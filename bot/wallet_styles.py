"""What strategy is each smart wallet using, and when does each strategy work? (python -m bot wallet-styles)

1. Each followed wallet's own record: every coin it bought and later sold over its last ~4 months on the blockchain
   (the same reads the finder's scoring uses), with when and what it made, minus 2% for what copying costs.
2. For each buy, the coin's 5-minute price chart around it (GeckoTerminal) and its pool (DEX Screener): how old the
   coin was, how far it had moved in the hour and the 6 hours before, and how big it was.
3. Every buy gets a STYLE (the same rule the copy-trader uses when it copies a buy, from DEX Screener's numbers):
   - launch sniper: the coin was under 1 hour old (or still on its launch curve, before its real pool existed)
   - dip buyer:     it had fallen 15%+ in the hour, or 30%+ in 6 hours, before the buy
   - pump chaser:   it had risen 20%+ in the hour, or 50%+ in 6 hours
   - quiet buyer:   none of those (bought a coin that wasn't moving much)
   and every round trip a HOLD: flips (under 15 min), hours (15 min to 6 h) or days (6 h+).
4. Each wallet's profile: its mix of styles, how long it holds, what copying it made, its best style and time of day.
5. The playbook: every trade from every wallet, plus the copy practice's own trades once they carry a style, grouped
   by style x time of day (Milwaukee time) and by weekday x time of day. A cell says GO or AVOID only with 20+ trades
   on 8+ different coins and 90%+ confidence, otherwise "not sure yet". The confidence reshuffles whole COINS, not
   single trades, so one coin's big run (many trades on the same coin) can't make a cell look sure, and the trades
   must come from 4+ different days, so one good (or bad) day can't either.
6. Days: every trade also gets the market's mood when it was bought (SOL's move over the 24 hours before, from
   Coinbase), and each calendar day gets its own result, so the report shows whether bad days come in a pattern
   (a weekday, a falling market) before any rule is made from it. It is re-built every other Sunday, so it
   keeps up with whatever the wallets do next.
Saved to models/wallet_styles.json and sent to your phone. Real-money copying skips AVOID cells only when
solbot.yaml copytrade.live.playbook is true. Practice copies everything, so the playbook keeps learning.
"""
from __future__ import annotations

import datetime
import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("wallet_styles")
OUT = Path("models/wallet_styles.json")
TZ = "America/Chicago"
STYLES = ("launch sniper", "dip buyer", "pump chaser", "quiet buyer")
HOLDS = ("flips (under 15 min)", "holds hours", "holds days")
SLOTS = (("overnight", 23, 5), ("morning", 5, 11), ("midday", 11, 17), ("evening", 17, 23))
SLOT_HOURS = {"overnight": "11pm-5am", "morning": "5-11am", "midday": "11am-5pm", "evening": "5-11pm"}
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
COPY_COST = 0.02            # what copying loses per round trip (the finder's scoring uses the same)
MIN_CELL, MIN_COINS, MIN_DAYS, MIN_SURE = 20, 8, 4, 0.9     # 90%: many cells are judged at once, so 80% would call some by luck
MAX_TRIPS = 150             # round trips per wallet that get a chart read, spread over as many days as possible
WALLET_TX = 3000            # transactions read per wallet (busy wallets make ~300 a day, so this is about 10 days)
MAX_CHARTS = 450            # GeckoTerminal reads per run (its free feed allows about 30 a minute)


def entry_style(age_h: float | None, ch1: float | None, ch6: float | None) -> str:
    """The style of one buy. age_h: how old the coin's pool was (negative = before it existed); ch1/ch6: its price
    change over the hour / 6 hours before (0.2 = +20%)."""
    if age_h is not None and age_h < 1:
        return "launch sniper"
    ch1, ch6 = ch1 or 0.0, ch6 or 0.0
    if ch1 <= -0.15 or ch6 <= -0.30:
        return "dip buyer"
    if ch1 >= 0.20 or ch6 >= 0.50:
        return "pump chaser"
    return "quiet buyer"


def hold_style(minutes: float) -> str:
    return HOLDS[0] if minutes < 15 else HOLDS[1] if minutes < 360 else HOLDS[2]


def slot_of(t: float, tz: str = TZ) -> str:
    from zoneinfo import ZoneInfo

    h = datetime.datetime.fromtimestamp(t, ZoneInfo(tz)).hour
    return next(n for n, s, e in SLOTS if ((s <= h < e) if s < e else (h >= s or h < e)))


def date_of(t: float, tz: str = TZ) -> str:
    from zoneinfo import ZoneInfo

    return datetime.datetime.fromtimestamp(t, ZoneInfo(tz)).strftime("%Y-%m-%d")


def day_of(t: float, tz: str = TZ) -> str:
    from zoneinfo import ZoneInfo

    return DAYS[datetime.datetime.fromtimestamp(t, ZoneInfo(tz)).weekday()]


def style_from_dex(info: dict | None) -> str | None:
    """The style of a buy happening right now, from DEX Screener's numbers (what the copy-trader sees)."""
    if not info:
        return None
    return entry_style(info.get("age_h"), float(info.get("h1") or 0) / 100, float(info.get("h6") or 0) / 100)


# ---- Reading the past: each wallet's round trips, and the coin's chart at each buy -----------------------------------

def chart(pool: str, before: float) -> pd.DataFrame:
    """Up to ~3.5 days of 5-minute candles (USD) for a pool, ending at `before` (unix time)."""
    import requests

    for attempt in range(5):
        r = requests.get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/minute",
                         params={"aggregate": 5, "limit": 1000, "before_timestamp": int(before), "currency": "usd",
                                 "token": "base"},
                         headers={"Accept": "application/json;version=20230302"}, timeout=30)
        time.sleep(2.2)
        if r.status_code != 429:
            break
        time.sleep(15 * (attempt + 1))
    if r.status_code == 404:
        return pd.DataFrame(columns=["close", "high"])
    r.raise_for_status()
    rows = r.json()["data"]["attributes"]["ohlcv_list"]
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "volume"]).astype(float)
    return df.set_index("t").sort_index()


def at(df: pd.DataFrame, t: float) -> tuple[float | None, float | None, float | None]:
    """(price at t, change over the hour before, change over the 6 hours before) from 5-minute candles."""
    if df is None or df.empty or t < df.index[0] or t > df.index[-1] + 600:
        return None, None, None
    close = df["close"]

    def price(x):
        s = close[close.index <= x]
        return float(s.iloc[-1]) if len(s) and x >= close.index[0] else None
    now = price(t)
    if not now:
        return None, None, None
    then1, then6 = price(t - 3600), price(t - 6 * 3600)
    return now, (now / then1 - 1 if then1 else None), (now / then6 - 1 if then6 else None)


def enrich(wallet: str, trips: list[tuple], coins: dict, charts) -> list[dict]:
    """One row per round trip (buy time, sell time, return, mint): its style, hold, time of day and result."""
    rows = []
    for t0, t1, ret, mint in trips:
        info = coins.get(mint) or {}
        created = info.get("created")
        age_h = (t0 - created) / 3600 if created else None
        now, ch1, ch6 = at(charts(mint, t0), t0) if info.get("pool") else (None, None, None)
        mcap = info["mcap"] * now / info["price"] if now and info.get("mcap") and info.get("price") else None
        rows.append({"wallet": wallet, "mint": mint, "symbol": info.get("symbol") or mint[:6], "t": t0, "sold": t1,
                     "ret": ret - COPY_COST, "hold_min": (t1 - t0) / 60, "age_h": age_h, "ch1": ch1, "ch6": ch6,
                     "mcap": mcap, "style": entry_style(age_h, ch1, ch6), "hold": hold_style((t1 - t0) / 60),
                     "slot": slot_of(t0), "day": day_of(t0), "date": date_of(t0), "source": "wallet"})
    return rows


class Charts:
    """5-minute charts per coin, read once per stretch of time and reused for the coin's other buys."""

    def __init__(self, coins: dict, read=chart, limit: int = MAX_CHARTS):
        self.coins, self.read, self.left, self.cache = coins, read, limit, {}

    def __call__(self, mint: str, t: float) -> pd.DataFrame | None:
        for df in self.cache.get(mint, []):
            if len(df) and df.index[0] <= t - 6 * 3600 and t <= df.index[-1] + 600:
                return df
        if self.left <= 0 or not (self.coins.get(mint) or {}).get("pool"):
            return None
        self.left -= 1
        try:
            df = self.read(self.coins[mint]["pool"], t + 2 * 86400)      # this buy, plus the next ~2 days of buys
        except Exception as e:
            log.warning("chart %s: %s", mint[:6], e)
            return None
        self.cache.setdefault(mint, []).append(df)
        return df


# ---- Grading ----------------------------------------------------------------------------------------------------------

def grade(rets, coins=None, rng=None, days=None) -> dict:
    """n, won, avg (after copy costs) and a verdict: GO / AVOID only with MIN_CELL+ trades on MIN_COINS+ coins over
    MIN_DAYS+ days and MIN_SURE confidence. The confidence resamples whole coins (all of a coin's trades together)."""
    r = np.asarray(list(rets), float)
    if not len(r):
        return {"n": 0}
    rng = rng or np.random.default_rng(0)
    coins = np.asarray(list(coins) if coins is not None else range(len(r)))
    names, idx = np.unique(coins, return_inverse=True)
    sums, counts = np.bincount(idx, r, len(names)), np.bincount(idx, minlength=len(names)).astype(float)
    pick = rng.integers(0, len(names), (2000, len(names)))
    means = sums[pick].sum(axis=1) / counts[pick].sum(axis=1)
    up = float((means > 0).mean())
    n_days = len(set(days)) if days is not None else MIN_DAYS
    enough = len(r) >= MIN_CELL and len(names) >= MIN_COINS and n_days >= MIN_DAYS
    verdict = ("GO" if up >= MIN_SURE else "AVOID" if up <= 1 - MIN_SURE else "not sure yet") if enough else "not sure yet"
    return {"n": int(len(r)), "coins": int(len(names)), "days": int(n_days), "won": float((r > 0).mean()),
            "avg": float(r.mean()), "median": float(np.median(r)), "sum": float(r.sum()), "sure_up": up,
            "verdict": verdict}


def profile(rows: list[dict]) -> dict:
    """How one wallet trades."""
    d = pd.DataFrame(rows)
    mix = d["style"].value_counts(normalize=True)
    best = {}
    for key in ("style", "slot"):
        g = d.groupby(key)["ret"].agg(["mean", "size"])
        g = g[g["size"] >= 5]
        if len(g):
            k = g["mean"].idxmax()
            best[key] = {"name": k, "avg": float(g.loc[k, "mean"]), "n": int(g.loc[k, "size"])}
    return {"trades": len(d), "coins": int(d["mint"].nunique()), "main_style": str(mix.index[0]),
            "mix": {k: float(v) for k, v in mix.items()}, "hold_min": float(d["hold_min"].median()),
            "hold": hold_style(float(d["hold_min"].median())), "won": float((d["ret"] > 0).mean()),
            "avg": float(d["ret"].mean()), "best": best,
            "charted": float(d["ch1"].notna().mean())}


def playbook(rows: list[dict]) -> dict:
    d = pd.DataFrame(rows)
    out = {"by_style_slot": {}, "by_day_slot": {}, "by_style": {}, "by_slot": {}, "by_hold": {}, "by_mood": {},
           "by_date": {}}
    if d.empty:
        return out
    if "date" not in d:
        d["date"] = d["t"].map(date_of)
    d["date"] = d["date"].fillna(d["t"].map(date_of))
    rng = np.random.default_rng(0)
    g = lambda mask: grade(d[mask]["ret"], d[mask]["mint"], rng, d[mask]["date"])
    for s in STYLES:
        out["by_style"][s] = g(d["style"] == s)
        for n, _, _ in SLOTS:
            out["by_style_slot"][f"{s}|{n}"] = g((d["style"] == s) & (d["slot"] == n))
    for n, _, _ in SLOTS:
        out["by_slot"][n] = g(d["slot"] == n)
        for day in DAYS:
            out["by_day_slot"][f"{day}|{n}"] = g((d["day"] == day) & (d["slot"] == n))
    for h in HOLDS:
        out["by_hold"][h] = g(d["hold"] == h)
    if "sol24" in d:
        sol = pd.to_numeric(d["sol24"], errors="coerce")
        out["by_mood"] = {"SOL up": g(sol > 0), "SOL down": g(sol <= 0)}
    for day in sorted(d["date"].unique()):
        out["by_date"][day] = g(d["date"] == day)
    # Each wallet's own record by style and time of day: a copier following that wallet judges its buys by these
    # (its own history), not by the other wallets' (one wallet's overnight dip buys can lose while another's win).
    out["by_wallet"] = {}
    if "wallet" in d:
        for w in d["wallet"].dropna().unique():
            mine = d["wallet"] == w
            out["by_wallet"][w] = {f"{s}|{n}": g(mine & (d["style"] == s) & (d["slot"] == n))
                                   for s in STYLES for n, _, _ in SLOTS
                                   if (mine & (d["style"] == s) & (d["slot"] == n)).any()}
    return out


def practice_rows(state: dict) -> list[dict]:
    """The copy practice's own finished trades that were tagged with a style when bought (real copy results)."""
    rows, open_buys = [], {}
    for t in state.get("trades", []):
        if t["action"] == "BUY":
            open_buys[t["what"]] = t
        elif t["action"] == "SELL" and t["what"] in open_buys:
            b = open_buys.pop(t["what"])
            if b.get("style"):
                rows.append({"wallet": b.get("wallet"), "mint": b.get("mint") or t["what"], "symbol": t["what"],
                             "t": b["t"], "sold": t["t"], "ret": t["result"], "hold_min": (t["t"] - b["t"]) / 60,
                             "style": b["style"], "hold": hold_style((t["t"] - b["t"]) / 60), "slot": slot_of(b["t"]),
                             "day": day_of(b["t"]), "date": date_of(b["t"]), "sol24": b.get("sol24"),
                             "source": "practice"})
    return rows


def verdict(style: str | None, t: float, book: dict | None = None, wallet: str | None = None) -> str:
    """The playbook's call on copying a buy of this style now: GO, AVOID or "not sure yet". With `wallet`, a wallet that
    has its own record in the playbook is judged only by that record (its other cells don't count against it)."""
    if book is None:
        try:
            book = json.loads(OUT.read_text()).get("playbook") or {}
        except (OSError, ValueError):
            return "not sure yet"
    if not style:
        return "not sure yet"
    cells = (book.get("by_wallet") or {}).get(wallet) if wallet else None
    if cells is None:
        cells = book.get("by_style_slot") or {}
    return (cells.get(f"{style}|{slot_of(t)}") or {}).get("verdict", "not sure yet")


# ---- The market's mood: SOL's move over the 24 hours before a buy ----------------------------------------------------

def sol_hourly(start: float, end: float) -> pd.Series:
    """SOL's hourly closing price (Coinbase, no key) from `start` to `end`."""
    import requests

    out, t = [], start - 2 * 86400
    while t < end:
        e = min(t + 300 * 3600, end)
        iso = lambda x: datetime.datetime.fromtimestamp(x, datetime.timezone.utc).isoformat()
        r = requests.get("https://api.exchange.coinbase.com/products/SOL-USD/candles",
                         params={"granularity": 3600, "start": iso(t), "end": iso(e)}, timeout=30)
        r.raise_for_status()
        out += r.json()
        t = e
        time.sleep(0.4)
    s = pd.Series({float(row[0]): float(row[4]) for row in out})
    return s.sort_index()


def sol_change(sol: pd.Series | None, t: float, hours: float = 24) -> float | None:
    if sol is None or sol.empty:
        return None
    now, then = sol[sol.index <= t], sol[sol.index <= t - hours * 3600]
    return float(now.iloc[-1] / then.iloc[-1] - 1) if len(now) and len(then) else None


_MOOD: dict = {}


def market_mood(now: float | None = None) -> float | None:
    """SOL's move over the last 24 hours (0.05 = +5%), from DEX Screener, looked up at most every 10 minutes."""
    from .copytrade import QUOTES
    from .solbot import dex_info

    now = now or time.time()
    if now - _MOOD.get("t", 0) > 600:
        try:
            sol = next(m for m in QUOTES if m.startswith("So1"))
            _MOOD.update(t=now, sol24=float((dex_info([sol]).get(sol) or {})["h24"]) / 100)
        except Exception as e:
            log.warning("market mood: %s", e)
            _MOOD.update(t=now, sol24=None)
    return _MOOD.get("sol24")


def spread(trips: list[tuple], n: int) -> list[tuple]:
    """Up to n round trips, taken from as many different days as possible (newest first within each day)."""
    by_day: dict[str, list] = {}
    for x in sorted(trips, key=lambda x: -x[0]):
        by_day.setdefault(date_of(x[0]), []).append(x)
    days, out = sorted(by_day, reverse=True), []
    while len(out) < n and any(by_day.values()):
        for d in days:
            if by_day[d] and len(out) < n:
                out.append(by_day[d].pop(0))
    return sorted(out, key=lambda x: -x[0])


# ---- The run (every other Sunday, and by hand) ------------------------------------------------------------------------

def build(wallets: list[str], trades_of=None, coin_info=None, read_chart=chart, practice: dict | None = None,
          sol=None) -> dict:
    from .smart_wallets import round_trips, wallet_trades
    from .solbot import dex_info

    trades_of = trades_of or (lambda w: wallet_trades(w, 120, WALLET_TX))
    coin_info = coin_info or dex_info
    trips = {}
    for w in wallets:
        try:
            trips[w] = spread(round_trips(trades_of(w)), MAX_TRIPS)
        except Exception as e:
            log.warning("record %s: %s", w[:6], e)
    mints = sorted({m for ts in trips.values() for *_, m in ts})
    coins = coin_info(mints) if mints else {}
    charts = Charts(coins, read_chart)
    times = [x[0] for ts in trips.values() for x in ts]
    if sol is None and times:
        try:
            sol = sol_hourly(min(times), max(times))
        except Exception as e:
            log.warning("SOL prices: %s", e)
    rows, profiles = [], {}
    for w, ts in trips.items():
        mine = enrich(w, ts, coins, charts)
        for r in mine:
            r["sol24"] = sol_change(sol, r["t"])
        if mine:
            profiles[w] = profile(mine)
            rows += mine
    mine_practice = practice_rows(practice or {})
    return {"updated": time.time(), "wallets": profiles, "playbook": playbook(rows + mine_practice),
            "practice_playbook": playbook(mine_practice), "trades": len(rows), "practice_trades": len(mine_practice),
            "charts_read": MAX_CHARTS - charts.left,
            "rows": [{k: (round(v, 5) if isinstance(v, float) else v) for k, v in r.items()} for r in rows[-1500:]]}


def _pct(x):
    return f"{x:+.1%}" if x is not None else "?"


def report_text(res: dict, live_on: bool = False) -> str:
    """The every-other-Sunday phone report, in plain words."""
    dates = sorted({r.get("date") or date_of(r["t"]) for r in res.get("rows", [])})
    span = f" ({dates[0]} to {dates[-1]}, trades on {len(dates)} different days)" if dates else ""
    lines = [f"Read {res['trades']} finished trades from {len(res['wallets'])} smart wallets{span}"
             + (f" + {res['practice_trades']} copy-practice trades" if res.get("practice_trades") else "")
             + ". Results are after 2% copying costs.", "", "HOW EACH WALLET TRADES:"]
    for w, p in sorted(res["wallets"].items(), key=lambda kv: -kv[1]["avg"] * kv[1]["trades"]):
        best = p.get("best", {})
        extra = "; best: " + ", ".join(f"{b['name']} {_pct(b['avg'])} ({b['n']})" for b in best.values()) if best else ""
        lines.append(f"• {w[:4]}…{w[-4:]}: mostly {p['main_style'].upper()} ({p['mix'][p['main_style']]:.0%}), "
                     f"{p['hold']} (median {p['hold_min']:.0f} min). {p['trades']} trades on {p['coins']} coin{'s' * (p['coins'] != 1)}, "
                     f"won {p['won']:.0%}, {_pct(p['avg'])} a trade{extra}")
    book = res["playbook"]
    lines += ["", "WHICH STYLE WORKS WHEN (avg a trade, trades):"]
    for s in STYLES:
        g = book["by_style"].get(s) or {}
        if not g.get("n"):
            continue
        cells = []
        for n, _, _ in SLOTS:
            c = book["by_style_slot"].get(f"{s}|{n}") or {}
            if c.get("n"):
                cells.append(f"{n} {_pct(c['avg'])} ({c['n']})" + (f" {c['verdict']}" if c["verdict"] != "not sure yet" else ""))
        lines.append(f"• {s}: overall {_pct(g['avg'])} ({g['n']}). " + " · ".join(cells))
    lines += ["", "TIME OF DAY (all styles): " + " · ".join(
        f"{n} {_pct(book['by_slot'][n]['avg'])} ({book['by_slot'][n]['n']})" for n, _, _ in SLOTS if book["by_slot"][n].get("n"))]
    holds = [f"{h} {_pct(g['avg'])} ({g['n']})" for h, g in book["by_hold"].items() if g.get("n")]
    if holds:
        lines.append("HOLDING: " + " · ".join(holds))
    days = [(k, g) for k, g in book["by_day_slot"].items() if g.get("n", 0) >= 8]
    if days:
        days.sort(key=lambda kv: kv[1]["avg"])
        fmt = lambda kv: f"{kv[0].replace('|', ' ')} {_pct(kv[1]['avg'])} ({kv[1]['n']})"
        lines.append("WEEKDAYS: best " + ", ".join(map(fmt, days[::-1][:3])) + "; worst " + ", ".join(map(fmt, days[:3])))
    mood = [f"{k} {_pct(g['avg'])} ({g['n']}, typical {_pct(g['median'])})" for k, g in (book.get("by_mood") or {}).items()
            if g.get("n")]
    if mood:
        lines.append("MARKET MOOD (SOL's last 24 h when bought): " + " · ".join(mood))
    by_date = [(k, g) for k, g in (book.get("by_date") or {}).items() if g.get("n", 0) >= 5]
    if by_date:
        bad = [k for k, g in by_date if g["avg"] < 0]
        worst = min(by_date, key=lambda kv: kv[1]["avg"])
        best = max(by_date, key=lambda kv: kv[1]["avg"])
        lines.append(f"DAYS: {len(bad)} of {len(by_date)} days lost money. Best {best[0]} {_pct(best[1]['avg'])} "
                     f"({best[1]['n']}), worst {worst[0]} {_pct(worst[1]['avg'])} ({worst[1]['n']}).")
    go = [k.replace("|", " ") for k, c in book["by_style_slot"].items() if c.get("verdict") == "GO"]
    avoid = [k.replace("|", " ") for k, c in book["by_style_slot"].items() if c.get("verdict") == "AVOID"]
    lines += ["", f"PLAYBOOK: GO {', '.join(go) or 'nothing sure yet'}; AVOID {', '.join(avoid) or 'nothing sure yet'}. "
              f"Real money {'skips the AVOID ones' if live_on else 'does NOT use it yet (ask Claude to switch it on)'}; "
              "practice copies everything so the playbook keeps learning."]
    return "\n".join(lines)


def run(settings_path: str = "solbot.yaml"):
    from .copytrade import STATE, WALLETS
    from .signals import alert_target, notify
    from .solbot import commit, load_settings

    settings = load_settings(settings_path)
    cfg = settings.get("copytrade") or {}
    data = json.loads(WALLETS.read_text()) if WALLETS.exists() else {}
    wallets = list(data.get("wallets") or {})[: int(cfg.get("follow", 30))]
    practice = json.loads(STATE.read_text()) if STATE.exists() else {}
    res = build(wallets, practice=practice)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1))
    commit([str(OUT)], f"Wallet styles: {res['trades']} trades from {len(res['wallets'])} wallets")
    text = report_text(res, bool((cfg.get("live") or {}).get("playbook")))
    print(text, flush=True)
    target = alert_target()
    if target and res["trades"]:
        notify(target, "🧠 Smart wallet styles (every 2 weeks)", text[:3900], buy=True, tag="bar_chart")
    return res
