# simworker — the long-running simulation kit

A self-contained bot-vs-bot simulation harness that builds **any branch** of
this repo into a runnable bundle and races bundles against each other in paired,
concurrent arms.

**Start at [`../../HANDOFF.md`](../../HANDOFF.md)** (repo root). It is the
operating mandate: setup, the bot-version map, the priority program, and the
results protocol. This file is only the map of the directory.

```
build-bot.sh          <git-ref> <bundle-dir>  ->  a fully built, self-contained bot
harness/              the sweep harness (TypeScript; compiled into each bundle)
  lib/                config, board build, bots, sim, replay, sweep planning
  bin/                run-sweep, run-match, read-replay, smoke, throughput
lib/                  plain-node modules the bin/ scripts share
  arm-spec.js         PER-SEAT BOT ISOLATION — which seats an arm's config may
                      reach, and the refusal when that is ambiguous
bin/                  plain-node tooling; no build step
  run-pair.js         launch paired arms simultaneously  <- the entry point
  selftest.js         the gate. `--bundle <dir>` adds a real two-contender game
                      and reads the per-seat mechanism stamp out of its manifest
  aggregate.js        block-paired stats + markdown tables; reports `sharePar`
                      — THE OBJECTIVE, share of end weight x teams, par 1 —
                      beside the older rank readings (METHODOLOGY §3.0)
  verify-null.js      prove an A/A null is A/A; print the noise floor, in
                      `sharePar` units first (rank floors do not convert)
  batch-manifest.js   assemble manifest.json; size accounting; replay pruning
  make-specs.js       regenerate the spec library
specs/                the spec library (generated; edit make-specs.js, not these)
                      make-specs.js --promotion-batch  ->  the NEXT batch, from
                      the promotion ledger. See ../learnloop/.
context/
  METHODOLOGY.md      the laws, with the exhibit that forced each one
  FINDINGS-DIGEST.md  what the program already knows, with numbers
```

Quick check that everything works:

```sh
tools/simworker/build-bot.sh HEAD /tmp/bundle
node tools/simworker/bin/selftest.js --bundle /tmp/bundle
node tools/simworker/bin/run-pair.js --batch /tmp/smoke \
  --spec tools/simworker/specs/smoke.json \
  --arm nullA=/tmp/bundle --arm nullB=/tmp/bundle --workers 1
node tools/simworker/bin/verify-null.js --batch /tmp/smoke --null nullA,nullB
```

**A bot config reaches ONE seat.** `--arm 'treat=<b>,bot={...}'` applies to the
subject seat and is REFUSED when the spec seats more than one configurable
contender; `--arm 'treat=<b>,bot@<seat>={...}'` names the seat and is repeatable.
Before 20260830 a config reached a lobster seat without naming which, which
loses a within-game contrast silently. Measured on `20260831-batch2` (harness
`cee34dd`, one commit before the fix) it reached the FIRST configurable
contender only — `lobster-territory` got it, `lobster-material` did not — so
that batch's config arms are genuine one-seat ablations. See `lib/arm-spec.js`
and `../../HANDOFF.md`.

## What to run next

`tools/learnloop/` holds the VALIDATION RECORD (`promotion-ledger.json` — the
path keeps its old name so nothing that links to it breaks) — one
machine-readable record of where every candidate stands, what its gate measures, and what
the next decisive experiment for it is. It is the artifact both sessions read,
and it answers "what should this box run next?" as a command:

```sh
node tools/simworker/bin/make-specs.js --promotion-batch --dry
node tools/simworker/bin/make-specs.js --promotion-batch --out <dir>
```

`tools/learnloop/specs/batch2/` is the current generated proposal, with a
README explaining every entry and what is deliberately NOT scheduled.

After a batch comes back:

```sh
node tools/learnloop/bin/ingest.js --batch results/<batch> \
     --null nullA,nullB --pair base=treat --flag <FLAG> --engagement <counter>
```

which checks the null first, prints the drift and instrument-hygiene tables,
then proposes ledger updates — and refuses the ones the record says it must
(a probe cannot move a status alone; an unengaged arm moves nothing; an underpowered
placement cell moves nothing).

`tools/learnloop/` is a VERBATIM MIRROR of the copy on
`claude/cluster-lookahead`, which is the source of truth. Edit there and
re-copy; the ledger's `home.mirroredFrom` block records which commit this copy
came from.

Tooling only — nothing here is imported by the bot at runtime.
