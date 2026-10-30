"""The bot's learning brain: it studies every BUY its rules have ever given and learns which kind tends to win.

For each strategy it replays the rule over every price history in data/ and records each trade: what the market
looked like when the BUY fired (trend, momentum, how stretched, volatile and busy it was) and whether the trade made
money after fees. A model learns from the older trades and is graded on the newest ones, which it never saw. It is
switched on only if, on those unseen trades, the signals it approves made more per trade than simply taking every
signal; otherwise it keeps studying and filters nothing. The weekly learn workflow adds the newest prices and
retrains, so it keeps learning as markets change, including from the signals it gave live that week.

A model is a small JSON file in models/ (a logistic regression: one weight per market feature), so you can read what
it learned.
"""
from __future__ import annotations

import glob
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .backtest import run_backtest
from .config import Config
from .data import load_csv
from .indicators import rsi, sma
from .strategies import build_strategy

MODELS = Path("models")
FEATURES = ["mom_5", "mom_20", "mom_60", "vs_avg_20", "vs_avg_50", "vs_avg_200", "volatility", "vol_change",
            "volume_surge", "rsi", "range_spot", "off_high", "last_candle"]
FEATURE_NAMES = {
    "mom_5": "rise over the last 5 candles", "mom_20": "rise over the last 20 candles", "mom_60": "rise over the last 60 candles",
    "vs_avg_20": "distance above its 20-candle average", "vs_avg_50": "distance above its 50-candle average",
    "vs_avg_200": "distance above its 200-candle average", "volatility": "how jumpy the price is",
    "vol_change": "jumpier than usual", "volume_surge": "trading volume vs normal", "rsi": "dip score (RSI)",
    "range_spot": "where it sits in its 20-candle range", "off_high": "distance below its 60-candle high",
    "last_candle": "size of the signal candle",
}
CRYPTO_15M = {"btc", "eth", "sol", "xrp", "doge", "ada", "avax", "link", "ltc", "bch"}
# Which price files each strategy learns from (the same rules as your alert lists).
STRATEGIES = {
    "trend": {"config": "config.trend.yaml",
              "files": ["data/daily/*.csv", "data/sp500/*.csv", "data/spy_1d.csv", "data/qqq_1d.csv", "data/gld_1d.csv", "data/tlt_1d.csv"]},
    "breakout": {"config": "config.memes.yaml", "files": ["data/memes/*.csv", "data/daily/*.csv"]},
    "rsi_revert": {"config": "config.daytrade.yaml", "files": ["data/intraday/*_15m.csv"]},
}
TEST_SHARE = 0.3          # the newest 30% of trades are the exam the model never studies
MIN_KEPT = 30             # it must approve at least this many exam trades to count
MIN_GAIN = 0.002          # and beat taking every signal by at least 0.2% per trade
MIN_SURE = 0.8            # in at least 80% of reshuffled exams (so luck alone can't switch it on)


def feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """What the market looked like at each candle: the inputs the model learns from."""
    c, o, h, low, v = (df[k] for k in ("close", "open", "high", "low", "volume"))
    r = c.pct_change()
    f = pd.DataFrame(index=df.index)
    for n in (5, 20, 60):
        f[f"mom_{n}"] = c / c.shift(n) - 1
    for n in (20, 50, 200):
        f[f"vs_avg_{n}"] = c / sma(c, n) - 1
    f["volatility"] = r.rolling(20).std()
    f["vol_change"] = r.rolling(20).std() / r.rolling(100).std() - 1
    f["volume_surge"] = np.log((v + 1e-9) / (v.rolling(20).mean() + 1e-9))
    f["rsi"] = rsi(c, 14) / 100
    lo, hi = low.rolling(20).min(), h.rolling(20).max()
    f["range_spot"] = (c - lo) / (hi - lo).replace(0, np.nan)
    f["off_high"] = c / c.rolling(60).max() - 1
    f["last_candle"] = c / o - 1
    return f[FEATURES].replace([np.inf, -np.inf], np.nan)


def replay(df: pd.DataFrame, cfg: Config, market: str) -> list[dict]:
    """Every finished long trade the rule made on this history: features at the BUY candle and the result after fees."""
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if len(df) < strategy.warmup + 30:
        return []
    trades = run_backtest(df, strategy, cfg).trades
    feats = feature_frame(df).to_numpy()
    pos = {t: i for i, t in enumerate(df.index)}
    rows = []
    for t in trades:
        e = pos.get(t.entry_time, 0)
        if t.side != 1 or t.reason == "open" or e == 0:
            continue
        ret = t.exit_price / t.entry_price - 1 - 2 * cfg.fee_pct   # fills include slippage; a fee on the buy and the sell
        rows.append({"market": market, "time": df.index[e - 1], "ret": ret, **dict(zip(FEATURES, feats[e - 1]))})
    return rows


def dataset(name: str) -> pd.DataFrame:
    spec = STRATEGIES[name]
    cfg = Config.load(spec["config"])
    cfg.risk.max_drawdown_pct = 0.0     # learn from every trade, never stop a replay early
    seen, rows = set(), []
    for pattern in spec["files"]:
        for path in sorted(glob.glob(pattern)):
            market = Path(path).stem.replace("_1d", "").replace("_15m", "").lower()
            if market.startswith("_") or market in seen:
                continue
            seen.add(market)
            try:
                rows += replay(load_csv(path), cfg, market)
            except Exception:
                continue
    d = pd.DataFrame(rows)
    if len(d):
        d["time"] = pd.to_datetime(d["time"], utc=True)
        d = d.sort_values("time").reset_index(drop=True)
    return d


def _fit(X: np.ndarray, y: np.ndarray, C: float = 0.3) -> dict:
    from sklearn.linear_model import LogisticRegression

    mean = np.nanmean(X, axis=0)
    scale = np.nanstd(X, axis=0) + 1e-9
    Z = np.clip(np.nan_to_num((X - mean) / scale), -5, 5)
    m = LogisticRegression(C=C, max_iter=2000).fit(Z, y)
    return {"mean": mean.tolist(), "scale": scale.tolist(), "coef": m.coef_[0].tolist(), "intercept": float(m.intercept_[0])}


def _prob(model: dict, X: np.ndarray) -> np.ndarray:
    Z = np.clip(np.nan_to_num((X - np.array(model["mean"])) / np.array(model["scale"])), -5, 5)
    return 1 / (1 + np.exp(-(Z @ np.array(model["coef"]) + model["intercept"])))


def _how_sure(approved: pd.Series, every: pd.Series, n: int = 2000) -> float:
    """Share of reshuffled exams (bootstrap) in which the approved trades still beat every signal on average."""
    if len(approved) < 2:
        return 0.0
    rng = np.random.default_rng(0)
    a = rng.choice(approved.to_numpy(), (n, len(approved))).mean(axis=1)
    b = rng.choice(every.to_numpy(), (n, len(every))).mean(axis=1)
    return float((a > b).mean())


def _summary(ret: pd.Series) -> dict:
    return {"trades": int(len(ret)), "win_rate": float((ret > 0).mean()) if len(ret) else 0.0,
            "avg": float(ret.mean()) if len(ret) else 0.0}


def train(name: str) -> dict:
    """Learn from the older trades, grade on the newest, decide whether to switch on, and save models/<name>.json."""
    d = dataset(name)
    if len(d) < 200:
        raise ValueError(f"{name}: only {len(d)} trades to learn from, need 200")
    X, y, ret = d[FEATURES].to_numpy(float), (d["ret"] > 0).astype(int).to_numpy(), d["ret"]
    cut = int(len(d) * (1 - TEST_SHARE))
    # 1. How picky to be: fit on the first 3/4 of the study period, try keep-shares on its last 1/4.
    inner = int(cut * 0.75)
    p_val = _prob(_fit(X[:inner], y[:inner]), X[inner:cut])
    val_ret = ret.iloc[inner:cut].reset_index(drop=True)
    keep, best = 1.0, val_ret.mean()
    for share in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8):
        kept = val_ret[p_val >= np.quantile(p_val, 1 - share)]
        if len(kept) >= MIN_KEPT and kept.mean() > best:
            keep, best = share, kept.mean()
    # 2. The exam: a model fit on the whole study period, graded on the newest trades it never saw.
    model = _fit(X[:cut], y[:cut])
    threshold = float(np.quantile(_prob(model, X[:cut]), 1 - keep))
    p_test = _prob(model, X[cut:])
    exam = ret.iloc[cut:].reset_index(drop=True)
    approved = exam[p_test >= threshold]
    base, mine = _summary(exam), _summary(approved)
    sure = _how_sure(approved, exam)
    mine["sure"] = sure
    if keep == 1.0:
        reason = "no pickier setting beat taking every signal while it studied"
    elif mine["trades"] < MIN_KEPT:
        reason = f"it approved only {mine['trades']} exam trades, too few to trust"
    elif mine["avg"] < base["avg"] + MIN_GAIN:
        reason = "on the newest trades it never saw, its picks did not beat taking every signal"
    elif mine["avg"] <= 0:
        reason = "its picks lost less than every signal, but still lost money on average, so it won't approve any"
    elif sure < MIN_SURE:
        reason = f"its picks did better, but only in {sure:.0%} of reshuffled exams: could be luck"
    else:
        reason = f"on the newest trades it never saw, its picks beat taking every signal ({sure:.0%} sure)"
    enabled = reason.startswith("on the newest trades it never saw, its picks beat")
    # 3. Live use: once it passed, relearn from everything so it knows the latest market too.
    if enabled:
        model = _fit(X, y)
        threshold = float(np.quantile(_prob(model, X), 1 - keep))
    weights = sorted(zip(FEATURES, model["coef"]), key=lambda kv: -abs(kv[1]))[:3]
    out = {
        "strategy": name, "trained_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "features": FEATURES,
        "model": model, "threshold": threshold, "keep_share": keep, "enabled": bool(enabled), "reason": reason,
        "report": {"study_trades": cut, "exam_trades": base["trades"], "exam_from": str(d["time"].iloc[cut].date()),
                   "every_signal": base, "approved": mine,
                   "learned": [f"{'more' if w > 0 else 'less'} likely to win with a higher {FEATURE_NAMES[f]}" for f, w in weights]},
    }
    MODELS.mkdir(exist_ok=True)
    (MODELS / f"{name}.json").write_text(json.dumps(out, indent=1))
    return out


def load(name: str) -> dict | None:
    path = MODELS / f"{name}.json"
    try:
        return json.loads(path.read_text()) if path.exists() else None
    except (OSError, ValueError):
        return None


def assess(strategy: str, df: pd.DataFrame) -> dict | None:
    """The model's view of a BUY on the last candle of `df`: chance of a win, and whether it approves."""
    m = load(strategy)
    if not m or len(df) < 30:
        return None
    x = feature_frame(df).iloc[-1][m["features"]].to_numpy(float)
    p = float(_prob(m["model"], x[None, :])[0])
    return {"p": p, "enabled": m["enabled"], "approve": (not m["enabled"]) or p >= m["threshold"], "report": m["report"]}


def describe(a: dict | None) -> str:
    """One line for an alert or chart check."""
    if not a:
        return ""
    r = a["report"]
    if not a["enabled"]:
        return ("Bot's learning: still studying. On the newest trades it never saw, it hasn't beaten taking every signal yet, "
                "so it isn't filtering.")
    b, m = r["every_signal"], r["approved"]
    verdict = "likes this one" if a["approve"] else "would SKIP this one"
    return (f"Bot's learning: {verdict} ({a['p']:.0%} chance of a win). On {r['exam_trades']} recent trades it never saw, "
            f"the ones it approved averaged {m['avg']:+.1%} ({m['win_rate']:.0%} won) vs {b['avg']:+.1%} ({b['win_rate']:.0%} won) for every signal.")


def report_text(m: dict) -> str:
    r = m["report"]
    b, a = r["every_signal"], r["approved"]
    lines = [f"== {m['strategy']} (trained {m['trained_at']}) ==",
             f"Studied {r['study_trades']} trades; exam on the {r['exam_trades']} newest (from {r['exam_from']}), never seen while studying.",
             f"  Every signal:   {b['trades']:5d} trades, {b['win_rate']:.0%} won, {b['avg']:+.2%} average",
             f"  Model's picks:  {a['trades']:5d} trades, {a['win_rate']:.0%} won, {a['avg']:+.2%} average"
             + (f" (better in {a['sure']:.0%} of reshuffled exams)" if "sure" in a else ""),
             f"  {'ON' if m['enabled'] else 'OFF'}: {m['reason']}."]
    lines += [f"  Learned: {x}" for x in r["learned"]]
    return "\n".join(lines)


# ---- Keeping the price history fresh, so each week it learns from the newest market too ----

def _append(path: str, new: pd.DataFrame) -> int:
    """Add candles newer than the file's last row, in the file's own timestamp style. Returns rows added."""
    if new is None or new.empty:
        return 0
    first = pd.read_csv(path, nrows=1)["ts"]
    epoch = pd.api.types.is_numeric_dtype(first)
    old = load_csv(path)
    if epoch:
        new = new[new.index > old.index[-1]]
        stamps = [str(int(t.value // 1_000_000)) for t in new.index]
    else:
        new = new[new.index.normalize() > old.index[-1].normalize()]
        stamps = [t.strftime("%Y-%m-%d") for t in new.index]
    if new.empty:
        return 0
    with open(path, "a") as f:
        for ts, row in zip(stamps, new.itertuples(index=False)):
            f.write(",".join([ts] + [repr(float(x)) for x in (row.open, row.high, row.low, row.close, row.volume)]) + "\n")
    return len(new)


def _coinbase_since(product: str, gran: int, since: pd.Timestamp) -> pd.DataFrame:
    import requests

    rows, end = [], pd.Timestamp.now(tz="UTC")
    while end > since:
        start = max(since, end - pd.Timedelta(seconds=gran * 299))
        r = requests.get(f"https://api.exchange.coinbase.com/products/{product}/candles", timeout=30,
                         params={"granularity": gran, "start": start.isoformat(), "end": end.isoformat()})
        r.raise_for_status()
        rows += r.json()
        end = start
        time.sleep(0.35)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["t", "low", "high", "open", "close", "volume"]).drop_duplicates("t").sort_values("t")
    df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True)
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df[df.index + pd.Timedelta(seconds=gran) <= pd.Timestamp.now(tz="UTC")]   # finished candles only


def refresh(log=print) -> int:
    """Append the newest candles to the price files the bot learns from. Returns rows added."""
    from .signals import fetch_candles

    added = 0

    def safe(path, getter):
        nonlocal added
        try:
            added += _append(path, getter())
        except Exception as e:
            log(f"  skipped {path}: {str(e)[:80]}")

    for path in sorted(glob.glob("data/daily/*.csv")):
        sym = Path(path).stem.upper()
        safe(path, lambda: fetch_candles(f"{sym}-USD", "1d"))
    sources = json.loads(Path("data/memes/_sources.json").read_text()) if Path("data/memes/_sources.json").exists() else {}
    for sym, src in sources.items():
        path = f"data/memes/{sym.lower()}.csv"
        if not Path(path).exists():
            continue
        if src["source"] == "coinbase":
            safe(path, lambda: fetch_candles(f"{sym}-USD", "1d"))
        elif src["source"].startswith("dex:") and src.get("pool"):
            net = {"solana": "solana", "base": "base", "ethereum": "eth", "bsc": "bsc"}[src["source"].split(":")[1]]
            safe(path, lambda: _gecko_daily(net, src["pool"]))
    for path in sorted(glob.glob("data/sp500/*.csv")) + [f"data/{t}_1d.csv" for t in ("spy", "qqq", "gld", "tlt")]:
        if Path(path).stem.startswith("_") or not Path(path).exists():
            continue
        ticker = Path(path).stem.replace("_1d", "").upper().replace(".", "-")
        safe(path, lambda: fetch_candles(ticker, "1d"))
        time.sleep(0.3)
    for path in sorted(glob.glob("data/intraday/*_15m.csv")):
        sym = Path(path).stem.replace("_15m", "")
        if sym in CRYPTO_15M:
            safe(path, lambda: _coinbase_since(f"{sym.upper()}-USD", 900, load_csv(path).index[-1]))
        else:
            safe(path, lambda: fetch_candles(sym.upper(), "15m"))
    log(f"Added {added} new candles.")
    return added


def _gecko_daily(net: str, pool: str) -> pd.DataFrame:
    import requests

    r = requests.get(f"https://api.geckoterminal.com/api/v2/networks/{net}/pools/{pool}/ohlcv/day",
                     params={"limit": 60, "currency": "usd", "token": "base"},
                     headers={"Accept": "application/json;version=20230302"}, timeout=30)
    time.sleep(2.5)
    r.raise_for_status()
    df = pd.DataFrame(r.json()["data"]["attributes"]["ohlcv_list"], columns=["t", "open", "high", "low", "close", "volume"])
    df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True)
    df = df.sort_index().astype(float)
    return df[df.index.normalize() < pd.Timestamp.now(tz="UTC").normalize()]
