"""News-driven meme coin IDEAS (not buy signals).

Each run: read what's trending (Google Trends) and who's in the headlines (Google News, BBC), look at the
meme coins with the most action right now (GeckoTerminal trending pools + DEX Screener's newest profiles),
and flag coins named after a current news topic that also pass basic safety filters. At most a few new
ideas per run, never the same coin twice in a week.

Testing on 3,000+ brand-new coins found that news-named coins LOST money on average; these filters make the
list pickier, but an idea is only a starting point: add it to watchlist.memes.txt and let the breakout rule
decide if and when to buy.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path

import requests

from . import news

log = logging.getLogger("news_ideas")
NETWORKS = {"solana": "sol", "base": "base", "bsc": "bsc"}
GECKO_HEADERS = {"Accept": "application/json;version=20230302"}
MIN_LIQ, MIN_VOL24, MAX_AGE_H, MAX_MCAP = 20_000, 50_000, 45 * 24, 50_000_000
COPYCAT = ("inc", "inc.", "corp", "corp.", "corporation", "ltd", "llc", "company")
# Coins pretending to be a big, real coin (a "Bitcoin" meme coin is not Bitcoin): always left out.
IMPOSTOR = {"bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "bnb", "usdc", "usdt", "tether", "dogecoin", "doge"}


def _get(url, **kw):
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=30, **kw)
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            log.warning("fetch failed (%s): %s", url, e)
            time.sleep(3)
    return None


def candidates() -> list[dict]:
    """Meme coins with the most action right now, with the numbers the filters need."""
    found = {}
    lists = [("trending_pools", page) for page in (1, 2, 3)] + [("pools", page) for page in (1, 2)]  # hot + busiest
    for net in NETWORKS:
        for kind, page in lists:
            data = _get(f"https://api.geckoterminal.com/api/v2/networks/{net}/{kind}",
                        params={"page": page, "include": "base_token"}, headers=GECKO_HEADERS)
            time.sleep(2.5)
            if not data:
                continue
            tokens = {t["id"]: t["attributes"] for t in data.get("included", [])}
            for p in data.get("data", []):
                a, tid = p["attributes"], p["relationships"]["base_token"]["data"]["id"]
                t = tokens.get(tid, {})
                address = t.get("address") or tid.split("_", 1)[1]
                found[(net, address)] = {
                    "chain": net, "address": address, "symbol": t.get("symbol") or "", "name": t.get("name") or "",
                    "age_h": (time.time() - datetime.fromisoformat(a["pool_created_at"].replace("Z", "+00:00")).timestamp()) / 3600,
                    "liq": float(a.get("reserve_in_usd") or 0), "vol24": float((a.get("volume_usd") or {}).get("h24") or 0),
                    "mcap": float(a.get("market_cap_usd") or a.get("fdv_usd") or 0),
                    "url": f"https://dexscreener.com/{net}/{a['address']}"}
    # DEX Screener's newest coin profiles (projects that just set up a page): look up their numbers in batches.
    profiles = _get("https://api.dexscreener.com/token-profiles/latest/v1") or []
    by_chain = {}
    for pr in profiles:
        if pr.get("chainId") in NETWORKS and (pr["chainId"], pr["tokenAddress"]) not in found:
            by_chain.setdefault(pr["chainId"], []).append(pr["tokenAddress"])
    for chain, addrs in by_chain.items():
        for i in range(0, len(addrs), 30):
            for p in _get(f"https://api.dexscreener.com/tokens/v1/{chain}/" + ",".join(addrs[i:i + 30])) or []:
                key = (chain, p["baseToken"]["address"])
                liq = (p.get("liquidity") or {}).get("usd") or 0
                if key in found and found[key]["liq"] >= liq:
                    continue
                found[key] = {"chain": chain, "address": p["baseToken"]["address"], "symbol": p["baseToken"].get("symbol") or "",
                              "name": p["baseToken"].get("name") or "",
                              "age_h": (time.time() * 1000 - (p.get("pairCreatedAt") or 0)) / 3.6e6, "liq": liq,
                              "vol24": (p.get("volume") or {}).get("h24") or 0, "mcap": p.get("marketCap") or p.get("fdv") or 0,
                              "url": p.get("url") or ""}
    return list(found.values())


def current_topics(hours: float = 12) -> dict[str, str]:
    """keyword -> headline, for real news topics in the last `hours` (see news.news_topics)."""
    rows, cutoff = [], time.time() - hours * 3600
    for source, url in news.FEEDS.items():
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            r.raise_for_status()
            rows += [(source, title) for title, pub in news._parse_rss(source, r.text) if (pub or time.time()) >= cutoff]
        except Exception as e:
            log.warning("feed %s failed: %s", source, e)
    return news.news_topics(rows)


def passes(c: dict) -> bool:
    return c["liq"] >= MIN_LIQ and c["vol24"] >= MIN_VOL24 and c["age_h"] <= MAX_AGE_H and 0 < c["mcap"] <= MAX_MCAP


def find_ideas(cands: list[dict], topics: dict[str, str]) -> list[dict]:
    ideas = []
    for c in cands:
        if not passes(c):
            continue
        words = c["name"].lower().replace(",", " ").split()
        if any(w in COPYCAT for w in words) or c["name"].strip().lower() in IMPOSTOR or c["symbol"].strip().lower() in IMPOSTOR:
            continue  # copies a real company or a big coin: a common scam, never an idea worth sending
        kw = news.coin_matches(c["name"], c["symbol"], topics)
        if kw:
            ideas.append({**c, "keyword": kw, "headline": topics[kw], "copycat": False})
    return sorted(ideas, key=lambda i: -i["vol24"])


def message(i: dict) -> tuple[str, str]:
    title = f"IDEA: {i['symbol']} (news: {i['keyword']})"
    lines = [f"\"{i['headline'][:110]}\"",
             f"{i['name']}: {i['age_h']:.0f}h old, value ${i['mcap']:,.0f}, ${i['vol24']:,.0f} traded today, ${i['liq']:,.0f} in the pool.",
             f"Not a buy signal. To track it, add this line to watchlist.memes.txt: {NETWORKS[i['chain']]}:{i['address']}"]
    if i["copycat"]:
        lines.insert(0, "WARNING: named like a real company - often a scam.")
    if i["url"]:
        lines.append(i["url"])
    return title, "\n".join(lines)


def run(target: str | None, state_path: str = "news_ideas_state.json", max_per_run: int = 3) -> list[dict]:
    """Find ideas, alert on up to `max_per_run` coins not alerted in the last 7 days. Returns the ideas found."""
    from .signals import notify

    state = json.loads(Path(state_path).read_text()) if Path(state_path).exists() else {}
    week_ago = time.time() - 7 * 86400
    state = {k: v for k, v in state.items() if v >= week_ago}
    ideas = find_ideas(candidates(), current_topics())
    sent = 0
    for i in ideas:
        key = f"{i['chain']}:{i['address']}"
        i["new"] = key not in state
        if i["new"] and sent < max_per_run:
            title, msg = message(i)
            log.warning("IDEA %s: %s", title, msg.replace("\n", " | "))
            if target:
                notify(target, title, msg, buy=True)
            state[key] = time.time()
            sent += 1
    Path(state_path).write_text(json.dumps(state))
    return ideas


def table(ideas: list[dict]) -> str:
    if not ideas:
        return "No news-matched meme coins pass the safety filters right now."
    out = [f"{'coin':<12}{'news word':<16}{'age':>6}{'value':>14}{'traded 24h':>14}  headline"]
    for i in ideas:
        flag = " (company copycat!)" if i["copycat"] else ""
        out.append(f"{i['symbol'][:11]:<12}{i['keyword'][:15]:<16}{i['age_h']:>5.0f}h{i['mcap']:>14,.0f}{i['vol24']:>14,.0f}  {i['headline'][:70]}{flag}")
    return "\n".join(out)
