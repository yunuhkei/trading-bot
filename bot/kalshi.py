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
    """Chance the official high (a whole °F) lands in this market's bracket. The high is modeled as max(floor, R) with
    R ~ Normal(mu, sigma): it can't end below what was already recorded (`floor_f`), and R is what the rest of the
    day brings."""
    st, lo, hi = m.get("strike_type"), m.get("floor_strike"), m.get("cap_strike")
    if st == "less":
        a, b = -math.inf, hi - 0.5             # "70 or below" (cap 71): high < 71
    elif st == "greater":
        a, b = lo + 0.5, math.inf              # "79 or above" (floor 78): high > 78
    elif st == "between":
        a, b = lo - 0.5, hi + 0.5              # "71 to 72": 71 or 72
    else:
        return math.nan

    def below(x: float) -> float:              # P(high <= x)
        if not math.isfinite(x):
            return 0.0 if x < 0 else 1.0
        if floor_f is not None and x < floor_f:
            return 0.0
        return _ncdf((x - mu) / sigma)
    return max(0.0, below(b) - below(a))


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
    if st not in cache or "state" not in cache[st]:
        s = nws_get(f"{NWS}/stations/{st}")
        lon, lat = s["geometry"]["coordinates"]
        pt = nws_get(f"{NWS}/points/{lat:.4f},{lon:.4f}")["properties"]
        cache[st] = {"tz": s["properties"]["timeZone"], "forecast": pt["forecast"], "lat": lat, "lon": lon,
                     "state": ((pt.get("relativeLocation") or {}).get("properties") or {}).get("state", "")}
    return cache[st]


def forecast_highs(info: dict) -> dict[str, int]:
    """Date -> forecast high (°F) from the NWS daytime forecast periods."""
    out = {}
    for p in nws_get(info["forecast"])["properties"]["periods"]:
        if p.get("isDaytime") and p.get("temperatureUnit") == "F":
            out.setdefault(p["startTime"][:10], int(p["temperature"]))
    return out


# Weather models from Open-Meteo (free, no key): European, American (GFS, HRRR, National Blend), German, Canadian.
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
MODELS = ["ecmwf_ifs025", "gfs_seamless", "gfs_hrrr", "ncep_nbm_conus", "icon_seamless", "gem_seamless"]
SAFE_MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless", "gem_seamless"]


def model_forecasts(info: dict) -> dict:
    """{"daily": {date: {model: high °F}}, "hourly": [[unix time, {model: °F}], ...]} from several weather models."""
    import requests
    from zoneinfo import ZoneInfo

    for models in (MODELS, SAFE_MODELS):
        r = requests.get(OPEN_METEO, params={"latitude": info["lat"], "longitude": info["lon"], "daily": "temperature_2m_max",
                                             "hourly": "temperature_2m", "temperature_unit": "fahrenheit", "timezone": info["tz"],
                                             "timeformat": "unixtime", "forecast_days": 3, "models": ",".join(models)}, timeout=30)
        if r.status_code != 400:                       # 400 = a model it doesn't offer: try the safe list
            break
    r.raise_for_status()
    d, tz = r.json(), ZoneInfo(info["tz"])

    def by_model(block: dict, var: str) -> dict:
        return {(k[len(var) + 1:] or "best_match") if k != var else "best_match": v for k, v in block.items() if k.startswith(var)}
    daily = {}
    for model, vals in by_model(d.get("daily", {}), "temperature_2m_max").items():
        for t, v in zip(d["daily"]["time"], vals):
            if v is not None:
                daily.setdefault(datetime.fromtimestamp(t, tz).date().isoformat(), {})[model] = v
    hourly = {}
    for model, vals in by_model(d.get("hourly", {}), "temperature_2m").items():
        for t, v in zip(d["hourly"]["time"], vals):
            if v is not None:
                hourly.setdefault(t, {})[model] = v
    return {"daily": daily, "hourly": sorted([t, v] for t, v in hourly.items())}


IEM = "https://mesonet.agron.iastate.edu/api/1"


def iem_today_max(st: str, info: dict) -> tuple[float, str] | None:
    """(the station's high so far today in °F, its local date) from the Iowa Environmental Mesonet: whole °F like the
    official climate report, from every reading including the 6-hour highs."""
    import requests

    r = requests.get(f"{IEM}/currents.json", params={"station": st[1:], "network": f"{info['state']}_ASOS"}, timeout=20)
    r.raise_for_status()
    row = (r.json().get("data") or [{}])[0]
    return (float(row["max_tmpf"]), str(row.get("local_date") or row.get("local_valid", ""))[:10]) if row.get("max_tmpf") is not None else None


def iem_day_max(st: str, info: dict, day: str) -> float | None:
    """The station's high for a finished day (to grade the forecasts)."""
    import requests

    r = requests.get(f"{IEM}/daily.json", params={"station": st[1:], "network": f"{info['state']}_ASOS", "date": day}, timeout=20)
    r.raise_for_status()
    row = (r.json().get("data") or [{}])[0]
    return float(row["max_tmpf"]) if row.get("max_tmpf") is not None else None


def climate_day(day: date, tz: str) -> tuple[datetime, datetime]:
    """The climate report's day: midnight to midnight local STANDARD time (no daylight saving), in UTC."""
    from zoneinfo import ZoneInfo

    std = ZoneInfo(tz).utcoffset(datetime(day.year, 1, 15))
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - std
    return start, start + timedelta(days=1)


def observed_max_f(st: str, start: datetime, end: datetime) -> tuple[float, bool] | None:
    """(highest NWS reading so far in °F, whether readings are precise to 0.1°C) for the climate day (backup source)."""
    feats = nws_get(f"{NWS}/stations/{st}/observations", {"start": start.isoformat(), "end": min(end, datetime.now(timezone.utc)).isoformat()})
    vals = [f["properties"]["temperature"]["value"] for f in feats.get("features", [])
            if (f["properties"].get("temperature") or {}).get("value") is not None]
    return (max(vals) * 9 / 5 + 32, any(abs(v - round(v)) > 1e-6 for v in vals)) if vals else None


PRIOR = {"d1": 2.0, "d0": 1.8}     # typical forecast error (°F) before the bot has graded any: tomorrow, this morning


_PRIORS: dict | None = None


def city_prior(st: str | None, horizon: str) -> tuple[float, float, int]:
    """(bias, typical error, days) measured by the backtest for this station (models/kalshi_priors.json), for
    day-ahead forecasts; else no bias and the default error."""
    global _PRIORS
    if _PRIORS is None:
        try:
            _PRIORS = json.loads(Path("models/kalshi_priors.json").read_text())
        except (OSError, ValueError):
            _PRIORS = {}
    p = _PRIORS.get(st or "", {})
    if horizon == "d1" and p.get("n", 0) >= 5:
        return float(p["bias"]), max(1.0, float(p["err"])), int(p["n"])
    return 0.0, PRIOR[horizon], 0


def learned(calib: dict, horizon: str, st: str | None = None) -> tuple[float, float, int]:
    """(bias, typical error, graded days) for a station: what its forecasts got wrong before, blended with the prior
    (the backtest's measurement for this city if there is one) until there are enough graded days."""
    pb, pe, pn = city_prior(st, horizon)
    w = min(pn, 10) if pn else 5                          # how much the prior counts, in days
    errs = calib.get(horizon, [])
    n = len(errs)
    if not n:
        return pb, pe, pn
    bias = sum(errs) / n
    rmse = math.sqrt(sum(e * e for e in errs) / n)
    return (n * bias + w * pb) / (n + w), math.sqrt((n * rmse ** 2 + w * pe ** 2) / (n + w)), n + pn


def weather_view(day: date, info: dict, st: str, now: datetime, fc: dict, obs_cache: dict,
                 models: dict | None = None, calib: dict | None = None) -> dict | None:
    """(mu, sigma, floor, why) for the day's official high: max(already recorded, rest of the day), or None."""
    from statistics import mean, pstdev
    from zoneinfo import ZoneInfo

    start, end = climate_day(day, info["tz"])
    if now >= end:
        return None                                   # the day is over: waiting for the official report
    d, models, calib = day.isoformat(), models or {}, calib or {}
    nws = fc.get(d)
    daily = [v for v in [nws, *models.get("daily", {}).get(d, {}).values()] if v is not None]
    if now < start:                                    # tomorrow: the forecasts are all there is
        if not daily:
            return None
        bias, err, n = learned(calib, "d1", st)
        avg, spread = mean(daily), pstdev(daily) if len(daily) > 1 else 0.0
        return {"mu": avg + bias, "sigma": max(err, spread), "floor": None, "avg": avg,
                "why": f"{len(daily)} forecast{'s' if len(daily) > 1 else ''} average {avg:.0f}°" + (f" (spread {spread:.1f}°)" if spread else "")
                       + (f", corrected {bias:+.1f}° from {n} graded days" if n and abs(bias) >= 0.3 else "")}
    m, precise = obs_cache.get(st) or (None, False)
    floor = (m if precise else m - 0.9) if m is not None else None
    local = now.astimezone(ZoneInfo(info["tz"]))
    hour = local.hour + local.minute / 60
    # The rest of the day: the warmest hour each model still expects before midnight (standard time).
    rest = {}
    for t, temps in models.get("hourly", []):
        if now.timestamp() <= t < end.timestamp():
            for model, v in temps.items():
                rest[model] = max(rest.get(model, -999), v)
    bias, err, n = learned(calib, "d0")
    if rest:
        vals = list(rest.values())
        mu, spread, src = mean(vals) + bias, pstdev(vals) if len(vals) > 1 else 0.0, f"{len(vals)} models"
    elif daily and hour < 15:
        mu, spread, src = mean(daily) + bias, pstdev(daily) if len(daily) > 1 else 0.0, f"{len(daily)} forecast{'s' if len(daily) > 1 else ''}"
    elif m is not None:
        mu, spread, src = m - 2.0, 0.0, "late in the day"   # no forecast left: it shouldn't get warmer
    else:
        return None
    left = max(0.0, 17 - hour) / 9                    # how much of the warm part of the day is left (1 = all of it)
    sigma = max(0.8, err * left, spread)
    why = f"{src}: warmest still to come {mu:.0f}°" if rest or (daily and hour < 15) else src
    if m is not None:
        why += f", {m:.0f}° already recorded"
    return {"mu": mu, "sigma": sigma, "floor": floor, "avg": mean(daily) if daily else None, "why": why}


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def grade_forecasts(state: dict, now: datetime, limit: int = 10):
    """Self-learning: for finished days, compare the logged forecasts with the station's real high (IEM) and keep
    each station's errors, so `learned` can correct its bias and how sure it is."""
    logs, stations, done = state.setdefault("fc_log", {}), state.get("stations", {}), 0
    for st, days in logs.items():
        info = stations.get(st)
        for d in list(days):
            if done >= limit or not info:
                return
            _, end = climate_day(date.fromisoformat(d), info["tz"])
            if now < end + timedelta(hours=3):
                continue
            try:
                actual = iem_day_max(st, info, d)
            except Exception as e:
                log.warning("grading %s %s failed: %s", st, d, e)
                continue
            done += 1
            if actual is not None:
                cal = state.setdefault("calib", {}).setdefault(st, {})
                for horizon, forecast in days[d].items():
                    cal.setdefault(horizon, []).append(round(actual - forecast, 2))
                    cal[horizon] = cal[horizon][-40:]
            days.pop(d)


def weather_views(events: list[dict], now: datetime, state: dict) -> list[tuple[dict, dict]]:
    """(event, the bot's view of its high) for every weather event it can read. Gathers the forecasts, models and
    station readings once, for every strategy to use."""
    from zoneinfo import ZoneInfo

    out, obs_cache, fc_cache = [], {}, {}
    stations, mcache = state.setdefault("stations", {}), state.setdefault("models", {})
    for e in events:
        day, markets = event_day(e["event_ticker"]), e.get("markets") or []
        st = station_of((markets[0] if markets else {}).get("rules_primary", ""))
        if not day or not st:
            continue
        try:
            info = station_info(st, stations)
            if st not in fc_cache:
                fc_cache[st] = forecast_highs(info)
            if now.timestamp() - mcache.get(st, {}).get("t", 0) > 3600:      # models update hourly at most
                try:
                    mcache[st] = {"t": now.timestamp(), "data": model_forecasts(info)}
                except Exception as ex:
                    log.warning("weather models for %s failed (using NWS only): %s", st, ex)
                    old = mcache.get(st, {}).get("data") or {}
                    mcache[st] = {"t": now.timestamp() - 3000, "data": old}          # try again in 10 minutes
            start, end = climate_day(day, info["tz"])
            if start <= now < end and st not in obs_cache:
                got = None
                try:
                    iem = iem_today_max(st, info)
                    local_day = now.astimezone(ZoneInfo(info["tz"])).date().isoformat()
                    if iem and iem[1] == local_day:
                        got = (iem[0], True)
                except Exception as ex:
                    log.warning("IEM for %s failed: %s", st, ex)
                obs_cache[st] = got or observed_max_f(st, start, end)
            view = weather_view(day, info, st, now, fc_cache[st], obs_cache, mcache.get(st, {}).get("data"),
                                state.get("calib", {}).get(st))
        except Exception as ex:
            log.warning("weather data for %s failed: %s", st, ex)
            continue
        if not view or view["mu"] is None:
            continue
        # Log the forecast once per horizon (tomorrow / this morning) so the day can be graded when it's over.
        local_hour = now.astimezone(ZoneInfo(info["tz"])).hour
        horizon = "d1" if now < start else "d0" if local_hour < 10 else None
        if horizon and view.get("avg") is not None:
            state.setdefault("fc_log", {}).setdefault(st, {}).setdefault(day.isoformat(), {}).setdefault(horizon, round(view["avg"], 2))
        view["late"] = start <= now and local_hour >= 15 and view.get("floor") is not None   # today, the high mostly in
        out.append((e, view))
    return out


# The strategies tested side by side (each with its own practice account); kalshi.yaml can change them.
STRATEGIES = {
    "A": {"label": "Current", "rules": {}},
    "B": {"label": "Cautious", "rules": {"sigma_mult": 1.5, "min_edge": 0.15}},
    "C": {"label": "Favorites", "rules": {"min_price": 0.60, "max_price": 0.95, "min_edge": 0.05}},
    "D": {"label": "Late-day sure things", "rules": {"when": "late", "min_price": 0.50, "min_edge": 0.04}},
    "E": {"label": "Fade long shots", "rules": {"side": "no", "min_price": 0.80, "min_edge": 0.04}},
}


def ideas_from_views(views: list[tuple[dict, dict]], rules: dict) -> list[dict]:
    """The trades one strategy would make: its chance beats the price by `min_edge` after fees, within its rules."""
    min_edge, max_gap = float(rules.get("min_edge", 0.10)), float(rules.get("max_disagree", 0.30))
    lo_p, hi_p = float(rules.get("min_price", 0.10)), float(rules.get("max_price", 0.97))
    mult, only_side = float(rules.get("sigma_mult", 1.0)), rules.get("side")
    ideas = []
    for e, view in views:
        if rules.get("when") == "late" and not view.get("late"):
            continue
        for m in e.get("markets") or []:
            p = bracket_prob(m, view["mu"], view["sigma"] * mult, view["floor"])
            if math.isnan(p):
                continue
            for side, price, size, fair in (("yes", _f(m.get("yes_ask_dollars")), _f(m.get("yes_ask_size_fp")), p),
                                            ("no", _f(m.get("no_ask_dollars")), _f(m.get("no_ask_size_fp")), 1 - p)):
                if (only_side and side != only_side) or not (lo_p <= price <= hi_p) or size < 1:
                    continue
                edge = fair - price - fee(price)
                if edge >= min_edge and fair - price <= max_gap:   # disagreeing by more: the market knows something
                    ideas.append({"kind": "weather", "event": e["event_ticker"], "ticker": m["ticker"], "side": side,
                                  "price": price, "size": size, "fair": fair, "edge": edge,
                                  "title": f"{e.get('title', '').replace('?', '')}: {m.get('yes_sub_title')}",
                                  "why": view["why"]})
    return sorted(ideas, key=lambda i: -i["edge"])


def weather_ideas(events: list[dict], now: datetime, settings: dict, state: dict) -> list[dict]:
    """The main strategy's weather trades (see ideas_from_views)."""
    return ideas_from_views(weather_views(events, now, state), settings)


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


def strategies(settings: dict) -> dict:
    out = {k: {"label": v["label"], "rules": dict(v["rules"])} for k, v in STRATEGIES.items()}
    for k, v in (settings.get("strategies") or {}).items():
        out[k] = {"label": v.get("label", k), "rules": dict(v.get("rules") or {})}
    base = {k: settings[k] for k in ("min_edge", "min_price", "max_price", "max_disagree") if k in settings}
    for k, v in out.items():
        v["rules"] = {**base, **v["rules"]} if k == "A" else {**{kk: vv for kk, vv in base.items() if kk == "max_disagree"}, **v["rules"]}
    return out


def settle(acct: dict, tell, tag: str, now: float, cache: dict, label: str = "") -> None:
    """Pay out finished positions with Kalshi's real result."""
    positions = acct.setdefault("positions", {})
    for ticker in list(positions):
        p = positions[ticker]
        if ticker not in cache:
            try:
                cache[ticker] = kget(f"/markets/{ticker}").get("market", {})
            except Exception as e:
                log.warning("market %s: %s", ticker, e)
                continue
        m = cache[ticker]
        if m.get("result") in ("yes", "no") and m.get("status") in ("finalized", "settled", "determined"):
            won = m["result"] == p["side"]
            paid = p["count"] * 1.0 if won else 0.0
            acct["cash"] += paid
            profit = paid - p["cost"]
            positions.pop(ticker)
            acct.setdefault("results", []).append({"t": now, "title": p["title"], "kind": p["kind"], "won": won,
                                                   "profit": profit, "fair": p.get("fair"), "price": p["price"]})
            tell(f"{'✅' if won else '❌'} {tag}Kalshi {'WON' if won else 'LOST'}: {profit:+,.2f}",
                 f"{label}{p['title']} ({p['count']} {p['side'].upper()} at {p['price'] * 100:.0f}¢): settled "
                 f"{m['result'].upper()}. Account {money(acct['cash'] + sum(q['cost'] for q in positions.values()))}.")


def trade(acct: dict, ideas: list[dict], settings: dict, tell, tag: str, now: float, live: bool = False, client=None) -> int:
    """Buy the best ideas within the limits; returns how many trades it made."""
    positions = acct.setdefault("positions", {})
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if acct.get("day") != day:
        acct.update(day=day, trades_today=0)
    held_events, bought = {p["event"] for p in positions.values()}, 0
    for i in ideas:
        if acct["trades_today"] >= int(settings.get("max_trades_per_day", 10)) or bought >= int(settings.get("max_trades_per_check", 3)):
            break
        if i["event"] in held_events:
            continue
        budget = min(float(settings.get("max_per_trade", 5)), acct["cash"])
        if i["kind"] == "arbitrage":
            count = min(i["count"], int(budget // i["cost"]))
            legs = list(zip(i["legs"], i["prices"]))
        else:
            count = min(int(i["size"]), int(budget // (i["price"] + fee(i["price"]))))
            legs = [(i["ticker"], i["price"])]
        if count < 1:
            continue
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
        acct["cash"] -= spent
        acct["trades_today"] += 1
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
    return bought


def scoreboard(state: dict, strats: dict) -> tuple[str, str]:
    """Each strategy's record: settled trades, wins, profit, and open bets."""
    lines, best = [], None
    for k, v in strats.items():
        acct = state if k == "A" else state.get("variants", {}).get(k, {})
        res = acct.get("results", [])
        start = acct.get("start", 100.0)
        value = acct.get("cash", start) + sum(p["cost"] for p in acct.get("positions", {}).values())
        wins = sum(r["won"] for r in res)
        lines.append(f"{k}. {v['label']}: {len(res)} settled, {wins}-{len(res) - wins}, "
                     f"{sum(r['profit'] for r in res):+,.2f} | {len(acct.get('positions', {}))} open | account {money(value)}")
        if res and (best is None or value > best[1]):
            best = (f"{k}. {v['label']}", value)
    return ("📊 Kalshi scoreboard" + (f": {best[0]} leads" if best else ""),
            "Practice accounts, $100 each, same markets, different rules:\n" + "\n".join(lines))


def step(settings: dict, tell=print, now: float | None = None, events: list[dict] | None = None, client=None) -> str:
    """One check: settle finished trades, then let every strategy look for trades with its own account. The main
    strategy (A) pings your phone; the others trade quietly and show up in the Thursday scoreboard."""
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
    cash0 = float(settings.get("practice_cash", 100))
    if "cash" not in state:
        state["cash"] = client.balance() if live else cash0
        state["start"] = state["cash"]
        tell(f"{tag}Kalshi bot connected", f"{'Account' if live else 'Pretend account'}: {money(state['cash'])}. "
             f"Weather markets + arbitrage, up to {money(float(settings.get('max_per_trade', 5)))} a trade, only when it's "
             f"{float(settings.get('min_edge', 0.10)) * 100:.0f}¢+ better than the price after fees.")
    strats = strategies(settings)
    quiet = lambda t, m: log.warning("KALSHI (quiet) %s: %s", t, m)
    try:
        cache: dict = {}
        settle(state, tell, tag, now, cache)
        for k in strats:
            if k != "A":
                acct = state.setdefault("variants", {}).setdefault(k, {"cash": cash0, "start": cash0, "positions": {}})
                settle(acct, quiet, "PRACTICE ", now, cache, f"[{k}] ")
        if events is None:
            events = weather_events(state, now)
        nowdt = datetime.fromtimestamp(now, timezone.utc)
        try:
            grade_forecasts(state, nowdt)
        except Exception as e:
            log.warning("grading failed: %s", e)
        views = weather_views(events, nowdt, state)
        bought, summary = 0, []
        for k, v in strats.items():
            ideas = ideas_from_views(views, v["rules"])
            if k == "A":
                ideas = arb_ideas(events, settings) + ideas
                bought = trade(state, ideas, settings, tell, tag, now, live, client)
            else:
                n = trade(state["variants"][k], ideas, settings, quiet, "PRACTICE ", now)
                summary.append(f"{k}:{n}")
        due = None
        try:
            from .solbot import report_due
            due = report_due(now, settings.get("report_at", "15:00"), settings.get("timezone", "America/Chicago"),
                             state.get("report_day"), settings.get("report_days", ["Thursday"]))
        except Exception as e:
            log.warning("report check failed: %s", e)
        if due:
            state["report_day"] = due
            tell(*scoreboard(state, strats))
        held = sum(p["cost"] for p in state.get("positions", {}).values())
        mc = state.get("models", {})
        with_models = sum(1 for v in mc.values() if (v.get("data") or {}).get("daily"))
        graded = sum(len(v.get("d1", [])) + len(v.get("d0", [])) for v in state.get("calib", {}).values())
        return (f"{tag}Kalshi: cash {money(state['cash'])}, {len(state.get('positions', {}))} open ({money(held)}), "
                f"bought {bought}; other strategies bought {' '.join(summary)}. Weather models for {with_models}/{len(mc)} "
                f"cities; {graded} forecasts graded so far.")
    finally:
        state["results"] = state.get("results", [])[-500:]
        for v in state.get("variants", {}).values():
            v["results"] = v.get("results", [])[-500:]
        path.write_text(json.dumps(state, indent=1, default=str))


def run(settings_path: str = "kalshi.yaml"):
    from .signals import alert_target, notify

    def tell(title, msg):
        log.warning("KALSHI %s: %s", title, msg)
        target = alert_target()
        if target:
            notify(target, title, msg, buy="LOST" not in title)

    print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), step(load_settings(settings_path), tell), flush=True)
