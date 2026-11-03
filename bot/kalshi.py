"""Kalshi bot: weather markets and arbitrage, starting in practice mode (pretend money). Settings: kalshi.yaml.

Kalshi sells YES/NO contracts that pay $1 if they come true; the price is the crowd's probability. This bot only buys
when its own estimate beats the price by more than the fee plus `min_edge`:

- Weather (daily high temperature in US cities): Kalshi settles on the official climate report for one station (e.g.
  Chicago Midway). The bot reads the National Weather Service's forecast and the station's live readings. Later in the
  day part of the answer is already known (the high can't be lower than what was already recorded), so its estimate
  gets sharper as the day goes on, sometimes faster than the market.
- Arbitrage: in a set of brackets where exactly one comes true, if buying YES on all of them costs less than $1 (or NO
  on all of them less than n-1 dollars) after fees, buying the whole set wins no matter what.

Practice mode keeps a pretend account (real prices, real fees, settled by Kalshi's real results) and sends every
practice trade and result to your phone. Live mode needs a Kalshi API key (KALSHI_KEY_ID, KALSHI_PRIVATE_KEY secrets).
"""
from __future__ import annotations

import base64
import json
import logging
import math
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

log = logging.getLogger("kalshi")
BASE = "https://api.elections.kalshi.com"
API = "/trade-api/v2"
NWS = "https://api.weather.gov"
NWS_HEADERS = {"User-Agent": "trading-bot (github.com/yunuhkei/trading-bot)", "Accept": "application/geo+json"}
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


# ---- Kalshi API ----

def kget(path: str, params: dict | None = None) -> dict:
    """Public market data (no key needed)."""
    import requests

    for attempt in range(5):
        r = requests.get(BASE + API + path, params=params, timeout=30)
        if r.status_code != 429:
            break
        time.sleep(3 * 2 ** attempt)      # rate limited: wait 3, 6, 12, 24 s
    r.raise_for_status()
    return r.json()


class Kalshi:
    """Signed requests with your API key (only for live mode)."""

    def __init__(self, key_id: str, private_key_pem: str):
        from cryptography.hazmat.primitives import serialization

        self.key_id = key_id
        self.key = serialization.load_pem_private_key(private_key_pem.replace("\\n", "\n").encode(), password=None)

    @classmethod
    def from_env(cls) -> "Kalshi | None":
        kid, pem = os.environ.get("KALSHI_KEY_ID", "").strip(), os.environ.get("KALSHI_PRIVATE_KEY", "").strip()
        return cls(kid, pem) if kid and pem else None

    def _sign(self, method: str, path: str) -> dict:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ed25519, padding

        ts = str(int(time.time() * 1000))
        msg = (ts + method + API + path.split("?")[0]).encode()
        if isinstance(self.key, ed25519.Ed25519PrivateKey):
            sig = self.key.sign(msg)
        else:
            sig = self.key.sign(msg, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
                                hashes.SHA256())
        return {"KALSHI-ACCESS-KEY": self.key_id, "KALSHI-ACCESS-TIMESTAMP": ts,
                "KALSHI-ACCESS-SIGNATURE": base64.b64encode(sig).decode()}

    def call(self, method: str, path: str, body: dict | None = None, params: dict | None = None) -> dict:
        import requests

        r = requests.request(method, BASE + API + path, json=body, params=params, headers=self._sign(method, path), timeout=30)
        r.raise_for_status()
        return r.json() if r.content else {}

    def balance(self) -> float:
        return self.call("GET", "/portfolio/balance").get("balance", 0) / 100

    def buy(self, ticker: str, side: str, count: int, price: float) -> dict:
        """A limit buy at `price` dollars (never pays more), capped by buy_max_cost."""
        cents = int(round(price * 100))
        body = {"ticker": ticker, "action": "buy", "side": side, "count": int(count), "type": "limit",
                f"{side}_price": cents, "client_order_id": str(uuid.uuid4()), "buy_max_cost": cents * int(count)}
        return self.call("POST", "/portfolio/orders", body).get("order", {})

    def cancel_resting(self):
        for o in self.call("GET", "/portfolio/orders", params={"status": "resting"}).get("orders", []):
            try:
                self.call("DELETE", f"/portfolio/orders/{o['order_id']}")
            except Exception as e:
                log.warning("cancel %s failed: %s", o.get("order_id"), e)


def fee(price: float, count: int = 1, rate: float = 0.07) -> float:
    """Kalshi's trading fee in dollars: rate x contracts x P x (1-P), rounded up to the cent."""
    return math.ceil(rate * count * price * (1 - price) * 100 - 1e-9) / 100


def money(x: float) -> str:
    return f"-${-x:,.2f}" if x < 0 else f"${x:,.2f}"


# ---- Weather: what the bot thinks the high will be ----

def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bracket_prob(m: dict, mu: float, sigma: float, floor_f: float | None = None) -> float:
    """Chance the day's high (a whole °F) lands in this market's bracket, if the high ~ Normal(mu, sigma) and can't be
    below `floor_f` (what was already recorded)."""
    st, lo, hi = m.get("strike_type"), m.get("floor_strike"), m.get("cap_strike")
    a, b = -math.inf, math.inf
    if st == "less":
        b = hi - 0.5                      # "70 or below" (cap 71): high < 71
    elif st == "greater":
        a = lo + 0.5                      # "79 or above" (floor 78): high > 78
    elif st == "between":
        a, b = lo - 0.5, hi + 0.5         # "71 to 72": 71 or 72
    else:
        return math.nan
    z = lambda x: _ncdf((x - mu) / sigma) if math.isfinite(x) else (0.0 if x < 0 else 1.0)
    if floor_f is not None:
        a = max(a, floor_f)
        base = 1 - z(floor_f)
        if base <= 1e-9:
            return 1.0 if a <= mu <= b else 0.0
        return max(0.0, z(b) - z(a)) / base if b > a else 0.0
    return max(0.0, z(b) - z(a))


def event_day(event_ticker: str) -> date | None:
    """KXHIGHCHI-26NOV03 -> 2026-11-03."""
    m = re.search(r"-(\d{2})([A-Z]{3})(\d{2})(?:$|-)", event_ticker)
    return date(2000 + int(m.group(1)), MONTHS[m.group(2)], int(m.group(3))) if m and m.group(2) in MONTHS else None


def station_of(rules: str) -> str | None:
    """'...recorded at Chicago (CLIMDW)...' -> 'KMDW' (US stations only)."""
    m = re.search(r"\(CLI([A-Z]{3})\)", rules or "")
    return "K" + m.group(1) if m else None


def nws_get(url: str, params: dict | None = None) -> dict:
    import requests

    r = requests.get(url, params=params, headers=NWS_HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def station_info(st: str, cache: dict) -> dict:
    if st not in cache:
        s = nws_get(f"{NWS}/stations/{st}")
        lon, lat = s["geometry"]["coordinates"]
        pt = nws_get(f"{NWS}/points/{lat:.4f},{lon:.4f}")["properties"]
        cache[st] = {"tz": s["properties"]["timeZone"], "forecast": pt["forecast"]}
    return cache[st]


def forecast_highs(info: dict) -> dict[str, int]:
    """Date -> forecast high (°F) from the NWS daytime forecast periods."""
    out = {}
    for p in nws_get(info["forecast"])["properties"]["periods"]:
        if p.get("isDaytime") and p.get("temperatureUnit") == "F":
            out.setdefault(p["startTime"][:10], int(p["temperature"]))
    return out


def climate_day(day: date, tz: str) -> tuple[datetime, datetime]:
    """The climate report's day: midnight to midnight local STANDARD time (no daylight saving), in UTC."""
    from zoneinfo import ZoneInfo

    std = ZoneInfo(tz).utcoffset(datetime(day.year, 1, 15))
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - std
    return start, start + timedelta(days=1)


def observed_max_f(st: str, start: datetime, end: datetime) -> tuple[float, bool] | None:
    """(highest reading so far in °F, whether readings are precise to 0.1°C) for the climate day."""
    feats = nws_get(f"{NWS}/stations/{st}/observations", {"start": start.isoformat(), "end": min(end, datetime.now(timezone.utc)).isoformat()})
    vals = [f["properties"]["temperature"]["value"] for f in feats.get("features", [])
            if (f["properties"].get("temperature") or {}).get("value") is not None]
    return (max(vals) * 9 / 5 + 32, any(abs(v - round(v)) > 1e-6 for v in vals)) if vals else None


def weather_view(day: date, info: dict, st: str, now: datetime, fc: dict, obs_cache: dict) -> dict | None:
    """(mu, sigma, floor) for the day's high, or None if it can't tell."""
    from zoneinfo import ZoneInfo

    start, end = climate_day(day, info["tz"])
    if now >= end:
        return None                                   # the day is over: waiting for the official report
    local = now.astimezone(ZoneInfo(info["tz"]))
    f = fc.get(day.isoformat())
    if now < start:                                    # tomorrow: the forecast is all there is
        return {"mu": f, "sigma": 2.5, "floor": None, "why": f"forecast high {f}°"} if f is not None else None
    if st not in obs_cache:
        obs_cache[st] = observed_max_f(st, start, end)
    m, precise = obs_cache[st] or (None, False)
    floor = m - (0.3 if precise else 1.0) if m is not None else None   # whole-°C readings: about ±1°F
    hour = local.hour + local.minute / 60
    if m is not None and (hour >= 17 or f is None or f <= m):
        # Late in the day, or the forecast for the rest of the day is no warmer than what was already recorded
        # (e.g. the high came overnight before a cold front): the high is almost surely in already.
        return {"mu": m, "sigma": 0.8, "floor": floor, "why": f"{m:.0f}° already recorded and it shouldn't get warmer"}
    if f is None:
        return None
    return {"mu": f, "sigma": max(1.2, 2.5 * (17 - hour) / 12), "floor": floor,
            "why": f"forecast high {f}°" + (f", {m:.0f}° recorded so far" if m is not None else "")}


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def weather_ideas(events: list[dict], now: datetime, settings: dict, stations: dict) -> list[dict]:
    """Trades where the bot's estimate beats the price by more than fees + min_edge."""
    min_edge, ideas, obs_cache, fc_cache = float(settings.get("min_edge", 0.10)), [], {}, {}
    max_gap = float(settings.get("max_disagree", 0.30))
    lo_p, hi_p = float(settings.get("min_price", 0.03)), float(settings.get("max_price", 0.97))
    for e in events:
        day, markets = event_day(e["event_ticker"]), e.get("markets") or []
        st = station_of((markets[0] if markets else {}).get("rules_primary", ""))
        if not day or not st:
            continue
        try:
            info = station_info(st, stations)
            if st not in fc_cache:
                fc_cache[st] = forecast_highs(info)
            view = weather_view(day, info, st, now, fc_cache[st], obs_cache)
        except Exception as ex:
            log.warning("weather data for %s failed: %s", st, ex)
            continue
        if not view or view["mu"] is None:
            continue
        for m in markets:
            p = bracket_prob(m, view["mu"], view["sigma"], view["floor"])
            if math.isnan(p):
                continue
            for side, price, size, fair in (("yes", _f(m.get("yes_ask_dollars")), _f(m.get("yes_ask_size_fp")), p),
                                            ("no", _f(m.get("no_ask_dollars")), _f(m.get("no_ask_size_fp")), 1 - p)):
                if not (lo_p <= price <= hi_p) or size < 1:
                    continue
                edge = fair - price - fee(price)
                if edge >= min_edge and fair - price <= max_gap:   # disagreeing by more: the market knows something
                    ideas.append({"kind": "weather", "event": e["event_ticker"], "ticker": m["ticker"], "side": side,
                                  "price": price, "size": size, "fair": fair, "edge": edge,
                                  "title": f"{e.get('title', '').replace('?', '')}: {m.get('yes_sub_title')}",
                                  "why": view["why"]})
    return sorted(ideas, key=lambda i: -i["edge"])


def arb_ideas(events: list[dict], settings: dict) -> list[dict]:
    """Whole sets of brackets that pay more than they cost after fees, whatever happens."""
    out, margin = [], float(settings.get("arb_margin", 0.02))
    for e in events:
        ms = e.get("markets") or []
        if not e.get("mutually_exclusive") or len(ms) < 2:
            continue
        kinds = {m.get("strike_type") for m in ms}
        exhaustive = "less" in kinds and "greater" in kinds          # temperature brackets cover every outcome
        for side, payout in (("yes", 1.0), ("no", len(ms) - 1.0)):
            if side == "yes" and not exhaustive:
                continue
            prices = [_f(m.get(f"{side}_ask_dollars")) for m in ms]
            sizes = [_f(m.get(f"{side}_ask_size_fp")) for m in ms]
            if min(prices) <= 0 or min(sizes) < 1:
                continue
            cost = sum(prices) + sum(fee(p) for p in prices)
            if payout - cost >= margin:
                out.append({"kind": "arbitrage", "event": e["event_ticker"], "side": side, "legs": [m["ticker"] for m in ms],
                            "prices": prices, "cost": cost, "payout": payout, "edge": payout - cost,
                            "count": int(min(sizes)), "title": e.get("title", "").replace("?", "")})
    return sorted(out, key=lambda i: -i["edge"])


# ---- The account (practice or live) and one check ----

def load_settings(path: str = "kalshi.yaml") -> dict:
    return yaml.safe_load(Path(path).read_text()) or {}


def weather_events(state: dict, now: float, budget_s: float = 240) -> list[dict]:
    """Open US daily-high events with their markets. Which series are US cities is learned a few at a time and
    remembered (Kalshi rate-limits hard), and each run stops after `budget_s` seconds with what it has."""
    t0 = time.time()
    if now - state.get("series_t", 0) > 86400 or not state.get("series"):
        ser = kget("/series", {"category": "Climate and Weather"}).get("series", [])
        state["series"] = sorted(s["ticker"] for s in ser if "HIGH" in s["ticker"].upper())
        state["series_t"] = now
    kind = state.setdefault("series_kind", {})               # ticker -> "us" / "other" (and when it was checked)
    unknown = [t for t in state["series"] if t not in kind or (kind[t]["k"] != "us" and now - kind[t]["t"] > 7 * 86400)]
    todo = [t for t in state["series"] if kind.get(t, {}).get("k") == "us"] + unknown[:15]
    events = []
    for t in todo:
        if time.time() - t0 > budget_s:
            log.warning("Kalshi scan stopped after %.0f s (rate limits); the rest next time", budget_s)
            break
        try:
            evs = kget("/events", {"series_ticker": t, "status": "open", "with_nested_markets": "true"}).get("events", [])
        except Exception as e:
            log.warning("events for %s failed: %s", t, e)
            continue
        us = [e for e in evs if station_of(((e.get("markets") or [{}])[0]).get("rules_primary", ""))]
        if us or evs:
            kind[t] = {"k": "us" if us else "other", "t": now}
        elif t not in kind:
            kind[t] = {"k": "other", "t": now - 6 * 86400}     # nothing open: look again tomorrow
        events += us
        time.sleep(1.0)                                         # stay under Kalshi's rate limit
    return events


def step(settings: dict, tell=print, now: float | None = None, events: list[dict] | None = None, client=None) -> str:
    """One check: settle finished trades, then look for weather and arbitrage trades. Returns a one-line status."""
    now = now or time.time()
    mode = settings.get("mode", "practice")
    if mode not in ("practice", "live"):
        return "Off."
    live = mode == "live"
    tag = "" if live else "PRACTICE "
    path = Path(f"kalshi_state_{mode}.json")
    state = json.loads(path.read_text()) if path.exists() else {}
    if live and client is None:
        client = Kalshi.from_env()
        if client is None:
            return "No Kalshi API key yet (KALSHI_KEY_ID and KALSHI_PRIVATE_KEY secrets)."
    if "cash" not in state:
        state["cash"] = client.balance() if live else float(settings.get("practice_cash", 100))
        state["start"] = state["cash"]
        tell(f"{tag}Kalshi bot connected", f"{'Account' if live else 'Pretend account'}: {money(state['cash'])}. "
             f"Weather markets + arbitrage, up to {money(float(settings.get('max_per_trade', 5)))} a trade, only when it's "
             f"{float(settings.get('min_edge', 0.10)) * 100:.0f}¢+ better than the price after fees.")
    positions = state.setdefault("positions", {})
    try:
        # 1) Settle what finished (Kalshi's real result)
        for ticker in list(positions):
            p = positions[ticker]
            try:
                m = kget(f"/markets/{ticker}").get("market", {})
            except Exception as e:
                log.warning("market %s: %s", ticker, e)
                continue
            if m.get("result") in ("yes", "no") and m.get("status") in ("finalized", "settled", "determined"):
                won = m["result"] == p["side"]
                paid = p["count"] * 1.0 if won else 0.0
                state["cash"] += paid
                profit = paid - p["cost"]
                positions.pop(ticker)
                state.setdefault("results", []).append({"t": now, "title": p["title"], "kind": p["kind"], "won": won,
                                                        "profit": profit, "fair": p.get("fair"), "price": p["price"]})
                tell(f"{'✅' if won else '❌'} {tag}Kalshi {'WON' if won else 'LOST'}: {profit:+,.2f}",
                     f"{p['title']} ({p['count']} {p['side'].upper()} at {p['price'] * 100:.0f}¢): settled "
                     f"{m['result'].upper()}. Account {money(state['cash'] + sum(q['cost'] for q in positions.values()))}.")
        # 2) Look for trades
        if events is None:
            events = weather_events(state, now)
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        if state.get("day") != day:
            state.update(day=day, trades_today=0)
        held_events = {p["event"] for p in positions.values()}
        nowdt = datetime.fromtimestamp(now, timezone.utc)
        ideas = arb_ideas(events, settings) + weather_ideas(events, nowdt, settings, state.setdefault("stations", {}))
        bought = 0
        for i in ideas:
            if state["trades_today"] >= int(settings.get("max_trades_per_day", 10)) or bought >= int(settings.get("max_trades_per_check", 3)):
                break
            if i["event"] in held_events:
                continue
            budget = min(float(settings.get("max_per_trade", 5)), state["cash"])
            if i["kind"] == "arbitrage":
                unit = i["cost"]
                count = min(i["count"], int(budget // unit))
                if count < 1:
                    continue
                legs = list(zip(i["legs"], i["prices"]))
            else:
                count = min(int(i["size"]), int(budget // (i["price"] + fee(i["price"]))))
                if count < 1:
                    continue
                legs = [(i["ticker"], i["price"])]
            spent = 0.0
            for ticker, price in legs:
                if live:
                    order = client.buy(ticker, i["side"], count, price)
                    filled = int(order.get("fill_count") or order.get("filled_count") or 0)
                    if filled < 1:
                        continue
                else:
                    filled = count
                cost = filled * price + fee(price, filled)
                spent += cost
                positions[ticker] = {"event": i["event"], "side": i["side"], "count": filled, "price": price, "cost": cost,
                                     "kind": i["kind"], "fair": i.get("fair"), "opened": now,
                                     "title": i["title"] if i["kind"] == "weather" else f"{i['title']} ({ticker.split('-')[-1]})"}
            if live:
                client.cancel_resting()
            if spent <= 0:
                continue
            state["cash"] -= spent
            state["trades_today"] += 1
            bought += 1
            held_events.add(i["event"])
            if i["kind"] == "arbitrage":
                tell(f"🔁 {tag}Kalshi arbitrage: {money(spent)} for a sure {money(count * i['payout'])}",
                     f"{i['title']}: bought {count} {i['side'].upper()} on all {len(legs)} brackets. Whatever happens it pays "
                     f"{money(count * i['payout'])} (profit about {money(count * i['payout'] - spent)} after fees).")
            else:
                tell(f"🎯 {tag}Kalshi: bought {count} {i['side'].upper()} at {i['price'] * 100:.0f}¢ ({money(spent)})",
                     f"{i['title']}. The bot thinks {i['side'].upper()} has a {i['fair']:.0%} chance ({i['why']}); "
                     f"the market says {i['price']:.0%}. Pays {money(count)} if right.")
        held = sum(p["cost"] for p in positions.values())
        return (f"{tag}Kalshi: cash {money(state['cash'])}, {len(positions)} open ({money(held)}), {len(ideas)} ideas, "
                f"bought {bought}.")
    finally:
        state["results"] = state.get("results", [])[-500:]
        path.write_text(json.dumps(state, indent=1, default=str))


def run(settings_path: str = "kalshi.yaml"):
    from .signals import alert_target, notify

    def tell(title, msg):
        log.warning("KALSHI %s: %s", title, msg)
        target = alert_target()
        if target:
            notify(target, title, msg, buy="LOST" not in title)

    print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), step(load_settings(settings_path), tell), flush=True)
