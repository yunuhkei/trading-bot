"""Find "smart wallets": Solana wallets that bought young coins near the bottom of a big run and sold near the top, on
several different coins. They're what the copy-trader (bot/copytrade.py) follows.

How it works (python -m bot smart-wallets; the smart-wallets workflow runs it every week with the HELIUS_API_KEY secret):
1. For each coin (the Solana bot's list plus busy young coins it can find), it looks at the last ~7 days of 5-minute
   candles for pumps (the price at least doubled within 2 days) and takes the most recent one from the last 4 days.
2. It reads every swap in that coin's main pool around the bottom (2 h before to 2 h after) and around the top (4 h
   either side), straight from the blockchain (Helius RPC; the public RPC is too slow), and works out, per wallet, what
   it bought and sold and at what price.
3. A wallet is "smart" on a pump if it bought $25+ near the bottom and sold at least 30% of that near the top for 1.5x+
   its buy price. Wallets with 40+ swaps in those windows are bots (sandwiching, market making) and are skipped.
4. The list keeps wallets that did it on 2+ different coins (or, if too few, the ones that made the most), ranked by
   coins then profit, and saves it to models/smart_wallets.json.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import pandas as pd

log = logging.getLogger("smart_wallets")
PUBLIC_RPC = "https://api.mainnet-beta.solana.com"
OUT = Path("models/smart_wallets.json")
SOL_MINT = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
BUY_WINDOW = (2 * 3600, 2 * 3600)      # seconds before / after the bottom
SELL_WINDOW = (4 * 3600, 4 * 3600)     # seconds before / after the top
MIN_BUY_USD, MIN_SOLD_SHARE, MIN_GAIN, MAX_SWAPS = 25.0, 0.30, 1.5, 40
# The free Helius plan has 1M credits a month: a run reads at most MAX_TX transactions per pump (a coin busier than that
# around its pump is skipped: bots, and we'd only see a sliver of each wallet's trades), MAX_COINS coins, and only pumps
# from the last RECENT_DAYS days (older ones need too many pages of history).
MAX_TX, MAX_COINS, RECENT_DAYS = 2500, 8, 4
CALLS = {"pages": 0, "tx": 0}


def rpc_url() -> str:
    key = os.environ.get("HELIUS_API_KEY", "").strip()
    return f"https://mainnet.helius-rpc.com/?api-key={key}" if key else PUBLIC_RPC


def rpc(method: str, params: list, url: str | None = None):
    import requests

    for attempt in range(6):
        r = requests.post(url or rpc_url(), json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(1.5 * (attempt + 1))
            continue
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"{method}: {j['error']}")
        return j["result"]
    raise RuntimeError(f"{method}: rate limited")


def rpc_batch(calls: list[tuple[str, list]], url: str | None = None) -> list:
    """Several RPC calls in one request (results in order; None for any that failed)."""
    import requests

    body = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
    for attempt in range(6):
        r = requests.post(url or rpc_url(), json=body, timeout=120)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 * (attempt + 1))
            continue
        j = r.json()
        if isinstance(j, dict):                          # the endpoint doesn't take batches: one by one
            return [_try(lambda m=m, p=p: rpc(m, p, url)) for m, p in calls]
        by_id = {x.get("id"): x.get("result") for x in j}
        return [by_id.get(i) for i in range(len(calls))]
    raise RuntimeError("batch: rate limited")


def _try(f):
    try:
        return f()
    except Exception as e:
        log.warning("%s", e)
        return None


def signatures(address: str, since: float, max_pages: int = 300) -> list[tuple[str, float]]:
    """(signature, unix time) of every successful transaction touching `address` since `since`, newest first."""
    out, before = [], None
    for _ in range(max_pages):
        opts = {"limit": 1000}
        if before:
            opts["before"] = before
        page = rpc("getSignaturesForAddress", [address, opts])
        CALLS["pages"] += 1
        if not page:
            break
        out += [(s["signature"], float(s["blockTime"] or 0)) for s in page if not s.get("err")]
        before = page[-1]["signature"]
        if (page[-1].get("blockTime") or 0) < since:
            break
    return [(s, t) for s, t in out if t >= since]


def swap_of(tx: dict | None, mint: str) -> tuple[str, float] | None:
    """(wallet, change in its `mint` balance) for the wallet that signed this transaction: + bought, - sold."""
    if not tx or (tx.get("meta") or {}).get("err"):
        return None
    keys = tx["transaction"]["message"]["accountKeys"]
    signer = next((k["pubkey"] if isinstance(k, dict) else k for k in keys if isinstance(k, dict) and k.get("signer")), None)
    if not signer:
        return None
    meta = tx["meta"]

    def bal(rows):
        return sum(float(b["uiTokenAmount"].get("uiAmount") or 0) for b in rows or []
                   if b.get("mint") == mint and b.get("owner") == signer)
    d = bal(meta.get("postTokenBalances")) - bal(meta.get("preTokenBalances"))
    return (signer, d) if abs(d) > 0 else None


def pumps(df: pd.DataFrame, min_gain: float = 1.0, within_h: float = 48) -> list[dict]:
    """Big runs in a 5-minute chart: from a low, the price at least (1 + min_gain)x within `within_h` hours.
    Biggest first, no two overlapping."""
    if df is None or len(df) < 50:
        return []
    lo, hi, idx = df["low"].to_numpy(), df["high"].to_numpy(), df.index
    n, span = len(df), int(within_h * 12)
    cands = []
    for i in range(n):
        j = i + 1 + int(hi[i + 1:i + 1 + span].argmax()) if i + 1 < n else None
        if j is not None and j < n and lo[i] > 0 and hi[j] / lo[i] >= 1 + min_gain:
            cands.append((hi[j] / lo[i], i, j))
    out, used = [], []
    for gain, i, j in sorted(cands, reverse=True):
        if any(not (j < a or i > b) for a, b in used):
            continue
        used.append((i, j))
        out.append({"low_t": idx[i].timestamp(), "low": float(lo[i]), "high_t": idx[j].timestamp(), "high": float(hi[j]),
                    "gain": float(gain - 1)})
    return out


def price_at(df: pd.DataFrame, t: float) -> float | None:
    s = df["close"][df.index <= pd.Timestamp(t, unit="s", tz="UTC")]
    return float(s.iloc[-1]) if len(s) else None


def smart_on_pump(trades: list[tuple[float, str, float]], df: pd.DataFrame, pump: dict) -> dict[str, dict]:
    """wallet -> its record on this pump, for the wallets that bought near the bottom and sold near the top.
    `trades`: (time, wallet, token change) of the swaps in the two windows."""
    b0, b1 = pump["low_t"] - BUY_WINDOW[0], pump["low_t"] + BUY_WINDOW[1]
    s0, s1 = pump["high_t"] - SELL_WINDOW[0], pump["high_t"] + SELL_WINDOW[1]
    per: dict[str, dict] = {}
    for t, w, d in trades:
        p = price_at(df, t)
        if p is None:
            continue
        r = per.setdefault(w, {"swaps": 0, "bought": 0.0, "cost": 0.0, "sold": 0.0, "got": 0.0})
        r["swaps"] += 1
        if d > 0 and b0 <= t <= b1:
            r["bought"] += d
            r["cost"] += d * p
        elif d < 0 and s0 <= t <= s1:
            r["sold"] += -d
            r["got"] += -d * p
    out = {}
    for w, r in per.items():
        if r["swaps"] > MAX_SWAPS or r["cost"] < MIN_BUY_USD or r["bought"] <= 0 or r["sold"] <= 0:
            continue
        avg_buy, avg_sell = r["cost"] / r["bought"], r["got"] / r["sold"]
        if r["sold"] >= MIN_SOLD_SHARE * r["bought"] and avg_sell >= MIN_GAIN * avg_buy:
            sold = min(r["sold"], r["bought"])
            out[w] = {"bought_usd": round(r["cost"], 2), "x": round(avg_sell / avg_buy, 2),
                      "profit": round(sold * (avg_sell - avg_buy), 2)}
    return out


def coin_trades(mint: str, pool: str, pump: dict, cap: int = MAX_TX) -> list[tuple[float, str, float]] | None:
    """(time, wallet, token change) of the swaps in the pool around this pump's bottom and top; None if there are more
    than `cap` (too busy to read them all on the free plan)."""
    since = pump["low_t"] - BUY_WINDOW[0]
    sigs = signatures(pool, since)
    want = [(s, t) for s, t in sigs if pump["low_t"] - BUY_WINDOW[0] <= t <= pump["low_t"] + BUY_WINDOW[1]
            or pump["high_t"] - SELL_WINDOW[0] <= t <= pump["high_t"] + SELL_WINDOW[1]]
    if len(want) > cap:
        log.warning("%d swaps around this pump: too busy, skipped", len(want))
        return None
    out = []
    for k in range(0, len(want), 50):
        chunk = want[k:k + 50]
        txs = rpc_batch([("getTransaction", [s, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1}])
                         for s, _ in chunk])
        CALLS["tx"] += len(chunk)
        for (s, t), tx in zip(chunk, txs):
            sw = swap_of(tx, mint)
            if sw:
                out.append((t, sw[0], sw[1]))
    return out


def main_pool(mint: str) -> str | None:
    import requests

    pairs = [p for p in requests.get(f"https://api.dexscreener.com/tokens/v1/solana/{mint}", timeout=30).json()
             if p["baseToken"]["address"] == mint]
    return max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)["pairAddress"] if pairs else None


def find(coins: list[tuple[str, str]], history=None, min_coins: int = 2, keep: int = 30, budget_s: float = 4 * 3600,
         max_coins: int = MAX_COINS, recent_days: float = RECENT_DAYS) -> dict:
    """The smart wallets across these coins [(name, mint)]: see the module notes."""
    from .solbot_learn import coin_history

    history = history or (lambda mint: coin_history(f"sol:{mint}"))
    t0, wallets, seen_pumps, read = time.time(), {}, [], 0
    for name, mint in coins:
        if time.time() - t0 > budget_s or read >= max_coins:
            log.warning("time or coin budget reached")
            break
        try:
            df = history(mint)
            found = [p for p in pumps(df) if p["low_t"] >= time.time() - recent_days * 86400]
            pool = main_pool(mint) if found else None
        except Exception as e:
            log.warning("%s: %s", name, e)
            continue
        for p in sorted(found, key=lambda p: -p["low_t"])[:1]:     # its most recent big run
            try:
                trades = coin_trades(mint, pool, p)
            except Exception as e:
                log.warning("%s pump: %s", name, e)
                continue
            if trades is None:
                seen_pumps.append({"coin": name, "mint": mint, "gain": round(p["gain"], 2), "skipped": "too busy"})
                print(f"{name}: +{p['gain']:.0%} run, too busy to read on the free plan (skipped)", flush=True)
                continue
            read += 1
            smart = smart_on_pump(trades, df, p)
            seen_pumps.append({"coin": name, "mint": mint, "gain": round(p["gain"], 2), "low_t": p["low_t"],
                               "high_t": p["high_t"], "swaps": len(trades), "smart": len(smart)})
            print(f"{name}: +{p['gain']:.0%} run, {len(trades)} swaps read, {len(smart)} wallets bought the bottom and sold the top",
                  flush=True)
            for w, r in smart.items():
                rec = wallets.setdefault(w, {"coins": [], "profit": 0.0, "wins": []})
                if name not in rec["coins"]:
                    rec["coins"].append(name)
                rec["profit"] = round(rec["profit"] + r["profit"], 2)
                rec["wins"].append({"coin": name, **r})
    ranked = sorted(wallets.items(), key=lambda kv: (-len(kv[1]["coins"]), -kv[1]["profit"]))
    best = [(w, r) for w, r in ranked if len(r["coins"]) >= min_coins][:keep]
    level = f"{min_coins}+ coins"
    if len(best) < 5:                                        # too few repeat winners: the biggest one-time winners
        best = [(w, r) for w, r in ranked if r["profit"] >= 100][:keep] or best
        level = "the biggest winners (few won on 2+ coins)"
    return {"updated": time.time(), "level": level, "wallets": dict(best), "pumps": seen_pumps,
            "coins_checked": [n for n, _ in coins], "calls": dict(CALLS)}


def coins_to_check(settings: dict, n: int = 20) -> list[tuple[str, str]]:
    """The Solana bot's list plus busy young Solana coins (2-60 days old)."""
    from .news_ideas import candidates
    from .solbot import solana_coins, watch_names

    wl = settings.get("watchlist", "watchlist.young.txt")
    names = watch_names(wl)
    out = [(names.get(m, mint[:6]), mint) for m, mint in solana_coins(wl)]
    try:
        young = [c for c in candidates({"solana": "sol"}) if c["chain"] == "solana" and 48 <= c.get("age_h", 0) <= 60 * 24
                 and c.get("liq", 0) >= 30_000]
        for c in sorted(young, key=lambda c: -c.get("vol24", 0)):
            if len(out) >= n:
                break
            if c["address"] not in {m for _, m in out}:
                out.append((c["symbol"], c["address"]))
    except Exception as e:
        log.warning("coin search failed: %s", e)
    return out


def run(settings_path: str = "solbot.yaml"):
    from .signals import alert_target, notify
    from .solbot import commit, load_settings

    if not os.environ.get("HELIUS_API_KEY"):
        print("No HELIUS_API_KEY secret: using the slow public RPC (expect rate limits).", flush=True)
    res = find(coins_to_check(load_settings(settings_path)))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1))
    commit([str(OUT)], f"Smart wallets: {len(res['wallets'])} found")
    top = list(res["wallets"].items())[:5]
    text = (f"Checked {len(res['coins_checked'])} coins, {len(res['pumps'])} big runs ({res['calls']['tx']:,} swaps read). "
            f"Following {len(res['wallets'])} "
            f"wallets ({res['level']}). Top: " + "; ".join(
                f"{w[:4]}…{w[-4:]} won on {', '.join(r['coins'])} (+${r['profit']:,.0f})" for w, r in top))
    print(text, flush=True)
    target = alert_target()
    if target and res["wallets"]:
        notify(target, f"🧠 Smart wallets: following {len(res['wallets'])}", text[:3500], buy=True, tag="bar_chart")
