# Research audit — the (S, w) object tested against the field that invented it

Second-pass document (owner rulings 49/50: iterate; fitted constants are members
with premise coordinates; academic grounding). Every citation below was
verified against the source this session (fetched abstract or full text);
claims marked (from memory) are standard results I did not re-fetch.

Outcome up front: the object survives, with **one self-correction** (the
thread-ε coupling recommendation in 04-doc §7.3 was wrong and is amended),
**one new law rider** (re-centering, §1), **one new mechanism** (fitted leaf
residual in sigmaOfPly, §5), and **one representation upgrade** (disjunctive
support, §4).

---

## 1. Dilation — the literature's own pathology, and where it does and does not bite

**The phenomenon** (Seidenfeld & Wasserman, *Dilation for Sets of
Probabilities*, Annals of Statistics 21(3):1139–1154, 1993; Wasserman &
Seidenfeld, *The dilation phenomenon in robust Bayesian inference*, JSPI 40:
345–356, 1994 — both fetched): for a credal set M, the conditional
lower/upper interval of an event A given B can STRICTLY CONTAIN the
unconditional interval — for EVERY B in a partition. Observing anything makes
you strictly less precise. ε-contaminated neighborhoods are a canonical
dilating family (WS94 keywords; Pelessoni & Vicig, IJAR 140:211–231, 2022,
characterize dilation for the Nearly-Linear family that includes the
ε-contamination model). Note the collision of vocabulary: our cloud engine's
"dilation" is temporal widening under dynamics — the literature's dilation is
widening under CONDITIONING, a different and nastier thing. This section uses
"IP-dilation" for the latter.

**Where it cannot bite us — a one-line theorem.** The conditioning ladder
C0–C2 operates on the SUPPORT by intersection: S' = S ∩ E. Value envelopes
are monotone under intersection — min over S' ≥ min over S, max over S' ≤ max
over S — so a sound interval can only narrow or hold under evidence.
IP-dilation is a fact about generalized-Bayes conditioning of a SET OF
MEASURES; the support laws never perform that operation. L1 (support moves
only by dilation-in-time and conditioning-by-intersection) excludes
IP-dilation of the sound channel *by construction, not by luck* — this was
implicitly assumed in the first pass and is now stated as what it is.

**Where it genuinely could bite.** Two future paths, both now fenced:

1. A D2 supplier doing within-game Bayes ADAPTATION over a credal prior
   (dof-synthesis D2 names "within-game Bayes with halflife") is generalized
   Bayes over a set: observing an enemy's move could WIDEN our interval over
   their next action, and the sticky stager would then thrash on evidence —
   decision instability caused by observation, the exact pathology.
2. Conditioning the ε-contamination class itself (pricing "value given reply
   r" robustly by GBR over the class): the class is not closed under
   conditioning, the posterior contamination rate is data-dependent, and the
   family dilates (Pelessoni-Vicig).

**The fence — the RE-CENTERING RIDER, added to L2:** *the credal set is
re-erected around the current w at each reading; it is never conditioned as a
set.* Between readings, w moves by precision-weighted merge (a point update)
and S by intersection; the ε-ball is a READING-TIME construction. The price,
stated honestly: the sequence of readings is not the conditioning of any one
fixed credal set (dynamic incoherence in Walley's sense — the trade the
literature knows; Epstein & Schneider's rectangularity (from memory:
*Recursive multiple-priors*, JET 113:1–31, 2003) is the alternative and is
declined below).

**Vindication of the split itself.** Gong & Meng (arXiv:1712.08946, fetched):
the generalized Bayes rule "is incapable of updating without prior
information regardless of how strong the information in our data is" — the
vacuous-prior inertia. A design that maintained one credal object and
conditioned it by GBR would start vacuous (that is what sound means here) and
LEARN NOTHING, ever. The (S, w) split — set-conditioning for the sound half,
point-precision-merge for the advised half — is precisely what lets a bot be
simultaneously sound and capable of learning. The first pass chose this shape
by engineering instinct; the IP literature supplies the theorem-grade reason.

## 2. ε-contamination — properties confirmed, one recommendation reversed

Confirmed: the closed form (1−ε)·E_w[V] + ε·min_S V is the lower prevision of
the linear-vacuous mixture class (Walley 1991, from memory; the model appears
as a named special case of Pelessoni-Vicig's Vertical Barrier Models —
fetched). 2-monotone, so the reading composes with comparison the way 02-doc
§5 claims.

**The reversal.** 04-doc §7.3 recommended coupling: depth threads' inner min
runs the root's ε. The literature says that choice is exactly the
rectangularity decision (Epstein-Schneider): applying the blend RECURSIVELY
at every ply is the dynamically-consistent recursive-multiple-priors
construction — but it COMPOUNDS: the advised component decays as (1−ε)^d
along a d-ply line, so deep readings converge to maximin regardless of the
weight's quality, and depth under contamination collapses toward the very
worst-case-passivity the advised channel exists to relieve. Worse, it
double-discounts depth: sigmaOfPly already pays model-error precision per
ply. Two depth discounts, one earned, one structural — the exact shape of
mistake (two compensating fear knobs) the dof synthesis forbids.

**Amended recommendation (04-doc §7.3 edited to match):** ε is applied ONCE,
at the root reading of each projection; thread interiors stay pure maximin
for the sound thread value (unchanged today) and the deep ADVISED estimate is
blended once when folded at the origin branch. Cost: dynamic inconsistency
(the plan a deep node would choose re-rooted differs from the plan the root's
blend implies) — accepted deliberately, because (a) the bot re-decides every
turn anyway, so root-re-evaluation is the actual dynamics, and (b) the
alternative's compounding pessimism is a measured-in-kind harm. This is now a
recorded design decision with its literature name attached, instead of a
sentence in a dilemma list.

## 3. ReBeL and public belief states — the lesson lands on the mirror

ReBeL (Brown, Bakhtin, Lerer, Gong, NeurIPS 2020 — fetched): make the VALUE
FUNCTION take the public belief state as input; infostate values are
supergradients of the (concave) PBS value; search on a fixed belief without
accounting for how policy shapes beliefs is exploitable, so safe subgame
solving carries the belief explicitly.

Mapping onto (S, w):

- "Value depends on belief" is our projection-tag discipline: every value
  carries its basis (which S) and weight-id (which w). A V(board) with no
  tags is exactly the object ReBeL proves inadequate under hidden state.
- The exploitability lesson binds where the MIRROR lives (03-doc §3): when
  our unit is hidden, our move choice SHAPES Belief(enemy), and pricing
  moves against a frozen enemy belief is the exploitable pattern. The
  concealment-spend D1 terms are the first-order fix; the full fix (policy
  and belief solved together) is deliberately out of scope for a worst-case
  Centaur — recorded so the boundary is a choice, not an oversight.
- Belief-space blowup: ReBeL carries a distribution over ~10³ private states
  and samples; we carry SET-compressions (clouds) and refine by the C-ladder.
  Same problem, two compressions — theirs weighted and unsound-if-truncated,
  ours unweighted and sound. The next section is about getting both.

### 3b. The honest counter-example: DeepNash

DeepNash (Pérolat et al., *Science* 378, 2022 — fetched) reached human-expert
Stratego — imperfect information at 10^535 nodes — MODEL-FREE, with no
search and NO explicit belief tracking at all: regularized Nash dynamics over
self-play, the belief living implicitly in the policy network's weights. The
strongest published result on a large fog board game is belief-free, and an
audit that only cited ReBeL would be curating the evidence.

Why the counter-example does not transfer, stated so it can be re-examined
if the premises move: (a) DeepNash's guarantee is exploitability-flavored
(approximate Nash in expectation over huge self-play); it offers NOTHING
like a per-decision sound floor, and the owner's Centaur doctrine (ruling
13: conservative advice, humans take the risks) makes the per-decision floor
the product; (b) it needs training at a scale the program does not have and
rulings forbid depending on; (c) its implicit belief cannot be inspected,
priced, or handed to an operator — the mechanism-report/operator-pin
surface is load-bearing here. The honest residue: DeepNash is evidence that
EXPLOITING fog (bluffing with invisibility, randomizing collection routes)
may eventually want policy-gradient machinery rather than deeper belief
modeling — which is D3's mixing temperature and the humans' empathy
department, and a reason the mirror's scope stays deliberately narrow
(03-doc §3, 09-doc §7).

## 4. Particles vs masks — the box-particle literature answers the compression question

The question posed by the extended mandate: is the possibility-cloud
representation the right belief compression at high occlusion, or do
particles win? The filtering literature has met this exact fork:

- Point-particle filters (POMCP's belief particles — Silver & Veness 2010,
  from memory) are expressive but suffer particle DEPRIVATION: a
  low-probability observation empties the particle set, and the filter's
  support no longer contains the truth — for us that is an UNSOUND floor,
  disqualifying point particles from the sound channel outright.
- BOX PARTICLE FILTERS (Abdallah, Gning, Bonnifait 2007; Gning, Ristić,
  Mihaylova, Abdallah, *An Introduction to Box Particle Filtering*, IEEE
  Signal Processing Magazine 2013 — both fetched): particles that are BOXES
  with weights, propagated by interval analysis; "a few dozen box particles"
  match the accuracy of thousands of point particles under imprecise
  measurements.

The cloud engine is a ONE-box box-PF with a vacuous weight. The kindSet fork
is already a TWO-box mixture on the kind coordinate. The upgrade the
literature recommends and the (S, w) object admits without new laws:
**disjunctive support** — S as a small union of cloud-boxes, each box a
hypothesis branch (post-C1: "ate food A and is near A with health h₁" ∪
"never reached A, wider but hungrier"), with weights over boxes living in
the advised channel. Soundness is preserved by construction (a union of
over-approximations over-approximates; dropping a box is FORBIDDEN — that is
deprivation; MERGING boxes by union-hull is the sound compaction operator).
Box count is the compression dial: 1 = today's engine, k small = correlation
kept where C1 evidence created it, hull-merge under pressure = graceful
degradation to today. This resolves the mask-vs-particle question with a
better answer than either: sound boxes, advised weights — the pair again.

Where it pays first: 03-doc's T13 mixture-dodge (weights over cloud cells)
becomes weights over BOXES, which is cheaper (few boxes, not many cells) and
keeps the position-health correlation the flat cloud loses — the difference
between "somewhere in this 30-cell fog, health unknown" and "either at the
food with full health or in the corridor exhausted".

## 5. KataGo — precision-weighted search validated, and the one term we are missing

KataGo's *Uncertainty-Weighted MCTS Playouts* (KataGoMethods.md, fetched, in
production since v1.9.0, part of a measured ~75 Elo gain with dynamic cPUCT):
the net predicts its own short-term value error; playouts are weighted
roughly inversely to reported uncertainty when averaged into node values.
That is precision-weighted backup — the strongest open-source game program
independently converged on the same aggregation our belief.ts uses. Two
deltas worth stealing, one worth refusing:

1. **The missing term (steal).** KataGo's uncertainty is the net's estimate
   of ITS OWN residual error vs deeper search. Our sigmaOfPly measures the
   line's discrimination state (world, spread, misses, fog, interference) —
   the SIMULATION's error — and a perfectly enumerated line earns σ = 0,
   infinite precision. But the value at the leaf is still the ONE-PLY
   EVALUATOR's opinion of a position d turns out; its residual against
   deeper truth is not zero and is not in the quadrature. Add an
   `evalResidual` term to sigmaOfPly's inputs: fitted from our own replay
   corpus (evaluation at t vs deeper-search value at t — the retrodiction
   harness already computes both), per stratum, entering per ruling 49 as a
   member with fit provenance as premise coordinates. This closes the honest
   gap where a clean line's proof-grade precision silently vouches for a
   fallible evaluator.
2. **Subtree value bias correction (a future advisory member).** KataGo
   online-learns per-bucket ERROR of the raw evaluation vs its own subtree
   and corrects — not a fresh value, a bootstrapped correction. In our
   vocabulary: an advisory term whose weight is fitted online within the
   decision, with the mechanism report as its bucket ledger. Parked as a
   candidate entry shape, not designed here.
3. **The minimum-uncertainty floor (refuse, with the reason on record).**
   KataGo caps the maximum weight of one playout via a baseline uncertainty,
   because a LEARNED uncertainty can be overconfident. Our no-caps law
   (ruling 12) stands for PROOF-DERIVED precision — a collapsed interval is
   a proof, and capping it would be fear expressed twice. But the moment
   term 1 lands, the combined sigma is part-fitted, and the fitted PART
   carries its own error bars — which is the same discipline 02-doc §3
   already imposes on advisory precision. No floor constant; fitted
   variance with provenance instead.

## 6. Consolidated deltas to the first-pass docs

| Doc | Change | Provenance |
|---|---|---|
| 00 §8 | L2 gains the re-centering rider | §1 (S&W 93/94, P&V 22, G&M 17) |
| 04 §7.3 | thread-ε coupling REVERSED: one-shot at root | §2 (E&S rectangularity, compounding) |
| 01/03 | disjunctive support (union-of-boxes) as the named upgrade path; drop-forbidden / hull-merge rules | §4 (box-PF literature) |
| scout | `evalResidual` fitted term in sigmaOfPly, premise-tagged | §5 (KataGo error head), ruling 49 |
| 03 §3 | mirror's exploitability boundary recorded as a choice | §3 (ReBeL safe search) |
