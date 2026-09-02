# PRIOR ART 28 — fitting a stochastic choice model to a deterministic agent

Written against `design/belief-fog` @ `afd3642`
(`docs/design/belief-fog/17-LOGIT-SUPPLIER.md`), which pre-registered and ran the
logit/Gibbs supplier from domain 20 and refuted it: **coupled log-loss is
monotone INCREASING in β across the whole grid; β̂ = 0, which equals the already
refuted `solutions` supplier.**

Two things follow. **One is an error of mine that they caught in advance**, and
one is a literature that names their hypothesis (ii) and — more usefully — says
their constructive residue is measuring the right thing with the wrong statistic.

---

## 28.1 My P3 was wrong, and their pre-registration was right

I wrote that **β must be irrelevant on the detached stratum** ("no constraint
couples anything"). They registered the opposite — that detached would *worsen*
at every β > 0 — and it did.

The error is clean and worth naming so it is not repeated: **I conflated "the
CONSTRAINT is inert on detached" (true) with "β is inert on detached" (false).**
β tilts each unit's distribution toward high-`V` actions *whether or not units are
coupled*; the constraint system only decides which joint assignments are legal.
Uncoupled units still get tilted, so a misaligned `V` makes detached worse
immediately. My "mechanical tripwire" was not mechanical — it was a substantive
claim, wrongly labelled, and labelling it as a tripwire would have made a real
refutation look like a bug if they had not registered their own version.

---

## 28.2 Their hypothesis (ii) has a name, and it explains the monotone shape

Their two candidate explanations: **(i) the V is wrong** — the population
optimises the search's surrogate, not L1-food; **(ii) the population is nearly
deterministic**, so there is no action-level randomness for any smooth likelihood
to fit.

Hypothesis (ii) is the standard identification problem in **discrete choice** and
**inverse reinforcement learning**, and it has a precise shape.

**S54. Ziebart, Maas, Bagnell & Dey, "Maximum entropy inverse reinforcement
learning", AAAI 2008**, and the discrete-choice literature it descends from
(McFadden). MaxEnt IRL models the expert as `P(action) ∝ exp(λ·V(action))` — the
same Gibbs family — and infers `V` from behaviour. Its documented difficulty with
**near-deterministic experts** is exactly what the belief lens hit: when the
generating policy is deterministic given the state, the only apparent randomness
in a pooled dataset comes from **state pooling** (the analyst merging states the
policy distinguishes), and then:

- λ and `V` are **entangled** — a mis-scaled `V` and a mis-fitted λ trade off, so
  neither is separately identified;
- if `V` **misranks** the chosen action relative to alternatives, log-loss is
  **monotone increasing in λ**, because every increase in λ moves mass away from
  the action that was actually played;
- so **λ̂ → 0 is the signature of misalignment, not of a random agent**, and
  uniform wins by default as the max-entropy hedge against a misranked `V`.

Their observed table is that signature exactly: monotone increase on every
stratum, β̂ pinned at the boundary, and the boundary value coinciding with the
already-refuted supplier.

**This does not adjudicate between their (i) and (ii)** — a wrong V and a
deterministic generator produce the same monotone shape, which is precisely why
the two hypotheses are hard to separate. But it does say something useful about
what to do next, below.

---

## 28.3 C58: β̂ is the wrong statistic for the V-alignment meter they invented

Their constructive residue is right and valuable: *"β̂(V) is a V-ALIGNMENT METER.
Fitting the one parameter per candidate V ranks candidate value functions by how
well their Gibbs tilt explains played moves — at one number per V, from replays,
zero games."* The idea is correct. **The statistic is not.**

β̂ is a boundary-saturating estimator. Once `V` misranks the played action even
slightly, β̂ = 0, and it stays 0 for a `V` that is *nearly* right and for one that
is *completely* wrong. **A meter that reads zero across the entire range you care
about cannot rank candidates**, which is the meter's whole purpose. This is the
same class of instrument pathology as R-8's bounded-statistic trap seen from the
other side: there the statistic saturated at a ceiling and manufactured structure;
here it saturates at a floor and destroys gradation.

**The statistic that works for a deterministic expert is rank-based, not
likelihood-based.** Three candidates, all computable on the same corpus with the
same harness and none requiring the population to be stochastic:

1. **Top-1 accuracy**: the fraction of decisions where `V` ranks the played joint
   first. Interpretable, has an obvious null (1/|options|), and gradates.
2. **Mean normalised rank** of the played action under `V` — 0 = always first,
   0.5 = random, 1 = always last. Bounded, smooth, and it distinguishes "nearly
   right" from "completely wrong", which is exactly what β̂ cannot.
3. **Pairwise agreement**: over sampled pairs of legal joints, how often does `V`'s
   order agree with the order the played action implies (played ≻ not-played)?
   This is a Kendall-τ-shaped statistic, it is the one most robust to `V` being
   correct up to a monotone transform, and **a value function only needs to be
   right up to monotone transform to order plans** — which is precisely the
   property our comparator needs and log-loss does not test.

  Candidate (3) is the one I would build. Our comparator is an *ordering*, not a
  probability, so the right retrodiction test of any `V` is whether it orders the
  way play ordered — and that test is immune to both hypothesis (i)'s scaling
  problems and hypothesis (ii)'s determinism.

**And it changes what the value lens's queued test measures.** They have
pre-registered running the fold's `V` through this fit. Under β̂ that test can only
return 0 or not-0; under mean-normalised-rank or pairwise agreement it returns a
*graded* answer, and it becomes a genuine retrodiction of the fold as a policy
explanation rather than a pass/fail on a boundary. **The pre-registration should
be amended before the fit is run**, because the statistic determines what the
result can say.

---

## 28.4 M72: the determinism hypothesis is separately testable, cheaply

Their (i) vs (ii) can be separated without any new games, using data they already
have. If (ii) holds — the population is deterministic and the apparent randomness
is **state pooling** — then the observed action entropy should **fall as the
conditioning becomes finer**. Concretely: compute the empirical entropy of the
played action conditioned on progressively richer state descriptions (cell only →
cell + roster → cell + roster + local geometry → …). Under (ii) the entropy
collapses toward zero as conditioning sharpens; under (i) with a genuinely
stochastic population it plateaus above zero.

That is one pass over the same 1.15M decisions, it needs no model, and it settles
which of their two hypotheses is doing the work. **If (ii) is confirmed, the
entire smooth-likelihood approach to supplier fitting is mis-specified for this
corpus** — and the conclusion is not "we have no supplier", it is "**this corpus
cannot identify a smooth supplier, and the meter must be rank-based**", which is
a much more useful thing to know than another refutation.

---

## 28.5 Verdicts

- **BELIEF (amend before the queued fit runs):** the V-alignment meter is the
  right idea and **β̂ is the wrong statistic for it** — it saturates at the
  boundary, so it reads 0 for a nearly-right `V` and for a completely wrong one
  alike, and a meter that cannot gradate cannot rank. Use **pairwise order
  agreement** (Kendall-τ-shaped, played ≻ not-played) as the primary, with mean
  normalised rank as a readable secondary. Our comparator is an *ordering*, so a
  `V` only needs to be right **up to monotone transform**, and an order statistic
  tests exactly that while log-loss does not.
- **BELIEF (settles their own (i) vs (ii), one pass, no new games):** if the
  population is deterministic and the apparent randomness is **state pooling**,
  the empirical action entropy **falls as conditioning sharpens**. Compute it on
  progressively richer state descriptions. Confirming (ii) would mean this corpus
  cannot identify *any* smooth supplier — which is a finding about the instrument
  rather than about the family, and worth far more than another β̂ = 0.
- **VALUE:** your pre-registered β̂(V_fold) test should be **re-registered on an
  order statistic** for the same reason. Under β̂ it can only return 0 or not-0;
  under order agreement it returns a graded retrodiction of the fold as a policy
  explanation. The statistic determines what the result can say, and this one is
  registered to say very little.
- **[error, recorded]** My P3 ("β irrelevant on detached") was wrong: β tilts each
  unit's distribution whether or not units are coupled, so a misaligned `V`
  worsens detached immediately. I conflated *the constraint being inert* with
  *β being inert*, and labelled a substantive claim as a mechanical tripwire —
  which would have made a real refutation look like a bug had they not registered
  their own version. Their pre-registration caught my mislabelling, which is the
  second time in this survey their discipline has caught my error before it cost
  anything.
