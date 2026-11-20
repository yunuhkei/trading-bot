"""REAL MONEY on Kalshi, small and fenced in (kalshi.yaml `real:`). OFF unless `enabled: true` AND the KALSHI_KEY_ID /
KALSHI_PRIVATE_KEY secrets exist. Every practice account (the $100 ones, the $1,000 ones) keeps running untouched.

It trades ONE strategy (G by default, the same ideas as its practice accounts), with:
- `per_trade` dollars a bet (fees included), filled against Kalshi's real order book with a limit price (the best ask +
  `max_slip`, never past the strategy's own limits): it never pays more than that; whatever doesn't fill is cancelled;
- the cushion: it never has more at risk than `bankroll + profit so far - floor`. If every open bet lost at once, the
  account would end at the floor, not below it. At the floor it stops for good and pings the owner;
- a daily stop: down `max_day_loss` today means no new bets until tomorrow;
- a reality check: after `check_after` settled real bets, if real results run more than `max_gap` a bet below the
  same strategy's $1,000 practice account over the same time, it stops and pings the owner;
- at most `max_trades_per_day` bets a day and one bet per city per day.
Real winnings are paid out by Kalshi itself; this file only keeps the record and the limits (kalshi_state_real.json).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from . import kalshi as k
from . import kalshi_big as kb

log = logging.getLogger("kalshi_real")
STATE = Path("kalshi_state_real.json")
DEFAULTS = {"enabled": False, "strategy": "G", "bankroll": 100.0, "per_trade": 10.0, "floor": 70.0, "max_day_loss": 15.0,
            "max_trades_per_day": 5, "max_slip": 0.02, "min_fill": 3.0, "check_after": 20, "max_gap": 0.10}


def config(settings: dict) -> dict | None:
    c = settings.get("real") or {}
    return {**DEFAULTS, **c} if c.get("enabled") else None


def money_now(acct: dict, cfg: dict) -> float:
    return float(cfg["bankroll"]) + acct["pnl"]


def at_risk(acct: dict) -> float:
    return sum(p["cost"] for p in acct["positions"].values())


def settle_real(acct: dict, cache: dict, tell, now: float):
    for ticker in list(acct["positions"]):
        p = acct["positions"][ticker]
        if ticker not in cache:
            try:
                cache[ticker] = k.kget(f"/markets/{ticker}").get("market", {})
            except Exception as e:
                log.warning("market %s: %s", ticker, e)
                continue
        m = cache[ticker]
        if m.get("result") in ("yes", "no") and m.get("status") in ("finalized", "settled", "determined"):
            won = m["result"] == p["side"]
            profit = (p["count"] if won else 0.0) - p["cost"]
            acct["pnl"] += profit
            acct["day_pnl"] += profit
            acct["positions"].pop(ticker)
            acct["results"].append({"t": now, "ticker": ticker, "title": p["title"], "won": won, "profit": round(profit, 2),
                                    "cost": p["cost"], "count": p["count"], "price": p["price"], "opened": p["opened"]})
            tell(f"{'✅' if won else '❌'} REAL Kalshi {'WON' if won else 'LOST'}: {profit:+,.2f}",
                 f"{p['title']} ({p['count']} {p['side'].upper()} at {p['price'] * 100:.0f}¢). Real account "
                 f"about {k.money(acct['bankroll'] + acct['pnl'])}.")


def reality_gap(acct: dict, cfg: dict, settings: dict) -> tuple[float, float] | None:
    """(real average per bet, the practice account's average) over the real bets' time, or None if too few yet."""
    res = acct["results"]
    if len(res) < int(cfg["check_after"]):
        return None
    real = sum(r["profit"] / r["cost"] for r in res if r["cost"]) / len(res)
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
    """One check: settle, apply the stops, then place real bets within the limits. None when it's off."""
    cfg = config(settings)
    if not cfg:
        return None
    client = client or k.Kalshi.from_env()
    if client is None:
        return "REAL Kalshi: no API key yet (KALSHI_KEY_ID and KALSHI_PRIVATE_KEY secrets)."
    book_of = book_of or kb.fetch_book
    state = json.loads(path.read_text()) if path.exists() else {}
    acct = state.setdefault("acct", {"pnl": 0.0, "positions": {}, "results": [], "started": now, "stopped": None,
                                     "day": None, "day_pnl": 0.0, "trades_today": 0, "bankroll": float(cfg["bankroll"])})
    try:
        settle_real(acct, cache, tell, now)
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        if acct["day"] != day:
            acct.update(day=day, day_pnl=0.0, trades_today=0, day_stop_told=False)
        have = money_now(acct, cfg)
        if acct["stopped"]:
            return f"REAL Kalshi: STOPPED ({acct['stopped_why']}); about {k.money(have)}."
        if have <= float(cfg["floor"]) + 1e-9 or (not acct["positions"] and have - float(cfg["floor"]) < float(cfg["min_fill"])):
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
            room = have - at_risk(acct) - float(cfg["floor"])        # the cushion: never more at risk than this
            budget = min(float(cfg["per_trade"]), room)
            if budget < float(cfg["min_fill"]):
                break
            try:
                asks = book_of(i["ticker"]).get(i["side"]) or []
            except Exception as e:
                log.warning("order book %s: %s", i["ticker"], e)
                continue
            lim = kb.limit_price(i, rules, float(cfg["max_slip"]))
            plan = kb.walk(asks, budget, lim)
            if plan["count"] < 1 or plan["cost"] < float(cfg["min_fill"]):
                continue
            try:
                order = client.buy(i["ticker"], i["side"], plan["count"], lim)        # a limit: never pays more than lim
            except Exception as e:
                log.warning("REAL order %s failed: %s", i["ticker"], e)
                continue
            finally:
                try:
                    client.cancel_resting()                                         # whatever didn't fill: cancelled
                except Exception as e:
                    log.warning("cancel failed: %s", e)
            filled = int(order.get("fill_count") or order.get("taker_fill_count") or order.get("filled_count") or 0)
            if filled < 1:
                continue
            paid = order.get("taker_fill_cost")                              # cents, when Kalshi reports it
            fees = order.get("taker_fees")
            cost = ((paid + (fees or 0)) / 100) if isinstance(paid, (int, float)) and paid > 0 else (
                plan["avg"] * filled if plan["count"] else lim * filled + k.fee(lim, filled))
            acct["positions"][i["ticker"]] = {"event": i["event"], "side": i["side"], "count": filled, "price": cost / filled,
                                              "cost": round(cost, 2), "opened": now, "title": i["title"],
                                              "order": order.get("order_id")}
            acct["trades_today"] += 1
            held.add(i["event"])
            bought += 1
            tell(f"💵 REAL Kalshi bought {filled} {i['side'].upper()} for {k.money(cost)}",
                 f"{i['title']} (avg {cost / filled * 100:.0f}¢). Pays {k.money(filled)} if right. Account about "
                 f"{k.money(have)}, {k.money(at_risk(acct))} in open bets, floor {k.money(cfg['floor'])}.")
        return (f"REAL Kalshi ({key}): about {k.money(have)}, {len(acct['positions'])} open ({k.money(at_risk(acct))}), "
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
