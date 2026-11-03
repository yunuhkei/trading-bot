"""The Solana bot's learning: it re-tests its dip-bounce settings on recent prices and adopts better ones, carefully.

Two separate brains, one per kind of market:
- coins: every day, the last ~7 days of 5-minute candles of every young coin it watched in the last 2 weeks
  (including the ones that died, so it learns from the losers too), at 1% fees per buy or sell.
- stocks: every week, the daily candles since 2019 of the stocks it trades as xStocks, at 0.2% costs.

For each, it replays the rule with every setting in GRIDS (how long an average, and how far below it a dip must go)
and scores each one on the older trades. It is then graded on the newest 30% of trades, which it never studied.
It switches only if the new setting, on those unseen trades: made more than the current one, made money, had enough
trades to judge, and stayed ahead in 80% of reshuffled exams (so luck alone can't switch it). Otherwise it keeps the
current setting. What it uses is saved in models/solbot_<kind>.params.json, and your phone hears about any change.

It also learns from its own trades (in solbot.py): a coin that loses `bench_after_losses` trades in a row is dropped
from the list and not picked again for 2 weeks.
"""
from __future__ import annotations

import itertools
import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("solbot_learn")
MODELS = Path("models")
GRIDS = {"coin": {"period": [15, 20, 30], "width": [1.5, 2.0, 2.5, 3.0]},
         "stock": {"period": [10, 15, 20, 30], "width": [1.5, 2.0, 2.5]}}
FEES = {"coin": 0.01, "stock": 0.002}
MIN_EXAM_TRADES = {"coin": 30, "stock": 40}
EXAM_SHARE, MIN_SURE = 0.3, 0.8
LABEL = {"coin": "young coins (5-minute chart)", "stock": "stocks (daily chart)"}
GRIDS_DEFAULT = {"coin": {"period": 20, "width": 2.0}, "stock": {"period": 20, "width": 2.0}}


def path(kind: str) -> Path:
    return MODELS / f"solbot_{kind}.params.json"


def current(kind: str) -> dict:
    """The settings the bot has adopted for this kind ({} = the config file's own)."""
    try:
        return json.loads(path(kind).read_text()).get("params", {}) if path(kind).exists() else {}
    except (OSError, ValueError):
        return {}


def apply(kind: str, cfg):
    cfg.strategy_params = {**cfg.strategy_params, **current(kind)}
    return cfg


def settings_text(p: dict, kind: str) -> str:
    unit = "candle" if kind == "coin" else "day"
    return f"buy when the price drops {p['width']:g}x its usual swing below its {p['period']}-{unit} average"


def replay(df: pd.DataFrame, params: dict, fee: float, stop_loss: float = 0.2) -> list[tuple[pd.Timestamp, float]]:
    """(buy time, result after fees) of every finished trade: buy at the close of the dip candle, sell at the close of
    the candle that's back at the average, or at the stop-loss."""
    from .strategies import build_strategy

    s = build_strategy("bollinger", params)
    if len(df) <= s.warmup + 5:
        return []
    sig = s.signals(df).clip(lower=0).to_numpy()
    c, lo, idx = df["close"].to_numpy(), df["low"].to_numpy(), df.index
    out, entry = [], None
    for i in range(1, len(df)):
        if entry is None and sig[i] == 1 and sig[i - 1] == 0:
            entry, et = c[i], idx[i]
        elif entry is not None:
            if lo[i] <= entry * (1 - stop_loss):
                out.append((et, (1 - stop_loss) * (1 - fee) ** 2 - 1))
                entry = None
            elif sig[i] == 0:
                out.append((et, c[i] / entry * (1 - fee) ** 2 - 1))
                entry = None
    return out


def tune(kind: str, hist: dict[str, pd.DataFrame], current_params: dict, stop_loss: float = 0.2) -> dict:
    """Try every setting in GRIDS; adopt one only if it wins the exam on the newest trades. Returns the decision."""
    grid = GRIDS[kind]
    cur = {k: current_params.get(k, grid[k][0]) for k in grid}
    combos = [dict(zip(grid, v)) for v in itertools.product(*grid.values())]
    if cur not in combos:
        combos.append(cur)
    trades = {json.dumps(c, sort_keys=True): [t for df in hist.values() for t in replay(df, c, FEES[kind], stop_loss)]
              for c in combos}
    ck = json.dumps(cur, sort_keys=True)
    times = sorted(t for t, _ in trades[ck]) or sorted(t for tr in trades.values() for t, _ in tr)
    if len(times) < 20:
        raise ValueError(f"only {len(times)} trades to learn from")
    cutoff = times[int(len(times) * (1 - EXAM_SHARE))]

    def part(key, exam):
        return np.array([r for t, r in trades[key] if (t >= cutoff) == exam])

    best_key = max(trades, key=lambda k: part(k, False).sum())
    best = json.loads(best_key)
    e_cur, e_best = part(ck, True), part(best_key, True)
    rng = np.random.default_rng(0)
    sure = 0.0
    if len(e_cur) and len(e_best):
        a = rng.choice(e_best, (2000, len(e_best))).sum(axis=1)
        b = rng.choice(e_cur, (2000, len(e_cur))).sum(axis=1)
        sure = float((a > b).mean())
    if best == cur:
        reason = "the current settings did best while it studied"
    elif len(e_best) < MIN_EXAM_TRADES[kind]:
        reason = f"only {len(e_best)} trades on the newest days: too few to judge"
    elif e_best.sum() <= e_cur.sum():
        reason = "the setting that studied best did not beat the current one on the newest trades"
    elif e_best.sum() <= 0:
        reason = "the setting that studied best still lost money on the newest trades"
    elif sure < MIN_SURE:
        reason = f"the new setting did better on the newest trades, but only in {sure:.0%} of reshuffled exams: could be luck"
    else:
        reason = f"on the newest trades it never studied it made more ({sure:.0%} sure)"
    changed = reason.startswith("on the newest trades")
    chosen = best if changed else cur

    def summary(r):
        return {"trades": int(len(r)), "won": float((r > 0).mean()) if len(r) else 0.0, "avg": float(r.mean()) if len(r) else 0.0}
    return {"kind": kind, "learned_at": time.time(), "params": chosen, "changed": changed, "reason": reason, "was": cur,
            "best": best, "tried": len(combos), "markets": len(hist), "exam_from": str(cutoff),
            "exam_current": summary(e_cur), "exam_best": summary(e_best), "sure": sure}


def coin_history(market: str, pages: int = 2) -> pd.DataFrame:
    """About 7 days of 5-minute candles for a Solana coin from its busiest pool (GeckoTerminal)."""
    import requests

    addr = market.split(":", 1)[1]
    pairs = [p for p in requests.get(f"https://api.dexscreener.com/tokens/v1/solana/{addr}", timeout=30).json()
             if p["baseToken"]["address"] == addr]
    pool = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)["pairAddress"]
    rows, before = [], None
    for _ in range(pages):
        params = {"aggregate": 5, "limit": 1000, "currency": "usd", "token": "base"}
        if before:
            params["before_timestamp"] = before
        for attempt in range(4):
            r = requests.get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute", params=params,
                             headers={"Accept": "application/json;version=20230302"}, timeout=30)
            if r.status_code != 429:
                break
            time.sleep(15 * (attempt + 1))
        r.raise_for_status()
        batch = r.json()["data"]["attributes"]["ohlcv_list"]
        if not batch:
            break
        rows += batch
        before = min(b[0] for b in batch)
        time.sleep(3)
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "volume"]).drop_duplicates("t").sort_values("t")
    df.index = pd.to_datetime(df.pop("t"), unit="s", utc=True)
    return df.astype(float)[lambda d: d.index + pd.Timedelta(minutes=5) <= pd.Timestamp.now(tz="UTC")]


def stock_history(ticker: str) -> pd.DataFrame:
    """Daily candles since 2019 (from data/, refreshed daily by the learn workflow; Yahoo if missing)."""
    from .data import load_csv
    from .signals import fetch_yahoo

    for p in (Path(f"data/sp500/{ticker}.csv"), Path(f"data/{ticker.lower()}_1d.csv")):
        if p.exists():
            df = load_csv(str(p))
            return df[df.index >= pd.Timestamp("2019-01-01", tz="UTC")]
    return fetch_yahoo(ticker, "1d")


def maybe_learn(kind: str, markets: list[str], every_hours: float, stop_loss: float, tell, tag: str = "",
                now: float | None = None, history=None) -> dict | None:
    """Re-learn if it's been `every_hours`; save, and tell your phone if the settings changed. Returns the decision."""
    from .solbot import commit

    now = now or time.time()
    saved = json.loads(path(kind).read_text()) if path(kind).exists() else {}
    if now - saved.get("learned_at", 0) < every_hours * 3600 or not markets:
        return None
    history = history or (coin_history if kind == "coin" else stock_history)
    hist = {}
    for m in markets:
        try:
            df = history(m)
            if len(df) > 60:
                hist[m] = df
        except Exception as e:
            log.warning("learning: no history for %s: %s", m, e)
    try:
        result = tune(kind, hist, {**GRIDS_DEFAULT[kind], **saved.get("params", {})}, stop_loss)
    except ValueError as e:
        log.warning("learning (%s) skipped: %s", kind, e)
        result = {**saved, "learned_at": now, "params": saved.get("params", {}), "changed": False, "reason": str(e)}
        MODELS.mkdir(exist_ok=True)
        path(kind).write_text(json.dumps(result, indent=1, default=str))
        return result
    result["learned_at"] = now
    MODELS.mkdir(exist_ok=True)
    path(kind).write_text(json.dumps(result, indent=1, default=str))
    commit([str(path(kind))], f"Solana bot learned ({kind}): " + ("changed settings" if result["changed"] else "kept settings"))
    log.warning("learning (%s): %s", kind, result["reason"])
    if result["changed"]:
        e, w = result["exam_best"], result["exam_current"]
        tell(f"{tag}Solana bot learned: new settings for {LABEL[kind]}",
             f"Now: {settings_text(result['params'], kind)} (was: {settings_text(result['was'], kind)}). "
             f"Why: {result['reason']}. On the newest trades it never studied: {e['trades']} trades, {e['won']:.0%} won, "
             f"{e['avg']:+.1%} average (old settings: {w['trades']} trades, {w['won']:.0%} won, {w['avg']:+.1%}).")
    return result


