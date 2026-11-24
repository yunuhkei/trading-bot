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
- at the floor it stops for good and pings the owner; a daily stop after `max_day_loss`; once `check_after` markets
  match its $1,000 practice account's, it stops if a real contract cost more than `max_price_gap` above practice's;
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
            "max_day_loss": 15.0, "max_trades_per_day": 5, "max_slip": 0.02, "min_fill": 3.0, "check_after": 10,
            "max_price_gap": 0.03, "off_days": 30, "off_min_bets": 15}
FINAL = ("finalized", "settled", "determined")
CONFIRM_AFTER = 300                                      # an order is confirmed from Kalshi's fills only after 5 minutes
DROP_AFTER = 1800                                        # ...and dropped as "nothing filled" only after 30 minutes
STUCK_AFTER = 7200                                       # unconfirmed for 2 hours: it stops and pings the owner


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


def market_fills(client, ticker: str, side: str, since: float) -> tuple[int, float] | None:
    """(contracts, cost with fees) it really bought on this market since `since`, from Kalshi's fills (it places one
    bet per market, so they're all that bet's, whatever happened to the order's reply); None if it can't tell."""
    try:
        fills = client.call("GET", "/portfolio/fills",
                            params={"ticker": ticker, "min_ts": int(since) - 60, "limit": 200}).get("fills") or []
    except Exception as e:
        log.warning("REAL fills %s: %s", ticker, e)
        return None
    count, cost = 0, 0.0
    for f in fills:
        # only its own kind of fill: a buy of `side` (the older fields action/side, or the newer outcome_side and
        # book_side, where buying YES takes the bid side of the YES book)
        if f.get("action") not in (None, "buy") or f.get("side") not in (None, side):
            continue
        if f.get("outcome_side") not in (None, side) or (side == "yes" and f.get("book_side") not in (None, "bid")):
            continue
        n = _num(f, "count_fp", "count")
        p = _num(f, f"{side}_price_dollars")
        if p is None:
            c = _num(f, f"{side}_price")
            p = c / 100 if c is not None else None
        if not n or p is None:
            return None                                  # a fill it can't read: keep the safe estimate
        n = int(round(n))
        paid_fee = _num(f, "fee_cost")
        count += n
        cost += n * p + (paid_fee if paid_fee is not None else k.fee(p, n))
    return count, round(cost, 2)


def place(client, ticker: str, side: str, count: int, price: float, coid: str) -> dict:
    """One limit buy of YES, immediate-or-cancel, tagged as this module's (`price` is already a whole cent: never
    more). Kalshi's current order API (POST /portfolio/events/orders; the old /portfolio/orders is gone): "bid" buys
    YES at up to `price`; nothing rests, whatever doesn't fill at once is cancelled."""
    if side != "yes":
        raise ValueError("it only buys YES")
    body = {"ticker": ticker, "client_order_id": coid, "side": "bid", "count": f"{int(count)}.00",
            "price": f"{price:.4f}", "time_in_force": "immediate_or_cancel", "self_trade_prevention_type": "taker_at_cross",
            "post_only": False, "reduce_only": False}
    j = client.call("POST", "/portfolio/events/orders", body) or {}
    return j.get("order", j) or {}


def cancel(client, order_id: str | None, ticker: str | None = None):
    if not order_id:
        return
    try:
        client.call("DELETE", f"/portfolio/events/orders/{order_id}", params={"market_ticker": ticker} if ticker else None)
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
        if m.get("status") not in FINAL or p.get("est"):
            continue                                     # (a bet not yet confirmed from Kalshi's fills never settles)
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


def reconcile(acct: dict, held_real: dict, client, now: float) -> tuple[list[str], list[str]]:
    """Confirm bets from Kalshi, once they're at least 5 minutes old: the real count and cost from its fills; or, if
    Kalshi's positions show the bet but its fills don't, the position's count at the worst-case price (so it still
    settles). A bet is dropped as "nothing filled" only after 30 minutes with no fill and no position, and never once
    it has been seen. Until confirmed a bet counts as fully filled at its limit. Returns (tickers where Kalshi holds
    MORE than it recorded, tickers stuck unconfirmed for 2 hours); either stops it."""
    over, stuck = [], []
    for ticker, p in list(acct["positions"].items()):
        real_n = held_real.get(ticker)
        if real_n:
            p["seen"] = True
        age = now - p["opened"]
        if p.get("est") and age >= CONFIRM_AFTER:
            got = market_fills(client, ticker, p["side"], p["opened"])
            if got is not None and got[0] >= 1:
                p.update(count=got[0], cost=got[1], price=got[1] / got[0], est=False)
            elif real_n and real_n <= p["count"] + 1e-9:     # Kalshi holds it, its fills don't show: the position counts
                per = p["cost"] / p["count"]
                p.update(count=int(round(real_n)), cost=round(per * real_n, 2), est=False, cost_est=True)
            elif got is not None and got[0] == 0 and not p.get("seen") and age >= DROP_AFTER:
                acct["positions"].pop(ticker)            # nothing ever filled, nothing ever held: no bet
                continue
            elif age >= STUCK_AFTER:
                stuck.append(ticker)
        if real_n is not None and real_n > p["count"] + 1e-9:
            over.append(ticker)                          # Kalshi holds more than it recorded: that stops it
    return over, stuck


def reality_gap(acct: dict, cfg: dict, settings: dict) -> tuple[float, int] | None:
    """Whether real money gets the prices practice gets: on the markets both bet on, how much more a contract cost for
    real than in the strategy's $1,000 practice account (fees included, both from real fills). Returns (that average
    gap in dollars, how many markets), or None until `check_after` markets match. Wins and losses aren't compared:
    with a few bets a day they're mostly luck, and on the same market they're the same anyway."""
    mine_by = {}
    for r in acct["results"]:
        if r.get("count") and not r.get("est") and not r.get("cost_est"):
            mine_by[r["ticker"]] = r["cost"] / r["count"]
    for t, q in acct["positions"].items():
        if q.get("count") and not q.get("est") and not q.get("cost_est"):
            mine_by[t] = q["cost"] / q["count"]
    try:
        big = json.loads(kb.STATE.read_text())
        name = kb.name(cfg["strategy"], kb.config(settings) or kb.DEFAULTS)
        a = big.get(name) or {}
        prac = {r["ticker"]: r["cost"] / r["count"] for r in a.get("results", []) if r.get("count") and r.get("ticker")}
        prac.update({t: q["cost"] / q["count"] for t, q in (a.get("positions") or {}).items() if q.get("count")})
    except Exception:
        return None
    both = [t for t in mine_by if t in prac]
    if len(both) < int(cfg["check_after"]):
        return None
    return sum(mine_by[t] - prac[t] for t in both) / len(both), len(both)


def strategy_recent(cfg: dict, settings: dict, now: float) -> tuple[float, int] | None:
    """(profit, settled bets) of the strategy's $1,000 practice account over the last `off_days` days, or None if its
    record can't be read."""
    try:
        big = json.loads(kb.STATE.read_text())
        name = kb.name(cfg["strategy"], kb.config(settings) or kb.DEFAULTS)
        rs = [r for r in (big.get(name) or {}).get("results", []) if now - float(r.get("t", 0)) <= float(cfg["off_days"]) * 86400]
    except Exception:
        return None
    return sum(r["profit"] for r in rs), len(rs)


def real_step(settings: dict, views: list, strats: dict, cache: dict, now: float, tell, client=None, book_of=None,
              path: Path = STATE) -> str | None:
    """One check: settle, reconcile with Kalshi, apply the stops, then place real bets within the limits. None when
    it's off."""
    wall = time.time()                                   # the check may take a while: an order's time is when it's sent
    cfg = config(settings)
    if not cfg:
        return None
    if settings.get("mode") == "live":
        return "REAL Kalshi: not running, because the older 'mode: live' is on (they'd trade the same account)."
    try:
        client = client or k.Kalshi.from_env()
    except Exception as e:                               # a key it can't read: say so once (never showing the key)
        why = str(e) if isinstance(e, ValueError) and "KALSHI_PRIVATE_KEY" in str(e) else type(e).__name__
        state = json.loads(path.read_text()) if path.exists() else {}
        if state.get("key_error_told") != why:
            state["key_error_told"] = why
            path.write_text(json.dumps(state, indent=1, default=str))
            tell("⚠️ REAL Kalshi can't read your private key", "The KALSHI_PRIVATE_KEY secret isn't a key it can "
                 "read, so it isn't betting. Paste the whole private key again (from -----BEGIN to -----END, those "
                 f"lines included) as the secret's new value. ({why})")
        return f"REAL Kalshi: can't read the private key ({why}); no bets."
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
        over, stuck = reconcile(acct, held_real, client, now) if held_real is not None else ([], [])   # even stopped
        settle_real(acct, cache, tell, now, held_real)
        have = money_now(acct)
        if acct["stopped"]:
            return f"REAL Kalshi: STOPPED ({acct['stopped_why']}); about {k.money(have)}."
        cash = real_cash(client)
        if cash is None or held_real is None:
            acct["fails"] = acct.get("fails", 0) + 1
            if acct["fails"] == 3:                       # half an hour of no answer: say so once (a wrong key, or Kalshi down)
                tell("⚠️ REAL Kalshi can't read your account", "For 30 minutes it couldn't read your Kalshi cash or "
                     "positions, so it isn't betting. If you just added the key, check the KALSHI_KEY_ID and "
                     "KALSHI_PRIVATE_KEY secrets. Otherwise Kalshi may be down; it keeps trying.")
            return "REAL Kalshi: couldn't read the real account; no new bets this check."
        acct["fails"] = 0
        if not acct.get("connected"):                    # the first good read: the key works
            acct["connected"] = now
            tell("✅ REAL Kalshi connected", f"Your key works. Kalshi cash: {k.money(cash)}. "
                 + ("DRY RUN: it only says what it would buy." if cfg["dry_run"] else "It's live: real bets, up to "
                    f"{k.money(cfg['per_trade'])} each, never below the {k.money(cfg['floor'])} cushion.")
                 + (f" Note: under the {k.money(cfg['bankroll'])} it's set for; it only bets what's there."
                    if cash < cfg["bankroll"] - 0.005 else ""))
        closed = {t for t, at in (acct.get("closed") or {}).items() if now - at < 3 * 86400}
        acct["closed"] = {t: at for t, at in (acct.get("closed") or {}).items() if now - at < 3 * 86400}
        unknown = sorted(t for t in held_real if t not in acct["positions"] and t not in closed)
        if stuck:
            acct.update(stopped=now, stopped_why="bets it couldn't confirm for 2 hours: " + ", ".join(stuck)[:120])
            tell("🛑 REAL Kalshi stopped: bets it can't confirm", f"{len(stuck)} bet(s) still can't be confirmed from "
                 "Kalshi's records after 2 hours. No new bets until Claude checks. Nothing was sold.")
            return "REAL Kalshi: stopped (unconfirmed bets)."
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
        short = have - (cash + at_risk(acct))            # it's set for more than Kalshi holds (a deposit on its way)
        if short > 1.0 and cash - float(cfg["floor"]) < float(cfg["min_fill"]):
            if not acct.get("short_told"):
                acct["short_told"] = True
                tell("⏳ REAL Kalshi is waiting for your deposit", f"It's set for about {k.money(have)}, but Kalshi holds "
                     f"{k.money(cash)} cash plus {k.money(at_risk(acct))} in open bets. No new bets until the money's there.")
            return f"REAL Kalshi: waiting for the deposit (Kalshi cash {k.money(cash)})."
        acct["short_told"] = False
        recent = strategy_recent(cfg, settings, now)     # the off switch: the strategy's own practice record, lately
        if recent and recent[1] >= int(cfg["off_min_bets"]) and recent[0] < 0:
            if not acct.get("off"):
                acct["off"] = now
                tell("⏸️ REAL Kalshi paused: its strategy is losing lately",
                     f"{cfg['strategy']}'s $1,000 practice account is down {k.money(-recent[0])} over its last {recent[1]} "
                     f"bets ({cfg['off_days']:.0f} days). No new real bets until it's back above zero; open bets still "
                     "settle. The edge may be fading.")
            return f"REAL Kalshi: paused, {cfg['strategy']} practice is down lately ({k.money(recent[0])} on {recent[1]})."
        if acct.get("off"):
            acct["off"] = None
            tell("▶️ REAL Kalshi back on", f"{cfg['strategy']}'s practice account is back above zero over the last "
                 f"{cfg['off_days']:.0f} days, so real bets start again.")
        gap = reality_gap(acct, cfg, settings)
        if gap and gap[0] > float(cfg["max_price_gap"]):
            acct.update(stopped=now, stopped_why="real bets cost more than practice")
            tell("🛑 REAL Kalshi stopped: real bets cost more than practice",
                 f"On the {gap[1]} markets both bet on, a real contract cost {gap[0] * 100:.1f}¢ more than in practice "
                 "(fees included), so practice's results wouldn't carry over. No new bets until Claude checks.")
            return "REAL Kalshi: stopped (reality check)."
        if acct["day_pnl"] <= -float(cfg["max_day_loss"]):
            if not acct.get("day_stop_told"):
                acct["day_stop_told"] = True
                tell("⏸️ REAL Kalshi: daily stop", f"Down {k.money(-acct['day_pnl'])} today; no new bets until tomorrow.")
            return f"REAL Kalshi: daily stop; about {k.money(have)}."
        key = cfg["strategy"]
        rules = strats[key]["rules"]
        # a dry run keeps its pretend bets for 36 hours (they've settled by then) so it plans like the real one would:
        # inside the same cushion, and never the same city-day twice; going live drops them
        dry = {t: d for t, d in (acct.get("dry") or {}).items() if cfg["dry_run"] and now - d["opened"] < 36 * 3600}
        acct["dry"] = dry
        held = {p["event"] for p in acct["positions"].values()} | {d["event"] for d in dry.values()}
        bought = 0
        for i in k.ideas_from_views(views, rules, now):
            if acct["trades_today"] >= int(cfg["max_trades_per_day"]):
                break
            if i.get("kind") != "weather" or i["event"] in held or i.get("side") != "yes":
                continue
            # the cushion, two ways: by its own record, and by the real cash on Kalshi
            pretend = sum(d["cost"] for d in dry.values())
            room = min(have - at_risk(acct) - pretend - float(cfg["floor"]), cash - pretend - float(cfg["floor"]))
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
            # fees round up per fill, and in the worst case every contract is its own fill: a cent each is kept for it
            count = affordable(budget, lim + 0.01, available)
            worst = count * (lim + 0.01) + k.fee(lim, count) if count else 0.0
            if count < 1 or worst < float(cfg["min_fill"]):
                continue
            if cfg["dry_run"]:                           # practice run on the real account: nothing is sent
                acct["trades_today"] += 1
                held.add(i["event"])
                dry[i["ticker"]] = {"event": i["event"], "cost": round(worst, 2), "opened": now}
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
                    cash += worst
                    acct["trades_today"] -= 1
                    acct["refused"] = acct.get("refused", 0) + 1
                    if acct["refused"] >= 3:                 # refused again and again: something's wrong, stop
                        acct.update(stopped=now, stopped_why=f"Kalshi refused 3 orders in a row ({code})")
                        tell("🛑 REAL Kalshi stopped: orders keep getting refused", f"Kalshi refused 3 orders in a "
                             f"row (last: {i['title']}: {str(e)[:120]}). Nothing was bought. No new bets until Claude "
                             "checks.")
                        break
                    tell("⚠️ REAL Kalshi: an order was refused", f"{i['title']}: {str(e)[:150]}. Nothing was bought.")
                    continue
                # no clear answer (a timeout): it counts as placed, at its worst case, until Kalshi's positions say
            acct["refused"] = 0
            cancel(client, order.get("order_id"), i["ticker"])
            # counted as fully filled at its limit (the worst case) until it's confirmed from Kalshi's fills, at least
            # 5 minutes from now: nothing goes back into this check's budget, whatever a quick read would say
            n, cost = count, round(worst, 2)
            acct["positions"][i["ticker"]] = {"event": i["event"], "side": i["side"], "count": n, "price": cost / n,
                                              "cost": cost, "opened": now + (time.time() - wall), "title": i["title"],
                                              "order": order.get("order_id"), "coid": coid, "est": True}
            bought += 1
            tell(f"💵 REAL Kalshi bought up to {n} {i['side'].upper()} for at most {k.money(cost)}",
                 f"{i['title']} (at most {lim * 100:.0f}¢ each; the real fill is confirmed in 5 minutes). Pays up to "
                 f"{k.money(n)} if right. Account about "
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
