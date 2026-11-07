import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from bot.backtest import run_backtest
from bot.broker import PaperBroker
from bot.config import Config, RiskConfig
from bot.data import synthetic
from bot.risk import protective_exit
from bot.runner import Runner, replay
from bot.strategies import (Bollinger, Breakout, LateDayMomentum, Momentum, OpeningRange, RSIMeanReversion, SMACross,
                            TrendFilter, VWAP, build_strategy, targets)


def frame(closes):
    c = np.asarray(closes, float)
    o = np.concatenate([[c[0]], c[:-1]])
    idx = pd.date_range("2024-01-01", periods=len(c), freq="h", tz="UTC")
    return pd.DataFrame({"open": o, "high": np.maximum(o, c), "low": np.minimum(o, c),
                         "close": c, "volume": 1.0}, index=idx)


def cfg(allow_short=False, **risk):
    return Config(fee_pct=0, slippage_pct=0, allow_short=allow_short,
                  risk=RiskConfig(**{"position_pct": 1.0, "stop_loss_pct": 0, "max_drawdown_pct": 0, **risk}))


STRATS = [SMACross(5, 20), SMACross(5, 20, rsi_max=70, rsi_min=30), RSIMeanReversion(), Breakout(20, 10, 50),
          TrendFilter(50, 0.02), Momentum(30), OpeningRange(2), VWAP("revert", 0.002), VWAP("trend", 0.0),
          Bollinger(20, 2.0)]


@pytest.mark.parametrize("strat", STRATS)
def test_no_lookahead(strat):
    df = synthetic(500)
    full = strat.signals(df)
    for t in (100, 250, 499):
        assert strat.signals(df.iloc[: t + 1]).iloc[-1] == full.iloc[t]


@pytest.mark.parametrize("strat", STRATS)
def test_shorts_removed_when_disabled(strat):
    df = synthetic(500)
    assert (targets(strat, df, allow_short=True) == -1).any()
    assert (targets(strat, df, allow_short=False) >= 0).all()


def test_uptrend_captured_and_costs_reduce_return():
    df = frame(np.linspace(100, 200, 200))
    free = run_backtest(df, SMACross(3, 10), cfg())
    assert free.stats["total_return_pct"] > 50
    costly = run_backtest(df, SMACross(3, 10), Config(fee_pct=0.01, slippage_pct=0.01, risk=cfg().risk))
    assert costly.stats["total_return_pct"] < free.stats["total_return_pct"]


def test_short_profits_in_downtrend_only_when_enabled():
    df = frame(np.linspace(200, 100, 200))
    long_only = run_backtest(df, SMACross(3, 10), cfg())
    short = run_backtest(df, SMACross(3, 10), cfg(allow_short=True))
    assert long_only.stats["total_return_pct"] == pytest.approx(0)
    assert short.stats["short_trades"] >= 1
    assert short.stats["total_return_pct"] > 40  # 1x short from ~195 to 100


def test_short_carry_costs_money():
    df = frame(np.linspace(200, 100, 200))
    base = run_backtest(df, SMACross(3, 10), cfg(allow_short=True))
    c = cfg(allow_short=True)
    c.short_carry_pct_per_day = 0.01
    assert run_backtest(df, SMACross(3, 10), c).stats["final_equity"] < base.stats["final_equity"]


def test_protective_exits_both_sides():
    r = RiskConfig(stop_loss_pct=0.05, take_profit_pct=0.10)
    assert protective_exit(1, 100, 99, 99, 94, r) == pytest.approx(95)
    assert protective_exit(1, 100, 90, 91, 89, r) == pytest.approx(90)      # gapped through
    assert protective_exit(1, 100, 105, 111, 104, r) == pytest.approx(110)
    assert protective_exit(-1, 100, 101, 106, 100, r) == pytest.approx(105)
    assert protective_exit(-1, 100, 110, 111, 109, r) == pytest.approx(110)  # gapped through
    assert protective_exit(-1, 100, 95, 96, 89, r) == pytest.approx(90)
    assert protective_exit(-1, 100, 101, 104, 96, r) is None


def test_stop_loss_limits_loss_in_crash():
    closes = [100] * 20 + list(np.linspace(100, 108, 8)) + [90, 85]  # crash soon after entry
    res = run_backtest(frame(closes), SMACross(3, 10), cfg(stop_loss_pct=0.05))
    assert any(t.reason == "stop_loss" for t in res.trades)
    assert all(t.pnl_pct > -0.08 for t in res.trades)


def test_short_stop_loss_limits_loss_in_squeeze():
    closes = [100] * 20 + list(np.linspace(100, 92, 8)) + [110, 115]  # squeeze soon after short entry
    res = run_backtest(frame(closes), SMACross(3, 10), cfg(allow_short=True, stop_loss_pct=0.05))
    stopped = [t for t in res.trades if t.reason == "stop_loss"]
    assert stopped and stopped[0].side == -1
    assert all(t.pnl_pct > -0.08 for t in res.trades)


def test_max_drawdown_halts():
    closes = list(np.linspace(100, 150, 60)) + [120] + list(np.linspace(120, 200, 60))
    res = run_backtest(frame(closes), SMACross(3, 10), cfg(max_drawdown_pct=0.1))
    assert res.halted_at is not None
    assert res.equity.iloc[-1] == res.equity.loc[res.halted_at]  # no trading after the halt


def test_breakout_goes_long_and_short():
    up = frame(list(np.full(60, 100.0)) + list(np.linspace(100, 150, 60)))
    dn = frame(list(np.full(60, 100.0)) + list(np.linspace(100, 60, 60)))
    s = Breakout(20, 10, trend=50)
    assert s.signals(up).iloc[-1] == 1
    assert s.signals(dn).iloc[-1] == -1


def test_paper_broker_long_and_short(tmp_path):
    b = PaperBroker(1000, fee_pct=0.001, slippage_pct=0)
    b.order(5, 100)
    b.order(-5, 110)
    assert b.qty == 0 and b.cash == pytest.approx(1000 + 50 - 0.001 * (500 + 550))
    b.order(-5, 100)          # short
    assert b.equity(80) == pytest.approx(b.cash - 400)
    b.order(5, 80)            # cover at a profit
    assert b.qty == 0 and b.cash > 1040


@pytest.mark.parametrize("name,params", [("sma_cross", {"fast": 10, "slow": 30}),
                                         ("breakout", {"entry": 20, "exit": 10, "trend": 50})])
def test_replay_matches_backtest(tmp_path, name, params):
    df = synthetic(800, seed=3)
    c = Config(fee_pct=0.001, slippage_pct=0, allow_short=True, trade_log="",
               state_file=str(tmp_path / "state.json"), risk=RiskConfig(stop_loss_pct=0, max_drawdown_pct=0))
    strat = build_strategy(name, params)
    bt = run_backtest(df, strat, c)
    runner = Runner(c, strat, PaperBroker(c.starting_cash, c.fee_pct, 0))
    replay(c, runner, df)
    assert runner.broker.equity(df["close"].iloc[-1]) == pytest.approx(bt.equity.iloc[-1], rel=0.02)


def test_runner_resumes_from_state_and_logs_trades(tmp_path):
    c = Config(state_file=str(tmp_path / "state.json"), trade_log=str(tmp_path / "trades.csv"))
    df = frame(np.linspace(100, 200, 80))
    r1 = Runner(c, SMACross(3, 10), PaperBroker(c.starting_cash, 0, 0, c.state_file))
    r1.step(df, 200)
    assert r1.entry is not None
    r2 = Runner(c, SMACross(3, 10), PaperBroker(c.starting_cash, 0, 0, c.state_file))
    assert r2.entry == r1.entry and r2.broker.qty == r1.broker.qty
    assert r2.step(df, 200) is None  # same bar: no duplicate order
    assert "BUY" in (tmp_path / "trades.csv").read_text()


def test_live_broker_requires_confirmation(monkeypatch):
    from bot.broker import CCXTBroker
    monkeypatch.delenv("BOT_LIVE_CONFIRM", raising=False)
    with pytest.raises(RuntimeError, match="BOT_LIVE_CONFIRM"):
        CCXTBroker("coinbase", "BTC/USD")


def test_load_csv_with_date_strings(tmp_path):
    from bot.data import load_csv
    p = tmp_path / "d.csv"
    p.write_text("ts,open,high,low,close,volume\n2026-01-01,1,2,0.5,1.5,10\n2026-01-02,1.5,2,1,1.8,11\n")
    df = load_csv(str(p))
    assert len(df) == 2 and df.index[0].year == 2026 and df["close"].iloc[-1] == 1.8


def test_backtest_start_uses_history_for_warmup():
    df = frame(np.linspace(100, 200, 300))
    late = run_backtest(df, TrendFilter(50), cfg(), start=df.index[200])
    assert late.equity.index[0] == df.index[200]
    assert late.trades and late.trades[0].entry_time == df.index[200]  # already warmed up, trades immediately


def test_recurring_buy_invests_everything_once():
    from bot.backtest import recurring_buy
    df = frame(np.full(70, 100.0))
    eq = recurring_buy(df, cfg(), every=7)
    assert eq.iloc[-1] == pytest.approx(10_000)  # flat price, no fees: no gain or loss
    up = recurring_buy(frame(np.linspace(100, 200, 70)), cfg(), every=7)
    assert 10_000 < up.iloc[-1] < 20_000  # averaged in, so less than a lump sum would make


def test_optimizer_ranks_on_training_only():
    from bot.optimize import search
    df = synthetic(900, seed=1, freq="1d")
    c = Config(timeframe="1d", fee_pct=0.001, state_file="", trade_log="")
    res = search(df, str(df.index[600].date()), c, strategies=["momentum"], workers=1)
    assert len(res) == 9 * 8 * 2
    assert res["train_score"].is_monotonic_decreasing


def test_short_cannot_lose_more_than_the_account():
    df = frame([100] * 30 + list(np.linspace(100, 90, 5)) + list(np.linspace(90, 400, 20)))
    res = run_backtest(df, SMACross(3, 10), cfg(allow_short=True))  # no stop, no kill switch
    assert res.equity.min() >= 0
    assert res.stats["total_return_pct"] >= -100


def test_clean_repairs_bad_ticks():
    from bot.data import clean
    df = frame([100, 101, 102])
    df.loc[df.index[1], "low"] = 0.06
    out = clean(df)
    assert out["low"].iloc[1] == pytest.approx(50.0)
    assert out["low"].iloc[0] == df["low"].iloc[0]


def test_cagr_uses_calendar_time_for_weekday_markets():
    from bot.backtest import compute_stats
    idx = pd.bdate_range("2020-01-01", "2021-12-31", tz="UTC")  # weekdays only, ~2 years
    eq = pd.Series(np.linspace(10_000, 12_100, len(idx)), index=idx)
    stats = compute_stats(eq, [], eq, 365, 1.0)
    assert stats["cagr_pct"] == pytest.approx(10, abs=0.3)


def test_late_day_momentum_no_lookahead_at_day_boundaries():
    # Uses the session length, which is known in advance, so cut the data only at day boundaries.
    df = synthetic(24 * 20, freq="1h")
    full = LateDayMomentum(2).signals(df)
    days = df.index.normalize()
    for d in days.unique()[5:8]:
        cut = df.loc[days <= d]
        assert (LateDayMomentum(2).signals(cut) == full.loc[cut.index]).all()


def test_day_trade_closes_every_position_by_end_of_day():
    df = synthetic(24 * 30, freq="1h")
    c = cfg(allow_short=True)
    c.day_trade = True
    res = run_backtest(df, SMACross(3, 10), c)
    assert res.trades
    for t in res.trades:
        assert t.exit_time.normalize() == t.entry_time.normalize()


def test_opening_range_waits_for_the_range_to_finish():
    df = synthetic(24 * 10, freq="1h")
    sig = OpeningRange(4).signals(df)
    first_bars = df.groupby(df.index.normalize()).cumcount() < 4
    assert (sig[first_bars] == 0).all()
    assert (sig != 0).any()


def test_runner_day_trade_closes_on_new_day(tmp_path):
    c = Config(state_file=str(tmp_path / "s.json"), trade_log="", day_trade=True)
    df = frame(np.linspace(100, 200, 80))  # hourly bars spanning several days
    r = Runner(c, SMACross(3, 10), PaperBroker(c.starting_cash, 0, 0))
    r.step(df.iloc[:30], 150)
    assert r.broker.qty > 0
    assert r.step(df.iloc[:60], 160) in ("end_of_day", "long")  # next day: yesterday's position is closed first


def _universe():
    idx = pd.date_range("2020-01-01", periods=200, freq="D", tz="UTC")
    return pd.DataFrame({"BTC": np.linspace(100, 150, 200), "UP": np.linspace(10, 40, 200), "DOWN": np.linspace(50, 20, 200)}, index=idx)


def test_rotation_holds_the_leader():
    from bot.rotation import backtest_rotation
    res = backtest_rotation(_universe(), top_n=1, lookback=30, fee_pct=0, slippage_pct=0)
    assert res.holdings[0][1] == []  # first month: no coin has 30 days of history yet
    assert all(h == ["UP"] for _, h in res.holdings[1:])
    assert res.equity.iloc[-1] > 10_000


def test_rotation_self_filter_skips_falling_coins():
    from bot.rotation import backtest_rotation
    u = _universe()[["DOWN"]].assign(BTC=_universe()["BTC"])
    res = backtest_rotation(u[["DOWN"]], top_n=1, lookback=30, cash_filter="self", fee_pct=0, slippage_pct=0)
    assert all(h == [] for _, h in res.holdings)
    assert res.equity.iloc[-1] == pytest.approx(10_000)


def test_rotation_costs_reduce_returns():
    from bot.rotation import backtest_rotation
    free = backtest_rotation(_universe(), top_n=2, lookback=7, fee_pct=0, slippage_pct=0)
    paid = backtest_rotation(_universe(), top_n=2, lookback=7, fee_pct=0.01, slippage_pct=0)
    assert paid.equity.iloc[-1] < free.equity.iloc[-1]


def test_launch_report_counts_vanished_coins_as_total_loss(tmp_path):
    from bot.launch_watch import connect, outcomes
    path = str(tmp_path / "l.db"); db = connect(path)
    for tok, later, missing in (("A", 2.0, 0), ("B", 0.5, 0), ("C", None, 1)):
        db.execute("insert into coins values (?,?,?,?,?,?,?,?,?)", (tok, "p", tok, "pump-fun", 0, 60, 1000, 1, 0))
        db.execute("insert into checks values (?,?,?,?,?,?,?,?)", (tok, "0m", 60, 61, 1.0, 1000, 0, 0))
        db.execute("insert into checks values (?,?,?,?,?,?,?,?)", (tok, "1h", 3660, 3661, later, None, None, missing))
    db.commit()
    df = outcomes(path, round_trip_cost=0.0).set_index("token")
    assert df.loc["A", "ret"] == pytest.approx(1.0)
    assert df.loc["B", "ret"] == pytest.approx(-0.5)
    assert df.loc["C", "ret"] == -1.0


def test_news_topics_need_names_not_everyday_words():
    from bot.news import coin_matches, news_topics
    rows = [("google_news_top", "Fans cheer as Lorenzo Musetti stuns Alcaraz"),
            ("google_news_sports", "Why Musetti and Alcaraz played the match of the year"),
            ("google_news_top", "Investors follow the money into the House race"),
            ("google_trends_us", "gsv vs atl")]
    topics = news_topics(rows)
    assert {"musetti", "alcaraz"} <= set(topics)
    assert "money" not in topics and "house" not in topics  # everyday words, mentioned once
    assert coin_matches("Musetti", "MUSETTI", topics) == "musetti"
    assert coin_matches("Lorenzo Musetti", "LM", topics) in {"musetti", "lorenzomusetti"}
    assert coin_matches("Musetti Moon Rocket Pump", "MMRP", topics) == "musetti"  # moon/pump are filler
    assert coin_matches("Tennis Legends Rocket Club", "TLRC", topics) is None
    assert coin_matches("Golden State", "GSVATL", topics) is None


def test_news_match_ignores_headlines_published_after_the_coin(tmp_path):
    from bot.launch_watch import connect
    from bot.news import SCHEMA, match_coins
    db = connect(str(tmp_path / "l.db")); db.executescript(SCHEMA)
    db.execute("insert into coins values ('T','p','GOAT / SOL','pump-fun',0,1000,0,0,0)")
    db.execute("insert into coin_names values ('T','Goat','GOAT')")
    db.execute("insert into news values ('late','google_trends_us','goat',2000,2000)")
    assert match_coins(db) == []
    db.execute("insert into news values ('early','google_trends_us','goat',900,900)")
    assert len(match_coins(db)) == 1


def test_launch_report_counts_pulled_liquidity_as_total_loss(tmp_path):
    from bot.launch_watch import connect, outcomes
    path = str(tmp_path / "l.db"); db = connect(path)
    db.execute("insert into coins values ('R','p','RUG','pumpswap',0,60,1000,1,0)")
    db.execute("insert into checks values ('R','0m',60,61,1.0,1000,26000,0)")
    db.execute("insert into checks values ('R','15m',960,961,23000.0,1e9,70,0)")  # price 'up' 23,000x, $70 left in the pool
    db.commit()
    assert outcomes(path, round_trip_cost=0.0).ret.iloc[0] == -1.0


def test_signals_alert_only_when_the_signal_changes(tmp_path, monkeypatch):
    import bot.signals as sg
    up = frame(np.linspace(100, 200, 260))
    down = frame(list(np.linspace(100, 200, 230)) + list(np.linspace(200, 120, 30)))
    sent = []
    monkeypatch.setattr(sg, "notify", lambda topic, title, msg, buy: sent.append((title, buy)))
    cfg = Config(strategy="trend", strategy_params={"period": 200, "band": 0.02}, timeframe="1h")
    state = str(tmp_path / "s.json")
    monkeypatch.setattr(sg, "fetch_candles", lambda m, tf: up)
    first = sg.check(cfg, ["TEST"], state, topic="t")
    assert first[0]["stance"] == "IN" and not first[0]["changed"] and sent == []  # first look: no alert
    assert sg.check(cfg, ["TEST"], state, topic="t")[0]["changed"] is False
    monkeypatch.setattr(sg, "fetch_candles", lambda m, tf: down)
    flipped = sg.check(cfg, ["TEST"], state, topic="t")[0]
    assert flipped["stance"] == "OUT" and flipped["changed"]
    assert sent == [("SELL all of TEST (stock) at $120.00", False)]


def test_practice_alerts_are_labeled_and_keep_a_score_after_fees(tmp_path, monkeypatch):
    import bot.signals as sg
    up = frame(np.linspace(100, 200, 260))
    down = frame(list(np.linspace(100, 200, 230)) + list(np.linspace(200, 120, 30)))
    sent = []
    monkeypatch.setattr(sg, "notify", lambda topic, title, msg, buy: sent.append((title, msg)))
    cfg = Config(strategy="trend", strategy_params={"period": 200, "band": 0.02}, timeframe="1h")
    state = str(tmp_path / "s.json")
    for df in (down, up, down):
        monkeypatch.setattr(sg, "fetch_candles", lambda m, tf, df=df: df)
        sg.check(cfg, ["TEST"], state, topic="t", stake=30, practice=True)
    (buy_title, _), (sell_title, sell_msg) = sent
    assert buy_title == "PRACTICE BUY $30 of TEST (stock) at $200.00" and sell_title.startswith("PRACTICE SELL")
    assert "This trade: -40.7% after fees" in sell_msg and "1 trades, 0 wins" in sell_msg


def test_practice_account_trades_alerts_by_itself_with_fixed_amounts(tmp_path):
    from bot.signals import PracticeAccount
    path = str(tmp_path / "acct.json")
    acct = PracticeAccount(path, cash=15, per_trade=10, fee=0.0)
    assert "bought $10" in acct.buy("BTC-USD", 100.0)
    assert "skipped" in acct.buy("ETH-USD", 50.0)  # only $5 left
    acct.save()
    acct = PracticeAccount(path, fee=0.0)  # picks up where it left off
    acct.mark("BTC-USD", 120.0)
    assert round(acct.value(), 2) == 17.0
    assert "+20.0%" in acct.sell("BTC-USD", 120.0) and acct.cash == 17.0 and acct.sell("BTC-USD", 1.0) == ""


def test_alerts_say_what_kind_of_asset_it_is():
    from bot.signals import asset_type
    assert asset_type("PEPE-USD") == "meme coin, Coinbase" and asset_type("BTC-USD") == "crypto, Coinbase"
    assert asset_type("sol:abc") == "meme coin on Solana, Fomo" and asset_type("bsc:0x1") == "meme coin on BNB chain, Fomo"
    assert asset_type("SPY") == "stock fund/ETF" and asset_type("NVDA") == "stock"


def test_prices_paste_as_plain_decimals_and_copy_line():
    from bot.signals import alert_text, money, plain
    assert plain(0.00000437) == "0.000004370" or plain(0.00000437) == "0.00000437"
    assert "e" not in plain(4.97e-06) and money(4.97e-06).startswith("$0.00000")
    assert plain(81249.31) == "81249.31"
    cfg = Config(strategy="breakout", strategy_params={"entry": 20, "exit": 10, "trend": 0}, timeframe="1d")
    df = frame(list(np.full(40, 0.000004)) + [0.0000052])
    _, msg = alert_text(cfg, df, "sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BUY", 30)
    assert msg.splitlines()[-1] == "Copy: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 | buy $30 | price 0.0000052 | stop 0.000004"


def test_buy_alert_spells_out_amount_and_stop_loss():
    from bot.signals import alert_text
    cfg = Config(strategy="breakout", strategy_params={"entry": 20, "exit": 10, "trend": 0}, timeframe="1d")
    df = frame(list(np.full(40, 100.0)) + [130])
    title, msg = alert_text(cfg, df, "PEPE-USD", "BUY", 30)
    assert title == "BUY $30 of PEPE-USD (meme coin, Coinbase) at $130.00"
    assert "Amount: $30" in msg and "Stop-loss: $100.00 (-23.1%)" in msg and "Hold until the SELL alert" in msg


def test_meme_alerts_stay_off_when_the_model_has_not_passed(tmp_path, capsys):
    import pickle
    from bot.meme_model import alert
    path = tmp_path / "m.pkl"
    with open(path, "wb") as fh:
        pickle.dump({"model": None, "meta": {"passed": False}}, fh)
    import bot.meme_model as mm
    old = mm.MODEL_PATH
    try:
        mm.load.__defaults__ = (str(path),)
        alert(str(tmp_path / "l.db"), target=None, hours=0.01)
    finally:
        mm.load.__defaults__ = (old,)
    assert "Alerts are OFF" in capsys.readouterr().out


def test_survivor_scan_buys_only_live_believable_coins(tmp_path, monkeypatch):
    import time as _t
    import bot.survivors as sv
    from bot.launch_watch import connect
    db = connect(str(tmp_path / "l.db"))
    now = _t.time()
    for tok in ("LIVE", "DEAD", "FAKE"):
        db.execute("insert into coins values (?,?,?,?,?,?,?,?,?)", (tok, "p", tok, "pump-fun", now - 7200, now - 7000, 0, 0, 0))
    pair = lambda tok, vol, mcap: {"baseToken": {"address": tok}, "priceUsd": "1", "liquidity": {"usd": 20000}, "marketCap": mcap,
                                   "volume": {"h1": vol}, "priceChange": {"h1": 5, "h6": 10}, "txns": {"h1": {"buys": 9, "sells": 3}}}
    monkeypatch.setattr(sv, "_pairs", lambda toks: {"LIVE": pair("LIVE", 5000, 100000), "DEAD": pair("DEAD", 10, 100000),
                                                    "FAKE": pair("FAKE", 5000, 9e9)})
    assert sv.scan(db) == 1
    row = db.execute("select token, uptrend from survivor_buys").fetchall()
    assert row == [("LIVE", 1)]


def test_launch_report_counts_rigged_billion_dollar_prices_as_total_loss(tmp_path):
    from bot.launch_watch import connect, outcomes
    path = str(tmp_path / "l.db"); db = connect(path)
    db.execute("insert into coins values ('N','p','NEX','pumpswap',0,60,13000,1,0)")
    db.execute("insert into checks values ('N','0m',60,61,0.00001,13000,25000,0)")
    db.execute("insert into checks values ('N','1h',3660,3661,22.7,2.27e10,156000,0)")  # 'worth' $22.7 billion an hour later
    db.commit()
    assert outcomes(path, round_trip_cost=0.0).ret.iloc[0] == -1.0


def test_overnight_holds_only_between_evening_and_morning():
    from bot.strategies import Overnight
    df = frame(np.linspace(100, 110, 72))  # 3 days of hourly candles from midnight UTC
    sig = Overnight(buy_hour=1, sell_hour=13).signals(df)
    held_hours = sorted(set((df.index[sig.to_numpy() == 1] + pd.Timedelta(hours=1)).hour))
    assert held_hours == list(range(1, 13))
    res = run_backtest(df, Overnight(1, 13), cfg())
    assert all(t.exit_time.hour == 13 for t in res.trades if t.reason == "signal")


def test_overnight_trend_filter_skips_falling_nights():
    from bot.strategies import Overnight
    falling = frame(np.linspace(200, 100, 24 * 6))
    assert Overnight(1, 13, trend=24).signals(falling).iloc[48:].sum() == 0


def test_onchain_market_names_are_recognised():
    from bot.signals import display_name, is_crypto, is_onchain
    assert is_onchain("sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
    assert is_onchain("base:0xabc") and is_onchain("bsc:0xabc")
    assert not is_onchain("BTC-USD") and not is_onchain("SPY") and is_crypto("BTC-USD")
    assert display_name("sol:DezXAZ8z7Pnrn").startswith("sol:DezXAZ")


def test_alerts_runs_every_saved_list_with_its_own_strategy(tmp_path, monkeypatch):
    import bot.signals as sg
    (tmp_path / "w1.txt").write_text("AAA  # comment\n# skip\n")
    (tmp_path / "w2.txt").write_text("BBB\n")
    (tmp_path / "t.yaml").write_text("timeframe: 1d\nstrategy: trend\nstrategy_params: {period: 50, band: 0.0}\n")
    (tmp_path / "m.yaml").write_text("timeframe: 1d\nstrategy: breakout\nstrategy_params: {entry: 20, exit: 10, trend: 0}\n")
    (tmp_path / "alerts.yaml").write_text(
        f"notify: ntfy:x\nlists:\n  - {{name: Main, config: {tmp_path}/t.yaml, watchlist: {tmp_path}/w1.txt}}\n"
        f"  - {{name: Memes, config: {tmp_path}/m.yaml, watchlist: {tmp_path}/w2.txt, stake: 30}}\n"
        f"  - {{name: Off, config: {tmp_path}/m.yaml, watchlist: {tmp_path}/w2.txt, enabled: false}}\n")
    seen = []
    monkeypatch.setattr(sg, "check", lambda cfg, markets, state, topic, stake, practice=False, account=None, quiet=False: seen.append((cfg.strategy, markets, stake)) or [])
    monkeypatch.chdir(tmp_path)
    sg.run_alerts(str(tmp_path / "alerts.yaml"), once=True)
    assert seen == [("trend", ["AAA"], None), ("breakout", ["BBB"], 30)]


def test_news_ideas_filter_match_and_never_repeat(tmp_path, monkeypatch):
    import bot.news_ideas as ni
    good = {"chain": "solana", "address": "AAA", "symbol": "MUSETTI", "name": "Musetti", "age_h": 10, "liq": 50_000,
            "vol24": 200_000, "mcap": 500_000, "url": ""}
    thin = {**good, "address": "BBB", "liq": 1_000}               # almost no money in the pool
    old = {**good, "address": "CCC", "age_h": 2000}                # not riding today's news
    unrelated = {**good, "address": "DDD", "symbol": "FROGZ", "name": "Frogz"}
    copy = {**good, "address": "EEE", "symbol": "MUSETTI", "name": "Musetti Inc."}
    monkeypatch.setattr(ni, "candidates", lambda: [good, thin, old, unrelated, copy])
    monkeypatch.setattr(ni, "current_topics", lambda: {"musetti": "Musetti stuns Alcaraz in Paris"})
    sent = []
    monkeypatch.setattr("bot.signals.notify", lambda t, title, msg, buy: sent.append((title, msg)))
    state = str(tmp_path / "s.json")
    ideas = ni.run("ntfy:x", state)
    assert [i["address"] for i in ideas] == ["AAA"]                 # the company copycat is left out
    assert len(sent) == 1 and "sol:AAA" in sent[0][1] and "Not a buy signal" in sent[0][1]
    assert ni.run("ntfy:x", state) and len(sent) == 1               # same coin again: no repeat alert


def test_news_ideas_leave_out_big_coin_impostors(monkeypatch):
    import bot.news_ideas as ni
    fake = {"chain": "solana", "address": "F", "symbol": "Bitcoin", "name": "Bitcoin", "age_h": 45, "liq": 30_000,
            "vol24": 700_000, "mcap": 84_000, "url": ""}
    assert ni.find_ideas([fake], {"bitcoin": "bitcoin price"}) == []


def _chart_settings():
    return {"lists": [{"name": "Main", "config": "config.trend.yaml", "watchlist": "w"},
                      {"name": "Memes", "config": "config.memes.yaml", "watchlist": "w", "stake": 30}]}


def test_chart_check_verdicts(monkeypatch):
    import bot.chart_check as cc
    rising = frame(list(np.full(40, 100.0)) + [130, 131])            # fresh 20-day breakout today
    falling = frame(np.linspace(100, 60, 60))
    young = frame(np.linspace(1, 2, 8))
    old_coin = {"market": "sol:AAA", "kind": "meme_coin", "liquidity": 90_000, "age_days": 60}
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: rising)
    v = cc.verdict(old_coin, _chart_settings())
    assert v["decision"] == "BUY" and v["stake"] == 30 and v["stop"] < v["price"]
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: falling)
    w = cc.verdict(old_coin, _chart_settings())
    assert w["decision"] == "WAIT" and w["trigger"] > w["price"]
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: young)
    short = cc.verdict(old_coin, _chart_settings())                                  # too little daily history:
    assert short["young"] and short["decision"] == "WAIT"                           # 5-minute rule, needs more candles
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: rising)
    thin = {**old_coin, "liquidity": 3_000}
    assert cc.verdict(thin, _chart_settings())["decision"] == "AVOID"                # red flag: tiny pool


def test_chart_check_uses_the_live_price_not_just_yesterdays_close(monkeypatch):
    import bot.chart_check as cc
    rising = frame(list(np.full(40, 100.0)) + [130, 131])            # fresh breakout, stop near 100
    coin = {"market": "sol:AAA", "kind": "meme_coin", "liquidity": 90_000, "age_days": 60}
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: rising if tf == "1d" else frame([90.0]))
    v = cc.verdict(coin, _chart_settings())
    assert v["decision"] == "WAIT" and v["price"] == 90.0 and "trend is breaking today" in v["why"]


def test_chart_check_waits_on_a_coin_with_no_full_day_of_history(monkeypatch):
    import bot.chart_check as cc
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: frame([1.0]).iloc[:0])
    settings = {"lists": [{"config": "config.memes.yaml", "stake": 30}]}
    v = cc.verdict({"market": "bsc:0xabc", "kind": "meme_coin", "liquidity": 100_000, "age_days": 0.1}, settings)
    assert v["decision"] == "WAIT" and v["young"] and "five-minute candles" in v["why"]


def test_chart_check_uses_the_dip_bounce_rule_for_hours_old_coins(monkeypatch):
    import bot.chart_check as cc
    settings = {"lists": [{"config": "config.memes.yaml", "stake": 30}]}
    coin = {"market": "sol:abc", "kind": "meme_coin", "liquidity": 100_000, "age_days": 0.3}
    calm = list(1 + 0.01 * np.sin(np.arange(40)))
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: frame(calm + [0.8]))  # a sharp dip on the last candle
    v = cc.verdict(coin, settings)
    assert v["decision"] == "BUY" and v["young"] and v["stake"] == 30
    assert abs(v["stop"] - 0.8 * 0.8) < 1e-9 and v["target"] > 0.8  # 20% stop, sells back at the average
    monkeypatch.setattr(cc, "fetch_candles", lambda m, tf: frame(calm))
    assert cc.verdict(coin, settings)["decision"] == "WAIT"
    assert cc.verdict({**coin, "liquidity": 5_000}, settings)["decision"] == "AVOID"
    assert cc.verdict({**coin, "age_days": 0.01}, settings)["decision"] == "AVOID"  # under an hour old


def test_chart_check_picks_the_coin_matching_the_screenshot_value(monkeypatch):
    import bot.chart_check as cc
    pair = lambda addr, cap, liq: {"chainId": "bsc", "baseToken": {"address": addr, "symbol": "GANG", "name": "Gang"},
                                   "marketCap": cap, "liquidity": {"usd": liq}, "pairCreatedAt": 0, "url": ""}
    monkeypatch.setattr(cc, "_dex_pairs", lambda q: [pair("0xBIG", 90_000_000, 5_000_000), pair("0xREAL", 2_100_000, 200_000),
                                                     pair("0xTINY", 4_000, 900)])
    info = {"kind": "meme_coin", "name": "Gang", "ticker": "", "chain": "bsc", "market_cap_usd": 2_080_000, "contract_address": ""}
    coin = cc.resolve(info)
    assert coin["market"] == "bsc:0xREAL" and not coin["uncertain"]


def test_learning_replays_trades_with_features_and_results():
    from bot import learn
    cfg = Config(strategy="breakout", strategy_params={"entry": 20, "exit": 10, "trend": 0}, timeframe="1d", fee_pct=0.006)
    prices = np.concatenate([np.linspace(100, 160, 80), np.linspace(160, 110, 40), np.linspace(110, 190, 80)])
    rows = learn.replay(frame(prices), cfg, "test")
    assert rows and all(set(learn.FEATURES) <= set(r) for r in rows)
    assert all(abs(r["ret"]) < 1 for r in rows)


def test_learning_model_filters_alerts_only_when_switched_on(tmp_path, monkeypatch):
    import json
    import bot.learn as learn
    import bot.signals as sg
    monkeypatch.setattr(learn, "MODELS", tmp_path)
    n = len(learn.FEATURES)
    report = {"exam_trades": 500, "every_signal": {"trades": 500, "win_rate": 0.3, "avg": 0.01},
              "approved": {"trades": 150, "win_rate": 0.4, "avg": 0.03, "sure": 0.9}, "learned": []}
    model = {"strategy": "trend", "features": learn.FEATURES, "enabled": True, "threshold": 0.99, "report": report,
             "model": {"mean": [0.0] * n, "scale": [1.0] * n, "coef": [0.0] * n, "intercept": 0.0}}
    (tmp_path / "trend.json").write_text(json.dumps(model))
    up = frame(np.linspace(100, 200, 260))
    down = frame(list(np.linspace(100, 200, 230)) + list(np.linspace(200, 120, 30)))
    a = learn.assess("trend", up)
    assert a["p"] == 0.5 and not a["approve"] and "SKIP" in learn.describe(a)
    sent = []
    monkeypatch.setattr(sg, "notify", lambda topic, title, msg, buy: sent.append((title, msg)))
    cfg = Config(strategy="trend", strategy_params={"period": 200, "band": 0.02}, timeframe="1h")
    acct = sg.PracticeAccount(str(tmp_path / "acct.json"), cash=80, per_trade=10, fee=0.0)
    for df in (down, up):
        monkeypatch.setattr(sg, "fetch_candles", lambda m, tf, df=df: df)
        sg.check(cfg, ["TEST"], str(tmp_path / "s.json"), topic="t", account=acct)
    title, msg = sent[-1]
    assert title.startswith("LOW ODDS BUY") and "skipped it" in msg and not acct.positions
    model["enabled"] = False
    (tmp_path / "trend.json").write_text(json.dumps(model))
    assert learn.assess("trend", up)["approve"] and "still studying" in learn.describe(learn.assess("trend", up))


def test_tuning_adopts_new_settings_only_when_they_win_the_exam(tmp_path, monkeypatch):
    import json
    import bot.learn as learn
    monkeypatch.setattr(learn, "MODELS", tmp_path)
    monkeypatch.setattr(learn, "GRIDS", {"breakout": {"entry": [20, 30], "exit": [10]}})
    rng = np.random.default_rng(1)
    hist = [(f"m{i}", frame(100 * np.exp(np.cumsum(rng.normal(0.001, 0.03, 900))))) for i in range(12)]
    t = learn.tune("breakout", hist)
    saved = json.loads((tmp_path / "breakout.params.json").read_text())
    assert saved["params"]["entry"] in (20, 30) and saved["params"]["exit"] == 10 and "reason" in saved
    if not t["changed"]:
        assert saved["params"]["entry"] == 20      # kept the config's own settings
    # Whatever it adopted is what the live alerts use.
    saved["params"] = {"entry": 30, "exit": 10}
    (tmp_path / "breakout.params.json").write_text(json.dumps(saved))
    cfg = Config(strategy="breakout", strategy_params={"entry": 20, "exit": 10, "trend": 0})
    assert learn.apply(cfg).strategy_params == {"entry": 30, "exit": 10, "trend": 0}


class FakeCoinbase:
    """A pretend Coinbase account for the auto-trader tests."""

    def __init__(self, usd=200.0, coins=None, can_transfer=False):
        self.prices = {"BTC/USD": 100.0, "ETH/USD": 10.0}
        self.free = {"USD": usd, **(coins or {})}
        self.can_transfer, self.orders = can_transfer, {}

    def v3PrivateGetBrokerageKeyPermissions(self):
        return {"can_view": True, "can_trade": True, "can_transfer": self.can_transfer}

    def fetch_ticker(self, symbol):
        return {"last": self.prices[symbol]}

    def fetch_balance(self):
        return {"free": dict(self.free)}

    def amount_to_precision(self, symbol, amount):
        return f"{amount:.8f}"

    def create_market_buy_order_with_cost(self, symbol, cost):
        units = cost * 0.99 / self.prices[symbol]
        self.free["USD"] -= cost
        self.free[symbol.split("/")[0]] = self.free.get(symbol.split("/")[0], 0) + units
        return self._order(units, cost * 0.99, cost * 0.01)

    def create_market_sell_order(self, symbol, amount):
        coin = symbol.split("/")[0]
        self.free[coin] -= amount
        got = amount * self.prices[symbol]
        self.free["USD"] += got * 0.99
        return self._order(amount, got, got * 0.01)

    def _order(self, filled, cost, fee):
        oid = str(len(self.orders))
        self.orders[oid] = {"id": oid, "status": "closed", "filled": filled, "cost": cost, "fee": {"cost": fee}}
        return self.orders[oid]

    def fetch_order(self, oid, symbol):
        return self.orders[oid]


def _autotrade_setup(tmp_path, monkeypatch, mode="dry_run", **extra):
    from pathlib import Path
    import yaml
    import bot.autotrade as at
    monkeypatch.chdir(tmp_path)
    Path("config.trend.yaml").write_text(Path(__file__).parent.parent.joinpath("config.trend.yaml").read_text())
    Path("autotrade.yaml").write_text(yaml.safe_dump({"mode": mode, "strategy_config": "config.trend.yaml",
                                                      "markets": ["BTC-USD", "ETH-USD"], "budget": 100, "max_loss": 30, **extra}))
    monkeypatch.setattr(at.time, "sleep", lambda s: None)
    holds = {"BTC-USD": True, "ETH-USD": True}
    monkeypatch.setattr(at, "rule_says_hold", lambda cfg, m: holds[m])
    sent = []
    return at, holds, sent, (lambda title, msg, buy: sent.append(title))


def test_autotrade_follows_the_rule_within_budget_and_never_sells_your_own_coins(tmp_path, monkeypatch):
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch, mode="live")
    ex = FakeCoinbase(usd=200.0, coins={"BTC": 5.0})        # you already own 5 BTC
    at.run(exchange=ex, tell=tell)
    assert ex.free["USD"] == 100.0                          # spent exactly the $100 budget, $50 per coin
    assert any(t.startswith("BOUGHT $50.00 of BTC-USD") for t in sent)
    at.run(exchange=ex, tell=tell)
    assert ex.free["USD"] == 100.0                          # already holding: no second buy
    holds["BTC-USD"] = False
    at.run(exchange=ex, tell=tell)
    assert abs(ex.free["BTC"] - 5.0) < 1e-9                 # sold only what the bot bought; your 5 BTC untouched
    assert any(t.startswith("SOLD BTC-USD") for t in sent)


def test_autotrade_kill_switch_sells_and_stops(tmp_path, monkeypatch):
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch, mode="live")
    ex = FakeCoinbase()
    at.run(exchange=ex, tell=tell)
    ex.prices = {"BTC/USD": 40.0, "ETH/USD": 4.0}             # both down 60%: a $60 loss, over the $30 limit
    assert at.run(exchange=ex, tell=tell) == "Kill switch."
    assert ex.free.get("BTC", 0) < 1e-9 and ex.free.get("ETH", 0) < 1e-9
    assert "kill switch" in at.run(exchange=ex, tell=tell)


def test_autotrade_refuses_a_key_that_can_withdraw_and_stops_without_its_notes(tmp_path, monkeypatch):
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch, mode="live")
    ex = FakeCoinbase(can_transfer=True)
    assert at.run(exchange=ex, tell=tell) == "Refused: key can transfer." and ex.free["USD"] == 200.0
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch, mode="live", live_since="2026-11-06")
    ex = FakeCoinbase()
    assert at.run(exchange=ex, tell=tell) == "Stopped: ledger missing." and ex.free["USD"] == 200.0


def test_autotrade_dry_run_places_no_orders(tmp_path, monkeypatch):
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch)
    ex = FakeCoinbase()
    status = at.run(exchange=ex, tell=tell)
    assert not ex.orders and ex.free["USD"] == 200.0
    assert sent[0].startswith("DRY RUN: Auto-trader connected") and any(t.startswith("DRY RUN: BOUGHT") for t in sent)
    assert status.startswith("DRY RUN:")


def _rss(*titles, outlet="Outlet"):
    return "<rss><channel>" + "".join(
        f"<item><title>{t} - {outlet}</title><source>{outlet}</source><pubDate>Fri, 15 Jan 2027 08:00:00 GMT</pubDate></item>"
        for t in titles) + "</channel></rss>"


def test_news_digest_sends_only_the_worst_headlines_worst_first():
    from bot import headlines
    now = 1_800_000_000.0
    feeds = {"Top": headlines.parse(_rss("Storm hits Florida coast overnight", "Senate passes budget bill",
                                         "Earthquake kills dozens in Turkey", "Stocks plunge as recession fears grow")),
             "World": headlines.parse(_rss("Russia launches missile attack on Kyiv, 12 killed")),
             "Tech": headlines.parse(_rss("Column | Missile attack on my ladder", "Apple unveils new chip")),
             "Crypto": headlines.parse(_rss("Turkey earthquake kills dozens, rescuers search rubble"))}
    for items in feeds.values():
        for i in items:
            i["published"] = now - 3600
    assert feeds["Top"][0]["title"] == "Storm hits Florida coast overnight" and feeds["Top"][0]["outlet"] == "Outlet"
    assert len(feeds["Tech"]) == 1                                   # the advice column is dropped
    chosen = headlines.pick(feeds, sent=[], most=5, now=now)
    titles = [c["title"] for c in chosen]
    assert titles == ["Russia launches missile attack on Kyiv, 12 killed", "Earthquake kills dozens in Turkey"]
    assert headlines.pick(feeds, sent=titles, most=5, now=now) == []                        # nothing sent twice


def test_red_alert_only_for_a_nuclear_weapon_actually_used():
    from bot import headlines
    for t in ["Russia launches nuclear strike on Ukraine", "Nuclear bomb dropped on city, officials say",
              "Nuclear explosion reported near Kyiv", "Nuke dropped from plane over port city"]:
        assert headlines.nuclear_used(t), t
    for t in ["Putin threatens nuclear strike", "Fears of nuclear war grow", "Could a nuclear attack happen?",
              "Iran nuclear talks resume", "North Korea conducts nuclear test", "US strikes Iran nuclear sites",
              "Drone hits Zaporizhzhia nuclear plant", "Hiroshima marks anniversary of atomic bomb",
              "Kremlin denies plans for nuclear strike",
              # the Nov 2026 false alarm (a commentator's claim, repeated by a dozen sites)
              "Tucker Carlson: Donald Trump pressured by Benjamin Netanyahu to launch nuclear strike on Iran",
              "Iran to be hit by nuclear bomb soon? US commentator makes big claim",
              "Trump is 'considering nuclear strike on Iran', former CIA agent claims",
              "Tucker Carlson Claims 'Desperate' Netanyahu Pushing US Toward Nuke Strike On Iran, Trump Hesitant",
              "\u201cWas That a Nuclear Bomb?\u201d russians React to Massive Explosion at Warehouse (Video)",
              "Kyiv, Moscow Citizens Receive Imminent Nuclear Strike Alerts After \u2018Hackers\u2019 Hit Civil Defence Apps"]:
        assert not headlines.nuclear_used(t), t
    assert headlines.nuclear_used("Ukraine says Russia struck Kyiv with nuclear missile")


def test_nuclear_alert_escalates_in_stages_by_outlets_and_major_services():
    from bot import headlines as h
    now = 1_800_000_000.0
    state = {}

    def feeds(*outlets):
        return {"Top": [{"title": "Russia launches nuclear strike on Kyiv", "outlet": o, "published": now - 60} for o in outlets]}
    stage = lambda alert: alert[0][0] if alert else None
    assert stage(h.nuke_alert(feeds("Daily Blog"), state, now)) == 1                 # 1 outlet: WARNING (unconfirmed)
    assert h.nuke_alert(feeds("Daily Blog"), state, now + 60) is None               # same stage: not sent twice
    assert stage(h.nuke_alert(feeds("Other Blog"), state, now + 120)) == 2          # 2 outlets: RED ALERT
    assert h.nuke_alert(feeds(*[f"Blog {i}" for i in range(6)]), state, now + 180) is None   # 8 small sites: stays RED
    assert stage(h.nuke_alert(feeds("Reuters", "BBC News"), state, now + 240)) == 3          # + 2 major: CONFIRMED
    alert = h.nuke_alert(feeds("AP News"), state, now + 300)                       # 3 major: BLACKOUT WARNING
    assert stage(alert) == 4
    title, msg = h.nuke_message(*alert)
    assert title == "⬛ BLACKOUT WARNING" and "charge your phone" in msg and "Reported by 11 outlets" in msg
    assert msg.index("(Reuters)") < msg.index("(Blog")                              # major services listed first
    later = now + 2 * 86400                                                          # a quiet day: stages reset
    again = {"Top": [{"title": "Russia launches nuclear strike on Kyiv", "outlet": "Daily Blog", "published": later - 60}]}
    assert stage(h.nuke_alert(again, state, later)) == 1



def _frame5(closes):
    df = frame(closes)
    df.index = pd.date_range("2026-01-05", periods=len(df), freq="5min", tz="UTC")
    return df


def test_rsi_scalp_sells_at_rsi_take_profit_or_stop():
    lead = [100.0, 100.3] * 15 + [99.0, 97.0]                 # wiggles, then a sharp dip (bought at 97)

    def entry(params, after):
        sig = build_strategy("rsi_scalp", params).signals(_frame5(lead + after))
        i = int(np.argmax(sig.to_numpy() == 1))
        return sig, i, (lead + after)[i]

    tp = {"period": 7, "low": 30, "high": 99, "tp": 0.02, "sl": 0.0}
    sig, i, px = entry(tp, [])
    assert i == len(lead) - 1 and px == 97.0
    sig, _, _ = entry(tp, [px * 1.01, px * 1.025])
    assert sig.iloc[-2] == 1 and sig.iloc[-1] == 0             # sold once it was up 2%+
    sl = {"period": 7, "low": 30, "high": 99, "tp": 0.0, "sl": 0.015}
    sig, i, px = entry(sl, [])
    sig, _, _ = entry(sl, [px * 0.98])
    assert sig.iloc[-1] == 0                                   # stop loss: down 1.5%+ from the buy
    sig, _, _ = entry({"period": 7, "low": 30, "high": 60}, list(np.linspace(97, 101, 8)))
    assert sig.iloc[-1] == 0                                   # RSI back above 60


def test_scalp_replay_charges_fees_and_closes_before_a_market_break():
    from bot import scalp_learn as sl
    p = {"period": 7, "low": 30, "high": 60, "tp": 0, "sl": 0}
    closes = [100.0, 100.3] * 15 + [99.0, 97.0, 94.0, 92.0] + list(np.linspace(92, 100, 8))
    trades = sl.replay(_frame5(closes), p, "5m", 0.006)
    no_fee = sl.replay(_frame5(closes), p, "5m", 0.0)
    assert len(trades) == 1 and no_fee[0][1] > 0
    assert abs((1 + trades[0][1]) - (1 + no_fee[0][1]) * 0.994 ** 2) < 1e-9   # fee on the buy and the sell
    df = _frame5([100.0, 100.3] * 15 + [99.0, 97.0, 94.0, 92.0] + [92.0] * 10)
    df.index = df.index[:34].append(df.index[34:] + pd.Timedelta(hours=17))   # overnight gap after the dip
    held = sl.replay(df, {**p, "high": 99}, "5m", 0.0)
    assert len(held) == 1 and held[0][0] < df.index[34]        # closed before the break, not held overnight


def test_scalp_learning_picks_settings_that_trade_often_enough(monkeypatch, tmp_path):
    from bot import scalp_learn as sl
    from bot.config import Config
    monkeypatch.setattr(sl, "GRID", {"period": [7], "low": [10, 35], "high": [55], "tp": [0.0], "sl": [0.0]})
    rng = np.random.default_rng(3)
    hist = {f"m{i}": _frame5(100 * np.exp(np.cumsum(rng.normal(0, 0.004, 7 * 288)))) for i in range(4)}
    slow = {"period": 7, "low": 10, "high": 55, "tp": 0.0, "sl": 0.0}
    r = sl.tune(list(hist), slow, "5m", 0.006, min_per_hour=1, hist=hist)
    assert r["timeframe"] == "5m" and r["history_days"] == 7 and r["exam_days"] == 2
    assert r["params"]["low"] == 35 and r["changed"] and "times a day" in r["reason"]
    assert "CHANGED to" in sl.learned_text(r)
    # maybe_learn saves it and uses it until it's time to learn again
    monkeypatch.setattr(sl, "tune", lambda *a, **k: {**r, "learned_at": 1e9})
    cfg = Config(strategy="rsi_scalp", timeframe="5m", strategy_params=slow)
    opts = {"file": str(tmp_path / "learned.json"), "every_hours": 3, "min_trades_per_hour": 1}
    params, just = sl.maybe_learn(cfg, list(hist), opts, 0.006, now=1e9)
    assert params["low"] == 35 and just
    params, just = sl.maybe_learn(cfg, list(hist), opts, 0.006, now=1e9 + 3600)
    assert params["low"] == 35 and just is None                  # not due yet: keeps what it learned
    calls = []
    monkeypatch.setattr(sl, "tune", lambda *a, **k: calls.append(a[2]) or {**r, "timeframe": "1h", "learned_at": 1e9})
    hourly = Config(strategy="rsi_scalp", timeframe="1h", strategy_params=slow)
    params, just = sl.maybe_learn(hourly, list(hist), opts, 0.006, now=1e9 + 3600)
    assert calls == ["1h"] and just                              # learned on 5m candles: relearns for 1h right away


def test_scalp_practice_is_quiet_per_trade_and_reports_hourly(tmp_path, monkeypatch):
    import bot.signals as sg
    from bot.config import Config
    sent = []
    monkeypatch.setattr(sg, "notify", lambda target, title, msg, buy, tag=None, priority=None: sent.append((title, msg, tag)))
    cfg = Config(strategy="rsi_scalp", timeframe="5m", strategy_params={"period": 7, "low": 30, "high": 60})
    acct = sg.PracticeAccount(str(tmp_path / "acct.json"), cash=8000, per_trade=800, fee=0.006)
    today = pd.Timestamp.now(tz="UTC").floor("5min")
    base = list(np.linspace(100, 101, 30))
    for closes in (base, base + list(np.linspace(100, 90, 12)), base + list(np.linspace(100, 90, 12)) + list(np.linspace(90, 99, 8))):
        df = _frame5(closes)
        df.index = pd.date_range(end=today, periods=len(df), freq="5min")
        monkeypatch.setattr(sg, "fetch_candles", lambda m, tf, df=df: df)
        sg.check(cfg, ["SOL-USD"], str(tmp_path / "s.json"), topic="t", practice=True, account=acct, quiet=True)
    assert not sent and [e["action"] for e in acct.events] == ["BUY", "SELL"]
    assert sg.send_report(acct, 60, "t", "my rule", None, 800, now=1e10) is None   # first time: just starts the clock
    acct.reported_at = acct.events[0]["t"] - 1
    title, msg = sg.send_report(acct, 60, "t", "my rule", None, 800, now=acct.events[0]["t"] + 3600)
    assert title.startswith("Scalp report") and "BUY SOL-USD $800" in msg and "SELL SOL-USD" in msg
    assert "Rule now: my rule" in msg and sent[-1][2] == "bar_chart"
    acct.save()
    again = sg.PracticeAccount(str(tmp_path / "acct.json"))
    assert len(again.events) == 2 and again.reported_at == acct.reported_at
    assert sg.send_report(again, 60, "t", "my rule", None, 800, now=again.reported_at + 7200) is None   # nothing new


def _solbot_fakes(monkeypatch, tmp_path, price):
    """A pretend market for the Solana bot: one coin, a price we control, Jupiter quotes at that price minus 1%."""
    from bot import solbot as sb
    monkeypatch.chdir(tmp_path)
    mint = "COIN111"
    (tmp_path / "young.txt").write_text(f"sol:{mint}   # COIN\n")
    sig = {"in": False, "fresh_buy": None, "name": "COIN", "candle_price": price[0]}
    monkeypatch.setattr(sb, "signal", lambda market, cfg, *a: dict(sig))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 1e6, "vol24": 1e6, "h6": 1, "h24": 1, "mcap": 1e6,
                                                           "name": m, "symbol": m, "age_h": 50} for m in mints})
    monkeypatch.setattr(sb, "find_coins", lambda settings, exclude, n: [])
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "passed the rug check"))
    import bot.solbot_learn as sl_

    def no_history(market):
        raise ValueError("no network in tests")
    monkeypatch.setattr(sl_, "coin_history", no_history)

    def order(i, o, raw, taker=None):
        usd_in = raw / 1e6 * (1 if i == sb.USDC else price[0])
        out = usd_in * 0.99 / (1 if o == sb.USDC else price[0])
        return {"inAmount": str(raw), "outAmount": str(int(out * 1e6)), "inUsdValue": usd_in, "outUsdValue": usd_in * 0.99,
                "requestId": "r", "transaction": None}
    monkeypatch.setattr(sb, "order", order)
    sent = []
    root = Path(__file__).parent.parent
    settings = {"mode": "dry_run", "tiers": [{"below": 100, "per_trade": 30}, {"below": 200, "per_trade": 50}, {"per_trade": 100}],
                "pause_at": [100, 200], "stop_loss": 0.2, "stop_below": 10, "stop_drawdown": 0.5, "max_cost": 0.03,
                "start_cash": 30, "watchlist": str(tmp_path / "young.txt"), "strategy_config": str(root / "config.young.yaml"),
                "stock_strategy_config": str(root / "config.stockdip.yaml"), "learn": False}
    return sb, mint, sig, settings, (lambda t, m: sent.append((t, m))), sent


def test_solbot_dry_run_buys_fresh_dips_sells_at_the_average_and_never_rebuys_the_same_signal(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    sb.step(settings, tell)
    assert sent[0][0].startswith("DRY RUN: Solana bot connected")
    sig.update({"in": True, "fresh_buy": "2026-11-03 10:00"})
    sb.step(settings, tell)
    assert sent[-1][0] == "DRY RUN: BOUGHT $30.00 of COIN"
    state = json.loads(Path("solbot_state_dry_run.json").read_text())
    assert state["paper_cash"] == 0 and abs(state["positions"][mint]["cost"] - 30) < 1e-9
    n = len(sent)
    sb.step(settings, tell)                                     # same signal: no second buy
    assert len(sent) == n
    price[0] = 1.10
    sig.update({"in": False, "fresh_buy": None})
    status = sb.step(settings, tell)
    assert sent[-1][0].startswith("DRY RUN: SOLD COIN for $32.") and "holding nothing" in status
    state = json.loads(Path("solbot_state_dry_run.json").read_text())
    assert 32 < state["paper_cash"] < 33 and not state["positions"]


def test_solbot_trade_size_grows_with_the_account():
    from bot import solbot as sb
    tiers = {"tiers": [{"below": 100, "per_trade": 30}, {"below": 200, "per_trade": 50}, {"below": 250, "per_trade": 75},
                       {"per_trade": 100}]}
    assert [sb.trade_size(tiers, v) for v in (30, 99.9, 100, 199, 200, 249, 250, 900)] == [30, 30, 50, 50, 75, 75, 100, 100]
    assert sb.trade_size({"per_trade": 20}, 500) == 20


def test_solbot_stop_loss_loss_limit_and_drawdown(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(settings, tell)
    price[0] = 0.75                                             # down 25%: the 20% stop-loss sells it
    sb.step(settings, tell)
    assert any(t.startswith("DRY RUN: SOLD") and "Stop-loss" in m for t, m in sent)
    sig.update({"fresh_buy": "t2"})                             # a new dip: buys again with what's left
    sb.step(settings, tell)
    price[0] = 0.30                                             # account falls below $10: sell all and stop
    status = sb.step(settings, tell)
    assert status.startswith("Stopped") and sent[-1][0] == "DRY RUN: Solana bot STOPPED: loss limit"
    assert sb.step(settings, tell).startswith("Dry run stopped")
    # Big drop from its best: stops even above $10
    Path("solbot_state_dry_run.json").unlink()
    price[0] = 1.0
    sig.update({"fresh_buy": "t3"})
    sb.step({**settings, "start_cash": 60}, tell)              # $30 in COIN + $30 cash
    price[0] = 1.25
    sb.step({**settings, "start_cash": 60}, tell)              # best: about $67
    price[0] = 0.85
    sig.update({"in": True, "fresh_buy": "t3"})
    sb.step({**settings, "start_cash": 60, "stop_loss": 0.9, "stop_drawdown": 0.1}, tell)
    assert sent[-1][0] == "DRY RUN: Solana bot STOPPED: big drop"


def test_solbot_pauses_at_each_checkpoint_once_then_trades_bigger(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    sb.step({**settings, "start_cash": 90}, tell)
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step({**settings, "start_cash": 90}, tell)              # $30 in COIN, $60 cash
    price[0] = 1.5                                              # account about $104: first checkpoint
    status = sb.step({**settings, "start_cash": 90}, tell)
    assert status.startswith("Stopped") and sent[-1][0].startswith("DRY RUN: Solana bot PAUSED at $100")
    assert "Next: $50.00 a trade" in sent[-1][1]
    state = json.loads(Path("solbot_state_dry_run.json").read_text())
    assert not state["positions"] and state["paper_cash"] > 100
    state.pop("stopped")                                        # you say "continue"
    Path("solbot_state_dry_run.json").write_text(json.dumps(state))
    sig.update({"in": True, "fresh_buy": "t2"})
    status = sb.step({**settings, "start_cash": 90}, tell)     # no second pause at $100; trades $50 now
    assert not status.startswith("Stopped") and any(t == "DRY RUN: BOUGHT $50.00 of COIN" for t, _ in sent)


def test_solbot_drops_dying_coins_and_adds_new_ones_like_nio(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    (tmp_path / "young.txt").write_text(f"# my list\nsol:{mint}   # COIN\nsol:DEAD222   # Halloween\n")
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 2000 if m == "DEAD222" else 1e6, "vol24": 1e6, "h6": 1,
                                                           "h24": 1, "mcap": 1e6, "name": m, "symbol": m, "age_h": 50} for m in mints})
    found = {"address": "NEW333", "name": "Newcoin", "symbol": "NEW", "age_h": 72, "liq": 90_000, "vol24": 600_000, "h24": 40}
    monkeypatch.setattr(sb, "find_coins", lambda settings, exclude, n: [found] if "NEW333" not in exclude and n > 0 else [])
    sb.step(settings, tell)
    lines = (tmp_path / "young.txt").read_text()
    assert "DEAD222" not in lines and f"sol:{mint}" in lines and "sol:NEW333   # Newcoin (NEW), found by the Solana bot" in lines
    assert "# my list" in lines
    assert any("dropped" in t for t, _ in sent) and any("now watching Newcoin" in t for t, _ in sent)
    n = len(sent)
    sb.step(settings, tell)                                     # not time to scan again yet
    assert len(sent) == n


def test_solbot_trades_xstocks_only_in_market_hours_and_at_a_fair_price(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    (tmp_path / "young.txt").write_text("")
    now = 1_800_000_000.0
    monkeypatch.setattr(sb, "xstocks", lambda state, t: [("NVDA", "XsNVDA")])
    quote = {"price": 1.0, "start": now - 3600, "end": now + 3600}
    monkeypatch.setattr(sb, "stock_quote", lambda t: dict(quote))
    monkeypatch.setattr(sb, "stock_signal", lambda t, cfg: {"in": True, "fresh_buy": "2026-11-02", "name": "NVDA (xStock)", "day": "2026-11-02"})
    st = {**settings, "stocks": True}
    quote["price"] = 1.05                                       # xStock 5% below the real stock: wait
    sb.step(st, tell, now=now)
    assert not any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)
    quote.update({"price": 1.0, "start": now + 600})            # market not open yet
    sb.step(st, tell, now=now + 1)
    assert not any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)
    quote["start"] = now - 3600
    sb.step(st, tell, now=now + 2)
    assert any(t == "DRY RUN: BOUGHT $30.00 of NVDA (xStock)" for t, _ in sent)


def test_solbot_skips_expensive_swaps_and_live_stop_writes_the_stop_file(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step({**settings, "max_cost": 0.005}, tell)              # 1% cost > 0.5% limit
    assert sent[-1][0] == "DRY RUN: Solana bot: didn't buy COIN" and "skipped" in sent[-1][1]

    class FakeLive:
        live, address = True, "WALLET"
        def __init__(self): self.usdc, self.coin = 5.0, 0
        def refresh(self): pass
        def cash(self): return self.usdc
        def sol(self): return 0.05
        def held_raw(self, m): return self.coin
        def swap(self, i, o, raw, max_cost=None): raise AssertionError("nothing to trade")
    status = sb.step({**settings, "mode": "live"}, tell, wallet=FakeLive())
    assert status.startswith("Stopped") and json.loads(Path(sb.STOP_FILE).read_text())["account"] == 5.0
    assert sb.step({**settings, "mode": "live"}, tell, wallet=FakeLive()).startswith("Stopped")
    assert sb.step({**settings, "mode": "off"}, tell).startswith("Off")


def test_solbot_signs_only_its_own_slot_and_refuses_someone_elses_swap():
    import base64
    from solders.hash import Hash
    from solders.keypair import Keypair
    from solders.message import MessageV0
    from solders.signature import Signature
    from solders.transaction import VersionedTransaction
    from bot import solbot as sb
    kp = Keypair()
    msg = MessageV0.try_compile(kp.pubkey(), [], [], Hash.default())
    unsigned = base64.b64encode(bytes(VersionedTransaction.populate(msg, [Signature.default()]))).decode()
    signed = VersionedTransaction.from_bytes(base64.b64decode(sb.sign(unsigned, kp)))
    assert signed.verify_with_results() == [True]
    with pytest.raises(sb.TradeError):
        sb.sign(unsigned, Keypair())


def test_solbot_notices_when_the_price_feed_hasnt_got_the_newest_candle(tmp_path, monkeypatch):
    import pandas as pd
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    now = 1_800_000_130.0                                       # 2:10 into a 5-minute candle
    closed = pd.Timestamp(now - now % 300 - 300, unit="s", tz="UTC")
    sig["last"] = closed - pd.Timedelta(minutes=5)              # the feed still ends one candle early
    sb.step(settings, tell, now=now)
    assert sb.stale == [f"sol:{mint}"]
    sig["last"] = closed                                        # now it has it
    sb.step(settings, tell, now=now + 30)
    assert sb.stale == []
    sig["last"] = closed - pd.Timedelta(hours=20)               # a coin nobody trades anymore: don't keep waiting
    sb.step(settings, tell, now=now + 60)
    assert sb.stale == []


def _fake_trades(monkeypatch, by_width):
    """Make the learner's replay return set trades per setting: width -> (study results, exam results)."""
    from bot import solbot_learn as sl
    t0 = pd.Timestamp("2026-10-01", tz="UTC")

    def replay(df, params, fee, stop_loss=0.2):
        study, exam = by_width[params["width"]]
        return [(t0 + pd.Timedelta(hours=i), r) for i, r in enumerate(study)] + \
               [(t0 + pd.Timedelta(days=30, hours=i), r) for i, r in enumerate(exam)]
    monkeypatch.setattr(sl, "replay", replay)
    monkeypatch.setattr(sl, "GRIDS", {"coin": {"period": [20], "width": [2.0, 3.0]}})
    monkeypatch.setattr(sl, "MIN_EXAM_TRADES", {"coin": 10})
    return sl


def test_solbot_learning_adopts_a_setting_only_if_it_wins_on_unseen_trades(monkeypatch):
    rng = np.random.default_rng(0)
    sl = _fake_trades(monkeypatch, {2.0: (list(rng.normal(-0.01, 0.02, 70)), list(rng.normal(-0.01, 0.02, 30))),
                                    3.0: (list(rng.normal(0.02, 0.02, 70)), list(rng.normal(0.02, 0.02, 30)))})
    r = sl.tune("coin", {"m": None}, {"period": 20, "width": 2.0})
    assert r["changed"] and r["params"] == {"period": 20, "width": 3.0} and r["exam_best"]["avg"] > 0
    # studied better, but worse on the newest trades: keeps the current setting
    sl = _fake_trades(monkeypatch, {2.0: (list(rng.normal(-0.01, 0.02, 70)), list(rng.normal(0.02, 0.02, 30))),
                                    3.0: (list(rng.normal(0.02, 0.02, 70)), list(rng.normal(-0.01, 0.02, 30)))})
    r = sl.tune("coin", {"m": None}, {"period": 20, "width": 2.0})
    assert not r["changed"] and r["params"]["width"] == 2.0 and "did not beat" in r["reason"]


def test_solbot_learning_saves_tells_you_and_waits_a_day(tmp_path, monkeypatch):
    rng = np.random.default_rng(1)
    sl = _fake_trades(monkeypatch, {2.0: (list(rng.normal(-0.01, 0.02, 70)), list(rng.normal(-0.01, 0.02, 30))),
                                    3.0: (list(rng.normal(0.02, 0.02, 70)), list(rng.normal(0.02, 0.02, 30)))})
    monkeypatch.setattr(sl, "MODELS", tmp_path)
    told = []
    hist = lambda m: pd.DataFrame({"close": np.ones(100), "low": np.ones(100)})
    r = sl.maybe_learn("coin", ["sol:A"], 24, 0.2, lambda t, m: told.append((t, m)), now=1e9, history=hist)
    assert r["changed"] and sl.current("coin") == {"period": 20, "width": 3.0}
    assert told and "new settings for young coins" in told[0][0] and "was: buy when the price drops 2x" in told[0][1]
    assert sl.maybe_learn("coin", ["sol:A"], 24, 0.2, lambda t, m: told.append((t, m)), now=1e9 + 3600, history=hist) is None
    from bot import learn
    from bot.config import Config
    cfg = learn.apply(Config(strategy="bollinger", timeframe="5m", strategy_params={"period": 20, "width": 2.0}))
    assert cfg.strategy_params["width"] == 3.0                  # the young-coin alerts follow what it learned


def test_solbot_benches_a_coin_after_three_losses_in_a_row(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    for k in range(3):
        price[0] = 1.0
        sig.update({"in": True, "fresh_buy": f"t{k}"})
        sb.step(settings, tell)
        price[0] = 0.98                                         # small loss, back at the average
        sig.update({"in": False, "fresh_buy": None})
        sb.step(settings, tell)
    assert f"sol:{mint}" not in (tmp_path / "young.txt").read_text()
    assert any(t == "DRY RUN: Solana bot: benched COIN111" or t.startswith("DRY RUN: Solana bot: benched") for t, _ in sent)


def test_solbot_checks_the_wallet_key_and_says_what_is_wrong_without_showing_it(tmp_path, monkeypatch):
    from solders.keypair import Keypair
    from bot import solbot as sb
    kp = Keypair()
    told, state = [], {}
    monkeypatch.setattr(sb, "balances", lambda a: {sb.USDC: {"uiAmount": 30.0}, "SOL": {"uiAmount": 0.03}})
    tell = lambda t, m: told.append((t, m))
    monkeypatch.setenv("SOLANA_BOT_KEY", f"  '{str(kp)}'\n")    # quotes and spaces around it are fine
    assert sb.check_key(state, 1e9, tell) == str(kp.pubkey())
    assert told[-1][0] == "✅ Solana bot: wallet key works" and str(kp.pubkey()) in told[-1][1] and "Ready" in told[-1][1]
    assert str(kp) not in told[-1][1]                           # never shows the key itself
    for bad, says in (("abandon " * 12, "12-word recovery phrase"), (str(kp.pubkey()), "wallet's address"),
                      ("x" * 88, "isn't a Solana private key")):
        monkeypatch.setenv("SOLANA_BOT_KEY", bad)
        sb.check_key(state, 2e9, tell)
        assert told[-1][0] == "❌ Solana bot: the wallet key didn't work" and says in told[-1][1]
    monkeypatch.delenv("SOLANA_BOT_KEY")
    assert sb.check_key(state, 3e9, tell) is None


def test_solbot_still_sells_a_coin_taken_off_the_list_but_never_buys_it_again(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(settings, tell)
    assert sent[-1][0] == "DRY RUN: BOUGHT $30.00 of COIN"
    (tmp_path / "young.txt").write_text("")                    # taken off the list while holding it
    sig.update({"in": True, "fresh_buy": "t2"})
    sb.step(settings, tell)
    assert sum(t.startswith("DRY RUN: BOUGHT") for t, _ in sent) == 1   # off the list: no new buys
    sig.update({"in": False, "fresh_buy": None})
    sb.step(settings, tell)
    assert sent[-1][0].startswith("DRY RUN: SOLD COIN")


def test_solbot_live_waits_for_the_deposit_and_only_trades_its_budget(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)

    class Wallet:
        live, address = True, "WALLET"
        def __init__(self, usdc): self.usdc, self.coin = usdc, 0
        def refresh(self): pass
        def cash(self): return self.usdc
        def sol(self): return 0.05
        def held_raw(self, m): return self.coin
        def swap(self, i, o, raw, max_cost=None):
            usd = raw / 1e6 if i == sb.USDC else raw / 1e6 * price[0]
            if i == sb.USDC:
                self.usdc -= usd
                self.coin += int(usd / price[0] * 1e6)
                return {"in": raw, "out": int(usd / price[0] * 1e6), "quoted_out": 0, "tx": "TX"}
            self.coin -= raw
            self.usdc += usd
            return {"in": raw, "out": int(usd * 1e6), "quoted_out": 0, "tx": "TX"}
    live = {**settings, "mode": "live", "budget": 30}
    status = sb.step(live, tell, wallet=Wallet(0.0))           # no deposit yet: waits, doesn't stop
    assert status.startswith("Waiting for USDC") and not Path(sb.STOP_FILE).exists()
    assert sent[-1][0] == "Solana bot is LIVE: waiting for your deposit"
    w = Wallet(500.0)                                           # a wallet with more money than the budget
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(live, tell, wallet=w)
    assert "Its budget: $30.00 USDC" in next(m for t, m in sent if t == "Solana bot connected")
    assert any(t == "BOUGHT $30.00 of COIN" for t, _ in sent) and w.usdc == 470.0
    state = json.loads(Path("solbot_state_live.json").read_text())
    assert state["cash"] == 0.0                                 # its own $30 is in the trade; your other $470 is untouched
    sig.update({"in": True, "fresh_buy": "t2"})
    price[0] = 1.0
    n = sum(t.startswith("BOUGHT") for t, _ in sent)
    sb.step(live, tell, wallet=w)
    assert sum(t.startswith("BOUGHT") for t, _ in sent) == n    # no budget left: no second buy with your money


def test_strategy_review_keeps_a_working_strategy_switches_a_failing_one_or_sits_out(monkeypatch):
    from bot import solbot_strats as ss
    t0 = pd.Timestamp("2026-11-01", tz="UTC")
    df = pd.DataFrame({"close": np.ones(400), "low": np.ones(400)},
                      index=pd.date_range(t0, periods=400, freq="30min"))
    results = {}

    def replay(d, strategy, params, fee=0.01, stop_loss=0.2, max_drop=None):
        return results.get((strategy, params.get("width"), params.get("low")), [])
    monkeypatch.setattr(ss, "replay", replay)
    monkeypatch.setattr(ss, "CANDIDATES", [("dip bounce", "bollinger", {"period": [20], "width": [2.0, 1.5], "exit": [0.0]}),
                                           ("RSI dip", "rsi_scalp", {"period": [7], "low": [25], "high": [65], "tp": [0.0], "sl": [0.0]})])
    late = lambda n, r: [(df.index[-1] - pd.Timedelta(hours=i + 1), r) for i in range(n)]
    early = lambda n, r: [(df.index[0] + pd.Timedelta(hours=i), r) for i in range(n)]
    current = {"label": "dip bounce", "strategy": "bollinger", "params": {"period": 20, "width": 2.0, "exit": 0.0}}
    results[("bollinger", 2.0, None)] = early(8, 0.02) + late(10, 0.03)          # still winning lately
    assert ss.review(df, current, [])[0] == "keep"
    assert ss.review(df, current, [-0.05, -0.05, 0.02, -0.03, 0.01])[0] != "keep"   # but its own last trades lost: re-check
    results[("bollinger", 2.0, None)] = early(8, 0.02) + late(5, 0.03) + late(5, -0.04)   # 50% lately: stopped working
    results[("rsi_scalp", None, 25)] = early(8, 0.03) + late(6, 0.04)          # another strategy wins on both halves
    d, c, why = ss.review(df, current, [])
    assert d == "switch" and c["label"] == "RSI dip" and "stopped working" in why
    results[("rsi_scalp", None, 25)] = early(8, 0.03) + late(6, -0.04)
    d, c, why = ss.review(df, current, [])
    assert d == "sit out" and c is None and "81%+" in why


def test_solbot_trades_each_coin_with_its_strategy_and_sits_out_when_none_wins(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    import bot.solbot_learn as sl_
    import bot.solbot_strats as ss
    monkeypatch.setattr(sl_, "coin_history", lambda market: pd.DataFrame())
    used = []
    monkeypatch.setattr(sb, "signal", lambda market, cfg, *a: used.append((cfg.strategy, dict(cfg.strategy_params))) or dict(sig))
    rsi = {"label": "RSI dip", "strategy": "rsi_scalp", "params": {"period": 7, "low": 25, "high": 65, "tp": 0.0, "sl": 0.0},
           "exam": {"trades": 6, "won": 0.83, "avg": 0.04}}
    monkeypatch.setattr(ss, "review", lambda df, current, live, mwr=0.81, sl=0.2, **kw: ("switch", rsi, "dip bounce stopped working"))
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(settings, tell)
    assert any(t == "DRY RUN: Solana bot: COIN111 switched to RSI dip" or "switched to RSI dip" in t for t, _ in sent)
    assert used[-1][0] == "rsi_scalp" and any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)
    state = json.loads(Path("solbot_state_dry_run.json").read_text())
    assert state["positions"][mint]["strategy"] == "rsi_scalp"                # its exit follows the strategy it was bought with
    # Nothing wins 81%+: sits out (no new buys), but still sells what it holds by its own rule
    monkeypatch.setattr(ss, "review", lambda df, current, live, mwr=0.81, sl=0.2, **kw: ("sit out", None, "nothing wins"))
    state["strats"][mint]["reviewed_at"] = 0
    Path("solbot_state_dry_run.json").write_text(json.dumps(state))
    sig.update({"in": False, "fresh_buy": None})
    sb.step(settings, tell)
    assert any("sitting out" in t for t, _ in sent) and any(t.startswith("DRY RUN: SOLD") for t, _ in sent)
    n = len(used)
    sig.update({"in": True, "fresh_buy": "t2"})
    sb.step(settings, tell)
    assert len(used) == n and sum(t.startswith("DRY RUN: BOUGHT") for t, _ in sent) == 1   # sitting out: not even checked


def test_solbot_never_benches_a_pinned_coin(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    for k in range(3):
        price[0] = 1.0
        sig.update({"in": True, "fresh_buy": f"t{k}"})
        sb.step({**settings, "bench_after_losses": 3, "pinned": [f"sol:{mint}"]}, tell)
        price[0] = 0.98
        sig.update({"in": False, "fresh_buy": None})
        sb.step({**settings, "bench_after_losses": 3, "pinned": [f"sol:{mint}"]}, tell)
    assert f"sol:{mint}" in (tmp_path / "young.txt").read_text() and not any("benched" in t for t, _ in sent)


def test_practice_account_takes_every_signal_with_the_live_strategies_and_reports_daily(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    live = {**settings, "mode": "live", "practice": {"enabled": True, "cash": 300, "per_trade": 30}}
    ps = sb.practice_settings(live)
    assert ps["mode"] == "practice" and ps["tiers"] == [{"per_trade": 30.0}] and not ps["pause_at"]
    assert sb.practice_settings({**live, "mode": "dry_run"}) is None
    rsi = {"label": "RSI dip", "strategy": "rsi_scalp", "params": {"period": 7, "low": 25, "high": 65, "tp": 0.0, "sl": 0.0}}
    Path("solbot_state_live.json").write_text(json.dumps({"strats": {mint: rsi}}))
    used = []
    monkeypatch.setattr(sb, "signal", lambda market, cfg, *a: used.append(cfg.strategy) or dict(sig))
    called = []
    monkeypatch.setattr(sb, "find_coins", lambda *a: called.append(1) or [])
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(ps, tell)
    assert used == ["rsi_scalp"] and not called                        # live bot's strategy; never searches or edits the list
    price[0] = 1.05
    sig.update({"in": False, "fresh_buy": None})
    sb.step(ps, tell)
    state = json.loads(Path("solbot_state_practice.json").read_text())
    assert [t["action"] for t in state["trades"]] == ["BUY", "SELL"] and state["trades"][0]["usd"] == 30.0
    title, msg = sb.practice_report(state, state["trades"][-1]["t"] + 60, 24, {"cash": 26.73, "trades": []})
    assert title.startswith("📊 Daily report: practice 1-0") and "COIN: 1-0" in msg
    assert msg.startswith("REAL bot: 0 trades") and "$26.73" in msg
    # 3 pm in New York, once a day
    from datetime import datetime
    from zoneinfo import ZoneInfo
    mke = lambda d, h, m: datetime(2026, 11, d, h, m, tzinfo=ZoneInfo("America/Chicago")).timestamp()
    assert sb.report_due(mke(5, 14, 59), "15:00") is None                         # Thursday Nov 5, before 3 pm
    assert sb.report_due(mke(5, 15, 0), "15:00", days=["Thursday"]) == "2026-11-05"
    assert sb.report_due(mke(5, 18, 0), "15:00", last_day="2026-11-05", days=["Thursday"]) is None   # once
    assert sb.report_due(mke(4, 15, 30), "15:00", days=["Thursday"]) is None        # Wednesday: no report


def test_rug_check_blocks_printable_freezable_flagged_and_whale_coins(monkeypatch):
    from bot import solbot as sb
    report = {}

    class R:
        def json(self): return report
    monkeypatch.setattr("requests.get", lambda *a, **k: R())
    good = {"rugged": False, "mintAuthority": None, "freezeAuthority": None, "transferFee": {"pct": 0}, "risks": [],
            "knownAccounts": {"POOL": {"type": "AMM"}},
            "topHolders": [{"address": "POOL", "owner": "x", "pct": 60}, {"address": "a", "owner": "a", "pct": 5}]}
    report.update(good)
    assert sb.safety_check("M") == (True, "passed the rug check")              # the 60% is the trading pool: fine
    for change, says in (({"mintAuthority": "abc"}, "print more"), ({"freezeAuthority": "abc"}, "freeze"),
                         ({"rugged": True}, "rugged"), ({"transferFee": {"pct": 5}}, "fee on every transfer"),
                         ({"risks": [{"name": "Copycat token", "level": "danger"}]}, "Copycat"),
                         ({"topHolders": [{"address": "w", "owner": "w", "pct": 35}]}, "one wallet owns 35%")):
        report.clear(); report.update({**good, **change})
        ok, why = sb.safety_check("M")
        assert not ok and says in why, (change, why)


def test_solbot_wont_buy_an_unsafe_coin_or_a_falling_knife_or_while_sol_crashes(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (False, "one wallet owns 40% of it"))
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(settings, tell)
    assert not any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent) and any("won't buy COIN" in t for t, _ in sent)
    # falling knife: down 10%+ in 6 hours
    idx = pd.date_range("2026-11-01", periods=100, freq="5min", tz="UTC")
    knife = pd.DataFrame({"close": np.r_[np.ones(28), np.linspace(1, 0.85, 72)]}, index=idx)
    assert sb.falling(knife, 0.10) and not sb.falling(knife, 0.20) and not sb.falling(knife, None)
    # SOL down 3%+ in the last hour: no coin buys
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    import bot.signals as sg
    sol = pd.DataFrame({"close": np.r_[np.ones(20) * 100, np.linspace(100, 95, 13)]})
    monkeypatch.setattr(sg, "fetch_candles", lambda m, tf: sol)
    sig.update({"in": True, "fresh_buy": "t2"})
    sb.step({**settings, "market_drop_1h": 0.03}, tell)
    assert not any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)


def test_solbot_guard_sells_at_the_stop_within_seconds_and_on_a_pool_money_drop(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    assert sb.step(settings, tell, guard=True) == "guard: nothing held"
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(settings, tell)
    assert any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)
    price[0] = 0.78                                                  # a crash between the 5-minute checks
    status = sb.step(settings, tell, guard=True)
    assert "sold 1" in status and any(t.startswith("DRY RUN: SOLD") and "Stop-loss" in m for t, m in sent)
    # the pool loses 40% of its money while holding: sold at once
    price[0] = 1.0
    sig.update({"in": True, "fresh_buy": "t2"})
    sb.step(settings, tell)
    liq = [1e6]
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": liq[0], "vol24": 1e6, "h6": 1, "h24": 1, "mcap": 1e6,
                                                           "name": m, "symbol": m, "age_h": 50} for m in mints})
    sb.step(settings, tell, guard=True)
    liq[0] = 6e5
    sb.step(settings, tell, guard=True)
    assert "possible rug pull" in sent[-1][1] and sent[-1][0].startswith("DRY RUN: SOLD")


def test_each_coin_gets_the_falling_knife_filter_only_if_it_helps_on_that_coin(monkeypatch):
    from bot import solbot_strats as ss
    df = pd.DataFrame({"close": np.ones(400), "low": np.ones(400)},
                      index=pd.date_range("2026-11-01", periods=400, freq="30min", tz="UTC"))
    late = lambda n, r: [(df.index[-1] - pd.Timedelta(hours=i + 1), r) for i in range(n)]
    with_filter, without = late(4, 0.02), late(10, 0.03)           # NIO-like: skipping falling dips throws away winners
    monkeypatch.setattr(ss, "replay", lambda d, st, p, fee=0.01, stop_loss=0.2, max_drop=None: with_filter if max_drop else without)
    current = {"label": "dip bounce", "strategy": "bollinger", "params": {"period": 20, "width": 2.0}}
    d, c, why = ss.review(df, current, [], max_drop=0.10)
    assert d == "keep" and c["max_drop"] is None and "10 trades" in why
    with_filter, without = late(8, 0.03), late(10, 0.03) + late(6, -0.05)   # FLOAT-like: the filter skips the losers
    d, c, why = ss.review(df, current, [], max_drop=0.10)
    assert d == "keep" and c["max_drop"] == 0.10
    # once it chose "off", later reviews still re-test "on": a crash the filter would have skipped flips it back
    current = {**current, "max_drop": None}
    with_filter, without = late(5, 0.06), late(9, 0.04) + [(df.index[-1] - pd.Timedelta(hours=2), -0.216)]   # NIO, Nov 3
    d, c, why = ss.review(df, current, [], max_drop=0.10)
    assert d == "keep" and c["max_drop"] == 0.10 and "filter off: 10 trades" in why
    with_filter, without = late(5, 0.03), late(5, 0.03)                    # a tie keeps what it uses now
    d, c, why = ss.review(df, current, [], max_drop=0.10)
    assert c["max_drop"] is None and "filter on:" not in why


def test_kalshi_bracket_odds_fees_and_dates():
    from bot import kalshi as k
    assert k.fee(0.50) == 0.02 and k.fee(0.50, 10) == 0.18 and k.fee(0.95) == 0.01
    assert k.event_day("KXHIGHCHI-26NOV03") == __import__("datetime").date(2026, 11, 3)
    assert k.station_of("recorded at Chicago (CLIMDW) for Nov 3") == "KMDW" and k.station_of("Toronto") is None
    between = {"strike_type": "between", "floor_strike": 73, "cap_strike": 74}
    less = {"strike_type": "less", "cap_strike": 71}
    more = {"strike_type": "greater", "floor_strike": 78}
    assert abs(k.bracket_prob(between, 73.5, 1.0) - 0.68) < 0.01                    # 72.5-74.5 around 73.5
    total = sum(k.bracket_prob({"strike_type": "between", "floor_strike": a, "cap_strike": a + 1}, 74, 2.0) for a in range(71, 78, 2))
    assert abs(total + k.bracket_prob(less, 74, 2.0) + k.bracket_prob(more, 74, 2.0) - 1) < 1e-9   # brackets add up to 100%
    assert k.bracket_prob(less, 74, 1.0, floor_f=72.0) == 0.0                     # 72°+ already recorded: "70 or below" is dead


def test_kalshi_weather_view_uses_what_was_recorded_the_models_and_the_rest_of_the_day(monkeypatch):
    from datetime import date, datetime, timezone
    from bot import kalshi as k
    monkeypatch.setattr(k, "_PRIORS", {})                 # no backtest measurements for the station here
    info = {"tz": "America/Chicago"}
    b = lambda lo, hi: {"strike_type": "between", "floor_strike": lo, "cap_strike": hi}
    # 3 pm, the high came overnight (66°) and the forecast is only 59°: the answer is basically in
    afternoon = datetime(2026, 11, 3, 21, 0, tzinfo=timezone.utc)
    v = k.weather_view(date(2026, 11, 3), info, "KMDW", afternoon, {"2026-11-03": 59}, {"KMDW": (66.0, True)})
    assert k.bracket_prob(b(65, 66), v["mu"], v["sigma"], v["floor"]) > 0.95 and "66° already recorded" in v["why"]
    # 8 am: forecast-driven, wide, can't end below what's recorded (whole-°C readings: ~1°F looser)
    morning = datetime(2026, 11, 3, 14, 0, tzinfo=timezone.utc)
    v = k.weather_view(date(2026, 11, 3), info, "KMDW", morning, {"2026-11-03": 73}, {"KMDW": (60.0, False)})
    assert v["mu"] == 73 and v["sigma"] > 1.5 and abs(v["floor"] - 59.1) < 1e-9
    # the rest of the day from the models' hourly forecasts
    hourly = [[afternoon.timestamp() + 3600, {"ecmwf_ifs025": 70.0, "gfs_seamless": 72.0}],
              [afternoon.timestamp() - 7200, {"ecmwf_ifs025": 99.0}]]          # earlier hours don't count
    v = k.weather_view(date(2026, 11, 3), info, "KMDW", afternoon, {}, {"KMDW": (66.0, True)}, {"hourly": hourly})
    assert v["mu"] == 71 and "2 models" in v["why"]
    # tomorrow: the average of every forecast, as sure as the models agree (or the usual error, if wider)
    models = {"daily": {"2026-11-04": {"ecmwf_ifs025": 62.0, "gfs_seamless": 66.0}}}
    v = k.weather_view(date(2026, 11, 4), info, "KMDW", morning, {"2026-11-04": 64}, {}, models)
    assert v["mu"] == 64 and v["sigma"] == 2.0 and v["floor"] is None and "3 forecasts" in v["why"]
    # it learned this station runs 2° cold: shifts the forecast up (blended with the prior: 10 days -> 2/3 of it)
    v = k.weather_view(date(2026, 11, 4), info, "KMDW", morning, {"2026-11-04": 64}, {}, models, {"d1": [2.0] * 10})
    assert abs(v["mu"] - (64 + 2 * 10 / 15)) < 1e-9 and "corrected" in v["why"]


def test_kalshi_reads_the_station_reports_like_the_official_high():
    from datetime import datetime, timezone
    from bot import kalshi as k
    assert k.metar_temp_f("KAUS 011925Z AUTO 13008KT 10SM CLR 29/14 A3001 RMK T02890144 MADISHF") == 84.0
    assert k.metar_temp_f("KMSP 031253Z 00000KT 10SM CLR M02/M05 A3012 RMK AO2") == 28.4      # no T-group: whole °C
    start, end = datetime(2026, 11, 1, 6, tzinfo=timezone.utc), datetime(2026, 11, 2, 6, tzinfo=timezone.utc)
    t = start.timestamp()
    readings = [[t + 13 * 3600, 84.02, "ob"], [t + 18 * 3600, 86.0, "max6"],     # 6-hour high sent at 6 pm: 86
                [t - 600, 90.0, "ob"],                                           # before the day: doesn't count
                [t + 3 * 3600, 95.0, "max6"]]                                    # its 6 hours started the day before
    assert k.recorded_high(readings, start, end) == 86.0
    assert k.recorded_high(readings, start, end, now=t + 17 * 3600) == 84.0      # before the 6 pm report
    assert k.recorded_high([], start, end) is None
    assert k.recorded_high([[t + 3600, 87.8, "ob"]], start, end) == 87.0           # 31°C: could be 86.9-88.6°F


def test_kalshi_grades_its_forecasts_and_reads_the_models(monkeypatch):
    from datetime import datetime, timezone
    from bot import kalshi as k
    state = {"stations": {"KMDW": {"tz": "America/Chicago", "state": "IL"}},
             "fc_log": {"KMDW": {"2026-11-03": {"d1": 70.0, "d0": 72.5}, "2026-11-05": {"d1": 60.0}}}}
    monkeypatch.setattr(k, "iem_day_max", lambda st, info, day: 73.0)
    k.grade_forecasts(state, datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc))
    assert state["calib"]["KMDW"] == {"d1": [3.0], "d0": [0.5]} and list(state["fc_log"]["KMDW"]) == ["2026-11-05"]
    bias, err, n = k.learned({"d1": [3.0] * 5}, "d1")
    assert n == 5 and bias == 1.5 and err > 2.0

    class R:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"daily": {"time": [1793685600], "temperature_2m_max_ecmwf_ifs025": [73.4], "temperature_2m_max_gfs_seamless": [None]},
                    "hourly": {"time": [1793700000], "temperature_2m_ecmwf_ifs025": [71.0], "temperature_2m_gfs_seamless": [72.0]}}
    monkeypatch.setattr("requests.get", lambda *a, **kw: R())
    got = k.model_forecasts({"lat": 41.8, "lon": -87.8, "tz": "America/Chicago"})
    assert got["daily"] == {"2026-11-03": {"ecmwf_ifs025": 73.4}}
    assert got["hourly"] == [[1793700000, {"ecmwf_ifs025": 71.0, "gfs_seamless": 72.0}]]


def test_kalshi_practice_buys_an_edge_settles_it_and_finds_arbitrage(tmp_path, monkeypatch):
    from bot import kalshi as k
    monkeypatch.chdir(tmp_path)
    ev = {"event_ticker": "KXHIGHCHI-26NOV03", "title": "Highest temperature in Chicago on Nov 3, 2026?", "mutually_exclusive": True,
          "markets": [{"ticker": "T1", "strike_type": "less", "cap_strike": 73, "yes_sub_title": "72° or below",
                       "yes_ask_dollars": "0.30", "yes_ask_size_fp": "50", "no_ask_dollars": "0.72", "no_ask_size_fp": "50",
                       "rules_primary": "(CLIMDW)"},
                      {"ticker": "T2", "strike_type": "greater", "floor_strike": 72, "yes_sub_title": "73° or above",
                       "yes_ask_dollars": "0.60", "yes_ask_size_fp": "50", "no_ask_dollars": "0.42", "no_ask_size_fp": "50"}]}
    arbs = k.arb_ideas([ev], {"arb_margin": 0.02})
    assert arbs and arbs[0]["side"] == "yes" and abs(arbs[0]["cost"] - 0.94) < 1e-9   # 30 + 60 + fees 4 = 94¢ for a sure $1
    monkeypatch.setattr(k, "weather_views", lambda *a, **kw: [])
    told = []
    status = k.step({"mode": "practice", "practice_cash": 100, "max_per_trade": 5}, lambda t, m: told.append((t, m)), events=[ev])
    assert "bought 1" in status and any("arbitrage" in t for t, _ in told)
    state = json.loads(Path("kalshi_state_practice.json").read_text())
    assert set(state["positions"]) == {"T1", "T2"} and state["positions"]["T1"]["count"] == 5
    monkeypatch.setattr(k, "kget", lambda path, params=None: {"market": {"status": "finalized", "result": "yes" if path.endswith("T2") else "no"}})
    k.step({"mode": "practice"}, lambda t, m: told.append((t, m)), events=[])
    state = json.loads(Path("kalshi_state_practice.json").read_text())
    cost = 5 * 0.90 + k.fee(0.30, 5) + k.fee(0.60, 5)                                     # fees round once per order
    assert not state["positions"] and abs(state["cash"] - (100 - cost + 5)) < 1e-6 and cost < 4.70   # paid $5 for $4.67
    assert sum("WON" in t for t, _ in told) == 1 and sum("LOST" in t for t, _ in told) == 1


def test_kalshi_strategies_follow_their_own_rules_and_keep_their_own_accounts(tmp_path, monkeypatch):
    from bot import kalshi as k
    monkeypatch.chdir(tmp_path)
    mk = lambda t, kind, lo, hi, ya, na: {"ticker": t, "strike_type": kind, "floor_strike": lo, "cap_strike": hi,
                                          "yes_sub_title": t, "yes_ask_dollars": str(ya), "yes_ask_size_fp": "100",
                                          "no_ask_dollars": str(na), "no_ask_size_fp": "100"}
    ev = {"event_ticker": "KXHIGHCHI-26NOV04", "title": "Chicago high Nov 4?", "markets": [
        mk("LOW", "less", None, 70, 0.15, 0.86),         # bot: ~5%: a long shot the crowd overpays for
        mk("MID", "between", 70, 71, 0.62, 0.40),         # bot: ~79%: a favorite it likes even more
        mk("HIGH", "greater", 71, None, 0.30, 0.72)]}     # bot: ~15%
    view = {"mu": 71.0, "sigma": 0.6, "floor": None, "late": False, "tomorrow": True, "why": "test"}
    rules = {key: v["rules"] for key, v in k.strategies({}).items()}
    pick = lambda key, late=False: [(i["ticker"], i["side"]) for i in k.ideas_from_views([(ev, {**view, "late": late})], rules[key])]
    assert pick("A") == [("MID", "yes")]                                            # the market's favorite, at 62c
    assert k.ideas_from_views([(ev, {**view, "tomorrow": False})], rules["A"]) == []  # tomorrow's markets only
    cheap = {**ev, "markets": [{**ev["markets"][1], "yes_ask_dollars": "0.55", "no_ask_dollars": "0.47"}, ev["markets"][2]]}
    assert k.ideas_from_views([(cheap, view)], rules["A"]) == []                    # a 55c favorite: outside 60-80c
    assert ("MID", "yes") in pick("B")                                              # the weather models like it too
    fav = k.ideas_from_views([(ev, view)], rules["C"])
    assert ("MID", "yes") in pick("C") and all(i["price"] >= 0.60 for i in fav)       # favorites: 60c+ sides only
    assert pick("D") == [] and pick("D", late=True)                                  # late-day only after 3 pm today
    assert pick("E") and all(side == "no" for _, side in pick("E"))                  # fade: NO only
    assert pick("F") == [("MID", "yes")] and pick("G") == [("MID", "yes")]           # the models agree; 62c is in 60-65c
    warm = {**view, "mu": 73.5}                                                      # the models now favor HIGH
    assert k.ideas_from_views([(ev, warm)], rules["A"]) and not k.ideas_from_views([(ev, warm)], rules["F"])
    pricey = {**ev, "markets": [ev["markets"][0], {**ev["markets"][1], "yes_ask_dollars": "0.70", "no_ask_dollars": "0.32"},
                                ev["markets"][2]]}
    assert k.ideas_from_views([(pricey, view)], rules["A"]) and not k.ideas_from_views([(pricey, view)], rules["G"])
    monkeypatch.setattr(k, "weather_views", lambda events, now, state: [(ev, view)])
    told = []
    k.step({"mode": "practice", "practice_cash": 100}, lambda t, m: told.append(t), events=[ev])
    state = json.loads(Path("kalshi_state_practice.json").read_text())
    assert state["positions"] and set(state["variants"]) == {"B", "C", "D", "E", "F", "G", "R", "M"}
    assert state["variants"]["E"]["positions"] and all(p["side"] == "no" for p in state["variants"]["E"]["positions"].values())
    assert sum("Kalshi: bought" in t for t in told) == len(state["positions"])        # only A pings per trade
    title, msg = k.scoreboard(state, k.strategies({}))
    assert title.startswith("📊 Kalshi scoreboard") and "E. Fade long shots" in msg and "0 settled" in msg


def test_kalshi_backtest_reads_history_and_scores_strategies(monkeypatch):
    from datetime import datetime, timezone
    from bot import kalshi as k, kalshi_backtest as kb
    at = datetime(2026, 11, 2, 18, tzinfo=timezone.utc)
    candles = lambda ya, yb: [{"end_period_ts": int(at.timestamp()) - 3600, "yes_ask": {"close_dollars": str(ya)}, "yes_bid": {"close_dollars": str(yb)}},
                              {"end_period_ts": int(at.timestamp()) + 3600, "yes_ask": {"close_dollars": "0.99"}, "yes_bid": {"close_dollars": "0.98"}}]
    monkeypatch.setattr(k, "kget", lambda path, params=None: {"market_tickers": ["LOW", "MID"],
                                                               "market_candlesticks": [candles(0.20, 0.18), candles(0.55, 0.50)]})
    assert kb.prices_at("KXHIGHCHI", "KXHIGHCHI-26NOV03", at) == {"LOW": (0.20, 0.82), "MID": (0.55, 0.50)}   # no later candles

    class R:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            t = int(datetime(2026, 11, 3, 18, tzinfo=timezone.utc).timestamp())
            return {"hourly": {"time": [t, t + 3600], "temperature_2m_previous_day1_ecmwf_ifs025": [70.0, 72.0],
                               "temperature_2m_previous_day1_gfs_seamless": [71.0, None]}}
    monkeypatch.setattr("requests.get", lambda *a, **kw: R())
    got = kb.past_day_ahead({"lat": 1, "lon": 1, "tz": "America/Chicago"}, at.date(), at.date())
    assert sorted(got["2026-11-03"]) == [71.0, 72.0]                                 # each model's high for the day
    mk = lambda t, kind, lo, hi, ya, na, res: {"ticker": t, "strike_type": kind, "floor_strike": lo, "cap_strike": hi,
                                               "yes_sub_title": t, "yes_ask_dollars": ya, "no_ask_dollars": na,
                                               "yes_ask_size_fp": 100, "no_ask_size_fp": 100, "result": res}
    rows = [{"event": {"event_ticker": f"KXHIGHCHI-26NOV{d:02d}", "title": "x", "markets": [
                mk("LOW", "less", None, 70, 0.15, 0.86, "no"), mk("MID", "between", 70, 71, 0.55, 0.47, "yes"),
                mk("HIGH", "greater", 71, None, 0.30, 0.72, "no")]},
             "station": "KMDW", "day": f"2026-11-{d:02d}", "mu": 71.0, "spread": 0.0, "models": 6, "actual": 71.0} for d in (1, 2, 3)]
    out = kb.simulate(rows, k.strategies({}), sigma=0.8)
    assert out["B"]["trades"] == 3 and out["B"]["wins"] == 3 and out["B"]["profit"] > 0
    assert out["A"]["trades"] == 0                                    # the favorite costs 55c: under A's 60c
    table, ll = kb.calibration(rows, 0.8)
    assert table and ll > 0
    text = kb.report(rows, k.strategies({}))
    assert "3 settled city-days" in text and "best sigma" in text and "WITH the bias correction" in text and "E. Fade long shots" in text


def test_kalshi_backtest_bias_correction_only_uses_earlier_days_and_seeds_city_priors(tmp_path, monkeypatch):
    from bot import kalshi as k, kalshi_backtest as kb
    rows = [{"station": "KMDW", "day": f"2026-10-{d:02d}", "mu": 70.0, "actual": 72.0, "spread": 0.0, "models": 6,
             "event": {"event_ticker": "x", "markets": []}} for d in range(1, 11)]
    c = kb.corrected(rows)
    assert c[0]["bias"] == 0.0                                    # day 1: nothing known yet
    assert 1.5 < c[-1]["bias"] <= 2.0                              # later: learned the +2° from earlier days only
    pri = kb.city_priors(rows)
    assert pri == {"KMDW": {"bias": 2.0, "err": 2.0, "n": 10}}
    monkeypatch.chdir(tmp_path)
    Path("models").mkdir()
    Path("models/kalshi_priors.json").write_text(json.dumps(pri))
    monkeypatch.setattr(k, "_PRIORS", None)
    bias, err, n = k.learned({}, "d1", "KMDW")
    assert (bias, err, n) == (2.0, 2.0, 10)                        # the live bot starts from the backtest's measurement
    assert k.learned({}, "d1", "KDEN") == (0.0, k.PRIOR["d1"], 0)  # unknown city: the default


def test_kalshi_sameday_learns_where_the_official_high_ends_and_trades_it():
    from datetime import date, timedelta
    from bot import kalshi_sameday as sd
    data = {"readings": {"KXXX": {}}, "days": {}}
    for i in range(40):                                   # 40 days: readings top out at 80 by 3 pm, official is 81
        day = (date(2026, 10, 1) + timedelta(days=i)).isoformat()
        start = 1790000000 + i * 86400
        obs = [[start + h * 3600, 60.0 + 4 * h if h <= 5 else 80.0 - (h - 15) * 1.5 if h >= 15 else 80.0, "ob"]
               for h in range(0, 24)]
        data["readings"]["KXXX"][day] = obs
        markets = [{"ticker": f"E{i}-B79.5", "strike_type": "between", "floor_strike": 79, "cap_strike": 80, "result": "no", "value": "81.00"},
                   {"ticker": f"E{i}-B81.5", "strike_type": "between", "floor_strike": 81, "cap_strike": 82, "result": "yes", "value": "81.00"}]
        candles = {f"E{i}-B79.5": [[start + h * 3600, 0.60, 0.58] for h in range(24)],      # the market thinks 80 is it
                   f"E{i}-B81.5": [[start + h * 3600, 0.35, 0.33] for h in range(24)]}
        data["days"][f"E{i}"] = {"station": "KXXX", "day": day, "tz": "UTC", "start": start, "end": start + 86400,
                                 "markets": markets, "candles": candles}
    snaps = sd.snapshots(data)
    late = [s for s in snaps if s["hour"] == 17]
    assert len(late) == 40 and late[0]["floor"] == 80 and late[0]["drop"] == 3.0 and late[0]["official"] == 81
    model = sd.fit(snaps)
    m = data["days"]["E0"]["markets"][1]
    assert sd.chance(model, 17, 3.0, 80.0, m) > 0.9                    # learned: it ends 1° above what's recorded
    assert sd.chance(model, 17, 3.0, 80.0, m, min_n=50) is None        # not enough days for this hour: no opinion
    o = sd.simulate(snaps)
    assert o["trades"] >= 40 and o["profit"] > 0
    bought = {(t["ticker"].split("-")[1], t["side"]) for t in o["list"]}
    assert bought == {("B81.5", "yes"), ("B79.5", "no")}               # buys the real bracket and fades the market's pick
    assert "same-day backtest" in sd.report(data)


def test_kalshi_new_strategy_lineup_restarts_practice_accounts_and_says_so(tmp_path, monkeypatch):
    import json
    from pathlib import Path
    from bot import kalshi as k
    monkeypatch.chdir(tmp_path)
    Path("kalshi_state_practice.json").write_text(json.dumps({"cash": 42.0, "start": 100.0, "positions": {"OLD": {}},
                                                              "variants": {"B": {"cash": 1.0}}, "series": ["KXHIGHCHI"]}))
    monkeypatch.setattr(k, "weather_views", lambda events, now, state: [])
    monkeypatch.setattr("bot.solbot.report_due", lambda *a, **kw: None)   # not during the real Thursday report time
    told = []
    k.step({"mode": "practice", "practice_cash": 100}, lambda t, m: told.append((t, m)), events=[])
    state = json.loads(Path("kalshi_state_practice.json").read_text())
    assert state["cash"] == 100 and not state["positions"] and state["variants"]["B"]["cash"] == 100
    assert state["series"] == ["KXHIGHCHI"] and state["lineup"] == k.LINEUP           # what it learned is kept
    assert len(told) == 1 and "Market favorites" in told[0][1] and "E. Fade long shots" in told[0][1]
    k.step({"mode": "practice", "practice_cash": 100}, lambda t, m: told.append((t, m)), events=[])
    assert len(told) == 1                                                              # said once


def test_sharp_drop_rule_buys_the_flush_and_sells_on_the_bounce_or_after_its_time():
    from bot.strategies import build_strategy
    close = [1.0] * 10 + [0.95, 0.90, 0.85, 0.79, 0.78] + [0.80] * 3 + [0.90]
    high = list(close)
    df = pd.DataFrame({"close": close, "high": high, "low": close}, index=pd.date_range("2026-11-03", periods=len(close), freq="5min"))
    s = build_strategy("flush", {"n": 6, "drop": 0.20, "tp": 0.12, "hold": 72}).signals(df).tolist()
    assert s[13] == 1 and sum(s[:13]) == 0                    # -21% within 6 candles: in at 0.79
    assert s[17] == 1 and s[18] == 0                          # back to 0.90 (+14%): out
    flat = pd.DataFrame({"close": [1.0] * 10 + [0.79] + [0.80] * 6, "high": [1.0] * 10 + [0.79] + [0.80] * 6,
                         "low": [0.79] * 17}, index=pd.date_range("2026-11-03", periods=17, freq="5min"))
    t = build_strategy("flush", {"n": 6, "drop": 0.20, "tp": 0.12, "hold": 4}).signals(flat).tolist()
    assert t[10:14] == [1, 1, 1, 1] and t[14] == 0            # no bounce: out after its 4 candles


def test_sharp_drop_account_trades_the_same_coins_with_its_own_rule_and_never_touches_the_list(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    live = {**settings, "mode": "live", "flush": {"enabled": True, "cash": 300, "per_trade": 30, "drop": 0.2, "minutes": 30,
                                                 "take_profit": 0.12, "hours": 6}, "max_drop_6h": 0.10, "market_drop_1h": 0.03,
            "bench_after_losses": 1}
    fs = sb.flush_settings(live)
    assert fs["mode"] == "flush" and fs["tiers"] == [{"per_trade": 30.0}] and fs["bench_after_losses"] == 0 and not fs["market_drop_1h"]
    assert sb.flush_settings({**live, "mode": "dry_run"}) is None and sb.flush_settings({**live, "flush": {}}) is None
    assert sb.practice_settings({**live, "practice": {"enabled": True}})["bench_after_losses"] == 0
    Path("solbot_state_live.json").write_text(json.dumps({"strats": {mint: {"label": "dip bounce", "strategy": "bollinger",
                                                                           "params": {"period": 20, "width": 2.0}}}}))
    used = []
    monkeypatch.setattr(sb, "signal", lambda market, cfg, max_drop=None: used.append((cfg.strategy, cfg.strategy_params, max_drop)) or dict(sig))
    sig.update({"in": True, "fresh_buy": "t1"})
    sb.step(fs, tell)
    assert used[0] == ("flush", {"n": 6, "drop": 0.2, "tp": 0.12, "hold": 72}, None)    # its own rule, no falling-knife filter
    assert any(t.startswith("SHARP-DROP PRACTICE: BOUGHT $30.00 of COIN") for t, _ in sent)
    price[0] = 0.9
    sig.update({"in": False, "fresh_buy": None})
    sb.step(fs, tell)                                         # a loss, and bench_after_losses was 1 in the live settings...
    state = json.loads(Path("solbot_state_flush.json").read_text())
    assert [t["action"] for t in state["trades"]] == ["BUY", "SELL"] and state["trades"][1]["result"] < 0
    assert mint in Path(settings["watchlist"]).read_text()    # ...but a pretend account never removes a coin
    assert not Path("solbot_state_practice.json").exists()    # its own account
    title, msg = sb.practice_report({"trades": []}, state["trades"][-1]["t"] + 60, 24, {"cash": 20, "trades": []}, state)
    assert "SHARP-DROP PRACTICE" in msg and "1 trades, 0-1" in msg and "0% won" in msg


def test_live_bot_only_buys_dips_in_coins_up_20_percent_over_24h_and_practice_still_takes_every_signal(tmp_path, monkeypatch):
    price = [1.0]
    sb, mint, sig, settings, tell, sent = _solbot_fakes(monkeypatch, tmp_path, price)
    settings = {**settings, "min_up_24h": 0.20}
    sb.step(settings, tell)
    sig.update({"in": True, "fresh_buy": "t1", "up_24h": -0.41})          # NIO on Nov 4: still crashing
    sb.step(settings, tell)
    assert not any("BOUGHT" in t for t, _ in sent)
    sig.update({"fresh_buy": "t2", "up_24h": None})                       # not 24 h of candles yet: can't tell, skip
    sb.step(settings, tell)
    assert not any("BOUGHT" in t for t, _ in sent)
    sig.update({"fresh_buy": "t3", "up_24h": 0.35})                       # a strong uptrend: buys
    sb.step(settings, tell)
    assert any(t.startswith("DRY RUN: BOUGHT") for t, _ in sent)
    live = {**settings, "mode": "live", "practice": {"enabled": True}, "flush": {"enabled": True}}
    assert sb.practice_settings(live)["min_up_24h"] == 0 and sb.flush_settings(live)["min_up_24h"] == 0


def test_signal_reports_how_much_the_coin_moved_over_24h(monkeypatch):
    from bot import solbot as sb
    from bot.config import Config
    df = pd.DataFrame({"close": np.r_[np.ones(11), np.linspace(1, 1.5, 289)]}, index=pd.date_range("2026-11-03", periods=300, freq="5min"))
    df = df.assign(open=df.close, high=df.close, low=df.close, volume=1.0)
    monkeypatch.setattr("bot.signals.fetch_onchain_candles", lambda market, tf: df)
    cfg = Config.load(str(Path(__file__).parent.parent / "config.young.yaml"))
    s = sb.signal("sol:COIN111", cfg)
    assert abs(s["up_24h"] - 0.5) < 1e-9                                  # 1.00 -> 1.50 over the last 288 candles
    monkeypatch.setattr("bot.signals.fetch_onchain_candles", lambda market, tf: df.iloc[-100:])
    assert sb.signal("sol:COIN111", cfg)["up_24h"] is None                # under 24 h of candles


def _tx(signer, changes, err=None, other_signer=None):
    """A minimal parsed Solana transaction: `changes` = [(owner, mint, before, after)]."""
    keys = [{"pubkey": other_signer or signer, "signer": True}, {"pubkey": "POOL", "signer": False}]
    pre = [{"accountIndex": i, "mint": m, "owner": o, "uiTokenAmount": {"uiAmount": a}} for i, (o, m, a, _) in enumerate(changes)]
    post = [{"accountIndex": i, "mint": m, "owner": o, "uiTokenAmount": {"uiAmount": b}} for i, (o, m, _, b) in enumerate(changes)]
    return {"transaction": {"message": {"accountKeys": keys}}, "meta": {"err": err, "preTokenBalances": pre, "postTokenBalances": post}}


def test_smart_wallets_read_who_bought_and_sold_and_find_bottom_buyers_who_sold_the_top():
    from bot import smart_wallets as sw
    from bot import copytrade as ct
    usdc = sw.USDC
    buy = _tx("ALICE", [("ALICE", "COIN", 0, 1000), ("POOL", "COIN", 5000, 4000), ("ALICE", usdc, 50, 40)])
    assert sw.swap_of(buy, "COIN") == ("ALICE", 1000)
    assert sw.swap_of(_tx("RELAY", [("BOB", "COIN", 0, 10)]), "COIN") is None                  # signed by someone else
    assert sw.swap_of(_tx("ALICE", [("ALICE", "COIN", 0, 10)], err={"x": 1}), "COIN") is None   # failed
    assert ct.wallet_swaps(buy, "ALICE") == [("COIN", 1000)]                                  # what it paid with doesn't count
    assert ct.wallet_swaps(_tx("RELAY", [("ALICE", "COIN", 0, 10)]), "ALICE") == []
    # a pump: 1.0 for a day, down to 0.5, then up to 2.0
    idx = pd.date_range("2026-11-01", periods=600, freq="5min", tz="UTC")
    close = np.r_[np.ones(200), np.full(50, 0.5), np.linspace(0.5, 2.0, 200), np.full(150, 1.8)]
    df = pd.DataFrame({"open": close, "high": close, "low": close, "close": close, "volume": 1.0}, index=idx)
    ps = sw.pumps(df)
    assert len(ps) == 1 and abs(ps[0]["gain"] - 3.0) < 1e-9 and ps[0]["low"] == 0.5 and ps[0]["high"] == 2.0
    p = ps[0]
    lo, hi = p["low_t"], p["high_t"]
    trades = [(lo + 600, "SMART", 100.0), (hi - 600, "SMART", -80.0),           # bought $50 at 0.5, sold 80 at ~2.0
              (lo + 600, "LATE", 100.0), (hi + 6 * 3600, "LATE", -100.0),       # sold outside the top window: unknown
              (hi - 600, "TOPBUYER", 100.0), (hi - 300, "TOPBUYER", -100.0),    # bought near the top: not a bottom buy
              (lo + 60, "TINY", 1.0), (hi - 60, "TINY", -1.0)]                  # $0.50: too small to count
    trades += [(lo + i, "BOT", 10.0 if i % 2 else -10.0) for i in range(1, 60)] + [(lo + 61, "BOT", 100.0), (hi, "BOT", -100.0)]
    smart = sw.smart_on_pump(trades, df, p)
    assert set(smart) == {"SMART"} and smart["SMART"]["x"] >= 3.5 and smart["SMART"]["profit"] > 100


def test_smart_wallet_list_keeps_wallets_that_won_on_several_coins(monkeypatch):
    from bot import smart_wallets as sw
    idx = pd.date_range(pd.Timestamp.now(tz="UTC").floor("5min") - pd.Timedelta(hours=40), periods=480, freq="5min")
    close = np.r_[np.full(100, 0.5), np.linspace(0.5, 2.0, 200), np.full(180, 1.9)]
    df = pd.DataFrame({"open": close, "high": close, "low": close, "close": close, "volume": 1.0}, index=idx)
    monkeypatch.setattr(sw, "main_pool", lambda mint: "POOL" + mint)
    wins = {"A": ["W1", "W2"], "B": ["W1", "W3"], "C": ["W1", "W2"]}

    def fake_trades(mint, pool, p, df):
        if mint == "BUSY":
            return []
        out = []
        for w in wins.get(mint, []):
            out += [(p["low_t"] + 300, w, 100.0), (p["high_t"] - 300, w, -100.0)]
        return out
    monkeypatch.setattr(sw, "pump_trades", fake_trades)
    res = sw.find([("A", "A"), ("B", "B"), ("C", "C"), ("BUSY", "BUSY")], history=lambda mint: df)
    assert list(res["wallets"]) == ["W1", "W2", "W3"]                     # 3 coins, 2 coins, 1 coin
    assert res["level"].startswith("the biggest winners")                  # under 5 repeat winners: the top earners too
    assert res["wallets"]["W1"]["coins"] == ["A", "B", "C"] and res["wallets"]["W1"]["profit"] > 400
    strict = sw.find([("A", "A"), ("B", "B"), ("C", "C")], history=lambda mint: df, min_coins=3)
    assert strict["level"].startswith("the biggest winners") and list(strict["wallets"])[0] == "W1"
    assert any(p.get("skipped") == "no swaps read" for p in res["pumps"])


def test_copytrader_copies_a_smart_buy_alerts_on_two_wallets_and_sells_when_the_wallet_sells(tmp_path, monkeypatch):
    import json
    import time
    from bot import copytrade as ct
    from bot import solbot as sb
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}, "W2": {}}}))
    price = [1.0]
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 50_000, "vol24": 1e5, "symbol": "COIN"} for m in mints})
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})

    def order(i, o, raw, taker=None):
        usd = raw / 1e6 * (1 if i == sb.USDC else price[0])
        return {"inAmount": str(raw), "outAmount": str(int(usd * 0.99 / (1 if o == sb.USDC else price[0]) * 1e6)),
                "inUsdValue": usd, "outUsdValue": usd * 0.99}
    monkeypatch.setattr(sb, "order", order)
    loud, quiet = [], []
    c = ct.Copier({"copytrade": {"cash": 300, "per_trade": 30}}, lambda t, m: loud.append(t), lambda t, m: quiet.append(t))
    assert c.wallets == ["W1", "W2"]
    c.on_swap("W1", "COIN", 1000)
    assert "COIN" in c.positions and quiet[-1].startswith("COPY PRACTICE: BOUGHT $30.00 of COIN") and not loud
    c.on_swap("W2", "COIN", 500)                                   # a 2nd smart wallet buys the same coin
    assert loud and loud[0].startswith("🧠 2 smart wallets just bought COIN") and len(c.positions) == 1
    price[0] = 1.5
    c.on_swap("W1", "COIN", -1000)                                 # the wallet it copied sells: so does the bot
    assert "COIN" not in c.positions and "SOLD COIN" in quiet[-1] and "(+" in quiet[-1]
    c.on_swap("W1", "DUD", 10)
    price[0] = 0.7
    c.check_positions()                                            # -30%: the stop-loss
    assert "DUD" not in c.positions and c.state["trades"][-1]["action"] == "SELL" and c.state["trades"][-1]["result"] < -0.4
    c.save()
    lines = ct.report_lines(json.loads((tmp_path / "copytrade_state.json").read_text()), time.time() + 60, 24)
    assert "COPY PRACTICE" in lines[0] and "2 trades" in lines[0]
    for _ in range(int(c.cfg["max_reads_per_wallet_hour"])):
        assert c.can_read("W1")
    assert not c.can_read("W1") and c.can_read("W2")              # the free plan's credit guard


def test_copytrader_listens_live_and_hands_each_smart_wallet_transaction_over(tmp_path, monkeypatch):
    import asyncio
    import json
    from aiohttp import web
    from bot import copytrade as ct
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}, "W2": {}}}))
    subscribed = []

    async def ws_handler(request):                                  # a pretend Helius
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        async for msg in ws:
            j = json.loads(msg.data)
            subscribed.append(j["params"][0]["mentions"][0])
            await ws.send_json({"jsonrpc": "2.0", "id": j["id"], "result": 100 + j["id"]})
            if len(subscribed) == 2:
                await ws.send_json({"jsonrpc": "2.0", "method": "logsNotification", "params": {"subscription": 102,
                                    "result": {"value": {"signature": "SIG2", "err": None, "logs": []}}}})
                await ws.send_json({"jsonrpc": "2.0", "method": "logsNotification", "params": {"subscription": 101,
                                    "result": {"value": {"signature": "BAD", "err": {"x": 1}, "logs": []}}}})
        return ws

    async def main():
        app = web.Application()
        app.router.add_get("/", ws_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        monkeypatch.setattr(ct, "ws_url", lambda: f"http://127.0.0.1:{port}/")
        c = ct.Copier({}, lambda t, m: None)
        seen = []
        c.handle = lambda w, sig: seen.append((w, sig))
        await c.listen(1.5)
        await runner.cleanup()
        return seen
    seen = asyncio.run(main())
    assert subscribed == ["W1", "W2"] and seen == [("W2", "SIG2")]         # failed transactions are ignored


def test_smart_wallet_search_reads_the_bottom_then_each_big_buyers_own_history(monkeypatch):
    from bot import smart_wallets as sw
    idx = pd.date_range("2026-11-01", periods=600, freq="5min", tz="UTC")
    close = np.r_[np.ones(200), np.full(50, 0.5), np.linspace(0.5, 2.0, 200), np.full(150, 1.8)]
    df = pd.DataFrame({"open": close, "high": close, "low": close, "close": close, "volume": 1.0}, index=idx)
    p = sw.pumps(df)[0]
    lo, hi = p["low_t"], p["high_t"]
    txs = {"B1": _tx("SMART", [("SMART", "COIN", 0, 100)]), "B2": _tx("BOT", [("BOT", "COIN", 0, 500)]),
           "B3": _tx("SMALL", [("SMALL", "COIN", 0, 10)]), "S1": _tx("SMART", [("SMART", "COIN", 100, 20)])}
    hist = {"POOL": [("B1", lo + 60), ("B2", lo + 120), ("B3", lo + 180), ("OLD", lo - 7200)],
            "SMART": [("S1", hi - 600)], "BOT": [(f"X{i}", hi) for i in range(3000)], "SMALL": []}
    looked_up = []

    def fake_sigs(address, since, max_pages=300):
        looked_up.append(address)
        return [(s, t) for s, t in hist.get(address, []) if t >= since]
    monkeypatch.setattr(sw, "signatures", fake_sigs)
    monkeypatch.setattr(sw, "rpc_batch", lambda calls, url=None: [txs.get(c[1][0]) for c in calls])
    trades = sw.pump_trades("COIN", "POOL", p, df)
    assert "SMALL" not in looked_up                                       # a $5 buy isn't worth a lookup
    assert ("SMART" in looked_up and "BOT" in looked_up) and not any(w == "BOT" and d < 0 for _, w, d in trades)
    smart = sw.smart_on_pump(trades, df, p)
    assert set(smart) == {"SMART"} and smart["SMART"]["x"] > 3


def test_kalshi_walk_forward_picks_settings_on_earlier_days_only_and_can_take_profit():
    from datetime import date, timedelta

    from bot import kalshi_walkforward as w

    def day_row(d, fav_wins, models_agree):
        mk = lambda t, lo, res: {"ticker": t, "strike_type": "between", "floor_strike": lo, "cap_strike": lo + 1,
                                 "result": res}
        ev = {"event_ticker": f"KXHIGHX-{d}", "markets": [mk(f"{d}-A", 70, "yes" if fav_wins else "no"),
                                                          mk(f"{d}-B", 72, "no" if fav_wins else "yes")]}
        return {"event": ev, "station": "KXXX", "day": d, "mu": 70.5 if models_agree else 72.5, "spread": 0.0,
                "bias": 0.0, "err": 1.0}

    start = date(2026, 10, 1)
    rows, paths = [], {}
    for n in range(20):
        d = (start + timedelta(days=n)).isoformat()
        agree = n % 2 == 0                      # the favorite wins exactly when the models agree with it
        rows.append(day_row(d, agree, agree))
        at = w.entry_time(d, 12)
        paths[f"KXHIGHX-{d}"] = {f"{d}-A": [[at - 60, 0.65, 0.63], [at + 3600 * 20, 0.66, 0.92]],
                                 f"{d}-B": [[at - 60, 0.30, 0.28]]}
    cds = [w.city_day(r, paths, 12) for r in rows]
    assert cds[0]["fav"].endswith("-A") and cds[0]["price"] == 0.65 and cds[0]["model_top"] == cds[0]["fav"]
    assert cds[1]["model_top"] != cds[1]["fav"]
    cost, back, won = w.outcome(cds[0], take=0.90)                   # sold at the 92c bid, not held to $1
    assert won and abs(back - (7 * 0.92 - w.k.fee(0.92, 7))) < 1e-9 and cost > 4
    assert w.outcome(cds[1])[1] == 0                                 # held: lost
    cdhs = [{12: c} for c in cds]
    assert w.pick(cdhs[0], {"hours": (13, 23)}) is None and w.pick(cdhs[0], {})["hour"] == 12
    wf = w.walk_forward(cdhs)
    held_days = {t[0] for t in wf["A"]["trades"]}
    assert min(held_days) == cds[w.WARMUP_DAYS]["day"]               # the warm-up days are never judged
    a, agree = w.summary(wf["A"]["trades"]), w.summary(wf["agree"]["trades"])
    assert a["n"] == 13 and agree["n"] == 6 and agree["won"] == 6 and agree["profit"] > a["profit"]
    picked = w.walk_forward(cdhs, {"take": w.IDEAS["take"]})["take"]
    assert picked["setting"] in ({"take": 0.85}, {"take": 0.9})       # every bid spiked to 92c: selling there paid


def test_kalshi_arbitrage_anywhere_finds_sure_no_sets_and_checks_the_event_first(monkeypatch):
    from bot import kalshi as k
    m = lambda t, yes, no, size="50": {"ticker": t, "event_ticker": "EV", "yes_ask_dollars": str(yes),
                                       "no_ask_dollars": str(no), "no_ask_size_fp": size}
    # at most one of these can come true: NO on A and B (45c + 47c) pays at least $1, and adding C's 96c NO makes it
    # at least $2 for $1.93 with fees, the best set
    ms = [m("A", 0.56, 0.45), m("B", 0.54, 0.47), m("C", 0.05, 0.96)]
    sub = k.no_subset_arb(ms, 0.02)
    assert sub and sub["legs"] == ["A", "B", "C"] and sub["payout"] == 2.0 and abs(sub["edge"] - 0.07) < 1e-9
    assert k.no_subset_arb(ms[:2], 0.02)["edge"] == k.no_subset_arb(ms[:2], 0.02)["payout"] - k.no_subset_arb(ms[:2], 0.02)["cost"]
    assert k.no_subset_arb([m("A", 0.56, 0.52), m("B", 0.54, 0.50)], 0.02) is None          # costs more than it pays
    assert k.no_subset_arb([m("A", 0.5, 0.45, None), m("B", 0.5, 0.47, None)], 0.02) is None  # no size to buy
    calls = []

    def kget(path, params=None):
        calls.append(path)
        if path == "/markets":
            return {"markets": [{**x, "no_ask_size_fp": None} for x in ms] + [m("Z", 0.5, 0.5)], "cursor": ""}
        if path == "/events/EV":
            return {"event": {"event_ticker": "EV", "title": "Who wins?", "mutually_exclusive": calls.count(path) == 1,
                              "markets": ms}}
        raise AssertionError(path)
    monkeypatch.setattr(k, "kget", kget)
    state = {}
    ideas = k.arb_scan(state, 0.0, {"arb_margin": 0.02}, budget_s=5)
    assert len(ideas) == 1 and ideas[0]["side"] == "no" and ideas[0]["event"] == "EV" and state["arb_mutex"]["EV"]
    assert state["arb_cursor"] is None                                          # swept it all: start over next time
    assert k.arb_scan({}, 0.0, {"arb_margin": 0.02}, budget_s=5) == []         # not mutually exclusive: no trade
    acct = {"cash": 100.0, "positions": {}}
    assert k.trade(acct, ideas, {"max_per_trade": 5}, lambda *a: None, "PRACTICE ", 0.0) == 1
    assert set(acct["positions"]) == {"A", "B", "C"} and all(p["side"] == "no" for p in acct["positions"].values())


def test_kalshi_shows_what_each_open_bet_would_sell_for_now():
    from bot import kalshi as k
    acct = {"positions": {"T1": {"title": "NYC 70-71", "side": "yes", "price": 0.60, "count": 8, "cost": 4.94},
                          "T2": {"title": "Houston 77-78", "side": "yes", "price": 0.61, "count": 7, "cost": 4.39}}}
    cache = {"T1": {"yes_bid_dollars": "0.75"}, "T2": {"yes_bid_dollars": "0.40"}}
    m = k.marks(acct, cache)
    assert m[0]["title"] == "NYC 70-71" and abs(m[0]["now"] - (8 * 0.75 - k.fee(0.75, 8))) < 1e-9 and m[0]["change"] > 0.15
    assert m[1]["change"] < -0.35
    assert k.marks({"positions": {"T3": {"title": "x", "side": "no", "price": 0.9, "count": 5, "cost": 4.6}}}, {}) == []


def test_imagine_picks_the_next_script_writes_timed_captions_and_a_caption_to_post(tmp_path, monkeypatch):
    from bot import imagine as im
    data = {"style": "3D", "character": "a guy in a red hoodie",
            "episodes": [{"id": "a", "title": "Imagine A", "tags": "#x", "scenes": [{"say": "One. Would you? Comment.", "image": "{char} waving"}]},
                         {"id": "b", "title": "Imagine B", "scenes": []}]}
    assert im.next_episode(data, {"done": ["a"]})["id"] == "b" and im.next_episode(data, {"done": ["a", "b"]}) is None
    assert im.image_prompt(data, data["episodes"][0]["scenes"][0]) == "3D: a guy in a red hoodie waving"
    spoken = [(0.0, 0.3, "Imagine"), (0.4, 0.2, "you"), (0.7, 0.3, "wake"), (1.1, 0.2, "up"), (1.4, 0.5, "tomorrow"),
              (2.0, 0.2, "and"), (2.3, 0.2, "the"), (2.6, 0.3, "sun"), (3.0, 0.3, "never"), (3.4, 0.3, "rises")]
    words = im.mark_pauses(spoken, "Imagine you wake up tomorrow, and the sun never rises.")
    assert words[4][3] and not words[3][3]                                   # a comma after "tomorrow"
    groups = [" ".join(w[2] for w in g) for g in im.chunks(words)]
    assert groups == ["Imagine you", "wake up tomorrow", "and the sun", "never rises"]     # breaks at the comma
    jump = im.mark_pauses([(i, 0.2, w) for i, w in enumerate("You jump into the hole".split())], "You jump into the hole")
    assert [" ".join(w[2] for w in g) for g in im.chunks(jump)] == ["You jump", "into the hole"]   # never ends on "into"
    im.captions(words, tmp_path / "s.ass")
    ass = (tmp_path / "s.ass").read_text()
    cues = [l for l in ass.splitlines() if l.startswith("Dialogue: 0,")]
    assert cues[0].endswith("IMAGINE YOU") and cues[0].startswith("Dialogue: 0,0:00:00.00,0:00:00.70")
    assert cues[1].endswith("WAKE UP TOMORROW") and "AI animated" in ass
    assert len(im.mark_pauses(spoken, "too few words")[0]) == 4            # words that don't line up: no pauses known
    assert im.post_caption(data["episodes"][0]).startswith("Imagine A... One. Would you?") and "#aianimated" in im.post_caption(data["episodes"][0])


def test_imagine_renders_a_vertical_video_even_without_pictures(tmp_path, monkeypatch):
    import shutil
    import subprocess
    from bot import imagine as im
    if not shutil.which("ffmpeg"):
        pytest.skip("needs ffmpeg")
    monkeypatch.chdir(tmp_path)

    def fake_say(text, out, voice=im.VOICE):                      # 1 s of silence instead of the voice service
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "1",
                        "-c:a", "libmp3lame", str(out)], check=True)
        return [(0.1, 0.3, w) for w in text.split()[:2]]
    monkeypatch.setattr(im, "say", fake_say)
    data = {"style": "3D", "character": "x", "episodes": [{"id": "t", "title": "Imagine T", "scenes": [
        {"say": "Imagine this.", "image": "a"}, {"say": "Then that.", "image": "b"}]}]}
    out = im.render(data, data["episodes"][0], tmp_path / "w", images=lambda p, o, s: False)
    info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0",
                           str(out)], capture_output=True, text=True).stdout
    assert "video,1080,1920" in info and "audio" in info and 2.0 < im.duration(out) < 3.5


def test_imagine_publishes_the_video_and_pings_the_phone_with_the_link(tmp_path, monkeypatch):
    from bot import imagine as im
    calls = []

    class R:
        def __init__(self, code=200, body=None):
            self.status_code, self._b, self.ok, self.text = code, body or {}, code < 400, ""
        def json(self):
            return self._b
    def fake(method):
        def f(url, **kw):
            calls.append((method, url, kw))
            if method == "get":
                return R(404)
            if "uploads" in url:
                return R(201, {"browser_download_url": "https://github.com/o/r/releases/download/videos/x.mp4"})
            if url.endswith("/releases"):
                return R(201, {"upload_url": "https://uploads.github.com/repos/o/r/releases/1/assets{?name,label}", "assets": []})
            return R(200)
        return f
    for m in ("get", "post", "delete"):
        monkeypatch.setattr("requests." + m, fake(m))
    video = tmp_path / "x.mp4"
    video.write_bytes(b"fake")
    assert im.publish(video) is None                                    # no token: nothing uploaded
    monkeypatch.setenv("GITHUB_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    link = im.publish(video)
    assert link.endswith("/videos/x.mp4") and any("uploads.github.com" in c[1] and c[2]["params"] == {"name": "x.mp4"} for c in calls)
    monkeypatch.setenv("ALERT_TARGET", "ntfy:topic123")
    ep = {"id": "x", "title": "Imagine X", "tags": "#a", "scenes": [{"say": "Would you? Comment.", "image": ""}]}
    assert im.send(link, ep)
    ping = calls[-1]
    assert ping[1] == "https://ntfy.sh/topic123" and ping[2]["headers"]["Click"] == link and b"Caption to paste" in ping[2]["data"]
    assert not im.send(None, ep)


def _swap_tx(wallet, t, mint, tokens, sol, before=0.0):
    """A wallet's own swap of SOL for `tokens` of `mint` (+ bought, - sold), as getTransaction returns it."""
    return {"blockTime": t, "transaction": {"message": {"accountKeys": [{"pubkey": wallet, "signer": True},
                                                                         {"pubkey": "POOL", "signer": False}]}},
            "meta": {"err": None, "fee": 5000, "preBalances": [10_000_000_000, 0],
                     "postBalances": [10_000_000_000 + int(sol * 1e9) - 5000, 0],
                     "preTokenBalances": [{"mint": mint, "owner": wallet, "uiTokenAmount": {"uiAmount": before}}],
                     "postTokenBalances": [{"mint": mint, "owner": wallet, "uiTokenAmount": {"uiAmount": before + tokens}}]}}


def test_wallet_records_are_scored_as_if_copied_and_only_good_ones_are_approved():
    from bot import smart_wallets as sw
    x = sw.wallet_trade(_swap_tx("W", 0, "COIN", 1000, -1.0), "W")
    assert x["mint"] == "COIN" and x["tokens"] == 1000 and abs(x["sol"] + 1.0) < 1e-9     # the fee doesn't count
    assert sw.wallet_trade(_swap_tx("W", 0, "COIN", 1000, -1.0), "SOMEONE_ELSE") is None     # not its own swap
    trades = [sw.wallet_trade(_swap_tx("W", t, "COIN", n, s, b), "W")
              for t, n, s, b in [(0, 1000, -1.0, 0), (100, 1000, -2.0, 1000), (200, -1500, 3.0, 2000), (300, -500, 0.5, 500)]]
    trips = sw.round_trips(trades)                         # first in, first out
    assert [(a, b, round(r, 6)) for a, b, r, _ in trips] == [(0, 200, 1.0), (100, 200, 0.0), (100, 300, -0.5)]
    s = sw.score(trips, cost=0.02)
    assert s["trades"] == 3 and abs(s["won"] - 1 / 3) < 1e-9 and abs(s["profit_factor"] - 0.98 / 0.54) < 1e-9
    ok, why = sw.passes(s)
    assert not ok and "only 3 finished trades" in why and "only 1 coins" in why
    good = {"trades": 30, "coins": 6, "avg": 0.02, "profit_factor": 1.5, "hold_min": 10, "weeks": 4, "good_weeks": 0.75}
    assert sw.passes(good) == (True, "passes")
    assert not sw.passes({**good, "hold_min": 0.5})[0]                                   # too fast to copy
    approved, stats = sw.approve(["A", "B", "C"], record=lambda w: {**good, "avg": 0.05} if w == "B" else good if w == "A" else s)
    assert approved == ["B", "A"] and not stats["C"]["approved"]


class _FakeLiveWallet:
    live, address = True, "BOTWALLET1111111111"

    def __init__(self, usd, price):
        self.usd, self.price, self.held, self.fail_sell, self.refreshed = usd, price, {}, False, 0

    def refresh(self):
        self.refreshed += 1

    def cash(self):
        return self.usd

    def held_raw(self, mint):
        return self.held.get(mint, 0)

    def swap(self, i, o, raw, max_cost=None):
        from bot.solbot import USDC, TradeError
        if i == USDC:
            self.usd -= raw / 1e6
            self.held[o] = int(raw / self.price[0])
            return {"in": raw, "out": self.held[o], "tx": "BUYTX"}
        if self.fail_sell:
            raise TradeError("network")
        got = self.held.pop(i) * self.price[0]
        self.usd += got / 1e6
        return {"in": raw, "out": int(got), "tx": "SELLTX"}


def test_real_money_copier_follows_only_approved_wallets_with_small_trades_and_drops_losers(tmp_path, monkeypatch):
    import json
    import time
    from bot import copytrade as ct
    from bot import solbot as sb
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}, "W2": {}, "W3": {}},
                                                                        "approved": ["W1", "W2"]}))
    price = [1.0]
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 50_000, "vol24": 1e5, "symbol": m} for m in mints})
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})
    w = _FakeLiveWallet(13.64, price)
    loud = []
    c = ct.Copier({"copytrade": {"live": {"drop_after_losses": 2}}}, lambda t, m: loud.append(t), live=True, wallet=w)
    assert c.wallets == ["W1", "W2"] and c.path == ct.STATE_LIVE
    c.on_swap("W1", "AAA", 100)
    c.on_swap("W2", "BBB", 100)
    c.on_swap("W1", "CCC", 100)                                       # 2 open already: skipped
    assert set(c.positions) == {"AAA", "BBB"} and loud[0] == "COPY LIVE: BOUGHT $6.00 of AAA" and w.refreshed >= 2
    assert abs(w.usd - 1.64) < 1e-9
    price[0] = 0.5
    w.fail_sell = True
    c.on_swap("W1", "AAA", -100)                                      # the sell fails: kept and tried again
    assert c.positions["AAA"]["pending"] and not any("SOLD" in t for t in loud)
    w.fail_sell = False
    c.check_positions()                                               # AAA's retry, and BBB's -50% stop-loss
    assert not c.positions and sum("COPY LIVE: SOLD" in t for t in loud) == 2
    assert c.state["by_wallet"] == {"W1": [-0.5], "W2": [-0.5]} and not c.state.get("dropped")
    price[0] = 1.0
    c.on_swap("W1", "DDD", 100)
    price[0] = 0.5
    c.on_swap("W1", "DDD", -100)                                      # W1's 2nd loss in a row: dropped
    assert "W1" in c.state["dropped"] and loud[-1].startswith("COPY LIVE: stopped copying W1")
    price[0] = 1.0
    c.on_swap("W1", "EEE", 100)
    assert not c.positions                                            # dropped wallets aren't copied
    w.usd = 2.0
    c.on_swap("W2", "FFF", 100)                                       # under $3: stops buying, one ping
    c.on_swap("W2", "GGG", 100)
    assert not c.positions and sum("paused" in t for t in loud) == 1
    c.save()
    state = json.loads((tmp_path / "copytrade_state_live.json").read_text())
    lines = ct.report_lines(state, time.time() + 60, 24, c.value(), live=True)
    assert lines[0].startswith("COPY LIVE") and "3 trades" in lines[0] and "$2.00" in lines[0]
    assert not (tmp_path / "copytrade_state.json").exists()           # the practice account's file is separate


def test_one_listener_feeds_the_practice_and_the_real_money_copier(tmp_path, monkeypatch):
    import json
    from bot import copytrade as ct
    from bot import smart_wallets as sw
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}, "W2": {}}, "approved": ["W1", "W9"]}))
    practice = ct.Copier({}, lambda t, m: None)
    real = ct.Copier({}, lambda t, m: None, live=True, wallet=_FakeLiveWallet(10, [1.0]))
    practice.others.append(real)
    assert practice.watched() == ["W1", "W2", "W9"]
    monkeypatch.setattr(sw, "rpc", lambda method, params: {"tx": params[0]})
    monkeypatch.setattr(ct, "wallet_swaps", lambda tx, w: [("COIN", 5.0)])
    got = []
    practice.on_swap = lambda w, m, ch, sig: got.append(("practice", w))

    def boom(w, m, ch, sig):
        got.append(("real", w))
        raise RuntimeError("one account's problem doesn't stop the other")
    real.on_swap = boom
    for wallet in ("W1", "W2", "W9"):
        practice.handle(wallet, "SIG")
    assert got == [("practice", "W1"), ("real", "W1"), ("practice", "W2"), ("real", "W9")]
    practice.save()
    assert (tmp_path / "copytrade_state.json").exists() and (tmp_path / "copytrade_state_live.json").exists()


def test_empty_token_accounts_are_closed_to_get_the_deposit_back():
    import base64
    from solders.keypair import Keypair
    from solders.transaction import Transaction
    from bot import solbot as sb
    kp = Keypair()
    ids = {k: str(Keypair().pubkey()) for k in ("usdc", "coin", "full", "ice", "t22")}

    def acct(key, mint, amount, state="initialized"):
        return {"pubkey": ids[key], "account": {"data": {"parsed": {"info": {
            "mint": mint, "state": state, "tokenAmount": {"amount": amount}}}}}}
    accounts = {sb.TOKEN_PROGRAMS[0]: [acct("usdc", sb.USDC, "0"), acct("coin", "COIN", "0"), acct("full", "FULL", "5"),
                                       acct("ice", "ICE", "0", "frozen")],
                sb.TOKEN_PROGRAMS[1]: [acct("t22", "T22", "0")]}
    sent = []

    def rpc(method, params):
        if method == "getTokenAccountsByOwner":
            assert params[0] == str(kp.pubkey())
            return {"value": accounts[params[1]["programId"]]}
        if method == "getLatestBlockhash":
            return {"value": {"blockhash": "11111111111111111111111111111111"}}
        assert method == "sendTransaction"
        sent.append(Transaction.from_bytes(base64.b64decode(params[0])))
        return "SIG"
    assert sb.close_empty_accounts(kp, rpc=rpc) == 2                   # never USDC, a coin it still holds, or a frozen one
    assert len(sent) == 2
    for tx, key in zip(sent, ("coin", "t22")):
        keys = [str(k) for k in tx.message.account_keys]
        ix = tx.message.instructions[0]
        assert len(tx.message.instructions) == 1 and bytes(ix.data) == bytes([9])
        assert keys[ix.accounts[0]] == ids[key] and keys[0] == str(kp.pubkey())   # deposit goes back to the wallet
    sent[0].verify()                                                  # signed by the bot's wallet


def test_copytrade_forgive_puts_a_dropped_wallet_back_once(tmp_path, monkeypatch):
    import json
    import bot.copytrade as ct
    monkeypatch.chdir(tmp_path)
    w = "71pAfN1nJhcLaezSRYvwdsNFE9PnY9hNfcxB4nZ1gdAp"
    ct.WALLETS.parent.mkdir(parents=True, exist_ok=True)
    ct.WALLETS.write_text(json.dumps({"wallets": {w: {}}, "approved": [w]}))
    ct.STATE_LIVE.write_text(json.dumps({"dropped": {w: 1.0}, "by_wallet": {w: [-0.01, -0.02, -0.03, -0.04]}}))

    class Wallet:
        def cash(self):
            return 20.0

    told = []
    settings = {"copytrade": {"live": {"enabled": True, "forgive": [w]}}}
    c = ct.Copier(settings, lambda t, m, *a: told.append(t), live=True, wallet=Wallet())
    assert w not in c.state["dropped"] and c.state["by_wallet"][w] == [] and any("again" in t for t in told)
    c.state["dropped"][w] = 2.0                       # dropped again later: stays dropped
    c.save()
    c2 = ct.Copier(settings, lambda t, m, *a: told.append(t), live=True, wallet=Wallet())
    assert w in c2.state["dropped"]


def test_copytrade_live_budget_is_its_own_money_and_stops_under_the_limit(tmp_path, monkeypatch):
    import json
    import bot.copytrade as ct
    monkeypatch.chdir(tmp_path)
    w = "71pAfN1nJhcLaezSRYvwdsNFE9PnY9hNfcxB4nZ1gdAp"
    ct.WALLETS.parent.mkdir(parents=True, exist_ok=True)
    ct.WALLETS.write_text(json.dumps({"wallets": {w: {}}, "approved": [w]}))

    class Wallet:                                     # the shared wallet holds $113.64 (another bot's $13.64 too)
        address = "Bot1111111111111111111111111111111111111111"

        def cash(self):
            return 113.64

    told = []
    settings = {"copytrade": {"live": {"enabled": True, "budget": 100, "stop_below": 70}}}
    c = ct.Copier(settings, lambda t, m, *a: told.append(t), live=True, wallet=Wallet())
    assert c.wallet.cash() == 100 and c.value() == 100 and any("budget set to $100" in t for t in told)
    c.state["cash"] = 65.0                            # lost $35 of it
    assert c.value() < float(c.cfg["stop_below"])
    c.save()
    told.clear()
    c2 = ct.Copier(settings, lambda t, m, *a: told.append(t), live=True, wallet=Wallet())
    assert c2.wallet.cash() == 65.0 and not told      # same budget: the ledger carries on, no reset


def test_autotrade_practice_needs_no_key_and_trades_pretend_money(tmp_path, monkeypatch):
    at, holds, sent, tell = _autotrade_setup(tmp_path, monkeypatch, mode="practice")
    monkeypatch.delenv("COINBASE_API_KEY", raising=False)
    ex = FakeCoinbase()
    status = at.run(exchange=ex, tell=tell)
    assert not ex.orders and status.startswith("PRACTICE:")
    assert sent[0] == "PRACTICE: Auto-trader started with pretend money"
    assert any(t.startswith("PRACTICE: BOUGHT $50.00 of BTC-USD") for t in sent)
    holds["BTC-USD"] = False
    at.run(exchange=ex, tell=tell)
    assert any(t.startswith("PRACTICE: SOLD BTC-USD") for t in sent) and not ex.orders


def test_copytrade_live_stops_at_market_value_and_ignores_drops_when_off(tmp_path, monkeypatch):
    import json
    import bot.copytrade as ct
    import bot.solbot as sb
    monkeypatch.chdir(tmp_path)
    w = "71pAfN1nJhcLaezSRYvwdsNFE9PnY9hNfcxB4nZ1gdAp"
    ct.WALLETS.parent.mkdir(parents=True, exist_ok=True)
    ct.WALLETS.write_text(json.dumps({"wallets": {w: {}}, "approved": [w]}))

    class Wallet:
        address = "Bot1111111111111111111111111111111111111111"

        def cash(self):
            return 500.0

    told = []
    settings = {"copytrade": {"live": {"enabled": True, "budget": 100, "stop_below": 70, "drop_after_losses": 0,
                                       "trade_hours": [11, 17]}}}
    c = ct.Copier(settings, lambda t, m, *a: told.append(t), live=True, wallet=Wallet(), now=lambda: 1_800_000_000.0)
    c.state["dropped"] = {w: 1.0}
    assert not int(c.cfg["drop_after_losses"])                       # drops are ignored while the rule is off
    c.state["cash"] = 40.0                                           # $40 cash + a coin bought for $40, now worth $20
    c.positions["MINT"] = {"name": "X", "raw": 10_000_000, "decimals": 6, "cost": 40.0, "entry": 4.0, "t": 1_800_000_000.0,
                           "wallets": [w]}
    sold = []
    monkeypatch.setattr(sb, "prices", lambda mints: {"MINT": {"usdPrice": 2.0}})
    monkeypatch.setattr(ct.Copier, "sell", lambda self, mint, why: sold.append((mint, why)) or self.positions.pop(mint) or True)
    c.check_positions()                                              # $40 + $20 = $60, under the $70 stop
    assert c.state["halted"] and sold and any("STOPPED at $60.00" in t for t in told)
    hour = __import__("datetime").datetime.fromtimestamp(1_800_000_000.0, __import__("zoneinfo").ZoneInfo("America/Chicago")).hour
    assert c.in_trade_hours() == (11 <= hour < 17)


def test_copytrade_live_can_follow_every_practice_wallet(tmp_path, monkeypatch):
    import json
    import bot.copytrade as ct
    monkeypatch.chdir(tmp_path)
    ct.WALLETS.parent.mkdir(parents=True, exist_ok=True)
    ct.WALLETS.write_text(json.dumps({"wallets": {"A": {}, "B": {}, "C": {}}, "approved": ["C"]}))

    class Wallet:
        address = "Bot1111111111111111111111111111111111111111"

        def cash(self):
            return 100.0

    base = {"enabled": True, "budget": 100}
    only = ct.Copier({"copytrade": {"live": base}}, lambda *a: None, live=True, wallet=Wallet())
    every = ct.Copier({"copytrade": {"live": {**base, "follow_all": True}}}, lambda *a: None, live=True, wallet=Wallet())
    practice = ct.Copier({"copytrade": {}}, lambda *a: None)
    assert only.wallets == ["C"] and every.wallets == practice.wallets == ["A", "B", "C"]


def test_wallet_styles_label_each_buy_and_grade_style_by_time_of_day():
    import datetime
    import numpy as np
    import pandas as pd
    from bot import wallet_styles as ws

    assert ws.entry_style(0.5, 0.0, 0.0) == "launch sniper" and ws.entry_style(-3, 0.5, 0.0) == "launch sniper"
    assert ws.entry_style(30, -0.2, 0.0) == "dip buyer" and ws.entry_style(30, 0.0, -0.4) == "dip buyer"
    assert ws.entry_style(30, 0.3, 0.0) == "pump chaser" and ws.entry_style(30, 0.05, 0.1) == "quiet buyer"
    assert ws.style_from_dex({"age_h": 50, "h1": -20, "h6": 0}) == "dip buyer" and ws.style_from_dex(None) is None
    assert ws.hold_style(5) == ws.HOLDS[0] and ws.hold_style(60) == "holds hours" and ws.hold_style(900) == "holds days"
    ct_ = datetime.timezone(datetime.timedelta(hours=-6))                  # Milwaukee in November
    noon = datetime.datetime(2026, 11, 2, 12, 0, tzinfo=ct_).timestamp()   # a Monday
    assert ws.slot_of(noon) == "midday" and ws.slot_of(noon - 13 * 3600) == "overnight" and ws.day_of(noon) == "Mon"

    # Wallet D buys 25 coins at midday right after a 30% drop and sells +30%; wallet P buys 25 in the morning
    # after a 40% run-up and sells -20%.
    buys = {}
    def trades_of(w):
        out = []
        for i in range(25):
            t = noon + i * 86400 - (4 * 3600 if w == "P" else 0)
            m = f"{w}{i}"
            buys[m] = (t, w)
            out += [{"t": t, "mint": m, "tokens": 100.0, "sol": -1.0, "usdc": 0.0},
                    {"t": t + 3 * 3600, "mint": m, "tokens": -100.0, "sol": 1.3 if w == "D" else 0.8, "usdc": 0.0}]
        return out
    coins = lambda mints: {m: {"pool": "pool_" + m, "created": buys[m][0] - 10 * 86400, "mcap": 2e6, "price": 1.0,
                               "symbol": m} for m in mints}
    reads = []
    def read_chart(pool, before):
        reads.append(pool)
        t, w = buys[pool[5:]]
        idx = np.arange(t - 86400, t + 86400, 300.0)
        before_px = 1.0 if w == "D" else 0.6
        close = np.where(idx < t - 1800, before_px, 0.7 if w == "D" else 0.84)
        return pd.DataFrame({"close": close, "high": close}, index=idx)
    sol = pd.Series(np.linspace(100, 200, 24 * 40), index=noon - 3 * 86400 + 3600.0 * np.arange(24 * 40))   # rising
    res = ws.build(["D", "P"], trades_of=trades_of, coin_info=coins, read_chart=read_chart, practice={}, sol=sol)
    d, p = res["wallets"]["D"], res["wallets"]["P"]
    assert d["main_style"] == "dip buyer" and d["mix"]["dip buyer"] == 1.0 and d["hold"] == "holds hours"
    assert p["main_style"] == "pump chaser" and abs(d["avg"] - 0.28) < 1e-9 and abs(p["avg"] + 0.22) < 1e-9
    assert abs(res["rows"][0]["mcap"] - 2e6 * 0.7) < 1 and len(reads) == 50 and res["charts_read"] == 50
    book = res["playbook"]
    assert book["by_style_slot"]["dip buyer|midday"]["verdict"] == "GO"
    assert book["by_style_slot"]["pump chaser|morning"]["verdict"] == "AVOID"
    assert book["by_style_slot"]["dip buyer|evening"] == {"n": 0}
    assert ws.verdict("pump chaser", noon - 4 * 3600, book) == "AVOID" and ws.verdict("dip buyer", noon, book) == "GO"
    assert ws.verdict("quiet buyer", noon, book) == "not sure yet" and ws.verdict(None, noon, book) == "not sure yet"
    # each wallet's own record: a wallet with one is judged only by it; a wallet without one by everyone's
    assert book["by_wallet"]["D"]["dip buyer|midday"]["verdict"] == "GO" and "pump chaser|morning" not in book["by_wallet"]["D"]
    assert ws.verdict("pump chaser", noon - 4 * 3600, book, "D") == "not sure yet"
    assert ws.verdict("pump chaser", noon - 4 * 3600, book, "P") == "AVOID"
    assert ws.verdict("pump chaser", noon - 4 * 3600, book, "nobody") == "AVOID"
    text = ws.report_text(res)
    assert "D…D: mostly DIP BUYER (100%)" in text
    assert "GO dip buyer midday" in text and "AVOID pump chaser morning" in text and "does NOT use it yet" in text
    small = ws.grade([0.5] * 19)
    assert small["verdict"] == "not sure yet" and small["n"] == 19          # 19 trades: too few to call
    assert book["by_mood"]["SOL up"]["n"] == 50 and book["by_mood"]["SOL down"] == {"n": 0}
    assert len(book["by_date"]) == 25 and "trades on 25 different days" in text and "DAYS: 0 of 0" not in text
    assert res["rows"][0]["sol24"] > 0 and res["rows"][0]["date"]
    one_day = ws.grade([0.5] * 30, [f"C{i}" for i in range(30)], days=["2026-11-03"] * 15 + ["2026-11-04"] * 15)
    assert one_day["verdict"] == "not sure yet" and one_day["days"] == 2       # 2 good days: not enough to call
    trips = [(noon + d * 86400 + k * 60, noon + d * 86400 + k * 60 + 600, 0.1, "M") for d in range(3) for k in range(10)]
    picked = ws.spread(trips, 6)
    assert len(picked) == 6 and len({ws.date_of(x[0]) for x in picked}) == 3     # spread over all 3 days
    assert abs(ws.sol_change(sol, noon) - (sol[sol.index <= noon].iloc[-1] / sol[sol.index <= noon - 86400].iloc[-1] - 1)) < 1e-12
    one_coin = ws.grade([0.5] * 30, ["PEAK"] * 30)
    assert one_coin["verdict"] == "not sure yet" and one_coin["coins"] == 1  # one coin's big run: can't be sure
    lucky = ws.grade([2.0] * 3 + [-0.1] * 27, [f"C{i}" for i in range(30)])
    assert lucky["avg"] > 0 and lucky["verdict"] == "not sure yet"          # 3 big wins, 27 losers: not sure


def test_copier_tags_each_buy_with_its_style_and_live_can_skip_what_the_playbook_avoids(tmp_path, monkeypatch):
    import datetime
    import json
    from bot import copytrade as ct
    from bot import solbot as sb
    from bot import wallet_styles as ws
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}}, "approved": ["W1"]}))
    (tmp_path / "models" / "wallet_styles.json").write_text(json.dumps({"playbook": {"by_style_slot": {
        "pump chaser|midday": {"n": 30, "verdict": "AVOID"}, "dip buyer|midday": {"n": 30, "verdict": "GO"}}}}))
    noon = datetime.datetime(2026, 11, 2, 12, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=-6))).timestamp()
    price = [1.0]
    moves = {"PUMP": 40, "DIP": -25}
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 50_000, "vol24": 1e5, "symbol": m, "age_h": 30,
                                                           "h1": moves[m], "h6": 0} for m in mints})
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})
    off = ct.Copier({"copytrade": {}}, lambda *a: None, live=True, wallet=_FakeLiveWallet(50, price), now=lambda: noon)
    off.on_swap("W1", "PUMP", 100)                                   # playbook off: copied, tagged
    assert off.positions["PUMP"]["style"] == "pump chaser"
    buy = off.state["trades"][-1]
    assert buy["style"] == "pump chaser" and buy["playbook"] == "AVOID" and buy["mint"] == "PUMP"
    on = ct.Copier({"copytrade": {"live": {"playbook": True}}}, lambda *a: None, live=True,
                   wallet=_FakeLiveWallet(50, price), now=lambda: noon)
    on.state["positions"] = on.positions = {}
    on.on_swap("W1", "PUMP", 100)                                    # playbook on: AVOID cell skipped
    on.on_swap("W1", "DIP", 100)                                     # GO cell copied
    assert set(on.positions) == {"DIP"}
    price[0] = 1.2
    on.on_swap("W1", "DIP", -100)
    rows = ws.practice_rows(on.state)
    assert rows and rows[0]["style"] == "dip buyer" and rows[0]["slot"] == "midday" and rows[0]["ret"] > 0.15
    lines = ct.style_lines(on.state)
    assert any(l.startswith("  style dip buyer: 1 trades, 1 won") for l in lines)
    assert any(l.startswith("  playbook said GO: 1 trades") for l in lines)


def test_copy_live_can_follow_only_chosen_wallets_judged_by_their_own_record(tmp_path, monkeypatch):
    import datetime
    import json
    from bot import copytrade as ct
    from bot import solbot as sb
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}, "W2": {}},
                                                                        "approved": ["W1"]}))
    (tmp_path / "models" / "wallet_styles.json").write_text(json.dumps({"playbook": {
        "by_style_slot": {"dip buyer|overnight": {"n": 60, "verdict": "AVOID"}},          # everyone's overnight dips lose
        "by_wallet": {"HD": {"quiet buyer|overnight": {"n": 30, "verdict": "AVOID"}}}}}))  # HD's own record differs
    night = datetime.datetime(2026, 11, 2, 23, 51, tzinfo=datetime.timezone(datetime.timedelta(hours=-6))).timestamp()
    price = [1.0]
    moves = {"DIP": (-17, 47), "CALM": (0, 0)}
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 50_000, "vol24": 1e5, "symbol": m, "age_h": 15,
                                                           "h1": moves[m][0], "h6": moves[m][1]} for m in mints})
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})
    cfg = {"copytrade": {"live": {"only": ["HD"], "follow_all": True, "playbook": True}}}
    c = ct.Copier(cfg, lambda *a: None, live=True, wallet=_FakeLiveWallet(50, price), now=lambda: night)
    assert c.wallets == ["HD"]                                       # only HD, even though it isn't in the finder's list
    practice = ct.Copier({"copytrade": {}}, lambda *a: None, now=lambda: night)
    practice.others.append(c)
    assert "HD" in practice.watched()                                # still listened to
    c.on_swap("HD", "DIP", 100)                                      # its 11:51 pm dip buy: copied (its own record)
    c.on_swap("HD", "CALM", 100)                                     # its own record says skip quiet overnight buys
    assert set(c.positions) == {"DIP"} and c.state["trades"][-1]["playbook"] == "not sure yet"
    assert ct.Copier({"copytrade": {"live": {}}}, lambda *a: None, live=True, wallet=_FakeLiveWallet(50, price),
                     now=lambda: night).wallets == ["W1"]            # without `only`: the approved ones, as before
    # switching to `only` while holding a coin another wallet bought: still copies that wallet's SELL, never its buys
    c.state["positions"]["OLD"] = {"wallets": ["W2"], "tokens": 1.0, "cost": 1.0, "entry": 1.0, "t": night}
    c.save()
    c2 = ct.Copier(cfg, lambda *a: None, live=True, wallet=_FakeLiveWallet(50, price), now=lambda: night)
    assert c2.wallets == ["HD", "W2"] and c2.buy_from == {"HD"}
    c2.on_swap("W2", "NEWCOIN", 100)
    assert "NEWCOIN" not in c2.positions
    # anytime: HD at every hour, the other wallets only in trade_hours
    cfg = {"copytrade": {"live": {"follow_all": True, "trade_hours": [11, 17], "anytime": ["HD"], "playbook": True}}}
    clock = [night]
    m = ct.Copier(cfg, lambda *a: None, live=True, wallet=_FakeLiveWallet(50, price), now=lambda: clock[0])
    m.state["positions"] = m.positions = {}
    assert m.wallets == ["W1", "W2", "HD"]
    m.on_swap("W1", "CALM", 100)                                     # 11:51 pm: not W1's hours
    m.on_swap("HD", "DIP", 100)                                      # HD: any hour
    assert set(m.positions) == {"DIP"}
    clock[0] = night - 11 * 3600 - 51 * 60 + 60 * 60                 # 1 pm
    m.on_swap("W1", "CALM", 100)
    assert set(m.positions) == {"DIP", "CALM"}


def test_copy_live_bad_day_brake_stops_buying_after_the_days_limit(tmp_path, monkeypatch):
    import datetime
    import json
    from bot import copytrade as ct
    from bot import solbot as sb
    monkeypatch.chdir(tmp_path)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "smart_wallets.json").write_text(json.dumps({"wallets": {"W1": {}}, "approved": ["W1"]}))
    noon = datetime.datetime(2026, 11, 2, 12, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=-6))).timestamp()
    clock = [noon]
    price = [1.0]
    monkeypatch.setattr(sb, "dex_info", lambda mints: {m: {"liq": 50_000, "vol24": 1e5, "symbol": m} for m in mints})
    monkeypatch.setattr(sb, "safety_check", lambda mint, *a: (True, "ok"))
    monkeypatch.setattr(sb, "prices", lambda mints: {m: {"usdPrice": price[0], "decimals": 6} for m in mints})
    told = []
    c = ct.Copier({"copytrade": {"live": {"max_daily_loss": 5, "anytime": ["HD"]}}}, lambda t, m: told.append(t), live=True,
                  wallet=_FakeLiveWallet(50, price), now=lambda: clock[0])
    for coin in ("A", "B"):                                          # two $6 trades that halve: -$6 today
        price[0] = 1.0
        c.on_swap("W1", coin, 100)
        price[0] = 0.5
        c.on_swap("W1", coin, -100)
    assert abs(c.lost_today() - 6) < 0.01
    price[0] = 1.0
    c.on_swap("W1", "C", 100)
    c.on_swap("W1", "D", 100)
    assert not c.positions and sum("bad-day brake" in t for t in told) == 1  # no buys, one ping
    assert "except HD…HD" in told[-1]
    c.on_swap("HD", "H", 100)                                        # an anytime wallet keeps being copied
    assert set(c.positions) == {"H"}
    clock[0] += 86400                                                # tomorrow: buying again
    c.on_swap("W1", "E", 100)
    assert "E" in c.positions and c.lost_today() == 0


def test_callouts_record_each_callout_score_sources_and_ping_coins_called_by_two():
    from bot import callouts as co

    st = {}
    info = {"A": {"price": 1.0, "liq": 50_000, "mcap": 1e6, "age_h": 3, "symbol": "AAA", "name": "Alpha"},
            "B": {"price": 2.0, "liq": 5_000, "mcap": 1e5, "age_h": 1, "symbol": "BBB", "name": "Beta"}}
    px = {"now": info}
    price_of = lambda mints: {m: px["now"][m] for m in mints if m in px["now"]}
    told = []
    cfg = co.load_settings("nope.yaml")
    co.check(st, cfg, 0.0, lambda t, m: told.append(t), [("A", "boost", ""), ("B", "boost", ""), ("X", "tg:c", "")],
             price_of, safe=lambda m: {"red": [], "green": ["an X account"], "score": 1, "desc": ""})
    assert set(st["seen"]) == {"A", "B"} and not told                       # X has no pool; one source each: no ping
    co.check(st, cfg, 600.0, lambda t, m: told.append(t), [("A", "trending", ""), ("B", "trending", "")],
             price_of, safe=lambda m: {"red": [], "green": ["an X account"], "score": 1, "desc": ""})
    assert told == ["📣 Callout: AAA (2 sources)"]                          # B's pool is too small to ping
    co.check(st, cfg, 900.0, lambda t, m: told.append(t), [("A", "tg:c", "")], price_of, safe=lambda m: {"red": [], "green": ["an X account"], "score": 1, "desc": ""})
    assert len(told) == 1                                                   # each coin once
    px["now"] = {"A": {**info["A"], "price": 3.0}, "B": {**info["B"], "liq": 100}}
    co.check(st, cfg, 3600.0 + 60, None, [], price_of)
    assert st["seen"]["A"]["later"]["1h"][1] == 3.0 and st["seen"]["B"]["later"]["1h"][1] == 0.0   # B's pool died
    board = co.scoreboard(st)
    assert abs(board["boost"]["1h"]["avg"] - ((3 * 0.98 - 1) + (0 - 1)) / 2) < 1e-9
    assert board["2+ sources"]["1h"]["doubled"] == 0.5 and board["trending"]["n"] == 2
    co.check(st, cfg, 25 * 3600.0, None, [], price_of)
    assert not st["seen"] and len(st["record"]) == 2                        # finished coins move to the record
    assert "6h later" not in co.report_text(st) or "boost" in co.report_text(st)
    page = ('<div class="tgme_widget_message x"><time datetime="2026-11-06T20:00:00+00:00"></time>'
            '<div>CA: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU send it</div></div>')

    class R:
        text = page
    import requests
    orig = requests.get
    requests.get = lambda *a, **k: R()
    try:
        assert co.telegram("calls", 0)[0][:2] == ("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "tg:calls")
        assert co.telegram("calls", 2e9) == []                              # older than the last check: skipped
    finally:
        requests.get = orig


def test_callout_purpose_check_flags_dump_setups_and_lists_a_real_projects_footprint():
    from bot import callouts as co

    clean_rug = {"token": {"supply": 1_000_000}, "creatorBalance": 0, "graphInsidersDetected": 0, "totalHolders": 2400,
                 "markets": [{"lp": {"lpLockedPct": 100}}], "topHolders": [{"pct": 4.0, "address": "w1"}], "risks": []}
    day = 86_400_000
    pair = {"priceChange": {"h1": 12, "h6": 40}, "txns": {"h1": {"buys": 80, "sells": 60}}, "liquidity": {"usd": 150_000},
            "marketCap": 2_000_000, "volume": {"h24": 500_000}, "pairCreatedAt": __import__("time").time() * 1000 - 5 * day,
            "info": {"websites": [{"url": "https://realproject.example"}, {"url": "https://github.com/x/y"}],
                     "socials": [{"type": "twitter", "url": "https://x.com/p"}, {"type": "telegram", "url": "https://t.me/p"}],
                     "description": "A game where you stake memes"}}
    v = co.vet("M", clean_rug, pair, loads=lambda u: "realproject" in u)
    assert v["red"] == [] and v["score"] == 6 and "code or docs" in v["green"] and "2,400 holders" in v["green"]
    assert "Purpose check 6/6" in co.vet_line(v) and "stake memes" in co.vet_line(v)
    dumpy = {**clean_rug, "creatorBalance": 120_000, "graphInsidersDetected": 8, "totalHolders": 150,
             "markets": [{"lp": {"lpLockedPct": 20}}]}
    late = {**pair, "priceChange": {"h1": 250, "h6": 900}, "txns": {"h1": {"buys": 10, "sells": 45}},
            "liquidity": {"usd": 30_000}, "marketCap": 3_000_000, "info": {}}     # a 1% pool
    r = co.vet("M", dumpy, late, loads=lambda u: False)
    text = " | ".join(r["red"])
    for bit in ("insider wallets", "creator still holds 12%", "isn't locked", "already pumped", "sold off",
                "only 150 holders", "thin pool"):
        assert bit in text, bit
    assert r["score"] <= 1 and "pure speculation" in co.vet_line(r)
    assert not co.site_loads("https://x.com/someone")                      # a social profile isn't a website
    big = {**clean_rug, "graphInsidersDetected": 5000, "totalHolders": 1_000_000}
    assert co.vet("M", big, {**pair, "marketCap": 400_000_000}, loads=lambda u: True)["red"] == []   # a sliver: fine


def test_kalshi_maker_bids_rest_at_the_bid_and_fill_only_when_someone_sells_below():
    from bot import kalshi as k

    mk = lambda t, bid, ask: {"ticker": t, "yes_sub_title": t, "yes_bid_dollars": str(bid), "yes_ask_dollars": str(ask)}
    ev = {"event_ticker": "EV", "title": "Chicago high Nov 9?",
          "markets": [mk("FAV", 0.66, 0.69), mk("MID", 0.20, 0.23), mk("LOW", 0.03, 0.05)]}
    views = [(ev, {"tomorrow": True})]
    acct = {"cash": 100.0, "positions": {}}
    prints = {"FAV": []}
    told = []
    trades_of = lambda t, since: [p for p in prints.get(t, []) if p["t"] > since]
    assert k.maker_step(acct, views, k.STRATEGIES["M"]["rules"], {"max_per_trade": 5}, lambda *a: told.append(a), 100.0,
                        trades_of) == 0
    assert acct["resting"]["FAV"]["price"] == 0.66 and not acct["positions"]            # resting, not bought
    prints["FAV"] = [{"t": 150.0, "yes_price_dollars": "0.66"}]                           # a trade AT our price: not enough
    ev["markets"][0] = mk("FAV", 0.67, 0.70)
    assert k.maker_step(acct, views, k.STRATEGIES["M"]["rules"], {"max_per_trade": 5}, lambda *a: told.append(a), 200.0,
                        trades_of) == 0
    assert acct["resting"]["FAV"]["price"] == 0.67                                     # re-priced to the new best bid
    prints["FAV"].append({"t": 250.0, "yes_price_dollars": "0.65"})                       # someone sold below us: filled
    assert k.maker_step(acct, views, k.STRATEGIES["M"]["rules"], {"max_per_trade": 5}, lambda *a: told.append(a), 300.0,
                        trades_of) == 1
    p = acct["positions"]["FAV"]
    assert p["count"] == 7 and p["price"] == 0.67 and abs(p["cost"] - (7 * 0.67 + k.maker_fee(0.67, 7))) < 1e-9
    assert not acct["resting"] and told
    acct2 = {"cash": 100.0, "positions": {}}
    k.maker_step(acct2, views, k.STRATEGIES["M"]["rules"], {}, lambda *a: None, 100.0, lambda t, s: [])
    k.maker_step(acct2, [(ev, {"tomorrow": False})], k.STRATEGIES["M"]["rules"], {}, lambda *a: None, 200.0,
                 lambda t, s: [])
    assert not acct2["resting"] and not acct2["positions"]                              # the day began: cancelled
    wide = {**ev, "markets": [mk("FAV", 0.62, 0.90)]}
    acct3 = {"cash": 100.0, "positions": {}}
    k.maker_step(acct3, [(wide, {"tomorrow": True})], k.STRATEGIES["M"]["rules"], {}, lambda *a: None, 1.0, lambda t, s: [])
    assert not acct3.get("resting")                                                    # a 28c spread: no bid


def _pump_trade(mint_b, sol, tok, buy, user_b, ts, vs, vt, rs, fee_bps=95, creator_bps=5):
    import hashlib
    import struct
    raw = hashlib.sha256(b"event:TradeEvent").digest()[:8] + mint_b + struct.pack("<QQ", int(sol * 1e9), int(tok * 1e6))
    raw += bytes([1 if buy else 0]) + user_b + struct.pack("<qQQQQ", ts, int(vs * 1e9), int(vt * 1e6), int(rs * 1e9), 0)
    raw += b"\x00" * 32 + struct.pack("<QQ", fee_bps, 0) + b"\x00" * 32 + struct.pack("<QQ", creator_bps, 0)
    import base64
    return "Program data: " + base64.b64encode(raw).decode()


def test_launch_lab_decodes_pump_trades_and_prices_fills_on_the_curve_with_delays_and_fees():
    from bot import launch_lab as ll

    line = _pump_trade(b"\x01" * 32, 1.0, 34_000_000, True, b"\x02" * 32, 1_800_000_000, 31.0, 1_039_000_000, 1.0)
    e = ll.decode(line)
    assert e["kind"] == "trade" and e["buy"] and abs(e["sol"] - 1.0) < 1e-9 and abs(e["vsol"] - 31.0) < 1e-6
    assert abs(e["fee"] - 0.01) < 1e-12 and e["mint"] == ll.b58(b"\x01" * 32)
    tok = ll.buy_tokens(31.0, 1_039_000_000, 1.0, 0.01)
    back = ll.sell_sol(31.0 + 0.99, 1_039_000_000 - tok, tok, 0.01)
    assert 0.97 < back < 0.99                                              # a round trip costs the two fees
    lab = ll.Lab(sol_usd=200.0)
    ev = lambda vs, vt, rs, sol=0.5, buy=True, user=b"\x03" * 32: ll.decode(
        _pump_trade(b"\x09" * 32, sol, 1e6, buy, user, 1, vs, vt, rs))
    lab.event(100.0, ev(31.0, 1_039_000_000, 1.0, sol=1.0))                 # launch (the dev's buy)
    a = lab.accts["snipe"]
    assert len(a.pending) == 1 and a.cash == 750.0 and not a.positions         # ordered, not yet filled
    lab.event(101.0, ev(32.0, 1_006_000_000, 2.0))                          # too soon: still waiting
    assert not a.positions
    lab.event(101.6, ev(33.0, 975_000_000, 3.0))                            # 1.6 s after the signal: filled here
    p = a.positions[ll.b58(b"\x09" * 32)]
    assert abs(p["entry"] - 33.0 / 975_000_000) < 1e-15 and p["lag"] == 1.6
    lab.event(110.0, ev(70.0, 460_000_000, 40.0, sol=5.0))                  # price way up: take profit (+100%+)
    assert a.positions[ll.b58(b"\x09" * 32)].get("selling")
    lab.event(111.2, ev(71.0, 453_000_000, 41.0))
    assert a.n == 1 and a.wins == 1 and a.pnl > 200 and not a.positions
    assert "Snipe every new coin: last 1 h 1 trades, 1-0" in lab.board(112.0) and "Since it started: 1 trades, 100% won" in lab.board(112.0)
    lab.event(112.0, ev(80.0, 400_000_000, 85.0))                           # the curve completes: graduated
    for acct in lab.accts.values():
        assert not acct.positions and not acct.pending                     # everything sold or refunded
    snap = lab.snapshot()
    assert snap["accounts"]["snipe"]["n"] == 1 and snap["accounts"]["snipe"]["cash"] > 1000
    st = lab.to_state(200.0)
    assert st["accounts"]["snipe"]["n"] == 1 and all(v["cash"] > 0 for v in st["accounts"].values())


def test_launch_lab_follows_whales_and_momentum_only_with_enough_buyers():
    from bot import launch_lab as ll

    lab = ll.Lab(sol_usd=200.0)
    mint = b"\x07" * 32
    ev = lambda vs, vt, rs, sol=0.3, buy=True, u=0: ll.decode(_pump_trade(mint, sol, 1e6, buy, bytes([u]) * 32, 1, vs, vt, rs))
    lab.event(0.0, ev(31.0, 1_039_000_000, 1.0, sol=1.0, u=200))
    for i in range(20):                                                     # 20 different buyers, price climbing
        lab.event(3.0 * i + 1, ev(31.0 + i * 1.5, 1_039_000_000 - i * 30_000_000, 1.0 + i * 1.5, u=i + 1))
    lab.event(62.0, ev(70.0, 460_000_000, 40.0, u=50))
    assert lab.accts["momentum_60s"].pending or lab.accts["momentum_60s"].positions
    lab.event(63.0, ev(72.0, 450_000_000, 42.0, sol=6.0, u=60))             # a 6 SOL buy
    assert lab.accts["whale_follow"].pending


def test_launch_lab_splits_results_by_time_of_day_and_keeps_old_trades_counted():
    import datetime
    from zoneinfo import ZoneInfo

    from bot import launch_lab as ll

    at = lambda h: datetime.datetime(2026, 11, 7, h, 30, tzinfo=ZoneInfo("America/Chicago")).timestamp()
    # an account saved before the tally: 5 trades in all, but only the last 3 were kept (all midday)
    old = {"cash": 1100.0, "n": 5, "wins": 3, "pnl": 100.0,
           "trades": [{"t": at(15), "s": 30, "profit": 50.0}, {"t": at(15), "s": 30, "profit": -20.0},
                      {"t": at(16), "s": 30, "profit": 40.0}]}
    lab = ll.Lab(state={"accounts": {"volume_spike": old}})
    a = lab.accts["volume_spike"]
    assert a.slot(11, 17) == (5, 3, 100.0)              # the 2 trades it no longer has count in the oldest kept hour
    a.tally(at(20), -30.0)                              # 8:30 pm: evening
    a.tally(at(2), 10.0)                                # 2:30 am: overnight
    assert a.slot(17, 23) == (1, 0, -30.0) and a.slot(23, 5) == (1, 1, 10.0)
    again = ll.Lab(state={"accounts": {"volume_spike": a.to_dict()}}).accts["volume_spike"]
    assert again.by_hour == a.by_hour
    lab.accts["snipe"].cash = 197.0                      # busted: a short line, and no time-of-day line
    board = lab.board(now=at(21))
    assert "By time of day" in board and "midday 11a-5p 5 trades, 60% won, +100" in board
    assert "evening 5-11p 1 trades, 0% won, -30" in board and "overnight 11p-5a 1 trades" in board
    assert "busted" in board.split("Snipe every new coin")[1].split("\n")[0]
    assert "Snipe every new coin" not in board.split("By time of day")[1]
    assert "window vs the rest" not in board            # nothing inside 11a-3:40p yet
    a.tally(at(15) - 20 * 60, 25.0)                     # 3:10 pm: inside the window
    a.tally(at(15) + 15 * 60, -5.0)                     # 3:45 pm: just after it
    assert a.window == {"in": [1, 1, 25.0], "out": [3, 1, -25.0]}
    board = lab.board(now=at(21))
    assert "in it 1 trades, 100% won, +25 | rest 3 trades, 33% won, -25" in board
    assert ll.Lab(state={"accounts": {"volume_spike": a.to_dict()}}).accts["volume_spike"].window == a.window
