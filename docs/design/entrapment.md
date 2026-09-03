# Entrapment: a member that works at sixty turns, fails its gate at thirty, and turned up a bank inversion on the way

> "The basics of avoiding entrapment and territory management."

## The gap it was for, and it is a real one

`room` (`src/lobster/evaluate/features.ts`) is billed as the death predictor,
and it measures a RACE rather than a REGION. Its `owned` count is plane 1 of the
territory partition — cells this unit reaches strictly before every other
admitted trail unit — computed on the dilation shells, and the shells step
against the real board for the first unknown turn and against the PERMISSIVE
board (every cell a pawn target) for every turn after it. The reason is given in
`shells.ts` and it is a good one: after one unknown turn nobody knows where the
bodies are, and over-approximating is the only direction a reach may be wrong
in.

That is exactly right for a race and exactly wrong for a box. **A snake coiled
into a pocket of four cells has a plane-1 region that walks out through its own
body on the second shell, because on the permissive board its own body is not
there.** So `room` reads it as roomy several turns before it suffocates. Nothing
else in the fold sees a pocket either: `material`'s cliff fires on what kills us
THIS turn, and a unit that steps into a pocket dies next turn or the turn after.

The gap is confirmed, and it is the reason this file exists rather than a note
saying "room already does it".

## The member

`src/lobster/evaluate/entrap.ts`, weight 3, seated at the end of `FEATURES`. A
four-connected flood from the cell the unit ends the turn on, capped at
`need = max(4, len + 2)` cells, with two barrier classes:

* **terrain**, and
* **certain bodies** — every unit's `cells[0 .. len-2]`, which is the set
  `staging-safety.ts` derives from the rules: a trail unit's occupancy next turn
  is `[newHead, cells[0] .. cells[len-2]]`, so the body shifts by one and only
  the TAIL vacates, whatever that unit chooses. A board constant, computed once
  per decision.

```
short(u) = (need − region) / need
exits(u) = free four-neighbours of the destination
fear(u)  = max(short(u), exits ≥ 2 ? 0 : exits === 1 ? 0.5 : 1)
entrap   = − Σ ours fear(u) / |ours|            ∈ [−1, 0]
```

The constructed boards pin it and they pass: a length-6 snake whose own coil
plus the perimeter encloses four cells scores the pocket move at exactly
−(need−4)/need and the open move at an exact zero, the flood counts the tail as
free and the rest of the body as barrier, a corner with one way out is feared at
the exit floor however long the corridor behind it is, and R1/R2/R3 hold on the
pocket board under a held enemy for both the production and the material-only
profile.

## What the runner said

Five seeds, `--nodes`, against HEAD.

**At the mandated 30 turns:**

| board | meals/100 A → B | deaths A → B | bodyBlock+self A → B |
|---|---|---|---|
| snakes | 18.12 → 18.50 | 5 → **8** | 4 → **6** |
| mixed | 16.26 → 16.45 | 9 → 8 | 0 → 0 |
| sparse | 6.83 → 6.83 | 0 → 0 | byte-identical |
| potions | 16.31 → 16.31 | 11 → 11 | byte-identical |

**At 60 turns**, where the death it targets is actually reachable (14 of
`snakes`' 17 deaths are bodyBlock or self at that length, against 4 of 5 at
thirty):

| board | meals/100 A → B | deaths A → B | unit-turns A → B |
|---|---|---|---|
| snakes | 17.07 → 17.49 | 17 → 16 | 1377 → 1395 |
| mixed | 19.63 → 18.89 | 23 → **19** | 1798 → 1853 |

The 30-turn and 60-turn runs are the SAME games — same build, same seeds, same
rng — so these are consistent readings and not a contradiction: the entrap arm
loses three more units in the first thirty turns and four fewer in the second
thirty, for 40 → 35 deaths and +73 unit-turns of survival over the two boards.

An earlier arm (`need = len × 2`, and the enemy's claims admitted as a third
barrier class) was worse and is recorded because the mechanism generalises: on a
six-snake board the enemy field covers a large share of the interior, so every
option a big snake has floods into a fragment, the shortfall saturates, and the
term returns the same number for every move. The trace showed three options of a
length-12 snake in a corner scoring −75.79 apiece on the turn before it coiled
into itself. That is the identical failure `calibration.ts` records for `reach`
on a slider, and the lesson is the same one: **a saturated set carries no
information about the unit's own position.**

## Why it is not seated

The pre-registered gate was "bodyBlock/self deaths on `snakes` and `mixed` down;
meals not down beyond noise", measured at thirty turns. Meals held everywhere.
The deaths did not: `snakes` went 4 → 6 on the two causes and 5 → 8 overall. The
case for the member rests entirely on a horizon the mandated instrument does not
measure, and "more search would show it" is the argument every unmeasured term
has ever made.

## The thing that is worth more than the member

**`basic-intelligence.test.ts` reports zero bound inversions at HEAD and
twenty-three with this member seated — and the member is not the cause.**

    CENTAUR_DEBUG_INVERSION=1 node -e '
      const { runGame, MIXED_SCENARIO } = require("./dist/tests/local-game.js");
      runGame({ ...MIXED_SCENARIO, maxTurns: 100, seed: 3, nodeBudget: 220 },
              { scores: false }).then(() => {});'

At **HEAD, with no member of any kind added**, that command prints

    INVERSION inverted ScoreBounds [-336.54891290527655, -Infinity]: bank floor=B0 ceiling=B1

nine hundred and ninety times. A ceiling of −Infinity under basis B1 against a
finite floor under B0: the narrower basis is applying a terminal clamp the wider
one does not, and the bank is comparing the two. Doubling `contest`'s weight
gives the same 990. Replacing the entrap feature with a CONSTANT `point(-0.5)` —
trivially sound, trivially monotone, trivially collapsing — gives 990 as well.

So the inversion is a property of the bank's cross-basis comparison and not of
any feature's admission contract. What a new term does is change which games get
played, and some of those games reach it: seated, entrap turns up a second
signature, `[254.94, 204.32]: bank floor=B3 ceiling=B2`, a fifty-point gap
between two finite bases that no ordering term is large enough to have created.

The gate "bound inversions must stay zero" therefore passes at HEAD by the route
the games happen to take rather than by construction. That belongs to whoever
owns `bounds/bank.ts` and `search/`, and it should be fixed before the next
member is judged on that gate — because on this evidence the gate is measuring
the search's basis bookkeeping and not the member under test.
