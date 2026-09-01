# THE VALUE ALGEBRA — weight accounts, account-wipe hazard, and why territory "collapses"

Design memo, VALUE lens. Branch `design/value-evaluation` off `origin/primary`.
Nothing here is shipped; every number below is measured from replays already on disk.

---

## 0. SUMMARY IN ONE PARAGRAPH

Value in this game is not a bag of additive positional terms. It is a set of **per-unit
weight accounts** with three flows — inflow (food capture), outflow (death, which wipes
the *whole* account at once), and transfer (contest/sever, which moves weight between
accounts) — folded onto the score by the share derivative. The current evaluator prices
safety in **cells** (`room: 3`, flat per unit) when the game prices it in **weight at
risk**. That single missing factor explains, quantitatively, all three rungs of the R1
evaluator ladder, including the knight/queen asymmetry the coordinator found — and it
explains them better than any hypothesis about how territory prices mobility, because
territory's *behaviour* is equally degraded by both piece types. What differs is what
the board lets that behaviour be worth.

---

## 1. WHAT THE R1 LADDER ACTUALLY MEASURED

All three cells are byte-identical in configuration except **one roster slot** and the
seed base (verified by diffing the replay headers: 25×25, 3 teams × 6 units, 2000 ms,
turnCap 120, potions on at 0.15, food 0.5). So every difference below is attributable to
swapping one snake for one piece, per team.

Mined from `$SP/continuous/rl1` (snake6), `rl4` (snake5-queen), `rl3` (snake5-knight),
48 games each, both arms pooled. Paired within-game, territory − material:

| cell | earlyDeaths (t≤40) | total deaths | eliminations/game | elim(T−M) | **sharePar (T−M)** |
|---|---|---|---|---|---|
| snake6 | −1.312 [−1.71,−0.92] | −3.500 [−3.95,−3.05] | 0.73 | −0.312 [−.45,−.18] | **+1.620** |
| snake5-queen | −0.250 [−0.80,+0.30] | −0.271 [−0.61,+0.07] | 1.04 | −0.167 [−.30,−.03] | **+0.536** |
| snake5-knight | −0.167 [−0.60,+0.27] | −0.167 [−0.62,+0.29] | 0.12 | +0.000 [−.06,+.06] | **+0.060** |

**Read the middle columns before the last one.** Territory's *behavioural* edge over
material — how many fewer units it loses — is statistically indistinguishable between the
queen board and the knight board (−0.271 vs −0.167, CIs overlapping and both containing
zero). Territory is *equally* degraded by both pieces. Yet the score differs 9×.

So the knight/queen asymmetry is **not an evaluation asymmetry. It is a score-conversion
asymmetry**: the same behavioural edge pays +0.536 where teams are eliminated 1.04×/game
and +0.060 where they are eliminated 0.12×/game.

This refutes the working hypothesis as stated ("a territory metric prices a queen roughly
right, and misprices a knight"). Territory has its piece term switched **off** in this
ladder (see §2.1) — it prices neither. §3 gives the mechanism that does explain it.

### 1.1 The knight makes the cell a dead instrument

Score = share × K. Share only moves a lot when a team's weight leaves the denominator,
i.e. on elimination. A team is eliminated only when *all six* of its units die.

Piece deaths per 48 games, by bot:

| | queen board | knight board |
|---|---|---|
| lobster-territory | 4 | **1** |
| lobster-material | 14 | **3** |
| reflex | 48 | 40 |

`moveGrammar.ts:27` — *"A jump crosses no edge, so a knight can never contest one."* The
knight is the only unit in the game that traverses no edges: it cannot be blocked, cannot
be intercepted mid-path, and always has up to eight landing squares regardless of how
crowded the board is. For a searching bot it is **effectively immortal**.

An immortal unit is a floor under team survival. P(team eliminated) ≤ P(its knight dies),
and that is 1/48 for territory. Consequently:

- 48/48 knight-board games reach the turn cap; **0** end by elimination.
- Pooled sharePar SD collapses to 0.582, against 0.898 (snake6) and 0.998 (queen).
- All three contenders land within 0.14 of par (0.935 / 0.995 / 1.070).

**The snake5-knight cell cannot return a positive for any evaluator, because its outcome
variable barely moves.** The +0.060 is not evidence that territory misprices leapers. It
is a measurement taken with an instrument whose needle is glued. This must be said
plainly before the program builds a leaper term on the strength of it.

**Methodological consequence, general:** the roster is not merely "a board to test on" —
it sets the *sensitivity* of the outcome variable. A roster containing a hard-to-kill
unit converts the game from an elimination game (score ≈ {0, 1.5, 3}, huge variance,
cheap measurement) into a pure share game (score ≈ 1 ± ε, tiny variance, needs enormous
n). Cells should be ranked by measured elimination rate before blocks are spent on them.

---

## 2. WHAT THE QUEEN BOARD ACTUALLY IS

Final unit weights, last turn, 48 games:

| board | piece weight (if alive) | all five snakes together | **piece share of team weight** |
|---|---|---|---|
| queen, territory | **31.2** | 2.0 | **91%** |
| queen, material | **28.7** | 2.2 | **80%** |
| knight, territory | 3.0 | 5.5 | 54% |
| knight, material | 2.8 | 5.0 | 57% |

A queen slides along rays and eats everything it traverses; it grows to 30–49 while the
snakes around it are ground down to 2. **On the queen board, one unit holds four fifths of
the team's entire score.** On the knight board no account exceeds ~3.

And the score is a step function of that one unit's survival:

| bot | sharePar, queen alive | sharePar, queen dead |
|---|---|---|
| lobster-territory | **1.881** (n=44) | 0.362 (n=2) |
| lobster-material | **1.537** (n=36) | 0.345 (n=7) |
| reflex | — (n=0) | 0.212 (n=13) |

Territory keeps its queen alive 96% of the time; material 84%. Reconstructing the effect
from nothing but those two rates and the two conditional means:

    territory  0.96 × 1.881 + 0.04 × 0.362 = 1.82
    material   0.84 × 1.537 + 0.16 × 0.345 = 1.35
    difference                              = 0.47   vs   measured +0.536

**Queen-survival rate alone reproduces ~88% of the measured effect.** On the knight board
the same conditional is flat (material: 0.957 alive vs 0.907 dead) — the knight's survival
is worth nothing, because the knight holds nothing.

### 2.1 And the ladder's territory seat has its piece term off

`calibration.ts:101`, in `DEFAULT_WEIGHTS`, which `TERRITORY_PROFILE` (`name:
'lobster-territory'`) uses verbatim:

```
  /**
   * The piece-command term — OFF here, and off is the honest default: it is
   * the slider repair, and it has its own profile so the two can be measured
   * against each other. See `TERRITORY_SLIDER_PROFILE`.
   */
  command: 0,
```

`cells.js:184` — `const FIELD = ['lobster-territory', 'lobster-material', 'reflex']`. The
ladder always seats the command-0 profile. Pieces are excluded from plane 1 by
construction (it partitions by *trail* units), and `room` is defined per trail unit, so
with `command: 0` **no territory feature gives a piece any positional signal at all** —
on either piece board.

`lobster-territory-x` (`TERRITORY_SLIDER_PROFILE`, `command: 2`) exists, is shipped, and
was never seated in R1. The standing verdict — *"territory evaluation beats
material/reflex by +1.6 on all-snake boards but collapses to zero the moment a piece is
fielded"* — is true of a profile whose piece term is switched off. It is not a statement
about territory evaluation. **Recommend the ladder seat `lobster-territory-x` on every
piece cell before any of R1's piece rungs is treated as a verdict.**

Note this is a *second, independent* defect: even with `command: 2`, §3 says the safety
term would still be mispriced by an order of magnitude on the queen board.

---

## 3. THE JOINT: WEIGHT IS HELD IN ACCOUNTS, AND DEATH WIPES ONE WHOLE

Three facts from the rules, which together fix the type of value.

1. **Weight is per-unit occupancy length.** `TeamSnekProcessor.ts:915` —
   `playerScores[id] = deadPlayers.has(id) ? 0 : newSnakes[id].length`. Team weight is a
   sum over units of a per-unit balance.
2. **Death is total.** A dead unit scores 0, not a reduced amount. Losing a unit removes
   *its entire balance* in one event.
3. **Weight is also the contest comparator.** `turnEngine.ts:437` — arrivals onto a body
   rank tier first, then strictly-greater weight. Weight is simultaneously the score
   numerator and the strength stat that decides every fight.

So each unit is a **weight account** with a balance `w_u`, and three flows:

| flow | what it is | who has it |
|---|---|---|
| **inflow** | food captured → balance grows | every unit; rate set by how much *new* space the unit sweeps per turn |
| **outflow** | death → the whole balance is wiped | every unit; rate set by escape geometry under crowding |
| **transfer** | contest / sever moves weight to another account or to nothing | gated by the tier-then-weight comparator |

Fold onto the score with the share derivative (`S = K·w/W`):

    ∂S/∂w_ours  = (K/W)(1 − p)          ∂S/∂w_theirs = −(K/W)·p

    ΔS  =  (K/W) · [ (1−p)·( Σ_u inflow_u − Σ_u P(death_u)·w_u )
                     +   p ·( Σ_v P(death_v)·w_v − Σ_v inflow_v ) ]

**The term `P(death_u) · w_u` is the whole finding.** Safety is worth the *balance it
protects*. The shipped evaluator carries `room: 3` — a flat coefficient, identical for
every unit — so it prices a weight-31 queen's safety and a weight-2 snake's safety the
same. On the queen board that is a **15× mispricing on the unit that holds 91% of the
score.**

### 3.1 One mechanism, all three rungs

| cell | account structure | is flat `room` right? | observed |
|---|---|---|---|
| snake6 | six accounts, all ~equal and small | **yes, approximately** — equal balances make the flat weight correct up to a constant | territory dominates, **+1.62** |
| snake5-queen | one account holds 80–91% | **no** — under-prices the decisive account ~15× | edge survives but shrinks 3×, **+0.536** |
| snake5-knight | no account exceeds ~3 | vacuously — nothing to protect | nothing accumulates, nothing is measurable, **+0.060** |

The territory evaluator is not a space heuristic that happens to work. It is a **survival
heuristic** (`room` is the death predictor; the calibration comment says so) that is
correctly normalised only when all accounts hold equal balances. Snake boards satisfy that
by construction. Piece boards violate it, and the violation is proportional to the weight
concentration the roster produces.

That reframes the coordinator's slider/leaper intuition rather than discarding it. The
right statement is not "rays are territorial and jumps are not". It is:

> **A queen is a weight accumulator (long rays sweep much new space per turn → high
> inflow; balance reaches 30–49). A knight is not (eight landing squares → inflow like a
> snake; balance stays ~3).** Territory-as-inflow-estimator is therefore *relevant* on a
> queen board and *irrelevant* on a knight board — and territory-as-safety is mispriced on
> a queen board and pointless on a knight board.

Inflow and outflow are both functions of the same geometry, read two different ways —
which is exactly why one algebra can hold them both, and why a bag of additive cell-counts
cannot.

---

## 4. THE ALGEBRA — ONE TYPE FOR ALL FIVE HEURISTIC FAMILIES

Every heuristic in the portfolio emits the same thing: a **rate on a named flow, attached
to a unit**.

```
Contribution {
  unit      UnitId          -- whose account
  flow      'in' | 'out' | 'transfer'
  side      'ours' | 'theirs'
  rate      interval        -- weight per turn, [lo, hi] (the two-world discipline)
  horizon   turns over which the rate is asserted
}
```

The fold is then fixed, and has **no free per-term coefficients at all**:

    ΔS = (K/W) · Σ_c  sign(c.side) · shareFactor(c.side) · c.rate · c.horizon · balanceFactor(c)

    shareFactor(ours) = (1 − p)      shareFactor(theirs) = p
    balanceFactor(c)  = w_u^γ  for c.flow == 'out'   (weight at risk)
                      = 1      otherwise

Where every existing and proposed term lands:

| family | emits | notes |
|---|---|---|
| `material` | the balances themselves (`w_u`), not a flow | the state, not a rate — the base of the fold |
| `reach` / voronoi | **inflow**: contested food arrival rate | the memo's food channel; `q · f · η`, η fitted from the archive |
| `room` | **outflow**: box-in hazard × `w_u^γ` | today: hazard × 3. The `w_u^γ` factor is the fix |
| `slider attack vector` | **transfer, theirs→nothing** | natively in weight already; needs no conversion (the memo is right) |
| `defence line` / shadowing | **outflow reduction, ours** | `w_u^γ` applies here too — shadowing the queen ≠ shadowing a spawn snake |
| `potion tier` | **not a term at all** — a multiplier on `P(win)` inside every `transfer` | this is why it never paid as an additive term (see §4.1) |
| `healthEconomy` | **outflow**: exhaustion hazard × `w_u^γ` | exhaustion is 25–28% of deaths on these boards; same missing factor |

**Only two free parameters survive the refactor**: `γ` (risk concentration) and the
per-flow conversion efficiencies, which are fitted from the archive rather than tuned.
Everything the current profile expresses as five hand-set coefficients becomes either
derived (share factors, computable from the live board) or measured.

### 4.1 Why potions never paid, in this algebra

k5 measured a clean null at every `effectTurns` despite +30–51% more pickups. In this
algebra that is predicted, not surprising. A potion does not add value; it **multiplies
the win probability inside the transfer flow** for three turns. So its value is

    Δ(transfer) = Σ_v [ P(win | tier+1) − P(win | tier 0) ] × w_v

which is **identically zero when there is no `v` worth taking** — no enemy account with a
balance on a ray you can reach in the window. The current implementation adds a potion
term to a sum; the algebra says it is a *coefficient on another term* and is worth exactly
zero in isolation. Collecting more potions with nothing to spend them on is measured
correctly as nothing.

This also says where potions *would* pay, sharply and testably: **a queen board.** There,
`w_v` for the enemy queen is ~30, and one tier-severing crossing on a weight-30 account is
worth more than an entire snake board's potion supply. The k5 null was measured on
`potion-snake6`/`potion-snake5-knight` shapes — boards with no large accounts to attack.
**Do not close "potions never pay" on evidence drawn only from boards with no fat
accounts.**

### 4.2 What this says about `material: 10` vs the territory weights

The cliff inequality (`calibration.ts:106`) protects the trade by comparing an ordering
term's spread against `10 × (lightest unit weight)`. On a board where weight is
concentrated, the unit whose loss actually decides the game is the **heaviest**, not the
lightest. The inequality is calibrated against the wrong extreme exactly when it matters
most. Under the algebra the cliff is not a separate convention at all — it falls out of
`balanceFactor`, because a death is already priced at the balance it wipes.

---

## 5. WHAT THE ENGINE API MUST EXPOSE

To make these flows cheap and composable, and nothing more than these:

1. **Per-unit arrival grid** (`earliest(c)` per unit) — exists (`UnitShells`), already
   paid for by the sweep. Inflow and outflow both read it.
2. **Per-cell "new space swept this turn"** — the derivative of the arrival grid over a
   unit's own candidate destination. This is the per-unit-action class the portfolio memo
   identified; it is what separates a queen (high) from a knight (low) *without naming
   either kind*.
3. **Escape cardinality under crowding** — count of a unit's legal destinations not
   occupied at arrival, and its gradient as occupancy rises. This is the outflow hazard's
   natural input, it is kind-agnostic, and it is the quantity that makes a knight immortal
   and a queen mortal **as a number rather than as a special case**.
4. **Ordered ray crossings** (`crossings(unit, dest) → [{ray, cells, occupants, tier,
   weight}]`) — the portfolio memo's §3.0 kernel; already built as
   `evaluate/ray-crossing.ts` on the potion branch. Transfer reads it.
5. **The live share state** `(K, W, p)` — one scalar triple per turn, feeding the share
   factors. Trivially cheap and currently not exposed to the fold at all.

Note what is *not* needed: no per-kind branches anywhere. Kind enters only through (2) and
(3), as measured rates. `moveGrammar.ts` already declares that everything downstream is
property-driven ("the engine never asks what kind a unit is"); the evaluator should hold
the same line, and today it does not — `command` is a kind-shaped patch.

---

## 6. KNOBS AS NATURAL COORDINATES

The owner wants live dials. In a bag-of-terms evaluator a dial is a patch on a
coefficient. In this algebra the dials are the algebra's own free parameters, and each has
a meaning an operator can hold in their head:

| knob | range | what it means to a human | today's behaviour |
|---|---|---|---|
| **γ** — risk concentration | 0 … 2 | "protect the big units" | γ = 0 (flat `room: 3`) |
| **p̂** — assumed share | override of live `p` | "I'm further ahead/behind than the board shows" (a third party is about to be eliminated) | not expressible |
| **horizon** per flow | turns | "play for the long game / grab what's in front of you" | fixed |
| **δ** — deterrence | 0 … 1 | "my opponent has a mind" — multiplies the outflow-reduction half of defence lines | not expressible |
| per-unit scope on any of the above | — | "make *this* queen hunt", "stop feeding my king" | not expressible |

γ is the one to expose first, and it is worth stating why it is a *strategy* dial rather
than a tuning constant: γ = 0 plays every unit as equally expendable; γ = 1 is risk-neutral
in weight; γ > 1 plays to preserve the accumulator at the cost of the periphery. On a queen
board those are three genuinely different, genuinely reasonable strategies, and which is
right depends on the opponent — which is precisely the class of parameter the portfolio
memo argued belongs to the human at the console rather than to a sweep.

**And the dials stay a within-basis recalibration.** Every knob above is a scalar
multiplier on a retained per-flow part, so a knob change is a re-fold, not a re-proof —
provided the bound bank retains per-flow parts rather than folded totals. That is the same
precondition the portfolio memo flagged as the one open dependency on the core rebuild;
this factorization makes it stronger, because the parts are now *named flows* with fixed
semantics rather than an open-ended list of feature contributions.

---

## 7. FALSIFIABLE PREDICTIONS, CHEAPEST FIRST

Each is a claim this memo will be wrong about if it is wrong.

**P1 — the weight-scaled safety term.** Scale `room` (and `healthEconomy`'s exhaustion
half) by `w_u`. Predicted: **a no-op on snake6** (equal balances ⇒ scaling is a constant),
and a **large gain on snake5-queen**, concentrated in queen-survival rate. If it moves
snake6, the mechanism in §3 is wrong. This is the highest-information single experiment
available and it is two rungs of an existing ladder.

**P2 — the ladder's territory seat is the wrong profile.** Re-run snake5-queen and
snake5-knight with `lobster-territory-x` (`command: 2`) in the territory seat. Predicted:
a real gain on the queen board, ~nothing on the knight board (nothing to convert). Costs
two cells, no new code.

**P3 — the knight cell is a dead instrument.** Predicted: *any* arm contrast on
snake5-knight returns |G| < 0.2 with a floor of comparable size, regardless of what is
varied. Already half-confirmed: all three contenders sit within 0.14 of par and
`elim(T−M)` is exactly 0.000 [−0.058, +0.058]. Cheapest confirmation: check the A/A floor
against the treatment spread rather than spending blocks.

**P4 — potions pay on fat-account boards.** Predicted: the k5 null does *not* replicate on
`snake5-queen` with potions on, because the transfer flow finally has a `w_v ≈ 30` target.
This is the one place the standing "potions never pay" verdict is at risk, and it is worth
one cell before that verdict is written into doctrine.

**P5 — elimination rate predicts measurable effect size.** Across cells, |G| between any
two non-trivial evaluators should scale with the cell's measured eliminations/game.
Observed so far: 0.73 → +1.62; 1.04 → +0.536; 0.12 → +0.060. (The queen board breaks
monotonicity in eliminations because the effect there is gated by *which* unit dies, not
how many teams do — the refined predictor is variance of terminal weight share, measured:
SD 0.898 / 0.998 / 0.582.) Usable immediately as a **cell-ranking rule**: measure a cell's
sharePar SD from a handful of games before committing blocks to it.

---

## 8. WHAT THIS MEMO DOES NOT ESTABLISH

1. Nothing here is implemented or measured as a *change*. Every number is a measurement of
   existing replays or a rule read from the engine.
2. `γ` has no fitted value. §7 P1 proposes γ = 1 as the first probe because it is the
   risk-neutral point, not because it was estimated.
3. The queen-board conditional means rest on small dead-queen cells (n = 2 and n = 7). The
   *rates* are well-measured; the conditional sharePar given a dead queen is not.
4. The horizon-1 finding still binds everything (`chosen.horizon == 1` in every telemetry
   record I read across all three cells, 5,000+ decisions per bot per cell). A transfer
   flow that resolves in three turns is invisible to a one-turn search at any weighting.
5. I have not checked the rook cell (running at time of writing). It is the discriminator
   between "slider" and "weight accumulator": a rook sweeps fewer new cells per turn than a
   queen. **This memo predicts the rook lands between the two — closer to the queen than to
   the knight, and ordered by final piece weight, not by mobility class.** That is a clean
   pre-registration.
