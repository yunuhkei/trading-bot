from __future__ import annotations

import argparse
from pathlib import Path

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


def cmd_launches(args, cfg):
    from . import news
    from .launch_watch import report, watch

    if args.action == "train":
        from .meme_model import train
        print(train(args.db, horizon=args.horizon, cost=args.cost))
        return
    if args.action == "alert":
        from .meme_model import alert
        alert(args.db, args.notify, args.hours, force=args.force)
        return
    if args.action == "survivors":
        from .survivors import report as survivors_report, run as survivors_run
        survivors_run(args.db, args.hours)
        print(survivors_report(args.db))
        return
    if args.action == "watch":
        watch(args.db, args.hours, last=args.last)
    elif args.action == "news":
        news.run(args.db, args.hours)
    from .survivors import report as survivors_report
    print(report(args.db, args.cost))
    print()
    print(news.report(args.db, args.cost))
    print()
    print(survivors_report(args.db))


def cmd_signals(args, cfg):
    from .signals import notify, run

    if args.test_alert:
        if not args.notify:
            sys.exit("--test-alert needs --notify YOUR-TOPIC")
        ok = notify(args.notify, "Test alert from your trading bot", "If you can read this, phone alerts work.", buy=True)
        print("Test alert sent. Check your phone." if ok else "The test alert was NOT delivered (see the warning above).")
        return
    if args.watchlist:
        from .signals import read_watchlist
        markets = read_watchlist(args.watchlist)
    else:
        markets = [m.strip() for m in args.markets.split(",") if m.strip()]
    from .learn import apply

    run(apply(cfg), markets, args.notify, args.every, args.state, args.stake)


def cmd_alerts(args, cfg):
    import yaml

    from .signals import notify, run_alerts

    if args.test_alert:
        from .signals import alert_target
        target = args.notify or alert_target(yaml.safe_load(Path(args.settings).read_text()).get("notify"))
        if not target:
            sys.exit("No alert channel set: put e.g. ntfy:your-channel in my_alert_channel.txt (see alerts.yaml).")
        ok = notify(target, "Test alert from your trading bot", "If you can read this, phone alerts work.", buy=True)
        print("Test alert sent. Check your phone." if ok else "The test alert was NOT delivered (see the warning above).")
        return
    run_alerts(args.settings, once=args.once, notify_override=args.notify, minutes=args.minutes)


def cmd_ideas(args, cfg):
    import time

    from . import news_ideas
    from .signals import alert_target

    while True:
        ideas = news_ideas.run(args.notify or alert_target(), args.state, args.max)
        print(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()))
        print(news_ideas.table(ideas), flush=True)
        if not args.every:
            return
        time.sleep(args.every * 60)


def cmd_chart(args, cfg):
    from .chart_check import report

    info = None
    if not args.image:
        if not (args.ticker or args.name or args.ca):
            sys.exit("Give a screenshot, or what it shows: --ticker/--name (and --chain, --value) or --ca.")
        info = {"found_asset": True, "kind": args.kind, "name": args.name or "", "ticker": args.ticker or "",
                "chain": args.chain, "market_cap_usd": args.value, "price_usd": None, "contract_address": args.ca or "",
                "app": "", "notes": ""}
    print(report(args.image, args.settings, info))


def cmd_learn(args, cfg):
    import warnings

    from . import learn

    warnings.filterwarnings("ignore")
    if args.refresh:
        learn.refresh()
    names = args.only or list(learn.STRATEGIES)
    if not args.report:
        learn.run(names, notify_changes=args.notify_changes, log=lambda t: print(t, flush=True))
        return
    for name in names:
        saved, tuned = learn.load(name), learn.load(f"{name}.params")
        print(learn.report_text(saved) if saved else f"== {name} ==\n  not trained yet")
        print(learn.tune_text(tuned) if tuned else "  Settings: not tuned yet", "\n")


def cmd_autotrade(args, cfg):
    from .autotrade import run

    print(run(args.settings))


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

    la = sub.add_parser("launches", help="paper-test buying brand-new meme coins (Solana)")
    la.add_argument("action", choices=["watch", "news", "report", "train", "alert", "survivors"],
                    help="watch: collect new coins; news: match coins to headlines (run alongside watch); report: results so far; "
                         "train: teach + test the jackpot model; alert: BUY/SELL alerts from the model (run alongside watch); "
                         "survivors: paper-buy coins still alive 1-24h after launch and check them 1h/2h later")
    la.add_argument("--horizon", default="15m", choices=["5m", "15m", "1h"], help="train: how long each pick is held")
    la.add_argument("--notify", metavar="TARGET", help="alert: ntfy:TOPIC, discord:WEBHOOK_URL or telegram:TOKEN:CHAT")
    la.add_argument("--force", action="store_true", help="alert: run even if the model failed its test (practice only)")
    la.add_argument("--hours", type=float, default=2, help="how long to look for new coins (checks continue 24h after)")
    la.add_argument("--db", default="data/launches.db")
    la.add_argument("--last", default="24h", choices=["5m", "15m", "1h", "6h", "24h"], help="latest price check to wait for")
    la.add_argument("--cost", type=float, default=0.04, help="round-trip fees + slippage, e.g. 0.04 = 4%%")

    al = sub.add_parser("alerts", help="run your saved alert lists from alerts.yaml (trend filter + meme breakout)")
    al.add_argument("--settings", default="alerts.yaml")
    al.add_argument("--once", action="store_true", help="check once and exit (used by the hourly GitHub runner)")
    al.add_argument("--notify", metavar="TARGET", help="override where alerts go (default: notify in alerts.yaml)")
    al.add_argument("--test-alert", action="store_true", help="send one test notification and exit")
    al.add_argument("--minutes", type=float, help="keep checking for this many minutes, then stop")

    ch = sub.add_parser("chart", help="screenshot of a coin or stock -> BUY / WAIT / AVOID, stop-loss and amount")
    ch.add_argument("image", nargs="?", help="path to the screenshot (png/jpg); or describe the coin with the options below")
    ch.add_argument("--ticker", help="ticker shown, e.g. GANG")
    ch.add_argument("--name", help="coin or company name shown")
    ch.add_argument("--chain", default="unknown", choices=["solana", "base", "bsc", "ethereum", "none", "unknown"])
    ch.add_argument("--value", type=float, help="market value shown, in dollars (tells copycats apart)")
    ch.add_argument("--ca", help="contract address, if shown")
    ch.add_argument("--kind", default="meme_coin", choices=["meme_coin", "crypto", "stock"])
    ch.add_argument("--settings", default="alerts.yaml")

    ni = sub.add_parser("ideas", help="meme coins named after today's news that pass safety filters (ideas, not buy signals)")
    ni.add_argument("--notify", metavar="TARGET", help="also send new ideas to your phone (ntfy:TOPIC, ...)")
    ni.add_argument("--state", default="news_ideas_state.json")
    ni.add_argument("--max", type=int, default=3, help="most new ideas to send at once")
    ni.add_argument("--every", type=float, metavar="MINUTES", help="keep checking every N minutes (e.g. 10)")

    sg = sub.add_parser("signals", help="BUY/SELL signals for a watchlist, with optional phone alerts (never trades)")
    sg.add_argument("--markets", default="BTC-USD,ETH-USD,SOL-USD,SPY,QQQ,GLD",
                    help="comma-separated: crypto as BTC-USD (Coinbase), blockchain coins as sol:<address> (e.g. from Fomo), "
                         "stocks/funds as SPY (Yahoo)")
    sg.add_argument("--notify", metavar="TARGET",
                    help="where to send alerts: ntfy:TOPIC, discord:WEBHOOK_URL or telegram:BOT_TOKEN:CHAT_ID")
    sg.add_argument("--every", type=float, metavar="MINUTES", help="keep checking every N minutes (default: check once)")
    sg.add_argument("--state", default="signals_state.json", help="remembers the last signal so only changes alert")
    sg.add_argument("--test-alert", action="store_true", help="send one test notification and exit")
    sg.add_argument("--watchlist", metavar="FILE", help="read markets from a text file, one per line (e.g. watchlist.memes.txt)")
    sg.add_argument("--stake", type=float, help="dollars to buy per BUY alert, shown in the alert (e.g. 30)")

    le = sub.add_parser("learn", help="the bot studies every past signal and learns which ones tend to win")
    le.add_argument("--refresh", action="store_true", help="first add the newest prices to data/ (the weekly run does this)")
    le.add_argument("--only", nargs="+", choices=["trend", "breakout", "rsi_revert"], help="just these strategies")
    le.add_argument("--report", action="store_true", help="show what the saved models learned, without retraining")
    le.add_argument("--notify-changes", action="store_true", help="send a phone alert when it changes a strategy or switches a filter")

    at = sub.add_parser("autotrade", help="trade on Coinbase for you with the trend rule (settings: autotrade.yaml)")
    at.add_argument("--settings", default="autotrade.yaml")

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
    elif args.cmd == "launches":
        cmd_launches(args, cfg)
    elif args.cmd == "chart":
        cmd_chart(args, cfg)
    elif args.cmd == "ideas":
        cmd_ideas(args, cfg)
    elif args.cmd == "alerts":
        cmd_alerts(args, cfg)
    elif args.cmd == "signals":
        cmd_signals(args, cfg)
    elif args.cmd == "autotrade":
        cmd_autotrade(args, cfg)
    elif args.cmd == "learn":
        cmd_learn(args, cfg)
    elif args.cmd == "markets":
        cmd_markets(args, cfg)
    else:
        cmd_trade(args, cfg, live=args.cmd == "live")


if __name__ == "__main__":
    main()
