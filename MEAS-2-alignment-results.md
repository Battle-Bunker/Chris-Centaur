# RESULTS — the rank-based V-alignment meter, and M72

Reported against `PREREG-beta-alignment.md` + Amendment 1, both committed before any run.

---

## 0. AN ARTIFACT CAUGHT BEFORE PUBLICATION — and it reversed the conclusion

My first run said **all three V's rank played moves BELOW chance** (0.466 / 0.466 / 0.459, CIs
excluding 0.5), which would have read as "the population plays *against* the fold".

The sanity check refused it: my classifier said **59.4% of played moves landed on a fatal
destination**. Bots do not commit suicide three times in five. Diagnosis, in two steps:

1. Tail cells vacate as a unit advances, so current occupancy over-counts fatality. Correcting to
   *persistent* occupancy moved it 59.4% → 49.8%. **Not the main bug.**
2. **The perimeter is playable.** 21.7% of body cells sit on it and food spawns there (65 instances
   in one game). My `isInterior` test — imported from the engine, where it governs *spawn and
   hazard placement*, not movement — flagged **123 of 465 played moves as suicide**. With it
   removed, played-onto-occupied falls to **1 in 465 (0.2%)**, which is what a competent bot looks
   like.

**Corrected, the result inverts.** This is the fourth instrument artifact I have caught this
session, and again it was the cheap plausibility check that found it, not any statistical
refinement downstream. I am reporting only the corrected numbers.

---

## 1. THE PRIMARY STATISTIC

Pairwise order agreement (0.5 = chance; higher = V ranks the played move above alternatives):

| V | all | detached | coupled |
|---|---|---|---|
| **V_fold** | 0.5067 ± 0.0120 | **0.4455 ± 0.0155** | **0.6087 ± 0.0177** |
| V_raw | 0.5063 ± 0.0120 | 0.4455 ± 0.0155 | 0.6077 ± 0.0177 |
| V_food | 0.4593 ± 0.0106 | 0.4480 ± 0.0134 | 0.4782 ± 0.0172 |

Mean normalised rank (0 = always first): V_fold 0.4933, V_raw 0.4937, V_food 0.5407.

---

## 2. AGAINST THE REGISTRATION

**Q3 — VOID, and the registration error is mine.** `V_fold ≈ V_raw` to three decimals, and this
is **mathematically necessary**: the share prefactor is a *positive constant within a turn*, and a
positive scaling cannot change a within-decision ranking. **I registered a rank statistic to test a
hypothesis a rank statistic is incapable of testing.** I had even written §1's note that the
folding is "absorbed into β turn-by-turn" and failed to see that the same algebra makes it
invisible to any within-decision order statistic.

**That void is itself a result, and it is the more interesting half.** Combined with the Ng
theorem, the fold is now shown inert as a policy lever from two independent directions:

> **It is policy-invariant across a game (potential-based shaping), and order-invariant within a
> turn (a positive per-turn scaling).** The fold cannot change what a bot plays. It is an
> accounting device, not a policy lever — which is what the synthesis claimed, now with a second
> and much shorter proof.

**Q4 — REFUTED, and inverted.** I predicted `detached > coupled` because the per-unit fold is exact
on detached and approximate where units interact. Observed: **coupled 0.609, detached 0.446** — a
large reversal. The factorisation argument is fine as algebra but wrong as a prediction about
*what the bots are doing*: on coupled decisions the binding consideration is collision and contest,
which my hazard term captures well; on detached decisions the bot is pursuing something at a
distance that a per-destination V does not see at all.

**Q5 — does NOT fire, on the stratum where it matters.** `V_fold` (0.609) beats `V_food` (0.478) by
**+0.131** on coupled decisions — a real and large gap. So the honest-null sentence I pre-committed
to ("my fold explains played moves no better than a distance-to-food heuristic") **does not have to
be written**: on contested decisions the flow content explains play substantially better than the
distance heuristic this instrument already refuted. The aggregate gap (+0.047) is more modest.

**Q6 — guard respected.** I am not reporting the bare 0.5067. The content is the two contrasts:
`V_fold ≫ V_food` on coupled, and `V_fold < 0.5` on detached.

**β̂ — as amended, registered in advance as uninformative**, and not used.

---

## 3. M72 — INCONCLUSIVE, AND PROVABLY SO AT THIS SAMPLE SIZE

The ladder appears to collapse: H(played direction | context) = 2.129 → 2.027 → 1.657 → 1.539 →
0.462 → **0.018** bits. Registered prediction was collapse, so this looks like confirmation.

**The saturation control refuses it.** With ~1 sample per context, empirical entropy is forced
toward zero. Comparing against a shuffled null with identical context structure:

| level | H obs | H shuffled | **GAP** | contexts | samples/context |
|---|---|---|---|---|---|
| L1 +unit kind | 2.027 | 2.126 | 0.100 | 4 | 1134 |
| L2 +neighbour occupancy | 1.657 | 2.097 | **0.440** | 40 | 113 |
| L3 +nearest-food direction | 1.539 | 1.982 | **0.443** | 199 | 22.8 |
| L4 +5×5 window | 0.462 | 0.693 | 0.231 | 2853 | 1.59 |
| L5 +unit id and turn | 0.018 | 0.037 | 0.019 | 4430 | 1.02 |

**The genuine information peaks at 0.44 bits and then collapses along with the null.** The apparent
determinism at L4–L5 is small-sample bias, not determinism.

**So M72 cannot separate the belief lens's (i) from (ii) at 4,538 decisions**, and the reason is
structural rather than a shortage of effort: the two regimes require contexts rich enough to nearly
determine the action *and* enough samples per context, and those requirements fight each other.
At the richest trustworthy level (L3, 22.8 samples/context) **1.54 bits of action entropy remain** —
consistent with a deterministic policy conditioning on far more state than L3 encodes, and equally
consistent with genuine stochasticity.

**The instrument statement stands as the finding, which is what was wanted:** a conditional-entropy
ladder on replay-only data cannot certify determinism here. Settling it needs either far more
decisions at one fixed rich context, or **direct re-execution of the bot on a repeated state**,
which a replay-only harness structurally cannot do. That is a concrete requirement on any future
harness rather than another zero.

---

## 4. WHAT I WOULD CARRY FORWARD

1. **The fold is not a policy model and now has two proofs that it cannot be one.** Its warrant
   stays exactly where the synthesis put it: interior outcome accounting.
2. **The flow content does explain contested play** (+0.131 over the distance heuristic on coupled)
   — that is about `V_raw`, not about the folding.
3. **Detached play is unexplained by any per-destination V tried**, all three below chance. That is
   the interesting open question this run produced, and it points at distance-to-objective terms
   that a one-step V cannot represent.
4. **`isInterior` governs spawn placement, not movement.** Anything reading it as a movement
   constraint is wrong; I would put that in the shared notes, since it is the kind of borrowed
   predicate that looks right and silently inverts a result.
