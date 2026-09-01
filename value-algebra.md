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

## 3.2 THE FOLD IS EMPIRICALLY VALIDATED — one coefficient, three rosters, 27× of effect

§3's fold is not an argument. It is testable against the replays already on disk, and it
passes. For each game I summed, per bot, the weight destroyed by each of its unit deaths,
priced three ways, and regressed the paired within-game `sharePar(T−M)` on each — **through
the origin, one pooled coefficient for all three cells, no per-cell tuning** (144 games):

| predictor of sharePar(T−M) | pooled k | R² | worst per-cell residual |
|---|---|---|---|
| deaths avoided (the count) | 0.523 | 0.677 | 0.395 |
| weight saved (count × balance) | 0.128 | 0.638 | 0.315 |
| **folded weight — Σ (K/W)(1−p)·w_u at the moment of death** | **2.919** | **0.866** | **0.085** |

Per-cell, the folded model against observation:

| cell | observed sharePar(T−M) | model | residual |
|---|---|---|---|
| snake6 | +1.620 | +1.705 | −0.085 |
| snake5-queen | +0.536 | +0.472 | +0.064 |
| snake5-knight | +0.060 | +0.056 | +0.004 |

**A single-parameter model reproduces effect sizes spanning 27× across three rosters that
were chosen precisely because they behave differently.** The nesting tells the whole story:
counting deaths is wrong (it ignores the balance destroyed); counting weight is better;
folding through the live share state `(K/W)(1−p)` is right. Each refinement is exactly one
term of §3's derivative, and each one buys accuracy.

Three consequences worth stating flatly:

1. **`room: 3` is wrong by a factor the engine can compute for free.** The correct
   coefficient on a unit's death hazard is `(K/W)(1−p)·w_u`, and every quantity in it is on
   the live board. This is not a parameter to fit — it is a parameter to *stop hard-coding*.
2. **k ≈ 2.92, not 1.0.** Preventing a death is worth about three times the instantaneous
   share value of the weight preserved. That is the compounding premium of a live account:
   a unit that survives keeps eating, keeps denying, and keeps the team out of the
   elimination tail. It is the one honest free parameter in the fold, and it is now measured
   rather than guessed.
3. **The residual is small enough that the remaining structure is second-order.** Whatever
   territory, ordering and potions are doing beyond "keep valuable units alive in
   share-adjusted terms", it accounts for less than 0.09 sharePar on any of these cells.

### 3.3 A negative result that matters: unit count adds nothing

I expected team survival to need its own term — a team dies only when *all* units die, a
conjunction, so a "survival buffer" seemed like it should carry independent value. It does
not. Predicting final sharePar from mid-game (turn 60) state, over 141–144 team-observations
per cell:

| cell | corr with weight | corr with **weight share** | corr with unit count | **partial corr with unit count, given weight share** |
|---|---|---|---|---|
| snake6 | +0.804 | **+0.870** | +0.815 | +0.067 |
| snake5-queen | +0.848 | **+0.878** | +0.597 | −0.100 |
| snake5-knight | +0.375 | **+0.447** | +0.181 | −0.283 |

**Weight share is a sufficient statistic; unit count adds nothing once you know it.** So the
algebra needs no separate survival-buffer term, and an evaluator whose objective is
"maximise expected terminal weight share" is aiming at the right target — which is the
strongest available vindication of the currency choice itself. (Note also the knight cell's
weak +0.447 against the others' +0.87: even *mid-game weight share* barely predicts the
final result there. Another face of the dead instrument.)

### 3.4 EVERY `(ours − theirs)` BALANCE IS CALIBRATED FOR A TWO-TEAM GAME

The share derivative is **asymmetric**, and the asymmetry is forced by the metric rather
than chosen:

    ∂S/∂w_ours = (K/W)(1 − p)        ∂S/∂w_theirs = −(K/W)·p

At three teams at par (p = 1/3) that is **2 : 1** — a unit of our own weight is worth twice
a unit removed from an enemy. The two coincide only at p = 0.5, i.e. **a two-team game at
parity**. The owner's default shape is three teams.

Now grep the evaluator collection for how the two sides are combined:

```
territory.ts:648       balance: open === 0 ? 0 : (ours - theirs) / open
potion-control.ts:281  balance: reachable === 0 ? 0 : (ours - theirs) / reachable
```

**A symmetric difference hard-codes an exchange rate of 1 : 1.** Both of the collection's
headline positional balances are therefore calibrated for a two-team game and are being run
on three-team boards, where the correct rate is 1 : 2. This is not a weighting preference
that a sweep could discover — it is a coefficient the metric determines and the live board
supplies.

**And in `potionControl` the error compounds, because the two sides are not even the same
channel.** A potion *we* control opens a window in which we **remove enemy weight** — the
`p` channel. A potion *they* control opens one in which they **remove our weight** — the
`(1 − p)` channel. So:

> **At three-team par, a potion the enemy controls is worth twice a potion we control**, and
> the module counts them 1 : 1. Threats are systematically under-weighted by 2×.

**A separate sign error, in the same module's own caveat.** The header states:

> *"Their window counts weight they could remove from ANY team that is not theirs, third
> parties included. Under the share metric that still costs us — their share rises when
> anyone else's weight leaves the board…"*

That is signed backwards. If team B removes δ from third party C, then W falls by δ and

    ΔS_ours = −∂S/∂w_C · δ = +(K/W)·p·δ  >  0

**Third-party damage raises our score.** Our share rises too, for the same reason theirs
does. So the third-party component of "their window" is a small *positive* for us, and
entering the whole of their window negatively over-values denial on exactly the multi-team
boards the owner plays. (The portfolio memo's §1 has this right — `∂S/∂w_enemy = −(K/W)·p`
for *any* other team — so the two artifacts disagree and the module is the one that is
wrong. Worth reconciling explicitly, since `theirsAgainstUs` already exists as the
correctly-scoped half and is simply not the headline.)

This does **not** license free-riding, and the distinction matters: the measured null on
free-riding (0.274 against 0.333 by chance) is about *declining to fight*, which forgoes our
own `p`-channel gains and lets a searcher prey on us. Third-party damage being mildly good
for us is a statement about the *sign of a term*, not a strategy.

**The fix is one derived quantity, and the data is already held.** The substrate carries
team numbering (`teamNumbers`/`teamLabels`) and per-unit `weight`, so `(K, W, p)` is one
pass over `roster()`. But `grep` finds **no team count and no share computation anywhere in
the evaluator collection** — the share state is simply never formed. That single missing
triple is exactly the difference §3.2 measured between R² = 0.638 and R² = 0.866.

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

## 4.3 ADMISSION VERSUS PRICING — what the VALUE side wants the combination law to be

The composition lens established that the shipped move-selection law is not the additive
sum the socket declares, but `gainOrderKey` — a twelve-slot hand-written lexicographic
comparator — and that `candidateCap: 8` closes the candidate set *after* that comparator
sorts and *before* anything is priced. I verified both (`candidates.ts:1556`, `core.ts:383`).
That changes what my algebra has to say, and it turns out to sharpen it rather than
complicate it.

**The two channels have the same bug.** Reading `gainOrderKey` with the account algebra in
hand:

```
captureRank = (c) => c === 'yes' ? 2 : c === 'maybe' ? 1 : 0;     // candidates.ts:1497
if (a.foodGain !== b.foodGain) return b.foodGain - a.foodGain;    // foodGain is 0 or 1
```

**Not one of the twelve slots scales with weight.** Capturing a weight-31 queen ranks
identically to capturing a weight-2 snake. `tierRisk` grades tier exposure without asking
what balance is exposed. `contingencies` is a count. So the ordering channel is blind to
account balance in exactly the way `room: 3` is blind to it in the additive channel.

> **The additive channel's bug and the lexicographic channel's bug are the same bug: both
> freeze a magnitude relation that the board sets at runtime.** A fixed coefficient asserts
> "this flow is always worth 3 cells"; a fixed precedence asserts "this flow always
> dominates that one". Both assertions are true only at some particular balance
> configuration, and §2 measured balances varying 15× across rosters.

**So the law should be additive — but the currency is the deliverable, not the law.**
Choosing "additive" without a common currency merely reintroduces arbitrary weights.
Lexicographic ordering exists in this codebase because the emissions are *incommensurable*:
you cannot add `foodGain: 1` to `shadowBonus: 3`. Once every emission is a weight-flow rate
folded by §3.2's validated derivative, addition becomes meaningful and precedence becomes
*derivable* instead of declared.

And then the composition lens's three options stop being alternatives:

> **Lexicographic and additive are the two limits of one parameter.** With
> `balanceFactor = w_u^γ`: at γ = 0 all accounts are equal and the fold is purely additive;
> as γ grows, the fattest account's flows dominate every comparison, and in the limit the
> order is lexicographic by balance-at-risk. Banded is the interior. **The combination law
> is not a mode to select — it is a coordinate to set**, and it is the same γ that §6 hands
> the operator. That is what "cleanly parameterizable at the joint" should mean.

**Banding is legitimate only when derived, and this game has exactly one real band.** A
death is not a marginal loss — it wipes the whole account (`playerScores[id] = dead ? 0 :
length`). That discontinuity is a genuine band boundary, and it is *computed* from the
balances rather than declared as a slot position. On snake6 all bands coincide (equal
balances) and behaviour is additive; on the queen board the queen's band separates sharply.
Same law, different behaviour, driven by state. That is what the twelve-slot comparator was
groping for when it put tier and capture on top — it had the right instinct and froze it at
one board's magnitudes.

**Admission must be a bound, not a preference.** Pricing answers "of these plans, which
maximises ΔS"; admission answers "which plans could possibly maximise ΔS". Those are
different questions and only the second one is allowed to discard. A comparator sorts by
preference and truncates, which can silently drop the argmax — and the code comment says as
much: *"a collection that never enters the priced set cannot be valued by any evaluator,
however loudly that evaluator prices it."* The value-side replacement:

> Drop a plan only when its interval **upper** bound on ΔS lies below the **lower** bounds
> of at least `candidateCap` other plans.

This is sound — it can never drop the true best — and it is no more expensive than the
comparator provided the bounds are the coarse per-flow priors the portfolio memo already
proposes as shadows. It also degrades honestly: when bounds are wide the admitted set stays
wide and the search must either spend more or admit that it is guessing, which is exactly
the information a fixed cap currently destroys.

**Which flows belong in ordering, and which in evaluation.** The criterion is not importance
— it is *bound width per unit of cost*:

| channel | carries flows that are… | examples |
|---|---|---|
| **ordering** (cheap, pre-admission) | exactly known or boundable by one bitboard op, and *wide* enough to separate plans | does this move eat (inflow, 1 bit); does it step into a strictly-higher tier's reach (transfer risk, one AND); does it drop escape cardinality below threshold (outflow, one popcount); **the balance at risk (one lookup — currently absent)** |
| **evaluation** (priced, post-admission) | needing the expensive kernel — ordered ray walks, the partition | slider attack vectors, voronoi inflow, defence-line shadowing |

By that rule the shipped comparator is miscomposed in both directions: it carries `edgeEv`
and `shadowBonus` (expensive to compute, narrow in effect) as slots, and it omits balance
(one lookup, and the widest-magnitude factor in the whole system).

### 4.4 This reconciles "ordering is the lever" with "weights do nothing"

The two histories were never one puzzle, and the algebra says exactly how they compose:

- **Ordering controls the support** of the value distribution. `potionOrdering` moved the
  support (+55% pickups, free) because it admitted plans that were previously never seen.
- **Evaluation controls the choice within the support.**
- **k5's null is the correct value of that support change.** Per §4.1 a potion is a
  multiplier on the transfer flow, worth `Σ[P(win|tier+1) − P(win|tier 0)]·w_v` — identically
  zero when no fat enemy account is reachable, which is exactly the boards k5 ran on. So
  `potionOrdering` widened the support in a direction of zero value, and both findings are
  true simultaneously.

**And a cheap diagnostic that may explain "4× weights flat-to-worse" outright.** If the
eight admitted candidates are homogeneous in feature `f`, then `w_f` is inert *at any
value* — scaling it reorders nothing because there is nothing to reorder. Nobody has
measured the spread of each feature **across the admitted set**; the acceptance tests
measure spread across all legal candidates, which is a different and much larger number.

> **Instrument: per decision, the spread of each feature over the `candidateCap` admitted
> plans, not over the legal ones.** Prediction: `reach` and `room` spread over the admitted
> eight is near zero on most turns, because the top slots (tier, capture, `foodGain`) select
> plans already similar in territory. If that holds, the entire weight-sweep history was
> measuring an inert coefficient, and no amount of re-weighting was ever going to move it.

This is the cheapest decisive measurement I have found anywhere in the program: it needs no
games, no new evaluator, and one counter in the existing candidate pipeline.

### 4.5 Conceding the γ overreach, and deriving the twelve slots

**The composition lens is right and I withdraw the strong form of §4.3's claim.** γ is a
risk-concentration *exponent inside the currency* (`balanceFactor = w_u^γ` on outflows). It
is not a general lexicographic-versus-additive interpolation. A lexicographic band emerges
as the γ→∞ limit only where a band boundary is an *unbounded balance ratio*, and this game
supplies exactly one such boundary — the account wipe. **One dial does not reproduce twelve
slots, and I should not have implied it does.** What the currency does buy is narrower and
still worth having: the law is additive over a weight-flow currency, with one
risk-concentration parameter and one derived band.

That leaves the question the lens actually asked. Walking `gainOrderKey`'s slots against the
currency, with the code checked rather than inferred:

| # | slot | is it a value flow? | where it belongs |
|---|---|---|---|
| 1 | `tier` (`'safe'\|'atRisk'\|'doomed'`) | **no** | soundness floor — see below |
| 2 | `tierRisk` (`tierGrade` + `selfDebuff`) | yes — outflow: P(death) × `w_u` | priced fold |
| 3 | `regicideShot` | yes — transfer of a whole *team's* weight (the elimination step) | priced fold |
| 4 | `capture` (`yes\|maybe\|no`) | yes — transfer, and it must carry `w_v` | priced fold |
| 5 | `foodGain` (0/1) | yes — inflow, exactly +1 weight | priced fold, or ordering (exactly known, 1 bit) |
| 6 | `potionGain` | yes — a *multiplier* on the transfer flow, not an addend | priced fold, as a coefficient |
| 7 | `shadowBonus` | yes — outflow reduction, and it must carry `w_u` | priced fold |
| 8 | `edgeEv` | yes — inflow rate over a horizon | priced fold |
| 9 | `healthSpent.hi` | yes — outflow: exhaustion hazard × `w_u` | priced fold |
| 10 | `contingencies` | **no** | value of information — see below |
| 11 | `candidate.to` | **no** | determinism |

**Nine of eleven are value flows the currency subsumes.** Their precedence ordering is
exactly the frozen magnitude relation §4.3 objects to, and each becomes a term with a
computed coefficient rather than a slot position.

**The three survivors are not value at all, and that is the concession — a real residual
domain for precedence-as-data, with a principled boundary:**

- **`tier` is a lattice bottom, not a low number.** `SafetyTier` is documented as *"the
  safety tier a set-level filter keeps whole"*, and `calibration.ts` states the rule
  independently: *"DEAD is a lattice bottom applied by replacement and never by addition."*
  A doomed move is not badly-valued, it is **outside the domain of the value function**.
  Encoding it as a large negative number is precisely the error that makes a dial able to
  buy a suicide, and §6's hard boundary on knobbing material is the same observation. So
  this slot must stay a precedence and must never become a weight.
- **`contingencies` — *"how many held units' claims this move's outcome rests on"* — is
  bound width, not value.** It orders by how much is unknown. That is the value-of-information
  channel the shadow machinery owns, and it is a *search-control* quantity: it should decide
  what to resolve next, not what is worth more.
- **`candidate.to` is determinism.** A tiebreak, and it should stay one.

So the boundary is not a compromise between two mechanisms — it falls out of the type:
**the currency governs everything denominated in weight; precedence governs the three things
that are not (the soundness bottom, information, and determinism), and none of the three can
be given a coefficient without a category error.** That is a cleaner statement than either
memo started with, and it is what I would ask the socket's declared law to say.

### 4.6 The potion identification: CONFIRMED for two facts, and it does NOT extend to k5

The lens proposes that the potion 4×-weights null and the potionOrdering win are the same
fact measured twice. **Confirmed, and the code says so in as many words.** The pickup slot
carries its own note (`candidates.ts:1565-1571`):

> *"Zero on every bot that does not set `potionOrdering`, so this line is inert in the
> shipped comparator."* … *"a collection that never enters the priced set cannot be valued by
> any evaluator, however loudly that evaluator prices it."*

With `potionOrdering` off, `potionGain` is identically zero across every candidate, so the
admitted eight are selected without reference to potions and are **homogeneous in
potion-gain**. A homogeneous feature has zero spread over the admitted set, so its weight is
inert at any value — hence "4× weights, flat to worse". Turning the slot on makes the set
heterogeneous, pickups get admitted, and pickups rise 55%. One mechanism, two observations,
and the remedy for the first verdict follows: **"volume is not the lever" was a statement
about ADMISSION, not about potion value, and should be withdrawn as untested rather than
carried as a finding about potions.**

**But the identification stops there, and this matters because the two verdicts need
different remedies.** k5 was run with `potionOrdering` **on** — admission already fixed,
pickups up 30–51% and monotone — and still returned a clean null at every `effectTurns`. So
k5 is *not* an admission artifact; it is a measurement of potion value taken after the
admission defect was repaired. It cannot be dissolved by the homogeneity argument, and
attempting to would be the mirror of the error we are correcting.

What §4.1 says about it instead: a potion is a coefficient on the transfer flow, worth
`Σ_v [P(win | tier+1) − P(win | tier 0)] · w_v`, which is identically zero when no fat enemy
account is reachable in the window. k5 ran on `potion-snake6` and `potion-snake5-knight`
shapes — **boards on which §2 measured that no account exceeds ~3.** So the null is correct
*for those boards* and says nothing about boards where `w_v ≈ 30`.

| standing verdict | is it an admission artifact? | remedy |
|---|---|---|
| "4× potion weights do nothing" | **yes** | withdraw; measure admitted-set spread (P1b) |
| "potionOrdering wins +55% pickups, free" | **yes — same fact** | keep, but state it as a support change, not a value finding |
| "potions never pay at any `effectTurns`" (k5) | **no — measured post-fix** | re-test on a fat-account board (P4); do not generalise from thin-account boards |

### 4.7 CORRECTION: the cap does not bind where we both assumed it did

Before the homogeneity instrument is built, one structural fact changes where to point it.
`candidateCap: 8` is not one cap, and on the units it is usually discussed about it **never
fires**. From `cluster-enum.ts:259-263` and its own census comment:

```
maxJointsPerCluster: 512,     // "three units at the shipped candidateCap: 8"
enumCandidateCap:      8,     // non-sliders
sliderCandidateCap:    4,     // sliders
```
> *"The census says **98.9% of team-turns have every non-slider component at ≤3**."*

And `topCandidates` (`order.ts:166`) is `cap >= candidates.length ? candidates : slice`.

| unit | legal options | cap that applies | binds? |
|---|---|---|---|
| snake | ≤3, in 98.9% of team-turns | `enumCandidateCap: 8` | **essentially never** — every legal move is admitted and priced |
| slider (queen, rook) | tens (the portfolio memo counted 71 for a queen) | **`sliderCandidateCap: 4`** | **always, and brutally — ~94% of a queen's options are discarded** |
| the joint | product over units | `maxJointsPerCluster: 512` | binds on a six-snake roster (3⁶ = 729 > 512) |

Three consequences, and they cut in different directions for the two lenses:

1. **On snake boards, "weights do nothing" cannot be a per-unit admission artifact.** The
   ordering truncates nothing there. Whatever suppressed the weight sweeps on snake rosters
   is either the *joint* cap or — more likely — a **gradient** problem: three adjacent
   destinations barely move a whole-board aggregate. That is a different diagnosis with a
   different remedy (per-unit credit assignment, which `TrailRoom.owned` already computes and
   nothing consumes) and it should not be folded into the admission story.

2. **On slider boards the admission defect is real and severe** — four candidates kept out of
   ~71, chosen by a comparator in which *nothing scales with weight* (§4.3).

3. **And the two defects land on the same unit.** The queen is simultaneously the unit whose
   safety flat `room: 3` under-prices ~15× (§3) *and* the unit whose option set is cut by 94%
   by a balance-blind comparator — while holding **80–91% of its team's entire score** (§2).
   That is one blind spot, balance-insensitivity, expressed once in each channel, converging
   on the single unit that decides the game. It is the most concentrated defect I have found,
   and it explains why territory keeps only a third of its edge on the queen board while
   being exactly the right *kind* of heuristic there.

**So the homogeneity instrument should be split by unit class, and its prediction is
different for each:**

| unit class | predicted admitted-set spread | diagnosis if confirmed | remedy |
|---|---|---|---|
| snakes | ≈ spread over *all* legal moves (no truncation) | gradient, not admission | per-unit credit assignment |
| sliders | ≪ spread over all legal moves (4 of ~71) | admission | choose the 4 by a balance-aware sound bound, not a weight-blind comparator |

This does not refute the composition lens's identification in §4.6 — potion pickups are a
*membership* change (does a pickup destination appear at all), which the ordering controls
for every unit class, including snakes where the cap does not bind, because the pickup slot
also drives the joint-enumeration order under the 512 cap. It does mean the instrument must
report spread **by unit class**, or a snake-board null and a slider-board hit will average
into a misleading nothing.

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

**P0 — the fold replaces the coefficient.** Set the safety term's coefficient to
`(K/W)(1−p)·w_u · k` with k ≈ 2.9 from §3.2, computed live, instead of the constant
`room: 3`. Every input is on the board; nothing is fitted. Predicted: recovers most of the
queen-board deficit, no-ops on snake6 (where the fold is near-constant across units), and
does nothing on snake5-knight (nothing to protect). This supersedes P1 below, which is its
cruder ancestor — P1 scales by balance only, P0 by the full validated derivative.

**P1 — the weight-scaled safety term.** Scale `room` (and `healthEconomy`'s exhaustion
half) by `w_u`. Predicted: **a no-op on snake6** (equal balances ⇒ scaling is a constant),
and a **large gain on snake5-queen**, concentrated in queen-survival rate. If it moves
snake6, the mechanism in §3 is wrong. Cheaper to implement than P0 and a valid first probe.

**P1b — the admitted-set spread instrument (§4.4).** Measure each feature's spread over the
`candidateCap` admitted plans. Predicted near-zero for `reach`/`room` on most turns. **No
games required.** If confirmed, every weight sweep in the program's history was measuring an
inert coefficient, and that single fact reframes the whole additive-channel record.

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
5. **The rook cell — pre-registration, and a first partial reading.** The rook is the
   discriminator between "slider" and "weight accumulator": it sweeps fewer new cells per
   turn than a queen. This memo predicted, before any rook data existed, that it would land
   **between the two, closer to the queen, ordered by final piece weight rather than by
   mobility class**. First four complete games (`rl5`, still running — treat as indicative
   only, n = 4):

   | roster | piece weight, territory | piece weight, material |
   |---|---|---|
   | snake5-queen (n=48) | 31.2 | 28.7 |
   | **snake5-rook (n=4)** | **26.0** | **18.0** |
   | snake5-knight (n=48) | 3.0 | 2.8 |

   Consistent with the prediction so far. The prediction that actually discriminates is on
   the *score*: G(territory − material) on the rook cell should land between +0.06 and
   +0.54 and nearer the queen's, and should be predicted by the folded-weight model of §3.2
   using the rook cell's own measured deaths — **a one-parameter out-of-sample forecast with
   k = 2.919 already fixed by the other three cells.** If it misses, §3.2 is overfitted to
   three points and should be treated as such.

6. The fold in §3.2 is validated on the **outflow** channel only. Inflow (food capture) and
   transfer (contest/sever) are folded by the same derivative in the algebra, but I have not
   tested them separately — the deaths channel simply dominates these cells. A board where
   growth rather than survival decides would be the honest test of the other two, and none of
   the cells I have is one.

7. The per-cell CIs on weight-saved are wide on two of three cells (queen: [−4.2, +0.8];
   knight: [−1.7, +1.1]). The pooled regression is driven substantially by snake6, which has
   by far the largest signal. The R² = 0.866 is a genuine improvement over 0.677/0.638, and
   the residual ordering is right on all three, but this is 144 games and three rosters, not
   a law.
