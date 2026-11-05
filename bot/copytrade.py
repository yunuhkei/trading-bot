"""Copy the smart wallets (models/smart_wallets.json, found by bot/smart_wallets.py) within seconds, with pretend money.

It keeps a live connection to Helius (the HELIUS_API_KEY secret) that announces every transaction of every smart wallet
about a second after it lands. For each one it reads what the wallet bought or sold:
- a smart wallet BUYS a coin: the bot pretend-buys `per_trade` of it right away at Jupiter's real price, if the coin
  passes the rug check and its pool has `min_liquidity`+ (about 2-5 seconds behind the wallet in total);
- a wallet the bot copied SELLS that coin: the bot sells it too;
- and every minute: the 20% stop-loss, and a sell after `max_hold_hours` whatever happens.
When `alert_wallets` (2)+ different smart wallets buy the same coin within 6 hours, your phone gets a normal ping; the
pretend trades ping silently. Settings: solbot.yaml `copytrade:`. State: copytrade_state.json. The Thursday 3 pm
report covers it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger("copytrade")
STATE = Path("copytrade_state.json")
WALLETS = Path("models/smart_wallets.json")
QUOTES = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"}          # SOL, USDC, USDT: what coins are bought with
DEFAULTS = {"enabled": True, "cash": 300, "per_trade": 30, "follow": 30, "alert_wallets": 2, "min_liquidity": 20_000,
            "stop_loss": 0.20, "max_hold_hours": 48, "max_reads_per_wallet_hour": 60, "max_reads_per_day": 1500,
            "report_at": "15:00", "report_days": ["Thursday"], "timezone": "America/Chicago"}
# Real money (solbot.yaml copytrade: live:): only the wallets the finder approved (their whole record passes), small
# trades, few at once. budget 0 = whatever USDC is in the bot's wallet (refills count right away).
LIVE = {"enabled": False, "budget": 0, "per_trade": 6, "max_open": 2, "max_cost": 0.03, "stop_below": 3.0,
        "drop_after_losses": 4}
STATE_LIVE = Path("copytrade_state_live.json")


def ws_url() -> str | None:
    key = os.environ.get("HELIUS_API_KEY", "").strip()
    return f"wss://mainnet.helius-rpc.com/?api-key={key}" if key else None


def wallet_swaps(tx: dict | None, wallet: str) -> list[tuple[str, float]]:
    """(coin, change in the wallet's balance of it) for a transaction the wallet signed itself: + bought, - sold.
    SOL/USDC/USDT moves are what it paid or got, not the trade."""
    if not tx or (tx.get("meta") or {}).get("err"):
        return []
    keys = tx["transaction"]["message"]["accountKeys"]
    if not any(isinstance(k, dict) and k.get("signer") and k.get("pubkey") == wallet for k in keys):
        return []                                    # someone else signed it (a relayer): not a trade we can copy
    meta, ch = tx["meta"], {}
    for rows, sign in ((meta.get("preTokenBalances"), -1), (meta.get("postTokenBalances"), 1)):
        for b in rows or []:
            if b.get("owner") == wallet and b.get("mint") not in QUOTES:
                ch[b["mint"]] = ch.get(b["mint"], 0.0) + sign * float(b["uiTokenAmount"].get("uiAmount") or 0)
    return [(m, d) for m, d in ch.items() if abs(d) > 0]


class Copier:
    """One account copying the smart wallets: pretend money (every wallet on the list) or, with live=True, the bot's
    real wallet (only the approved wallets, see LIVE)."""

    def __init__(self, settings: dict, tell, quiet_tell=None, now=time.time, live: bool = False, wallet=None):
        from .solbot import BudgetWallet, PaperWallet

        base = {**DEFAULTS, **(settings.get("copytrade") or {})}
        self.live, self.cfg = live, ({**base, **LIVE, **(base.get("live") or {})} if live else base)
        self.path = STATE_LIVE if live else STATE
        self.tag = "COPY LIVE: " if live else "COPY PRACTICE: "
        self.tell, self.now = tell, now
        self.quiet = tell if live else (quiet_tell or tell)            # real-money trades always ping out loud
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.state.setdefault("started", self.now())
        self.positions = self.state.setdefault("positions", {})
        self.kp = None
        data = json.loads(WALLETS.read_text()) if WALLETS.exists() else {}
        if live:
            if wallet is None:
                from .solbot import LiveWallet, keypair

                self.kp = keypair()
                if self.kp is None:
                    raise RuntimeError("no wallet key (the SOLANA_BOT_KEY secret)")
                wallet = LiveWallet(self.kp)
            budget = float(self.cfg.get("budget") or 0)
            if budget:
                self.state.setdefault("cash", min(wallet.cash(), budget))
                wallet = BudgetWallet(wallet, self.state)
            self.wallet = wallet
            self.wallets = list(data.get("approved") or [])
        else:
            self.wallet = PaperWallet(self.state, float(self.cfg["cash"]))
            self.wallets = list((data.get("wallets") or {}))[: int(self.cfg["follow"])]
        self.others: list[Copier] = []                                  # other accounts fed by the same listener
        self.reads: dict[str, list[float]] = {}

    def save(self):
        self.state["trades"] = self.state.get("trades", [])[-500:]
        self.path.write_text(json.dumps(self.state, indent=1))
        for o in self.others:
            o.save()

    def can_read(self, wallet: str) -> bool:
        """Credit guard (the free plan): at most `max_reads_per_wallet_hour` per wallet and `max_reads_per_day` total."""
        now = self.now()
        mine = [t for t in self.reads.get(wallet, []) if now - t < 3600]
        day = self.state.setdefault("reads_day", {})
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        if day.get("day") != today:
            day.update(day=today, n=0)
        if len(mine) >= int(self.cfg["max_reads_per_wallet_hour"]) or day["n"] >= int(self.cfg["max_reads_per_day"]):
            return False
        self.reads[wallet] = mine + [now]
        day["n"] += 1
        return True

    def on_swap(self, wallet: str, mint: str, change: float, sig: str = ""):
        from .solbot import USDC, USDC_DECIMALS, dex_info, prices, safety_check
        from .signals import money

        now = self.now()
        if change > 0:                                   # a smart wallet bought
            seen = self.state.setdefault("seen", {}).setdefault(mint, [])
            seen.append([now, wallet])
            seen[:] = [s for s in seen if now - s[0] < 6 * 3600]
            buyers = {w for _, w in seen}
            info = None
            try:
                info = (dex_info([mint]) or {}).get(mint)
            except Exception as e:
                log.warning("%s: no DEX info: %s", mint, e)
            name = (info or {}).get("symbol") or mint[:6]
            told = self.state.setdefault("alerted", {})
            if not self.live and len(buyers) >= int(self.cfg["alert_wallets"]) and now - told.get(mint, 0) > 6 * 3600:
                told[mint] = now
                self.tell(f"🧠 {len(buyers)} smart wallets just bought {name}",
                          f"{len(buyers)} of the wallets that bought bottoms and sold tops on other coins bought {name} in the "
                          f"last 6 hours" + (f" (pool {money(info['liq'])}, {money(info['vol24'])} traded in 24 h)" if info else "")
                          + f". https://dexscreener.com/solana/{mint}")
            if mint in self.positions:
                if wallet not in self.positions[mint]["wallets"]:
                    self.positions[mint]["wallets"].append(wallet)
                return
            if self.live:
                if (self.state.get("dropped") or {}).get(wallet) or len(self.positions) >= int(self.cfg["max_open"]):
                    return
                try:
                    self.wallet.refresh()                # the real balance now (refills count right away)
                except Exception as e:
                    log.warning("balance: %s", e)
                    return
                if self.value() < float(self.cfg["stop_below"]):
                    if not self.state.get("low_told"):
                        self.state["low_told"] = now
                        self.tell(f"{self.tag}paused: the account is under {money(float(self.cfg['stop_below']))}",
                                  f"It's about {money(self.value())}, so it stops buying (anything it holds is still sold "
                                  f"when the wallet sells or at the stop). Refill the wallet with USDC and it starts again.")
                    return
                self.state.pop("low_told", None)
            usd = min(float(self.cfg["per_trade"]), self.wallet.cash())
            if usd < 5 or not info or info.get("liq", 0) < float(self.cfg["min_liquidity"]):
                return
            ok, why = safety_check(mint)
            if not ok:
                log.warning("copy %s skipped: %s", name, why)
                return
            try:
                fill = self.wallet.swap(USDC, mint, int(usd * 10 ** USDC_DECIMALS), float(self.cfg.get("max_cost", 0.05)))
                dec = int((prices([mint]).get(mint) or {}).get("decimals") or 6)
            except Exception as e:
                log.warning("copy %s failed: %s", name, e)
                return
            spent = fill.get("in", usd * 10 ** USDC_DECIMALS) / 10 ** USDC_DECIMALS
            tokens = fill["out"] / 10 ** dec
            self.positions[mint] = {"name": name, "raw": fill["out"], "decimals": dec, "cost": spent,
                                    "entry": spent / tokens if tokens else 0, "t": now, "wallets": [wallet], "sig": sig}
            self.state.setdefault("trades", []).append({"t": now, "action": "BUY", "what": name, "usd": spent,
                                                        "wallet": wallet, "tx": fill.get("tx")})
            self.quiet(f"{self.tag}BOUGHT {money(spent)} of {name}",
                       f"Smart wallet {wallet[:4]}…{wallet[-4:]} just bought it (seconds ago); copied with "
                       f"{'REAL' if self.live else 'pretend'} money. Sells when that wallet sells, at "
                       f"-{float(self.cfg['stop_loss']):.0%}, or after {float(self.cfg['max_hold_hours']):g} h."
                       + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))
        elif mint in self.positions and wallet in self.positions[mint]["wallets"]:
            self.sell(mint, f"smart wallet {wallet[:4]}…{wallet[-4:]} sold it")

    def sell(self, mint: str, why: str) -> bool:
        from .solbot import USDC, USDC_DECIMALS
        from .signals import money

        p = self.positions[mint]
        if self.live:
            try:
                self.wallet.refresh()
                raw = self.wallet.held_raw(mint)
            except Exception as e:
                log.warning("balance: %s", e)
                p["pending"] = why
                return False
            if raw <= 0 and self.now() - p["t"] < 600:   # just bought: the balance may not show it yet
                p["pending"] = why
                return False
        else:
            raw = int(p["raw"])
        if raw <= 0:                                     # nothing left in the wallet (sold by hand): forget it
            self.positions.pop(mint)
            self.tell(f"{self.tag}{p['name']} is gone from the wallet", "It wasn't sold by the bot, so it stops tracking it.")
            return True
        try:
            fill = self.wallet.swap(mint, USDC, int(raw))
        except Exception as e:
            log.warning("sell %s failed: %s", p["name"], e)
            p["pending"] = why                           # tried again every minute
            return False
        got = fill["out"] / 10 ** USDC_DECIMALS
        result = got / p["cost"] - 1 if p["cost"] else 0.0
        self.positions.pop(mint)
        self.state.setdefault("trades", []).append({"t": self.now(), "action": "SELL", "what": p["name"], "usd": got,
                                                    "result": result, "wallets": p["wallets"], "tx": fill.get("tx")})
        self.quiet(f"{self.tag}SOLD {p['name']} for {money(got)} ({result:+.1%})",
                   f"{why[0].upper() + why[1:]}. Bought for {money(p['cost'])}, {got - p['cost']:+,.2f} after fees. "
                   f"{'Account' if self.live else 'Pretend account'} about {money(self.value())}."
                   + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))
        if self.live:
            self.judge(p["wallets"], result)
            if self.kp is not None:
                try:
                    from .solbot import close_empty_accounts

                    close_empty_accounts(self.kp)        # get the coin's ~0.002 SOL account deposit back
                except Exception as e:
                    log.warning("closing empty accounts: %s", e)
        return True

    def judge(self, wallets: list[str], result: float):
        """Real-money record per copied wallet: one whose last `drop_after_losses` copies all lost is dropped."""
        from .signals import money

        n = int(self.cfg.get("drop_after_losses") or 0)
        for w in wallets:
            res = self.state.setdefault("by_wallet", {}).setdefault(w, [])
            res.append(result)
            if n and len(res) >= n and all(r <= 0 for r in res[-n:]) and not self.state.setdefault("dropped", {}).get(w):
                self.state["dropped"][w] = self.now()
                self.tell(f"{self.tag}stopped copying {w[:4]}…{w[-4:]}",
                          f"Its last {n} copied trades all lost (total {sum(res[-n:]):+.0%}), so real money stops following "
                          f"it. The finder re-checks every wallet on Mondays.")

    def value(self) -> float:
        return self.wallet.cash() + sum(p["cost"] for p in self.positions.values())

    def check_positions(self):
        """Every minute: the stop-loss and the time limit."""
        from .solbot import prices

        if not self.positions:
            return
        try:
            px = prices(list(self.positions))
        except Exception as e:
            log.warning("prices: %s", e)
            return
        now = self.now()
        for mint, p in list(self.positions.items()):
            if p.get("pending"):                         # a sell that failed: try again
                self.sell(mint, p["pending"])
                continue
            price = float((px.get(mint) or {}).get("usdPrice") or 0)
            if price and p["entry"] and price <= p["entry"] * (1 - float(self.cfg["stop_loss"])):
                self.sell(mint, f"stop-loss: down {price / p['entry'] - 1:.0%} from the buy")
            elif now - p["t"] > float(self.cfg["max_hold_hours"]) * 3600:
                self.sell(mint, f"held {float(self.cfg['max_hold_hours']):g} hours")

    def handle(self, wallet: str, sig: str):
        """A smart wallet's new transaction: read it and copy any buy or sell."""
        from .smart_wallets import rpc

        if not self.can_read(wallet) and not any(c.live and wallet in c.wallets for c in self.copiers()):
            return                                       # over the free plan's budget (never for a real-money wallet)
        tx = None
        for _ in range(3):                               # just confirmed: may need a moment to be readable
            try:
                tx = rpc("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1,
                                                  "commitment": "confirmed"}])
            except Exception as e:
                log.warning("tx %s: %s", sig[:8], e)
            if tx:
                break
            time.sleep(0.7)
        swaps = wallet_swaps(tx, wallet)
        for c in self.copiers():
            if wallet in c.wallets:
                for mint, change in swaps:
                    try:
                        c.on_swap(wallet, mint, change, sig)
                    except Exception as e:
                        log.warning("%scopy of %s: %s", c.tag, mint[:6], e)

    def copiers(self) -> list["Copier"]:
        return [self, *self.others]

    def watched(self) -> list[str]:
        return list(dict.fromkeys(w for c in self.copiers() for w in c.wallets))

    def check_all(self):
        for c in self.copiers():
            try:
                c.check_positions()
            except Exception as e:
                log.warning("%schecking positions: %s", c.tag, e)

    async def listen(self, seconds: float):
        """Watch every smart wallet live for `seconds` (reconnects if the connection drops)."""
        import aiohttp

        url, end = ws_url(), time.time() + seconds
        loop = asyncio.get_running_loop()
        while time.time() < end:
            try:
                async with aiohttp.ClientSession() as sess:
                    async with sess.ws_connect(url, heartbeat=30) as ws:
                        subs, pending = {}, {}
                        watch = self.watched()
                        for i, w in enumerate(watch, 1):
                            pending[i] = w
                            await ws.send_json({"jsonrpc": "2.0", "id": i, "method": "logsSubscribe",
                                                "params": [{"mentions": [w]}, {"commitment": "confirmed"}]})
                        print(f"Watching {len(watch)} smart wallets live.", flush=True)
                        last = time.time()
                        while time.time() < end:
                            try:
                                msg = await ws.receive(timeout=max(0.1, min(20, end - time.time())))
                            except asyncio.TimeoutError:
                                msg = None
                            if msg is not None:
                                if msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                    break
                                if msg.type == aiohttp.WSMsgType.TEXT:
                                    j = json.loads(msg.data)
                                    if "id" in j and "result" in j and j["id"] in pending:
                                        subs[j["result"]] = pending.pop(j["id"])
                                    elif j.get("method") == "logsNotification":
                                        v = j["params"]["result"]["value"]
                                        w = subs.get(j["params"]["subscription"])
                                        if w and not v.get("err"):
                                            await loop.run_in_executor(None, self.handle, w, v["signature"])
                            if time.time() - last > 60:
                                await loop.run_in_executor(None, self.check_all)
                                self.save()
                                last = time.time()
            except Exception as e:
                log.warning("connection: %s (reconnecting)", e)
                await asyncio.sleep(5)
        self.save()


def report_lines(state: dict, now: float, hours: float, value: float | None = None, live: bool = False) -> list[str]:
    """For the Thursday report."""
    from .signals import money

    sells = [t for t in state.get("trades", []) if t["action"] == "SELL"]
    recent = [t for t in sells if now - t["t"] <= hours * 3600]
    made = lambda ts: sum(t["usd"] * t["result"] / (1 + t["result"]) for t in ts)
    if value is None:
        value = float(state.get("paper_cash", 0)) + sum(p["cost"] for p in state.get("positions", {}).values())
    head = ("COPY LIVE (approved wallets only; REAL money)" if live
            else "COPY PRACTICE (follows the smart wallets; pretend money)")
    if not sells:
        return [f"{head}: no finished trades yet, holding {len(state.get('positions', {}))}, account about {money(value)}."]
    return [f"{head}: last {hours:.0f} h {len(recent)} trades, "
            f"{sum(t['result'] > 0 for t in recent)}-{sum(t['result'] <= 0 for t in recent)}, {made(recent):+,.2f}. "
            f"Since it started: {len(sells)} trades, {sum(t['result'] > 0 for t in sells) / len(sells):.0%} won, "
            f"{made(sells):+,.2f}; account about {money(value)}."]


def status_text(now: float | None = None) -> str:
    """Both accounts' saved records (no trading, no keys needed): results, open coins, and anything stopping real money."""
    import datetime

    now = now or time.time()
    out = []
    for path, live in ((STATE, False), (STATE_LIVE, True)):
        if not path.exists():
            out.append(f"{'COPY LIVE' if live else 'COPY PRACTICE'}: no saved record.")
            continue
        st = json.loads(path.read_text())
        out += report_lines(st, now, (now - st.get("started", now)) / 3600, live=live)
        when = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%b %d %H:%M UTC")
        for mint, pos in st.get("positions", {}).items():
            out.append(f"  holding {pos.get('name', mint[:6])}: cost ${pos.get('cost', 0):.2f}, bought {when(pos.get('t', now))}")
        if live:
            for w, t in (st.get("dropped") or {}).items():
                out.append(f"  DROPPED wallet {w[:4]}…{w[-4:]} at {when(t) if isinstance(t, (int, float)) else t}")
            if st.get("low_told"):
                out.append(f"  PAUSED for low balance since {when(st['low_told'])}")
            sells = [t for t in st.get("trades", []) if t["action"] == "SELL"]
            for t in sells[-8:]:
                out.append(f"  sold {t.get('what')}: {t.get('result', 0):+.1%} on ${t.get('usd', 0):.2f} ({when(t['t'])})")
    return "\n".join(out)


def run(settings_path: str = "solbot.yaml", minutes: float = 340):
    from .signals import alert_target, money, notify
    from .solbot import load_settings, report_due

    settings = load_settings(settings_path)
    cfg = {**DEFAULTS, **(settings.get("copytrade") or {})}
    if not cfg.get("enabled"):
        print("Copy-trading is off (solbot.yaml copytrade.enabled).")
        return
    if not ws_url():
        print("No HELIUS_API_KEY secret: the copy-trader needs it.")
        return

    def tell(title, msg, priority=None):
        log.warning("COPY %s: %s", title, msg)
        target = alert_target()
        if target:
            notify(target, title, msg, buy="SOLD" not in title or "(+" in title, priority=priority)

    c = Copier(settings, tell, lambda t, m: tell(t, m, "low"))
    live_cfg = {**LIVE, **(cfg.get("live") or {})}
    if live_cfg.get("enabled"):
        try:
            real = Copier(settings, tell, live=True)
            c.others.append(real)
            if "announced" not in real.state:
                real.state["announced"] = time.time()
                who = ", ".join(f"{w[:4]}…{w[-4:]}" for w in real.wallets) or "none yet"
                tell("💸 Copy trading with REAL money started",
                     f"Copies only the approved wallets ({who}): {money(float(real.cfg['per_trade']))} a trade, at most "
                     f"{real.cfg['max_open']} at once, sells when they sell, at -{float(real.cfg['stop_loss']):.0%} or after "
                     f"{float(real.cfg['max_hold_hours']):g} h. Stops buying under {money(float(real.cfg['stop_below']))}; "
                     f"wallet {real.wallet.address[:4]}…{real.wallet.address[-4:]} has about {money(real.wallet.cash())}.")
        except Exception as e:
            log.warning("real-money copying is off: %s", e)
            print(f"Real-money copying is off: {e}")
    if not c.watched():
        print("No smart wallets yet (run the smart-wallets workflow first).")
        return
    if "announced" not in c.state:
        c.state["announced"] = time.time()
        tell("🧠 Copy practice started", f"Following {len(c.wallets)} smart wallets live with pretend "
             f"${float(cfg['cash']):,.0f} (${float(cfg['per_trade']):,.0f} a trade). Its trades ping silently; you get a "
             f"normal ping when {cfg['alert_wallets']}+ of them buy the same coin.")
    end = time.time() + minutes * 60
    while time.time() < end:
        chunk = min(1800, end - time.time())
        asyncio.run(c.listen(chunk))
        day = report_due(time.time(), cfg["report_at"], cfg["timezone"], c.state.get("report_day"), cfg["report_days"])
        if day:
            since = c.state.get("reported_at", c.state["started"])
            c.state.update(report_day=day, reported_at=time.time())
            lines = report_lines(c.state, time.time(), (time.time() - since) / 3600)
            for o in c.others:
                lines += report_lines(o.state, time.time(), (time.time() - since) / 3600, o.value(), live=o.live)
            tell("📊 Copy trading: weekly report", "\n".join(lines))
        c.save()
