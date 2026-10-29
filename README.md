# trading-bot

A small, safety-first spot crypto trading bot built on [ccxt](https://github.com/ccxt/ccxt) (100+ exchanges).
It runs one strategy on one symbol, long or long/short, and acts once per closed candle.

**New to this?** Start with [HOW_TO_USE.md](HOW_TO_USE.md) to run it on your phone or computer,
then [GUIDE.md](GUIDE.md) for going from backtest to real trading on Coinbase.

## What the tests found (Oct 2026)

All tests use real prices and fees, pick settings on older "practice" data and grade them on newer "exam" data.

| Style | Tested on | Result |
|---|---|---|
| **200-day trend filter** (`config.trend.yaml`) | 10 markets, daily, 2015–2026 | Best overall. Smaller crashes in all 10 markets; usually less profit than simply holding in rising markets |
| Monthly coin rotation (`rotation`) | 40 Coinbase coins, 2018–2026 | Lost money in 75% of versions in 2022–2026; only 10% beat holding Bitcoin |
| Day trading (`config.daytrade.yaml`) | 20 markets (10 coins, 10 stocks), 5m–1h candles | Best rule (RSI dip buying) succeeded in ~30% of tests and made little; **0% at Coinbase spot fees** |
| Short-term crypto trading | Bitcoin, 1m–1h candles | No better than random trades, even with zero fees |
| Shorting | everywhere | Made results worse in most markets |

Simply holding a broad market (Bitcoin, or an S&P 500 fund) beat most strategies on profit.

**Workflow:** backtest → paper trade → (optionally) live. Live trading is off by default and has three locks.

## Setup

```bash
pip install -r requirements.txt
cp config.example.yaml config.yaml   # edit exchange / symbol / strategy / risk
```

## Commands

```bash
python -m bot -c config.yaml backtest                 # 180 days of real exchange data
python -m bot -c config.yaml backtest --days 365 --trades
python -m bot -c config.yaml backtest --data csv:btc.csv
python -m bot -c config.yaml backtest --days 730 --start 2026-01-01   # out-of-sample check
python -m bot -c config.yaml markets --search BTC     # list symbols, incl. futures contracts
python -m bot -c config.yaml optimize --data csv:data/btc_usd_1d.csv --split 2022-01-01 --out results.csv
python -m bot backtest --data synthetic               # offline random-walk data

python -m bot -c config.yaml paper                    # paper trade against live prices (Ctrl-C to stop)
python -m bot -c config.yaml paper --replay synthetic # run the live loop over historical bars

python -m bot -c config.yaml live                     # real money; see below
python -m pytest
```

Note that `-c` goes before the subcommand.

## Strategies (`bot/strategies.py`)

| name | idea | params |
|---|---|---|
| `sma_cross` | long while the fast MA is above the slow MA; optionally skip entries when RSI is overbought | `fast`, `slow`, `use_ema`, `rsi_max` |
| `rsi_revert` | buy oversold (RSI < low), sell on recovery (RSI > high); mirrored for shorts | `period`, `low`, `high` |
| `trend` | hold while price is above its N-bar average (± a band to avoid flip-flopping); short below | `period`, `band` |
| `momentum` | long if price is higher than N bars ago, short if lower | `lookback` |
| `breakout` | Donchian breakout with a trend filter: long on new N-bar highs above the trend EMA, short on new lows below it | `entry`, `exit`, `trend` |

To add one, subclass `Strategy`, implement `signals(df) -> Series of 1/0/-1`, set `warmup`, and register it in `STRATEGIES`.
A signal on bar *t* may only use data up to bar *t*'s close; it is executed at bar *t+1*'s open.
`test_no_lookahead` checks this.

## Finding a strategy (`optimize`)

`optimize` runs every strategy in `bot/optimize.py:GRIDS` × every risk setting × long-only/long-short
(about 2,400 backtests). It ranks them on data **before** `--split`, then shows how they did **after** it.
Only trust a setup that does well after the split, and whose neighbouring settings do too.

`data/btc_usd_1d.csv` holds Coinbase BTC-USD daily candles from 2015-07-20 to 2026-10-28.
Loaded data passes through `clean()`, which repairs bad ticks. For example, Coinbase's history shows a $0.06 low on 2017-04-15.

On that data the most robust result was `trend` with `period: 200, band: 0.02`, long-only, with no stop
and no emergency stop: see `config.trend.yaml`. It cut the worst crash from about 80% to about 55%, but in most
periods it made less than simply holding.

## Day trading (`day_trade: true`)

With `day_trade: true`, every position is closed on the last candle of each day (UTC date; this is also the
US stock close). Day-trading strategies: `orb` (opening range breakout), `vwap` (revert to / trend away from the
day's VWAP), `bollinger` (band mean reversion), `eod_momentum` (ride the day's direction into the close).
`search(..., day_trade=True)` in `bot/optimize.py` uses `DAY_GRIDS` and tight `DAY_RISK` stops.

## Monthly rotation (`rotation`)

`python -m bot rotation --top 3 --lookback 30 --filter btc --start 2022-01-01` holds the coins with the biggest
gains over the last `lookback` days, re-picked on the 1st of each month. `--filter self` skips falling coins;
`--filter btc` holds cash while Bitcoin is below its 200-day average. Coin data: `data/daily/` (Coinbase, 40 coins).
Note: it only includes coins still listed on Coinbase today, which flatters results (delisted coins that went to zero are missing).

## Short selling

Set `allow_short: true`. Strategies then emit -1 (short) as well as 1 (long) and 0 (flat).
With it off, every -1 becomes 0, so the same strategy runs long-only.

- **Backtests and paper trading** simulate shorts on any symbol. `short_carry_pct_per_day` charges
  an estimated funding or borrow cost on short positions in backtests.
- **Live shorting needs a derivatives market**, because you can't short spot coins on Coinbase.
  Set `market_type: future` (or `swap`) and a derivatives symbol from `python -m bot markets`.
  The bot sizes positions at 1x notional and closes them with `reduceOnly` orders.
- Stops are mirrored for shorts: a 5% stop on a short exits if price *rises* 5%.

## Risk controls (`risk:` in the config)

- `position_pct`: fraction of equity deployed per entry
- `stop_loss_pct` / `take_profit_pct`: fixed exits measured from the entry price, for longs and shorts. After a stop the bot waits for the signal to reset before re-entering.
- `max_drawdown_pct`: kill switch. It sells everything and halts. Delete the state file to resume.
- `fee_pct` and `slippage_pct` apply on every fill, in backtests and in paper trading.

## Going live

Three conditions must all be met:
1. `mode: live` in the config
2. `EXCHANGE_API_KEY` / `EXCHANGE_API_SECRET` env vars (use a key with **trade-only, no withdrawal** permission)
3. `BOT_LIVE_CONFIRM=I_UNDERSTAND_THIS_USES_REAL_MONEY`

Paper trade for weeks first. Run it under a process supervisor (systemd, Docker `restart: unless-stopped`).
State (entry price, equity peak, halt flag, last processed bar) lives in `state_file` so restarts don't double-trade.
Every fill is appended to `trade_log` (CSV).

## Caveats

This is a framework, not a money printer. The default strategies are textbook examples with no proven edge.
Backtests ignore order-book depth, outages and partial fills. A good backtest on one period is often overfitting.
Never trade money you can't afford to lose.
