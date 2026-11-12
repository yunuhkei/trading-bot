"""The blend: the market's price and the weather models together, each city learning how much to trust each model,
from past days only. A practice strategy only if it passes the walk-forward test (bot/kalshi_brain.py's rules).

For each city-day (the saved history, data/kalshi_backtest_rows.json + data/kalshi_paths.json):

1. Each model's forecast made two days ahead (data/kalshi_model_highs.json, collected from Open-Meteo's previous-runs
   API; surely known before any buy the day before).
2. Per city and model, the bias and typical error from days that ended 2+ days before the buy, shrunk toward that
   model's all-city record (`prior_days` days' worth). The city's forecast: each model corrected for its bias,
   weighted by 1 / its typical error squared. Its own typical error: how the city's blended forecast missed before.
3. Each bracket's chance from that forecast, mixed with the market's own chance (the bid/ask midpoint, the brackets
   scaled to add up to 1): blend = a x models + (1 - a) x market, with `a` the mix that scored best (log loss) on the
   brackets of days that ended 2+ days before.
4. Buy a side only where the blend beats its ask by Kalshi's fee + 1c slippage + `margin`, the first hour from 9 am to
   11 pm Central the day before it does, $100, held to settlement. `margin` is picked walk-forward too: on each day,
   the one that made the most on earlier days.
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from . import kalshi as k
from . import kalshi_brain as kb

log = logging.getLogger("kalshi_blend")
HIGHS = Path("data/kalshi_model_highs.json")
PREVIOUS_RUNS = "https://previous-runs-api.open-meteo.com/v1/forecast"
CFG = {"prior_days": 5, "sigma_floor": 0.8, "mixes": [i / 10 for i in range(11)], "margins": [0.02, 0.05, 0.10, 0.15],
       "min_learn_days": 10, "min_learn_trades": 15}


# ---- Data: each model's forecast high, made one and two days ahead ----

def model_highs(info: dict, start: date, end: date) -> dict[str, dict[str, dict[str, float]]]:
    """day -> {"1": {model: high}, "2": {model: high}}: each model's forecast for the day's highest hourly
    temperature, from the runs made one and two days before each hour."""
    import requests
    from zoneinfo import ZoneInfo

    hourly = "temperature_2m_previous_day1,temperature_2m_previous_day2"
    for models in (k.MODELS, k.SAFE_MODELS):
        r = requests.get(PREVIOUS_RUNS, params={"latitude": info["lat"], "longitude": info["lon"], "hourly": hourly,
                                                "temperature_unit": "fahrenheit", "timezone": info["tz"],
                                                "timeformat": "unixtime", "models": ",".join(models),
                                                "start_date": start.isoformat(), "end_date": end.isoformat()}, timeout=90)
        if r.status_code != 400:
            break
    r.raise_for_status()
    h, tz = r.json().get("hourly", {}), ZoneInfo(info["tz"])
    times, out = h.get("time", []), {}
    for key, vals in h.items():
        for lead in ("1", "2"):
            var = f"temperature_2m_previous_day{lead}"
            if not key.startswith(var):
                continue
            model = key[len(var):].lstrip("_") or "best_match"
            for t, v in zip(times, vals):
                if v is None:
                    continue
                d = datetime.fromtimestamp(t, tz).date().isoformat()
                cur = out.setdefault(d, {}).setdefault(lead, {})
                cur[model] = max(cur.get(model, -999.0), float(v))
    return out


def collect(rows: list[dict], path: Path = HIGHS) -> dict:
    """station -> day -> {"1": {...}, "2": {...}} for every saved city-day (adds to what's saved)."""
    data = json.loads(path.read_text()) if path.exists() else {}
    stations: dict = {}
    for st in sorted({r["station"] for r in rows}):
        days = [r["day"] for r in rows if r["station"] == st]
        if st in data and all(d in data[st] for d in days):
            continue
        try:
            info = k.station_info(st, stations)
            data[st] = model_highs(info, date.fromisoformat(min(days)) - timedelta(days=1), date.fromisoformat(max(days)))
            log.warning("%s: %d days of model forecasts", st, len(data[st]))
        except Exception as e:
            log.warning("%s model forecasts: %s", st, e)
        time.sleep(1.0)
    path.write_text(json.dumps(data, separators=(",", ":")))
    return data


# ---- Learning from past days ----

class Errors:
    """Running sums of forecast errors (actual - forecast) by group, added in day order and read as of a cutoff day."""

    def __init__(self):
        self.pending: list[tuple[str, tuple, float]] = []          # (day, group keys, error), in day order
        self.i, self.sums = 0, {}

    def add(self, day: str, keys: tuple, err: float):
        self.pending.append((day, keys, err))

    def upto(self, cutoff: str):
        while self.i < len(self.pending) and self.pending[self.i][0] <= cutoff:
            _, keys, e = self.pending[self.i]
            for g in keys:
                x = self.sums.setdefault(g, [0, 0.0, 0.0])
                x[0] += 1
                x[1] += e
                x[2] += e * e
            self.i += 1

    def shrunk(self, key, prior_key, w: float) -> tuple[float, float]:
        """(bias, typical error) for `key`, shrunk toward `prior_key`'s by `w` days' worth."""
        n, s, ss = self.sums.get(key, (0, 0.0, 0.0))
        gn, gs, gss = self.sums.get(prior_key, (0, 0.0, 0.0))
        g = gs / gn if gn else 0.0
        gerr2 = gss / gn if gn else 2.5 ** 2
        return (s + w * g) / (n + w), math.sqrt((ss + w * gerr2) / (n + w))


def forecasts(rows: list[dict], highs: dict, cfg: dict = CFG) -> dict[str, dict]:
    """event -> {"mu", "sigma", "models"}: each city-day's blended model forecast and its typical error, from what was
    known 2+ days before (the walk-forward model weights)."""
    errs, berrs, out = Errors(), Errors(), {}
    for r in sorted(rows, key=lambda r: (r["day"], r["station"])):
        f = ((highs.get(r["station"]) or {}).get(r["day"]) or {}).get("2") or {}
        cutoff = (date.fromisoformat(r["day"]) - timedelta(days=2)).isoformat()
        errs.upto(cutoff)
        berrs.upto(cutoff)
        num = den = 0.0
        for m, v in f.items():
            bias, err = errs.shrunk((r["station"], m), ("*", m), cfg["prior_days"])
            w = 1 / max(err, 0.5) ** 2
            num += w * (v + bias)
            den += w
        if den:
            _, sig = berrs.shrunk(r["station"], "*", cfg["prior_days"])
            out[r["event"]["event_ticker"]] = {"mu": num / den, "sigma": max(sig, cfg["sigma_floor"]), "models": len(f)}
            if r.get("actual") is not None:
                berrs.add(r["day"], (r["station"], "*"), r["actual"] - num / den)
        if r.get("actual") is not None:
            for m, v in f.items():
                errs.add(r["day"], ((r["station"], m), ("*", m)), r["actual"] - v)
    return out


def market_chances(q: dict[str, tuple[float, float]]) -> dict[str, float]:
    """Each bracket's chance by the market: the bid/ask midpoint, scaled so the brackets add up to 1."""
    mids = {t: (a + b) / 2 for t, (a, b) in q.items()}
    s = sum(mids.values())
    return {t: v / s for t, v in mids.items()} if s > 0 else {}


def log_loss(p: float, hit: bool) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return -math.log(p if hit else 1 - p)


# ---- The test ----

def city_day_snaps(r: dict, paths: dict, fc: dict) -> dict[int, dict]:
    """hour -> what the blend sees then: each bracket's ask/bid, market chance and model chance."""
    p = paths.get(r["event"]["event_ticker"])
    if not p or not fc:
        return {}
    out = {}
    for h in kb.HOURS:
        at = kb.entry_time(r["day"], h)
        q, model = {}, {}
        for m in r["event"]["markets"]:
            x = kb.quote(p.get(m["ticker"]) or [], at)
            pr = k.bracket_prob(m, fc["mu"], fc["sigma"], None)
            if x and not math.isnan(pr):
                q[m["ticker"]], model[m["ticker"]] = x, pr
        if len(q) >= 2:
            out[h] = {"q": q, "model": model, "market": market_chances(q),
                      "result": {m["ticker"]: m.get("result") for m in r["event"]["markets"]}}
    return out


def pick(snaps: dict[int, dict], mix: float, margin: float, slip: float = 0.01) -> dict | None:
    """The first hour the blend beats an ask by fee + slip + margin: (ticker, side, price, won, hour)."""
    for h in sorted(snaps):
        s, best = snaps[h], None
        for t, (ask, bid) in s["q"].items():
            pb = mix * s["model"][t] + (1 - mix) * s["market"][t]
            for side, price, fair in (("yes", ask, pb), ("no", round(1 - bid, 4) if bid > 0 else 0.0, 1 - pb)):
                if not (0.05 <= price <= 0.95):
                    continue
                edge = fair - price - k.fee(price) - slip
                if edge > margin and (best is None or edge > best[0]):
                    best = (edge, {"ticker": t, "side": side, "price": price, "won": s["result"][t] == side, "hour": h})
        if best:
            return best[1]
    return None


def walk_forward(rows: list[dict], paths: dict, highs: dict, cfg: dict = CFG) -> dict:
    """The blend's held-out trades: on each day, the mix and margin are the ones that did best on days that ended 2+
    days before (the mix by log loss on every bracket, the margin by profit); then that day's trades are scored."""
    fcs = forecasts(rows, highs, cfg)
    days_rows: dict[str, list[dict]] = {}
    for r in rows:
        days_rows.setdefault(r["day"], []).append(r)
    snaps = {r["event"]["event_ticker"]: city_day_snaps(r, paths, fcs.get(r["event"]["event_ticker"]))
             for r in rows}
    loss = {a: [] for a in cfg["mixes"]}                         # (day, loss) per mix, scored at noon the day before
    made = {(a, m): [] for a in cfg["mixes"] for m in cfg["margins"]}   # (day, trade) per setting
    held, chosen = [], []
    days = sorted(days_rows)
    for n, d in enumerate(days):
        cutoff = (date.fromisoformat(d) - timedelta(days=2)).isoformat()
        learn_days = {x for x in days[:n] if x <= cutoff}
        if len(learn_days) >= cfg["min_learn_days"]:
            mix = min(cfg["mixes"], key=lambda a: sum(v for dd, v in loss[a] if dd <= cutoff))
            ok = [mg for mg in cfg["margins"] if sum(1 for dd, _ in made[(mix, mg)] if dd <= cutoff) >= cfg["min_learn_trades"]]
            margin = max(ok, key=lambda mg: sum(t["r"] for dd, t in made[(mix, mg)] if dd <= cutoff)) if ok else max(cfg["margins"])
            chosen.append((d, mix, margin))
            for r in days_rows[d]:
                t = pick(snaps[r["event"]["event_ticker"]], mix, margin)
                if t:
                    held.append(kb.trade_row(d, r["station"], t["hour"], 1, t))
        for r in days_rows[d]:                                    # what each setting would have done (for later days)
            s = snaps[r["event"]["event_ticker"]]
            noon = s.get(12) or (s[min(s)] if s else None)
            for a in cfg["mixes"]:
                if noon:
                    loss[a].append((d, sum(log_loss(a * noon["model"][t] + (1 - a) * noon["market"][t],
                                                    noon["result"][t] == "yes") for t in noon["q"])))
                for mg in cfg["margins"]:
                    t = pick(s, a, mg)
                    if t:
                        made[(a, mg)].append((d, kb.trade_row(d, r["station"], t["hour"], 1, t)))
    return {"trades": held, "chosen": chosen}


def run(collect_data: bool = True) -> dict:
    """Collect the models' forecasts (if needed), run the walk-forward test and judge it like the brain does."""
    rows = json.loads(kb.ROWS.read_text())
    paths = json.loads(kb.PATHS.read_text())
    highs = collect(rows) if collect_data else json.loads(HIGHS.read_text())
    wf = walk_forward(rows, paths, highs)
    tests = 1
    try:
        tests += int(json.loads(kb.OUT.read_text()).get("tests", 0))
    except (OSError, ValueError):
        pass
    from statistics import NormalDist

    z = NormalDist().inv_cdf(1 - kb.CFG["alpha"] / tests)
    st = kb.stats(wf["trades"], z)
    ok, why = kb.passes(st, kb.CFG) if st["n"] else (False, "no trades")
    last = wf["chosen"][-1] if wf["chosen"] else None
    text = (f"Kalshi blend (market + weather models, per-city trust), walk-forward on {len({t['day'] for t in wf['trades']})} "
            f"days: {st['n']} trades" + (f", won {st['won']:.0%}, {st['mean']:+.1%} a trade after fees, low end "
                                         f"{st['lb']:+.1%} (corrected for {tests} tests), {st['day_share']:.0%} of days up"
                                         if st["n"] and st["lb"] is not None else "")
            + f". {'PASSES' if ok else 'Does not pass'}: {why}."
            + (f" Latest pick: {last[1]:.0%} models / {1 - last[1]:.0%} market, margin {last[2] * 100:.0f}c." if last else ""))
    print(text, flush=True)
    out = {"passes": ok, "why": why, "stats": st, "tests": tests, "chosen": wf["chosen"][-5:], "text": text}
    Path("models").mkdir(exist_ok=True)
    Path("models/kalshi_blend.json").write_text(json.dumps(out, indent=1, default=str))
    return out
