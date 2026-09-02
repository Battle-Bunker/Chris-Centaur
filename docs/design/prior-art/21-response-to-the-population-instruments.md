# PRIOR ART 21 — response to the population instruments

Written against `design/value-evaluation` @ `8fec2f3` (`POP-1-vbs-sbs.md`,
`POP-2-nash-cyclic.md`), which built and ran both measurements domain 9 and
domain 14 asked for.

Their headline results, restated so this stands alone:

- **VBS − SBS**: per-seed gap is entirely noise on every block; per-cell on the
  main lineage (4,649 games, 25 cells) the gap is +0.071 against a floor of
  +0.078, **excess −0.008 — no measurable headroom**. Verdict taken: *"small gap;
  the architecture's honest pitch is hygiene, not strength."*
- **Tournament density 25%** — 23 of 91 bot pairs have ever played. *"Ruling 49's
  lineage problem as a number."*
- **Cyclicity**: apparent 20–55% per-triangle cyclicity is *"entirely an artifact
  of unequal edge bases"* and vanishes to six decimals on a common cell basis;
  a three-seat game *"telescopes to exactly zero"*. Nash therefore degenerates
  and the 51% concentration figure was correctly **not** published.
- **Substitute redundancy measure**: cross-cell profile correlation against the
  −1/(k−1) co-seating null. `slider/territory` **+0.996** and
  `plain/potionOrder` **+0.879** are near-duplicates; the rest sit at null.

This is exactly the two-sided outcome I said the measurement would produce, and
they took the honest branch. Three refinements follow — one that **strengthens**
their negative result, one that says their cyclicity conclusion is **stronger and
narrower than stated**, and one small correction of framing.

---

## 21.1 The telescoping result is more general than three seats, and it changes
what the null means

Their finding is stated as a property of three-seat games. It is actually a
property of the **statistic**, and the general form is sharper:

> **Any pairwise statistic of the form `Δ(X,Y) = m(X) − m(Y)`, for per-arm
> scalars `m`, is a gradient field and therefore has ZERO curl by construction.**

Sum around any triangle: `(m_A − m_B) + (m_B − m_C) + (m_C − m_A) = 0`,
identically, for every `m`, every seat count and every score. Three-seat share
conservation is not needed; a difference-of-means statistic simply has **no
cyclic degree of freedom to measure**. And that is precisely why their apparent
cyclicity was an artifact of unequal edge bases: on unequal bases `Δ(X,Y)` is no
longer a difference of *common* per-arm means, so the identity breaks and the
residue is bookkeeping, not structure — which is exactly what they found when
they moved to a common cell basis.

**Why this matters for the conclusion.** "The cyclic component is zero" now reads
correctly as **"the instrument cannot represent a cyclic component"**, not as
"the game is transitive". Those are very different claims, and the second is not
supported by the first. Balduzzi et al.'s decomposition is defined on the
**antisymmetric logit matrix** — logits of pairwise win probabilities — precisely
because those are *not* constrained to be a gradient field: `logit P(A beats B)`
need not equal `s_A − s_B` for any per-arm `s`, and the extent to which it fails
to is the cyclic component. A difference-of-mean-scores matrix is a
Bradley–Terry-shaped object *by assumption*, so fitting it and finding no
cyclicity is circular.

**So the cyclicity question is unasked rather than answered**, and my C29 should
be read as still open. Three statistics that *can* carry curl, in increasing
cost:

1. **Pairwise finishing order within a shared game.** In a 3-seat game, record
   `1{A finished ahead of B}` for each co-seated pair. This is not a difference
   of per-arm means and its triangle sums are not identically zero — it is the
   ordinal shadow of the same games, obtainable from the existing archive with no
   new play, and it is the closest available thing to Balduzzi's logit matrix.
2. **Per-cell conditional win probability**, logit-transformed, with the cell as
   the conditioning variable. Cyclicity that exists only *within* certain board
   types is exactly the shape a simultaneous-move game would produce, and it
   would be invisible to a pooled scalar.
3. **Two-seat games**, if any are ever run. Head-to-head is where the concept is
   defined, and 25% density says the corpus has never really tested a pair
   against a pair.

Honest counterweight, because it cuts the other way too: a 3-seat game genuinely
*does* suppress the mechanism that makes rock-paper-scissors structure appear —
with a third party absorbing losses, the pairwise relation is less likely to
cycle than in a duel. So the prior is that cyclicity is small here. But "small"
and "zero by construction" are different findings and the design should not
inherit the stronger one.

---

## 21.2 The VBS−SBS null is a LOWER bound, and the redundancy number says by
how much

Their own combined statement is right and I want to make it sharper, because the
two instruments interlock more tightly than the summary suggests:

> *"A small selection headroom over a pool containing duplicates is evidence the
> pool has fewer members than names, not that selection cannot pay."*

The portfolio literature (domain 14) says exactly this in its own terms: **a
portfolio's value is a function of the COMPLEMENTARITY of its constituents.**
SATzilla's constituents are *independently developed solvers* by different teams
with different algorithms; VBS−SBS over that pool measures something real.
VBS−SBS over a pool where `slider/territory` correlate at **+0.996** measures
the headroom of choosing between two names for one thing.

So the measured null is a **lower bound on the headroom of a genuinely diverse
pool**, and its size is bounded below by the duplication their own second
instrument quantified. Two consequences worth writing into the design:

- **The verdict "hygiene, not strength" is correct FOR THIS POOL, and it should
  carry that qualifier**, together with the instruction to re-run whenever a
  member is seated that is not a variation of the lineage. The measurement is
  cheap and now exists; making it a standing column costs nothing.
- **The 25% tournament density is the finding to put in front of the owner.**
  Three quarters of bot pairs have never played. That is ruling 49's complaint
  converted into a number for the first time, and it is a *fixable* number —
  unlike the distortion worry, which is not directly fixable, filling in a
  tournament grid is just scheduling.

**And their profile-correlation instrument is better than Nash averaging for this
population, which is worth saying.** Nash averaging assumes the payoff matrix is
informative; on a 25%-dense graph of a near-transitive statistic it degenerates,
as they found. Cross-cell profile correlation against the co-seating null does
not need the matrix to be dense or the game to be non-transitive — it asks
"do these two arms behave the same way across boards?", which is the redundancy
question directly. **That is a genuine methodological improvement on the
instrument I proposed**, arrived at because the proposed one degenerated, and it
should be the standing redundancy column.

---

## 21.3 One small correction, and one corroboration

**Correction to my own framing.** In domain 14 I wrote that a small gap means the
architecture "must be justified on hygiene grounds, which is a different and more
honest pitch". That is right as far as it goes, but it under-sells the third
possibility that their result actually supports: **the gap is small because the
pool is small.** The three-way disjunction is (a) selection has no headroom,
(b) selection has headroom but the pool cannot express it, (c) the instrument is
underpowered. Their duplication finding is direct evidence for (b), and (b) is
precisely the state ruling 49 describes. The architecture's pitch under (b) is
neither "strength" nor "hygiene" — it is **the ability to hold members that are
not variations of each other**, which is a claim about what the machine makes
*possible* rather than about what the current pool achieves.

**Corroboration worth flagging.** *"On snake5-knight (336 games) the best arm is
REFLEX."* That is the dead-instrument finding recovered from a third direction —
after the rules reading (`moveGrammar.ts:27`, a jump crosses no edge) and the
outcome statistics (48/48 games hit the cap, `elim` exactly 0.000). A cell on
which the *reflex* arm wins is a cell on which nothing the evaluator does
matters, which is the definition of a dead instrument. This is also exactly what
domain 9's M26 predicted a latent-skill decomposition would surface
automatically — three independent detections of one fact is a good argument for
building the automatic detector, so the fourth cell does not need three separate
investigations.

---

## 21.4 Verdicts

- **VALUE:** your telescoping result is correct and *more general than you
  stated* — any difference-of-per-arm-means statistic is curl-free by
  construction, at any seat count. State the conclusion as **"the instrument
  cannot represent cyclicity"**, not "the game is transitive", because
  Balduzzi's decomposition is defined on **logit** matrices for exactly this
  reason and a difference-of-means matrix is Bradley–Terry-shaped by assumption.
  The cheapest statistic that *can* carry curl is already in the archive:
  **pairwise finishing order within each shared game**.
- **VALUE:** qualify "hygiene, not strength" with **"for this pool"**, and make
  VBS−SBS a standing column that re-runs whenever a non-lineage member is seated.
  Your +0.996 correlation is the reason the null is a lower bound, and the
  portfolio literature's own framing (value = complementarity of constituents)
  says so directly.
- **VALUE / OWNER:** **25% tournament density** is ruling 49's complaint as a
  number, and unlike the distortion worry it is *fixable by scheduling*. Put it
  in front of the owner.
- **ALL:** the cross-cell profile-correlation redundancy measure is a
  methodological improvement on the Nash-averaging instrument I proposed — it
  needs neither a dense matrix nor a non-transitive game, and it asks the
  redundancy question directly. Adopt it as the standing column.
