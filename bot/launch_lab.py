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
# the super bot turns a strategy on for an hour when, in that same hour on EARLIER days (never today), it has
# 2+ days of trades, 20+ trades in all, a profit overall, and a profit on more than half of those days
SUPER_DAYS, SUPER_TRADES, KEEP_DAYS = 2, 20, 35
SUPER = ("timing", "streak")  # $1,000 and $250 trades like the rest; real money later at $100 is about a tenth
STREAK_S, STREAK_TRADES = 1800, 5     # super bot 2: a strategy is hot when it made money in its last 30 min (5+ trades)
COOLED = 3                            # ...and it's dropped the moment its last 3 trades all lost (good stretches end fast)
SIGN_EVERY = 300                      # the market-signs log: one row every 5 minutes, kept for KEEP_DAYS
SUPER_TOP = 3                  # with this many versions, copy only the best 3 for an hour (luck makes some look good)


def in_window(t: float) -> bool:
    lt = local_time(t)
    return WINDOW[0] <= lt.hour * 60 + lt.minute < WINDOW[1]


def slot_hours(s: int, e: int) -> list[int]:
    return list(range(s, e)) if s < e else list(range(s, 24)) + list(range(0, e))

STRATEGIES = {
    "snipe": {"label": "Snipe every new coin", "family": "new_coin", "tp": 1.0, "sl": 0.35, "max_s": 90},
    "snipe_quick": {"label": "Snipe, quick flip", "family": "new_coin", "tp": 0.25, "sl": 0.15, "max_s": 20},
    "momentum_60s": {"label": "First-minute momentum", "family": "momentum", "tp": 0.6, "sl": 0.25, "max_s": 300},
    "volume_spike": {"label": "Volume spike", "family": "spike", "tp": 0.4, "sl": 0.2, "max_s": 180, "spike": 4},
    # versions of the volume spike with other settings: if they ALL make money, the edge is real, not one lucky setting
    "volume_spike_3": {"label": "Volume spike, 3 SOL trigger", "family": "spike", "tp": 0.4, "sl": 0.2, "max_s": 180,
                       "spike": 3},
    "volume_spike_5": {"label": "Volume spike, 5 SOL trigger", "family": "spike", "tp": 0.4, "sl": 0.2, "max_s": 180,
                       "spike": 5},
    "volume_spike_tp30": {"label": "Volume spike, quick (+30%/-15%)", "family": "spike", "tp": 0.3, "sl": 0.15,
                          "max_s": 120, "spike": 4},
    "volume_spike_tp60": {"label": "Volume spike, let it run (+60%/-25%)", "family": "spike", "tp": 0.6, "sl": 0.25,
                          "max_s": 300, "spike": 4},
    "dip_bounce": {"label": "Second-chart dip bounce", "family": "dip", "sl": 0.15, "max_s": 120, "exit": "vwap"},
    "breakout": {"label": "Breakout to new highs", "family": "breakout", "trail": 0.2, "max_s": 600},
    "graduation_run": {"label": "Graduation run (70% full curve)", "family": "graduation", "grad": 0.7, "sl": 0.2,
                       "max_s": 900},
    "whale_follow": {"label": "Follow a 5+ SOL buy", "family": "whale", "min_sol": 5, "tp": 0.5, "sl": 0.25,
                     "max_s": 180},
    "random": {"label": "Random coins (luck baseline)", "family": "random", "tp": 0.5, "sl": 0.25, "max_s": 180},
    # copies a strategy's buys only in the hours that strategy made money in on earlier days (see timing_on)
    "timing": {"label": "Super bot (each strategy only at its best hours)", "max_s": 900},
    # copies the strategies that are winning right now: made money in the last 30 minutes (see streak_on)
    "streak": {"label": "Super bot 2 (copies what's winning right now)", "max_s": 900},
}

# more versions for the super bot to choose from: the same buy signals with other ways out. They're ghost-only (no
# pretend account of their own, just a record), so the report stays short.
EXITS = {
    "quick": ({"tp": 0.15, "sl": 0.10, "max_s": 60}, "quick flip +15%/-10%"),
    "flip": ({"tp": 0.25, "sl": 0.15, "max_s": 120}, "flip +25%/-15%"),
    "base": ({"tp": 0.40, "sl": 0.20, "max_s": 180}, "+40%/-20%"),
    "ride": ({"tp": 1.0, "sl": 0.30, "max_s": 600}, "let it ride +100%/-30%"),
    "hold": ({"sl": 0.20, "max_s": 900}, "hold up to 15 min, -20% stop"),
    "trail": ({"trail": 0.15, "max_s": 600}, "15% trailing stop"),
    "trail_wide": ({"trail": 0.30, "max_s": 1200}, "30% trailing stop"),
}
VERSIONS = [  # (key prefix, family, settings, name, ways out)
    ("sn", "new_coin", {}, "Snipe new coins", ["quick", "base", "trail", "trail_wide"]),
    ("mo", "momentum", {}, "First-minute momentum", ["quick", "flip", "base", "trail"]),
    ("vs4", "spike", {"spike": 4}, "Volume spike", ["quick", "ride", "trail", "trail_wide"]),
    ("vs3", "spike", {"spike": 3}, "Volume spike 3 SOL", ["quick", "flip", "trail"]),
    ("vs5", "spike", {"spike": 5}, "Volume spike 5 SOL", ["quick", "flip", "trail"]),
    ("vs8", "spike", {"spike": 8}, "Volume spike 8 SOL", ["quick", "base", "trail"]),
    ("dip", "dip", {}, "Dip bounce", ["quick", "flip", "base"]),
    ("bo", "breakout", {}, "Breakout", ["quick", "flip", "base"]),
    ("gr70", "graduation", {"grad": 0.7}, "Graduation run 70%", ["quick", "base", "trail"]),
    ("gr50", "graduation", {"grad": 0.5}, "Graduation run 50%", ["hold", "base", "trail"]),
    ("gr85", "graduation", {"grad": 0.85}, "Graduation run 85%", ["hold", "base", "trail"]),
    ("wh5", "whale", {"min_sol": 5}, "Follow a 5+ SOL buy", ["quick", "flip", "trail"]),
    ("wh2", "whale", {"min_sol": 2}, "Follow a 2+ SOL buy", ["quick", "base", "trail"]),
    ("wh10", "whale", {"min_sol": 10}, "Follow a 10+ SOL buy", ["quick", "base", "trail"]),
]
for _pre, _fam, _set, _name, _outs in VERSIONS:
    for _out in _outs:
        _rules, _how = EXITS[_out]
        STRATEGIES[f"{_pre}_{_out}"] = {"label": f"{_name}, {_how}", "family": _fam, **_set, **_rules, "ghost_only": True}


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
        size = STRATEGIES.get(key, {})
        self.per_trade = float(size.get("per_trade", PER_TRADE))
        self.key, self.cash = key, float(d.get("cash", size.get("cash", CASH)))
        self.start = float(d.get("start", size.get("cash", CASH)))
        self.positions: dict = {}                       # open bets are sold when a run ends (see to_state)
        self.trades: list = d.get("trades", [])[-300:]
        self.n, self.wins, self.pnl = int(d.get("n", 0)), int(d.get("wins", 0)), float(d.get("pnl", 0.0))
        self.best, self.worst = float(d.get("best", 0.0)), float(d.get("worst", 0.0))
        self.pending: dict = {}
        self.ghost = False
        # every trade by the hour it was bought (Milwaukee time): [trades, wins, profit]; not cut off like `trades`
        self.by_hour = [list(b) for b in d["by_hour"]] if d.get("by_hour") else self._rebuild_hours()
        # by day and hour, for the super bot: {"2026-11-08": 24 x [trades, wins, profit]}. A save from before this
        # was all one day (the lab's first, Nov 7), so its hour tally becomes that day.
        self.days = {k: [list(b) for b in v] for k, v in (d.get("days") or {}).items()}
        if not d.get("days") and self.trades:
            self.days[local_time(self.trades[-1]["t"]).strftime("%Y-%m-%d")] = [list(b) for b in self.by_hour]
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
        lt = local_time(t)
        bs = [(self.by_hour if hours is None else hours)[lt.hour]]
        if hours is None:
            bs.append(self.window["in" if in_window(t) else "out"])
            day = lt.strftime("%Y-%m-%d")
            if day not in self.days:
                self.days[day] = [[0, 0, 0.0] for _ in range(24)]
                for old in sorted(self.days)[:-KEEP_DAYS]:
                    self.days.pop(old)
            bs.append(self.days[day][lt.hour])
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
                "window": {k: [b[0], b[1], round(b[2], 2)] for k, b in self.window.items()},
                "days": {k: [[b[0], b[1], round(b[2], 2)] for b in v] for k, v in self.days.items()}}

    def can_buy(self, mint: str) -> bool:
        return (len(self.positions) + len(self.pending) < MAX_OPEN and self.cash >= self.per_trade
                and mint not in self.positions and mint not in self.pending)


class Lab:
    def __init__(self, sol_usd: float = 150.0, latency_buy: float = 1.5, latency_sell: float = 1.0, seed: int = 0,
                 state: dict | None = None, tell=None):
        state = state or {}
        self.coins: dict[str, Coin] = {}
        self.names: dict[str, str] = {}
        self.sol_usd, self.lb, self.ls = sol_usd, latency_buy, latency_sell
        self.accts = {k: Account(k, (state.get("accounts") or {}).get(k))
                      for k, r in STRATEGIES.items() if not r.get("ghost_only")}
        self.family: dict[str, list[str]] = {}
        for k, r in STRATEGIES.items():
            if r.get("family"):
                self.family.setdefault(r["family"], []).append(k)
        # a ghost of every strategy: the same buys and sells, but it never runs out of money, so its records keep
        # counting after the real account busts (busted accounts stay dead). The super bot judges strategies on these.
        saved = state.get("shadow") or {}
        self.ghosts = {k: Account(k, saved.get(k) or (state.get("accounts") or {}).get(k)) for k in STRATEGIES}
        for g in self.ghosts.values():
            g.ghost = True
        self.rng = random.Random(seed)
        self.random_plan: dict[str, float] = {}
        self.events = int(state.get("events", 0))
        # how busy pump.fun is by the hour (Milwaukee time): [seconds watched, trades, new coins, SOL bought]
        self.activity = ([list(b) for b in state["activity"]] if state.get("activity")
                         else [[0.0, 0, 0, 0.0] for _ in range(24)])
        self._clock, self._last_seen = (None, 0), None
        self._timing: tuple = (None, [])
        self._streak: tuple = (-1e18, [])
        # market signs every 5 minutes, to find out later what shows up before a good stretch
        self.signs: list = state.get("signs") or []
        self._win: dict = {"start": None, "trades": 0, "new": 0, "buy": 0.0, "sell": 0.0, "grad": 0, "buyers": set(),
                           "fam": {}}
        # the owner's money plan for the super bot: keep $1,000 in, take out everything above it each night, and
        # after 2 losing days in a row stop using the money (paper only) until the owner's next check
        self.plan = state.get("plan") or {"mode": "plan", "streak": 0, "put_in": CASH, "banked": 0.0, "start": None,
                                          "n": None, "day": None, "ghost_start": 0.0, "log": []}
        self.hello_done = bool(state.get("hello")) or self.events > 0       # a lab that already ran said hello
        self.tell = tell or (lambda t, m: None)

    # orders: signal now, filled at the first trade seen `latency` seconds later
    def timing_on(self, now: float) -> list[str]:
        """The strategies the super bot copies right now: judged only on this same hour on earlier days."""
        lt = local_time(now)
        day, h = lt.strftime("%Y-%m-%d"), lt.hour
        if self._timing[0] != (day, h):
            on = []
            for k, a in self.ghosts.items():
                if k == "random" or k in SUPER:
                    continue
                rows = [a.days[d][h] for d in a.days if d < day and a.days[d][h][0]]
                if (len(rows) >= SUPER_DAYS and sum(r[0] for r in rows) >= SUPER_TRADES and sum(r[2] for r in rows) > 0
                        and 2 * sum(r[2] > 0 for r in rows) > len(rows)):
                    on.append((sum(r[2] for r in rows) / sum(r[0] for r in rows), k))
            self._timing = ((day, h), [k for _, k in sorted(on, reverse=True)[:SUPER_TOP]])
        return self._timing[1]

    def books(self) -> list[Account]:
        return list(self.accts.values()) + list(self.ghosts.values())

    def streak_on(self, now: float) -> list[str]:
        """Super bot 2's picks: the best 3 strategies by profit over the last 30 minutes (5+ trades, in profit), but
        not one whose last 3 trades all lost (it's cooling off)."""
        if now - self._streak[0] >= 60:
            hot = []
            for k, g in self.ghosts.items():
                if k == "random" or k in SUPER:
                    continue
                rec = [t["profit"] for t in g.trades[-400:] if now - (t["t"] + t["s"]) <= STREAK_S]
                cooled = len(rec) >= COOLED and all(x <= 0 for x in rec[-COOLED:])
                if len(rec) >= STREAK_TRADES and sum(rec) > 0 and not cooled:
                    hot.append((sum(rec), k))
            self._streak = (now, [k for _, k in sorted(hot, reverse=True)[:SUPER_TOP]])
        return self._streak[1]

    def order(self, key: str, mint: str, now: float, side: str, why: str = ""):
        if side != "buy":
            return self._sell(self.accts[key], mint, now, why) if key in self.accts else None
        if key not in SUPER:
            for sk, picks in (("timing", self.timing_on(now)), ("streak", self.streak_on(now))):
                if key in picks:
                    why2 = f"{STRATEGIES[key]['label']}: {why}"
                    if sk != "timing" or self.plan["mode"] == "plan":    # in practice mode its money sits still
                        self._buy(self.accts[sk], mint, now, why2, via=key)
                    self._buy(self.ghosts[sk], mint, now, why2, via=key)
            self._buy(self.ghosts[key], mint, now, why)
        if key in self.accts:
            self._buy(self.accts[key], mint, now, why)

    def signal(self, family: str, mint: str, now: float, why: str, keep=lambda rules: True):
        """A buy signal goes to every strategy of that family (whose settings `keep` accepts)."""
        for key in self.family.get(family, ()):
            if keep(STRATEGIES[key]):
                self.order(key, mint, now, "buy", why)

    def _buy(self, a: Account, mint: str, now: float, why: str, via: str | None = None):
        if a.ghost and a.cash < a.per_trade:
            a.cash += CASH                                              # a ghost never runs out: it only keeps score
        if not a.can_buy(mint):
            return
        a.pending[mint] = {"side": "buy", "at": now + self.lb, "why": why, "signal": now, "via": via}
        a.cash -= a.per_trade                                           # reserved

    def _sell(self, a: Account, mint: str, now: float, why: str):
        if mint in a.positions and not a.positions[mint].get("selling"):
            a.positions[mint]["selling"] = {"at": now + self.ls, "why": why}

    def fill(self, now: float, coin: Coin, stale: bool = False):
        """Fill every order on this coin whose time has come, at the coin's current reserves."""
        for a in self.books():
            o = a.pending.get(coin.mint)
            if o and now >= o["at"]:
                a.pending.pop(coin.mint)
                if coin.done:
                    a.cash += a.per_trade
                    continue
                sol_in = a.per_trade / self.sol_usd - TX_COST_SOL
                tok = buy_tokens(coin.vsol, coin.vtok, sol_in, coin.fee)
                a.positions[coin.mint] = {"tokens": tok, "net": sol_in * (1 - coin.fee), "cost": a.per_trade, "t": now,
                                          "entry": coin.price,
                                          "peak": coin.price, "why": o["why"], "lag": round(now - o["signal"], 2),
                                          "via": o.get("via"),
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
        if a.ghost and a.key not in SUPER:                # the families' results, for the market-signs log
            f = self._win["fam"].setdefault(STRATEGIES[a.key].get("family", "?"), [0, 0.0])
            f[0] += 1
            f[1] += profit
        if len(a.trades) > 2000:
            del a.trades[:-1000]
        a.trades.append({"t": round(p["t"]), "s": round(now - p["t"], 1), "name": p["name"], "mint": coin.mint,
                         "profit": round(profit, 2), "why_in": p["why"], "why_out": why, "lag": p["lag"]})

    # strategies, checked on every trade of a coin
    def on_trade(self, now: float, coin: Coin, t: dict):
        age, px = coin.age(now), coin.price
        if coin.fresh and coin.n_buys + coin.n_sells == 1:
            self.signal("new_coin", coin.mint, now, "new coin")
            if self.rng.random() < 0.05:
                self.random_plan[coin.mint] = now + self.rng.uniform(5, 600)
        if coin.fresh and 60 <= age <= 75 and "m60" not in coin.flags:
            coin.flags.add("m60")
            sells, buys = coin.n_sells, coin.n_buys
            if coin.birth_price and buys >= 15 and len(coin.buyers) >= 10 and px >= 1.5 * coin.birth_price and sells <= 0.6 * buys:
                self.signal("momentum", coin.mint, now, f"{buys} buys, {len(coin.buyers)} buyers, x{px / coin.birth_price:.1f}")
        if age <= 1800:
            last10 = sum(x[2] for x in coin.window(now, 10) if x[3])
            prev = sum(x[2] for x in coin.window(now, 70, 10) if x[3]) / 6
            for key in self.family.get("spike", ()):
                rules = STRATEGIES[key]
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
                self.signal("dip", coin.mint, now, f"down {1 - px / hi:.0%} in 20 s")
        if 180 <= age <= 3600:
            prior = [x[1] for x in coin.window(now, 190, 10)]
            vol = sum(x[2] for x in coin.window(now, 10) if x[3])
            if len(prior) >= 20 and px > 1.10 * max(prior) and vol >= 2 and now - coin.__dict__.get("bo_t", 0) > 300:
                coin.bo_t = now
                self.signal("breakout", coin.mint, now, "new 3-min high")
        for g in sorted({STRATEGIES[k]["grad"] for k in self.family.get("graduation", ())}):
            flag = "grad" if g == 0.7 else f"grad{g}"
            if coin.real_sol >= g * GRADUATE_SOL and flag not in coin.flags and coin.first_real_sol < (g - 0.1) * GRADUATE_SOL:
                coin.flags.add(flag)
                self.signal("graduation", coin.mint, now, f"{coin.real_sol:.0f} SOL in the curve",
                            keep=lambda r, g=g: r["grad"] == g)
        if t["buy"] and t["sol"] >= 2 and age <= 600 and coin.n_buys > 1:
            self.signal("whale", coin.mint, now, f"a {t['sol']:.1f} SOL buy", keep=lambda r: t["sol"] >= r["min_sol"])
        if coin.mint in self.random_plan and now >= self.random_plan[coin.mint]:
            self.random_plan.pop(coin.mint)
            self.order("random", coin.mint, now, "buy", "random")

    def exits(self, now: float, coin: Coin):
        px = coin.price
        for a in self.books():
            p = a.positions.get(coin.mint)
            if not p or p.get("selling"):
                continue
            rules, ch = STRATEGIES[p.get("via") or a.key], px / p["entry"] - 1 if p["entry"] else 0.0
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
                self._sell(a, coin.mint, now, why)

    def watch(self, now: float, e: dict):
        m = int(now // 60)
        if m != self._clock[0]:                          # the local hour, worked out once a minute
            lt = local_time(now)
            self._clock = (m, lt.hour)
            day = lt.strftime("%Y-%m-%d")
            if self.plan["day"] is None:
                self.plan.update(day=day, start=self.value(self.accts["timing"]), n=self.accts["timing"].n,
                                 ghost_start=self.ghosts["timing"].pnl)
            elif day != self.plan["day"]:
                self.settle()
                self.plan["day"] = day
        b = self.activity[self._clock[1]]
        if self._last_seen is not None and 0 < now - self._last_seen < 10:    # gaps (between runs) don't count
            b[0] += now - self._last_seen
        self._last_seen = now
        w = self._win
        if w["start"] is None:
            w["start"] = now
            w["px0"] = {m: c.price for m, c in self.coins.items()}
        if e["kind"] == "create":
            b[2] += 1
            w["new"] += 1
        elif e["kind"] == "complete":
            w["grad"] += 1
        elif e["kind"] == "trade":
            b[1] += 1
            w["trades"] += 1
            if e.get("buy"):
                b[3] += e.get("sol", 0.0)
                w["buy"] += e.get("sol", 0.0)
                if len(w["buyers"]) < 50000 and e.get("user"):
                    w["buyers"].add(e["user"])
            else:
                w["sell"] += e.get("sol", 0.0)

    def settle(self):
        """End of a day (Milwaukee time) for the owner's plan: a winning day takes out everything above $1,000; a
        losing day isn't topped up; 2 losing days in a row put the super bot in practice mode."""
        p, sup, g = self.plan, self.accts["timing"], self.ghosts["timing"]
        day, value = p["day"], self.value(sup)
        res, n = value - p["start"], sup.n - p["n"]
        took, mode = 0.0, p["mode"]
        if mode == "plan" and n > 0:
            if res > 0:
                p["streak"] = 0
                took = max(0.0, min(sup.cash, value - CASH))
                sup.cash -= took
                p["banked"] += took
            elif res < 0:
                p["streak"] += 1
        paper = g.pnl - p.get("ghost_start", 0.0)
        p["log"] = (p["log"] + [{"day": day, "mode": mode, "result": round(res, 2), "trades": n, "took": round(took, 2),
                                 "paper": round(paper, 2)}])[-60:]
        after = self.value(sup)
        net = p["banked"] + after - p["put_in"]
        if mode == "plan" and n > 0 and p["streak"] >= 2:
            p.update(mode="practice", since=day, ghost_at=g.pnl)
            last2 = [x for x in p["log"] if x.get("mode") == "plan" and x.get("trades")][-2:]
            days = ", ".join(f"{x['day']} {x['result']:+,.0f}" for x in last2)
            self.tell("🧪 Super bot: practice mode",
                      f"2 losing days in a row ({days}). "
                      f"It stopped using its money and trades on paper only until your next check. Your plan so far: "
                      f"taken out ${p['banked']:,.0f}, account ${after:,.0f}, net {net:+,.0f}.")
        elif mode == "plan" and n > 0:
            self.tell(f"🧪 Super bot, {day}",
                      f"{res:+,.0f} on {n} trades. Took out ${took:,.0f}. Your plan so far: taken out ${p['banked']:,.0f}, "
                      f"account ${after:,.0f}, net {net:+,.0f}." + (" Losing day 1 of 2." if res < 0 else ""))
        p["start"], p["n"], p["ghost_start"] = after, sup.n, g.pnl

    def resume_super(self) -> float:
        """The owner's check says go: the super bot uses its money again, topped back up to $1,000 (counted as put in)."""
        p, sup = self.plan, self.accts["timing"]
        add = max(0.0, CASH - self.value(sup))
        sup.cash += add
        p["put_in"] += add
        p.update(mode="plan", streak=0)
        p.pop("since", None)
        p["start"], p["n"] = self.value(sup), sup.n
        p["log"] = (p["log"] + [{"day": p["day"], "resumed": True, "added": round(add, 2)}])[-60:]
        return add

    def plan_lines(self, now: float) -> list[str]:
        """The super bot's lines for the phone: practice mode, no trades yet, or today and the plan so far."""
        p, sup = self.plan, self.accts["timing"]
        value = self.value(sup)
        net = p["banked"] + value - p["put_in"]
        so_far = f"Your plan so far: taken out ${p['banked']:,.0f}, account ${value:,.0f}, net {net:+,.0f}"
        if p["mode"] == "practice":
            paper = self.ghosts["timing"].pnl - p.get("ghost_at", 0.0)
            return [f"Super bot: PRACTICE MODE since {p.get('since')} (2 losing days in a row). On paper since then: "
                    f"{paper:+,.0f}. Tell Claude to restart it at your next check.", so_far]
        if sup.n == 0 and not sup.positions and not sup.pending:
            return ["Super bot: no trades yet. It starts once a strategy wins the same hour on 2 different days."]
        start = p["start"] if p["start"] is not None else value
        n = sup.n - (p["n"] if p["n"] is not None else sup.n)
        return [f"Super bot today: {value - start:+,.0f} on {n} trades" + (" (losing day 1 of 2 so far: yesterday was red)"
                                                                         if p["streak"] == 1 else ""),
                f"{so_far} ({sup.n} trades, {sup.wins / max(sup.n, 1):.0%} won)"]

    def busy_lines(self) -> list[str]:
        """Trades and new coins a minute in each time slot, and the busiest hours, once there's 10+ minutes of it."""
        def rate(hours):
            secs = sum(self.activity[h][0] for h in hours)
            if secs < 600:
                return None
            return (sum(self.activity[h][1] for h in hours) * 60 / secs,
                    sum(self.activity[h][2] for h in hours) * 60 / secs)
        shorts = {"midday": "mid", "evening": "eve", "overnight": "night", "morning": "morn"}
        slots = [(shorts[key], rate(slot_hours(s, e))) for key, _, s, e in SLOTS]
        slots = [f"{label} {r[0]:,.0f} trades, {r[1]:.0f} new coins" for label, r in slots if r]
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

    def up_share(self, w: dict) -> float | None:
        """Market health: of the coins that traded in these 5 minutes, the share whose price ended higher."""
        px0 = w.get("px0") or {}
        moved = [c.price > px0[m] for m, c in self.coins.items() if m in px0 and c.last >= w["start"]]
        return round(sum(moved) / len(moved), 3) if moved else None

    def log_signs(self, now: float):
        """Every 5 minutes, one row of market signs and how each strategy family did in those 5 minutes."""
        w = self._win
        if w["start"] is None or now - w["start"] < SIGN_EVERY:
            return
        mins = (now - w["start"]) / 60
        lt = local_time(w["start"])
        self.signs.append({"t": round(w["start"]), "day": lt.strftime("%Y-%m-%d"), "hm": lt.strftime("%H:%M"),
                           "trades_min": round(w["trades"] / mins), "new_min": round(w["new"] / mins, 1),
                           "buy_sol_min": round(w["buy"] / mins, 1), "sell_sol_min": round(w["sell"] / mins, 1),
                           "buyers_min": round(len(w["buyers"]) / mins), "grads": w["grad"],
                           "coins": len(self.coins), "sol_usd": round(self.sol_usd, 2),
                           "up_share": self.up_share(w),
                           "fam": {k: [v[0], round(v[1], 1)] for k, v in w["fam"].items()}})
        cut = now - KEEP_DAYS * 86400
        while self.signs and self.signs[0]["t"] < cut:
            self.signs.pop(0)
        self._win = {"start": now, "trades": 0, "new": 0, "buy": 0.0, "sell": 0.0, "grad": 0, "buyers": set(), "fam": {},
                     "px0": {m: c.price for m, c in self.coins.items()}}

    def tick(self, now: float):
        """Every second: time-based exits and orders on coins that went quiet; forget old coins; the signs log."""
        self.log_signs(now)
        for c in list(self.coins.values()):
            busy = any(c.mint in a.positions or c.mint in a.pending for a in self.books())    # ghosts too
            if busy:
                self.exits(now, c)
                if now - c.last > 10:                    # no trades for 10 s: fill at the last known reserves
                    self.fill(now, c, stale=True)
            elif now - c.last > 600 or c.age(now) > 7200:
                self.coins.pop(c.mint, None)
                self.names.pop(c.mint, None)

    def value(self, a: Account) -> float:
        return a.cash + sum(p["cost"] for p in a.positions.values()) + a.per_trade * len(a.pending)

    def board(self, now: float | None = None, hours: float = 1.0, top: int | None = None) -> str:
        """Like the copy bot's reports: per account still trading, the last hour and since it started; the busted
        ones in one line; what the super bot is doing; then every strategy by time of day (its ghost record)."""
        now = now or time.time()
        lines = ["Pretend $1,000 per strategy, $250 trades, 1-second charts, real delays and fees:"]
        rows = sorted(self.accts.items(), key=lambda kv: -kv[1].pnl)
        dead = []
        for k, a in rows:
            value = self.value(a)
            if value < a.per_trade and not a.positions and not a.pending:
                dead.append(f"{STRATEGIES[k]['label']} {a.pnl:+,.0f}")      # busted strategies stay dead
                continue
            recent = [t for t in a.trades if now - (t["t"] + t["s"]) <= hours * 3600]
            won = sum(t["profit"] > 0 for t in recent)
            last = (f"last {hours:.0f} h {len(recent)} trades, {won}-{len(recent) - won}, "
                    f"{sum(t['profit'] for t in recent):+,.2f}. ")
            since = (f"Since it started: {a.n} trades, {a.wins / a.n:.0%} won, {a.pnl:+,.2f}; account about ${value:,.0f}"
                     if a.n else "Since it started: no trades yet")
            lines.append(f"• {STRATEGIES[k]['label']}: {last}{since}.")
        if dead:
            lines.append(f"• Busted, staying dead ({len(dead)}): " + ", ".join(dead))
        lines += [f"• {x}" for x in self.plan_lines(now)]
        on = self.timing_on(now)
        hour = local_time(now).hour
        hour = f"{hour % 12 or 12}{'a' if hour < 12 else 'p'}"
        lines.append(f"• Super bot this hour ({hour}): " + (
            "copying " + ", ".join(STRATEGIES[k]["label"] for k in on) if on else
            f"sitting out (no strategy has made money at {hour} on {SUPER_DAYS}+ earlier days yet)"))
        tod = self.busy_lines() + self.times_of_day(top)
        if tod:
            lines += ["", "By time of day, profit/trades (% won). Busted ones keep counting what they would have made. "
                          f"Milwaukee time: mid 11a-5p, eve 5-11p, night 11p-5a, morn 5-11a; win = your {WINDOW_LABEL} "
                          "window (from Nov 8):"] + tod
        return "\n".join(lines)

    def simple(self, now: float | None = None) -> str:
        """The phone's hourly ping in plain words: the super bot; last hour per strategy (which ones made money and
        how much, the rest as an average, the biggest win); the best hours so far, and the ones that keep winning."""
        now = now or time.time()
        lines = self.plan_lines(now)
        s2 = self.accts["streak"]
        hot = self.streak_on(now)
        lines.append(f"Super bot 2 (copies what's winning right now): ${self.value(s2):,.0f} ({s2.pnl:+,.0f} on {s2.n} "
                     f"trades). Now copying: " + (", ".join(STRATEGIES[k]["label"] for k in hot) or "nothing is hot"))
        on = self.timing_on(now)
        hour = local_time(now).hour
        hour = f"{hour % 12 or 12}{'a' if hour < 12 else 'p'}"
        lines.append(f"Super bot this hour ({hour}): " + ("copying " + ", ".join(STRATEGIES[k]["label"] for k in on)
                                                         if on else "sitting out"))
        # the last hour, strategy by strategy (the ghosts: every strategy, always running)
        hour_of = {}
        for k, g in self.ghosts.items():
            if k == "random" or k in SUPER:
                continue
            rec = [t for t in g.trades if now - (t["t"] + t["s"]) <= 3600]
            if rec:
                hour_of[k] = rec
        if hour_of:
            pnl = {k: sum(t["profit"] for t in r) for k, r in hour_of.items()}
            won, lost = [k for k in pnl if pnl[k] > 0], [k for k in pnl if pnl[k] <= 0]
            lines += ["", f"Last hour: {len(hour_of)} strategies traded ({sum(len(r) for r in hour_of.values())} trades)"]
            for k in sorted(won, key=lambda k: -pnl[k])[:6]:
                lines.append(f"✅ {STRATEGIES[k]['label']}: {pnl[k]:+,.0f} on {len(hour_of[k])} trades "
                             f"({sum(t['profit'] > 0 for t in hour_of[k])} won)")
            if len(won) > 6:
                lines.append(f"✅ ...and {len(won) - 6} more made money")
            if lost:
                worst = min(lost, key=lambda k: pnl[k])
                lines.append(f"❌ {len(lost)} lost money: {sum(pnl[k] for k in lost) / len(lost):+,.0f} each on average "
                             f"(worst: {STRATEGIES[worst]['label']}, {pnl[worst]:+,.0f})")
            k, t = max(((k, t) for k, r in hour_of.items() for t in r), key=lambda kt: kt[1]["profit"])
            if t["profit"] > 0:
                lines.append(f"Biggest win: {STRATEGIES[k]['label']} on {t['name']}, {t['profit']:+,.0f}")
        # the best hours so far (strategy + hour of the day, Milwaukee time), and the ones that keep winning there
        cells = []
        for k, g in self.ghosts.items():
            if k == "random" or k in SUPER:
                continue
            for h in range(24):
                n, w, pnl_ = g.by_hour[h]
                if n:
                    rows = [g.days[d][h] for d in g.days if g.days[d][h][0]]
                    cells.append((pnl_, n, w, k, h, sum(r[2] > 0 for r in rows), len(rows)))
        hr = lambda h: f"{h % 12 or 12}{'a' if h < 12 else 'p'}"
        piece = lambda c: (f"{STRATEGIES[c[3]]['label']} at {hr(c[4])}: {c[0]:+,.0f} on {c[1]} trades "
                           f"({c[2] / c[1]:.0%} won; up {c[5]} of {c[6]} days)")
        good = sorted((c for c in cells if c[0] > 0), reverse=True)
        if good:
            lines += ["", "Best hours so far:"] + [f"{i}. {piece(c)}" for i, c in enumerate(good[:3], 1)]
        elif cells:
            lines += ["", "Best hours so far: none yet, every strategy is losing in every hour"]
        repeat = [c for c in good if c[6] >= 2 and c[5] == c[6]]       # up in that hour every day it traded, 2+ days
        if repeat:
            lines += ["Repeat winners (up in the same hour every day, 2+ days):"] + [f"• {piece(c)}" for c in repeat[:3]]
        elif cells:
            lines.append("Repeat winners (up in the same hour on 2+ days): none yet")
        return "\n".join(lines).encode()[:4000].decode(errors="ignore")

    def times_of_day(self, top: int | None = None) -> list[str]:
        """Every strategy's ghost record by time slot and in the owner's window, plus all of them together. With
        `top`, only the best that many strategies (the rest are counted in one line)."""
        def piece(short, n, w, pnl):
            return f"{short} {pnl:+,.0f}/{n} ({w / n:.0%})"

        shorts = {"midday": "mid", "evening": "eve", "overnight": "night", "morning": "morn"}
        out, total = [], {key: [0, 0, 0.0] for key, *_ in SLOTS}
        for k, g in sorted(self.ghosts.items(), key=lambda kv: -kv[1].pnl):
            if k in SUPER:
                continue
            parts = []
            for key, _, s, e in SLOTS:
                n, w, pnl = g.slot(s, e)
                if n:
                    parts.append(piece(shorts[key], n, w, pnl))
                    if k != "random":                    # the luck baseline isn't a strategy
                        t = total[key]
                        t[0], t[1], t[2] = t[0] + n, t[1] + w, t[2] + pnl
            if g.window["in"][0]:
                parts.append(piece("win", *g.window["in"]))
            if parts:
                out.append(f"• {STRATEGIES[k]['label']}: " + " | ".join(parts))
        if top is not None and len(out) > top:
            out = out[:top] + [f"• ...and {len(out) - top} more strategies (all of them: launch-lab-status)"]
        both = [piece(shorts[key], *total[key]) for key, *_ in SLOTS if total[key][0]]
        if both:
            m = sum(k != "random" and k not in SUPER for k in self.ghosts)
            out.insert(0, f"• All {m} strategies together (not random): " + " | ".join(both))
        return out

    def snapshot(self) -> dict:
        """The accounts as they stand, open bets counted at what they cost (for a save in the middle of a run)."""
        accts = {}
        for k, a in self.accts.items():
            d = a.to_dict()
            d["cash"] = self.value(a)
            accts[k] = d
        return {"accounts": accts, "events": self.events, "t": time.time(), "hello": self.hello_done,
                "activity": [[round(b[0]), b[1], b[2], round(b[3], 1)] for b in self.activity],
                "shadow": self.ghost_state(), "plan": self.plan, "signs": self.signs}

    def ghost_state(self) -> dict:
        out = {}
        for k, g in self.ghosts.items():
            d = g.to_dict()
            d.pop("trades")
            d["cash"] = self.value(g)
            out[k] = d
        return out

    def to_state(self, now: float | None = None) -> dict:
        now = now or time.time()
        for a in self.books():                          # a run ends: sell what's open at today's curve price
            for mint in list(a.positions):
                c = self.coins.get(mint)
                if c:
                    self.close(a, c, now, "the run ended")
                else:
                    a.cash += a.positions.pop(mint)["cost"]
            a.cash += a.per_trade * len(a.pending)
            a.pending = {}
        return {"accounts": {k: a.to_dict() for k, a in self.accts.items()}, "events": self.events, "t": time.time(),
                "hello": self.hello_done,
                "activity": [[round(b[0]), b[1], b[2], round(b[3], 1)] for b in self.activity],
                "shadow": self.ghost_state(), "plan": self.plan, "signs": self.signs}


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
                            lab.tell("🧪 Launch lab", lab.simple(now))    # the full board goes to the logs/peek
        except Exception as e:
            log.warning("feed dropped (%s); reconnecting", e)
            await asyncio.sleep(3)


PEEK_TOPIC = "tbot-launch-lab-" + hashlib.sha256(b"yunuhkei/trading-bot launch lab").hexdigest()[:12]


def peek(lab: "Lab", now: float):
    """The scoreboard every few minutes on a quiet ntfy topic no phone subscribes to, so it can be read while the
    lab runs (curl https://ntfy.sh/<PEEK_TOPIC>/json?poll=1&since=15m) without stopping it. Pretend money only."""
    import requests

    try:
        requests.post(f"https://ntfy.sh/{PEEK_TOPIC}", data=lab.board(now, top=14).encode()[:4000], timeout=10,
                      headers={"Title": f"launch lab {time.strftime('%H:%M UTC', time.gmtime(now))}", "Priority": "min"})
    except Exception as ex:
        log.debug("peek failed: %s", ex)


def sol_price() -> float:
    import requests

    try:
        return float(requests.get("https://api.coinbase.com/v2/prices/SOL-USD/spot", timeout=15).json()["data"]["amount"])
    except Exception:
        return 150.0


def run(minutes: float = 340, status: bool = False, first_report: float | None = None, resume_super: bool = False):
    from .signals import alert_target, notify

    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    target = alert_target()
    tell = (lambda t, m: notify(target, t, m, buy=True, tag="test_tube")) if target else (lambda t, m: print(t, m))
    lab = Lab(sol_price(), state=state, tell=tell)
    if resume_super:                                    # the owner's check said go
        was = lab.plan["mode"]
        add = lab.resume_super()
        STATE.write_text(json.dumps(lab.snapshot()))
        tell("🧪 Super bot is back on", f"It was in {was} mode; it uses its money again"
             + (f", topped back up to $1,000 (${add:,.0f} put in)." if add else "."))
    if status:
        print(lab.board())
        # every strategy's record by day and hour (Milwaukee time), for a closer look at its best times
        print("DAYS " + json.dumps({k: g.days for k, g in lab.ghosts.items() if g.days}), flush=True)
        print("SIGNS " + json.dumps(lab.signs), flush=True)
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
