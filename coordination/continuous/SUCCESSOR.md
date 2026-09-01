# SUCCESSOR — exact resume instructions

Paused 2026-09-01 ~02:20 on an owner quota directive (94% weekly limit).
**No game runs were left going.** Cycle k4 was aborted at 90/216 per arm.

Read `STATE.md` for the full picture and `HANDOFF-NOTE.md` for the
one-page summary. This file is only what you need to restart.

`SP=/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad`

## Before you launch anything

```
ps -eo pcpu,etime,args --sort=-pcpu --no-headers | head -6
```

The box is SHARED with sibling agent threads (jest suites, `piruns/`
work). Look for `match-worker.js`, `run-sweep.js`, `run-pair.js`, `jest`.
Two `run-pair` processes collided once this session and cost a full
cycle. Detached shells from earlier turns have PPID 1 and are not
children of the agent process.

## Queue state

| # | item | status |
|---|---|---|
| 1 | potion-intel acceptance games | **SMASH question ANSWERED: no.** Capability works (+22-45% potions); prize too small. Live head is now the VALUE question (item 9). |
| 2 | P11 decidable read | packaged for the PC as Slot A; does not pool with sandbox scale |
| 3 | piece-cell floor | **CLOSED.** Floor is sound; "piece cells have no usable floor" withdrawn |
| 4 | evaluator-selection ladder | untouched |
| 5 | gainOrdering under potions | untouched |
| 6 | focus-narrowing search | still unbuilt by the builder |
| 7 | hazard dose-response | **PARTIAL — k4 aborted.** Rerun; see below |
| 8 | replay inspection | **DONE**, zero games, produced the session's best result |
| 9 | potion-VALUE sweep | **READY TO FIRE — this is the next cycle** |

`$SP/experiment-queue.md` carries the full reasoning.

## Per-item block tallies

Blocks accumulate WITHIN A FIELD only — `sharePar` is a share, so a
within-game contrast moves when the third seat changes (the same
`potionAware − plain` read -0.476 in c1's field and +0.007 in c2's).

| field | cell | blocks | batches |
|---|---|---:|---|
| {potionAware, plain, reflex} | 3 potion cells | 8 each | `ppruns/c1` |
| {potionBold, potionAware, plain} | 3 potion cells | 8 each | `ppruns/c2` |
| {potionBoth, potionOrder, plain} | potion-snake6 | **48** | k1 + k2 |
| {potionBoth, potionOrder, plain} | potion-hazard-snake6 | **48** | k1 + k2 |
| {potionBoth, potionOrder, plain} | potion-snake5-knight | **48** | k3 |
| {potionBoth, potionOrder, plain} | hazdose05 | 24 | k4 (partial) |
| {potionBoth, potionOrder, plain} | hazdose15 | 6 | k4 (partial, unreadable) |
| {potionBoth, potionOrder, plain} | hazdose30 | 0 | not run |

Floor-cleared verdicts (read against the reading's OWN interval, not the
A/A half-width — see STATE.md §3):

- `potionOrder − plain`, potion-hazard-snake6, 48 blocks:
  **-0.145 [-0.258, -0.035]**, replicated at -0.146 (k1) / -0.143 (k2).
- `potionOrder − plain`, potion-snake6, 48 blocks: +0.021 [-0.143, 0.213]
  — null, with 45% more potions collected.
- `potionOrder − plain`, potion-snake5-knight, 48 blocks:
  +0.069 [-0.032, 0.165] — null.
- `potionBoth − potionOrder`, potion-hazard-snake6, 48 blocks:
  +0.001 [-0.128, 0.150] — the advisory adds nothing.
- Piece-cell A/A floor, knight, 48 blocks: -0.176 [-0.364, 0.018],
  contains zero, scales as 1/sqrt(n).

## Next planned cycle — run this first

```
bash $SP/continuous/run-cycle5.sh          # ~68 min, 216 games/arm
```

**The potion-VALUE sweep.** `effectTurns` 3 / 8 / 20, hazards OFF,
`potionOrder` vs `plain` vs `reflex`, seeds 102301+. Spec generator
written and validated. It asks the one question left open: at what potion
settings does collecting them pay?

- If G crosses zero at 8 or 20, **replicate that cell on disjoint seeds**
  (change `seedBase`, not the block count — seeds NEST) before claiming
  it. Replication is the standard now, not block count.
- If it never crosses, write the verdict: invulnerability potions are not
  worth chasing in this game at any setting the harness offers; leave the
  ordering flag selectable and default OFF on hazard boards.

Analyse with:
```
node $SP/continuous/accum.js      potionOrder plain $SP/continuous/k5
node $SP/continuous/floorscale.js potionOrder plain $SP/continuous/k5
node $SP/continuous/replaymech.js $SP/continuous/k5
```

## Then, in order

2. **Rerun k4** (`rm -rf $SP/continuous/k4` first, then
   `bash $SP/continuous/run-cycle4.sh`) — the hazard dose-response. Two
   doses so far: -0.030 at damage 0.05, -0.145 at 0.15. Directionally
   right, but two overlapping points is not a curve. The 0.30 rung is the
   one that settles it and it never ran.
3. **`replaymech.js` on k2 and k3** — independent confirmation of the
   +22-45% potion-collection result, at zero machine cost. Do it while
   nothing else is running; decompressing 288 replays is single-threaded
   but not free.
4. Queue item 4 onward.

## Do not repeat

Do not buy more blocks for item 1's SMASH question — it is answered. And
do not use the A/A floor as an effect-size threshold; it is ~2x the
reading's own half-width by construction and it suppressed a real
replicated result for a full cycle.
