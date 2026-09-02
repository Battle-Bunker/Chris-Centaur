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

## Results

(Filled after the run — the section above is committed first.)
