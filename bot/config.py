from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class RiskConfig:
    position_pct: float = 0.95      # fraction of equity to commit per position (1x, no leverage)
    stop_loss_pct: float = 0.05     # exit if price moves this far against the entry (0 = off)
    take_profit_pct: float = 0.0    # exit if price moves this far in favour of the entry (0 = off)
    max_drawdown_pct: float = 0.25  # halt trading if equity falls this far from its peak


@dataclass
class Config:
    exchange: str = "kraken"
    symbol: str = "BTC/USD"
    market_type: str = "spot"       # "spot" (long only) or "future"/"swap" (can short)
    timeframe: str = "1h"
    strategy: str = "sma_cross"
    strategy_params: dict = field(default_factory=dict)
    allow_short: bool = False
    day_trade: bool = False         # close every position by the last candle of each day (UTC date)
    short_carry_pct_per_day: float = 0.0  # borrow/funding cost charged on shorts in backtests
    starting_cash: float = 10_000.0
    fee_pct: float = 0.001          # per side
    slippage_pct: float = 0.0005    # per side
    risk: RiskConfig = field(default_factory=RiskConfig)
    mode: str = "paper"             # "paper" or "live"
    poll_seconds: int = 60
    state_file: str = "state.json"
    trade_log: str = "trades.csv"

    @classmethod
    def load(cls, path: str | Path | None) -> "Config":
        if path is None:
            return cls()
        raw = yaml.safe_load(Path(path).read_text()) or {}
        risk = RiskConfig(**raw.pop("risk", {}))
        return cls(risk=risk, **raw)
