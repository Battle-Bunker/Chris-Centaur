# opp/solutions@1 — the canonical-weight claim, measured

Closes the loop M36 opened: solution counting implemented in the log-loss
harness and measured on the same corpus as v0 (13-doc), same population
premise, zero games.

## The constraint system at a full-information decision (v0, declared)

The harness corpus is full-info, so there are no C1/C2 constraints; the
non-trivial system available TODAY is the simultaneity one: per-unit supports
(C0) plus SAME-TEAM SAME-DESTINATION EXCLUSIVITY — rules-certain because own
units contest and kill each other (engine-verified, pinned). Not modeled,
declared: same-team edge swaps; the unequal-weight survivor nuance (the
heavier teammate survives a friendly contest — the exclusion over-constrains
by that corner). The constraint's own empirical contamination is measured
directly: the count of PLAYED same-team same-destination joints.

Coupled subsets = same-team units with overlapping supports (shared
variables = shared destination cells, exactly M36's partition). C40
declaration: exact backtracking enumeration when the subset's joint product
≤ 20,000; otherwise 500 uniform joint samples with valid-only accumulation
(fall back to uniform, counted, if no valid sample lands). Detached units
share uniform's weight OBJECT, so the reduction clause below is mechanical
equality, not an approximation.

## Pre-registered predictions (written before the full run; adapted forms noted)

- **(a) Reduction + coupled gain.** On DETACHED decisions, solutions ==
  uniform bit-for-bit (mechanical; any nonzero delta is a bug). On the
  COUPLED stratum, solutions beats uniform on log-loss with CI clear of
  zero. (Adaptation of "beats uniform wherever C1-visible events exist":
  this corpus has no C1; the coupled/detached split is the full-info
  analogue of store-non-trivial/store-trivial.) The coupled gain also
  retro-tests finding 1's explanation: if the C0-exclusivity solutions
  carry real information, "the support is the model" extends one constraint
  deeper.
- **(b) ε̂(solutions) ≤ ε̂(uniform)** per stratum wherever both are defined
  (a better-centered w leaves less contamination), most visibly on the
  coupled stratum.
- **(c) Contact ordering.** At contact, solutions sits between uniform and
  cover on the pessimism ordering (its toward-enemy mass between theirs)
  and its log-loss ≤ cover's. If it also beats uniform there, it is the
  first supplier both admissible and principled and the est-rung shipping
  question changes shape. Honest prior from this lens: the same-team system
  knows nothing about attacking, so at contact I expect solutions ≈ uniform
  on log-loss, strictly better than cover; I do NOT expect it to beat
  uniform at contact on this corpus.

Instrument predictions: constraint-violation count ≈ 0 (bots do not play
friendly same-cell joints); unresolved-to-uniform ≈ 0.

## Results (same corpus as v0: 1,412 games / 1,155,029 decisions; full tables in results-v1-full.md)

C40 rows: components exact=30,964, sampled=12,061, unresolved=0. Constraint
contamination: **0 played same-team same-destination joints in 1.15M
decisions** — the exclusivity constraint itself is perfect on this
population. Runtime 2m49s (vs 1m42s without the supplier).

| stratum | n | uniform | solutions | Δ | verdict |
|---|---|---|---|---|---|
| detached | 1,037,794 | 1.0250 | 1.0250 | **+0.0000 exactly** | (a)-reduction PASSED, mechanical |
| coupled | 117,235 | 2.1936 | 2.2124 | **+0.0188 ± 0.0075** | (a)-gain REFUTED — solutions is WORSE |
| contact | 182,620 | 1.1316 | 1.1339 | +0.0023 | (c) PASSED in the honest-prior form: ≈uniform, far better than cover (1.5442) |
| ALL | 1,155,029 | 1.1436 | 1.1455 | +0.0019 | — |

ε̂: coupled 0.354 vs uniform's 0.350 (argmin category shifts to toward-food)
— **(b) REFUTED** on the one stratum where it had content; equal elsewhere.

## The verdict, stated against my own claim

The canonical-weight claim FAILS its first measurement. Uniform-over-
SOLUTIONS of the C0-exclusivity system predicts this population slightly but
significantly WORSE than uniform-over-support on exactly the stratum where
the two differ.

**Diagnosis (worked example).** Supports A={x,y}, B={x,z} share cell x.
Valid joints: (x,z), (y,x), (y,z) — solution marginals give each unit 1/3 on
the contested cell vs uniform's 1/2. But contested cells are contested
because they are DESIRABLE (food, the corridor square), and real play
resolves the contention by exactly ONE unit taking x — the true joint is
optimized, not uniform over solutions, and its marginal puts ≈1/2 on x for
whichever unit the team routes there. Uniform-over-solutions depresses mass
on contested-desirable cells — precisely where play concentrates. The
constraint is right (0 violations); the MEASURE built on its solution set is
wrong about where inside the solution set play lives.

**What survives, sharpened.** M36's identification stands — the store, the
coupled-subset partition, and the reduction-to-uniform are all confirmed
mechanically (the detached row is the retro-test of finding 1's explanation:
uniform-over-support IS C0-only solution counting, and it remains the best
predictor). What is refuted is the leap from "canonical" to "calibrated":
the solution set is the right SUPPORT object (a joint-support for the bank's
exclusivity reasoning — 0 violations says the bank could USE it as sound
structure), but uniform over it is not a better weight than uniform over
per-unit supports, because play is optimized within the solution set. The
support/weight boundary of the (S, w) object reasserts itself at the joint
level: constraints belong to S, where they are perfect; the free lunch of a
constraint-derived w was not there. The cover result (13-doc finding 3) now
has a sibling: BOTH derived weights measured so far lose to the support's
own uniform — which strengthens the est-rung conclusion (default-on-pieces
remains the only admissible supplier) and the architecture's support-first
center of gravity.

**Instrument note.** Pre-registration did its job twice in one cycle: the
mechanical reduction clause caught nothing (good — it was a bug tripwire),
and the substantive clause caught an over-claim of my own before any bot
consumed the weight. The joint-support object (solution set as SOUND
structure for friendly-contest reasoning) is queued as the constructive
residue — it belongs to the bank's joint-fold story, not to D2.
