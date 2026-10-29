from __future__ import annotations

import time

import numpy as np
import pandas as pd

COLUMNS = ["open", "high", "low", "close", "volume"]


def clean(df: pd.DataFrame, max_wick: float = 0.5) -> pd.DataFrame:
    """Repair bad ticks: wicks more than `max_wick` (50%) beyond the candle body are clamped.

    Exchange history has glitches, e.g. Coinbase BTC-USD on 2017-04-15 shows a low of $0.06.
    Left in, a single bad print like that triggers every stop-loss in a backtest.
    """
    body_lo = df[["open", "close"]].min(axis=1)
    body_hi = df[["open", "close"]].max(axis=1)
    df = df.copy()
    df["low"] = df["low"].clip(lower=body_lo * (1 - max_wick))
    df["high"] = df["high"].clip(upper=body_hi * (1 + max_wick))
    return df


def _frame(rows) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", *COLUMNS])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return clean(df.set_index("ts").astype(float))


def fetch_ccxt(exchange: str, symbol: str, timeframe: str, limit: int = 1000, since_days: float | None = None) -> pd.DataFrame:
    """Fetch OHLCV from a public exchange endpoint (no API keys needed). Paginates when `since_days` is set."""
    import ccxt

    ex = getattr(ccxt, exchange)({"enableRateLimit": True})
    if since_days is None:
        return _frame(ex.fetch_ohlcv(symbol, timeframe, limit=limit))

    tf_ms = ex.parse_timeframe(timeframe) * 1000
    since = ex.milliseconds() - int(since_days * 86_400_000)
    rows: list = []
    while since < ex.milliseconds() - tf_ms:
        batch = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=limit)
        if not batch:
            break
        rows.extend(batch)
        since = batch[-1][0] + tf_ms
        time.sleep(ex.rateLimit / 1000)
    df = _frame(rows)
    return df[~df.index.duplicated()]


def load_csv(path: str) -> pd.DataFrame:
    """CSV with columns: ts (ISO date or epoch ms), open, high, low, close, volume."""
    df = pd.read_csv(path)
    ts = df["ts"]
    df["ts"] = pd.to_datetime(ts, unit="ms", utc=True) if pd.api.types.is_numeric_dtype(ts) else pd.to_datetime(ts, utc=True)
    return clean(df.set_index("ts")[COLUMNS].astype(float))


def synthetic(n: int = 2000, seed: int = 7, start_price: float = 30_000.0, freq: str = "1h") -> pd.DataFrame:
    """Regime-switching random walk, handy for offline testing. Not a market forecast."""
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.normal(0, 0.0015, n // 200 + 1), 200)[:n]
    rets = drift + rng.normal(0, 0.01, n)
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]])
    wick = np.abs(rng.normal(0, 0.004, (2, n)))
    high = np.maximum(open_, close) * (1 + wick[0])
    low = np.minimum(open_, close) * (1 - wick[1])
    idx = pd.date_range("2024-01-01", periods=n, freq=freq.replace("m", "min").replace("1d", "D"), tz="UTC")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                         "volume": rng.uniform(10, 100, n)}, index=idx)
