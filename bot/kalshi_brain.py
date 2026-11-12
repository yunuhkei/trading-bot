"""The Kalshi brain: the same kind of strict test the memecoin brain (bot/brain.py) uses, on the Kalshi strategies F, G
and C and every slice of them (price band, city, days ahead, entry hour). Practice data only; "nothing qualifies" is a
valid answer and is reported as such.

Data: the saved history (data/kalshi_backtest_rows.json: 1,423 settled city-days, Sep 7 - Nov 5, with the weather
models' forecasts; data/kalshi_paths.json: Kalshi's hourly ask/bid for every bracket from the day before until
settlement), plus the live practice results (kalshi_state_practice.json, kalshi_state_big.json) for later days.

Honest by construction:
- every simulated buy uses only what existed then: the models' forecast made TWO days ahead (the one-day-ahead run for
  the afternoon high comes out the afternoon/evening before, after most buys), and each city's bias and typical error
  from days that had ended two days before (the day before isn't over at buy time);
- the price is the hourly ask at the buy (the last full hour), plus Kalshi's taker fee, plus `slip` per contract for a
  $100 order eating into the book (the history has no order-book depth: the 1c default is an assumption, unproven);
- one trade per city-day per rule, the first hour from 9 am to 11 pm Central the day before when the rule would buy
  (like the live bot's checks), held until Kalshi settles it.

The test (each strategy and each slice): 100+ trades on 14+ days, profit per trade after fees with a lower confidence
bound above +1% (one-sided, Bonferroni-corrected for every slice tested; days are the clusters), profitable on 60%+ of
days, positive over the last 7 days, and walk-forward: judged only on earlier days, it must then make money on 30+ later
trades it never saw.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_brain")
ROWS = Path("data/kalshi_backtest_rows.json")
PATHS = Path("data/kalshi_paths.json")
OUT = Path("models/kalshi_brain.json")
CFG = {"target": 0.01, "min_trades": 100, "min_days": 14, "day_share": 0.60, "alpha": 0.05, "min_oos_trades": 30,
       "warmup_days": 14, "budget": 100.0, "slip": 0.01, "sigma_floor": 0.8, "prior_days": 5, "max_disagree": 0.30}
HOURS = range(9, 24)
BANDS = [(0.60, 0.65), (0.65, 0.70), (0.70, 0.80), (0.80, 0.95)]
HOUR_BUCKETS = [(9, 11), (12, 14), (15, 17), (18, 20), (21, 23)]
STRATS = {k_: dict(v["rules"]) for k_, v in k.STRATEGIES.items() if k_ in ("F", "G", "C")}
for _r in STRATS.values():
    _r.setdefault("max_disagree", CFG["max_disagree"])


# ---- History: honest forecasts and candidate trades ----

def honest(rows: list[dict], cfg: dict = CFG) -> list[dict]:
    """Each city-day with its two-day-ahead forecast and the city's bias / typical error from days that ended at
    least two days earlier (blended with all cities' so far, `prior_days` days' worth). Rows without a two-day
    forecast keep mu=None (only the price-only rules can use them)."""
    out, errs = [], []                                   # errs: (day, station, actual - forecast)
    for r in sorted(rows, key=lambda r: (r["day"], r["station"])):
        cutoff = (date.fromisoformat(r["day"]) - timedelta(days=2)).isoformat()
        known = [(st, e) for d, st, e in errs if d <= cutoff]
        mine = [e for st, e in known if st == r["station"]]
        allv = [e for _, e in known]
        g = sum(allv) / len(allv) if allv else 0.0
        gerr = math.sqrt(sum(e * e for e in allv) / len(allv)) if allv else 2.0
        n, w = len(mine), cfg["prior_days"]
        bias = (sum(mine) + w * g) / (n + w)
        err = math.sqrt((sum(e * e for e in mine) + w * gerr ** 2) / (n + w))
        mu = r.get("mu2")
        out.append({**r, "mu": mu + bias if mu is not None else None, "sigma": max(err, r.get("spread2") or 0.0,
                                                                                    cfg["sigma_floor"]),
                    "bias": bias, "err": err})
        if r.get("actual") is not None and r.get("mu2") is not None:
            errs.append((r["day"], r["station"], r["actual"] - r["mu2"]))
    return out


def entry_time(day: str, hour_ct: int) -> float:
    from zoneinfo import ZoneInfo

    d = date.fromisoformat(day) - timedelta(days=1)
    return datetime(d.year, d.month, d.day, hour_ct, tzinfo=ZoneInfo("America/Chicago")).timestamp()


def quote(path: list[list], at: float) -> tuple[float, float] | None:
    """(YES ask, YES bid) from the last hourly candle that ended by `at`."""
    last = None
    for ts, ask, bid in path:
        if ts is None or ts > at:
            break
        last = (ask, bid)
    return last if last and 0 < last[0] < 1 else None


def snapshot(r: dict, paths: dict, hour: int) -> dict | None:
    """What a rule could see at `hour` (Central, the day before): every bracket's YES ask/bid, the favorite, the
    models' chance for each bracket and their top pick."""
    p = paths.get(r["event"]["event_ticker"])
    if not p:
        return None
    at = entry_time(r["day"], hour)
    q, chance, result = {}, {}, {}
    for m in r["event"]["markets"]:
        x = quote(p.get(m["ticker"]) or [], at)
        result[m["ticker"]] = m.get("result")
        if x:
            q[m["ticker"]] = x
        if r.get("mu") is not None:
            pr = k.bracket_prob(m, r["mu"], r["sigma"], None)
            if not math.isnan(pr):
                chance[m["ticker"]] = pr
    if not q:
        return None
    fav = max(q, key=lambda t: q[t][0] + q[t][1])
    return {"q": q, "fav": fav, "chance": chance, "top": max(chance, key=chance.get) if chance else None,
            "result": result}


def rule_pick(s: dict, rules: dict, band: tuple | None = None) -> dict | None:
    """The trade a rule makes at this snapshot (ticker, side, price, won), or None."""
    lo, hi = float(rules.get("min_price", 0.10)), float(rules.get("max_price", 0.97))
    if band:
        lo, hi = max(lo, band[0]), min(hi, band[1])
    if rules.get("pick") == "favorite":
        price = s["q"][s["fav"]][0]
        if not (lo <= price <= hi):
            return None
        if rules.get("agree") and (s["top"] is None or s["top"] != s["fav"]):
            return None
        return {"ticker": s["fav"], "side": "yes", "price": price, "won": s["result"][s["fav"]] == "yes"}
    if not s["chance"]:
        return None
    best = None
    for t, (ask, bid) in s["q"].items():
        p = s["chance"].get(t)
        if p is None:
            continue
        for side, price, fair in (("yes", ask, p), ("no", round(1 - bid, 4) if bid > 0 else 0.0, 1 - p)):
            if rules.get("side") and side != rules["side"]:
                continue
            if not (lo <= price <= hi) or not (0 < price < 1):
                continue
            edge = fair - price - k.fee(price)
            if edge >= float(rules.get("min_edge", 0.10)) and fair - price <= float(rules.get("max_disagree", 0.30)):
                if best is None or edge > best[0]:
                    best = (edge, {"ticker": t, "side": side, "price": price, "won": s["result"][t] == side})
    return best[1] if best else None


def ret(price: float, won: bool, cfg: dict = CFG) -> float:
    """Profit per dollar for a `budget` order at `price` (+ slip), after Kalshi's taker fee, held to settlement."""
    count = int(cfg["budget"] // (price + cfg["slip"] + k.fee(price)))
    if count < 1:
        return 0.0
    cost = count * (price + cfg["slip"]) + k.fee(price, count)
    return ((count if won else 0.0) - cost) / cost


def history_trades(rows: list[dict], paths: dict, cfg: dict = CFG) -> dict[str, list[dict]]:
    """slice name -> its trades on the history. Slices: each strategy alone, and each strategy limited to a price
    band, a city, or an entry-hour window (decided at buy time: the first hour the limited rule would buy)."""
    out: dict[str, list[dict]] = {}
    for r in honest(rows, cfg):
        snaps = {h: s for h in HOURS if (s := snapshot(r, paths, h))}
        if not snaps:
            continue
        city = r["station"]
        for key, rules in STRATS.items():
            needs_models = rules.get("agree") or rules.get("pick") != "favorite"
            if needs_models and r.get("mu") is None:
                continue
            variants = [(key, None, HOURS)]
            variants += [(f"{key}|price {lo * 100:.0f}-{hi * 100:.0f}c", (lo, hi), HOURS) for lo, hi in BANDS]
            variants += [(f"{key}|buy {a}-{b} h", None, range(a, b + 1)) for a, b in HOUR_BUCKETS]
            for name, band, hours in variants:
                for h in hours:
                    if h in snaps and (t := rule_pick(snaps[h], rules, band)):
                        out.setdefault(name, []).append(trade_row(r["day"], city, h, 1, t, cfg))
                        if name == key:          # the city slice is the whole rule's trades in that city
                            out.setdefault(f"{key}|city {city}", []).append(out[key][-1])
                            out.setdefault(f"{key}|1 day ahead", []).append(out[key][-1])
                        break
    return out


def trade_row(day: str, city: str, hour: int, ahead: int, t: dict, cfg: dict = CFG, src: str = "history") -> dict:
    return {"day": day, "city": city, "hour": hour, "ahead": ahead, "price": t["price"], "won": t["won"],
            "r": ret(t["price"], t["won"], cfg), "src": src}


# ---- Live practice results ----

TITLE = __import__("re").compile(r"in (.+?) on ([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})")


def from_title(title: str, name_city: dict[str, str]) -> tuple[date | None, str]:
    """(day, city) from a title like "Highest temperature in Miami on Nov 7, 2026: 87° to 88°" (older records)."""
    m = TITLE.search(title or "")
    if not m:
        return None, "?"
    mon = k.MONTHS.get(m.group(2).upper())
    return (date(int(m.group(4)), mon, int(m.group(3))) if mon else None), name_city.get(m.group(1), "?")


def live_trades(results: dict[str, list[dict]], series_city: dict[str, str], after: str,
                name_city: dict[str, str] | None = None) -> dict[str, list[dict]]:
    """strategy -> its live settled trades on days after `after` (the history's last day), as trade rows (their own
    real profit per dollar, fees included). Older records without the event or buy time still count for the
    strategy, its city and its price band (not for days-ahead or entry-hour slices)."""
    from zoneinfo import ZoneInfo

    by_event: dict[str, dict[str, dict]] = {}
    for key in sorted(results, key=lambda n: n.rstrip("0123456789") == n):   # the $1,000 accounts first
        res = results[key]
        base = key.rstrip("0123456789") or key
        for x in res:
            d = k.event_day(x.get("event") or "")
            city = series_city.get((x.get("event") or "").split("-")[0], "?")
            if not d:
                d, city = from_title(x.get("title", ""), name_city or {})
            cost = x.get("cost")
            if not cost and x.get("price"):              # older records: $5 trades, cost from the price
                count = int(5 // (x["price"] + k.fee(x["price"])))
                cost = count * x["price"] + k.fee(x["price"], count) if count else None
            if not d or d.isoformat() <= after or not cost:
                continue
            hour = ahead = None
            if x.get("opened"):
                opened = datetime.fromtimestamp(float(x["opened"]), ZoneInfo("America/Chicago"))
                start, _ = k.climate_day(d, "America/Chicago")
                hour, ahead = opened.hour, 1 if opened.astimezone(timezone.utc) < start else 0
            row = {"day": d.isoformat(), "city": city, "hour": hour, "ahead": ahead,
                   "price": float(x.get("price") or 0), "won": bool(x["won"]), "r": x["profit"] / cost,
                   "src": "live" if key == base else f"live {key}"}
            by_event.setdefault(base, {}).setdefault(f"{row['day']}|{city}", row)   # one per city-day
    return {base: list(v.values()) for base, v in by_event.items()}


def add_live(slices: dict[str, list[dict]], live: dict[str, list[dict]]) -> None:
    """Live trades join their strategy and every slice they belong to."""
    for key, rows in live.items():
        for t in rows:
            names = [key, f"{key}|city {t['city']}"]
            names += [f"{key}|price {lo * 100:.0f}-{hi * 100:.0f}c" for lo, hi in BANDS if lo <= t["price"] <= hi]
            if t["ahead"] is not None:
                names.append(f"{key}|{'1 day ahead' if t['ahead'] else 'same day'}")
            if t["hour"] is not None and t["ahead"]:     # entry-hour slices are hours the day before
                names += [f"{key}|buy {a}-{b} h" for a, b in HOUR_BUCKETS if a <= t["hour"] <= b]
            for n in names:
                slices.setdefault(n, []).append(t)


# ---- The test ----

def same_dropped(slices: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Without slices that are exactly their strategy (e.g. G's 60-65c band is all of G): not a separate test."""
    out = {}
    for n, trades in slices.items():
        base = slices.get(n.split("|")[0])
        if "|" in n and base is not None and len(base) == len(trades) and {id(t) for t in base} == {id(t) for t in trades}:
            continue
        out[n] = trades
    return out


def stats(trades: list[dict], z: float) -> dict:
    """Profit per trade after fees, its lower bound (days as clusters), days, share of days up, last 7 days."""
    n = len(trades)
    if not n:
        return {"n": 0, "days": 0, "mean": None, "lb": None, "won": None, "day_share": None, "last_week": None}
    mean = sum(t["r"] for t in trades) / n
    by_day: dict[str, list[float]] = {}
    for t in trades:
        x = by_day.setdefault(t["day"], [0, 0.0])
        x[0] += 1
        x[1] += t["r"]
    dn = len(by_day)
    lb = None
    if dn >= 2:
        var = sum((s - mean * c) ** 2 for c, s in by_day.values()) / n ** 2 * dn / (dn - 1)
        lb = mean - z * math.sqrt(var)
    last = max(by_day)
    since = (date.fromisoformat(last) - timedelta(days=6)).isoformat()
    return {"n": n, "days": dn, "mean": mean, "lb": lb, "won": sum(t["won"] for t in trades) / n,
            "day_share": sum(s > 0 for _, s in by_day.values()) / dn,
            "last_week": sum(s for d, (_, s) in by_day.items() if d >= since)}


def passes(st: dict, cfg: dict = CFG) -> tuple[bool, str]:
    if st["n"] < cfg["min_trades"]:
        return False, f"only {st['n']} trades (needs {cfg['min_trades']})"
    if st["days"] < cfg["min_days"]:
        return False, f"only {st['days']} days (needs {cfg['min_days']})"
    if st["lb"] is None or st["lb"] <= cfg["target"]:
        return False, (f"{st['mean']:+.1%} a trade after fees, low end {st['lb']:+.1%} (needs above {cfg['target']:+.0%})"
                       if st["lb"] is not None else f"{st['mean']:+.1%} a trade, low end unknown")
    if st["day_share"] < cfg["day_share"]:
        return False, f"up on only {st['day_share']:.0%} of days (needs {cfg['day_share']:.0%})"
    if st["last_week"] <= 0:
        return False, f"lost over the last 7 days ({st['last_week']:+.2f} per $1 staked)"
    return True, "passes"


def judge(slices: dict[str, list[dict]], cfg: dict = CFG) -> dict:
    """Every slice's record and verdict, with the walk-forward check, corrected for how many slices were tested."""
    from statistics import NormalDist

    tested = len(slices)
    z = NormalDist().inv_cdf(1 - cfg["alpha"] / max(1, tested))
    out = {}
    for name, trades in slices.items():
        trades = sorted(trades, key=lambda t: t["day"])
        st = stats(trades, z)
        ok, why = passes(st, cfg)
        days = sorted({t["day"] for t in trades})
        oos = []
        for i in range(cfg["warmup_days"], len(days)):              # approve on earlier days, score the next one
            before = [t for t in trades if t["day"] < days[i]]
            if passes(stats(before, z), cfg)[0]:
                oos += [t for t in trades if t["day"] == days[i]]
        st["oos_n"] = len(oos)
        st["oos_mean"] = sum(t["r"] for t in oos) / len(oos) if oos else None
        if ok and len(oos) < cfg["min_oos_trades"]:
            ok, why = False, f"only {len(oos)} trades on later days it never saw (needs {cfg['min_oos_trades']})"
        elif ok and st["oos_mean"] <= 0:
            ok, why = False, f"lost on later days it never saw ({st['oos_mean']:+.1%} a trade)"
        st.update(ok=ok, why=why, live=sum(t["src"] != "history" for t in trades))
        out[name] = st
    return {"tested": tested, "z": round(z, 3), "slices": out, "approved": sorted(n for n, v in out.items() if v["ok"])}


def lines(res: dict, top: int = 6) -> list[str]:
    s = res["slices"]
    fmt = lambda n, v: (f"{n}: {v['n']} trades ({v['live']} live), won {v['won']:.0%}, {v['mean']:+.1%} a trade after "
                        f"fees, low end {v['lb']:+.1%}, {v['days']} days, {v['day_share']:.0%} up" if v["n"] and v["lb"] is not None
                        else f"{n}: {v['n']} trades")
    out = [f"Kalshi brain: {res['tested']} strategies and slices tested (z = {res['z']}). "
           + (f"APPROVED: {', '.join(res['approved'])}" if res["approved"] else "Nothing qualifies.")]
    for key in STRATS:
        if key in s:
            out.append(fmt(key, s[key]) + f". {s[key]['why']}")
    ranked = sorted((n for n in s if "|" in n and s[n]["lb"] is not None and s[n]["n"] >= 30), key=lambda n: -s[n]["lb"])
    if ranked:
        out.append("Best slices (by low end):")
        out += ["  " + fmt(n, s[n]) + f". {s[n]['why']}" for n in ranked[:top]]
    return out


def run(state_paths: tuple[str, ...] = ("kalshi_state_practice.json", "kalshi_state_big.json"), save: bool = True) -> dict:
    rows = json.loads(ROWS.read_text())
    paths = json.loads(PATHS.read_text())
    slices = history_trades(rows, paths)
    series_city = {r["event"]["event_ticker"].split("-")[0]: r["station"] for r in rows}
    name_city = {TITLE.search(r["event"]["title"]).group(1): r["station"] for r in rows if TITLE.search(r["event"].get("title", ""))}
    results: dict[str, list[dict]] = {}
    for p in state_paths:
        if not Path(p).exists():
            continue
        st = json.loads(Path(p).read_text())
        for key, acct in (st.get("variants") or {}).items():
            if key in STRATS:
                results[key] = acct.get("results", [])
        for key in STRATS:
            for n, acct in st.items():
                if isinstance(acct, dict) and n.startswith(key) and n[len(key):].isdigit():
                    results[n] = acct.get("results", [])
    add_live(slices, live_trades(results, series_city, max(r["day"] for r in rows), name_city))
    res = judge(same_dropped(slices))
    text = "\n".join(lines(res))
    print(text, flush=True)
    if save:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps({"tests": res["tested"], "approved": res["approved"], "z": res["z"],
                                   "slices": res["slices"], "text": text}, indent=1, default=str))
    return res
