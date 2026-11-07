# Run from the repo root: PYTHONPATH=. python tools/kalshi_maker_collect.py (about an hour; resumable)
"""Collect Kalshi trade prints, the day before each settled daily-high event, for the markets a maker-bid strategy would
bid on: the favorite YES bracket (YES bid 60-95c at some hour) and long-shot brackets whose NO bid is 60-95c."""
import json, time, sys, logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from bot import kalshi as k  # noqa: E402
logging.basicConfig(level=logging.WARNING)
OUT = "data/maker_trades.json"          # big (tens of MB): kept out of git
rows = json.load(open("data/kalshi_backtest_rows.json"))
paths = json.load(open("data/kalshi_paths.json"))
try:
    data = json.load(open(OUT))
except Exception:
    data = {}
stations = {}
t0 = time.time()
for n, r in enumerate(sorted(rows, key=lambda r: r["day"])):
    e = r["event"]["event_ticker"]
    p = paths.get(e)
    if not p:
        continue
    d = date.fromisoformat(r["day"])
    start = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(hours=14)      # ~market open, day before
    info = stations.get(r["station"]) or k.station_info(r["station"], stations)
    cday0, _ = k.climate_day(d, info["tz"])                                                   # the measurement day begins
    want = set()
    for m in r["event"]["markets"]:
        for ts, ask, bid in p.get(m["ticker"]) or []:
            if ts and start.timestamp() <= ts <= cday0.timestamp():
                if 0.60 <= bid <= 0.95 or 0.60 <= round(1 - ask, 4) <= 0.95:
                    want.add(m["ticker"]); break
    for t in sorted(want):
        key = f"{e}|{t}"
        if key in data:
            continue
        got, cur = [], None
        for _ in range(10):
            params = {"ticker": t, "limit": 1000, "min_ts": int(start.timestamp()), "max_ts": int(cday0.timestamp())}
            if cur:
                params["cursor"] = cur
            try:
                j = k.kget("/markets/trades", params)
            except Exception as ex:
                logging.warning("%s: %s", t, ex); break
            got += [[datetime.fromisoformat(x["created_time"].replace("Z", "+00:00")).timestamp(),
                     float(x["yes_price_dollars"]), float(x["count_fp"]), x.get("taker_side")] for x in j.get("trades", [])]
            cur = j.get("cursor")
            if not cur:
                break
            time.sleep(0.3)
        data[key] = {"open": start.timestamp(), "cancel": cday0.timestamp(), "trades": sorted(got)}
        time.sleep(0.3)
    if n % 50 == 0:
        json.dump(data, open(OUT, "w")); print(n, len(data), round(time.time() - t0), "s", flush=True)
json.dump(data, open(OUT, "w")); print("done", len(data), round(time.time() - t0), "s")
