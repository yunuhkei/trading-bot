"""Direct pump.fun trades, PRACTICE ONLY: builds the real buy and sell transactions for pump.fun's bonding curve (its
`buy_exact_quote_in_v3` and `sell_v3` instructions, from pump.fun's published program definition) and has the Solana
network test-run them ("simulate"). A simulation runs the transaction against the live chain and reports what it would
do (success or the error, the tokens it would get, the compute it uses) without sending it: nothing changes on chain,
no money moves, and it needs no wallet key. The pretend buyer in a simulation is a public wallet with plenty of SOL
(pump.fun's own fee wallet), since the network checks that the buyer could pay.

Going direct skips Jupiter, which can't trade a coin until it lists it (about half of brand-new coins in their first
seconds) and limits how fast you can ask."""
from __future__ import annotations

import base64
import struct

from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

PUMP = Pubkey.from_string("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P")
FEE_CONFIG = Pubkey.from_string("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
WSOL = Pubkey.from_string("So11111111111111111111111111111111111111112")
# one of pump.fun's 8 buyback fee wallets (any of them works for any coin; docs/FEE_RECIPIENTS.md)
BUYBACK = Pubkey.from_string("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD")
# the pretend buyer for simulations: pump.fun's normal fee wallet #0, a plain wallet with thousands of SOL
SIM_PAYER = Pubkey.from_string("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV")

BUY_EXACT_QUOTE_IN_V3 = bytes([225, 247, 80, 30, 213, 179, 132, 136])
SELL_V3 = bytes([28, 146, 222, 119, 38, 196, 105, 213])
CU_LIMIT = 200_000


def pda(*seeds: bytes, program: Pubkey = PUMP) -> Pubkey:
    return Pubkey.find_program_address(list(seeds), program)[0]


def ata(owner: Pubkey, mint: Pubkey, token_program: Pubkey) -> Pubkey:
    return pda(bytes(owner), bytes(token_program), bytes(mint), program=ATA_PROGRAM)


GLOBAL = pda(b"global")
EVENT_AUTHORITY = pda(b"__event_authority")


def trade_accounts(mint: Pubkey, user: Pubkey, token_program: Pubkey) -> list[AccountMeta]:
    """The 17 accounts of buy_v3 / buy_exact_quote_in_v3 / sell_v3, in order (docs/instructions/TRADE_V3.md)."""
    curve = pda(b"bonding-curve", bytes(mint))
    w = lambda k, s=False: AccountMeta(k, is_signer=s, is_writable=True)
    r = lambda k: AccountMeta(k, is_signer=False, is_writable=False)
    return [r(GLOBAL), r(mint), r(WSOL), r(token_program), r(TOKEN), w(curve), w(ata(curve, mint, token_program)),
            w(ata(curve, WSOL, TOKEN)), w(user, True), w(ata(user, mint, token_program)), w(ata(user, WSOL, TOKEN)),
            w(pda(b"user_volume_accumulator", bytes(user))), r(FEE_CONFIG), w(BUYBACK), r(SYSTEM),
            r(EVENT_AUTHORITY), r(PUMP)]


def create_token_account(payer: Pubkey, owner: Pubkey, mint: Pubkey, token_program: Pubkey) -> Instruction:
    """The user's token account for the coin (v3 trades need it to exist): create it if it isn't there yet."""
    return Instruction(ATA_PROGRAM, bytes([1]), [
        AccountMeta(payer, True, True), AccountMeta(ata(owner, mint, token_program), False, True),
        AccountMeta(owner, False, False), AccountMeta(mint, False, False), AccountMeta(SYSTEM, False, False),
        AccountMeta(token_program, False, False)])


def buy_ix(mint: Pubkey, user: Pubkey, token_program: Pubkey, lamports: int, min_tokens: int = 1) -> Instruction:
    """Spend exactly `lamports` (fees included) for at least `min_tokens` (raw units)."""
    return Instruction(PUMP, BUY_EXACT_QUOTE_IN_V3 + struct.pack("<QQ", lamports, max(1, min_tokens)),
                       trade_accounts(mint, user, token_program))


def sell_ix(mint: Pubkey, user: Pubkey, token_program: Pubkey, tokens: int, min_lamports: int = 0) -> Instruction:
    return Instruction(PUMP, SELL_V3 + struct.pack("<QQ", tokens, min_lamports), trade_accounts(mint, user, token_program))


def transaction(ixs: list[Instruction], payer: Pubkey, priority_microlamports: int = 100_000) -> VersionedTransaction:
    """An unsigned transaction (a blank signature) for simulation; the network puts in a fresh blockhash."""
    msg = MessageV0.try_compile(payer, [set_compute_unit_limit(CU_LIMIT), set_compute_unit_price(priority_microlamports),
                                        *ixs], [], Hash.default())
    return VersionedTransaction.populate(msg, [Signature.default()])


def buy_tx(mint: str, token_program: str, lamports: int, min_tokens: int = 1, payer: Pubkey = SIM_PAYER):
    m, tp = Pubkey.from_string(mint), Pubkey.from_string(token_program)
    return transaction([create_token_account(payer, payer, m, tp), buy_ix(m, payer, tp, lamports, min_tokens)], payer)


def round_trip_tx(mint: str, token_program: str, lamports: int, tokens: int, payer: Pubkey = SIM_PAYER):
    """Buy, then sell `tokens` back, in one transaction: proves the sell works for this coin, right now."""
    m, tp = Pubkey.from_string(mint), Pubkey.from_string(token_program)
    return transaction([create_token_account(payer, payer, m, tp), buy_ix(m, payer, tp, lamports),
                        sell_ix(m, payer, tp, tokens)], payer)


def simulate_params(tx: VersionedTransaction, watch: list[Pubkey]) -> list:
    """The simulateTransaction call: no signature check, a fresh blockhash, and the accounts to read back after."""
    return [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True,
                                                   "commitment": "processed",
                                                   "accounts": {"encoding": "base64", "addresses": [str(a) for a in watch]}}]


def token_amount(account: dict | None) -> int:
    """A token account's balance (raw units) from simulateTransaction's account data."""
    if not account or not account.get("data"):
        return 0
    raw = base64.b64decode(account["data"][0])
    return struct.unpack_from("<Q", raw, 64)[0] if len(raw) >= 72 else 0


# ---- the practice shadow: every "Snipe every new coin" bet, test-run directly on pump.fun ----

import asyncio  # noqa: E402
import time  # noqa: E402
from collections import Counter, deque  # noqa: E402

RPC = "https://api.mainnet-beta.solana.com"
USD = 50.0
BUY_AFTER, SELL_AFTER = 1.0, 0.6     # a real order lands about this long after the decision
FEES_SOL = (0.001, 0.0025, 0.005)    # network + priority fee per transaction to compare: normal, 2.5x, 5x
RENT_SOL = 0.00203928                # opening the coin's token account; a real bot closes it after selling and gets it back


def curve_state(account: dict | None) -> tuple[float, float, bool] | None:
    """A bonding curve account (getAccountInfo, base64) -> (virtual SOL, virtual tokens, complete)."""
    if not account or not account.get("data"):
        return None
    raw = base64.b64decode(account["data"][0])
    if len(raw) < 49:
        return None
    vtok, vsol = struct.unpack_from("<QQ", raw, 8)
    return vsol / 1e9, vtok / 1e6, bool(raw[48])


class DirectBuyer:
    """Shadows the lab's snipe ghost straight on pump.fun with test-runs. Nothing is sent and no key is used."""

    def __init__(self, state: dict | None = None, sol_usd: float = 150.0, usd: float = USD, rpc: str = RPC):
        st = state or {}
        self.sol_usd, self.usd, self.rpc = sol_usd, usd, rpc
        self.queue: deque = deque()
        self.open: dict = {}
        self.trades: list = st.get("trades", [])[-500:]
        self.stats = Counter(st.get("stats", {}))
        self.lat: list = st.get("lat", [])[-500:]
        self.programs: dict = {}                 # mint -> its token program (looked up once)
        self.fee = None                           # (mint) -> the coin's fee from the lab's feed
        self.program_of = None                    # (mint) -> its token program, from the coin's launch event

    def to_state(self) -> dict:
        return {"trades": self.trades[-500:], "stats": dict(self.stats), "lat": self.lat[-500:]}

    def lab_buy(self, mint: str, now: float, lab_tokens: float | None = None):
        self.queue.append(("buy", mint, now, None))

    def lab_sell(self, mint: str, now: float, why: str = ""):
        self.queue.append(("sell", mint, now, why))

    def lab_result(self, mint: str, lab_return: float):
        for t in reversed(self.trades[-50:]):
            if t["mint"] == mint and "lab_ret" not in t:
                t["lab_ret"] = round(lab_return, 4)
                return
        if mint in self.open:
            self.open[mint]["lab_ret"] = round(lab_return, 4)

    async def _rpc(self, session, method: str, params: list):
        try:
            async with session.post(self.rpc, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                                    timeout=8) as r:
                d = await r.json(content_type=None)
            return d.get("result"), (d.get("error") or {}).get("message")
        except Exception as ex:
            return None, type(ex).__name__

    async def _program(self, session, mint: str) -> str | None:
        known = self.program_of(mint) if self.program_of else None
        if known:
            return known
        for attempt in range(3):                  # a brand-new coin may not be on every network node yet
            if mint in self.programs:
                break
            if attempt:
                await asyncio.sleep(0.4)
            res, _ = await self._rpc(session, "getAccountInfo", [mint, {"encoding": "base64", "commitment": "processed"}])
            owner = ((res or {}).get("value") or {}).get("owner")
            if owner:
                self.programs[mint] = owner
                if len(self.programs) > 5000:
                    self.programs.pop(next(iter(self.programs)))
        return self.programs.get(mint)

    async def _handle(self, session, item):
        side, mint, decided, why = item
        delay = (BUY_AFTER if side == "buy" else SELL_AFTER) - (time.time() - decided)
        if delay > 0:
            await asyncio.sleep(delay)
        t0 = time.time()
        if side == "buy":
            self.stats["signals"] += 1
            prog = await self._program(session, mint)
            if not prog:
                self.stats["buy coin not found"] += 1
                return
            lam = int(self.usd / self.sol_usd * 1e9)
            m, tp = Pubkey.from_string(mint), Pubkey.from_string(prog)
            res, err = await self._rpc(session, "simulateTransaction",
                                       simulate_params(buy_tx(mint, prog, lam), [ata(SIM_PAYER, m, tp)]))
            self.lat.append(round(time.time() - t0, 3))
            val = (res or {}).get("value") or {}
            if err or val.get("err") is not None:
                self.stats[f"buy failed: {str(err or val.get('err'))[:40]}"] += 1
                return
            tok = token_amount((val.get("accounts") or [None])[0])
            self.stats["buy ok"] += 1
            self.open[mint] = {"mint": mint, "t": round(decided), "late": round(time.time() - decided, 2), "in": lam,
                               "tok": tok, "prog": prog, "units": val.get("unitsConsumed")}
        elif mint in self.open:
            b = self.open.pop(mint)
            m, tp = Pubkey.from_string(mint), Pubkey.from_string(b["prog"])
            curve = pda(b"bonding-curve", bytes(m))
            # what the sale brings: the coin's live curve, read from the chain, with our own buy still in it
            res, err = await self._rpc(session, "getAccountInfo", [str(curve), {"encoding": "base64", "commitment": "processed"}])
            st = curve_state((res or {}).get("value"))
            fee = (self.fee(mint) if self.fee else None) or 0.0125
            out, check = 0, 0
            if st and not st[2] and b["tok"] > 0:
                vsol, vtok, _ = st
                net, tok = b["in"] / 1e9 * (1 - fee), b["tok"] / 1e6
                v, t = vsol + net, max(vtok - tok, 1e-9)
                out = int((v - v * t / (t + tok)) * (1 - fee) * 1e9)
                # what the same buy gets right now, to sell back in the check (selling more than that would fail)
                check = int(min(b["tok"], (vtok - vsol * vtok / (vsol + net)) * 1e6) * 0.95)
            # and does a sale really go through right now? (buy then sell in one test-run)
            ok = False
            if out > 0 and check > 0:
                r2, e2 = await self._rpc(session, "simulateTransaction",
                                         simulate_params(round_trip_tx(mint, b["prog"], b["in"], check), []))
                ok = e2 is None and ((r2 or {}).get("value") or {}).get("err") is None
            self.lat.append(round(time.time() - t0, 3))
            self.stats["sell ok" if ok else ("sell failed" if out else "sell: curve finished or gone")] += 1
            b.update(sold=round(time.time()), why=why, sell_ok=ok, out=out if ok else 0, done_curve=bool(st and st[2]))
            self.trades.append(b)

    async def run(self, session, stop_at: float):
        tasks = set()
        while time.time() < stop_at:
            while self.queue:
                t = asyncio.create_task(self._handle(session, self.queue.popleft()))
                tasks.add(t)
                t.add_done_callback(tasks.discard)
            await asyncio.sleep(0.05)
        for t in list(tasks):
            t.cancel()

    def summary(self) -> dict:
        done = [t for t in self.trades if t.get("sell_ok")]
        out = {"signals": self.stats.get("signals", 0), "bought": self.stats.get("buy ok", 0), "finished": len(done),
               "unsellable": sum(1 for t in self.trades if not t.get("sell_ok")),
               "fails": {k: v for k, v in self.stats.items() if k.startswith("buy ") and k != "buy ok"},
               "answer_s": sorted(self.lat)[len(self.lat) // 2] if self.lat else None, "pnl": {},
               "real_ret": None, "lab_ret": None}
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
            return "Direct buyer (pump.fun test-runs, no money): no snipes yet"
        txt = (f"Direct buyer (pump.fun test-runs, no money): {s['signals']} snipes, {s['bought']} would have gone through, "
               f"{s['finished']} sold" + (f", {s['unsellable']} couldn't sell" if s["unsellable"] else ""))
        if s["pnl"]:
            txt += (f"; at ${self.usd:.0f} a trade {s['pnl'][FEES_SOL[0]]:+,.2f} (normal fees) / "
                    f"{s['pnl'][FEES_SOL[-1]]:+,.2f} (5x fees)")
        if s["real_ret"] is not None:
            txt += f"; real {s['real_ret']:+.1%} a bet vs the lab's {s['lab_ret']:+.1%} on the same bets"
        return txt + ". Nothing is ever sent."
