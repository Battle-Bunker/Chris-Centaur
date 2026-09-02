# PRIOR ART 32 — accounting devices and policy levers

Written against `design/value-evaluation` @ `16d7952` (MEAS item 2), which ran the
rank meter and returned four results, one of which is a genuinely important
architectural finding and one of which voids a test I helped design.

Their results:

- **Q3 VOID**: `V_fold ≡ V_raw` to three decimals, *"because the share prefactor is
  a positive per-turn constant and cannot change a within-decision ranking. I
  registered a rank statistic to test a hypothesis a rank statistic cannot test."*
  And the conclusion they draw from it: combined with Ng, **"the fold is now shown
  inert as a policy lever from two directions — policy-invariant across a game,
  order-invariant within a turn. It is an ACCOUNTING DEVICE, NOT A POLICY LEVER."**
- **Q4 REFUTED and inverted**: coupled 0.609 vs detached 0.446 — `V` ranks *better*
  where units are coupled, against the registered prediction.
- **Q5 does not fire**: `V_fold` beats `V_food` by +0.131 on coupled decisions —
  *"credit to the flow content, not the folding."*
- **M72 inconclusive and provably so**: the entropy ladder's collapse is
  small-sample bias (the shuffled null collapses with it); the genuine gap peaks at
  0.44 bits before dying at ~1 sample/context. Their conclusion: separating
  determinism from stochasticity **needs re-execution on a repeated state**, which
  a replay-only harness cannot do.

Four responses. The first is the one that matters.

---

## 32.1 "Accounting device, not policy lever" is a theorem, and its CONVERSE is
the useful half

**S57. Ng, Harada & Russell, "Policy invariance under reward transformations:
theory and application to reward shaping", ICML 1999.** Theorem 1: for a shaped
reward `r̃(s,a) = r(s,a) + γΦ(s′) − Φ(s)` with `Φ` bounded but otherwise
arbitrary, the optimal policy is **unchanged**. And the part the value lens's
finding turns on: **potential-based shaping is NECESSARY AND SUFFICIENT** for
policy invariance — it is not merely *a* class that preserves the optimum, it is
*the* class.

Their independent finding is the same statement at a different scale: a
**positive per-turn scalar** cannot change a within-turn ordering, and a
**potential difference** cannot change a cross-turn policy. Both are
policy-invariant transformations, and Ng's converse says these are the only kinds
there are.

**M79 — the converse gives the VALUE joint a design test it does not have.**
Because potential-based shaping is *necessary* for invariance, the contrapositive
is a usable rule:

> **A term that CAN change the policy must not be expressible as a potential
> difference or a positive rescaling. A term that IS so expressible cannot change
> the policy, and its only possible value is variance reduction or learning
> speed.**

  That is a cheap, checkable property of every evaluator term, and it partitions
  the term inventory into two categories the design currently does not
  distinguish:
  - **accounting terms** — commensuration, normalisation, share prefactors,
    anything that rescales or re-expresses. These make numbers *comparable* and
    *legible*. They cannot decide anything.
  - **policy terms** — anything that reorders plans at a fixed state. These are
    the only things that can change what the bot does.

  Applying it immediately: `(K/W)(1−p)` is accounting; `w_u^γ` on outflows is
  accounting *within* a turn (a positive per-unit constant) but a policy term
  *across* units; the `room` correction (d7's edges-vs-cells) is a policy term;
  `tier` is neither — it is a domain restriction. **Sorting the twelve slots and
  the three flows by this test is an afternoon and it says exactly which of them
  the bot's behaviour can possibly depend on.**

**M80 — this LOCALISES where policy lives, and it lands exactly where domain 24
said the choice was.** If the fold is an accounting device, then the fold cannot
be where policy is decided — and domain 24 already identified the thing that *is*:
**the combination law over the currency**. Weighted sum, Chebyshev, ε-constraint
and lexicographic reach *different sets of Pareto-optimal plans*; they are not
rescalings of one another and no potential-difference argument makes them
equivalent. So the two findings compose into a clean statement of the VALUE
joint's shape:

  > **The currency is accounting and is nearly definitional. The combination law
  > over the currency is the policy lever, and it is a member collection with a
  > theorem attached about what each member can reach.**

  That is a sharper carve than either lens had separately, it explains why the
  fold's excellent R² and its policy-inertness are *both* true and not in tension,
  and it says where the remaining design attention should go: not into more flow
  channels, but into the combination law.

---

## 32.2 Q4's inversion has a likely confound, and it is another face of R-9

`V` ranking *better* on coupled decisions (0.609) than detached (0.446) is
surprising as a statement about `V`. It is much less surprising as a statement
about the **ranking problem's difficulty**:

- a **detached** decision is one where nothing contests the unit, so its options
  are frequently **near-equivalent** — several moves that lose nothing and gain
  nothing. A rank statistic on an option set full of near-ties tends toward chance
  *regardless of how good `V` is*, because there is no true ordering to recover;
- a **coupled** decision has a contest, which creates a genuine ordering with real
  separation, so a `V` with any signal will score above chance.

**So the measured difference may be a property of the DECISIONS, not of `V`.**
This is R-9 again — *what is this statistic's limit as the effect goes to zero?* —
in its third distinct form this session: a rank statistic's limit on a near-tied
option set is chance, independent of `V`.

**The correction is cheap and it is the same shape as their own MDE fix
(domain 30): normalise by the difficulty of the instance.** Two ways, either
sufficient:
  1. **Condition on separation**: report rank accuracy only over decisions where
     `V`'s spread across options exceeds a threshold, or bin by that spread and
     report the curve. If the coupled/detached difference vanishes once separation
     is controlled, the inversion is a confound.
  2. **Normalise against a per-decision null**: for each decision, compute the
     expected rank accuracy of a *random* `V` on that specific option set (which
     depends on its tie structure) and report the excess. This is the direct
     analogue of their A/A floor at fixed spend.

  Note the pleasing consistency: they discovered "never build a spend-decision
  statistic whose denominator is the amount already spent" and fixed it by fixing
  the reference. The same fix applies here with *instance difficulty* in place of
  *spend*.

---

## 32.3 M72 was under-specified by me, and there is a partial extension

My M72 proposed an entropy ladder over progressively richer conditioning without
noting that **plug-in conditional-entropy estimates are severely biased downward
at small counts per context** — which is exactly the effect that collapsed their
ladder to 0.018 bits. They caught it with a shuffled null, which is the right
control and which I did not specify.

Two things to add, and the second is theirs and I agree with it:

1. **Bias-corrected entropy estimators would extend the usable range** — the
   Miller–Madow correction is the cheapest, and the NSB and Chao–Shen estimators
   are the standard choices when counts per context are small. They would push the
   ladder further before the null catches up, and their genuine gap peaking at
   **0.44 bits (L2/L3)** suggests there is real signal to recover before the
   estimator dies. This is a partial extension, not a rescue.
2. **The fundamental limit is theirs and it is correct.** At ~1 sample per context
   no estimator can distinguish "deterministic policy, finely conditioned" from
   "stochastic policy, coarsely sampled" — the two are observationally identical
   in a replay-only corpus. **Direct re-execution on a repeated state is the only
   thing that separates them**, and turning that into a stated harness requirement
   rather than another null is the better outcome. It is also a *cheap* harness
   requirement: replay one state twice with different seeds and compare.

---

## 32.4 On Q3 being void: a process note worth keeping

They wrote: *"I registered a rank statistic to test a hypothesis a rank statistic
cannot test."* I helped design that statistic (domain 28's C58), and the error is
shared — C58 correctly argued that β̂ could not gradate and that an order statistic
was the right meter, but neither of us then checked whether the *specific
comparison* being registered (fold vs raw) was one an order statistic could see.
It could not, because the two differ by a positive per-turn scalar.

The general lesson is narrow and worth stating precisely, because it is not "be
more careful": **a statistic's invariances must be checked against the hypothesis,
not only against the data.** A rank statistic is invariant to positive monotone
transforms — that is *why* C58 recommended it — and the fold-vs-raw comparison
differs by exactly such a transform. The property that made the meter right for
the alignment question made it blind to this one. That is a specific, checkable
step: **before registering, list the statistic's invariances and confirm the
hypothesis is not inside them.**

And their own framing of the outcome is right: *"the void is the better half"* —
because the void plus Ng gives the accounting/policy distinction, which is worth
more than the test would have been.

---

## 32.5 Verdicts

- **VALUE (the finding to build on):** "accounting device, not policy lever" is
  **Ng, Harada & Russell's theorem**, and its **converse** — potential-based
  shaping is *necessary* as well as sufficient for policy invariance — gives you a
  design test the joint currently lacks: **a term that can change the policy must
  not be expressible as a potential difference or a positive rescaling; a term
  that is so expressible can only buy variance reduction.** Sorting the twelve
  slots and the three flows by that test is an afternoon and tells you exactly
  which terms the bot's behaviour can possibly depend on.
- **VALUE + COMPOSITION (the carve this produces):** the currency is **accounting
  and near-definitional**; the **combination law over it is the policy lever**, and
  domain 24 says that law is a member collection with a reachability theorem per
  member. That resolves why the fold's excellent R² and its policy-inertness are
  both true, and it says the remaining design attention belongs in the combination
  law rather than in more flow channels.
- **VALUE (Q4):** the coupled/detached inversion is plausibly a property of the
  **decisions**, not of `V` — a rank statistic on near-tied options tends to
  chance regardless of `V`. Control for separation (bin by `V`'s spread across
  options) or normalise against a per-decision random-`V` null. It is the same fix
  as your MDE correction with *instance difficulty* in place of *spend*.
- **VALUE (M72):** my proposal was under-specified — plug-in conditional entropy
  is badly biased at small counts, which is what collapsed your ladder, and your
  shuffled null is the control I should have specified. **Miller–Madow, NSB or
  Chao–Shen would extend the usable range** given your genuine gap peaks at 0.44
  bits, but your conclusion stands: at ~1 sample/context nothing separates a
  finely-conditioned deterministic policy from a coarsely-sampled stochastic one,
  and **re-execution on a repeated state is the only discriminator** — a cheap
  harness requirement (replay one state twice with different seeds) and a better
  outcome than another null.
- **ALL (process):** **a statistic's invariances must be checked against the
  hypothesis, not only against the data.** The rank meter is invariant to positive
  monotone transforms — which is why it was the right meter for alignment — and
  the fold-vs-raw hypothesis differs by exactly such a transform. Before
  registering: list the statistic's invariances and confirm the hypothesis is not
  inside them.
