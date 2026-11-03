"""The scalp practice bot's learning: every few hours it re-studies recent candles and adjusts its own settings.

How it learns: it replays its rule (bot/strategies.py RsiScalp) on every market in its watchlist with many different
settings (how deep a dip to buy, when to sell, take profit, stop loss) and scores each one by what it would have made
after the practice account's 0.6% fee on each buy and sell. It studies the older candles and is graded on the newest
ones, which it never studied (1-hour candles: 60 days, graded on the newest 15; 5-minute candles: 7 days and 2). It switches to a new setting only if that setting also did better on those
unseen days (or if the current one trades less often than you asked for). Settings that trade less often than
`min_trades_per_hour` across the whole watchlist are not picked, so it keeps scalping instead of learning to sit still.

What it learned is saved in scalp_learned.json (kept between GitHub jobs) and included in the scalp report.
"""
from __future__ import annotations

import itertools
import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .strategies import build_strategy

log = logging.getLogger("scalp_learn")
GRID = {"period": [7, 14], "low": [25, 30, 35], "high": [55, 65], "tp": [0.0, 0.01, 0.02, 0.04], "sl": [0.0, 0.015, 0.03]}
# Per candle size: (days of history it studies, newest days kept back as the exam it never studies).
WINDOWS = {"5m": (7, 2), "15m": (21, 6), "1h": (60, 15)}
GRAN = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600}


def history(market: str, timeframe: str, days: int | None = None) -> pd.DataFrame:
    """Finished candles for the last `days` days (Coinbase for crypto, Yahoo for stocks)."""
    from .signals import fetch_yahoo, is_crypto

    days = days or WINDOWS.get(timeframe, (7, 2))[0]
    if is_crypto(market):
        from .learn import _coinbase_since

        since = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days)
        return _coinbase_since(market.replace("/", "-"), GRAN[timeframe], since)
    df = fetch_yahoo(market, timeframe)
    return df[df.index >= pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days)]


def replay(df: pd.DataFrame, params: dict, timeframe: str, fee: float) -> list[tuple[pd.Timestamp, float]]:
    """(buy time, result after fees) of every finished trade the rule would have made, bought and sold at the close
    of the signal candle like the practice account. Closed at the last candle before a market break (stocks overnight)."""
    strategy = build_strategy("rsi_scalp", params)
    if len(df) <= strategy.warmup + 10:
        return []
    pos = strategy.signals(df).clip(lower=0).to_numpy()
    close, idx = df["close"].to_numpy(), df.index
    gap = pd.Timedelta(seconds=GRAN[timeframe] * 3)
    trades, entry, entry_t = [], None, None
    for i in range(strategy.warmup, len(df)):
        end_of_session = i + 1 < len(df) and idx[i + 1] - idx[i] > gap
        if entry is None and pos[i] == 1 and pos[i - 1] == 0 and not end_of_session:
            entry, entry_t = close[i], idx[i]
        elif entry is not None and (pos[i] == 0 or end_of_session):
            trades.append((entry_t, close[i] / entry * (1 - fee) ** 2 - 1))
            entry = None
    return trades


def score(trades: list, start: pd.Timestamp, end: pd.Timestamp, hours: float) -> dict:
    """Total result (sum of each trade's %, i.e. dollars per $1 a trade), trade count and trades per hour."""
    rets = [r for t, r in trades if start <= t < end]
    return {"total": float(sum(rets)), "trades": len(rets), "per_hour": len(rets) / max(hours, 1e-9),
            "wins": int(sum(r > 0 for r in rets)), "avg": float(np.mean(rets)) if rets else 0.0}


def settings_text(p: dict) -> str:
    sell = [f"RSI back above {p['high']:g}"]
    if p.get("tp"):
        sell.append(f"up {p['tp']:.1%}")
    if p.get("sl"):
        sell.append(f"down {p['sl']:.1%} (stop)")
    return f"buy when the {p['period']}-candle RSI dips below {p['low']:g}; sell at " + " or ".join(sell)


def tune(markets: list[str], current: dict, timeframe: str, fee: float, min_per_hour: float,
         hist: dict[str, pd.DataFrame] | None = None) -> dict:
    """Try every setting in GRID on the last week; return what it picked and why."""
    if hist is None:
        hist = {}
        for m in markets:
            try:
                hist[m] = history(m, timeframe)
            except Exception as e:
                log.warning("scalp learning: no history for %s: %s", m, e)
    hist = {m: df for m, df in hist.items() if len(df)}
    if not hist:
        raise ValueError("no price history to learn from")
    end = max(df.index[-1] for df in hist.values()) + pd.Timedelta(seconds=1)
    start = min(df.index[0] for df in hist.values())
    history_days, exam_days = WINDOWS.get(timeframe, (7, 2))
    cutoff = end - pd.Timedelta(days=exam_days)
    study_h, exam_h = (cutoff - start).total_seconds() / 3600, (end - cutoff).total_seconds() / 3600
    current = {k: current.get(k, GRID[k][0]) for k in GRID}
    combos = [dict(zip(GRID, v)) for v in itertools.product(*GRID.values())]
    if current not in combos:
        combos.append(current)
    results = []
    for c in combos:
        trades = [t for df in hist.values() for t in replay(df, c, timeframe, fee)]
        results.append({"params": c, "study": score(trades, start, cutoff, study_h), "exam": score(trades, cutoff, end, exam_h)})
    cur = next(r for r in results if r["params"] == current)
    busy = [r for r in results if r["study"]["per_hour"] >= min_per_hour]
    pool = busy or sorted(results, key=lambda r: -r["study"]["per_hour"])[:5]
    best = max(pool, key=lambda r: r["study"]["total"])
    cur_busy = cur["exam"]["per_hour"] >= min_per_hour
    if best["params"] == current:
        reason = "the current settings did best while it studied"
    elif not cur_busy and best["exam"]["per_hour"] >= cur["exam"]["per_hour"]:
        reason = (f"the current settings traded only {cur['exam']['per_hour'] * 24:.1f} times a day lately "
                  f"(you asked for {min_per_hour * 24:.3g}+)")
    elif best["exam"]["total"] > cur["exam"]["total"]:
        reason = "it also did better on the newest days it never studied"
    else:
        reason = "the setting that studied best did not beat the current one on the newest days"
    changed = reason.startswith(("the current settings traded", "it also did"))
    chosen = best if changed else cur
    return {"learned_at": time.time(), "params": chosen["params"], "changed": changed, "reason": reason,
            "was": current, "tried": len(combos), "markets": len(hist), "timeframe": timeframe,
            "history_days": history_days, "exam_days": exam_days,
            "exam": chosen["exam"], "exam_was": cur["exam"], "exam_from": str(cutoff.floor("min"))}


def load(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text()) if Path(path).exists() else {}
    except (OSError, ValueError):
        return {}


def maybe_learn(cfg, markets: list[str], opts: dict, fee: float, now: float | None = None) -> tuple[dict, dict | None]:
    """The settings to use now; re-learns first if it's been `every_hours` since the last time.
    Returns (params, what it just learned or None)."""
    now = now or time.time()
    path = opts.get("file", "scalp_learned.json")
    saved = load(path)
    if saved.get("timeframe") != cfg.timeframe:
        saved = {}                     # learned on another candle size: start over
    params = {**cfg.strategy_params, **saved.get("params", {})}
    if now - saved.get("learned_at", 0) < float(opts.get("every_hours", 3)) * 3600:
        return params, None
    try:
        result = tune(markets, params, cfg.timeframe, fee, float(opts.get("min_trades_per_hour", 4)))
    except Exception as e:
        log.warning("scalp learning failed, keeping the current settings: %s", e)
        return params, None
    Path(path).write_text(json.dumps(result, indent=1, default=str))
    return {**cfg.strategy_params, **result["params"]}, result


def learned_text(r: dict) -> str:
    e, w = r["exam"], r["exam_was"]
    lines = [f"Learning: tried {r['tried']} settings on the last {r['history_days']} days of {r['markets']} markets "
             f"({r['timeframe']} candles).",
             ("CHANGED to: " if r["changed"] else "Kept: ") + settings_text(r["params"]) + f" ({r['reason']}).",
             f"On the newest {r['exam_days']} days it never studied: {e['trades']} trades ({e['per_hour'] * 24:.1f} a day), "
             f"{e['wins']} wins, {e['avg']:+.2%} average after fees"
             + (f" (old settings: {w['trades']} trades, {w['avg']:+.2%} average)." if r["changed"] else ".")]
    return "\n".join(lines)


def report(account, since: float, learned: dict | None, rule: str | None, stake: float) -> tuple[str, str] | None:
    """The scalp report for your phone: what the practice bot did since `since`, the account, and what it learned.
    None if it did nothing and learned nothing."""
    events = [e for e in account.events if e["t"] >= since]
    if not events and not learned:
        return None
    buys = [e for e in events if e["action"] == "BUY"]
    sells = [e for e in events if e["action"] == "SELL"]
    made = sum(e.get("profit", 0.0) for e in sells)
    lines = []
    for e in events:
        when = time.strftime("%H:%M", time.gmtime(e["t"]))
        if e["action"] == "BUY":
            lines.append(f"{when} BUY {e['market']} ${stake:,.0f} at {e['price']:.6g}")
        else:
            lines.append(f"{when} SELL {e['market']} at {e['price']:.6g}: {e['result']:+.2%} (${e['profit']:+,.2f})")
    hours = max((time.time() - since) / 3600, 0.1)
    head = (f"{len(buys)} buys, {len(sells)} sells in the last {hours:.1f} h"
            + (f", ${made:+,.2f} on closed trades." if sells else "."))
    body = [head] + lines[-25:] + [account.summary()]
    if account.positions:
        body.append("Holding: " + ", ".join(account.positions))
    if rule:
        body.append("Rule now: " + rule + ".")
    if learned:
        body.append(learned_text(learned))
    title = (f"Scalp report: ${made:+,.2f}" if sells else "Scalp report") + f", account ${account.value():,.0f}" \
            + (" (new settings)" if learned and learned["changed"] else "")
    return title, "\n".join(body)
