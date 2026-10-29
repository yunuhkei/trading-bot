from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import Config
from .risk import drawdown_breached, order_size, protective_exit
from .strategies import Strategy, targets

PERIODS_PER_YEAR = {"1m": 525_600, "5m": 105_120, "15m": 35_040, "30m": 17_520,
                    "1h": 8_760, "4h": 2_190, "1d": 365, "1w": 52}


@dataclass
class Trade:
    side: int  # 1 long, -1 short
    entry_time: pd.Timestamp
    entry_price: float
    qty: float
    exit_time: pd.Timestamp | None = None
    exit_price: float | None = None
    reason: str = ""

    @property
    def pnl_pct(self) -> float:
        return self.side * (self.exit_price / self.entry_price - 1) if self.exit_price else 0.0


@dataclass
class Result:
    equity: pd.Series
    trades: list[Trade] = field(default_factory=list)
    halted_at: pd.Timestamp | None = None
    stats: dict = field(default_factory=dict)


def run_backtest(df: pd.DataFrame, strategy: Strategy, cfg: Config, start=None) -> Result:
    """Simulate trading. With `start`, indicators warm up on the earlier data but trading begins at `start`."""
    # Signal from bar t's close is executed at bar t+1's open.
    target = targets(strategy, df, cfg.allow_short).shift(1).fillna(0).astype(int)
    if start is not None:
        target, df = target.loc[start:], df.loc[start:]
    target = target.to_numpy()
    # Last candle of each day (UTC date). US stock sessions fall within one UTC date, so this is their close too.
    day = df.index.normalize() if isinstance(df.index, pd.DatetimeIndex) else pd.Index(np.zeros(len(df)))
    session_end = np.append(day[1:] != day[:-1], True) if cfg.day_trade else np.zeros(len(df), bool)
    o, h, l, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
    fee, slip, risk = cfg.fee_pct, cfg.slippage_pct, cfg.risk
    ppy = PERIODS_PER_YEAR.get(cfg.timeframe, 8_760)
    carry = cfg.short_carry_pct_per_day * 365 / ppy

    cash, pos, peak = cfg.starting_cash, 0.0, cfg.starting_cash
    blocked = 0           # after a stop/TP exit, don't re-enter that side until the signal changes
    halted_at = None
    trades: list[Trade] = []
    equity, held = np.empty(len(df)), np.zeros(len(df))

    def fill(dq, price):
        nonlocal cash, pos
        px = price * (1 + np.sign(dq) * slip)
        cash -= dq * px + abs(dq) * px * fee
        pos += dq
        return px

    def close(i, price, reason):
        t = trades[-1]
        t.exit_price, t.exit_time, t.reason = fill(-pos, price), df.index[i], reason

    for i in range(len(df)):
        side = int(np.sign(pos))
        if halted_at is None:
            if blocked and target[i] != blocked:
                blocked = 0
            if side and target[i] != side:
                close(i, o[i], "signal")
                side = 0
            if not side and target[i] and target[i] != blocked:
                side = target[i]
                dq = order_size(side, cash, o[i] * (1 + side * slip), fee, risk)
                trades.append(Trade(side, df.index[i], fill(dq, o[i]), dq))
            if side:
                px = protective_exit(side, trades[-1].entry_price, o[i], h[i], l[i], risk)
                if px is not None:
                    won = side * (px - trades[-1].entry_price) > 0
                    close(i, px, "take_profit" if won else "stop_loss")
                    blocked, side = side, 0
            if pos and session_end[i]:
                close(i, c[i], "end_of_day")
            if pos < 0:
                cash -= abs(pos) * c[i] * carry

        eq = cash + pos * c[i]
        peak = max(peak, eq)
        if halted_at is None and (eq <= 0 or drawdown_breached(eq, peak, risk)):
            if pos:
                close(i, c[i], "liquidated" if eq <= 0 else "max_drawdown")
            # An exchange closes a position before the account goes below zero.
            cash = max(cash, 0.0)
            eq = cash
            halted_at = df.index[i]
        equity[i], held[i] = eq, pos

    if pos:  # mark open position to market at the end
        trades[-1].exit_time, trades[-1].exit_price, trades[-1].reason = df.index[-1], c[-1], "open"

    eq = pd.Series(equity, index=df.index)
    res = Result(eq, trades, halted_at)
    res.stats = compute_stats(eq, trades, df["close"], ppy, float((held != 0).mean()))
    return res


def recurring_buy(df: pd.DataFrame, cfg: Config, every: int = 7, start=None) -> pd.Series:
    """Benchmark: split starting_cash into equal buys every `every` bars (dollar-cost averaging).

    Uninvested cash waits on the side, so the series shows the whole account.
    """
    df = df.loc[start:] if start is not None else df
    buys = list(range(0, len(df), every))
    chunk = cfg.starting_cash / len(buys)
    o, c = df["open"].to_numpy(), df["close"].to_numpy()
    cash, qty, eq = cfg.starting_cash, 0.0, np.empty(len(df))
    buy_set = set(buys)
    for i in range(len(df)):
        if i in buy_set:
            qty += chunk * (1 - cfg.fee_pct) / (o[i] * (1 + cfg.slippage_pct))
            cash -= chunk
        eq[i] = cash + qty * c[i]
    return pd.Series(eq, index=df.index)


def compute_stats(equity: pd.Series, trades: list[Trade], close: pd.Series, periods_per_year: int,
                  exposure: float) -> dict:
    rets = equity.pct_change().dropna()
    if isinstance(equity.index, pd.DatetimeIndex) and len(equity) > 1:
        # Use calendar time so markets with weekends off (stocks: ~252 bars a year) annualize correctly.
        years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1e-9)
        periods_per_year = len(equity) / years
    else:
        years = max(len(equity) / periods_per_year, 1e-9)
    total = equity.iloc[-1] / equity.iloc[0] - 1
    closed = [t for t in trades if t.reason != "open"]
    wins = [t for t in closed if t.pnl_pct > 0]
    sharpe = rets.mean() / rets.std() * np.sqrt(periods_per_year) if rets.std() > 0 else 0.0
    return {
        "total_return_pct": 100 * total,
        "buy_hold_return_pct": 100 * (close.iloc[-1] / close.iloc[0] - 1),
        "cagr_pct": 100 * ((1 + total) ** (1 / years) - 1) if total > -1 else -100.0,
        "sharpe": float(sharpe),
        "max_drawdown_pct": 100 * float((1 - equity / equity.cummax()).max()),
        "trades": len(trades),
        "long_trades": sum(t.side == 1 for t in trades),
        "short_trades": sum(t.side == -1 for t in trades),
        "win_rate_pct": 100 * len(wins) / len(closed) if closed else 0.0,
        "avg_hold_hours": float(np.mean([(t.exit_time - t.entry_time).total_seconds() / 3600 for t in closed])) if closed else 0.0,
        "exposure_pct": 100 * exposure,
        "final_equity": float(equity.iloc[-1]),
    }
