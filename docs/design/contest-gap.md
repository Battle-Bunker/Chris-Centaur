# The contest gap — why moving pieces die in contests `contest` did not price

A diagnosis, not a repair. Nothing here is shipped; `contest.ts` and every
other source file on this branch are byte-identical to `a707e3b`.

## Method

Two builds, paired by seed, 60 turns, `--nodes`, never pooled:

* **head** — `a707e3b`.
* **arm** — head plus P1's rule and nothing else. `origin/beh-p1`'s rule commit
  `f598933` is an ANCESTOR of head, and head carries two later changes
  (REVIEW-1 F3's `bank.ts` gate, a calibration comment), so the rule was
  re-applied onto head rather than the whole of `f598933` re-run; otherwise the
  A/B would carry F3's play as well. The arm reproduces the audit's own totals:
  `mixed` 1–6 deaths **14 → 16**, all of the rise `contest`, and `mixed` 1–3
  6 → 5 / 4–6 8 → 9 against the audit's 6 → 7 / 8 → 9.

Scenarios read: head `mixed` 1–6 (2 463 decider unit-turns) and `potions` 1–3
(1 180), arm `mixed` 1–6 (2 412). A scratch instrument in `local-game.ts` (env
`CONTEST_DIAG`, removed before this commit) printed, per unit-turn, the enemy
roster with each enemy's whole arrival set, and per candidate: the settle cell,
`contestField`'s `(reached, tier, weight)` there, `beatenAt`, the safe-exit
count, the two-ply enemy field, and `explainPlan`'s per-feature `lo/est`. A
second print inside `contest.ts::evaluate` gave the per-unit `costOf` bracket
with `held / bestAlive / worstAlive / fates`.

**28 contest deaths were read at the death turn and at every turn back to the
last one the unit stood outside every enemy fan.**

## 1. The cause classes

The classifying turn is the **entry turn**: the last turn at which the unit's
own cell was not `beatenAt` in `contestField`. Every one of these deaths is
1–7 turns after it (median 1).

Only OFFERED options count — a staged square that is a wall or the unit's own
neck is not a choice the member could have made.

| class | what `contest` read at the entry turn | head | arm | all |
|---|---|---|---|---|
| **A — field silent** | `0.000/0.000` on every option; not one candidate cell was inside any enemy's ONE-step arrival set | 12 | 8 | **20** |
| **B — field speaks, flat** | every offered option beaten, `contest` identical across all of them | 2 | 2 | **4** |
| **C — forced** | one offered option at all (the rest own neck or wall) | 2 | 1 | **3** |
| **E — exact tie** | floor AND est equal on every offered option; the salted tie key chose | 0 | 1 | **1** |

**There is no class D.** Not one of the 28 is a case where `contest` carried a
gradient across the offered options and lost the argument to another member.
The member never lost; it never had one to make. The nearest thing to an
exception is `mixed` 6 T7 (below), where the field had begun to speak by the
death turn and the BANK's refined floor — not another fold member — ranked the
charged cell first.

Reproductions, one per class (scenario, seed, turn, unit, enemy, cell):

* **A** — `mixed` 6, T6, red-B pawn (0,1). Every option `contest = 0.000`; the
  blue-B queen is at (5,5), two of its own moves from the x = 0 file. red-B
  steps to (0,2). T7: the queen is at (0,10), its arrival set is the whole
  file, red-B's origin and its forward step are both beaten, it steps to (0,3)
  and dies there.
* **A** — `mixed` 1, T49, blue-C pawn (0,4). All four options `0.000`; red-A
  snake head (3,4). blue-C steps to (1,4). T50 red-A is at (2,4); blue-C takes
  (2,3) — red-C knight's vacated square — and red-A arrives there. DEATH.
* **B** — `mixed` 6 (arm), T27, green-A snake (4,5). All four options beaten by
  blue-B queen (2,4), `contest = −1.500` on each. Dies at (4,6).
* **C** — `mixed` 5, T60, red-A snake (10,10), body along y = 10. (10,9) is its
  only legal action and blue-B queen (7,9) covers it.
* **E** — `mixed` 4 (arm), T60, blue-C pawn (3,10). All three offered options
  score `127.90` on the floor and `225.00–225.02` on `est`; blue-B queen (1,10)
  takes (4,10).

## 2. The dominant class, and the reading that misses

**Class A is 20 of 28 (71 %), and its mechanism has two halves that fire on
consecutive turns.**

### 2.1 The horizon: `contestField` is one ply, read at the arrival turn

`enemyArrivals` (`contest.ts:224`) yields `sub.actionsOf(e)` — the cells `e` can
END THIS TURN on — and `costOf` charges our unit only at the cell its arrival
settles on, this turn. A cell two of an enemy's steps away is charged nothing.
On the corpus, `contestField` is silent on **every** option of a unit on
1 838 of 3 643 unit-turns, and at 12 of the 16 head entry turns.

### 2.2 The pin: once the unit is IN a fan, `contest` is exactly constant

This is the half that makes the horizon miss irreversible, and it is the finding.

For a unit `u` whose own cell is beaten:

* **`lo` is pinned by the origin.** `settlesOn` (`contest.ts:280`) returns
  `{settle cell} ∪ {origin} ∪ traversed` for any unit `fates` calls
  `contingent`, and `costOf` takes the **max** over that set. The origin is in
  the set of every candidate, so if the origin is beaten the worst charge is
  `CONTEST_LOSS` for every candidate, whatever the destination costs. Measured
  directly, `mixed` 1 T50, blue-C pawn (1,4), all five options:
  `worst = 1` at every one of them, including `(1,3)` and `(2,4)` where
  `chargeAt(destination) = 0`. Same at `mixed` 4 T46 for a snake, which has no
  hold in its grammar at all.
* **`hi` is zeroed by the alive-polarity.** `ourUnitTerm` (`bound.ts:176`) pays
  a COST into the best accumulator only `if (vHi < 0 && paidWorst)`, and
  `paidWorst` is `worstAlive` — false for exactly the units `material`'s cliff
  writes off, which is any unit a ledger entry names, which is any unit in a
  fan. Measured: of the 597 flat-nonzero readings in the corpus, **592 have
  `hi` exactly 0** (365/368 head, 227/229 arm).

Both endpoints constant ⇒ `est` (their midpoint) constant ⇒ **the member
expresses no preference among that unit's options at all.**

### 2.3 What that state costs

Every decider unit-turn, bucketed by whether the unit's own cell is beaten and
whether `contest` varies across its options:

| bucket | head `mixed` 1–6 | | | head `potions` 1–3 | | | arm `mixed` 1–6 | | |
|---|---|---|---|---|---|---|---|---|---|
| | turns | deaths | /100 | turns | deaths | /100 | turns | deaths | /100 |
| origin outside every fan | 1 144 | 0 | 0.00 | 615 | 0 | 0.00 | 1 141 | 0 | 0.00 |
| origin safe, some option beaten | 824 | 2 | 0.24 | 328 | 1 | 0.30 | 790 | 3 | 0.38 |
| **origin beaten, `contest` FLAT** | **140** | **8** | **5.71** | **65** | **3** | **4.62** | **122** | **8** | **6.56** |
| origin beaten, `contest` graded | 355 | 1 | 0.28 | 169 | 1 | 0.59 | 359 | 1 | 0.28 |

The flat bucket is 5–6 % of unit-turns and carries **67–73 % of the contest
deaths (11 of 16 head, 8 of 12 arm), at 20× the rate of equally exposed
unit-turns where the member still has a gradient.** No unit ever died a contest
death from outside every fan.

By kind, head `mixed`: pawns are 377 of 2 463 unit-turns and 8 of 11 contest
deaths; **7 of those 8 are in the flat bucket**, which is only 32 pawn
unit-turns — 22 deaths per 100. Knights spend 227 unit-turns origin-beaten,
go flat on 9 of them, and die 0 times.

### 2.4 What does NOT miss

Read at every death cell: `outranks` — `winsContest`'s tier-then-weight order —
was right every time; the killer's arrival was in the field at the death turn in
every case but the four where our unit staged onto a cell an enemy stood on
(D1's unrepaired hole in `enemyArrivals` — a trail unit's own square is still
not in the field). The claims horizon and
`material`'s floor are not the miss either: the floor writes the exposed unit
off IDENTICALLY in every option (`material = 110.000` on all five of blue-C's at
`mixed` 1 T50), which is the cliff behaving exactly as its doctrine says.

## 3. One rule that would price it

**`CONTEST_STANDING`, one knob `σ ∈ [0, 1]`.** A second addend inside
`contest`, folded as a **POINT**:

    d_u        = the cell this plan's staged action leaves u standing on
    field⁺     = contestField ∪ {each enemy's own turn-start head cell}
    standing_u = 1 if beatenAt(field⁺, tier_u, weight_u, d_u) else 0

    contest += − σ · Σ_u standing_u / |ours|        (lo = est = hi)

`σ = 0` is today's fold, byte for byte.

**Why a point, and why that is the whole trick.** The existing charge asks
"what does the cell this unit ENDS on cost" — a world-dependent quantity, so it
must be bracketed, and the bracket contains the origin, and a max over a set
containing the origin can never reward leaving it. This addend asks a different
question: "does this PLAN stage a unit onto a cell an enemy beats". `d_u` is a
function of the staged plan and the turn-start board, so it is the same number
in every completion world the claims admit — a point needs no bracket, nothing
about the origin enters it, and it therefore moves `lo`, which is the rung
`search/core.ts::better` decides on first (`floor, est, ceiling, tie`).

**The algebra, on a real deciding comparison.** `mixed` 6, T7, red-B pawn at
(0,2), `|ours| = 3`, `w_contest = 3`, so the addend contributes `−σ·Σ standing_u`
outright. blue-B queen sits at (0,10) and its arrival set is the whole x = 0
file. The fold's own floor, per offered option:

    (0,3)  forward, on the file       fold lo −124.080     contest −1.000
    (1,3)  diagonal, off the file     fold lo −123.078     contest  0.000
    (0,2)  hold                       fold lo −124.240     contest −1.000
    (−1,2) rotate                     fold lo −124.240     contest −1.000

The staged cells are (0,3), (1,3), (0,2), (0,2): the addend charges `σ` to
three of the four and 0 to (1,3), so the margin `(1,3) − (0,3)` goes from
**1.002 to 1.002 + σ** — a widening of a gap the member already states, not a
new preference invented beside it. This reproduction is also the honest limit
of the rule: the margin was ALREADY 1.002 in `contest`'s favour and the plan
still played (0,3), because the rung the search compares first is the BANK's
refined floor (`(0,3) = −113.43` against `(0,2) = −113.73`), not the fold's.
Widening a fold margin only decides where the bank's floors tie, which in the
flat bucket is 38 of 199 decisions (19 %, against 9–13 % elsewhere).

**Where it bites, measured rather than argued.** Inside the flat bucket the
addend's value VARIES across the offered options on **95 of 205 head unit-turns
and 54 of 122 arm ones** — it breaks the flatness on about half the state it is
aimed at. But among the ELEVEN head deaths inside that bucket it varies on only
**one**: in 9 of the 11, every offered option's staged cell is already beaten
and the unit is genuinely cornered. So the rule's honest claim is about the
STATE, not directly about the deaths, and its prediction below is written that
way on purpose: if the state shrinks and the deaths do not follow, the rule is
refuted and the next attempt must look one turn further back, at the entry.

**Why it is not P2's shift.** P2 moved with every plan because `ground` is
nonzero everywhere. This addend is exactly 0 unless a plan stages a unit onto a
beaten cell: on the measured corpus it is 0 on **every option of 1 838 of 3 643
unit-turns** (50 %).

**The honest floor and the ratchet.** `costOf`'s bracket is untouched;
`settlesOn` keeps its contract and `dischargeable: true` still holds, because a
point is exact in the held and the discharged reading alike. `law-sweep`'s
`contest.lo` class is CLOSED at 0 and a point addend equal in both readings
cannot open it; `σ = 0` gives a zero-dose identity the sweep can be pinned
against. What DOES move is the span: the per-unit reading becomes `[−1−σ, 0]`,
so the cliff certificate `w_contest × span < CLIFF_MATERIAL_WEIGHT × lightest`
goes from `3 < 10` to `3(1+σ) < 10` and must be re-pinned at whatever `σ` ships.

**The counter.** The addend charges the STAGED cell, and `field⁺`'s origin
clause puts every enemy's own square in the field — so a plan that TAKES a piece
now pays `σ` for the capture it makes. If capture rate or meals fall on any
class, this is D1's first attempt in another coat and it should be refused as
that was. Second counter: the addend is blind to the next turn, so on the 12 of
16 entry turns where `contestField` is silent it reads 0 on every option. **It
does not touch class A's entry decision at all** — it makes the state class A
leads INTO cheaper to leave, and that is the whole of its claim.

**Falsifiable, per class.**
* origin-beaten ∧ flat unit-turns: `mixed` 140 → **< 100**, `potions` 65 → **< 50**.
* contest deaths in that bucket: `mixed` 8 → **≤ 6**, `potions` 3 → **≤ 2**.
  A LARGER fall than that is evidence of a confound, not of the rule working:
  the addend varies on only 1 of the 11.
* class A deaths (entry turn with the field silent): **20 → 20 ± 2.**
* `sparse`: byte-identical (0 occupied-cell entries in 720 unit-turns).
  `snakes`/`sparse-lean` are NOT predicted identical — they have contests.
* meals within 3 % on every class; `enemyOccupiedEntriesLost` down, not up.
* `law-sweep`: `contest.lo` class stays ABSENT, `totalLo` 0,
  `bounds/exact-reply` exact on all four seed-1 arms.

### A rule that was tried on paper and refuted by measurement

The obvious repair — charge the two-ply enemy field at `γ` — was measured
before being written. The two-ply field is **saturated (every option beaten) on
2 296 of 3 643 unit-turns (63 %)**, and **at 12 of 12 class-A entry turns where
the one-ply field was silent it is saturated too.** A boolean two-ply charge is
therefore flat on exactly the decisions it was proposed for: it shifts every
plan alike, which is P2's refutation restated. Its graded form (count of
distinct beating enemies at two plies) varies on 1 322 unit-turns but on only
4 of the 16 entry turns. The safe-exit count varies on 13 of 16, but at
`mixed` 1 T49 it prefers (1,4) — the fatal step, 3 safe exits against 2 — and
at `mixed` 6 T6 it prefers (0,2), also fatal. None of the three is the rule.

## 4. Why the three refuted attempts could not have fixed this

**D1's first attempt (enemy-origin clause + certainty weight).** Both clauses
act inside `costOf`, on WHICH cells are in the field and how dearly each is
charged. Neither changes the horizon: the enemy whose arrival kills is two of
its own steps away at the entry turn, and so is its own cell. Measured here
directly — adding the origin clause to the flat state's discrimination moves it
from 96 unit-turns to 95, and from 2 of the 11 flat-bucket deaths to 1.

**D1's second attempt (`1 − ε + ε·p`).** A monotone re-scaling of the same
per-cell charge. Where the boolean charge is constant across a unit's options —
which is the definition of the flat state — so is any function of it: `p` is a
property of the ENEMY's action count, identical across our candidates at a cell
the same enemy covers. It could not have broken the flatness at any `ε`, which
is why it was refused on the bound and then on tempo rather than on the play.

**D1's third attempt (the floor repair, SHIPPED).** It is the CAUSE of the `lo`
half of the pin, and it is right: the commonest completion world is the one
where the move does not happen and the unit is still standing where it set out.
This diagnosis is not an argument to revert it — dropping the origin from the
set restores the unsound floor the sweep pinned 30 worlds of. What it does
establish is the theorem the next attempt inherits: **no refinement INSIDE
`costOf` can restore a gradient for a unit standing in a fan, because any
bracket containing the origin is pinned by the origin.** The repair must be
spent somewhere the bracket does not read — which is what a POINT addend is.

**P1 (the masked mobility indicator).** It changes which cell a pawn FACES, not
what any cell costs. Measured on the arm: the flat bucket goes 140 → 122
unit-turns with **8 → 8 deaths** and the rate 5.71 → 6.56 per 100, and the
arm's 12 contest deaths fall into the same classes as the head's 16 (A 8/12
against 12/16). It neither created the gap nor cured it: it moved deaths within
it, from a pawn that dies against a wall to a pawn that dies in the open, and
the audit's note is exactly right that `contest` prices an arrival and not the
standing. What this measurement adds is that the standing is not merely
unpriced — it is priced at a CONSTANT, and P1's own suggested repair (a) —
gate `m_u` on the safety of the step it restores — would have inherited the
same pin, because it too would have been read at the settle cell.

**REVIEW-1 F2 / BANK-F23 (declined).** It narrows a B1/B3 view's peril, gives a
capture its edge back, buys meals and pays `+1.0` contest death per game on
`mixed`. It is on the far side of this gap: it makes our units advance into
fans MORE often, and the member that should price the advance is the flat one.
Its deaths were contests for the reason set out in §2.2, and its counter-example
is the same 5–6 % of unit-turns.
