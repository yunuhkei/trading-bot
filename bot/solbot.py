"""Auto-trading brand-new Solana coins (your young-coin list, e.g. NIO on Fomo) with the dip-bounce rule, from a
wallet that belongs to the bot alone. Settings: solbot.yaml. Runs all day on GitHub (the "solbot" workflow).

What it does every 5 minutes, for each Solana coin in watchlist.young.txt:
- BUY (up to `per_trade` dollars of USDC) right after a fresh dip-bounce signal on the 5-minute chart (the same rule as
  your young-coin alerts, config.young.yaml), unless the swap would cost more than `max_cost` (fees + price impact).
- SELL when the price is back at its average (the rule's exit), or it's down `stop_loss` from the buy.
- Account = the wallet's USDC + the coins the bot bought. If it falls to `stop_below` or reaches `stop_above`, it sells
  everything, stops for good and tells you. To start again after a stop, delete solbot_stopped.json (or ask Claude).

Swaps go through Jupiter (the router most Solana apps use): Jupiter builds the swap, the bot signs it with the wallet
key (SOLANA_BOT_KEY secret) and Jupiter sends it. The bot never sends money anywhere else: it only swaps USDC for a coin
on your list and back. Keep only what you're willing to lose in that wallet (plus a little SOL for network fees).

`mode: dry_run` uses real Jupiter quotes (real fees and price impact) with pretend money and places no trades.
Every buy and sell (or would-be one) is sent to your phone.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
import time
from pathlib import Path

import pandas as pd
import yaml

log = logging.getLogger("solbot")
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_DECIMALS = 6
STOP_FILE = "solbot_stopped.json"
MIN_TRADE = 5.0          # dollars: smaller buys are skipped
MIN_SOL = 0.005          # the wallet needs a little SOL for network fees
RETRY_SECONDS, RETRY_FOR = 30, 240   # the price feed can lag 1-3 minutes: re-check until the new candle shows up
stale: list[str] = []    # coins whose just-finished candle wasn't in the feed yet at the last check


class TradeError(Exception):
    pass


# ---- Jupiter ----

def _jup_base() -> tuple[str, dict]:
    key = os.environ.get("JUPITER_API_KEY", "").strip()
    return ("https://api.jup.ag", {"x-api-key": key}) if key else ("https://lite-api.jup.ag", {})


def jup(path: str, params: dict | None = None, body: dict | None = None) -> dict:
    import requests

    base, headers = _jup_base()
    for attempt in range(3):
        r = (requests.post(base + path, json=body, headers=headers, timeout=40) if body is not None
             else requests.get(base + path, params=params, headers=headers, timeout=20))
        if r.status_code != 429:
            break
        time.sleep(5 * (attempt + 1))
    r.raise_for_status()
    return r.json()


def prices(mints: list[str]) -> dict[str, dict]:
    """mint -> {"usdPrice", "decimals", ...} from Jupiter's price feed."""
    if not mints:
        return {}
    data = jup("/price/v3", params={"ids": ",".join(mints)})
    return {m: v for m, v in data.items() if v and v.get("usdPrice")}


def balances(wallet: str) -> dict[str, dict]:
    """mint -> {"amount": raw, "uiAmount": ...}; native SOL is under "SOL"."""
    return jup(f"/ultra/v1/balances/{wallet}")


def order(in_mint: str, out_mint: str, amount_raw: int, taker: str | None = None) -> dict:
    params = {"inputMint": in_mint, "outputMint": out_mint, "amount": int(amount_raw)}
    if taker:
        params["taker"] = taker
    o = jup("/ultra/v1/order", params=params)
    if o.get("errorMessage") or o.get("error"):
        raise TradeError(o.get("errorMessage") or o.get("error"))
    return o


def cost(o: dict) -> float:
    """What the swap costs in fees + price impact, as a share of what goes in (0.01 = 1%)."""
    i, out = float(o.get("inUsdValue") or 0), float(o.get("outUsdValue") or 0)
    return 1 - out / i if i > 0 and out > 0 else 0.0


def sign(tx_b64: str, kp) -> str:
    """Sign Jupiter's transaction with the wallet key (only our own signature slot)."""
    from solders.message import to_bytes_versioned
    from solders.transaction import VersionedTransaction

    raw = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
    keys = list(raw.message.account_keys)
    if kp.pubkey() not in keys[: raw.message.header.num_required_signatures]:
        raise TradeError("the swap isn't for this wallet")
    sigs = list(raw.signatures)
    sigs[keys.index(kp.pubkey())] = kp.sign_message(to_bytes_versioned(raw.message))
    return base64.b64encode(bytes(VersionedTransaction.populate(raw.message, sigs))).decode()


def keypair():
    """The bot's wallet from the SOLANA_BOT_KEY secret (Phantom's base58 private key, or a [..] byte list)."""
    from solders.keypair import Keypair

    key = os.environ.get("SOLANA_BOT_KEY", "").strip()
    if not key:
        return None
    if key.startswith("["):
        return Keypair.from_bytes(bytes(json.loads(key)))
    return Keypair.from_base58_string(key)


# ---- Wallets: the real one, and a pretend one for dry runs ----

class LiveWallet:
    live = True

    def __init__(self, kp):
        self.kp, self.address = kp, str(kp.pubkey())
        self.refresh()

    def refresh(self):
        self.bal = balances(self.address)

    def cash(self) -> float:
        return float((self.bal.get(USDC) or {}).get("uiAmount") or 0)

    def sol(self) -> float:
        return float((self.bal.get("SOL") or {}).get("uiAmount") or 0)

    def held_raw(self, mint: str) -> int:
        return int((self.bal.get(mint) or {}).get("amount") or 0)

    def swap(self, in_mint: str, out_mint: str, amount_raw: int, max_cost: float | None = None) -> dict:
        o = order(in_mint, out_mint, amount_raw, self.address)
        if max_cost is not None and cost(o) > max_cost:
            raise TradeError(f"skipped: the swap would cost {cost(o):.1%} in fees and price impact (limit {max_cost:.0%})")
        if not o.get("transaction"):
            raise TradeError("Jupiter returned no transaction")
        res = jup("/ultra/v1/execute", body={"signedTransaction": sign(o["transaction"], self.kp), "requestId": o["requestId"]})
        if res.get("status") != "Success":
            raise TradeError(f"swap failed: {res.get('error') or res.get('code') or res}")
        self.refresh()
        return {"in": int(res.get("inputAmountResult") or o["inAmount"]), "out": int(res.get("outputAmountResult") or o["outAmount"]),
                "quoted_out": int(o["outAmount"]), "tx": res.get("signature")}


class PaperWallet:
    """Dry run: real Jupiter quotes, pretend money, no trades."""
    live = False

    def __init__(self, state: dict, start_cash: float):
        self.state = state
        state.setdefault("paper_cash", float(start_cash))
        self.address = "dry run"

    def refresh(self):
        pass

    def cash(self) -> float:
        return self.state["paper_cash"]

    def sol(self) -> float:
        return 1.0

    def held_raw(self, mint: str) -> int:
        return int(self.state.get("positions", {}).get(mint, {}).get("raw", 0))

    def swap(self, in_mint: str, out_mint: str, amount_raw: int, max_cost: float | None = None) -> dict:
        o = order(in_mint, out_mint, amount_raw)
        if max_cost is not None and cost(o) > max_cost:
            raise TradeError(f"skipped: the swap would cost {cost(o):.1%} in fees and price impact (limit {max_cost:.0%})")
        got = int(o["outAmount"])
        if in_mint == USDC:
            self.state["paper_cash"] -= amount_raw / 10 ** USDC_DECIMALS
        if out_mint == USDC:
            self.state["paper_cash"] += got / 10 ** USDC_DECIMALS
        return {"in": int(amount_raw), "out": got, "quoted_out": got, "tx": None}


# ---- The rule ----

def signal(market: str, cfg) -> dict:
    """The dip-bounce rule on the coin's latest finished 5-minute candles."""
    from .signals import display_name, fetch_onchain_candles
    from .strategies import build_strategy, targets

    df = fetch_onchain_candles(market, cfg.timeframe)
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if len(df) <= strategy.warmup + 2:
        raise TradeError(f"only {len(df)} candles")
    sig = targets(strategy, df, False).to_numpy()
    flip = None
    for i in (len(sig) - 1, len(sig) - 2):          # a BUY that started on one of the last 2 candles is still fresh
        if sig[i] == 1 and sig[i - 1] == 0:
            flip = str(df.index[i])
    return {"in": bool(sig[-1] == 1), "fresh_buy": flip if sig[-1] == 1 else None, "name": display_name(market),
            "candle_price": float(df["close"].iloc[-1]), "last": df.index[-1]}


def solana_coins(watchlist: str) -> list[tuple[str, str]]:
    """(market, mint) for each Solana coin in the watchlist."""
    from .signals import read_watchlist

    out = []
    for m in read_watchlist(watchlist):
        chain, _, addr = m.partition(":")
        if chain.lower() in ("sol", "solana") and addr:
            out.append((m, addr))
    return out


# ---- One check ----

def load_settings(path: str = "solbot.yaml") -> dict:
    return yaml.safe_load(Path(path).read_text()) or {}


def value(wallet, positions: dict, px: dict) -> float:
    """Account value: USDC + the coins the bot bought, at Jupiter's prices."""
    return wallet.cash() + sum(p["raw"] / 10 ** p["decimals"] * float(px.get(m, {}).get("usdPrice") or p["entry"])
                               for m, p in positions.items())


def _stop_file_commit(reason: str):
    if os.environ.get("SOLBOT_COMMIT_STOP") != "1":
        return
    for cmd in (["git", "config", "user.name", "github-actions[bot]"],
                ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
                ["git", "add", STOP_FILE], ["git", "commit", "-q", "-m", f"Solana bot stopped: {reason}"],
                ["git", "pull", "-q", "--rebase", "origin", "main"], ["git", "push", "-q", "origin", "HEAD:main"]):
        subprocess.run(cmd, check=False)


def step(settings: dict, tell=print, wallet=None, now: float | None = None) -> str:
    """One check: follow the rule for every coin, enforce the account stops. Returns a one-line status."""
    from .config import Config
    from .signals import display_name, money

    global stale
    now = now or time.time()
    stale = []
    mode = settings.get("mode", "off")
    if mode not in ("dry_run", "live"):
        return "Off (mode: off in solbot.yaml)."
    live = mode == "live"
    if live and Path(STOP_FILE).exists():
        return f"Stopped earlier: {json.loads(Path(STOP_FILE).read_text()).get('reason')}. Delete {STOP_FILE} to start again."
    state_path = f"solbot_state_{mode}.json"
    state = json.loads(Path(state_path).read_text()) if Path(state_path).exists() else {}
    if state.get("stopped"):
        return f"Dry run stopped earlier: {state['stopped']}."
    tag = "" if live else "DRY RUN: "
    if wallet is None:
        if live:
            kp = keypair()
            if kp is None:
                return "No wallet key yet (SOLANA_BOT_KEY secret)."
            wallet = LiveWallet(kp)
        else:
            wallet = PaperWallet(state, float(settings.get("start_cash", 30)))
    positions = state.setdefault("positions", {})
    coins = solana_coins(settings.get("watchlist", "watchlist.young.txt"))
    names = {mint: m for m, mint in coins}
    if not state.get("started"):
        state["started"] = now
        tell(f"{tag}Solana bot connected",
             f"Wallet: {wallet.address}. Cash ${wallet.cash():,.2f} USDC. Trading {len(coins)} coins with the dip-bounce rule, "
             f"up to ${float(settings.get('per_trade', 30)):,.0f} a trade. Stops at ${settings.get('stop_below')} or ${settings.get('stop_above')}."
             + ("" if live else " Dry run: it will message what it WOULD buy and sell, without trading."))
    if live:   # a dedicated wallet: coins from the list that it holds but has no notes on are treated as its own
        for m, mint in coins:
            if mint not in positions and wallet.held_raw(mint) > 0:
                positions[mint] = {"market": m, "raw": wallet.held_raw(mint), "decimals": None, "entry": None, "cost": None,
                                   "adopted": True}
    px = prices(list({*positions, *names}))
    for mint, p in positions.items():
        p["decimals"] = p["decimals"] or int(px.get(mint, {}).get("decimals") or 6)
        if p["entry"] is None:
            p["entry"] = float(px.get(mint, {}).get("usdPrice") or 0)
            p["cost"] = p["raw"] / 10 ** p["decimals"] * p["entry"]
            tell(f"{tag}Solana bot: found {display_name(names.get(mint, mint))} in its wallet",
                 "It had no notes on this coin, so it treats it as bought at today's price and will sell it by the rule.")
    if live and wallet.sol() < MIN_SOL and now - state.get("low_sol_told", 0) > 6 * 3600:
        state["low_sol_told"] = now
        tell("Solana bot: add a little SOL", f"The wallet has {wallet.sol():.4f} SOL. Swaps need about 0.01 SOL for network fees.")

    def sell(mint: str, why: str) -> bool:
        p = positions[mint]
        raw = min(p["raw"], wallet.held_raw(mint)) if live else p["raw"]
        name = p.get("name") or display_name(names.get(mint, mint))
        if raw <= 0:
            positions.pop(mint)
            tell(f"{tag}Solana bot: {name} is no longer in the wallet", "It was sold or moved outside the bot, so the bot forgot it.")
            return True
        try:
            fill = wallet.swap(mint, USDC, raw)
        except Exception as e:
            log.warning("sell %s failed: %s", name, e)
            last = state.setdefault("sell_errors", {}).get(mint, 0)
            if now - last > 1800:
                state["sell_errors"][mint] = now
                tell(f"{tag}Solana bot: could not sell {name}", f"{e}. It will keep trying every 5 minutes.")
            return False
        got = fill["out"] / 10 ** USDC_DECIMALS
        result = got / p["cost"] - 1 if p.get("cost") else 0.0
        positions.pop(mint)
        state.setdefault("trades", []).append({"t": now, "action": "SELL", "coin": name, "usd": got, "result": result, "tx": fill["tx"]})
        tell(f"{tag}SOLD {name} for {money(got)} ({result:+.1%})",
             f"{why}. Bought for {money(p['cost'])}, sold for {money(got)} after fees: {got - p['cost']:+,.2f}."
             + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))
        return True

    def stop_all(reason: str, title: str) -> str:
        for mint in list(positions):
            sell(mint, reason)
        wallet.refresh()
        final = value(wallet, positions, px)
        if positions:
            reason += " (some coins could not be sold yet: it keeps trying)"
            return f"Stopping: {reason}."
        if live:
            Path(STOP_FILE).write_text(json.dumps({"stopped_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(now)),
                                                   "reason": reason, "account": round(final, 2)}, indent=1))
            _stop_file_commit(reason)
        else:
            state["stopped"] = reason
        tell(f"{tag}{title}", f"{reason}. Everything is sold: the account is {money(final)} in USDC. The bot has stopped."
             + (f" To start again, delete {STOP_FILE} (or ask Claude)." if live else ""))
        return f"Stopped: {reason}."

    def check_stops() -> str | None:
        v = value(wallet, positions, px)
        if v <= float(settings.get("stop_below", 0)):
            return stop_all(f"the account fell to {money(v)} (limit {money(float(settings['stop_below']))})", "Solana bot STOPPED: loss limit")
        if settings.get("stop_above") and v >= float(settings["stop_above"]):
            return stop_all(f"the account reached {money(v)} (goal {money(float(settings['stop_above']))})", "Solana bot STOPPED: goal reached")
        return None

    try:
        if (done := check_stops()):
            return done
        cfg = Config.load(settings.get("strategy_config", "config.young.yaml"))
        stop_loss = float(settings.get("stop_loss", 0.2))
        for market, mint in coins:
            try:
                s = signal(market, cfg)
            except Exception as e:
                log.warning("%s: no signal: %s", market, e)
                continue
            just_closed = pd.Timestamp(now - now % 300 - 300, unit="s", tz="UTC")
            if s.get("last") is not None and s["last"] == just_closed - pd.Timedelta(minutes=5):
                stale.append(s["name"])     # exactly one candle behind: the feed is lagging (older = the coin went quiet)
            price = float(px.get(mint, {}).get("usdPrice") or s["candle_price"])
            if mint in positions:
                p = positions[mint]
                p["name"] = s["name"]
                if price <= p["entry"] * (1 - stop_loss):
                    sell(mint, f"Stop-loss: down {price / p['entry'] - 1:.0%} from the buy")
                elif not s["in"]:
                    sell(mint, "The price is back at its average (the rule's exit)")
                continue
            if not s["fresh_buy"] or state.get("last_buy", {}).get(mint) == s["fresh_buy"]:
                continue
            usd = min(float(settings.get("per_trade", 30)), wallet.cash())
            if usd < MIN_TRADE:
                continue
            state.setdefault("last_buy", {})[mint] = s["fresh_buy"]
            try:
                fill = wallet.swap(USDC, mint, int(usd * 10 ** USDC_DECIMALS), float(settings.get("max_cost", 0.03)))
            except Exception as e:
                tell(f"{tag}Solana bot: didn't buy {s['name']}", str(e))
                continue
            dec = int(px.get(mint, {}).get("decimals") or 6)
            spent = fill["in"] / 10 ** USDC_DECIMALS
            tokens = fill["out"] / 10 ** dec
            positions[mint] = {"market": market, "name": s["name"], "raw": fill["out"], "decimals": dec,
                               "entry": spent / tokens if tokens else price, "cost": spent, "bought_at": now}
            state.setdefault("trades", []).append({"t": now, "action": "BUY", "coin": s["name"], "usd": spent, "tx": fill["tx"]})
            tell(f"{tag}BOUGHT {money(spent)} of {s['name']}",
                 f"Dip-bounce signal on the 5-minute chart. It sells when the price is back at its average, or at "
                 f"{stop_loss:.0%} down. Cash left: {money(wallet.cash())}."
                 + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))
        wallet.refresh()
        if (done := check_stops()):
            return done
        v = value(wallet, positions, px)
        held = ", ".join(p.get("name") or m[:6] for m, p in positions.items()) or "nothing"
        return f"{tag}Account {money(v)} (cash {money(wallet.cash())}; holding {held})."
    finally:
        state["trades"] = state.get("trades", [])[-300:]
        Path(state_path).write_text(json.dumps(state, indent=1))


def run(settings_path: str = "solbot.yaml", minutes: float | None = None, every: float = 5):
    """Check every `every` minutes (just after each 5-minute candle closes) until `minutes` have passed."""
    from .signals import alert_target, notify

    stop_at = time.time() + minutes * 60 if minutes else None
    while True:
        settings = load_settings(settings_path)      # re-read each time, so switching to live takes effect

        def tell(title, msg):
            log.warning("SOLBOT %s: %s", title, msg)
            target = alert_target()
            if target:
                notify(target, title, msg, buy="SOLD" not in title and "STOP" not in title)

        first = time.time()
        while True:
            try:
                status = step(settings, tell)
            except Exception as e:
                status = f"Check failed: {e}"
                log.warning(status)
            print(time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()), status
                  + (f" (waiting for the new candle: {', '.join(stale)})" if stale else ""), flush=True)
            # The feed often lags 1-3 minutes: re-check every 30 s until the just-finished candle is in, so a dip is
            # never caught a whole 5 minutes late (tested on NIO: 1-2 minutes late cost nothing, 5 minutes did).
            if not (minutes and stale and time.time() + RETRY_SECONDS - first < RETRY_FOR):
                break
            time.sleep(RETRY_SECONDS)
        if not minutes:
            return
        wait = every * 60 - time.time() % (every * 60) + 30          # 30 s after the next candle closes
        if time.time() + wait > stop_at:
            return
        time.sleep(wait)
