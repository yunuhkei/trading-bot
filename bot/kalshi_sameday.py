"""Backtest same-day trading on Kalshi's daily-high markets: once the station has recorded most of the day, does the
market still misprice brackets the readings have (nearly) decided?

For every settled city-day in data/kalshi_backtest_rows.json (saved by the day-before backtest) it collects:
- the station's readings that day (5-minute, hourly, and the 6-hour highs measured like the official report), and
- Kalshi's hourly prices for each bracket during the day,
and saves them to data/kalshi_sameday.json. Then, hour by hour, it compares what the readings said so far with what the
market charged and what really happened. Run it from GitHub: Actions -> kalshi-backtest -> Run workflow, same-day: yes
(Kalshi limits requests from shared servers), or `python -m bot kalshi-backtest --sameday`.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_sameday")
ROWS = Path("data/kalshi_backtest_rows.json")
DATA = Path("data/kalshi_sameday.json")


def day_candles(series: str, event_ticker: str, start: datetime, end: datetime) -> dict[str, list[list]]:
    """market -> [[end of hour (unix), YES ask, YES bid], ...] over the climate day."""
    j = k.kget(f"/series/{series}/events/{event_ticker}/candlesticks",
               {"start_ts": int(start.timestamp()), "end_ts": int(end.timestamp()) + 3600, "period_interval": 60})
    out = {}
    for ticker, candles in zip(j.get("market_tickers", []), j.get("market_candlesticks", [])):
        out[ticker] = [[c.get("end_period_ts"), k._f((c.get("yes_ask") or {}).get("close_dollars")),
                        k._f((c.get("yes_bid") or {}).get("close_dollars"))] for c in candles]
    return out


def collect(rows: list[dict] | None = None, budget_s: float = 3000) -> dict:
    """Readings and same-day prices for every settled city-day (adds to what's already saved)."""
    from zoneinfo import ZoneInfo

    rows = rows if rows is not None else json.loads(ROWS.read_text())
    data = json.loads(DATA.read_text()) if DATA.exists() else {"readings": {}, "days": {}}
    t0, stations = time.time(), {}
    for r in sorted(rows, key=lambda r: (r["station"], r["day"])):
        key = r["event"]["event_ticker"]
        if key in data["days"]:
            continue
        if time.time() - t0 > budget_s:
            log.warning("time budget reached; saving what was collected")
            break
        st = r["station"]
        try:
            info = k.station_info(st, stations)
            start, end = k.climate_day(date.fromisoformat(r["day"]), info["tz"])
            tz = ZoneInfo(info["tz"])
            got = data["readings"].setdefault(st, {})
            for d in sorted({start.astimezone(tz).date().isoformat(), (end - timedelta(seconds=1)).astimezone(tz).date().isoformat()}):
                if d not in got:
                    got[d] = k.iem_readings(st, info, d)
                    time.sleep(0.3)
            series = r["event"].get("series_ticker") or key.split("-")[0]
            candles = day_candles(series, key, start, end)
            time.sleep(0.8)
        except Exception as e:
            log.warning("%s: %s", key, e)
            continue
        data["days"][key] = {"station": st, "day": r["day"], "tz": info["tz"], "start": start.timestamp(),
                             "end": end.timestamp(),
                             "markets": [{"ticker": m["ticker"], "strike_type": m.get("strike_type"),
                                          "floor_strike": m.get("floor_strike"), "cap_strike": m.get("cap_strike"),
                                          "result": m["result"], "value": m.get("expiration_value")}
                                         for m in r["event"]["markets"]],
                             "candles": candles}
    return data




# --- the test -------------------------------------------------------------------------------------------------------

DROPS = (1.0, 2.0, 4.0)          # how far the temperature has fallen from the day's high so far (°F): buckets
MAX_UP = 12                      # the final high is modeled up to 12° above what's recorded


def drop_bucket(drop: float) -> int:
    return sum(drop >= d for d in DROPS)


def official_value(day: dict) -> float | None:
    for m in day["markets"]:
        try:
            return float(m.get("value"))
        except (TypeError, ValueError):
            continue
    return None


def snapshots(data: dict, hours=range(9, 24)) -> list[dict]:
    """For every city-day and hour (local standard time): what had been recorded by then, how much it had cooled since,
    each bracket's prices then, and the official high."""
    out = []
    for key, d in data["days"].items():
        official = official_value(d)
        readings = [r for day in data["readings"].get(d["station"], {}).values() for r in day]
        if official is None or not readings:
            continue
        start = datetime.fromtimestamp(d["start"], timezone.utc)
        end = datetime.fromtimestamp(d["end"], timezone.utc)
        obs = sorted((t, v) for t, v, kind in readings if kind == "ob" and d["start"] <= t < d["end"])
        for h in hours:
            t = d["start"] + h * 3600
            floor = k.recorded_high(readings, start, end, now=t)
            now_obs = [v for ts, v in obs if ts <= t]
            if floor is None or not now_obs:
                continue
            markets = []
            for m in d["markets"]:
                c = [c for c in d["candles"].get(m["ticker"], []) if c[0] and c[0] <= t]
                if not c:
                    continue
                ya, yb = c[-1][1], c[-1][2]
                if 0 < ya < 1 and 0 <= yb < 1:
                    markets.append({**{x: m[x] for x in ("ticker", "strike_type", "floor_strike", "cap_strike", "result")},
                                    "yes_ask": ya, "no_ask": round(1 - yb, 4)})
            out.append({"event": key, "station": d["station"], "day": d["day"], "hour": h, "floor": floor,
                        "drop": floor - now_obs[-1], "official": official, "markets": markets})
    return out


def fit(snaps: list[dict], prior: float = 0.5) -> dict:
    """How far the official high ends above what was recorded, by hour and how much it had cooled:
    {"hour|drop bucket": {offset: chance}} (offsets -2..MAX_UP, smoothed), plus "n" per key."""
    counts: dict[str, dict[int, float]] = {}
    for s in snaps:
        x = int(max(-2, min(MAX_UP, round(s["official"] - s["floor"]))))
        c = counts.setdefault(f"{s['hour']}|{drop_bucket(s['drop'])}", {})
        c[x] = c.get(x, 0) + 1
    table, n = {}, {}
    for key, c in counts.items():
        total = sum(c.values())
        # smoothing: a little weight on every offset near the ones seen, so nothing seen-once is "certain"
        sm = {x: c.get(x, 0) + prior * (1 if any(abs(x - y) <= 1 for y in c) else 0.02) for x in range(-2, MAX_UP + 1)}
        z = sum(sm.values())
        table[key], n[key] = {x: v / z for x, v in sm.items()}, total
    return {"table": table, "n": n}


def chance(model: dict, hour: int, drop: float, floor: float, m: dict, min_n: int = 20) -> float | None:
    """Chance this bracket wins from the readings alone (None if the table has fewer than `min_n` days like this)."""
    key = f"{hour}|{drop_bucket(drop)}"
    if model["n"].get(key, 0) < min_n:
        return None
    lo, hi, kind = m.get("floor_strike"), m.get("cap_strike"), m.get("strike_type")
    p = 0.0
    for x, q in model["table"][key].items():
        v = floor + x
        if (kind == "less" and v < hi) or (kind == "greater" and v > lo) or (kind == "between" and lo <= v <= hi):
            p += q
    return p


def simulate(snaps: list[dict], min_edge: float = 0.05, min_price: float = 0.05, max_price: float = 0.97,
             hours=range(12, 24), budget: float = 5.0, side: str | None = None) -> dict:
    """Two-fold by date (learn on one half of the days, trade the other, then swap): each bracket is bought at most
    once per city-day, the first hour its readings-based chance beats the price by `min_edge` after fees."""
    days = sorted({s["day"] for s in snaps})
    halves = [set(days[: len(days) // 2]), set(days[len(days) // 2:])]
    out = {"trades": 0, "wins": 0, "profit": 0.0, "staked": 0.0, "by_hour": {}, "list": []}
    for i, test in enumerate(halves):
        model = fit([s for s in snaps if s["day"] in halves[1 - i]])
        bought = set()
        for s in sorted((s for s in snaps if s["day"] in test and s["hour"] in hours), key=lambda s: (s["event"], s["hour"])):
            for m in s["markets"]:
                p = chance(model, s["hour"], s["drop"], s["floor"], m)
                if p is None or m["ticker"] in bought:
                    continue
                for sd, price, fair in (("yes", m["yes_ask"], p), ("no", m["no_ask"], 1 - p)):
                    if (side and sd != side) or not (min_price <= price <= max_price):
                        continue
                    if fair - price - k.fee(price) < min_edge:
                        continue
                    count = int(budget // (price + k.fee(price)))
                    if count < 1:
                        continue
                    cost = count * price + k.fee(price, count)
                    won = m["result"] == sd
                    gain = (count if won else 0) - cost
                    out["trades"] += 1
                    out["wins"] += won
                    out["profit"] += gain
                    out["staked"] += cost
                    h = out["by_hour"].setdefault(s["hour"], [0, 0, 0.0])
                    h[0] += 1
                    h[1] += won
                    h[2] += gain
                    out["list"].append({"event": s["event"], "hour": s["hour"], "ticker": m["ticker"], "side": sd,
                                        "price": price, "fair": round(fair, 3), "won": won, "gain": round(gain, 2)})
                    bought.add(m["ticker"])
                    break
    return out


def calibration(snaps: list[dict], hours=range(12, 24)) -> list[tuple[int, int, float, float]]:
    """(hour, brackets, log loss of the readings-based chance, log loss of the market's price): which knew better?"""
    import math

    days = sorted({s["day"] for s in snaps})
    halves = [set(days[: len(days) // 2]), set(days[len(days) // 2:])]
    acc: dict[int, list] = {}
    for i, test in enumerate(halves):
        model = fit([s for s in snaps if s["day"] in halves[1 - i]])
        for s in snaps:
            if s["day"] not in test or s["hour"] not in hours:
                continue
            for m in s["markets"]:
                p = chance(model, s["hour"], s["drop"], s["floor"], m)
                if p is None:
                    continue
                hit = m["result"] == "yes"
                mid = (m["yes_ask"] + 1 - m["no_ask"]) / 2
                a = acc.setdefault(s["hour"], [0, 0.0, 0.0])
                a[0] += 1
                for j, q in ((1, p), (2, mid)):
                    q = min(max(q, 0.005), 0.995)
                    a[j] -= math.log(q if hit else 1 - q)
    return [(h, a[0], a[1] / a[0], a[2] / a[0]) for h, a in sorted(acc.items())]


def report(data: dict) -> str:
    snaps = snapshots(data)
    lines = [f"Kalshi same-day backtest: {len(data['days'])} city-days, {len(snaps)} hourly snapshots."]
    ends = [s for s in snaps if s["hour"] == 23]
    if ends:
        from collections import Counter
        gap = Counter(int(round(s["official"] - s["floor"])) for s in ends)
        lines.append("Official high minus what the readings had recorded by 11 pm: " +
                     ", ".join(f"{g:+d}°: {n / len(ends):.0%}" for g, n in sorted(gap.items())))
    lines.append("Readings vs market, log loss by hour (lower knew better): " + ", ".join(
        f"{h}h {a:.3f} vs {b:.3f}" for h, n, a, b in calibration(snaps)))
    for label, kw in (("edge 5¢+", {}), ("edge 10¢+", {"min_edge": 0.10}), ("edge 3¢+", {"min_edge": 0.03}),
                      ("edge 5¢+, from 3 pm", {"hours": range(15, 24)}), ("edge 5¢+, YES only", {"side": "yes"}),
                      ("edge 5¢+, NO only", {"side": "no"})):
        o = simulate(snaps, **kw)
        roi = o["profit"] / o["staked"] if o["staked"] else 0.0
        lines.append(f"  {label}: {o['trades']} trades, {o['wins']}-{o['trades'] - o['wins']}, "
                     f"{o['profit']:+,.2f} on {k.money(o['staked'])} staked ({roi:+.0%})")
    return "\n".join(lines)


def run(save: bool = True):
    from .signals import alert_target, notify

    data = collect()
    if save:
        DATA.parent.mkdir(exist_ok=True)
        DATA.write_text(json.dumps(data, separators=(",", ":")))
    text = report(data)
    print(text, flush=True)
    target = alert_target()
    if target and data["days"]:
        notify(target, f"🧪 Kalshi same-day backtest: {len(data['days'])} city-days", text[:3500], buy=True, tag="bar_chart")
