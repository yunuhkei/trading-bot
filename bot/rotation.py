"""Monthly rotation: hold the coins that rose the most recently, re-chosen once a month.

On the first day of each month, rank every coin by its return over the last `lookback` days,
then hold the top `top_n` in equal parts until next month. Optional `cash_filter`:
  "self": only hold coins whose own lookback return is positive (otherwise that slot sits in cash)
  "btc":  hold nothing while Bitcoin is below its 200-day average
Decisions use closes up to and including the decision day; trades fill at that same close.
"""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .backtest import compute_stats


def load_universe(folder: str) -> pd.DataFrame:
    """Daily closes, one column per coin, from every CSV in `folder` (columns: ts, open, high, low, close, volume)."""
    closes = {}
    for f in sorted(glob.glob(os.path.join(folder, "*.csv"))):
        df = pd.read_csv(f, parse_dates=["ts"]).set_index("ts")
        closes[os.path.basename(f)[:-4].upper()] = df["close"]
    out = pd.DataFrame(closes).sort_index()
    out.index = pd.to_datetime(out.index, utc=True)
    return out


@dataclass
class RotationResult:
    equity: pd.Series
    holdings: list  # (date, [coins]) per rebalance
    stats: dict


def backtest_rotation(closes: pd.DataFrame, top_n: int = 3, lookback: int = 30, cash_filter: str | None = None,
                      fee_pct: float = 0.006, slippage_pct: float = 0.0005, start=None, end=None,
                      starting_cash: float = 10_000.0, min_history: int = 30) -> RotationResult:
    px = closes.ffill(limit=5)  # bridge short data gaps, but don't carry a dead coin forever
    btc_ok = (px["BTC"] > px["BTC"].rolling(200).mean()) if "BTC" in px else pd.Series(True, index=px.index)
    listed_days = closes.notna().cumsum()
    period = px.loc[start:end]
    month = period.index.year * 12 + period.index.month
    rebalance = np.append(True, month[1:] != month[:-1])

    cost = fee_pct + slippage_pct
    cash, units = starting_cash, pd.Series(0.0, index=px.columns)
    equity, holdings = [], []
    for i, day in enumerate(period.index):
        today = px.loc[day]
        if rebalance[i]:
            ret = today / px.shift(lookback).loc[day] - 1
            eligible = ret[(listed_days.loc[day] >= max(lookback, min_history)) & today.notna() & ret.notna()]
            picks = list(eligible.sort_values(ascending=False).index[:top_n])
            if cash_filter == "self":
                picks = [c for c in picks if eligible[c] > 0]
            elif cash_filter == "btc" and not btc_ok.loc[day]:
                picks = []
            value = cash + float((units * today.fillna(0)).sum())
            target = pd.Series(0.0, index=px.columns)
            for c in picks:
                target[c] = value / top_n / today[c]  # empty slots stay in cash
            traded = float((abs(target - units) * today.fillna(0)).sum())
            cash = value - float((target * today.fillna(0)).sum()) - traded * cost
            units = target
            holdings.append((day, picks))
        equity.append(cash + float((units * today.fillna(0)).sum()))

    eq = pd.Series(equity, index=period.index)
    btc = period["BTC"] if "BTC" in period else period.iloc[:, 0]
    stats = compute_stats(eq, [], btc, 365, float(np.mean([len(h) > 0 for _, h in holdings])))
    stats["rebalances"] = len(holdings)
    return RotationResult(eq, holdings, stats)
