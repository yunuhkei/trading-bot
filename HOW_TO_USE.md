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

## Scalping practice alerts (all day)

The **scalp** workflow on GitHub checks 20 coins and stocks every 5 minutes, all day, with the best day-trading rule
(RSI dip buying on 15-minute charts). Expect about 6 alerts a day. Every alert says **PRACTICE**: in testing this rule
lost about 31% a year at Coinbase/Fomo fees, so don't use real money with it. Each SELL alert shows a running
**practice score** after fees, so you can see whether it would have made money. Settings: `alerts.scalp.yaml`,
markets: `watchlist.scalp.txt`. On your computer: `python -m bot alerts --settings alerts.scalp.yaml`.

## Practice auto-trading (fake money)

Two fake-money accounts trade **by themselves** on every new BUY and SELL alert, at live prices, after
0.6% fees: one for your main lists (`alerts.yaml`, $80 to start, $10 per buy) and one for scalping
(`alerts.scalp.yaml`, $8,000 to start, $800 per buy).
Each alert then ends with a line like *"Practice account: bought $10 by itself. Account $80.00 ..."*. Change the
amounts under `practice_trading:` in those files. Real-money auto-trading (Coinbase only; Fomo has no bot access)
is a later step, once the practice accounts show it's worth it.

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
