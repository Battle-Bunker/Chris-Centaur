# The weight-half dilation guard, and the librarian's cycle-3 items

Answers the prior-art lens's C9/C10 (the survey's most-dangerous flag: our ε
form is Walley's linear-vacuous mixture and that class dilates) and their
cycle-3 deliveries C25/C26/M21/C27. The C9/C10 argument is made explicitly
against Seidenfeld-Wasserman rather than assumed, as demanded — and it holds,
with one law promoted from rider to guard and one terminology fix adopted.

---

## 1. C9/C10 — the argument, made against the theorems

**Their charge, stated fairly.** The linear-vacuous class dilates
(Seidenfeld-Wasserman 1993): element-wise conditioning of the class can
strictly widen the credal interval for EVERY element of a partition — one can
know in advance that observing will leave one less certain. My laws protect
S (deduction-only intersection, genuinely narrowing) but the weight half was
argued by a rider ("re-erected, never conditioned") that was never checked
against the theorem's operation.

**The check.** The S-W dilation theorems are statements about one specific
map: M ↦ M|B, conditioning EVERY member of a fixed credal set (generalized
Bayes / regular extension) and taking envelopes of the conditioned set. Walk
our weight half's full lifecycle and that map is applied NOWHERE:

1. At a reading, the ε-ball M_t = {(1−ε̂)w_t + ε̂q} exists only inside one
   static functional — the lower expectation (1−ε̂)E_{w_t}[V] + ε̂·min_S V.
   No conditional of M_t is ever formed.
2. Between readings, the update is: w_{t+1} = point-update(w_t, evidence)
   (precision merge, or re-derivation from the new S by a derived supplier);
   S_{t+1} = S_t ∩ E; ε̂_{t+1} = table(supplier, stratum_{t+1}). The ball is
   then RE-ERECTED around w_{t+1}. At no step is any member of M_t
   conditioned on anything.

So the pathology's generating operation is absent by construction, not by
luck. **Promoted from rider to guard (L2-G, in 00-doc):** *no code path may
form a conditional of a credal set; weights move by point-update, supports by
intersection, balls by re-erection.* A future D2 adapter doing within-game
Bayes over a credal prior (the one path 06-doc flagged) violates L2-G at the
type level — the guard is what makes that a review-time catch instead of a
shipped pathology.

**What the guard does NOT forbid, stated honestly.** The ball can WIDEN
between readings because ε̂ is stratum-indexed and the game moved to a
harder stratum — and the harness just measured exactly that (13-doc finding
4: ε̂(cover) 0.12 quiet → 0.46 contact). Three reasons this is not the S-W
pathology wearing a hat: (i) it is partition-ASYMMETRIC — an observation
resolving to the quiet stratum SHRINKS the ball, so "wider under every
outcome, knowable in advance" cannot arise from the table unless every
reachable successor stratum measures harder, in which case (ii) the widening
is a FITTED FACT about play with a CI attached, auditable in the ε̂ table,
not an artifact of conditioning arithmetic; and (iii) it changes only
advised readings — the sound channel's envelope still narrows monotonically
under the same evidence (the toll-free theorem), so no floor, veto, or
refusal ever weakens on observation.

**Their structural test, answered.** "Dilation requires the credal set to
intersect the independence plane; the vacuous adversarial supplier trivially
does — maximally dilation-prone." For the vacuous set the operative
conditionals in OUR system are event-level: lower expectations over S∩E,
which are monotone in E (min over a subset ≥ min over the set) — the vacuous
prior sits at the FIXED POINT of dilation ([0,1] cannot strictly widen), and
its value envelopes only narrow. The S-W intersection test bites credal sets
strictly between vacuous and precise under GBR — exactly the sets L2-G
forbids conditioning. The two ends we actually use (vacuous quantifier;
point weight with re-erected ball) are the two ends the pathology cannot
reach.

**The two operational holes they named, closed:**

- *"advisoryPrecision treated as monotone in evidence"* — monotone
  accumulation is confined to WITHIN-REBUILD folding of independent
  readings; across evidence events the kernel's own discipline
  (rebuild-from-latest-triple, `refreshBelief`; the conditioningEpoch of
  12-doc §1) re-derives rather than accumulates, so precision falls when
  the stratum or the reading changes. Precision is a ratchet nowhere; the
  12-doc epoch is the mechanism that makes that true mid-decision.
- *"the scheduler can pay for an observation that provably dilates"* — no
  purchasable operation conditions a credal set (L2-G), and every
  purchasable conditioning (C1/C2) intersects S, where meet=narrow is a
  theorem. Ball-width changes ride stratum shifts, which are not purchases.
  "Meet = narrow, priced" is now explicitly scoped to the support half; the
  weight half has no meet to buy.

**Terminology fix, adopted.** The word collision is real and would let a
reader of both literatures believe the pathology is handled because the word
appears. In these docs, dynamics-driven cloud growth is now **spread**
(spread-in-time), and **dilation** is reserved for the IP pathology
(06-doc already coined "IP-dilation"; this doc completes the split). The
vendored engine's `dilate`/`DilateScratch` names are upstream identifiers
and keep their names until an engine sync renames them — flagged as a
rename-on-next-sync item so the collision dies at the source too.

## 2. C25 — the QMDP hole: claiming the VOI seam explicitly

Their charge is correct and the concrete prediction is accepted as a test:
nothing in any lens's architecture makes information valuable in the ACTION
value, so under invisibility the bot will never spend a move to scout. In
(S, w) terms the defect is typed: every candidate is priced over the SAME S
— QMDP's exact assumption (uncertainty resolves identically regardless of
action).

**The seam, claimed.** A candidate's value table gains an INFORMATION FLOW
term, owned jointly: this lens supplies both beliefs and the per-action
observation model; the value lens denominates it as a flow in the common
currency; the search lens's operators may propose scouting moves; the
economy prices its compute.

    VOI(a) = E_w[ V(S'(a)) ] − V(S),   S'(a) = condition(spread(S), obs(a))

With the DISJUNCTIVE SUPPORT this is tractable by construction: the boxes
are the hypotheses, an action either separates two boxes (its observation
differs under them — visibility, forced contact, item tells) or not, and
the value of separation is the spread of best-response values across the
separated boxes — classic VOI over a scenario set, upper-bounded by the
boxes' value range, weighted by the advised box weights. ADVISED channel
only: VOI is an expectation under w (information has non-negative value in
expectation — M21's subclass even has it as a theorem); the sound floor
never moves on a hope of learning. Placement: an ordering/est-rung flow and
a D1 term family at fog step 7 ("expected support-width purchased per
candidate"), with C25's prediction as the acceptance test — the configured
bot walks the three cells that settle the question, the QMDP bot does not.

## 3. C26 — marginals evaporate C1/C2: reconciled, and the store wins

Their finding sharpens my cycle-6 rule. Item-vanish with two candidate
eaters is a DISJUNCTION across units; sub-step exclusion is a JOINT
exclusion; per-unit marginal clouds can store neither, so every marginal
stays wide and a null conditioning-effect measurement would read as "the
rung is weak" when it is merely UNSTORABLE. My joint-scenario boxes answer
the two-eater case but DNF-explode in general: k independent disjunctions
want 2^k boxes, and the box cap's hull-merge evaporates exactly the
correlations again.

**Adopted, explicitly: the constraint store is the TRUTH; boxes are a
VIEW.** The ConditioningTrace's entries already ARE constraints — the store
is the trace kept un-compiled (lossless, linear in evidence), marginal
clouds are its cheapest query surface (the hull), and scenario boxes become
a BOUNDED ON-DEMAND COMPILATION: for the ≤k most decision-relevant
constraints (the mixture dodge's attackers, the VOI computation's
hypotheses), compile the disjunction into boxes; hull everything else. This
subsumes both proposals — no 2^k store, no evaporation at storage, and the
compilation budget is a compute knob, not a soundness knob. Consequence for
the validation plan (05-doc): the conditioning-effect instrument measures
at the STORE level (constraints held, strength, compilation hits) — never
only cloud width — so storage limits can never masquerade as rung weakness.

## 4. M21 — the one-sided subclass: adopted as backstop and as the carry shape

Under invisibility-with-truthful-items, we are the uninformed player of a
one-sided POSG — Horák & Bošanský's solved subclass (value function PWLC
over our belief; HSVI solvers; search-game benchmarks). Three adoptions,
one deferral:

- **Theory backstop**: the fog game's value structure is KNOWN — cite it in
  01/04 as the existence proof that the belief-indexed value the projection
  tags describe is well-posed, and that information's non-negative value
  (C25's term) is a theorem in exactly our case.
- **The α-vector carry shape**: PWLC means a plan's value is LINEAR in the
  belief over scenarios — with box-scenarios, a plan's α-vector is its
  per-box value row, which box-aware consumers compute anyway. Carried rows
  (the worldline's attention map) should store the per-box row, not a
  scalar: validity across a turn = the current box weights staying inside
  the row's dominance region, which is a richer and CHEAPER test than
  premise-equality (a region test survives small belief drift that
  exact-match would kill). Handed to the time lens as a concrete upgrade to
  the carry store, costed: one small vector per carried row, k ≤ box cap.
- **The maximality dual as Centaur output**: a SET of undominated plans
  with dominance regions over beliefs is the natural operator surface under
  fog ("plan A unless they're in the corridor, then plan B") — noted for
  the eventual legibility framework (ruling 44's LATER), not built.
- **Deferred**: HSVI-style solving and their benchmarks — different scale
  regime; parked as a v2 sanity-check idea, honestly labeled.

## 5. C27 — observation branching commits to the DESPOT shape

Adopted as the stated pattern before any observation-branching code exists:
when threads must branch on observations under fog (C2, VOI lookahead,
post-reveal planning), the branching is SAMPLED SCENARIOS × ALL ACTIONS
with a regret-style bound — never an ad-hoc per-node observation cap. The
disjunctive support makes the sampling frame native: the boxes are the
scenario set, sampling weights are the advised box weights, and a scenario
sample is a coherent WORLD (one box, one trajectory), not an independent
per-node draw. This is one sentence of commitment now so that the first
fog-thread builder inherits a shape instead of inventing a cap.
