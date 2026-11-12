"""Kalshi stock bot: watches Kalshi's S&P 500 and Nasdaq-100 daily-close markets and practices betting on them.
Practice only (pretend money); settings in kalshi_stocks.yaml, state in kalshi_stocks_state.json.

Kalshi lists, every trading day, brackets for where the index closes at 4 pm ET (KXINX: S&P 500, 25-point brackets;
KXNASDAQ100: Nasdaq-100, 100-point brackets). Each pays $1 if the close lands in it.

The bot's own chance for each bracket: the close ~ Normal(index now, index x implied vol x sqrt(time left)), with the
implied vol from the VIX (S&P) or VXN (Nasdaq), times `vol_mult`, and the time left in trading hours (6.5 a day, 252
days a year). It buys a side only where that chance beats the ask by Kalshi's fee + slippage + `margin`.

Fills are realistic: a $100 order walks Kalshi's real order book from the cheapest ask up, never above the best ask +
`max_slip` or where the edge would drop under the margin, with the taker fee at every price level; a thin book means a
smaller fill or no trade. An order never costs more than the account's cash.

The backtest (`backtest`) runs the same rule on settled events (data/kalshi_markets_stocks.json: Kalshi's quotes over
each event's life) with Yahoo's hourly index and VIX/VXN, each setting picked on earlier days only.
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

from . import kalshi as k

log = logging.getLogger("kalshi_stocks")
ET = "America/New_York"
SETTINGS = Path("kalshi_stocks.yaml")
STATE = Path("kalshi_stocks_state.json")
DATA = Path("data/kalshi_markets_stocks.json")
SERIES = {"KXINX": {"name": "S&P 500", "index": "^GSPC", "vol": "^VIX"},
          "KXNASDAQ100": {"name": "Nasdaq-100", "index": "^NDX", "vol": "^VXN"}}
YEAR_HOURS = 252 * 6.5
DEFAULTS = {"mode": "practice", "cash": 1000.0, "per_trade": 100.0, "margin": 0.05, "vol_mult": 1.0, "slip": 0.01,
            "max_slip": 0.03, "min_fill": 10.0, "min_price": 0.05, "max_price": 0.95, "max_trades_per_day": 6,
            "max_open": 6, "first_hour": 10.0, "last_hour": 15.5, "report_at": "15:30", "timezone": "America/Chicago"}


# ---- The model ----

def hours_left(now: float, close: float) -> float:
    """Trading hours from now to the close (the same day: market hours only)."""
    return max(0.0, (close - now) / 3600)


def chance(m: dict, level: float, vol: float, hours: float, mult: float = 1.0) -> float:
    """The chance the index closes in this market's range: Normal(level, level x vol x mult x sqrt(hours / year))."""
    sd = max(level * vol * mult * math.sqrt(max(hours, 1e-6) / YEAR_HOURS), level * 1e-5)
    st, lo, hi = m.get("strike_type"), m.get("floor_strike"), m.get("cap_strike")
    cdf = lambda x: 0.5 * (1 + math.erf((x - level) / (sd * math.sqrt(2))))
    if st in ("greater", "greater_or_equal"):
        return 1 - cdf(lo)
    if st in ("less", "less_or_equal"):
        return cdf(hi)
    if st == "between":
        return cdf(hi + 0.01) - cdf(lo)          # brackets like 7,425 to 7,449.99
    return math.nan


def best_side(markets: list[dict], level: float, vol: float, hours: float, cfg: dict, quotes=None) -> dict | None:
    """The side that beats its ask by the most after fee + slip, if by more than the margin. `quotes`: ticker ->
    (YES ask, YES bid); else the market's own *_dollars fields."""
    best = None
    for m in markets:
        p = chance(m, level, vol, hours, float(cfg["vol_mult"]))
        if math.isnan(p):
            continue
        ya, yb = quotes[m["ticker"]] if quotes else (k._f(m.get("yes_ask_dollars")), k._f(m.get("yes_bid_dollars")))
        for side, price, fair in (("yes", ya, p), ("no", round(1 - yb, 4) if yb > 0 else 0.0, 1 - p)):
            if not (float(cfg["min_price"]) <= price <= float(cfg["max_price"])):
                continue
            edge = fair - price - k.fee(price) - float(cfg["slip"])
            if edge > float(cfg["margin"]) and (best is None or edge > best["edge"]):
                best = {"ticker": m["ticker"], "side": side, "price": price, "fair": fair, "edge": edge, "market": m}
    return best


# ---- Prices: the index and its implied vol (Yahoo) ----

def yahoo(symbol: str, rng: str = "5d", interval: str = "1m") -> dict:
    import requests

    r = requests.get(f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}", params={"range": rng, "interval": interval},
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    return r.json()["chart"]["result"][0]


def live_level(symbol: str) -> tuple[float, float]:
    """(the latest price, its time) for an index or the VIX."""
    res = yahoo(symbol, "1d", "1m")
    meta = res.get("meta") or {}
    ts, closes = res.get("timestamp") or [], (res["indicators"]["quote"][0] or {}).get("close") or []
    last = [(t, c) for t, c in zip(ts, closes) if c is not None]
    if last:
        return float(last[-1][1]), float(last[-1][0])
    return float(meta["regularMarketPrice"]), float(meta.get("regularMarketTime") or time.time())


def hourly(symbol: str, rng: str = "730d") -> list[tuple[float, float]]:
    """[(when the hourly bar ended, its close), ...] (the last bar of a day ends at the 4 pm close)."""
    from zoneinfo import ZoneInfo

    res = yahoo(symbol, rng, "60m")
    out = []
    for t, c in zip(res.get("timestamp") or [], (res["indicators"]["quote"][0] or {}).get("close") or []):
        if c is None:
            continue
        d = datetime.fromtimestamp(t, ZoneInfo(ET))
        close = datetime(d.year, d.month, d.day, 16, tzinfo=ZoneInfo(ET)).timestamp()
        out.append((min(t + 3600, close) if t < close else t, float(c)))
    return sorted(out)


def last_before(series: list[tuple[float, float]], at: float, max_age: float = 4 * 3600) -> float | None:
    """The last value that was known at `at` (no older than max_age)."""
    lo, hi = 0, len(series)
    while lo < hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= at:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0 or at - series[lo - 1][0] > max_age:
        return None
    return series[lo - 1][1]


# ---- Backtest (settled events, settings picked on earlier days only) ----

def quote_at(candles: list[list], at: float) -> tuple[float, float] | None:
    """(YES ask, YES bid) as of `at`: Kalshi only records a candle when the quote changes, so the last one stands."""
    last = None
    for ts, ask, bid in candles:
        if ts is None or ts > at:
            break
        last = (ask, bid)
    return last if last and 0 < last[0] <= 1 else None


def entry_times(close: float) -> list[float]:
    """10:30 am to 3:30 pm ET on the close day, hourly (when Yahoo's hourly bars end)."""
    return [close - h * 3600 - 1800 for h in range(5, -1, -1)]


def bt_trades(data: dict, prices: dict, cfg: dict, settings: list[dict]) -> dict[int, list[dict]]:
    """setting index -> its trades: per event, the first entry time the rule beats the ask by the margin."""
    out = {i: [] for i in range(len(settings))}
    for key, ev in sorted(data.items(), key=lambda kv: kv[1]["close"]):
        src = SERIES.get(ev["series"])
        if not src or not ev.get("markets"):
            continue
        day = datetime.fromtimestamp(ev["close"], timezone.utc).date().isoformat()
        res = {m["ticker"]: m["result"] for m in ev["markets"]}
        for i, s in enumerate(settings):
            c = {**cfg, **s}
            for at in entry_times(ev["close"]):
                level = last_before(prices[src["index"]], at)
                vol = last_before(prices[src["vol"]], at, 24 * 3600)
                q = {m["ticker"]: quote_at(ev["candles"].get(m["ticker"]) or [], at) for m in ev["markets"]}
                q = {t: v for t, v in q.items() if v}
                if level is None or vol is None or len(q) < 3:
                    continue
                b = best_side([m for m in ev["markets"] if m["ticker"] in q], level, vol / 100, hours_left(at, ev["close"]), c, q)
                if b:
                    out[i].append({"day": day, "event": key, "series": ev["series"], "hour": round((ev["close"] - at) / 3600, 1),
                                   "price": b["price"], "side": b["side"], "won": res[b["ticker"]] == b["side"],
                                   "r": ret(b["price"], res[b["ticker"]] == b["side"], c)})
                    break
    return out


def ret(price: float, won: bool, cfg: dict) -> float:
    """Profit per dollar for a per_trade order at price + slip, Kalshi's taker fee, held to settlement."""
    count = int(float(cfg["per_trade"]) // (price + float(cfg["slip"]) + k.fee(price)))
    if count < 1:
        return 0.0
    cost = count * (price + float(cfg["slip"])) + k.fee(price, count)
    return ((count if won else 0.0) - cost) / cost


def log_loss_check(data: dict, prices: dict, mults=(0.6, 0.8, 1.0, 1.2)) -> dict:
    """Per bracket at 12:30 pm ET: how well the market's midpoint and the model (at each vol multiplier) predicted the
    result (log loss; lower is better)."""
    tot = {"market": 0.0, **{m: 0.0 for m in mults}}
    n = 0
    for ev in data.values():
        src = SERIES.get(ev["series"])
        if not src:
            continue
        at = ev["close"] - 3.5 * 3600
        level, vol = last_before(prices[src["index"]], at), last_before(prices[src["vol"]], at, 24 * 3600)
        if level is None or vol is None:
            continue
        for m in ev["markets"]:
            q = quote_at(ev["candles"].get(m["ticker"]) or [], at)
            if not q:
                continue
            hit = m["result"] == "yes"
            tot["market"] += k_log((q[0] + q[1]) / 2, hit)
            for mu in mults:
                tot[mu] += k_log(chance(m, level, vol / 100, 3.5, mu), hit)
            n += 1
    return {"brackets": n, **{key: v / n for key, v in tot.items()}} if n else {"brackets": 0}


def k_log(p: float, hit: bool) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return -math.log(p if hit else 1 - p)


GRID = [{"vol_mult": v, "margin": m} for v in (0.6, 0.8, 1.0, 1.2) for m in (0.03, 0.05, 0.10)]


def walk_forward(trades: dict[int, list[dict]], settings: list[dict], warmup_days: int = 10, min_learn: int = 15) -> list[dict]:
    """Held-out trades: each day, the setting that made the most on earlier days (with min_learn+ trades) is used."""
    days = sorted({t["day"] for ts in trades.values() for t in ts})
    held = []
    for n, d in enumerate(days):
        if n < warmup_days:
            continue
        past = {i: [t for t in ts if t["day"] < d] for i, ts in trades.items()}
        ok = [i for i, ts in past.items() if len(ts) >= min_learn]
        if not ok:
            continue
        best = max(ok, key=lambda i: sum(t["r"] for t in past[i]))
        held += [{**t, "setting": best} for t in trades[best] if t["day"] == d]
    return held


# ---- The strict test (the same rules as the real-money gate) ----

GATE = {"min_trades": 100, "min_days": 14, "min_lcb": 0.01, "alpha": 0.05, "min_good_days": 0.60}


def gate(trades: list[dict], tests: int, rules: dict = GATE) -> dict:
    """100+ settled trades on 14+ days, profit per trade after fees with a lower confidence bound above +1%
    (one-sided, Bonferroni over `tests`, days as clusters), up on 60%+ of days, and up over the last 7 days."""
    from statistics import NormalDist

    n = len(trades)
    by_day: dict[str, list[float]] = {}
    for t in trades:
        x = by_day.setdefault(t["day"], [0, 0.0])
        x[0] += 1
        x[1] += t["r"]
    mean = sum(t["r"] for t in trades) / n if n else 0.0
    dn, lcb = len(by_day), -math.inf
    if dn >= 2:
        var = sum((s - mean * c) ** 2 for c, s in by_day.values()) / n ** 2 * dn / (dn - 1)
        lcb = mean - NormalDist().inv_cdf(1 - rules["alpha"] / max(1, tests)) * math.sqrt(var)
    good = sum(s > 0 for _, s in by_day.values()) / dn if dn else 0.0
    last = None
    if by_day:
        since = (date.fromisoformat(max(by_day)) - timedelta(days=6)).isoformat()
        last = sum(s for d, (_, s) in by_day.items() if d >= since)
    checks = {"trades": (n >= rules["min_trades"], f"{n}/{rules['min_trades']} trades"),
              "days": (dn >= rules["min_days"], f"{dn}/{rules['min_days']} days"),
              "lcb": (lcb > rules["min_lcb"], f"low end {lcb:+.1%}" if math.isfinite(lcb) else "low end unknown"),
              "good_days": (good >= rules["min_good_days"], f"{good:.0%} of days up"),
              "last_week": (last is not None and last > 0, f"last week {last:+.2f}" if last is not None else "no last week")}
    return {"passes": all(ok for ok, _ in checks.values()), "n": n, "mean": mean, "lcb": lcb, "days": dn,
            "won": sum(t["won"] for t in trades) / n if n else None, "missing": [w for ok, w in checks.values() if not ok]}


def backtest(data: dict | None = None, prices: dict | None = None) -> dict:
    """The model against the market on the saved settled events, and the walk-forward result."""
    data = data if data is not None else json.loads(DATA.read_text())
    if prices is None:
        prices = {sym: hourly(sym) for src in SERIES.values() for sym in (src["index"], src["vol"])}
    cfg = {**DEFAULTS}
    trades = bt_trades(data, prices, cfg, GRID)
    held = walk_forward(trades, GRID)
    g = gate(held, len(GRID))
    ll = log_loss_check(data, prices)
    days = sorted({datetime.fromtimestamp(ev["close"], timezone.utc).date().isoformat() for ev in data.values()})
    text = (f"Kalshi stocks backtest ({len(data)} settled S&P/Nasdaq events, {days[0]} to {days[-1]}): "
            f"log loss per bracket at 12:30 pm ET (lower is better): market {ll.get('market', 0):.3f}, model "
            + ", ".join(f"x{m} vol {ll[m]:.3f}" for m in (0.6, 0.8, 1.0, 1.2) if m in ll) + ". "
            f"Walk-forward: {g['n']} trades"
            + (f", won {g['won']:.0%}, {g['mean']:+.1%} a trade after fees, low end {g['lcb']:+.1%}" if g["n"] else "")
            + f". {'PASSES' if g['passes'] else 'Does not pass: ' + ', '.join(g['missing'])}.")
    print(text, flush=True)
    return {"text": text, "gate": g, "log_loss": ll, "by_setting": {json.dumps(GRID[i]): (len(t), sum(x["r"] for x in t) / len(t) if t else None)
                                                                      for i, t in trades.items()}}


# ---- Live practice ----

def load_settings(path: Path = SETTINGS) -> dict:
    s = yaml.safe_load(path.read_text()) if path.exists() else {}
    return {**DEFAULTS, **(s or {})}


def parse_book(j: dict) -> dict[str, list[tuple[float, float]]]:
    """{"yes": [(ask, size), ...], "no": [...]}, cheapest first, from GET /markets/{ticker}/orderbook. Kalshi lists
    only bids: a YES ask at P is a NO bid at 1-P."""
    fp, old = j.get("orderbook_fp") or {}, j.get("orderbook") or {}
    bids = {}
    for side in ("yes", "no"):
        rows = fp.get(f"{side}_dollars")
        if rows is None and old.get(side) is not None:
            rows = [[c / 100, n] for c, n in old.get(side) or []]
        bids[side] = [(k._f(p), k._f(n)) for p, n in rows or [] if 0 < k._f(p) < 1 and k._f(n) > 0]
    other = {"yes": "no", "no": "yes"}
    return {side: sorted((round(1 - p, 4), n) for p, n in bids[other[side]]) for side in ("yes", "no")}


def fetch_book(ticker: str) -> dict:
    j = k.kget(f"/markets/{ticker}/orderbook")
    time.sleep(0.3)
    return parse_book(j)


def walk(asks: list[tuple[float, float]], budget: float, limit: float) -> dict:
    """Whole contracts from the cheapest ask up to `limit`, at most `budget` dollars with the fee at every level."""
    levels, cost, fees, count = [], 0.0, 0.0, 0
    for price, size in asks:
        if price > limit + 1e-9:
            break
        n = min(int(math.floor(size + 1e-9)), int((budget - cost) // price))
        while n > 0 and cost + n * price + k.fee(price, n) > budget + 1e-9:
            n -= 1
        if n < 1:
            break
        f = k.fee(price, n)
        levels.append([price, n])
        cost, fees, count = cost + n * price + f, fees + f, count + n
    return {"count": count, "cost": round(cost, 2), "fees": round(fees, 2), "levels": levels,
            "avg": cost / count if count else 0.0, "top": asks[0][0] if asks else None}


def limit_price(b: dict, cfg: dict) -> float:
    """The most it pays per contract: best ask + max_slip, the max price, and where the edge still beats the margin."""
    lim, p, best = min(b["price"] + float(cfg["max_slip"]), float(cfg["max_price"])), round(b["price"], 2), None
    while p <= lim + 1e-9:
        if b["fair"] - p - k.fee(p) - float(cfg["slip"]) > float(cfg["margin"]):
            best = p
        p = round(p + 0.01, 2)
    return best if best is not None else b["price"]


def today_events(series: str, now: float) -> list[dict]:
    """The open events of a series that close today (ET), with their markets and close time."""
    from zoneinfo import ZoneInfo

    evs = k.kget("/events", {"series_ticker": series, "status": "open", "with_nested_markets": "true"}).get("events", [])
    today = datetime.fromtimestamp(now, ZoneInfo(ET)).date()
    out = []
    for e in evs:
        ms = [m for m in e.get("markets") or [] if m.get("status") in (None, "active", "open")]
        if not ms:
            continue
        close = max(datetime.fromisoformat(m["close_time"].replace("Z", "+00:00")).timestamp() for m in ms)
        if datetime.fromtimestamp(close, ZoneInfo(ET)).date() == today:
            out.append({**e, "series": series, "markets": ms, "close": close})
    time.sleep(0.5)
    return out


def in_window(now: float, cfg: dict) -> bool:
    """A weekday between first_hour and last_hour ET (10 am - 3:30 pm by default)."""
    from zoneinfo import ZoneInfo

    t = datetime.fromtimestamp(now, ZoneInfo(ET))
    h = t.hour + t.minute / 60
    return t.weekday() < 5 and float(cfg["first_hour"]) <= h <= float(cfg["last_hour"])


def trade_step(acct: dict, events: list[dict], levels: dict, cfg: dict, tell, now: float, book_of=None) -> int:
    """Buy the best side of each of today's events (one bet per event) where the model beats the ask by the margin."""
    book_of = book_of or fetch_book
    positions = acct.setdefault("positions", {})
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if acct.get("day") != day:
        acct.update(day=day, trades_today=0)
    held, bought = {p["event"] for p in positions.values()}, 0
    for e in events:
        src = SERIES[e["series"]]
        if e["event_ticker"] in held or acct["trades_today"] >= int(cfg["max_trades_per_day"]) \
                or len(positions) >= int(cfg["max_open"]):
            continue
        lv, vol = levels.get(src["index"]), levels.get(src["vol"])
        if not lv or not vol:
            continue
        hrs = hours_left(now, e["close"])
        b = best_side(e["markets"], lv, vol / 100, hrs, cfg)
        if not b:
            continue
        budget = min(float(cfg["per_trade"]), acct["cash"])
        if budget < float(cfg["min_fill"]):
            break
        try:
            book = book_of(b["ticker"])
        except Exception as ex:
            log.warning("order book %s: %s", b["ticker"], ex)
            continue
        lim = limit_price(b, cfg)
        fill = walk(book.get(b["side"]) or [], budget, lim)
        if fill["count"] < 1 or fill["cost"] < float(cfg["min_fill"]):
            log.warning("skipped %s %s: only %s at up to %.0fc in the book", b["ticker"], b["side"], k.money(fill["cost"]), lim * 100)
            continue
        m = b["market"]
        what = m.get("yes_sub_title") or m.get("subtitle") or m["ticker"].split("-")[-1]
        title = f"{src['name']} close today: {what}"
        acct["cash"] -= fill["cost"]
        acct["trades_today"] += 1
        bought += 1
        held.add(e["event_ticker"])
        positions[b["ticker"]] = {"event": e["event_ticker"], "side": b["side"], "count": fill["count"], "price": fill["avg"],
                                  "cost": fill["cost"], "kind": "stocks", "fair": b["fair"], "opened": now, "title": title,
                                  "fill": {"top": fill["top"], "limit": lim, "fees": fill["fees"], "levels": fill["levels"]},
                                  "level": lv, "vol": vol, "hours": round(hrs, 2)}
        tell(f"🎯 PRACTICE Kalshi stocks: {fill['count']} {b['side'].upper()} for {k.money(fill['cost'])}",
             f"{title}. {src['name']} is {lv:,.2f} with {hrs:.1f} h to the close; the bot says {b['fair']:.0%}, "
             f"it paid {fill['avg'] * 100:.1f}¢ on average. Pays {k.money(fill['count'])} if right. (Unproven: practice.)")
    return bought


def results_as_trades(acct: dict) -> list[dict]:
    out = []
    for r in acct.get("results", []):
        d = datetime.fromtimestamp(r.get("opened") or r["t"], timezone.utc).date().isoformat()
        out.append({"day": d, "r": r["profit"] / r["cost"] if r.get("cost") else 0.0, "won": r["won"]})
    return out


def report(acct: dict, tests: int) -> tuple[str, str]:
    res = acct.get("results", [])
    g = gate(results_as_trades(acct), tests)
    value = acct["cash"] + sum(p["cost"] for p in acct.get("positions", {}).values())
    line = (f"{k.money(value)} ({len(acct.get('positions', {}))} open), {len(res)} settled"
            + (f", won {g['won']:.0%}, {sum(r['profit'] for r in res) / len(res):+,.2f} a trade ({g['mean']:+.1%} after fees)"
               if res else "") + ".")
    verdict = "PASSES the real-money test (nothing is switched on)" if g["passes"] else "Not yet: " + ", ".join(g["missing"])
    return ("✅ Kalshi stocks: PASSES the real-money test" if g["passes"] else "📊 Kalshi stocks (practice)",
            f"{line} {verdict}.")


def step(cfg: dict, tell=print, now: float | None = None, events: list[dict] | None = None, levels: dict | None = None,
         book_of=None, path: Path = STATE) -> str:
    """One check: settle finished bets, then (in market hours) look for today's bets. Practice only."""
    now = now or time.time()
    if cfg.get("mode") != "practice":
        return "Off (practice is the only mode)."
    state = json.loads(path.read_text()) if path.exists() else {}
    acct = state.setdefault("account", {"cash": float(cfg["cash"]), "start": float(cfg["cash"]), "positions": {},
                                        "results": [], "started": now})
    if "announced" not in state:
        state["announced"] = now
        tell("📈 Kalshi stock bot started (practice)",
             f"Pretend {k.money(acct['cash'])}, {k.money(float(cfg['per_trade']))} a bet, on where the S&P 500 and "
             f"Nasdaq-100 close today. It bets only where its odds beat the price by {float(cfg['margin']) * 100:.0f}¢ "
             "after fees, filled against the real order book. Unproven: practice only.")
    try:
        extra = {t: {x: p[x] for x in ("fill", "level", "vol", "hours") if x in p} for t, p in acct["positions"].items()}
        n0 = len(acct.get("results", []))
        k.settle(acct, tell, "PRACTICE ", now, {}, "[stocks] ")
        for r in acct.get("results", [])[n0:]:            # keep how each bet was filled and what the bot saw
            r.update(extra.get(r.get("ticker"), {}))
        bought = 0
        if in_window(now, cfg):
            if events is None:
                events = [e for s in SERIES for e in today_events(s, now)]
            if levels is None:
                levels = {}
                for src in SERIES.values():
                    for sym in (src["index"], src["vol"]):
                        try:
                            v, t = live_level(sym)
                            if now - t < 15 * 60:            # a stale price is no price
                                levels[sym] = v
                        except Exception as ex:
                            log.warning("%s: %s", sym, ex)
            bought = trade_step(acct, events, levels, cfg, tell, now, book_of)
        from .solbot import report_due

        due = report_due(now, cfg["report_at"], cfg["timezone"], state.get("report_day"))
        if due:
            state["report_day"] = due
            tell(*report(acct, len(GRID)))
        value = acct["cash"] + sum(p["cost"] for p in acct["positions"].values())
        return (f"Kalshi stocks (practice): {k.money(value)}, {len(acct['positions'])} open, "
                f"{len(acct.get('results', []))} settled, bought {bought}.")
    finally:
        acct["results"] = acct.get("results", [])[-2000:]
        path.write_text(json.dumps(state, indent=1, default=str))


def status_text(path: Path = STATE) -> str:
    if not path.exists():
        return "No saved Kalshi stock account yet."
    acct = json.loads(path.read_text()).get("account", {})
    lines = ["\n".join(report(acct, len(GRID)))]
    lines += ["RESULT " + json.dumps(r, default=str) for r in acct.get("results", [])]
    lines += ["OPEN " + json.dumps({"ticker": t, **p}, default=str) for t, p in (acct.get("positions") or {}).items()]
    return "\n".join(lines)


def run(settings_path: str = str(SETTINGS)):
    from .signals import alert_target, notify

    def tell(title, msg):
        log.warning("KALSHI STOCKS %s: %s", title, msg)
        target = alert_target()
        if target:
            notify(target, title, msg, buy="LOST" not in title)

    print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), step(load_settings(Path(settings_path)), tell), flush=True)
