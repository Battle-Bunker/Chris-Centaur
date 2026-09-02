# 13 — The propensity log and the randomised holdout (librarian domain 43, co-adopted)

Cannot-wait item, adopted WITH the surface rather than retrofitted. The
librarian's finding (43.5, correcting their own M101): the ratification-
laundering rider **detects** contamination and cannot **correct** it —
this surface is a deployed ranker, and every outcome row it produces is
conditioned on its own selection policy (closed-loop presentation bias).
Correction needs **inverse propensity scoring** — weight each observed
outcome by 1/P(surfaced) — which is *a requirement on the surfacing
code*: the probability must be logged at selection time. Identification
needs a **randomised holdout**, because IPS is undefined where
P(surfaced) = 0 — and once the surface ships, almost every row is a
caused row, so the stratification refusal binds on nearly everything
unless a supply of uncaused rows is deliberately maintained. The holdout
is that supply. One column and one selector clause now, or an unusable
corpus later.

## 1. The selection record — every frame logs its own exposure model

At frame assembly, after shelves/inhibits/flood-mode fix the **eligible
set**, the selector logs one row per eligible candidate item:

```ts
interface SelectionEntry {                 // FrameLedger, one per eligible item per frame
  readonly itemRef: SignalRef
  readonly gainAtSelection: number         // facility-location marginal gain when considered
  readonly attentionWeight: 1 | 2 | 3
  readonly surfaced: boolean
  readonly cause: 'greedy' | 'holdout' | 'pin' | 'sticky' | 'ask-open' | 'not-surfaced'
  readonly propensity: number              // P(surfaced | frame state, policy) — exact, computed, never inferred later
}
interface FrameLedger {
  readonly frameKey: string                // (gameId, teamId, scope, turn, seq)
  readonly policyId: string
  readonly holdoutDraw: { seed: string; offerSlot: SignalRef | null; askSlot: SignalRef | null }
  readonly entries: ReadonlyArray<SelectionEntry>
  readonly ineligible: ReadonlyArray<{ itemRef: SignalRef; why: 'shelved' | 'inhibited' | 'flood' }>
}
```

Propensities under ε-greedy are **exact and cheap**:

- greedy picks, pins, sticky, open asks: `propensity = 1` (deterministic
  given the frame state) — logged as their own causes; the policy-forced
  strata (pin/sticky) are excluded from selector fitting entirely;
- non-picks: `propensity = ε_offer × weightShare(item)` over the eligible
  non-selected pool — the standard ε-greedy exposure probability, one
  multiplication;
- ineligible items: `P = 0` **by the operator's own act** (shelved) or by
  hygiene (inhibited/flood). These are logged as a separate array, and no
  estimator may pretend they were explorable: identification there is
  genuinely impossible and *that is the operator's right* — the fitter
  treats them as a distinct population or refuses.

The draw is **seeded from the ledger** (decision seed × frame seq — the
time lens's ledger law): replays reproduce the holdout exactly, so the
FrameLedger is replay-checkable like everything else.

## 2. The holdout — two epsilons, budget-charged, rendered identically

- **ε_offer**: with probability ε_offer per frame, one budget slot is
  filled by a weighted-uniform draw from the eligible-but-unselected
  offers. Charged to the attention budget at its declared weight —
  exploration is never off-book; the human's attention is spent, so the
  ledger says so, and the expected cost is ε × weight per frame.
- **ε_ask**: smaller, drawn only from asks that were **priced and lost
  the selection** (decisionRelevance > 0) — boundary exploration where
  the ask/act threshold fitting needs support, not uniform noise. A
  random ask demands a response, so its price multiplier applies in the
  charge; `askAppetite: 'quiet'` scales ε_ask down with it.
- **Never held out**: soundness/sticky (unshelvable and P = 1 anyway),
  conformance acks (operator-class echoes are answers, not choices), and
  anything the flood mode suppressed (hygiene beats exploration).
- **Rendered identically.** A holdout item is a true signal from the
  eligible pool, truthfully presented; `cause: 'holdout'` is log-internal.
  A "shown at random" badge would measure a different, labeled treatment
  — the corpus needs exposure variation, not disclosure variation.
- **ε values are members with provenance** (ruling 49); the policy may
  lower them per operator (attention is theirs — humans always win), and
  every fitter **refuses strata where ε = 0** rather than extrapolating
  into them. An operator who zeroes exploration keeps a fully functional
  surface and forfeits only personalization fitting on their own rows;
  the program default stays small and nonzero so the shared corpus
  exists.

## 3. What this corrects downstream (the column's three consumers)

1. **The override ledger (doc 12).** Every intervention row joins its
   provoking item's SelectionEntry; outcome estimates are IPS-weighted;
   the librarian's own correction applies verbatim — **M101 (fitting the
   ask/act threshold p* on overrides) stands only with the propensity log
   and holdout attached**, else the threshold re-fits to itself. Doc 12
   §3 gains the rule: *a selection-affected outcome row without its
   propensity column is refused by every fitter* — the miner-refuse
   discipline extended from schemas to exposure.
2. **Uptake telemetry (both surfaces).** `provokedBy` joins measure
   "advice acted on" conditioned on "advice surfaced"; the honest uptake
   number is IPS-weighted, and the guidance lens's ratified/authored
   strata compose with it (their strata answer *whose preference*, the
   weights answer *despite whose selection*). The librarian's closing
   distinction is kept verbatim: **ratification is evidence about the
   operator's preferences, and it is not evidence about the option's
   quality. Two different fits, two different corpora.** The instruments
   here make the first fit valid; nothing makes the second valid from
   ratifications alone.
3. **Any future selection member** (an operator-tuned value function, the
   calibration-aware invitation tuning of doc 12 §4): fitted on
   IPS-weighted rows or not seated — Law F1/F2 provenance now includes
   the exposure model (`policyId` + ε values) the corpus was collected
   under, so a fit collected under one selection policy names it and
   refuses silent transport to another.

## 4. Placement and cost

- The FrameLedger is frame-scoped, not decision-scoped: it lands beside
  the O0 DecisionLedger in the store (doc 11 §6's custody), keyed by
  frameKey, serialized off the emit path with the same try/catch-counted
  discipline. It is **O1's obligation, not O0's** — it exists the moment
  the first frame ships, because the first shipped frame is the moment
  rows start being caused (the librarian's timing point: this cannot be
  added "when the refusal starts firing").
- Cost: one row per eligible item per frame (the eligible set is
  attention-scale, tens not thousands — the index's anchor-class bound
  applies), one seeded draw, zero extra computation for propensities.
- The second scale (doc 08) inherits the clause: the owner-brief
  selector logs the same record — "which pending decisions got surfaced"
  is as much a caused corpus as the live frames, and the 4,000-line pins
  file is what an unlogged owner-attention selector produces.

## 5. Falsifiers

- Replay determinism: re-running frame assembly from the ledger
  reproduces holdout draws and propensities byte-for-byte.
- Propensity sanity (conservation-in-extraction): per frame,
  Σ P(surfaced) over eligible items ≈ E[surfaced count] — checked inside
  the serializer, refused rows counted.
- The holdout works: after N harness frames, the fraction of FrameLedger
  rows with `0 < propensity < 1` matches ε within its interval, and no
  eligible offer class has empty support (every class's min propensity
  > 0) — the "supply of uncaused rows" measurably exists.
- The refusal bites: a deliberately propensity-stripped corpus fed to the
  doc-12 fitter is refused, not fitted (the anti-M101 regression).
