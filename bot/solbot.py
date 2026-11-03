"""The Solana auto-trader: buys dips with the dip-bounce rule, from a wallet that belongs to the bot alone.
Settings: solbot.yaml. Runs all day on GitHub (the "solbot" workflow), checking every 5 minutes.

What it trades:
- Young Solana coins (watchlist.young.txt, e.g. NIO) on the 5-minute chart. Every few hours it removes coins that are
  dying (little money left in the pool, or nobody trading) and searches for new ones like NIO (busy, rising, real
  pool) to add, up to `max_coins`.
- Stocks as verified "xStocks" on Solana (NVDAx = Nvidia...) on the daily chart, only for companies the rule was
  tested on (S&P 500, SPY, QQQ), only during US market hours, and only when the xStock's price matches the real stock.

The rule: BUY right after a sharp dip below the recent average; SELL when the price is back at the average, or at the
`stop_loss`. Trade size grows with the account (`tiers`); at each `pause_at` amount it sells everything, stops and
tells you (start it again by deleting solbot_stopped.json, or ask Claude). It stops for good at `stop_below` or if the
account falls `stop_drawdown` from its best.

Swaps go through Jupiter (the router most Solana apps use): Jupiter builds the swap, the bot signs it with the wallet
key (SOLANA_BOT_KEY secret) and Jupiter sends it. The bot only ever swaps USDC for something on its lists and back.
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
FUNDS_TESTED = {"SPY", "QQQ"}


class TradeError(Exception):
    pass


# ---- Jupiter ----

def _jup_base() -> tuple[str, dict]:
    key = os.environ.get("JUPITER_API_KEY", "").strip()
    return ("https://api.jup.ag", {"x-api-key": key}) if key else ("https://lite-api.jup.ag", {})


def jup(path: str, params: dict | None = None, body: dict | None = None):
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
    out = {}
    mints = list(mints)
    for i in range(0, len(mints), 50):
        data = jup("/price/v3", params={"ids": ",".join(mints[i:i + 50])})
        out.update({m: v for m, v in data.items() if v and v.get("usdPrice")})
    return out


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


class KeyProblem(Exception):
    pass


def keypair():
    """The bot's wallet from the SOLANA_BOT_KEY secret (Phantom's base58 private key, or a [..] byte list).
    None if there's no key; KeyProblem (saying what's wrong, never the key itself) if it can't be read."""
    from solders.keypair import Keypair

    key = os.environ.get("SOLANA_BOT_KEY", "").strip().strip("'\"").strip()
    if not key:
        return None
    if len(key.split()) >= 12:
        raise KeyProblem("it looks like the 12-word recovery phrase. Use the private key instead: one long string "
                         "(Phantom: Settings → Manage Accounts → the bot's account → Show Private Key)")
    if " " in key or "\n" in key:
        raise KeyProblem("it has spaces or line breaks in it. Copy it again and paste it with nothing else")
    try:
        if key.startswith("["):
            return Keypair.from_bytes(bytes(json.loads(key)))
        if 32 <= len(key) <= 44:
            raise KeyProblem("it looks like the wallet's address (the public one you send money to). The private key "
                             "is longer: about 88 letters and numbers")
        return Keypair.from_base58_string(key)
    except KeyProblem:
        raise
    except Exception:
        raise KeyProblem(f"it isn't a Solana private key ({len(key)} characters; Phantom's is about 88 letters and "
                         "numbers, no spaces or quotes). Copy it again from Phantom → Show Private Key")


def check_key(state: dict, now: float, tell) -> str | None:
    """Dry run: if a wallet key is set, check it works and tell your phone the wallet's address and money (never the
    key). Re-tells when the money in it changes, so you also see when your deposit arrives."""
    try:
        kp = keypair()
    except KeyProblem as e:
        if state.get("key_note") != str(e) or now - state.get("key_told", 0) > 86400:
            state.update(key_note=str(e), key_told=now)
            tell("❌ Solana bot: the wallet key didn't work", f"The SOLANA_BOT_KEY secret is set, but {e}. Then replace the secret on GitHub.")
        return None
    if kp is None:
        return None
    address = str(kp.pubkey())
    try:
        bal = balances(address)
    except Exception as e:
        log.warning("balance check failed: %s", e)
        return address
    usdc = float((bal.get(USDC) or {}).get("uiAmount") or 0)
    sol = float((bal.get("SOL") or {}).get("uiAmount") or 0)
    note = f"{address}|{usdc:.2f}|{sol:.3f}"
    if state.get("key_note") != note and now - state.get("key_told", 0) > 600:
        state.update(key_note=note, key_told=now)
        todo = [x for x, missing in (("send it USDC on Solana", usdc < MIN_TRADE), ("send it about 0.03 SOL for fees", sol < MIN_SOL)) if missing]
        tell("✅ Solana bot: wallet key works",
             f"Wallet {address}: ${usdc:,.2f} USDC and {sol:.4f} SOL. Check this address matches your bot account in Phantom. "
             + (f"Still to do: {' and '.join(todo)}." if todo else "Ready: tell Claude \"go live\" when you are."))
    return address


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


# ---- The rule: young coins (5-minute chart) ----

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
    if not Path(watchlist).exists():
        return out
    for m in read_watchlist(watchlist):
        chain, _, addr = m.partition(":")
        if chain.lower() in ("sol", "solana") and addr:
            out.append((m, addr))
    return out


# ---- Finding new coins and dropping dying ones ----

def dex_info(mints: list[str]) -> dict[str, dict]:
    """mint -> pool money, 24 h trading, price changes, name... from each coin's busiest DEX Screener pool."""
    import requests

    out = {}
    for i in range(0, len(mints), 30):
        try:
            pairs = requests.get("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(mints[i:i + 30]), timeout=30).json()
        except Exception as e:
            log.warning("DEX Screener lookup failed: %s", e)
            continue
        for p in pairs or []:
            mint = p["baseToken"]["address"]
            liq = float((p.get("liquidity") or {}).get("usd") or 0)
            if mint in out and out[mint]["liq"] >= liq:
                continue
            ch = p.get("priceChange") or {}
            out[mint] = {"liq": liq, "vol24": float((p.get("volume") or {}).get("h24") or 0),
                         "h6": float(ch.get("h6") or 0), "h24": float(ch.get("h24") or 0),
                         "mcap": float(p.get("marketCap") or p.get("fdv") or 0), "name": p["baseToken"].get("name") or "",
                         "symbol": p["baseToken"].get("symbol") or "",
                         "age_h": (time.time() * 1000 - (p.get("pairCreatedAt") or 0)) / 3.6e6}
    return out


BIG_COINS = {"monero", "xmr", "cardano", "ada", "litecoin", "ltc", "chainlink", "link", "polkadot", "dot", "avalanche",
             "avax", "shiba inu", "shib", "pepe", "tron", "trx", "toncoin", "ton", "sui", "stellar", "xlm", "hyperliquid",
             "hype", "jupiter", "jup", "bonk", "dogwifhat", "wif", "pump", "fartcoin", "trump", "usd", "wrapped"}


def find_coins(settings: dict, exclude: set[str], n: int) -> list[dict]:
    """Up to n new young Solana coins that look like NIO did: real pool, busy, rising, cheap enough to trade."""
    from .news_ideas import COPYCAT, IMPOSTOR, candidates

    f = {"min_age_hours": 48, "max_age_days": 21, "min_liquidity": 50_000, "min_volume_24h": 250_000,
         "min_mcap": 250_000, "max_mcap": 50_000_000, **(settings.get("coin_filters") or {})}

    def looks_right(c: dict) -> bool:
        name, sym = c["name"].strip().lower(), c["symbol"].strip().lower()
        return (f["min_age_hours"] <= c["age_h"] <= f["max_age_days"] * 24 and c["liq"] >= f["min_liquidity"]
                and c["vol24"] >= f["min_volume_24h"] and f["min_mcap"] <= c["mcap"] <= f["max_mcap"]
                and name not in IMPOSTOR | BIG_COINS and sym not in IMPOSTOR | BIG_COINS
                and not any(w in COPYCAT for w in name.split()))

    cands = [c for c in candidates({"solana": "sol"}) if c["chain"] == "solana" and c["address"] not in exclude and looks_right(c)]
    info = dex_info([c["address"] for c in cands])
    # Check again with DEX Screener's numbers for the coin's busiest pool, and keep only coins that are rising.
    rising = [m for m in ({**c, **info[c["address"]]} for c in cands if c["address"] in info)
              if looks_right(m) and m["h24"] > 0 and m["h6"] > -10]
    picks = []
    for c in sorted(rising, key=lambda c: -c["vol24"]):
        if len(picks) >= n:
            break
        try:
            if cost(order(USDC, c["address"], int(trade_size(settings, 30) * 10 ** USDC_DECIMALS))) > float(settings.get("max_cost", 0.03)):
                continue
        except Exception:
            continue
        picks.append(c)
    return picks


def edit_watchlist(path: str, remove: list[str], add: list[dict]):
    lines = Path(path).read_text().splitlines() if Path(path).exists() else []
    lines = [l for l in lines if l.split("#", 1)[0].strip() not in remove]
    day = time.strftime("%b %d", time.gmtime())
    for c in add:
        lines.append(f"sol:{c['address']}   # {c['name']} ({c['symbol']}), found by the Solana bot {day}: "
                     f"${c['liq'] / 1000:,.0f}k pool, ${c['vol24'] / 1000:,.0f}k traded in 24 h")
    Path(path).write_text("\n".join(lines) + "\n")


def commit(files: list[str], message: str):
    """Save files to the repo (on GitHub only), so the change lasts and the alerts see it too."""
    if os.environ.get("SOLBOT_COMMIT") != "1":
        return
    for cmd in (["git", "config", "user.name", "github-actions[bot]"],
                ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
                ["git", "add", *files], ["git", "commit", "-q", "-m", message],
                ["git", "pull", "-q", "--rebase", "origin", "main"], ["git", "push", "-q", "origin", "HEAD:main"]):
        subprocess.run(cmd, check=False)


# ---- Stocks (xStocks on Solana, daily chart) ----

def xstocks(state: dict, now: float) -> list[tuple[str, str]]:
    """(ticker, mint) for each verified xStock of a company the rule was tested on. Looked up once a day."""
    cached = state.get("xstocks")
    if cached and now - cached["t"] < 86400:
        return [tuple(x) for x in cached["list"]]
    tested = {p.stem.upper() for p in Path("data/sp500").glob("*.csv")} | FUNDS_TESTED
    found = {}
    for q in ("xStock", "xStocks"):
        for t in jup("/tokens/v2/search", params={"query": q}) or []:
            sym, name = t.get("symbol") or "", t.get("name") or ""
            if t.get("isVerified") and name.endswith("xStock") and t["id"].startswith("Xs") and sym.endswith("x") \
                    and sym[:-1].upper() in tested:
                found[sym[:-1].upper()] = t["id"]
    out = sorted(found.items())
    state["xstocks"] = {"t": now, "list": out}
    return out


def stock_quote(ticker: str) -> dict:
    """The real stock's price now and whether the US market is open (Yahoo)."""
    import requests

    meta = requests.get(f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}", params={"range": "1d", "interval": "1m"},
                        headers={"User-Agent": "Mozilla/5.0"}, timeout=20).json()["chart"]["result"][0]["meta"]
    reg = meta["currentTradingPeriod"]["regular"]
    return {"price": float(meta["regularMarketPrice"]), "start": reg["start"], "end": reg["end"]}


def stock_signal(ticker: str, cfg) -> dict:
    """The dip-bounce rule on the stock's finished daily candles: a fresh BUY means yesterday closed in a sharp dip."""
    from .signals import fetch_yahoo
    from .strategies import build_strategy, targets

    df = fetch_yahoo(ticker, "1d")
    sig = targets(build_strategy(cfg.strategy, cfg.strategy_params), df, False).to_numpy()
    fresh = str(df.index[-1].date()) if sig[-1] == 1 and sig[-2] == 0 else None
    return {"in": bool(sig[-1] == 1), "fresh_buy": fresh, "name": f"{ticker} (xStock)", "day": str(df.index[-1].date())}


# ---- Money management ----

def load_settings(path: str = "solbot.yaml") -> dict:
    return yaml.safe_load(Path(path).read_text()) or {}


def trade_size(settings: dict, account: float) -> float:
    """Dollars per trade for this account size (the `tiers` in solbot.yaml)."""
    for t in settings.get("tiers") or []:
        if "below" not in t or account < float(t["below"]):
            return float(t["per_trade"])
    return float(settings.get("per_trade", 30))


def value(wallet, positions: dict, px: dict) -> float:
    """Account value: USDC + everything the bot bought, at Jupiter's prices."""
    return wallet.cash() + sum(p["raw"] / 10 ** p["decimals"] * float(px.get(m, {}).get("usdPrice") or p["entry"])
                               for m, p in positions.items())


# ---- One check ----

def step(settings: dict, tell=print, wallet=None, now: float | None = None, only: set[str] | None = None) -> str:
    """One check: drop dying coins and find new ones (every few hours), follow the rule for every coin and stock,
    enforce the pauses and stops. `only`: just re-check these coins (the feed was late). Returns a one-line status."""
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
        return f"Stopped: {json.loads(Path(STOP_FILE).read_text()).get('reason')}. Delete {STOP_FILE} to start again."
    state_path = f"solbot_state_{mode}.json"
    state = json.loads(Path(state_path).read_text()) if Path(state_path).exists() else {}
    if state.get("stopped"):
        return f"Dry run stopped: {state['stopped']}."
    tag = "" if live else "DRY RUN: "
    if wallet is None:
        if live:
            try:
                kp = keypair()
            except KeyProblem as e:
                if now - state.get("key_told", 0) > 3600:
                    state["key_told"] = now
                    Path(state_path).write_text(json.dumps(state, indent=1))
                    tell("❌ Solana bot: the wallet key didn't work", f"The SOLANA_BOT_KEY secret is set, but {e}. Nothing was traded.")
                return f"Wallet key problem: {e}."
            if kp is None:
                return "No wallet key yet (SOLANA_BOT_KEY secret)."
            wallet = LiveWallet(kp)
        else:
            wallet = PaperWallet(state, float(settings.get("start_cash", 30)))
            if only is None:
                check_key(state, now, tell)
    positions = state.setdefault("positions", {})
    watchlist = settings.get("watchlist", "watchlist.young.txt")
    coins = solana_coins(watchlist)
    stocks = []
    if settings.get("stocks") and only is None:
        try:
            stocks = xstocks(state, now)
        except Exception as e:
            log.warning("xStock list failed: %s", e)
    kinds = {mint: ("coin", m) for m, mint in coins} | {mint: ("stock", t) for t, mint in stocks}

    def label(mint: str) -> str:
        p = positions.get(mint) or {}
        kind, m = kinds.get(mint, (p.get("kind"), p.get("market") or mint))
        return p.get("name") or (f"{m} (xStock)" if kind == "stock" else display_name(m))

    if not state.get("started"):
        state["started"] = now
        pauses = " and ".join(money(float(x)) for x in settings.get("pause_at") or [])
        tell(f"{tag}Solana bot connected",
             f"Wallet: {wallet.address}. Cash {money(wallet.cash())} USDC. Trading {len(coins)} young coins"
             + (f" and {len(stocks)} stocks" if stocks else "") + f" with the dip-bounce rule, {money(trade_size(settings, wallet.cash()))} a trade."
             + (f" Pauses at {pauses}." if pauses else "") + f" Stops at {money(float(settings.get('stop_below', 0)))}."
             + ("" if live else " Dry run: it will message what it WOULD buy and sell, without trading."))
    if live:   # a dedicated wallet: things from its lists that it holds but has no notes on are treated as its own
        for mint, (kind, m) in kinds.items():
            if mint not in positions and wallet.held_raw(mint) > 0:
                positions[mint] = {"market": m, "kind": kind, "raw": wallet.held_raw(mint), "decimals": None, "entry": None,
                                   "cost": None, "adopted": True}
    px = prices(list({*positions, *kinds}))
    for mint, p in positions.items():
        p["decimals"] = p["decimals"] or int(px.get(mint, {}).get("decimals") or 6)
        if p["entry"] is None:
            p["entry"] = float(px.get(mint, {}).get("usdPrice") or 0)
            p["cost"] = p["raw"] / 10 ** p["decimals"] * p["entry"]
            tell(f"{tag}Solana bot: found {label(mint)} in its wallet",
                 "It had no notes on it, so it treats it as bought at today's price and will sell it by the rule.")
    if live and wallet.sol() < MIN_SOL and now - state.get("low_sol_told", 0) > 6 * 3600:
        state["low_sol_told"] = now
        tell("Solana bot: add a little SOL", f"The wallet has {wallet.sol():.4f} SOL. Swaps need about 0.01 SOL for network fees.")

    def sell(mint: str, why: str) -> bool:
        p = positions[mint]
        raw = min(p["raw"], wallet.held_raw(mint)) if live else p["raw"]
        name = label(mint)
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
        if p.get("kind", "coin") == "coin":     # learning from its own trades: bench a coin that keeps losing
            res = state.setdefault("coin_results", {}).setdefault(mint, [])
            res.append(result)
            n = int(settings.get("bench_after_losses", 3))
            if n and len(res) >= n and all(r <= 0 for r in res[-n:]):
                state.setdefault("benched", {})[mint] = now
                to_bench.append((p.get("market") or f"sol:{mint}", n))
        state.setdefault("trades", []).append({"t": now, "action": "SELL", "what": name, "usd": got, "result": result, "tx": fill["tx"]})
        tell(f"{tag}SOLD {name} for {money(got)} ({result:+.1%})",
             f"{why}. Bought for {money(p['cost'])}, sold for {money(got)} after fees: {got - p['cost']:+,.2f}. "
             f"Account now about {money(value(wallet, positions, px))}."
             + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))
        return True

    to_bench: list[tuple[str, int]] = []

    def buy(mint: str, kind: str, market: str, name: str, why: str, account: float):
        usd = min(trade_size(settings, account), wallet.cash())
        if usd < MIN_TRADE:
            return
        try:
            fill = wallet.swap(USDC, mint, int(usd * 10 ** USDC_DECIMALS), float(settings.get("max_cost", 0.03)))
        except Exception as e:
            tell(f"{tag}Solana bot: didn't buy {name}", str(e))
            return
        dec = int(px.get(mint, {}).get("decimals") or 6)
        spent, tokens = fill["in"] / 10 ** USDC_DECIMALS, fill["out"] / 10 ** dec
        positions[mint] = {"market": market, "kind": kind, "name": name, "raw": fill["out"], "decimals": dec,
                           "entry": spent / tokens if tokens else float(px.get(mint, {}).get("usdPrice") or 0),
                           "cost": spent, "bought_at": now}
        state.setdefault("trades", []).append({"t": now, "action": "BUY", "what": name, "usd": spent, "tx": fill["tx"]})
        tell(f"{tag}BOUGHT {money(spent)} of {name}",
             f"{why}. It sells when the price is back at its average, or at {float(settings.get('stop_loss', 0.2)):.0%} down. "
             f"Cash left: {money(wallet.cash())}." + (f"\nhttps://solscan.io/tx/{fill['tx']}" if fill.get("tx") else ""))

    def halt(reason: str, title: str) -> str:
        """Sell everything and stop (a pause or a stop: either way it waits for you)."""
        for mint in list(positions):
            sell(mint, reason[0].upper() + reason[1:])
        wallet.refresh()
        final = value(wallet, positions, px)
        if positions:
            return f"Stopping: {reason} (some things could not be sold yet: it keeps trying)."
        if live:
            Path(STOP_FILE).write_text(json.dumps({"stopped_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(now)),
                                                   "reason": reason, "account": round(final, 2)}, indent=1))
            commit([STOP_FILE], f"Solana bot stopped: {reason}")
        else:
            state["stopped"] = reason
        tell(f"{tag}{title}", f"{reason[0].upper() + reason[1:]}. Everything is sold: the account is {money(final)} in USDC. "
             "The bot is stopped until you start it again" + (f" (delete {STOP_FILE}, or ask Claude)." if live else " (ask Claude)."))
        return f"Stopped: {reason}."

    def limits() -> str | None:
        v = value(wallet, positions, px)
        last, peak = state.get("last_value", v), max(state.get("peak", v), v)
        state["last_value"], state["peak"] = v, peak
        if v <= float(settings.get("stop_below", 0)):
            return halt(f"the account fell to {money(v)} (limit {money(float(settings['stop_below']))})", "Solana bot STOPPED: loss limit")
        dd = float(settings.get("stop_drawdown") or 0)
        if dd and v <= peak * (1 - dd):
            return halt(f"the account fell to {money(v)}, {1 - v / peak:.0%} below its best ({money(peak)})", "Solana bot STOPPED: big drop")
        for m in sorted(float(x) for x in settings.get("pause_at") or []):
            if last < m <= v:
                nxt = trade_size(settings, v)
                return halt(f"the account reached {money(v)} (your {money(m)} checkpoint). Next: {money(nxt)} a trade",
                            f"Solana bot PAUSED at {money(m)} 🎉")
        size = trade_size(settings, v)
        if state.get("size") not in (None, size):
            tell(f"{tag}Solana bot: now {money(size)} a trade", f"The account is {money(v)}, so each trade is now {money(size)}.")
        state["size"] = size
        return None

    try:
        if only is None and now - state.get("scanned_at", 0) >= float(settings.get("scan_every_hours", 2)) * 3600:
            state["scanned_at"] = now
            dead, info = [], dex_info([mint for _, mint in coins])
            for m, mint in coins:
                i = info.get(mint)
                why = ("no trading pool left" if not i
                       else f"only {money(i['liq'])} left in its pool" if i["liq"] < float(settings.get("dead_below_liquidity", 20_000))
                       else f"only {money(i['vol24'])} traded in 24 h" if i["vol24"] < float(settings.get("dead_below_volume_24h", 20_000))
                       else None)
                if why and (mint not in positions or sell(mint, f"It's dying ({why})")):
                    dead.append((m, mint, why))
            room = int(settings.get("max_coins", 6)) - (len(coins) - len(dead))
            new = []
            if settings.get("find_coins", True) and room > 0:
                try:
                    benched = {m for m, t in state.get("benched", {}).items() if now - t < 14 * 86400}
                    new = find_coins(settings, {mint for _, mint in coins} | benched, room)
                except Exception as e:
                    log.warning("coin search failed: %s", e)
            if dead or new:
                edit_watchlist(watchlist, [m for m, _, _ in dead], new)
                commit([watchlist], "Solana bot: " + "; ".join(
                    [f"removed {display_name(m)} ({why})" for m, _, why in dead] + [f"added {c['name']}" for c in new]))
                for m, _, why in dead:
                    tell(f"{tag}Solana bot: dropped {display_name(m)}", f"It's dying: {why}. Removed from the young-coin list.")
                for c in new:
                    tell(f"{tag}Solana bot: now watching {c['name']} ({c['symbol']})",
                         f"Found a coin like NIO: {c['age_h'] / 24:.0f} days old, {money(c['liq'])} in its pool, {money(c['vol24'])} "
                         f"traded in 24 h, up {c['h24']:.0f}% in 24 h. Added to the young-coin list; it trades it on the next dip.")
                coins = solana_coins(watchlist)
                kinds.update({mint: ("coin", m) for m, mint in coins})
                px.update(prices([mint for _, mint in coins if mint not in px]))
        stop_loss = float(settings.get("stop_loss", 0.2))
        if only is None and settings.get("learn", True):
            from . import solbot_learn
            seen = state.setdefault("seen_coins", {})
            seen.update({m: now for m, _ in coins})
            for m in [m for m, t in seen.items() if now - t > 14 * 86400]:
                seen.pop(m)
            for kind, markets, hours in (("coin", list(seen), settings.get("learn_coins_every_hours", 24)),
                                         ("stock", [t for t, _ in stocks], settings.get("learn_stocks_every_hours", 168))):
                try:
                    solbot_learn.maybe_learn(kind, markets, float(hours), stop_loss, tell, tag, now)
                except Exception as e:
                    log.warning("learning (%s) failed: %s", kind, e)
        if (done := limits()):
            return done
        from .solbot_learn import apply as learned
        cfg = learned("coin", Config.load(settings.get("strategy_config", "config.young.yaml")))
        just_closed = pd.Timestamp(now - now % 300 - 300, unit="s", tz="UTC")
        for market, mint in coins:
            if only is not None and market not in only:
                continue
            try:
                s = signal(market, cfg)
            except Exception as e:
                log.warning("%s: no signal: %s", market, e)
                continue
            if s.get("last") is not None and s["last"] == just_closed - pd.Timedelta(minutes=5):
                stale.append(market)        # exactly one candle behind: the feed is lagging (older = the coin went quiet)
            price = float(px.get(mint, {}).get("usdPrice") or s["candle_price"])
            if mint in positions:
                p = positions[mint]
                p["name"] = s["name"]
                if price <= p["entry"] * (1 - stop_loss):
                    sell(mint, f"Stop-loss: down {price / p['entry'] - 1:.0%} from the buy")
                elif not s["in"]:
                    sell(mint, "The price is back at its average (the rule's exit)")
                continue
            if s["fresh_buy"] and state.get("last_buy", {}).get(mint) != s["fresh_buy"]:
                state.setdefault("last_buy", {})[mint] = s["fresh_buy"]
                buy(mint, "coin", market, s["name"], "Dip-bounce signal on the 5-minute chart", value(wallet, positions, px))
        if stocks:
            scfg = learned("stock", Config.load(settings.get("stock_strategy_config", "config.stockdip.yaml")))
            gap_limit = float(settings.get("max_price_gap", 0.01))
            for ticker, mint in stocks:
                try:
                    q = stock_quote(ticker)
                    if not q["start"] + 900 <= now <= q["end"] - 600:      # market open (skip its first 15 and last 10 minutes)
                        continue
                    day = time.strftime("%Y-%m-%d", time.gmtime(now))
                    s = state.setdefault("stock_sig", {}).get(ticker)
                    if not s or s.get("checked") != day:
                        s = {**stock_signal(ticker, scfg), "checked": day}
                        state["stock_sig"][ticker] = s
                except Exception as e:
                    log.warning("%s: no stock signal: %s", ticker, e)
                    continue
                jp = float(px.get(mint, {}).get("usdPrice") or 0)
                gap = jp / q["price"] - 1 if jp and q["price"] else 1.0
                if mint in positions:
                    p = positions[mint]
                    if jp and jp <= p["entry"] * (1 - stop_loss):
                        sell(mint, f"Stop-loss: down {jp / p['entry'] - 1:.0%} from the buy")
                    elif not s["in"] and abs(gap) <= gap_limit:
                        sell(mint, f"{ticker} closed back at its average (the rule's exit)")
                    continue
                if s["fresh_buy"] and state.get("last_buy", {}).get(mint) != s["fresh_buy"]:
                    if abs(gap) > gap_limit:
                        continue                    # the xStock's price is off from the real stock: wait
                    state.setdefault("last_buy", {})[mint] = s["fresh_buy"]
                    buy(mint, "stock", ticker, s["name"], f"{ticker} closed in a sharp dip below its 20-day average",
                        value(wallet, positions, px))
        if to_bench:
            edit_watchlist(watchlist, [m for m, _ in to_bench], [])
            commit([watchlist], "Solana bot: benched " + ", ".join(display_name(m) for m, _ in to_bench))
            for m, n in to_bench:
                tell(f"{tag}Solana bot: benched {display_name(m)}",
                     f"It lost {n} trades in a row on this coin, so it dropped it from the list (and won't pick it again for 2 weeks).")
        wallet.refresh()
        if (done := limits()):
            return done
        v = value(wallet, positions, px)
        held = ", ".join(label(m) for m in positions) or "nothing"
        return (f"{tag}Account {money(v)} (cash {money(wallet.cash())}; holding {held}; {money(trade_size(settings, v))} a trade; "
                f"watching {len(coins)} coins" + (f", {len(stocks)} stocks" if stocks else "") + ").")
    finally:
        state["trades"] = state.get("trades", [])[-300:]
        Path(state_path).write_text(json.dumps(state, indent=1))


def run(settings_path: str = "solbot.yaml", minutes: float | None = None, every: float = 5):
    """Check every `every` minutes (just after each 5-minute candle closes) until `minutes` have passed."""
    from .signals import alert_target, display_name, notify

    stop_at = time.time() + minutes * 60 if minutes else None
    while True:
        settings = load_settings(settings_path)      # re-read each time, so switching to live takes effect

        def tell(title, msg):
            log.warning("SOLBOT %s: %s", title, msg)
            target = alert_target()
            if target:
                notify(target, title, msg, buy=not any(w in title for w in ("SOLD", "STOP", "dropped", "didn't")))

        first, only = time.time(), None
        while True:
            try:
                status = step(settings, tell, only=only)
            except Exception as e:
                status = f"Check failed: {e}"
                log.warning(status)
            print(time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()), status
                  + (f" (waiting for the new candle: {', '.join(display_name(m) for m in stale)})" if stale else ""), flush=True)
            # The feed often lags 1-3 minutes: re-check those coins every 30 s until the just-finished candle is in, so a
            # dip is never caught a whole 5 minutes late (tested on NIO: 1-2 minutes late cost nothing, 5 minutes did).
            if not (minutes and stale and time.time() + RETRY_SECONDS - first < RETRY_FOR):
                break
            only = set(stale)
            time.sleep(RETRY_SECONDS)
        if not minutes:
            return
        wait = every * 60 - time.time() % (every * 60) + 30          # 30 s after the next candle closes
        if time.time() + wait > stop_at:
            return
        time.sleep(wait)
