# SYNTHESIS — the epistemics factorization

The standalone summary of the design/belief-fog line. Details and derivations:
`00-THE-OBJECT.md` (the object and laws), `01-OBSERVATION-API.md` (fog as a
wire parameter), `02-PROJECTIONS-AND-WEIGHTS.md` (value table, weight socket,
risk dial), `03-WORKED-FOG-SCENARIO.md` (the trace and its three findings).

SECOND-PASS STATE (owner rulings 49/50 — nothing final): this doc is amended
in place where later passes changed it, and three documents extend it:
`06-RESEARCH-AUDIT.md` (the object tested against the imprecise-probability,
belief-state-search, box-particle-filter and uncertainty-weighted-search
literatures; one reversal, one new law rider, one new mechanism, one
representation upgrade, one honest counter-example), `07-REDTEAM-VALUE-FOLD.md`
(the assigned red team of the value lens's fold), `08-CONTRACTS-SKETCH.md`
(builder-facing signatures), `09-AMENDMENTS-COMPOSITION-REDTEAM.md` (the
composition lens's eight findings answered; the falsifiable claim below is
restated per its adopted form).

---

## 1. The answer to the mandate's question, in one paragraph

There is one epistemic object. A belief is a pair **(S, w)** — a proved
SUPPORT over worlds that moves only by dilation (dynamics) and conditioning
(evidence), and a WEIGHT over that support that moves on any evidence at the
precision the evidence earned. Every epistemic mechanism the program has
built — possibility clouds, Kleene trits, ScoreBounds and their basis, the
bound bank's B0–B3, BranchPosterior, advisoryEst and its clamp, sigmaOfPly,
the cover-counting dodge discount, the posture governor — is a PROJECTION of
that pair, and the architectural complexity the mandate targets is the cost
of having built nine projections as nine idioms without naming the object
they project. The sound/advised split is the object's own grain: sound =
quantified over ALL of S (weight-invariant, adversary-proof), advised =
integrated under a NAMED w. Fog, the opponent model, the risk policy, the
advisory channel and the depth channel are the five faces of the same pair.

## 2. Direct answers to the four design questions

**Q: Is there one object from which proved intervals, advisory estimates,
possibility clouds, cover-counting discounts, and cross-turn fog all fall
out?** Yes — (S, w), with a small law set (00-doc §8): support law, weight
law, projection law (every number tagged (horizon, quantifier-or-weight,
basis)), refusal law (tag mismatch never compares silently — the existing
basis refusal, generalized), reducibility law (every held component tagged
with its removal operation). Clouds are S's marginals; intervals are S's
value envelope; est/mu are w's expectations; cover-counting is the canonical
w that S itself induces; fog is S's evolution under partial conditioning.

**Q: What is the real joint between SOUND and ADVISED?** Quantifier vs
measure — not "proved vs guessed". Both channels are arithmetic over the same
S; sound statements survive any change of w, advised statements are exactly
as good as w. Consequences: the advisoryEst clamp is a missing type (a
declared same-horizon expectation under an in-support weight is in [lo,hi] by
theorem); the deep channel's escape from the interval is a horizon tag, not
an exception (and the projection tags are now ONE declaration with the time
lens's citation records — coordinates drive invalidation, tags drive
comparison-refusal; the two designs share the mechanism and must keep
sharing it); and the potion-play defect is PRECISION LAUNDERING — an
advisory opinion inheriting interval-earned proof-grade precision by riding
the est scalar (02-doc §1). The repair is the value table: BankResult carries
{envelope, estSound, estAdvised, advisoryPrecision}; belief folds advisory as
its own ObservationKind at earned precision; unfitted terms order but never
move belief.

**Q: What should the engine expose for observability?** Observations, not
states: per-team view documents (the privateMoves precedent — Firestore
cannot mask fields per reader) carrying (facts, mask, events). The mask is
data — `hiddenUnits: [{unitId, lastSeenTurn}]` is literally a FrozenRecord
constructor — and per-(observer, unit, attribute) masking subsumes per-cell
rules. Bot-side, ingestion becomes `S' = condition(dilate(S), obs)`: dilation
is the cloud engine unchanged; conditioning is a three-rung sound ladder
(C0 occupancy/attribution set-arithmetic, C1 item-vanish and sever-geometry
inference, C2 sub-step non-event exclusion), carried in a ConditioningTrace
that keeps CloudTimeline pure and cacheable. Today's game is the degenerate
total-mask case; code written against the observation record runs unchanged
on it.

**Q: Where does the opponent-model socket live relative to belief?** Between
the support and every advised consumer: a WEIGHT SUPPLIER over the
coordinates of S — enemy actions AND hidden-unit positions (the 03-doc
mixture-dodge correction). `'adversarial'` is its zero point (refuse to pick
a weight = keep the quantifier = ruling 13's population), which is the data
point the ruling gives us: the socket's type must span quantifiers and
measures — a credal set. D3's response rule is then a functional over that
set, and the ε-contamination class gives it a closed form,
`(1−ε)·estAdvised + ε·lo`, making D2×D3 two axes of one object (supplier id
× ε) and fear single-surfaced. Four consumers that today improvise opponent
treatment (dodge, potion exposure, thread replies, sigmaOfPly's theirMiss —
the last is uniform-hardcoded-implicitly) rewire to one call.

## 3. The deepest joint found: reducibility of held width

Held-by-choice (the scheduler froze it) and held-by-ignorance (the game hides
it) are the SAME epistemic state with DIFFERENT removal operations. All cloud
/ risk / bounds / posture machinery applies verbatim to an invisible enemy —
it is a FrozenRecord whose hold the game imposes. Only the ECONOMICS fork:
the voc lever menu (catch-up → preview → narrow → advance → deepen) assumes
un-holding is purchasable with compute; for a game-held unit those levers do
not exist and only C2-deduction and weight-refinement do. One provenance enum
on the hold record, read by the lever menu and nothing else (respecting voc's
two-currencies-no-scalar law).

**The tag's contract, stated precisely (per the time lens's correction —
their design/time-interruption line absorbed this joint and caught the
mismatch):** the tag answers "what can REMOVE this width" (compute-meet /
observation / nothing-this-turn) and gates only removal levers. It never
answers "what may be bought AGAINST this width": hedged preparation —
pre-spending compute on conditional frontiers per possible reveal — does not
narrow anything; it buys REACTION LATENCY for the turn the determination
arrives, and it is always open and priced by the scheduler, not the tag. A
consumer that conflates the two reads observation-reducible width as
"compute may do nothing here" and forecloses exactly the pondering that fog
makes valuable. Two purchases, two prices; the tag governs one of them.

This joint is why cross-turn fog is an
ingestion feature, not a rewrite — the falsifiable claim of the whole line,
AS AMENDED under the composition red team (09-doc, adopted verbatim):
**invisibility changes no soundness law and no bound arithmetic, but WILL
change modal posture, lever set, and frozen-slot occupancy — three
pre-registered numbers that must move within a predicted band** (09-doc §9).
The tag above is the operation-set form of 09-doc §4 (C0–C2 are compute that
removes observation-tagged width — the enum form mis-gated exactly them);
the FOGGED-VACUOUS regime shift makes the value-table fix a PREREQUISITE of
the fog programme (09-doc §1), and the observation-held units publish
simStale = 0 so the voc catchup lever never leeches on an impossible repair
(09-doc §2).

## 4. Findings that amend standing verdicts (for the pins)

1. **FOGGED postures become legitimate production states** under invisibility
   (amends dof-synthesis Part I §1's doctrine sentence; zero code change —
   the governor never keyed on WHY a hold exists, which is vindicated).
2. **The kindSet promotion fork returns from the dead**: a hidden pawn's
   promotion is masked with the rest of its row, so "ambiguously a queen" is
   real again in production. PIN 20's do-not-delete gets its concrete
   exhibit. (Unless the redaction policy publishes hidden-unit promotions —
   a named game-design dial.)
3. **The static CloudPremise is unsound across real turns**: "item spawning
   is gated off while anything is frozen" is a simulation covenant, false in
   production (potions 0.15/turn, always on). A cross-turn hold needs the
   time-indexed premise (per-turn item boards ride the ConditioningTrace;
   conservative union under compaction). The ONE vendored-engine amendment
   the fog programme requires.
4. **The reappearance oracle**: every reappearance (expiry, C1 collapse
   later confirmed) must land inside the predicted cloud — a free, live,
   production soundness audit of the entire pipeline; a violation throws.
   The tripwire discipline the depth-idle lesson demands, built into physics.

## 5. What NOT to build (negative space, argued in the docs)

- No probabilistic support updates — a "probably went left" is a weight
  update; S takes only deductions. (Keeps every floor a floor.)
- No per-cell visibility model — per-(observer, unit, attribute) masking
  plus an optional lit-region field expresses vision-radius rules too.
- No second-order weights now (what the enemy believes we believe) — the
  observer-indexed constructor Belief(observer) is built for pricing THEIR
  SUPPORT over our hidden units (a D1 term family, pure deduction we can run
  exactly); empathy-grade prediction stays with the humans per ruling 13.
- No bank rewrite — B0–B3 restate cleanly as coarsening schemata over S
  (documentation, adopted in 00-doc's table), and the restatement's value is
  what it forbids future members from doing (a member that integrates
  instead of quantifying is not a floor). Code untouched.
- No inverse-dynamics engine for C2 at launch — deferred, priced as a
  purchasable narrowing behind the reducibility tag.

## 6. Build sequence (each step independently valuable, falsifiable, ordered)

| # | Step | Acceptance |
|---|---|---|
| 1 | estSound beside estAdvised; belief reads estSound (the queued potion fix, typed) | floor/dec dose-response flattens; potion ordering wins retained |
| 2 | 'advisory' ObservationKind at earned precision (0 until fitted); provenance column | belief bit-for-bit vs step 1 with unfitted terms; laundering measurable |
| 3 | Action-support constructor + weight-supplier slot (adversarial/uniform/cover); rewire dodge, then exposure, then theirMiss | dodge bit-for-bit; exposure false-alarm rate on the 03-scenario boards; log-loss harness runs on Turn.moves at zero match cost |
| 4 | ε-contamination reading at the est rung, ε=1 default | bit-for-bit at ε=1; (supplier × ε) grid on potion cells |
| 5 | ObservationRecord wire schema + per-team views in TacticToes (behind game config, never a bot flag) | full-info games byte-identical; view docs match masked full record |
| 6 | Ingestion via mask→hold with real observedTurns; reducibility tag filtering the lever menu | full-info play byte-identical (mask empty ⇒ no holds ⇒ no path change) |
| 7 | ConditioningTrace in the timeline + time-indexed premise + C0/C1 | reappearance oracle green over seeded fog games; cloud width vs no-conditioning measured |
| 8 | Belief(enemy) + concealment-spend D1 terms | the mirror scenario: hidden collector declines the revealing meal when the window value says so |

Steps 1–4 pay off TODAY (they are the potion-intelligence est-value fix and
the D2 socket the pins already queue); steps 5–8 are the fog programme.
DEPENDENCY AMENDED under the composition red team (09-doc §1): steps 1–2 are
PREREQUISITES of 5–8, not a parallel track — under fog the FOGGED-VACUOUS
posture makes est the modal ordering channel, and shipping fog against a
precision-laundered est is shipping the defect at scale. Step 3's supplier
slot is also read by step 7's mixture dodge.

## 7. Dilemmas for the owner (rulings needed before the affected step)

1. **Redaction policy defaults** (step 5): item boards truthful (recommended
   — else clouds saturate, C1 dies, invisibility strictly dominates); deaths
   public; hidden-unit promotions masked (fork returns) or published (fork
   dormant). Each is a fog-depth vs bot-complexity dial; priced in 03-doc.
2. **ε ownership** (step 4): DISSOLVED at third pass (11-doc Part A). ε is
   fitted (ε_min per supplier per stratum, closed form off the log-loss
   harness), not owned by anyone as a dial; the per-term mean-vs-worst
   choices still fold into the single blend, and the operator-facing D3
   control that REMAINS is appetite only (utility curvature — the
   tournament-context call that was always the operator's). This is a real
   SIMPLIFICATION OF THE OWNER'S DECISION SURFACE: of the two fear-shaped
   controls the joint frame anticipated, one is now a measurement with
   provenance, and the operator's whole risk surface is a single legible
   dial whose meaning ("gamble / ice the game") never mixes with model
   error. What needs the
   owner's eyes is no longer "who holds ε" but the fit-transport rule:
   an ε̂ fitted on the population refuses per-opponent use until ruling 13
   lifts.
3. **Thread-reply coupling** (step 4): REVERSED on second pass (06-doc §2).
   Recursive per-ply blending is the Epstein-Schneider rectangular
   construction: dynamically consistent, but the advised component decays as
   (1−ε)^d, deep readings collapse toward maximin regardless of the weight's
   quality, and depth is discounted twice (once structurally, once by
   sigmaOfPly's earned precision). Amended recommendation: ε applies ONCE at
   the root reading of each projection; thread interiors stay pure maximin
   (unchanged today) and the deep advised estimate is blended once when
   folded at the origin branch. The dynamic inconsistency this accepts is
   priced in 06-doc §2 (the bot re-decides every turn; root re-evaluation is
   the real dynamics).
