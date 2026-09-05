# Class A — is there a gradient at the entry turn? Measured, named, and refused

A measurement, not a repair. Nothing is shipped; `contest.ts` and every other
source file on this branch are byte-identical to `a707e3b`, which is also the
head this was measured on (`git diff a707e3b HEAD -- src/lobster src/engine-vendor`
is empty, so the play `contest-gap.md` read is the play read here).

`contest-gap.md` §2 leaves one question open. Class A is 20 of 28 contest
deaths; at the ENTRY TURN — the last turn the unit stood outside every enemy fan
— `contestField` is silent on every offered option, and the obvious two-ply
BOOLEAN repair saturates there, so it is flat on exactly the decisions it was
proposed for. **Is there a GRADIENT that discriminates the entry-turn options
where the boolean cannot?**

The answer is: **one quantity does, at p = 0.0004, and it is still refused.** It
is refused on the arithmetic of the rung the search decides on, not on taste,
and the refusal has a shape the next attempt can use.

## 0. What was measured, and how faithfully it reproduces

Head build, 60 turns, `--nodes` (550), `mixed` seeds 1–6 and `potions` seeds
1–8. A scratch instrument (`src/tests/classa-diag.ts`, a hook in
`local-game.ts`'s `decideTeam`, both removed before this commit) recorded, per
unit-turn, every OFFERED option's settle cell with the sixteen readings of §1
taken around it, and separately priced every option of the 19 entry turns
through a `BoundBank` of its own.

The reproduction is exact where it can be checked:

| | this run | `contest-gap.md` |
|---|---|---|
| `mixed` 1–6 decider unit-turns | **2 463** | 2 463 |
| `potions` 1–3 decider unit-turns | **1 180** | 1 180 |
| head contest deaths, `mixed` 1–6 + `potions` 1–3 | **16** | 16 |
| of those, class A | **12** | 12 |
| `mixed` 1 T49 blue-C, all four options `0.000`, dies T50 at (2,3) | reproduced | §1 |
| `mixed` 6 T6 red-B (0,1), all options `0.000`, dies T7 | reproduced | §1 |

The 20 class-A deaths of `contest-gap.md` are 12 head + 8 ARM, and the arm
(head + P1's mobility indicator) is not in the tree — `calibration.ts` records
P1 as refused and the `CommandKnobs` field is gone. So the population here is
the head one, ENLARGED to the same size instead of reconstructed: `potions` 4–8
adds 7 more, giving **19 class-A entry turns on a build that exists**. Every
number below is on those 19 and on 2 966 silent unit-turns that did not die.

Corpus: 5 587 decider unit-turns, 35 deaths, **29 contest**. Entry-turn classes,
by `contest-gap.md` §1's own rule: **A 19, B 2, C 5, and 3 where the field
speaks unevenly** (the class the doc calls absent — it is not absent on
`potions` 4–8, and all 3 are `potions`). 16 of the 19 class-A units are pawns,
3 are snakes; the lead from entry to death is 1 on 13 of 19, 2 on 4, 3 on 2.

`contestField` is silent on every option of 1 953 of the 3 643 doc-subset
unit-turns (53.6 %), against the doc's 1 838 — this instrument reads the cell
the action SETTLES on, the doc's read the staged square, and a pawn's rotation
is the difference.

## 1. The entry-turn table, in one summary

Mean over the 19 fatal options against the mean over their 50 offered siblings,
and how often each reading VARIES across a unit's options — on the 19, and on
the 2 966 silent unit-turns nobody died on.

| reading | fatal | siblings | varies on 19 | varies on the 2 966 |
|---|---|---|---|---|
| `b1` — today's one-ply charge | 0.000 | 0.000 | **0** | 0.0 % |
| `press1` — D1's certainty weight `p_e(c)` | 0.000 | 0.000 | **0** | 0.0 % |
| `n1` — beating arrivals at 1 ply | 0.000 | 0.000 | **0** | 0.3 % |
| `n2` — beating arrivals at 2 plies | 1.000 | 0.880 | 2 | 14.1 % |
| `n3` — at 3 plies | 1.474 | 1.380 | 4 | 26.6 % |
| `ttb` — plies to the first beating arrival | 2.368 | 2.480 | 1 | 18.8 % |
| **`π` — two-ply pressure (§2)** | **0.231** | **0.208** | **12** | **32.8 %** |
| `pxmin` — least-pressed exit | 0.190 | 0.183 | 11 | 24.6 % |
| `pxmean` — mean pressure over the exits | 0.250 | 0.251 | 18 | 50.7 % |
| `esc1` — exits outside today's field | 1.789 | 1.820 | 17 | 65.4 % |
| `esc2` — exits no beating enemy reaches in 2 | 0.316 | 0.300 | 6 | 58.7 % |
| `dens` — fan density over `{d} ∪ exits` | 0.889 | 0.869 | 5 | 30.6 % |
| `deg` — exits from `d` | 2.211 | 2.100 | 14 | 54.2 % |
| `room` — the barred flood from `d` (`territory.ts`) | 2.526 | 2.580 | 7 | 49.8 % |
| `ttbx` — the best exit's time-to-first-arrival | 3.474 | 2.940 | 5 | 17.2 % |

**The boolean's saturation is confirmed and it is worse than stated.** The
two-ply boolean is CONSTANT across the offered options on **18 of the 19** entry
turns (saturated — every option inside some beating fan — on 17). At three
plies it is saturated on 18. **And D1's certainty weight `p_e(c)` varies on 0 of
19 and on 0.0 % of the 2 966** — the theorem `contest-gap.md` §4 states about
`1 − ε + ε·p` is not merely an argument, it is a measurement: at the entry turn
that quantity has no gradient at any `ε`, on any board in this corpus.

## 2. The one reading that discriminates: two-ply pressure `π`

    actions(e)   the enemy's own legal option list this turn — `sub.actionsOf(e)`,
                 which IS the claim's `options` before any narrowing
    land(a)      where option `a` leaves e standing (its path's last cell)
    step(c)      one more of e's own plies from c — `queries.legalTargets`

    π_e(d) = |{ a ∈ actions(e) : d ∈ step(land(a)) ∪ {land(a)} }| / |actions(e)|
    π(d)   = max over enemies e that BEAT us of π_e(d)                  ∈ [0, 1]

`π` is the two-ply boolean's own question asked with a count instead of an
existential: not *"can this enemy be on `d` in two plies"* — which is true of
every option — but ***"how much of the enemy's own freedom has to be spent to
get there"***. It is the enemy's reach CONDITIONED ON ITS OWN PLAN CELLS, which
is what `claims.ts` carries in `options` and what a boolean throws away.

It is not D1's `p_e(c)`. D1's is one ply and is a property of the ENEMY's action
count at a cell that enemy covers, so it is identical across our candidates
inside one fan — the 0/19 row above. `π` is two plies, so the same enemy's
cells now differ from one another by how many of its own moves lead to each.

**Separation on the 19.** The null is the entry turn's own option set with the
fatal choice drawn uniformly from it (exact Poisson-binomial, per-turn `p`):

| | observed | expected | p |
|---|---|---|---|
| `π` varies at all | 12 / 19 | — | — |
| `π` ranks the fatal option below some sibling | **10 / 19** | 5.1 | **0.0020** |
| `π` makes the fatal option the STRICT maximum | **8 / 19** | 2.8 | **0.0004** |

No other reading survives its own null. `esc1` is 11/19 against 8.5 expected
(p = 0.15) and fires on 65 % of the survivable turns — it is the "safe exits"
count `contest-gap.md` §3 already refuted, and this reading refutes it again on
a bigger corpus. `n3` reaches p = 0.0125 but varies on only 4 of 19. `room`,
`deg`, `esc2`, `dens`, `ttbx` are all at or below chance. `pxmean` — mean `π`
over the option's own exits — varies on 18 of 19 AND on 50.7 % of the survivable
turns and discriminates at chance (12/19 against 10.8, p = 0.37): **it is the
quantity that fires everywhere, and it is rejected exactly as the boolean was.**

`π` is not that. It is 0 on every option of **56.9 %** of the 2 966 silent
survivable unit-turns and flat across the options on 67.2 % of them — a term
aimed at a state, not a re-weighting of the board.

## 3. Why it is refused anyway

**The rule it would be.** A POINT addend inside `contest`, one knob
`σ ∈ [0, 1]`, exactly the shape `contest-gap.md` §3 argues for and for the same
reason (`π(d_u)` is a function of the staged plan and the turn-start board, so
it is the same number in every completion world and needs no bracket):

    contest += − σ · Σ_u π(d_u) / |ours|                    (lo = est = hi)

`σ = 0` is today's fold byte for byte. `costOf`'s bracket is untouched,
`settlesOn` keeps its contract, `dischargeable: true` still holds, `law-sweep`'s
`contest.lo` class stays CLOSED at 0. The span goes to `[−1−σ, 0]`, so the cliff
certificate `w_contest × span < CLIFF_MATERIAL_WEIGHT × lightest` becomes
`3(1+σ) < 10` — **σ < 2.33 is the whole admissible range**, and the σ rule now
under implementation for class B takes the same budget, so two addends of this
shape cannot both have it.

**The algebra, on the real deciding comparisons.** With `w_contest = 3` and
`|ours| = 3` the addend contributes `−σ·π(d_u)` to the aggregate, and because it
is a point it shifts the BANK's refined floor by the same amount. `better`
reads that floor first. So the σ that would flip an entry decision is the bank
floor gap divided by the `π` gap:

| case | kind | opts | cells | π fatal | π best sibling | bank-floor gap | σ needed |
|---|---|---|---|---|---|---|---|
| `mixed` 1 T49 blue-C | pawn | 4 | 2 | 0.250 | 0.200 | 40.553 | 811 |
| `mixed` 3 T18 blue-C | pawn | 3 | **1** | 0.250 | 0.250 | floor tie | — |
| `mixed` 3 T21 red-B | pawn | 4 | 2 | 0.229 | 0.200 | 0.163 | 5.62 |
| `mixed` 4 T16 red-B | pawn | 4 | 2 | 0.258 | 0.226 | 0.160 | 5.01 |
| `mixed` 4 T17 blue-C | pawn | 3 | **1** | 0.250 | 0.250 | floor tie | — |
| `mixed` 4 T44 red-A | snake | 2 | 2 | 0.258 | 0.194 | 0.015 | **0.23** |
| `mixed` 5 T10 blue-C | pawn | 4 | 2 | 0.250 | 0.250 | — | — |
| `mixed` 5 T10 red-B | pawn | 4 | 2 | 0.258 | 0.226 | 0.139 | 4.33 |
| `mixed` 6 T6 red-B | pawn | 4 | 2 | 0.244 | 0.195 | 0.162 | 3.31 |
| `potions` 1 T10 green-A | snake | 2 | 2 | 0.229 | 0.229 | floor tie | — |
| `potions` 1 T15 red-B | pawn | 5 | 3 | 0.290 | 0.258 | 10.001 | 313 |
| `potions` 3 T11 red-B | pawn | 4 | 2 | 0.258 | 0.258 | — | — |
| `potions` 4 T49 green-A | snake | 2 | 2 | 0.189 | 0.216 | π prefers the fatal | — |
| `potions` 4 T57 blue-C | pawn | 3 | **1** | 0.200 | 0.200 | floor tie | — |
| `potions` 5 T23 red-B | pawn | 4 | 2 | 0.258 | 0.226 | 0.156 | 4.88 |
| `potions` 6 T32 blue-C | pawn | 4 | 2 | 0.200 | 0.000 | 0.154 | **0.77** |
| `potions` 7 T8 blue-C | pawn | 4 | 2 | 0.000 | 0.000 | — | — |
| `potions` 7 T54 red-B | pawn | 5 | 3 | 0.290 | 0.258 | 10.190 | 318 |
| `potions` 8 T15 red-B | pawn | 4 | 2 | 0.226 | 0.258 | π prefers the fatal | — |

**At every dose the cliff certificate admits, the rule changes 2 of the 19 entry
decisions.** Seven more need `σ` between 3.3 and 5.6, which is outside it; three
need `σ > 300`, because the entry decision is being made on a meal or a capture
worth 10 or 40 and not on a tie. The gradient is real and its DYNAMIC RANGE is
wrong: the `π` margins are 0.03–0.05 against a bank-floor margin of 0.16
(median of the seven), a factor of four short before the certificate is even
consulted.

**And the anti-correlation is exact.** Cross-tab of "the bank's floors TIE at
the top" — the only rung a fold addend gets to decide — against "`π` varies":

    floor tie  &  π varies      0
    floor tie  &  π flat        4
    floor open &  π varies     12
    floor open &  π flat        3

**`π` is flat on 4 of 4 of the entry turns where the fold could decide, and
speaks on 12 of the 15 where the floor has already decided by a margin it cannot
close.** The reason is structural, not a coincidence of this corpus: the floors
tie between options that leave the unit ON THE SAME CELL, and `π` is a per-CELL
reading. **On 3 of those 4 turns EVERY offered option leaves the unit on the
same cell** — a pawn against a wall with nothing but rotations, which is
BEHAVIOUR-AUDIT-2 P1's immobility — so the entry was not chosen at all. Three of
the 19 "class A" deaths are class C in substance.

This is `08-DEPTH-VERDICT` §0's finding at member scale: *the affordability of
the reading is anti-correlated with its value.* There it was a chained ply; here
it is a two-ply reading. The channel is the same.

**Read cost.** `π` is a per-cell `Float32Array` built once per (board, team),
cached exactly as `contestField` is, so the PER-NODE cost is unchanged — one
array read per unit of ours, the read `contest` already makes, and zero extra
`now()` reads, so nothing moves on the node clock's `reads × 0.01` term.
Measured over 360 decisions on `mixed` 1–2: **44 enemy actions per decision, 42
distinct step-set lookups, 896 cell-writes** (`sparse`: 8, 8, 40).
`contestField`'s own build is one cell-write per enemy action — 44 — so the
field is ≈20× it; the step sets come from the substrate's
`stepCache`/`orientedStepCache`, which every reach term already fills, and cold
they are ~7 000 `planUnitAction` calls ≈ 8 evaluator nodes ≈ **1.7 % of a
decision's 470-node budget**. The cost is not what refuses this rule.

## 4. Verdict — class A is accepted as the price of a crowded board

**No rule.** The gradient exists, it is statistically unambiguous, and it cannot
be spent: at `σ < 2.33` it moves 2 of 19 entry decisions, and it is silent by
construction on the 4 where the fold is the rung that decides. Shipping it would
spend the whole cliff-certificate budget the class-B σ rule needs, for two
decisions in fourteen games, with no evidence either of them survives the
change.

**What the entry turn actually is.** On 16 of 19 it is a pawn one step from a
wall with a slider two of its own moves away, choosing between a forward step
and a rotation, where every option is inside the same fan at two plies, the bank
has already priced the step higher for a reason that is not contest (a meal, a
capture, a territory difference of 0.16), and the fatal cell is dearer than its
siblings by three hundredths of one enemy's option list. **That is a crowded
board, not a blind member.**

**If somebody runs the arm anyway** — `σ = 1`, one commit, `π` folded as above —
these are the numbers to hold it to, and any of them missing refutes it:

* class-A contest deaths, `mixed` 1–6 + `potions` 1–8: **19 → 17 ± 2**. A larger
  fall is a confound: the rule changes 2 of the 19 entry decisions and cannot
  honestly claim more.
* entry turns where `π` varies: 12 of 19 — unchanged, it is a property of the
  board, so a run that moves it has moved the play somewhere else first.
* `sparse` is **NOT** byte-identical, and this is where `π` differs from the σ
  rule: measured on `sparse` 1–3, `π > 0` on 56 of 2 043 offered options and
  VARIES across a unit's options on 48 of 720 unit-turns (6.7 %). A `sparse`
  run that changes any counter is expected; one that changes a DEATH count on a
  board with zero deaths refutes the rule outright.
* meals within 3 % on every class, and the class-B σ rule NOT co-resident —
  `3(1+σ_A+σ_B) < 10` is the certificate the pair would have to meet.
* `law-sweep`: `contest.lo` class stays ABSENT, `totalLo` 0, `bounds/exact-reply`
  exact on all four seed-1 arms. A point addend cannot open a closed floor class.

**The counter, if it is built.** `π > 0` on 44.5 % of all offered options in the
corpus, so unlike the σ rule this addend is NOT mostly zero at the option level;
it is mostly FLAT (67.2 % of silent unit-turns), which is a weaker property.
Watch `parked share` and `longestPark` first: a term that charges every cell a
slider's options lead towards is a tax on crossing open ground, and D1's floor
repair already taxed advancing once.

## 5. What the next attempt inherits

1. **The two-ply boolean is dead twice over**: saturated on 17 of 19 and
   CONSTANT on 18 of 19 entry turns. So is D1's certainty weight, at 0 of 19.
2. **A count beats an existential, and it is measurable**: `π` is the first
   reading in this corpus to separate the fatal entry option from its siblings
   at better than chance (p = 0.0004). Any future entry-turn member should be
   scored against these 19 and this null before it is written.
3. **A per-cell reading cannot reach the floor ties**, because the ties are
   between options that share a cell. A member that wants those four turns must
   read something the cell does not carry — the FACING, which is what P1 tried
   and what `command`'s clamp already owns — and it must beat `pxmean`'s
   chance-level 12/19, which is the bar for anything exit-shaped.
4. **Three of the 19 are not entry decisions at all.** `contest-gap.md`'s class
   A should be split: 16 where the unit chose a cell, 3 where every offered
   option left it where it stood. The second group is `immobileUnitTurns`, it
   is already counted, and no reading of the enemy fan can touch it.
