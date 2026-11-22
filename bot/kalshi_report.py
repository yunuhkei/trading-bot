"""A short morning ping with yesterday's Kalshi results: the real account first, then the practice accounts that
matter (the $1,000 ones and G/H/J's $5 ones). Sent once a day after `morning_report_at` (Milwaukee time, default
9:30, when Kalshi has usually paid out the day before), from the saved records only: it reads nothing from Kalshi.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path

from . import kalshi as k

log = logging.getLogger("kalshi_report")
PRACTICE = Path("kalshi_state_practice.json")
BIG = Path("kalshi_state_big.json")
REAL = Path("kalshi_state_real.json")
SENT = Path("kalshi_state_report.json")
SMALL = ("G", "H", "J")                                  # the $5 accounts worth a line


def _load(p: Path) -> dict:
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except (OSError, ValueError):
        return {}


def _day(r: dict) -> date | None:
    e = r.get("event") or (r.get("ticker") or "").rsplit("-", 1)[0]
    return k.event_day(e) if e else None


def line(name: str, results: list[dict], day: date, value: float, start: float | None = None) -> str:
    """'G1000: 6/8 won, +$64.30 → $1,988 (+99%)' for the bets on `day`'s markets."""
    rs = [r for r in results if _day(r) == day and r.get("won") is not None]
    total = f"{k.money(value)}" + (f" ({value / start - 1:+.0%})" if start else "")
    if not rs:
        return f"{name}: no bets → {total}"
    won, p = sum(bool(r["won"]) for r in rs), sum(r["profit"] for r in rs)
    return f"{name}: {won}/{len(rs)} won, {'+' if p >= 0 else '-'}${abs(p):,.2f} → {total}"


def build(day: date, settings: dict) -> tuple[str, str] | None:
    """(title, message) for `day`'s markets, or None if nothing bet on them."""
    from . import kalshi_big as kb
    from . import kalshi_real as kr

    lines, title_bits = [], []
    real = _load(REAL).get("acct")
    if real and kr.config(settings):
        rs = [r for r in real.get("results", []) if _day(r) == day and r.get("won") is not None]
        lines.append("💵 " + line("REAL", real.get("results", []), day, kr.money_now(real)))
        if rs:
            title_bits.append(f"REAL {'+' if sum(r['profit'] for r in rs) >= 0 else '-'}"
                              f"${abs(sum(r['profit'] for r in rs)):,.2f}")
    big, cfg = _load(BIG), kb.config(settings)
    for key in (cfg or {}).get("strategies", []):
        a = big.get(kb.name(key, cfg))
        if a:
            lines.append(line(kb.name(key, cfg), a.get("results", []), day, kb.value(a), float(a.get("start", 1000))))
    small = _load(PRACTICE)
    for key in SMALL:
        a = (small.get("variants") or {}).get(key)
        if a:
            v = a.get("cash", 0.0) + sum(p["cost"] for p in (a.get("positions") or {}).values())
            lines.append(line(f"{key} ($5 bets)", a.get("results", []), day, v))
    if not any("won" in x for x in lines):
        return None
    waiting = sum(1 for a in [real or {}] + [big.get(kb.name(key, cfg)) or {} for key in (cfg or {}).get("strategies", [])]
                  for p in (a.get("positions") or {}).values() if _day(p) == day)
    if waiting:
        lines.append(f"({waiting} bet(s) from that day still waiting on Kalshi to pay out)")
    head = f"📊 Kalshi, {day.strftime('%a %b')} {day.day}" + (": " + ", ".join(title_bits) if title_bits else "")
    return head, "\n".join(lines)


def morning(settings: dict, now: float, tell) -> bool:
    """Send yesterday's report once a day after `morning_report_at`; True if it was sent."""
    if settings.get("morning_report") is False:
        return False
    from .solbot import report_due

    tz = settings.get("timezone", "America/Chicago")
    sent = _load(SENT)
    due = report_due(now, str(settings.get("morning_report_at", "09:30")), tz, sent.get("day"))
    if not due:
        return False
    yesterday = date.fromisoformat(due) - timedelta(days=1)
    msg = build(yesterday, settings)
    SENT.write_text(json.dumps({"day": due}))
    if msg:
        tell(*msg)
    return bool(msg)
