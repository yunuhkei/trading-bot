"""The super bot's research log (practice data only; nothing here trades).

Two kinds of rows, written to compact daily gzip files in lab_data/ (UTC dates; old files are pruned):
- "c" (coins): every new pump.fun coin: launch facts, what was known at 10 s and 60 s after launch (trades, buyers,
  sizes, timing), and what happened after (highs, lows and price at 5/30/60 minutes, when it first crossed
  +25/+50/+100% or -20/-35%, graduated, when the creator first sold).
- "b" (bets): every ghost bet: strategy, its result after the lab's fees, and the market at the moment of the
  signal (minute of hour, hour, launch rate, the coin's volume and buyers so far, SOL's trend and swings, fill delay).

Point-in-time only: a snapshot holds just the trades seen up to that second, and the launch facts just what was known
at launch (a creator's past coins count only coins that had finished before this one launched).

Prices are relative: "e0" is the price right after a coin's first trade (about what a sniper pays); multiples are
price / e0, and the "x60" crossing times are measured from the price at the 60-second snapshot.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import math
import time
from collections import Counter, deque
from pathlib import Path

log = logging.getLogger("coin_log")

DATA_DIR = Path("lab_data")
KEEP_DAYS = {"c": 21, "b": 35}            # coin rows / bet rows are kept this many days
SNAPS = (10, 60)                          # seconds after launch
UPS, DOWNS = (1.25, 1.5, 2.0), (0.8, 0.65)
HORIZONS = (300, 1800, 3600)              # 5, 30, 60 minutes after launch
QUIET = 900                               # no trade for 15 minutes (after the first 2): finished early
MAX_TRACKS = 20000
MAX_WALLETS = 300
SOL_URL = "https://api.coinbase.com/v2/prices/SOL-USD/spot"


def safe(fn):
    """The log never gets in the lab's way: an error is counted and logged, and the lab carries on."""
    import functools

    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        try:
            return fn(self, *a, **k)
        except Exception as ex:
            self.stats[f"error in {fn.__name__}"] += 1
            if self.stats[f"error in {fn.__name__}"] <= 3:
                log.warning("research log: %s: %r", fn.__name__, ex)
            return None
    return wrapper


def tag(addr: str | None) -> str | None:
    """A short stand-in for a wallet address (enough to recognise the same creator again)."""
    return hashlib.sha1(addr.encode()).hexdigest()[:10] if addr else None


def rnd(x, n: int = 4):
    return None if x is None else round(x, n)


def th_key(th: float) -> str:
    return f"{(th - 1) * 100:+.0f}"            # 1.25 -> "+25", 0.8 -> "-20"


def local_hm(t: float) -> tuple[int, int]:
    from .launch_lab import local_time
    lt = local_time(t)
    return lt.hour, lt.minute


class Track:
    """One new coin, followed for an hour after launch."""

    __slots__ = ("mint", "t0", "creator", "mayhem", "ctx", "n", "nb", "ns", "bsol", "ssol", "maxb", "wallets", "t5",
                 "dev", "cs", "p", "e0", "tf", "e60", "snaps", "hi1", "lo1", "hi", "lo", "marks", "x0", "x60", "grad",
                 "last")

    def __init__(self, mint: str, t0: float, creator: str | None, mayhem: bool, ctx: dict):
        self.mint, self.t0, self.creator, self.mayhem, self.ctx = mint, t0, creator, mayhem, ctx
        self.n = self.nb = self.ns = 0
        self.bsol = self.ssol = self.maxb = self.dev = 0.0
        self.wallets: dict = {}                   # other buyers in the first minute -> SOL each bought
        self.t5 = self.cs = self.p = self.e0 = self.tf = self.e60 = self.grad = None
        self.snaps: dict = {}
        self.hi1 = self.lo1 = self.hi = self.lo = None
        self.marks: dict = {}
        self.x0: dict = {}
        self.x60: dict = {}
        self.last = t0

    def _snap(self, s: int) -> dict:
        top = max(self.wallets.values()) / self.bsol if self.wallets and self.bsol > 0 else None
        d = {"n": self.n, "nb": self.nb, "ns": self.ns, "bs": rnd(self.bsol, 3), "ss": rnd(self.ssol, 3),
             "mb": rnd(self.maxb, 3), "u": len(self.wallets), "t5": rnd(self.t5, 1), "dv": rnd(self.dev, 3),
             "cs": 1 if self.cs is not None and self.cs <= s else 0, "top": rnd(top, 3),
             "pm": rnd(self.p / self.e0, 4) if self.e0 else None}
        return {k: v for k, v in d.items() if v not in (None, 0)}

    def due(self, now: float):
        """Take the snapshots and horizon marks whose time has come (before a trade after them is counted)."""
        a = now - self.t0
        for s in SNAPS:
            if s not in self.snaps and a >= s:
                self.snaps[s] = self._snap(s)
                if s == SNAPS[-1]:
                    self.e60 = self.p
        for h in HORIZONS:
            if h not in self.marks and a >= h:
                last = self.p / self.e0 if self.e0 else None
                self.marks[h] = [rnd(self.hi if self.hi is not None else last), rnd(self.lo if self.lo is not None
                                                                                   else last), rnd(last)]

    def trade(self, now: float, p: float, sol: float, buy: bool, user: str | None):
        self.due(now)
        a = now - self.t0
        if self.e0 is None:
            self.e0, self.tf = p, now
        self.p, self.last = p, now
        self.n += 1
        mine = user is not None and user == self.creator
        if buy:
            self.nb += 1
            self.bsol += sol
            self.maxb = max(self.maxb, sol)
            if mine:
                self.dev += sol
            elif a <= SNAPS[-1] and user:
                if user in self.wallets or len(self.wallets) < MAX_WALLETS:
                    self.wallets[user] = self.wallets.get(user, 0.0) + sol
                if self.t5 is None and len(self.wallets) >= 5:
                    self.t5 = a
        else:
            self.ns += 1
            self.ssol += sol
            if mine and self.cs is None:
                self.cs = a
        if p <= 0 or not self.e0:
            return
        m = p / self.e0
        if a <= SNAPS[-1]:
            self.hi1 = m if self.hi1 is None else max(self.hi1, m)
            self.lo1 = m if self.lo1 is None else min(self.lo1, m)
        else:
            self.hi = m if self.hi is None else max(self.hi, m)
            self.lo = m if self.lo is None else min(self.lo, m)
        for th in UPS:
            if th not in self.x0 and m >= th:
                self.x0[th] = now - self.tf
        for th in DOWNS:
            if th not in self.x0 and m <= th:
                self.x0[th] = now - self.tf
        if self.e60 and a > SNAPS[-1]:
            m60 = p / self.e60
            for th in UPS:
                if th not in self.x60 and m60 >= th:
                    self.x60[th] = now - (self.t0 + SNAPS[-1])
            for th in DOWNS:
                if th not in self.x60 and m60 <= th:
                    self.x60[th] = now - (self.t0 + SNAPS[-1])

    def finished(self, now: float) -> bool:
        a = now - self.t0
        return (a >= HORIZONS[-1] or (self.grad is not None and now - self.t0 - self.grad > 60)
                or (a >= 120 and now - self.last >= QUIET))

    def last_multiple(self) -> float | None:
        return self.p / self.e0 if self.e0 and self.p else None

    def row(self, cut: float | None = None) -> dict:
        d = {"m": self.mint[:12], "t": round(self.t0), "cr": tag(self.creator), **self.ctx, "N": self.n}
        if self.mayhem:
            d["my"] = 1
        if self.n > 1 or self.grad is not None:
            d.update({"s10": self.snaps.get(10), "s60": self.snaps.get(60), "h1": [rnd(self.hi1), rnd(self.lo1)],
                      "mk": {str(h // 60): v for h, v in self.marks.items()},
                      "x0": {th_key(k): round(v, 1) for k, v in self.x0.items()},
                      "x60": {th_key(k): round(v, 1) for k, v in self.x60.items()},
                      "e60": rnd(self.e60 / self.e0, 4) if self.e60 and self.e0 else None,
                      "g": rnd(self.grad, 1), "cs": rnd(self.cs, 1)})
        if cut is not None:
            d["cut"] = round(cut)                 # the run ended this many seconds after launch: later marks missing
        return {k: v for k, v in d.items() if v not in (None, {}, [None, None])}


class CoinLog:
    def __init__(self, state: dict | None = None, data_dir: Path = DATA_DIR):
        st = state or {}
        self.dir = Path(data_dir)
        self.tracks: dict[str, Track] = {}
        self.creators: dict[str, list] = dict(st.get("creators") or {})    # tag -> [coins, died, graduated]
        self.launches: deque = deque()
        self.sol: deque = deque(maxlen=180)       # (time, SOL price), about once a minute
        self.buf: dict[str, list] = {"c": [], "b": []}
        self.stats = Counter()
        self._next_tick = 0.0

    def to_state(self) -> dict:
        return {"creators": dict(list(self.creators.items())[-50000:])}

    # ---- the market at a moment ----
    def launch_rate(self, now: float) -> float:
        while self.launches and now - self.launches[0] > 600:
            self.launches.popleft()
        return round(len(self.launches) / 10, 1)

    def sol_ctx(self, now: float) -> tuple[float | None, float | None]:
        """SOL's change over the last hour and the swing of its 1-minute moves (from what's been polled so far)."""
        pts = [(t, p) for t, p in self.sol if now - t <= 3700 and t <= now]
        if len(pts) < 10:
            return None, None
        trend = pts[-1][1] / pts[0][1] - 1
        rets = [math.log(b[1] / a[1]) for a, b in zip(pts, pts[1:]) if a[1] > 0 and b[1] > 0]
        mean = sum(rets) / len(rets)
        vol = math.sqrt(sum((r - mean) ** 2 for r in rets) / len(rets))
        return round(trend, 4), round(vol, 5)

    @safe
    def bet_ctx(self, now: float, coin) -> dict:
        hr, mi = local_hm(now)
        st, sv = self.sol_ctx(now)
        d = {"mi": mi, "hr": hr, "lr": self.launch_rate(now), "st": st, "sv": sv}
        if coin is not None:
            d.update(ag=round(coin.age(now), 1), v=round(sum(x[2] for x in coin.trades), 2), nb=len(coin.buyers))
        return {k: v for k, v in d.items() if v is not None}

    # ---- the feed ----
    @safe
    def on_event(self, now: float, e: dict):
        k = e.get("kind")
        if k == "create":
            self.stats["launches"] += 1
            creator = e.get("creator") or e.get("user")
            c = self.creators.get(tag(creator)) or [0, 0, 0]
            hr, mi = local_hm(now)
            st, sv = self.sol_ctx(now)
            ctx = {"hr": hr, "mi": mi, "lr": self.launch_rate(now), "cp": c[0], "cd": c[1], "cg": c[2], "st": st, "sv": sv}
            self.launches.append(now)
            if e["mint"] not in self.tracks and len(self.tracks) < MAX_TRACKS:
                self.tracks[e["mint"]] = Track(e["mint"], now, creator, bool(e.get("mayhem")),
                                               {k2: v for k2, v in ctx.items() if v not in (None, 0)})
            elif len(self.tracks) >= MAX_TRACKS:
                self.stats["launches not followed (too many at once)"] += 1
        elif k == "trade":
            tr = self.tracks.get(e["mint"])
            if tr is not None and e.get("vtok", 0) > 0:
                tr.trade(now, e["vsol"] / e["vtok"], e.get("sol", 0.0), bool(e.get("buy")), e.get("user"))
        elif k == "complete":
            tr = self.tracks.get(e.get("mint"))
            if tr is not None and tr.grad is None:
                tr.grad = now - tr.t0

    @safe
    def tick(self, now: float):
        if now < self._next_tick:
            return
        self._next_tick = now + 5
        for tr in list(self.tracks.values()):
            if tr.finished(now):
                self._finish(tr)
            else:
                tr.due(now)

    def _finish(self, tr: Track, cut: float | None = None):
        if cut is None:
            tr.due(tr.t0 + HORIZONS[-1])          # finished early (quiet or graduated): nothing changes after
        self.buf["c"].append(tr.row(cut))
        self.tracks.pop(tr.mint, None)
        self.stats["coins logged"] += 1
        if cut is None and tr.creator:            # the creator's record counts only finished coins
            t = tag(tr.creator)
            c = self.creators.setdefault(t, [0, 0, 0])
            last = tr.last_multiple()
            c[0] += 1
            c[1] += 1 if (last is not None and last < 0.5) else 0
            c[2] += 1 if tr.grad is not None else 0
            if len(self.creators) > 60000:
                for k in list(self.creators)[:10000]:
                    self.creators.pop(k, None)

    @safe
    def bet(self, row: dict):
        self.buf["b"].append(row)
        self.stats["bets logged"] += 1

    # ---- files ----
    def flush(self, now: float | None = None):
        """Appends what's buffered to today's files (gzip members can be appended) and prunes old files."""
        now = now or time.time()
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            for kind, rows in self.buf.items():
                if rows:
                    with gzip.open(self.dir / f"{kind}-{day}.jsonl.gz", "at", encoding="utf-8") as f:
                        f.write("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows))
                    self.buf[kind] = []
            for p in self.dir.glob("*.jsonl.gz"):
                kind, _, d = p.name.partition("-")
                keep = KEEP_DAYS.get(kind)
                if keep and d[:10] < time.strftime("%Y-%m-%d", time.gmtime(now - keep * 86400)):
                    p.unlink()
        except Exception as ex:                   # the log never stops the lab
            log.warning("research log: couldn't write: %s", ex)

    @safe
    def close(self, now: float | None = None):
        """The run ends: coins still being followed are written as they stand (marked cut), then everything's saved."""
        now = now or time.time()
        for tr in list(self.tracks.values()):
            tr.due(now)
            self._finish(tr, cut=now - tr.t0)
        self.flush(now)

    async def poll_sol(self, session, stop_at: float):
        import asyncio

        while time.time() < stop_at:
            try:
                async with session.get(SOL_URL, timeout=10) as r:
                    d = await r.json(content_type=None)
                self.sol.append((time.time(), float(d["data"]["amount"])))
            except Exception:
                pass
            await asyncio.sleep(60)


def read(kind: str, data_dir: Path = DATA_DIR, since: float = 0.0) -> list[dict]:
    """Every row of one kind ("c" or "b") with a time at or after `since`, oldest file first."""
    out = []
    for p in sorted(Path(data_dir).glob(f"{kind}-*.jsonl.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        r = json.loads(line)
                        if r.get("t", 0) >= since:
                            out.append(r)
        except (OSError, EOFError, json.JSONDecodeError) as ex:     # a file cut off mid-write: keep what's readable
            log.warning("research log: %s: %s", p.name, ex)
    return out
