"""News matcher for the meme-coin launch watcher.

Pulls headlines and trending searches every few minutes, then flags new coins whose name or symbol
matches something in the news *published before we first saw the coin* (so there's no peeking ahead).
`report` compares how news-matched coins did against all other new coins.
"""
from __future__ import annotations

import email.utils
import hashlib
import logging
import re
import time
import xml.etree.ElementTree as ET

import requests

from .launch_watch import DEXSCREENER, connect, outcomes

log = logging.getLogger("news")

FEEDS = {
    "google_news_top": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    "google_news_world": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en",
    "google_news_entertainment": "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en",
    "google_news_sports": "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en",
    "google_news_tech": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
    "google_news_business": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
    "google_trends_us": "https://trends.google.com/trending/rss?geo=US",
    "google_trends_gb": "https://trends.google.com/trending/rss?geo=GB",
    "bbc_world": "https://feeds.bbci.co.uk/news/world/rss.xml",
}

# Words too common to mean anything when they show up in both a headline and a coin name.
STOP = set("""
a an the and or of to in on at for from by with as is are was were be been it its this that these those he she they
we you i his her their our your not no yes but if then than so up down out over under after before into about new
says said say will would can could may might just more most very also one two three first last year years day days
week time man woman people world news live update today video watch how why what who when where which all any some
coin token sol solana pump fun moon inu meme memecoin crypto official real community the based baby mini super mega
king queen lord god dog cat frog pepe wif bonk usd usdc bot bots app ai gpt agent chain swap finance capital labs
january february march april may june july august september october november december monday tuesday wednesday
thursday friday saturday sunday north south east west street house city state states united national president
minister government police court league cup series game games week price market markets stock stocks report
windows season team player players election elections party""".split())

SCHEMA = """
create table if not exists news (id text primary key, source text, title text, published_at real, fetched_at real);
create table if not exists coin_names (token text primary key, name text, symbol text);
create table if not exists news_matches (token text, news_id text, keyword text, primary key (token, news_id));
"""


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def keywords(title: str) -> set[str]:
    """Distinctive words (4+ letters, not filler) plus joined pairs, e.g. 'lorenzo musetti' -> 'lorenzomusetti'."""
    words = [w for w in re.findall(r"[a-z0-9]+", title.lower())]
    keep = {w for w in words if len(w) >= 4 and w not in STOP and not w.isdigit()}
    pairs = {a + b for a, b in zip(words, words[1:]) if a not in STOP and b not in STOP and len(a + b) >= 6}
    return keep | pairs


def entities(title: str) -> set[str]:
    """Names in a headline: capitalized words that aren't the first word (Trump, Musk, Hormuz), plus joined pairs."""
    raw = re.findall(r"[A-Za-z][A-Za-z0-9]+", title)
    long_words = [w for w in raw[1:] if len(w) >= 4]
    if len(long_words) >= 3 and sum(w[0].isupper() for w in long_words) / len(long_words) > 0.75:
        return set()  # Title Case Headline: capital letters don't tell us what's a name
    caps = [w for i, w in enumerate(raw) if i > 0 and w[0].isupper() and len(w) >= 4 and w.lower() not in STOP]
    pairs = {(a + b).lower() for a, b in zip(raw[1:], raw[2:]) if a[0].isupper() and b[0].isupper()
             and a.lower() not in STOP and b.lower() not in STOP}
    return {w.lower() for w in caps} | pairs


def news_topics(rows) -> dict[str, str]:
    """keyword -> one headline, for words that are real news topics: anything trending on Google,
    or a name capitalized in at least two different headlines. Everyday words don't qualify."""
    counts, example = {}, {}
    for source, title in rows:
        found = keywords(title) if source.startswith("google_trends") else entities(title)
        for kw in found:
            counts[kw] = counts.get(kw, 0) + (2 if source.startswith("google_trends") else 1)
            example.setdefault(kw, title)
    return {kw: example[kw] for kw, n in counts.items() if n >= 2}


def coin_matches(name: str, symbol: str, topics) -> str | None:
    """The news topic this coin is named after, or None. Needs an exact match on the symbol, the full name,
    or one word of a short name, so 'MUSETTI' or 'Lorenzo Musetti' match but 'Musetti Moon Rocket Pump' doesn't."""
    sym, nm = _norm(symbol or ""), _norm(name or "")
    words = [w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if w not in STOP]
    candidates = {sym, nm} | (set(w for w in words if len(w) >= 4) if len(words) <= 2 else set())
    for kw in sorted(topics, key=len, reverse=True):
        if kw in candidates:
            return kw
    return None


def _parse_rss(source: str, xml_text: str):
    root = ET.fromstring(xml_text)
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        if source.startswith("google_news"):
            title = title.rsplit(" - ", 1)[0]  # drop the " - Publisher" suffix
        pub = item.findtext("pubDate")
        try:
            published = email.utils.parsedate_to_datetime(pub).timestamp() if pub else None
        except (TypeError, ValueError):
            published = None
        yield title, published


def fetch_news(db) -> int:
    db.executescript(SCHEMA)
    new, now = 0, time.time()
    for source, url in FEEDS.items():
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            r.raise_for_status()
            items = list(_parse_rss(source, r.text))
        except Exception as e:
            log.warning("feed %s failed: %s", source, e)
            continue
        for title, published in items:
            nid = hashlib.sha1(f"{source}|{title}".encode()).hexdigest()[:16]
            # Trends items show when the search started trending; if a feed gives no date, use when we saw it.
            cur = db.execute("insert or ignore into news values (?,?,?,?,?)", (nid, source, title, published or now, now))
            new += cur.rowcount
    db.commit()
    return new


def fetch_coin_names(db, batch: int = 30) -> int:
    """Look up full names/symbols for coins we haven't named yet (DEX Screener, 30 per request)."""
    db.executescript(SCHEMA)
    todo = [t for (t,) in db.execute("select token from coins where token not in (select token from coin_names)")]
    named = 0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        try:
            pairs = requests.get(DEXSCREENER + ",".join(chunk), timeout=30).json()
        except Exception as e:
            log.warning("name lookup failed: %s", e)
            break
        seen = {}
        for p in pairs:
            seen[p["baseToken"]["address"]] = (p["baseToken"].get("name"), p["baseToken"].get("symbol"))
        for tok in chunk:
            pool_symbol = (db.execute("select name from coins where token=?", (tok,)).fetchone()[0] or "").split(" / ")[0]
            name, symbol = seen.get(tok, (None, None))
            db.execute("insert or replace into coin_names values (?,?,?)", (tok, name or pool_symbol, symbol or pool_symbol))
            named += 1
        db.commit()
        time.sleep(1.2)
    return named


def match_coins(db, window_hours: float = 12) -> list[tuple]:
    """Match every unmatched coin against news topics published in the `window_hours` before we saw it."""
    db.executescript(SCHEMA)
    rows = db.execute("""select c.token, n.name, n.symbol, c.seen_at from coins c join coin_names n on n.token = c.token
                         where c.token not in (select token from news_matches)""").fetchall()
    news = db.execute("select id, source, title, published_at from news order by published_at").fetchall()
    found = []
    for token, name, symbol, seen_at in rows:
        window = [(src, title) for _, src, title, pub in news if seen_at - window_hours * 3600 <= pub <= seen_at]
        topics = news_topics(window)
        kw = coin_matches(name, symbol, topics)
        if kw:
            nid = next(i for i, src, t, pub in news if t == topics[kw])
            db.execute("insert or ignore into news_matches values (?,?,?)", (token, nid, kw))
            found.append((symbol, name, kw, topics[kw]))
    db.commit()
    return found


def run(db_path: str, hours: float, poll_seconds: int = 180):
    """Keep fetching news and matching new coins for `hours`. Logs an ALERT line for each match."""
    db = connect(db_path)
    end = time.time() + hours * 3600
    while time.time() < end:
        n = fetch_news(db)
        fetch_coin_names(db)
        for symbol, name, kw, title in match_coins(db):
            log.info("ALERT  coin %s (%s) matches news keyword '%s': %s", symbol, name, kw, title)
        log.info("news items: +%d (total %d), coins matched so far: %d", n,
                 db.execute("select count(*) from news").fetchone()[0],
                 db.execute("select count(distinct token) from news_matches").fetchone()[0])
        time.sleep(poll_seconds)


def report(db_path: str, round_trip_cost: float = 0.04) -> str:
    db = connect(db_path)
    db.executescript(SCHEMA)
    df = outcomes(db_path, round_trip_cost)
    if df.empty:
        return "No finished checkpoints yet."
    matched = {t for (t,) in db.execute("select distinct token from news_matches")}
    df["group"] = df.token.map(lambda t: "news-matched" if t in matched else "everything else")
    lines = [f"{'held for':<9}{'group':<17}{'coins':>6}{'went up':>9}{'typical':>9}{'avg (EV)':>10}{'lost 90%+':>11}{'2x+':>6}  $1 each →"]
    for label in ["5m", "15m", "1h", "6h", "24h"]:
        for grp in ("news-matched", "everything else"):
            g = df[(df.label == label) & (df.group == grp)]
            if g.empty:
                continue
            n = len(g)
            lines.append(f"{label:<9}{grp:<17}{n:>6}{(g.net > 0).mean():>9.0%}{g.net.median():>+9.0%}{g.net.mean():>+10.0%}"
                         f"{(g.ret <= -0.9).mean():>11.0%}{(g.ret >= 1).mean():>6.0%}  ${n} → ${n * (1 + g.net.mean()):,.0f}")
    ex = db.execute("""select n.symbol, m.keyword, w.title from news_matches m join coin_names n on n.token = m.token
                       join news w on w.id = m.news_id order by m.rowid desc limit 8""").fetchall()
    if ex:
        lines += ["", "Recent matches:"] + [f"  {s} ← '{k}' ← {t[:80]}" for s, k, t in ex]
    return "\n".join(lines)
