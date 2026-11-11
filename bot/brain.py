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


# ---- the report ----
def report(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    coins = cl.read("c", data_dir)              # a coin cut off by a run's end counts only at the marks it reached
    out = {"base_rates": base_rates(coins, cfg["cost"]), "timing": timing_map(cl.read("b", data_dir), cfg)}
    out["lines"] = base_rates_lines(out["base_rates"]) + timing_lines(out["timing"], cfg)
    return out


def main(data_dir: Path = cl.DATA_DIR, out_path: Path = Path("brain_report.json")) -> dict:
    r = report(data_dir)
    out_path.write_text(json.dumps(r))
    print("\n".join(r["lines"]), flush=True)
    return r
