# Energy: what a move costs, and when the bot should decline to pay it

> "Pieces are often stupid about wasting health pointlessly when there is no
> food or valuable target within reach. Health is really ENERGY in terms of its
> mechanics. If the marginal value of a move is low, its health/energy cost
> should not outweigh the hold move."

## (a) What a move costs

The rules charge health in one place: `turnEngine.ts` sub-step (e), mirrored in
`PartialEngine.healthPhase`.

* **One health per cell ENTERED**, per sub-step, at the kind's `costPerCell` —
  which is `1` for every kind in `grammar.ts`, snake included. A unit's path is
  one cell per sub-step (`moveGrammar.rayPath`), so:
  * snake, king, pawn (forward or diagonal), knight — **1** per turn;
  * rook, bishop, queen — **the length of the ray**, 1 to 9 on an 11×11
    interior. A queen crossing the board pays nine.
* **A hold costs nothing.** `{ kind: "stay" }` and a pawn's `{ kind: "rotate" }`
  both produce an empty path, `entered` is false, and no health is charged. The
  one exception is terrain: a unit that stages no path still pays one full
  stationary hazard dose at sub-step 1, which is what `restVerdict`
  (`candidates.ts`) already prices. A trail unit has no hold in its grammar at
  all — staging its own square is not a move, and `defaultAction` steps it
  forward — so **only a `stayLegal` kind has an energy decision to make**.
* **Exhaustion is provisional death.** Health at or below zero halts movement
  (`u.status = "exhausted"`); the unit stays a live collision incumbent, and
  the food phase decides. Food is the only heal: a survivor whose head ends the
  turn on a meal is restored to *its kind's* maximum and grows one weight, and
  that includes an exhausted unit — halting on food is the only way one comes
  back. So **a move that eats is free**: the health it spent is refunded in the
  same turn, before the turn closes.
* A capture-stop or an edge win truncates the path at the cell it halted on,
  and the mover pays for the cells it actually entered and no more. Promotion
  clamps health to the promoted kind's maximum (`resolveTurn` step 5); it never
  raises it.

## (b) Where that cost is priced today, and why the bot still moves for nothing

Four findings, and they compound.

1. **The objective has no per-cell price at all above the reserve.**
   `healthEconomy` is the only term that reads health, and `budgetShare` returns
   `min(1, health / (0.5 × max))` for a `stayLegal` kind. Above 50 health it is
   a flat **1**: a queen at 100 that slides seven cells scores *identically* to
   one that holds. Health spending is literally free in the fold for any piece
   above 57 health, and costs `0.5 × spend/50` below it — 0.07 of score for a
   seven-cell slide at 40 health, against a `material` scale of 10 per unit of
   weight. Nothing else in `FEATURES` reads what a move spent.
2. **`momentum` charges the hold and nothing else.** `IDLE_COST` is 0.5 at
   weight 1, divided by our unit count; a move that changes the unit's cell
   pays zero. So with (1), *every* move with a non-negative positional delta
   beats holding, and the bot is biased toward motion by construction. This is
   the single largest thing standing between the owner's observation and the
   fold.
3. **`command` (weight 2) is a positive gradient in position with no matching
   cost.** It pays a piece for the contested ground and food its next-turn
   front covers. That is the gradient the slider repair deliberately added —
   but paired with (1) it says "relocate whenever the front improves at all",
   and the front improves for almost any relocation.
4. **The candidate layer knows the price and cannot spend it.**
   `AssessedCandidate.healthSpent` is an exact interval and `exhaustionFatal` a
   trit, but both enter only the ORDERING (`orderKey`, `gainOrderKey`), and only
   after tier, captures and food. Ordering never licenses a move — and
   `DEFAULT_SWITCH_MARGIN` is 0.01, so any positive scoring difference restages
   away from the cheap seed. The price is measured and then discarded.

Recorded, `mixed` seed 1: `T 2 blue-B queen hp100 (8,2)->(2,8)` — a six-cell
diagonal, no capture, no meal, taken the turn after it ate, at a cost of six
health and a score difference of 0.35.

## (c) The design

A new evaluator member, `energy` (`src/lobster/evaluate/energy.ts`), seated at
the END of `FEATURES` and weighted in `DEFAULT_WEIGHTS`. It is a pure PRICE: it
never pulls a unit anywhere, it only makes spending cost something.

For each of our non-held units of a `stayLegal` kind, all read at the START of
the turn except the spend:

    runway  h   = turn-start health = cells of travel the unit can still buy
    trip    d   = BFS steps from its turn-start cell to the nearest reachable
                  meal (`foodDistance`, the flood `food.ts` already caches), or
                  the board diameter D when no meal is reachable — the honest
                  bound on how far the next one can be
    spend   s   = max(0, h − health after the resolution)   ← the rules' own
                  charge, so an eating move is 0 by the refund and a hold is 0
    share       = min(1, s / h)          the fraction of the runway this move burns
    slack       = clamp01(1 − d / h)     the fraction of the runway NOT already owed
                                         to the trip: 0 when the unit must run now
    scarcity    = clamp01(d / D)         how dear a refill is: 0 standing on a meal

    cost(u)     = share × slack × scarcity                     ∈ [0, 1]
    energy      = − Σ_ours cost(u) / |ours non-held|           ∈ [−1, 0]

`d`, `h`, `slack` and `scarcity` are per-unit CONSTANTS within one decision
(they read the turn-start board), so the term cannot prefer one destination over
another — exactly `food.ts`'s argument for reading turn-start health. Only
`share` varies across a unit's options, and it varies as the rules charge.

**As effect → 0.** The product is zero, exactly, when the move spends nothing
(a hold, a rotation, or a meal — the refund), and when the unit stands on food
(`scarcity = 0`). It is *negligible* when health is abundant relative to the
trip: a piece at 100 health one step from a meal that spends 7 pays
`0.07 × 0.99 × 0.045 = 0.003`, i.e. 0.025 of weighted score against a food
gradient of 4 per unit of pull. That is the required behaviour: a healthy piece
next to food behaves as it does today. It is zero for every snake on every
board, because a trail unit is not `stayLegal` — so a snake-only board scores
`point(0)` here and is bit-identical to today's fold (`add` of an exact zero).

**Starvation cannot be caused by this term.** `slack` reaches 0 when `d ≥ h`:
a unit that cannot afford the trip it must make is charged nothing at all, and
`food` (weight 4, pull → 1 as hunger → 1) keeps sole authority over the hungry.
The term's peak is at `h = 2d`: far enough from a meal to be worth conserving
for, close enough to still afford it.

**Bounds.** `cost ∈ [0,1]` per unit and the sum is divided by our unit count, so
the feature's range is `[−1, 0]` on every board shape and every roster size —
the construction `food`, `momentum` and `contest` use. The cliff inequality
`w × range < 10 × lightest weight` therefore reads `w < 10`.

**Weight: 8.** Not a taste — it is fixed by the term it has to clear.
`momentum` charges a hold `w_m × IDLE = 0.5`, and both terms divide by the same
`|ours|`, so the division cancels and a hold beats a move exactly when
`w_e × cost > 0.5`, roster-independently. At `w_e = 8` that threshold is
`cost > 1/16`: a slider burning a sixteenth of its runway at full price. The
canonical case the owner names — a piece at 60 health, no meal inside its
runway, choosing between a seven-cell slide and a hold — has
`cost = (7/60)(1 − 22/60)(1) = 0.074`, which clears it and nothing much smaller
does. Eight also sits under the cliff ceiling of 10 by construction, and the
largest cost these boards produce is around 0.25, so its realised influence is
~2 against `food`'s 4 and `material`'s 10 per unit of weight.

**Interaction with `momentum`'s idleness charge.** It is NOT suppressed, and
the arithmetic above is why: it is a *deductible*, not a veto. If the energy
price makes the hold the argmax it has already out-paid the 0.5, so the charge
never prevents a hold it should have caused; what it does is set the threshold
under which a piece keeps acting — which is the anti-statue floor the "pieces
act" gate (`stationary% < 12` on `mixed`) measures. Waiving the idle charge
whenever `energy` is nonzero was the alternative; it was rejected because it
pays the hold twice (cheaper to hold AND dearer to move) and removes the only
floor keeping pieces off the statue failure the command term was seated to fix.

## (d) Pre-registered predictions

Measured per board class, never pooled, `src/tests/local-game.ts` at 100 turns
× 5 seeds, energy weight 0 against energy weight 8, everything else identical.

| board | metric | prediction |
|---|---|---|
| mixed | piece health spent per unit-turn | **down** |
| mixed | piece hold share | **up** |
| mixed | exhaustion/starvation deaths | **down or equal** (they are already 0 at 150 ms; then equal) |
| mixed | meals per 100 unit-turns | **not down by more than 10%** |
| mixed | contest deaths | **not up** |
| mixed | dithers, reversals | **not up** |
| mixed | stationary% | **up, and below the gate's 12** |
| snakes, sparse | every counter, byte for byte | **identical** |

A snake cannot hold, so the term must be exactly zero for it; the snake-only
scenarios are the falsifier for that and are checked as a byte diff of the
runner's own trace, not as a summary comparison.

If the measurement contradicts the prediction it is reported as a contradiction.
The weight is not re-derived to make a table green.
