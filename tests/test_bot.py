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
    assert sent == [("SELL TEST at $120.00", False)]
