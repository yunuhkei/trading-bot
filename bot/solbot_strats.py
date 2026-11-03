"""Picks the strategy for each young coin, and switches when one stops working.

For a coin, it replays every candidate strategy (and its settings) on the coin's last ~7 days of 5-minute candles at
1% fees per buy or sell, with the 20% stop-loss:
- dip bounce:   buy a sharp dip below the recent average, sell back at the average
- range bounce: buy a sharp dip, sell higher, above the average (for coins moving sideways)
- RSI dip:      buy when the RSI is very low, sell when it recovers (or at a take profit)

It ranks every strategy on the older 60% of the days (it must have made money there, winning 60%+), then gives only the
5 best an exam on the newest 40%, which it never studied: the first that won at least `min_win_rate` (81%) of its
trades there AND made money is used. If none passes, the bot sits that coin out (no new buys) until one does.
The same test decides whether a newly found coin is added at all.
"""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

FEE = 0.01
CANDIDATES = [
    ("dip bounce", "bollinger", {"period": [15, 20, 30], "width": [1.5, 2.0, 2.5, 3.0], "exit": [0.0]}),
    ("range bounce", "bollinger", {"period": [20, 30], "width": [1.5, 2.0, 2.5], "exit": [0.5, 1.0]}),
    ("RSI dip", "rsi_scalp", {"period": [7, 14], "low": [20, 25, 30], "high": [55, 65], "tp": [0.0, 0.03, 0.05], "sl": [0.0]}),
]
STUDY_SHARE = 0.6
MIN_STUDY, MIN_EXAM = 6, 4


def replay(df: pd.DataFrame, strategy: str, params: dict, fee: float = FEE, stop_loss: float = 0.2,
           max_drop: float | None = None) -> list[tuple]:
    """(buy time, result after fees) of every finished long trade; sold at the stop-loss if the low reaches it.
    `max_drop`: skip buys while the coin is a falling knife (down more than that over the last 6 hours), like the bot."""
    from .strategies import build_strategy

    s = build_strategy(strategy, params)
    if len(df) <= s.warmup + 5:
        return []
    sig = s.signals(df).clip(lower=0).to_numpy()
    c, lo, idx = df["close"].to_numpy(), df["low"].to_numpy(), df.index
    out, entry = [], None
    for i in range(1, len(df)):
        if entry is None and sig[i] == 1 and sig[i - 1] == 0 and not (max_drop and i >= 72 and c[i] / c[i - 72] < 1 - max_drop):
            entry, et = c[i], idx[i]
        elif entry is not None:
            if lo[i] <= entry * (1 - stop_loss):
                out.append((et, (1 - stop_loss) * (1 - fee) ** 2 - 1))
                entry = None
            elif sig[i] == 0:
                out.append((et, c[i] / entry * (1 - fee) ** 2 - 1))
                entry = None
    return out


def _stats(r: list[float]) -> dict:
    a = np.array(r)
    return {"trades": int(len(a)), "won": float((a > 0).mean()) if len(a) else 0.0,
            "avg": float(a.mean()) if len(a) else 0.0, "total": float(a.sum()) if len(a) else 0.0}


def choose(df: pd.DataFrame, min_win_rate: float = 0.81, stop_loss: float = 0.2, min_study_win: float = 0.6,
           top: int = 5, exclude: tuple | None = None, max_drop: float | None = None) -> dict | None:
    """The best strategy for this coin right now, or None if none qualifies (see the module notes).

    It ranks every strategy and setting on the older days (it must have made money there and won at least
    `min_study_win`), then takes the first of the `top` best that ALSO won `min_win_rate`+ and made money on the
    newest days it never studied. Only the best few get that exam, so a setting can't pass by luck alone."""
    if len(df) < 300:
        return None
    cutoff = df.index[int(len(df) * STUDY_SHARE)]
    ranked = []
    for label, strategy, grid in CANDIDATES:
        for values in itertools.product(*grid.values()):
            params = dict(zip(grid, values))
            for knife in ([None, max_drop] if max_drop else [None]):     # the falling-knife filter on and off
                if exclude and (strategy, params) == exclude[:2] and (len(exclude) < 3 or exclude[2] == knife):
                    continue
                trades = replay(df, strategy, params, stop_loss=stop_loss, max_drop=knife)
                study = _stats([r for t, r in trades if t < cutoff])
                if study["trades"] >= MIN_STUDY and study["won"] >= min_study_win and study["avg"] > 0:
                    ranked.append({"label": label, "strategy": strategy, "params": params, "max_drop": knife,
                                   "study": study, "exam": _stats([r for t, r in trades if t >= cutoff]),
                                   "exam_from": str(cutoff)})
    for c in sorted(ranked, key=lambda c: -c["study"]["total"])[:top]:
        e = c["exam"]
        if e["trades"] >= MIN_EXAM and e["won"] >= min_win_rate and e["avg"] > 0:
            return c
    return None


def describe(c: dict) -> str:
    p = c["params"]
    if c["strategy"] == "rsi_scalp":
        rule = f"buy when the {p['period']}-candle RSI is under {p['low']}, sell when it's over {p['high']}" + (
            f" or up {p['tp']:.0%}" if p.get("tp") else "")
    elif p.get("exit"):
        rule = f"buy {p['width']:g}x its usual swing below the {p['period']}-candle average, sell {p['exit']:g}x above it"
    else:
        rule = f"buy {p['width']:g}x its usual swing below the {p['period']}-candle average, sell back at the average"
    e = c["exam"]
    rule += "; skips falling knives" if c.get("max_drop") else "; also buys dips in a falling coin (works on this one)"
    return (f"{c['label']} ({rule}). On the newest days it never studied: {e['trades']} trades, {e['won']:.0%} won, "
            f"{e['avg']:+.1%} average after fees")


def recent(df: pd.DataFrame, strategy: str, params: dict, days: float = 3, stop_loss: float = 0.2,
           max_drop: float | None = None) -> dict:
    """How a strategy did on this coin's last `days` days."""
    since = df.index[-1] - pd.Timedelta(days=days)
    return _stats([r for t, r in replay(df, strategy, params, stop_loss=stop_loss, max_drop=max_drop) if t >= since])


def review(df: pd.DataFrame, current: dict | None, live: list[float], min_win_rate: float = 0.81,
           stop_loss: float = 0.2, max_drop: float | None = None) -> tuple[str, dict | None, str]:
    """Is the coin's strategy still working? Returns (decision, strategy to use or None, why) where decision is
    "keep", "switch" or "sit out".

    The current strategy is kept while it keeps winning: on the last 3 days at least `min_win_rate` of its trades won
    and they made money (or it barely traded: no evidence it stopped), and the bot's own last trades with it on this
    coin (5+) didn't fall below `min_win_rate`. Otherwise it switches to the strategy that passes the full test in
    choose(), or sits the coin out if none does."""
    if current:
        variants = [current.get("max_drop")] if "max_drop" in current else [None, max_drop] if max_drop else [None]
        tried = {k: recent(df, current["strategy"], current["params"], stop_loss=stop_loss, max_drop=k) for k in variants}
        knife = max(tried, key=lambda k: (tried[k]["won"] >= min_win_rate and tried[k]["avg"] > 0, tried[k]["total"]))
        current, r = {**current, "max_drop": knife}, tried[knife]
        mine = np.array(live[-8:])
        own_ok = len(mine) < 5 or (mine > 0).mean() >= min_win_rate
        if own_ok and r["trades"] < MIN_EXAM:
            return "keep", current, f"{current['label']} barely traded lately ({r['trades']} trades in 3 days): keeping it"
        if own_ok and r["won"] >= min_win_rate and r["avg"] > 0:
            return "keep", current, (f"{current['label']} is still working: last 3 days {r['trades']} trades, "
                                     f"{r['won']:.0%} won, {r['avg']:+.1%} average")
        why = (f"{current['label']} stopped working: " + (
            f"the bot's own last {len(mine)} trades won only {(mine > 0).mean():.0%}" if not own_ok
            else f"last 3 days {r['trades']} trades, {r['won']:.0%} won, {r['avg']:+.1%} average"))
    else:
        why, own_ok = "no strategy yet", True
    # If the bot's own trades with it lost, it's out even if the replay still looks fine (real fills beat replays).
    c = choose(df, min_win_rate, stop_loss,
               exclude=None if own_ok or not current else (current["strategy"], current["params"], current.get("max_drop")),
               max_drop=max_drop)
    if c and current and c["strategy"] == current["strategy"] and c["params"] == current["params"] \
            and c.get("max_drop") == current.get("max_drop"):
        return "keep", current, why
    if c:
        return "switch", c, why
    return "sit out", None, f"{why}, and no strategy is winning {min_win_rate:.0%}+ on it right now"
