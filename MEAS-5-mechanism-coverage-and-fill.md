# THREE THREADS — the mechanism-coverage producer, cyclicity vs selectability, and the fill spec

---

## 0. A CORRECTION I OWE, FIRST

I reported the fold's 9.7× residual blow-up as **regicide**, with `corr(king present, residual) =
+0.954`. **The correlation stands; the attribution does not.** Two checks retired it:

**(a) The flows are fully accounted on king boards.** The attribution audit — 0.00% on the R1 cells —
is **also 0.00% on king cells and on pawn cells**. So the blow-up is *not* an unmodelled-flow hole.
Whatever regicide does, the weight it moves is counted.

**(b) King presence and piece density are perfectly confounded in this archive.**

| pieces of 6 | king? | cells | example roster |
|---|---|---|---|
| 0 | no | 22 | snake×6 |
| 1 | no | 12 | knight + snake×5 |
| 2 | no | 2 | queen×2 + snake×4 |
| **4** | **yes** | **7** | king, queen, rook, knight, snake×2 |

**There is no 4-piece cell without a king, and no king cell with few pieces. Overlap: empty.** So
"regicide breaks the fold" and "piece-dense boards break the fold" are the same column of data, and
I cannot separate them. I should have run this check before naming a mechanism.

**(c) The denominator-jump hypothesis also fails.** `corr(max single-turn |ΔW|/W, residual) = +0.158`
overall and **−0.230 within king cells** — the quartile trend is confounded with king presence
(12% → 47% king across quartiles), not driven by jump size.

**What survives:** the blow-up is real, large, and localised to mix-king cells; it is not an
accounting hole; and its cause is one of two confounded candidates. §3 specs the cells that separate
them.

---

## 1. THE MECHANISM-COVERAGE PRODUCER FOR `advisoryPrecision`

Current schema (belief lens, `08-CONTRACTS-SKETCH.md`):

```ts
/** Precision the advisory lineup EARNED (quadrature over fitted terms' residual
 *  variances; 0 while unfitted). Fed to belief as its own ObservationKind —
 *  unfitted lineups order floor ties, never move mu. */
readonly advisoryPrecision: number
```

The schema already has the right shape for what I need, and that is the key design point: **an
out-of-coverage term does not need a new refusal mechanism — it needs its residual variance to be
honest, and the existing "orders floor ties, never moves mu" behaviour then falls out as the limit.**

### The producer

```ts
type MechanismId = 'regicide' | 'mutual-annihilation' | 'promotion' | 'cap-adjudication'

interface MechanismCoverage {
  /** Mechanisms this term's accounting identity is DEFINED over. Declared by the
   *  term, checkable against the rules, not inferred from data. */
  readonly models: ReadonlySet<MechanismId>
  /** Measured residual-variance INFLATION when an unmodelled mechanism is present.
   *  fitted-with-provenance. ABSENT means "never measured" and is read as infinite. */
  readonly inflation: ReadonlyMap<MechanismId, number>
}

// board -> the mechanisms it ADMITS, from the config alone, before any play:
//   regicide            <- roster contains a king
//   mutual-annihilation <- always admissible with >=2 teams
//   promotion           <- roster contains a pawn
//   cap-adjudication    <- maxTurns is finite   (i.e. always, at the shipped default)

sigma2_effective(term, board)
  = sigma2_fitted(term) * PRODUCT over m in admits(board) \ term.models of inflation[m]

advisoryPrecision = 1 / SUM over terms of sigma2_effective(term, board)
```

**Three properties this buys, and each answers an objection to the distance version:**

1. **Refusal is a limit, not a special case.** An unmeasured inflation is infinite, so
   `sigma2 -> inf`, `precision -> 0`, and the term lands in the schema's existing
   "orders floor ties, never moves mu" regime. No new control flow, no new refusal type.
2. **It cannot warn hardest where the model is best.** The distance producer did exactly that here:
   the six *farthest* cells had the *lowest* residuals (0.142) while the flagged cells were nearer.
   A mechanism indicator is a property of the board's rules, not of its position in a feature space
   nobody validated.
3. **The list is short, enumerable from the rules, and each entry is a yes/no read off the config.**
   That is what makes it cheap enough to evaluate per board and auditable enough to argue about.

### And what it must record honestly today

For `value/fold-k@1` the map is:

```
models    = { }                       // the fold's identity handles none of these
inflation = { 'regicide': ABSENT }    // measured at ~94x variance on mix-king cells, but
                                      // CONFOUNDED with piece density - see section 0
```

**`inflation` must stay ABSENT (⇒ refuse) rather than be set to 94**, because the 9.7× residual is
not attributable to regicide alone. Writing 94 there would launder a confounded estimate into a
calibrated-looking constant — the exact failure mode the `fitted-with-provenance` discipline exists
to prevent. §3's cells are what would let it be filled in.

---

## 2. CYCLICITY IS NOT SELECTABILITY — thread closed, negatively

Per-cell VBS−SBS restricted to the two significantly-cyclic triples, against per-cell logit cycle
magnitude:

| cell | n | \|logit cycle\| | per-cell best | selection gain |
|---|---|---|---|---|
| null-snake6 | 1284 | **0.601** | territory | **+0.000** |
| c1-owner-queen | 72 | **0.552** | territory | **+0.000** |
| c1-owner-snake | 120 | 0.430 | territory | +0.000 |
| snake5-queen | 516 | 0.428 | territory | +0.000 |
| snake5-knight | 336 | 0.213 | **reflex** | **+0.289** |
| hazard-mix-king | 480 | 0.038 | territory | +0.000 |
| c1-old-flat | 72 | 0.038 | territory | +0.000 |
| headline-mix-king | 1290 | 0.017 | territory | +0.000 |

    corr(|per-cell logit cycle|, per-cell selection gain) = -0.127
    high-cycle cells mean gain +0.0000 (n=4)   vs   low-cycle +0.0722 (n=4)

**A large cycle coexists with a completely stable arm ordering** — `null-snake6` has the largest
cycle in the set and territory wins outright. On reflection this is what the statistic says: a logit
cycle measures inconsistency of *pairwise* win probabilities with a single rating vector, and that
can be large in exactly the saturated regime where one arm dominates every pairwise comparison.

**So cyclicity and selectability are different properties, now measured to be uncorrelated.** This
completes M64: the cycle is not selectable by board family, and it is not associated with per-cell
selection gains either.

**And the one cell with a real gain is the dead one.** `snake5-knight` (+0.289 to `reflex`) is the
cell my own deadness detector rates marginal-to-dead. **That gain is the detector's warning made
concrete: it is selecting noise, and it is the single largest "selection opportunity" in the
table.**

---

## 3. THE FILL SPEC — interpolating rosters, now serving two masters

The cells below are motivated twice over, which is why they are worth the blocks: they locate
POP-3's sign crossing **and** they break §0's confound. Every cell holds board 25×25, 3 teams,
6 units, turnCap 120, budget 2000 ms, food 0.5, potions 0.15, hazards off — the owner shape — so the
only moving variables are roster composition and the presence of a king.

### 3a. The piece-fraction ladder (locates the cycle's sign crossing)

Piece **kind held fixed at queen** so count is the only variable. Existing coverage: 0 (22 cells),
1 (12), 2 (2 cells / 136 games), 4 (7, all with a king). **3 and 5 have never been run.**

| cell | roster | fills |
|---|---|---|
| `fill-q1-snake5` | queen + snake×5 | anchors to existing 1-piece |
| `fill-q2-snake4` | queen×2 + snake×4 | thickens the 136-game column |
| **`fill-q3-snake3`** | **queen×3 + snake×3** | **never run** |
| **`fill-q5-snake1`** | **queen×5 + snake×1** | **never run** |
| `fill-q6` | queen×6 | the far endpoint |

Measured quantity: **the per-cell logit cycle** for `{territory, material, reflex}`. Known values are
+0.601 at 0 pieces and −0.428 at 1 queen, so the crossing is between 0 and 1 and the ladder's job is
to confirm the sign is monotone in piece fraction rather than an artifact of the two endpoints.

### 3b. The confound-breaking pair (the higher-value half)

| cell | roster | why it is the discriminating cell |
|---|---|---|
| **`fill-nok4`** | queen, rook, knight, bishop, snake×2 | **4 pieces, NO king.** If the fold's residual is normal here, the blow-up is regicide. |
| **`fill-king1`** | king + snake×5 | **A king, few pieces.** If the residual blows up here, it is regicide. |

**These two cells alone decide §1's `inflation['regicide']` entry**, which is currently ABSENT and
therefore forcing a refusal. They are the difference between a term that refuses every king board
forever and one that carries a measured inflation.

### 3c. Blocks, from the deadness detector rather than by habit

`MEAS-1` gives the rule: a cell is worth running at spend B iff its between-arm signal exceeds the
A/A floor at B. Piece-bearing cells in the archive show floors around **0.06–0.11** at B=24 and
between-arm signals of **0.3–0.7**, i.e. deadness 5–10. **So 24 games/arm is ample for 3a**, and the
ladder should be run at B=24 first with the option to extend.

**3b needs a different calculation**, because its outcome is a *residual*, not an arm contrast. The
effect it must resolve is the gap between `|resid| ≈ 0.20` (no-king cells) and `≈ 1.95` (mix-king) —
nearly an order of magnitude, so a handful of games per cell suffices to tell which side a new cell
lands on. **12 games/arm is enough for 3b**, and it is the cheapest high-value batch on my list.

### 3d. Seed population, stated per `MEAS-4`

Seeds drawn **uniformly at random** from 1–10⁶ rather than as a contiguous pinned block, recorded in
the spec, so the verdict generalises over the harness's spawn-geometry generator rather than over
eight particular boards. Given the measured 0.427→0.530 spawn-geometry swing this is the single
cheapest bias reduction available, and it costs nothing but writing the draw down.
