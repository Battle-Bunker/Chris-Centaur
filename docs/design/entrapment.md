# Entrapment: a repair of `room`, not a member beside it

> *"The basics of avoiding entrapment and territory management."* — the owner,
> who also asked for conservative behaviour.

This document supersedes the record of the first attempt (`ede21fa`, kept below
in §1 with its numbers intact) and specifies the second. The verdict it reaches
is:

**Entrapment is not a missing member. It is `room` measuring the wrong
quantity, and the repair is one changed relation inside the partition sweep —
after which three special cases and a whole per-unit plane layer come out of
`territory.ts` and nothing new goes into `FEATURES`.**

And the finding that decides the whole shape of it, which the first attempt did
not have and could not have had from a static board:

**A snake cannot trap itself. Its own body vacates one cell per turn, so the
region bounded by its own trail is always at least its own length — the coil is
a tail-chase, not a tomb. Every real entrapment is closed by somebody else's
body or lost as a race. A member barred by `cells[0..len-2]` and nothing else
can therefore only ever fire on false alarms, which is exactly what the runner
measured.** (§3.2, and the arithmetic in §7.1.)

---

## 1. What was built, recorded and not seated

The gap the first arm was built for is real and is written down here because it
is still the gap.

`room` (`src/lobster/evaluate/features.ts:711`, doctrine at `:674-710`) is
billed as the death predictor, and it measures a RACE rather than a REGION. Its
`owned` count is plane 1 of the territory partition (`territory.ts:16-23`) —
cells this unit reaches strictly before every other admitted trail unit —
computed on the dilation shells, and the shells step against the real board for
the first unknown turn and against the PERMISSIVE board (every cell a pawn
target) for every turn after it (`shells.ts:116-127`, `claims.ts:202-216`). The
reason is given in both files and it is a good one: after one unknown turn
nobody knows where the bodies are, and over-approximating is the only direction
a reach may be wrong in.

That is exactly right for a race and exactly wrong for a box. **A snake coiled
into a pocket of four cells has a plane-1 region that walks out through its own
body on the second shell, because on the permissive board its own body is not
there.** So `room` reads it as roomy several turns before it suffocates.
Nothing else in the fold sees a pocket either: `material`'s cliff fires on what
kills us THIS turn, and a unit that steps into a pocket dies next turn or the
turn after.

The arm that was built and recorded — `src/lobster/evaluate/entrap.ts`, weight
3, seated at the end of `FEATURES` — closed that with a four-connected flood
from the settled cell, capped at `need = max(4, len + 2)`, barred by terrain
and by every unit's `cells[0 .. len-2]` (the certain occupancy
`staging-safety.ts:38-48` derives from the rules), plus an exit floor so that a
one-way-out cell was feared however long the corridor behind it was. Its
constructed boards passed and pinned it exactly. The runner did not:

**At the mandated 30 turns, five seeds, `--nodes`, against HEAD:**

| board | meals/100 A → B | deaths A → B | bodyBlock+self A → B |
|---|---|---|---|
| snakes | 18.12 → 18.50 | 5 → **8** | 4 → **6** |
| mixed | 16.26 → 16.45 | 9 → 8 | 0 → 0 |
| sparse | 6.83 → 6.83 | 0 → 0 | byte-identical |
| potions | 16.31 → 16.31 | 11 → 11 | byte-identical |

**At 60 turns**, where 14 of `snakes`' 17 deaths are bodyBlock or self against
4 of 5 at thirty:

| board | meals/100 A → B | deaths A → B | unit-turns A → B |
|---|---|---|---|
| snakes | 17.07 → 17.49 | 17 → 16 | 1377 → 1395 |
| mixed | 19.63 → 18.89 | 23 → **19** | 1798 → 1853 |

The two runs are the SAME games, so those are consistent readings: the arm lost
three more units in the first thirty turns and four fewer in the second thirty,
40 → 35 deaths over the two boards and +73 unit-turns of survival. The
pre-registered gate was measured at thirty turns and it failed there. Both
self-deaths in the failing arm were already-boxed snakes with every option
fatal. The case rested on a horizon the instrument did not measure, which is the
argument every unmeasured term has ever made — so it was recorded and not
seated.

An earlier discarded arm (`need = len × 2`, the enemy's claims admitted as a
flat third barrier class) was worse, and the mechanism generalises: on a
six-snake board the enemy field covers a large share of the interior, so every
option a big snake has floods into a fragment, the shortfall saturates, and the
term returns the same number for every move — three options of a length-12
snake scoring −75.79 apiece on the turn before it coiled into itself. **A
saturated set carries no information about the unit's own position.** That is
the same failure `calibration.ts` records for `reach` on a slider, and §4.4
below is what carries the lesson forward.

### 1.1 The bank inversion the work turned up, which is still open

`basic-intelligence.test.ts` reports zero bound inversions at HEAD and
twenty-three with that member seated — **and the member is not the cause.**

    CENTAUR_DEBUG_INVERSION=1 node -e '
      const { runGame, MIXED_SCENARIO } = require("./dist/tests/local-game.js");
      runGame({ ...MIXED_SCENARIO, maxTurns: 100, seed: 3, nodeBudget: 220 },
              { scores: false }).then(() => {});'

At HEAD, with no member of any kind added, that prints

    INVERSION inverted ScoreBounds [-336.54891290527655, -Infinity]: bank floor=B0 ceiling=B1

nine hundred and ninety times. Doubling `contest`'s weight gives the same 990;
a constant `point(-0.5)` in place of the member gives the same 990. The
inversion is a property of the bank's cross-basis comparison, not of any
feature's admission contract; what a new term does is change which games get
played. The related `G-D3` failure — 485 inversions on `potions` seed 4 where a
B1 floor sits above an exact concrete reply — is recorded in
`docs/design/decision-lens/08-DEPTH-VERDICT.md:799-802` as the next soundness
item. **Neither is this document's to fix, and both make "bound inversions must
stay zero" a gate that measures the search's basis bookkeeping rather than the
member under test.** §6 gates on *no new inversion signature* on the same
build, not on zero.

---

## 2. What the lookahead verdict permits, and why this is inside it

`08-DEPTH-VERDICT.md:24-84` settles that chained depth is refused at production
budgets (a partial settlement is not a board any world reaches, so it cannot be
chained from), and `:785-802` settles that the ceiling ply is sound and vacuous
and is not merged. The standing conclusion is:

> *at production budgets, the one-ply bracket plus the threat map IS the
> lookahead.*

Entrapment is therefore not allowed to be a search, and this design is not one.
It buys **no settlements at all**. Everything it reads is already computed:

* the settled board of the plan being scored (`PartialSettlement`),
* each held unit's `Claim` — `certainIfAlive` (`claims.ts:110`, `:542`),
  `weightMin`/`weightMax`, `certainlyGone` — carried onto every `Standing`
  already (`features.ts:225-236`),
* the decision-scoped dilation shells (`shells.ts:470-519`), which are the
  engine's own step relation iterated and cached per `(kind, cell, facing,
  turn)`.

The objection §3.1 raises against abstract plies — *the base board is the
optimistic timeline, so a span-2 reading is a bracket conditional on the ply-1
ledger* — does not bite here, for the same reason it does not bite `room` and
`reach` today: the flood is a GEOMETRIC statement about the board the ply-1
settlement produced, priced in the two extremal alive-sets like every other
member, and the optimism of that board about our own unit is exactly what the
`lo` reading's barrier set exists to charge for. Nothing is settled at `t+1`,
no `BasisKey` moves, no narrowing is declared, `est` is never touched.

---

## 3. The geometry

### 3.1 The horizon `k`, and why it is per unit

**`k_u = need_u = max(4, L_u + 2)` turns**, where `L_u` is the reading's
endpoint of the unit's own length. Not `REACH_HORIZON_TURNS` (=4,
`calibration.ts:192`).

The reason is arithmetic, not taste. A snake dies of a pocket when its own tail
stops feeding it slack, and the tail takes `L` turns to clear the body. A
horizon of 4 is shorter than the body of every snake past length 3, so **`room`
at `REACH_HORIZON_TURNS` cannot see a pocket even with the barrier repair
applied** — it would stop looking one turn after the front is blocked and
before the body vacates. The horizon has to be the length of the thing being
measured.

That costs nothing extra, because the flood is capped at `need_u` cells (§3.4),
so the work is `O(need × k)` cell tests — a few dozen — regardless of the board.
Where `k_u` runs past the shells' own horizon, an enemy front is held at its
last front, which is the cumulative and conservative reading (`Shells.extendTo`
already carries a front forward when the next one is empty, `shells.ts:186-192`).

`+2` is the margin, and it is the number the first arm's constructed boards were
calibrated on (`need = max(4, len + 2)`) — carried forward rather than
reinvented. Its meaning: a region of exactly `L` cells is survivable only if it
admits a Hamiltonian cycle (the tail-chase); `+1` buys one meal's growth, `+2`
buys one cell lost to a crowder. The floor at 4 covers the lengths where `L+2`
is smaller than a snake's own immediate neighbourhood.

### 3.2 The barrier set, and the one thing the first arm got backwards

For our trail unit `u` on the settled board, at horizon turn `t = 1 … k_u`, a
cell is BARRED when any of these holds.

**(a) Terrain.** `terrain.wall`. Barred at every `t`. This is the only class the
existing dilation already respects, and it respects it only at COUNTING time
(`territory.ts:546`), never at STEP time — which is the shape of the whole
repair.

**(b) Another trail unit's body, on its own vacating schedule.** For every other
live trail unit `v`, cell `O^v[i]` is barred at `t` iff `i ≤ L_v − 1 − t`. That
is the neck argument (`staging-safety.ts:38-48`, `claims.ts:104-110`)
generalised from one turn to `t`: a trail unit's occupancy after `t` further
turns retains its old cells `0 … L_v − 1 − t`, whatever it chooses, because it
must step and its body follows. At `t = 1` this is exactly `cells[0..len-2]`;
at `t = L_v` it is empty. `L_v` is an interval endpoint chosen against the
reading (§5).

A PIECE has no trail and no schedule: it contributes only through (d), whose
`earliest` already contains its own cell at `t = 0`. No branch on a kind name
anywhere — `leavesTrail` decides, exactly as the partition already decides which
plane a unit is on (`territory.ts:415`).

**(c) `u`'s OWN body, on the SAME schedule — and its own new trail not at all.**
This is the correction. `O^u[i]` is barred at `t` iff `i ≤ L_u − 1 − t`, so the
head's own coil opens behind it turn by turn. The unit's new trail is NOT barred
and is not modelled cell by cell: it is what the `need` threshold prices. That
is the exact sense in which the region is measured *"as the trail will be, not
as it is"* — the trail's future is a length, and a region of `L + 2` cells is
precisely the statement that the future trail fits inside it.

The first arm barred `cells[0..len-2]` at every depth. **Under a static own-body
barrier a coiled snake is trapped; under the rules it is chasing its own tail
and is fine.** Worked in §7.1: a length-8 coil whose only way out runs through
its own fourth segment reads 3 cells (fear 0.837) statically and ≥ 10 cells
(fear 0.000) on the schedule. That false alarm is a complete mechanism for
`snakes` 5 → 8 deaths at thirty turns: the arm feared safe ground, and a snake
pushed out of its own safe coil goes where the other snakes are.

**(d) Ground an enemy or a teammate can hold first — the claims as barriers.**
Cell `c` is barred at `t` iff some OTHER admitted unit `w` has
`earliest_w(c) ≤ arrivalTurn + t`, read off `UnitShells.earliest()`
(`shells.ts:212-224`) — the engine's own dilation, unbarred, over-approximating,
which is the only direction a claim may be wrong in (`claims.ts:31-38`).

This is the second clause of the owner's brief — *"every exit could be closed by
held enemies within their claim horizon"* — and it is **not a separate term**.
An exit an enemy can stand in before we get there is a barred cell; a pocket
whose every mouth is closable collapses to a region of one or two cells, and the
shortfall says so on its own. That is one special case the first arm had (its
`exits(u)` floor) and this design does not.

Note the two directions deliberately disagree: OUR front is barred, THEIR fronts
are not. Ours must under-approximate (we are counting ground we can keep);
theirs must over-approximate (they are the threat). Both are the conservative
side of their own question.

`at or before`, not `strictly before`. A tie kills both, so a cell we tie for is
not a cell we keep. That retires the asymmetric tie rule and the held-teammate
tie exemption whose doctrine occupies `territory.ts:63-73` (§4.3).

### 3.3 The dilation itself

`R_0 = { the settled head cell of u }`, and for `t = 1 … k_u`:

    R_t = R_{t-1}  ∪  { c ∈ step(R_{t-1}) : c is not barred at t }

`step` is the engine's own relation — `ShellTable.stepBoard(kind, cell)` for a
kind that reads no facing, `ShellTable.stepsFrom` for one that does
(`shells.ts:288-359`). Nothing here decides what a unit may do; this file's
whole addition is the `∩ ¬barrier` that `Shells.extendTo` (`shells.ts:159-197`)
does not apply. **That intersection is the entire code change to the geometry.**

The union-carry is what lets the region grow through a cell that only opens
later (the head can loiter while its own body clears), and it is the reason §7.1
comes out right. It is suppressed while `|R_{t-1}| = 1`: a unit with a single
cell has nowhere to loiter, and a carry there would credit it with an escape it
cannot walk to.

    kept(u) = |R_{k_u}|            capped: stop as soon as |R| ≥ need_u

### 3.4 The number

    need(u) = max(4, L_u + 2)
    fear(u) = sqrt( clamp01( (need(u) − kept(u)) / need(u) ) )     ∈ [0, 1]
    room    = − Σ_{ours, live, unheld} fear(u) / |ours|            ∈ [−1, 0]

* **Zero when the region is comfortably larger than the body**, by the cap: the
  flood stops at `need` and `fear` is exactly `0` there. A roomy unit costs
  nothing and the term expresses no preference among its options — which is
  what keeps it from being a second, weaker `reach`.
* **Steep as the exits close.** `sqrt` is convex-decreasing in `kept` near the
  threshold: the FIRST cell of shortfall costs `sqrt(1/need)` ≈ 0.35 of the
  whole term, and the last costs almost nothing more. Losing an exit costs a
  block of cells at once, so the shape prices the loss of the second-to-last
  exit hardest — which is where a decision can still be changed. It is the same
  `sqrt` `room` already uses (`features.ts:770`), moved to the other side of the
  saturation.
* **A fear, never a credit.** Ours-only and never positive, folded through
  `ourUnitTerm` (`bound.ts:143-166`) so that a dead unit can never invert the
  bracket and a costs-over-the-superset reading is not re-derived here.

---

## 4. Repair, not a new member — and what comes out

### 4.1 Why not both

The first arm added a fear beside a `room` that still said "roomy" about the
same unit in the same position. The fold then carries a fiction and its
correction side by side at weights 3 and 3, and their sum is not a reading of
anything. **You cannot fix a wrong number by putting a right one next to it.**
`room`'s own header calls it the death predictor; there is room in the fold for
exactly one.

So: the feature KEY stays `room`, the weight stays 3, its position in `FEATURES`
stays (`features.ts:1165-1177`), the `roomScale` divisor and the cliff
certificate keep their form. What changes is the quantity behind the name — and
the operator-facing definition changes with it, from *"how much ground this unit
wins the race to"* to *"how much ground this unit can keep"*. That has to be
said in `docs/BASIC-INTELLIGENCE.md` and in the lens column's help text, because
the sign flips: the column runs `[−1, 0]` where it ran `[−1, +1]`.

### 4.2 The enemy half is retired, and that is what deletes `crowdCertain`

`room` today is `(Σ ours g − Σ theirs g)/roomScale`. The repair drops the enemy
half, for three reasons and one of them is decisive:

1. **A held enemy has no head cell to flood from.** Its position is a cloud. A
   region measured from the cloud's seed is a statement about a unit that may be
   nowhere near it; a region measured over the cloud is the whole board.
2. `reach` already carries the contested-ground difference at the team level
   (`features.ts:652-669`), which is where "am I squeezing them" belongs.
3. **It is the entire subject of `crowdCertain`** (`features.ts:759-772`): that
   patch exists because the MAXIMISED side of the sum — the enemy's `g` in our
   `hi` reading — cannot be read off one sweep when an uncertain crowder is
   admitted, and it saturates at `g ≤ 1` when one is. With no enemy half there
   is no maximised side and no patch. It goes, and the paragraph of doctrine
   above it goes with it.

What is lost is an incentive to box the enemy in. That is the aggressive half of
"territory management" and the brief here is the conservative one; it is named
as a deliberate omission rather than an oversight, and `contest` and `reach`
still price the pressure.

The range contracting from `[−1, +1]` to `[−1, 0]` strictly TIGHTENS the cliff
inequality the acceptance suite asserts (`territory-acceptance.test.ts:564-593`,
`w_room × span < CLIFF_MATERIAL_WEIGHT`): the certified span halves from 2 to 1.

### 4.3 What comes out of `territory.ts`

With no per-unit ownership plane to compute, the sweep loses a whole layer:

| removed | why it existed |
|---|---|
| `TerritoryWorkspace.own` / `planeFor` (`:212-213`, `:266-269`, `:432`, `:519-522`, `:543-548`) | the per-unit plane 1, read by `roomSum` and by nothing else |
| the per-team `seen`/`multi` sweep (`:209-210`, `:482-523`) | deciding the unique argmin per cell, only ever needed per unit |
| the held-teammate tie exemption (`:63-73`, `:490-492`, `:510-511`) | making per-unit ownership refinement-monotone; with barriers-at-or-before there is no tie to exempt, and narrowing a held unit only ever REMOVES a barrier |
| `crowdCertain` (`features.ts:759-772`) | §4.2 |

`TrailRoom.owned` becomes `TrailRoom.kept` and `Partition.trails` keeps its
shape, so `territory-acceptance.test.ts` re-pins the same positions in the same
units (§6, G-6). The team-level `oursBoard`/`theirsBoard` sweep is untouched —
`reach` still needs it, and `reach` is still a race and is right to be.

Three special cases and one plane layer, against one added `∩ ¬barrier` and one
per-unit barrier board. That is the whole of "prefer the repair".

### 4.4 The saturation guard, carried forward from the discarded arm

Three things keep this from degenerating the way `need = len × 2` with a flat
enemy-field barrier did:

* the flood is **capped at `need`**, so a roomy unit is exactly 0 and cannot be
  distinguished from another roomy unit by noise;
* the enemy barrier is **timed against our own arrival** (`earliest ≤ t`), never
  a flat `k`-ball — at `k = 4` on an 11×11 board a flat ball is most of the
  interior, which is precisely how the discarded arm made every option of a
  length-12 snake score −75.79;
* the `hi` reading admits **only certain barriers**, so at least one endpoint
  stays discriminating on a crowded board.

---

## 5. Soundness: where `lo` and `hi` come from

Every member is a bound over the world set, and the world set here is *"the
completions of the held units' moves this turn"* (`bound.ts:11-15`,
`laws.ts:1-26`). Two things follow that must be said plainly, because the first
arm's post-mortem confused them.

**The pessimism in the DEFINITION is not unsoundness.** The value `v(w)` of this
feature in a concrete world `w` is the barred flood computed on that world's
board. It under-counts what a cleverer snake could keep (it never models the
snake's own future trail cell by cell, and its loiter carry is coarse). That
makes the feature CONSERVATIVE, not unsound: soundness is `lo ≤ v(w) ≤ hi` for
every `w`, and `v` is whatever we define it to be, as long as it is the same
function in every world. The same is true of `room` today: a body-blind race is
a fiction, and it is a soundly bounded fiction. What made it the wrong member
was never its bracket.

**The bracket comes only from what is held.** So the two readings differ in
exactly the three places the held set makes something uncertain:

| | `lo` (our worst world) | `hi` (our best world) |
|---|---|---|
| a HELD unit's ground | its whole cloud (`frontAt(t)`, `earliest ≤ t`) bars | only its `certainIfAlive` (`claims.ts:110`) bars |
| a CONTINGENT unit's body | bars if `worstAlive` | bars only if `worstAlive && bestAlive` |
| lengths `L_v`, `L_u` | `weightMax` — bodies persist longest, `need_u` largest | `weightMin` — bodies vacate soonest, `need_u` smallest |

* **R1 (soundness).** In any world `w`: a held unit is somewhere in its cloud, so
  the `lo` barrier set is a superset of `w`'s and `kept_lo ≤ kept(w)`; it is
  certainly on its `certainIfAlive` cells wherever it is alive and uncut, so the
  `hi` barrier set is a subset of `w`'s and `kept_hi ≥ kept(w)`. `fear` is
  monotone decreasing in `kept`, so `fear_lo ≥ fear(w) ≥ fear_hi`, and the term
  is negated: `lo ≤ v(w) ≤ hi`. The `certainIfAlive` set is conditional on
  *alive and uncut* (`claims.ts:104-110`, `severPossible`), which is why the
  `hi` side admits a unit only when it is alive in BOTH worlds — a barrier from
  a unit that might be dead would push `hi` DOWN below a world, and that is
  precisely the direction that unsounds a ceiling.
* **R2 (monotonicity).** Narrowing a held unit shrinks its cloud
  (`HeldUnit.options`, `claims.ts:56-63`), which can only REMOVE barriers from
  `lo`, which can only grow `kept_lo`, which can only raise `lo`. On the `hi`
  side a narrowing can only promote a contingent unit to certainly-alive, adding
  a barrier, lowering `hi`. The interval shrinks both ways. No tie rule and no
  exemption is needed to make that true, which is the whole of §4.3's third row.
* **R3 (collapse).** With nothing held there is no ledger, so nothing is
  contingent, `worstAlive === bestAlive` for every unit, `weightMin ===
  weightMax` for every mover, and the two barrier sets are literally the same
  set. `lo === est === hi` by construction, not by luck. The horizon is NOT a
  world dimension: everything the flood speculates about turns `t > 0` is the
  same speculation in every world, so it enters both endpoints identically and
  cannot break the collapse.

The contract declaration is therefore:

```ts
contract: {
  reads: [
    { input: 'held-arrival',          monotone: 'down' },  // later arrival ⇒ fewer barriers ⇒ less fear
    { input: 'held-weight',           monotone: 'down' },
    { input: 'maybe-body-presence',   monotone: 'down' },
    { input: 'contingent-survival',   monotone: 'down' },
  ],
  cliff: false,          // it must slide, never jump: material owns the cliff
  dischargeable: true,   // R3 above
}
```

`cliff: false` matters. A trapped unit is not a dead unit, and a term that
jumped would make `lo` FALL when a feared death is merely confirmed
(`bound.ts:35-42`). The fear is bounded by 1 per unit, so at weight 3 against
`CLIFF_MATERIAL_WEIGHT = 10` it can never outrank the lightest death anywhere on
the board.

---

## 6. Momentum, energy, and the fact that a trapped unit must still move

* **A trail unit has no hold in its grammar.** Staging its own square is not a
  move (`queries.ts:143-150`), so this term never argues for standing still. It
  argues about WHICH cell, which is the only question a snake has.
* **`momentum`.** A reversal costs `1/|ours|` (`momentum.ts:105-124`); a full
  fear costs `3/|ours|` at the shipped weights. Backing out of a closing pocket
  therefore beats the anti-dither charge three to one, which is the clause
  `momentum.ts:68-77` already declares it must never break (*"a unit backing out
  of a trap still backs out of the trap"*). Idleness is charged only to a kind
  that can decline, so it never meets this term at all.
* **`energy`.** Identically zero on a snake-only board — the feature is gated on
  `ours.some(isPieceType)` (`energy.ts:184`) — so on `snakes` and `sparse` the
  two never interact. On `mixed`/`potions` they act on disjoint unit classes:
  `energy` prices a piece's spend, this prices a trail unit's room. Neither can
  be the other's counterweight, and neither is asked to be.
* **The already-boxed unit.** When every option of a unit is fully feared the
  term is FLAT across its options and orders nothing; `material`'s cliff, `food`
  and `momentum` decide, and the unit dies. That is correct — a term that
  invented a preference among fatal options would be pricing a fiction — and it
  is the honest reading of the two self-deaths the first arm was blamed for. The
  member's claim is about the turns BEFORE that, and §7.2 is how that claim is
  measured instead of asserted.

---

## 7. The boards and the instrument

### 7.1 The constructed board, and what it pins

`src/tests/entrapment.test.ts`, driven by `board-fixtures.ts`'s `makeSnake`, on
an 11×11 API board (13×13 full, one-cell perimeter wall, `translate.ts:1-17`).
Two positions, and the first one is the point.

**P1 — THE FALSE ALARM the first arm fired on.** One snake, length 8, coiled
into the bottom-left corner, no other unit within reach. Settled occupancy after
the candidate move, head first:

    (1,0) (2,0) (2,1) (2,2) (1,2) (0,2) (0,3) (0,4)

            y
        4   S . . .        S = this snake        need = 10
        3   S . . .        . = open              k    = 10
        2   S S S . .
        1   . o S . .      o = the free pocket cells
        0   o o S . .          (0,0) (0,1) (1,1)
            0 1 2 3 4  x       head at (1,0)

*Static own-body barrier (the first arm):* region `{(0,0),(0,1),(1,1)}` = 3.
`fear = sqrt(7/10) = 0.837`. **A strong fear of nothing.**

*This design's schedule:* `O[i]` opens at `t ≥ 8 − i`.
`t=1 {(0,0),(1,1)}` · `t=2 {(0,1)}` · `t=3 (0,2)=O[5] opens` ·
`t=4 (0,3)=O[6], (1,2)=O[4] open` · `t=5 (0,4), (2,2)=O[3], (1,3)` — `|R| ≥ 10`.
`fear = 0.000`. The snake is chasing its own tail and it is fine, which is what
the rules say.

The test pins both numbers, so a regression to a static barrier is visible as a
number and not as a behaviour change nobody can attribute.

**P2 — THE TRUE TRAP, which needs another unit.** Ours: `A`, length 4, head
`(1,1)`, body `(1,2) (1,3) (1,4)`. Enemy `E`, length 6, occupying column 0 from
`(0,0)` up to `(0,5)`, head `(0,0)`. Enemy `F`, length 4, along row 0 from
`(2,0)` to `(5,0)`, head `(2,0)`.

`A`'s legal steps are `(1,0)` south, `(2,1)` east, `(0,1)` = `E`'s body, `(1,2)`
= its own neck. The last two are certainly fatal and `staging-safety.ts` already
refuses them; the two survivable options are what the fold has to tell apart.

* **east, `(2,1)`** — settled `A = (2,1) (1,1) (1,2) (1,3)`, open board north and
  east, `|R| ≥ need = 6` inside three turns. `fear = 0.000`.
* **south, `(1,0)`** — settled `A = (1,0) (1,1) (1,2) (1,3)`. At `t=1` every
  neighbour is barred: `(0,0)` is `E[0]` (`0 ≤ 5−1`), `(2,0)` is `F[0]`
  (`0 ≤ 3−1`), `(1,1)` is its own `O[1]` (`1 ≤ 3−1`), `(1,-1)` is wall. The front
  is empty. `(1,1)` opens at `t=3` — but `E`'s unbarred front holds it at `t=1`,
  so clause (d) bars it for good. `kept = 1`, `fear = sqrt(5/6) = 0.913`.

A gap of `0.913 × 3 / |ours|` between the two options: five times `momentum`'s
reversal charge, a third of the lightest death. The unit that takes the south
option dies of `bodyBlock` on the next turn, and the test asserts that too by
stepping the real engine.

The suite also runs `laws.ts` R1/R2/R3 over P2 with `E` and `F` held, at both
the production and the material-only profile — the same shape the first arm's
suite had, which is the part of it that was right.

**A runner scenario, `pocket`**, added to `SCENARIOS` (`local-game.ts:1487`):
`snakes`' three teams of two on an 11×11 with four wall blocks placed to make
corridors, and `foodTarget` lowered to 3 so snakes grow long enough to box
themselves. It exists because `snakes` produces 4 bodyBlock+self deaths in 30
turns over five seeds, which is too few to move; the instrument (§7.2) is what
says whether `pocket` produces more, and it is measured on the BASELINE build
before anything is written.

### 7.2 The instrument, and it goes first

`entrappedAt(board, turn)` in `src/tests/local-game.ts`, in the shape
`readPickup` (`:963-1020`) already established: read off the board the turn
LEFT, asking the rules rather than reconstructing them. Every unit is held with
`observedTurn = arrivalTurn − t` for `t = 1 … k`, so `computeClaims` answers
where each unit could be and what it certainly still occupies at each turn of
the horizon (`claims.ts:309`), and the barred flood of §3 runs against that with
nothing uncertain — the collapsed reading, `lo === hi`, on the concrete board.

It follows `bounds/loud.ts:19-34`'s rule for what an instrument may do: it
counts. It settles nothing, evaluates nothing, reads no clock, and makes no
evaluator call — so under the runner's node clock (`nodes × NODE_COST + reads ×
READ_COST`) **it cannot move a counter**, and it is mergeable on a gate that
says "byte-identical" and means it.

New counters on `GameMetrics` and `RunSummary.counters` (`local-game.ts:1512`):

| counter | what it is |
|---|---|
| `entrappedUnitTurns` | living trail unit-turns with `kept < need` |
| `entrapmentEpisodes` | transitions free → entrapped, so a unit stuck for five turns counts once |
| `fatalEntrapments` | episodes ending in that unit's death while entrapped or on the next turn |
| `escapedEntrapments` | episodes ending with the unit free again |
| `entrapmentLeadSum` | Σ over fatal episodes of (death turn − first entrapped turn) |

The log line gains `ENTRAPPED <id> kept=<n>/<need>` on the turn an episode
opens, so a transcript can be read.

`entrapmentLeadSum / fatalEntrapments` is the mean warning in turns, and it is
the number that answers the first arm's post-mortem directly: *the case rests on
a horizon the instrument doesn't measure.* This instrument measures it. If the
lead is 0–1 turns, no member can act on it and the design is withdrawn; if it is
3+, a term at weight 3 has three turns of gradient to work in.

---

## 8. Pre-registered predictions and the gates

Two builds, five seeds, `--nodes` (the deterministic mode), `sum` over
`snakes,mixed,sparse,potions,pocket` at 30 AND 60 turns, JSON summaries diffed
by `scripts/ab-compare.js`. Baseline is `stable/one-engine-lens-v2`.

### Step 1 — the instrument alone. Byte-identical, merged on its own.

* **G-1 · COSTS NOTHING.** Every JSON summary except the five new counters is
  byte-identical to the baseline's on all five boards, both turn counts. A
  single differing byte fails it.
* **P-1 · THE FALSIFIER, AND IT IS READ BEFORE ANY MEMBER IS WRITTEN.** On
  `snakes` at 30 turns the baseline's 4 bodyBlock+self deaths are preceded by
  `fatalEntrapments ≥ 3`, at a mean lead ≥ 2 turns. **If `fatalEntrapments ≤ 1`,
  or the mean lead is < 2, those deaths are not entrapments the horizon can see,
  and this design is withdrawn rather than measured.** That is the discipline the
  first arm lacked: it built the member, then discovered the instrument could not
  see its mechanism.
* **P-2 · SPARSE IS EMPTY.** `entrappedUnitTurns = 0` on `sparse` at both turn
  counts (13×13, two teams of two, bodies short, region always ≫ `need`). This
  PRE-QUALIFIES G-5: if it is not zero, the byte-identity gate below is void and
  must be replaced before the member is judged against it.
* **P-3 · THE POCKET BOARD EARNS ITS PLACE.** `entrapmentEpisodes` on `pocket` is
  at least 3× `snakes`' rate per 100 unit-turns. If not, `pocket` is dropped
  rather than kept as a board that flatters the member.

### Step 2 — the barred dilation and the fixture. No behaviour change.

The flood, the barrier boards and `entrapment.test.ts`, with `roomSum` still
reading the OLD `owned`. Byte-identical on all five boards again (the new code is
computed and unread — the shape `08-DEPTH-VERDICT.md:88-107` calls the correct
one for a precondition: installed while it cannot move anything, and therefore
installable on a gate that can see a change).

### Step 3 — the repair. The only commit that changes behaviour.

* **G-2 · SOUNDNESS.** `laws.ts` R1/R2/R3 green on the existing corpus, the two
  acceptance boards and P1/P2, at both profiles.
* **G-3 · NO NEW INVERSION SIGNATURE.** Measured on the SAME build, not against
  zero — §1.1. The 990-per-game `[finite, −Infinity] B0/B1` signature is
  pre-existing at HEAD and must be unchanged; any signature not present in the
  baseline's own trace fails the gate.
* **G-4 · SNAKE-ONLY A/B (the gate the first arm failed).** On `snakes` at 30
  turns: bodyBlock+self `4 → ≤ 3`; total deaths `5 → ≤ 5`; `meals/100` within
  ±3%. At 60 turns: deaths `17 → ≤ 15`. **And the mechanism, not only the
  outcome:** `fatalEntrapments / entrapmentEpisodes` must FALL. Episodes
  themselves may rise — entering a pocket is not dying in one, and a bot that
  never enters one is a bot that has stopped competing for ground.
* **G-5 · SPARSE BYTE-IDENTICAL.** Conditional on P-2. No pocket ever forms, so
  every `fear` is 0 in both readings, the fold is arithmetically unchanged, and
  the summary must be byte-identical. This is the cleanest evidence available
  that the repair is inert where it should be inert.
* **G-6 · MIXED, AND THE PIECES UNTOUCHED.** On `mixed` at 30 and 60 turns:
  deaths not up; `meals/100` within ±3%. The term is exactly 0 for a piece, so
  any change on `mixed` must be attributable to its snakes, and the per-cause
  breakdown must show it.
* **G-7 · THE ACCEPTANCE POSITIONS RE-PINNED, NOT DELETED.**
  `territory-acceptance.test.ts:262-296` currently pins `owned` at `25/3`,
  `15/3`, `3/3`, `12/4` and the squeeze arc `10 → 5 → 10 → 16`. Each is re-pinned
  as `kept`, and **B's boxed snake `b0` must read `kept < need` at turn 7**,
  nine turns before it dies. If the repaired quantity does not fire on the one
  board in the suite that was chosen because a unit suffocates on it, the repair
  has not repaired anything.
* **G-8 · THROUGHPUT.** `nodes` per decision within ±5%. The flood is
  `O(need × k)` per our trail unit per reading (a few dozen cell tests) against a
  per-unit whole-board plane fill and popcount that goes away (§4.3); the honest
  prediction is a wash, and a regression past 5% fails.

### What would make this design wrong

Stated in advance, because the first arm's post-mortem could not say it:

* **P-1 fails.** The deaths are not preceded by a measurable shortfall. Then the
  bot's bodyBlock deaths are one-turn blunders, `staging-safety.ts` owns them,
  and no region term will help.
* **G-4's ratio does not move while episodes fall sharply.** The bot has bought
  its survival by refusing ground, which is `reach` losing an argument it should
  win. Conservative is not the same as timid, and the meals gate is there to
  catch it.
* **G-7's `b0` does not fire.** The geometry is wrong, whatever the constructed
  boards say — a fixture proves it for one board, and B is a real position from a
  real match in which the unit actually died.
