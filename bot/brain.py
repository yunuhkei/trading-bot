"""The super bot's brain: honest reports from the research log (bot/coin_log.py). Practice data only.

Everything here reads lab_data/ and works out, from past rows only, what's worth trading. Its thresholds live in
brain.yaml. The answer "nothing qualifies" is a valid result and is reported as such.

The log can hold millions of rows, so nothing loads it whole: bets are boiled down, as they're read, to tallies
per (strategy, day, hour, 10-minute slot), and coins to a compact table of numbers.
"""
from __future__ import annotations

import json
import math
from collections import deque
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
SUPER_KEYS = ("timing", "streak", "brain")        # bots built on the others: never judged as strategies


def config(path: Path = CONFIG) -> dict:
    c = dict(DEFAULTS)
    if Path(path).exists():
        c.update((yaml.safe_load(Path(path).read_text()) or {}).get("brain") or {})
    return c


def pct(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x * 100:+.{digits}f}%"


_DAYS: dict = {}


def day_of(t: float) -> str:
    """The Milwaukee date of a time (the time-zone lookup is done once per minute of time)."""
    k = int(t // 60)
    d = _DAYS.get(k)
    if d is None:
        from .launch_lab import local_time
        if len(_DAYS) > 200_000:
            _DAYS.clear()
        d = _DAYS[k] = local_time(k * 60).strftime("%Y-%m-%d")
    return d


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


class BaseRates:
    """Counts, one coin at a time, of which coins touched +25/+50/+100% after a real round trip's cost."""
    UPS = (0.25, 0.5, 1.0)

    def __init__(self, cost: float):
        self.cost, self.coins, self.dead, self.n_mayhem = cost, 0, 0, 0
        self.c: dict = {}                         # (group, horizon) -> counters

    def add(self, r: dict):
        self.coins += 1
        self.dead += r.get("N", 0) <= 1
        self.n_mayhem += bool(r.get("my"))
        g = "mayhem" if r.get("my") else "normal"
        for h, x in coin_paths(r).items():
            c = self.c.setdefault((g, h), {"n": 0, "n60": 0, "up": 0, **{f"l{u}": 0 for u in self.UPS},
                                           **{f"m{u}": 0 for u in self.UPS}})
            c["n"] += 1
            c["up"] += (x["last0"] or 0) * (1 - self.cost) > 1
            for u in self.UPS:
                c[f"l{u}"] += x["hi0"] * (1 - self.cost) >= 1 + u
            if x["hi60"] is not None:
                c["n60"] += 1
                for u in self.UPS:
                    c[f"m{u}"] += x["hi60"] * (1 - self.cost) >= 1 + u

    def result(self) -> dict:
        out = {"coins": self.coins, "dead": self.dead, "n_mayhem": self.n_mayhem}
        for (g, h), c in self.c.items():
            row = {"n": c["n"]}
            for u in self.UPS:
                row[f"launch +{u:.0%}"] = c[f"l{u}"] / c["n"]
                row[f"1 min +{u:.0%}"] = c[f"m{u}"] / c["n60"] if c["n60"] else None
            row["launch, held: ended up"] = c["up"] / c["n"]
            out.setdefault(g, {})[h] = row
        return out


def base_rates(coins, cost: float) -> dict:
    """What share of new coins touched +25/+50/+100% after a real round trip's cost: bought right after launch
    (about what a sniper pays) or at 1 minute. "Touched" is the best case: the high, not a price you'd surely get."""
    b = BaseRates(cost)
    for r in coins:
        b.add(r)
    return b.result()


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


def usable(r: dict) -> bool:
    """A ghost bet that counts: not a super bot, not closed by a run ending, with the time of its signal."""
    return not (r.get("e") or r.get("k") in SUPER_KEYS or "mi" not in r or "hr" not in r or r.get("r") is None)


def usable_bets(bets, cfg: dict) -> list[dict]:
    return [{**r, "day": day_of(r["t"]), "ret": r["r"] - cfg["extra_cost"]} for r in bets if usable(r)]


class BetBlocks:
    """Bets boiled down as they're read: per (strategy, day, hour, slot) [trades, sum of results, wins, sum of
    wins], plus each window's latest results (for the drop rule), the snipes (for the launch rug filter) and every
    bot's totals (for the baselines)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.b: dict = {}
        self.recent: dict = {}
        self.snipes: list = []
        self.raw: dict = {}
        self.sat = 0                              # signals the brain sat out (logged every 5 minutes by the lab)
        self.first: dict = {}                     # each bot's first logged trade (for the go-live gate's 4 weeks)
        self.n = 0

    def add(self, r: dict):
        k = r.get("k")
        if k == "_sat":
            self.sat += r.get("n", 0)
            return
        if r.get("r") is not None and not r.get("e"):
            ret = r["r"] - self.cfg["extra_cost"]
            self.first.setdefault(k, r["t"])
            for key in ((k, "every signal") if k not in SUPER_KEYS else (k,)):
                s = self.raw.setdefault(key, [0, 0.0, 0, 0.0])
                s[0] += 1
                s[1] += ret
                if ret > 0:
                    s[2] += 1
                    s[3] += ret
        if not usable(r):
            return
        ret, day = r["r"] - self.cfg["extra_cost"], day_of(r["t"])
        slot = r["mi"] * self.cfg["slots"] // 60
        x = self.b.setdefault((k, day, r["hr"], slot), [0, 0.0, 0, 0.0])
        x[0] += 1
        x[1] += ret
        if ret > 0:
            x[2] += 1
            x[3] += ret
        for w in ("all", f"slot{slot}", f"hours{hour_group(r['hr'], self.cfg)}"):
            q = self.recent.get((k, w))
            if q is None:
                q = self.recent[(k, w)] = deque(maxlen=self.cfg["drop_recent"])
            q.append(ret)
        if k == "snipe":
            self.snipes.append((r.get("m"), ret, day))
        self.n += 1

    def windows(self) -> dict:
        """(strategy, window) -> its blocks [(day, hour, trades, sum, wins, sum of wins)]."""
        out: dict = {}
        for (k, day, hr, slot), (n, s, w, sw) in self.b.items():
            blk = (day, hr, n, s, w, sw)
            for win in ("all", f"slot{slot}", f"hours{hour_group(hr, self.cfg)}"):
                out.setdefault((k, win), []).append(blk)
        return out


def _stats(blocks: list, cfg: dict, z: float, rng) -> dict:
    """A window's record from its blocks; the lower bound only for one that could pass (bootstrap by hour blocks)."""
    import numpy as np

    n = sum(b[2] for b in blocks)
    s = sum(b[3] for b in blocks)
    w = sum(b[4] for b in blocks)
    sw = sum(b[5] for b in blocks)
    days: dict = {}
    hours: dict = {}
    for d, hr, bn, bs, *_ in blocks:
        x = days.setdefault(d, [0, 0.0])
        x[0] += bn
        x[1] += bs
        y = hours.setdefault((d, hr), [0, 0.0])
        y[0] += bn
        y[1] += bs
    counted = [v for v in days.values() if v[0] >= 5]
    st = {"n": n, "days": len(days), "win_rate": w / n if n else None, "avg_win": sw / w if w else None,
          "avg_loss": (s - sw) / (n - w) if n > w else None, "mean": s / n if n else None,
          "day_share": (sum(1 for v in counted if v[1] > 0) / len(counted)) if counted else None, "lb": None}
    if n >= 2 and st["mean"] - cfg["target"] > 0:
        sums = np.array([v[1] for v in hours.values()])
        cnts = np.array([v[0] for v in hours.values()])
        if len(sums) > 1:
            idx = rng.integers(0, len(sums), (cfg["bootstrap"], len(sums)))
            se = float((sums[idx].sum(1) / cnts[idx].sum(1)).std(ddof=1))
        else:
            se = float("inf")
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


def timing_map(bets, cfg: dict, seed: int = 0) -> dict:
    """Every (strategy, window): its record, and whether it passes the strict test, including walk-forward (judged
    day by day only on earlier days, then scored on the next day it never saw) and the drop rule. `bets` is any
    iterable of bet rows, or a BetBlocks already filled."""
    import numpy as np
    from statistics import NormalDist

    if isinstance(bets, BetBlocks):
        bb = bets
    else:
        bb = BetBlocks(cfg)
        for r in bets:
            bb.add(r)
    rng = np.random.default_rng(seed)
    groups = bb.windows()
    tested = len(groups)
    z = NormalDist().inv_cdf(1 - cfg["alpha"] / max(1, tested))        # corrected for every window tested
    out = {}
    for (k, w), g in groups.items():
        st = _stats(g, cfg, z, rng)
        ok, why = passes(st, cfg)
        st["oos_n"], st["oos_mean"] = 0, None
        if ok:                                         # walk-forward: approve on earlier days, score the next one
            days = sorted({b[0] for b in g})
            oos_n, oos_s = 0, 0.0
            for i in range(cfg["min_days"], len(days)):
                if passes(_stats([b for b in g if b[0] < days[i]], cfg, z, rng), cfg)[0]:
                    oos_n += sum(b[2] for b in g if b[0] == days[i])
                    oos_s += sum(b[3] for b in g if b[0] == days[i])
            st["oos_n"], st["oos_mean"] = oos_n, (oos_s / oos_n if oos_n else None)
            if oos_n < cfg["min_oos_trades"]:
                ok, why = False, f"only {oos_n} trades on later days it never saw (needs {cfg['min_oos_trades']})"
            elif st["oos_mean"] <= 0:
                ok, why = False, f"lost on later days it never saw ({pct(st['oos_mean'])} a trade)"
        if ok:                                         # the drop rule: its latest trades fall clearly short
            recent = np.array(bb.recent.get((k, w)) or [])
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


class CoinTable:
    """Normal (non-mayhem) coins as numbers, built one row at a time: what the model and the rug filter need."""

    def __init__(self, cost: float):
        self.cost = cost
        self.m, self.day, self.hr, self.x60, self.ret, self.rug, self.x0, self.rug0 = ([] for _ in range(8))

    def add(self, r: dict):
        if r.get("my") or "hr" not in r:
            return
        ret, r0 = trade_60(r, self.cost), rugged(r, at_launch=True)
        if ret is None and r0 is None:
            return
        self.m.append(r.get("m"))
        self.day.append(day_of(r["t"]))
        self.hr.append(r["hr"])
        self.x60.append(features(r, F60) if ret is not None else None)
        self.ret.append(ret)
        self.rug.append(rugged(r))
        self.x0.append(features(r, F0))
        self.rug0.append(r0)

    @classmethod
    def of(cls, coins, cost: float) -> "CoinTable":
        if isinstance(coins, cls):
            return coins
        t = cls(cost)
        for r in coins:
            t.add(r)
        return t


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


def coin_model(coins, cfg: dict, pick: float = 0.10, seed: int = 0) -> dict:
    """Can the first minute pick winners? Bought at 1 minute (the fixed trade above) on the top 10% of coins by a
    model trained only on earlier days. Lift = how many times more often those picks won than the average coin."""
    import numpy as np
    from statistics import NormalDist

    t = CoinTable.of(coins, cfg["cost"])
    idx = [i for i, r in enumerate(t.ret) if r is not None]
    out = {"coins": len(idx), "ok": False, "why": "not enough data yet"}
    if len(idx) < 100:
        return out
    X = np.array([t.x60[i] for i in idx])
    rets = np.array([t.ret[i] for i in idx])
    days = np.array([t.day[i] for i in idx])
    hrs = [t.hr[i] for i in idx]
    y = (rets > 0).astype(int)
    pred = walk_forward(X, y, days, seed=seed)
    sel = picks(pred, days, pick)
    oos = ~np.isnan(pred)
    out.update(oos_coins=int(oos.sum()), base_win=float(y[oos].mean()) if oos.any() else None,
               base_mean=float(rets[oos].mean()) if oos.any() else None, picked=int(sel.sum()))
    if not sel.any():
        return out
    z = NormalDist().inv_cdf(1 - cfg["alpha"] / 2)          # the model and the rug filter: 2 things tested
    blocks: dict = {}
    for i in np.where(sel)[0]:
        b = blocks.setdefault((days[i], hrs[i]), [0, 0.0, 0, 0.0])
        b[0] += 1
        b[1] += float(rets[i])
        if rets[i] > 0:
            b[2] += 1
            b[3] += float(rets[i])
    st = _stats([(d, h, *v) for (d, h), v in blocks.items()], cfg, z, np.random.default_rng(seed))
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


def rug_filter(coins, snipes, cfg: dict, flag: float = 0.20, seed: int = 0) -> dict:
    """Which coins are about to crash? Flags the 20% most likely (by a model trained on earlier days only) and shows
    what that would have saved and cost: at 1 minute on every coin, and at launch on the "snipe every coin" bets.
    `snipes`: (mint, result after fees, day) for each snipe bet, or bet rows."""
    import numpy as np

    t = CoinTable.of(coins, cfg["cost"])
    out = {}
    idx = [i for i in range(len(t.m)) if t.ret[i] is not None and t.rug[i] is not None]
    if len(idx) >= 100:
        rets = np.array([t.ret[i] for i in idx])
        days = np.array([t.day[i] for i in idx])
        y = np.array([int(t.rug[i]) for i in idx])
        pred = walk_forward(np.array([t.x60[i] for i in idx]), y, days, seed=seed)
        oos = ~np.isnan(pred)
        fl = picks(pred, days, flag) & oos
        if fl.any() and (oos & ~fl).any():
            tail, win = rets <= -0.30, rets > 0
            out["one_minute"] = {
                "coins": int(oos.sum()), "flagged": int(fl.sum()),
                "rugs_caught": float((fl & (y == 1)).sum() / max(1, (oos & (y == 1)).sum())),
                "loss_tail_removed": float((fl & tail).sum() / max(1, (oos & tail).sum())),
                "winners_lost": float((fl & win).sum() / max(1, (oos & win).sum())),
                "mean_all": float(rets[oos].mean()), "mean_kept": float(rets[oos & ~fl].mean())}
    # at launch, for the snipes: only what's known at launch (the creator's past coins, its first buy, the hour)
    idx = [i for i in range(len(t.m)) if t.rug0[i] is not None]
    snipes = [s if isinstance(s, tuple) else (s.get("m"), s["r"] - cfg["extra_cost"], day_of(s["t"]))
              for s in snipes if isinstance(s, tuple) or (usable(s) and s.get("k") == "snipe")]
    if len(idx) >= 100 and snipes:
        y = np.array([int(t.rug0[i]) for i in idx])
        d = np.array([t.day[i] for i in idx])
        pred = walk_forward(np.array([t.x0[i] for i in idx]), y, d, seed=seed)
        fl = picks(pred, d, flag) & ~np.isnan(pred)
        flagged = {t.m[i] for i, f in zip(idx, fl) if f}
        judged = {t.m[i] for i, p in zip(idx, pred) if not np.isnan(p)}
        sn = [s for s in snipes if s[0] in judged]
        if sn:
            sr = np.array([s[1] for s in sn])
            f = np.array([s[0] in flagged for s in sn])
            tail = sr <= -0.30
            out["launch_snipes"] = {
                "bets": len(sn), "flagged": int(f.sum()),
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


# ---- step 9: side by side ----
def record(v: list | None) -> dict | None:
    """[trades, sum, wins, sum of wins] -> the numbers that matter, with the break-even win rate for that payoff."""
    if not v or not v[0]:
        return None
    n, s, w, sw = v
    avg_win = sw / w if w else None
    avg_loss = (s - sw) / (n - w) if n > w else None
    be = (-avg_loss / (avg_win - avg_loss)) if (avg_win and avg_loss and avg_win > avg_loss) else None
    return {"n": n, "win_rate": w / n, "avg_win": avg_win, "avg_loss": avg_loss, "per_trade": s / n, "break_even": be}


def side_by_side_lines(raw: dict, sat: int) -> list[str]:
    rows = (("The brain (super bot 3)", raw.get("brain")), ("Took every signal", raw.get("every signal")),
            ("Random coins (luck)", raw.get("random")))
    lines = ["Side by side, after fees (win rate vs the win rate needed to break even with that payoff):"]
    for name, v in rows:
        r = record(v)
        if not r:
            lines.append(f"• {name}: no trades" + (f" (sat out {sat:,} signals: nothing qualified)"
                                                    if name.startswith("The brain") else "") + ".")
            continue
        lines.append(f"• {name}: {r['n']:,} trades, won {r['win_rate']:.1%} (needs {r['break_even']:.1%})"
                     if r["break_even"] is not None else f"• {name}: {r['n']:,} trades, won {r['win_rate']:.1%}")
        lines[-1] += (f", avg win {pct(r['avg_win'])}, avg loss {pct(r['avg_loss'])}, {pct(r['per_trade'])} a trade"
                      + (f"; sat out {sat:,} signals" if name.startswith("The brain") else "") + ".")
    return lines


GATE = {"trades": 300, "weeks": 4}               # the go-live gate (documented in HOW_TO_USE.md; it stays OFF)


def gate_line(raw: dict, first: dict, cfg: dict, now: float | None = None) -> str:
    """How far the brain's practice record is from the go-live gate. Informational only: nothing here turns real
    money on; that needs the owner's say-so and a change by hand."""
    import time

    r = record(raw.get("brain"))
    weeks = ((now or time.time()) - first["brain"]) / (7 * 86400) if "brain" in first else 0.0
    if not r:
        return f"Go-live gate (stays OFF): 0 of {GATE['trades']} practice trades, 0 of {GATE['weeks']} weeks."
    ok = r["n"] >= GATE["trades"] and weeks >= GATE["weeks"] and r["per_trade"] > cfg["target"]
    return (f"Go-live gate (stays OFF): {r['n']} of {GATE['trades']} practice trades, {weeks:.1f} of {GATE['weeks']} "
            f"weeks, {pct(r['per_trade'])} a trade after fees (needs above {pct(cfg['target'], 0)})"
            + (": the numbers are met; real money still only if you say so." if ok else "."))


def weekly(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None, since_days: float = 7.0) -> str:
    """The weekly summary for the phone: what the brain did, what qualified, and how it compares. Short."""
    import time

    cfg = cfg or config()
    since = time.time() - since_days * 86400
    br, ct, bb = BaseRates(cfg["cost"]), CoinTable(cfg["cost"]), BetBlocks(cfg)
    for r in cl.rows("c", data_dir):
        ct.add(r)
    for r in cl.rows("b", data_dir):
        bb.add(r)
    week = BetBlocks(cfg)
    for r in cl.rows("b", data_dir, since=since):
        week.add(r)
    tm, m = timing_map(bb, cfg), coin_model(ct, cfg)
    lines = side_by_side_lines(week.raw, week.sat)
    lines.append(f"Approved windows: {len(tm['approved'])} of {tm['tested']}" + (
        ": " + ", ".join(tm["approved"][:5]) if tm["approved"] else " (nothing passed: it sat out)."))
    if m.get("picked"):
        lines.append(f"Coin model on days it never saw: lift {m['lift']:.2f}x, {pct(m['mean'])} a trade; "
                     + ("approved." if m["ok"] else f"not approved ({m['why']})."))
        if m.get("calibration"):
            lines.append("Predicted vs real win chance: " + ", ".join(f"{c[1]:.0%}->{c[2]:.0%}" for c in m["calibration"]))
    else:
        lines.append(f"Coin model: {m.get('why')}.")
    lines.append(gate_line(bb.raw, bb.first, cfg))
    return "\n".join(lines)


# ---- the report ----
def read_all(data_dir: Path, cfg: dict) -> tuple[BaseRates, CoinTable, BetBlocks]:
    """One pass over each kind of file (a coin cut off by a run's end counts only at the marks it reached)."""
    br, ct, bb = BaseRates(cfg["cost"]), CoinTable(cfg["cost"]), BetBlocks(cfg)
    for r in cl.rows("c", data_dir):
        br.add(r)
        ct.add(r)
    for r in cl.rows("b", data_dir):
        bb.add(r)
    return br, ct, bb


def report(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    br, ct, bb = read_all(data_dir, cfg)
    out = {"base_rates": br.result(), "timing": timing_map(bb, cfg), "model": coin_model(ct, cfg),
           "rug": rug_filter(ct, bb.snipes, cfg),
           "bots": {k: record(v) for k, v in bb.raw.items() if v[0]}, "sat_out": bb.sat}
    out["lines"] = (base_rates_lines(out["base_rates"]) + timing_lines(out["timing"], cfg)
                    + model_lines(out["model"], out["rug"]) + side_by_side_lines(bb.raw, bb.sat))
    return out


def live(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None) -> dict:
    """What the practice super bot may trade now: the approved windows and, if it passed, the coin model (fitted on
    the last 14 days, with the cut-off for its top 10% from its picks on the latest day)."""
    import time

    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier

    cfg = cfg or config()
    _, ct, bb = read_all(data_dir, cfg)
    tm = timing_map(bb, cfg)
    out = {"approved": tm["approved"], "model": None, "cut": None, "model_ok": False, "at": time.time(), "cfg": cfg,
           "note": f"{len(tm['approved'])} of {tm['tested']} windows approved"}
    m = coin_model(ct, cfg)
    if m.get("ok"):
        idx = [i for i, r in enumerate(ct.ret) if r is not None]
        days = np.array([ct.day[i] for i in idx])
        recent = sorted(set(days))[-14:]
        keep = np.isin(days, recent)
        X = np.array([ct.x60[i] for i in idx])[keep]
        y = (np.array([ct.ret[i] for i in idx]) > 0).astype(int)[keep]
        model = HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=15, l2_regularization=1.0, random_state=0)
        model.fit(X, y)
        last = days[keep] == recent[-1]
        out.update(model=model, model_ok=True, cut=float(np.quantile(model.predict_proba(X[last])[:, 1], 0.9)),
                   note=out["note"] + "; the coin model passed")
    return out


def main(data_dir: Path = cl.DATA_DIR, out_path: Path = Path("brain_report.json"), live_path: Path | None = None) -> dict:
    if live_path is not None:                            # for the running lab: its approvals, nothing printed
        import pickle

        d = live(data_dir)
        tmp = Path(str(live_path) + ".tmp")
        with open(tmp, "wb") as f:
            pickle.dump(d, f)
        tmp.replace(live_path)
        return d
    r = report(data_dir)
    out_path.write_text(json.dumps(r, default=str))
    print("\n".join(r["lines"]), flush=True)
    return r
