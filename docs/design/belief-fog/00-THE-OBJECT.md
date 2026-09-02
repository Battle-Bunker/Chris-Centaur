# The Epistemic Object — support × weight, and everything as a projection

Design lens: EPISTEMICS (belief, uncertainty, bounds, fog).
Branch: `design/belief-fog`. Status: design document, no shipping code.
Sources verified against `claude/cluster-lookahead` tip (belief.ts, bounds/bank.ts,
search/core.ts, evaluate/bound.ts, evaluate/dodge-discount.ts, scout/scout.ts,
partial-engine/{cloud,risk,bounds,narrow}.ts, substrate.ts, postures.ts) and the
owner's own words in the session transcript (quoted where load-bearing).

---

## 1. The inventory: nine epistemic mechanisms, built separately

What the codebase holds today, each mechanism its own idiom:

| # | Mechanism | Where | Mathematical content |
|---|---|---|---|
| 1 | Possibility clouds | partial-engine/cloud.ts | over-approximating SET of a held unit's states; dilation by turns held; tier/weight endpoint bounds; kindSet fork |
| 2 | Kleene trits | partial-engine/risk.ts | three-valued encounter verdicts (yes/maybe/no) |
| 3 | ScoreBounds + basis | partial-engine/bounds.ts | value interval [worst,best] over a declared world set; assumption basis; typed refusal on basis mismatch; DEAD lattice bottom |
| 4 | Bound bank B0–B3 | bounds/bank.ts | floor = max over qualifying lower-bound schemata; ceiling = min over evaluated points; which-truncation forbidden; witnesses as upper certificates |
| 5 | BranchPosterior | belief.ts | (mu, prec) density inside the sound interval; precision derived (4/(hi−lo)²); precision-weighted merge; deep readings escape truncation with `plies` recorded |
| 6 | advisoryEst + clamp | evaluate/bound.ts | weighted advisory sum onto est, clamped into [lo,hi]; AdvisoryMeter counts what the clamp ate |
| 7 | sigmaOfPly | scout/scout.ts | model-error of a deepened line: world² + spread²·(ourMiss+theirMiss+fog+interfere), in quadrature |
| 8 | dodge discount | evaluate/dodge-discount.ts | cover-counting enemy distribution w(r)=\|C(r)\|/Σ\|C\|; mean endpoint only; independent survival across attackers |
| 9 | Posture governor | postures.ts | SIGHTED / FOGGED-DISCRIMINATING / FOGGED-VACUOUS regime classifier; flips ride the basis |

Plus the observation machinery: `SubstrateInit.observedTurns` (per-unit observation
ages — already plumbed through workers and laws), `heldAtTurn` stamps, and the
rule "staleness = currentTurn − observedTurn, applied once".

Every one of these is correct in isolation. The factorization claim of this
document: **they are all projections of one object, and building them as nine
separate idioms is the architectural complexity the mandate asks us to remove.**

## 2. The object

> A belief is a pair **(S, w)**:
>
> - **S — the SUPPORT**: a set of worlds that provably contains the truth.
>   Over-approximating, always. It may GROW only by dynamics (dilation: time
>   passes, held things move) and SHRINK only by evidence (conditioning: an
>   observation, a rule deduction, a proof). Opinion never touches it.
> - **w — the WEIGHT**: a measure over S. It may move on ANY evidence, at the
>   precision that evidence earned. It must live inside S (no mass outside the
>   support — absolute continuity).

A world, for this game, is a point in the product space

    W = (hidden unit states) × (enemy actions staged this turn) × (free future choices)

and S factorizes over those coordinates the way the engine already factorizes
it: per-unit clouds are the position marginals of the hidden-state coordinates,
reply sets are the action coordinates, thread trees are the future coordinates.

### The projections

Fix a value function V_h — the evaluation at horizon h (V₁ = the one-ply frame
value; V_d = value on a board d turns of play ahead). Then:

| Existing object | Is exactly |
|---|---|
| possibility cloud of unit u | the u-marginal of S |
| tier/weight endpoint bounds | the attribute-marginal of S |
| trit "maybe" | ∃w∈S with the event, ∃w∈S without it |
| sound interval [lo, hi] | [min over S of V₁, max over S of V₁] — the envelope |
| bank floor (B0/B1/B3) | lower envelope computed via a coarsening of S (hold = quantify jointly; enumerate = split a coordinate) |
| witness (B2) | V at one point of S — an upper certificate on the min |
| est / mu | E_w[V] — the expectation under the weight |
| prec | 1/Var_w — the weight's concentration |
| dodge discount w(r) | a CANONICAL weight over the enemy-action coordinate, derived from S alone (§4) |
| sigmaOfPly | dispersion of w accumulated along a trajectory of belief states |
| posture | a regime classification of (S, envelope): support saturated? envelope separating? |
| basis / Assumption set | the NAME of which S a number was computed over |
| stage-0 safe draw domain | the rules-certain-safe subset of the action coordinate of S (the search lens's C-B3 — a ninth projection this table originally missed; its degradation ladder as the set empties is the correct behavior of a projection) |

Nothing in that table is a new mechanism. The claim is about the joints: once
the object is named, the sound/advised split, the opponent-model socket, the
clamp, and cross-turn fog stop being separate design problems and become the
four faces of (S, w).

## 3. The real joint between SOUND and ADVISED

**Sound = a statement quantified over ALL of S.** "For every world the proof
admits, V ≥ lo." Invariant under any change of weight; adversary-proof because
the adversary can only pick a world inside S. This is why the bank never needs
an opponent model: quantifiers don't integrate.

**Advised = a statement integrated under w.** Changes when w changes; can be
discounted, mixed, calibrated, learned; is exactly as good as the weight.

The joint is therefore NOT "proved numbers vs guessed numbers" — both channels
are arithmetic over the same S. The joint is **quantifier vs measure**. Three
consequences the current code reaches by patchwork:

1. **The clamp becomes a theorem, not a repair.** If an advisory term is the
   expectation of the SAME V₁ under a weight supported inside S, then
   lo ≤ E_w[V₁] ≤ hi automatically. The clamp at `advisoryEst` exists because
   today's advisory terms are NOT declared expectations — they are scalars of
   unstated denomination. Re-typing them (§6) makes the AdvisoryMeter's
   `clamped` count a violation detector rather than a loss meter.
2. **The deep channel's escape from the interval is not an exception.** [lo,hi]
   bounds V₁ over S; a deep reading estimates V_d — a different random variable
   on the same worlds. The `plies` field on BranchPosterior is a horizon LABEL
   incompletely applied (only the deep kinds carry it). In the factorization
   every projection carries (horizon, quantifier-or-weight-id, basis), and the
   refusal law (basis mismatch is a typed refusal, already built at
   compareFloors) generalizes: numbers differing in ANY of the three tags never
   compare silently.
3. **D3 (risk policy) interpolates the two channels on the same object.**
   min over S = maximin; E_w = EV; CVaR_α = lower envelope over an α-shrunk
   credal neighborhood of w inside S. The one paranoia dial α is literally the
   size of the set of weights you refuse to choose among — the sound channel is
   α=1 (all weights), the advised channel is α=0 (one weight). One object, one
   dial, both ends already built.

## 4. The opponent-model socket is a WEIGHT SUPPLIER — and the worst-case ruling is its zero point

D2's contract in this frame: **given the enemy-action coordinates of S, return
a weight over them.** A ladder of suppliers, ordered by information content,
every rung obeying the absolute-continuity law (never weigh a move outside S —
the dodge discount's "legal minus rules-certain-fatal" support rule is this law
already applied once):

- **W0 — adversarial** (the current population, owner ruling 13): not a weight
  at all but the quantifier min. The socket's zero point: "refuse to choose a
  weight" = keep the whole credal set = sound channel only.
- **W1 — uniform** over the action coordinate of S. Maximum entropy, zero
  learned content.
- **W2 — cover-counting** (owner ruling 23): push OUR uniform through the
  enemy's best-response map: w(r) ∝ |C(r)|. Derived from S plus the rules
  alone — zero learned content, yet strictly better calibrated than W0 against
  any enemy who must commit before seeing us. This is why the owner's rule
  slotted in so naturally: it is the canonical weight the support itself
  induces.
- **W3 — priors**: engine default action, greedy-food, threat-averse, mixtures.
- **W4 — calibrated/learned**: per-opponent, log-loss on `Turn.moves`.

The data point the ruling-13 restriction gives us: the socket must accept BOTH
quantifiers and measures. That is the credal-set signature — the socket
supplies a SET of weights (singleton = point prediction; everything = worst
case; α-ball = robustified prediction), and D3's response rule is the
functional applied over that set. D2 and D3 are the two halves of one
mathematical object and the dof-synthesis's "sweep D2×D3 as a grid, fuse if no
interior optimum" is exactly what you'd predict when two parameters
parameterize one set.

**Where cover-counting should live.** Today W2 is embedded inside one evaluator
term (dodge-discount, wired only to potion-seek's exposure endpoint). Four
consumers currently improvise their own opponent treatment:

- sigmaOfPly's `theirMiss` term (unpriced replies → dispersion),
- thread reply selection in the scout (worst-case reply walks),
- the exposure bracket (the 99.6% false-alarm the pins name as "needs D2"),
- the dodge discount itself.

One weight supplier serving all four is the re-carve. The dodge module's
careful support hygiene (hazard exclusion, occupancy fatality, oriented-unit
refusal) is not potion-specific — it is the general "action-coordinate of S"
constructor and should be extracted as such.

## 5. FOG: held-by-choice and held-by-ignorance are the same state with different removal operations

The single deepest reality joint found in this pass.

Today a unit is HELD because the scheduler chose not to model it (a compute
economy). Under invisibility potions a unit will be held because the game
withholds it (a world fact). The owner's words (transcript, verbatim): *"The
same machinery we use for prompting the advance in imagination of a previously
held unit … should be used for advancing held units when we learn for certain
what they did."*

The cloud engine is ALREADY the belief-transition operator:

    S_{t+1} = condition( dilate(S_t), obs_t )

- **dilate** — built: clouds are a pure function of (record, terrain, premise,
  turnsHeld); the door advances them by absolute-turn query.
- **condition** — built for the degenerate case: today obs_t is the full board,
  so conditioning collapses S to a point and the code expresses that as
  "rebuild the clouds from the observed board". That rebuild is not a reset
  button bolted on — it IS conditioning on a total observation. The
  generalization to partial obs_t is the same bitboard intersection the
  narrowing machinery already performs (bbAnd against admissible sets, prefix
  closure), applied at ingestion instead of only inside search.

So cross-turn fog requires NO new epistemic machinery. It requires:

1. the ingestion path to stop assuming obs is total (feed `observedTurns` with
   real last-seen turns — the field, its worker plumbing, and the
   staleness-once rule already exist);
2. an observation record on the wire that carries partial facts (§7);
3. a PROVENANCE tag on each held component saying what can remove the hold.

### The reducibility tag — why provenance matters and mechanism must not fork

Three sources of support-width, three removal operations:

| Fog source | Removable by | Who prices removal |
|---|---|---|
| simultaneity (enemy's staged move this turn) | nothing until resolution | D2's weight / D3's functional |
| search futures (we haven't simulated yet) | COMPUTE (narrow, advance, enumerate) | the scheduler's VOI economics |
| observation fog (invisible unit, cross-turn) | OBSERVATION (wait; or deduce from events) | nothing purchasable this turn |

The scheduler's un-hold lever currently treats all held width as purchasable —
true today, false the day the first invisibility potion lands. VOI computed
without the tag will spend compute trying to buy width that compute cannot
buy. The tag is one enum on the hold record; every downstream mechanism
(clouds, trits, bounds, sigmaOfPly's fog term, postures) is UNCHANGED because
the epistemic state is identical — only the economics read the tag.

Conversely: an invisible ENEMY is, mechanically, a FrozenRecord whose
`heldAtTurn` is its last-seen turn and whose cloud the game — not the
scheduler — refuses to collapse. The FOGGED postures, dilation, saturation,
catch-up targeting: all of it applies verbatim. The pins' worry that cross-turn
staleness machinery was "arena scaffolding" is resolved cleanly by this joint:
the machinery is the production armor (owner pin 20); what was scaffolding was
only the premise that PRODUCTION observations are always total.

## 6. What the projection discipline replaces

The potion-play finding (pins, 2026-09-01) is the smoking gun for the current
factorization's cost: `core.ts:1545` feeds the ADVISED est into
`posteriorOfBranch`, the depth rung sits above the floor comparison, so an
advisory term converts floor-decided comparisons into belief-decided ones
instead of ordering floor ties. The queued fix ("carry the sound est beside the
advised one") is the first step of the general move:

**A branch's value is not a scalar with corrections; it is a small TABLE of
labeled projections:**

    BankResult.value : {
      envelope[h]           — [lo,hi] of V_h over S (h=1 today; deep threads add h=d)
      estimate[(h, wId)]    — E_w[V_h] ± precision, per declared weight
    }

Comparators DECLARE which projections they read (the adjudication ladder
becomes a declared read-set instead of a hardwired scalar chain), and the
refusal law covers all three tags. `posteriorOfBranch(worst, best, est)` then
takes the (1, sound-midpoint) projection by name and the potion bug class —
one consumer silently reading another consumer's projection — becomes
untypeable.

Advisory terms re-type into exactly two legal shapes:

- **expectation terms**: declare a weight id; land in estimate[(h, wId)];
  in-interval by theorem when h matches the envelope's horizon;
- **deep terms**: declare a horizon; land in estimate[(d, wId)]; free of the
  h=1 envelope by construction (this is what `plies` + the truncation escape
  hand-code today).

A term that can declare neither is not an advisory term; it is an unpriced
opinion, and the type system should refuse it the way the bank refuses a basis
mismatch.

## 7. The engine API for observability (sketch — full spec in 01-OBSERVATION-API.md)

Fog becomes a parameter when the engine emits OBSERVATIONS rather than states:

    ObservationRecord = {
      facts:   the masked Turn content (units, cells, health, tiers, items…)
      mask:    WHAT COULD HAVE BEEN SEEN — the visibility domain, declared
      events:  visible resolution events (deaths, severs, food consumed, potion
               pickups/expiries) — each an evidence item in its own right
    }

Three commitments the sketch defends in the companion doc:

1. **The mask is on the wire.** Absence of a unit from `facts` is
   uninterpretable without knowing whether it COULD have been reported.
   "Unit u invisible since turn k" is itself public knowledge (the pickup is a
   visible event) and is exactly a FrozenRecord constructor.
2. **Negative information is conditioning.** A visible-empty cell removes
   cloud mass (bbAndNot). An invisible unit standing on a visible cell is NOT
   excluded by cell visibility — visibility is per-(observer, unit, attribute),
   not per-cell, and the mask schema must say which. Both per-unit masks
   (invisibility potions) and per-cell masks (a hypothetical vision radius)
   are instances of one mask algebra over the fact schema.
3. **Events are evidence.** Food that vanished with no visible eater, a sever
   with no visible severer, a death adjudicated against an unseen contestant —
   each intersects the invisible unit's cloud with the set of worlds that
   could have produced the event. The full-information wire made this
   machinery unnecessary; the invisibility wire makes it the difference
   between a bot that infers and a bot that dilates into vacuity.

Today's wire is the degenerate case: mask = everything, events fully
attributed, conditioning collapses S to a point. The bot-side ingestion code
written against ObservationRecord runs UNCHANGED on the full-information game.

## 8. The five laws (the contract the factorization enforces)

- **L1 Support law.** S moves only by dilation (dynamics) and conditioning
  (evidence). Over-approximation is the only permitted error, in the known
  direction. (Already the cloud engine's own covenant.)
- **L2 Weight law.** Weights live inside S. Any evidence moves them, at earned
  precision. No caps. (Already belief.ts + ruling 12.) RE-CENTERING RIDER
  (second pass, 06-doc §1): any credal set built around w — the ε-ball — is
  re-erected around the current w at each reading and is NEVER conditioned as
  a set; w moves only by point updates (precision merge), S only by
  intersection. This is what excludes the imprecise-probability literature's
  dilation pathology (conditioning a credal set can WIDEN every posterior
  interval — Seidenfeld & Wasserman 1993) and its vacuous-prior inertia
  (generalized Bayes cannot learn from a vacuous prior — Gong & Meng 2017)
  from ever entering the design.
- **L3 Projection law.** Every number carries (horizon, quantifier-or-weight,
  basis). Sound = envelope over S; advised = expectation under a named weight.
- **L4 Refusal law.** Numbers differing in any projection tag never compare
  silently. (Generalizes the basis-mismatch refusal that already exists.)
- **L5 Reducibility law.** Every held component of S is tagged with its
  removal operation (compute / observation / none-this-turn); VOI reads the
  tag; nothing else may.

## 9. What this opens (the flexibility claim, concretely)

- Invisibility potions: an ingestion-layer change plus a wire schema; zero new
  search/bounds/cloud code. FOGGED postures become production states.
- Any future visibility rule (vision radius, smoke, misdirection): a new mask
  instance; same conditioning operator.
- Opponent-model growth (ruling 13 lifted later): swap the weight supplier;
  every advised consumer (dodge, exposure, thread replies, theirMiss) improves
  at once; the sound channel is untouched by construction.
- Risk-policy sweeps (D2×D3): one α over one credal object, instead of two
  compensating knobs in two modules.
- The rebase/ponder programme: belief_{t+1} = condition(dilate(belief_t), obs)
  is the SAME operator across real turns, operator commits, and imagination —
  the owner's "same machinery" directive falls out as an identity, not a
  discipline.

## 10. Open questions carried into the next cycle

1. Bank re-statement: is B0–B3 worth re-deriving as "coarsening schemata over
   S" in code, or only in documentation? (Suspicion: documentation — the bank's
   mechanics are already right; the re-derivation's value is in what it forbids
   a future member from doing.)
2. Where exactly does the projection table live without allocating per
   evaluation? (BankResult is on the hot path; the table must be two or three
   flat fields, not a Map.)
3. The mask algebra's schema: per-(unit, attribute) suffices for invisibility
   potions; does committing to it foreclose per-cell rules, or is per-cell
   expressible as per-(unit-at-cell, attribute)? (Believed yes; needs a worked
   example.)
4. Event-deduction cost: conditioning on "food vanished, no visible eater" is
   a set intersection; conditioning on "a contest was adjudicated against an
   unseen unit" wants the resolver run backwards. How much inverse-dynamics is
   worth building vs. letting the cloud stay wide?
5. The credal α-interpolation for D3: CVaR over an α-ball is clean on paper;
   what is the cheap computable surrogate over our interval-plus-weight
   representation?
