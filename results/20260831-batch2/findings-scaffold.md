# Sim results: 20260831-batch2

**Local simulation batch 2**, run on the owner's box overnight 2026-08-31.
Every number below is a paired measurement read against **this batch's own
same-night A/A control**. Where a delta sits inside its control band it is
reported as unreadable, not as an effect.

## Vocabulary note
This report says **contender** (not "arm") and **board** for a cell's map
shape, per the principal-glossary ledger.

## Host and conditions
- `DESKTOP-6DUTJPI`, WSL2 Ubuntu 22.04, **24 cores / 31 GB RAM**, Node v22.23.2.
- Nothing else heavy on the box. Sleep and hibernate disabled for the run.
- **10 workers per contender**, both contenders launched simultaneously, one
  pair at a time — matching batch 1 exactly so the control bands are comparable.
  Exception: **P13 ran at 4 workers**, documented in its own section, because the
  `workers-auto` contender spawns its own decision pool and 10 would have
  oversubscribed the box asymmetrically between the two contenders.
- Load average sat at **21-24 of 24 cores** for the whole run.

## Builds (re-resolved; SHAs in this document are the ones actually built)
| contender bundle | ref | SHA |
|---|---|---|
| `b2-perf` | `origin/claude/cluster-lookahead` | `b68ce98d54f1dbc8db4a453e2af193f7a92ef9fa` |
| `b2-integrated` | `origin/claude/mid-turn-collision-logic-mkxurg` | `66904d256103a1d3f32d060fe742e98b092d33b6` |

Both built with `build-bot.sh`; 6 pre-existing tsc errors in the drizzle route
files, all required artifacts present, as HANDOFF §2 describes.

**Every config-selected contender was built from `b2-perf`.** This is the trap
the specs warn about: `mid-turn-collision-logic` is PRE-teardown and carries no
`bot-config` module, so it would have ignored a bot config entirely and played
the shipped bot under a treatment's name. Verified by checking for
`src/lobster/bot-config.ts` on each ref before building. `b2-integrated` is used
only in the budget ladder, where the two contenders are whole bundles and no
config is passed.

## Engagement is shown, not assumed
Batch 1 could not write a live status because its bundles carried no mechanism
rows. **These do.** Every treatment in this batch is verified from the per-seat
resolved config on the actual game rows, e.g. for P7F:

```
default contender:        lobster-territory -> unitFatality=false  x142
unit-fatality contender:  lobster-territory -> unitFatality=true   x144
```

A null in this batch therefore means "engaged and did not help", not "never ran".

## What was NOT run, and why
- **P8/P9-joint** — WITHDRAWN by the 20260830 teardown, not by a result. Neither
  contender is buildable: the cluster enumeration has no off setting in any
  configuration of the shipped engine, and the joint partner's code is deleted.
  Its spec file is pruned from the directory by the generator.
- **P5R (wasm)** — eliminated by owner ruling; the layer and its switch are gone.
- **P4R (tier-truth)** — closed by decision; the widening is a measured no-op at
  ply 1 and the other setting is the unsound one past it.
- **P6R (admission)** — not scheduled. NOTE: the stated blocker has CLEARED —
  `arch/s2` IS now published (`962884a`), along with a new `arch/s3`. HANDOFF
  says to re-check this each batch. P6R remains unscheduled for the different
  reason P-LIST gives: its admission counters need folding into the CL7
  mechanism report first.
- **X9's other two slices** — see the X9 section.

## Tooling problems found (no bot source was modified)
