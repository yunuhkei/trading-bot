"""Strategies map an OHLCV frame to a target position per bar: 1 = long, -1 = short, 0 = flat.

The signal on bar t may only use data up to and including bar t's close.
Execution happens on bar t+1's open, so there is no lookahead.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import ema, rsi, sma


class Strategy:
    name = "base"

    def __init__(self, **params):
        self.params = params

    @property
    def warmup(self) -> int:
        return 0

    def signals(self, df: pd.DataFrame) -> pd.Series:
        raise NotImplementedError


class SMACross(Strategy):
    """Long while the fast MA is above the slow MA, short while below.

    Optional RSI filters: no new longs when RSI > rsi_max, no new shorts when RSI < rsi_min.
    """

    name = "sma_cross"

    def __init__(self, fast: int = 20, slow: int = 50, use_ema: bool = False,
                 rsi_max: float = 100, rsi_min: float = 0):
        if fast >= slow:
            raise ValueError("fast must be < slow")
        super().__init__(fast=fast, slow=slow, use_ema=use_ema, rsi_max=rsi_max, rsi_min=rsi_min)
        self.fast, self.slow, self.use_ema = fast, slow, use_ema
        self.rsi_max, self.rsi_min = rsi_max, rsi_min

    @property
    def warmup(self) -> int:
        return self.slow

    def signals(self, df: pd.DataFrame) -> pd.Series:
        ma = ema if self.use_ema else sma
        f, s = ma(df["close"], self.fast), ma(df["close"], self.slow)
        trend = np.where(s.isna(), 0, np.where(f > s, 1, -1))
        r = rsi(df["close"]).to_numpy()
        out, pos = [], 0
        for want, v in zip(trend, r):
            if want != pos:
                blocked = (want == 1 and v > self.rsi_max) or (want == -1 and v < self.rsi_min)
                pos = 0 if blocked else want
            out.append(pos)
        return pd.Series(out, index=df.index)


class RSIMeanReversion(Strategy):
    """Buy oversold (RSI < low), exit above `high`. Mirrored for shorts: short above 100-low, exit below 100-high."""

    name = "rsi_revert"

    def __init__(self, period: int = 14, low: float = 30, high: float = 55):
        super().__init__(period=period, low=low, high=high)
        self.period, self.low, self.high = period, low, high

    @property
    def warmup(self) -> int:
        return self.period * 3

    def signals(self, df: pd.DataFrame) -> pd.Series:
        r = rsi(df["close"], self.period)
        out, pos = [], 0
        for v in r:
            if pos == 1 and v > self.high or pos == -1 and v < 100 - self.high:
                pos = 0
            if pos == 0:
                pos = 1 if v < self.low else -1 if v > 100 - self.low else 0
            out.append(pos)
        return pd.Series(out, index=df.index)


class Breakout(Strategy):
    """Donchian channel breakout ("turtle" style), both directions, with a trend filter.

    - Long when the close breaks above the highest high of the last `entry` bars and is above the `trend` EMA.
    - Short when the close breaks below the lowest low of the last `entry` bars and is below the `trend` EMA.
    - Exit a long when the close falls below the lowest low of the last `exit` bars (mirror for shorts).

    Breakout strategies are right less than half the time; they rely on a few large trends
    paying for many small losses.
    """

    name = "breakout"

    def __init__(self, entry: int = 20, exit: int = 10, trend: int = 200):
        if exit >= entry:
            raise ValueError("exit must be < entry")
        super().__init__(entry=entry, exit=exit, trend=trend)
        self.entry, self.exit, self.trend = entry, exit, trend

    @property
    def warmup(self) -> int:
        return max(self.entry, self.trend)

    def signals(self, df: pd.DataFrame) -> pd.Series:
        c = df["close"]
        # shift(1): compare today's close with the channel built from *previous* bars only
        up = df["high"].rolling(self.entry).max().shift(1).to_numpy()
        dn = df["low"].rolling(self.entry).min().shift(1).to_numpy()
        ex_up = df["high"].rolling(self.exit).max().shift(1).to_numpy()
        ex_dn = df["low"].rolling(self.exit).min().shift(1).to_numpy()
        tr = ema(c, self.trend).to_numpy() if self.trend else np.full(len(c), np.nan)
        out, pos = [], 0
        for i, px in enumerate(c.to_numpy()):
            if i < self.warmup:
                out.append(0)
                continue
            if pos == 1 and px < ex_dn[i] or pos == -1 and px > ex_up[i]:
                pos = 0
            if pos == 0:
                above = not self.trend or px > tr[i]
                below = not self.trend or px < tr[i]
                pos = 1 if px > up[i] and above else -1 if px < dn[i] and below else 0
            out.append(pos)
        return pd.Series(out, index=df.index)


class TrendFilter(Strategy):
    """Hold while the close is above its `period`-bar SMA; short while below (if shorting is on).

    `band` adds a buffer (e.g. 0.02 = 2%) so price must clear the average by that much to switch,
    which cuts down on back-and-forth trades when price hovers near the line.
    """

    name = "trend"

    def __init__(self, period: int = 200, band: float = 0.0):
        super().__init__(period=period, band=band)
        self.period, self.band = period, band

    @property
    def warmup(self) -> int:
        return self.period

    def signals(self, df: pd.DataFrame) -> pd.Series:
        c = df["close"].to_numpy()
        m = sma(df["close"], self.period).to_numpy()
        out, pos = [], 0
        for px, ma in zip(c, m):
            if np.isnan(ma):
                out.append(0)
                continue
            if px > ma * (1 + self.band):
                pos = 1
            elif px < ma * (1 - self.band):
                pos = -1
            out.append(pos)
        return pd.Series(out, index=df.index)


class Momentum(Strategy):
    """Long when the price is higher than it was `lookback` bars ago; short when it is lower."""

    name = "momentum"

    def __init__(self, lookback: int = 90):
        super().__init__(lookback=lookback)
        self.lookback = lookback

    @property
    def warmup(self) -> int:
        return self.lookback

    def signals(self, df: pd.DataFrame) -> pd.Series:
        change = df["close"].pct_change(self.lookback)
        return pd.Series(np.where(change.isna(), 0, np.sign(change)), index=df.index).astype(int)


def _day_key(df: pd.DataFrame) -> pd.Index:
    return df.index.normalize()


class OpeningRange(Strategy):
    """Opening range breakout: after the first `range_bars` candles of the day, go long on a close
    above that range's high, or short on a close below its low. Meant for `day_trade: true`."""

    name = "orb"

    def __init__(self, range_bars: int = 2):
        super().__init__(range_bars=range_bars)
        self.range_bars = range_bars

    def signals(self, df: pd.DataFrame) -> pd.Series:
        day = _day_key(df)
        n = df.groupby(day).cumcount().to_numpy()
        first = n < self.range_bars
        hi = df["high"].where(first).groupby(day).transform("max").to_numpy()
        lo = df["low"].where(first).groupby(day).transform("min").to_numpy()
        c, d = df["close"].to_numpy(), day.to_numpy()
        out, pos = np.zeros(len(df), int), 0
        for i in range(len(df)):
            if i == 0 or d[i] != d[i - 1]:
                pos = 0
            if not first[i]:  # the range is only known once its candles have closed
                if c[i] > hi[i]:
                    pos = 1
                elif c[i] < lo[i]:
                    pos = -1
            out[i] = pos
        return pd.Series(out, index=df.index)


class VWAP(Strategy):
    """Trades around the day's volume-weighted average price (VWAP), reset each day.

    mode "revert": buy when price is `k` below VWAP, exit back at VWAP (mirror for shorts).
    mode "trend":  long when price is `k` above VWAP, short when `k` below.
    """

    name = "vwap"

    def __init__(self, mode: str = "revert", k: float = 0.005):
        super().__init__(mode=mode, k=k)
        self.mode, self.k = mode, k

    def signals(self, df: pd.DataFrame) -> pd.Series:
        day = _day_key(df)
        typical = (df["high"] + df["low"] + df["close"]) / 3
        vol = df["volume"].replace(0, np.nan).fillna(1e-9)
        vwap = ((typical * vol).groupby(day).cumsum() / vol.groupby(day).cumsum()).to_numpy()
        c, d = df["close"].to_numpy(), day.to_numpy()
        out, pos = np.zeros(len(df), int), 0
        for i in range(len(df)):
            if i == 0 or d[i] != d[i - 1]:
                pos = 0
            up, dn = c[i] > vwap[i] * (1 + self.k), c[i] < vwap[i] * (1 - self.k)
            if self.mode == "trend":
                pos = 1 if up else -1 if dn else pos
            else:
                if pos == 1 and c[i] >= vwap[i] or pos == -1 and c[i] <= vwap[i]:
                    pos = 0
                if pos == 0:
                    pos = 1 if dn else -1 if up else 0
            out[i] = pos
        return pd.Series(out, index=df.index)


class Bollinger(Strategy):
    """Mean reversion: buy when the close drops `width` standard deviations below its `period`-bar
    average, exit at the average. Mirrored for shorts."""

    name = "bollinger"

    def __init__(self, period: int = 20, width: float = 2.0):
        super().__init__(period=period, width=width)
        self.period, self.width = period, width

    @property
    def warmup(self) -> int:
        return self.period

    def signals(self, df: pd.DataFrame) -> pd.Series:
        c = df["close"]
        mid = c.rolling(self.period).mean().to_numpy()
        sd = c.rolling(self.period).std().to_numpy()
        cc = c.to_numpy()
        out, pos = np.zeros(len(df), int), 0
        for i in range(len(df)):
            if np.isnan(mid[i]):
                continue
            if pos == 1 and cc[i] >= mid[i] or pos == -1 and cc[i] <= mid[i]:
                pos = 0
            if pos == 0:
                pos = 1 if cc[i] < mid[i] - self.width * sd[i] else -1 if cc[i] > mid[i] + self.width * sd[i] else 0
            out[i] = pos
        return pd.Series(out, index=df.index)


class LateDayMomentum(Strategy):
    """If the day is up (down) by more than `threshold` going into its last `hold_bars` candles,
    ride it into the close. Assumes a regular session length (known in advance for stocks)."""

    name = "eod_momentum"

    def __init__(self, hold_bars: int = 2, threshold: float = 0.0):
        super().__init__(hold_bars=hold_bars, threshold=threshold)
        self.hold_bars, self.threshold = hold_bars, threshold

    def signals(self, df: pd.DataFrame) -> pd.Series:
        day = _day_key(df)
        g = df.groupby(day)
        n = g.cumcount().to_numpy()
        size = g["close"].transform("size").to_numpy()
        day_open = g["open"].transform("first").to_numpy()
        ret = df["close"].to_numpy() / day_open - 1
        out = np.zeros(len(df), int)
        decide = n == size - self.hold_bars - 1  # signal on this close, trade from the next candle's open
        sig = np.where(ret > self.threshold, 1, np.where(ret < -self.threshold, -1, 0))
        d = day.to_numpy()
        cur = 0
        for i in range(len(df)):
            if i == 0 or d[i] != d[i - 1]:
                cur = 0
            if decide[i]:
                cur = sig[i]
            out[i] = cur
        return pd.Series(out, index=df.index)


STRATEGIES = {cls.name: cls for cls in (SMACross, RSIMeanReversion, Breakout, TrendFilter, Momentum,
                                        OpeningRange, VWAP, Bollinger, LateDayMomentum)}


def build_strategy(name: str, params: dict | None = None) -> Strategy:
    try:
        return STRATEGIES[name](**(params or {}))
    except KeyError:
        raise ValueError(f"unknown strategy {name!r}; choose from {sorted(STRATEGIES)}") from None


def targets(strategy: Strategy, df: pd.DataFrame, allow_short: bool) -> pd.Series:
    """Strategy signals, with shorts turned into 'flat' when shorting is disabled."""
    sig = strategy.signals(df)
    return sig if allow_short else sig.clip(lower=0)
