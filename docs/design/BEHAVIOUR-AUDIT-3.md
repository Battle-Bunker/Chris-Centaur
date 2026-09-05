# Behaviour audit 3 — the wide corpus: five new board shapes, read at `81063d7`

Audits 1 and 2 read the SAME 26 games. `docs/ORCHESTRATOR-LOOP.md` closed that
corpus — "the behaviour programme on the 26-game corpus is at its floor... the
only decidable next step is more board" — so this audit reads a different one:
**200 games**, the five old classes UNCHANGED plus five new shapes built from
one parameterised `boardOfShape` (`src/tests/local-game.ts`, the `wide-corpus`
section), every class on seeds 1–10 and on two arms.

**Only NEW defect classes are named here.** D1–D6 (audit 1), P1–P4 (audit 2)
and every refutation in `docs/design/DECISIONS.md` are binding: nothing below
re-derives a refuted rule, and where the new board makes a KNOWN class worse
that is §4, a magnitude and not a discovery.

## Method and corpus

    scripts/wide-corpus.sh docs/design/wide 10 1

One process per (scenario, seed, arm), deterministic (`--nodes`), so every
number below is a function of (build, scenario, seed, arm) and re-recording it
on `81063d7` reproduces it byte for byte. `arm = mirror` is every team on the
default profile; `arm = material-only` puts every team but team 0 on
`MATERIAL_ONLY_PROFILE`, so on that arm team 0's (`red`'s) deaths are OURS.
60 turns everywhere except `long`, which is 120. The five old classes are
byte-identical to the head at seeds 1–3 (`ab-compare.js`: all zero, 5 classes
flat; and the fifteen JSON summaries equal field-for-field bar `label`/`wall`).

The per-class play, both arms, the paired arm tests and the instruments are
`docs/design/WIDE-BASELINE.md` — they are the baseline, not this audit. The
tables are `docs/design/wide/TABLE.md`, regenerated from disk by
`node scripts/wide-corpus.js table docs/design/wide`; the paired tests are
`node scripts/wide-corpus.js pair docs/design/wide <A> <B>`; the death, park
and pickup census is `node scripts/wide-corpus.js census docs/design/wide`.
Traces are not committed — each is a deterministic function of the build, and
every reproduction below prints the one command that regenerates its own.

The new classes, one line each (`boardOfShape`):

| class | board | rosters | items | asks |
|---|---|---|---|---|
| `wide` | 15×15 | 3 × 4 units | 8 meals | does the bot SCALE — distance, not density |
| `dense` | 11×11 | **4** × 3 units | 6 meals | `mixed`'s board with half again the crowd |
| `asym` | 13×13 | **5 / 3 / 1** units | 6 meals | the first board where team 0 is not level at turn 1 |
| `potion-rich` | 13×13 | 3+3+2 units | 5 meals, **8 potions**, refill 2 | the potion member's "until the game changes" |
| `long` | 11×11 (`mixed`) | `mixed`'s | `mixed`'s | the same games, run to **120** turns |

---

# 1. What the wide corpus says before any defect is named

**Deaths are ordered by crowd, not by size.** Mirror arm, deaths/100:
`sparse` 0.000 · `sparse-lean` 0.127 · `mixed` 0.655 · `potions` 0.660 ·
`potion-rich` 0.735 · `long` 0.759 · `snakes` 0.796 · `asym` 0.818 ·
`wide` 1.073 · `dense` **1.745**. Twelve units on `mixed`'s 121 cells kill at
2.7× `mixed`'s rate; the same twelve on 225 cells, a LOWER density, at 1.6×.

**One class crashes and no other class crashes at all.** `long` — the only
class that plays past turn 100 — throws `BoundsInversionError` in **9 of its 20
games**. The other 180 games, both arms, nine classes: `crashed: null`.

---

# 2. NEW defect classes

Ranked by (deaths × frequency × cheapness).

## W1 — the turn cap has never fired, and the first time it does the bracket inverts and the game dies

**Rank 1. It is the only defect in the corpus that ENDS a game, it fires on
nearly half of them, and it is a soundness class, not a play class.**

`long` is `mixed` run to 120 turns. Nine of its twenty games die:

| game | turn | thrown |
|---|---|---|
| `long` 3 mirror | 101 | `inverted ScoreBounds [-912.7693604376012, -Infinity]: bank floor=B0 ceiling=B2` |
| `long` 9 material-only | 102 | `[-421.78337444373807, -Infinity]` floor=B0 ceiling=B2 |
| `long` 2 mirror | 103 | `[-784.5224134774317, -Infinity]` floor=B0 ceiling=B2 |
| `long` 6 mirror | 103 | `[-813.1229054950732, -Infinity]` floor=B0 ceiling=B2 |
| `long` 1 material-only | 104 | `[-620, -Infinity]` floor=B0 ceiling=B2 |
| `long` 9 mirror | 105 | `[-985.913975672663, -Infinity]` floor=B0 **ceiling=B1** |
| `long` 7 mirror | 110 | `[-582.8262142403053, -Infinity]` floor=B0 ceiling=B2 |
| `long` 5 mirror | 113 | `[-261.86722059758426, -Infinity]` floor=B0 ceiling=B2 |
| `long` 3 material-only | 120 | `[-580, -Infinity]` floor=B0 ceiling=B2 |

Every crash turn is ≥ 101. Every ceiling is exactly −∞. Every floor is B0, and
every ceiling is a rung that FIXES enemy replies — B2 eight times, B1 once.
Nothing before turn 101 crashes anywhere; the other 180 games of the corpus
record `crashed: null`.

### Reproduction

    npx tsc -p .
    node dist/tests/local-game.js long 120 3 --nodes --opponent=material-only
    # ... turn 120: inverted ScoreBounds [-580, -Infinity]: bank floor=B0 ceiling=B2

### Mechanic, member and line

101 is not a coincidence: it is the first turn after the engine's default limit.

    src/tests/local-game.ts:415  buildBoard() returns a Board with NO maxTurns
    src/logic/turn-oracle.ts:420 maxTurns: resolveMaxTurns(board.maxTurns)
    engine/adjudicate.ts:70      resolveMaxTurns(undefined) === DEFAULT_MAX_TURNS === 100

So the bot's cap is 100 whatever the scenario declares and whatever the runner
plays to, and `capVerdicts` (`src/lobster/evaluate/terminal.ts:99`) gates on it:

    const limit = ctx.sub.marshalled.maxTurns;
    if (limit === null || ctx.sub.arrivalTurn < limit) return NO_CAP;

**Every arm ever recorded before this corpus ran to 30 or 60 turns, so
`arrivalTurn < 100` held on every evaluation of every leaf of all 26 games of
audits 1 and 2. `model/terminal@1` — the boundary member, built and reasoned
about at length in a file of its own — has never once fired on a measured
board.** `long` is the first class that reaches it.

What happens when it does fire is that it fires on SOME rungs and not others.
The member reads the settlement's own `OutcomeBracket` and refuses to read it
unless turn-limit is the one reachable ending:

    if (bracket.possibleKinds.length !== 1 || bracket.possibleKinds[0] !== 'turn-limit')
      return NO_CAP;                                    // terminal.ts:124

B0 holds every uncontrolled unit (`bank.ts:620-627`), so an elimination branch
stays reachable in its settlement, `possibleKinds` is not the singleton, the cap
is NOT read, and B0's floor is the INTERIOR fold — a finite heuristic number,
−620. B1 and B2 fix enemy replies (`bank.ts:660-724`), turn-limit becomes the
only reachable ending, the cap IS read, `us ∉ possibleWinners` gives
`best = 'loss'`, and `finish` (`evaluate/index.ts:355-366`) replaces the whole
interval with the lattice bottom: the leaf is [DEAD, DEAD]. That is exactly the
pattern in the table — floor always B0, ceiling always a reply-fixing rung.

The bank then assembles a floor from one member and a ceiling from another —
"each bound its own game" — and its one escape hatch is gated on completeness:

    if (best < floorPick.bounds.worst && !floorPick.report.complete) {  // bank.ts:757

B0's report is `complete: true`, unconditionally (`bank.ts:626`). So the guard
is skipped, `makeScoreBounds` sees worst = −620 > best = −∞ and throws.

**The floor is the unsound one.** Past the cap the game HAS ended; its value is
the cap's verdict, and a finite interior score is not a bound on it at all. B0
is "the floor of last resort" and it is the one rung whose settlement can never
satisfy the singleton test — so the member that is always present is exactly the
member the boundary rule can never reach.

### One parameterised rule

**`CAP_RUNG_FLOOR(κ)` — the cap's verdict is read on every rung, at a
conservatism dose κ ∈ {0, 1, 2}.**

    κ = 0  today: read the bracket only when `possibleKinds` is exactly
           ['turn-limit'].
    κ = 1  when the board is at or past the limit and turn-limit is one of the
           reachable endings, read the LOSS half only: `us ∉ possibleWinners`
           ⇒ hi = DEAD, on every rung including B0. A floor may only fall.
    κ = 2  κ = 1, and additionally `us ∈ certainWinners ∧ |possibleWinners| = 1`
           ⇒ lo = WIN on every rung.

κ = 1 is the minimal dose that removes the inversion: it cannot raise a floor,
so it cannot introduce one, and it makes B0's floor fall to DEAD in exactly the
worlds where a reply-fixing rung already proves the loss. κ = 2 is the symmetric
half and must be swept separately, because a WIN floor is the direction that CAN
invert against an unrelated ceiling.

Independently and not as a dose: `buildBoard` should put the spec's `maxTurns`
on the board it builds, so the bot's cap is the game's cap. That is a one-line
change in a part of `local-game.ts` two other workers also edit and it belongs
to whoever owns `buildBoard` — and note that it makes the member fire on EVERY
class (all five old scenarios declare `maxTurns: 100` and are played to 60), so
it must not land before κ.

### Counter

`crashed` is already in the JSON summary and already the table's `crashed`
column — no new instrument was needed to find this, only a class that plays
long enough. Beside it, count per decision: `capFired` (the member returned
something other than `none`) and `capFiredByRung`, which is what turns the
pattern in the crash table into a measurement.

### Per-class prediction

`long` at κ = 1: **crashes 9 → 0**, and no counter on any other class moves at
all, because `capVerdicts` returns `NO_CAP` before it reads anything on every
board under turn 100 and the other nine classes stop at 60. `ab-compare` must be
byte-identical on `snakes`, `mixed`, `sparse`, `sparse-lean`, `potions`, `wide`,
`dense`, `asym` and `potion-rich`; `long` may differ only after turn 100. If any
class other than `long` moves, κ = 1 has been implemented wrong.

### STATUS — CLOSED by `docs/design/TERMINAL-SOUND.md`; `CAP_RUNG_FLOOR(κ)` is not needed

W1 is a soundness defect and it has been fixed as one, so the dose ladder above
never has to be swept. The gate this section quotes —
`possibleKinds.length !== 1 || possibleKinds[0] !== 'turn-limit'` — is gone from
`terminal.ts`; what replaced it is not κ = 1's "read the loss half on every
rung" but the predicate the rule was always about: `ended(kinds)`, i.e. *no
world this settlement admits leaves the game running*. Past the cap `adjudicate`
cannot return `continues` at all (`decide` emits it only when `reachedTurnLimit`
is false), so `ended` holds on **every** rung including B0 — the rung κ was
invented to reach — and it holds for the reason κ = 1 only asserted. Both
corners are then read as BOUNDS off the bracket rather than as a verdict per
winners list, and `clampTo`/`meetClamps` replace only the ends a member spoke
for and widen on disagreement, so the assembly this section blames — a finite
B0 floor standing above a −∞ B2 ceiling — cannot be built by any path through
`finish`. κ = 2's warning ("a WIN floor is the direction that CAN invert") is
answered by construction rather than by a sweep: `'win'` as a floor forces
`possibleWinners = {us}`, which forces `'win'` as the ceiling too.

Measured on the merged head (`87e8e87`), 120 turns, `--nodes`, seeds 1–10,
mirror and `--opponent=material-only` — the same twenty arms as the table above:

| gate | W1's measurement | merged head |
|---|---|---|
| `long` games with `crashed != null` | 9 / 20 | **0 / 20** |
| `INVERSION` lines, `long 3 --opponent=material-only` | crashed T120 | **0**, exit 0 |
| `INVERSION` lines, `long 9` mirror | crashed T105 | **0**, exit 0 |

The second half of W1 — `buildBoard` putting the spec's `maxTurns` on the board
— also landed (TERMINAL-SOUND §4), and the ordering warning ("it must not land
before κ") was honoured: the corner repair and the algebra shipped in the same
commit as the cap statement, which is why the class that this section predicted
would crash on *every* board instead crashes on none.

What W1's counter proposal still buys, and is NOT closed: `capFired` /
`capFiredByRung` per decision. The member's reach is currently inferred from
byte-identical arms rather than counted, which is enough to bound it and not
enough to attribute a behaviour change to it. That is a runner instrument and
belongs to whoever owns `local-game.ts`.

## W2 — `contest` prices the cell an enemy STANDS on and not the edge it CROSSES, and a slider's path is all edge

**Rank 2. Twenty-eight deaths, on seven classes, of a cause audit 2 recorded as
closed: "edge deaths are gone: 3 → 0, and 0 in all 57 deaths of this corpus."**

`edge` is the in-flight exchange: two units crossing the same edge in opposite
directions inside one sub-step (`engine/turnEngine.ts:378-394`,
`shared/types/Game.ts:211`). D1's floor repair closed it on the old five at
seeds 1–3. On the wide corpus it is back, and it is a function of traffic:

| class | edge deaths (mirror + material-only) |
|---|---|
| `dense` | **8** (4 + 4) |
| `potions` | **7** (0 + 7) |
| `asym` | 5 (2 + 3) |
| `wide` | 4 (1 + 3) |
| `potion-rich` | 2 (0 + 2) |
| `mixed` | 1 (0 + 1) |
| `long` | 1 (0 + 1) |
| `snakes`, `sparse`, `sparse-lean` | **0** |

Zero on the three classes with no sliders at all; one apiece on the two 11×11
eight-unit classes, both on the material-only arm and both outside the seeds
1–3 the audits read; and twenty-four of the twenty-eight on the four classes
that add a team, a board or a potion stream.

### Reproduction

    node dist/tests/local-game.js dense 60 1 --nodes
    # turn 3:
    #   T  3 blue-B  queen hp100 (9,5)->(6,5)   top3: (5,5)=-153.35|-56.30 ...
    #   T  3 green-C pawn  hp100 (8,5)->(9,5) PARKED [seed]
    #                       top3: (8,5)=-166.44|-57.73 (8,4)=-166.44|-57.73 (8,6)=-166.45|-57.73
    #   ENEMY-CELL green-C -> blue-B's square  LOST
    #   DEATH green-C (edge)  body was (8,5)

Played: green-C the pawn steps east into (9,5), the cell the queen is standing
on and about to leave. Wanted: any of the three cells that are not on the
queen's line. The queen slides (9,5) → (6,5) THROUGH (8,5), green-C's own cell,
so the two cross the edge (8,5)–(9,5) in opposite directions and the pawn loses
the exchange to a queen.

It is not one seed: `dense` mirror seeds 1, 3 and 4 all kill `green-C` at **the
same cell (8,5)**, and `dense` material-only seed 2 kills it at (8,7).

### Mechanic, member and line

`winsContest`/`contestFeature` (`src/lobster/evaluate/contest.ts`) price
ARRIVALS: for a candidate arrival cell, who else can arrive there and who wins.
D1's repair (`settlesOn`) added the case where an enemy is STANDING on the
arrival cell and does not move. Neither reading covers the third case: the enemy
is standing on the arrival cell, DOES move, and its path crosses back through
our origin. The engine settles that as `edge` and it is fatal; the fold sees an
arrival cell whose occupant is leaving and prices it as free.

The evidence that the fold does not see it is in the trace: green-C's three
candidates are tied to the printed precision (−166.44 / −166.44 / −166.45), so
the fatal option and the two safe ones score the same. The D1 instrument already
records the event — `ENEMY-CELL green-C -> blue-B's square LOST` — so the corpus
counts it without a new probe: `enemyOccupiedEntriesLost` is 17 on `dense`
mirror and 30 on `dense` material-only, against 11 and 19 on `mixed` and 0 on
`snakes` mirror.

Why the old five hid it: an edge exchange needs a unit crossing a cell another
unit is leaving on the same sub-step, which needs traffic. `mixed` has ONE
slider and eight units on 121 cells; `dense` has one slider and twelve units on
the same 121 cells with FOUR teams, and `wide` gives its slider a 15-cell line
to cross. `sparse` has no pieces and no edge death on any arm of any corpus.

### One parameterised rule

**`EDGE_EXCHANGE(λ)` — an arrival cell occupied by an enemy that can leave
through OUR origin is priced as a contest at that enemy's weight, discounted by
λ ∈ {0, ½, 1}.**

For a candidate arrival `a` of our unit at origin `o`: for each enemy `e`
standing on `a`, if `o` is on any of `e`'s legal exit paths, charge
`λ · CONTEST_LOSS(e, us)` in `lo` — the same charge `contest` already computes
for a shared arrival, on the same scale, through the same `winsContest`. λ = 1
prices the crossing exactly as an arrival contest; λ = ½ prices it as half,
which is the dose to try first because the enemy has other exits; λ = 0 is
today. `lo` only, never `hi`: the crossing may not happen, so it is a
worst-world charge and not a certainty.

This is NOT `contest σ`, refuted in `WEIGHT-SWEEP.md` ("the addend is a boolean
so every dose decides the floor ties the same way"): σ dosed a charge already
being made on cells already being priced. λ prices a cell that is priced at
ZERO today, so at λ > 0 it changes WHICH cells are charged, not by how much.

### Counter

`enemyOccupiedEntriesLost` exists and is per class in the table. Add the
denominator the rule needs: `crossableEntries` — arrivals onto a cell an enemy
occupies where our origin lies on that enemy's exit path — and
`crossableEntriesLost`. The rule is worth taking only if
`crossableEntriesLost / crossableEntries` is high and
`crossableEntries / enemyOccupiedEntries` is low: only if it refuses few entries
and those few are the fatal ones.

### Per-class prediction

At λ = ½: `dense` edge deaths **8 → ≤ 2** and `dense` mirror total deaths
78 → ≤ 74; `potions` material-only edge 7 → ≤ 2; `asym` 5 → ≤ 2; `wide` 4 → ≤ 1.
`snakes`, `sparse` and `sparse-lean` **byte-identical** — no sliders, no edge
deaths, nothing to charge. `mixed` and `long` may move by at most one death
each. Deaths must not rise on any class; `dense` is where the budget is.

## W3 — a team's LAST unit floors every candidate at DEAD, so the floor orders nothing and the tie-break decides

**Rank 3. It is why `asym` exists, and it is the answer to "does asymmetry break
the material floor?" — the floor holds for the BIG team and collapses for the
small one.**

`asym` fields five units, three and one. Team `green` — the lone snake — is
eliminated in **16 of 20 games**, on both arms, and every one of its deaths is a
`contest`. Team `red` (ours, five units) ends the ten mirror games standing
with 5, 4, 4, 4, 4, 4, 4, 3, 5 and 5 of its five, while `blue` ends with 0, 1,
1, 2, 1, 1, 2, 1, 1 and 1 of its three: **the material floor holds where there
is material to floor.**

The counter, over every mirror arm in the corpus, bucketed by how many units the
DECIDING unit's own team still has alive that turn:

| living units on own team | unit-turns | all candidates floor at DEAD |
|---|---|---|
| 1 | 3752 | **5.12%** |
| 2 | 18335 | 0.03% |
| 3 | 12033 | 0.00% |
| 4 | 3736 | 0.00% |
| 5 | 1955 | 0.00% |

A 170-fold step from two units to one, and flat everywhere above it.

### Reproduction

    node dist/tests/local-game.js asym 60 3 --nodes
    # T  8 green-A snake hp 94 (7,1)->(7,0) [seed]
    #     top3: (7,0)=-Infinity|-98.61 (8,1)!=-Infinity|-99.22 (6,1)=-Infinity|-102.13
    #   DEATH green-A (contest)  body was (7,1)(8,1)(8,2)(9,2)

Played: (7,0), and green is eliminated. Wanted: the option whose worst case is
survivable — and there may not be one, which is precisely the point: **all three
candidates read `lo = -Infinity`, so the floor is uniformly the lattice bottom
and cannot order them.** `[seed]` says what actually decided: the tie-break kept
the seed plan.

### Mechanic, member and line

The cliff is correct and is defended in `bound.ts`'s own header — "a feature
representing a catastrophe scores 'might die' in `lo` EXACTLY as it scores
'dies', because the worst case of might-die IS die". For OUR unit
(`features.ts:245-246`, `standingOf`):

    worstAlive: !claim.certainlyGone && (!mine || !contested)

so any of our units that is merely CONTESTED is dead in the worst world;
`eliminated` (`features.ts:1141-1156`) counts standing units of the team, so a
team of one that is contested has `subjectGone` in the worst world; and `finish`
(`evaluate/index.ts:346`) replaces `lo` with DEAD.

Each step is right. The composition is degenerate: on a team of one, EVERY
candidate any enemy can contest floors at DEAD, the floor ties across the whole
candidate set, and the decision falls through to a tie-break that by contract
does not adjudicate — `bound.ts` states it twice, "`est` NEVER ADJUDICATES...
`est` orders moves among floor ties". The cliff is information only while some
candidate is off it. On a last unit it is on every candidate at once, and the
bot then plays the seed plan into a contest it loses.

Note what the trace also shows: the CEILINGS do separate (−98.61 / −99.22 /
−102.13) and they rank the fatal cell FIRST, so "order by `hi` when the floor
ties" is not the repair — it picks the same cell here.

### One parameterised rule

**`CLIFF_DEPTH(δ)` — when every candidate floors at DEAD, order them by how much
of the enemy's cooperation the death needs, at depth δ ∈ {0, 1, 2}.**

δ = 0 is today. At δ ≥ 1, and ONLY on the decisions where the floor is uniformly
DEAD (5.12% of a last unit's turns, 0.03% of everyone else's, so it costs
nothing anywhere else), compute for each candidate the count of distinct enemy
joint replies in the bank's already-enumerated B1 lists that kill us, and prefer
the candidate fewest replies kill; δ = 2 breaks the remaining ties by the weight
of the lightest enemy that must commit. This is a SECONDARY ORDER on a tied
floor, not a change to the floor: no `lo` moves, so no bound is weakened, and
B1's option lists are already built and paid for at this node.

It is deliberately not a graded death penalty. That is the one thing `bound.ts`
forbids — "a large finite death penalty inverts the cliff the moment some other
term outgrows it" — and D2's dose sweep already refused a repair that "unparks
the pawn by killing it". Ordering ties is the only move free of both.

### Counter

`uniformCliffTurns` (unit-turns where every candidate's `lo` is DEAD) and
`deathsAfterUniformCliff`, both bucketed by the deciding team's living-unit
count — the table above, promoted from a trace scrape to a counter in
`GameMetrics`. Add `lastUnitTeamTurns` as the denominator so the rate is
readable on `asym` without dividing by the whole board.

### Per-class prediction

At δ = 1: on `asym`, `green`'s eliminations **16/20 → ≤ 11/20** and `asym`
mirror deaths 34 → ≤ 31; on `dense`, whichever team is reduced first survives
longer and `dense` mirror deaths 78 → ≤ 75. `sparse`, `sparse-lean` and
`snakes` byte-identical (0.00% uniform-cliff turns above one unit, and no team
on `sparse` ever reaches one). `mixed`, `potions`, `potion-rich`, `wide` and
`long` move by at most one or two deaths, because their uniform-cliff share is
≤ 0.3% of unit-turns. If a class with no last-unit turns moves at all, δ is
firing where the floor was not uniform.

---

# 3. What the new shapes reveal that the old five hid

## 3.1 Does the bot scale to 15×15? Its JUDGEMENT does; its BUDGET does not

`wide` is 225 cells against `mixed`'s 121, with twelve units against eight — 86%
more room and a crowd 50% larger, so LESS crowded per cell.

The judgement holds. The share of unit-turns whose top two candidates score
identically to the printed precision — audit 2's own discrimination measure — is
**7.2% on `wide` against 7.5% on `mixed`** (mirror arms; `dense` 5.2%,
`potion-rich` 11.0%, `snakes` 2.2%). The fold separates candidates on a 15×15
board at least as well as on an 11×11 one, and "the members are flood fills and
the board grew" is not what happens.

The budget does not hold. The bank's completed bounded evaluations per unit-turn,
at the same fixed 550-node budget:

| class | board | bank occasions per unit-turn | mean reply product P |
|---|---|---|---|
| `snakes` | 11×11, 6 snakes | **561** | 5.3 |
| `sparse-lean` | 13×13, 4 snakes | 478 | 4.6 |
| `sparse` | 13×13, 4 snakes | 442 | 4.6 |
| `long` | 11×11, 8 units | 276 | 23.8 |
| `dense` | 11×11, **12 units** | 249 | **90.0** |
| `potions` | 11×11, 8 units | 202 | 24.8 |
| `mixed` | 11×11, 8 units | 191 | 24.5 |
| `asym` | 13×13, 9 units | 189 | 55.6 |
| `potion-rich` | 13×13, 8 units | 188 | 21.8 |
| `wide` | **15×15, 12 units** | **104** | 26.1 |

`wide` gets 54% of `mixed`'s deliberation per unit-turn and 19% of `snakes`'.
The outcomes move the other way: deaths/100 `mixed` 0.655 → `wide` 1.073
(+64%), meals/100 18.45 → 15.82 (−14%), and the share of decisions that keep the
seed plan rises 44.14% → 52.79%. The bot on a big board is not confused; it is
under-resourced and inert, and `DEFAULT_NODE_BUDGET = 550` is a constant
calibrated on 121 cells.

That is a budget question, not a member question, and it belongs to whoever owns
budget allocation. What this corpus adds is the number to allocate against — the
`wide` row above — and the fact that the fold's DISCRIMINATION is not the thing
that degrades.

## 3.2 Does asymmetry break the material floor? No — it breaks the SMALL team

`asym` fields 5 / 3 / 1, and it is the first board in the project's history on
which team 0 is not level on material at turn 1.

**The floor holds for the big team.** `red` fields 56% of the units and takes
**24%** of the mirror arm's deaths (8 of 34) and **8%** of the material-only
arm's (3 of 37); it ends every mirror game with at least three of its five, and
with four or five in nine of ten. `asym` is a mid-table class for deaths
(0.818/100, between `snakes` and `wide`) despite carrying the corpus's most
lopsided board.

**It collapses for the team of one** — W3 above. `green`, one snake, is
eliminated in 16 of 20 games, always by contest. The asymmetry does not break
the floor; it exposes that the floor was only ever informative while a team had
a second unit to lose.

Two corollaries the symmetric corpus could not state:

* `material` is the heaviest weight in the table (10) and the whole behaviour
  programme measured it on boards where both sides always had the same amount of
  it. Every A/B in `docs/design/ab/` is therefore blind to what that weight does
  when the sides differ, and `asym` is the first arm that is not.
* The DEAD clamp is the only member whose value depends on how many units a team
  has left, and it is a step function with its step at one. Nothing else in the
  fold reads team size at all.

## 3.3 What sixty turns hid

`long` is `mixed` at 120 turns and nothing else, so its first sixty turns are
byte-identical to `mixed`'s and every difference is the second sixty. Paired on
the same ten seeds (`wide-corpus.js pair mixed:mirror long:mirror`):

    counters.survivors            5.400 -> 3.400   (-2.000,  0/10 up, p = 0.002)
    counters.unitTurns          396.700 -> 606.400 (+209.7, 10/0 up, p = 0.002)
    rates.mealsPer100            18.522 -> 20.086  (+1.565,  9/1 up, p = 0.022)
    rates.entrappedUnitTurnsPer100 38.531 -> 34.694 (0/10 up, p = 0.002)
    deaths.contest                   23 -> 33      (7/0 up,  p = 0.016)
    deaths.self                       1 -> 6       (5/0 up,  p = 0.063)

The second sixty turns costs 2.0 units per game and multiplies `self` deaths by
six. `self` is a snake entering its own body, and a snake only has a body worth
entering after ten or more meals, which takes more than sixty turns at `mixed`'s
food density. **D3 — "`room`'s fear falls as the snake grows, at equal absolute
shortfall" — predicted exactly this, and the corpus has never run long enough to
see it.** It is D3's consequence, not a new class, and it is recorded here as
D3's first measured cost: 6 deaths in 10 games, all after turn 60, on a board
where the same bot at 60 turns loses one.

The other thing sixty turns hid is W1: the boundary member has never fired.

---

# 4. Known classes, larger — no new rule proposed

* **P1 (the boxed pawn).** Alive, and the new shapes give it more wall. Every
  park of 8+ turns in the corpus is a pawn or a knight against a wall or in a
  corner: `potions` mirror seed 8 `blue-C` holds (0,10) for **44 consecutive
  turns** — exactly audit 2's record, reproduced at a seed audit 2 never ran —
  `long` mirror seed 7 `blue-C` holds (0,10) for 41, `wide` material-only seed 6
  `blue-C` holds (0,14) for 38, `asym` mirror seed 4 `red-B` holds (12,12) for
  32. P1's repair was refused on the measured ground that it "unparks the pawn
  and the pawn is then killed in the open"; nothing here changes that verdict
  and nothing here re-derives it. What is new is §2 of `WIDE-BASELINE.md`: the
  parked share roughly DOUBLES against a material-only field on 7 of 7 classes
  that park at all (p = 0.016 over classes, p = 0.002 within `potions` and
  `long`) — P1 driven by the opponent rather than by the board.
* **D5 / P4 (`room` saturates, and the instrument with it).** The wide corpus
  prices the saturation: entrapped unit-turns rise monotonically with board area
  at a fixed roster shape — `mixed` 38.64% → `asym` 45.49% → `dense` 45.34% →
  `wide` **51.81%** — and `escaped` is **0** on all five of those classes while
  `snakes` escapes 150 of 190. The instrument is unreadable on every new class,
  exactly as D5 says it is on `mixed`.
* **The potion member.** `potion-shape.md`'s "leave it alone until the game
  changes" is answered in `WIDE-BASELINE.md` §3: the game changed and the member
  held — twice the potions on twice the board raises pickups 40 → 67 while the
  reckless share FALLS 72.5% → 56.7%. No new potion rule is proposed, and the
  standing rule stands with one more class behind it.
* **D2 / P2 / P3, contest σ, class A.** Untouched, and nothing above is any of
  them: W1 is a boundary member that has never run, W2 charges cells charged at
  zero today, W3 is a secondary order on an already-tied floor.

---

# 5. What this audit does not claim

* Ten seeds is the first slice on which a per-class sign test can reach
  significance at all, and most per-class tests still do not (see the p column
  in `WIDE-BASELINE.md` §2). The three classes above rest on counts that do not
  need one: 9 crashes of 20 in one class and 0 of 180 elsewhere; 28 edge deaths
  on seven classes and 0 on the three with no sliders; a 170-fold step in the
  uniform-cliff rate between two living units and one.
* No rule here is built or measured. W1, W2 and W3 are three parameterised rules
  with pre-registered per-class predictions and the counters that would settle
  them, in the form `DECISIONS.md` requires — "a refuted rule earns a paragraph
  beside the code, not a scaffold", so none of the three gets a scaffold until
  somebody takes it.
* W1's second half — putting the spec's `maxTurns` on the board `buildBoard`
  returns — is a one-line change in a part of `local-game.ts` this branch does
  not own, and it is deliberately NOT made here: it would make the boundary
  member fire on all ten classes at once, and the inversion it fires into is
  W1's whole point.
* The recorder takes seeds 1–20 unchanged (`scripts/wide-corpus.sh
  docs/design/wide 20 1`, resumable, skipping what is already recorded). This
  audit reads 1–10; a deeper slice can only narrow the intervals above.
