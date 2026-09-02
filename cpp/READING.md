# The first two CPP curves — a reading

First empirical product of the extended mandate: v0 conditional
performance profiles for the search-arch default bot (`lobster-territory`,
bundle b5 = `claude/cluster-lookahead` @ 79b5f5e), compiled from the rl
replay corpus per `docs/design/time-cpp-spec.md`. Files:
`cpp/snake6-3t-25x25.json`, `cpp/snake5queen-3t-25x25.json`,
`compile-v0.log`. n = 60 seat-turns per stratum (turns 6/18/34/52 across
15+ games, one arm of paired seeds), rungs 125–4000 ms geometric ratio 2,
quality = exact joint-move agreement with the 4000 ms rung, plus a 12-run
A/A repeat of the top rung as the noise ceiling. Provenance: PROVISIONAL,
ms-denominated v0 (wall clock, idle box, load < 0.6 at launch), fresh
engine per decide, agreement-only.

## The two curves

| rung ms | snake6 agree | queen agree | queen hamming | snake6 plans | queen plans |
|---:|---:|---:|---:|---:|---:|
| 125 | 0.950 | 0.733 | 0.114 | 122 | 5.4 |
| 250 | 0.967 | 0.800 | 0.087 | 444 | 18.8 |
| 500 | 1.000 | 0.833 | 0.067 | 1,105 | 70.3 |
| 1000 | 1.000 | 0.850 | 0.064 | 2,428 | 198.7 |
| 2000 | 1.000 | 0.883 | 0.040 | 5,079 | 449.5 |
| 4000 | (ref) | (ref) | — | 10,252 | 962.4 |

Noise ceiling: 12/12 exact agreement on a repeated 4000 ms decision, BOTH
strata — every sub-top disagreement below is signal, not run noise.
(Agreement at 4000 is 1.0 by construction; the curve is read off the
sub-top rungs.)

## Reading 1 — snake6 saturates at ≤ 500 ms; the control behaves as the base rate predicted

On the all-snake board the staged joint move is fully converged by 500 ms
(and 95% converged at 125 ms). From 500 ms to 4,000 ms the bot prices
9,000+ more plans and changes NOTHING it stages. This is the VALUE lens's
10×-budget invariance, now measured as a curve: extra same-horizon breadth
on the snake control buys zero decision changes. The production budget
(9,850 ms) is ~20× past saturation on this board class.

## Reading 2 — the queen curve CLIMBS THROUGH THE TOP RUNG: starved, not overhead-bound

The queen cell is still climbing at every measured rung: 11.7% of
decisions change between 2,000 ms (the budget these games were PLAYED at)
and 4,000 ms, 15% between 1,000 and 4,000 — against a 0% noise floor. The
pre-registered arbitration (`time-cpp-spec.md` §6.3) therefore lands on
**starved → fund ponder-class carried compute**, not on
enumeration-overhead → structural pre-build: enumeration and threads
saturate EARLY (clusterJoints 92 and scoutPlies ~24 by 500 ms;
first-stage 9.6 ms — the toll fix holding), while what keeps climbing is
plan PRICING throughput (449 plans at 2,000 ms vs snake6's 5,079 — the
11× starvation). The scarce good on piece boards is priced plans, so the
window's value lies in carrying/warming VALUE work (priced banks, deep
observations on promoted hypotheses), and the structural-pre-build rung
of the ponder ladder covers at most the first ~500 ms of a turn.
(Amends `time-response-value-redteam.md` §2's guess, which had it the
other way round — the CPP arbitrated exactly as designed.)

## Reading 3 — what the top rung buys over 1 s (the owner's never-had curve)

snake6: nothing — 1.000 at 1 s. queen: 15% of decisions stage differently
at 4 s than at 1 s, 11.7% differently than at 2 s. And 4,000 ms is only a
LOWER BOUND on the queen cell's convergence point — the ladder never saw
it flatten, so the true gap to converged play at production budgets is at
least this large. Live queen-cell games at 2,000 ms were staged
measurably off-curve; every strength conclusion drawn from piece cells at
≤ 2 s budgets carries this caveat.

## AMENDMENT (librarian C48, before any budget reallocation): the arbitration is CONDITIONAL ON MARGIN

A saturating profile is not self-interpreting. Two readings, opposite
remedies: (a) the search extracted what is there → shorten the contract,
fund ponder (the reading above); (b) the EVALUATOR is too coarse for
depth to bite — leaf values do not separate the compared plans, so more
search returns the same ordering, and the remedy is FIX THE EVALUATOR,
after which the saturation LIFTS. Chess history says (b) masquerades as
(a) (Thompson's constant-returns puzzle resolved as weak-evaluator
masking), and our own evidence points at (b) on exactly the board that
saturates: the evaluator is measured weight-blind/mis-scaled (VALUE
lens), snake6's undifferentiated weight accounts are where a coarse
evaluator separates nothing, and the queen board — one dominant account
the evaluator CAN separate — is where the curve climbs. That is (b)'s
signature pattern.

So, until the margin axis is compiled (M47 — cheap:
`Pr(margin at deciding rung | quanta, premise)`; wide margin +
saturation ⇒ reading (a) stands; near-zero margin + saturation ⇒ the
arbitration INVERTS to fix-evaluator-first):

- Reading 1's "production is 20× past saturation on snake boards" is
  DOWNGRADED to evaluator-conditioned: past saturation FOR THIS
  EVALUATOR. It licenses no budget cut on its own.
- Reading 2's queen conclusion survives in weakened form — a climbing
  curve is not saturation under either reading, so carried compute on
  piece cells pays under (a) AND (b); but WHAT to carry differs
  ((b) would redirect part of the window budget to evaluator work), so
  the ponder-funding decision also waits on the margin column.
- M48 adopted: every CPP is KEYED ON evalVersion — saturation is a
  property of the evaluator, and reusing a profile across evaluators is
  the silent premise crossing the refusal law exists to catch. These two
  profiles are stamped: evaluator = b5 default (`lobster-territory`).
  v0.1 must also capture `telemetry.chosen` and the mechanism advisory
  rows per rung (recorded but discarded by the v0 script), which is
  where the margin column comes from without new machinery.

## RE-CLASSIFICATION (librarian d36-37, cannot-wait relay — before any consumer reads these files)

These two v0 files are **machine-local calibration artifacts, not
profiles**. A wall-clock-denominated curve is a property of the machine:
"snake6 saturates at 500 ms" is unfalsifiable across hardware, and every
ms-keyed profile would have to be redone on any box change. What the v0
compile legitimately delivered: the one-time arbitration reading (queen
climbs, snake6 flattens — SHAPE claims, ordinal across rungs on one box,
still valid), the noise-ceiling methodology, and this box's rate
calibration. What it must never be used for: cross-machine claims,
consumer reads through the CPP interface, or budget policy. **No further
CPPs are compiled in milliseconds** — the quanta denominator
(nodestime shape: deterministic work unit + one measured machine-local
rate constant set below real throughput) is now a PREREQUISITE of any
further compile, not a v1 follow-up.

## Limitations (stamped in provenance)

Agreement conflates "converged" with "matches the 4,000 ms draw" — safe
here only because the noise ceiling is 1.0; ms-denominated (box-sensitive;
quanta rungs are v1); one bot, one lineage (ruling 49: these profiles are
members, not commitments); n = 60/stratum, phase-pooled (per-phase splits
need v1's larger n); the 4,000 ms reference may itself be unconverged on
the queen cell.

---

## Amendments landing with this compile (coordinator notes, integrated)

1. **C13 correction (librarian, via territory.ts):** the commit-scope
   falsifier's framing is amended — the 343 ms recovery rests on
   CLUSTER/READING-granularity invalidation, not per-term incrementality:
   the value fold is strictly MORE incrementalisable than shipped
   ((K,W,p) per-turn constant, zero cross-unit coupling), and the genuine
   un-incrementalisable object is `partitionOf` (whole-board set-cover,
   one unit's change moves every unit's cells). A PARTIAL 343 ms recovery
   therefore reads as partitionOf's granularity floor, NOT as a
   refutation of citation-scoping — the falsifier must report the
   partition-rebuild share separately. Future work, one line: an
   NNUE-style observer-local basis (per-unit reading against a frozen
   background with a declared refresh trigger) is uncosted and measurable
   on the existing corpus.
2. **W-1 (search-theory): the latency cap has a stated drift hazard.**
   B2 is O(|witnesses|) per priced plan with no witness eviction, so
   price cost RISES within a decision for a computational reason the
   slice-sizing comment mis-attributes to roster size; since events drain
   between slices, operator-pin latency drifts upward late in the turn
   against any fixed-ms cap. Carried as a hazard on the exchange-rate's
   latency cap until their S0 support-based pruning lands (sound, where
   LRU eviction would be the forbidden kind).
3. **W-2 (search-theory): workers bank witnesses that die with the
   parcel.** The fix is the evaluation channel's own discipline (buffer,
   sort by witnessKey, adopt at slice/epoch boundary) and becomes nearly
   free under the counting cut — added to increment 1's notes as a
   dependent of the handle swap.
4. **C38 (librarian, DeepStack): ADVANCE's payload gets its theorem.**
   Re-base is continual re-solving, sound ONLY because bounded opponent
   counterfactual values cross the boundary and the re-solve may not
   increase them; carrying nothing has unbounded error under imperfect
   information. Transport-law line added: ADVANCE's payload includes
   opponent counterfactual BOUNDS at the public state — degenerate
   (empty) under full observability, which is why today's re-base is
   sound as-is, and LOAD-BEARING at fog step 5, where the fog worked
   timeline must exercise it. The constraint mechanism ("opponent may
   decline and take the bound") lands in better()'s floor discipline, not
   the commitment agent (their M34). The bank already produces the needed
   type — the sound/advised split is the machinery, no new object.
5. **M21 (α-vectors over belief regions) — costed briefly:** a carried
   α-vector is a value bound valid over a REGION of belief space, so it
   crosses ADVANCE without recomputation wherever the new belief stays in
   the region — strictly stronger than warm hypothesis promotion (which
   needs premise-point match). Cost: our values are not linear in a
   belief-state vector (the game is not a POMDP solved by PBVI; bounds
   are premise-fibered, not belief-linear), so true α-vectors need a
   belief-linearized value class we do not have. The cheap approximation
   we CAN take: region-tagged bounds — a bound declared valid for any
   frontier whose clouds are SUBSETS of the proving clouds (the NARROWED
   verdict's monotonicity, applied at ADVANCE) — which is C38's payload
   generalized one step. Filed as fog-step future work, after the
   counterfactual-bound payload exists.
