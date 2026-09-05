# Behaviour audit: what the bot actually does, read off 23 games

This is an audit of BEHAVIOUR, not of code structure. Nothing here re-derives
`docs/design/potions.md`, `entrapment.md`, `energy.md` or `docs/BASIC-INTELLIGENCE.md`;
where a finding of theirs is confirmed or contradicted it is named as such.

## Method and corpus

`npx tsc -p .` clean at `f215bf8`. Every run is
`node dist/tests/local-game.js <scenario> 60 <seed> --nodes` — the deterministic
work-unit clock, so every number below is reproducible from (build, scenario, seed).

| corpus | runs | unit-turns | meals/100 | deaths (by cause) | reversals | parked* |
|---|---|---|---|---|---|---|
| `mixed` seeds 1–3 | 3 | 1258 | 19.6 | 10 — contest 7, edge 2, bodyBlock 1 | 0.9% | 7.2% |
| `snakes` seeds 1–3 | 3 | 967 | 16.2 | 7 — bodyBlock 4, self 3 | 0.1% | 0.0% |
| `sparse` seeds 1–3 | 3 | 720 | 7.2 | **0** | 0.0% | 0.0% |
| `potions` seeds 1–8 | 8 | 3044 | 19.5 | 26 — contest 24, edge 1, bodyBlock 1 | 1.0% | 10.4% |
| `mixed`/`snakes` seeds 1–3 vs `material-only` | 6 | 1928 | 14.2 | 23 | 1.8% | 9.1% |

\* `parked` is the TRUE stationary share — a unit whose head cell is the same at the
start of two consecutive turns. It was not the runner's `stationary` counter; see D6,
which is now fixed, so as of `beh-contest` the counter reads this quantity.

`CENTAUR_DEBUG_INVERSION=1` over 10 runs (`potions` 1,2,3,4,5,7,8; `mixed` 1; `snakes` 1;
`sparse` 1) at 60 turns: **zero bound inversions**, on every board. `crashed: null` in all 23.
Zero `exhaustion` and zero `hazard` deaths in all 23. Zero deaths at a nonzero tier in all 23.

---

# Defect classes, ranked

## D1 — `contest` cannot see the cell an enemy is standing on

**Rank 1: it kills, it is a one-line rules-correctness fix, and it caused every one of the
three `edge` deaths in the corpus.**

### Reproduction A — `mixed` seed 1, turn 47

    T 47 blue-C  pawn  hp96 (0,2)->(0,3)  top3: (0,3)=19.33  (-1,2)=18.18  (0,2)=18.18
    T 47 green-A snake hp96 (0,3)->(0,2)
    DEATH blue-C (edge)

blue-C stepped onto the cell green-A's head occupied; `turnEngine.ts` c1 adjudicated the
head-on edge exchange and blue-C lost. A careful operator holds at (0,2) or rotates: the
one square on the board guaranteed to produce an adjudication this turn is the square an
adjacent enemy is standing on.

The arithmetic says exactly why it did not. The two alternatives are idle, so each pays
`momentum`'s `IDLE_COST × 1/|ours|` = `0.5/3` = 0.167, and each is ALSO inside green-A's
one-step reach, so each pays `contest`'s `CONTEST_LOSS × 3/3` = 1.00. Total 1.167 ≈ the
observed 1.15 gap. (0,3) — green-A's own cell — paid **nothing** for either.

### Reproduction B — `potions` seed 6, turn 31

    T 31 red-B  pawn  hp97 (6,10)->(6,9)  top3: (6,9)=-411.87  (7,9)=-412.87  (6,10)=-413.02
    T 31 blue-A snake hp98 (6,9)->(6,10)
    DEATH red-B (edge)

Same shape, same exact 1.00 gap: `(7,9)` is beaten and charged 1.00, `(6,9)` — the snake's
own cell — is charged 0.

### Reproduction C — `mixed` seed 1, turn 10 (the slider variant)

    T 10 red-B  pawn  hp100 (1,4)->(1,5)  top3: (1,5)=-154.09  (1,4)=-154.25  (2,4)=-154.25
    T 10 blue-B queen hp97  (1,5)->(1,4)
    DEATH red-B (edge)

A queen HAS `stay` in its grammar, so its cell IS in the field — and all three of red-B's
options are inside the queen's fan, so `contest` charges 1.00 to each and cancels. The 0.16
that decided the move is `momentum`'s idleness charge, `0.5/3` = 0.167, to the digit.

### The mechanic and the line

`src/lobster/evaluate/contest.ts`, `enemyArrivals` (line 213) stamps each enemy's
`sub.actionsOf(unit.unitId)` and nothing else. A trail unit has no `stay` in its grammar
(`moveGrammar.ts`: "staging their own square is not a move"), so **a snake's own cell is
never in `contestField`**, and `costOf` (line 236) returns 0 there. `beatenAt` then makes
the charge a BOOLEAN, so among cells that ARE in the field a slider's saturated fan cancels
across every option (reproduction C).

### The rule (one, parameterised, no board special case)

In `enemyArrivals`, yield each enemy's action set **union its own turn-start cell**, and
replace the boolean cost with a certainty weight:

    p_e(c) = 1                                  if c is e's turn-start cell
           = |{a ∈ actions(e) : a.to = c}| / |actions(e)|   otherwise
    cost(u) = CONTEST_LOSS × max over beating e of p_e(c)

The origin clause is the rules, not a heuristic: the enemy either holds that cell (c4
contest) or vacates it along our edge (c1 exchange), so a meeting there is certain either
way. `cost ∈ [0,1]` per unit is unchanged, so the term's `[-1,0]` range, the cliff
inequality and the contract's monotonicity all stand; the field only ever widens, which is
the conservative direction.

### Counter and prediction

Add `enemyOccupiedEntriesLost` — staged destinations equal to an enemy's turn-start cell
where `winsContest` says we lose. Measured today: 0.7–4.2% of unit-turns on `mixed`/`potions`
stage onto an enemy-occupied cell at all (60 events), 0.0–0.3% on `snakes`, 0 on `sparse`.

* `mixed` + `potions`, seeds 1–8: `edge` deaths **3 → ≤1**; `enemyOccupiedEntriesLost`
  **down ≥60%**; `contest` deaths **not up**.
* `snakes`: `bodyBlock` + `self` unchanged ±1 (the field widens by 3 cells per snake).
* `sparse`: byte-identical (no enemy is ever within one step; verified 0 events in 720
  unit-turns).

### STATUS — instrument merged, rule MEASURED AND REVERTED (`beh-contest`)

**The counter is in.** `enemyOccupiedEntries` / `enemyOccupiedEntriesLost` in
`src/tests/local-game.ts`, read off the board each decision was taken on with
that decision's own staged destinations, split by `winsContest`. It costs
nothing: over the corpus below every counter but the new and the D6-redefined
ones is byte-identical to the pre-instrument build, work and loud histogram
included. Baseline, 60 turns, `--nodes`:

| board | entries | lost | entries/100 | lost/100 |
|---|---|---|---|---|
| `mixed` seeds 1–3 | 29 | 5 | 2.31 | 0.40 |
| `potions` seeds 1–8 | 63 | 4 | 2.07 | 0.13 |
| `snakes` seeds 1–3 | 1 | 0 | 0.10 | 0.00 |
| `sparse` seeds 1–3 | 0 | 0 | 0.00 | 0.00 |

All three reproductions fire it, each an `ENEMY-CELL … LOST` line immediately
above the `edge` death: `mixed` seed 1 turns 10 and 47, `potions` seed 6 turn 31.

**The rule was implemented exactly as written above — origin clause and
certainty weight — and taken back out.** A/B by seed against the instrument
commit, per board class, `scripts/ab-compare.js`, never pooled:

| board | deaths A→B | `edge` | `lost` | meals | parked share |
|---|---|---|---|---|---|
| `mixed` | 10 → **9** | 2 → **0** | 5 → 3 | 246 → **215** | 7.2% → **12.3%** |
| `potions` | 26 → **28** | 1 → **0** | 4 → 4 | 595 → 586 | 10.4% → 6.5% |
| `snakes` | 7 → 7 | 0 → 0 | 0 → 0 | 157 → 157 | byte-identical |
| `sparse` | 0 → 0 | 0 → 0 | 0 → 0 | 52 → 52 | every game counter identical (`nodes` +12) |

Sixteen-arm inversion gate clean, `laws.ts` R1/R2/R3 green at both profiles.

The headline prediction HOLDS: `edge` deaths **3 → 0**, and those three are the
deaths D1 explains. Two of the three registered predictions do not.
`enemyOccupiedEntriesLost` falls **9 → 7**, a 22% drop against the 60%
predicted — the rule stops the losing entries it was aimed at and the bot finds
new ones. `contest` deaths are **up**, 31 → 33. And `potions` is worse on deaths
outright (contest +1, bodyBlock +1, self +1, plus the corpus's first
`deathsWhileDebuffed`), so the keep-criterion "no board class gets worse on
deaths" is not met and the change is reverted to the instrument-only state.

**What the measurement says about the rule, for whoever re-opens this.** The two
clauses are not separable the way the counter implies. The origin clause ALONE
cannot fix reproduction A — with a boolean charge all three of blue-C's options
are charged 1.00, they cancel, and the tie-break still takes the enemy's square;
that is reproduction C's argument applied to A. But the certainty weight divides
every non-origin charge by the enemy's action count, 1/3 to 1/5 in practice, so
`contest` loses about three quarters of its seated strength against a weight
(`contest: 3`) calibrated on the boolean reading — and the tempo terms move in
behind it: `mixed`'s parked share 7.2% → 12.3%, its longest park 8 → 49 turns,
its meals 246 → 215. The shape to measure next is a rule that keeps the seated
scale — the boolean charge LIGHTENED by a knob, `1 − ε + ε·p`, so the enemy's own
cell is the only full certainty and `ε = 0` recovers today's term — and it wants
its own calibration arm rather than a re-run of this one.

`src/lobster/__tests__/contest-occupied-cell.test.ts` holds reproduction A's
board unit for unit and pins TODAY's pricing: the entry onto the occupied cell
costs 0 and the hold costs the whole `CONTEST_LOSS`. A repair inverts that line.

### SECOND ATTEMPT — the lightened charge (`d1-two`), baseline re-taken

The instrument state (`a104f36`) re-measured at `npx tsc -p .` clean, 60 turns,
`--nodes`, one JSON summary per (scenario, seed), as the A arm every ε below is
paired against by seed: `mixed`/`snakes`/`sparse` seeds 1–3, `potions` seeds
1–8, and the `sparse-lean` arm seeds 1–3. It reproduces the corpus table above
figure for figure — `mixed` 1258 unit-turns, 10 deaths (`edge` 2, `contest` 7,
`bodyBlock` 1), 246 meals, `lost` 5; `snakes` 967, 7 deaths, 157 meals;
`sparse` 720, 0 deaths, 52 meals; `potions` 3044, 26 deaths (`contest` 24,
`bodyBlock` 1, `edge` 1), 595 meals, `lost` 4 — so the audit's numbers and this
attempt's are the same measurement, not two.

`sparse-lean` seeds 1–3: 720 unit-turns, 0 deaths, 45 meals of which 38 grown,
0 occupied-cell entries. It is in the corpus as the arm where a meal is worth
less than the turn it costs, and it is dark for D1 by construction.

#### The shape, and what ε has to clear

`enemyArrivals` yields each enemy's action set UNION its turn-start head cell,
every stamp carries how certain it is (`1` on the enemy's own cell,
`k/|actions|` on a cell k of its actions reach), and `costOf` charges

    CONTEST_LOSS × (1 − ε + ε·p)

so `ε = 0` is today's boolean term plus the origin clause, and the enemy's own
cell is the only full certainty at any `ε`. Reproduction A sets the floor on
`ε` exactly: the entry pays 1.00 in fold units, the two alternatives pay
`1.00 − 0.75ε` plus `momentum`'s 0.167, so the pawn stops stepping onto the
snake only at `ε > 0.167/0.75 = 0.222`. `ε = 0.25` clears it by 0.028; nothing
below 0.22 can fix the reproduction at all, which is what makes the window this
attempt had to measure in a narrow one.

#### The arms, per board class, paired by seed against the baseline above

60 turns, `--nodes`, `scripts/ab-compare.js` per class, never pooled.

| board | arm | unit-turns | deaths (by cause) | `edge` | `lost` | meals |
|---|---|---|---|---|---|---|
| `mixed` 1–3 | A | 1258 | 10 — contest 7, edge 2, bodyBlock 1 | 2 | 5 | 246 |
| | ε = 0.25 | 1239 | **10** — contest 8, bodyBlock 1, self 1 | **0** | **0** | 239 (−2.8%) |
| | ε = 0.50 | 1201 | **8** — contest 5, bodyBlock 2, self 1 | **0** | 1 | 214 (**−13.0%**) |
| | ε = 0.75 | 1063 | **12** — contest 11, self 1 | **0** | 1 | 211 (**−14.2%**) |
| `potions` 1–8 | A | 3044 | 26 — contest 24, bodyBlock 1, edge 1 | 1 | 4 | 595 |
| | ε = 0.25 | 3183 | **21** — contest 20, bodyBlock 1 | **0** | 4 | 624 (+4.9%) |
| | ε = 0.50 | 3140 | **24** — contest 22, bodyBlock 2 | **0** | 3 | 616 (+3.5%) |
| | ε = 0.75 | 3022 | **28** — contest 27, edge 1 | 1 | 5 | 587 (−1.3%) |
| `snakes` 1–3 | all three | 967 | 7 — bodyBlock 4, self 3 | 0 | 0 | 157 |
| `sparse` 1–3 | all three | 720 | 0 | 0 | 0 | 52 |
| `sparse-lean` 1–3 | all three | 720 | 0 | 0 | 0 | 45 (38 grown) |

`snakes`, `sparse` and `sparse-lean` are byte-identical to the baseline at
every `ε` — every game counter, not only these columns.

**`ε = 0.25` MEETS THE KEEP-CRITERION, and it is the first D1 arm that does.**
`edge` deaths 3 → **0** across `mixed` + `potions`; `enemyOccupiedEntriesLost`
9 → 4 (`mixed` 5 → **0**, `potions` 4 → 4); deaths up on no board class
(`mixed` 10 → 10, `potions` 26 → **21**, the other three flat); meals within 3%
everywhere (`mixed` −2.8%, `potions` +4.9%). The honest asterisks: `mixed`'s
deaths/100 is a hair UP (0.799 → 0.820) because the same ten deaths happen over
19 fewer unit-turns; `mixed` trades its two `edge` deaths for one `contest` and
one `self`; `mixed`'s occupied-cell ENTRIES go 29 → 42 while the ones it loses
go to zero, i.e. the bot takes the enemy's square more often and now takes it
only when it wins there; and `potions` seed 3 contributes the corpus's first
`deathsWhileDebuffed`. `ε = 0.50` and `ε = 0.75` are out on meals (−13.0% and
−14.2% on `mixed`), and `ε = 0.75` on `potions` deaths as well (26 → 28) — the
first attempt's failure re-appearing as `ε` → 1, which is what `ε` → 1 is.

### STATUS — SECOND ATTEMPT ALSO REVERTED, on the bound and not on the play

The sixteen-arm inversion gate is clean at `ε = 0.25`, `npx tsc --noEmit -p .`
and `npx eslint "src/**/*.ts"` are clean, and `local-game-determinism` passes
UNCHANGED — the pinned game plays the same moves, so no fixture was re-pinned.
What it fails is `src/lobster/evaluate/law-sweep.test.ts`:

    contest.lo = 34 > 30

and `contest.lo` is a RATCHET class, which may only go down. Measured at
`ε = 0.05, 0.20, 0.23, 0.25, 1`: **34 at every one of them**. At `ε = 0`
— the origin clause alone, boolean charge — it is **30**, unchanged. So the
origin clause is free and the LIGHTENING is what costs, in any dose.

**Why, exactly.** The four extra worlds are all on the sweep's board seed 1, and
the diagnostic prints them:

    e = 0     held.lo = -0.5      real.lo = -0.5     (a tie, not counted)
    e = 0.05  held.lo = -0.4778   real.lo = -0.5
    e = 0.25  held.lo = -0.3889   real.lo = -0.5
    e = 1     held.lo = -0.0556   real.lo = -0.5

The world's −0.5 is one of our units settled on an enemy's own cell, charged
the whole loss by the origin clause. The partial's floor is the average over the
units the PARTIAL resolution settles, at the charges of the cells it settles
them on — and a completion world can settle the same unit somewhere else. The
per-unit charge is therefore CONTINGENT and the term reads it as a point; the
boolean charge hid that by tying the two readings exactly, and a refinement that
raises the floor by even 0.02 cannot. `law-sweep`'s lattice-end guard
(`real.lo === held.lo` → skip) is what turned the tie into a non-event.

That is the same defect class as the 30 already pinned (there, on board seed
308, the partial reads 0 for a unit the world charges), so the lightening does
not introduce a new unsoundness — it widens an old one. It is still a rise, and
the ratchet's rule is that a class may only go down.

**What was tried and did not work.** Keeping the BOOLEAN charge in the `lo`
reading whenever one of our own units is held, and spending the certainty only
in the discharged reading: `contest.lo` stays 34. The held units in the sweep
— and in play — are the ENEMY claims; our own units are all staged, so the gate
never fires. Making the floor boolean whenever ANY unit is held instead turns
`contest` into a permanent interval, halves the lightening in `est` (the
envelope's midpoint), and needs its own calibration and its own corpus.

**So the state on disk is the instrument state again**, `contest.ts` and
`contest-occupied-cell.test.ts` byte-identical to `d597d0b`, and the pinned test
goes on pinning the defect.

**For a third attempt.** The play is not the problem any more — `ε = 0.25`
answers every behavioural prediction D1 registered, including the two the first
attempt missed. The problem is that a term whose per-unit charge depends on
where the resolution settles our unit cannot have its floor refined upward while
that cell is contingent. Either the floor is repaired first (charge each unit at
the worst cell its arrival could settle on, which is the loosening `b1-sound`
declined and would need its own A/B), or the certainty is spent somewhere the
floor does not read — the candidate ORDERING, or `momentum`'s idleness charge,
which is the 0.167 that actually decided reproduction A.

### THIRD ATTEMPT — the floor repaired at its cause (`d1-three`)

The second attempt's blocker was named exactly: `contest` charged each of our
units at the charge of the cell the PARTIAL resolution settles it on, and a
completion world can settle it elsewhere. `settlePartial` settles with every
held unit ABSENT, so a mover walks as far along its own staged path as an empty
board allows; a world can only ADD obstacles, halting it earlier along that same
walk or refusing the move outright and leaving it where it started. The cell is
therefore CONTINGENT and the term read it as a point.

#### The repair

`contest.ts`'s `settlesOn` names the set — nothing at all where the engine's own
`fates` says the unit is not contingent, so the term stays a POINT wherever
nothing is held and its `dischargeable` contract still holds; otherwise the
cells the unit ENTERED in this timeline (`traversed`) union the cell it set out
from. `costOf` brackets over it: the dearest cell in the worst reading, the
cheapest in the best.

Checked on the law sweep's own 240 boards before it was believed: over **8 637
completion worlds and 1 956 relocations of one of our movers, the world's settle
cell was inside the set every time**, and it was outside `traversed` ALONE
1 854 times — the commonest world is the one where the move does not happen and
the unit is still standing where it started, so the ORIGIN is the defect rather
than a tightening. A kind filter over the ledger (only the divergences that can
halt a unit) was measured too and moves the mean set size 1.605 → 1.603 cells:
the contingency is a halting one nearly every time, and the filter is not worth
its own paragraph in the code.

    law-sweep: contest.lo 30 -> 0   totalLo 0   no contest.hi class

The class is CLOSED, not lowered, and `bounds/exact-reply.test.ts` stays exact
on all four seed-1 arms.

#### What the repair costs, ALONE, per board class

60 turns, `--nodes`, `scripts/ab-compare.js` per class, never pooled, paired by
seed against a baseline re-recorded at the head this branch left from
(`924d91a`, a clean detached worktree). The baseline reproduces the corpus table
figure for figure — `mixed` 1258 unit-turns / 10 deaths / 246 meals / `lost` 5,
`snakes` 967 / 7 / 157, `sparse` 720 / 0 / 52, `potions` 3044 / 26 / 595 /
`lost` 4.

| board | arm | unit-turns | deaths (by cause) | `edge` | `lost` | meals/100 |
|---|---|---|---|---|---|---|
| `mixed` 1–3 | A | 1258 | 10 — contest 7, edge 2, bodyBlock 1 | 2 | 5 | 19.564 |
| | repair | 1242 | **9** — bodyBlock 4, contest 5 | **0** | **1** | 18.764 (**−4.1%**) |
| `potions` 1–8 | A | 3044 | 26 — contest 24, bodyBlock 1, edge 1 | 1 | 4 | 19.660 |
| | repair | 3052 | **24** — contest 20, bodyBlock 2, edge 1, self 1 | 1 | 6 | 20.251 (+3.0%) |
| `snakes` 1–3 | both | 967 | 7 — bodyBlock 4, self 3 | 0 | 0 | 16.190 |
| `sparse` 1–3 | both | 720 | 0 | 0 | 0 | 7.222 |

`sparse` is byte-identical on every field of the summary; `snakes` is identical
on every GAME counter and differs only in the work and loud accounting
(`nodes` 66 195 → 66 193 on seed 1).

**The repair alone is out on `mixed` meals**: −4.1% per 100 unit-turns against a
3% budget, with the parked share 7.2% → 8.2%. It answers the `edge` deaths
(2 → 0 on `mixed`) and takes `enemyOccupiedEntriesLost` 5 → 1 there, and it
loses ground on `potions`' `lost` (4 → 6).

#### The ordering ON TOP of the repaired floor: `ε = 0.25`, then `ε = 0.125`

The second attempt's lightened charge — `CONTEST_LOSS × (1 − ε + ε·p)`, the knob
`CONTEST_CERTAINTY` in `calibration.ts`, the enemy's own turn-start cell the only
full certainty — measured on top of the repair, against the same `924d91a`
baseline, same protocol, `scripts/ab-compare.js` per class.

**The bound gates are clean at both doses, which is the whole point of repairing
the floor first.** The ratchet that refused the second attempt (`contest.lo`
30 → 34, at every `ε` it was tried at) does not fire at any dose once the floor
brackets over the cells the arrival could settle on:

| arm | `law-sweep` | `totalLo` | `bounds/exact-reply` |
|---|---|---|---|
| A (instrument) | `contest.lo` **30** | 0 | exact |
| repair, `ε = 0` | `contest.lo` **class absent** | 0 | exact |
| repair + `ε = 0.125` | `contest.lo` **class absent** | 0 | exact |
| repair + `ε = 0.25` | `contest.lo` **class absent** | 0 | exact |

`exact-reply` is exact on all four seed-1 arms at every row (`mixed` 804 checks /
102 912 worlds, `snakes` 1 539 / 196 992, `sparse` 1 187 / 18 992 complete,
`potions` 849 / 108 672; zero floors above a real reply, zero ceilings below a
complete reply space). So the bound is no longer what refuses D1. The play is.

#### The arms, per board class, paired by seed

60 turns, `--nodes`, never pooled. `meals/100` is `ab-compare`'s paired mean of
`rates.mealsPer100`; `parked` is `stationary / unit-turns`.

| board | arm | unit-turns | deaths (by cause) | `edge` | `lost` | entries | meals/100 | parked |
|---|---|---|---|---|---|---|---|---|
| `mixed` 1–3 | A | 1258 | 10 — contest 7, edge 2, bodyBlock 1 | 2 | 5 | 29 | 19.564 | 7.2% |
| | repair | 1242 | **9** — bodyBlock 4, contest 5 | **0** | **1** | 13 | 18.764 (**−4.1%**) | 8.3% |
| | repair + `ε = 0.125` | 1261 | **7** — contest 7 | **0** | **1** | 14 | 18.927 (**−3.3%**) | 10.3% |
| | repair + `ε = 0.25` | 1251 | **8** — contest 7, self 1 | **0** | **1** | 19 | 18.454 (**−5.7%**) | 11.5% |
| `potions` 1–8 | A | 3044 | 26 — contest 24, bodyBlock 1, edge 1 | 1 | 4 | 63 | 19.660 | 10.4% |
| | repair | 3052 | **24** — contest 20, bodyBlock 2, edge 1, self 1 | 1 | 6 | 53 | 20.251 (+3.0%) | 9.7% |
| | repair + `ε = 0.125` | 3034 | **27** — contest 22, bodyBlock 2, wall 1, edge 1, self 1 | 1 | **2** | 50 | 20.651 (+5.0%) | 9.8% |
| | repair + `ε = 0.25` | 3077 | 26 — contest 22, bodyBlock 1, wall 2, self 1 | **0** | 4 | 49 | 21.123 (+7.4%) | 10.6% |
| `snakes` 1–3 | all four | 967 | 7 — bodyBlock 4, self 3 | 0 | 0 | 1 | 16.190 | 0% |
| `sparse` 1–3 | all four | 720 | 0 | 0 | 0 | 0 | 7.222 | 0% |

`snakes` and `sparse` are identical on every GAME counter at every arm — the same
deaths, the same causes, the same meals, the same zero occupied-cell entries on
`sparse` — exactly as D1's registered prediction said they would be.

**No arm is inside the meals budget on `mixed`, and the two `ε` arms each fail a
second criterion as well.**

* **`ε = 0.25`** is the best arm this defect has produced on everything the
  audit aimed at: `mixed` deaths 10 → **8** with `edge` 2 → **0** and `lost`
  5 → **1**, `potions` `edge` 1 → **0** with deaths flat at 26. It is **out on
  `mixed` meals at −5.7%**, nearly twice the 3% budget, with the parked share
  7.2% → 11.5%; and `potions`' `enemyOccupiedEntriesLost` does not move (4 → 4),
  so "`lost` down on every class" is missed too.
* **`ε = 0.125`** is the cheapest arm on meals — **−3.3%**, still outside the
  budget though only just — and it is the best arm on `mixed` deaths (10 → **7**,
  all `contest`, no `edge`). But `potions` **deaths go UP, 26 → 27**, and its
  `edge` death survives (1 → 1). Out on two counts, and the first of them is the
  keep-criterion the first attempt died on.
* **The repair alone** (`ε = 0`) is out at −4.1%, recorded above.

#### The mechanism: the meals are the FLOOR's cost, and `ε` does not pay them back

The repair charges each of our units at the dearest cell its arrival could settle
on, and for a mover that set is `traversed ∪ origin`. The measurement that
justified the set says why it is expensive: over the sweep's 8 637 worlds the
world's settle cell was outside `traversed` ALONE 1 854 times in 1 956
relocations — **the commonest contingent world is the one where the move does not
happen and the unit is still standing where it set out from**. So every staged
move whose path passes an enemy is now priced at the worst of {where it would
get to, where it started}, and a hold is priced at one cell. That is the honest
floor, and it is also a standing tax on ADVANCING, applied across the whole board
rather than at the reproduction: `mixed`'s parked share rises and its meals fall
before any ordering change is spent.

`ε` does not buy them back. It moves the two doses in opposite directions
(−4.1% → −3.3% at 0.125, → −5.7% at 0.25) while `potions` deaths go 24 → 27 → 26,
which is three seeds and eight seeds of a game counter behaving like noise around
a cost that is already there. There is no window between the doses to search: the
tempo loss is not a function of `ε`.

### STATUS — THIRD ATTEMPT REVERTED, on the play and not on the bound

The exact inverse of the second attempt, and the second attempt's diagnosis was
right about the cause: repairing the floor at `settlesOn` DOES close
`contest.lo` (30 → 0, `totalLo` 0, `exact-reply` exact), and it does free the
lightening to be measured at any dose. What the repair costs is tempo, and it
costs it on its own, before `ε` is spent. `mixed` meals are outside the 3% budget
at every arm this attempt measured.

**So the state on disk is the instrument state once more**: `src/` is
byte-identical to `924d91a` — `contest.ts`, `calibration.ts` (the
`CONTEST_CERTAINTY` knob is gone with it), `evaluate/index.ts`,
`law-sweep.test.ts` (`contest.lo` pinned back at **30**) and
`contest-occupied-cell.test.ts`, which goes on characterising the defect at
today's pricing. The scratch diagnostic `d1diag2.test.ts` is deleted.

Gates at the reverted state: `npx tsc --noEmit -p .` clean, `npx eslint
"src/**/*.ts"` clean, the five-suite jest gate 18/18 suites and 292/292 tests
green with `local-game-determinism` passing UNCHANGED (no fixture re-pinned —
the pinned game plays the same moves it always did), law sweep `totalLo 0` with
`contest.lo` back at 30, and the sixteen-arm inversion gate
(`CENTAUR_DEBUG_INVERSION=1`, seeds 1–3 at 30 turns per scenario plus `potions`
60 turns on seeds 4, 5, 6, 8) prints **no `INVERSION` line on any arm**.

**For a fourth attempt, if there is one.** Two doors are now closed and one is
still open, and the closed ones cost a branch each:

1. *Lighten the charge on the unrepaired floor* — refused by the `contest.lo`
   ratchet at every `ε` (second attempt).
2. *Repair the floor first, then lighten* — bound-clean at every `ε`, refused by
   `mixed` meals at every `ε` (this attempt). The cost is the origin clause in
   `settlesOn`, and it is not a tuning: the `kind` filter over the ledger was
   measured and moves the mean set size 1.605 → 1.603 cells.
3. *Spend the certainty where the floor does not read it* — the candidate
   ORDERING, or `momentum`'s idleness charge, which is the 0.167 that actually
   decided reproduction A. This is the one door D1 has never had a branch
   through, and after two attempts it is the only one left that does not start
   by making the bot slower.


---

## D2 — a pawn's orientation is invisible to the fold, so it parks

**Rank 2: no deaths, but it is the largest tempo loss on the board and it happens in every
`mixed` and `potions` game.**

### Reproduction — `potions` seed 5, turns 27–45, blue-C at (0,10)

Nineteen consecutive turns in which every option scored identically to the printed precision:

    T 27 blue-C pawn hp90 (0,10)->(0,10)  top3: (0,11)=91.23  (0,10)=91.23  (0,9)=91.23
    T 30 blue-C pawn hp90 (0,10)->(0,10) DITHER  top3: (-1,10)=99.88 (0,10)=99.88 (1,10)=99.88
    T 35 blue-C pawn hp90 (0,10)->(0,10) DITHER  top3: (0,11)=110.97 (0,10)=110.97 (0,9)=110.97
    ...
    T 46 blue-C pawn hp90 (0,10)->(1,10)  top3: (1,10)=110.61  (-1,10)=110.61  (0,10)=110.61

It escaped at turn 46 on a 0.01 tie-break, then walked the top row east and **ate twice**
(turns 48 and 53). A careful operator rotates east once on turn 27 and starts eating on
turn 29 — seventeen turns and two meals earlier.

Not a corner artefact: `mixed` seed 2 turns 50–55 has the same tie at the interior cell
(5,9) — `(5,9)=169.78 (5,10)=169.78 (5,8)=169.77`. Longest parks per run: `mixed` 9, 6, 21
turns (mirror), `potions` 6–21 turns, and 45 of 60 turns for blue-C in `mixed` seed 3 vs
material-only. **Every** long park in the corpus is a pawn.

### The mechanic and the lines

Every member reads `Standing.cell`, and a rotation does not change it, so a rotation and a
hold are indistinguishable to all of them but two, and both of those tie as well:

* `src/lobster/evaluate/momentum.ts`, `costOf`: `if (s.cell === from) { ... return IDLE_COST
  * min(1, energy/cap) }` — a rotation and a hold are charged the same. The file says so
  outright ("for a pawn it is the rotation").
* `src/lobster/evaluate/features.ts`, `commandSum`:
  `const c = Math.min(1, (ground * knobs.ground + meals * knobs.food) / open);` — `command`
  is the ONLY member that reads a piece's next-turn front and so the only one that CAN see
  an orientation, but the front is intersected with the contested trail domain and the food
  board only. On `mixed`/`potions` a queen's claim cloud collapses the trail domain near the
  perimeter (`entrapment.md` §4.4), so the one cell that differs between two orientations is
  in neither board and `c` is equal. `command` was seated to kill exactly this pathology
  (`calibration.ts`: "a pawn spends the game turning on the spot"); it fixed the interior
  case and left this one.

Measured tie rate, top-two candidate floors equal, mirror runs: **pawn 17–47%**, knight
8–19%, snake 2–9%, queen 0–7%.

### The rule

One new `CommandKnobs` field, folded into the same clamp:

    c = min(1, (ground·knobs.ground + meals·knobs.food + |F_u|·knobs.mobility) / open)

with `mobility = 1` (equal to `ground`, an order of magnitude under `food`'s 20). `|F_u|` is
the front's own cardinality — already computed, one extra `popcount32` per unit. It applies
to every non-royal piece on every board, is identically zero on a board with no piece, keeps
`c ∈ [0,1]` so the range and cliff inequality are untouched, and reads the same shells
`ground` reads, so R2/R3 are unaffected.

### Counter and prediction

Fix `stationary` (D6) and add `longestPark`.

* `mixed` + `potions` seeds 1–3: parked share **7.2% / 10.4% → <4%**; `longestPark`
  **≥9 → ≤3** turns; pawn top-two tie rate **17–47% → <15%**; meals/100 unit-turns **up ≥5%**.
* `snakes`, `sparse`: **byte-identical** — the `commandSum` loop skips `leavesTrail` kinds,
  so a board with no piece never reaches the new addend.

---

## D3 — `room`'s fear falls as the snake grows, at equal absolute shortfall

**Rank 3: 9 of the 43 deaths in the corpus are `self` or `bodyBlock`, and the fix is one
normaliser.**

### Reproduction — `snakes` seed 1, turns 45–51, green-B

    T 45 green-B (7,0)->(8,0)   top3: (8,0)=-192.42  (6,0)=-192.54  (7,1)!=-292.63
      ENTRAPPED green-B kept=6/12
    T 46 (8,0)->(8,1)   T 47 (8,1)->(9,1)   T 48 (9,1)->(10,1)   T 49 (10,1)->(10,0)
    T 50 (10,0)->(9,0)  top3: (9,0)=-91.67  (11,0)!=-211.07  (10,-1)!=-211.07
    T 51 (9,0)->(9,1)   top3: (9,1)=-211.08  (8,0)=-211.08  (10,0)=-211.08
    DEATH green-B (self)  body was (9,0)(10,0)(10,1)(9,1)(8,1)(8,0)(7,0)(7,1)(6,1)(5,1)(4,1)(3,1)

The instrument opened the episode at turn 45. The bot then spent six turns walking DEEPER
into the bottom-right pocket its own body had walled off along y=1, and by turn 51 all three
legal moves were its own body — a total tie, and death. The decision that mattered is turn
45: the escape (6,0) lost to the pocket entry (8,0) by **0.12**.

### The mechanic and the line

`src/lobster/evaluate/features.ts`, `fearsOf`:

    const short = Math.min(1, Math.max(0, (need - t.kept) / need));
    out.set(t.subject.unitId, Math.sqrt(short));

`need = max(4, length + 2)`. At a FIXED absolute shortfall `d` cells, the fear is
`sqrt(d/(L+2))`, which **decreases as `L` grows**. A length-12 snake three cells short reads
0.46; a length-4 snake three cells short reads 0.71. The longer snake — which needs more
room, turns worse, and is the one that actually suffocates — is charged less. That inversion
is the whole of the 0.12 at turn 45.

### The rule

Normalise the shortfall by a fixed cell budget rather than by `need`:

    short = clamp01((need - kept) / roomCells)     // roomCells: one profile knob, default 6

Same `sqrt` shaping, same `[0,1]` per unit, same `[-1,0]` term range, same cliff inequality.
Length-independent by construction, so it is a rule and not a case.

### Counter and prediction

`fatalEntrapments`, `entrapmentLeadSum / fatalEntrapments`, `deathsByCause.self` +
`.bodyBlock`.

* `snakes` seeds 1–3: fatal entrapments **7 → ≤4**; `self` + `bodyBlock` deaths **7 → ≤4**;
  `escapedEntrapments` **not down** (45 today).
* `mixed`, `potions`: within noise — the term is already saturated there by a slider's cloud
  (`entrapment.md` §4.4), which is D5.
* `sparse`: unchanged (2–4 entrapped unit-turns per game, 0 fatal).

---

## D4 — the potion peril's far horizons are a constant, and eat half its range

**Rank 4: it costs tiers and turns, not lives — `deathsWhileDebuffed` is 0 in all eight
`potions` games — but the owner's stated criterion is met by only one pickup in five.**

Measured, `potions` seeds 1–8: **39 pickups; 16 profitable (41%); 23 reckless (59%);
8 profitable AND safe (20.5%)**.

### Reproduction — `potions` seed 6, turn 39

    T 39 red-C knight hp91 (3,7)->(5,8)  top3: (5,8)=-403.05  (2,5)=-403.08  (1,6)=-403.39
    POTION x1  tier up: red-A  tier down: red-C  [red-C hp90 enemyTier+0 caught@1 EXPOSED]

red-B was already dead, so red-C paid a tier to give its ONE surviving ally a tier — a net
zero for the team — and did it with an enemy able to beat the debuffed collector anywhere it
could stand on the very next turn. The margin over the next option was **0.03**. Second
instance: seed 4 turn 5, blue-B queen `(10,3)->(8,5)`, EXPOSED, margin 0.10.

### The mechanic and the line

`src/lobster/evaluate/window.ts`, `perilOf`: `const w = window - k + 1;`. With `W = 3` the
horizon weights are 3, 2, 1. The file's own header records that horizons 2 and 3 are
vacuous — "41 of 41 pickups came back fully exposed" there — so half the term's mass is a
constant ≈1 and `peril`'s usable range is `[0.5, 1]`, not `[0, 1]`. The discriminating
signal is halved before it is weighed against `PERIL_WEIGHT`.

### The rule

Geometric horizon weights, `w_k = λ^(k−1)`, with one profile knob `λ` (default `1/4`), so
horizon 1 carries 76% rather than 50%. `λ = 1` recovers a flat reading; today's arithmetic
weights are the single point the knob replaces. No new geometry, no new claim pass.

### Counter and prediction

`recklessPickups / potionPickups` and `profitableSafePickups / potionPickups`.

* `potions` seeds 1–8: reckless share **59% → ≤40%**; profitable-and-safe **20.5% → ≥30%**;
  total pickups **≥20** (not a collapse to zero); `deathsWhileDebuffed` **stays 0**.
* `mixed`, `snakes`, `sparse`: **byte-identical** — `collectorsOf` gates the whole member.

### STATUS: BUILT, MEASURED, REVERTED — the prediction fails in direction

The rule above was implemented exactly as written (`λ = 1/4`, and a second arm at
`PERIL_WEIGHT = 3` to answer the level objection), measured over the same corpus, and
backed out. `potions` seeds 1–8, 60 turns, `--nodes`, paired by seed:

| arm | pickups | reckless | profitable AND safe | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|
| before | 39 | 23 (**59.0%**) | 8 (**20.5%**) | 0 | 26 |
| `λ = 1/4` | 63 | 50 (**79.4%**) | 5 (**7.9%**) | 1 | 22 |
| `λ = 1/4`, peril ×3 | 49 | 35 (**71.4%**) | 2 (**4.1%**) | 0 | 19 |

Both counters move the WRONG way, and the profitable-and-safe fall is the one clean
signal in the experiment (down on 7 of 7 moving seeds, p = 0.016). The diagnosis in this
section is right — half the reading really is a constant, and the reproduction board now
carries a fixture proving it (red-C's horizons read 1/3, 1, 1 at seed 6 turn 39) — but
the repair is wrong: with the tail saturated, ANY reweighting toward horizon 1 lowers the
tail's contribution from 0.5 to 0.24, which cuts the price of every pickup, and the extra
pickups a price cut admits are the exposed ones. `reckless` is also a boolean on ONE
beatable cell where `peril` is a share of the ground, so no choice of λ can make the term
refuse what the counter counts. The three potion-free classes were byte-identical and all
sixteen inversion arms were clean, so the rule is sound and merely ineffective.
`docs/design/potions.md`, "D4", carries the mechanism and what a next attempt must fix.

---

## D5 — `room` saturates on any board with a slider, and the instrument saturates with it

**Rank 5: no fix proposed here beyond a knob; it is recorded because it makes D3's counter
unreadable on two of the four boards.**

On `mixed` every run reports exactly **3 entrapment episodes, 0 escapes**, and 158–180
entrapped unit-turns out of ~400 — one permanently-open episode per snake. `mixed` seed 2
scores 3 fatal entrapments with `entrapmentLeadSum` 158: a mean "warning" of **52.7 turns**,
which is not a warning, it is a stuck flag. On `snakes` the same instrument reads 14–25
episodes with 11–21 escapes and 2–3 fatal — informative.

Mechanic: a held queen's claim cloud bars most of the interior within two turns, so every
snake reads a shortfall from turn 1 and `fearsOf` is nearly constant across candidates. This
is already stated in `entrapment.md` §4.4 and `BASIC-INTELLIGENCE.md`; what is new is the
measurement that the FLAG never clears, so `escapedEntrapments` is structurally 0 there and
`fatalEntrapments` on `mixed`/`potions` is a death counter wearing an entrapment label.

Rule: give the barrier flood a knob for the enemy-head bar — bar a cell only where an enemy
head can hold it at or before `t` **and** at or before a horizon `enemyBarTurns` (default 2,
today unbounded). One parameter, applied to every unit on every board.

Counter and prediction: `escapedEntrapments` and `entrapmentLeadSum / fatalEntrapments`.
On `mixed` + `potions` seeds 1–3, escapes **0 → >0** and mean lead **52.7 → <15** turns;
on `snakes` and `sparse` unchanged ±10% (no slider on either board, so the bar never binds).

---

## D6 — the runner counts a pawn rotation as a move, hiding D2

**Rank 6: an instrument defect, and it is why D2 has never been reported.**

`src/tests/local-game.ts`, the trace loop: `const moved = key(tr.from) !== key(tr.to);` — but
`tr.to` is the STAGED cell, and a pawn's rotation stages a side square it never enters
(`moveGrammar.planUnitAction`, the `rotate` branch). blue-C's nineteen parked turns in D2
register as fifteen "moves" and four stationary turns. Reported `stationary` across the
corpus is 0.0–6.2%; the true parked share is 0.0–13.0%.

Rule: compare the cell actually HELD — `tr.from` against the same unit's `tr.from` last
turn — and keep the staged cell only for the dither signature. Add `longestPark`.

Prediction: `stationary` on `mixed`/`potions` roughly doubles with no behaviour change at
all; `snakes` and `sparse` unchanged at 0 (no kind on those boards can rotate).

### STATUS — FIXED and measured (`beh-contest`)

`stationary` now compares the cell HELD — `tr.from` against the same unit's
`tr.from` last turn — and the staged cell is kept for the dither signature and
for the (unchanged) reversal reading; a unit's first turn is neither parked nor
moved, because there is no previous cell to compare it against. `longestPark` is
in beside it, and the trace prints ` PARKED` on the row.

**The prediction holds, and so does "no behaviour change at all":** over the
whole corpus every other counter is byte-identical to the pre-fix build, `work`
and `loud` included.

| board | `stationary` before | after | `longestPark` |
|---|---|---|---|
| `mixed` seeds 1–3 | 2.54% | **7.15%** | 8 |
| `potions` seeds 1–8 | 4.17% | **10.41%** | 20 |
| `snakes`, `sparse` | 0.00% | 0.00% | 0 |

---

# Behaviour that is already right

Do not re-litigate these. Each has its evidence.

1. **Energy management does not starve anything, and it does not freeze anything.**
   `sparse` — two meals on a 13×13, the board built to starve a bot without a food gradient —
   ran three 60-turn games with **0 deaths of any cause**, end health 73–100 on all four
   snakes, 16–19 meals each. Across all 23 runs: **0 exhaustion deaths, 0 hazard deaths**.
2. **The `energy` member is doing its job on sliders.** Mean health spent per queen-turn is
   **0.50–1.57** against a per-turn maximum of nine, over five mixed/potions games, with the
   queen still eating (blue-B is the top eater on `mixed` seed 1). It shortened travel
   without producing a statue, which is what `energy.md` §(c) predicted.
3. **Reversals are rare and mostly justified.** Mirror runs: 0.0–2.1% reversal rate,
   unjustified 0.0–0.9%, against a gate of 12%. `snakes` and `sparse` are at 0.0–0.3%.
4. **The bound is sound at head.** Zero `ScoreBounds` inversions over ten 60-turn runs
   spanning all four scenarios, including `potions` seeds 5, 7 and 8. This **contradicts**
   `potions.md` §3's record of 875 inversions on `potions` seed 7 and 103 with the member on;
   whatever produced them is gone. That is a repaired finding, not an open one. Re-confirmed
   on `beh-contest` over sixteen arms (all four boards, seeds 1–3 at 30 turns, plus `potions`
   seeds 4, 5, 6, 8 at 60): zero on every one. `potions.md` §3 now says so at the figures.
5. **`room` works on a trail-only board.** `snakes` seeds 1–3: 56 entrapment episodes, **45
   escaped**, 7 fatal. The term detects the shortfall and the bot walks out of it four times
   in five.
6. **Tier bookkeeping is exact and nothing dies holding one.** `potionTierUps` equals
   `potionTierDowns` in all eight `potions` games (every level given is given back at lapse),
   and `deathsWhileBuffed` = `deathsWhileDebuffed` = **0** across 26 deaths.
7. **The bot survives `material-only` on the snake board.** Red keeps the default profile
   (`--opponent=material-only` leaves team 0 alone); red finishes seeds 1–3 with 2/2, 1/2 and
   2/2 units standing at turn 60. On `mixed` the result is mixed — 2/3, 2/3, 1/3 survivors.
   Reported, not claimed as a win: the runner's counters are board totals, so no per-team
   meal or death rate can be read off them without a new counter.
8. **The fold already prices the fill-to-grow rule correctly where it can see it.**
   `material` reads the SETTLED weight, so the meal that tops a tank off scores above the meal
   that merely feeds (`evaluate.test.ts`, "material prices the meal that FILLS"), and
   `energy`'s `spend = max(0, runway − s.energy)` is read off the resolution, so a partial
   meal is charged its true residual and not assumed free.

---

# Not a defect

1. **Off-board destinations in the top-3 scoring exactly what a hold scores.**
   `(-1,2)`, `(0,11)`, `(0,-1)` appear as candidates for pawns and score identically to
   staying. They are the `rotate` branch of `moveGrammar.planUnitAction`: "the side square is
   pure signalling, never entered, so a pawn against the wall may still turn." Pricing them as
   a hold is CORRECT. What is wrong is that nothing prices the orientation they buy — D2.
2. **`edge` deaths are not perimeter walks.** Already recorded in `BASIC-INTELLIGENCE.md`;
   confirmed here — all three are `turnEngine.ts` c1 head-on exchanges, and all three are D1.
3. **59% `reckless` pickups is an upper bound, not a body count.** `readPickup` compares
   `mine.weightMin` against `claim.weightMax` at horizon 1, so `reckless` fires whenever any
   enemy claim merely intersects the debuffed collector's claim. `potions.md` §4 already flags
   that this and the peril half measure different things. `deathsWhileDebuffed` = 0 over 480
   turns is the check on it: the risk is real but it did not cash in once. D4 is ranked as a
   tempo-and-tier loss for that reason.
4. **`seedKept` at 141–265 of ~180 decisions.** The generator's seed survives roughly half
   the unit-turns under the `--nodes` budget. That is the deterministic clock being small, not
   the evaluator failing to decide; `BASIC-INTELLIGENCE.md` records the same shape at 20 ms
   (98.8%) and 150 ms (37%).
5. **High `entrappedUnitTurns` on `mixed`/`potions`.** It is instrument saturation, D5, not
   three snakes that spend the game boxed in.

---

# The gap the corpus cannot close

**The fill-to-grow rule is never exercised by any behavioural measurement in this repo.**
None of the four scenarios sets `foodEnergy`, so `resolveTurn` uses
`DEFAULT_FOOD_ENERGY = 100`, which equals `defaultMaxEnergy` — every meal fills and every
meal grows, exactly the old rule. `grep foodEnergy src/lobster` returns only the unit test.
So the fold's pieces are pinned at the level of one evaluation and the BEHAVIOUR over sixty
turns is unknown: whether `food`'s hunger pull (weight 4, hardest on the emptiest unit, which
is the unit whose meal will NOT top it off) and `material`'s growth credit (weight 10, paid to
the unit whose meal will) produce a sensible division of labour has never been watched.

The cheapest thing that closes it: a `sparse-lean` scenario — `SPARSE_SCENARIO` plus
`foodEnergy: 50` — and a `grownMeals` counter beside `foodEaten` in `stepGame`.
Prediction to pre-register: at seeds 1–3, 60 turns, `grownMeals / foodEaten` is at least 0.5
and starvation deaths stay at 0. If either fails, the food/material balance is the next
defect class and it belongs above D4.

### STATUS — the gap is CLOSED, and 50 was the wrong value (`beh-contest`)

`grownMeals` is in beside `foodEaten` (and `ate` is now settlement's own
collection test — a survivor whose head finished on a cell the turn opened with
food on — rather than an occupancy-growth reading, which on a lean board would
report a board where nothing eats). `GameSpec.foodEnergy` rides through
`buildBoard`, `--food-energy=N` states it per invocation, and the recorded arm
is `sparse-lean`.

**At the suggested `foodEnergy: 50` the arm exercises nothing.** Swept over
seeds 1–3 at 60 turns:

    foodEnergy   100    50     40     25     20     15     10
    meals         52    52     52     51     45     46     61
    grown/meals 1.00  1.00   0.98   0.92   0.84   0.70   0.36

A unit on `sparse` is almost never more than fifty short when it eats, so at 50
every meal still fills and still grows and the whole run is byte-identical to
`sparse` itself. `sparse-lean` is therefore `foodEnergy: 20`, where one meal in
six is fuel and no length while the board keeps the property that made it the
base: **0 deaths, 0 starvation deaths, `grownMeals / foodEaten` = 0.84** over
seeds 1–3 (45 meals, 38 grown, 720 unit-turns, meals/100 6.25 against `sparse`'s
7.22). The pre-registered prediction PASSES at every value down to 15 (0.70) and
FAILS at 10 (0.36), where the bot eats a fifth more often for a third of the
growth — so the food/material balance is sound in the regime this board can be
run at, and 10 is the value at which it stops being.
