# Rollup fold — the TIME section's stragglers (19-per-lens-rollup @ b58a473)

Already absorbed before this pass: the conditional-saturation correction +
evalVersion keying, the flip factor, the DeepStack counterfactual-bound
payload, ratio-2/THEOREM provenance, monitoring-vs-fixed-contract, and the
α-region costing. This document folds the rest; where an item changes a
standing doc, the doc carries an inline edit pointing here.

## 1. [C] observe() goes LAZY: dirty-then-verify-on-demand (Adapton/Salsa)

Accepted, and it corrects a real flaw in my draft: eager citation-kill
spends the scarcest compute at the worst moment (an operator commit with
the deadline near) on invalidation work the turn may never demand. The
law's mechanics change; its verdicts do not:

- `observe()` does two cheap things only: append the determination to the
  ledger and MARK DIRTY along the durability-strata index (O(edges));
- verification and recomputation happen ON DEMAND, when a consumer reads
  a dirty entry — walking dependencies with early CUTOFF (the
  recompute-and-compare law now runs at verify time, where Salsa runs
  backdating);
- the one eager path that remains is the obligation: conform-now IS a
  demand that arrives immediately after the commit, so the wire's
  conformance work is unchanged — everything else defers.

## 2. [C] Value HASHES join the declaration record (R-1)

Coords alone give dirty-bit semantics; a hash of what was READ gives
minimality and early cutoff — the red-green verify chain, and it is what
feature/commit-scope is actually buying. The ReadSet gains an optional
per-edge `valueHash`; verification compares hashes before recomputing,
and an unchanged hash re-greens the subtree without touching it. Three
literatures land on this independently; adopted into the sketch.

## 3. [C] The re-base window is BOUNDED (GGPO's rollback cap)

My re-base pass was unbounded — as much synchronous work as happened to
be citation-dependent. Cap it: the synchronous slice of `observe(
resolution)` (condition + dirty-marking + promotion bookkeeping) gets a
quanta cap; past the cap, remaining work stays dirty and lazily verifies
under §1. GGPO stalls past its cap because its speculation reached the
screen; ours never did (quarantine), so our overflow degrades to lazy
work instead of a stall — but the cap must exist, and its p99 is a gate
beside the conformance p99.

## 4. [C] Per-sub-step checksums PROMOTED out of "additive polish"

GGPO's named desync causes (iteration over unordered collections chief
among them) are the replay-rebase divergence hazards verbatim, and a
per-turn checksum detects but cannot LOCALIZE. `Turn.subStepCount` plus
per-sub-step digests move from nice-to-have to the replay-rebase
increment's engine-ask list: still additive, but now motivated — a
divergence names its sub-step, which names its adjudication tier, which
is the difference between an afternoon and a week of hunting.
(`realized-resolution.sketch.md` edited to match.)

## 5. [M] The market's free baseline is "the enemy repeats" — with a ruling-13 gate

GGPO's repeat-last-input predictor carries a genre; a market member that
cannot beat it is not earning its allowance. But repeat-last reads
HISTORY — a behavioral model — so under ruling 13 it enters in two
stages: NOW, as a validation-harness baseline only (a measuring stick for
market members, never live); WHEN the owner opens the D2 socket, as the
first and cheapest live member, with GGPO as the evidence it clears the
bar cheap priors are held to. The market spec's baseline row is amended
accordingly.

## 6. [M] "Ask the operator" gets its economy row

Three width-removal operations exist: deduce (compute), observe (wait),
ASK — and the third had no row anywhere. Added to the reducibility
table as an obligation-side purchase: surfacing a question or a fork to
the operator costs operator attention (the scarcest resource in the
centaur loop) and is priced by the reaction table's owner, not by VOI —
but it EXISTS now, which is the hook the red-team lens's F11
(operator-facing option play, the missing joint kind) needs: the
economy can at least represent "this width is cheapest to remove by
asking the human who controls it."

## 7. [?] settled — the selector's feature computation is charged, with a fallback

SATzilla budgets its feature computation and keeps a fallback solver;
ours computes market features (CPP lookups, flip factors, promotion
matching) inside the decision budget. Settled as: YES, charged — the
metareasoning meter (M7, already adopted) is the row it lands on — plus
the SATzilla clause my adoption lacked: every policy that reads computed
features DECLARES A FALLBACK for when the features are unaffordable
(market → realization-only weights; grant sizing → fixed ratio-2;
reaction → the kernel floor). The fallback is the policy's `unit` in the
manifest's terms, so it exists by construction; the clause makes reading
it under starvation a defined behavior instead of an accident.

## 8. The M55-style hypothesis assertion for the CPP (added to the spec)

The metamorphic-testing pattern from the rollup's search section —
assert a theorem's hypothesis NOW so a future change trips it loudly —
applied to the CPP's standing assumption: a profile is valid only for
the evalVersion it was fitted under. The profile READER asserts
`consumer.evalVersion === profile.evalVersion` and refuses on mismatch
(refuse-unknown-coordinate extended to refuse-MISMATCHED-coordinate);
a stale curve can then never silently price a re-dialed bot. In
`time-cpp-spec.md` §2¾ as of this fold.
