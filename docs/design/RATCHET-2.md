# RATCHET-2 — the five largest law-sweep classes, classified by cause

`src/lobster/evaluate/law-sweep.test.ts` pins nine per-feature R1 classes on
240 generated boards. Eight of them are open; one (`contest.lo`) is closed and
pinned at zero. This document does for the five largest what
`docs/design/contest-gap.md` §2 did for `contest`: it names the READING that is
wrong, per violating world, before any code is touched.

    class          worlds   cause                                    repairable at its cause
    command.hi        600   the ADD side's ground board is the       YES  (§1)
                            reading's OWN domain, and that domain
                            drops every held enemy trail
    reach.hi          220   plane 2 pays out on plane 1's cover,     NO   (§2)
                            and the reading dropped the cover
    reach.lo          128   the same, mirrored onto our own          NO   (§2)
                            contingent trail
    room.lo            73   `barsIn('lo')` admits a crowder only     YES  (§3)
                            from a unit alive in the WORST world
    food.hi            63   a slider's settled cell is contingent    YES  (§4)
                            and `pullOf` reads it as a point

## Method

The sweep's own generator, its own 240 boards, its own worlds — replayed with a
scratch instrument that snapshots, for the partial reading and for every
violating world: each feature's `[lo, hi]`; per unit its kind, held flag,
settled cell, occupancy, `worstAlive`/`bestAlive`, weight bracket, `traversed`
and `fates`; per reading the partition's `ours`, `theirs`, `open`, its `domain`
and `certainDomain` AS BITBOARDS, each unit's arriving front at `turn + 1` and
its cumulative cover over the whole horizon, and both food boards. The
instrument reproduces the pinned tally exactly —
`{food.hi:63, reach.hi:220, command.hi:600, room.lo:73, reach.lo:128,
material.hi:8, energy.hi:10, momentum.lo:27}`, `contest.lo` absent — so the
worlds it classifies are the worlds the ratchet counts. It is not in the tree:
a diagnostic that has to be maintained is a second pipeline, and this one had
one job.

Note what a world IS here. The sweep stages our WHOLE side and holds nothing of
ours; everything held is therefore an ENEMY unit, and a completion world is one
joint reply of the enemy's whole roster. So every class below is a statement
about how a reading answers for the enemy's claim cloud — never about our own
staging.

## 1. `command.hi` — 600 worlds, and 98% of them are one reading

`commandSum` (`features.ts`) prices a piece at the contested ground its own
front can act on next turn:

    command(u) = ( |F_u ∩ domain| · ground + |F_u ∩ food| · food ) / open

and its docstring already states the rule the two readings owe: *a term the
reading ADDS is read off the narrow board, a term it SUBTRACTS off the wide
one, and which side that makes ours is the READING's business.* In `hi` we add
our own pieces, so ours is read off `wide`. `wide` is `partition.domain`.

**The defect is that `partition('hi').domain` is not wide.** `ADMISSION.hi`
drops every HELD unit of theirs, and the trail domain is the running union of
the ADMITTED trail units' arriving fronts. In the sweep every enemy is held, so
the `hi` domain is our own trails' cover and nothing else — while in the world
the enemy trail is on the board and its cover is ground our piece is paid for.
The ceiling therefore sits below its own worlds.

Measured over the 400 sampled violating worlds (the instrument caps a class at
400):

| signal | worlds |
|---|---:|
| world's trail domain ⊄ `partition('hi').domain` | **393** |
| world's trail domain ⊆ `partition('lo').domain ∪ partition('hi').domain` | **400** |
| our own piece's front at `turn + 1` grew in the world | 7 |
| our own settled cell moved | 108 |
| our own alive-set moved | 226 |

Two cause classes:

* **1a — the domain (393/400, 98%).** As above. The 57 worlds where
  `partition('lo').domain` alone does not cover the world are exactly the
  worlds where one of OUR trail units is contingent: `ADMISSION.lo` drops it,
  so the `lo` domain misses its cover. The UNION of the two readings' domains
  covers all 400, and that union is not an accident — it is exactly "every
  trail unit that could be alive": `lo` admits `worstAlive` of theirs and
  `worstAlive ∧ ¬held` of ours, `hi` admits `bestAlive ∧ ¬held` of theirs and
  `bestAlive` of ours, and for either side one of the two predicates is the
  weaker. So the union is the ground plane 1 could contest in ANY world.
  Reproduction: board 28, world 1. `hi` reads `domain` = 24 cells (our snake
  alone) against the world's 46 (our snake plus the enemy snake); our bishop's
  front is 12 cells in both. `command` 0.219 held against 0.273 in the world.
* **1b — the front (7/400, 2%).** `F_u` itself is a contingent quantity: the
  shells step against the REAL settled board for the first unknown turn, and a
  held enemy sits on its observed cells there. A world in which it vacates
  gives our own piece a larger front. Not repaired here — it is a statement
  about `shells.ts`, which is shared by five members and interned per decision,
  so making the first step per-reading doubles the shell cost for 2% of one
  class.

**The repair (1a).** Read the WIDE board — wherever `commandSum` names one, so
`hi`'s ours and `lo`'s theirs alike — as the union of the two readings' domain
boards, taken per word in the counting loop rather than into a third board. The
CERTAIN boards are untouched; a term bounded BELOW still reads the subset. R2
holds because a refinement shrinks both domains, so the union shrinks, `hi`
falls and `lo` rises. R3 holds because with nothing held and nothing contingent
the two domains are the same board.

**Measured: `command.hi` 600 → 65, and the 65 are two further sub-causes, both
refused.** Re-classified with the same instrument on the repaired tree:

| residue | worlds |
|---|---:|
| the WORLD's trail domain is empty, so the open-board fallback fires in the world and hands our pieces the whole board | **35** |
| 1b — our own piece's front at `turn + 1` grew in the world | **30** |

The first is the fallback's own discontinuity: `command` reads "contested
ground" while plane 1 contests anything and the WHOLE OPEN BOARD the moment it
does not, and a world in which our last trail unit dies crosses that step. A
ceiling that covered it would have to take the fallback whenever no trail unit
is CERTAINLY alive — which on these boards is most of them, and which
saturates the term. That is the blanket widening again, and it is refused for
the same reason as §2. The second needs the shells' first step, which is
computed against the real settled board, to be taken per reading; the shells are
interned per decision and shared by five members, so that doubles their cost for
30 worlds of one class. Both are recorded and neither is taken.

**AND THE REPAIR IS REVERTED. It closed 89% of the class and the play refused
it, in the shape `b1-sound` was refused in.** The bound gates were clean —
`command.hi` **600 → 65**, `totalLo` 0, `totalHi` 9, no other class moved, and
`bounds/soundness.test.ts`, `bounds/exact-reply.test.ts` and the whole
`lobster/__tests__` suite green (`lens-cost.test.ts`'s `mixed` recording moves,
which is the same class of re-take its own header records three times, and
`snake` stays byte-identical). Then the play, 60 turns, `--nodes`,
`scripts/ab-compare.js` per board class, never pooled, against `02cd772`:

| board | deaths | deaths/100 | meals/100 | note |
|---|---:|---:|---:|---|
| `snakes` 1–5 | 14 → 14 | 0.910 → 0.910 | 16.895 → 16.895 | every metric 0; `nodes` identical |
| `sparse` 1–5 | 0 → 0 | 0 → 0 | 7.667 → 7.667 | byte-identical |
| `sparse-lean` 1–5 | 2 → 2 | — | 6.85 → 6.85 | byte-identical |
| `mixed` 1–5 | **12 → 14** | 0.608 → 0.771 (**+0.163**) | 18.394 → 19.205 | `edge` 0 → 2 and `wall` 0 → 2, both NEW causes |
| `potions` 1–8 | **21 → 22** | 0.692 → 0.761 (**+0.069**) | 19.517 → 18.861 (**−0.66**) | `edge` 0 → 3; `lost` 4 → 10 |

Deaths are UP on the two classes that have any and down on none — the exact
finding that declined `b1-sound` (`docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md`),
and the two death causes `mixed` gains are the two that
`docs/design/BEHAVIOUR-AUDIT.md` §D1's shipped repair removed. On seeds 1–3
alone it reads the same way: `mixed` 2 seeds up 1 down, `potions` 3 of 3 up.
The mechanism is legible and is the price rather than an accident — widening
the ceiling's ground board pays our own pieces for acting on a held enemy
trail's cover, so a plan that walks past a claim looks better than it is, and
the units walk into edges and walls. **A correct-and-tighter ceiling that loses
more units is not a repair we ship**, by §7.1's own rule; `command.hi` stays
open and stays pinned at 600.

## 2. `reach.hi` (220) and `reach.lo` (128) — plane 2 pays out on plane 1's cover

`reach` is `(ours − theirs)/open` after displacement. Plane 1 gives a cell to
the team whose trail covers it exclusively; plane 2 (`displace`) then reassigns
a cell to a PIECE that arrives by the deciding turn `D(c)` and outranks the
claim standing there. `D(c)` is written only for cells some ADMITTED TRAIL
unit's front reaches: ground no trail walks belongs to nobody, and `displace`
skips it.

**So dropping a trail unit from a reading does not move that reading
monotonically.** It removes the ground that unit would claim — the conservative
half the admission predicate is written for — and it also removes the ground
the OPPOSING side's pieces would have taken off it, which is the optimistic
half nobody accounted for.

Both directions are in the data.

* **`reach.hi` — 220/220 have `ours` LARGER in the world than in the `hi`
  reading**, and `theirs` larger too. 153 of them (70%) are the degenerate
  case: `hi` admits NO trail at all, `decisive` is empty, `ours = theirs = 0`
  and the term reads a flat **0** as though determinate. Reproduction: board 5.
  Our side is one knight; theirs is one held snake. `hi` drops the snake, so
  plane 1 is empty and plane 2 has nothing to displace: `reach.hi` = 0. In the
  world the snake is a mover, our knight displaces 15 cells off its cover and
  it keeps 12: balance +0.083 > 0. The remaining 67 are the partial form —
  `ours` 
  short by the cells our pieces would have taken off the dropped enemy trail.
* **`reach.lo` — the mirror, on our own contingent trail.** 80/128 read
  `ours = 0` with `theirs` short: `ADMISSION.lo` drops our contingent snake, so
  its cover is not decisive, and the enemy pieces standing on it are paid
  nothing. Reproduction: board 412. `lo` reads ours 0 / theirs 32 = −0.500; the
  world reads ours 4 / theirs 48 = −0.688, and the extra 16 cells of `theirs`
  are precisely our dropped snake's cover, displaced by their queen and their
  knight. A further 26 are the flat-zero degenerate case again (board 71:
  `lo` = 0 against a world of −0.028), and 22 are both at once.

**There is no repair at this cause that is not a blanket widening.** A sound
ceiling on `ours` would have to maximise over the enemy's whole world set, and
`ours` is monotone in the enemy's presence in NEITHER direction: admitting the
enemy trail gives our pieces ground to take and takes exclusive ground away.
The only single-sweep bound is
`|(our trails' cover) ∪ (our pieces' cover ∩ any trail's cover)|`, which
saturates on any board with a slider on it — the exact degeneracy
`territory.ts`'s own docstring gives as the reason pieces do not bar in the
kept flood, and the same shape as the `crowdCertain` patch that `room`'s enemy
half was retired to avoid. A term that reads ±1 on every option carries no
gradient, so this would not be a correct-and-looser floor with a price; it
would be the deletion of the member. **Not attempted. The two classes stay
open and stay pinned.**

## 3. `room.lo` — 73 worlds, one predicate, and its polarity is backwards

`room` is a FEAR: `−Σ sqrt(clamp01((need − kept)/need)) / |ours|`, in `[−1, 0]`.
`kept` is the barred flood of `territory.ts` §3, and which units BAR is
`barsIn`:

    lo → s.worstAlive          hi → s.worstAlive && s.bestAlive

with the stated justification *"`lo` is our worst world, so a unit that is
alive in it bars"*. That is the right rule for a term that COUNTS ground, where
a barrier costs the reading. It is backwards for a fear, where a barrier is the
thing being feared: fewer crowders ⇒ larger `kept` ⇒ smaller fear ⇒ a HIGHER
floor.

Our own contingent mover is exactly the unit the two predicates disagree on
(`worstAlive` false, `bestAlive` true), so `lo` floods as though it were not
there. Every one of the 73 worlds has that shape and no other:

| signal | worlds |
|---|---:|
| one of ours is contingent in the partial and alive in the world | **73 / 73** |
| the flooding unit's `kept` FELL from the partial to the world | **73 / 73** |
| the flooding unit's own alive-set, cell, weight or `need` moved | 0 |

Reproduction: board 69. Three of ours — two snakes and a rook. Snake 0 is
contingent; snake 1 floods `kept = 6` against `need = 6` in the `lo` reading,
so `fear = 0` and `room.lo = 0`. In the world snake 0 is alive, its body and
its cloud bar, snake 1 keeps 3 of 6, `fear = √0.5`, and `room = −0.236`. The
floor sat a quarter of the term's whole range above its own world.

**The repair.** `barsIn('lo')` becomes "possibly alive" — `worstAlive ||
bestAlive`. For THEIRS this changes nothing (`worstAlive` is already the weaker
predicate on that side, held or not); it admits exactly our own contingent
movers, as barriers, in the reading that fears them. `hi` is untouched and
`room.hi` has zero violations. `barsIn` is read by `bodyBarriersOf` and
`cloudsOf`, and their output reaches nothing but `keptOf` → `TrailRoom.kept` →
`room`; no other member moves. R2: a refinement can only shrink the
possibly-alive set, so `kept` grows and `lo` rises. R3: with nothing held
nothing is contingent, the two predicates coincide, and the reading is the one
it is today.

**Measured, and KEPT. `room.lo` 73 → 0 — the class is CLOSED — and the play is
flat.** Bounds: `totalLo` 0, `totalHi` 9, no other class moved, `room.hi` still
absent; `bounds/soundness.test.ts`, `bounds/exact-reply.test.ts` and the whole
`lobster/__tests__` suite green with `lens-cost.test.ts`'s recording UNMOVED on
both boards; the sixteen-arm gate `npm run gate:exact` zero floors and zero
ceilings on all sixteen (`mixed` 1–3, `snakes` 1–3, `sparse` 1–3, `potions`
1–6 and 8).

The play, 60 turns, `--nodes`, `scripts/ab-compare.js` per board class, never
pooled, against `02cd772`:

| board | what moved |
|---|---|
| `snakes` 1–5 | every game counter 0 (`nodes` 310 166 → 310 171) |
| `sparse` 1–5 | byte-identical |
| `sparse-lean` 1–5 | byte-identical |
| `potions` 1–8 | every counter 0 on all eight seeds (`nodes` 568 766 → 568 767) |
| `mixed` 1–5 | one seed moves: seed 3 meals/100 **+0.771** and `seedKept`/100 +0.257; deaths, causes, `unitTurns`, `stationary`, `lost` and every other counter flat on all five |

**Deaths up on 0 of 5 board classes and down on 0**, meals up on one and down
on none. That is neutral-or-better per class with a class closed, which is
exactly §7.1's bar; the change is taken. It is also the cheapest of the three
repairs by construction: `barsIn` disagrees with itself only on a unit the
settlement left contingent on OUR side, so on a board where nothing is held
the flood is the flood it always was, and four of five board classes never
reach the line at all.

## 4. `food.hi` — 63 worlds, all 63 a slider halted by a claim

`food` is a positional gradient over our own units: `pull(u) = (1 − d/D)`
scaled by hunger, read at `s.cell`, averaged over our roster. Nothing in it is
contested — and nothing in it brackets, either. `s.cell` for a mover is the
cell the PARTIAL settlement stopped it on, and a held enemy's claim is what
stops it.

This is `contest.lo` again, in a second member. `contest.ts`'s `settlesOn`
names the set — the cells a contingent arrival could settle on: where it got
to, where it set out from, and every cell it entered on the way — and `costOf`
brackets over it. `food` reads the same quantity as a point.

| signal | worlds |
|---|---:|
| exactly one of our units moved cell, and it is a SLIDER | **63 / 63** |
| the engine's own `fates` calls that unit's arrival `contingent` | **63 / 63** |
| the world's settled cell is inside `{cell} ∪ {origin} ∪ traversed` | **63 / 63** |
| any of our TRAIL units moved cell | 0 |

Rook 46, queen 15, bishop 2. A trail unit never appears: a snake steps one cell
and a claim that blocks it kills it rather than halting it, so its arrival is
settled or it is dead. It is the slider's multi-cell path that has an interior.

**The repair.** `pullOf` becomes a bracket over `settlesOn`'s set — `hi` takes
the dearest cell of it and `lo` the cheapest — and stays a point wherever
`fates` does not say `contingent`, which is every unit on a board with nothing
held. `food.lo` has no violations today, but the floor is read as a point by
the same line for the same reason, so the bracket is taken on both ends: a
class that is empty on 240 boards is not a proof, and the asymmetric form would
leave a floor whose justification is "we did not catch it". R3 is untouched
(the set is a singleton with nothing held); R2 holds because a refinement can
only shrink the set of cells a halted arrival could settle on.

The rule is stated in `contest.ts` and is deliberately NOT shared with it here:
`contest.ts` is closed, and re-exporting from it to save eight lines is a
change to a closed member for a reason that is not about its behaviour. The
copy in `food.ts` names its twin.

**Measured: `food.hi` 63 → 0 — and REVERTED. The bracket is `contest.lo`'s
mechanism pointed at the wrong kind of term.** Bounds: the class CLOSED,
`totalLo` 0, `totalHi` 9, no other class moved, `food.lo` still absent;
`bounds/soundness.test.ts`, `bounds/exact-reply.test.ts` and all of
`lobster/__tests__` green with `lens-cost.test.ts`'s recording unmoved. Then
the play, 60 turns, `--nodes`, `ab-compare` per board class, never pooled,
against the `room.lo` head:

| board | deaths | deaths/100 | meals/100 | note |
|---|---:|---:|---:|---|
| `snakes` 1–5 | 14 → 14 | 0.910 → 0.910 | 16.895 → 16.895 | byte-identical |
| `sparse` 1–5 | 0 → 0 | 0 → 0 | 7.667 → 7.667 | byte-identical |
| `sparse-lean` 1–5 | 2 → 2 | 0.206 → 0.206 | 6.880 → 6.880 | byte-identical |
| `mixed` 1–5 | **12 → 16** | 0.608 → 0.818 (**+0.211**) | 18.549 → 17.891 (**−0.66**) | `contest` 9 → 15 |
| `potions` 1–8 | **21 → 23** | 0.692 → 0.765 (**+0.073**) | 19.517 → 19.293 | `self` 1 → 3, `edge` 0 → 1 |

**Deaths up on the two classes that have any and down on none, and meals down
on both** — the same verdict as §1 and for a legible reason. §7.1 records that
`contest.lo`'s bracket works out as *a standing tax on ADVANCING*, because the
commonest contingent world is the one where the move does not happen. That is a
GAIN when the term being taxed is a DANGER: paying the worst cell makes the bot
decline squares it would have lost on, and D1's deaths went down. `food` is a
BENEFIT, and the same tax on the same worlds removes the pull that takes a
slider past a claim toward a meal — so the bot eats less AND, on `mixed`, dies
more in contests, because the gradient that used to separate the food-side
options is flattened while `contest`'s cliff is not. **The mechanism does not
generalise from a fear to a reward**, and that is the finding this attempt
adds. `food.hi` stays open and stays pinned at 63.

## What this document commits to, and what it delivered

It planned three repairs (§1, §3, §4) and two refusals (§2), each repair one
commit lowering exactly one pin, each gated by
`docs/design/decision-lens/08-DEPTH-VERDICT.md` §7.1's two requirements — a
lower number here AND an A/B that is neutral or better per board class, never
pooled. A repair that fails the second is reverted and recorded with its
numbers, exactly as `docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md` records
the last four.

**All three were written, all three were sound, all three lowered their number,
and ONE shipped.**

| class | at its cause | pin | play | verdict |
|---|---|---|---|---|
| `command.hi` §1 | the wide board is the UNION of the two readings' domains | 600 → 65 | `mixed` deaths 12 → 14 (new `edge`, `wall`), `potions` 21 → 22, meals −0.66 | **reverted**, pin stays 600 |
| `room.lo` §3 | a barrier is the thing being FEARED: `worstAlive \|\| bestAlive` | 73 → **0** | one seed of `mixed` moves, meals +0.771; deaths flat on 5 of 5 classes | **kept**, class CLOSED |
| `food.hi` §4 | `pullOf` brackets over `settlesOn` | 63 → **0** | `mixed` deaths 12 → 16, `potions` 21 → 23, meals down on both | **reverted**, pin stays 63 |
| `reach.hi` / `reach.lo` §2 | no bound that is not a blanket widening | — | not attempted | refused at classification |

Two things the ledger now says that it did not before. **A repair whose A/B is
FLAT is the one that ships** — `room.lo` moved one seed of one board and closed
its class, and it is the only one of the three that cost nothing; the two that
moved the play moved it the wrong way, on the same two board classes, in the
same direction, for the second and third time (`b1-sound` was the first).
**And the `contest.lo` mechanism does not transfer from a fear to a reward**
(§4): the same honest bracket over the same contingent settle cell buys deaths
when it prices a danger and costs both deaths and meals when it prices a meal.
