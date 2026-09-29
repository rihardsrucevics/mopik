#!/bin/bash
# Full suite — FOR BIG RELEASES ONLY. The smoke suite (smoke.sh) is the
# per-change check; this runs every older scenario script at 375×812 and
# 1280×800 (the two viewports of one script in parallel, scripts in turn).
#
#   PORT=3290 scripts/verify/full.sh               everything
#   PORT=3290 scripts/verify/full.sh e2e chain     just these (names as in LIST)
#
# The scripts are the pw32xx set, ported: they load fixture rides instead of
# generating (where a fixture exists for their places) and their router calls
# go through the cache. Several print observations rather than PASS/FAIL —
# read the logs in scripts/verify/out/full/, an exit code of 0 is not a pass.
# Needs a server already running on $PORT (smoke.sh starts one if not).
#
# Known on 2026-09-29 (after release B), all script expectations, not app bugs
# as far as checked:
# - insert, guidance: older scripts, not in release B's verified set. insert
#   expects the pre-B refusal wording („– izvēlies citu vietu.”); B names the
#   blocking point instead. guidance expects a pass-through re-proposal that
#   is now a warned out-and-back. Update them before relying on them.
# - gate: prints „gate markers: 0” on Vangaži → Inčukalns — not investigated.
set -u
cd "$(dirname "$0")/../.."
PORT=${PORT:-3290}
export PORT
export DPR=${DPR:-2}          # full fidelity: the phone at DPR 2
export TILES=${TILES:-cache}  # real OSM tiles, fetched once into cache/tiles
OUT=scripts/verify/out/full
mkdir -p "$OUT"
curl -s -o /dev/null -m 5 "http://localhost:$PORT/" || { echo "no server on :$PORT — start one first (see README)"; exit 3; }

# name|script args (after the viewport)|extra env
LIST=(
  "e2e|e2e|"
  "insert|insert|"
  "linesheet|linesheet|"
  "gap|gap|"
  "guidance|guidance|"
  "guard|guard|"
  "straight|straight|"
  "placesearch|placesearch|PLACES=live"
  "gate|gate gate|"
  "laurini|laurini|"
  "ropazi|ropazi|"
  "mergupe|mergupe|"
  "batchbad-rest|batchbad rest|"
  "batchbad-straight|batchbad straight|"
  "ogre-pass|ogre pass|"
  "ogre-stop|ogre stop|"
  "chain|chain|"
)
T0=$(date +%s)
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
for item in "${LIST[@]}"; do
  IFS='|' read -r name cmd envs <<< "$item"
  if [ $# -gt 0 ] && [[ ! " $* " =~ " $name " ]] && [[ ! " $* " =~ " ${name%%-*} " ]]; then continue; fi
  script=${cmd%% *}; args=${cmd#"$script"}
  t=$(date +%s)
  env $envs node "scripts/verify/full/$script.cjs" phone $args > "$OUT/$name-375.log" 2>&1 & p1=$!
  env $envs node "scripts/verify/full/$script.cjs" desk $args > "$OUT/$name-1280.log" 2>&1 & p2=$!
  wait $p1; r1=$?; wait $p2; r2=$?
  fails=$(cat "$OUT/$name-375.log" "$OUT/$name-1280.log" | grep -c '^\(\[[0-9]*\] \)\?FAIL')
  line="$(printf '%-18s 375 rc=%s 1280 rc=%s  FAIL lines %s  %ss' "$name" "$r1" "$r2" "$fails" $(( $(date +%s) - t )))"
  echo "$line" | tee -a "$SUMMARY"
done
echo "full: $(( $(date +%s) - T0 )) s — summary $SUMMARY, logs $OUT/" | tee -a "$SUMMARY"
