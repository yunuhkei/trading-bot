"""Kalshi practice accounts with their own pretend $1,000 and $100 trades (kalshi.yaml `big_accounts`), next to the
$100 / $5 accounts in bot/kalshi.py (those and their records are untouched; these live in kalshi_state_big.json).

The strategies are the same (F, G and C by default: same ideas, same markets, same checks); what's different is the
fill. A $100 order is filled against Kalshi's real order book at that moment, not at the top price:

- it buys from the cheapest ask up, whole contracts, never above a limit price: the best ask plus `max_slip` (3c), and
  never past the strategy's own limits (its max price; for model-edge strategies like C, the price where its edge
  after fees would drop under its min_edge);
- each price level pays Kalshi's taker fee (7% x contracts x P x (1-P)), rounded up to the cent per level, so the fee
  is never less than Kalshi would charge;
- if the book doesn't have at least `min_fill` dollars at acceptable prices, it skips the trade (counted as "thin");
- the three accounts share one book per check: what one account bought isn't there for the next;
- an order never costs more than the account's cash, and every open bet's cost is out of the cash until it settles.

Kalshi's order book lists only bids: a YES ask at P is a NO bid at 1-P (and the other way around).
"""
from __future__ import annotations

import json
import logging
import math
import time
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_big")
STATE = Path("kalshi_state_big.json")
DEFAULTS = {"strategies": ["F", "G", "C"], "cash": 1000.0, "per_trade": 100.0, "max_slip": 0.03, "min_fill": 10.0,
            "max_trades_per_day": 10, "max_trades_per_check": 3, "report_at": "15:00"}


def config(settings: dict) -> dict | None:
    cfg = settings.get("big_accounts")
    if not cfg or cfg.get("enabled") is False:
        return None
    return {**DEFAULTS, **cfg}


def name(key: str, cfg: dict) -> str:
    return f"{key}{float(cfg['cash']):.0f}"            # "F1000"


# ---- The order book ----

def parse_book(j: dict) -> dict[str, list[tuple[float, float]]]:
    """{"yes": [(ask, size), ...], "no": [...]}, cheapest first, from GET /markets/{ticker}/orderbook (either format:
    orderbook_fp with dollar strings, or the older orderbook with cents)."""
    fp, old = j.get("orderbook_fp") or {}, j.get("orderbook") or {}
    bids = {}
    for side in ("yes", "no"):
        rows = fp.get(f"{side}_dollars")
        if rows is None and old.get(side) is not None:
            rows = [[c / 100, n] for c, n in old.get(side) or []]
        bids[side] = [(k._f(p), k._f(n)) for p, n in rows or [] if 0 < k._f(p) < 1 and k._f(n) > 0]
    other = {"yes": "no", "no": "yes"}
    return {side: sorted((round(1 - p, 4), n) for p, n in bids[other[side]]) for side in ("yes", "no")}


def fetch_book(ticker: str) -> dict[str, list[tuple[float, float]]]:
    j = k.kget(f"/markets/{ticker}/orderbook")
    time.sleep(0.3)                                      # stay under Kalshi's rate limit
    return parse_book(j)


def walk(asks: list[tuple[float, float]], budget: float, limit: float, taken: dict | None = None) -> dict:
    """Buy whole contracts from the cheapest ask up to `limit`, spending at most `budget` dollars including fees.
    `taken`: {price: contracts} already bought from this book this check (not there any more; updated)."""
    taken = taken if taken is not None else {}
    levels, cost, fees, count = [], 0.0, 0.0, 0
    for price, size in asks:
        if price > limit + 1e-9:
            break
        avail = int(math.floor(size - taken.get(price, 0) + 1e-9))
        if avail < 1:
            continue
        n = min(avail, int((budget - cost) // price))
        while n > 0 and cost + n * price + k.fee(price, n) > budget + 1e-9:
            n -= 1
        if n < 1:
            break
        f = k.fee(price, n)
        levels.append([price, n])
        cost += n * price + f
        fees += f
        count += n
        taken[price] = taken.get(price, 0) + n
    return {"count": count, "cost": round(cost, 2), "fees": round(fees, 2), "levels": levels,
            "avg": cost / count if count else 0.0, "top": asks[0][0] if asks else None}


def limit_price(idea: dict, rules: dict, max_slip: float) -> float:
    """The most it may pay per contract: the best ask + max_slip, within the strategy's price range, and for
    strategies that need an edge, where the edge after fees still meets min_edge."""
    lim = min(idea["price"] + max_slip, float(rules.get("max_price", 0.97)))
    if rules.get("pick") != "favorite" and idea.get("fair") is not None:
        need = float(rules.get("min_edge", 0.10))
        p = round(idea["price"], 2)
        best = None
        while p <= lim + 1e-9:
            if idea["fair"] - p - k.fee(p) >= need - 1e-9:
                best = p
            p = round(p + 0.01, 2)
        lim = best if best is not None else idea["price"]
    return lim


# ---- The accounts ----

def account(state: dict, key: str, cfg: dict) -> dict:
    cash = float(cfg["cash"])
    return state.setdefault(name(key, cfg), {"cash": cash, "start": cash, "positions": {}, "results": [],
                                             "started": time.time(), "thin": 0})


def big_trade(acct: dict, ideas: list[dict], rules: dict, cfg: dict, book_of, books: dict, taken: dict, tell,
              tag: str, now: float) -> int:
    """Buy the best ideas within the limits at realistic fills; returns how many trades it made."""
    positions = acct.setdefault("positions", {})
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if acct.get("day") != day:
        acct.update(day=day, trades_today=0)
    held, bought = {p["event"] for p in positions.values()}, 0
    for i in ideas:
        if acct["trades_today"] >= int(cfg["max_trades_per_day"]) or bought >= int(cfg["max_trades_per_check"]):
            break
        if i.get("kind") != "weather" or i["event"] in held:
            continue
        budget = min(float(cfg["per_trade"]), acct["cash"])
        if budget < float(cfg["min_fill"]):
            break                                        # no cash left to trade with
        if i["ticker"] not in books:
            try:
                books[i["ticker"]] = book_of(i["ticker"])
            except Exception as e:
                log.warning("order book %s: %s", i["ticker"], e)
                continue
        asks = books[i["ticker"]].get(i["side"]) or []
        lim = limit_price(i, rules, float(cfg["max_slip"]))
        fill = walk(asks, budget, lim, taken.setdefault((i["ticker"], i["side"]), {}))
        if fill["count"] < 1 or fill["cost"] < float(cfg["min_fill"]):
            seen = acct.setdefault("thin_seen", {})      # not enough at acceptable prices: skipped (counted once per event)
            if i["event"] not in seen:
                seen[i["event"]] = now
                acct["thin"] = acct.get("thin", 0) + 1
            for price, n in fill["levels"]:              # give back what this skipped order took
                taken[(i["ticker"], i["side"])][price] -= n
            log.warning("%sskipped %s: only %s at up to %.0fc in the book", tag, i["title"], k.money(fill["cost"]), lim * 100)
            continue
        acct["cash"] -= fill["cost"]
        acct["trades_today"] += 1
        bought += 1
        held.add(i["event"])
        positions[i["ticker"]] = {"event": i["event"], "side": i["side"], "count": fill["count"], "price": fill["avg"],
                                  "cost": fill["cost"], "kind": "weather", "fair": i.get("fair"), "opened": now,
                                  "title": i["title"],
                                  "fill": {"top": fill["top"], "limit": lim, "fees": fill["fees"], "levels": fill["levels"]}}
        tell(f"🎯 {tag}Kalshi: bought {fill['count']} {i['side'].upper()} for {k.money(fill['cost'])} "
             f"(avg {fill['avg'] * 100:.1f}¢, best ask {(fill['top'] or 0) * 100:.0f}¢)",
             f"{i['title']}. {len(fill['levels'])} price level(s), fees {k.money(fill['fees'])}. Pays "
             f"{k.money(fill['count'])} if right.")
    return bought


def big_step(settings: dict, views: list, strats: dict, cache: dict, now: float, quiet, book_of=None,
             path: Path = STATE, tell=None) -> dict | None:
    """Settle and trade every $1,000 account (one check), and send the daily report when it's due. Returns the saved
    state, or None if they're off."""
    cfg = config(settings)
    if not cfg:
        return None
    book_of = book_of or fetch_book
    state = json.loads(path.read_text()) if path.exists() else {}
    keys = [key for key in cfg["strategies"] if key in strats]
    try:
        for key in keys:
            k.settle(account(state, key, cfg), quiet, "PRACTICE ", now, cache, f"[{name(key, cfg)}] ")
        books, taken = {}, {}
        for key in keys:
            rules = strats[key]["rules"]
            ideas = k.ideas_from_views(views, rules)
            big_trade(account(state, key, cfg), ideas, rules, cfg, book_of, books, taken,
                      lambda t, m, n=name(key, cfg): quiet(f"[{n}] {t}", m), "PRACTICE ", now)
        from .solbot import report_due

        due = report_due(now, cfg["report_at"], settings.get("timezone", "America/Chicago"), state.get("report_day"))
        if due:
            state["report_day"] = due
            title, msg, passing = report(state, cfg, tests_run(len(keys)))
            (tell or quiet)(title, msg)
            for n in passing:                            # remember when each account first passed
                if not state.setdefault("passed", {}).get(n):
                    state["passed"][n] = now
        return state
    finally:
        for key in keys:
            a = state.get(name(key, cfg))
            if a:
                a["results"] = a.get("results", [])[-3000:]
                a["thin_seen"] = {e: t for e, t in (a.get("thin_seen") or {}).items() if now - t < 3 * 86400}
        path.write_text(json.dumps(state, indent=1, default=str))


# ---- The real-money gate ----

GATE = {"min_trades": 100, "min_days": 14, "min_lcb": 0.01, "alpha": 0.05, "min_good_days": 0.60}
BRAIN = Path("models/kalshi_brain.json")


def tests_run(n_accounts: int = 3, path: Path = BRAIN) -> int:
    """How many things have been tested (for the multiple-testing correction): the accounts plus every slice the
    Kalshi brain tested (models/kalshi_brain.json)."""
    try:
        return n_accounts + int(json.loads(path.read_text()).get("tests", 0))
    except (OSError, ValueError, TypeError):
        return n_accounts


def trade_day(r: dict) -> str:
    d = k.event_day(r.get("event") or "")
    return d.isoformat() if d else time.strftime("%Y-%m-%d", time.gmtime(r["t"]))


def lower_bound(results: list[dict], tests: int, alpha: float = 0.05) -> tuple[float, float]:
    """(profit per dollar staked after fees, its one-sided lower confidence bound at alpha/tests). Trades on the same
    day share the weather and the market's mood, so the error is measured with days as the units (cluster-robust)."""
    from statistics import NormalDist

    cost = sum(r["cost"] for r in results)
    if not results or cost <= 0:
        return 0.0, -math.inf
    rate = sum(r["profit"] for r in results) / cost
    days: dict[str, list[float]] = {}
    for r in results:
        d = days.setdefault(trade_day(r), [0.0, 0.0])
        d[0] += r["profit"]
        d[1] += r["cost"]
    n = len(days)
    if n < 2:
        return rate, -math.inf
    var = sum((p - rate * c) ** 2 for p, c in days.values()) / cost ** 2 * n / (n - 1)
    z = NormalDist().inv_cdf(1 - alpha / max(1, tests))
    return rate, rate - z * math.sqrt(var)


def gate(results: list[dict], tests: int, rules: dict = GATE) -> dict:
    """Whether an account qualifies for real money: 100+ settled trades on 14+ different days, a profit per dollar
    after fees whose lower confidence bound (corrected for `tests` things tested) is above +1%, profitable on 60%+ of
    days, and still positive over the most recent 7 days. It only says so; it never switches anything on."""
    rate, lcb = lower_bound(results, tests, rules["alpha"])
    by_day: dict[str, float] = {}
    for r in results:
        by_day[trade_day(r)] = by_day.get(trade_day(r), 0.0) + r["profit"]
    days = sorted(by_day)
    good = sum(v > 0 for v in by_day.values()) / len(days) if days else 0.0
    last = None
    if days:
        from datetime import date, timedelta

        since = (date.fromisoformat(days[-1]) - timedelta(days=6)).isoformat()
        last = sum(v for d, v in by_day.items() if d >= since)
    checks = {"trades": (len(results) >= rules["min_trades"], f"{len(results)}/{rules['min_trades']} trades"),
              "days": (len(days) >= rules["min_days"], f"{len(days)}/{rules['min_days']} days"),
              "lcb": (lcb > rules["min_lcb"], f"low end {lcb:+.1%}" if math.isfinite(lcb) else "low end unknown"),
              "good_days": (good >= rules["min_good_days"], f"{good:.0%} of days up"),
              "last_week": (last is not None and last > 0, f"last week {last:+,.2f}" if last is not None else "no last week")}
    return {"passes": all(ok for ok, _ in checks.values()), "rate": rate, "lcb": lcb, "tests": tests,
            "checks": checks, "missing": [why for ok, why in checks.values() if not ok]}


def report(state: dict, cfg: dict, tests: int) -> tuple[str, str, list[str]]:
    """(title, message, keys that pass the gate) for the daily report."""
    lines, passing = [], []
    for key in cfg["strategies"]:
        n = name(key, cfg)
        acct = state.get(n)
        if not acct:
            continue
        res = acct.get("results", [])
        wins = sum(r["won"] for r in res)
        g = gate(res, tests)
        per = sum(r["profit"] for r in res) / len(res) if res else 0.0
        lines.append(f"{n}: {k.money(value(acct))} ({len(acct.get('positions', {}))} open), {len(res)} settled, "
                     + (f"won {wins / len(res):.0%}, {per:+,.2f} a trade ({g['rate']:+.1%} after fees)" if res else "none yet")
                     + (f", {acct.get('thin', 0)} skipped (thin book)" if acct.get("thin") else "")
                     + (". PASSES the real-money test" if g["passes"] else f". Not yet: {', '.join(g['missing'])}"))
        if g["passes"]:
            passing.append(n)
    head = "✅ Kalshi: an account PASSES the real-money test" if passing else "📊 Kalshi $1,000 accounts (practice)"
    note = (f"Test: 100+ trades on 14+ days, low end of profit per $ above +1% (corrected for {tests} things tested), "
            "60%+ of days up, last week up. Nothing is switched on; real money needs your Kalshi keys.")
    return head, "\n".join(lines + [note]), passing


def value(acct: dict) -> float:
    """Cash plus what the open bets cost (they're valued at cost until they settle)."""
    return acct.get("cash", 0.0) + sum(p["cost"] for p in (acct.get("positions") or {}).values())


def status_rows(settings: dict, path: Path = STATE) -> list[str]:
    """RESULT / OPEN rows (JSON) for the kalshi-status workflow, with strategy names like "F1000"."""
    cfg = config(settings)
    if not cfg or not path.exists():
        return []
    state = json.loads(path.read_text())
    out = []
    for key in cfg["strategies"]:
        n = name(key, cfg)
        acct = state.get(n) or {}
        out += ["RESULT " + json.dumps({"strategy": n, **r}, default=str) for r in acct.get("results", [])]
        out += ["OPEN " + json.dumps({"strategy": n, "ticker": t, **p}, default=str)
                for t, p in (acct.get("positions") or {}).items()]
    return out
