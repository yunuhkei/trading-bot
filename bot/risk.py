from __future__ import annotations

from .config import RiskConfig


def protective_exit(side: int, entry: float, open_: float, high: float, low: float, risk: RiskConfig) -> float | None:
    """Price at which a stop-loss or take-profit fills within a bar, or None. `side` is 1 (long) or -1 (short).

    If price gaps through the level, fill at the open. If both levels are touched
    in the same bar, assume the stop hit first (the conservative choice).
    """
    if side == 1:
        if risk.stop_loss_pct > 0 and low <= (stop := entry * (1 - risk.stop_loss_pct)):
            return min(open_, stop)
        if risk.take_profit_pct > 0 and high >= (target := entry * (1 + risk.take_profit_pct)):
            return max(open_, target)
    elif side == -1:
        if risk.stop_loss_pct > 0 and high >= (stop := entry * (1 + risk.stop_loss_pct)):
            return max(open_, stop)
        if risk.take_profit_pct > 0 and low <= (target := entry * (1 - risk.take_profit_pct)):
            return min(open_, target)
    return None


def drawdown(equity: float, peak: float) -> float:
    return 0.0 if peak <= 0 else 1 - equity / peak


def drawdown_breached(equity: float, peak: float, risk: RiskConfig) -> bool:
    return risk.max_drawdown_pct > 0 and drawdown(equity, peak) >= risk.max_drawdown_pct


def order_size(side: int, equity: float, price: float, fee_pct: float, risk: RiskConfig) -> float:
    """Signed base-currency quantity for a new 1x position."""
    return side * equity * risk.position_pct / (price * (1 + fee_pct))
