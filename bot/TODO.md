# Super bot brain: the plan (trimmed, owner-approved Nov 10)

Branch `claude/super-bot-brain` (from main). Never push to main; the owner merges. Practice only: `sniper.yaml`
`live: false`. Commit + push after every step. Keep this file current (done / next) so a new session can resume.
Tests offline. Don't touch racer/, Racer_Prototype.html, Close_Call*.html.

Goal: the paper bots trade everything (the data); the super bot trades rarely, only where the expected profit per
trade AFTER real fees has a lower confidence bound above +2% on days it never saw. If nothing qualifies, say so.

## Steps (trimmed: no wallet copying, no stock test, exit study only if a signal shows up)
0. Safety: sniper off on this branch; a buy with no price to protect it is skipped (test). Slippage note.
1. Design note in HOW_TO_USE.md.
2. Data logging (starts collecting only once the owner MERGES this branch into main):
   every new coin: launch facts, snapshots at 10 s and 60 s (trades, buyers, sizes, timing), outcomes up to 60 min
   (max/min/last multiple, first time it crossed +25/+50/+100% and -20/-35%, graduated, creator sold).
   every paper bet: strategy, time, minute of hour, hour, launch rate, coin volume so far, SOL trend/volatility,
   mayhem, fill delay, result after fees. Compact daily gzip files in lab_data/, pruned after 28 days.
3. Base rates: share of new coins that touch +25/+50/+100% after real costs.
4. Timing map: fixed windows (six 10-min slots per hour; 4 groups of hours), per (strategy, window): n, win rate,
   avg win/loss, mean after fees, bootstrap bounds.
5. Approval rule (brain.yaml): 100+ trades, several days, lower bound > +2% (corrected for the number of windows
   tested), same direction on ~70% of days, positive walk-forward on unseen days; drop when recent results sag.
6. Coin model (scikit-learn) on first-minute features, past data only, walk-forward; lift, calibration, decay.
7. Rug filter: how much of the loss tail it removes, which winners it costs.
8. Super bot "brain" (practice $1,000, $250 trades): trades only approved windows / model picks; otherwise sits
   out and logs why; reported next to "took every signal" and "random coins".
9. Honest reports (hourly line, weekly summary); synthetic-data tests (finds the one real edge, rejects noise,
   shuffled time kills it, fees applied, never trades unapproved).
10. Go-live gate documented, OFF (300+ profitable-after-fees paper trades over 4+ weeks, kill switch,
    profit lock, only when the owner says so).
Then PART 2 (branch claude/repo-cleanup): inventory, archive merged branches as tags, remove unused files by
category, list pointless workflows for the owner. Never delete Actions caches or the lab's saved state.

## Notes
- Slippage (not changed live): buy 30% and first sale 50% are loose for a $25 trade on a curve with ~30 SOL in it
  (a $25 buy moves the price well under 1%). The real losses came from fees and one -94% coin, not from these
  limits. Worth tightening to ~10% buy / 20% first sale before any real money again; the last sale try already
  keeps a 10% floor (was "anything").

## Done
- 0. Safety.
- 1. Design note (HOW_TO_USE.md, "The super bot's brain").
- 2. Data logging: bot/coin_log.py (coins + ghost bets, daily gzip in lab_data/, coins kept 21 days, bets 35),
  hooked into launch_lab.py (event, tick, _buy ctx, close), SOL price polled once a minute, separate `lab-data-`
  cache in launch_lab.yml (the lab's own state cache untouched). Live check: ~80 B/coin, ~17 B/bet compressed,
  ~5-6 MB/day. NOTE: it only collects once the owner merges this branch into main (the lab runs from main).

- 3. Base rates: bot/brain.py (`python -m bot brain`, writes brain_report.json), brain.yaml (the strict test's
  thresholds), launch_lab_status.yml restores the lab-data cache (read only) and uploads brain_report.json in the
  `lab-status` artifact.

- 4+5. Timing map + strict test (bot/brain.py `timing_map`): windows fixed in advance (overall, six 10-min slots,
  4 hour groups); per window n, win rate, avg win/loss, mean after fees, lower bound (bootstrap by hour blocks,
  Bonferroni over every window tested), day share, walk-forward on unseen days, drop rule. Synthetic tests: finds
  the one planted edge, approves no noise at +2%, shuffled time kills it, fees taken off.

- 6+7. Coin model + rug filter (bot/brain.py `coin_model`, `rug_filter`): one fixed practice trade per coin
  (bought at 1 min, sold at +50% / through -35% at the price it really fell to / at 30 min, after costs);
  gradient-boosted model on first-minute features, trained on up to 14 earlier days only, top 10% picked with
  the previous day's cut-off; lift, calibration, a 2-day decay check, the strict test. Rug filter at 1 minute and
  at launch (on the snipe bets): what it catches vs which winners it costs. Logging now records the real price a
  drop gapped to, and the creator's first buy.

- 8. Super bot 3 "brain" (practice $1,000, $250): takes a strategy's signal only in an approved window, buys a
  coin model pick only once the model passed (sold by the model's tested rule), otherwise sits out and counts it;
  its approvals are refreshed every 3 h by a separate process (`python -m bot brain --live brain_live.pkl`) so
  the lab never slows; one line in the hourly ping. Live check: loop ran, nothing approved, it sat out.

## Next
- 9. Honest reports: baselines (took every signal / random coins) and break-even win rate in the brain report; a
  weekly summary ping (low volume).
