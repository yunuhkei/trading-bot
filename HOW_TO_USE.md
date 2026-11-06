# How to use the bot on your phone or computer

There are three ways. Pick the one that fits:

| | Phone | Computer | Install anything? | Runs 24/7? |
|---|---|---|---|---|
| **A. GitHub Codespaces** (a computer in your browser) | ✅ | ✅ | No | No (stops when you close it) |
| **B. Your own computer** | ❌ | ✅ | Python + GitHub Desktop | Only while your computer is on |
| **C. Ask Claude** | ✅ | ✅ | No | No |

For practice trading that runs around the clock, see "Running it 24/7" at the bottom.

---

## A. GitHub Codespaces: works on a phone, no installs

Codespaces gives you a free computer in your web browser with everything set up.
Personal GitHub accounts get a free monthly allowance, which is plenty for running tests.

1. Open **github.com** in your phone's browser (not the GitHub app) and go to your `trading-bot` repository.
   On a phone, tap **"Aa"** or the **⋮** menu and choose **"Request desktop website"**, because the button is hidden on the mobile layout.
2. Tap the green **`<> Code`** button → **Codespaces** tab → **Create codespace on main**.
3. Wait about a minute. A code editor opens with a **terminal** at the bottom (if not: **☰ menu → Terminal → New Terminal**).
4. In the terminal, type this once and press Enter:
   ```bash
   pip install -r requirements.txt
   ```
5. Now run any command from the **cheat sheet** below.
6. When you're done, close the tab. The codespace stops by itself after 30 minutes idle.
   To come back: **`<> Code` → Codespaces** → tap the one you made.

Tip: on a phone, turn it sideways. The terminal is much easier to read.

---

## B. On your own computer (Windows or Mac)

### One-time setup (about 10 minutes)

1. **Install Python** from **python.org/downloads** (version 3.11 or newer).
   - **Windows:** on the first installer screen, tick **"Add python.exe to PATH"**, then click Install.
   - **Mac:** run the installer, then double-click **"Install Certificates.command"** in the Python folder it opens.
2. **Install GitHub Desktop** from **desktop.github.com** and sign in with your GitHub account.
3. In GitHub Desktop: **File → Clone repository** → pick `trading-bot` → **Clone**.
4. Open a terminal **in that folder**: in GitHub Desktop, choose **Repository → Open in Command Prompt** (Windows) or **Open in Terminal** (Mac).
5. Install the bot's parts:
   ```bash
   pip install -r requirements.txt
   ```
   (On Mac, if `pip` isn't found, use `pip3`, and use `python3` instead of `python` in the commands below.)

### Getting updates

When there's a new version on GitHub, click **Fetch origin → Pull origin** in GitHub Desktop.

---

## C. Ask Claude

In the Claude app (phone or computer), you can ask things like
*"run the trend filter backtest on Ethereum"* or *"test monthly rotation with the top 5 coins"*,
and Claude runs it for you and explains the results.

---

## Cheat sheet

Copy and paste these into the terminal. Results show up as text in a few seconds.

**Backtests (test a strategy on past prices; no money involved)**
```bash
# The best long-term strategy (200-day trend filter) on Bitcoin since 2022
python -m bot -c config.trend.yaml backtest --data csv:data/btc_usd_1d.csv --start 2022-01-01

# Same, on Ethereum
python -m bot -c config.trend.yaml backtest --data csv:data/eth_1d.csv --start 2022-01-01

# Monthly coin rotation: hold the top 3 risers of the last 30 days, re-picked each month
python -m bot rotation --top 3 --lookback 30 --start 2022-01-01 --picks 6

# The best day-trading rule (RSI dip buying) on Nvidia 15-minute candles
python -m bot -c config.daytrade.yaml backtest --data csv:data/intraday/nvda_15m.csv --days 0 --trades
```

**Practice trading with fake money (live prices)**
```bash
python -m bot -c config.trend.yaml paper
```
Leave it running. It checks prices every few minutes and logs what it would do.
Press **Ctrl + C** to stop. Its fake trades are saved in `trades.csv`.

**Run the full strategy search yourself**
```bash
python -m bot -c config.trend.yaml optimize --data csv:data/btc_usd_1d.csv --split 2022-01-01 --top 10
```

**Check everything still works**
```bash
python -m pytest -q
```

If you get **"command not found"**, use `python3` instead of `python`.
If you get **"No module named …"**, run `pip install -r requirements.txt` again.

---

## Buy/sell alerts on your phone

The bot can work as a **signal bot**: it never trades. It tells you **🟢 BUY** or **🔴 SELL**, and you place the trade yourself
in Coinbase, Fomo or any other app.

**See the signals right now**
```bash
# 200-day trend filter on a watchlist (crypto like BTC-USD from Coinbase, stocks/funds like SPY from Yahoo)
python -m bot -c config.trend.yaml signals --markets BTC-USD,ETH-USD,SOL-USD,SPY,QQQ,NVDA

# Day-trading signals (RSI dip buying, 15-minute candles)
python -m bot -c config.daytrade.yaml signals --markets BTC-USD,ETH-USD,NVDA
```
Each row shows **IN** (buy / keep holding) or **OUT** (sell / stay in cash), when it last changed, and
how far the price must move to flip it.

**Get phone notifications. The easiest way is the free ntfy app.**
1. Install **ntfy** from the App Store or Google Play. No account is needed.
2. Tap **+** and subscribe to a topic with a long, random name only you know, e.g. `tbot-7f3k9q2xw1`.
   (Anyone who guesses the name can read it, so don't use your name.)
3. Test it:
   ```bash
   python -m bot signals --notify ntfy:tbot-7f3k9q2xw1 --test-alert
   ```
4. Keep it checking every 30 minutes, and get an alert whenever a signal changes:
   ```bash
   python -m bot -c config.trend.yaml signals --markets BTC-USD,ETH-USD,SOL-USD,SPY --notify ntfy:tbot-7f3k9q2xw1 --every 30
   ```
Other options: `--notify discord:WEBHOOK_URL` (a channel in your own Discord server: Server Settings → Integrations →
Webhooks → copy URL) or `--notify telegram:BOT_TOKEN:CHAT_ID` (a bot made with @BotFather).

**Let GitHub run it for you every hour, for free (no computer needed)**
Once the project is in your GitHub repository:
1. Repository → **Settings → Secrets and variables → Actions → New repository secret**:
   name `ALERT_TARGET`, value `ntfy:tbot-7f3k9q2xw1` (your own topic).
2. Optional, under the **Variables** tab: `MARKETS` (e.g. `BTC-USD,ETH-USD,SPY`) and `CONFIG` (e.g. `config.daytrade.yaml`).
3. Go to the **Actions** tab → enable workflows → **signals → Run workflow** to test it.
It then checks every hour (`.github/workflows/signals.yml`) and only alerts when something changes.

**Meme-coin alerts, including coins you trade on Fomo**
```bash
# 20-day breakout signals for the meme coins in watchlist.memes.txt; alerts say "BUY $30 of ..."
python -m bot -c config.memes.yaml signals --watchlist watchlist.memes.txt --stake 30 --notify ntfy:tbot-7f3k9q2xw1 --every 60
```
To add a Fomo coin, copy its contract address in Fomo and add a line `sol:<address>` (or `base:`/`bsc:`) to
`watchlist.memes.txt`. The bot reads its price from the coin's public trading pool. It can't see Fomo's own lists.

**Meme-coin research tools** (paper only, Solana):
```bash
python -m bot launches watch --hours 2 --last 1h   # record new coins and their prices for the next hour
python -m bot launches news --hours 2              # in a second terminal: flag coins named after the news
python -m bot launches report                      # results, incl. news-matched vs everything else
```

## Scalping practice bot (all day, self-tuning)

**Switched off (Nov 3 2026):** it never showed an edge after fees. The young-coin alerts are off too: the Solana bot
trades that list and reports every real trade, so the scalp workflow no longer runs on a schedule. To bring it back, set `enabled: true` on the
scalping list and under `practice_trading:` in `alerts.scalp.yaml`. The young-coin alerts keep running either way.

The **scalp** workflow on GitHub runs a fake-money trader on 20 coins and stocks: it checks every 5 minutes, all day,
buying RSI dips on **1-hour** charts. Its rule (`config.scalp.yaml`) can also sell at a take profit or a stop loss.

**It learns:** every 3 hours it replays the last 60 days of prices with 144 different settings (how deep a dip to
buy, when to sell, take profit, stop loss), scores each after the 0.6% fee on every buy and sell, and switches to a
new one only if it also did better on the newest 15 days it never studied. It only picks settings that trade at least
about once a day (`min_trades_per_hour` in `alerts.scalp.yaml`), so it keeps trading instead of learning to sit still.

**Report:** instead of a ping for every trade, your phone gets a **Scalp report** every hour it did something: each
buy and sell with its result, the account, what it's holding, the rule it's using, and anything it just learned.

**Warning:** on 5-minute candles every setting lost about 1.2% per trade after fees (small moves, same fees). On
1-hour candles the best settings were around break-even with 1-2 trades a day, and busier settings still lost about
1.2% per trade. Practice only: don't copy it with real money. Settings: `alerts.scalp.yaml`, markets:
`watchlist.scalp.txt`. On your computer: `python -m bot alerts --settings alerts.scalp.yaml`.

## Practice auto-trading (fake money)

Two fake-money accounts trade **by themselves** on every new BUY and SELL alert, at live prices, after
0.6% fees: one for your main lists (`alerts.yaml`, $80 to start, $10 per buy) and one for scalping
(`alerts.scalp.yaml`, $8,000 to start, $800 per buy).
Each alert (or, for scalping, the hourly report) shows the account, like *"Account $80.00 ..."*. Change the
amounts under `practice_trading:` in those files. Real-money auto-trading (Coinbase only; Fomo has no bot access)
is a later step, once the practice accounts show it's worth it.

## The bot's learning

`python -m bot learn` makes the bot study every BUY its rules have ever given (about 7,000 trades across 10 years of
coins, 500 stocks, meme coins and 15-minute charts): what the market looked like at the moment of the signal, and
whether the trade made money after fees. It learns from the older trades and takes an exam on the newest ones, which
it never saw. It switches itself on only when its picks beat taking every signal on that exam, make money on average,
and still win in at least 80% of reshuffled exams, so luck alone can't switch it on.

When it's on, BUY alerts and chart checks say whether it likes the signal, and low-rated ones are marked
**LOW ODDS** (the practice accounts skip them). When it's off, alerts say it's still studying.

It also **tunes the strategies themselves**: it tries small changes to each rule's settings (like a 15-, 20- or 30-day
breakout) and adopts one only if it beat the current settings on the newest trades it never studied, made money, and
held up in 80% of reshuffled exams. Alerts and chart checks use whatever it adopted.

The **learn** workflow runs every day: it adds the newest prices (including the charts of every Fomo coin on your
watchlist, saved in `data/seen/`), tunes and retrains, and sends your phone a message whenever it changes a strategy or
switches its filter on or off. See what it learned: `python -m bot learn --report` (everything is in readable files in
`models/`).

## Auto-trading on Coinbase (real money)

The **autotrade** workflow trades for you every hour on Coinbase with the trend rule (BTC, ETH, SOL), using the
settings the bot's learning adopted. Settings are in `autotrade.yaml`: `budget` (most money in its trades, $100 to
start), `max_loss` (kill switch: if its trades are down that much it sells what it bought and stops), and `mode`
(`dry_run` messages what it would do without trading; `live` places real orders). It only sells coins it bought
itself, never coins you already had, and every order is sent to your phone.

Setup (one time):
1. Go to **portal.cdp.coinbase.com** (same login as Coinbase) → **API keys** → **Create API key**.
   Allow **View** and **Trade** only. Leave **Transfer** off, so the key can never move money out.
   Under advanced settings choose the **ECDSA** signature type (Coinbase's trading API needs it).
2. Copy the **API key name** (starts with `organizations/...`) and the **private key** (the whole block, from
   `-----BEGIN EC PRIVATE KEY-----` to `-----END EC PRIVATE KEY-----`).
3. In GitHub, add two repository secrets (Settings → Secrets and variables → Actions → New repository secret):
   `COINBASE_API_KEY` = the key name, `COINBASE_API_SECRET` = the private key.
4. Keep the money for the bot as **USD cash** in Coinbase (not USDC).

It starts in **dry run**: your phone gets "Auto-trader connected" and then "DRY RUN: BOUGHT ..." messages. When those
match the alerts for a few days, ask Claude to switch it to live. In live mode it refuses a key that can transfer
money, and if it ever loses its notes on what it bought, it stops instead of guessing.

## The Solana auto-trader (young coins + stocks)

The **solbot** workflow buys dips for you with the **dip-bounce** rule, every 5 minutes, all day, from **its own
wallet** (Fomo has no bot access), swapping through Jupiter (what most Solana apps use behind the scenes):

- **Young Solana coins** (`watchlist.young.txt`, e.g. NIO) on the 5-minute chart. Every 2 hours it **drops dying
  coins** (under $20k in the pool or under $20k traded a day) and **searches for new coins** that are **2-8 weeks old**
  ($50k+ pool, $100k+ traded a day, rising), up to 6 on the list: on 28 coins, dip-buying lost on coins under 2 weeks
  old and made money on older ones that were still trading. Your young-coin alerts use the same list.
- **Stocks** as verified **xStocks** on Solana (NVDAx = Nvidia, SPYx = S&P 500...) on the daily chart: Apple, Amazon,
  Google, Intel, McDonald's, Meta, Microsoft, Nvidia, Palantir, Tesla, SPY and QQQ (the ones it was tested on). Only
  during US market hours, and only when the xStock's price is within 1% of the real stock's.
- Not the meme coins on your other lists: dip bounce didn't make money on them even with no fees.

**Each coin gets the strategy that's winning on it** (`bot/solbot_strats.py`): dip bounce (sell back at the average),
range bounce (sell higher, for coins moving sideways) or RSI dip. Every 2 hours it re-checks each coin: it keeps the
current strategy while it wins **81%+** (last 3 days, and the bot's own last trades on that coin); otherwise it switches
to one that won 81%+ on the newest days it never studied, or **sits the coin out** (no new buys) until one does. New
coins are only added if a strategy passes that test on the coin's own prices. NIO is pinned: never benched or dropped
for losing, it switches or sits out instead. (Your young-coin alerts still use plain dip bounce; the bot's own BOUGHT /
SOLD messages show what it actually does.)

**Safety** (`solbot.yaml`): before every buy it runs a **rug check** (RugCheck): no buy if the creator can still print
or freeze coins, it taxes transfers, it's flagged as dangerous, or one wallet owns 20%+ (top 10: 50%+). Between the
5-minute checks it watches what it holds **every 30 seconds**: it sells at the 20% stop-loss within seconds, and sells at
once if a coin's pool loses 30% of its money (often the start of a rug pull). It doesn't buy **falling knives** (coins
down 10%+ in 6 hours; in testing this doubled the profit per trade) or while **SOL is crashing** (down 3%+ in an hour).
And it only buys a dip in a coin that's in a **strong uptrend: up 20%+ over the last 24 hours** (`min_up_24h`). On 21
young coins, dips bought in falling or barely-rising coins lost money; RSI dips in coins up 20%+ won ~78% and made money
in both halves of the week. It would have skipped 4 of the bot's first 5 real trades. The practice account still takes
every signal, so the Thursday report shows whether the rule really helps.

**It learns** (`bot/solbot_learn.py`): every day for coins (the last week of every coin it watched in the last 2 weeks,
including the ones that died) and every week for stocks (daily prices since 2019), it re-tests the dip-bounce
settings (how long an average, how deep a dip) and switches only if a new setting also made more money on the newest
trades it never studied, in at least 80% of reshuffled exams. Your phone hears about any change, and the young-coin
alerts follow it too. It also learns from its own trades: a coin that loses 3 trades in a row is dropped from the list
and not picked again for 2 weeks.

**Money** (`solbot.yaml`): the bot only uses its own **budget** ($30 to start, plus or minus what its trades make), never other money in the wallet, and in live mode it waits until your deposit arrives. $30 a trade until the account (its money + what it holds) reaches **$100**, where it **pauses**:
sells everything and messages you. Tell Claude to continue: then $50 a trade until **$200** (pauses again), $75 until
$250, and $100 a trade from $250 up with no more pauses. It **stops** for good if the account falls to $10 or drops 50%
from its best. Each coin or stock is sold at a 20% loss (stop-loss), and buys are skipped if fees plus price impact
would be over 3%.

Setup (one time, about 10 minutes):
1. In **Phantom** (or another Solana wallet) create a **new account just for the bot**. Never use your main wallet.
2. Send it **$30 of USDC on Solana** plus about **0.03 SOL** (~$3) for network fees.
3. Export that account's **private key** (Phantom: Settings → Manage Accounts → the bot's account → Show Private Key).
4. In GitHub add a repository secret (Settings → Secrets and variables → Actions → New repository secret):
   `SOLANA_BOT_KEY` = the private key. It's never written into the code or shown in logs.

It starts in **dry run**: your phone gets "DRY RUN: BOUGHT ..." and "DRY RUN: SOLD ..." messages using real prices
and fees but pretend money. When you're happy, ask Claude to switch `mode` to `live`. Every real buy and sell is sent
to your phone with a Solscan link. When it pauses or stops it saves `solbot_stopped.json`; delete it (or ask Claude)
to start again.

Two pretend accounts run next to the live bot, on the same coins (`solbot.yaml`):
- **practice** ($300, $30 a trade): every signal of the live bot's own strategies, so there's data on every coin.
- **sharp-drop practice** (`flush:`, $300, $30 a trade): a different rule, to compare on the same coins. It buys right
  after a coin falls **20% within 30 minutes** and sells once it's back up 12% (on the 5-minute close), after 6 hours,
  or at the 20% stop. No falling-knife filter, on purpose: it buys the crash. Tested on 21 young coins (7 days, 1%
  fees): about 70% of trades won and it held up on coins it hadn't seen in most splits; 336 other versions of the idea
  lost. Its trades show up on your phone silently (low priority), marked SHARP-DROP PRACTICE.
The Thursday 3 pm report shows the real bot, practice, and sharp-drop side by side. Neither pretend account ever
removes a coin from the list (that's the live bot's job).

**Copying smart wallets** (needs the free `HELIUS_API_KEY` secret from helius.dev):
- The **smart-wallets** workflow (every Monday, or by hand: Actions → smart-wallets → Run workflow) looks for big runs
  (the price at least doubled) on young coins, reads the swaps at each run's bottom straight from the blockchain, then
  each big bottom buyer's own trades around the top, and keeps the wallets that **bought near the bottom and sold near
  the top for 1.5x+ on 2+ different coins** (bots with thousands of trades are skipped; so are trades signed by someone
  else, which can't be copied). The list is saved in `models/smart_wallets.json`. To stay inside the free plan it
  reads at most 8 coins' most recent run (busy pumps have 10,000s of bot swaps, so it samples the bottom).
- The **copytrade** workflow watches those wallets **live** and copies them about **2-5 seconds** behind: a smart wallet
  buys → it pretend-buys $30 (rug check and a $20k+ pool first); the wallet sells → it sells; plus the 20% stop and a
  48-hour limit. Pretend money for now (`solbot.yaml` `copytrade:`); its trades ping silently, and you get a normal
  ping when 2+ smart wallets buy the same coin within 6 hours. Weekly report Thursdays at 3 pm.
- **Approved for real money:** the finder also reads each wallet's last ~4 months of trades and scores them as if we
  had copied every one (2% off each for fees and being late). A wallet is approved only with 20+ finished trades on 5+
  coins, +1% or more a trade on average, wins at least 1.2x its losses, holds 2+ minutes (we can't copy faster than
  that) and made money in 60%+ of its weeks. Re-score by hand: `python -m bot smart-wallets --rescore`.
- **Real money** (`solbot.yaml` `copytrade: live:`): the same copier also trades the bot's real wallet
  (`SOLANA_BOT_KEY`), but only for the approved wallets: $6 a trade, at most 2 coins at once, skips a buy that would
  cost over 3% in fees, the same 20% stop and 48-hour limit. Its trades ping out loud ("COPY LIVE"). It stops buying
  when the account is under $3 (refill the wallet with USDC and it starts again), stops copying a wallet whose last 4
  real copies all lost, and closes the empty coin accounts after each sell to get their ~$0.30 deposit back.
  Turn it off with `live: enabled: false`.
- Know the limits: some "smart" wallets are insiders or bots that sell to the people copying them, and we're always a
  few seconds behind and pay a little more. A good past record doesn't promise the next trade.

Know the risks: it checks every 5 minutes, so a crash can go past the 20% stop before it sells; if a coin's team
pulls the money out of the pool (a rug pull), nothing can sell it; coins it finds by itself are strangers (most new
coins fail); and the wallet key can spend everything in that wallet, so keep only lottery money there.

## The Kalshi bot (weather + arbitrage), practice first

The **kalshi** workflow checks Kalshi every 10 minutes (`bot/kalshi.py`, settings in `kalshi.yaml`). Kalshi contracts pay
$1 if they come true, and the price is the crowd's probability. It trades the daily-high-temperature markets of 20+ US
cities, which settle on one official weather station per city (The Weather Company's number), plus **arbitrage** (if a
whole set of brackets costs less than it must pay out after fees, it buys the set: it wins whatever happens).

**What the backtest found** (483 settled city-days, Oct 13 - Nov 2; `kalshi-backtest` workflow):
- The day before, the **market's own odds beat the weather models** (log loss 0.300 vs 0.350, lower is better), even
  after correcting the models' 1.2° cold bias per city. Betting where the models disagreed with the market lost 11-20%.
- On the day itself the market has the answer early: by 4-5 pm its prices were right almost every time. The station's
  readings (5-minute, hourly, and the 6-hour highs measured like the official number) match the official high at the end
  of the day, but traders see them as fast; buying the "sure things" the readings showed lost money.
- One pattern held in every third of the test: **the market's favorite bracket for tomorrow at 60-80¢ won 75% of the
  time** (120 trades, +12% after fees). Cheap long shots were overpriced too (betting NO on them: +5%, smaller test).

**The bigger test (Nov 6: 1,423 settled city-days, Sep 7 - Nov 5).** With 60 days instead of 21, the favorites' edge
mostly went away: bought the way the live bot buys (the first hourly check when the favorite costs 60-80¢), A made +0%
on 539 trades (won 65%; it needs about 66% at these prices). Favorites at 70-80¢ won only 52% (-31%). A walk-forward test
(`kalshi-backtest` with walk-forward: yes; each idea's setting picked on earlier days only, judged on later days) tried
ways to improve it:
- **Agreement looked best:** buy the favorite only when the weather models' most likely bracket is the same one: +5%
  on 347 trades (+$80 vs A's +$2). **But a recheck found most of that came from peeking:** the saved forecasts were
  made one day ahead of the high, i.e. the afternoon before, a few hours after a morning buy. With the forecasts made
  two days ahead (surely known in time), on the same 1,009 days agreement made -1% (A -2%). It practices as F (the
  live bot uses the newest forecasts it really has), but it's no proven edge.
- Only 60-65¢ favorites: +1% (practices as G). Skipping cities whose forecasts miss, a minimum gap between the models'
  chance and the price, taking profit early, and buying only at certain hours all did no better than A.
- **Other markets (Nov 6, `kalshi-backtest` with markets / kind: low):** daily lows (1,182 city-days: A -8%, agreement
  -3%), gas prices (the market beat a today-plus-trend model badly), Bitcoin/Ethereum at 5 pm and the S&P/Nasdaq
  close: nothing passed (30+ held-out trades, +3%, making money in both halves and without its best day). So the bot
  doesn't trade them. **R. Arbitrage anywhere on Kalshi** practices instead: each check sweeps a slice of every open
  market settling within 2 weeks for sets that pay more than they cost whatever happens (rare).

So there are 8 strategies side by side, each with its own pretend $100 (the Thursday 3 pm scoreboard compares them):
- **A. Market favorites** (pings your phone): YES on tomorrow's favorite bracket when it costs 60-80¢.
- B. Weather models (7 forecasts averaged, corrected per city, 10¢+ edge) | C. Model favorites (60¢+ only) |
  D. Late-day sure things (today after 3 pm) | E. Fade long shots (NO at 80¢+) | **F. Favorites the models agree
  with** | G. Cheaper favorites (60-65¢) | R. Arbitrage anywhere. These trade quietly. The `kalshi-status` workflow prints every strategy's
  settled trades.

For today's markets the bot knows the high so far exactly: the higher of every station report (incl. the 6-hour highs)
and the Iowa Environmental Mesonet's running high matched Kalshi's official high on all 480 test days.

Guard rails: up to $5 a trade and 10 trades a day. It runs in **practice** (pretend money, real prices, settled by
Kalshi's real results). Honest take: the edge found is small and from 3 weeks of data; let practice prove it for a few
weeks before real money. Live mode later: a verified Kalshi account (check it works in Wisconsin), an API key from
Kalshi's settings saved as the GitHub secrets `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY`, and `mode: live`.

## Check a chart screenshot (PC)

Take a screenshot of a coin or stock in any app (Fomo, Coinbase, Robinhood...) and the bot tells you
**BUY / WAIT / AVOID**, your **stop-loss**, and **how much** (from alerts.yaml).

One-time setup:
1. Go to **console.anthropic.com**, sign up, add a few dollars of credit (Billing), then **API Keys -> Create Key**.
2. Copy the key (starts with `sk-ant-`) into a new text file called **my_anthropic_key.txt** in the trading-bot
   folder. It's never uploaded. Each screenshot costs about a cent.

Then: **Windows:** drag the screenshot onto **CHECK_CHART.bat**. **Mac:** double-click **check_chart.command** and drag
the screenshot into the window. Or type `python -m bot chart path/to/screenshot.png`.

**On your phone:** send the screenshot to Claude in the Claude app and say *"check this chart"*. Claude reads it
and runs the same check (`python -m bot chart --ticker GANG --chain solana --value 1200000`, or `--ca <address>`).
No API key needed.

**Hours-old coins (under 7 days):** the check uses the *dip bounce* rule on the 5-minute chart instead: BUY right after
a sharp dip, sell when the price gets back to its recent average (usually within an hour), 20% stop-loss. In a test on
38 brand-new coins, chasing pumps lost money and this was the only short-term rule ahead after fees (a small test:
lottery money only). Add the coin to `watchlist.young.txt` to get its SELL alert (checked every 5 minutes).

What it does: Claude reads the coin's name, blockchain and value from the picture (it does not guess the price from
the chart shape, which tested as a coin flip), the bot finds the real coin (using the value to skip same-name
copycats), and runs your tested rules on its full price history. Coins under 21 days old, with under $20k in their
pool, or under 7 days old are marked AVOID. For a sure match, include the contract address in the screenshot.

## Running it 24/7

Paper trading only works while the terminal stays open. To keep it running around the clock,
use a small cloud server (about $5 a month from DigitalOcean, Hetzner and similar), and do steps
B.4–B.5 there using `git clone`. Then start it with:
```bash
nohup python -m bot -c config.trend.yaml paper >> bot.log 2>&1 &
```
Check on it any time with `tail bot.log`. **GUIDE.md** covers going from practice to real money,
which these tests suggest you shouldn't rush into.

## "Imagine if you..." videos (automatic)

Every morning at 6:41 am the **imagine** workflow makes the next video from `content/imagine/scripts.json` and sends
it to your phone (ntfy) with a caption to paste. Tap the notification to download it, then post it to TikTok,
Instagram Reels and YouTube Shorts (add a trending sound if you like). Make one now: Actions → imagine → Run workflow.

How each video is made (all free): every scene is read by a free neural AI voice; each scene gets an AI picture
(Pollinations, one every 45 seconds free; add a `POLLINATIONS_KEY` secret later for faster, unlimited pictures) in the
same 3D-animated style with the same main character (a guy in a red hoodie = "you"); each picture slowly zooms and
pans; big bold captions pop on word by word; an "AI animated" label sits in the corner. If a picture can't be made,
that scene gets a colored title card so the video still comes out.

Rules it follows (YouTube pays for "using AI to visualize a unique character and narrative you invented", not for
mass-produced templates): every script is original, with real facts and a question at the end; no copied characters,
clips or music. Add more scripts to the file (same format) or ask Claude for the next batch. Upgrades for later: real
AI video motion (a paid video tool) and auto-posting (needs TikTok/YouTube API approval).
