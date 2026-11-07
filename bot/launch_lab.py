"""Launch lab: a PRACTICE bot (pretend money only) that watches every pump.fun coin live, builds second-by-second
charts, and runs many short-term strategies side by side, each with its own pretend $1,000 and $250 trades.

Data: Solana's free public websocket (logsSubscribe on the pump.fun program), no key needed, so it never touches the
Helius allowance the real-money copy bot relies on. Every trade's event carries the coin, SOL and token amounts, buy
or sell, the wallet, and the bonding curve's reserves, so prices are exact.

Honest fills (the point of the lab is to find out whether being fast actually pays):
- Latency: a buy or sell lands at the first trade the bot SEES at least `latency` seconds after the signal (default
  1.5 s to buy, 1.0 s to sell), at the curve's reserves after that trade. Events themselves arrive about a second late.
- Price impact: bought and sold on the bonding curve's own math (x*y=k on the virtual reserves).
- Costs: the fee in each trade's event (~1%), plus 0.001 SOL a transaction for priority fees.
- Graduation: when a coin's curve completes (it moves to PumpSwap), open positions are sold at the last curve price.
Strategies (see STRATEGIES): sniping new coins, first-minute momentum, volume spikes, second-chart dip bounces,
breakouts, graduation runs, following whales, and a random baseline (to show what luck alone does).
Run: python -m bot launch-lab --minutes 340 (the launch-lab workflow runs it around the clock); --status prints the board.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import random
import struct
import time
from collections import deque
from pathlib import Path

log = logging.getLogger("launch_lab")
PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
WS = "wss://api.mainnet-beta.solana.com"
STATE = Path("launch_lab_state.json")
DISC = {hashlib.sha256(f"event:{n}".encode()).digest()[:8]: n for n in ("TradeEvent", "CreateEvent", "CompleteEvent")}
GRADUATE_SOL = 84.9            # real SOL in the curve when it completes
TX_COST_SOL = 0.001
CASH, PER_TRADE, MAX_OPEN = 1000.0, 250.0, 4
TZ = "America/Chicago"         # Milwaukee time, the same four slots as the copy bot's playbook
SLOTS = (("midday", "midday 11a-5p", 11, 17), ("evening", "evening 5-11p", 17, 23),
         ("overnight", "overnight 11p-5a", 23, 5), ("morning", "morning 5-11a", 5, 11))


def local_time(t: float):
    import datetime
    from zoneinfo import ZoneInfo

    return datetime.datetime.fromtimestamp(t, ZoneInfo(TZ))


def local_hour(t: float) -> int:
    return local_time(t).hour


# the owner's hunch: coins jump from about 11 am to 3:40 pm (Milwaukee time), then die. Counted from Nov 8.
WINDOW, WINDOW_LABEL = (11 * 60, 15 * 60 + 40), "11a-3:40p"


def in_window(t: float) -> bool:
    lt = local_time(t)
    return WINDOW[0] <= lt.hour * 60 + lt.minute < WINDOW[1]


def slot_hours(s: int, e: int) -> list[int]:
    return list(range(s, e)) if s < e else list(range(s, 24)) + list(range(0, e))

STRATEGIES = {
    "snipe": {"label": "Snipe every new coin", "tp": 1.0, "sl": 0.35, "max_s": 90},
    "snipe_quick": {"label": "Snipe, quick flip", "tp": 0.25, "sl": 0.15, "max_s": 20},
    "momentum_60s": {"label": "First-minute momentum", "tp": 0.6, "sl": 0.25, "max_s": 300},
    "volume_spike": {"label": "Volume spike", "tp": 0.4, "sl": 0.2, "max_s": 180, "spike": 4},
    # versions of the volume spike with other settings: if they ALL make money, the edge is real, not one lucky setting
    "volume_spike_3": {"label": "Volume spike, 3 SOL trigger", "tp": 0.4, "sl": 0.2, "max_s": 180, "spike": 3},
    "volume_spike_5": {"label": "Volume spike, 5 SOL trigger", "tp": 0.4, "sl": 0.2, "max_s": 180, "spike": 5},
    "volume_spike_tp30": {"label": "Volume spike, quick (+30%/-15%)", "tp": 0.3, "sl": 0.15, "max_s": 120, "spike": 4},
    "volume_spike_tp60": {"label": "Volume spike, let it run (+60%/-25%)", "tp": 0.6, "sl": 0.25, "max_s": 300,
                          "spike": 4},
    "dip_bounce": {"label": "Second-chart dip bounce", "sl": 0.15, "max_s": 120, "exit": "vwap"},
    "breakout": {"label": "Breakout to new highs", "trail": 0.2, "max_s": 600},
    "graduation_run": {"label": "Graduation run (70% full curve)", "sl": 0.2, "max_s": 900},
    "whale_follow": {"label": "Follow a 5+ SOL buy", "tp": 0.5, "sl": 0.25, "max_s": 180},
    "random": {"label": "Random coins (luck baseline)", "tp": 0.5, "sl": 0.25, "max_s": 180},
}


# ---- decoding pump.fun events ----

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(b: bytes) -> str:
    n, s = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        s = _B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def decode(line: str) -> dict | None:
    """A 'Program data: ...' log line -> {"kind": "trade"|"create"|"complete", ...}, or None."""
    try:
        raw = base64.b64decode(line[14:])
    except Exception:
        return None
    kind = DISC.get(raw[:8])
    try:
        if kind == "TradeEvent" and len(raw) >= 129:
            sol, tok = struct.unpack_from("<QQ", raw, 40)
            ts, vs, vt, rs, _ = struct.unpack_from("<qQQQQ", raw, 89)
            fee_bps = 100
            if len(raw) >= 169:                           # fee_basis_points, then creator_fee_basis_points
                fee_bps = struct.unpack_from("<Q", raw, 161)[0]
                if len(raw) >= 217:
                    fee_bps += struct.unpack_from("<Q", raw, 209)[0]
            return {"kind": "trade", "mint": b58(raw[8:40]), "sol": sol / 1e9, "tokens": tok / 1e6, "buy": bool(raw[56]),
                    "user": b58(raw[57:89]), "ts": ts, "vsol": vs / 1e9, "vtok": vt / 1e6, "real_sol": rs / 1e9,
                    "fee": min(max(fee_bps, 0), 500) / 1e4}
        if kind == "CreateEvent":
            o, out = 8, []
            for _ in range(3):
                n = struct.unpack_from("<I", raw, o)[0]
                out.append(raw[o + 4:o + 4 + n].decode("utf-8", "replace"))
                o += 4 + n
            return {"kind": "create", "name": out[0], "symbol": out[1], "mint": b58(raw[o:o + 32])}
        if kind == "CompleteEvent":
            return {"kind": "complete", "mint": b58(raw[40:72]) if len(raw) >= 72 else ""}
    except struct.error:
        return None
    return None


# ---- the bonding curve ----

def buy_tokens(vsol: float, vtok: float, sol_in: float, fee: float) -> float:
    net = sol_in * (1 - fee)
    return vtok - vsol * vtok / (vsol + net)


def sell_sol(vsol: float, vtok: float, tokens: float, fee: float) -> float:
    return (vsol - vsol * vtok / (vtok + tokens)) * (1 - fee)


# ---- coins and their second charts ----

class Coin:
    def __init__(self, mint: str, now: float, t: dict):
        self.mint, self.first_seen, self.name = mint, now, ""
        self.trades: deque = deque(maxlen=1500)      # (recv time, price, sol, buy, user)
        self.buyers: set = set()
        self.n_buys = self.n_sells = 0
        self.birth_price = None
        self.fresh = t["real_sol"] - (t["sol"] if t["buy"] else 0) < 1.0      # first seen at (or right after) launch
        self.flags: set = set()
        self.done = False
        self.first_real_sol = t["real_sol"]
        self.add(now, t)

    def add(self, now: float, t: dict):
        self.vsol, self.vtok, self.real_sol, self.fee, self.last = t["vsol"], t["vtok"], t["real_sol"], t["fee"], now
        p = self.price
        if self.birth_price is None:
            self.birth_price = p
        self.trades.append((now, p, t["sol"], t["buy"], t["user"]))
        if t["buy"]:
            self.n_buys += 1
            if len(self.buyers) < 500:
                self.buyers.add(t["user"])
        else:
            self.n_sells += 1

    @property
    def price(self) -> float:
        return self.vsol / self.vtok if self.vtok > 0 else 0.0

    def age(self, now: float) -> float:
        return now - self.first_seen

    def window(self, now: float, a: float, b: float = 0.0) -> list:
        """Trades received between `a` and `b` seconds ago."""
        return [x for x in self.trades if now - a <= x[0] <= now - b]

    def candles(self, now: float, seconds: int = 120) -> list[tuple]:
        """1-second candles (start, open, high, low, close, buy SOL, sell SOL) for the last `seconds`."""
        out: dict[int, list] = {}
        for t, p, sol, buy, _ in self.window(now, seconds):
            k = int(t)
            c = out.setdefault(k, [k, p, p, p, p, 0.0, 0.0])
            c[2], c[3], c[4] = max(c[2], p), min(c[3], p), p
            c[5 if buy else 6] += sol
        return [tuple(v) for _, v in sorted(out.items())]


# ---- practice accounts ----

class Account:
    def __init__(self, key: str, d: dict | None = None):
        d = d or {}
        self.key, self.cash = key, float(d.get("cash", CASH))
        self.start = float(d.get("start", CASH))
        self.positions: dict = {}                       # open bets are sold when a run ends (see to_state)
        self.trades: list = d.get("trades", [])[-300:]
        self.n, self.wins, self.pnl = int(d.get("n", 0)), int(d.get("wins", 0)), float(d.get("pnl", 0.0))
        self.best, self.worst = float(d.get("best", 0.0)), float(d.get("worst", 0.0))
        self.pending: dict = {}
        # every trade by the hour it was bought (Milwaukee time): [trades, wins, profit]; not cut off like `trades`
        self.by_hour = [list(b) for b in d["by_hour"]] if d.get("by_hour") else self._rebuild_hours()
        # inside the owner's window vs the rest of the day; starts empty (only trades from Nov 8 on)
        self.window = {k: list(v) for k, v in (d.get("window") or {"in": [0, 0, 0.0], "out": [0, 0, 0.0]}).items()}

    def _rebuild_hours(self) -> list:
        """For a saved account from before the tally: count the trades it kept; any older ones it no longer has
        happened before the oldest kept trade, so they go in that trade's hour."""
        hours = [[0, 0, 0.0] for _ in range(24)]
        for tr in self.trades:
            self.tally(tr["t"], tr["profit"], hours)
        left = self.n - len(self.trades)
        if left > 0 and self.trades:
            b = hours[local_hour(self.trades[0]["t"])]
            b[0] += left
            b[1] += max(0, self.wins - sum(tr["profit"] > 0 for tr in self.trades))
            b[2] += self.pnl - sum(tr["profit"] for tr in self.trades)
        return hours

    def tally(self, t: float, profit: float, hours: list | None = None):
        bs = [(self.by_hour if hours is None else hours)[local_hour(t)]]
        if hours is None:
            bs.append(self.window["in" if in_window(t) else "out"])
        for b in bs:
            b[0] += 1
            b[1] += profit > 0
            b[2] += profit

    def slot(self, s: int, e: int) -> tuple[int, int, float]:
        bs = [self.by_hour[h] for h in slot_hours(s, e)]
        return sum(b[0] for b in bs), sum(b[1] for b in bs), sum(b[2] for b in bs)

    def to_dict(self) -> dict:
        return {"cash": self.cash, "start": self.start, "trades": self.trades[-300:], "n": self.n, "wins": self.wins,
                "pnl": self.pnl, "best": self.best, "worst": self.worst,
                "by_hour": [[b[0], b[1], round(b[2], 2)] for b in self.by_hour],
                "window": {k: [b[0], b[1], round(b[2], 2)] for k, b in self.window.items()}}

    def can_buy(self, mint: str) -> bool:
        return (len(self.positions) + len(self.pending) < MAX_OPEN and self.cash >= PER_TRADE
                and mint not in self.positions and mint not in self.pending)


class Lab:
    def __init__(self, sol_usd: float = 150.0, latency_buy: float = 1.5, latency_sell: float = 1.0, seed: int = 0,
                 state: dict | None = None, tell=None):
        state = state or {}
        self.coins: dict[str, Coin] = {}
        self.names: dict[str, str] = {}
        self.sol_usd, self.lb, self.ls = sol_usd, latency_buy, latency_sell
        self.accts = {k: Account(k, (state.get("accounts") or {}).get(k)) for k in STRATEGIES}
        self.rng = random.Random(seed)
        self.random_plan: dict[str, float] = {}
        self.events = int(state.get("events", 0))
        # how busy pump.fun is by the hour (Milwaukee time): [seconds watched, trades, new coins, SOL bought]
        self.activity = ([list(b) for b in state["activity"]] if state.get("activity")
                         else [[0.0, 0, 0, 0.0] for _ in range(24)])
        self._clock, self._last_seen = (None, 0), None
        self.hello_done = bool(state.get("hello")) or self.events > 0       # a lab that already ran said hello
        self.tell = tell or (lambda t, m: None)

    # orders: signal now, filled at the first trade seen `latency` seconds later
    def order(self, key: str, mint: str, now: float, side: str, why: str = ""):
        a = self.accts[key]
        if side == "buy":
            if not a.can_buy(mint):
                return
            a.pending[mint] = {"side": "buy", "at": now + self.lb, "why": why, "signal": now}
            a.cash -= PER_TRADE                                         # reserved
        elif mint in a.positions and not a.positions[mint].get("selling"):
            a.positions[mint]["selling"] = {"at": now + self.ls, "why": why}

    def fill(self, now: float, coin: Coin, stale: bool = False):
        """Fill every order on this coin whose time has come, at the coin's current reserves."""
        for a in self.accts.values():
            o = a.pending.get(coin.mint)
            if o and now >= o["at"]:
                a.pending.pop(coin.mint)
                if coin.done:
                    a.cash += PER_TRADE
                    continue
                sol_in = PER_TRADE / self.sol_usd - TX_COST_SOL
                tok = buy_tokens(coin.vsol, coin.vtok, sol_in, coin.fee)
                a.positions[coin.mint] = {"tokens": tok, "net": sol_in * (1 - coin.fee), "cost": PER_TRADE, "t": now,
                                          "entry": coin.price,
                                          "peak": coin.price, "why": o["why"], "lag": round(now - o["signal"], 2),
                                          "name": self.names.get(coin.mint, coin.mint[:6])}
            p = a.positions.get(coin.mint)
            if p and p.get("selling") and (now >= p["selling"]["at"] or stale):
                self.close(a, coin, now, p["selling"]["why"])

    def close(self, a: Account, coin: Coin, now: float, why: str):
        p = a.positions.pop(coin.mint)
        # the curve as it would really be: everyone else's trades, plus our own buy still sitting in it
        vsol, vtok = coin.vsol + p.get("net", 0.0), max(coin.vtok - p["tokens"], 1e-9)
        sol = max(0.0, sell_sol(vsol, vtok, p["tokens"], coin.fee) - TX_COST_SOL)
        back = sol * self.sol_usd
        profit = back - p["cost"]
        a.cash += back
        a.n += 1
        a.wins += profit > 0
        a.pnl += profit
        a.best, a.worst = max(a.best, profit), min(a.worst, profit)
        a.tally(p["t"], profit)
        a.trades.append({"t": round(p["t"]), "s": round(now - p["t"], 1), "name": p["name"], "mint": coin.mint,
                         "profit": round(profit, 2), "why_in": p["why"], "why_out": why, "lag": p["lag"]})

    # strategies, checked on every trade of a coin
    def on_trade(self, now: float, coin: Coin, t: dict):
        age, px = coin.age(now), coin.price
        if coin.fresh and coin.n_buys + coin.n_sells == 1:
            self.order("snipe", coin.mint, now, "buy", "new coin")
            self.order("snipe_quick", coin.mint, now, "buy", "new coin")
            if self.rng.random() < 0.05:
                self.random_plan[coin.mint] = now + self.rng.uniform(5, 600)
        if coin.fresh and 60 <= age <= 75 and "m60" not in coin.flags:
            coin.flags.add("m60")
            sells, buys = coin.n_sells, coin.n_buys
            if coin.birth_price and buys >= 15 and len(coin.buyers) >= 10 and px >= 1.5 * coin.birth_price and sells <= 0.6 * buys:
                self.order("momentum_60s", coin.mint, now, "buy", f"{buys} buys, {len(coin.buyers)} buyers, x{px / coin.birth_price:.1f}")
        if age <= 1800:
            last10 = sum(x[2] for x in coin.window(now, 10) if x[3])
            prev = sum(x[2] for x in coin.window(now, 70, 10) if x[3]) / 6
            for key, rules in STRATEGIES.items():
                need = rules.get("spike")
                if need and last10 >= need and last10 >= 3 * max(prev, 0.3) and \
                        now - coin.__dict__.get(f"vs_{key}", 0) > 120:
                    setattr(coin, f"vs_{key}", now)
                    self.order(key, coin.mint, now, "buy", f"{last10:.1f} SOL bought in 10 s")
        if 120 <= age <= 3600 and len(coin.trades) >= 60 and coin.real_sol >= 10:
            w = coin.window(now, 30)
            hi = max((x[1] for x in w), default=px)
            fell = [x for x in w if now - x[0] <= 20]
            if hi and px <= 0.75 * hi and fell and max(x[1] for x in fell) >= 0.95 * hi and now - coin.__dict__.get("db_t", 0) > 120:
                coin.db_t = now
                self.order("dip_bounce", coin.mint, now, "buy", f"down {1 - px / hi:.0%} in 20 s")
        if 180 <= age <= 3600:
            prior = [x[1] for x in coin.window(now, 190, 10)]
            vol = sum(x[2] for x in coin.window(now, 10) if x[3])
            if len(prior) >= 20 and px > 1.10 * max(prior) and vol >= 2 and now - coin.__dict__.get("bo_t", 0) > 300:
                coin.bo_t = now
                self.order("breakout", coin.mint, now, "buy", "new 3-min high")
        if coin.real_sol >= 0.7 * GRADUATE_SOL and "grad" not in coin.flags and coin.first_real_sol < 0.6 * GRADUATE_SOL:
            coin.flags.add("grad")
            self.order("graduation_run", coin.mint, now, "buy", f"{coin.real_sol:.0f} SOL in the curve")
        if t["buy"] and t["sol"] >= 5 and age <= 600 and coin.n_buys > 1:
            self.order("whale_follow", coin.mint, now, "buy", f"a {t['sol']:.1f} SOL buy")
        if coin.mint in self.random_plan and now >= self.random_plan[coin.mint]:
            self.random_plan.pop(coin.mint)
            self.order("random", coin.mint, now, "buy", "random")

    def exits(self, now: float, coin: Coin):
        px = coin.price
        for key, a in self.accts.items():
            p = a.positions.get(coin.mint)
            if not p or p.get("selling"):
                continue
            rules, ch = STRATEGIES[key], px / p["entry"] - 1 if p["entry"] else 0.0
            p["peak"] = max(p["peak"], px)
            why = None
            if "tp" in rules and ch >= rules["tp"]:
                why = f"take profit {ch:+.0%}"
            elif "sl" in rules and ch <= -rules["sl"]:
                why = f"stop {ch:+.0%}"
            elif "trail" in rules and px <= p["peak"] * (1 - rules["trail"]):
                why = f"trailing stop {ch:+.0%}"
            elif rules.get("exit") == "vwap":
                w = coin.window(now, 60)
                vol = sum(x[2] for x in w)
                vwap = sum(x[1] * x[2] for x in w) / vol if vol else px
                if px >= vwap and now - p["t"] > 3:
                    why = f"back to the 60 s average {ch:+.0%}"
            if not why and now - p["t"] >= rules["max_s"]:
                why = f"time's up {ch:+.0%}"
            if coin.done:
                why = f"graduated {ch:+.0%}"
            if why:
                self.order(key, coin.mint, now, "sell", why)

    def watch(self, now: float, e: dict):
        m = int(now // 60)
        if m != self._clock[0]:                          # the local hour, worked out once a minute
            self._clock = (m, local_hour(now))
        b = self.activity[self._clock[1]]
        if self._last_seen is not None and 0 < now - self._last_seen < 10:    # gaps (between runs) don't count
            b[0] += now - self._last_seen
        self._last_seen = now
        if e["kind"] == "create":
            b[2] += 1
        elif e["kind"] == "trade":
            b[1] += 1
            if e.get("buy"):
                b[3] += e.get("sol", 0.0)

    def busy_lines(self) -> list[str]:
        """Trades and new coins a minute in each time slot, and the busiest hours, once there's 10+ minutes of it."""
        def rate(hours):
            secs = sum(self.activity[h][0] for h in hours)
            if secs < 600:
                return None
            return (sum(self.activity[h][1] for h in hours) * 60 / secs,
                    sum(self.activity[h][2] for h in hours) * 60 / secs)
        slots = [(label, rate(slot_hours(s, e))) for _, label, s, e in SLOTS]
        slots = [f"{label} {r[0]:,.0f} trades, {r[1]:.1f} new coins" for label, r in slots if r]
        if not slots:
            return []
        hours = sorted(((rate([h]), h) for h in range(24) if rate([h])), key=lambda x: -x[0][0])[:3]
        name = lambda h: f"{h % 12 or 12}{'a' if h < 12 else 'p'}"
        return ["• How busy pump.fun is, a minute: " + " | ".join(slots),
                "• Busiest hours so far: " + ", ".join(f"{name(h)} ({r[0]:,.0f} trades)" for r, h in hours)]

    def event(self, now: float, e: dict):
        self.events += 1
        self.watch(now, e)
        if e["kind"] == "create":
            self.names[e["mint"]] = e["symbol"] or e["name"]
            return
        if e["kind"] == "complete":
            c = self.coins.get(e["mint"])
            if c:
                c.done = True
                self.exits(now, c)
                self.fill(now + 99, c, stale=True)
            return
        c = self.coins.get(e["mint"])
        if c is None:
            if len(self.coins) > 6000:
                return
            c = self.coins[e["mint"]] = Coin(e["mint"], now, e)
        else:
            c.add(now, e)
        if c.real_sol >= GRADUATE_SOL:
            c.done = True
        self.fill(now, c)
        if not c.done:
            self.on_trade(now, c, e)
        self.exits(now, c)
        self.fill(now, c)

    def tick(self, now: float):
        """Every second: time-based exits and orders on coins that went quiet; forget old coins."""
        for c in list(self.coins.values()):
            busy = any(c.mint in a.positions or c.mint in a.pending for a in self.accts.values())
            if busy:
                self.exits(now, c)
                if now - c.last > 10:                    # no trades for 10 s: fill at the last known reserves
                    self.fill(now, c, stale=True)
            elif now - c.last > 600 or c.age(now) > 7200:
                self.coins.pop(c.mint, None)
                self.names.pop(c.mint, None)

    def value(self, a: Account) -> float:
        return a.cash + sum(p["cost"] for p in a.positions.values()) + PER_TRADE * len(a.pending)

    def board(self, now: float | None = None, hours: float = 1.0) -> str:
        """Like the copy bot's reports: per strategy, the last hour and since it started, and the account; then the
        same strategies split by time of day."""
        now = now or time.time()
        lines = ["Pretend $1,000 per strategy, $250 trades, 1-second charts, real delays and fees:"]
        rows = sorted(self.accts.items(), key=lambda kv: -kv[1].pnl)
        alive = [(k, a) for k, a in rows if self.value(a) >= PER_TRADE or a.positions or a.pending]
        living = {k for k, _ in alive}
        for k, a in rows:
            value = self.value(a)
            if k not in living:                      # busted strategies stay dead: one short line
                lines.append(f"• {STRATEGIES[k]['label']}: busted at ${value:,.0f} ({a.n} trades, "
                             f"{a.wins / max(a.n, 1):.0%} won, {a.pnl:+,.0f})")
                continue
            recent = [t for t in a.trades if now - (t["t"] + t["s"]) <= hours * 3600]
            won = sum(t["profit"] > 0 for t in recent)
            last = (f"last {hours:.0f} h {len(recent)} trades, {won}-{len(recent) - won}, "
                    f"{sum(t['profit'] for t in recent):+,.2f}. ")
            since = (f"Since it started: {a.n} trades, {a.wins / a.n:.0%} won, {a.pnl:+,.2f}; account about ${value:,.0f}"
                     if a.n else "Since it started: no trades yet")
            lines.append(f"• {STRATEGIES[k]['label']}: {last}{since}.")
        tod = self.busy_lines() + self.times_of_day(alive)
        if tod:
            lines += ["", "By time of day (Milwaukee time, when the coin was bought):"] + tod
        win = self.window_lines(alive)
        if win:
            lines += ["", f"Your {WINDOW_LABEL} window vs the rest of the day (from Nov 8 on):"] + win
        return "\n".join(lines)

    def window_lines(self, alive: list) -> list[str]:
        """Each strategy still trading: inside the owner's window vs outside it. Shown once a trade lands inside."""
        if not any(a.window["in"][0] for _, a in alive):
            return []
        def piece(b):
            return f"{b[0]} trades, {b[1] / b[0]:.0%} won, {b[2]:+,.0f}" if b[0] else "no trades"
        return [f"• {STRATEGIES[k]['label']}: in it {piece(a.window['in'])} | rest {piece(a.window['out'])}"
                for k, a in alive if a.window["in"][0] or a.window["out"][0]]

    def times_of_day(self, alive: list) -> list[str]:
        """One line per strategy still trading, plus all of them together; only the time slots it has traded in."""
        def piece(n, w, pnl, label):
            return f"{label} {n} trades, {w / n:.0%} won, {pnl:+,.0f}"

        out, total = [], {key: [0, 0, 0.0] for key, *_ in SLOTS}
        for k, a in alive:
            parts = []
            for key, label, s, e in SLOTS:
                n, w, pnl = a.slot(s, e)
                if n:
                    parts.append(piece(n, w, pnl, label))
                    if k != "random":                    # the luck baseline isn't a strategy
                        t = total[key]
                        t[0], t[1], t[2] = t[0] + n, t[1] + w, t[2] + pnl
            if parts:
                out.append(f"• {STRATEGIES[k]['label']}: " + " | ".join(parts))
        both = [piece(*total[key], label) for key, label, *_ in SLOTS if total[key][0]]
        if len(both) > 1 or out:
            m = sum(k != "random" for k, _ in alive)    # busted ones are left out, so midday looks better than it was
            out.insert(0, f"• The {m} still trading, together (not random, not the busted ones): "
                          + (" | ".join(both) or "no trades yet"))
        return out

    def snapshot(self) -> dict:
        """The accounts as they stand, open bets counted at what they cost (for a save in the middle of a run)."""
        accts = {}
        for k, a in self.accts.items():
            d = a.to_dict()
            d["cash"] = self.value(a)
            accts[k] = d
        return {"accounts": accts, "events": self.events, "t": time.time(), "hello": self.hello_done,
                "activity": [[round(b[0]), b[1], b[2], round(b[3], 1)] for b in self.activity]}

    def to_state(self, now: float | None = None) -> dict:
        now = now or time.time()
        for a in self.accts.values():                   # a run ends: sell what's open at today's curve price
            for mint in list(a.positions):
                c = self.coins.get(mint)
                if c:
                    self.close(a, c, now, "the run ended")
                else:
                    a.cash += a.positions.pop(mint)["cost"]
            a.cash += PER_TRADE * len(a.pending)
            a.pending = {}
        return {"accounts": {k: a.to_dict() for k, a in self.accts.items()}, "events": self.events, "t": time.time(),
                "hello": self.hello_done,
                "activity": [[round(b[0]), b[1], b[2], round(b[3], 1)] for b in self.activity]}


async def listen(lab: Lab, seconds: float, report_every: float = 1800, hello_after: float = 180,
                 first_report: float = 300, save_every: float = 300, early: bool = False):
    import aiohttp

    end, start = time.time() + seconds, time.time()
    said_hello = lab.hello_done                             # "lab is live" and the quick first report: only ever once
    last_report = start - report_every + first_report if not said_hello or early else start
    last_save = start
    while time.time() < end:
        try:
            async with aiohttp.ClientSession() as s:
                async with s.ws_connect(WS, heartbeat=20, max_msg_size=0) as ws:
                    await ws.send_json({"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
                                        "params": [{"mentions": [PUMP]}, {"commitment": "processed"}]})
                    next_tick = time.time() + 1
                    while time.time() < end:
                        try:
                            msg = await asyncio.wait_for(ws.receive(), timeout=1.0)
                        except asyncio.TimeoutError:
                            msg = None
                        now = time.time()
                        if msg is not None:
                            if msg.type != aiohttp.WSMsgType.TEXT:
                                break
                            d = json.loads(msg.data)
                            v = (d.get("params") or {}).get("result", {}).get("value")
                            if v and not v.get("err"):
                                for line in v.get("logs") or []:
                                    if line.startswith("Program data: "):
                                        e = decode(line)
                                        if e:
                                            try:
                                                lab.event(now, e)
                                            except Exception as ex:          # one odd coin never stops the lab
                                                log.debug("event skipped: %s", ex)
                        if now >= next_tick:
                            lab.tick(now)
                            next_tick = now + 1
                        if not said_hello and now - start >= hello_after:
                            said_hello = lab.hello_done = True
                            new = sum(c.fresh for c in lab.coins.values())
                            lab.tell("🧪 Launch lab is live", f"In the first {hello_after / 60:.0f} minutes it saw {lab.events:,} "
                                     f"pump.fun events and {new:,} brand-new coins. Scoreboard when this run ends (~6 h).")
                        if now - last_save >= save_every:            # a killed job keeps its accounts
                            last_save = now
                            peek(lab, now)
                            try:
                                STATE.write_text(json.dumps(lab.snapshot()))
                            except Exception as ex:
                                log.warning("saving failed: %s", ex)
                        if now - last_report >= report_every:
                            last_report = now
                            head = (f"{time.strftime('%H:%M UTC', time.gmtime())}: {lab.events:,} events so far, "
                                    f"{len(lab.coins):,} coins being watched")
                            print(head, flush=True)
                            print(lab.board(), flush=True)
                            lab.tell("🧪 Launch lab: hourly report", (head + "\n" + lab.board(now))[:3500])
        except Exception as e:
            log.warning("feed dropped (%s); reconnecting", e)
            await asyncio.sleep(3)


PEEK_TOPIC = "tbot-launch-lab-" + hashlib.sha256(b"yunuhkei/trading-bot launch lab").hexdigest()[:12]


def peek(lab: "Lab", now: float):
    """The scoreboard every few minutes on a quiet ntfy topic no phone subscribes to, so it can be read while the
    lab runs (curl https://ntfy.sh/<PEEK_TOPIC>/json?poll=1&since=15m) without stopping it. Pretend money only."""
    import requests

    try:
        requests.post(f"https://ntfy.sh/{PEEK_TOPIC}", data=lab.board(now).encode(), timeout=10,
                      headers={"Title": f"launch lab {time.strftime('%H:%M UTC', time.gmtime(now))}", "Priority": "min"})
    except Exception as ex:
        log.debug("peek failed: %s", ex)


def sol_price() -> float:
    import requests

    try:
        return float(requests.get("https://api.coinbase.com/v2/prices/SOL-USD/spot", timeout=15).json()["data"]["amount"])
    except Exception:
        return 150.0


def run(minutes: float = 340, status: bool = False, first_report: float | None = None):
    from .signals import alert_target, notify

    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    target = alert_target()
    tell = (lambda t, m: notify(target, t, m, buy=True, tag="test_tube")) if target else (lambda t, m: print(t, m))
    lab = Lab(sol_price(), state=state, tell=tell)
    if status:
        print(lab.board())
        for k, a in lab.accts.items():
            for t in a.trades[-5:]:
                print(f"  {k}: {t['name']} {t['profit']:+.2f} in {t['s']} s ({t['why_in']} -> {t['why_out']}, filled {t['lag']} s late)")
        return
    import signal

    def stop(*_):                                       # a cancelled job still saves the accounts
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        asyncio.run(listen(lab, minutes * 60, report_every=3600,
                           first_report=(first_report or 5) * 60, early=first_report is not None))
    except KeyboardInterrupt:
        pass
    finally:
        STATE.write_text(json.dumps(lab.to_state()))
        print(lab.board(), flush=True)                  # the hourly reports already went to the phone
