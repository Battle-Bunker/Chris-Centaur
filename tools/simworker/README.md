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
bin/                  plain-node tooling; no build step
  run-pair.js         launch paired arms simultaneously  <- the entry point
  aggregate.js        block-paired stats + markdown tables
  verify-null.js      prove an A/A null is A/A; print the noise floor
  batch-manifest.js   assemble manifest.json; size accounting; replay pruning
  make-specs.js       regenerate the spec library
specs/                the spec library (generated; edit make-specs.js, not these)
context/
  METHODOLOGY.md      the laws, with the exhibit that forced each one
  FINDINGS-DIGEST.md  what the program already knows, with numbers
```

Quick check that everything works:

```sh
tools/simworker/build-bot.sh HEAD /tmp/bundle
node tools/simworker/bin/run-pair.js --batch /tmp/smoke \
  --spec tools/simworker/specs/smoke.json \
  --arm nullA=/tmp/bundle --arm nullB=/tmp/bundle --workers 1
node tools/simworker/bin/verify-null.js --batch /tmp/smoke --null nullA,nullB
```

Tooling only — nothing here is imported by the bot at runtime.
