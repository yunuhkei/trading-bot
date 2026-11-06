"""Walk-forward test of ways to improve the Kalshi bot's main strategy (A: YES on tomorrow's favorite bracket at 60-80c).

For every settled city-day saved by the day-before backtest (data/kalshi_backtest_rows.json) it reads Kalshi's hourly
prices from the day before until the high is settled (data/kalshi_paths.json), then trades each idea the way the live bot
would: $5 a trade, one per city-day, real fees, settled by Kalshi's real result. Ideas:

- A: the market's favorite at 60-80c (the live main strategy), bought at a set time the day before
- agree: only when the weather models' most likely bracket is the same one (A + C together)
- gap: only when the models' chance for that bracket beats the price, after fees, by at least `gap`
- cities: skip cities whose forecasts have missed by more than `max_err` degrees (typical error so far)
- take profit: sell as soon as the bid reaches `take` instead of holding until it settles

Walk-forward: on each test day, an idea's setting (its gap, max_err or take) is the one that made the most on the EARLIER
days only; the day's trades are then judged by what really happened. Nothing is chosen with hindsight. Weather-model
corrections are walk-forward too (kalshi_backtest.corrected: each city's bias from earlier days only).
Run it from GitHub: Actions -> kalshi-backtest -> walk-forward: yes, or `python -m bot kalshi-backtest --walkforward`.
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_walkforward")
ROWS = Path("data/kalshi_backtest_rows.json")
PATHS = Path("data/kalshi_paths.json")
BUDGET = 5.0
WARMUP_DAYS = 7          # the first week only teaches (no held-out trades)
MIN_LEARN = 15           # an idea's setting is picked only once the earlier days have this many of its trades


# ---- Data: hourly prices from the day before until settlement ----

def collect_paths(rows: list[dict], budget_s: float = 3000) -> dict:
    """event -> market -> [[end of hour (unix), YES ask, YES bid], ...] from 6 am Central the day before to the end of
    the climate day (adds to what's saved)."""
    data = json.loads(PATHS.read_text()) if PATHS.exists() else {}
    t0 = time.time()
    for r in rows:
        e = r["event"]["event_ticker"]
        if e in data:
            continue
        if time.time() - t0 > budget_s:
            log.warning("time budget reached; saving what was collected")
            break
        d = date.fromisoformat(r["day"])
        midnight = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        try:
            j = k.kget(f"/series/{e.split('-')[0]}/events/{e}/candlesticks",
                       {"start_ts": int((midnight - timedelta(hours=14)).timestamp()),
                        "end_ts": int((midnight + timedelta(hours=31)).timestamp()), "period_interval": 60})
        except Exception as ex:
            log.warning("%s: %s", e, ex)
            continue
        data[e] = {t: [[c.get("end_period_ts"), k._f((c.get("yes_ask") or {}).get("close_dollars")),
                        k._f((c.get("yes_bid") or {}).get("close_dollars"))] for c in cs]
                   for t, cs in zip(j.get("market_tickers", []), j.get("market_candlesticks", []))}
        time.sleep(0.4)
    return data


def quote(path: list[list], at: float) -> tuple[float, float] | None:
    """(YES ask, YES bid) from the last hourly candle that ended by `at`."""
    last = None
    for ts, ask, bid in path:
        if ts is None or ts > at:
            break
        last = (ask, bid)
    return last if last and 0 < last[0] < 1 else None


# ---- One city-day: what each idea would do ----

def entry_time(day: str, hour_ct: int) -> float:
    """The day before `day`, at `hour_ct` o'clock Central (standard or daylight time as it was)."""
    from zoneinfo import ZoneInfo

    d = date.fromisoformat(day) - timedelta(days=1)
    return datetime(d.year, d.month, d.day, hour_ct, tzinfo=ZoneInfo("America/Chicago")).timestamp()


def city_day(r: dict, paths: dict, hour_ct: int, sigma_floor: float = 0.8) -> dict | None:
    """The favorite bracket at the entry time, its price, the models' chance for it and their own top pick, how the
    city's forecasts have done so far, and the YES bid path after the buy (for take-profit)."""
    p = paths.get(r["event"]["event_ticker"])
    if not p:
        return None
    at = entry_time(r["day"], hour_ct)
    mu, sg = r["mu"] + r.get("bias", 0.0), max(r.get("err", 2.0), r["spread"], sigma_floor)
    quotes, chance = {}, {}
    for m in r["event"]["markets"]:
        q = quote(p.get(m["ticker"]) or [], at)
        if q:
            quotes[m["ticker"]] = q
        pr = k.bracket_prob(m, mu, sg, None)
        if not math.isnan(pr):
            chance[m["ticker"]] = pr
    if not quotes:
        return None
    fav = max(quotes, key=lambda t: quotes[t][0] + quotes[t][1])
    result = {m["ticker"]: m["result"] for m in r["event"]["markets"]}
    after = [(ts, bid) for ts, _, bid in p.get(fav) or [] if ts and ts > at]
    return {"day": r["day"], "station": r["station"], "fav": fav, "price": quotes[fav][0], "won": result.get(fav) == "yes",
            "chance": chance.get(fav, 0.0), "model_top": max(chance, key=chance.get) if chance else None,
            "err": r.get("err", 2.0), "bids": after}


def outcome(c: dict, take: float | None = None) -> tuple[float, float, bool]:
    """(cost, money back, won) for $5 of YES on the favorite: sold at the first bid >= `take`, else held to the end."""
    price = c["price"]
    count = int(BUDGET // (price + k.fee(price)))
    if count < 1:
        return 0.0, 0.0, False
    cost = count * price + k.fee(price, count)
    if take is not None:
        for _, bid in c["bids"]:
            if bid >= take:
                return cost, count * bid - k.fee(bid, count), True
    return cost, (count if c["won"] else 0.0), c["won"]


def buys(c: dict, rule: dict) -> bool:
    """Whether an idea buys this city-day's favorite."""
    if not (rule.get("min_price", 0.60) <= c["price"] <= rule.get("max_price", 0.80)):
        return False
    if rule.get("agree") and c["model_top"] != c["fav"]:
        return False
    if rule.get("gap") is not None and c["chance"] - c["price"] - k.fee(c["price"]) < rule["gap"]:
        return False
    if rule.get("max_err") is not None and c["err"] > rule["max_err"]:
        return False
    return True


# ---- Ideas and their settings ----

IDEAS = {
    "A": {"label": "Market favorites (now)", "base": {}, "grid": [{}]},
    "agree": {"label": "Agreement (A + models pick the same bracket)", "base": {"agree": True}, "grid": [{}]},
    "gap": {"label": "Models' chance beats the price by a gap", "base": {},
            "grid": [{"gap": g} for g in (0.10, 0.05, 0.0, -0.05, -0.10)]},
    "cities": {"label": "Skip cities whose forecasts keep missing", "base": {},
               "grid": [{"max_err": e} for e in (1.5, 2.0, 2.5, 3.0, 99)]},
    "take": {"label": "Take profit early", "base": {},
             "grid": [{"take": x} for x in (0.85, 0.90, 0.95, None)]},
    "agree+take": {"label": "Agreement + take profit", "base": {"agree": True},
                   "grid": [{"take": x} for x in (0.85, 0.90, 0.95, None)]},
}


def day_trades(cs: list[dict], rule: dict) -> list[tuple[float, float, bool]]:
    return [outcome(c, rule.get("take")) for c in cs if buys(c, rule)]


def walk_forward(cds: list[dict], ideas: dict = IDEAS) -> dict:
    """Each idea's held-out record: on each day after the warm-up, the setting that made the most on earlier days."""
    days = sorted({c["day"] for c in cds})
    by_day = {d: [c for c in cds if c["day"] == d] for d in days}
    out = {}
    for key, idea in ideas.items():
        rules = [{**idea["base"], **g} for g in idea["grid"]]
        past = {i: [] for i in range(len(rules))}            # each setting's trades on the days so far
        held, picks = [], []
        for n, d in enumerate(days):
            if n >= WARMUP_DAYS:
                ok = [i for i in past if len(past[i]) >= MIN_LEARN]
                best = max(ok, key=lambda i: sum(b - c for c, b, _ in past[i])) if ok else len(rules) - 1
                picks.append(best)
                held += [(d, *t) for t in day_trades(by_day[d], rules[best])]
            for i, rule in enumerate(rules):
                past[i] += day_trades(by_day[d], rule)
        last = max(past, key=lambda i: sum(b - c for c, b, _ in past[i])) if any(past.values()) else 0
        out[key] = {"label": idea["label"], "trades": held, "setting": rules[last],
                    "picked": {json.dumps(rules[i]): picks.count(i) for i in set(picks)}}
    return out


def summary(trades: list[tuple]) -> dict:
    cost = sum(t[1] for t in trades)
    back = sum(t[2] for t in trades)
    by_day = {}
    for t in trades:
        by_day[t[0]] = by_day.get(t[0], 0.0) + t[2] - t[1]
    best_day = max(by_day.values()) if by_day else 0.0
    return {"n": len(trades), "won": sum(t[3] for t in trades), "profit": back - cost, "staked": cost,
            "roi": (back - cost) / cost if cost else 0.0, "days": len(by_day), "without_best_day": back - cost - best_day}


def report(rows: list[dict], paths: dict) -> tuple[str, dict]:
    from .kalshi_backtest import corrected

    rs = corrected(rows)
    lines = [f"Kalshi walk-forward test: {len(rs)} settled city-days ({rs[0]['day']} to {rs[-1]['day']}), $5 a trade; "
             f"the first {WARMUP_DAYS} days only teach, every later day is judged with settings picked on earlier days."]
    res = {}
    for hour in (12, 18):
        cds = [c for c in (city_day(r, paths, hour) for r in rs) if c]
        wf = walk_forward(cds)
        days = sorted({c["day"] for c in cds})[WARMUP_DAYS:]
        half = days[len(days) // 2] if days else ""
        lines.append(f"\nBuying at {hour % 12 or 12} {'pm' if hour >= 12 else 'am'} Central the day before "
                     f"({len(days)} held-out days, {days[0] if days else '-'} to {days[-1] if days else '-'}):")
        for key, o in wf.items():
            s = summary(o["trades"])
            a = summary([t for t in o["trades"] if t[0] < half])
            b = summary([t for t in o["trades"] if t[0] >= half])
            res[(hour, key)] = {**s, "first": a, "second": b, "setting": o["setting"]}
            lines.append(f"  {key}. {o['label']}: {s['n']} trades, {s['won']}-{s['n'] - s['won']}, {s['profit']:+,.2f} "
                         f"({s['roi']:+.0%}); first half {a['profit']:+.2f} ({a['n']}), second half {b['profit']:+.2f} "
                         f"({b['n']}); without its best day {s['without_best_day']:+.2f}; setting now {o['setting'] or 'none'}")
    return "\n".join(lines), res


def run(collect: bool = True, save: bool = True):
    from .signals import alert_target, notify

    rows = json.loads(ROWS.read_text())
    paths = collect_paths(rows) if collect else json.loads(PATHS.read_text())
    if save and collect:
        PATHS.write_text(json.dumps(paths, separators=(",", ":")))
    text, _ = report(rows, paths)
    print(text, flush=True)
    target = alert_target()
    if target:
        notify(target, "🧪 Kalshi walk-forward test", text[:3500], buy=True, tag="bar_chart")
