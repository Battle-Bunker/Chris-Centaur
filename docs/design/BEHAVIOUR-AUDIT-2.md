# Behaviour audit 2 — the same 26 games, re-read at `48b4735`

A second read of what the bot DOES, on the corpus `BEHAVIOUR-AUDIT.md` used, so
the two are one measurement and not two. Nothing here re-derives D2, D3 or D4 from
their predictions — where a class touches one it starts from the refutation.

## Method and corpus

`npx tsc -p .` clean at `48b4735`. Every run is
`node dist/tests/local-game.js <scenario> 60 <seed> --nodes --json=F` — the
deterministic work-unit clock, so every number is a function of (build, scenario,
seed). `crashed: null` in all 26. Nineteen-arm inversion gate
(`CENTAUR_DEBUG_INVERSION=1`, five scenarios × seeds 1–3 at 30 turns plus `potions`
4, 5, 6, 8 at 60): **no `INVERSION` line on any arm**.

| corpus | runs | unit-turns | meals/100 | deaths (by cause) | reversals | parked |
|---|---|---|---|---|---|---|
| `mixed` 1–3 | 3 | 1295 | 17.84 | 6 — contest 3, bodyBlock 2, self 1 | 1.70% | 9.9% |
| `snakes` 1–3 | 3 | 967 | 16.24 | 7 — bodyBlock 4, self 3 | 0.10% | 0.0% |
| `sparse` 1–3 | 3 | 720 | 7.22 | **0** | 0.00% | 0.0% |
| `sparse-lean` 1–3 | 3 | 720 | 6.25 (38/45 grown) | **0** | 0.00% | 0.0% |
| `potions` 1–8 | 8 | 3124 | 19.43 | 21 — contest 18, bodyBlock 2, self 1 | 1.18% | 10.8% |
| `mixed`/`snakes` 1–3 vs `material-only` | 6 | 1920 | 14.53 | 23 board-wide, **5 ours** | 1.25% | 8.9% |

---

# 1. What moved since audit 1, per class, and why

| class | audit 1 | audit 2 | verdict |
|---|---|---|---|
| `mixed` 1–3 | 1258 ut, 19.56 meals/100, 10 deaths (contest 7, **edge 2**, bodyBlock 1), parked 7.2%, `lost` 5 | 1295 ut, **17.84** (−8.8%), **6** deaths (contest 3, bodyBlock 2, self 1), **edge 0**, parked 9.9%, `lost` 2 | deaths down 40%, tempo paid for it |
| `potions` 1–8 | 3044 ut, 19.66, 26 deaths (contest 24, **edge 1**, bodyBlock 1), parked 10.4%, `lost` 4, longestPark 20 | 3124 ut, **19.43** (−1.2%), **21** deaths (contest 18, bodyBlock 2, self 1), **edge 0**, parked 10.8%, `lost` 4, longestPark **44** | deaths down 19%, parks worse |
| `snakes` 1–3 | 967 ut, 16.19, 7 deaths, 56 episodes / 45 escaped / 7 fatal | **identical on every counter** | untouched |
| `sparse` 1–3 | 720 ut, 7.22, 0 deaths | **identical on every counter** | untouched |
| `sparse-lean` 1–3 | 720 ut, 45 meals / 38 grown, 0 deaths | **identical on every counter** | untouched |
| material-only 1–3 | 1928 ut, 14.2, 23 deaths, parked 9.1% | 1920 ut, 14.53, 23 deaths, parked 8.9% | flat; **5 of the 23 are ours** |
| `potions` pickups | 39 picked, 23 reckless (**59.0%**), 8 profitable-and-safe (20.5%) | 35 picked, 25 reckless (**71.4%**), 7 (20.0%) | **worse** |

**`edge` deaths are gone: 3 → 0, and 0 in all 57 deaths of this corpus.** That is
D1's floor repair (`897b5af`/`131cb89`, `contest.ts::settlesOn`) holding on ground
its own A/B never covered — `potions` 4–8 and both material-only arms.
`enemyOccupiedEntriesLost` on `mixed` fell 5 → 2 with it.

**Everything else that moved on `mixed`/`potions` and nowhere else is the
sibling-peril fix** (`1c27c64`, REVIEW-1 finding 1: `withModelled` handed a sibling
its parent's memoised `perilCache`). Its own note predicted this exact signature —
"`mixed` and `potions` counters both change; `snakes` and `sparse` do not" — and
the byte-identity of `snakes`, `sparse` and `sparse-lean` confirms it. The deltas
exceed what D1's repair alone recorded (`potions` 3052 ut / 24 deaths in that A/B,
3124 / 21 here), so the residual is that fix. The horizon-key fix (`1380107`) is
latent at `depthMax = 1`; the outcome bracket (`f8fcfde`) and bank leaf production
(`6ace1ab`) each recorded "no decision moved", and three byte-identical board
classes agree.

**What it cost.** `mixed` meals/100 19.56 → 17.84 — nearly twice the −4.1% D1's
repair was taken over — with the parked share 7.2 → 9.9%; `potions` gave back 1.2%
of meals for five fewer deaths and grew its longest park 20 → 44 turns; `mixed`
reversals rose 0.9 → 1.7% (unjustified 0.54%), an eighth of the 12% gate.

---

# 2. Defect classes, ranked by (deaths × frequency × cheapness)

## P1 — a pawn against the wall has no move that changes its cell, and the fold cannot see it

**Rank 1. Pawns are 12.5% of the corpus's unit-turns and 46% of its deaths, and
15 of those 18 deaths happen on a turn where the pawn's top two options score
IDENTICALLY.** This is D2's tie, re-read as mortality rather than tempo; D2 was
refuted on tempo and its dose table is what any repair has to beat.

| class | pawn unit-turns | pawn deaths | rate | snake/knight/queen rate | pawn parked |
|---|---|---|---|---|---|
| `mixed` 1–3 | 248 / 1295 | **4 of 6** | 1.61/100 | 0.39/100 | **35.1%** |
| `potions` 1–8 | 627 / 3124 | **11 of 21** | 1.75/100 | 0.40/100 | **45.9%** |
| `mixed` vs material-only (ours) | 66 / 391 | **3 of 4** | **4.55/100** | 0.31/100 | **59.4%** |

Pawn top-two exact-tie rate: `mixed` 28.6%, `potions` 39.4%, material-only 66.7%
(snake 4.9–6.8%, knight 10.4–11.1%, queen 2.2–4.2%).

### Reproduction A — `potions` seed 8, turn 17, blue-C

    T 16 blue-C pawn hp90 (0,10)->(0,11) [seed]  top3: (0,11)=-39.93 (0,10)=-39.93 (0,9)=-39.93
    T 17 blue-C pawn hp90 (0,10)->(-1,10) PARKED DITHER [seed]  top3: (-1,10)=-19.49 (0,10)=-19.49 (1,10)=-19.49
    T 18 blue-C pawn hp90 (0,10)->(0,10) PARKED  top3: (0,11)=-39.46 (0,10)=-39.46 (0,9)=-39.46

Played: at turn 17 the rotation to face **west**, out of the board. Wanted: the
rotation to face east or south. blue-C then held (0,10) for turns 17–60 — **44
consecutive turns, no meal, 73% of the game** — while its team lost three units.
`potions` seeds 1 and 3 run the same episode for 36 and 22 turns.

### Reproduction B — `mixed` vs `material-only` seed 2, turn 19, red-B (ours)

    T 19 red-B pawn hp97 (0,8)->(0,8) PARKED  top3: (-1,8)=-102.79 (0,8)=-102.79 (1,8)=-102.79
    DEATH red-B (contest)  body was (0,8)

Played: hold. Wanted: on any earlier turn, the rotation that puts a legal forward
step under it, so that at turn 19 it has a move off the contested cell at all. All
three of our own pawn deaths in the material-only arms are this shape — seed 1
turn 39 at (3,10), seed 2 turn 19 at (0,8), seed 3 turn 8 at (0,0) — each PARKED,
each a three-way tie to the printed precision.

### Mechanic, member and line

`moveGrammar.planUnitAction`, the pawn branch (`moveGrammar.ts:219-237`): the
forward step requires `interior`, the two side squares are `rotate` and are legal
anywhere — "the side square is pure signalling, never entered". A pawn on the
perimeter facing outward therefore has exactly three legal actions, **all of which
leave it on the same cell**.

Every member scores `Standing.cell`, and a rotation does not change it:

* `momentum.ts:114` — `if (s.cell === from) { … return IDLE_COST * … }`. A
  rotation and a hold pay the same charge; `momentum.ts:44` says so ("for a pawn
  it is the rotation").
* `features.ts:1028-1040`, `commandSum` — the only member that reads a next-turn
  front, and it intersects that front with the contested trail domain and the
  food board, both empty at the perimeter, so `c` is equal on all three.

The decision then falls through to `search/core.ts`'s salted tie key
(`core.ts:601`, `:663`) — reproducible, and arbitrary with respect to which way
the pawn ends up facing. Half the rotations point back into the wall, which is
reproduction A.

### The rule (one, parameterised, no board special case)

One new `CommandKnobs` field, folded into the same clamp as the other two:

    c = min(1, (ground·knobs.ground + meals·knobs.food + m_u·knobs.mobility) / open)

    m_u = 1  if the unit, standing where this candidate leaves it and facing the
             orientation this candidate leaves it with, has at least one legal
             action of kind `move` on the next turn
        = 0  otherwise

`m_u` is read from the grammar's own `legalActions(unit, board)` (`queries.ts:170`),
so it is masked by the perimeter, by occupancy and by the pawn-target set.
`c ∈ [0,1]` is unchanged, so the range, the cliff inequality and R2/R3 all stand.

**What the refuted attempt teaches.** D2 built this addend with `|F_u|`, the raw
front cardinality, and it got pieces killed on bodies at every dose (0 → 3 piece
body-deaths on `mixed`). The measured cause was that `Shells.extendTo`
(`shells.ts:159-197`) applies no barrier and no occupancy mask, so the term paid
a piece to sit where the widest RAW fan was — near a crowd, where the bodies are.
Both halves of this rule answer that failure and neither is a smaller dose of it:
the quantity is the grammar's own legality, so a cell a body stands on does not
count; and it is an INDICATOR, so it saturates at 1 for any unit with anywhere at
all to go and cannot be maximised by moving toward a crowd. It is also why the
knight regression cannot repeat — D2 raised `mixed` knight parking 4.56% → 8.64%
because `|F_u|` is a centrality bonus for a knight, and an indicator that reads 1
at every interior candidate cancels.

**Counter.** The indicator is flat wherever a pawn is not against a wall or fully
blocked, so it cannot break the interior ties D2 also found (`mixed` seed 2 turns
50–55 at (5,9), a 0.01 spread). And a pawn boxed into a corner is unreachable from
three sides: a term that always pays for facing inward will walk pawns off safe
corners into a queen's fan, which is a `contest` death traded for a park. If pawn
deaths do not fall on both classes, this is D2's tempo defect again and it should
be refused as D2 was.

**Counters to add.** `immobileUnitTurns` — unit-turns whose chosen action leaves
the unit with zero legal `move` actions next turn — and `deathsWhileImmobile`.

**Prediction, per class.**
* `mixed` + `potions` 1–8: pawn parked share 35.1% / 45.9% → **<15%**;
  `longestPark` 6 / 44 → **≤6 on both**; pawn deaths 4 / 11 → **≤2 / ≤6**; total
  deaths up on neither class; meals/100 down no more than 3% (17.84 / 19.43).
* `mixed` vs material-only: our three parked pawn deaths → **≤1**.
* `snakes`, `sparse`, `sparse-lean`: **byte-identical.** `commandSum` skips
  `leavesTrail` kinds at `features.ts:1021`, so a board with no piece never
  reaches the addend.

---

## P2 — the collector's exposure is a SHARE of its ground, so a wide collector dilutes its own risk

**Rank 2. 25 of 35 pickups are reckless (71.4%, up from 59.0% with no change to
the term), only 7 are profitable AND safe, and 25 of the 35 print `caught@1` —
the horizon that already carries half the term's mass.** It costs tiers and
tempo, not lives: `deathsWhileDebuffed` is 0 over all eight games.

### Reproduction — `potions` seed 4, turn 36, red-C

    T 36 red-C knight hp98 (2,6)->(0,7)  top3: (4,5)=-342.30 (0,7)=-342.34 (1,4)=-342.99
    POTION x1  tier up: red-A, red-B  tier down: red-C  [red-C hp97 enemyTier+0 caught@1 EXPOSED]

Played: the potion cell, at a 0.04 margin. Wanted: `(4,5)`, or any cell that is
not the potion. `enemyTier+0` says the level the two allies gained flips no
contest against any enemy actually on the board, and `caught@1` says the collector
is beatable on its own ground on the very next turn. red-C paid a real tier for a
nominal one, and stood in the open to do it. Seed 4 alone does this five times in
eight pickups.

### Mechanic, member and line

`window.ts::perilOf` (`window.ts:525-556`):

    num += (w * beaten) / cells.length;   den += w;      // w = window − k + 1
    return den > 0 ? num / den : 0;

The reading is `beaten / |ground_k|` — the SHARE of the collector's reachable
ground an enemy beats. Three beaten cells read 0.375 against a knight's eight-cell
ground and 0.12 against a queen's twenty-five, so the wider the collector the
cheaper its exposure looks at identical danger — yet it will stand on exactly ONE
cell, and which one is not its choice alone. `PERIL_WEIGHT = 2` (`window.ts:228`)
then multiplies a number already divided by the collector's own mobility.

### The rule

One profile knob, `PERIL_CONCAVITY = γ`, shaping the per-horizon share before it
is weighed — nothing else in the term changes:

    num += w * (beaten / cells.length) ** γ

`γ = 1` is today's term exactly, so the knob replaces a single point and nothing
else. `γ < 1` makes the reading concave in the share: a collector with three
beaten cells out of twenty-five reads 0.35 at `γ = 1/2` instead of 0.12, and a
collector with all of its ground beaten still reads 1. Default to sweep: `1/2`,
then `1/3`.

**What the refuted attempt teaches, and why this is not it.** D4 reweighted the
HORIZONS (`w_k = λ^(k−1)`) and both counters moved the wrong way: with the tail
saturated, shifting mass toward horizon 1 lowered the tail's contribution from
0.50 to 0.24, which CUT the price of every pickup, and a price cut admits exposed
ones. This rule redistributes nothing between horizons; because `share ∈ [0,1]`
and `γ < 1`, `share^γ ≥ share` at every horizon, so the price only ever rises.
That is the opposite direction to the one that failed, and it is the direction the
counter says is wanted.

**Counter.** A saturated tail reads `1^γ = 1` and is untouched, so this raises
horizon 1's contribution relatively less than the tail's — D4's diagnosis (half
the reading is a constant) is left standing and could get worse in proportion.
And a uniform price rise risks a collapse in pickups, which D4's own prediction
guarded against. `reckless` also remains an upper bound (`potions.md` §4): it is a
boolean on one beatable cell where `peril` is a share, so no γ can make the term
refuse exactly what the counter counts.

**Prediction, per class.** `potions` 1–8 at `γ = 1/2`: reckless share
71.4% → **≤50%**; profitable-and-safe 20.0% → **≥25%**; total pickups **≥20**
(not a collapse); `deathsWhileDebuffed` **stays 0**; `potions` deaths **not up**
from 21. `mixed`, `snakes`, `sparse`, `sparse-lean`: **byte-identical** —
`collectorsOf` gates the whole member and no potion exists on those boards.

### Status: BUILT, SWEPT AT BOTH γ, REFUTED, REVERTED — and the per-plan repair it prescribed is REFUTED AND REVERTED TOO (see the follow-up at the end of this section)

`docs/design/potions.md` "P2" carries the arms and the fixture. `potions`, 60
turns, seeds 1–8, `--nodes`, paired per class:

| arm | pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|---|
| BEFORE (`γ = 1`) | 35 | 15 | 25 (**71.4%**) | 7 (**20.0%**) | 0 | 21 |
| `γ = 1/2` | 31 | 11 | 22 (**71.0%**) | 6 (**19.4%**) | 0 | 22 |
| `γ = 1/3` | 24 | 12 | 16 (**66.7%**) | 5 (**20.8%**) | **2** | **30** |

Reckless ≤50% — **no**, it does not move. Profitable-and-safe ≥25% — **no**.
Pickups ≥20 — yes, but the count is the only thing that moves: the composition
is flat while the total falls a third. `deathsWhileDebuffed` 0 and deaths not up
— yes at `γ = 1/2`, **no** at `γ = 1/3`, which costs nine deaths (up on 7 of 8
seeds, p = 0.070) and brings back two `edge` deaths, the class §1 above records
as cleared. `mixed`/`snakes`/`sparse` byte-identical at both γ, as predicted.
Sixteen-arm inversion gate silent. The knob is backed out; the three source
files are a zero diff against `33c2b23` and all eight `potions` summaries come
back byte-identical to the baseline.

**Why, and it is not the level.** The prediction was sized against the wrong
margin. `perilOf` reads the collector's ground from where it STANDS as the turn
opens, not from the cell the plan sends it to — deliberately, since that is what
keeps the peril half memoisable per collector rather than per plan — so the
peril charge is IDENTICAL on every joint plan in which that collector picks the
potion up, and raising it adds the same constant to both sides of the comparison
that decides the move. At the reproduction, every red candidate on turn 36 shifts
by the same −0.16 and red-C plays `(0,7)` again on the same margin; the one
candidate whose best joint plan collects nothing, `(1,4)`, does not move at all
and is **0.65** away, sixteen times the 0.04 this rule was sized against. On
three of the eight seeds not one move changed anywhere in sixty turns. And
`s^γ` maps [0, 1] onto [0, 1], so the reading is not widened at any γ — the
range over a saturated tail is `[0.5, 1]` throughout. What the knob buys is a
level shift, which is D4 with the sign flipped, and D4's own prescription
("separate the level from the shape") is exactly what it did not do.

**What survives.** The mechanic in "Mechanic, member and line" is correct and
unrepaired: the wider the collector the cheaper identical danger reads. The
repair that is left is the one `potions.md` §1 item 3 already names as
unmeasured — read the ground from the PLAN's destination, at a claim pass per
candidate — because that is the only change that gives the term a gradient over
the collector's own options. Every scaling of the current share cannot.

### Follow-up: THAT repair was built, measured and REVERTED too — `potions.md` "P3"

The prescription immediately above was implemented as one knob
(`PLAN_PERIL_SHARE = α`; `α = 0` recovers this term exactly, `α = 1` reads the
collector's ground from the cell the plan leaves it on and from the ground
reachable from there, `k = 1` being that rule at zero further turns). It was
instrumented first, and **the instrument refuted the hypothesis before the rule
shipped**: on this same corpus a beating enemy can hold the collector's own
arrival cell on **5 of the 35 pickups**, all five already counted reckless,
while the other twenty reckless pickups are reckless through their GROUND. At
the reproduction above the trace reads `arrival=safe`.

| arm | pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|---|
| BEFORE (`α = 0`) | 35 | 15 | 25 (**71.4%**) | 7 (**20.0%**) | 0 | 21 |
| `α = 1`, PERIL_WEIGHT 2 | 49 | 17 | 34 (**69.4%**) | 7 (**14.3%**) | 0 | **25** |
| `α = 1`, PERIL_WEIGHT 3 | 25 | 7 | 20 (**80.0%**) | 3 (**12.0%**) | 0 | **25** |

Reckless share does not fall usefully, profitable-and-safe falls at both levels,
deaths rise to 25 in both arms and the first brings back two `edge` deaths.
Potion-free classes byte-identical, sixteen-arm inversion gate silent, six-suite
gate 120 passing with no ratchet moved. **Reverted.**

**And the reason corrects this section's own diagnosis of the margin.** `(0,7)`
and `(4,5)` — the top two candidates at seed 4 turn 36 — are BOTH potion cells,
so they are two collecting plans that leave the collector in different places,
which is exactly the pair a per-plan reading exists to order. It does not order
them. red-C, knight, weight 5, at the debuffed tier:

    turn-start ground   3/9   34/34   73/73   →  peril = 0.667
    from (0,7)          0/1    5/5    21/21   →  peril = 0.500
    from (4,5)          0/1    9/9    41/41   →  peril = 0.500
    from (1,4)          0/1    7/7    29/29   →  peril = 0.500

Three grounds of three sizes, one number — pinned as a fixture in
`src/lobster/__tests__/tier-window.test.ts`, written against the engine's claims
rather than against the member so it survives the revert. Conditioning the
ground on the plan collapses the one discriminating horizon to a BOOLEAN on a
single cell (false on 30 of 35 pickups) and leaves horizons 2 and 3 saturated at
1 from every arrival cell, so the per-plan peril takes two values, 0.5 and 1.0,
and is the constant 0.5 six times in seven. It is also 0.167 CHEAPER than the
reading it replaces, so it admits pickups rather than refusing them: 35 → 49, up
on 7 of 7 moving seeds, p = 0.016.

**The standing bound, general form.** `peril` is `Σ_k w_k · beaten_k / |ground_k|`
over a window whose horizons 2..W are saturated at 1 for every collector on every
plan. D4 moved `w_k`, P2 moved the share's shape, P3 moved `ground_k` — every
free part of the expression, each moving the level and none the composition,
because the saturated tail is not a parameter of any of them. The next attempt
must remove the tail or stop averaging over it (the untried `beaten_1 > 0`
floor), not reparameterise the mean a fourth time.

---

## P3 — hunger is denominated in the tank, not in meals, so a lean board is under-eaten

**Rank 3 by the ranking rule — 0 deaths in 60 turns — and rank 1 by the owner's
stated priority. It is the only defect the `sparse-lean` arm exists to find.**

Same board, same seeds, `foodEnergy: 20` instead of 100:

| seed | meals | mean energy t1–20 / t21–40 / t41–60 | ends at own minimum |
|---|---|---|---|
| `sparse` 2 | 16 | 93.5 / 90.6 / 87.1 | 0 of 4 |
| `sparse-lean` 2 | **12** | 93.5 / 88.7 / **76.2** | **3 of 4** (59, 61, 65) |

Across seeds 1–3: 45 meals against `sparse`'s 52, 6.25 per 100 unit-turns against
7.22. **The bot eats 13% LESS often on the board where each meal is worth a
fifth as much**, and on seed 2 three of four units are still falling at turn 60.

### Reproduction — `sparse-lean` seed 2, turn 48, blue-A

    T 47 blue-A snake hp72 (11,5)->(11,4)  top3: (11,4)=-38.92 (10,5)=-38.94 (12,5)=-38.98
    T 48 blue-A snake hp71 (11,4)->(10,4)  top3: (10,4)=-39.87 (12,4)=-39.88 (11,3)=-39.98
    turn 48  food: (12,0) (11,0)

Played: `(10,4)`, off the column it had been descending for four turns. Wanted:
`(11,3)`, three steps from the meal at (11,0) — which red-A, seventeen points
HEALTHIER, took three turns later. blue-A is five meals short of full on this
board and one meal short on the identical `sparse` board; the fold reads the same
appetite in both.

### Mechanic, member and line

`food.ts::pullOf` (`food.ts:158-163`):

    const cap = Math.max(1, ctx.sub.maxEnergyOf(s.kind));
    const hunger = Math.min(1, Math.max(0, 1 - energy / cap));
    return near * (HUNGER_FLOOR + (1 - HUNGER_FLOOR) * hunger);

`cap` is the TANK. A unit at 71 of 100 reads hunger 0.29 whatever a meal is worth,
but with `foodEnergy = 20` that shortfall is five meals and with 100 it is one.
The member never reads `foodEnergy`; `evaluate.test.ts` pins that deliberately
("and it does NOT read foodEnergy, because it is a distance and not a meal").

That pin is right about `near` and wrong about `hunger`. `near` is a distance and
must not scale with meal size. `hunger` is an URGENCY, and urgency is how many
meals the unit is behind, not how much tank.

### The rule

One profile knob, `HUNGER_SPAN` in meals, default 1:

    hunger = min(1, (cap - energy) / max(1, HUNGER_SPAN * foodEnergy))

`near` is untouched. On every board where `foodEnergy = DEFAULT_FOOD_ENERGY = 100
= cap` — which is `mixed`, `snakes`, `sparse`, `potions` and every scenario in the
repo but one — the denominator is `cap` and the reading is **today's, exactly**.

**What the refuted attempt teaches.** D3 replaced `fearsOf`'s denominator with a
fixed constant and it SATURATED the term: every unit past the constant read 1, a
saturated term orders nothing between a unit's options, and the deaths were what
that cost. This looks like the same move and is not, for a reason the code states
outright: `hunger` is a per-unit CONSTANT within one decision (`food.ts:145-152`
— the scale reads turn-start energy so the feature stays purely positional), and
the per-candidate ordering lives entirely in `near`, which this rule does not
touch. Saturating `hunger` raises the GAIN on the gradient; it cannot flatten the
order. D3's `short` was the ordering signal itself, which is why saturating it was
fatal there and is not here.

**Counter.** `material` already prices a meal that does not grow below one that
does (`evaluate.test.ts`, "material prices the meal that FILLS"), so eating less
on a lean board is PARTLY correct and this rule re-inflates exactly the appetite
the fill-to-grow rule tempers. `HUNGER_FLOOR`'s own calibration table records what
over-eating costs: a full snake that hunts anyway coils into a spiral and dies in
it (7 `self` deaths at floor 0.35 against 2 at 0.15). If `sparse-lean` deaths go
above 0, the rule is out on the same evidence that set `HUNGER_FLOOR`.

**Prediction, per class.**
* `sparse-lean` 1–3 at `HUNGER_SPAN = 1`: meals/100 6.25 → **≥7.22** (at least
  `sparse`'s rate); `grownMeals/meals` **stays ≥0.5** (0.84 today); deaths
  **stay 0**; seed 2's turn-41–60 mean energy 76.2 → **≥85**; no unit finishes at
  its own minimum.
* `mixed`, `snakes`, `sparse`, `potions`, both material-only arms:
  **byte-identical**, because `HUNGER_SPAN · foodEnergy = cap` there makes the new
  denominator the old one to the bit.

### STATUS: BUILT, MEASURED, REVERTED — every predicted number lands and the counter kills a snake (`beh-p3`)

The rule was implemented exactly as written: one knob `HUNGER_SPAN` in meals,
default 1, in `calibration.ts` beside the other measured numbers, with
`pullOf` (`food.ts`) dividing the shortfall by `HUNGER_SPAN · foodEnergy`
instead of by the tank. `near` untouched. `tsc`, `eslint`, the boundary tests,
`soundness`, `evaluate`, `local-game-determinism` and `law-sweep` all green on
it, and the nineteen-arm inversion gate clean ON THE P3 ARM ITSELF
(`CENTAUR_DEBUG_INVERSION=1`, the sixteen arms of audit 2's gate plus
`sparse-lean` seeds 1–3: **no `INVERSION` line on any arm**) — checked so this
revert cannot be read as a soundness failure. The bound arithmetic never
moves: `hunger` is a per-unit constant multiplying a `near` this rule does not
touch, so `lo <= hi` holds by exactly the construction it held by before.

`sparse-lean` seeds 1–3, 60 turns, `--nodes --json`, `ab-compare` per class:

| seed | meals before → after | grown | deaths | t41–60 mean energy | ends at own min |
|---|---|---|---|---|---|
| 1 | 15 → 21 | 12 → 18 | 0 → 0 | 90.6 → 91.4 | 0/4 → 0/4 |
| 2 | 12 → **17** | 10 → 13 | 0 → **1** | 75.6 → **84.6** | 3/4 → **1/4** |
| 3 | 18 → 26 | 16 → 25 | 0 → 0 | 86.1 → 94.9 | 2/4 → 1/4 |
| **1–3** | **45 → 64** | 38 → 56 | **0 → 1** | — | 5/12 → 2/12 |

**EVERY PREDICTED NUMBER LANDS.** meals/100 6.25 → **9.01**, against a
pre-registered ≥7.22 and against `sparse`'s own 7.22 — the lean board now
out-eats the rich one, which is the right direction for a board where a meal is
worth a fifth as much. `grownMeals/meals` 0.84 → **0.88**, against a
pre-registered ≥0.5. Seed 2's turn-41–60 mean energy 75.6 → 84.6, and units
finishing at their own minimum 3 of 4 → 1 of 4. The four other classes and both
material-only arms are **byte-identical on every counter of every seed** — 12 of
12 paired summaries equal field-for-field, exactly as claimed.

**AND THE RULE IS OUT ANYWAY, on the counter it was gated against.**
`sparse-lean` deaths 0 → 1. The pre-registration was unconditional — "if
`sparse-lean` deaths go above 0, the rule is out on the same evidence that set
`HUNGER_FLOOR`" — and it is not being re-argued here because the meals came in
high.

**THE MECHANISM IS `HUNGER_FLOOR`'s OWN, TRANSPOSED FROM A COIL TO A CORNER.**
seed 2, red-A, which under the old scale spent turns 44–52 crossing the open
bottom of the board and ate at (12,0), an edge cell with an exit:

    T 46 red-A snake hp84 (1,10)->(1,11)  top3: (1,11)=-47.35 (0,10)=-47.36 (2,10)=-47.45
    T 47 red-A snake hp83 (1,11)->(0,11)  top3: (0,11)=-47.30 (1,12)=-48.54 (2,11)=-89.46
    T 48 red-A snake hp82 (0,11)->(0,12)  top3: (0,12)=-38.42 (0,10)=-48.13 (-1,11)!=-89.48
      ATE red-A
      ENTRAPPED red-A kept=1/7
    T 49 red-A snake hp100 (0,12)->(1,12) top3: (1,12)=-41.04 (0,13)!=-89.01 (-1,12)!=-89.01
    T 50 red-A snake hp 99 (1,12)->(2,12) top3: (2,12)=-88.90 (1,13)!=-88.95 (0,12)!=-88.95
      DEATH red-A (bodyBlock)  body was (1,12)(0,12)(0,11)(1,11)(1,10)

It climbs the `x = 1` column for eight turns into the top-left corner after the
meal at (0,12), eats at turn 48 — 82 → 100, a full tank, so the meal GROWS it —
and is dead three turns later, walled in by the five body cells it laid on the
way in, one of which it only has because that meal grew it. At turn 48 it had
one legal option of seven, and the alternatives were already off-board.

**One line of arithmetic says why.** At hp 84 the tank scale reads hunger
`16/100 = 0.16` and a gain of `0.15 + 0.85·0.16 = 0.286`; the meal scale reads
`16/20 = 0.8` and a gain of `0.83`. **2.9× the pull**, on the same `near`, toward
a meal sitting in a two-wide dead end. That extra gain is exactly what bought the
eight-turn trip up the column, and the growth at the end of it is what sealed the
pocket. red-A was never in danger of starving — 0 starvation deaths in both arms,
and it never fell below 82 — so this is a unit that took a meal it did not need
and paid a life for it. That is `HUNGER_FLOOR`'s calibration table, in a corner
instead of a spiral.

**What survives the revert, for whoever picks this up.** The diagnosis in this
section is not withdrawn: hunger really is denominated in the wrong unit, the
lean board really is under-eaten, and saturating `hunger` really is safe where
saturating D3's `short` was not — the ordering never moved, and the 12-of-12
byte-identity off a lean board confirms the containment claim exactly. What is
refuted is that the denominator ALONE fixes it. Appetite is not the only thing
that should read `foodEnergy`: the same shortfall that makes a unit hungrier also
makes the meal at the end of a dead end worth less, and nothing on the approach
priced the pocket. A next attempt should carry the meal size into whatever
prices the ENTRY — `room`'s reading of the cell the meal sits in, or a growth
term that knows a full-tank meal lengthens the eater — and only then re-run this
gate. `HUNGER_SPAN` on its own is measured and closed.

**One implementation note worth keeping.** The rule must be written as
`(1 - energy/cap) · (cap/span)` and not as the algebraically equal
`(cap - energy)/span`. `1 - e/c` is not bit-equal to `(c - e)/c` in IEEE 754 —
they differ in the last ulp for 188 of the 476 integer energies under this repo's
kind ceilings — so the second form perturbs every non-lean board in the last
place and the byte-identity claim fails on a rounding artifact rather than on a
rule. Multiplying by a `cap/span` of exactly 1.0 is exact. The 12-of-12 result
above depends on this and on nothing else.

---

## P4 — D5 is unchanged and still makes `mixed`'s entrapment instrument unreadable

Recorded, not re-proposed. `mixed` reports 3 episodes per run, **0 escapes in 9**,
505 entrapped unit-turns of 1295 (39%), and a 42.5-turn mean lead before a fatal
entrapment — a stuck flag, not a warning. `snakes` reads 56 / 45 escaped / 7 fatal
on the same instrument and `potions` seeds 1–3 improved 24 / 15 / 4 → 32 / 24 / 3.
The mechanic and the `enemyBarTurns` knob are in `BEHAVIOUR-AUDIT.md` D5 and
`entrapment.md` §4.4; nothing here changes either, and no `mixed` reading of
`fatalEntrapments` or `escapedEntrapments` is trustworthy until it does.

---

# 3. Behaviour that is already right

1. **`edge` deaths are gone.** 0 in all 57 deaths, from 3 in audit 1 — including
   `potions` 4–8 and both material-only arms, which D1's A/B never ran.
2. **Energy starves nothing and freezes nothing.** 0 starvation, 0 exhaustion and
   0 hazard deaths in 7 553 unit-turns; `sparse` 0 deaths for the second audit
   running; `sparse-lean` 0 deaths on a board where a meal is a fifth of a tank.
3. **The bound is sound.** Zero inversions on nineteen arms.
4. **The queen is not a statue.** Mean health spent per queen-turn 0.85 (`mixed`)
   and 1.10 (`potions`) against a per-turn maximum of nine, and the queens still
   eat (blue-B twice inside three turns on `potions` seed 4).
5. **Tier bookkeeping is exact.** `potionTierUps` 98 = `potionTierDowns` 98 across
   the eight games; `deathsWhileBuffed` = `deathsWhileDebuffed` = **0** over 21
   `potions` deaths and 35 pickups.
6. **Reversals stay rare and mostly justified.** 1.70% / 1.18% / 0.10% / 0.00% on
   `mixed` / `potions` / `snakes` / `sparse` and `sparse-lean`, unjustified 0.54%
   / 0.42% / 0.00%, against a 12% gate.
7. **`room` works on a trail-only board**, byte-identically to audit 1: 56
   episodes, 45 escaped, 7 fatal.
8. **The bot beats `material-only`, and now we can say by how much.** Splitting
   deaths by team — new here — only **5 of the 23** material-only-arm deaths are
   ours (`mixed` 4, `snakes` 1). Red finishes 2/3, 2/3, 1/3 on `mixed` and 2/2,
   1/2, 2/2 on `snakes`, identical to audit 1; `snakes` seed 3 ended at turn 54
   with every opponent dead and both our snakes alive.
9. **Three board classes are byte-identical to audit 1 on every counter.** The
   contest floor repair, the peril-cache fix, the outcome bracket and the bank leaf
   production moved no decision on any board with no piece — what each of the four
   recorded, re-checked here against a different build.
10. **Fill-to-grow passes its pre-registered gate:** `sparse-lean`
    `grownMeals / foodEaten` = 38/45 = **0.84**, starvation deaths 0.

---

# 4. Not a defect

1. **`enemyOccupiedEntriesLost` in an `--opponent` arm counts the OPPONENT's
   blunders.** All ten losing entries in the material-only arms belong to blue and
   green units running `MATERIAL_ONLY_PROFILE`, and five of them are followed on
   the very next line by that unit's own `bodyBlock` death. Ours in those arms:
   **zero**. Corpus-wide ours is 6, of which exactly one killed (`mixed` seed 1,
   blue-C). The counter is a board total; read it per team or not at all.
2. **Off-board destinations that score exactly what a hold scores.** Still the
   `rotate` branch, still correct to price as a hold. What is wrong is that
   nothing prices the ORIENTATION they buy — P1.
3. **`reckless` is still an upper bound, not a body count.** 0
   `deathsWhileDebuffed` over 35 pickups and 480 turns. P2 is ranked as a tier and
   tempo loss for that reason.
4. **A snake's death-turn three-way tie is a terminal state, not indifference.**
   All 7 `snakes` deaths tie at the top, and the printed options are `-Infinity`
   or the snake's own body (`snakes` seed 2 turn 34, seed 3 turn 59). The decision
   that mattered was several turns earlier — D3's class, refuted, and its boundary
   test still pins it.
5. **`potions` seed 8 turn 31: red-C paid a tier with no ally alive to receive
   it.** Both alternatives scored `-Infinity`. Forced, not reckless.
6. **505 entrapped unit-turns on `mixed`** is instrument saturation (P4/D5), and
   **`seedKept` at about half of decisions** is the deterministic clock being
   small — the same shape is recorded at 20 ms and 150 ms in
   `BASIC-INTELLIGENCE.md`.
