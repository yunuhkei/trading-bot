"""Check a coin or stock from a screenshot: should I buy, and where's my stop-loss?

1. Claude reads the screenshot (any app: Fomo, Coinbase, Robinhood...) and pulls out the coin's name, ticker,
   blockchain, market value and contract address if shown. It does NOT guess where the price goes: short
   chart shapes tested as no better than a coin flip.
2. The bot finds the real coin or stock (using the market value to tell it apart from same-name copycats),
   downloads its daily price history, and runs the same tested rules as your alerts:
   meme coins -> 20-day breakout (config.memes.yaml); stocks and big coins -> 200-day trend filter.
3. You get BUY / WAIT / AVOID, the stop-loss (the rule's own exit level), and the dollar amount.

Needs an Anthropic API key (console.anthropic.com): set ANTHROPIC_API_KEY, or put the key in a file named
my_anthropic_key.txt next to alerts.yaml (that file is never uploaded). Each screenshot costs about a cent.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import learn
from .config import Config
from .indicators import rsi, sma
from .signals import asset_type, bollinger_levels, copy_id, fetch_candles, money, plain
from .strategies import build_strategy, targets

MODEL = "claude-opus-5-5"
FRESH_DAYS = 3          # a BUY that flipped within this many daily candles counts as fresh
MAX_LATE_RISK = 0.15    # joining an old trend is OK only if the stop is at most this far below
MIN_LIQ, MIN_AGE_DAYS = 20_000, 7
YOUNG_CONFIG, MIN_YOUNG_HOURS = "config.young.yaml", 1   # coins under MIN_AGE_DAYS: dip bounce on 5-minute candles

READ_SCHEMA = {
    "type": "object",
    "properties": {
        "found_asset": {"type": "boolean", "description": "true if the screenshot shows one specific coin or stock"},
        "kind": {"type": "string", "enum": ["meme_coin", "crypto", "stock", "unknown"]},
        "name": {"type": "string", "description": "the coin/company name exactly as shown, or empty"},
        "ticker": {"type": "string", "description": "the ticker/symbol as shown (no $), or empty"},
        "chain": {"type": "string", "enum": ["solana", "base", "bsc", "ethereum", "none", "unknown"],
                  "description": "blockchain, e.g. from a chain logo (BNB logo = bsc); none for stocks"},
        "market_cap_usd": {"type": ["number", "null"], "description": "market value / market cap shown, in USD"},
        "price_usd": {"type": ["number", "null"]},
        "contract_address": {"type": "string", "description": "full contract address if visible, else empty"},
        "app": {"type": "string", "description": "app or website the screenshot is from, if recognisable"},
        "notes": {"type": "string", "description": "anything else useful: position shown, timeframe of the chart"},
    },
    "required": ["found_asset", "kind", "name", "ticker", "chain", "market_cap_usd", "price_usd", "contract_address", "app", "notes"],
    "additionalProperties": False,
}

PROMPT = ("Read this trading screenshot and fill in the fields. Copy names, tickers, numbers and any contract "
          "address exactly as shown; convert values like '$2.08M' to 2080000. Use an empty string or null for "
          "anything not visible. Do not predict prices or give advice.")


def _api_key() -> str | None:
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        return None  # the SDK reads it from the environment
    f = Path("my_anthropic_key.txt")
    if f.exists() and f.read_text().strip():
        return f.read_text().strip()
    raise SystemExit("No Anthropic API key found. Get one at console.anthropic.com (API keys), then put it in a file "
                     "called my_anthropic_key.txt in the trading-bot folder.")


def read_screenshot(path: str) -> dict:
    """Ask Claude to read the screenshot. Returns the fields in READ_SCHEMA."""
    import anthropic

    data = base64.standard_b64encode(Path(path).read_bytes()).decode()
    media = mimetypes.guess_type(path)[0] or "image/png"
    key = _api_key()
    client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": READ_SCHEMA}},
            # If a safety check declines the request, the API retries it on a fallback model automatically.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}},
                {"type": "text", "text": PROMPT}]}],
        )
    except anthropic.AuthenticationError:
        raise SystemExit("The Anthropic API key was rejected. Check my_anthropic_key.txt (it should start with sk-ant-).")
    except anthropic.PermissionDeniedError:
        raise SystemExit("The API key can't use this model. Check your Anthropic account has credit.")
    except anthropic.RateLimitError:
        raise SystemExit("Anthropic is rate limiting this key. Wait a minute and try again.")
    except anthropic.APIConnectionError:
        raise SystemExit("Couldn't reach Anthropic. Check your internet connection.")
    if response.stop_reason == "refusal":
        raise SystemExit("Claude declined to read this image. Try a plain screenshot of the coin's page.")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)


def _dex_pairs(query: str) -> list[dict]:
    r = requests.get("https://api.dexscreener.com/latest/dex/search", params={"q": query}, timeout=30)
    r.raise_for_status()
    return r.json().get("pairs") or []


def resolve(info: dict) -> dict:
    """Turn what was read into a market the bot can fetch. Returns market, kind, and pool facts for crypto."""
    chains = {"solana": "sol", "base": "base", "bsc": "bsc", "ethereum": "eth"}
    name, ticker = (info.get("name") or "").strip(), (info.get("ticker") or "").strip().lstrip("$").upper()
    if info.get("kind") == "stock" and ticker:
        return {"market": ticker, "kind": "stock", "label": f"{name or ticker} ({ticker})"}
    if info.get("kind") in ("crypto", "meme_coin") and ticker and not info.get("contract_address"):
        # Coins Coinbase sells are checked with Coinbase's own prices.
        r = requests.get(f"https://api.exchange.coinbase.com/products/{ticker}-USD", timeout=30)
        if r.status_code == 200 and info.get("chain") in ("none", "unknown", ""):
            return {"market": f"{ticker}-USD", "kind": info["kind"], "label": f"{name or ticker} ({ticker}-USD on Coinbase)"}
    pairs = []
    if info.get("contract_address"):
        chain = info.get("chain") if info.get("chain") in chains else None
        pairs = [p for p in _dex_pairs(info["contract_address"]) if p["baseToken"]["address"].lower() == info["contract_address"].lower()]
        if chain:
            pairs = [p for p in pairs if p.get("chainId") == chain] or pairs
    else:
        for q in filter(None, {ticker, name}):
            pairs += _dex_pairs(q)
        want = {ticker.lower(), name.lower()} - {""}
        pairs = [p for p in pairs if {p["baseToken"].get("symbol", "").lower(), p["baseToken"].get("name", "").lower()} & want]
        if info.get("chain") in chains:
            pairs = [p for p in pairs if p.get("chainId") == info["chain"]]
    pairs = [p for p in pairs if p.get("chainId") in chains]
    if not pairs:
        return {"market": None, "reason": "couldn't find this coin's trading pool. Send the contract address (CA) instead."}
    # Same-name copycats are common: pick the coin whose value is closest to the one in the screenshot.
    by_token = {}
    for p in pairs:
        key = (p["chainId"], p["baseToken"]["address"])
        if key not in by_token or ((p.get("liquidity") or {}).get("usd") or 0) > ((by_token[key].get("liquidity") or {}).get("usd") or 0):
            by_token[key] = p
    shown = info.get("market_cap_usd")
    def distance(p):
        cap = p.get("marketCap") or p.get("fdv") or 0
        return abs(np.log(max(cap, 1) / shown)) if shown else -((p.get("liquidity") or {}).get("usd") or 0)
    best = min(by_token.values(), key=distance)
    cap = best.get("marketCap") or best.get("fdv") or 0
    uncertain = len(by_token) > 1 and (not shown or not 0.5 <= cap / shown <= 2)
    return {"market": f"{chains[best['chainId']]}:{best['baseToken']['address']}", "kind": info.get("kind") or "meme_coin",
            "label": f"{best['baseToken']['name']} ({best['baseToken']['symbol']}) on {best['chainId']}",
            "liquidity": (best.get("liquidity") or {}).get("usd") or 0, "market_cap": cap,
            "age_days": (time.time() * 1000 - (best.get("pairCreatedAt") or time.time() * 1000)) / 86_400_000,
            "matches": len(by_token), "uncertain": uncertain, "url": best.get("url")}


def young_verdict(coin: dict, stake: float | None) -> dict:
    """Hours-old coins: the dip-bounce rule on 5-minute candles (see config.young.yaml for how it tested)."""
    cfg = Config.load(YOUNG_CONFIG)
    out = {"rule": "dip bounce on the 5-minute chart (for coins too new for the 20-day rule)", "stake": stake, "flags": [], "young": True}
    if coin.get("liquidity") is not None and coin["liquidity"] < MIN_LIQ:
        out["flags"].append(f"only {money(coin['liquidity'])} in its trading pool (easy to rug or hard to sell)")
    if coin.get("uncertain"):
        out["flags"].append(f"{coin['matches']} coins share this name and none clearly matches the screenshot: send the contract address to be sure")
    if out["flags"]:
        return {**out, "decision": "AVOID", "why": "red flags: " + "; ".join(out["flags"])}
    if coin.get("age_days", 1) * 24 < MIN_YOUNG_HOURS:
        return {**out, "decision": "AVOID", "why": f"only {coin['age_days'] * 24 * 60:.0f} minutes old. Wait until it's at least an hour old "
                "and has a few hours of trading; most coins die in their first hour"}
    try:
        df = fetch_candles(coin["market"], "5m")
    except Exception as e:
        return {**out, "decision": "AVOID", "why": f"couldn't get its price history ({str(e)[:80]})"}
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if len(df) <= strategy.warmup:
        return {**out, "decision": "WAIT", "why": f"only {len(df)} five-minute candles of trading so far; the rule needs {strategy.warmup + 1}. "
                "Send it again in about an hour"}
    price = float(df.close.iloc[-1])
    mid, lower = bollinger_levels(cfg, df)
    stop = price * (1 - cfg.risk.stop_loss_pct)
    sig = targets(strategy, df, False)
    flips = np.flatnonzero(sig.to_numpy()[1:] != sig.to_numpy()[:-1])
    mins_in = 5 * (len(sig) - 1 - flips[-1]) if len(flips) else None
    out.update(price=price, stop=stop, target=mid)
    if int(sig.iloc[-1]) == 1 and mins_in is not None and mins_in <= 30 and mid / price - 1 >= 0.03:
        return {**out, "decision": "BUY", "why": f"it just dipped sharply ({mins_in} min ago) and the rule buys dips like this; "
                f"it sells when the price gets back to {money(mid)} ({mid / price - 1:+.1%})"}
    if int(sig.iloc[-1]) == 1:
        return {**out, "decision": "WAIT", "trigger": lower, "why": f"the dip has mostly bounced already. The next BUY comes if it drops below "
                f"{money(lower)} ({lower / price - 1:+.1%} from here)"}
    return {**out, "decision": "WAIT", "trigger": lower, "why": f"no dip right now. The rule buys if it drops below {money(lower)} "
            f"({lower / price - 1:+.1%} from here). Buying hours-old coins after they pump lost money in testing"}


def verdict(coin: dict, settings: dict) -> dict:
    """Apply the tested rule for this kind of asset and decide BUY / WAIT / AVOID with a stop-loss."""
    meme = coin["kind"] == "meme_coin" or coin["market"].split(":")[0] in ("sol", "base", "bsc", "eth")
    lst = next((l for l in settings["lists"] if ("memes" in l["config"]) == meme), settings["lists"][0])
    if meme and coin.get("age_days") is not None and coin["age_days"] < MIN_AGE_DAYS:
        return young_verdict(coin, lst.get("stake"))
    cfg = Config.load(lst["config"])
    stake = lst.get("stake")
    out = {"rule": "20-day breakout (meme coins)" if meme else "200-day trend filter", "stake": stake, "flags": []}
    if coin.get("liquidity") is not None and coin.get("age_days") is not None:
        if coin["liquidity"] < MIN_LIQ:
            out["flags"].append(f"only {money(coin['liquidity'])} in its trading pool (easy to rug or hard to sell)")
        if coin["age_days"] < MIN_AGE_DAYS:
            out["flags"].append(f"only {coin['age_days']:.1f} days old (brand-new coins lost money in testing)")
    if coin.get("uncertain"):
        out["flags"].append(f"{coin['matches']} coins share this name and none clearly matches the screenshot: send the contract address to be sure")
    try:
        df = fetch_candles(coin["market"], "1d")
    except Exception as e:
        return {**out, "decision": "AVOID", "why": f"couldn't get its price history ({str(e)[:80]})"}
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if df.empty and meme and coin.get("age_days") is not None:
        return young_verdict(coin, stake)
    if df.empty:
        return {**out, "decision": "AVOID", "why": "too new for the rule: not even one full day of price history yet. "
                "In testing, buying coins this young lost money"}
    price = float(df.close.iloc[-1])
    out["price"] = price
    if len(df) <= strategy.warmup and meme and coin.get("age_days") is not None:
        return young_verdict(coin, stake)  # not enough daily candles yet: use the 5-minute rule
    if len(df) <= strategy.warmup:
        return {**out, "decision": "AVOID", "why": f"too new for the rule: {len(df)} days of history, it needs {strategy.warmup + 1}. "
                "In testing, buying coins this young lost money; treat it as a lottery ticket at most."}
    sig = targets(strategy, df, False)
    p = cfg.strategy_params
    if cfg.strategy == "breakout":
        stop = float(df["low"].rolling(p.get("exit", 10)).min().iloc[-1])
        trigger = float(df["high"].rolling(p.get("entry", 20)).max().iloc[-1])
    else:
        avg = float(sma(df.close, p.get("period", 200)).iloc[-1])
        stop, trigger = avg * (1 - p.get("band", 0.0)), avg * (1 + p.get("band", 0.0))
    out["stop"] = stop
    flips = np.flatnonzero(sig.to_numpy()[1:] != sig.to_numpy()[:-1])
    days_in = len(sig) - 1 - flips[-1] if len(flips) else len(sig)
    # The rule runs on finished days; judge the entry against the price right now, which can be far from yesterday's close.
    price = live_price(coin["market"]) or price
    out["price"] = price
    risk = 1 - stop / price
    if out["flags"] and meme:
        return {**out, "decision": "AVOID", "why": "red flags: " + "; ".join(out["flags"])}
    out["learn"] = learn.assess(cfg.strategy, df)
    if int(sig.iloc[-1]) == 1 and price < stop:
        return {**out, "decision": "WAIT", "trigger": None,
                "why": f"the trend is breaking today: it's at {money(price)}, already {price / stop - 1:.1%} below the stop-loss "
                       f"({money(stop)}). Unless it climbs back above that by the daily close, the rule turns SELL. Don't buy into that"}
    if int(sig.iloc[-1]) != 1 and price > trigger:
        return {**out, "decision": "WAIT", "trigger": trigger,
                "why": f"it's above the BUY level ({money(trigger)}) right now. If it closes the day above it, that's a fresh BUY: "
                       "check again after the daily close"}
    if int(sig.iloc[-1]) == 1:
        if days_in <= FRESH_DAYS:
            return {**out, "decision": "BUY", "why": f"fresh BUY signal {days_in} day(s) ago; your stop is {risk:.0%} below the price"}
        if risk <= MAX_LATE_RISK:
            return {**out, "decision": "BUY (late)", "why": f"in an uptrend for {days_in} days; joining late, but the stop is only {risk:.0%} below"}
        return {**out, "decision": "WAIT", "why": f"in an uptrend for {days_in} days, but the stop is {risk:.0%} below: too much to risk joining late. "
                "Wait for the next fresh BUY", "trigger": None}
    return {**out, "decision": "WAIT", "trigger": trigger,
            "why": f"no BUY signal. The rule buys if it closes above {money(trigger)} ({trigger / price - 1:+.1%} from here)"}


def live_price(market: str) -> float | None:
    """The latest price (last finished 5-minute candle), or None if it can't be fetched."""
    try:
        df = fetch_candles(market, "5m")
        return float(df.close.iloc[-1]) if len(df) else None
    except Exception:
        return None


SCALP_CONFIG = "config.daytrade.yaml"   # the same rule as your scalping alerts


def scalp_read(market: str) -> dict:
    """The scalping rule (RSI dip buying on the 15-minute chart, as in alerts.scalp.yaml) on this coin or stock."""
    cfg = Config.load(SCALP_CONFIG)
    p = cfg.strategy_params
    try:
        df = fetch_candles(market, "15m")
    except Exception as e:
        return {"decision": "N/A", "why": f"couldn't get its 15-minute chart ({str(e)[:60]})"}
    strategy = build_strategy(cfg.strategy, p)
    if len(df) <= strategy.warmup:
        return {"decision": "WAIT", "why": f"only {len(df)} fifteen-minute candles so far, it needs {strategy.warmup + 1}"}
    sig = targets(strategy, df, False)
    r = float(rsi(df.close, p.get("period", 14)).iloc[-1])
    price = float(df.close.iloc[-1])
    flips = np.flatnonzero(sig.to_numpy()[1:] != sig.to_numpy()[:-1])
    mins_in = 15 * (len(sig) - 1 - flips[-1]) if len(flips) else None
    if int(sig.iloc[-1]) == 1 and mins_in is not None and mins_in <= 30:
        return {"decision": "BUY", "price": price, "learn": learn.assess(cfg.strategy, df), "why": f"dip score (RSI) {r:.0f}, it just dropped hard. Sell when the score gets back "
                f"above {p.get('high', 50)}, usually within a few hours"}
    if int(sig.iloc[-1]) == 1:
        return {"decision": "HOLD", "why": f"in a scalp trade for {mins_in} min (dip score {r:.0f}); it sells when the score gets back above "
                f"{p.get('high', 50)}. Too late to join"}
    return {"decision": "WAIT", "why": f"dip score (RSI) {r:.0f}. A scalp BUY comes when it drops below {p.get('low', 20)}"}


def report(path: str | None, settings_path: str = "alerts.yaml", info: dict | None = None) -> str:
    """`info`: what was read from the screenshot (READ_SCHEMA fields), e.g. read by Claude in the chat app when you
    send it a phone screenshot. Without it, Claude reads the image at `path` through the API."""
    import yaml

    settings = yaml.safe_load(Path(settings_path).read_text())
    info = info or read_screenshot(path)
    lines = [f"Read from the screenshot: {info.get('name') or '?'} {('(' + info['ticker'] + ')') if info.get('ticker') else ''}"
             f"{', ' + info['chain'] if info.get('chain') not in ('none', 'unknown', '') else ''}"
             f"{', value ' + money(info['market_cap_usd']) if info.get('market_cap_usd') else ''}"
             f"{' [' + info['app'] + ']' if info.get('app') else ''}"]
    if not info.get("found_asset"):
        return "\n".join(lines + ["I couldn't find one specific coin or stock in that picture. Try a screenshot of the coin's own page."])
    coin = resolve(info)
    if not coin.get("market"):
        return "\n".join(lines + ["Couldn't check it: " + coin["reason"]])
    v = verdict(coin, settings)
    lines.append(f"Matched to: {coin['label']}" + (f"  {coin['url']}" if coin.get("url") else ""))
    lines.append(f"Type: {asset_type(coin['market'])}")
    lines.append(f"Rule used: {v['rule']}")
    lines.append("")
    lines.append(f"DECISION: {v['decision']}")
    lines.append(f"Why: {v['why']}")
    if v["decision"].startswith("BUY"):
        if v.get("stake"):
            lines.append(f"Amount: ${v['stake']:,.0f} (your fixed amount for this list)")
        lines.append(f"Stop-loss: {money(v['stop'])}. Sell everything if it closes below this; you can also set it as a stop order in your app.")
        if v.get("young"):
            lines.append(f"Take-profit: {money(v['target'])} ({v['target'] / v['price'] - 1:+.1%}). Sell when it gets back there, "
                         "usually within an hour. Don't hold an hours-old coin overnight on this rule.")
            lines.append(f"Track it: add {coin['market']} to watchlist.young.txt and the bot sends the SELL alert (checked every 5 minutes)")
        else:
            lines.append("Take-profit: none. Let it run; the bot's SELL alert (or the stop above) is your exit.")
            if coin.get("market"):
                lines.append(f"Track it: add this line to your watchlist so you get the SELL alert: {coin['market']}")
        lines.append("Copy: " + " | ".join([copy_id(coin["market"]), f"buy ${v['stake']:,.0f}" if v.get("stake") else "buy",
                                          f"price {plain(v['price'])}", f"stop {plain(v['stop'])}"]))
    elif v["decision"] == "WAIT" and v.get("trigger"):
        lines.append("Copy: " + " | ".join([copy_id(coin["market"]), "wait",
                                          f"buy {'below' if v.get('young') else 'above'} {plain(v['trigger'])}"]))
    for f in v.get("flags", []):
        if not v["why"].startswith("red flags"):
            lines.append(f"Warning: {f}")
    if v["decision"].startswith("BUY") and v.get("learn"):
        lines.append(learn.describe(v["learn"]))
    s = scalp_read(coin["market"])
    lines.append("")
    lines.append(f"SCALPING: {s['decision']} (RSI dip on the 15-minute chart, the same rule as your scalping alerts)")
    lines.append(f"Why: {s['why']}")
    if s.get("learn"):
        lines.append(learn.describe(s["learn"]))
    if s["decision"] == "BUY" and v["decision"] == "AVOID":
        lines.append("But the main check says AVOID: the red flags above still apply, so skip it or use lottery money only.")
    lines.append("Scalping is for practice: at app fees (~0.6%+ per buy or sell) it lost money in testing.")
    lines.append("Reminder: the rules are tested, not guaranteed. Only use money you can afford to lose.")
    return "\n".join(lines)
