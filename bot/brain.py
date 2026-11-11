"""The super bot's brain: honest reports from the research log (bot/coin_log.py). Practice data only.

Everything here reads lab_data/ and works out, from past rows only, what's worth trading. Its thresholds live in
brain.yaml. The answer "nothing qualifies" is a valid result and is reported as such.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import yaml

from . import coin_log as cl

CONFIG = Path("brain.yaml")
DEFAULTS = {
    "cost": 0.035,            # a real round trip's cost as a share of the trade (pump.fun fees, network, slippage)
    "extra_cost": 0.005,      # taken off the lab's own results, which already include the lab's fees (the lab was
                              # within ~0.5 point of real prices on Nov 9-10)
    "target": 0.02,           # the lower confidence bound of profit per trade after fees must beat +2%
    "min_trades": 100,
    "min_days": 3,
    "day_share": 0.70,        # the same direction on at least this share of days (days with 5+ trades)
    "alpha": 0.05,            # before the correction for how many windows were tested
    "min_oos_trades": 30,     # walk-forward: trades on later days the rule never saw
    "drop_recent": 50,        # an approved window is dropped if its last this-many trades fall clearly short
    "bootstrap": 300,
    "slots": 6,               # 10-minute slots per hour
    "hour_groups": [[0, 6], [6, 12], [12, 18], [18, 24]],     # Milwaukee time: night, morning, afternoon, evening
}


def config(path: Path = CONFIG) -> dict:
    c = dict(DEFAULTS)
    if Path(path).exists():
        c.update((yaml.safe_load(Path(path).read_text()) or {}).get("brain") or {})
    return c


def pct(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x * 100:+.{digits}f}%"


# ---- step 3: base rates ----
def coin_paths(r: dict) -> dict:
    """A coin row's highs (vs the price after its first trade) by horizon in minutes, from launch and from 60 s."""
    h1 = (r.get("h1") or [None, None])[0]
    mk = r.get("mk") or {}
    e60 = r.get("e60")
    out = {}
    for h in ("5", "30", "60"):
        m = mk.get(h)
        if m is None:
            continue
        hi_after = m[0]
        hi_all = max(x for x in (h1, hi_after, 1.0) if x is not None)
        out[h] = {"hi0": hi_all, "hi60": (hi_after / e60) if (e60 and hi_after) else None,
                  "last0": m[2], "last60": (m[2] / e60) if (e60 and m[2]) else None}
    return out


def base_rates(coins: list[dict], cost: float, ups=(0.25, 0.5, 1.0)) -> dict:
    """What share of new coins touched +25/+50/+100% after a real round trip's cost: bought right after launch
    (about what a sniper pays) or at 1 minute. "Touched" is the best case: the high, not a price you'd surely get."""
    out = {"coins": len(coins), "dead": sum(1 for r in coins if r.get("N", 0) <= 1),
           "n_mayhem": sum(1 for r in coins if r.get("my"))}
    for group, rows in (("normal", [r for r in coins if not r.get("my")]), ("mayhem", [r for r in coins if r.get("my")])):
        g = {}
        for h in ("5", "30", "60"):
            got = [coin_paths(r).get(h) for r in rows]
            got = [x for x in got if x]
            if not got:
                continue
            row = {"n": len(got)}
            for u in ups:
                row[f"launch +{u:.0%}"] = sum(1 for x in got if x["hi0"] * (1 - cost) >= 1 + u) / len(got)
                at60 = [x for x in got if x["hi60"] is not None]
                row[f"1 min +{u:.0%}"] = (sum(1 for x in at60 if x["hi60"] * (1 - cost) >= 1 + u) / len(at60)
                                          if at60 else None)
            row["launch, held: ended up"] = sum(1 for x in got if (x["last0"] or 0) * (1 - cost) > 1) / len(got)
            g[h] = row
        out[group] = g
    return out


def base_rates_lines(b: dict) -> list[str]:
    if not b.get("coins"):
        return ["Base rates: no coins logged yet."]
    lines = [f"Base rates: {b['coins']:,} new coins ({b['dead']:,} never traded after launch, {b['n_mayhem']:,} mayhem). "
             f"Share that touched a gain after a real round trip's cost (best case: the high, not a sure sale):"]
    for group in ("normal", "mayhem"):
        for h in ("5", "30", "60"):
            r = (b.get(group) or {}).get(h)
            if not r:
                continue
            ups = ", ".join(f"+{u}: {r[f'launch +{u}%']:.1%} from launch / "
                            + (f"{r[f'1 min +{u}%']:.1%} from 1 min" if r[f"1 min +{u}%"] is not None else "n/a")
                            for u in (25, 50, 100))
            lines.append(f"• {group}, within {h} min ({r['n']:,} coins): {ups}; held to {h} min and ended up: "
                         f"{r['launch, held: ended up']:.1%}")
    return lines


# ---- steps 4-5: the timing map and the strict test ----
SUPER_KEYS = ("timing", "streak", "brain")        # bots built on the others: never judged as strategies


def hour_group(hr: int, cfg: dict) -> int:
    return next((i for i, (a, b) in enumerate(cfg["hour_groups"]) if a <= hr < b), 0)


def windows_of(r: dict, cfg: dict) -> list[str]:
    """The fixed windows a bet falls in: the strategy overall, its 10-minute slot of the hour, its group of hours."""
    return ["all", f"slot{r['mi'] * cfg['slots'] // 60}", f"hours{hour_group(r['hr'], cfg)}"]


def window_label(w: str, cfg: dict) -> str:
    if w.startswith("slot"):
        i, size = int(w[4:]), 60 // cfg["slots"]
        return f"minutes :{i * size:02d}-:{i * size + size - 1:02d} of every hour"
    if w.startswith("hours"):
        a, b = cfg["hour_groups"][int(w[5:])]
        f = lambda h: f"{h % 12 or 12}{'am' if h < 12 or h == 24 else 'pm'}"
        return f"{f(a)}-{f(b)}"
    return "any time"


def day_of(t: float) -> str:
    from .launch_lab import local_time
    return local_time(t).strftime("%Y-%m-%d")


def usable_bets(bets: list[dict], cfg: dict) -> list[dict]:
    """Ghost bets that count: not a super bot, not closed by a run ending, with the time of their signal; each gets
    its day and its result after the extra real cost."""
    out = []
    for r in bets:
        if r.get("e") or r.get("k") in SUPER_KEYS or "mi" not in r or "hr" not in r or r.get("r") is None:
            continue
        out.append({**r, "day": day_of(r["t"]), "ret": r["r"] - cfg["extra_cost"]})
    return out


def _stats(rows: list[dict], cfg: dict, z: float, rng) -> dict:
    import numpy as np

    rets = np.array([r["ret"] for r in rows], dtype=float)
    n = len(rets)
    wins, losses = rets[rets > 0], rets[rets <= 0]
    days: dict = {}
    for r in rows:
        days.setdefault(r["day"], []).append(r["ret"])
    counted = [v for v in days.values() if len(v) >= 5]
    st = {"n": n, "days": len(days), "win_rate": float(len(wins) / n) if n else None,
          "avg_win": float(wins.mean()) if len(wins) else None, "avg_loss": float(losses.mean()) if len(losses) else None,
          "mean": float(rets.mean()) if n else None,
          "day_share": (sum(1 for v in counted if sum(v) > 0) / len(counted)) if counted else None, "lb": None}
    if n >= 2 and st["mean"] - cfg["target"] > 0:      # only a window that could pass gets the (slower) bootstrap
        blocks: dict = {}
        for r in rows:
            b = blocks.setdefault((r["day"], r["hr"]), [0.0, 0])
            b[0] += r["ret"]
            b[1] += 1
        sums = np.array([b[0] for b in blocks.values()])
        cnts = np.array([b[1] for b in blocks.values()])
        idx = rng.integers(0, len(sums), (cfg["bootstrap"], len(sums)))
        means = sums[idx].sum(1) / cnts[idx].sum(1)
        se = float(means.std(ddof=1)) if len(sums) > 1 else float("inf")
        st["lb"] = st["mean"] - z * se
    return st


def passes(st: dict, cfg: dict) -> tuple[bool, str]:
    if st["n"] < cfg["min_trades"]:
        return False, f"only {st['n']} trades (needs {cfg['min_trades']})"
    if st["days"] < cfg["min_days"]:
        return False, f"only {st['days']} days (needs {cfg['min_days']})"
    if st["lb"] is None or st["lb"] <= cfg["target"]:
        return False, (f"profit per trade after fees {pct(st['mean'])}, its lower bound "
                       f"{pct(st['lb'])} doesn't beat {pct(cfg['target'], 0)}" if st["lb"] is not None else
                       f"profit per trade after fees {pct(st['mean'])} (needs a lower bound above {pct(cfg['target'], 0)})")
    if st["day_share"] is None or st["day_share"] < cfg["day_share"]:
        return False, f"won on only {pct(st['day_share'], 0) if st['day_share'] is not None else 'n/a'} of days"
    return True, "passed"


def timing_map(bets: list[dict], cfg: dict, seed: int = 0) -> dict:
    """Every (strategy, window): its record, and whether it passes the strict test, including walk-forward (judged
    day by day only on earlier days, then scored on the next day it never saw) and the drop rule."""
    import numpy as np
    from statistics import NormalDist

    rng = np.random.default_rng(seed)
    rows = sorted(usable_bets(bets, cfg), key=lambda r: r["t"])
    groups: dict = {}
    for r in rows:
        for w in windows_of(r, cfg):
            groups.setdefault((r["k"], w), []).append(r)
    tested = len(groups)
    z = NormalDist().inv_cdf(1 - cfg["alpha"] / max(1, tested))        # corrected for every window tested
    out = {}
    for (k, w), g in groups.items():
        st = _stats(g, cfg, z, rng)
        ok, why = passes(st, cfg)
        st["oos_n"], st["oos_mean"] = 0, None
        if ok:                                         # walk-forward: approve on earlier days, score the next one
            days = sorted({r["day"] for r in g})
            oos = []
            for i in range(cfg["min_days"], len(days)):
                before = [r for r in g if r["day"] < days[i]]
                if passes(_stats(before, cfg, z, rng), cfg)[0]:
                    oos += [r["ret"] for r in g if r["day"] == days[i]]
            st["oos_n"] = len(oos)
            st["oos_mean"] = sum(oos) / len(oos) if oos else None
            if len(oos) < cfg["min_oos_trades"]:
                ok, why = False, f"only {len(oos)} trades on later days it never saw (needs {cfg['min_oos_trades']})"
            elif st["oos_mean"] <= 0:
                ok, why = False, f"lost on later days it never saw ({pct(st['oos_mean'])} a trade)"
        if ok:                                         # the drop rule: its latest trades fall clearly short
            recent = np.array([r["ret"] for r in g[-cfg["drop_recent"]:]])
            if len(recent) >= cfg["drop_recent"] and recent.mean() < 0:
                se = recent.std(ddof=1) / math.sqrt(len(recent)) or 1e-9
                if (recent.mean() - st["mean"]) / se < -1.645:
                    ok, why = False, f"dropped: its last {len(recent)} trades made {pct(float(recent.mean()))} a trade"
        st.update(ok=ok, why=why)
        out[f"{k}|{w}"] = st
    return {"tested": tested, "z": round(z, 3), "windows": out,
            "approved": sorted(k for k, v in out.items() if v["ok"])}


def timing_lines(tm: dict, cfg: dict, top: int = 5) -> list[str]:
    from .launch_lab import STRATEGIES

    name = lambda k: STRATEGIES.get(k, {}).get("label", k)
    w = tm["windows"]
    if not w:
        return ["Timing map: no bets logged yet."]
    lines = [f"Timing map: {tm['tested']} strategy-and-time windows tested (each needs a lower bound above "
             f"{pct(cfg['target'], 0)} a trade after fees, corrected for testing that many)."]
    if tm["approved"]:
        lines.append("Approved: " + "; ".join(
            f"{name(k.split('|')[0])}, {window_label(k.split('|')[1], cfg)} ({w[k]['n']} trades, {pct(w[k]['mean'])} a "
            f"trade, lower bound {pct(w[k]['lb'])}, unseen days {pct(w[k]['oos_mean'])})" for k in tm["approved"]))
    else:
        lines.append("Approved: none. Nothing passed the test, so the super bot sits out.")
    best = sorted((v["mean"], k) for k, v in w.items() if v["n"] >= cfg["min_trades"] and v["mean"] is not None)[::-1][:top]
    for m, k in best:
        v = w[k]
        lines.append(f"• {name(k.split('|')[0])}, {window_label(k.split('|')[1], cfg)}: {v['n']} trades over {v['days']} "
                     f"days, won {v['win_rate']:.0%} (avg win {pct(v['avg_win'])}, avg loss {pct(v['avg_loss'])}), "
                     f"{pct(m)} a trade after fees: {v['why']}")
    return lines


# ---- steps 6-7: the coin model and the rug filter ----
F60 = ([("s60", k) for k in ("n", "nb", "ns", "bs", "ss", "mb", "u", "t5", "dv", "cs", "top", "pm")]
       + [("s10", k) for k in ("n", "u", "bs", "pm")] + [(None, k) for k in ("hr", "lr", "cp", "cd", "cg", "st", "sv", "f0")])
F0 = [(None, k) for k in ("cp", "cd", "cg", "f0", "lr", "hr")]     # known at launch (for the snipes)
FEAT_DEFAULT = {"t5": 99.0, "pm": 1.0}


def features(r: dict, feats: list) -> list[float]:
    out = []
    for sec, k in feats:
        v = ((r.get(sec) or {}) if sec else r).get(k)
        out.append(float(FEAT_DEFAULT.get(k, 0.0) if v is None else v))
    return out


def _cross(x: dict, key: str) -> tuple[float | None, float | None]:
    v = (x or {}).get(key)
    if v is None:
        return None, None
    return (v[0], v[1]) if isinstance(v, list) else (v, None)


def trade_60(r: dict, cost: float, tp: str = "+50", sl: str = "-35", hold: float = 1740) -> float | None:
    """One fixed practice trade on a coin: bought at its 1-minute price, sold when it first reaches +50% or falls
    through -35% (at the price it really fell to), else at 30 minutes; after a real round trip's cost."""
    e60 = r.get("e60")
    if not e60:
        return None
    x = r.get("x60") or {}
    tu, _ = _cross(x, tp)
    td, md = _cross(x, sl)
    tu = tu if tu is not None and tu <= hold else None
    td = td if td is not None and td <= hold else None
    if tu is not None and (td is None or tu < td):
        raw = float(tp) / 100
    elif td is not None:
        raw = (md if md is not None else 1 + float(sl) / 100) - 1
    else:
        m = (r.get("mk") or {}).get("30")
        if not m or m[2] is None:
            return None
        raw = m[2] / e60 - 1
    return (1 + raw) * (1 - cost) - 1


def rugged(r: dict, at_launch: bool = False) -> bool | None:
    """From its 1-minute price (or right after launch), it fell to half or less within 30 (or 5) minutes."""
    if at_launch:
        m, lo1 = (r.get("mk") or {}).get("5"), (r.get("h1") or [None, None])[1]
        lows = [x for x in ((m or [None, None])[1], lo1) if x is not None]
        return (min(lows) <= 0.5) if (m and lows) else None
    e60, m = r.get("e60"), (r.get("mk") or {}).get("30")
    return (m[1] / e60 <= 0.5) if (e60 and m and m[1] is not None) else None


def walk_forward(X, y, days, window_days: int = 14, min_train: int = 2000, max_train: int = 100_000, seed: int = 0):
    """Day by day: fit on up to 14 earlier days only, predict the next day. NaN where there was no model yet."""
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier

    rng = np.random.default_rng(seed)
    order = sorted(set(days))
    pred = np.full(len(y), np.nan)
    for i, d in enumerate(order):
        lo = order[max(0, i - window_days)]
        tr = np.where((days < d) & (days >= lo))[0]
        if len(tr) < min_train or len(set(days[tr])) < 2 or len(set(y[tr])) < 2:
            continue
        if len(tr) > max_train:
            tr = rng.choice(tr, max_train, replace=False)
        te = np.where(days == d)[0]
        m = HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=15, l2_regularization=1.0, random_state=seed)
        m.fit(X[tr], y[tr])
        pred[te] = m.predict_proba(X[te])[:, 1]
    return pred


def picks(pred, days, frac: float):
    """Each day picks the coins whose prediction beats the cut-off set by the PREVIOUS day's predictions (a top
    `frac` share), so a day's own results never set its own bar."""
    import numpy as np

    sel, cut = np.zeros(len(pred), bool), None
    for d in sorted(set(days)):
        mask = days == d
        p = pred[mask]
        if cut is not None:
            sel[mask] = np.nan_to_num(p, nan=-1) >= cut
        ok = p[~np.isnan(p)]
        if len(ok):
            cut = float(np.quantile(ok, 1 - frac))
    return sel


def _rows_for(coins: list[dict], cost: float):
    import numpy as np

    rows = [r for r in coins if not r.get("my") and "hr" in r]
    rets = [trade_60(r, cost) for r in rows]
    keep = [i for i, x in enumerate(rets) if x is not None]
    rows = [rows[i] for i in keep]
    rets = np.array([rets[i] for i in keep])
    days = np.array([day_of(r["t"]) for r in rows])
    return rows, rets, days


def coin_model(coins: list[dict], cfg: dict, pick: float = 0.10, seed: int = 0) -> dict:
    """Can the first minute pick winners? Bought at 1 minute (the fixed trade above) on the top 10% of coins by a
    model trained only on earlier days. Lift = how many times more often those picks won than the average coin."""
    import numpy as np
    from statistics import NormalDist

    rows, rets, days = _rows_for(coins, cfg["cost"])
    out = {"coins": len(rows), "ok": False, "why": "not enough data yet"}
    if len(rows) < 100:
        return out
    X = np.array([features(r, F60) for r in rows])
    y = (rets > 0).astype(int)
    pred = walk_forward(X, y, days, seed=seed)
    sel = picks(pred, days, pick)
    oos = ~np.isnan(pred)
    out.update(oos_coins=int(oos.sum()), base_win=float(y[oos].mean()) if oos.any() else None,
               base_mean=float(rets[oos].mean()) if oos.any() else None, picked=int(sel.sum()))
    if not sel.any():
        return out
    z = NormalDist().inv_cdf(1 - cfg["alpha"] / 2)          # the model and the rug filter: 2 things tested
    st = _stats([{"ret": float(rets[i]), "day": days[i], "hr": rows[i]["hr"]} for i in np.where(sel)[0]], cfg, z,
                np.random.default_rng(seed))
    ok, why = passes(st, cfg)
    cal = []
    for a, b in ((0, .1), (.1, .2), (.2, .3), (.3, .5), (.5, 1.01)):
        m = oos & (pred >= a) & (pred < b)
        if m.sum() >= 20:
            cal.append([a, round(float(pred[m].mean()), 3), round(float(y[m].mean()), 3), int(m.sum())])
    recent_days = sorted(set(days[sel]))[-2:]
    recent = rets[sel & np.isin(days, recent_days)]
    trusted = len(recent) < 20 or recent.mean() > 0               # decay: its latest picks fell below break-even
    if ok and not trusted:
        ok, why = False, f"not trusted: its picks on the last 2 days made {pct(float(recent.mean()))} a trade"
    out.update(st, ok=ok, why=why, lift=(st["win_rate"] / out["base_win"]) if out["base_win"] else None,
               calibration=cal, recent_mean=float(recent.mean()) if len(recent) else None)
    return out


def rug_filter(coins: list[dict], bets: list[dict], cfg: dict, flag: float = 0.20, seed: int = 0) -> dict:
    """Which coins are about to crash? Flags the 20% most likely (by a model trained on earlier days only) and shows
    what that would have saved and cost: at 1 minute on every coin, and at launch on the "snipe every coin" bets."""
    import numpy as np

    out = {}
    rows, rets, days = _rows_for(coins, cfg["cost"])
    lab = [rugged(r) for r in rows]
    keep = [i for i, v in enumerate(lab) if v is not None]
    if len(keep) >= 100:
        rows2, rets2, days2 = [rows[i] for i in keep], rets[keep], days[keep]
        y = np.array([int(lab[i]) for i in keep])
        pred = walk_forward(np.array([features(r, F60) for r in rows2]), y, days2, seed=seed)
        oos = ~np.isnan(pred)
        fl = picks(pred, days2, flag) & oos
        judged = oos
        if fl.any() and (judged & ~fl).any():
            tail = rets2 <= -0.30
            win = rets2 > 0
            out["one_minute"] = {
                "coins": int(judged.sum()), "flagged": int(fl.sum()),
                "rugs_caught": float((fl & (y == 1)).sum() / max(1, (judged & (y == 1)).sum())),
                "loss_tail_removed": float((fl & tail).sum() / max(1, (judged & tail).sum())),
                "winners_lost": float((fl & win).sum() / max(1, (judged & win).sum())),
                "mean_all": float(rets2[judged].mean()), "mean_kept": float(rets2[judged & ~fl].mean())}
    # at launch, for the snipes: only what's known at launch (the creator's past coins, its first buy, the hour)
    launch = [r for r in coins if not r.get("my") and "hr" in r and rugged(r, at_launch=True) is not None]
    if len(launch) >= 100:
        y = np.array([int(rugged(r, at_launch=True)) for r in launch])
        d = np.array([day_of(r["t"]) for r in launch])
        pred = walk_forward(np.array([features(r, F0) for r in launch]), y, d, seed=seed)
        fl = picks(pred, d, flag) & ~np.isnan(pred)
        flagged = {r["m"] for r, f in zip(launch, fl) if f}
        judged_m = {r["m"] for r, p in zip(launch, pred) if not np.isnan(p)}
        snipes = [b for b in usable_bets(bets, cfg) if b["k"] == "snipe" and b.get("m") in judged_m]
        if snipes:
            sr = np.array([b["ret"] for b in snipes])
            f = np.array([b["m"] in flagged for b in snipes])
            tail = sr <= -0.30
            out["launch_snipes"] = {
                "bets": len(snipes), "flagged": int(f.sum()),
                "loss_tail_removed": float((f & tail).sum() / max(1, tail.sum())),
                "winners_lost": float((f & (sr > 0)).sum() / max(1, (sr > 0).sum())),
                "mean_all": float(sr.mean()), "mean_kept": float(sr[~f].mean()) if (~f).any() else None}
    return out


def model_lines(m: dict, rf: dict) -> list[str]:
    lines = []
    if not m.get("picked"):
        lines.append(f"Coin model: {m.get('why', 'not enough data yet')} ({m.get('coins', 0):,} coins logged; it needs "
                     "a few days to learn, then it's tested only on days it never saw).")
    else:
        lines.append(f"Coin model (tested only on days it never saw): picked {m['picked']:,} of {m['oos_coins']:,} coins; "
                     f"they won {m['win_rate']:.1%} vs {m['base_win']:.1%} for every coin (lift {m['lift']:.2f}x); "
                     f"{pct(m['mean'])} a trade after fees (every coin: {pct(m['base_mean'])}). "
                     + ("APPROVED." if m["ok"] else f"Not approved: {m['why']}."))
        if m.get("calibration"):
            lines.append("  Predicted vs real win chance: " + ", ".join(
                f"{c[1]:.0%} -> {c[2]:.0%} ({c[3]})" for c in m["calibration"]))
    o, s = rf.get("one_minute"), rf.get("launch_snipes")
    if o:
        lines.append(f"Rug filter at 1 minute: flagged {o['flagged']:,} of {o['coins']:,} coins; caught {o['rugs_caught']:.0%} "
                     f"of the crashes and {o['loss_tail_removed']:.0%} of the big losses, but also {o['winners_lost']:.0%} "
                     f"of the winners; a trade on every coin went from {pct(o['mean_all'])} to {pct(o['mean_kept'])}.")
    if s:
        lines.append(f"Rug filter at launch, on the snipes: flagged {s['flagged']:,} of {s['bets']:,}; removed "
                     f"{s['loss_tail_removed']:.0%} of the big losses and {s['winners_lost']:.0%} of the winners; snipes "
                     f"went from {pct(s['mean_all'])} to {pct(s['mean_kept'])} a bet.")
    if not o and not s:
        lines.append("Rug filter: not enough data yet.")
    return lines


# ---- the report ----
def report(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    coins = cl.read("c", data_dir)              # a coin cut off by a run's end counts only at the marks it reached
    bets = cl.read("b", data_dir)
    out = {"base_rates": base_rates(coins, cfg["cost"]), "timing": timing_map(bets, cfg),
           "model": coin_model(coins, cfg), "rug": rug_filter(coins, bets, cfg)}
    out["lines"] = (base_rates_lines(out["base_rates"]) + timing_lines(out["timing"], cfg)
                    + model_lines(out["model"], out["rug"]))
    return out


def main(data_dir: Path = cl.DATA_DIR, out_path: Path = Path("brain_report.json")) -> dict:
    r = report(data_dir)
    out_path.write_text(json.dumps(r))
    print("\n".join(r["lines"]), flush=True)
    return r
