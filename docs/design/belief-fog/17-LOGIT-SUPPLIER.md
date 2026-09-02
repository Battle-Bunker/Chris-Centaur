# opp/logit@1 — the moment-constraint repair, measured

The librarian's answer to the 15-doc refutation (their doc 20 @ beb3499),
implemented and fitted. The refuted supplier's diagnosis ("the true joint is
optimized within the solution set, not uniform over it") names the classical
fix: maximum entropy over the solution set SUBJECT TO an expected-value
constraint — the Gibbs measure P ∝ exp(β·V) on the solution set. β=0 is the
refuted solutions supplier; β→∞ is argmax; the family is McKelvey-Palfrey
logit quantal response, the standard one-parameter boundedly-rational
opponent model.

## Slate consequence (recorded before the numbers)

If any β>0 fits, the D2 slate COLLAPSES: uniform (= β=0 on a C0-only store),
solutions (= β=0), best-response (= β→∞) and the QR family are one supplier
`opp/logit@1(β, V)` — a genuine no-single-member joint without
constants-in-disguise. β enters fitted-with-provenance per ruling 49. The
free V is, in the build item, cluster-enum's own surrogate Ṽ — and domain
17's max-plus/sum-product identity (argmax = β→∞ of the same factor-graph
computation) means ONE (graph, β) module can serve the search's
action-selection AND the opponent model over teammates, read at two
temperatures. Coordination note to the search lens: if both get built,
build ONCE — the shared module is theirs to own, this supplier is its β<∞
reader.

## Harness fit v0 (declared)

V is FIXED at the food potential V_u(a) = −L1(a, nearest food) (0 when no
food) — one parameter total (β), no search surrogate available to a
replay-only harness. A failure at every β refutes logit-with-food-V only.
Gibbs marginals computed in the same pass as solution counting (exact
backtracking ≤20k product; self-normalized importance sampling above,
declared, degenerate at large β). Detached units read softmax(β·V) over
their own support (their solution set IS the support). β grid
{0, 0.25, 0.5, 1, 2}; β̂ = grid argmin of coupled log-loss.

## Pre-registered predictions (committed before the full run)

- **P1 (mechanical):** logit(β=0) ≡ solutions to the digit, every stratum.
- **P2 (the librarian's constructive claim, scoped):** on COUPLED, log-loss
  decreases from β=0 to an interior grid minimum β̂ > 0, improving on BOTH
  solutions and uniform. This is the repair claim: the moment constraint
  moves mass back onto contested-desirable cells.
- **P3 (my registered prior, contra the librarian's throwaway "β irrelevant
  on detached"):** β is NOT irrelevant on detached (softmax-food is not
  uniform), and it does NOT beat uniform there at any β — finding 1 says
  the support is the model, and the hard food supplier lost by +0.65.
  β̂_detached = 0. An upset here would be loud news.
- **P4 (the librarian's, adopted):** little movement at CONTACT (V has no
  attack term); improvement there anyway would itself be informative.

## Results (same corpus: 1,412 games / 1,155,029 decisions; full tables in results-v2-full.md; run 6m09s at load 0.70)

| stratum | uniform | solutions (β=0) | logit .25 | .5 | 1 | 2 | β̂ |
|---|---|---|---|---|---|---|---|
| coupled (n=117k) | **2.1936** | 2.2124 | 2.2915 | 2.4120 | 2.6399 | 2.8840 | **0** |
| detached (n=1.04M) | **1.0250** | 1.0250 ≡ | 1.0369 | 1.0719 | 1.1796 | 1.3453 | 0 |
| contact (n=183k) | **1.1316** | 1.1339 | 1.1539 | 1.1978 | 1.3158 | 1.4851 | 0 |

- **P1 PASSED** (β=0 ≡ solutions to the digit, both strata — the tripwire).
- **P2 REFUTED**: no interior minimum exists — coupled log-loss is monotone
  INCREASING in β across the whole grid. The moment constraint made the
  supplier strictly worse at every β. β̂ = 0, which equals the already-
  refuted solutions supplier, which loses to uniform.
- **P3 PASSED as registered** (detached worsens at every β>0; the
  librarian's "β irrelevant on detached" was indeed wrong as stated, in the
  direction I registered).
- **P4**: contact moves the same worsening way; no informative improvement.

## The reading — what actually got measured

The scoped caveat fires exactly as written: this refutes
**logit-with-food-V**, and the refutation is informative about V, not about
the family. Three points now form a line on this population:

    uniform-over-support  BEATS  every hand-directional weight tried
    (food point-mass +0.65; cover +0.10/+0.41; solutions +0.019;
     Gibbs-food at any β>0: worse still)
    and loses only to the engine DEFAULT on piece strata.

Two hypotheses, distinguishable by future work: (i) the V is wrong — the
population optimizes the search's own surrogate, not L1-food, and the build
item (logit over cluster-enum's Ṽ) is untested by a replay-only harness;
(ii) the population is nearly DETERMINISTIC (our bots are deterministic mod
seed), so there is no action-level randomness for ANY smooth likelihood to
fit — apparent contamination is model misspecification plus state-pooling,
and β̂ shrinks to 0 whenever V misaligns with the true policy's value.

**The instrument upgrade this yields (the constructive residue — AS
AMENDED by librarian C58 @ b649c7d):** the V-alignment meter's idea stands;
its statistic as I first proposed it does not. β̂ FLOOR-SATURATES: with a
near-deterministic expert (hypothesis (ii)), a slightly-misranking V and a
totally-wrong V both pin β̂ at 0 — the MaxEnt-IRL identification failure —
so β̂ cannot GRADE candidate Vs, which is the meter's whole purpose. The
librarian mints **R-8b** for the pattern (bounded-statistic trap from the
floor side: saturation destroying gradation, the mirror of manufacturing
structure at a ceiling). The corrected meter is **RANK-BASED**: pairwise
order agreement between V and played choice, plus mean normalised rank of
the played move under V — correct for us SPECIFICALLY because the
comparator consuming any V is an ordering, so V need only be right up to a
monotone transform, which is exactly what rank statistics measure and
Gibbs-likelihood fits do not. And hypothesis (ii) has a name and a one-pass
separator (**M72**): conditional entropy of the played action under
progressively richer state descriptions — collapse to ≈0 means a
deterministic population (the corpus cannot identify ANY smooth supplier;
the meter MUST be rank-based), a plateau means genuine stochasticity. The
value lens is running both amendments against their folded-flow V; the
search surrogate Ṽ enters the rank meter, not a β̂ fit, when it becomes
exportable.

**Process note, recorded because it is the second instance:** the
librarian's doc 20 mislabeled the detached-stratum prediction; my
pre-registration of the OPPOSITE (P3) caught it at zero cost — as with the
solutions supplier's coupled-gain clause, registering a specific prior
against an incoming claim is what converted a wrong sentence into a clean
measurement instead of a propagated error. The discipline pays both ways:
it killed my over-claim (15-doc) and their mislabel (here), before either
reached a bot.

## Slate consequence, corrected

The collapse claim is NOT earned yet: the family exists, is well-typed, and
its only fitted point on this corpus is β̂=0 ≡ the refuted solutions
supplier. `opp/logit@1(β, V)` stays in the slate as the FAMILY of record
with two fitted-with-provenance parameters pending a V worth tilting toward;
uniform-over-support remains the reference and default-on-pieces the only
admissible non-uniform supplier. The shared (graph, β) module note to the
search lens stands — with the added datum that the module's β<∞ reading is
only as good as the V it shares, which their surrogate is the first real
candidate for.
