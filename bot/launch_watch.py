"""Meme-coin launch watcher: paper-test buying brand-new Solana coins.

`watch` finds new coins on GeckoTerminal's "new pools" feed (pump.fun, Meteora, ...), records the price
when we first see it (the earliest a normal person could buy), then re-checks the price on DEX Screener
after 5m, 15m, 1h, 6h and 24h. `report` answers: if you had bought every new coin you saw, how did it go?

No money is involved; nothing is bought. Prices come from public APIs and can lag the chain by a few seconds.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path

import requests

log = logging.getLogger("launches")
GECKO = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools"
DEXSCREENER = "https://api.dexscreener.com/tokens/v1/solana/"
CHECKS = {"0m": 0, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400}

SCHEMA = """
create table if not exists coins (token text primary key, pool text, name text, dex text,
    created_at real, seen_at real, fdv_seen real, buys_seen int, sells_seen int);
create table if not exists checks (token text, label text, due real, done_at real, price real, fdv real,
    liquidity real, missing int default 0, primary key (token, label));
create table if not exists snapshots (token text primary key, gecko text, dex0 text);
"""


def connect(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=60)  # the watcher and news matcher share this file: wait for each other
    db.execute("pragma journal_mode=wal")
    db.executescript(SCHEMA)
    return db


def _get(url, params=None, headers=None, tries=5):
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=30)
            if r.status_code == 429:
                raise RuntimeError("rate limited")
            r.raise_for_status()
            return r.json()
        except Exception as e:  # network blips and rate limits: back off and retry
            wait = 5 * 2 ** attempt
            log.debug("GET %s failed (%s); retrying in %ss", url, e, wait)
            time.sleep(wait)
    return None


def _ts(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def discover(db: sqlite3.Connection, pages: int = 2, last: str = "24h") -> int:
    """Record coins we haven't seen yet. Returns how many were new."""
    new = 0
    now = time.time()
    for page in range(1, pages + 1):
        data = _get(GECKO, {"page": page, "include": "dex,base_token"}, {"Accept": "application/json;version=20230302"})
        if not data:
            break
        fresh_on_page = 0
        for p in data.get("data", []):
            a, rel = p["attributes"], p["relationships"]
            token = rel["base_token"]["data"]["id"].split("_", 1)[1]
            if db.execute("select 1 from coins where token = ?", (token,)).fetchone():
                continue
            tx = a.get("transactions", {}).get("h1", {})
            db.execute("insert into coins values (?,?,?,?,?,?,?,?,?)",
                       (token, a["address"], a.get("name"), rel["dex"]["data"]["id"], _ts(a["pool_created_at"]), now,
                        float(a.get("fdv_usd") or 0), tx.get("buys", 0), tx.get("sells", 0)))
            # Everything the feeds said about the coin when we first saw it: clues for the prediction model.
            db.execute("insert or ignore into snapshots (token, gecko) values (?, ?)", (token, json.dumps(a)))
            db.executemany("insert into checks (token, label, due) values (?,?,?)",
                           [(token, label, now + delay) for label, delay in CHECKS.items() if delay <= CHECKS[last]])
            new += 1
            fresh_on_page += 1
        db.commit()
        if fresh_on_page < len(data.get("data", [])):
            break  # reached coins we already know; no need to page further
        time.sleep(6)
    return new


def _best_pair(pairs):
    """A coin can trade in several pools (e.g. pump.fun, then PumpSwap after it 'graduates'): use the deepest."""
    return max(pairs, key=lambda x: ((x.get("liquidity") or {}).get("usd") or 0, (x.get("volume") or {}).get("h24") or 0))


def run_checks(db: sqlite3.Connection, max_calls: int = 20) -> int:
    """Price every checkpoint that's due, 30 coins per DEX Screener request."""
    done = 0
    for _ in range(max_calls):
        due = [t for (t,) in db.execute("select token from checks where done_at is null and due <= ? order by due limit 30", (time.time(),))]
        if not due:
            break
        data = _get(DEXSCREENER + ",".join(due))
        if data is None:
            break
        by_token = {}
        for pair in data:
            by_token.setdefault(pair["baseToken"]["address"], []).append(pair)
        now = time.time()
        for token in due:
            for label, due_at in db.execute("select label, due from checks where token=? and done_at is null and due<=?", (token, now)).fetchall():
                pairs = by_token.get(token)
                if now - due_at > max(120, 0.25 * CHECKS[label]):
                    # Too late to count as this checkpoint (e.g. the watcher was stopped): skip it, don't guess.
                    db.execute("update checks set done_at=?, missing=2 where token=? and label=?", (now, token, label))
                elif pairs:
                    p = _best_pair(pairs)
                    if label == "0m":
                        db.execute("update snapshots set dex0=? where token=?", (json.dumps(p), token))
                    db.execute("update checks set done_at=?, price=?, fdv=?, liquidity=? where token=? and label=?",
                               (now, float(p.get("priceUsd") or 0), p.get("fdv"), (p.get("liquidity") or {}).get("usd"), token, label))
                else:
                    db.execute("update checks set done_at=?, missing=1 where token=? and label=?", (now, token, label))
                done += 1
        db.commit()
        time.sleep(1.2)
    return done


def watch(db_path: str, hours: float, poll_seconds: int = 45, last: str = "24h"):
    """Discover for `hours`, then keep checking until every pending checkpoint (up to `last`) is done."""
    db = connect(db_path)
    stop_discovering = time.time() + hours * 3600
    while True:
        discovering = time.time() < stop_discovering
        if discovering:
            n = discover(db, last=last)
            log.info("new coins: %d (total %d)", n, db.execute("select count(*) from coins").fetchone()[0])
        checked = run_checks(db)
        pending = db.execute("select count(*) from checks where done_at is null and due - (select seen_at from coins where coins.token = checks.token) <= ?",
                             (CHECKS[last],)).fetchone()[0]
        log.info("price checks done: %d, still pending: %d", checked, pending)
        if not discovering and pending == 0:
            break
        time.sleep(poll_seconds)


def outcomes(db_path: str, round_trip_cost: float = 0.04):
    """One row per coin and checkpoint: return from the first-seen price, before and after trading costs.

    `round_trip_cost` covers platform fees (~1% each way on pump.fun) plus slippage on thin new coins.
    A coin DEX Screener no longer lists at all is counted as -100% (it vanished / was abandoned).
    Checks that ran too late (missing=2, e.g. the watcher was offline) are left out.
    """
    import pandas as pd

    db = connect(db_path)
    q = """select c.token, c.name, c.dex, c.created_at, c.seen_at, c.fdv_seen, c.buys_seen, c.sells_seen,
                  e.price as entry, e.liquidity as entry_liq, k.label, k.price, k.missing, k.liquidity, k.fdv as fdv_later
           from coins c join checks e on e.token = c.token and e.label = '0m'
           join checks k on k.token = c.token and k.label != '0m'
           where e.price > 0 and e.missing = 0 and k.done_at is not null and k.missing != 2"""
    df = pd.read_sql(q, db)
    df["ret"] = (df.price / df.entry - 1).where(df.missing == 0, -1.0).fillna(-1.0)
    # Liquidity pulled ("rug pull"): with almost no money left in the pool the quoted price is meaningless
    # and you couldn't sell, so it's a total loss. (Pump.fun coins report no liquidity figure; those are kept.)
    rugged = df.liquidity.notna() & (df.liquidity < 500)
    df.loc[rugged, "ret"] = -1.0
    # Rigged pools: a coin "becoming" a billion-dollar coin within hours is a fake price set up to lure buyers;
    # nobody could actually sell at it.
    fake = (df.fdv_later > 1e9) & (df.ret > 100)
    df.loc[fake, "ret"] = -1.0
    df["net"] = (1 + df.ret) * (1 - round_trip_cost) - 1
    df["age_seen_min"] = (df.seen_at - df.created_at) / 60
    return df


def report(db_path: str, round_trip_cost: float = 0.04) -> str:
    df = outcomes(db_path, round_trip_cost)
    if df.empty:
        return "No finished checkpoints yet. Leave `launches watch` running a little longer."
    lines = [f"Coins tracked: {df.token.nunique()}  |  first seen a median {df.age_seen_min.median():.1f} min after launch",
             f"Costs assumed: {round_trip_cost:.0%} per round trip (fees + slippage)", "",
             f"{'held for':<9}{'coins':>6}{'went up':>9}{'typical':>10}{'avg (EV)':>10}{'lost 90%+':>11}{'2x+':>7}{'10x+':>7}  $1 in each coin →"]
    for label in [l for l in CHECKS if l != "0m"]:
        g = df[df.label == label]
        if g.empty:
            continue
        n = len(g)
        lines.append(f"{label:<9}{n:>6}{(g.net > 0).mean():>9.0%}{g.net.median():>+10.0%}{g.net.mean():>+10.0%}"
                     f"{(g.ret <= -0.9).mean():>11.0%}{(g.ret >= 1).mean():>7.0%}{(g.ret >= 9).mean():>7.0%}"
                     f"  ${n} → ${n * (1 + g.net.mean()):,.0f}")
    lines += ["", "typical = the middle coin's result; avg (EV) = what buying every coin returned on average,",
              "which a few huge winners can pull up. Both are after costs."]
    return "\n".join(lines)
