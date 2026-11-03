"""News digest for your phone: only the WORST of the newest headlines (war, attacks, disasters, crashes), plus a
RED ALERT if a nuclear weapon has actually been used.

Each run reads the top US, world, business, tech, crypto and war headlines from the last 6 hours, scores how bad each one
is (see SEVERITY), keeps only the bad ones that haven't been sent yet, worst first, skips the same story told by another
outlet, and sends them as one notification. Sent headlines are remembered for 3 days.

Red alert (see nuclear_used): a headline saying a nuclear weapon was dropped, fired, hit or exploded, not just threatened,
feared, tested or talked about. To avoid a false alarm from one misleading headline, it needs at least 2 different
outlets saying so. It goes out as its own urgent notification, at most once an hour (later headlines still show up in
the normal digest).
"""
from __future__ import annotations

import email.utils
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

log = logging.getLogger("headlines")
GOOGLE = "https://news.google.com/rss"
REGION = "hl=en-US&gl=US&ceid=US:en"
SECTIONS = {
    "Top": f"{GOOGLE}?{REGION}",
    "World": f"{GOOGLE}/headlines/section/topic/WORLD?{REGION}",
    "Business": f"{GOOGLE}/headlines/section/topic/BUSINESS?{REGION}",
    "Tech": f"{GOOGLE}/headlines/section/topic/TECHNOLOGY?{REGION}",
    "Crypto": f"{GOOGLE}/search?q=crypto%20OR%20bitcoin%20when:1d&{REGION}",
    "War": f"{GOOGLE}/search?q=nuclear%20OR%20missile%20OR%20war%20OR%20invasion%20when:1d&{REGION}",
}
FRESH_HOURS, REMEMBER_DAYS, SAME_STORY = 6, 3, 0.5
WORST = 4                   # a headline must score at least this (see SEVERITY) to be sent: only the crazy stuff
RED_OUTLETS = 2             # different outlets that must report a nuclear weapon used before a red alert
RED_COOLDOWN = 3600         # seconds between red alerts
RED = "RED|"                # state key prefix for headlines already sent as a red alert

# How bad a headline is: the points of every pattern it contains, added up. Patterns match the start of a word.
SEVERITY = {
    3: ["world war", "ww3", "wwiii", "nuclear", "nuke", "atomic", "invasion", "invade", "declares war", "martial law",
        "missile", "airstrike", "air strike", "bombing", "bombed", "massacre", "genocide", "terror", "assassinat",
        "coup", "mass shooting", "death toll", "mobiliz"],
    2: ["war", "wars", "attack", "kill", "dead", "deaths", "explosion", "blast", "troops", "shooting", "hostage",
        "earthquake", "hurricane", "tsunami", "wildfire", "evacuat", "emergency", "crash", "collapse", "outbreak",
        "pandemic", "escalat", "retaliat", "sanction", "drone"],
    1: ["plunge", "plummet", "tumble", "recession", "bankrupt", "layoff", "threat", "warns", "crisis", "tension",
        "fear", "injur", "strike"],
}
# Headlines that use scary words about something that isn't (crime blotter, animals, fakes, sports, entertainment).
NOT_WORST = ("home invasion", "kill zone", "toad", "invasive", "species", "fake", "hoax", "video game", "movie", "film",
             "trailer", "box office", "star wars", "episode", "season finale", "nfl", "nba", "mlb", "nhl", "fifa",
             "super bowl", "playoff", "touchdown", "recipe", "review:", "horoscope")
_SEVERITY = [(pts, re.compile(r"\b" + re.escape(w) + (r"\b" if w in ("war", "wars", "dead", "atomic") else "")))
             for pts, words in SEVERITY.items() for w in words]

# Red alert: a nuclear weapon AND something that says it happened, with NO word that makes it a threat, fear, test,
# plan, history lesson or denial. Whole words (with the forms listed), or word starts for the ones ending in *.
def _rx(words: str) -> re.Pattern:
    parts = [re.escape(w[:-1]) + r"\w*" if w.endswith("*") else re.escape(w) for w in words.split(",")]
    return re.compile(r"\b(" + "|".join(parts) + r")\b")


NUKE = re.compile(r"\bnuclear[- ](strike|attack|bomb|blast|explosion|detonation|missile|warhead|weapon)|\bnukes?\b|"
                  r"\batomic bomb|\bmushroom cloud")
HAPPENED = _rx("drop,drops,dropped,detonat*,explod*,explosion,explosions,blast,blasts,hit,hits,struck,launch,launches,"
               "launched,fired,fires,used,uses,strikes on,strike on,attack on,attacked,obliterat*,wiped out,"
               "mushroom cloud,killed,dead,casualties")
NOT_HAPPENED = _rx("threat*,warn*,fear*,risk,risks,could,would,might,may,if,possib*,potential*,plan,plans,planned,"
                   "planning,prepar*,drill,drills,exercise,exercises,simulat*,test,tests,tested,testing,deal,deals,"
                   "talk,talks,treaty,deter*,doctrine,rhetoric,rule out,rules out,ruled out,ready,readiness,capab*,"
                   "no sign,no evidence,deni*,false,fake,hoax,rumor*,rumour*,not,won't,anniversar*,years ago,"
                   "hiroshima,nagasaki,1945,film,movie,oppenheimer,game,games,documentar*,book,museum,plant,plants,"
                   "reactor*,power,energy,facilit*,site,sites,program,programs,programme,enrich*,scenario*,"
                   "what happens,how to,explainer,opinion,analysis")
# Advice and opinion columns that Google files under news sections: not news.
NOT_NEWS = ("column |", "opinion |", "asking eric", "dear abby", "ask amy", "carolyn hax", "miss manners", "dear annie",
            "hints from heloise", "horoscope")


def parse(xml_text: str) -> list[dict]:
    """Headline, outlet and publish time of each item in a Google News feed."""
    out = []
    for item in ET.fromstring(xml_text).iter("item"):
        title = (item.findtext("title") or "").strip()
        outlet = (item.findtext("source") or "").strip()
        if outlet and title.endswith(" - " + outlet):
            title = title[: -len(outlet) - 3]
        try:
            published = email.utils.parsedate_to_datetime(item.findtext("pubDate")).timestamp()
        except (TypeError, ValueError):
            published = time.time()
        if title and not any(x in title.lower() for x in NOT_NEWS):
            out.append({"title": title, "outlet": outlet, "published": published})
    return out


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) > 2}


def same_story(a: str, b: str) -> bool:
    wa, wb = _words(a), _words(b)
    return bool(wa and wb) and len(wa & wb) / min(len(wa), len(wb)) >= SAME_STORY


def severity(title: str) -> int:
    """How bad a headline is (0 = nothing bad)."""
    t = title.lower()
    if any(x in t for x in NOT_WORST):
        return 0
    return sum(pts for pts, rx in _SEVERITY if rx.search(t))


def nuclear_used(title: str) -> bool:
    """True if the headline says a nuclear weapon was actually used (not threatened, feared, tested or discussed)."""
    t = title.lower()
    return bool(NUKE.search(t) and HAPPENED.search(t) and not NOT_HAPPENED.search(t)) and not t.rstrip().endswith("?")


def _fresh(feeds: dict[str, list[dict]], now: float) -> list[dict]:
    return [{**i, "section": s} for s, items in feeds.items() for i in items if now - i["published"] <= FRESH_HOURS * 3600]


def pick(feeds: dict[str, list[dict]], sent: list[str], most: int, now: float | None = None) -> list[dict]:
    """Up to `most` new headlines scoring at least WORST, worst first (newest first on ties), one per story."""
    now = now or time.time()
    items = [{**i, "score": severity(i["title"])} for i in _fresh(feeds, now)]
    items = sorted((i for i in items if i["score"] >= WORST), key=lambda i: (-i["score"], -i["published"]))
    chosen: list[dict] = []
    for item in items:
        if len(chosen) >= most:
            break
        if not any(same_story(item["title"], t) for t in sent + [c["title"] for c in chosen]):
            chosen.append(item)
    return chosen


def red_alert(feeds: dict[str, list[dict]], already: list[str], now: float | None = None) -> list[dict]:
    """New headlines saying a nuclear weapon was used, if at least RED_OUTLETS different outlets say so; else []."""
    now = now or time.time()
    hits = [i for i in _fresh(feeds, now) if nuclear_used(i["title"]) and i["title"] not in already]
    unique: list[dict] = []
    for i in hits:
        if not any(u["title"] == i["title"] and u["outlet"] == i["outlet"] for u in unique):
            unique.append(i)
    outlets = {(i["outlet"] or i["title"]).lower() for i in unique}
    return unique if len(outlets) >= RED_OUTLETS else []


def message(chosen: list[dict]) -> tuple[str, str]:
    title = f"Worst news: {chosen[0]['title'][:70]}" + (f" (+{len(chosen) - 1} more)" if len(chosen) > 1 else "")
    lines = [f"• [{c['section']}] {c['title']}" + (f" ({c['outlet']})" if c["outlet"] else "") for c in chosen]
    return title, "\n".join(lines)


def red_message(hits: list[dict]) -> tuple[str, str]:
    title = "RED ALERT: nuclear weapon reported used"
    lines = [f"• {h['title']}" + (f" ({h['outlet']})" if h["outlet"] else "") for h in hits[:6]]
    lines.append(f"Reported by {len({h['outlet'] for h in hits})} outlets. Check a trusted news source now.")
    return title, "\n".join(lines)


def run(target: str | None, state_path: str = "news_headlines_state.json", most: int = 5) -> list[dict]:
    """Send one digest of new headlines (if any). Returns what was sent."""
    from .signals import notify

    state = json.loads(Path(state_path).read_text()) if Path(state_path).exists() else {}
    cutoff = time.time() - REMEMBER_DAYS * 86400
    state = {t: ts for t, ts in state.items() if ts >= cutoff}
    feeds = {}
    for section, url in SECTIONS.items():
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            r.raise_for_status()
            feeds[section] = parse(r.text)
        except Exception as e:
            log.warning("news feed %s failed: %s", section, e)
    now = time.time()
    red_sent = [t[len(RED):] for t in state if t.startswith(RED)]
    last_red = max((ts for t, ts in state.items() if t.startswith(RED)), default=0)
    hits = red_alert(feeds, red_sent, now) if now - last_red >= RED_COOLDOWN else []
    if hits:
        title, msg = red_message(hits)
        log.warning("RED ALERT %s | %s", title, msg.replace("\n", " | "))
        if target:
            notify(target, title, msg, buy=False, tag="rotating_light", priority="urgent")
        for h in hits:
            state[RED + h["title"]] = now
    chosen = pick(feeds, [t[len(RED):] if t.startswith(RED) else t for t in state], most)
    if chosen:
        title, msg = message(chosen)
        log.warning("NEWS %s | %s", title, msg.replace("\n", " | "))
        if target:
            notify(target, title, msg, buy=True, tag="newspaper")
        for c in chosen:
            state[c["title"]] = time.time()
    Path(state_path).write_text(json.dumps(state))
    return chosen
