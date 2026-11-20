"""REAL MONEY on Kalshi, small and fenced in (kalshi.yaml `real:`). OFF unless `enabled: true` AND the KALSHI_KEY_ID /
KALSHI_PRIVATE_KEY secrets exist; with `dry_run: true` (the default) it reads the real account and says what it would
buy, but sends no orders. Every practice account (the $100 ones, the $1,000 ones) keeps running untouched.

It trades ONE strategy (G by default, the same ideas as its practice accounts), with:
- `per_trade` dollars a bet, fees included, sized at its limit price (the best ask + `max_slip`, never past the
  strategy's own limits), sent as immediate-or-cancel: whatever doesn't fill at once is cancelled (and the order is
  cancelled by its own id as a backup). It never touches orders it didn't place;
- the cushion: it never has more at risk than (its money - `floor`), checked against its own record AND the real cash
  on Kalshi. Every order counts as fully filled at its limit price the moment it's sent (the worst case); Kalshi's own
  fills and positions then correct that down. If every open bet lost at once, the account would end at the floor;
- at the floor it stops for good and pings the owner; a daily stop after `max_day_loss`; after `check_after` settled
  real bets it stops if real results run more than `max_gap` a bet below the same strategy's $1,000 practice account;
- anything on Kalshi it didn't place (or more contracts than it recorded) stops it, and pings the owner;
- at most `max_trades_per_day` bets a day and one bet per city per day. It won't run if the older `mode: live` is on.
Kalshi pays out winnings itself; this file keeps the record and the limits (kalshi_state_real.json).
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path

from . import kalshi as k
from . import kalshi_big as kb

log = logging.getLogger("kalshi_real")
STATE = Path("kalshi_state_real.json")
DEFAULTS = {"enabled": False, "dry_run": True, "strategy": "G", "bankroll": 100.0, "per_trade": 10.0, "floor": 70.0,
            "max_day_loss": 15.0, "max_trades_per_day": 5, "max_slip": 0.02, "min_fill": 3.0, "check_after": 20,
            "max_gap": 0.10}
FINAL = ("finalized", "settled", "determined")


def config(settings: dict) -> dict | None:
    """Its settings, or None when it's off. Only `enabled: true` exactly turns it on, and only `dry_run: false` exactly
    sends real orders (a blank or anything else stays a dry run)."""
    c = settings.get("real") or {}
    if c.get("enabled") is not True:
        return None
    cfg = {**DEFAULTS, **{key: v for key, v in c.items() if v is not None}}
    cfg["dry_run"] = c.get("dry_run") is not False
    return cfg


def _num(d: dict, *keys) -> float | None:
    """The first of these fields Kalshi sent, as a number (it sends some as cents, some as '_fp'/'_dollars' strings)."""
    for key in keys:
        v = (d or {}).get(key)
        if v is not None and v != "":
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


def real_cash(client) -> float | None:
    """The account's real cash on Kalshi, in dollars (None if it can't tell: then nothing is bought)."""
    try:
        b = client.call("GET", "/portfolio/balance")
    except Exception as e:
        log.warning("REAL balance: %s", e)
        return None
    dollars = _num(b, "balance_dollars")
    if dollars is not None:
        return dollars
    cents = _num(b, "balance")
    return cents / 100 if cents is not None else None


def real_positions(client) -> dict[str, float] | None:
    """{ticker: contracts held} on the real account, from Kalshi itself (None if it can't tell)."""
    out, cursor = {}, None
    try:
        for _ in range(20):
            params = {"limit": 200, "count_filter": "position", **({"cursor": cursor} if cursor else {})}
            j = client.call("GET", "/portfolio/positions", params=params)
            for m in j.get("market_positions") or []:
                n = _num(m, "position_fp", "position")
                if n:
                    out[m.get("ticker")] = abs(n)
            cursor = j.get("cursor")
            if not cursor:
                break
    except Exception as e:
        log.warning("REAL positions: %s", e)
        return None
    return out


def order_fills(client, order_id: str, side: str) -> tuple[int, float] | None:
    """(contracts, cost with fees) Kalshi really filled for one order, from its fills; None if it can't tell."""
    try:
        fills = client.call("GET", "/portfolio/fills", params={"order_id": order_id, "limit": 200}).get("fills") or []
    except Exception as e:
        log.warning("REAL fills %s: %s", order_id, e)
        return None
    count, cost = 0, 0.0
    for f in fills:
        n = _num(f, "count_fp", "count")
        p = _num(f, f"{side}_price_dollars")
        if p is None:
            c = _num(f, f"{side}_price")
            p = c / 100 if c is not None else None
        if not n or p is None:
            return None                                  # a fill it can't read: keep the safe estimate
        n = int(round(n))
        count += n
        cost += n * p + k.fee(p, n)
    return count, round(cost, 2)


def place(client, ticker: str, side: str, count: int, price: float, coid: str) -> dict:
    """One limit buy, immediate-or-cancel, tagged as this module's (`price` is already a whole cent: never more)."""
    body = {"ticker": ticker, "action": "buy", "side": side, "count": int(count), "type": "limit",
            f"{side}_price": int(round(price * 100)), "client_order_id": coid, "time_in_force": "immediate_or_cancel"}
    return client.call("POST", "/portfolio/orders", body).get("order", {}) or {}


def cancel(client, order_id: str | None):
    if not order_id:
        return
    try:
        client.call("DELETE", f"/portfolio/orders/{order_id}")
    except Exception as e:                               # already filled or cancelled: fine
        log.info("REAL cancel %s: %s", order_id, e)


def affordable(budget: float, price: float, available: int) -> int:
    """Contracts at `price` (fees included) that fit in `budget`, no more than the book has."""
    n = min(available, int(budget // price) if price > 0 else 0)
    while n > 0 and n * price + k.fee(price, n) > budget + 1e-9:
        n -= 1
    return max(n, 0)


def money_now(acct: dict) -> float:
    return float(acct["bankroll"]) + acct["pnl"]


def at_risk(acct: dict) -> float:
    return sum(p["cost"] for p in acct["positions"].values())


def settle_real(acct: dict, cache: dict, tell, now: float, held_real: dict | None):
    for ticker in list(acct["positions"]):
        p = acct["positions"][ticker]
        if ticker not in cache:
            try:
                cache[ticker] = k.kget(f"/markets/{ticker}").get("market", {})
            except Exception as e:
                log.warning("market %s: %s", ticker, e)
                continue
        m = cache[ticker]
        if m.get("status") not in FINAL or (p.get("est") and not p.get("order") and not p.get("seen")):
            continue                                     # (an order whose fate is unclear never books a result)
        if m.get("result") in ("yes", "no"):
            won = m["result"] == p["side"]
            profit = (p["count"] if won else 0.0) - p["cost"]
        elif held_real is not None and ticker not in held_real:     # voided: Kalshi refunded it
            won, profit = None, 0.0
        else:
            continue
        acct["pnl"] += profit
        acct["day_pnl"] += profit
        acct["positions"].pop(ticker)
        acct.setdefault("closed", {})[ticker] = now        # Kalshi may still show it for a while after it settles
        acct["results"].append({"t": now, "ticker": ticker, "title": p["title"], "won": won, "profit": round(profit, 2),
                                "cost": p["cost"], "count": p["count"], "price": p["price"], "opened": p["opened"],
                                "est": p.get("est", False)})
        tell(("✅ REAL Kalshi WON" if won else "❌ REAL Kalshi LOST" if won is False else "↩️ REAL Kalshi refunded")
             + f": {profit:+,.2f}", f"{p['title']} ({p['count']} {p['side'].upper()} at {p['price'] * 100:.0f}¢). Real "
             f"account about {k.money(money_now(acct))}.")


def reconcile(acct: dict, held_real: dict, client, now: float) -> list[str]:
    """Bring its record in line with Kalshi: real fills for estimated bets, fewer contracts if fewer filled. Returns
    tickers where Kalshi holds MORE than it recorded (those stop it)."""
    over = []
    for ticker, p in list(acct["positions"].items()):
        real_n = held_real.get(ticker)
        if p.get("est") and not p.get("order"):          # an order whose reply never came: Kalshi's positions decide
            if real_n is not None:
                p["seen"] = True
                if real_n < p["count"] - 1e-9:
                    p.update(count=int(round(real_n)), cost=round(p["cost"] * real_n / p["count"], 2))
            elif not p.get("seen") and now - p["opened"] > 1800:
                acct["positions"].pop(ticker)            # it never landed: no bet
                continue
        elif p.get("est") and p.get("order"):
            got = order_fills(client, p["order"], p["side"])
            if got and got[0] >= 1:
                p.update(count=got[0], cost=got[1], price=got[1] / got[0], est=False)
            elif got and got[0] == 0 and real_n is None and now - p["opened"] > 1800:
                acct["positions"].pop(ticker)            # nothing ever filled: no bet
                continue
        if real_n is not None and real_n > p["count"] + 1e-9:
            over.append(ticker)                          # Kalshi holds more than it recorded: that stops it
        elif real_n is not None and real_n < p["count"] - 1e-9 and p.get("est"):
            share = real_n / p["count"]
            p.update(count=int(round(real_n)), cost=round(p["cost"] * share, 2))
    return over


def reality_gap(acct: dict, cfg: dict, settings: dict) -> tuple[float, float] | None:
    """(real average per bet, the practice account's average) over the real bets' time, or None if too few yet."""
    res = [r for r in acct["results"] if r["cost"] and r.get("won") is not None]
    if len(res) < int(cfg["check_after"]):
        return None
    real = sum(r["profit"] / r["cost"] for r in res) / len(res)
    try:
        big = json.loads(kb.STATE.read_text())
        name = kb.name(cfg["strategy"], kb.config(settings) or kb.DEFAULTS)
        prac = [r for r in (big.get(name) or {}).get("results", []) if r.get("t", 0) >= acct["started"] and r.get("cost")]
    except Exception:
        return None
    if len(prac) < 10:
        return None
    return real, sum(r["profit"] / r["cost"] for r in prac) / len(prac)


def real_step(settings: dict, views: list, strats: dict, cache: dict, now: float, tell, client=None, book_of=None,
              path: Path = STATE) -> str | None:
    """One check: settle, reconcile with Kalshi, apply the stops, then place real bets within the limits. None when
    it's off."""
    cfg = config(settings)
    if not cfg:
        return None
    if settings.get("mode") == "live":
        return "REAL Kalshi: not running, because the older 'mode: live' is on (they'd trade the same account)."
    client = client or k.Kalshi.from_env()
    if client is None:
        return "REAL Kalshi: no API key yet (KALSHI_KEY_ID and KALSHI_PRIVATE_KEY secrets)."
    book_of = book_of or kb.fetch_book
    state = json.loads(path.read_text()) if path.exists() else {}
    acct = state.setdefault("acct", {"pnl": 0.0, "positions": {}, "results": [], "started": now, "stopped": None,
                                     "day": None, "day_pnl": 0.0, "trades_today": 0, "bankroll": float(cfg["bankroll"])})
    try:
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        if acct["day"] != day:                           # a new day first, so today's settled losses count today
            acct.update(day=day, day_pnl=0.0, trades_today=0, day_stop_told=False)
        acct["bankroll"] = float(cfg["bankroll"])         # what kalshi.yaml says it may use, every check
        held_real = real_positions(client)
        settle_real(acct, cache, tell, now, held_real)
        over = reconcile(acct, held_real, client, now) if held_real is not None else []    # even while stopped
        have = money_now(acct)
        if acct["stopped"]:
            return f"REAL Kalshi: STOPPED ({acct['stopped_why']}); about {k.money(have)}."
        cash = real_cash(client)
        if cash is None or held_real is None:
            return "REAL Kalshi: couldn't read the real account; no new bets this check."
        closed = {t for t, at in (acct.get("closed") or {}).items() if now - at < 3 * 86400}
        acct["closed"] = {t: at for t, at in (acct.get("closed") or {}).items() if now - at < 3 * 86400}
        unknown = sorted(t for t in held_real if t not in acct["positions"] and t not in closed)
        if unknown or over:                              # Kalshi holds something it didn't place: stop, the owner checks
            acct.update(stopped=now, stopped_why="Kalshi shows bets it didn't record: " + ", ".join(unknown + over)[:120])
            tell("🛑 REAL Kalshi stopped: bets it didn't record", f"Kalshi shows {len(unknown) + len(over)} position(s) "
                 "the bot has no (or a smaller) record of. No new bets until Claude checks. Nothing was sold.")
            return "REAL Kalshi: stopped (unrecorded positions)."
        if have <= float(cfg["floor"]) + 1e-9 or (not acct["positions"]
                                                    and have - float(cfg["floor"]) < float(cfg["min_fill"])):
            acct.update(stopped=now, stopped_why="reached its floor")
            tell("🛑 REAL Kalshi stopped at its floor", f"It's about {k.money(have)} (floor {k.money(cfg['floor'])}). No new "
                 "bets; open ones still settle. Tell Claude when you've looked.")
            return f"REAL Kalshi: stopped at its floor; about {k.money(have)}."
        gap = reality_gap(acct, cfg, settings)
        if gap and gap[0] < gap[1] - float(cfg["max_gap"]):
            acct.update(stopped=now, stopped_why="real results fell well below practice")
            tell("🛑 REAL Kalshi stopped: real results fell below practice",
                 f"Real: {gap[0]:+.1%} a bet; its practice account over the same time: {gap[1]:+.1%}. No new bets.")
            return "REAL Kalshi: stopped (reality check)."
        if acct["day_pnl"] <= -float(cfg["max_day_loss"]):
            if not acct.get("day_stop_told"):
                acct["day_stop_told"] = True
                tell("⏸️ REAL Kalshi: daily stop", f"Down {k.money(-acct['day_pnl'])} today; no new bets until tomorrow.")
            return f"REAL Kalshi: daily stop; about {k.money(have)}."
        key = cfg["strategy"]
        rules = strats[key]["rules"]
        held = {p["event"] for p in acct["positions"].values()}
        bought = 0
        for i in k.ideas_from_views(views, rules):
            if acct["trades_today"] >= int(cfg["max_trades_per_day"]):
                break
            if i.get("kind") != "weather" or i["event"] in held:
                continue
            # the cushion, two ways: by its own record, and by the real cash on Kalshi
            room = min(have - at_risk(acct) - float(cfg["floor"]), cash - float(cfg["floor"]))
            budget = min(float(cfg["per_trade"]), room)
            if budget < float(cfg["min_fill"]):
                break
            try:
                asks = book_of(i["ticker"]).get(i["side"]) or []
            except Exception as e:
                log.warning("order book %s: %s", i["ticker"], e)
                continue
            lim = int(kb.limit_price(i, rules, float(cfg["max_slip"])) * 100 + 1e-9) / 100      # a whole cent, down
            levels = [(price, size) for price, size in asks if price <= lim + 1e-9]
            available = int(sum(size for _, size in levels))
            count = affordable(budget - 0.01 * len(levels), lim, available)   # at the limit price, fee margin kept
            worst = count * lim + k.fee(lim, count) if count else 0.0
            if count < 1 or worst < float(cfg["min_fill"]):
                continue
            if cfg["dry_run"]:                           # practice run on the real account: nothing is sent
                acct["trades_today"] += 1
                held.add(i["event"])
                bought += 1
                tell("🧪 REAL Kalshi (dry run, nothing sent): would buy",
                     f"{count} {i['side'].upper()} of {i['title']} at up to {lim * 100:.0f}¢ (at most {k.money(worst)}). "
                     f"Real cash {k.money(cash)}, floor {k.money(cfg['floor'])}.")
                continue
            # from here an order goes out: it counts at once as fully filled at its limit (the worst case)
            acct["trades_today"] += 1
            held.add(i["event"])
            cash -= worst
            order, coid = {}, f"real-{uuid.uuid4()}"
            try:
                order = place(client, i["ticker"], i["side"], count, lim, coid)
            except Exception as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                log.warning("REAL order %s failed (%s): %s", i["ticker"], code, e)
                if code is not None and 400 <= code < 500:      # Kalshi refused it: nothing was placed
                    tell("⚠️ REAL Kalshi: an order was refused", f"{i['title']}: {str(e)[:150]}")
                    cash += worst
                    continue
                # no clear answer (a timeout): it counts as placed, at its worst case, until Kalshi's positions say
            cancel(client, order.get("order_id"))
            got = order_fills(client, order["order_id"], i["side"]) if order.get("order_id") else None
            said = _num(order, "fill_count_fp", "fill_count", "taker_fill_count")
            if (got is None or got[0] < 1) and said == 0 and str(order.get("status", "")).startswith("cancel"):
                cash += worst                            # Kalshi's own reply: cancelled, nothing filled: no bet
                continue
            if got and got[0] >= 1:
                n, cost, est = got[0], got[1], False
            else:                                        # not confirmed yet: counts at its worst case till reconciled
                n, cost, est = count, round(worst, 2), True
            acct["positions"][i["ticker"]] = {"event": i["event"], "side": i["side"], "count": n, "price": cost / n,
                                              "cost": cost, "opened": now, "title": i["title"],
                                              "order": order.get("order_id"), "coid": coid, "est": est}
            cash += worst - cost
            bought += 1
            tell(f"💵 REAL Kalshi bought {n} {i['side'].upper()} for {k.money(cost)}" + (" (est.)" if est else ""),
                 f"{i['title']} (avg {cost / n * 100:.0f}¢). Pays {k.money(n)} if right. Account about "
                 f"{k.money(have)}, {k.money(at_risk(acct))} in open bets, floor {k.money(cfg['floor'])}.")
        return (f"REAL Kalshi ({key}{', dry run' if cfg['dry_run'] else ''}): about {k.money(have)} (real cash "
                f"{k.money(cash)}), {len(acct['positions'])} open ({k.money(at_risk(acct))}), "
                f"bought {bought}; {len(acct['results'])} settled, {acct['pnl']:+,.2f}.")
    finally:
        acct["results"] = acct["results"][-2000:]
        path.write_text(json.dumps(state, indent=1, default=str))


def status_rows(path: Path = STATE) -> list[str]:
    if not path.exists():
        return []
    a = json.loads(path.read_text()).get("acct") or {}
    return ([f"REAL Kalshi: {len(a.get('results', []))} settled, {a.get('pnl', 0):+,.2f}; open {len(a.get('positions', {}))}"
             + (f"; STOPPED ({a.get('stopped_why')})" if a.get("stopped") else "")]
            + ["REALRESULT " + json.dumps(r, default=str) for r in a.get("results", [])])
