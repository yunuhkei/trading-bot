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


# ---- the report ----
def report(data_dir: Path = cl.DATA_DIR, cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    coins = cl.read("c", data_dir)              # a coin cut off by a run's end counts only at the marks it reached
    out = {"base_rates": base_rates(coins, cfg["cost"])}
    out["lines"] = base_rates_lines(out["base_rates"])
    return out


def main(data_dir: Path = cl.DATA_DIR, out_path: Path = Path("brain_report.json")) -> dict:
    r = report(data_dir)
    out_path.write_text(json.dumps(r))
    print("\n".join(r["lines"]), flush=True)
    return r
