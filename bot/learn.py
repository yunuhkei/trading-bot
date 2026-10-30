"""The bot's learning brain: it studies every BUY its rules have ever given, tunes the rules, and learns which BUYs win.

For each strategy it replays the rule over every price history in data/ and records each trade: what the market
looked like when the BUY fired (trend, momentum, how stretched, volatile and busy it was) and whether the trade made
money after fees. A model learns from the older trades and is graded on the newest ones, which it never saw. It is
switched on only if, on those unseen trades, the signals it approves made more per trade than simply taking every
signal; otherwise it keeps studying and filters nothing. The weekly learn workflow adds the newest prices and
retrains, so it keeps learning as markets change, including from the signals it gave live that week.

It also tunes the rules themselves (tune): it tries small changes to each strategy's settings and adopts one only if,
on the newest trades it never studied, it made more per market than the current settings, made money, and held up in
80% of reshuffled exams. The daily learn workflow adds the newest prices (including every Fomo coin on your
watchlist) and does both, so the strategy keeps adapting to what the market is doing.

A model is a small JSON file in models/ (a logistic regression: one weight per market feature) and tuned settings are
in models/<strategy>.params.json, so you can read what it learned.
"""
from __future__ import annotations

import glob
import itertools
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
    "breakout": {"config": "config.memes.yaml", "files": ["data/memes/*.csv", "data/seen/*.csv", "data/daily/*.csv"]},
    "rsi_revert": {"config": "config.daytrade.yaml", "files": ["data/intraday/*_15m.csv"]},
}
# The small changes it may try to each strategy's settings.
GRIDS = {
    "trend": {"period": [150, 200, 250], "band": [0.0, 0.02, 0.04]},
    "breakout": {"entry": [15, 20, 30], "exit": [5, 10, 15]},
    "rsi_revert": {"low": [15, 20, 25], "high": [45, 50, 55]},
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


def histories(name: str) -> list[tuple[str, pd.DataFrame]]:
    """Every price history this strategy learns from, once per market."""
    seen, out = set(), []
    for pattern in STRATEGIES[name]["files"]:
        for path in sorted(glob.glob(pattern)):
            market = Path(path).stem.replace("_1d", "").replace("_15m", "").lower()
            if market.startswith("_") or market in seen:
                continue
            seen.add(market)
            try:
                out.append((market, load_csv(path)))
            except Exception:
                continue
    return out


def current_params(name: str) -> dict:
    """The settings the bot has adopted for this strategy so far ({} = the config file's own)."""
    path = MODELS / f"{name}.params.json"
    try:
        return json.loads(path.read_text()).get("params", {}) if path.exists() else {}
    except (OSError, ValueError):
        return {}


def apply(cfg: Config) -> Config:
    """Use the settings the bot learned for this strategy, if it adopted any."""
    if cfg.strategy in GRIDS:
        cfg.strategy_params = {**cfg.strategy_params, **current_params(cfg.strategy)}
    return cfg


def _config(name: str, params: dict | None = None) -> Config:
    cfg = Config.load(STRATEGIES[name]["config"])
    cfg.risk.max_drawdown_pct = 0.0     # learn from every trade, never stop a replay early
    cfg.strategy_params = {**cfg.strategy_params, **current_params(name), **(params or {})}
    return cfg


def dataset(name: str, params: dict | None = None, hist: list | None = None) -> pd.DataFrame:
    cfg = _config(name, params)
    rows = []
    for market, df in hist if hist is not None else histories(name):
        try:
            rows += replay(df, cfg, market)
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


def settings_text(name: str, p: dict) -> str:
    if name == "trend":
        return f"{p.get('period')}-day average with a {p.get('band', 0):.0%} band"
    if name == "breakout":
        return f"buy after a {p.get('entry')}-day high, sell below the {p.get('exit')}-day low"
    if name == "rsi_revert":
        return f"buy when the dip score drops below {p.get('low')}, sell when it's back above {p.get('high')}"
    return str(p)


def tune(name: str, hist: list | None = None) -> dict:
    """Try small changes to the strategy's settings; adopt one only if it wins the exam. Saves models/<name>.params.json."""
    hist = hist if hist is not None else histories(name)
    current = _config(name).strategy_params
    grid = GRIDS[name]
    combos = [{**current, **dict(zip(grid, vals))} for vals in itertools.product(*grid.values())]
    if current not in combos:
        combos.append(current)
    trades = {json.dumps(c, sort_keys=True): dataset(name, c, hist) for c in combos}
    cur = trades[json.dumps(current, sort_keys=True)]
    if len(cur) < 200:
        raise ValueError(f"{name}: only {len(cur)} trades to tune on, need 200")
    cutoff = cur["time"].quantile(1 - TEST_SHARE)
    markets = sorted({m for m, _ in hist})

    def per_market(d: pd.DataFrame, exam: bool) -> pd.Series:
        part = d[(d["time"] >= cutoff) == exam] if len(d) else d
        return (part.groupby("market")["ret"].sum() if len(part) else pd.Series(dtype=float)).reindex(markets, fill_value=0.0)

    study = {k: per_market(d, False).mean() for k, d in trades.items()}
    best_key = max(study, key=study.get)
    best = json.loads(best_key)
    exam_cur, exam_best = per_market(cur, True), per_market(trades[best_key], True)
    diff = (exam_best - exam_cur).to_numpy()
    rng = np.random.default_rng(0)
    sure = float((rng.choice(diff, (2000, len(diff))).mean(axis=1) > 0).mean()) if diff.any() else 0.0
    if best == current:
        reason = "the current settings did best while it studied"
    elif diff.mean() <= 0:
        reason = "the setting that studied best did not beat the current one on the newest trades"
    elif exam_best.mean() <= 0:
        reason = "the setting that studied best still lost money on the newest trades"
    elif sure < MIN_SURE:
        reason = f"the new setting did better on the newest trades, but only in {sure:.0%} of reshuffled exams: could be luck"
    else:
        reason = f"on the newest trades it never studied, the new setting did better ({sure:.0%} sure)"
    adopt = reason.startswith("on the newest trades")
    chosen = best if adopt else current
    out = {"strategy": name, "tuned_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
           "params": {k: chosen[k] for k in grid}, "changed": adopt, "reason": reason,
           "report": {"was": settings_text(name, current), "tried": len(combos), "best": settings_text(name, best),
                      "exam_from": str(cutoff.date()), "exam_current": float(exam_cur.mean()),
                      "exam_best": float(exam_best.mean()), "sure": sure}}
    MODELS.mkdir(exist_ok=True)
    (MODELS / f"{name}.params.json").write_text(json.dumps(out, indent=1))
    return out


def tune_text(t: dict) -> str:
    r = t["report"]
    return "\n".join([
        f"  Settings: tried {r['tried']}; best while studying: {r['best']}.",
        f"  On the newest trades (from {r['exam_from']}): current {r['exam_current']:+.1%} per market vs that one {r['exam_best']:+.1%}.",
        f"  {'CHANGED to ' + r['best'] if t['changed'] else 'Kept: ' + r['was']} ({t['reason']}).",
    ])


def train(name: str, hist: list | None = None) -> dict:
    """Learn from the older trades, grade on the newest, decide whether to switch on, and save models/<name>.json."""
    d = dataset(name, hist=hist)
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


LABELS = {"trend": "trend strategy (BTC, ETH, SOL, stocks)", "breakout": "meme-coin strategy", "rsi_revert": "scalping strategy"}


def run(names: list[str], notify_changes: bool = False, log=print) -> list[tuple[str, str]]:
    """Tune and retrain each strategy; tell your phone about anything that changed. Returns the changes."""
    changes = []
    for name in names:
        try:
            hist = histories(name)
            before = load(name)
            t = tune(name, hist)
            m = train(name, hist)
        except ValueError as e:
            log(str(e))
            continue
        log(report_text(m) + "\n" + tune_text(t) + "\n")
        if t["changed"]:
            changes.append((f"The bot updated its {LABELS[name]}",
                            f"Now: {t['report']['best']} (was: {t['report']['was']}). Why: {t['reason']}."))
        if before and before.get("enabled") != m["enabled"]:
            changes.append((f"The bot's {LABELS[name]} filter is now {'ON' if m['enabled'] else 'OFF'}", m["reason"] + "."))
    if notify_changes and changes:
        from .signals import alert_target, notify

        target = alert_target()
        for title, msg in changes:
            log(f"CHANGE {title}: {msg}")
            if target:
                notify(target, title, msg, buy=True)
    return changes


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
    from .signals import fetch_candles, fetch_yahoo

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
        safe(path, lambda: fetch_yahoo(ticker, "1d"))
        time.sleep(0.3)
    for path in sorted(glob.glob("data/intraday/*_15m.csv")):
        sym = Path(path).stem.replace("_15m", "")
        if sym in CRYPTO_15M:
            safe(path, lambda: _coinbase_since(f"{sym.upper()}-USD", 900, load_csv(path).index[-1]))
        else:
            safe(path, lambda: fetch_yahoo(sym.upper(), "15m"))
    # The Fomo coins on your watchlist: their charts become part of what the meme strategy studies.
    from .signals import is_onchain, read_watchlist

    Path("data/seen").mkdir(parents=True, exist_ok=True)
    for market in read_watchlist("watchlist.memes.txt") if Path("watchlist.memes.txt").exists() else []:
        if not is_onchain(market):
            continue
        chain, address = market.split(":", 1)
        path = f"data/seen/{chain.lower()}_{address}.csv"
        if Path(path).exists():
            safe(path, lambda: fetch_candles(market, "1d"))
        else:
            try:
                added += _write_new(path, fetch_candles(market, "1d"))
            except Exception as e:
                log(f"  skipped {market}: {str(e)[:80]}")
    log(f"Added {added} new candles.")
    return added


def _write_new(path: str, df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return 0
    with open(path, "w") as f:
        f.write("ts,open,high,low,close,volume\n")
        for ts, row in zip(df.index, df.itertuples(index=False)):
            f.write(",".join([ts.strftime("%Y-%m-%d")] + [repr(float(x)) for x in (row.open, row.high, row.low, row.close, row.volume)]) + "\n")
    return len(df)


def _gecko_daily(net: str, pool: str) -> pd.DataFrame:
    import requests

    for attempt in range(4):
        r = requests.get(f"https://api.geckoterminal.com/api/v2/networks/{net}/pools/{pool}/ohlcv/day",
                         params={"limit": 60, "currency": "usd", "token": "base"},
                         headers={"Accept": "application/json;version=20230302"}, timeout=30)
        time.sleep(2.5)
        if r.status_code != 429:
            break
        time.sleep(15 * (attempt + 1))   # the free feed allows only a few requests a minute
    r.raise_for_status()
    df = pd.DataFrame(r.json()["data"]["attributes"]["ohlcv_list"], columns=["t", "open", "high", "low", "close", "volume"])
    df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True)
    df = df.sort_index().astype(float)
    return df[df.index.normalize() < pd.Timestamp.now(tz="UTC").normalize()]
