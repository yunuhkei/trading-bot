"""Fast buyer, PRACTICE ONLY. It shadows the launch lab's "Snipe every new coin" bets with real prices: when the lab
decides to buy, it asks Jupiter (the service the real-money bots trade through) what $50 would really buy at the
moment a real order would land, and when the lab decides to sell, what those coins would really sell for. It records
how often a brand-new coin can be bought at all, how fast Jupiter answers, how far the real price is from the lab's,
and what the bets would have made at real prices with a few levels of network fees.

Nothing is ever sent: no wallet key is used and no transaction leaves this program. It's the step before a small
real-money test, to find out what real fills cost without spending anything."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import Counter, deque

log = logging.getLogger("fast_buyer")

SOL_MINT = "So11111111111111111111111111111111111111112"
USD = 50.0                    # what a real test trade would be
BUY_AFTER, SELL_AFTER = 1.0, 0.6     # a real order lands about this long after the decision (quote time comes on top)
FEES_SOL = (0.001, 0.0025, 0.005)    # network fee per transaction to compare: the lab's, 2.5x, 5x
MIN_GAP = 1.1                 # seconds between requests (the free Jupiter service limits how fast you can ask)
WATCH = "snipe"               # the lab strategy it shadows


def base() -> tuple[str, dict]:
    key = os.environ.get("JUPITER_API_KEY", "").strip()
    return ("https://api.jup.ag", {"x-api-key": key}) if key else ("https://lite-api.jup.ag", {})


def hour_stats(attempts, trades, now: float, sol_usd: float, fee_sol: float = 0.001) -> dict:
    att = [a for a in attempts if now - a[0] <= 3600]
    sold = [t for t in trades if t.get("sell_ok") and now - t.get("sold", 0) <= 3600]
    both = [t for t in sold if "lab_ret" in t]
    return {"tried": len(att), "ok": sum(1 for a in att if a[1]), "sold": len(sold),
            "real": sum((t["out"] - t["in"]) / t["in"] for t in sold) / len(sold) if sold else None,
            "lab": sum(t["lab_ret"] for t in both) / len(both) if both else None,
            "pnl": sum((t["out"] - t["in"]) / 1e9 * sol_usd - 2 * fee_sol * sol_usd for t in sold)}


class FastBuyer:
    def __init__(self, state: dict | None = None, sol_usd: float = 150.0, usd: float = USD):
        st = state or {}
        self.sol_usd, self.usd = sol_usd, usd
        self.queue: deque = deque()              # ("buy" | "sell", mint, when decided, lab info), filled by the lab
        self.open: dict = {}                      # mint -> the real-price buy, waiting for the lab's sell
        self.trades: list = st.get("trades", [])[-500:]
        self.stats = Counter(st.get("stats", {}))
        self.lat: list = st.get("lat", [])[-500:]
        self.attempts: deque = deque(st.get("attempts", [])[-2000:], maxlen=2000)    # (time, could buy)
        # the lab's results on the coins Jupiter couldn't buy in time: if the snipes' profit is mostly there, a bot
        # that trades through Jupiter would miss it
        self.missed: dict = {}
        self.missed_ret: list = st.get("missed_ret", [])[-1000:]
        self._next = 0.0
        self.curve = None                         # the lab's curve math: (mint, lamports) -> tokens, to compare
        # the lab's curve math for our own buy: a price quote for selling doesn't know we bought (we never did), so
        # it prices the sale as if our $50 had never gone into the coin. (mint, tokens, lamports in) -> factor
        self.own_buy = None
        self._lock = None

    def to_state(self) -> dict:
        return {"trades": self.trades[-500:], "stats": dict(self.stats), "lat": self.lat[-500:],
                "attempts": list(self.attempts)[-2000:],
                "missed_ret": self.missed_ret[-1000:]}

    # the lab calls these (no waiting): they only queue the decision
    def lab_buy(self, mint: str, now: float, lab_tokens: float | None = None):
        self.queue.append(("buy", mint, now, lab_tokens))

    def lab_sell(self, mint: str, now: float, why: str = ""):
        self.queue.append(("sell", mint, now, why))

    def lab_result(self, mint: str, lab_return: float):
        """The lab's own result for the same bet (profit / cost), to compare with the real-price one."""
        for t in reversed(self.trades[-50:]):
            if t["mint"] == mint and "lab_ret" not in t:
                t["lab_ret"] = round(lab_return, 4)
                return
        if mint in self.open:
            self.open[mint]["lab_ret"] = round(lab_return, 4)
        elif self.missed.pop(mint, None) is not None:
            self.missed_ret.append(round(lab_return, 4))

    async def _quote(self, session, in_mint: str, out_mint: str, amount: int) -> tuple[dict | None, float, str]:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:                      # one request at a time, MIN_GAP apart (two at once get refused)
            wait = self._next - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
            self._next = time.time() + MIN_GAP
        url, headers = base()
        t0 = time.time()
        try:
            async with session.get(f"{url}/swap/v1/quote", headers=headers, timeout=8,
                                   params={"inputMint": in_mint, "outputMint": out_mint, "amount": str(amount),
                                           "slippageBps": "1500", "restrictIntermediateTokens": "true"}) as r:
                d = await r.json(content_type=None)
        except Exception as ex:
            return None, time.time() - t0, f"error: {type(ex).__name__}"
        took = time.time() - t0
        if isinstance(d, dict) and d.get("outAmount"):
            return d, took, "ok"
        msg = str((d or {}).get("error") or (d or {}).get("errorCode") or (d or {}).get("message") or d)
        if "429" in msg or "Too many" in msg:
            return None, took, "too many requests"
        if "not tradable" in msg.lower() or "TOKEN_NOT_TRADABLE" in msg:
            return None, took, "not tradable yet"
        if "route" in msg.lower():
            return None, took, "no route"
        return None, took, msg[:40]

    async def _handle(self, session, item):
        side, mint, decided, info = item
        delay = (BUY_AFTER if side == "buy" else SELL_AFTER) - (time.time() - decided)
        if delay > 0:
            await asyncio.sleep(delay)
        if side == "buy":
            lamports = int(self.usd / self.sol_usd * 1e9)
            self.stats["signals"] += 1
            q, took, how = await self._quote(session, SOL_MINT, mint, lamports)
            if self.curve:
                info = self.curve(mint, lamports)          # the lab's price at the moment the quote came back
            self.lat.append(round(took, 3))
            self.stats[f"buy {how}"] += 1
            self.attempts.append((time.time(), bool(q)))
            if not q:
                self.missed[mint] = decided
            if q:
                route = "+".join((x.get("swapInfo") or {}).get("label", "?") for x in q.get("routePlan", []))
                self.open[mint] = {"mint": mint, "t": round(decided), "late": round(time.time() - decided, 2),
                                   "in": lamports, "tok": int(q["outAmount"]), "route": route,
                                   "vs_lab": (round(int(q["outAmount"]) / 1e6 / info - 1, 4) if info else None)}
        elif mint in self.open:
            b = self.open.pop(mint)
            for attempt in range(4):                # a real bot retries a sale; only "nobody can buy it" is a total loss
                q, took, how = await self._quote(session, mint, SOL_MINT, b["tok"])
                self.lat.append(round(took, 3))
                if q:
                    break
                await asyncio.sleep(2.0)
            self.stats[f"sell {how}"] += 1
            raw = int(q["outAmount"]) if q else 0                    # no buyer at all: the coins are worth nothing
            factor = (self.own_buy(mint, b["tok"] / 1e6, b["in"]) or 1.0) if (q and self.own_buy) else 1.0
            b.update(sold=round(time.time()), why=info, sell_ok=bool(q), raw_out=raw, own_buy=round(factor, 4),
                     out=int(raw * factor))
            self.trades.append(b)

    async def run(self, session, stop_at: float):
        """Works through the lab's decisions until the run ends."""
        tasks = set()
        while time.time() < stop_at:
            while self.queue:
                t = asyncio.create_task(self._handle(session, self.queue.popleft()))
                tasks.add(t)
                t.add_done_callback(tasks.discard)
            await asyncio.sleep(0.05)
        for t in list(tasks):
            t.cancel()

    def hour(self, now: float | None = None) -> dict:
        """The last hour: buys tried and how many could go through; sales, and what they made vs the lab."""
        return hour_stats(self.attempts, self.trades, now or time.time(), self.sol_usd)

    def summary(self) -> dict:
        # a coin Jupiter can't sell isn't worth nothing (pump.fun itself always takes a sale): it's counted on its own,
        # not in the profit, since a direct pump.fun seller would get out of it
        done = [t for t in self.trades if "out" in t and t.get("sell_ok")]
        sig = self.stats.get("signals", 0)
        bought = self.stats.get("buy ok", 0)
        out = {"signals": sig, "bought": bought, "finished": len(done),
               "unsellable": sum(1 for t in self.trades if "out" in t and not t.get("sell_ok")),
               "fails": {k[4:]: v for k, v in self.stats.items() if k.startswith("buy ") and k != "buy ok"},
               "answer_s": sorted(self.lat)[len(self.lat) // 2] if self.lat else None,
               "vs_lab": None, "real_ret": None, "lab_ret": None, "pnl": {},
               "missed": len(self.missed_ret),
               "missed_lab_ret": round(sum(self.missed_ret) / len(self.missed_ret), 4) if self.missed_ret else None}
        gaps = [t["vs_lab"] for t in done if t.get("vs_lab") is not None]
        if gaps:
            out["vs_lab"] = sorted(gaps)[len(gaps) // 2]
        if done:
            for f in FEES_SOL:
                out["pnl"][f] = round(sum((t["out"] - t["in"]) / 1e9 * self.sol_usd - 2 * f * self.sol_usd for t in done), 2)
            both = [t for t in done if "lab_ret" in t]
            if both:
                out["real_ret"] = round(sum((t["out"] - t["in"]) / t["in"] for t in both) / len(both), 4)
                out["lab_ret"] = round(sum(t["lab_ret"] for t in both) / len(both), 4)
        return out

    def line(self) -> str:
        s = self.summary()
        if not s["signals"]:
            return "Fast buyer (real Jupiter prices, no money): no snipes yet"
        txt = (f"Fast buyer (real Jupiter prices, no money): {s['signals']} snipes, {s['bought']} could be bought in time, "
               f"{s['finished']} sold" + (f", {s['unsellable']} Jupiter couldn't sell" if s["unsellable"] else ""))
        if s["pnl"]:
            txt += (f"; at ${self.usd:.0f} a trade {s['pnl'][FEES_SOL[0]]:+,.2f} (normal fees) / "
                    f"{s['pnl'][FEES_SOL[-1]]:+,.2f} (5x fees)")
        if s["real_ret"] is not None:
            txt += f"; real prices {s['real_ret']:+.1%} a bet vs the lab's {s['lab_ret']:+.1%} on the same bets"
        if s["missed_lab_ret"] is not None:
            txt += f"; the lab's result on the {s['missed']} it couldn't buy: {s['missed_lab_ret']:+.1%} a bet"
        txt += ". Nothing is ever sent."
        return txt
