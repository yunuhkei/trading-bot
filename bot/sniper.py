"""The sniper: REAL money, small. When the launch lab's "Snipe every new coin" decides to buy a brand-new coin, the
sniper buys the same coin straight on pump.fun from the bot's wallet (the SOLANA_BOT_KEY secret), and sells when the lab
decides to sell. It's off unless sniper.yaml says `live: true`, and it keeps to hard limits:

- a fixed dollar amount a trade and only a few coins at once, never more than its budget, and some SOL always kept back
  for network fees;
- the owner's plan: each midnight (Milwaukee time) profit above the budget is set aside (it's never traded again; the
  owner withdraws it), a losing day isn't topped up, and after 2 losing days in a row it stops until the owner's check;
- a floor: if its money falls to `floor`, it sells everything, stops and pings the phone;
- every buy has a price cap (slippage) so it never chases a coin that already ran; every sell retries, and a coin it
  can't sell is reported, not forgotten;
- whatever it holds when a run ends is sold, and anything left from a run that was killed is sold at the next start.

Buys and sells are pump.fun's own instructions (bot/pump_direct.py), signed with the wallet key and sent through
Helius (the HELIUS_API_KEY secret) when it's set."""
from __future__ import annotations

import base64
import logging
import os
import time
from pathlib import Path

import yaml
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.transaction import VersionedTransaction

from . import pump_direct as pd

log = logging.getLogger("sniper")
CONFIG = Path("sniper.yaml")
DEFAULTS = {"live": False, "per_trade": 25.0, "max_open": 3, "budget": 95.0, "floor": 50.0, "slippage_buy": 0.30,
            "slippage_sell": 0.50, "priority_microlamports": 5_000_000, "reserve_sol": 0.02,
            # only trade in these hours (Milwaukee time, [from, until)); none = any hour
            "live_hours": None,
            # the owner's condition: at the start of its hours it goes live only if the direct buyer's real-price
            # results over the last `gate_hours` were at least `gate_min_ret` a bet on `gate_min_sold`+ sold snipes
            "gate_hours": 3, "gate_min_sold": 30, "gate_min_ret": 0.0}
PUBLIC_RPC = "https://api.mainnet-beta.solana.com"


def config(path: Path = CONFIG) -> dict:
    try:
        return {**DEFAULTS, **((yaml.safe_load(path.read_text()) or {}).get("sniper") or {})}
    except FileNotFoundError:
        return dict(DEFAULTS)


def rpc_url() -> str:
    key = os.environ.get("HELIUS_API_KEY", "").strip()
    return f"https://mainnet.helius-rpc.com/?api-key={key}" if key else PUBLIC_RPC


def close_ix(account: Pubkey, owner: Pubkey, token_program: Pubkey) -> Instruction:
    """Close the coin's token account after selling it all: its rent (about 0.002 SOL) comes back."""
    return Instruction(token_program, bytes([9]), [AccountMeta(account, False, True), AccountMeta(owner, False, True),
                                                   AccountMeta(owner, True, False)])


def signed(kp, ixs: list, blockhash, cu_limit: int, price: int) -> VersionedTransaction:
    from solders.compute_budget import set_compute_unit_limit, set_compute_unit_price

    msg = MessageV0.try_compile(kp.pubkey(), [set_compute_unit_limit(cu_limit), set_compute_unit_price(price), *ixs],
                                [], blockhash)
    return VersionedTransaction(msg, [kp])


def wallet_change(tx: dict, owner: str, mint: str) -> tuple[int, int]:
    """From a confirmed transaction (getTransaction, jsonParsed): (lamports the wallet gained, raw tokens it gained)."""
    meta, keys = tx["meta"], [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    i = keys.index(owner)
    sol = meta["postBalances"][i] - meta["preBalances"][i]
    amt = lambda bals: sum(int(b["uiTokenAmount"]["amount"]) for b in bals or [] if b.get("owner") == owner and b.get("mint") == mint)
    return sol, amt(meta.get("postTokenBalances")) - amt(meta.get("preTokenBalances"))


class Sniper:
    def __init__(self, kp, state: dict | None = None, sol_usd: float = 150.0, tell=None, cfg: dict | None = None):
        st = state or {}
        self.kp, self.owner = kp, (kp.pubkey() if kp else None)
        self.sol_usd, self.tell = sol_usd, tell or (lambda t, m: None)
        self.cfg = cfg or config()
        self.open: dict = st.get("open", {})            # mint -> {tokens, spent (lamports), prog, t, ...}
        self.trades: list = st.get("trades", [])[-1000:]
        self.plan: dict = st.get("plan") or {"day": None, "day_pnl": 0.0, "streak": 0, "paused": None,
                                             "set_aside": 0.0, "pnl": 0.0, "stopped": None}
        self.stats: dict = st.get("stats", {})
        self.curve = None                                 # the lab's curve math (mint, lamports) -> tokens
        self.program_of = None
        self.fee = None
        self.queue: list = []
        self.busy: set = set()
        self.gate = None                                  # (hours) -> (sold, average real return): the direct buyer
        self._bal = (0.0, None)                          # (when, the wallet's SOL in lamports), checked every 20 s

    def to_state(self) -> dict:
        return {"open": self.open, "trades": self.trades[-1000:], "plan": self.plan, "stats": self.stats}

    # ---- the rules ----
    def money(self) -> float:
        """Its money in dollars: the budget plus results, less what's been set aside."""
        return self.cfg["budget"] + self.plan["pnl"] - self.plan["set_aside"]

    def window(self, now: float | None = None) -> str | None:
        """None inside its hours (or when it has none); otherwise why not. At the start of each window it checks the
        owner's condition once and pings the phone either way."""
        hours = self.cfg.get("live_hours")
        if not hours:
            return None
        import datetime
        from zoneinfo import ZoneInfo

        lt = datetime.datetime.fromtimestamp(now or time.time(), ZoneInfo("America/Chicago"))
        a, b = int(hours[0]), int(hours[1])
        inside = (a <= lt.hour < b) if a < b else (lt.hour >= a or lt.hour < b)
        if not inside:
            return "outside its hours"
        key = f"{(lt - datetime.timedelta(hours=(lt.hour - a) % 24)).strftime('%Y-%m-%d')} {a}"
        g = self.plan.get("gate") or {}
        if g.get("key") != key:
            sold, ret = self.gate(self.cfg["gate_hours"]) if self.gate else (0, None)
            ok = sold >= self.cfg["gate_min_sold"] and ret is not None and ret >= self.cfg["gate_min_ret"]
            g = self.plan["gate"] = {"key": key, "ok": ok, "sold": sold, "ret": ret}
            span = f"{a % 12 or 12}-{b % 12 or 12} {'am' if b <= 12 else 'pm'}"
            facts = (f"over the last {self.cfg['gate_hours']} hours the practice direct buyer's real prices were "
                     f"{ret:+.1%} a bet on {sold} sold snipes" if ret is not None else
                     f"the practice direct buyer sold only {sold} snipes in the last {self.cfg['gate_hours']} hours")
            if ok:
                self.tell("🎯 Sniper is live", f"Trading real money {span}: {facts}. Money: ${self.money():,.2f}.")
            else:
                self.tell("🎯 Sniper stays off tonight", f"Your condition wasn't met: {facts} (needs "
                          f"{self.cfg['gate_min_ret']:+.0%} or better on {self.cfg['gate_min_sold']}+). No trades, "
                          f"money untouched: ${self.money():,.2f}.")
        return None if g["ok"] else "the condition wasn't met"

    def can_buy(self, mint: str) -> str | None:
        c, p = self.cfg, self.plan
        if not c.get("live") or self.kp is None:
            return "off"
        why = self.window()
        if why:
            return why
        if p.get("stopped"):
            return "stopped at the floor"
        if p.get("paused"):
            return "paused after 2 losing days"
        if mint in self.open or mint in self.busy:
            return "already holding it"
        if len(self.open) + len(self.busy) >= c["max_open"]:
            return "full"
        in_coins = sum(o["spent"] for o in self.open.values()) / 1e9 * self.sol_usd + c["per_trade"] * len(self.busy)
        if self.money() - in_coins < c["per_trade"]:
            return "not enough left in its budget"
        return None

    def count(self, what: str):
        self.stats[what] = self.stats.get(what, 0) + 1

    def settle_day(self, day: str):
        """Midnight: set aside profit above the budget; count losing days; 2 in a row pauses it."""
        p = self.plan
        if p["day"] is None:
            p["day"] = day
            return
        if day == p["day"]:
            return
        result = p["day_pnl"]
        if result > 0:
            p["streak"] = 0
            extra = max(0.0, self.money() - self.cfg["budget"])
            p["set_aside"] += extra
            self.tell("🎯 Sniper, " + p["day"], f"{result:+,.2f} today. Set aside ${extra:,.2f} (yours to withdraw); "
                      f"set aside so far ${p['set_aside']:,.2f}. It trades on with ${self.money():,.2f}.")
        elif result < 0:
            p["streak"] += 1
            if p["streak"] >= 2:
                p["paused"] = p["day"]
                self.tell("🎯 Sniper paused", f"2 losing days in a row ({result:+,.2f} today). It stopped buying until "
                          f"your check: tell Claude to restart it. Money: ${self.money():,.2f}.")
            else:
                self.tell("🎯 Sniper, " + p["day"], f"{result:+,.2f} today (losing day 1 of 2). Money: ${self.money():,.2f}.")
        p["day"], p["day_pnl"] = day, 0.0

    # ---- the lab's decisions ----
    def lab_buy(self, mint: str, now: float, lab_tokens=None):
        if self.can_buy(mint) is None:
            self.busy.add(mint)
            self.queue.append(("buy", mint, now))

    def lab_sell(self, mint: str, now: float, why: str = ""):
        if mint in self.open:
            self.queue.append(("sell", mint, now, why))

    def lab_result(self, mint: str, ret: float):
        for t in reversed(self.trades[-30:]):
            if t["mint"] == mint and "lab_ret" not in t:
                t["lab_ret"] = round(ret, 4)
                return
        if mint in self.open:
            self.open[mint]["lab_ret"] = round(ret, 4)

    # ---- talking to the network ----
    async def _rpc(self, session, method: str, params: list):
        async with session.post(rpc_url(), json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                                timeout=10) as r:
            d = await r.json(content_type=None)
        if d.get("error"):
            raise RuntimeError(f"{method}: {d['error'].get('message', d['error'])}")
        return d["result"]

    async def _send(self, session, tx) -> tuple[str | None, str, dict | None]:
        """Send, wait for it to confirm (up to 25 s), and read back what it did. (signature, outcome, transaction)"""
        import asyncio

        sig = await self._rpc(session, "sendTransaction", [base64.b64encode(bytes(tx)).decode(),
                                                           {"encoding": "base64", "skipPreflight": True, "maxRetries": 3}])
        end = time.time() + 25
        while time.time() < end:
            await asyncio.sleep(0.6)
            st = (await self._rpc(session, "getSignatureStatuses", [[sig]]))["value"][0]
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                if st.get("err"):
                    return sig, f"failed: {st['err']}", None
                for _ in range(5):
                    tx = await self._rpc(session, "getTransaction", [sig, {"encoding": "jsonParsed", "commitment": "confirmed",
                                                                           "maxSupportedTransactionVersion": 0}])
                    if tx:
                        return sig, "ok", tx
                    await asyncio.sleep(1)
                return sig, "ok", None
        return sig, "not confirmed in 25 s", None

    async def _blockhash(self, session):
        from solders.hash import Hash

        return Hash.from_string((await self._rpc(session, "getLatestBlockhash", [{"commitment": "confirmed"}]))["value"]["blockhash"])

    async def wallet_lamports(self, session) -> int | None:
        if time.time() - self._bal[0] > 20 or self._bal[1] is None:
            try:
                self._bal = (time.time(), (await self._rpc(session, "getBalance", [str(self.owner), {"commitment": "processed"}]))["value"])
            except Exception as ex:
                log.warning("balance: %s", ex)
        return self._bal[1]

    async def buy(self, session, mint: str, decided: float):
        c, owner = self.cfg, self.owner
        try:
            lamports = int(c["per_trade"] / self.sol_usd * 1e9)
            have = await self.wallet_lamports(session)
            # the buy, its token account (~0.002 SOL), fees, and the SOL always kept back
            if have is None or have < lamports + 0.004e9 + c["reserve_sol"] * 1e9:
                self.count("buy skipped: not enough SOL in the wallet")
                return
            prog = (self.program_of(mint) if self.program_of else None) or (
                (await self._rpc(session, "getAccountInfo", [mint, {"encoding": "base64", "commitment": "processed"}]))
                .get("value") or {}).get("owner")
            if not prog:
                self.count("buy: coin not found")
                return
            expect = self.curve(mint, lamports) if self.curve else None
            min_tok = int(expect * 1e6 * (1 - c["slippage_buy"])) if expect else 1
            m, tp = Pubkey.from_string(mint), Pubkey.from_string(prog)
            tx = signed(self.kp, [pd.create_token_account(owner, owner, m, tp), pd.buy_ix(m, owner, tp, lamports, min_tok)],
                        await self._blockhash(session), 150_000, c["priority_microlamports"])
            sig, how, info = await self._send(session, tx)
            if how != "ok" or not info:
                self.count(f"buy {how[:50]}")
                return
            sol, tokens = wallet_change(info, str(owner), mint)
            if tokens <= 0:
                self.count("buy: landed but no tokens")
                return
            self.count("buy ok")
            self._bal = (time.time(), (self._bal[1] or 0) + sol)
            self.open[mint] = {"mint": mint, "tokens": tokens, "spent": -sol, "prog": prog, "t": round(decided),
                               "landed_s": round(time.time() - decided, 2), "buy_sig": sig}
        except Exception as ex:
            self.count(f"buy error: {type(ex).__name__}")
            log.warning("buy %s: %s", mint, ex)
        finally:
            self.busy.discard(mint)

    async def sell(self, session, mint: str, decided: float, why: str = ""):
        import asyncio

        o = self.open.get(mint)
        if not o or o.get("selling"):
            return
        o["selling"] = True
        c, owner = self.cfg, self.owner
        m, tp = Pubkey.from_string(mint), Pubkey.from_string(o["prog"])
        # first: does the wallet still hold it? (a sale that landed just before a run was stopped may not have been
        # saved; trying to sell a coin that's gone would fail and still pay its fee, again and again)
        try:
            bal = await self._rpc(session, "getTokenAccountBalance", [str(pd.ata(owner, m, tp)), {"commitment": "confirmed"}])
            held = int(((bal or {}).get("value") or {}).get("amount") or 0)
        except RuntimeError as ex:                                  # "could not find account": it was sold and closed
            held = 0 if "could not find" in str(ex).lower() or "invalid param" in str(ex).lower() else None
        except Exception:
            held = None
        if held == 0:
            self.open.pop(mint, None)
            self.count("sell: already gone from the wallet")
            return
        if held:
            o["tokens"] = held
        floor_frac = [1 - c["slippage_sell"], 0.25, 0.0]           # each retry accepts less, the last anything
        for attempt, frac in enumerate(floor_frac):
            try:
                res = await self._rpc(session, "getAccountInfo", [str(pd.pda(b"bonding-curve", bytes(m))),
                                                                  {"encoding": "base64", "commitment": "processed"}])
                st = pd.curve_state((res or {}).get("value"))
                if st and st[2]:
                    break                                           # the curve finished: it can't be sold here
                expect = 0
                if st:
                    vsol, vtok, _ = st
                    fee = (self.fee(mint) if self.fee else None) or 0.0125
                    tok = o["tokens"] / 1e6
                    expect = (vsol - vsol * vtok / (vtok + tok)) * (1 - fee)
                tx = signed(self.kp, [pd.sell_ix(m, owner, tp, o["tokens"], int(expect * 1e9 * frac)),
                                      close_ix(pd.ata(owner, m, tp), owner, tp)],
                            await self._blockhash(session), 120_000, c["priority_microlamports"])
                sig, how, info = await self._send(session, tx)
                if how == "ok" and info:
                    sol, tokens = wallet_change(info, str(owner), mint)
                    self._closed(mint, sol, why, sig, decided)
                    return
                self.count(f"sell try {attempt + 1}: {how[:40]}")
            except Exception as ex:
                self.count(f"sell error: {type(ex).__name__}")
                log.warning("sell %s: %s", mint, ex)
            await asyncio.sleep(2)
        o["selling"] = False
        o["stuck"] = o.get("stuck", 0) + 1
        self.count("sell: stuck")
        if o["stuck"] == 1:
            self.tell("🎯 Sniper: couldn't sell a coin", f"{mint}: 3 tries failed (or its curve finished). It's still in the "
                      "wallet; it will keep trying, or sell it in Solflare.")

    def _closed(self, mint: str, received: int, why: str, sig: str, decided: float):
        o = self.open.pop(mint)
        pnl = (received - o["spent"]) / 1e9 * self.sol_usd
        self.plan["pnl"] += pnl
        self.plan["day_pnl"] += pnl
        self.trades.append({**{k: v for k, v in o.items() if k not in ("selling",)}, "received": received,
                            "pnl": round(pnl, 4), "ret": round(received / o["spent"] - 1, 4) if o["spent"] else None,
                            "why": why, "sold": round(time.time()), "sell_sig": sig,
                            "sell_s": round(time.time() - decided, 2)})
        self.count("sell ok")
        if self.money() <= self.cfg["floor"] and not self.plan.get("stopped"):
            self.plan["stopped"] = round(time.time())
            self.tell("🎯 Sniper stopped at its floor", f"Its money fell to ${self.money():,.2f} (floor ${self.cfg['floor']:,.0f}). "
                      "It sold what it held and stopped buying. Tell Claude when you've looked.")

    async def run(self, session, stop_at: float):
        import asyncio

        tasks = set()
        while time.time() < stop_at:
            while self.queue:
                item = self.queue.pop(0)
                coro = self.buy(session, item[1], item[2]) if item[0] == "buy" else self.sell(session, *item[1:])
                t = asyncio.create_task(coro)
                tasks.add(t)
                t.add_done_callback(tasks.discard)
            for mint, o in list(self.open.items()):                 # stuck coins: try again every 2 minutes, 10 times
                if o.get("stuck") and o["stuck"] <= 10 and not o.get("selling") and time.time() - o.get("retry_t", 0) > 120:
                    o["retry_t"] = time.time()
                    t = asyncio.create_task(self.sell(session, mint, time.time(), "retry"))
                    tasks.add(t)
                    t.add_done_callback(tasks.discard)
            await asyncio.sleep(0.05)
        if tasks:
            await asyncio.wait(tasks, timeout=20)

    async def sell_all(self, session, why: str):
        import asyncio

        await asyncio.gather(*(self.sell(session, m, time.time(), why) for m in list(self.open)), return_exceptions=True)

    # ---- reporting ----
    def line(self) -> str:
        p = self.plan
        done = [t for t in self.trades if p.get("day") and time.time() - t.get("sold", 0) <= 3600]
        state = ("OFF" if not self.cfg.get("live") else "STOPPED at its floor" if p.get("stopped")
                 else "PAUSED (2 losing days; tell Claude to restart it)" if p.get("paused") else "on")
        txt = (f"Sniper (REAL money, {state}): ${self.money():,.2f}; today {p['day_pnl']:+,.2f}; set aside ${p['set_aside']:,.2f}. "
               f"Last hour: {len(done)} trades, {sum(t['pnl'] for t in done):+,.2f}")
        return txt + (f"; holding {len(self.open)}" if self.open else "") + "."


async def check(usd: float = 1.0, hold_s: float = 12.0, tell=None) -> dict:
    """One small REAL round trip to prove the whole path: wait for a brand-new coin, buy `usd` of it straight on
    pump.fun from the bot's wallet, hold `hold_s` seconds, sell it all and close its token account."""
    import asyncio
    import json

    import aiohttp

    from .launch_lab import PUMP, WS, buy_tokens, pump_events, sol_price
    from .solbot import keypair

    kp = keypair()
    if kp is None:
        raise SystemExit("No SOLANA_BOT_KEY secret: nothing to check with.")
    sn = Sniper(kp, sol_usd=sol_price(), tell=tell, cfg={**DEFAULTS, "live": True, "per_trade": usd, "budget": 1e9,
                                                         "floor": -1e9, "max_open": 1, "slippage_buy": 0.5})
    progs: dict = {}
    sn.program_of = progs.get
    async with aiohttp.ClientSession() as s:
        target = None
        async with s.ws_connect(WS, heartbeat=20) as ws:
            await ws.send_json({"jsonrpc": "2.0", "id": 1, "method": "logsSubscribe",
                                "params": [{"mentions": [PUMP]}, {"commitment": "processed"}]})
            end = time.time() + 120
            while target is None and time.time() < end:
                msg = await ws.receive()
                v = (json.loads(msg.data).get("params") or {}).get("result", {}).get("value")
                if not v or v.get("err"):
                    continue
                for e in pump_events(v.get("logs") or []):
                    if e["kind"] == "create" and e.get("token_program"):
                        progs[e["mint"]] = e["token_program"]
                    elif (e["kind"] == "trade" and e["mint"] in progs and e["buy"]
                          and e["real_sol"] - e["sol"] < 1.0):            # its first buy: brand new
                        target = e
                        break
        if target is None:
            return {"outcome": "no new coin in 2 minutes"}
        mint = target["mint"]
        sn.curve = lambda m, lam: buy_tokens(target["vsol"], target["vtok"], lam / 1e9, target["fee"])
        t0 = time.time()
        await sn.buy(s, mint, t0)
        if mint not in sn.open:
            return {"outcome": "the buy didn't go through", "mint": mint, "stats": sn.stats}
        o = dict(sn.open[mint])
        await asyncio.sleep(hold_s)
        await sn.sell(s, mint, time.time(), "check")
        if mint in sn.open:
            return {"outcome": "bought, but the sale didn't go through (it's still in the wallet)", "mint": mint,
                    "buy": o, "stats": sn.stats}
        t = sn.trades[-1]
        return {"outcome": "ok", "mint": mint, "usd": usd, "buy_landed_s": o["landed_s"], "tokens": o["tokens"],
                "spent_sol": o["spent"] / 1e9, "got_back_sol": t["received"] / 1e9, "result_usd": t["pnl"],
                "sell_landed_s": t["sell_s"], "buy_sig": o["buy_sig"], "sell_sig": t["sell_sig"],
                "note": "spent includes network fees, the coin's token account (refunded on the sale) and, the first "
                        "time only, pump.fun's per-wallet volume account (about 0.0018 SOL, not refunded)"}
