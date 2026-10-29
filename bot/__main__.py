from __future__ import annotations

import argparse

import pandas as pd
import logging
import sys

from . import data
from .backtest import run_backtest
from .broker import CCXTBroker, PaperBroker
from .config import Config
from .runner import Runner, replay, run_forever
from .strategies import build_strategy


def load_data(src: str, cfg: Config, days: float):
    if src == "synthetic":
        return data.synthetic(freq=cfg.timeframe)
    if src.startswith("csv:"):
        return data.load_csv(src[4:])
    return data.fetch_ccxt(cfg.exchange, cfg.symbol, cfg.timeframe, since_days=days)


def cmd_backtest(args, cfg):
    df = load_data(args.data, cfg, args.days).loc[args.start:args.end]
    res = run_backtest(df, build_strategy(cfg.strategy, cfg.strategy_params), cfg)
    print(f"{cfg.strategy} {cfg.strategy_params} on {args.data} ({len(df)} bars, {df.index[0]:%Y-%m-%d} -> {df.index[-1]:%Y-%m-%d})")
    for k, v in res.stats.items():
        print(f"  {k:<22}{v:>14,.2f}")
    if res.halted_at is not None:
        print(f"  HALTED by max drawdown at {res.halted_at}")
    if args.trades:
        for t in res.trades:
            print(f"  {'LONG ' if t.side > 0 else 'SHORT'} {t.entry_time:%Y-%m-%d %H:%M} {t.entry_price:>10.2f} -> "
                  f"{t.exit_time:%Y-%m-%d %H:%M} {t.exit_price:>10.2f} {100 * t.pnl_pct:>7.2f}% {t.reason}")


def cmd_optimize(args, cfg):
    from .optimize import benchmarks, search

    df = load_data(args.data, cfg, args.days)
    res = search(df, args.split, cfg, strategies=args.strategy or None)
    if args.out:
        res.to_csv(args.out, index=False)
    b = benchmarks(df, args.split, cfg)
    print(f"{len(res)} combinations. Ranked on data before {args.split}; graded on data from {args.split}.")
    print(f"  benchmark  hold: train {b['hold_train']['total_return_pct']:+.0f}%  test {b['hold_test']['total_return_pct']:+.0f}%"
          f"   weekly buys: train {b['dca_train']['total_return_pct']:+.0f}%  test {b['dca_test']['total_return_pct']:+.0f}%")
    cols = ["strategy", "params", "short", "stop_loss_pct", "max_drawdown_pct", "train_total_return_pct",
            "train_max_drawdown_pct", "test_total_return_pct", "test_max_drawdown_pct", "test_trades"]
    with pd.option_context("display.width", 200, "display.max_colwidth", 50):
        print(res[cols].head(args.top).round(1).to_string())


def cmd_rotation(args, cfg):
    from .rotation import backtest_rotation, load_universe

    closes = load_universe(args.folder)
    res = backtest_rotation(closes, top_n=args.top, lookback=args.lookback, cash_filter=args.filter,
                            fee_pct=cfg.fee_pct, slippage_pct=cfg.slippage_pct, start=args.start, end=args.end)
    print(f"Monthly rotation: top {args.top} by {args.lookback}-day return, filter={args.filter}, "
          f"{len(closes.columns)} coins, {res.equity.index[0]:%Y-%m-%d} -> {res.equity.index[-1]:%Y-%m-%d}")
    for k in ("total_return_pct", "buy_hold_return_pct", "cagr_pct", "max_drawdown_pct", "sharpe", "final_equity"):
        print(f"  {k:<22}{res.stats[k]:>14,.2f}")
    print("  (buy_hold = just holding Bitcoin)")
    if args.picks:
        for day, picks in res.holdings[-args.picks:]:
            print(f"  {day:%Y-%m-%d}: {', '.join(picks) or 'cash'}")


def cmd_markets(args, cfg):
    import ccxt

    ex = getattr(ccxt, cfg.exchange)()
    for m in ex.load_markets().values():
        if args.search.upper() in m["symbol"].upper() and m.get("active", True) is not False:
            size = f" contract={m['contractSize']}" if m.get("contract") else ""
            print(f"{m['symbol']:<28} {m['type']:<7}{size}")


def cmd_trade(args, cfg, live: bool):
    strategy = build_strategy(cfg.strategy, cfg.strategy_params)
    if live:
        if cfg.mode != "live":
            sys.exit("Refusing to trade live: set `mode: live` in the config file as well.")
        if cfg.allow_short and cfg.market_type == "spot":
            sys.exit("allow_short needs a futures/perpetual market: set market_type and a derivatives symbol.")
        broker = CCXTBroker(cfg.exchange, cfg.symbol, cfg.market_type)
    else:
        broker = PaperBroker(cfg.starting_cash, cfg.fee_pct, cfg.slippage_pct, cfg.state_file)
    runner = Runner(cfg, strategy, broker)
    if args.replay:
        replay(cfg, runner, load_data(args.replay, cfg, args.days))
    else:
        run_forever(cfg, runner, once=args.once)


def main(argv=None):
    p = argparse.ArgumentParser(prog="bot", description="Backtest, paper trade, or live trade a strategy.")
    p.add_argument("-c", "--config", help="YAML config file (see config.example.yaml)")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("backtest")
    b.add_argument("--data", default="exchange", help="exchange | synthetic | csv:PATH")
    b.add_argument("--days", type=float, default=180, help="history to fetch from the exchange")
    b.add_argument("--trades", action="store_true", help="list every trade")
    b.add_argument("--start", help="only test from this date, e.g. 2026-01-01")
    b.add_argument("--end", help="only test up to this date")

    o = sub.add_parser("optimize", help="search strategies & settings with a train/test split")
    o.add_argument("--data", default="exchange", help="exchange | synthetic | csv:PATH")
    o.add_argument("--days", type=float, default=2000)
    o.add_argument("--split", required=True, help="first date of the test period, e.g. 2022-01-01")
    o.add_argument("--strategy", action="append", help="limit to these strategies (repeatable)")
    o.add_argument("--top", type=int, default=20)
    o.add_argument("--out", help="save every result to this CSV")

    rt = sub.add_parser("rotation", help="monthly coin rotation: hold last month's biggest risers")
    rt.add_argument("--folder", default="data/daily", help="folder of daily CSVs, one per coin")
    rt.add_argument("--top", type=int, default=3, help="how many coins to hold")
    rt.add_argument("--lookback", type=int, default=30, help="rank coins by their return over this many days")
    rt.add_argument("--filter", choices=["self", "btc"], help="sit in cash when leaders fall (self) or BTC is in a downtrend (btc)")
    rt.add_argument("--start"); rt.add_argument("--end")
    rt.add_argument("--picks", type=int, default=0, help="show the coins held in the last N months")

    m = sub.add_parser("markets", help="list the exchange's symbols (find futures for shorting)")
    m.add_argument("--search", default="BTC")

    for name in ("paper", "live"):
        t = sub.add_parser(name)
        t.add_argument("--once", action="store_true", help="run a single step and exit")
        t.add_argument("--days", type=float, default=30)
        if name == "paper":
            t.add_argument("--replay", help="replay historical data through the live loop: synthetic | csv:PATH | exchange")
        else:
            t.set_defaults(replay=None)

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose or args.cmd != "backtest" else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load(args.config)
    if args.cmd == "backtest":
        cmd_backtest(args, cfg)
    elif args.cmd == "optimize":
        cmd_optimize(args, cfg)
    elif args.cmd == "rotation":
        cmd_rotation(args, cfg)
    elif args.cmd == "markets":
        cmd_markets(args, cfg)
    else:
        cmd_trade(args, cfg, live=args.cmd == "live")


if __name__ == "__main__":
    main()
