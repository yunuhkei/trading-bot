"""Read-only: Replays Super bot 1's trades against the real on-chain trades: the coin's real curve at the second it bought and
the second it sold, the same $250 and fee math as the lab, our own buy counted in the curve when selling."""
import json, os, sys, time, urllib.request
from solders.pubkey import Pubkey
from bot import launch_lab as ll
from bot import pump_direct as pd

KEY = os.environ.get("HELIUS_API_KEY", "").strip()
RPC = f"https://mainnet.helius-rpc.com/?api-key={KEY}" if KEY else "https://api.mainnet-beta.solana.com"
trades = json.load(open(sys.argv[1]))["super_trades"]["timing"]
out_path = sys.argv[2]

def rpc(method, params, tries=10):
    for i in range(tries):
        req = urllib.request.Request(RPC, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                     {"Content-Type": "application/json"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=30))
            if "result" in d:
                time.sleep(0.05 if KEY else 1.0)
                return d["result"]
        except Exception:
            pass
        time.sleep(5 + 6 * i)
    raise RuntimeError(f"{method} kept failing")

def sol_price(t):
    url = (f"https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=3600"
           f"&start={time.strftime('%Y-%m-%dT%H:00:00Z', time.gmtime(t - 3600))}&end={time.strftime('%Y-%m-%dT%H:00:00Z', time.gmtime(t + 3600))}")
    try:
        rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "trading-bot-check"}), timeout=20))
        return float(min(rows, key=lambda r: abs(r[0] - t))[4])
    except Exception:
        return 150.0

def curve_at(sigs, mint, t):
    """The coin's curve right after its last real trade at or before time t: (vsol, vtok, fee, seconds before t)."""
    for s in [x for x in sigs if x.get("blockTime") and x["blockTime"] <= t and not x.get("err")][:20]:
        tx = rpc("getTransaction", [s["signature"], {"encoding": "json", "maxSupportedTransactionVersion": 0, "commitment": "confirmed"}])
        evs = [e for e in ll.pump_events((tx or {}).get("meta", {}).get("logMessages") or [])
               if e["kind"] == "trade" and e["mint"] == mint]
        if evs:
            e = evs[-1]
            return e["vsol"], e["vtok"], e["fee"], t - s["blockTime"]
    return None

import os
results = json.load(open(out_path)) if os.path.exists(out_path) else []
done_keys = {(r["mint"], r["t"]) for r in results if r.get("real") is not None}
results = [r for r in results if r.get("real") is not None]
for i, tr in enumerate(trades):
    mint, t_buy, t_sell = tr["mint"], tr["t"], tr["t"] + tr["s"]
    if (mint, t_buy) in done_keys:
        continue
    try:
        replay_one = True
        curve = str(pd.pda(b"bonding-curve", bytes(Pubkey.from_string(mint))))
        sigs, before = [], None
        for page in range(40):                            # newest first, back to just before the buy
            p = rpc("getSignaturesForAddress", [curve, {"limit": 1000, **({"before": before} if before else {})}])
            if not p:
                break
            sigs += p
            before = p[-1]["signature"]
            if (p[-1].get("blockTime") or 0) < t_buy - 60 or len(p) < 1000:
                break
        sol_usd = sol_price(t_buy)
        b, s = curve_at(sigs, mint, t_buy), curve_at(sigs, mint, t_sell)
        row = {"mint": mint, "name": tr["name"], "t": t_buy, "lab": tr["profit"], "why_in": tr["why_in"][:40], "why_out": tr["why_out"][:30]}
        if b and s:
            sol_in = 250 / sol_usd - ll.TX_COST_SOL
            tok = ll.buy_tokens(b[0], b[1], sol_in, b[2])
            vsol, vtok = s[0] + sol_in * (1 - b[2]), max(s[1] - tok, 1e-9)
            back = max(0.0, ll.sell_sol(vsol, vtok, tok, s[2]) - ll.TX_COST_SOL) * sol_usd
            row.update(real=round(back - 250, 2), buy_gap=b[3], sell_gap=s[3])
        else:
            row["real"] = None
        results.append(row)
        print(f"{i + 1}/{len(trades)} {tr['name'][:12]:12} lab {tr['profit']:+8.2f}  real {row['real'] if row['real'] is not None else 'n/a':>8}", flush=True)
        json.dump(results, open(out_path, "w"))
    except Exception as ex:
        print(f"{i + 1}/{len(trades)} {tr['name'][:12]:12} failed: {ex}", flush=True)

done = [r for r in results if r["real"] is not None]
print(f"DONE: {len(done)} of {len(results)} replayed; lab {sum(r['lab'] for r in done):+.2f} vs real {sum(r['real'] for r in done):+.2f}")
