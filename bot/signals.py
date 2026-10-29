"""Buy/sell signals for a watchlist, with optional phone alerts. Nothing is ever traded.

For each market, fetch recent candles, run the configured strategy on the closed candles, and report
IN (the strategy would hold it: buy / keep holding) or OUT (sell / stay in cash). When a market's signal
changes since the last check, print an alert and, if a topic is given, push it to the ntfy phone app.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .config import Config
from .data import COLUMNS, clean
from .indicators import rsi, sma
from .strategies import build_strategy, targets

log = logging.getLogger("signals")
COINBASE_GRAN = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400}
YAHOO = {"1d": ("1d", "2y"), "1h": ("60m", "60d"), "15m": ("15m", "30d"), "5m": ("5m", "10d")}


def is_crypto(market: str) -> bool:
    return "-" in market or "/" in market


def fetch_candles(market: str, timeframe: str) -> pd.DataFrame:
    """Recent candles, oldest first, without the candle that's still forming.
    Crypto ('BTC-USD') comes from Coinbase; anything else ('SPY', 'NVDA') from Yahoo Finance."""
    if is_crypto(market):
        gran = COINBASE_GRAN[timeframe]
        r = requests.get(f"https://api.exchange.coinbase.com/products/{market.replace('/', '-')}/candles",
                         params={"granularity": gran}, timeout=30)
        r.raise_for_status()
        df = pd.DataFrame(r.json(), columns=["t", "low", "high", "open", "close", "volume"]).sort_values("t")
        df["ts"] = pd.to_datetime(df.t, unit="s", utc=True)
        df = df.set_index("ts")[COLUMNS].astype(float)
        return clean(df[df.index + pd.Timedelta(seconds=gran) <= pd.Timestamp.now(tz="UTC")])
    interval, rng = YAHOO[timeframe]
    r = requests.get(f"https://query2.finance.yahoo.com/v8/finance/chart/{market}", params={"range": rng, "interval": interval},
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    df = pd.DataFrame({k: q[k] for k in COLUMNS}, index=pd.to_datetime(res["timestamp"], unit="s", utc=True)).dropna()
    if timeframe == "1d":
        df = df[df.index.normalize() < pd.Timestamp.now(tz="UTC").normalize()]  # today's daily candle isn't finished
    else:
        df = df.iloc[:-1]
    return clean(df.astype(float))


def money(x: float) -> str:
    return f"${x:,.2f}" if x >= 1 else f"${x:.4g}"


def explain(cfg: Config, df: pd.DataFrame, stance: str) -> str:
    """A plain-English 'what would flip the signal' note for the built-in strategies."""
    p, close = cfg.strategy_params, df["close"]
    price = close.iloc[-1]
    if cfg.strategy == "trend":
        avg = sma(close, p.get("period", 200)).iloc[-1]
        band = p.get("band", 0.0)
        if stance == "IN":
            down = avg * (1 - band)
            return f"SELL if it closes below {money(down)} ({down / price - 1:+.1%} from here)"
        up = avg * (1 + band)
        return f"BUY if it closes above {money(up)} ({up / price - 1:+.1%} from here)"
    if cfg.strategy == "rsi_revert":
        r = rsi(close, p.get("period", 14)).iloc[-1]
        if stance == "IN":
            return f"RSI {r:.0f}: SELL when it rises above {p.get('high', 55)}" + (" or at the end of the day" if cfg.day_trade else "")
        return f"RSI {r:.0f}: BUY when it drops below {p.get('low', 30)}"
    return ""


def notify(target: str, title: str, message: str, buy: bool) -> bool:
    """Send an alert. `target` is one of:
      ntfy:TOPIC (or just TOPIC)        the free ntfy phone app; anyone who knows the topic can read it, so pick a hard-to-guess name
      discord:WEBHOOK_URL               a channel in your own Discord server (Server settings > Integrations > Webhooks)
      telegram:BOT_TOKEN:CHAT_ID        your own Telegram bot (create one with @BotFather)
    Returns True if it was delivered; logs the reason if not.
    """
    kind, _, rest = target.partition(":") if target.split(":", 1)[0] in ("ntfy", "discord", "telegram") else ("ntfy", "", target)
    icon = "🟢" if buy else "🔴"
    try:
        if kind == "ntfy":
            r = requests.post(f"https://ntfy.sh/{rest}", data=message.encode(), timeout=20,
                              headers={"Title": title.encode("utf-8"), "Tags": "green_circle" if buy else "red_circle", "Priority": "high"})
        elif kind == "discord":
            r = requests.post(rest, json={"content": f"{icon} **{title}**\n{message}"}, timeout=20)
        else:
            token, _, chat = rest.rpartition(":")
            r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat, "text": f"{icon} {title}\n{message}"}, timeout=20)
        r.raise_for_status()
        return True
    except Exception as e:
        detail = getattr(getattr(e, "response", None), "text", "") or str(e)
        log.warning("alert not delivered via %s: %s", kind, detail[:200])
        return False


def check(cfg: Config, markets: list[str], state_path: str = "signals_state.json", topic: str | None = None) -> list[dict]:
    state = json.loads(Path(state_path).read_text()) if Path(state_path).exists() else {}
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    rows = []
    for market in markets:
        try:
            df = fetch_candles(market, cfg.timeframe)
        except Exception as e:
            rows.append({"market": market, "error": str(e)[:80]})
            continue
        if len(df) <= strategy.warmup:
            rows.append({"market": market, "error": f"only {len(df)} candles, need {strategy.warmup + 1}"})
            continue
        sig = targets(strategy, df, cfg.allow_short)
        now = int(sig.iloc[-1])
        flips = np.flatnonzero(sig.to_numpy()[1:] != sig.to_numpy()[:-1])
        since = df.index[flips[-1] + 1] if len(flips) else df.index[0]
        if cfg.day_trade and now == 1 and df.index[-1].normalize() != pd.Timestamp.now(tz="UTC").normalize():
            now = 0  # day trading: never carry a position into a new day
        stance = {1: "IN", 0: "OUT", -1: "SHORT"}[now]
        key = f"{cfg.strategy}:{cfg.timeframe}:{market}"
        prev = state.get(key)
        row = {"market": market, "price": float(df.close.iloc[-1]), "stance": stance, "since": since, "note": explain(cfg, df, stance),
               "changed": prev is not None and prev != stance}
        if row["changed"]:
            action = "BUY" if stance == "IN" else "SELL" if prev == "IN" else stance
            title = f"{action} {market} at {money(row['price'])}"
            msg = f"{cfg.strategy} ({cfg.timeframe}) switched {prev} -> {stance}. {row['note']}"
            log.warning("ALERT %s: %s", title, msg)
            if topic:
                notify(topic, title, msg, buy=stance == "IN")
        state[key] = stance
        rows.append(row)
    Path(state_path).write_text(json.dumps(state, indent=2))
    return rows


def table(rows: list[dict]) -> str:
    out = [f"{'market':<10}{'price':>14}  {'signal':<22}{'since':<14}what would change it"]
    for r in rows:
        if "error" in r:
            out.append(f"{r['market']:<10}  could not check: {r['error']}")
            continue
        signal = {"IN": "IN  (buy / hold)", "OUT": "OUT (sell / cash)", "SHORT": "SHORT"}[r["stance"]] + (" NEW!" if r["changed"] else "")
        out.append(f"{r['market']:<10}{money(r['price']):>14}  {signal:<22}{r['since']:%b %d %H:%M}  {r['note']}")
    return "\n".join(out)


def run(cfg: Config, markets: list[str], topic: str | None, every_minutes: float | None, state_path: str):
    while True:
        print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()))
        print(table(check(cfg, markets, state_path, topic)), flush=True)
        if not every_minutes:
            return
        time.sleep(every_minutes * 60)
