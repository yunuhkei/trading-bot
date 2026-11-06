"""Meme-coin callouts: who is hyping which Solana coin right now, and what happened to the price after.

Sources (all public, no keys):
- boost: projects that just PAID DEX Screener to boost their coin (latest and most-boosted lists)
- profile: projects that just paid for a DEX Screener profile
- cto: "community takeovers" listed on DEX Screener
- trending: GeckoTerminal's trending Solana pools
- tg:<name>: public Telegram call channels you list in callouts.yaml (read from t.me/s/<name>, coin addresses in posts)

Each check records every new coin called out, its price when the bot first saw the callout (the earliest you could have
bought), and its price about 1 h, 6 h and 24 h later. Before a ping, the purpose check (vet): RED flags that it's set up
to dump on buyers (rug check, insider wallets, the creator still holding 5%+, an unlocked pool, a pump that already
happened, a sell-off, under 300 holders, a pool under 2% of the market cap) mean no ping; GREEN flags of a real project (a working website,
X, a community chat, code or docs, still trading after 3+ days, 1,000+ holders) are listed with the ping. The report (Sundays, and `python -m bot callouts --report`) says
which sources' callouts actually went up, after ~2% buying and selling costs. Phone pings: a coin called out by 2+
DIFFERENT sources within 6 hours that has $20k+ in its pool and passes RugCheck, with how such callouts have done so far.

A callout is NOT a buy signal: many are paid promotions, and whoever paid often sells into the buying it brings. The
record is what tells you whether a source is early or just the exit.
"""
from __future__ import annotations

import html as htmllib
import json
import logging
import re
import statistics
import time
from pathlib import Path

import requests
import yaml

log = logging.getLogger("callouts")
STATE = Path("callouts_state.json")
HORIZONS = {"1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600}
COST = 0.02                                # buying + selling, roughly (fees and price impact on a small buy)
DEAD_LIQ = 1000.0                          # a pool under $1k: treat the coin as dead (worth nothing)
MINT = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
UA = {"User-Agent": "Mozilla/5.0 (compatible; trading-bot)"}
DEFAULTS = {"telegram": [], "min_liquidity": 20000, "ping_sources": 2, "max_pings": 3, "together_hours": 6,
            "report_days": ["Sunday"], "report_at": "17:00", "timezone": "America/Chicago"}


def load_settings(path: str = "callouts.yaml") -> dict:
    p = Path(path)
    return {**DEFAULTS, **((yaml.safe_load(p.read_text()) or {}) if p.exists() else {})}


# ---- Sources: (mint, source, note) ----

def dex_list(url: str, source: str) -> list[tuple[str, str, str]]:
    d = requests.get(url, timeout=20, headers=UA).json()
    return [(x["tokenAddress"], source, (x.get("description") or "")[:80]) for x in d or []
            if x.get("chainId") == "solana" and x.get("tokenAddress")]


def gecko_trending() -> list[tuple[str, str, str]]:
    d = requests.get("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools", timeout=20, headers=UA).json()
    out = []
    for p in d.get("data") or []:
        tid = ((p.get("relationships") or {}).get("base_token") or {}).get("data", {}).get("id", "")
        if tid.startswith("solana_"):
            out.append((tid[len("solana_"):], "trending", (p.get("attributes") or {}).get("name", "")))
    return out


SKIP = {"So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}   # SOL, USDC


def telegram(channel: str, since: float) -> list[tuple[str, str, str]]:
    """Coin addresses in a public Telegram channel's recent posts (newer than `since`)."""
    page = requests.get(f"https://t.me/s/{channel}", timeout=20, headers=UA).text
    out = []
    for block in page.split('class="tgme_widget_message ')[1:]:
        m = re.search(r'<time datetime="([^"]+)"', block)
        if not m:
            continue
        from datetime import datetime
        t = datetime.fromisoformat(m.group(1)).timestamp()
        if t < since:
            continue
        text = htmllib.unescape(re.sub(r"<[^>]+>", " ", block))
        for mint in dict.fromkeys(MINT.findall(text)):
            if mint not in SKIP and not mint.isdigit():
                out.append((mint, f"tg:{channel}", " ".join(text.split())[:80]))
    return out


def gather(settings: dict, since: float) -> list[tuple[str, str, str]]:
    found = []
    jobs = [(dex_list, ("https://api.dexscreener.com/token-boosts/latest/v1", "boost")),
            (dex_list, ("https://api.dexscreener.com/token-boosts/top/v1", "boost")),
            (dex_list, ("https://api.dexscreener.com/token-profiles/latest/v1", "profile")),
            (dex_list, ("https://api.dexscreener.com/community-takeovers/latest/v1", "cto")),
            (gecko_trending, ())]
    jobs += [(telegram, (str(c).lstrip("@").split("/")[-1], since)) for c in settings.get("telegram") or []]
    for fn, args in jobs:
        try:
            found += fn(*args)
        except Exception as e:
            log.warning("callout source %s %s failed: %s", fn.__name__, args[1] if fn is dex_list else args[:1], e)
    return found


# ---- One check ----

def prices(mints: list[str]) -> dict[str, dict]:
    from .solbot import dex_info

    return dex_info(mints)


def check(state: dict, settings: dict, now: float, tell=None, sources=None, price_of=prices, safe=None) -> dict:
    """Record new callouts, fill in the 1 h / 6 h / 24 h prices that are due, ping the strongest new ones."""
    seen = state.setdefault("seen", {})
    since = state.get("last", now - 3600)
    calls = sources if sources is not None else gather(settings, since)
    new = [m for m in dict.fromkeys(m for m, _, _ in calls) if m not in seen]
    info = price_of(new) if new else {}
    for mint, source, note in calls:
        if mint in seen:
            seen[mint]["sources"].setdefault(source, now)
            continue
        i = info.get(mint)
        if not i or not i.get("price"):
            continue                                          # no pool to buy from (yet)
        seen[mint] = {"t": now, "price": i["price"], "liq": i["liq"], "mcap": i["mcap"], "age_h": round(i["age_h"], 1),
                      "symbol": i["symbol"], "name": i["name"], "sources": {source: now}, "note": note, "later": {}}
    due = [m for m, c in seen.items() if any(h not in c["later"] and now - c["t"] >= s for h, s in HORIZONS.items())]
    later = price_of(due) if due else {}
    for m in due:
        c, i = seen[m], later.get(m)
        for h, s in HORIZONS.items():
            if h in c["later"] or now - c["t"] < s:
                continue
            value = 0.0 if not i or i["liq"] < DEAD_LIQ else i["price"]
            c["later"][h] = [round(now - c["t"]), value]
    pings = strongest(state, settings, now, safe)
    if tell:
        for c, why in pings:
            tell(f"📣 Callout: {c['symbol'] or c['name']} ({len(c['sources'])} sources)", why)
    # finished coins (24 h price in) go to the record; it keeps the last 5,000
    record = state.setdefault("record", [])
    for m in [m for m, c in seen.items() if "24h" in c["later"]]:
        c = seen.pop(m)
        record.append({"mint": m, "t": c["t"], "sources": sorted(c["sources"]), "price": c["price"], "later": c["later"],
                       "vet": c.get("vet")})
    state["record"] = record[-5000:]
    state["last"] = now
    return state


def returns(c: dict, h: str) -> float | None:
    """The return bought at the first callout and sold at horizon `h`, after costs (None if checked too late to count:
    over 1.5x the horizon + 30 min)."""
    got = (c.get("later") or {}).get(h)
    if not got or not c.get("price") or got[0] > 1.5 * HORIZONS[h] + 1800:
        return None
    return got[1] / c["price"] * (1 - COST) - 1


def scoreboard(state: dict) -> dict[str, dict]:
    """Per source (and for coins called by 2+ sources): how its callouts did at each horizon."""
    every = list(state.get("record", [])) + [{"sources": sorted(c["sources"]), **c} for c in state.get("seen", {}).values()]
    groups: dict[str, list] = {}
    for c in every:
        for s in c["sources"]:
            groups.setdefault(s, []).append(c)
        if len(set(c["sources"])) >= 2:
            groups.setdefault("2+ sources", []).append(c)
            v = c.get("vet")
            if v:                     # did the purpose check pick better coins?
                groups.setdefault("2+ sources, red flags" if v["red"] else "2+ sources, no red flags", []).append(c)
                if not v["red"]:
                    groups.setdefault("2+ sources, no red flags, purpose 3+" if v["score"] >= 3 else
                                      "2+ sources, no red flags, purpose 0-2", []).append(c)
    out = {}
    for g, cs in groups.items():
        row = {"n": len(cs)}
        for h in HORIZONS:
            rs = [r for r in (returns(c, h) for c in cs) if r is not None]
            if rs:
                row[h] = {"n": len(rs), "median": statistics.median(rs), "avg": sum(rs) / len(rs),
                          "up": sum(r > 0 for r in rs) / len(rs), "doubled": sum(r >= 1 for r in rs) / len(rs),
                          "halved": sum(r <= -0.5 for r in rs) / len(rs)}
        out[g] = row
    return out


def record_line(row: dict, h: str = "6h") -> str:
    r = row.get(h)
    if not r:
        return "no record yet"
    return (f"{h} later: typical {r['median']:+.0%}, average {r['avg']:+.0%}, {r['up']:.0%} went up, {r['doubled']:.0%} "
            f"doubled, {r['halved']:.0%} lost half or more ({r['n']} coins)")


# ---- The purpose check: is there a real project here, or does it look set up to dump on buyers? ----

def site_loads(url: str) -> bool:
    """A real website: it answers, and has some actual text (not a blank page, a link list or a social profile)."""
    if any(x in url for x in ("x.com", "twitter.com", "t.me", "linktr.ee", "discord.", "pump.fun", "dexscreener.")):
        return False
    try:
        r = requests.get(url, timeout=8, headers=UA)
    except Exception:
        return False
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", r.text or "")))
    return r.status_code == 200 and len(text.strip()) >= 300


def vet(mint: str, rug: dict | None = None, pair: dict | None = None, loads=site_loads) -> dict:
    """Red flags (it looks set up to dump on buyers: no ping) and green flags (a real project footprint), from RugCheck
    and DEX Screener. It can't prove a coin has a purpose, scammers make websites too, but a coin with insiders, a
    creator still holding a big bag, an unlocked pool or a pump that already happened is a bad place to arrive late."""
    from .solbot import RUGCHECK, safety_check

    red, green = [], []
    try:
        rug = rug if rug is not None else requests.get(RUGCHECK.format(mint), timeout=20).json()
        ok, why = safety_check(mint, 0.20, 0.50, report=rug)
        if not ok:
            red.append(why)
    except Exception as e:
        return {"red": [f"the rug check couldn't run ({str(e)[:50]})"], "green": [], "score": 0, "desc": ""}
    if pair is None:
        try:
            pairs = requests.get(f"https://api.dexscreener.com/tokens/v1/solana/{mint}", timeout=20, headers=UA).json() or []
            pair = max(pairs, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0)) if pairs else {}
        except Exception:
            pair = {}
    # red flags
    insiders = int(rug.get("graphInsidersDetected") or 0)
    holders = int(rug.get("totalHolders") or 0)
    insider_pct = sum(float(h.get("pct") or 0) for h in rug.get("topHolders") or [] if h.get("insider"))
    # linked "insider" wallets: a bundled launch on a small coin (a big coin always has some, as a sliver of its holders)
    if insider_pct >= 10 or (insiders >= 5 and insiders > 0.02 * max(holders, 1)):
        red.append(f"insider wallets ({insiders} linked" + (f", holding {insider_pct:.0f}%" if insider_pct else "") + ")")
    supply = float((rug.get("token") or {}).get("supply") or 0)
    creator = float(rug.get("creatorBalance") or 0) / supply if supply else 0.0
    if creator >= 0.05:
        red.append(f"its creator still holds {creator:.0%}")
    locked = [float((m.get("lp") or {}).get("lpLockedPct") or 0) for m in rug.get("markets") or []]
    if locked and max(locked) < 90:
        red.append(f"the pool's money isn't locked ({max(locked):.0f}% locked): it can be pulled")
    ch = pair.get("priceChange") or {}
    if float(ch.get("h1") or 0) > 100 or float(ch.get("h6") or 0) > 300:
        red.append(f"it already pumped ({float(ch.get('h1') or 0):+.0f}% in 1 h, {float(ch.get('h6') or 0):+.0f}% in 6 h)")
    h1 = (pair.get("txns") or {}).get("h1") or {}
    if int(h1.get("sells") or 0) > 2 * max(1, int(h1.get("buys") or 0)) and int(h1.get("sells") or 0) >= 20:
        red.append(f"it's being sold off ({h1.get('sells')} sells vs {h1.get('buys')} buys in the last hour)")
    if holders and holders < 300:
        red.append(f"only {holders} holders")
    liq, mcap = float((pair.get("liquidity") or {}).get("usd") or 0), float(pair.get("marketCap") or pair.get("fdv") or 0)
    if mcap and liq and liq < 0.02 * mcap and mcap < 50_000_000:          # big coins trade in many places
        red.append(f"a thin pool (${liq:,.0f} behind a ${mcap:,.0f} market cap): easy to crash")
    # green flags: a real project footprint
    info = pair.get("info") or {}
    sites = [w.get("url", "") for w in info.get("websites") or []]
    socials = {(x.get("type") or "").lower(): x.get("url", "") for x in info.get("socials") or []}
    if any(loads(u) for u in sites[:2]):
        green.append("a working website")
    if socials.get("twitter") or socials.get("x"):
        green.append("an X account")
    if socials.get("telegram") or socials.get("discord"):
        green.append("a community chat")
    if any("github.com" in u or "docs" in u or "gitbook" in u or "whitepaper" in u for u in sites + list(socials.values())):
        green.append("code or docs")
    age_d = (time.time() * 1000 - float(pair.get("pairCreatedAt") or time.time() * 1000)) / 8.64e7
    if age_d >= 3 and float((pair.get("volume") or {}).get("h24") or 0) >= 10_000:
        green.append(f"still trading after {age_d:.0f} days")
    if holders >= 1000:
        green.append(f"{holders:,} holders")
    return {"red": red, "green": green, "score": len(green), "desc": (info.get("description") or "")[:120]}


def vet_line(v: dict) -> str:
    g = ", ".join(v["green"]) if v["green"] else "nothing"
    return (f"Purpose check {v['score']}/6: {g}" + (f". It says: \"{v['desc']}\"" if v.get("desc") else "")
            + (" (no real project footprint: pure speculation)" if v["score"] <= 1 else ""))


def strongest(state: dict, settings: dict, now: float, safe=None) -> list[tuple[dict, str]]:
    """New coins called out by `ping_sources`+ different sources within `together_hours`, with enough pool money and
    a clean RugCheck; at most `max_pings`, each coin once."""
    check_coin = safe or vet
    board, out = scoreboard(state), []
    for m, c in state.get("seen", {}).items():
        times = sorted(c["sources"].values())
        if (c.get("pinged") or len(c["sources"]) < int(settings["ping_sources"])
                or times[-1] - times[0] > float(settings["together_hours"]) * 3600 or now - times[-1] > 3600
                or c["liq"] < float(settings["min_liquidity"])):
            continue
        try:
            v = check_coin(m)
        except Exception as e:
            v = {"red": [f"the checks failed ({str(e)[:50]})"], "green": [], "score": 0, "desc": ""}
        c["pinged"], c["vet"] = now, {"red": v["red"], "score": v["score"]}
        if v["red"] or v["score"] < int(settings.get("min_purpose", 0)):
            log.warning("callout %s skipped: %s", c["symbol"], "; ".join(v["red"]) or f"purpose {v['score']}/6")
            continue
        row = board.get("2+ sources, no red flags") or board.get("2+ sources", {})
        out.append((c, f"{c['name']} ({c['symbol']}) is being called out by {', '.join(sorted(c['sources']))}. "
                       f"Price ${c['price']:.6g}, pool ${c['liq']:,.0f}, market cap ${c['mcap']:,.0f}, "
                       f"{c['age_h']:.0f} h old. No red flags (rug check, insiders, creator's bag, locked pool, "
                       f"already pumped, sell-off). {vet_line(v)}. Callouts like this so far: {record_line(row)}. "
                       f"A callout is not a buy signal: promoters often sell into the buying. "
                       f"https://dexscreener.com/solana/{m}"))
        if len(out) >= int(settings["max_pings"]):
            break
    return out


def report_text(state: dict) -> str:
    board = scoreboard(state)
    if not board:
        return "📣 Callouts: nothing recorded yet."
    lines = ["📣 Callout scoreboard (bought at the first callout the bot saw, after ~2% costs):"]
    for g, row in sorted(board.items(), key=lambda kv: -kv[1]["n"]):
        lines.append(f"• {g} ({row['n']} coins): {record_line(row, '1h')}; {record_line(row, '6h')}; "
                     f"{record_line(row, '24h')}")
    lines.append("A source is worth following only if its typical coin goes UP after the callout, week after week.")
    return "\n".join(lines)


def run(settings_path: str = "callouts.yaml", report: bool = False):
    from .signals import alert_target, notify
    from .solbot import report_due

    settings = load_settings(settings_path)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    target = alert_target()
    tell = (lambda t, m: notify(target, t, m, buy=True, tag="loudspeaker")) if target else (lambda t, m: print(t, m))
    now = time.time()
    if report:
        print(report_text(state))
        return
    check(state, settings, now, tell)
    due = report_due(now, settings["report_at"], settings["timezone"], state.get("report_day"), settings["report_days"])
    if due:
        state["report_day"] = due
        text = report_text(state)
        tell("📣 Callout scoreboard", text[:3500])
    STATE.write_text(json.dumps(state))
    print(f"callouts: {len(state.get('seen', {}))} coins being tracked, {len(state.get('record', []))} finished", flush=True)
