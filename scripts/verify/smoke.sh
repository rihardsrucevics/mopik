#!/bin/bash
# Smoke suite, both viewports in parallel, on fixtures + the router cache.
#   PORT=3290 scripts/verify/smoke.sh          (npm run verify:smoke)
#   RECORD=1 scripts/verify/smoke.sh           re-record the router answers
# Uses the dev server already on $PORT; if none answers, starts one and stops
# it again by its own PID at the end (never pkill — other agents' servers).
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-3290}
export PORT
OUT=scripts/verify/out
mkdir -p "$OUT"
T0=$(date +%s)
STARTED=""

if ! curl -s -o /dev/null -m 5 "http://localhost:$PORT/"; then
  echo "no server on :$PORT — starting next dev (PID in $OUT/dev-$PORT.pid)"
  npx next dev -p "$PORT" > "$OUT/dev-$PORT.log" 2>&1 &
  STARTED=$!
  echo "$STARTED" > "$OUT/dev-$PORT.pid"
  for _ in $(seq 1 60); do curl -s -o /dev/null -m 2 "http://localhost:$PORT/" && break; sleep 1; done
fi
cleanup() { if [ -n "$STARTED" ]; then kill "$STARTED" 2>/dev/null; rm -f "$OUT/dev-$PORT.pid"; fi; }
trap cleanup EXIT
# Warm the page once so the two browsers do not both wait for the first compile.
curl -s -o /dev/null -m 120 "http://localhost:$PORT/?lang=lv"

node scripts/verify/smoke.cjs phone > "$OUT/smoke-375.log" 2>&1 &
P1=$!
node scripts/verify/smoke.cjs desk > "$OUT/smoke-1280.log" 2>&1 &
P2=$!
wait $P1; R1=$?
wait $P2; R2=$?

grep -h -E "FAIL|pass in|cache " "$OUT/smoke-375.log" "$OUT/smoke-1280.log"
[ $R1 -gt 1 ] && tail -5 "$OUT/smoke-375.log"
[ $R2 -gt 1 ] && tail -5 "$OUT/smoke-1280.log"
echo "smoke: 375×812 exit $R1, 1280×800 exit $R2 — total $(( $(date +%s) - T0 )) s (logs in $OUT/)"
[ $R1 -eq 0 ] && [ $R2 -eq 0 ]
