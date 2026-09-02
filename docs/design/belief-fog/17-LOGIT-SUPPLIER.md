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

## Results

(Filled after the run.)
