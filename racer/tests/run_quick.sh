#!/bin/bash
# Quick regression for Racer: builds the game, then runs the checks that finish in a few minutes.
# Usage: racer/tests/run_quick.sh            (everything except the long road bots)
#        racer/tests/run_quick.sh --bots     (also drives every road at 24 and 34 m/s, about 25 minutes)
cd "$(dirname "$0")/../.." || exit 1
python3 racer/build.py | tail -1
T=racer/tests
for t in rnet netcheck lanecheck raudit rload rfinal rtouch2 renergy rdrift2 rdrift3 rhandle rturn rjump rpen rtrhit rdamage rsafe rcops rparts rscenery renv rcarlook rgfx rcam rcars rnav rphys rsig rbudget rheat rpolice; do
  echo; echo "=============== $t"; timeout 600 node $T/$t.js 2>&1 | tail -${LINES_PER_TEST:-40}
done
if [ "$1" = "--bots" ]; then
  echo; echo "=============== rtraffic (ten places, 90 s each)"; SECS=90 node $T/rtraffic.js 2>&1 | tail -30
  for s in 24 34; do echo; echo "=============== rbot at $s m/s"; SPD=$s node $T/rbot.js 2>&1 | grep -v " done .*hits 0  flights 0" | tail -40; done
fi
