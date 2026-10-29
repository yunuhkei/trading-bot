"""Event loop for paper and live trading. Acts once per newly closed candle."""
from __future__ import annotations

import csv
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .broker import Broker, PaperBroker
from .config import Config
from .risk import drawdown_breached, order_size, protective_exit
from .strategies import Strategy, targets

log = logging.getLogger("bot")
DUST = 1.0  # positions worth less than this (in quote currency) count as flat


class Runner:
    def __init__(self, cfg: Config, strategy: Strategy, broker: Broker):
        self.cfg, self.strategy, self.broker = cfg, strategy, broker
        self.path = Path(cfg.state_file)
        s = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.entry = s.get("entry")
        self.peak = s.get("peak", cfg.starting_cash)
        self.halted = s.get("halted", False)
        self.blocked = s.get("blocked", 0)
        self.last_bar = s.get("last_bar")
        self.entry_day = s.get("entry_day")

    def save(self):
        s = {"entry": self.entry, "peak": self.peak, "halted": self.halted,
             "blocked": self.blocked, "last_bar": self.last_bar, "entry_day": self.entry_day}
        if isinstance(self.broker, PaperBroker):
            s["broker"] = self.broker.to_dict()
        self.path.write_text(json.dumps(s, indent=2))

    def _record(self, action, qty, fill, reason):
        log.info("%s %.6f @ %.2f (%s)", action, abs(qty), fill, reason)
        if not self.cfg.trade_log:
            return
        p = Path(self.cfg.trade_log)
        new = not p.exists()
        with p.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "action", "qty", "price", "reason"])
            w.writerow([datetime.now(timezone.utc).isoformat(), action, f"{abs(qty):.8f}", f"{fill:.2f}", reason])

    def _close(self, price, reason):
        qty = self.broker.position()
        fill = self.broker.order(-qty, price)
        self._record("SELL" if qty > 0 else "COVER", qty, fill, reason)
        self.entry = None

    def _side(self, price) -> int:
        pos = self.broker.position()
        return 0 if abs(pos) * price <= DUST else (1 if pos > 0 else -1)

    def step(self, closed: pd.DataFrame, price: float) -> str | None:
        """`closed` holds only fully closed candles; `price` is the latest trade price."""
        if self.halted:
            return None
        action = None
        side = self._side(price)
        equity = self.broker.equity(price)
        self.peak = max(self.peak, equity)

        if drawdown_breached(equity, self.peak, self.cfg.risk):
            if side:
                self._close(price, "max_drawdown")
            self.halted = True
            log.warning("Max drawdown hit (equity %.2f, peak %.2f). Trading halted; delete state to reset.", equity, self.peak)
            self.save()
            return "halt"

        if side and self.entry and protective_exit(side, self.entry, price, price, price, self.cfg.risk) is not None:
            reason = "take_profit" if side * (price - self.entry) > 0 else "stop_loss"
            self._close(price, reason)
            self.blocked, side, action = side, 0, reason

        bar = closed.index[-1].isoformat()
        today = bar[:10]
        if self.cfg.day_trade and side and self.entry_day and today != self.entry_day:
            # Day trading: a new day has started, so close anything still open from yesterday.
            self._close(price, "end_of_day")
            side, action = 0, "end_of_day"
        if bar != self.last_bar and len(closed) > self.strategy.warmup:
            self.last_bar = bar
            want = int(targets(self.strategy, closed, self.cfg.allow_short).iloc[-1])
            if self.blocked and want != self.blocked:
                self.blocked = 0
            if side and want != side:
                self._close(price, "signal")
                side, action = 0, "close"
            if not side and want and want != self.blocked:
                qty = order_size(want, self.broker.equity(price), price, self.cfg.fee_pct, self.cfg.risk)
                self.entry = self.broker.order(qty, price)
                self.entry_day = today
                self._record("BUY" if want > 0 else "SHORT", qty, self.entry, "signal")
                action = "long" if want > 0 else "short"

        log.info("bar=%s price=%.2f position=%.6f equity=%.2f", bar, price,
                 self.broker.position(), self.broker.equity(price))
        self.save()
        return action


def run_forever(cfg: Config, runner: Runner, once: bool = False):
    from .data import fetch_ccxt
    import ccxt

    ex = getattr(ccxt, cfg.exchange)({"enableRateLimit": True})
    limit = runner.strategy.warmup + 100
    while True:
        try:
            df = fetch_ccxt(cfg.exchange, cfg.symbol, cfg.timeframe, limit=limit)
            closed = df.iloc[:-1]  # the last candle is still forming
            price = float(ex.fetch_ticker(cfg.symbol)["last"])
            runner.step(closed, price)
        except Exception as e:  # keep the loop alive through transient network errors
            log.exception("step failed: %s", e)
        if once:
            return
        time.sleep(cfg.poll_seconds)


def replay(cfg: Config, runner: Runner, df: pd.DataFrame):
    """Drive the runner bar-by-bar over historical data, to exercise the live code path offline."""
    for i in range(runner.strategy.warmup + 1, len(df)):
        runner.step(df.iloc[:i], float(df["open"].iloc[i]))
