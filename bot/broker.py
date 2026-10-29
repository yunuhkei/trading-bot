from __future__ import annotations

import json
import os
from pathlib import Path


class Broker:
    """Positions are signed base-currency quantities: positive = long, negative = short."""

    def position(self) -> float:
        raise NotImplementedError

    def equity(self, price: float) -> float:
        raise NotImplementedError

    def order(self, qty: float, price: float) -> float:
        """Market order for signed `qty` (buy > 0, sell < 0). Returns the average fill price."""
        raise NotImplementedError


class PaperBroker(Broker):
    """Simulated fills with fees and slippage. Balances persist in a JSON file."""

    def __init__(self, cash: float, fee_pct: float, slippage_pct: float, path: str | None = None):
        self.fee, self.slip = fee_pct, slippage_pct
        self.cash, self.qty = cash, 0.0
        if path and Path(path).exists():
            data = json.loads(Path(path).read_text()).get("broker", {})
            self.cash, self.qty = data.get("cash", cash), data.get("qty", 0.0)

    def position(self):
        return self.qty

    def equity(self, price):
        return self.cash + self.qty * price

    def order(self, qty, price):
        px = price * (1 + self.slip if qty > 0 else 1 - self.slip)
        self.cash -= qty * px + abs(qty) * px * self.fee
        self.qty += qty
        return px

    def to_dict(self):
        return {"cash": self.cash, "qty": self.qty}


class CCXTBroker(Broker):
    """Real orders on a ccxt exchange. Needs API keys in env and an explicit confirmation.

    market_type "spot": long only, position = free base balance.
    market_type "future"/"swap": position read from the exchange; quantities converted to contracts.
    """

    def __init__(self, exchange: str, symbol: str, market_type: str = "spot"):
        import ccxt

        if os.environ.get("BOT_LIVE_CONFIRM") != "I_UNDERSTAND_THIS_USES_REAL_MONEY":
            raise RuntimeError("Live trading requires BOT_LIVE_CONFIRM=I_UNDERSTAND_THIS_USES_REAL_MONEY")
        key, secret = os.environ.get("EXCHANGE_API_KEY"), os.environ.get("EXCHANGE_API_SECRET")
        if not key or not secret:
            raise RuntimeError("Set EXCHANGE_API_KEY and EXCHANGE_API_SECRET")
        # Coinbase CDP secrets are multi-line PEM keys; allow "\n" escapes in a one-line env var.
        secret = secret.replace("\\n", "\n")
        self.ex = getattr(ccxt, exchange)({"apiKey": key, "secret": secret, "enableRateLimit": True})
        self.ex.load_markets()
        self.symbol, self.market = symbol, self.ex.market(symbol)
        self.derivative = market_type != "spot"
        if self.derivative != bool(self.market.get("contract")):
            raise RuntimeError(f"{symbol} is a {self.market['type']} market but market_type is {market_type!r}")
        self.contract_size = float(self.market.get("contractSize") or 1)
        self.quote = self.market["settle"] if self.derivative else self.market["quote"]

    def position(self):
        if not self.derivative:
            return float(self.ex.fetch_balance()["free"].get(self.market["base"]) or 0)
        total = 0.0
        for p in self.ex.fetch_positions([self.symbol]):
            n = float(p.get("contracts") or 0) * self.contract_size
            total += n if p.get("side") == "long" else -n
        return total

    def equity(self, price):
        bal = self.ex.fetch_balance()["total"]
        cash = float(bal.get(self.quote) or 0)
        if self.derivative:
            return cash  # margin balance; unrealized PnL handling varies by exchange
        return cash + float(bal.get(self.market["base"]) or 0) * price

    def order(self, qty, price):
        current = self.position()
        if not self.derivative and current + qty < -1e-12:
            raise RuntimeError("Cannot short on a spot market; use a futures/perpetual symbol")
        amount = abs(qty) / self.contract_size
        amount = float(self.ex.amount_to_precision(self.symbol, amount))
        if amount <= 0:
            raise RuntimeError(f"Order too small for {self.symbol} (min contract size {self.contract_size})")
        params = {}
        if self.derivative and current and (qty > 0) != (current > 0):
            params["reduceOnly"] = True
        side = "buy" if qty > 0 else "sell"
        # Passing price lets ccxt compute cost for exchanges (e.g. Coinbase) that size market buys in quote.
        order = self.ex.create_order(self.symbol, "market", side, amount, price, params)
        return float(order.get("average") or price)
