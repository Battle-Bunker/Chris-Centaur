# Third pass: ε becomes a measurement, and evidence becomes toll-free

Two results, both of the shape the mandate wants (a knob collapsing into a
law). Part A works the ε×entropy arithmetic to closure: the robustness dial
is DERIVABLE from the log-loss harness with a closed form, leaving D3 exactly
one free parameter (appetite). Part B cross-checks the ObserverLedger against
the time lens's worldline (their docs at design/time-interruption tip, read
this session) and derives a third citation verdict their invalidation law
needs under fog — with the consequence that conditioning never costs a
teardown.

---

## Part A — the ε law

### A.1 What ε is, made exact

The est-rung reading is the lower prevision of the ε-contamination class
{(1−ε)·w + ε·q : q any distribution on S}. Read GENERATIVELY, the class is a
model of the opponent: "with frequency (1−ε) they play per w; with frequency
ε they do something we cannot model." Under that reading ε is not an
attitude — it is a POPULATION PARAMETER of observed play, and the logged
corpus estimates it.

### A.2 The closed form

Let p be the empirical action distribution in a stratum and w the supplier's
prediction. p is representable inside the class iff p ≥ (1−ε)·w pointwise
(choose q ∝ p − (1−ε)w), so the MINIMAL contamination fraction is

    ε_min(p, w) = 1 − min over supported actions a of  p(a) / w(a)

— one pass over the harness's existing per-action counts. Finite-sample
care: smooth p (add-α or shrink toward w) before the ratio, or the rare-a
noise drives ε_min to 1; report the CI from the multinomial. Note the
one-sided relation to distance: p = (1−ε)w + εq gives TV(p, w) ≤ ε, so a
TV or Pinsker bound (TV ≤ √(KL/2), with KL read straight off the log-loss
harness) UNDER-states the needed ε — the ratio form is the correct
estimator, the KL form a sanity floor.

### A.3 The law, and what it collapses

**ε(supplier, stratum) := fitted ε_min from the replay corpus, entering as a
PremisedMember (08-doc §7) with the fit's premise coordinates and residual
CI.** Consequences:

1. **The D2×D3 grid loses an axis.** (supplier × ε) sweeps become
   (supplier) with ε carried BY the supplier's own calibration record; what
   remains swept is fit transport (does ε̂ hold on new opponents/rosters —
   the same premise-refusal discipline as the value fold's k).
2. **Entropy scheduling is subsumed, resolving 09-doc §5 cleanly.** The
   strata may include mask-size/entropy bands; if ε̂ varies across them, the
   "schedule" is data with provenance, not a control law. The 09-doc
   refusal stands as stated — no feedback controller, no second fear knob —
   and the legitimate entropy dependence arrives as fitted structure. (The
   two texts are consistent: 09 refused ε-as-controller; this derives
   ε-as-measurement.)
3. **D3 is left with exactly one free parameter: appetite** (utility
   curvature over outcome lotteries — the operator's private tournament
   context, B-J10's content). Robustness-to-model-error, the other half the
   dof synthesis fused into D3, is now derived. The fusion survives as a
   sweep-together CONTRACT only until ε̂ ships; then the falsifier
   simplifies: if match play prefers ε far from ε̂ under a supplier whose
   log-loss is stable, the generative reading is wrong for this game and
   the finding is about the game (an adaptive opponent breaking the
   population premise), not about tuning.
4. **Ruling-13 compliance**: fitting ε_min on the existing corpus is
   instrument work on logged data (02-doc §4b's harness); no bot predicts
   anyone. Per-OPPONENT ε is adaptation and stays out until the ruling
   lifts — the stratum axis deliberately excludes centaurId.

### A.4 The honest edges

- ε_min is fitted against POOLED opponents; a single adversarial opponent
  is worse than the population ε in exactly the way the premise coordinates
  say (policyPair/opponent-population row). The floor channel never depends
  on it — that is the whole architecture.
- A supplier can game its own ε by flattening (w→uniform drives p/w ratios
  toward 1 and ε_min down while predicting nothing). The harness therefore
  reports (log-loss, ε_min) as a PAIR — a supplier is admissible for the
  est rung only if it beats uniform on log-loss, and uniform's own ε_min is
  the reference row. This closes the flattening loophole the composition
  lens's finding 5 pointed at, at the estimator level rather than the
  schedule level.

## Part B — the worldline cross-check

The time lens's factorization (design/time-interruption, time-worldline.md):
one per-game WORLDLINE owning the determination frontier, hypothesis table,
attention map, allowance ledger; `observe(determination)` kills exactly the
state whose CITATIONS intersect the determined variables; fog re-base is
"the same rule at n=some — state citing only still-hidden units is not
killed."

### B.1 The composition (no collision, one containment)

The ObserverLedger (05/08) and the worldline have the same lifecycle and the
same trigger, and they are NOT peers: **the ObserverLedger is the
worldline's belief half.** `worldline.observe(d)` decomposes an incoming
ObservationRecord into (i) support conditioning — the C-ladder, updating S
via the ledger — and (ii) citation invalidation over value stores — their
law. Order matters and is (i) then (ii): invalidated values are re-priced
against the already-updated S. The attention map (their carried rows,
citedUnits, premise-match survival) is the value-priority half; the
conditioningDepth-in-trace-key (09-doc §8) and their (hypothesis id,
citations) keys are the same pattern on the two halves. My 05-doc §2 said
"natural home of the rebase carry — same lifecycle"; this makes it precise:
one worldline, two components, one observe().

### B.2 The gap in their law under fog, and the third verdict that fills it

Their citation law is binary: a variable is DETERMINED (citing state dies)
or untouched (state lives). Fog conditioning produces a third case their
docs do not price: a variable NARROWED — the hidden unit's support shrunk
by evidence, determined by nothing.

The epistemics answer is a theorem, not a policy: **sound state citing a
narrowed variable SURVIVES, valid but looser.** A floor quantified over S is
a floor over any S' ⊆ S (min over a superset lower-bounds the min over the
subset); a ceiling likewise upper-bounds; a witness reply that existed in S
may have left S' — so witnesses (B2 upper certificates) are the one sound
object that must be re-checked against membership, a set query, not a
recompute. Advised state (mu/est) is neither bound: it survives with
precision DECAYED (the reading was taken under a wider S; fold a
zero-precision reposition or just flag for refresh). So the citation law
gains:

    determined  → kill (the question changed)
    narrowed    → sound bounds SURVIVE-LOOSER (flag for optional tighten);
                  witnesses re-checked for membership; advised precision decays
    contradicted-hypothesis → kill (their existing rule)

### B.3 The law this yields: EVIDENCE IS TOLL-FREE

Conditioning strictly shrinks S, and every sound bound over the old S
remains sound over the new S — so **no observation that merely narrows ever
forces invalidation; only determinations (which advance the root and change
the value's SUBJECT) pay a teardown.** Consequences:

1. Mid-turn reveals and C1 inferences cost zero invalidation — the bank,
   the enumerations, the thread values all stand, merely tightenable.
2. C2 conditioning becomes purchasable mid-decision with NO teardown
   externality: the operation-set prices of 09-doc §4 are pure compute,
   which the voc lever comparison needs to know (a lever whose spend also
   invalidated state would need a different price line).
3. The dilate half of ingestion is NOT covered — a real turn advancing the
   root is a determination of every acted variable (their n=all row), and
   ply-1 values die there as their doc already says. The law's scope is
   the conditioning half exactly, which is also its proof's scope
   (S' ⊆ S holds for conditioning and fails for dilation).
4. The contradiction rule (03-doc §8) composes: an unwind REWIDENS S, and
   rewidening breaks the S' ⊆ S premise for state tightened after the
   dropped evidence — so the trace records, per tighten, which entries it
   read (evidence citations, same pattern again), and an unwind kills
   exactly the tightenings citing dropped entries. Citations all the way
   down, on both halves, which is the strongest sign the two lenses'
   factorizations are one design.
