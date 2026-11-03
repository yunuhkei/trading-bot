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


def test_kalshi_weather_view_uses_what_was_recorded_the_models_and_the_rest_of_the_day():
    from datetime import date, datetime, timezone
    from bot import kalshi as k
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
    monkeypatch.setattr(k, "weather_ideas", lambda *a, **kw: [])
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
