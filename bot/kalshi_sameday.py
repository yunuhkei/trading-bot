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


def run(save: bool = True):
    data = collect()
    if save:
        DATA.parent.mkdir(exist_ok=True)
        DATA.write_text(json.dumps(data, separators=(",", ":")))
    print(f"Same-day data: {len(data['days'])} city-days, readings for {len(data['readings'])} stations.", flush=True)
