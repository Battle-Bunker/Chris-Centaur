# The wide baseline — ten board classes, two arms, 200 games, at `81063d7`

The number this branch exists to produce: what the head DOES, per board class,
on a corpus five classes wider than the one `BEHAVIOUR-AUDIT.md` and
`BEHAVIOUR-AUDIT-2.md` read. Every later build is measured against this file.

    scripts/wide-corpus.sh docs/design/wide 10 1          # record (resumable)
    node scripts/wide-corpus.js table docs/design/wide    # the tables
    node scripts/wide-corpus.js pair  docs/design/wide <A> <B>   # a paired test

Ten classes × seeds 1–10 × two arms = **200 games**, one process each,
deterministic mode (`--nodes`), 60 turns everywhere except `long` at 120. Every
number is a function of (build, scenario, seed, arm): re-record on `81063d7` and
it reproduces byte for byte. The recorder takes any seed range — `... 20 1`
records seeds 1–20 into the same directory and skips everything already there —
and the tables always describe what is on disk, so a deeper slice never
invalidates a number here, it only narrows its interval.

**Nothing is pooled across board classes** (`SUCCESSION.md`: measured sign-flips
cancel on pooling). The one figure taken across classes is a COUNT of classes,
which is what `ab-compare.js` itself prints at the end of its report.

The full machine-written tables are `docs/design/wide/TABLE.md`.

## 1. Play, per class, mirror arm — every team on the default profile

| class | ut | meals/100 | deaths | deaths/100 | by cause | survivors |
|---|---|---|---|---|---|---|
| `sparse` | 2400 | 6.88 | **0** | 0.000 | — | 40/40 |
| `sparse-lean` | 2354 | 6.46 | 3 | 0.127 | contest 2, self 1 | 37/40 |
| `mixed` | 3967 | 18.45 | 26 | 0.655 | contest 23, bodyBlock 2, self 1 | 54/80 |
| `potions` | 3941 | 19.16 | 26 | 0.660 | contest 22, bodyBlock 3, self 1 | 54/80 |
| `potion-rich` | 3945 | 16.60 | 29 | 0.735 | contest 29 | 51/80 |
| `long` | 6064 | 20.00 | 46 | 0.759 | contest 33, **self 6**, bodyBlock 5, wall 2 | 34/80 |
| `snakes` | 3139 | 17.36 | 25 | 0.796 | bodyBlock 16, **self 8**, contest 1 | 35/60 |
| `asym` | 4159 | 19.93 | 34 | 0.818 | contest 25, bodyBlock 4, **edge 2**, self 2, wall 1 | 56/90 |
| `wide` | 5406 | 15.82 | 58 | 1.073 | contest 40, bodyBlock 15, **edge 1**, self 1, wall 1 | 62/120 |
| `dense` | 4471 | 20.47 | **78** | **1.745** | contest 54, bodyBlock 17, **edge 4**, self 2, wall 1 | 42/120 |

**The ordering is the corpus's main result, and it is ordered by CROWD, not by
size.** `dense` (12 units on 121 cells) kills at **2.7×** `mixed`'s rate on
`mixed`'s own board with 1.5× the units. `wide` (12 units on 225 cells — a
LOWER density than `mixed`) kills at 1.6×. Half again the units on the same
board costs nearly three times the deaths; the same twelve units given twice
the board costs a little over half of that.

`contest` is the cause on 70% of the corpus's mirror deaths and is the top cause
on every class that has pieces. `bodyBlock` is a snake count: `snakes` (six
snakes), `wide` and `dense` (four and five) carry all of it.

## 2. The `material-only` arm, and what survives ten classes

Team 0 (`red`) keeps the default profile; every other team plays
`MATERIAL_ONLY_PROFILE`. Paired seed by seed within a class, never pooled
(`wide-corpus.js pair <c>:mirror <c>:material-only`, ten paired seeds each):

| class | meals/100 Δ | p | deaths/100 Δ | p | parked Δ | p | survivors Δ | p |
|---|---|---|---|---|---|---|---|---|
| `snakes` | −5.086 | 0.109 | +0.391 | 0.109 | 0.000 | — | −0.700 | 0.180 |
| `mixed` | −1.335 | 0.109 | +0.591 | 0.109 | +8.528 | **0.022** | −1.800 | **0.039** |
| `sparse` | −1.104 | 0.109 | +0.106 | 1.000 | 0.000 | — | −0.200 | 1.000 |
| `sparse-lean` | −0.791 | 0.754 | +0.006 | 1.000 | 0.000 | — | 0.000 | 1.000 |
| `potions` | −2.605 | 0.109 | +0.288 | **0.022** | +9.963 | **0.002** | −1.000 | **0.004** |
| `wide` | −2.424 | **0.022** | +0.354 | 0.109 | +3.975 | **0.022** | −1.200 | 0.219 |
| `dense` | −1.187 | 0.344 | +0.318 | 0.754 | +2.442 | **0.022** | −0.500 | 0.289 |
| `asym` | −2.999 | 0.109 | +0.369 | 0.754 | +5.496 | **0.022** | −0.300 | 0.688 |
| `potion-rich` | −2.937 | **0.022** | +0.263 | 0.109 | +7.724 | 0.109 | −0.700 | 0.070 |
| `long` | +0.229 | 0.754 | **+0.490** | **0.002** | +6.603 | **0.002** | **−1.600** | **0.002** |

Ten seeds is the first slice on which a per-class test can reach p < 0.0625 at
all (that is the floor of an exact two-sided sign test at n = 5), and four
classes now do. The direction is unanimous, and the count over classes — a
count, not a pool — is the strongest statement here:

* deaths/100 is HIGHER against `material-only` on **10 of 10** classes — sign
  test over classes, **p = 0.002**.
* meals/100 is LOWER on **9 of 10** (higher only on `long`) — **p = 0.021**.
* the parked share is HIGHER on **7 of 7** classes that park at all (`snakes`,
  `sparse`, `sparse-lean` park 0.00% on both arms) — **p = 0.016**.
* survivors are LOWER on **9 of 10** (flat on `sparse-lean`) — **p = 0.004**.

This reproduces the ORCHESTRATOR-LOOP's three-class opponent baseline on ten
classes and adds one fact it did not have: **the biggest and most significant
effect of a material-only field is not deaths, it is PARKING.** `mixed` 7.58%
→ 16.11%, `potions` 10.25% → 20.21%, `potion-rich` 8.73% → 16.45% — the parked
share roughly doubles on every class that has pieces, at p = 0.002 on two of
them. A field that chases material walks our pawns into walls and holds them
there, which is P1's mechanism driven by the opponent rather than by the board.

## 3. Parking, entrapment, potions — the instruments, per class

Mirror arms; the full tables are `docs/design/wide/TABLE.md`.

| class | parked | longestPark | entrapped ut | episodes | escaped | fatal |
|---|---|---|---|---|---|---|
| `snakes` | 0.00% | 0 | 21.15% | 190 | **150** | 25 |
| `sparse` | 0.00% | 0 | 1.46% | 24 | 21 | 0 |
| `sparse-lean` | 0.00% | 0 | 2.00% | 26 | 21 | 1 |
| `potions` | 10.12% | 44 | 32.33% | 80 | 52 | 11 |
| `potion-rich` | 8.75% | 20 | 33.18% | 76 | 46 | 16 |
| `long` | 8.94% | 43 | 34.71% | 30 | **0** | 22 |
| `mixed` | 7.76% | 29 | 38.64% | 30 | **0** | 11 |
| `asym` | 4.35% | 32 | 45.49% | 40 | **0** | 17 |
| `dense` | 7.96% | 10 | 45.34% | 50 | **0** | 36 |
| `wide` | 6.71% | 13 | **51.81%** | 60 | **0** | 29 |

`escaped = 0` on `mixed`, `long`, `asym`, `dense` and `wide` is D5/P4 — "`room`
saturates on any board with a slider, and the instrument saturates with it"
(`BEHAVIOUR-AUDIT.md` D5) — and the wide corpus prices the saturation: it is
monotone in board area at a fixed roster shape, `mixed` 38.64% → `wide` 51.81%,
and the instrument is UNREADABLE on every one of the five new classes. Nothing
here re-derives D5; it is recorded so a later `room` repair has a number to beat.

Potions:

| class | arm | pickups | reckless | profitable AND safe |
|---|---|---|---|---|
| `potions` | mirror | 40 | 29 (72.5%) | 8 (20.0%) |
| `potion-rich` | mirror | 67 | 38 (**56.7%**) | 15 (**22.4%**) |
| `potions` | material-only | 49 | 39 (79.6%) | 2 (4.1%) |
| `potion-rich` | material-only | 54 | 46 (**85.2%**) | 1 (1.9%) |

**`potion-shape.md`'s standing rule is answered on the game changed, and it
survives.** The rule was "leave the potion member alone until the game changes";
`potion-rich` IS that — twice the potions, on twice the board, refilled twice as
often — and on the mirror arm the composition does not get worse: pickups rise
40 → 67 (+68%) while the reckless share FALLS 72.5% → 56.7% and
profitable-and-safe rises 20.0% → 22.4%. The ~71% reckless floor audit 2
recorded is not an artefact of four potions on a small board, and doubling the
supply does not break it. What DOES break it is the arm: 85.2% reckless with
1.9% profitable-and-safe against a material-only field, on both potion classes.

## 4. What this baseline is for

1. A later build re-records the corpus and subtracts, per class:
   `node scripts/ab-compare.js <old> <new>`.
2. A behaviour change is kept only if it is at least as good on EVERY class at
   full length, deaths first (`DECISIONS.md`). Ten classes is a harder gate than
   five, deliberately — `dense` and `wide` are where the deaths are, and `long`
   is where the crashes are.
3. The three defect classes this corpus discovered are in
   `docs/design/BEHAVIOUR-AUDIT-3.md`, each with the counter that measures it.
