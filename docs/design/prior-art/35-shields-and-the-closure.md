# PRIOR ART 35 — shields: the closure as a synthesized object

Domain: the formal-methods answer to the ACTION joint's **closure** — the layer
that removes plans from the priced set on safety grounds, which the composition
lens correctly rules is **kernel** ("if it can move a sound bound it is kernel
behind the law harness. Set-closures stay kernel even though they are numbers").

Our closures are hand-written predicates: `certainlySelfFatal`, the `tier`
lattice bottom (`safe`/`atRisk`/`doomed`), `keepQuiet`, the staging-safety
exclusion, and the community invariant domain 7 recommends (keep a path to your
tail). The literature says a filter with that job should be **synthesized from a
specification**, with two guarantees the hand-written versions cannot offer.

---

## 35.1 The construct

**S63. Alshiekh, Bloem, Ehlers, Könighofer, Niekum & Topcu, "Safe reinforcement
learning via shielding", AAAI 2018 (arXiv:1708.08611); Könighofer et al.,
*Shield synthesis for reinforcement learning* (2020).**

A **shield** is a reactive system synthesized from a temporal-logic safety
specification. It sits between a learner and the environment and **corrects an
action only if the chosen action would violate the specification**. Two
architectures:

- **pre-decision (preemptive) shielding** — the shield *restricts the action set*
  to the safe ones before the agent chooses, so the agent explores and exploits
  only among safe actions;
- **post-decision shielding** — the agent proposes, the shield vetoes and
  substitutes.

Two properties are the reason this is a design pattern rather than a technique:

1. **Correctness by construction.** The shield is *derived from* the safety
   specification, so it enforces exactly that specification — not an
   approximation, and not whatever the predicate's author remembered.
2. **Minimal interference.** The shield intervenes *only* when a violation would
   occur, which is what preserves the learner's convergence guarantees. A filter
   that removes more than the specification requires is not merely conservative;
   it silently changes what the agent can be shown to achieve.

---

## 35.2 Mapping onto our joint

**[+] The composition lens's kernel ruling is exactly right, and shielding says
why in a stronger form.** "Set-closures stay kernel even though they are numbers"
is the correct call: a closure is not a preference, it is a *specification
enforcement point*. The shielding literature's version — the shield is
synthesized from the spec and lives outside the learner — is the same boundary,
drawn for the same reason, and it supplies the vocabulary (`pre-decision` /
`post-decision`) for a distinction our design makes implicitly.

  Our closures are **pre-decision** (they remove candidates before pricing) —
  which is the architecture the literature prefers, because it means everything
  downstream reasons only about safe plans. Worth naming, because the alternative
  exists and would be worse for us: a post-decision veto would leave the
  comparator ranking plans it must then discard, which is where "the closure runs
  after the comparator sorts" defects come from.

**C61. Our closures are hand-written predicates, and neither guarantee holds.**

  - **Correctness by construction fails**: `certainlySelfFatal`, `keepQuiet` and
    the tier bands are *implementations* of a safety intent that exists only in
    prose. There is no artifact saying what they are meant to enforce, so there is
    nothing to check them against — and the programme has already paid for exactly
    this class once, with the bot re-deriving movement rules and getting them
    wrong three ways (domain 11's C35). **A closure is the highest-stakes place to
    have a hand-written re-derivation**, because it silently deletes options and
    the deletion is invisible downstream.
  - **Minimal interference fails, and is unmeasured**: nothing establishes that
    our closures remove *only* what the safety intent requires. `keepQuiet: 2` is,
    in the composition lens's own words, "a number in a knob bag that closes a
    set". A closure that over-removes is indistinguishable, from inside the
    search, from a game in which those options do not exist.

  **The consequence is the sharpest form of R-3.** Domain 1's C2 established that
  every restriction of the option set must be adaptive on value or carry a bound
  on what it removed. A closure is the one restriction that *should* be neither —
  it is a hard filter — but that makes the third obligation binding instead:
  **a hard filter must be derived from a stated specification, and its
  interference must be minimal and measured.** Ours is derived from nothing and
  measured never.

**M84. The interference measurement is cheap and it is the same instrument the
survey keeps asking for.** "How often, and by how much, does each closure remove
the plan the unfiltered search would have chosen?" is one counter per closure over
the existing archive: run the closure, record whether the top-ranked *removed*
plan would have out-ranked the top-ranked *kept* plan. Three uses:
  - it measures interference directly, which is the property the literature says
    must hold;
  - it distinguishes a closure that never binds (delete it — the reachability law)
    from one that binds constantly (which is a *policy*, not a safety filter, and
    is in the wrong layer);
  - and it is the same shape as the deadness column (domain 30) and the
    admitted-set instrument the value lens built, so the harness exists.

**M85. Specification synthesis is available to us in a weak but sufficient form.**
Full temporal-logic shield synthesis is heavier than this programme needs. But the
useful half is not the synthesis — it is the **existence of the specification as a
separate artifact from the predicate**. Two cheap steps that capture most of the
value:
  1. **State each closure's specification in the rules module** (domain 11's "one
     rules artifact"), as a predicate over the *game's* vocabulary rather than the
     bot's — e.g. *"a plan is self-fatal iff the rules engine's resolution of it
     kills the moving unit"*. Then the closure is checkable against the engine by
     **differential test** on the replay archive, which is the free-differential
     pattern the replay-rebase design already established (domain 6).
  2. **Assert the specification, per R-6.** A closure whose specification the
     rules engine disagrees with should throw, not silently over-remove — the
     reappearance-oracle pattern applied to the ACTION joint.

  That gives correctness-by-construction's *effect* (the predicate cannot drift
  from the rules) without the machinery, and it reuses two mechanisms already
  designed.

**M86. Shielding names the failure mode of the tier lattice bottom, and confirms
the VALUE lens's refusal.** The value lens rules that `tier` must stay precedence
and "must never become a weight", because encoding a doomed move as a large
negative "is exactly what would let a dial buy a suicide". That is the shielding
literature's core distinction in our vocabulary: **a safety specification is not a
very large penalty.** A penalty is tradeable at some weight; a shield is not
tradeable at any. The refusal is correct and it now has a literature and a name —
which matters because "make it a big negative number" is the reflexive
simplification a future cycle will propose, and it should be refused with a
citation rather than by taste.

---

## 35.3 The counter-argument

Shields are synthesized from specifications over *known* dynamics. Ours are not
fully known: the closure must act before the resolution is computed, and
`certainlySelfFatal` is deliberately a *conservative* predicate over an
incompletely-determined future — that is the point of "certainly". So exact
minimal interference is unattainable: any sound pre-decision filter over an
uncertain resolution must over-remove somewhere.

That does not weaken the finding; it *locates* it. The obligation becomes: **state
the conservatism explicitly** — this closure removes `X ∪ Δ` where `X` is the
specification and `Δ` is the conservative margin — **and measure `Δ`**. That is
exactly what M84's counter does, and it converts an unbounded hand-written filter
into a bounded one, which is R-3 satisfied in the one place the survey had not
yet applied it.

---

## 35.4 Verdicts

- **COMPOSITION / SEARCH:** our closures are **pre-decision shields** — the
  architecture the literature prefers, and worth naming, because a post-decision
  veto is exactly the shape that produces "the closure runs after the comparator
  sorts" defects. But **neither shielding guarantee holds for us**:
  correctness-by-construction fails (the safety intent exists only in prose, so
  there is nothing to check the predicate against — and the programme has already
  paid once for a hand-written re-derivation of the rules), and **minimal
  interference is unmeasured**.
- **SEARCH (one counter per closure, existing archive):** measure **interference**
  — how often, and by how much, does each closure remove the plan the unfiltered
  search would have chosen? It measures the property the literature requires,
  separates a closure that never binds (delete it, per the reachability law) from
  one that binds constantly (a *policy* in the wrong layer), and reuses the
  admitted-set harness that already exists.
- **COMPOSITION:** get correctness-by-construction's **effect** cheaply — state
  each closure's specification in the **rules module** as a predicate over the
  game's vocabulary, differential-test the predicate against the engine on the
  archive (the free-differential pattern the replay-rebase design established),
  and **assert it** per R-6 so drift throws rather than silently over-removing.
- **VALUE [+]:** your refusal to let `tier` become a weight is the shielding
  literature's core distinction — **a safety specification is not a very large
  penalty**; a penalty is tradeable at some weight, a shield is not tradeable at
  any. Worth citing, because "just make it a big negative number" is the reflexive
  simplification a future cycle will propose.
- **ALL:** where a sound pre-decision filter *must* over-remove (because the
  resolution is not yet determined — which is what "certainly" in
  `certainlySelfFatal` means), the obligation is to **state the conservative
  margin and measure it**. That is R-3 applied to the one restriction class the
  survey had not yet reached.
