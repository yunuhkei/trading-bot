# From backtest to real trading: a practical guide

This guide takes you from "the code runs" to "the bot trades my account", in order.
Don't skip steps. Most people who lose money with bots skip step 3 or step 4.

---

## 0. Set your expectations

- **A bot automates a strategy; it doesn't create an edge.** If the strategy loses money by hand, the bot loses money faster.
- **Most retail trading strategies lose to buy-and-hold after fees.** Assume yours will too until real data says otherwise.
- **Shorting adds risk.** A long can lose at most 100%. A short's loss has no ceiling if price keeps rising.
  That's why the stop-loss and the drawdown kill switch exist.
- **Only trade money you can afford to lose completely.**

---

## 1. Choose where you'll trade

### Coinbase spot (long only): the easiest start
- You buy and sell actual coins. **You can't short on Coinbase spot.**
- Config: `exchange: coinbase`, `symbol: BTC/USD` (or `BTC/USDC`), `market_type: spot`, `allow_short: false`.
- **Fees are the big problem.** Taker fees at Coinbase's low-volume tiers are high (often 0.6% or more per side;
  check *Settings → Fees* in Coinbase Advanced for your current rate). At 0.6%, a round trip costs about 1.2%.
  A strategy that trades every few hours will be eaten alive. That's why the example config uses `4h` candles
  and `fee_pct: 0.006`. Put your real fee in `fee_pct`.

### Coinbase futures (long and short)
- Shorting needs a derivatives account. In the US that's **Coinbase Financial Markets** futures, which you enable
  inside Coinbase Advanced. It needs a separate application and approval.
  Outside the US, Coinbase International Exchange has its own ccxt class: `exchange: coinbaseinternational`.
  The ccxt library notes that the international perpetuals ("INTX") were removed from Coinbase Advanced
  on 2026-10-01.
- **Products and rules change often.** Check Coinbase's site for what's available to you before relying on this section.
- Find the exact symbol with:
  ```bash
  python -m bot -c config.yaml markets --search BTC
  ```
  Futures rows show `future` or `swap` and a **contract size**. The contract size matters: if one contract is
  0.01 BTC and BTC is $100,000, the smallest possible trade is about $1,000 of exposure. With a smaller account
  the bot can't trade at 1x and will refuse to place the order ("Order too small").
- Config: `market_type: future` (or `swap`), the derivatives symbol, `allow_short: true`.
- Things that don't exist on spot:
  - **Margin and liquidation.** The exchange can force-close your position if your margin runs low.
    The bot sizes at 1x notional (position value ≈ your equity), which keeps you far from liquidation.
    Don't raise `position_pct` above 1.
  - **Funding and expiry.** Perpetual-style contracts charge or pay funding periodically. Dated futures expire,
    and the bot doesn't roll expiring contracts, so you would update `symbol` yourself before expiry.

### Fomo
**This bot can't trade on Fomo.** Fomo (by FOMO Labs) is a social mobile/web app for trading on-chain tokens
(Solana, Base, BNB Chain and others). I found no public trading API, and ccxt doesn't support it, so nothing can
place orders there automatically. If you use Fomo, use this bot's backtester to *study* ideas and trade there by hand.
Be aware that the small on-chain tokens popular there are extremely volatile and easy to manipulate.
Strategies tested on BTC don't carry over.

---

## 2. Backtest on real data

```bash
pip install -r requirements.txt
cp config.example.yaml config.yaml          # set exchange, symbol, fee_pct
python -m bot -c config.yaml backtest --days 730 --trades
```

How to read the results:

| metric | what you want |
|---|---|
| `total_return_pct` vs `buy_hold_return_pct` | beating buy-and-hold, *or* a similar return with a much smaller drawdown |
| `max_drawdown_pct` | a number you could sit through without panicking (20–30% is already painful) |
| `sharpe` | above 1 is decent; above 3 on a backtest usually means something's wrong or overfit |
| `trades` | enough to mean something (30+). Five lucky trades prove nothing |
| `win_rate_pct` | low is fine for breakout strategies (35–45%) *if* the winners are bigger than the losers |

Compare `allow_short: true` against `false`. Shorting helps in bear markets and often hurts in bull markets,
when every short gets squeezed.

---

## 3. Check you haven't fooled yourself (out-of-sample)

The most common mistake is tweaking parameters until the backtest looks great. That's **overfitting**:
you've memorized the past rather than found something that repeats.

1. Pick parameters using only older data:
   ```bash
   python -m bot -c config.yaml backtest --days 1095 --end 2025-10-31
   ```
2. **Without changing anything**, test on data you never looked at:
   ```bash
   python -m bot -c config.yaml backtest --days 1095 --start 2025-11-01
   ```
3. If the second result falls apart, the strategy doesn't work. Don't keep re-tuning until it does.
4. Also check that small parameter changes (e.g. `entry: 15` or `25` instead of `20`) give similar results.
   If only one exact setting works, it's luck.

About my own test results: the synthetic data in this project has long trends built in, which favors
trend-following strategies like `breakout`. Its good numbers there aren't evidence about real markets.
They did show that raising fees from 0.26% to 0.6% cut returns roughly in half.

---

## 4. Paper trade for at least 4 weeks

```bash
python -m bot -c config.yaml paper
```

This uses **live Coinbase prices** with fake money. Leave it running on a machine that stays on
(a cheap cloud VPS is ideal; a laptop that sleeps will miss candles).
Each week, compare `trades.csv` with what the backtest predicted for that period.
If the bot behaves differently than expected, find out why *before* real money is involved.

To run it in the background on a Linux server:
```bash
nohup python -m bot -c config.yaml paper >> bot.log 2>&1 &
tail -f bot.log
```

---

## 5. Create a Coinbase API key (safely)

1. Go to the **Coinbase Developer Platform** (portal.cdp.coinbase.com) → *API Keys* → create a key.
2. Permissions: **View** and **Trade** only. **Never enable Transfer/Withdraw.** Then a stolen key can't
   move your money out.
3. If offered, restrict the key to your server's IP address.
4. You get a **key name** (looks like `organizations/.../apiKeys/...`) and a **private key** (a multi-line
   `-----BEGIN EC PRIVATE KEY-----` block). Store them as environment variables, never in the config file or git:
   ```bash
   export EXCHANGE_API_KEY='organizations/xxx/apiKeys/yyy'
   export EXCHANGE_API_SECRET='-----BEGIN EC PRIVATE KEY-----\nMHc...\n-----END EC PRIVATE KEY-----\n'
   ```
   (`\n` escapes are fine; the bot converts them.)

---

## 6. Go live, small

1. Put only a **small amount** in the account to start: an amount whose loss would just be tuition.
2. Edit `config.yaml`: `mode: live`. Delete the paper `state.json` so the bot starts fresh.
3. Confirm you mean it:
   ```bash
   export BOT_LIVE_CONFIRM=I_UNDERSTAND_THIS_USES_REAL_MONEY
   ```
4. Run a **single step** first and check what it did, both in the log and in the Coinbase app:
   ```bash
   python -m bot -c config.yaml live --once
   ```
5. Then run it continuously (on the VPS, under `nohup`, `systemd` or Docker with `restart: unless-stopped`):
   ```bash
   python -m bot -c config.yaml live
   ```

The bot checks the stop-loss every `poll_seconds` and makes strategy decisions once per closed candle.
If the stop-loss is hit, it sells (or covers a short) at market.

---

## 7. Operate it

- **Check daily:** the log, `trades.csv`, and your Coinbase balance. They should agree.
- **To stop:** Ctrl-C or kill the process. **Stopping the bot doesn't close your position.**
  Close it in the Coinbase app if you want to be flat.
- **Kill switch:** if equity falls `max_drawdown_pct` from its peak, the bot closes everything and refuses to trade.
  Work out what went wrong before you delete `state.json` to re-enable it.
- **Don't manually trade the same symbol** in the same account while the bot runs; it will get confused about its position.
- **Exchange-side stops:** the bot's stop only works while the bot is running. If your server dies during a crash,
  nothing protects you. Consider also placing a manual stop order on Coinbase as a backstop.

---

## 8. Taxes and records

In the US, every sell, cover or close is a taxable event, and short-term gains are taxed as ordinary income.
Keep `trades.csv`. Coinbase also provides tax documents, but your records are your backup.
Talk to a tax professional if you trade often.

---

## Checklist before real money

- [ ] Real fee rate entered in `fee_pct`
- [ ] Backtest on 2+ years of real data beats buy-and-hold or has a much lower drawdown
- [ ] Out-of-sample test still works, and nearby parameters do too
- [ ] 4+ weeks of paper trading that matched expectations
- [ ] API key has **no withdraw permission** and lives in env vars, not files
- [ ] Starting with money you can afford to lose
- [ ] Bot runs on an always-on machine, and you check it daily
- [ ] (Shorts) futures account approved, contract size fits your account, `position_pct` ≤ 1
