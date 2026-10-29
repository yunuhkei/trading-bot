"""Predict meme-coin jackpots from what's visible when a coin first appears, and only alert if that works.

`train` builds one row of clues per coin from the launch watcher's database, fits a simple model on the
older coins, and grades its picks on newer coins it never saw (walk-forward). Alerts are switched on only
if the model's picks made money after costs, beat buying every coin, and beat picking the same number of
coins at random. `alert` then scores each new coin and sends BUY, and later SELL, notifications.
"""
from __future__ import annotations

import json
import logging
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .launch_watch import CHECKS, connect, outcomes

log = logging.getLogger("meme_model")
MODEL_PATH = "data/meme_model.pkl"


def _snapshot_features(row) -> dict:
    """Extra clues from the full feed snapshots (only coins recorded after snapshots were added have them)."""
    out = {}
    try:
        g = json.loads(row.gecko) if isinstance(row.gecko, str) else None
    except ValueError:
        g = None
    if g:
        tx = (g.get("transactions") or {}).get("m5") or {}
        out["m5_buys"], out["m5_sells"] = tx.get("buys", 0), tx.get("sells", 0)
        out["m5_buyers"], out["m5_sellers"] = tx.get("buyers", 0), tx.get("sellers", 0)
        out["m5_volume"] = float((g.get("volume_usd") or {}).get("m5") or 0)
        out["m5_change"] = float((g.get("price_change_percentage") or {}).get("m5") or 0)
    try:
        d = json.loads(row.dex0) if isinstance(row.dex0, str) else None
    except ValueError:
        d = None
    if d:
        info = d.get("info") or {}
        out["socials"] = len(info.get("socials") or [])
        out["websites"] = len(info.get("websites") or [])
        out["has_image"] = int(bool(info.get("imageUrl")))
        out["boosted"] = int(bool((d.get("boosts") or {}).get("active")))
    return out


def build_features(db_path: str) -> pd.DataFrame:
    """One row per coin with everything known when we first saw it (nothing from the future)."""
    db = connect(db_path)
    coins = pd.read_sql("""select c.*, e.price as entry, e.fdv as entry_fdv, e.liquidity as entry_liq, s.gecko, s.dex0
                           from coins c join checks e on e.token = c.token and e.label = '0m'
                           left join snapshots s on s.token = c.token
                           where e.price > 0 and e.missing = 0""", db).sort_values("seen_at").reset_index(drop=True)
    tables = {t for (t,) in db.execute("select name from sqlite_master where type='table'")}
    creators = pd.read_sql("select * from creators", db) if "creators" in tables else pd.DataFrame(columns=["token", "creator"])
    matched = set(pd.read_sql("select distinct token from news_matches", db).token) if "news_matches" in tables else set()
    coins = coins.merge(creators, on="token", how="left")

    f = pd.DataFrame({"token": coins.token, "seen_at": coins.seen_at})
    f["age_seen_min"] = (coins.seen_at - coins.created_at) / 60
    f["log_fdv_seen"] = np.log10(coins.fdv_seen.clip(lower=1))
    f["log_entry_fdv"] = np.log10(coins.entry_fdv.fillna(coins.fdv_seen).clip(lower=1))
    f["fdv_jump"] = f.log_entry_fdv - f.log_fdv_seen            # moved between the two first looks
    f["has_liq"] = coins.entry_liq.notna().astype(int)
    f["log_liq"] = np.log10(coins.entry_liq.fillna(0).clip(lower=1))
    f["buys"], f["sells"] = coins.buys_seen, coins.sells_seen
    f["buy_ratio"] = coins.buys_seen / (coins.buys_seen + coins.sells_seen + 1)
    f["pump_fun"] = (coins.dex == "pump-fun").astype(int)
    f["pumpswap"] = (coins.dex == "pumpswap").astype(int)
    f["meteora"] = coins.dex.str.startswith("meteora").astype(int)
    f["news"] = coins.token.isin(matched).astype(int)
    f["hour"] = pd.to_datetime(coins.seen_at, unit="s").dt.hour

    # Creator history, counted only from coins seen earlier (and whose 15-minute result was already known).
    won15 = outcomes(db_path, 0.0)
    won15 = won15[(won15.label == "15m") & (won15.ret >= 1)][["token"]].assign(win=1)
    hist = coins[["token", "creator", "seen_at"]].merge(won15, on="token", how="left").fillna({"win": 0})
    prev, wins = [], []
    for _, r in hist.iterrows():
        if not isinstance(r.creator, str):
            prev.append(np.nan); wins.append(np.nan); continue
        earlier = hist[(hist.creator == r.creator) & (hist.seen_at < r.seen_at)]
        prev.append(len(earlier))
        wins.append(float(earlier[earlier.seen_at + CHECKS["15m"] <= r.seen_at].win.sum()))
    f["creator_prev"], f["creator_wins"] = prev, wins
    f["creator_known"] = coins.creator.notna().astype(int)

    snap = pd.DataFrame([_snapshot_features(r) for r in coins.itertuples()], index=coins.index)
    return pd.concat([f, snap], axis=1)


def _labelled(db_path: str, horizon: str, cost: float):
    feats = build_features(db_path)
    out = outcomes(db_path, cost)
    out = out[out.label == horizon][["token", "ret", "net"]]
    data = feats.merge(out, on="token").sort_values("seen_at").reset_index(drop=True)
    cols = [c for c in feats.columns if c not in ("token", "seen_at") and data[c].notna().mean() >= 0.5]
    return data, cols


def _model():
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                         LogisticRegression(C=0.3, class_weight="balanced", max_iter=2000))


def train(db_path: str, horizon: str = "15m", jackpot: float = 1.0, cost: float = 0.04, pick_share: float = 0.1,
          out_path: str = MODEL_PATH, seed: int = 7) -> str:
    """Walk-forward test, then (if it passes) fit on everything and save. Returns a plain-English report."""
    data, cols = _labelled(db_path, horizon, cost)
    y = (data.ret >= jackpot).astype(int)
    lines = [f"Coins with a {horizon} result: {len(data)}  |  jackpots ({1 + jackpot:.0f}x+): {int(y.sum())}  |  clues used: {len(cols)}"]
    if y.sum() < 10:
        return "\n".join(lines + ["Not enough jackpots to learn from yet. Keep the watcher running and try again later."])

    rng = np.random.default_rng(seed)
    folds, passed = [(0.5, 0.75), (0.75, 1.0)], []
    lines.append(f"{'test on':<16}{'picked':>7}{'went up':>9}{'jackpots':>10}{'$1 each (picks)':>18}{'$1 each (all coins)':>21}{'random picks do better':>24}")
    for a, b in folds:
        tr, te = data.iloc[: int(len(data) * a)], data.iloc[int(len(data) * a): int(len(data) * b)]
        ytr = (tr.ret >= jackpot).astype(int)
        if ytr.sum() < 5 or len(te) < 20:
            continue
        m = _model().fit(tr[cols], ytr)
        cut = np.quantile(m.predict_proba(tr[cols])[:, 1], 1 - pick_share)   # threshold chosen on training coins only
        p = m.predict_proba(te[cols])[:, 1]
        picks = te[p >= cut]
        k = len(picks)
        pick_mean = picks.net.mean() if k else -1.0
        rand = np.array([te.net.sample(k, random_state=int(rng.integers(1e9))).mean() for _ in range(2000)]) if k else np.array([0.0])
        p_rand = float((rand >= pick_mean).mean())
        ok = k >= 5 and pick_mean > 0 and pick_mean > te.net.mean() and p_rand < 0.1
        passed.append(ok)
        lines.append(f"{'coins ' + str(int(len(data)*a)) + '-' + str(int(len(data)*b)):<16}{k:>7}{(picks.net > 0).mean() if k else 0:>9.0%}"
                     f"{int((picks.ret >= jackpot).sum()) if k else 0:>10}{'$' + str(k) + ' -> $' + format(k * (1 + pick_mean), '.2f'):>18}"
                     f"{'$' + str(len(te)) + ' -> $' + format(len(te) * (1 + te.net.mean()), '.0f'):>21}{p_rand:>24.0%}")

    final = _model().fit(data[cols], y)
    weights = pd.Series(final[-1].coef_[0], index=cols).sort_values()
    verdict = bool(passed) and all(passed)
    meta = {"horizon": horizon, "jackpot": jackpot, "cost": cost, "cols": cols, "passed": verdict, "trained_on": len(data),
            "threshold": float(np.quantile(final.predict_proba(data[cols])[:, 1], 1 - pick_share)), "trained_at": time.time()}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as fh:
        pickle.dump({"model": final, "meta": meta}, fh)
    lines += ["", "Clues that pointed toward a jackpot: " + ", ".join(weights.index[-3:][::-1]),
              "Clues that pointed away from one:    " + ", ".join(weights.index[:3]), ""]
    if verdict:
        lines.append("PASSED: the model's picks made money on coins it never saw, beat buying everything, and beat random picks. Alerts are ON.")
    else:
        lines.append("NOT PASSED: on coins it never saw, the model's picks didn't reliably make money or beat random picks. "
                     "Alerts stay OFF. Keep collecting coins and retrain later (more jackpots to learn from).")
    return "\n".join(lines)


def load(path: str = MODEL_PATH):
    with open(path, "rb") as fh:
        return pickle.load(fh)


def alert(db_path: str, target: str | None, hours: float, force: bool = False, poll_seconds: int = 30):
    """Score every new coin the watcher records; BUY alert for high scores, SELL alert when the hold time is up.
    Needs `launches watch` running at the same time (it records the coins), and a passed model unless `force`."""
    from .signals import notify

    saved = load()
    meta, model = saved["meta"], saved["model"]
    if not meta["passed"] and not force:
        print("Alerts are OFF: the model didn't pass its test (see `launches train`). Use --force to run it anyway for practice.")
        return
    hold = CHECKS[meta["horizon"]]
    alerted, open_trades, start = set(), {}, time.time()
    while time.time() < start + hours * 3600 or open_trades:
        feats = build_features(db_path)
        fresh = feats[(feats.seen_at >= start) & ~feats.token.isin(alerted)]
        if len(fresh):
            scores = model.predict_proba(fresh.reindex(columns=meta["cols"]))[:, 1]
            db = connect(db_path)
            for (_, row), score in zip(fresh.iterrows(), scores):
                alerted.add(row.token)
                if score < meta["threshold"] or time.time() > start + hours * 3600:
                    continue
                name = db.execute("select name from coins where token=?", (row.token,)).fetchone()[0]
                entry = db.execute("select price from checks where token=? and label='0m'", (row.token,)).fetchone()[0]
                title = f"BUY {name} (score {score:.0%})"
                msg = (f"New coin, {row.age_seen_min:.0f} min old. Price ${entry:.4g}. Plan: sell in {meta['horizon']}. "
                       f"https://dexscreener.com/solana/{row.token}")
                log.warning("ALERT %s: %s", title, msg)
                if target:
                    notify(target, title, msg, buy=True)
                open_trades[row.token] = (name, entry, time.time() + hold)
        for token, (name, entry, sell_at) in list(open_trades.items()):
            if time.time() >= sell_at:
                db = connect(db_path)
                now = db.execute("select price from checks where token=? and label=?", (token, meta["horizon"])).fetchone()
                result = f"{(now[0] / entry - 1):+.0%} since the BUY alert" if now and now[0] else "price unknown (may be dead)"
                title, msg = f"SELL {name}", f"Hold time is up. {result}. https://dexscreener.com/solana/{token}"
                log.warning("ALERT %s: %s", title, msg)
                if target:
                    notify(target, title, msg, buy=False)
                del open_trades[token]
        time.sleep(poll_seconds)
