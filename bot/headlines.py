"""News digest for your phone: only the WORST of the newest headlines (war, attacks, disasters, crashes), plus a
RED ALERT if a nuclear weapon has actually been used.

Each run reads the top US, world, business, tech, crypto and war headlines from the last 6 hours, scores how bad each one
is (see SEVERITY), keeps only the bad ones that haven't been sent yet, worst first, skips the same story told by another
outlet, and sends them as one notification. Sent headlines are remembered for 3 days.

Nuclear alert (see nuclear_used): a headline saying a nuclear weapon WAS dropped, fired, hit or exploded, not one that is
threatened, feared, tested, planned, claimed, "considered", "soon?" or talked about. It escalates in STAGES as more
different outlets report it (counted over the last 6 hours), each stage sent once as its own urgent notification:
  1 outlet          ⚠️ NUCLEAR WARNING (unconfirmed)
  2-4 outlets       🚨 RED ALERT
  5-6 outlets       🚨☢️ CONFIRMED RED ALERT   (also needs 2+ major news services: Reuters, AP, BBC...)
  7+ outlets        ⬛ BLACKOUT WARNING         (also needs 3+ major news services)
The major-service rule stops a viral rumor repeated by many small sites from reaching the top stages. The stages reset
after 24 hours with no new reports.
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
    "Nuclear": f"{GOOGLE}/search?q=%22nuclear%20strike%22%20OR%20%22nuclear%20attack%22%20OR%20%22nuclear%20explosion%22%20OR%20"
               f"%22nuclear%20bomb%22%20OR%20nuked%20when:1d&{REGION}",
}
FRESH_HOURS, REMEMBER_DAYS, SAME_STORY = 6, 3, 0.5
WORST = 4                   # a headline must score at least this (see SEVERITY) to be sent: only the crazy stuff
RED = "RED|"                # (older versions) state key prefix for headlines sent as a red alert
NUKE_KEY = "NUKE|"          # state: NUKE|outlet|headline -> when it was first seen
STAGE_KEY = "STAGE|"        # state: STAGE|n -> when stage n was sent
NUKE_WINDOW, NUKE_RESET = 6 * 3600, 24 * 3600
# (stage, outlets needed, major news services needed, title, ntfy tags, what to do)
STAGES = [
    (1, 1, 0, "⚠️ NUCLEAR WARNING (unconfirmed)", "warning",
     "One outlet reports a nuclear weapon was used. NOT confirmed: often a mistake or a rumor. Wait for more sources."),
    (2, 2, 0, "🚨 RED ALERT: nuclear weapon reported used", "rotating_light",
     "More than one outlet now reports it. Still unconfirmed by the big news services: check a trusted source."),
    (3, 5, 2, "🚨☢️ CONFIRMED RED ALERT: nuclear weapon used", "rotating_light,radioactive",
     "Major news services confirm it. Follow official emergency alerts and instructions where you are."),
    (4, 7, 3, "⬛ BLACKOUT WARNING", "black_large_square,radioactive",
     "Widely confirmed. Power, phone and internet outages are possible: charge your phone and devices now, keep water and "
     "a flashlight handy, and follow official emergency alerts."),
]
MAJOR = ("reuters", "associated press", "ap news", "bbc", "cnn", "nbc", "cbs", "abc news", "the new york times",
         "the washington post", "the wall street journal", "bloomberg", "al jazeera", "the guardian", "npr", "fox news",
         "sky news", "financial times", "politico", "axios", "usa today", "los angeles times", "france 24", "dw")

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
                   "what happens,how to,explainer,opinion,analysis,"
                   # speculation, claims and the future (the Nov 2026 false alarm: "Trump to launch nuclear strike...",
                   # "considering a nuclear strike", "pushing toward", "...soon? US commentator makes big claim")
                   "claim*,commentator*,pressur*,push*,urg*,consider*,mull*,weigh*,decid*,decision*,deadline*,soon,"
                   "toward,towards,will,set to,ready to,about to,to launch,to nuke,to strike,to hit,to drop,to use,"
                   "to fire,to attack,to bomb,to be hit,speculat*,alleg*,react*,video,tucker,warned,warns,vows,vow,"
                   "calls for,demand*,suggest*,hint*,bombshell,"
                   # fake or mistaken alerts ("...receive imminent nuclear strike alerts after hackers hit civil defence apps")
                   "imminent,alert,alerts,hack*,app,apps,phishing,scam*,glitch*,mistak*,accident*,error,errors,drill*,false alarm")
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
    return bool(NUKE.search(t) and HAPPENED.search(t) and not NOT_HAPPENED.search(t)) and "?" not in t


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


def is_major(outlet: str) -> bool:
    o = outlet.lower()
    return any(o == m or o.startswith(m + " ") or o.startswith("the " + m) for m in MAJOR)


def nuke_alert(feeds: dict[str, list[dict]], state: dict, now: float | None = None) -> tuple[tuple, list[dict]] | None:
    """Record new reports of a nuclear weapon used; return (stage, reports) if a NEW, higher stage is reached."""
    now = now or time.time()
    if not any(k.startswith(NUKE_KEY) and now - ts <= NUKE_RESET for k, ts in state.items()):
        for k in [k for k in state if k.startswith(STAGE_KEY)]:
            state.pop(k)                                       # a quiet day: start again from no stage
    for i in _fresh(feeds, now):
        key = f"{NUKE_KEY}{(i['outlet'] or '?').replace('|', '/')}|{i['title']}"
        if nuclear_used(i["title"]) and now - state.get(key, 0) > NUKE_RESET:
            state[key] = now
    reports = [{"outlet": k.split("|", 2)[1], "title": k.split("|", 2)[2], "t": ts}
               for k, ts in state.items() if k.startswith(NUKE_KEY) and now - ts <= NUKE_WINDOW]
    outlets = {r["outlet"].lower() for r in reports}
    major = {o for o in outlets if is_major(o)}
    reached = [st for st in STAGES if len(outlets) >= st[1] and len(major) >= st[2]]
    if not reached:
        return None
    top = reached[-1]
    if f"{STAGE_KEY}{top[0]}" in state:
        return None
    for st in reached:
        state.setdefault(f"{STAGE_KEY}{st[0]}", now)            # lower stages count as sent too
    return top, sorted(reports, key=lambda r: (not is_major(r["outlet"]), -r["t"]))


def message(chosen: list[dict]) -> tuple[str, str]:
    title = f"Worst news: {chosen[0]['title'][:70]}" + (f" (+{len(chosen) - 1} more)" if len(chosen) > 1 else "")
    lines = [f"• [{c['section']}] {c['title']}" + (f" ({c['outlet']})" if c["outlet"] else "") for c in chosen]
    return title, "\n".join(lines)


def nuke_message(stage: tuple, reports: list[dict]) -> tuple[str, str]:
    _, _, _, title, _, todo = stage
    outlets = {r["outlet"].lower() for r in reports}
    major = sorted({r["outlet"] for r in reports if is_major(r["outlet"])})
    lines = [todo, f"Reported by {len(outlets)} outlets" + (f", including {', '.join(major[:4])}" if major else "") + ":"]
    seen = set()
    for r in reports:
        if r["outlet"].lower() not in seen and len(seen) < 6:
            seen.add(r["outlet"].lower())
            lines.append(f"• {r['title']} ({r['outlet']})")
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
    alert = nuke_alert(feeds, state, now)
    if alert:
        stage, reports = alert
        title, msg = nuke_message(stage, reports)
        log.warning("NUCLEAR STAGE %s %s | %s", stage[0], title, msg.replace("\n", " | "))
        if target:
            notify(target, title, msg, buy=False, tag=stage[4], priority="high" if stage[0] == 1 else "urgent")
    sent = [t.split("|", 2)[2] if t.startswith(NUKE_KEY) else t[len(RED):] if t.startswith(RED) else t
            for t in state if not t.startswith(STAGE_KEY)]
    chosen = pick(feeds, sent, most)
    if chosen:
        title, msg = message(chosen)
        log.warning("NEWS %s | %s", title, msg.replace("\n", " | "))
        if target:
            notify(target, title, msg, buy=True, tag="newspaper")
        for c in chosen:
            state[c["title"]] = time.time()
    Path(state_path).write_text(json.dumps(state))
    return chosen
