# The wide baseline — ten board classes, two arms, at `81063d7`

The number this branch exists to produce: what the head DOES, per board class,
on a corpus five classes wider than the one `BEHAVIOUR-AUDIT.md` and
`BEHAVIOUR-AUDIT-2.md` read. Every later build is measured against this file.

    scripts/wide-corpus.sh docs/design/wide <seeds> 1     # record (resumable)
    node scripts/wide-corpus.js table docs/design/wide    # the tables
    node scripts/wide-corpus.js pair  docs/design/wide <A> <B>   # a paired test

Deterministic mode (`--nodes`), one process per (scenario, seed, arm), 60 turns
except `long` at 120. Every number is a function of (build, scenario, seed, arm):
re-record on `81063d7` and it reproduces byte for byte. **Nothing is pooled
across board classes** — `SUCCESSION.md`'s rule, because measured sign-flips
cancel on pooling. The one number below that IS taken across classes is a COUNT
of classes, which is what `ab-compare.js` does at the end of its own report.

`docs/design/wide/TABLE.md` is the full machine-written table and is regenerated
from disk, so it grows as the corpus does; the seed range each class actually
carries is its `runs` column. **Every number in this document is the seeds 1–5
corpus** — 100 games, complete on all ten classes and both arms — frozen as
`docs/design/wide/TABLE-seeds-1-5.md` so it stays checkable after the corpus is
deepened. Deeper seeds are recorded into the same directory and read by the same
two commands; nothing about a later slice invalidates a number here, it only
narrows its interval.

## 1. Play, per class, mirror arm — every team on the default profile

| class | ut | meals/100 | deaths | deaths/100 | by cause | survivors |
|---|---|---|---|---|---|---|
| `sparse` | 1200 | 7.67 | **0** | 0.000 | — | 20/20 |
| `sparse-lean` | 1154 | 6.85 | 2 | 0.173 | contest 2 | 18/20 |
| `potions` | 2046 | 18.96 | 11 | 0.538 | contest 10, bodyBlock 1 | 29/40 |
| `mixed` | 2063 | 18.32 | 12 | 0.582 | contest 9, bodyBlock 2, self 1 | 28/40 |
| `potion-rich` | 2043 | 15.96 | 14 | 0.685 | contest 14 | 26/40 |
| `long` | 3073 | 20.01 | 23 | 0.748 | contest 13, **self 5**, bodyBlock 4, wall 1 | 17/40 |
| `asym` | 1994 | 20.71 | 17 | 0.853 | contest 15, **edge 1**, bodyBlock 1 | 28/45 |
| `snakes` | 1557 | 16.89 | 14 | 0.899 | **self 7**, bodyBlock 6, contest 1 | 16/30 |
| `wide` | 2751 | 15.67 | 27 | 0.981 | contest 18, bodyBlock 7, **edge 1**, self 1 | 33/60 |
| `dense` | 2285 | 19.96 | **39** | **1.707** | contest 25, bodyBlock 7, **edge 4**, self 2, wall 1 | 21/60 |

**The ordering is the corpus's main result.** Deaths/100 spans 0.000 to 1.707 —
a factor of ∞ and, among the classes that have any, a factor of 9.9. It is not
ordered by board size and not by unit count: it is ordered by CROWD. `dense`
(12 units on 121 cells) kills at 2.9× `mixed`'s rate on `mixed`'s own board with
1.5× the units; `wide` (12 units on 225 cells) sits at 1.7× `mixed`. Half again
the units on the same board costs three times the deaths; the same units on
twice the board costs less than twice.

## 2. The `material-only` arm, and the sign test that survives ten classes

Team 0 (`red`) keeps the default profile; every other team plays
`MATERIAL_ONLY_PROFILE`. Paired seed by seed, per class, never pooled
(`wide-corpus.js pair <c>:mirror <c>:material-only`):

| class | meals/100 Δ | up/down | p | deaths/100 Δ | up/down | p | survivors Δ |
|---|---|---|---|---|---|---|---|
| `snakes` (10 seeds) | −5.086 | 2/8 | 0.109 | **+0.391** | 8/2 | 0.109 | −0.700 |
| `mixed` | −1.640 | 1/4 | 0.375 | +0.552 | 4/1 | 0.375 | −1.800 |
| `sparse` | −1.624 | 0/5 | **0.063** | +0.212 | 1/0 | 1.000 | −0.400 |
| `sparse-lean` | −0.832 | 2/3 | 1.000 | +0.094 | 2/1 | 1.000 | −0.200 |
| `potions` | −4.068 | 1/4 | 0.375 | +0.281 | 5/0 | **0.063** | −1.000 |
| `wide` | −2.259 | 1/4 | 0.375 | +0.412 | 3/2 | 1.000 | −1.600 |
| `dense` | −1.149 | 2/3 | 1.000 | +0.206 | 2/3 | 1.000 | 0.000 |
| `asym` | −2.721 | 1/4 | 0.375 | +0.263 | 2/3 | 1.000 | −0.400 |
| `potion-rich` | −1.939 | 1/4 | 0.375 | +0.415 | 5/0 | **0.063** | −1.000 |
| `long` | +0.087 | 2/3 | 1.000 | +0.472 | 5/0 | **0.063** | −1.600 |

Five seeds cannot reach p < 0.0625 — that is the floor of an exact two-sided
sign test at n = 5, and it is the honest limit of this slice. **The test that
does reach significance is the one over CLASSES, which is a count and not a
pool:**

* deaths/100 is HIGHER against `material-only` on **10 of 10** classes — sign
  test over classes, **p = 0.002**.
* survivors are LOWER on **9 of 10** (flat on `dense`) — **p = 0.004**.
* meals/100 is LOWER on **9 of 10** (higher only on `long`) — **p = 0.021**.

This is the ORCHESTRATOR-LOOP's opponent baseline reproduced on ten classes
instead of three, and it says the same thing in the same direction: a
material-only field neither seeks food nor declines a contest, so team 0 meets
more contests, wins fewer of them, and eats less. It is a fact about the FIELD,
not a defect: read `BEHAVIOUR-AUDIT-3.md` §2 for the arm-specific defects.

## 3. Parking, entrapment, potions — the instruments, per class

Mirror arms, per 100 unit-turns; the full table is `docs/design/wide/TABLE.md`.

| class | parked | longestPark | entrapped ut | episodes | escaped | fatal |
|---|---|---|---|---|---|---|
| `snakes` | 0.00% | 0 | 19.72% | 95 | **75** | 14 |
| `sparse` | 0.00% | 0 | 1.25% | 10 | 9 | 0 |
| `sparse-lean` | 0.00% | 0 | 2.25% | 12 | 10 | 0 |
| `potions` | 10.65% | 36 | 32.70% | 41 | 27 | 5 |
| `potion-rich` | 8.22% | 19 | 34.12% | 34 | 19 | 8 |
| `long` | 8.04% | 19 | 36.74% | 15 | **0** | 11 |
| `mixed` | 7.61% | 6 | 41.15% | 15 | **0** | 4 |
| `asym` | 5.67% | 32 | 45.64% | 20 | **0** | 8 |
| `dense` | 7.35% | 10 | 46.91% | 25 | **0** | 19 |
| `wide` | 7.09% | 13 | **53.69%** | 30 | **0** | 12 |

`escaped = 0` on `mixed`, `long`, `asym`, `dense` and `wide` is D5/P4 — "`room`
saturates on any board with a slider, and the instrument saturates with it"
(`BEHAVIOUR-AUDIT.md` D5) — and the wide corpus prices the saturation: it is
monotone in board area at fixed roster shape, `mixed` 41.15% → `wide` 53.69%,
and the instrument is UNREADABLE on every new class. Nothing here re-derives
D5; it is recorded so a later `room` repair has a number to beat.

Potions:

| class | arm | pickups | reckless | profitable AND safe |
|---|---|---|---|---|
| `potions` | mirror | 25 | 17 (68.0%) | 5 (20.0%) |
| `potion-rich` | mirror | 32 | 19 (**59.4%**) | 8 (**25.0%**) |
| `potions` | material-only | 28 | 22 (78.6%) | 1 (3.6%) |
| `potion-rich` | material-only | 29 | 27 (**93.1%**) | 1 (3.4%) |

**`potion-shape.md`'s standing rule is answered, and it survives.** The rule was
"leave the potion member alone until the game changes"; `potion-rich` IS the
game changed — twice the potions, on twice the board, refilled twice as often —
and on the mirror arm the composition does not get worse: pickups rise 25 → 32
(+28%) while the reckless share FALLS 68.0% → 59.4% and profitable-and-safe
rises 20.0% → 25.0%. The 71% reckless floor audit 2 recorded is not an artefact
of four potions on a small board, and doubling the supply does not break it.
What DOES break it is the arm: 93.1% reckless against a material-only field
(§2.3 of the audit).

## 4. What this baseline is for

1. Any later build re-records this corpus and subtracts:
   `node scripts/ab-compare.js <old json> <new json>` per class.
2. A behaviour change is kept only if it is at least as good on EVERY class at
   full length, deaths first (`DECISIONS.md`). Ten classes is a harder gate than
   five, deliberately — `dense` and `wide` are where the deaths are.
3. The three defect classes this corpus discovered are in
   `docs/design/BEHAVIOUR-AUDIT-3.md`, each with the counter that measures it.
