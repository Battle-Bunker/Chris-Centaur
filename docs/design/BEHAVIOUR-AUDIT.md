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

### STATUS: BUILT, MEASURED, KEPT — the direction holds, the magnitude does not

`CommandKnobs.mobility = 1`, the addend `|F_u| · knobs.mobility` inside the same clamp
(`features.ts`, `commandSum`), validated at construction by `checkWeights` — which now
refuses a `command` block whose numeric knobs are missing or negative, because a knob
that reaches the fold as `undefined` makes `c` NaN in every piece evaluation on the board
and a stored binding is a plain object TypeScript never saw.

MEASURED TWICE, and the second measurement is the one that counts. The first was
arm-vs-arm at `mobility` 0 and 1 on one build, with the parked share recomputed off the
traces because the runner could not then report it. The second, below, is
BRANCH-vs-BRANCH: the working-branch head (`ab68d97`, which carries D6's fixed
instrument) against this branch's head, `mixed`/`snakes`/`sparse`/`potions` seeds 1–3,
60 turns, `--nodes --json`, subtracted per class by `scripts/ab-compare.js`. `parked`
below IS the runner's `stationary` now, and the recomputation and the instrument agree to
a tenth of a point on `mixed` (7.29 vs 7.15) — which is the check that the first
measurement was measuring the same thing.

| | parked | longestPark | meals/100 | meals | deaths | deaths/100 | unit-turns |
|---|---|---|---|---|---|---|---|
| `mixed` before | **7.15%** | 8 | 19.55 | 246 | 10 | 0.79 | 1258 |
| `mixed` after | **6.30%** | 6 | 20.40 | 233 | 10 | **0.88** | 1142 |
| `potions` before | **10.71%** | 10 | 18.23 | 223 | 10 | 0.82 | 1223 |
| `potions` after | **7.87%** | 5 | 19.85 | 232 | 9 | 0.77 | 1169 |

`snakes` and `sparse` are **byte-identical**: the two JSON summaries differ in the arm
label and in nothing else, counter for counter, on all three seeds — the `commandSum`
loop skips `leavesTrail` kinds, so a board with no piece never reaches the addend. All
sixteen inversion arms clean under `CENTAUR_DEBUG_INVERSION=1` (four classes × seeds 1–3
at 30 turns, plus `potions` seeds 4, 5, 6, 8 at 60), `crashed: null` on every one.

**THE COST, stated in the reading that shows it.** Deaths rise in COUNT on no class —
`mixed` 4/4/2 → 4/4/2 seed for seed, `potions` 2/4/4 → 2/4/3, `snakes` 7 → 7, `sparse`
0 → 0 — but on `mixed` they arrive EARLIER, on every seed: death turns (10,47,48,57) →
(18,24,33,58), (28,51,53,57) → (9,30,39,51), (24,43) → (19,21), a mean death turn of
**41.8 → 30.2**. That is the whole of the 9% fall in `mixed` unit-turns, and the
denominator is why `deathsPer100` RISES there (0.79 → 0.88, up on 3/3 seeds) with the
count flat, and why `mixed`'s ABSOLUTE meals fall (246 → 233) while its meals/100 rises.
`potions` shows none of it: absolute meals 223 → 232, one death fewer, unit-turns off
4%. Whoever reads only the rate column on `mixed` is reading a denominator.

`mixed`'s death CAUSES move with the timing: `bodyBlock` + `self` **1 → 6** over three
seeds, `contest` 7 → 4, `edge` 2 → 0. A pawn that stops parking meets things a parked
pawn never met, and on `mixed` what it meets is a body. KEPT — every counter D2 named
moves the right way on both classes, and no class buries a unit it did not bury before —
but the class of death it trades into is D3's own, and D3's measurement is where to find
out whether the trade is paid back.

**What the prediction got right, and what it did not.** Parked falls on both classes and
`longestPark` roughly halves, meals rise on both, and the pawn's tie rate falls by a
third — the direction is right on every counter. The MAGNITUDES are not met: parked
reaches 6.3% / 7.9% against a predicted <4%, `longestPark` 6 / 5 against ≤3, and
meals/100 rises 4.3% on `mixed` against a predicted ≥5% (`potions` clears it at 9.3%). The
addend separates a rotation from a hold, which is what it was built to do; it does not
make the pawn's whole option set gradient-rich, and 43% of parked pawn-turns still end in
a tie the tie-break decides.

**One thing the prediction did not anticipate, recorded because it is real.** The knob
applies to every non-royal piece, and for a KNIGHT — which has no orientation — `|F_u|`
is a pure centrality bonus, so a knight in a high-mobility cell is now paid to stay in
it. `mixed` knight parked share rises 4.56% → 8.64% — it is the team total that falls,
and it falls in spite of the knights, not with them. (Under the PRE-D6 counter this
showed up as `stationary` rising on `mixed` while the true parked share fell; that
counter is gone, and the branch-vs-branch table above is the fixed one.) Kept anyway —
the team totals move the right way on both classes and on every
counter D2 named — but a knight parking is a new thing to watch, and if it grows the
right narrowing is to gate the addend on kinds that HAVE an orientation rather than to
retune the level.

**A correction to this section's own prose.** D2 says blue-C escapes by "the east
rotation". At (0,10) facing west the two side squares are (0,11) and (0,9)
(`moveGrammar.planUnitAction`, the `rotate` branch: the sides are `±(−dy, dx)`), so east
is two turns away and the rotation this term buys is the one ALONG the board. The
mechanism is unchanged; the compass bearing was wrong. The boundary test
(`evaluate.test.ts`, "D2 — a pawn at the wall, where a rotation and a hold used to tie")
pins the geometry at the reproduction's own cell: with `mobility` at 0 all three of the
pawn's options score identically, and at 1 the along-the-board rotation is the argmax
while the into-the-wall rotation stays exactly level with the hold.

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
