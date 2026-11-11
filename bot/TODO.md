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
- 0. Safety (this commit).

## Next
- 1. Design note.
