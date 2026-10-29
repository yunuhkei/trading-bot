"""Forward test: do meme coins that are still alive a few hours after launch keep going?

Every round, look at every coin the launch watcher has recorded that is now 1-24 hours old. A coin
"survives" if it still trades (over $1k volume in the last hour), has real money in its pool, and a
believable value. The first time a coin survives it is paper-bought at its current price, in group
"survivor", and also in group "uptrend" if it is rising over the last 1h and 6h with more buyers than
sellers. Prices are re-checked 1h and 2h later. Nothing is bought for real.
"""
from __future__ import annotations

import logging
import time

import pandas as pd
import requests

from .launch_watch import DEXSCREENER, _best_pair, connect

log = logging.getLogger("survivors")
SCHEMA = """
create table if not exists survivor_buys (token text primary key, bought_at real, age_h real, price real, liq real, mcap real,
    vol_h1 real, chg_h1 real, chg_h6 real, buys_h1 int, sells_h1 int, uptrend int);
create table if not exists survivor_checks (token text, label text, due real, done_at real, price real, liq real, missing int default 0,
    primary key (token, label));
"""
FOLLOW = {"1h": 3600, "2h": 7200}
MIN_VOL_H1, MIN_LIQ, MIN_MCAP, MAX_MCAP = 1_000, 5_000, 10_000, 50_000_000


def _pairs(tokens):
    out = {}
    for i in range(0, len(tokens), 30):
        chunk = tokens[i:i + 30]
        try:
            data = requests.get(DEXSCREENER + ",".join(chunk), timeout=30).json()
        except Exception as e:
            log.warning("price lookup failed: %s", e)
            continue
        by = {}
        for p in data:
            by.setdefault(p["baseToken"]["address"], []).append(p)
        out.update({t: _best_pair(ps) for t, ps in by.items()})
        time.sleep(1.1)
    return out


def scan(db) -> int:
    """Paper-buy coins that newly qualify as survivors. Returns how many were bought."""
    db.executescript(SCHEMA)
    now = time.time()
    cand = [t for (t,) in db.execute("""select token from coins where ? - created_at between 3600 and 86400
                                        and token not in (select token from survivor_buys)""", (now,))]
    bought = 0
    for token, p in _pairs(cand).items():
        liq = (p.get("liquidity") or {}).get("usd") or 0
        mcap = p.get("marketCap") or p.get("fdv") or 0
        vol = (p.get("volume") or {}).get("h1") or 0
        price = float(p.get("priceUsd") or 0)
        if not (vol >= MIN_VOL_H1 and liq >= MIN_LIQ and MIN_MCAP <= mcap <= MAX_MCAP and price > 0):
            continue
        chg = p.get("priceChange") or {}
        tx = (p.get("txns") or {}).get("h1") or {}
        created = db.execute("select created_at from coins where token=?", (token,)).fetchone()[0]
        up = int((chg.get("h1") or 0) > 0 and (chg.get("h6") or 0) > 0 and tx.get("buys", 0) > tx.get("sells", 0))
        db.execute("insert into survivor_buys values (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (token, now, (now - created) / 3600, price, liq, mcap, vol, chg.get("h1"), chg.get("h6"), tx.get("buys", 0), tx.get("sells", 0), up))
        db.executemany("insert into survivor_checks (token, label, due) values (?,?,?)", [(token, l, now + d) for l, d in FOLLOW.items()])
        bought += 1
    db.commit()
    return bought


def follow_up(db) -> int:
    db.executescript(SCHEMA)
    now = time.time()
    due = db.execute("select token, label, due from survivor_checks where done_at is null and due <= ?", (now,)).fetchall()
    found = _pairs(sorted({t for t, _, _ in due}))
    for token, label, due_at in due:
        if now - due_at > 900:  # too late to count as this checkpoint (e.g. the tester was off): skip it
            db.execute("update survivor_checks set done_at=?, missing=2 where token=? and label=?", (now, token, label))
            continue
        p = found.get(token)
        if p:
            db.execute("update survivor_checks set done_at=?, price=?, liq=? where token=? and label=?",
                       (now, float(p.get("priceUsd") or 0), (p.get("liquidity") or {}).get("usd"), token, label))
        else:
            db.execute("update survivor_checks set done_at=?, missing=1 where token=? and label=?", (now, token, label))
    db.commit()
    return len(due)


def run(db_path: str, hours: float, every_minutes: float = 15):
    db = connect(db_path)
    db.executescript(SCHEMA)
    end = time.time() + hours * 3600
    while True:
        scanning = time.time() < end
        n = scan(db) if scanning else 0
        k = follow_up(db)
        pending = db.execute("select count(*) from survivor_checks where done_at is null").fetchone()[0]
        log.info("survivors bought: +%d (total %d), checks done: %d, pending: %d", n,
                 db.execute("select count(*) from survivor_buys").fetchone()[0], k, pending)
        if not scanning and pending == 0:
            break
        time.sleep(60 if not scanning else every_minutes * 60)


def report(db_path: str, cost: float = 0.03) -> str:
    db = connect(db_path)
    db.executescript(SCHEMA)
    df = pd.read_sql("""select b.*, c.label, c.price as later, c.liq as later_liq, c.missing from survivor_buys b
                        join survivor_checks c on c.token = b.token where c.done_at is not null and c.missing != 2""", db)
    total = db.execute("select count(*) from survivor_buys").fetchone()[0]
    if df.empty:
        return f"Survivors paper-bought so far: {total}. No 1-hour results yet."
    df["ret"] = (df.later / df.price - 1).where(df.missing == 0, -1.0).fillna(-1.0)
    df.loc[df.later_liq.notna() & (df.later_liq < 500), "ret"] = -1.0   # liquidity pulled = can't sell
    df["net"] = (1 + df.ret) * (1 - cost) - 1
    lines = [f"Survivors paper-bought so far: {total} (coins 1-24h old, still trading, $10k-$50M value). Costs: {cost:.0%} per round trip.",
             f"{'held':<6}{'group':<22}{'coins':>6}{'went up':>9}{'typical':>9}{'avg':>8}{'2x+':>6}{'lost 90%+':>11}  $1 each ->"]
    for label in FOLLOW:
        for name, g in (("all survivors", df[df.label == label]), ("trending up", df[(df.label == label) & (df.uptrend == 1)]),
                        ("not trending up", df[(df.label == label) & (df.uptrend == 0)])):
            if g.empty:
                continue
            n = len(g)
            lines.append(f"{label:<6}{name:<22}{n:>6}{(g.net > 0).mean():>9.0%}{g.net.median():>+9.0%}{g.net.mean():>+8.0%}"
                         f"{(g.ret >= 1).mean():>6.0%}{(g.ret <= -0.9).mean():>11.0%}  ${n} -> ${n * (1 + g.net.mean()):,.2f}")
    return "\n".join(lines)
