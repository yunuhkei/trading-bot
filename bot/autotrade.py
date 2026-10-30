"""Auto-trading on Coinbase: the bot buys and sells for you with real money, following the trend rule.

Settings are in autotrade.yaml. Safety, in order:
- The Coinbase API key must be trade-only. In live mode the bot asks Coinbase what the key may do and refuses to
  trade with a key that can move money out.
- It keeps its own ledger and only ever sells coins it bought itself, never coins you already had.
- `budget` caps the money in its trades. `max_loss` is a kill switch: if its trades are down that much in total, it
  sells what it bought, stops, and messages you.
- `mode: dry_run` decides real trades against your real account and messages what it WOULD do, placing no orders.
- If it ever loses its ledger after going live, it stops instead of guessing, and messages you.
Every order (or would-be order) is sent to your phone.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import yaml

from . import learn
from .config import Config
from .signals import alert_target, display_name, fetch_candles, money, notify
from .strategies import build_strategy, targets

FEE = 0.012            # Coinbase taker fee for small accounts, per buy or sell (estimate for dry runs)
MIN_ORDER = 5.0        # dollars; smaller buys are skipped


def make_exchange():
    import ccxt

    key, secret = os.environ.get("COINBASE_API_KEY"), os.environ.get("COINBASE_API_SECRET")
    if not key or not secret:
        return None
    # Coinbase secrets are multi-line PEM keys; allow "\n" escapes in a one-line secret.
    ex = ccxt.coinbase({"apiKey": key.strip(), "secret": secret.strip().replace("\\n", "\n"), "enableRateLimit": True})
    ex.load_markets()
    return ex


def key_can_transfer(ex) -> bool | None:
    """True if the key can move money out (refuse it), False if trade-only, None if Coinbase didn't say."""
    try:
        perms = ex.v3PrivateGetBrokerageKeyPermissions()
        return bool(perms.get("can_transfer"))
    except Exception:
        return None


class Ledger:
    """What the bot itself bought (and still holds), what it made or lost so far, and whether it has stopped."""

    def __init__(self, path: str):
        self.path = Path(path)
        self.existed = self.path.exists()
        saved = json.loads(self.path.read_text()) if self.existed else {}
        self.positions = saved.get("positions", {})   # market -> {"units", "cost"}
        self.realized = saved.get("realized", 0.0)
        self.halted = saved.get("halted", False)
        self.history = saved.get("history", [])

    def save(self):
        self.path.write_text(json.dumps({"positions": self.positions, "realized": self.realized, "halted": self.halted,
                                         "history": self.history[-200:]}, indent=1))

    def pnl(self, prices: dict) -> float:
        return self.realized + sum(p["units"] * prices.get(m, 0) - p["cost"] for m, p in self.positions.items())


class Trader:
    """Places orders: real ones in live mode, pretend ones (at the current price, minus fees) in a dry run."""

    def __init__(self, ex, live: bool):
        self.ex, self.live = ex, live

    def price(self, market: str) -> float:
        return float(self.ex.fetch_ticker(market.replace("-", "/"))["last"])

    def usd_free(self) -> float:
        bal = self.ex.fetch_balance()["free"]
        return float(bal.get("USD") or 0)

    def coin_free(self, market: str) -> float:
        return float(self.ex.fetch_balance()["free"].get(market.split("-")[0]) or 0)

    def _settle(self, order: dict, symbol: str) -> dict:
        for _ in range(5):
            time.sleep(2)
            o = self.ex.fetch_order(order["id"], symbol)
            if o.get("status") == "closed" or o.get("filled"):
                return o
        return o

    def buy(self, market: str, usd: float) -> tuple[float, float]:
        """Spend `usd`. Returns (coins received, dollars spent including fees)."""
        if not self.live:
            return usd * (1 - FEE) / self.price(market), usd
        symbol = market.replace("-", "/")
        o = self._settle(self.ex.create_market_buy_order_with_cost(symbol, usd), symbol)
        fee = float((o.get("fee") or {}).get("cost") or 0)
        return float(o.get("filled") or 0), float(o.get("cost") or usd) + fee

    def sell(self, market: str, units: float) -> float:
        """Sell `units` coins. Returns dollars received after fees."""
        if not self.live:
            return units * self.price(market) * (1 - FEE)
        symbol = market.replace("-", "/")
        amount = float(self.ex.amount_to_precision(symbol, min(units, self.coin_free(market))))
        o = self._settle(self.ex.create_market_sell_order(symbol, amount), symbol)
        fee = float((o.get("fee") or {}).get("cost") or 0)
        return float(o.get("cost") or 0) - fee


def rule_says_hold(cfg: Config, market: str) -> bool:
    df = fetch_candles(market, cfg.timeframe)
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if len(df) <= strategy.warmup:
        return False
    return int(targets(strategy, df, False).iloc[-1]) == 1


def run(settings_path: str = "autotrade.yaml", exchange=None, tell=None) -> str:
    """One check: follow the rule on each market, within the budget and kill switch. Returns a short status line."""
    s = yaml.safe_load(Path(settings_path).read_text())
    mode = str(s.get("mode", "off"))
    if mode not in ("dry_run", "live"):
        return "Auto-trading is off (mode: off in autotrade.yaml)."
    live = mode == "live"
    target = alert_target()

    def say(title: str, msg: str, buy: bool = True):
        print(f"{title}: {msg}", flush=True)
        (tell or (lambda *a: notify(target, *a) if target else None))(title, msg, buy)

    tag = "" if live else "DRY RUN: "
    ex = exchange or make_exchange()
    if ex is None:
        return "No Coinbase API key yet (COINBASE_API_KEY and COINBASE_API_SECRET secrets)."
    can_transfer = key_can_transfer(ex)
    if live and can_transfer:
        say("Auto-trader refused to trade", "Your Coinbase API key can move money out. Make a new key with only View and "
            "Trade allowed, put it in the COINBASE_API_KEY / COINBASE_API_SECRET secrets, and it starts again.", False)
        return "Refused: key can transfer."
    ledger = Ledger(f"autotrade_state_{mode}.json")
    if not ledger.existed and not (live and s.get("live_since")):
        safety = {True: "WARNING: this key can move money out; make a trade-only one before going live",
                  False: "the key is trade-only (it can't withdraw)", None: "Coinbase didn't say what the key may do"}[can_transfer]
        say(f"{tag}Auto-trader connected to Coinbase",
            f"It sees {money(Trader(ex, live).usd_free())} in USD; {safety}. "
            + ("Placing real orders from now on." if live else "Dry run: it will message what it WOULD buy and sell, without trading."))
    if live and s.get("live_since") and not ledger.existed:
        say("Auto-trader stopped", "It lost its notes on what it bought, so it won't guess. Nothing was sold. "
            "Ask Claude to check your Coinbase orders and restart it.", False)
        return "Stopped: ledger missing."
    if ledger.halted:
        return "Stopped by the kill switch earlier. Ask Claude to restart it."

    cfg = learn.apply(Config.load(s.get("strategy_config", "config.trend.yaml")))
    markets = list(s.get("markets", []))
    budget, max_loss = float(s.get("budget", 0)), float(s.get("max_loss", 0))
    trader = Trader(ex, live)
    prices = {m: trader.price(m) for m in markets}

    # Kill switch: down max_loss or more in total -> sell what it bought, stop, tell you.
    if max_loss and ledger.pnl(prices) <= -max_loss:
        for m in list(ledger.positions):
            got = trader.sell(m, ledger.positions[m]["units"])
            ledger.realized += got - ledger.positions.pop(m)["cost"]
        ledger.halted = True
        ledger.save()
        say(f"{tag}Auto-trader hit the kill switch", f"Its trades were down {money(-ledger.pnl(prices))} in total "
            f"(limit {money(max_loss)}), so it sold what it bought and stopped. Ask Claude before restarting.", False)
        return "Kill switch."

    per_coin = budget / max(1, len(markets))
    done = []
    for m in markets:
        hold = rule_says_hold(cfg, m)
        mine = ledger.positions.get(m)
        name = display_name(m)
        if hold and not mine:
            invested = sum(p["cost"] for p in ledger.positions.values())
            usd = min(per_coin, budget - invested, trader.usd_free() if live else per_coin)
            if usd < MIN_ORDER:
                done.append(f"{name}: wanted to buy but only {money(max(usd, 0))} available")
                continue
            units, spent = trader.buy(m, usd)
            ledger.positions[m] = {"units": units, "cost": spent}
            ledger.history.append({"t": time.time(), "market": m, "side": "buy", "usd": spent, "units": units, "price": prices[m]})
            say(f"{tag}BOUGHT {money(spent)} of {name} (crypto, Coinbase)",
                f"The auto-trader {'bought' if live else 'would buy'} {units:.8f} {name.split('-')[0]} at about {money(prices[m])}. "
                f"Rule: {learn.settings_text(cfg.strategy, cfg.strategy_params)}. It sells when the rule says so.")
            done.append(f"{name}: bought")
        elif not hold and mine:
            got = trader.sell(m, mine["units"])
            result = got - mine["cost"]
            ledger.realized += result
            ledger.positions.pop(m)
            ledger.history.append({"t": time.time(), "market": m, "side": "sell", "usd": got, "units": mine["units"], "price": prices[m]})
            say(f"{tag}SOLD {name} for {money(got)} (crypto, Coinbase)",
                f"The trend ended, so the auto-trader {'sold' if live else 'would sell'} at about {money(prices[m])}: "
                f"{result:+.2f} dollars on this trade. Total so far: {ledger.pnl(prices):+.2f} dollars.", False)
            done.append(f"{name}: sold")
        else:
            done.append(f"{name}: {'holding' if mine else 'waiting'}")
    ledger.save()
    return f"{tag}{'; '.join(done)}. Bot's trades so far: {ledger.pnl(prices):+.2f} dollars."
