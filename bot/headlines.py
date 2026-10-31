"""News digest for your phone: the newest top headlines (US, world, business, tech, crypto), whether or not they have
anything to do with meme coins.

Each run picks up to a few headlines from the last 6 hours that haven't been sent yet, mixes the sections, skips the
same story told by another outlet, and sends them as one notification. Sent headlines are remembered for 3 days.
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
}
FRESH_HOURS, REMEMBER_DAYS, SAME_STORY = 6, 3, 0.5
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


def pick(feeds: dict[str, list[dict]], sent: list[str], most: int, now: float | None = None) -> list[dict]:
    """Up to `most` new headlines, newest first within each section, taking turns between sections."""
    now = now or time.time()
    queues = {s: sorted((i for i in items if now - i["published"] <= FRESH_HOURS * 3600), key=lambda i: -i["published"])
              for s, items in feeds.items()}
    chosen: list[dict] = []
    while len(chosen) < most and any(queues.values()):
        for section, q in queues.items():
            while q:
                item = q.pop(0)
                if not any(same_story(item["title"], t) for t in sent + [c["title"] for c in chosen]):
                    chosen.append({**item, "section": section})
                    break
            if len(chosen) >= most:
                break
    return chosen


def message(chosen: list[dict]) -> tuple[str, str]:
    title = f"News: {chosen[0]['title'][:70]}" + (f" (+{len(chosen) - 1} more)" if len(chosen) > 1 else "")
    lines = [f"• [{c['section']}] {c['title']}" + (f" ({c['outlet']})" if c["outlet"] else "") for c in chosen]
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
    chosen = pick(feeds, list(state), most)
    if chosen:
        title, msg = message(chosen)
        log.warning("NEWS %s | %s", title, msg.replace("\n", " | "))
        if target:
            notify(target, title, msg, buy=True, tag="newspaper")
        for c in chosen:
            state[c["title"]] = time.time()
    Path(state_path).write_text(json.dumps(state))
    return chosen
