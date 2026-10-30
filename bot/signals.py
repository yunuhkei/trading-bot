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


CHAINS = {"sol": "solana", "solana": "solana", "base": "base", "bsc": "bsc", "bnb": "bsc", "eth": "ethereum", "ethereum": "ethereum"}
GECKO_NET = {"solana": "solana", "base": "base", "bsc": "bsc", "ethereum": "eth"}
GECKO_TF = {"1d": ("day", 1), "4h": ("hour", 4), "1h": ("hour", 1), "15m": ("minute", 15), "5m": ("minute", 5)}
_names: dict[str, str] = {}


def is_onchain(market: str) -> bool:
    """'sol:<address>', 'base:<address>' etc.: a coin that trades on a blockchain (what apps like Fomo trade)."""
    return market.split(":", 1)[0].lower() in CHAINS and ":" in market


def is_crypto(market: str) -> bool:
    return "-" in market or "/" in market


def display_name(market: str) -> str:
    return _names.get(market, market if not is_onchain(market) else market.split(":", 1)[0] + ":" + market.split(":", 1)[1][:6] + "…")


def fetch_onchain_candles(market: str, timeframe: str) -> pd.DataFrame:
    """Candles for a blockchain coin from its busiest trading pool (pool found on DEX Screener, candles from GeckoTerminal)."""
    chain_key, address = market.split(":", 1)
    chain = CHAINS[chain_key.lower()]
    pairs = requests.get(f"https://api.dexscreener.com/tokens/v1/{chain}/{address}", timeout=30).json()
    pairs = [p for p in pairs if p["baseToken"]["address"].lower() == address.lower()]
    if not pairs:
        raise ValueError("no trading pool found for that address")
    pool = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
    _names[market] = pool["baseToken"]["symbol"]
    unit, agg = GECKO_TF[timeframe]
    for attempt in range(4):
        r = requests.get(f"https://api.geckoterminal.com/api/v2/networks/{GECKO_NET[chain]}/pools/{pool['pairAddress']}/ohlcv/{unit}",
                         params={"aggregate": agg, "limit": 300, "currency": "usd", "token": "base"},
                         headers={"Accept": "application/json;version=20230302"}, timeout=30)
        if r.status_code != 429:
            break
        time.sleep(10 * (attempt + 1))  # the free feed allows only a few requests a minute
    r.raise_for_status()
    rows = r.json()["data"]["attributes"]["ohlcv_list"]
    df = pd.DataFrame(rows, columns=["t", *COLUMNS]).sort_values("t")
    df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True)
    step = {"day": 86400, "hour": 3600, "minute": 60}[unit] * agg
    df = df[df.index + pd.Timedelta(seconds=step) <= pd.Timestamp.now(tz="UTC")]  # drop the candle still forming
    time.sleep(2.5)
    return clean(df.astype(float))


def fetch_candles(market: str, timeframe: str) -> pd.DataFrame:
    """Recent candles, oldest first, without the candle that's still forming. Coinbase crypto ('BTC-USD'),
    blockchain coins by address ('sol:<address>', e.g. what you trade on Fomo), or stocks/funds ('SPY') from Yahoo."""
    if is_onchain(market):
        return fetch_onchain_candles(market, timeframe)
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


def plain(x: float) -> str:
    """A price as a normal decimal you can paste into an app: 2 decimals from $1 up, else 4 significant digits."""
    if x >= 1:
        return f"{x:.2f}"
    return np.format_float_positional(x, precision=4, unique=False, fractional=False, trim="-")


def money(x: float) -> str:
    return f"${x:,.2f}" if x >= 1 else "$" + plain(x)


def copy_id(market: str) -> str:
    """What to paste into an app's search: the full contract address for blockchain coins, else the ticker."""
    return market.split(":", 1)[1] if is_onchain(market) else market


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
    if cfg.strategy == "breakout":
        hi = df["high"].rolling(p.get("entry", 20)).max().iloc[-1]
        lo = df["low"].rolling(p.get("exit", 10)).min().iloc[-1]
        if stance == "IN":
            return f"SELL if it closes below {money(lo)} ({lo / price - 1:+.1%} from here)"
        return f"BUY if it closes above {money(hi)} ({hi / price - 1:+.1%} from here)"
    if cfg.strategy == "rsi_revert":
        r = rsi(close, p.get("period", 14)).iloc[-1]
        if stance == "IN":
            return f"RSI {r:.0f}: SELL when it rises above {p.get('high', 55)}" + (" or at the end of the day" if cfg.day_trade else "")
        return f"RSI {r:.0f}: BUY when it drops below {p.get('low', 30)}"
    if cfg.strategy == "bollinger":
        mid, lower = bollinger_levels(cfg, df)
        if stance == "IN":
            return f"SELL when it gets back to {money(mid)} ({mid / price - 1:+.1%} from here)"
        return f"BUY if it drops below {money(lower)} ({lower / price - 1:+.1%} from here)"
    return ""


def bollinger_levels(cfg: Config, df: pd.DataFrame) -> tuple[float, float]:
    """The dip-bounce rule's average (where it sells) and lower band (where it buys)."""
    p, close = cfg.strategy_params, df["close"]
    n, width = p.get("period", 20), p.get("width", 2.0)
    mid, sd = close.rolling(n).mean().iloc[-1], close.rolling(n).std().iloc[-1]
    return float(mid), float(mid - width * sd)


RULE_NAMES = {"trend": "200-day trend filter", "breakout": "20-day breakout", "rsi_revert": "RSI dip buying",
              "bollinger": "dip bounce (5-minute chart)"}


def stop_level(cfg: Config, df: pd.DataFrame) -> float | None:
    """The price where the rule would say SELL: the stop-loss for a position opened now."""
    p = cfg.strategy_params
    if cfg.strategy == "trend":
        return float(sma(df["close"], p.get("period", 200)).iloc[-1]) * (1 - p.get("band", 0.0))
    if cfg.strategy == "breakout":
        return float(df["low"].rolling(p.get("exit", 10)).min().iloc[-1])
    if cfg.risk.stop_loss_pct:
        return float(df["close"].iloc[-1]) * (1 - cfg.risk.stop_loss_pct)
    return None


def alert_text(cfg: Config, df: pd.DataFrame, market: str, action: str, stake: float | None,
               practice: bool = False) -> tuple[str, str]:
    """Plain-English alert: what to do, how much, the stop-loss and the exit plan."""
    if practice:
        title, msg = alert_text(cfg, df, market, action, stake)
        return "PRACTICE " + title, "Practice only: don't use real money (this rule lost money at app fees in testing).\n" + msg
    price = float(df["close"].iloc[-1])
    name = display_name(market)
    rule = RULE_NAMES.get(cfg.strategy, cfg.strategy)
    if action == "BUY":
        stop = stop_level(cfg, df)
        title = f"BUY {'$' + format(stake, ',.0f') + ' of ' if stake else ''}{name} at {money(price)}"
        lines = [f"Amount: {'$' + format(stake, ',.0f') if stake else 'your usual fixed amount for this list'}."]
        if stop:
            lines.append(f"Stop-loss: {money(stop)} ({stop / price - 1:+.1%}). Sell everything if it closes below this; "
                         "you can set it as a stop order in your app.")
        if cfg.strategy == "bollinger":
            mid = bollinger_levels(cfg, df)[0]
            lines.append(f"Take-profit: about {money(mid)} ({mid / price - 1:+.1%}), where the SELL alert comes (usually within an hour).")
        else:
            lines.append("Take-profit: none. Hold until the SELL alert" + (" (it comes the same day)." if cfg.day_trade else "."))
        lines.append(f"Rule: {rule}.")
        copy = [copy_id(market), f"buy ${stake:,.0f}" if stake else "buy", f"price {plain(price)}"]
        if stop:
            copy.append(f"stop {plain(stop)}")
        lines.append("Copy: " + " | ".join(copy))
        return title, "\n".join(lines)
    if action == "SELL":
        return (f"SELL all of {name} at {money(price)}",
                f"The {rule} says the move is over. Sell your whole position and keep the cash for the next BUY.\n"
                f"Copy: {copy_id(market)} | sell all | price {plain(price)}")
    return f"{action} {name} at {money(price)}", f"The {rule} switched to {action}."


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


PRACTICE_FEE = 0.006  # per buy or sell, about what Coinbase and Fomo charge on small trades


def practice_result(score: dict, entry: float, exit_: float) -> str:
    """Record one practice trade (after fees) and describe it plus the running score."""
    pct = exit_ / entry * (1 - PRACTICE_FEE) ** 2 - 1
    score["trades"] = score.get("trades", 0) + 1
    score["wins"] = score.get("wins", 0) + (pct > 0)
    score["growth"] = score.get("growth", 1.0) * (1 + pct)
    return (f"This trade: {pct:+.1%} after fees. Practice score: {score['trades']} trades, {score['wins']} wins, "
            f"{score['growth'] - 1:+.1%} total ($100 would now be ${100 * score['growth']:,.2f}).")


class PracticeAccount:
    """Fake-money account that trades every BUY and SELL alert by itself at live prices, a fixed amount per buy,
    after fees. Shows what auto-trading would have done before any real money is used."""

    def __init__(self, path: str, cash: float = 80.0, per_trade: float = 10.0, fee: float = PRACTICE_FEE):
        self.path, self.per_trade, self.fee = path, per_trade, fee
        saved = json.loads(Path(path).read_text()) if Path(path).exists() else {}
        self.start = saved.get("start", cash)
        self.cash = saved.get("cash", cash)
        self.positions = saved.get("positions", {})  # market -> {"qty", "cost", "price"}
        self.closed = saved.get("closed", [])        # % result of each finished trade, after fees

    def save(self):
        Path(self.path).write_text(json.dumps({"start": self.start, "cash": self.cash, "positions": self.positions,
                                               "closed": self.closed[-500:]}, indent=2))

    def value(self) -> float:
        return self.cash + sum(p["qty"] * p["price"] for p in self.positions.values())

    def mark(self, market: str, price: float):
        if market in self.positions:
            self.positions[market]["price"] = price

    def buy(self, market: str, price: float) -> str:
        if market in self.positions:
            return "Practice account: already holding it."
        if self.cash < self.per_trade:
            return f"Practice account: skipped, only ${self.cash:,.2f} cash left (needs ${self.per_trade:,.0f})."
        self.cash -= self.per_trade
        self.positions[market] = {"qty": self.per_trade * (1 - self.fee) / price, "cost": self.per_trade, "price": price}
        return f"Practice account: bought ${self.per_trade:,.0f} by itself. " + self.summary()

    def sell(self, market: str, price: float) -> str:
        pos = self.positions.pop(market, None)
        if not pos:
            return ""
        got = pos["qty"] * price * (1 - self.fee)
        self.cash += got
        self.closed.append(got / pos["cost"] - 1)
        return f"Practice account: sold by itself for ${got:,.2f} ({got / pos['cost'] - 1:+.1%} after fees). " + self.summary()

    def summary(self) -> str:
        wins = sum(r > 0 for r in self.closed)
        return (f"Account ${self.value():,.2f} (started ${self.start:,.0f}, {self.value() / self.start - 1:+.1%}): "
                f"${self.cash:,.2f} cash, {len(self.positions)} open, {len(self.closed)} trades done, {wins} wins.")


def check(cfg: Config, markets: list[str], state_path: str = "signals_state.json", topic: str | None = None,
          stake: float | None = None, practice: bool = False, account: PracticeAccount | None = None) -> list[dict]:
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
            title, msg = alert_text(cfg, df, market, action, stake, practice)
            if practice:
                score = state.setdefault("_practice", {})
                if action == "BUY":
                    score.setdefault("open", {})[key] = row["price"]
                elif action == "SELL" and key in score.get("open", {}):
                    msg += "\n" + practice_result(score, score["open"].pop(key), row["price"])
            if account and action in ("BUY", "SELL"):
                note = account.buy(market, row["price"]) if action == "BUY" else account.sell(market, row["price"])
                if note:
                    msg += "\n" + note
            log.warning("ALERT %s: %s", title, msg)
            if topic:
                notify(topic, title, msg, buy=stance == "IN")
        state[key] = stance
        if account:
            account.mark(market, row["price"])
        rows.append(row)
    Path(state_path).write_text(json.dumps(state, indent=2))
    return rows


def table(rows: list[dict]) -> str:
    out = [f"{'market':<10}{'price':>14}  {'signal':<22}{'since':<14}what would change it"]
    for r in rows:
        if "error" in r:
            out.append(f"{display_name(r['market']):<10}  could not check: {r['error']}")
            continue
        signal = {"IN": "IN  (buy / hold)", "OUT": "OUT (sell / cash)", "SHORT": "SHORT"}[r["stance"]] + (" NEW!" if r["changed"] else "")
        out.append(f"{display_name(r['market']):<10}{money(r['price']):>14}  {signal:<22}{r['since']:%b %d %H:%M}  {r['note']}")
    return "\n".join(out)


def run(cfg: Config, markets: list[str], topic: str | None, every_minutes: float | None, state_path: str, stake: float | None = None):
    while True:
        print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()))
        print(table(check(cfg, markets, state_path, topic, stake)), flush=True)
        if not every_minutes:
            return
        time.sleep(every_minutes * 60)


def alert_target(default: str | None = None) -> str | None:
    """Where alerts go, kept out of the (public) repo: ALERT_TARGET env var, then my_alert_channel.txt, then default."""
    import os

    if os.environ.get("ALERT_TARGET"):
        return os.environ["ALERT_TARGET"]
    local = Path("my_alert_channel.txt")
    if local.exists() and local.read_text().strip():
        return local.read_text().strip()
    return default or None


def read_watchlist(path: str) -> list[str]:
    """Markets from a text file: one per line, anything after # ignored."""
    from pathlib import Path as _P
    return [l.split("#", 1)[0].strip() for l in _P(path).read_text().splitlines() if l.split("#", 1)[0].strip()]


def run_alerts(settings_path: str = "alerts.yaml", once: bool = False, notify_override: str | None = None,
               minutes: float | None = None):
    """Check every list in alerts.yaml (each with its own strategy and watchlist) and alert on changes.
    `minutes`: stop after this long (lets GitHub run one long job that checks every few minutes)."""
    import re
    import yaml

    settings = yaml.safe_load(Path(settings_path).read_text())
    target = notify_override or alert_target(settings.get("notify"))
    every = float(settings.get("every_minutes", 60))
    stop_at = time.time() + minutes * 60 if minutes else None
    pt = settings.get("practice_trading") or {}
    while True:
        print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), flush=True)
        account = PracticeAccount(pt.get("file", "practice_account.json"), float(pt.get("cash", 80)),
                                  float(pt.get("per_trade", 10))) if pt.get("enabled") else None
        for lst in settings["lists"]:
            cfg = Config.load(lst["config"])
            slug = re.sub(r"[^a-z0-9]+", "_", lst["name"].lower()).strip("_")
            rows = check(cfg, read_watchlist(lst["watchlist"]), f"signals_state_{slug}.json", target, lst.get("stake"),
                         bool(lst.get("practice")), account if lst.get("practice_account", True) else None)
            print(f"\n== {lst['name']} ==")
            print(table(rows), flush=True)
        if account:
            account.save()
            print("\n== Practice auto-trading (fake money) ==\n" + account.summary(), flush=True)
        ideas_cfg = settings.get("news_ideas") or {}
        if ideas_cfg.get("enabled"):
            from . import news_ideas
            ideas = news_ideas.run(target, "news_ideas_state.json", int(ideas_cfg.get("max_per_check", 3)))
            print("\n== Meme coin ideas from the news (not buy signals) ==")
            print(news_ideas.table(ideas), flush=True)
        if once or (stop_at and time.time() + every * 60 > stop_at):
            return
        print(f"\nNext check in {every:.0f} minutes. Leave this window open; close it to stop.\n", flush=True)
        time.sleep(every * 60)
