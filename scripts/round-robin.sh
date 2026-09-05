#!/usr/bin/env bash
#
# THE ROUND ROBIN — the default against every opponent on the bench, from both
# seats, on every board class, at a fixed deterministic budget.
#
# ── WHAT IT PRODUCES ───────────────────────────────────────────────────────
#
# One JSON-Lines file per (class, arm, seat) under $OUT, named
#
#     <class>__<arm>__seat<N>.jsonl
#
# each holding one `RunSummary` per seed. Nothing is pooled and nothing is
# averaged here: the files are the measurement, and `round-robin-report.js`
# does the arithmetic. That split is deliberate — the runs cost an hour and the
# table gets rewritten five times while it is being read.
#
# `<arm>` is a member of the opponent catalog (src/tests/opponents.ts plus
# src/config/bot-binding.ts's BUILTIN_BOTS) or the literal `mirror`, which is
# the control: no `--opponent` at all, every team playing the default profile,
# which is what every measurement in this repo before the bench was taken
# against. The mirror's own weight share at the cap is the baseline every
# matchup's share is read against — NOT 0.5, because the three-team boards seat
# one default against two opponents.
#
# `seat<N>` is `--decider=N`: which team the default plays. Both seats are run
# for every arm because these boards are not symmetric — `mixed` gives red a
# snake, a pawn and a knight and blue a snake, a queen and a pawn; the food is
# not placed symmetrically; and the turn loop decides teams in ALPHABETICAL
# order, so blue moves before green moves before red at every turn. A matchup
# measured from one seat is a fact about that seat.
#
# ── IT IS RESUMABLE, AND THAT IS NOT A CONVENIENCE ─────────────────────────
#
# A full sweep is ~340 games at ~25 s each on a loaded box. Any single shell
# invocation that tries to hold that open will be killed by something. So a
# (class, arm, seat) whose output file already exists and is non-empty is
# SKIPPED, and `--budget=SECONDS` stops launching new work once the wall clock
# passes it and exits 3 to say "more to do". Re-running the same command
# continues where it stopped; `--force` starts over.
#
# A partially written file from a killed run is the one hazard: work is written
# to `<name>.partial` and moved into place only on a clean exit, so a file that
# exists is a file that finished.
#
# ── USAGE ──────────────────────────────────────────────────────────────────
#
#   scripts/round-robin.sh [--out DIR] [--seeds N] [--turns N] [--nodes N]
#                          [--jobs N] [--budget SECONDS] [--force]
#                          [--arms "a b c"] [--classes "x y"] [--seats "0 1"]
#
#   npm run round-robin -- --out /tmp/rr        # the same thing
#   node scripts/round-robin-report.js /tmp/rr  # the table
#
# Exit codes: 0 everything is done, 3 the budget ran out with work remaining.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OUT="${ROOT}/.round-robin"
SEEDS=6
TURNS=60
# The calibrated deterministic budget (`DEFAULT_NODE_BUDGET`). Every counter is
# then a function of (build, scenario, seed, arm, seat) and nothing else, which
# is the only reason a matchup table is worth writing down.
NODES=550
JOBS=4
BUDGET=0
FORCE=0
# The bench, plus the profile that was the only non-mirror opponent before it,
# plus the mirror control.
ARMS="mirror material-only aggressive territorial cautious glutton random-legal"
# The four classes the brief names. `sparse-lean` is left out: it is `sparse`
# with a leaner meal and has never recorded a death or a contest, so it would
# add 84 games and no distinguishing power.
CLASSES="mixed snakes potions sparse"
SEATS="0 1"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --seeds) SEEDS="$2"; shift 2 ;;
    --turns) TURNS="$2"; shift 2 ;;
    --nodes) NODES="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --budget) BUDGET="$2"; shift 2 ;;
    --arms) ARMS="$2"; shift 2 ;;
    --classes) CLASSES="$2"; shift 2 ;;
    --seats) SEATS="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,60p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "round-robin: unknown flag $1" >&2; exit 2 ;;
  esac
done

RUNNER="${ROOT}/dist/tests/local-game.js"
if [ ! -f "${RUNNER}" ]; then
  echo "round-robin: ${RUNNER} is missing — run 'npx tsc -p .' first" >&2
  exit 2
fi

mkdir -p "${OUT}"
START=$(date +%s)
REMAINING=0

# One (class, arm, seat). Writes to `.partial` and renames on success, so a
# file that exists is a file that finished — see the resumability note above.
run_one() {
  local class="$1" arm="$2" seat="$3"
  local base="${OUT}/${class}__${arm}__seat${seat}"
  local label="${arm}@${seat}"
  local args=(sum "${class}" "${TURNS}" "${SEEDS}" --nodes="${NODES}"
              "--json=${base}.jsonl.partial" "--label=${label}")
  # The mirror control takes no --opponent at all: that is what makes it the
  # control, and passing --opponent=lobster-territory would NOT be the same run
  # (it would route the non-decider teams through the opponent branch).
  if [ "${arm}" != "mirror" ]; then args+=("--opponent=${arm}"); fi
  if [ "${seat}" != "0" ]; then args+=("--decider=${seat}"); fi
  if node "${RUNNER}" "${args[@]}" >"${base}.log" 2>&1; then
    mv "${base}.jsonl.partial" "${base}.jsonl"
    echo "  done ${class} ${arm} seat${seat}"
  else
    rm -f "${base}.jsonl.partial"
    echo "  FAILED ${class} ${arm} seat${seat} — see ${base}.log" >&2
  fi
}

running=0
for class in ${CLASSES}; do
  for arm in ${ARMS}; do
    for seat in ${SEATS}; do
      base="${OUT}/${class}__${arm}__seat${seat}"
      if [ "${FORCE}" = "0" ] && [ -s "${base}.jsonl" ]; then continue; fi
      if [ "${BUDGET}" != "0" ] && [ $(( $(date +%s) - START )) -ge "${BUDGET}" ]; then
        REMAINING=1
        break 3
      fi
      rm -f "${base}.jsonl"
      echo "  start ${class} ${arm} seat${seat}"
      run_one "${class}" "${arm}" "${seat}" &
      running=$(( running + 1 ))
      # A plain job-slot gate. `wait -n` is not used: it is bash 4.3+ and the
      # runs are near enough the same length that draining a full batch costs
      # very little against the risk of a portability surprise mid-sweep.
      if [ "${running}" -ge "${JOBS}" ]; then wait; running=0; fi
    done
  done
done
wait

TOTAL=0
HAVE=0
for class in ${CLASSES}; do
  for arm in ${ARMS}; do
    for seat in ${SEATS}; do
      TOTAL=$(( TOTAL + 1 ))
      [ -s "${OUT}/${class}__${arm}__seat${seat}.jsonl" ] && HAVE=$(( HAVE + 1 ))
    done
  done
done
echo "round-robin: ${HAVE}/${TOTAL} matchup files in ${OUT} ($(( $(date +%s) - START ))s this pass)"
if [ "${HAVE}" -lt "${TOTAL}" ]; then
  echo "round-robin: re-run the same command to continue"
  exit 3
fi
exit 0
