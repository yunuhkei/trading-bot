"""Backtest Kalshi markets beyond the daily highs: daily lows, gas prices, Bitcoin/Ethereum at 5 pm, and the S&P 500 /
Nasdaq-100 at the close. Same method as the highs' walk-forward test (bot/kalshi_walkforward.py): for each settled event
it reads Kalshi's hourly prices over the event's life (data/kalshi_markets_<family>.json), then trades each idea the way
the live bot would ($5, one trade per event, real fees, Kalshi's real result), with each idea's setting picked on earlier
days only.

Ideas, for every family:
- fav: YES on the favorite (the bracket the market likes most) at 60-80c, in families whose brackets cover every outcome
- longshot: NO on a cheap YES (the crowd overpays for long shots), when YES costs at most `max_yes`
and where there's a model:
- gas: tomorrow's AAA average = today's + the recent daily change; buy the side the model says is underpriced by `gap`
- btc/eth: the price at 5 pm ET from the price now and the recent hourly swings (Coinbase), same `gap` rule
Each idea also picks `hours`: how long before the close it buys.
Run: `python -m bot kalshi-markets --family gas` (or lows, crypto, stocks, all).
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_markets")
BUDGET = 5.0
WARMUP_DAYS = 7
MIN_LEARN = 15


def _ts(s: str | None) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else 0.0


def family_series(family: str) -> list[str]:
    """The series tickers in a family (from Kalshi's list of series)."""
    if family == "gas":
        ser = k.kget("/series", {"category": "Economics"}).get("series", [])
        return sorted(s["ticker"] for s in ser if s["ticker"].startswith("KXAAAGASD") and s.get("frequency") == "daily")
    if family == "lows":
        ser = k.kget("/series", {"category": "Climate and Weather"}).get("series", [])
        return sorted(s["ticker"] for s in ser if s["ticker"].startswith("KXLOWT"))
    return {"crypto": ["KXBTCD", "KXBTC", "KXETHD", "KXETH"], "stocks": ["KXINX", "KXNASDAQ100"]}[family]


def wanted(family: str, e: dict) -> bool:
    """Which settled events to test: crypto only the 5 pm ET ones (they open a day ahead); lows only US stations."""
    if family == "crypto":
        return e["event_ticker"].endswith("17")
    if family == "lows":
        return bool(k.station_of(((e.get("markets") or [{}])[0]).get("rules_primary", "")))
    return True


def settled(series: str, since: date, pages: int = 12) -> list[dict]:
    out, cursor = [], None
    for _ in range(pages):
        params = {"series_ticker": series, "status": "settled", "with_nested_markets": "true", "limit": 200}
        if cursor:
            params["cursor"] = cursor
        page = k.kget("/events", params)
        evs = page.get("events", [])
        out += evs
        cursor = page.get("cursor")
        closes = [_ts((e.get("markets") or [{}])[0].get("close_time")) for e in evs]
        if not cursor or not evs or min(closes) < datetime(since.year, since.month, since.day, tzinfo=timezone.utc).timestamp():
            break
        time.sleep(0.5)
    return out


def collect(family: str, days: int = 60, budget_s: float = 3600) -> dict:
    """event -> {series, close, open, value, mutex, markets: [...], candles: {ticker: [[ts, ask, bid], ...]}}."""
    path = Path(f"data/kalshi_markets_{family}.json")
    data = json.loads(path.read_text()) if path.exists() else {}
    t0, since = time.time(), datetime.now(timezone.utc).date() - timedelta(days=days)
    for s in family_series(family):
        if time.time() - t0 > budget_s:
            log.warning("time budget reached")
            break
        try:
            evs = settled(s, since)
        except Exception as ex:
            log.warning("%s: %s", s, ex)
            continue
        for e in evs:
            ms = [m for m in e.get("markets") or [] if m.get("result") in ("yes", "no")]
            if not ms or e["event_ticker"] in data or not wanted(family, e):
                continue
            close, opened = _ts(ms[0].get("close_time")), min(_ts(m.get("open_time")) for m in ms)
            if close < datetime(since.year, since.month, since.day, tzinfo=timezone.utc).timestamp():
                continue
            if time.time() - t0 > budget_s:
                break
            try:
                j = k.kget(f"/series/{s}/events/{e['event_ticker']}/candlesticks",
                           {"start_ts": int(opened), "end_ts": int(close) + 3600, "period_interval": 60})
            except Exception as ex:
                log.warning("%s: %s", e["event_ticker"], ex)
                continue
            data[e["event_ticker"]] = {
                "series": s, "open": opened, "close": close, "mutex": bool(e.get("mutually_exclusive")),
                "value": k._f(ms[0].get("expiration_value")), "rules": ms[0].get("rules_primary", "")[:200],
                "markets": [{"ticker": m["ticker"], "strike_type": m.get("strike_type"), "floor_strike": m.get("floor_strike"),
                             "cap_strike": m.get("cap_strike"), "result": m["result"]} for m in ms],
                "candles": {t: [[c.get("end_period_ts"), k._f((c.get("yes_ask") or {}).get("close_dollars")),
                                 k._f((c.get("yes_bid") or {}).get("close_dollars"))] for c in cs]
                            for t, cs in zip(j.get("market_tickers", []), j.get("market_candlesticks", []))}}
            time.sleep(0.4)
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(data, separators=(",", ":")))       # save after each series (resumable)
    return data


# ---- Models (only what was known before the buy) ----

def above_prob(m: dict, mu: float, sigma: float) -> float:
    """Chance a value ~ Normal(mu, sigma) lands in this market's range (ladders: "greater"/"greater_or_equal" = above
    the floor; brackets: between floor and cap)."""
    st, lo, hi = m.get("strike_type"), m.get("floor_strike"), m.get("cap_strike")
    cdf = lambda x: 0.5 * (1 + math.erf((x - mu) / (sigma * math.sqrt(2))))
    if st in ("greater", "greater_or_equal"):
        return 1 - cdf(lo)
    if st in ("less", "less_or_equal"):
        return cdf(hi)
    if st == "between":
        return cdf(hi) - cdf(lo)
    return math.nan


def gas_views(data: dict) -> dict:
    """event -> (mu, sigma) for the AAA price on its day: the day before's price plus the average daily change of the
    5 days before, spread = the daily changes' typical size (from earlier days only)."""
    by_series: dict[str, list] = {}
    for key, ev in data.items():
        by_series.setdefault(ev["series"], []).append((ev["close"], key, ev["value"]))
    out = {}
    for s, evs in by_series.items():
        evs.sort()
        for i, (_, key, _) in enumerate(evs):
            past = [v for _, _, v in evs[max(0, i - 15):i]]
            if len(past) < 6:
                continue
            ch = [b - a for a, b in zip(past, past[1:])]
            drift = sum(ch[-5:]) / len(ch[-5:])
            sd = math.sqrt(sum(c * c for c in ch) / len(ch))
            out[key] = (past[-1] + drift, max(sd, 0.002))
    return out


def coinbase_hourly(product: str, start: float, end: float) -> list[list]:
    """[[time, close], ...] hourly from Coinbase's public candles."""
    import requests

    out, t = [], start
    while t < end:
        stop = min(end, t + 300 * 3600)
        r = requests.get(f"https://api.exchange.coinbase.com/products/{product}/candles",
                         params={"granularity": 3600, "start": datetime.fromtimestamp(t, timezone.utc).isoformat(),
                                 "end": datetime.fromtimestamp(stop, timezone.utc).isoformat()}, timeout=30)
        r.raise_for_status()
        out += [[c[0], c[4]] for c in r.json()]
        t = stop
        time.sleep(0.3)
    return sorted(out)


# ---- One event at one moment: what each idea does ----

def quote(path: list[list], at: float) -> tuple[float, float] | None:
    last = None
    for ts, ask, bid in path:
        if ts is None or ts > at:
            break
        last = (ask, bid)
    return last if last and 0 < last[0] < 1 else None


def snapshot(ev: dict, at: float) -> dict:
    """ticker -> (YES ask, YES bid) at `at`."""
    out = {}
    for t, path in ev["candles"].items():
        q = quote(path, at)
        if q:
            out[t] = q
    return out


def exhaustive(ev: dict) -> bool:
    kinds = {m.get("strike_type") for m in ev["markets"]}
    return ev["mutex"] and bool(kinds & {"less", "less_or_equal"}) and bool(kinds & {"greater", "greater_or_equal"})


def trade(side: str, price: float, won: bool) -> tuple[float, float, bool] | None:
    count = int(BUDGET // (price + k.fee(price)))
    if count < 1:
        return None
    return count * price + k.fee(price, count), (count if won else 0.0), won


def choose(ev: dict, rule: dict, view: tuple[float, float] | None, q: dict) -> tuple[str, str, float, float] | None:
    """(ticker, side, price, the chance it's worth) that one idea buys on this event at these quotes, or None."""
    kind = rule["kind"]
    if kind == "fav":
        if not exhaustive(ev):
            return None
        fav = max(q, key=lambda t: q[t][0] + q[t][1])
        ask = q[fav][0]
        if not (rule.get("min_price", 0.60) <= ask <= rule.get("max_price", 0.80)):
            return None
        return fav, "yes", ask, rule.get("hit_rate", 0.70)
    if kind == "longshot":
        best = None
        for t, (ask, bid) in q.items():
            no_ask = round(1 - bid, 4)
            if 0 < bid <= rule.get("max_yes", 0.10) and no_ask < 0.99 and (best is None or bid < best[1]):
                best = (t, bid, no_ask)
        return (best[0], "no", best[2], 1 - best[1] / 2) if best else None
    if kind == "model":
        if not view:
            return None
        mu, sigma = view
        best = None
        for m in ev["markets"]:
            if m["ticker"] not in q:
                continue
            p = above_prob(m, mu, sigma * rule.get("sigma_mult", 1.0))
            if math.isnan(p):
                continue
            ask, bid = q[m["ticker"]]
            for side, price, fair in (("yes", ask, p), ("no", round(1 - bid, 4), 1 - p)):
                if not (0.10 <= price <= 0.90):
                    continue
                edge = fair - price - k.fee(price)
                if edge >= rule.get("gap", 0.05) and (best is None or edge > best[0]):
                    best = (edge, m["ticker"], side, price, fair)
        return best[1:] if best else None
    return None


def idea(ev: dict, rule: dict, view: tuple[float, float] | None) -> tuple[float, float, bool] | None:
    """The trade one idea makes on this settled event `hours` before its close: (cost, money back, won), or None."""
    at = ev["close"] - rule.get("hours", 6) * 3600
    if at < ev["open"]:
        return None
    q = snapshot(ev, at)
    if not q:
        return None
    pick = choose(ev, rule, view, q)
    if not pick:
        return None
    ticker, side, price, _ = pick
    result = {m["ticker"]: m["result"] for m in ev["markets"]}
    return trade(side, price, result.get(ticker) == side)


# ---- Live (practice): open events and the trades a strategy would make now ----

def open_events(family: str, state: dict, now: float, budget_s: float = 90) -> list[dict]:
    """Open events in a family (its series list is refreshed daily)."""
    t0, cache = time.time(), state.setdefault("family_series", {})
    if now - cache.get(family, {}).get("t", 0) > 86400:
        cache[family] = {"t": now, "series": family_series(family)}
    out = []
    for s in cache[family]["series"]:
        if time.time() - t0 > budget_s:
            log.warning("%s scan stopped after %.0f s; the rest next time", family, budget_s)
            break
        try:
            evs = k.kget("/events", {"series_ticker": s, "status": "open", "with_nested_markets": "true"}).get("events", [])
        except Exception as e:
            log.warning("%s events: %s", s, e)
            continue
        out += [e for e in evs if wanted(family, e)]
        time.sleep(0.5)
    return out


def live_event(e: dict, now: float) -> dict:
    ms = e.get("markets") or []
    return {"close": min((_ts(m.get("close_time")) for m in ms), default=0.0), "open": now,
            "mutex": bool(e.get("mutually_exclusive")),
            "markets": [{"ticker": m["ticker"], "strike_type": m.get("strike_type"), "floor_strike": m.get("floor_strike"),
                         "cap_strike": m.get("cap_strike"), "yes_sub_title": m.get("yes_sub_title"),
                         "size": {"yes": k._f(m.get("yes_ask_size_fp")), "no": k._f(m.get("no_ask_size_fp"))}} for m in ms],
            "quotes": {m["ticker"]: (k._f(m.get("yes_ask_dollars")), k._f(m.get("yes_bid_dollars"))) for m in ms
                       if 0 < k._f(m.get("yes_ask_dollars")) < 1}}


def live_ideas(events: list[dict], rule: dict, now: float, views: dict | None = None, label: str = "") -> list[dict]:
    """The trades a strategy would make right now: on events closing within its `hours`, at today's quotes, in the
    format kalshi.trade buys."""
    out = []
    for e in events:
        ev = live_event(e, now)
        if not ev["quotes"] or not (0 < ev["close"] - now <= rule.get("hours", 6) * 3600):
            continue
        pick = choose(ev, rule, (views or {}).get(e["event_ticker"]), ev["quotes"])
        if not pick:
            continue
        ticker, side, price, fair = pick
        m = next(x for x in ev["markets"] if x["ticker"] == ticker)
        size = m["size"][side] or 1.0          # some listings leave sizes out: the limit order just won't overpay
        out.append({"kind": "market", "event": e["event_ticker"], "ticker": ticker, "side": side, "price": price,
                    "size": size, "fair": fair, "edge": fair - price - k.fee(price),
                    "title": f"{e.get('title', '').replace('?', '')}: {m.get('yes_sub_title') or ticker}",
                    "why": label or rule["kind"]})
    return sorted(out, key=lambda i: -i["edge"])


def ideas_for(family: str) -> dict:
    hours = (2, 6, 12, 20)
    out = {
        "fav": {"label": "Favorite at 60-80c", "grid": [{"kind": "fav", "hours": h} for h in hours]},
        "longshot": {"label": "NO on long shots", "grid": [{"kind": "longshot", "hours": h, "max_yes": x}
                                                            for h in hours for x in (0.05, 0.10, 0.15)]},
    }
    if family in ("gas", "crypto"):
        out["model"] = {"label": "Model vs price", "grid": [{"kind": "model", "hours": h, "gap": g, "sigma_mult": s}
                                                             for h in hours for g in (0.05, 0.10) for s in (1.0, 1.5)]}
    return out


def walk_forward(data: dict, views: dict, ideas: dict, tz: str = "America/Chicago") -> dict:
    from zoneinfo import ZoneInfo

    day = lambda ev: datetime.fromtimestamp(ev["close"] - 1, ZoneInfo(tz)).date().isoformat()
    days = sorted({day(ev) for ev in data.values()})
    by_day = {d: [(key, ev) for key, ev in data.items() if day(ev) == d] for d in days}
    out = {}
    for name, spec in ideas.items():
        rules = spec["grid"]
        past = {i: [] for i in range(len(rules))}
        held = []
        for n, d in enumerate(days):
            todays = {i: [t for t in (idea(ev, r, views.get(key)) for key, ev in by_day[d]) if t] for i, r in enumerate(rules)}
            if n >= WARMUP_DAYS:
                ok = [i for i in past if len(past[i]) >= MIN_LEARN]
                best = max(ok, key=lambda i: sum(b - c for c, b, _ in past[i])) if ok else None
                if best is not None:
                    held += [(d, *t) for t in todays[best]]
            for i in past:
                past[i] += todays[i]
        last = max(past, key=lambda i: sum(b - c for c, b, _ in past[i])) if any(past.values()) else None
        out[name] = {"label": spec["label"], "trades": held, "setting": rules[last] if last is not None else None,
                     "in_sample": {json.dumps(rules[i]): (len(past[i]), round(sum(b - c for c, b, _ in past[i]), 2))
                                   for i in past}}
    return out


def summary(trades: list[tuple]) -> dict:
    cost, back = sum(t[1] for t in trades), sum(t[2] for t in trades)
    by_day: dict = {}
    for t in trades:
        by_day[t[0]] = by_day.get(t[0], 0.0) + t[2] - t[1]
    return {"n": len(trades), "won": sum(t[3] for t in trades), "profit": back - cost,
            "roi": (back - cost) / cost if cost else 0.0, "without_best_day": back - cost - max(by_day.values(), default=0.0)}


def passes(s: dict, first: dict, second: dict) -> bool:
    """Good enough to practice: 30+ held-out trades, +3% or better, and still making money in both halves of the test
    and without its single best day."""
    return s["n"] >= 30 and s["roi"] >= 0.03 and first["profit"] > 0 and second["profit"] > 0 and s["without_best_day"] > 0


def family_views(family: str, data: dict) -> dict:
    if family == "gas":
        return gas_views(data)
    if family == "crypto":
        views = {}
        for coin in ("BTC", "ETH"):
            evs = {key: ev for key, ev in data.items() if ev["series"].startswith(f"KX{coin}")}
            if not evs:
                continue
            lo = min(ev["open"] for ev in evs.values()) - 8 * 86400
            hi = max(ev["close"] for ev in evs.values())
            px = coinbase_hourly(f"{coin}-USD", lo, hi)
            for key, ev in evs.items():
                for h in (2, 6, 12, 20):
                    at = ev["close"] - h * 3600
                    hist = [c for t, c in px if at - 7 * 86400 <= t <= at]
                    if len(hist) < 48:
                        continue
                    rets = [math.log(b / a) for a, b in zip(hist, hist[1:])]
                    vol = math.sqrt(sum(r * r for r in rets) / len(rets))
                    views.setdefault(key, {})[h] = (hist[-1], hist[-1] * vol * math.sqrt(h))
        return {key: v for key, v in views.items()}
    return {}


def report(family: str, data: dict) -> tuple[str, dict]:
    views = family_views(family, data)
    ideas = ideas_for(family)
    if family == "crypto":                      # the crypto view depends on the hour: one model idea per hour
        for name in list(ideas):
            if name == "model":
                spec = ideas.pop(name)
                for h in (2, 6, 12, 20):
                    ideas[f"model {h}h"] = {"label": f"Model vs price, {h} h before", "grid": [r for r in spec["grid"] if r["hours"] == h]}
    res, lines = {}, []
    days = sorted({datetime.fromtimestamp(ev["close"] - 1, timezone.utc).date() for ev in data.values()})
    lines.append(f"{family}: {len(data)} settled events, {len(days)} days ({days[0] if days else '-'} to {days[-1] if days else '-'})")
    for name, spec in ideas.items():
        v = views
        if name.startswith("model ") and family == "crypto":
            h = int(name.split()[1][:-1])
            v = {key: hv[h] for key, hv in views.items() if h in hv}
        o = walk_forward(data, v, {name: spec})[name]
        s = summary(o["trades"])
        held_days = sorted({t[0] for t in o["trades"]})
        half = held_days[len(held_days) // 2] if held_days else ""
        a, b = summary([t for t in o["trades"] if t[0] < half]), summary([t for t in o["trades"] if t[0] >= half])
        ok = passes(s, a, b)
        res[name] = {**s, "first": a, "second": b, "passes": ok, "setting": o["setting"], "in_sample": o["in_sample"]}
        lines.append(f"  {'PASS' if ok else 'fail'} {name}. {o['label']}: {s['n']} held-out trades, {s['won']}-{s['n'] - s['won']}, "
                     f"{s['profit']:+,.2f} ({s['roi']:+.0%}); halves {a['profit']:+.2f} ({a['n']}) / {b['profit']:+.2f} ({b['n']}); "
                     f"without its best day {s['without_best_day']:+.2f}; setting now {o['setting']}")
    return "\n".join(lines), res


def run(family: str = "all", days: int = 60, collect_first: bool = True):
    from .signals import alert_target, notify

    texts = []
    for fam in (["lows", "gas", "crypto", "stocks"] if family == "all" else [family]):
        data = collect(fam, days) if collect_first else json.loads(Path(f"data/kalshi_markets_{fam}.json").read_text())
        text, _ = report(fam, data)
        print(text, flush=True)
        texts.append(text)
    target = alert_target()
    if target:
        notify(target, "🧪 Kalshi: other markets tested", "\n\n".join(texts)[:3500], buy=True, tag="bar_chart")
