"""Search many strategies and settings without fooling yourself.

Settings are ranked on the *training* period only. The best ones are then graded on a
*test* period they never saw. A big gap between the two means the result was luck.
"""
from __future__ import annotations

import itertools
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace

import pandas as pd

from .backtest import compute_stats, run_backtest, PERIODS_PER_YEAR
from .config import Config, RiskConfig
from .strategies import build_strategy

GRIDS = {
    "sma_cross": [dict(fast=f, slow=s, use_ema=e) for f in (5, 10, 20, 30, 50) for s in (50, 100, 150, 200)
                  for e in (False, True) if f < s],
    "breakout": [dict(entry=e, exit=x, trend=t) for e in (10, 20, 30, 55, 100) for x in (5, 10, 20, 30)
                 for t in (0, 100, 200) if x < e],
    "rsi_revert": [dict(period=p, low=l, high=h) for p in (7, 14, 21) for l in (20, 25, 30, 35)
                   for h in (50, 55, 60, 70)],
    "trend": [dict(period=p, band=b) for p in (20, 50, 100, 150, 200) for b in (0.0, 0.02, 0.05)],
    "momentum": [dict(lookback=n) for n in (10, 20, 30, 60, 90, 120, 180, 270, 365)],
}
RISK = [dict(stop_loss_pct=sl, max_drawdown_pct=dd) for sl in (0.0, 0.05, 0.10, 0.15) for dd in (0.0, 0.25)]

# Day trading: positions close by the end of each day, so grids are in intraday candles and stops are tight.
DAY_GRIDS = {
    "orb": [dict(range_bars=r) for r in (1, 2, 4, 8)],
    "vwap": [dict(mode=m, k=k) for m in ("revert", "trend") for k in (0.0, 0.002, 0.005, 0.01) if not (m == "revert" and k == 0)],
    "bollinger": [dict(period=p, width=w) for p in (10, 20, 50) for w in (1.5, 2.0, 2.5, 3.0)],
    "eod_momentum": [dict(hold_bars=h, threshold=t) for h in (1, 2, 4) for t in (0.0, 0.005)],
    "rsi_revert": [dict(period=p, low=l, high=h) for p in (7, 14) for l in (20, 30) for h in (50, 60)],
    "momentum": [dict(lookback=n) for n in (4, 8, 16, 32)],
    "sma_cross": [dict(fast=f, slow=s) for f in (5, 10, 20) for s in (20, 50) if f < s],
    "breakout": [dict(entry=e, exit=x, trend=0) for e in (10, 20, 40) for x in (5, 10) if x < e],
}
DAY_RISK = [dict(stop_loss_pct=sl, max_drawdown_pct=0.0) for sl in (0.0, 0.005, 0.01, 0.02)]


def candidates(strategies=None, shorts=(False, True), grids=None, risks=None):
    for name, grid in (grids or GRIDS).items():
        if strategies and name not in strategies:
            continue
        for params, risk, short in itertools.product(grid, risks or RISK, shorts):
            yield name, params, risk, short


def _evaluate(args):
    df, split, base, (name, params, risk, short) = args
    cfg = replace(base, allow_short=short, risk=RiskConfig(**{**base.risk.__dict__, **risk}))
    strat = build_strategy(name, params)
    train = run_backtest(df.loc[:split].iloc[:-1], strat, cfg)
    test = run_backtest(df, strat, cfg, start=split)
    return {"strategy": name, "params": params, "short": short, **{k: v for k, v in risk.items()},
            **{f"train_{k}": v for k, v in train.stats.items()}, **{f"test_{k}": v for k, v in test.stats.items()}}


def search(df: pd.DataFrame, split: str, base: Config, strategies=None, workers=None, day_trade=False) -> pd.DataFrame:
    if day_trade:
        base = replace(base, day_trade=True)
        jobs = [(df, split, base, c) for c in candidates(strategies, grids=DAY_GRIDS, risks=DAY_RISK)]
    else:
        jobs = [(df, split, base, c) for c in candidates(strategies)]
    with ProcessPoolExecutor(workers) as pool:
        rows = list(pool.map(_evaluate, jobs, chunksize=16))
    out = pd.DataFrame(rows)
    # Risk-adjusted training score: yearly growth divided by the worst drop. Rewards making money
    # without huge crashes; a lucky all-in bet with an 80% drop scores poorly.
    out["train_score"] = out["train_cagr_pct"] / out["train_max_drawdown_pct"].clip(lower=5)
    return out.sort_values("train_score", ascending=False).reset_index(drop=True)


def benchmarks(df: pd.DataFrame, split: str, base: Config) -> dict:
    from .backtest import recurring_buy
    ppy = PERIODS_PER_YEAR.get(base.timeframe, 365)
    out = {}
    for label, d, start in (("train", df.loc[:split].iloc[:-1], None), ("test", df, split)):
        seg = d.loc[start:] if start else d
        hold = seg["close"] / seg["close"].iloc[0] * base.starting_cash
        out[f"hold_{label}"] = compute_stats(hold, [], seg["close"], ppy, 1.0)
        dca = recurring_buy(d, base, start=start)
        out[f"dca_{label}"] = compute_stats(dca, [], seg["close"], ppy, 1.0)
    return out
