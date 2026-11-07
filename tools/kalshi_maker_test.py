# Run from the repo root after the collector: PYTHONPATH=. python tools/kalshi_maker_test.py
"""Maker-bid test on Kalshi daily-high markets, the day before (the report's strategy #1), on real trade prints.

Each hour from market open until the measurement day starts: for each bracket, the favorite side (YES if its bid is
50c+, else NO) and that side's best bid. A resting buy at the best bid counts as FILLED only if, during the next hour,
someone trades that side BELOW our price (so the queue at our price was used up), and it fills at our price. Then it's
held to settlement. One position per event per variant; $5 each; maker fee 0 (and a second run with Kalshi's maker fee
0.0175*C*P*(1-P), in case these series charge it). The taker baseline buys the same first qualifying side at the ASK
with the taker fee. Every variant tried is printed.
"""
import json, math, sys
from collections import defaultdict

from bot import kalshi as k

rows = {r["event"]["event_ticker"]: r for r in json.load(open("data/kalshi_backtest_rows.json"))}
paths = json.load(open("data/kalshi_paths.json"))
tr = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "data/maker_trades.json"))
by_event = defaultdict(dict)
for key, v in tr.items():
    e, t = key.split("|")
    by_event[e][t] = v

maker_fee = lambda p, c: math.ceil(0.0175 * c * p * (1 - p) * 100 - 1e-9) / 100


def run(side_rule, lo, hi, fee_maker=False, taker=False):
    out = []
    for e, mk in by_event.items():
        r, p = rows.get(e), paths.get(e)
        if not r or not p:
            continue
        result = {m["ticker"]: m["result"] for m in r["event"]["markets"]}
        any_v = next(iter(mk.values()))
        t_open, t_cancel = any_v["open"], any_v["cancel"]
        hours = sorted({ts for t in mk for ts, _, _ in (p.get(t) or []) if ts and t_open <= ts < t_cancel})
        done = None
        for i, h in enumerate(hours):
            nxt = hours[i + 1] if i + 1 < len(hours) else t_cancel
            cands = []
            for t, v in mk.items():
                q = [(ts, a, b) for ts, a, b in (p.get(t) or []) if ts and ts <= h]
                if not q or q[-1][0] < h - 3600:
                    continue
                _, ask, bid = q[-1]
                if not (0 < ask < 1) or ask - bid > 0.20:
                    continue
                fav_yes = bid >= 0.5
                side = "yes" if fav_yes else "no"
                sbid, sask = (bid, ask) if fav_yes else (round(1 - ask, 4), round(1 - bid, 4))
                if side_rule == "yes" and side != "yes":
                    continue
                if side_rule == "no" and side != "no":
                    continue
                if lo <= sbid <= hi:
                    cands.append((t, side, sbid, sask))
            if not cands:
                continue
            if taker:                      # baseline: pay the ask now, first qualifying hour
                t, side, sbid, sask = max(cands, key=lambda c: c[2])
                c = int(5 // (sask + k.fee(sask)))
                if c >= 1:
                    done = (h, t, side, sask, c, c * sask + k.fee(sask, c))
                break
            fills = []
            for t, side, sbid, sask in cands:
                for ts, yp, cnt, _ in mk[t]["trades"]:
                    if h < ts <= nxt and ((side == "yes" and yp < sbid) or (side == "no" and (1 - yp) < sbid)):
                        fills.append((ts, t, side, sbid)); break
            if fills:
                ts, t, side, price = min(fills)
                c = int(5 // price)
                if c >= 1:
                    done = (ts, t, side, price, c, c * price + (maker_fee(price, c) if fee_maker else 0.0))
                break
        if done:
            ts, t, side, price, c, cost = done
            won = result.get(t) == side
            out.append({"day": r["day"], "price": price, "won": won, "cost": cost, "back": c if won else 0.0, "side": side})
    return out


def show(name, xs):
    if not xs:
        print(f"  {name}: no trades"); return
    days = sorted({x["day"] for x in xs}); half = days[len(days) // 2]
    prof = lambda s: sum(x["back"] - x["cost"] for x in s)
    stake = sum(x["cost"] for x in xs)
    a, b = [x for x in xs if x["day"] < half], [x for x in xs if x["day"] >= half]
    avgp = sum(x["price"] for x in xs) / len(xs)
    print(f"  {name}: {len(xs)} trades, won {sum(x['won'] for x in xs) / len(xs):.0%} at avg {avgp * 100:.0f}c, "
          f"{prof(xs):+.2f} ({prof(xs) / stake:+.1%}); halves {prof(a):+.2f} ({len(a)}) / {prof(b):+.2f} ({len(b)})")


print(f"{len(by_event)} events with trade prints, {min(r['day'] for e, r in rows.items() if e in by_event)} to "
      f"{max(r['day'] for e, r in rows.items() if e in by_event)}")
for side_rule, label in (("yes", "favorite bracket YES"), ("no", "NO on long-shot brackets"), ("any", "either favorite side")):
    for lo, hi in ((0.60, 0.95), (0.60, 0.80)):
        print(f"{label}, {lo * 100:.0f}-{hi * 100:.0f}c:")
        show("maker (no maker fee)", run(side_rule, lo, hi))
        show("maker (with maker fee)", run(side_rule, lo, hi, fee_maker=True))
        show("taker at the ask, same rule", run(side_rule, lo, hi, taker=True))
