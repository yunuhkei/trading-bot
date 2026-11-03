"""Backtest the Kalshi weather strategies on settled markets: what would each have made over the last few weeks?

For every US daily-high market that settled in the last `days` days it rebuilds the day-before decision:
- the price: Kalshi's ask at noon Central the day before (hourly price history),
- the forecast: what each weather model forecast that day's high one day ahead (Open-Meteo's archive of past runs),
- the answer: Kalshi's real result (and the station's real high from IEM, to measure the forecast error).
Then every strategy (bot/kalshi.py STRATEGIES) trades it with the same rules as live: $5 a trade, one per city-day.

It also checks how good the bot's odds are (calibration: when it says 30%, does it happen about 30% of the time?) and which
forecast uncertainty (sigma) would have done best. Run it from GitHub (Open-Meteo works there):
Actions -> kalshi-backtest -> Run workflow, or `python -m bot kalshi-backtest --days 21`.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, timedelta, timezone

from . import kalshi as k

log = logging.getLogger("kalshi_backtest")
PREVIOUS_RUNS = "https://previous-runs-api.open-meteo.com/v1/forecast"


def settled_events(series: str, since: date) -> list[dict]:
    out, cursor = [], None
    for _ in range(5):
        params = {"series_ticker": series, "status": "settled", "with_nested_markets": "true", "limit": 50}
        if cursor:
            params["cursor"] = cursor
        page = k.kget("/events", params)
        evs = page.get("events", [])
        out += [e for e in evs if (k.event_day(e["event_ticker"]) or date.min) >= since]
        cursor = page.get("cursor")
        if not cursor or not evs or min((k.event_day(e["event_ticker"]) or date.min) for e in evs) < since:
            break
        time.sleep(1.0)
    return out


def prices_at(series: str, event_ticker: str, at: datetime) -> dict[str, tuple[float, float]]:
    """market -> (YES ask, NO ask) from the last hourly candle before `at`."""
    j = k.kget(f"/series/{series}/events/{event_ticker}/candlesticks",
               {"start_ts": int(at.timestamp()) - 12 * 3600, "end_ts": int(at.timestamp()), "period_interval": 60})
    out = {}
    for ticker, candles in zip(j.get("market_tickers", []), j.get("market_candlesticks", [])):
        last = [c for c in candles if c.get("end_period_ts", 0) <= at.timestamp()]
        if not last:
            continue
        c = last[-1]
        ya = k._f((c.get("yes_ask") or {}).get("close_dollars"))
        yb = k._f((c.get("yes_bid") or {}).get("close_dollars"))
        if 0 < ya < 1 and 0 <= yb < 1:
            out[ticker] = (ya, round(1 - yb, 4))
    return out


def past_day_ahead(info: dict, start: date, end: date) -> dict[str, list[float]]:
    """date -> each model's high for that day as forecast one day earlier."""
    import requests
    from zoneinfo import ZoneInfo

    for models in (k.MODELS, k.SAFE_MODELS):
        r = requests.get(PREVIOUS_RUNS, params={"latitude": info["lat"], "longitude": info["lon"],
                                                "hourly": "temperature_2m_previous_day1", "temperature_unit": "fahrenheit",
                                                "timezone": info["tz"], "timeformat": "unixtime", "models": ",".join(models),
                                                "start_date": start.isoformat(), "end_date": end.isoformat()}, timeout=60)
        if r.status_code != 400:
            break
    r.raise_for_status()
    h, tz = r.json().get("hourly", {}), ZoneInfo(info["tz"])
    times = h.get("time", [])
    out: dict[str, dict[str, float]] = {}
    for key, vals in h.items():
        if not key.startswith("temperature_2m_previous_day1"):
            continue
        model = key[len("temperature_2m_previous_day1"):].lstrip("_") or "best_match"
        for t, v in zip(times, vals):
            if v is None:
                continue
            d = datetime.fromtimestamp(t, tz).date().isoformat()
            out.setdefault(d, {})[model] = max(out.get(d, {}).get(model, -999.0), v)
    return {d: list(m.values()) for d, m in out.items()}


def iem_highs(st: str, info: dict, months: set[tuple[int, int]]) -> dict[str, float]:
    import requests

    out = {}
    for y, m in sorted(months):
        r = requests.get(f"{k.IEM}/daily.json", params={"station": st[1:], "network": f"{info['state']}_ASOS", "year": y, "month": m}, timeout=30)
        r.raise_for_status()
        out.update({row["date"]: float(row["max_tmpf"]) for row in r.json().get("data", []) if row.get("max_tmpf") is not None})
    return out


def collect(days: int = 14, series: list[str] | None = None, budget_s: float = 2400) -> list[dict]:
    """Every settled city-day: its markets with day-before prices and results, the models' day-ahead forecasts, and
    the real high."""
    from statistics import mean, pstdev

    t0, state = time.time(), {}
    today = datetime.now(timezone.utc).date()
    since = today - timedelta(days=days)
    if series is None:
        k.weather_events(state, time.time(), budget_s=600)          # learns which series are US cities
        for _ in range(4):                                           # (15 new ones a pass)
            unknown = [t for t in state["series"] if t not in state.get("series_kind", {})]
            if not unknown:
                break
            k.weather_events(state, time.time(), budget_s=600)
        series = [t for t, v in state.get("series_kind", {}).items() if v["k"] == "us"]
    stations, rows, fcs, highs = {}, [], {}, {}
    for s in series:
        if time.time() - t0 > budget_s:
            log.warning("time budget reached; testing what was collected")
            break
        try:
            evs = settled_events(s, since)
        except Exception as e:
            log.warning("%s: %s", s, e)
            continue
        for e in evs:
            ms = [m for m in e.get("markets") or [] if m.get("result") in ("yes", "no")]
            day = k.event_day(e["event_ticker"])
            st = k.station_of((ms[0] if ms else {}).get("rules_primary", ""))
            if not ms or not day or not st:
                continue
            try:
                info = k.station_info(st, stations)
                if st not in fcs:
                    fcs[st] = past_day_ahead(info, since - timedelta(days=1), today)
                    highs[st] = iem_highs(st, info, {(since.year, since.month), (today.year, today.month)})
                at = datetime(day.year, day.month, day.day, 18, tzinfo=timezone.utc) - timedelta(days=1)   # noon Central, day before
                px = prices_at(s, e["event_ticker"], at)
            except Exception as ex:
                log.warning("%s %s: %s", s, e["event_ticker"], ex)
                continue
            time.sleep(1.0)
            f = fcs[st].get(day.isoformat())
            if not f or not px:
                continue
            markets = []
            for m in ms:
                if m["ticker"] in px:
                    ya, na = px[m["ticker"]]
                    markets.append({**m, "yes_ask_dollars": ya, "no_ask_dollars": na, "yes_ask_size_fp": 100, "no_ask_size_fp": 100})
            if markets:
                rows.append({"event": {**e, "markets": markets}, "station": st, "day": day.isoformat(),
                             "mu": mean(f), "spread": pstdev(f) if len(f) > 1 else 0.0, "models": len(f),
                             "actual": highs[st].get(day.isoformat())})
    return rows


def simulate(rows: list[dict], strategies: dict, sigma: float = 2.0, budget: float = 5.0) -> dict[str, dict]:
    """Each strategy's trades on the collected city-days: best idea per city-day, $5 each, settled by the real result."""
    out = {key: {"label": v["label"], "trades": 0, "wins": 0, "profit": 0.0, "staked": 0.0} for key, v in strategies.items()}
    for r in rows:
        view = {"mu": r["mu"], "sigma": max(sigma, r["spread"]), "floor": None, "late": False, "why": "backtest"}
        result = {m["ticker"]: m["result"] for m in r["event"]["markets"]}
        for key, v in strategies.items():
            ideas = k.ideas_from_views([(r["event"], view)], v["rules"])
            if not ideas:
                continue
            i = ideas[0]
            count = int(budget // (i["price"] + k.fee(i["price"])))
            if count < 1:
                continue
            cost = count * i["price"] + k.fee(i["price"], count)
            won = result[i["ticker"]] == i["side"]
            o = out[key]
            o["trades"] += 1
            o["wins"] += won
            o["staked"] += cost
            o["profit"] += (count if won else 0) - cost
    return out


def calibration(rows: list[dict], sigma: float = 2.0) -> tuple[list[tuple[str, int, float, float]], float]:
    """(probability bucket, brackets, average predicted, how often it happened) and the log loss, over every bracket."""
    buckets, ll, n = {}, 0.0, 0
    for r in rows:
        for m in r["event"]["markets"]:
            p = k.bracket_prob(m, r["mu"], max(sigma, r["spread"]), None)
            if math.isnan(p):
                continue
            hit = m["result"] == "yes"
            b = min(int(p * 10), 9)
            buckets.setdefault(b, []).append((p, hit))
            q = min(max(p, 1e-4), 1 - 1e-4)
            ll -= math.log(q if hit else 1 - q)
            n += 1
    table = [(f"{b * 10}-{b * 10 + 10}%", len(v), sum(p for p, _ in v) / len(v), sum(h for _, h in v) / len(v))
             for b, v in sorted(buckets.items())]
    return table, ll / max(n, 1)


def report(rows: list[dict], strategies: dict) -> str:
    errs = [r["actual"] - r["mu"] for r in rows if r.get("actual") is not None]
    lines = [f"Kalshi backtest: {len(rows)} settled city-days, day-before decisions at noon Central."]
    if errs:
        rmse = math.sqrt(sum(e * e for e in errs) / len(errs))
        lines.append(f"Model forecasts vs the real high: bias {sum(errs) / len(errs):+.1f}°, typical error {rmse:.1f}° "
                     f"({len(errs)} days, avg {sum(r['models'] for r in rows) / len(rows):.1f} models each).")
    best_sigma, best_ll = None, None
    for sg in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0):
        _, ll = calibration(rows, sg)
        if best_ll is None or ll < best_ll:
            best_sigma, best_ll = sg, ll
    lines.append(f"Best forecast uncertainty (sigma): {best_sigma}° (the bot uses 2.0° before it has graded a city).")
    table, _ = calibration(rows, best_sigma)
    lines.append("Calibration at that sigma (bot said -> happened): " + ", ".join(
        f"{b}: {pred:.0%}->{act:.0%} (n={n})" for b, n, pred, act in table if n >= 5))
    for sg in sorted({2.0, best_sigma}):
        lines.append(f"\nStrategies with sigma {sg}°:")
        for key, o in simulate(rows, strategies, sg).items():
            roi = o["profit"] / o["staked"] if o["staked"] else 0.0
            lines.append(f"  {key}. {o['label']}: {o['trades']} trades, {o['wins']}-{o['trades'] - o['wins']}, "
                         f"{o['profit']:+,.2f} on {k.money(o['staked'])} staked ({roi:+.0%})")
    return "\n".join(lines)


def run(days: int = 14):
    from .signals import alert_target, notify

    rows = collect(days)
    text = report(rows, k.strategies(k.load_settings()))
    print(text, flush=True)
    target = alert_target()
    if target and rows:
        notify(target, f"🧪 Kalshi backtest: {len(rows)} city-days", text[:3500], buy=True, tag="bar_chart")
