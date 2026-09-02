# 01 — Integration: where each guidance port enters the search

OPERATOR-GUIDANCE lens, second document. 00-FACTORING gave the carve
(PORT × SCOPE × CONSTRUCTOR × LIFECYCLE × AUTHORITY); this document walks
each port into the actual search architecture — the LOBSTER kernel on
`claude/cluster-lookahead` (`kernel.ts`, `search/core.ts`, `voc.ts`,
`team-decision-engine.ts`, `wire/pin-events.ts`) and the legacy per-unit
matrix path (`decision-engine.ts`, `heuristics.ts`, `waypoint-pathing.ts`) —
naming the seam, the law it must respect, and the invalidation rule. The
sibling-lens discipline applies throughout: nothing touches a bound or a
refusal outside the A2/A3/A4 rules of the authority ladder; every payload is
premise-tagged; every effect is visible in botDiff; attention is budgeted.

---

## 1. The finding that reframes the whole integration

**Today, `goto` reaches the deep search as a PIN, not as a preference.**
Traced through the shipped wiring:

1. The lobster team engine stages per-unit recommendations through the
   manager, and "manual > waypoint > bot precedence … run[s] untouched in
   the manager" (`team-decision-engine.ts` header). The waypoint re-bias
   (`getWaypointBiasedMove`) runs at the *manager* layer, over per-unit move
   evaluations, after the joint search has finished.
2. The pin-event stream classifies staging sources:
   `PINNING_SOURCES = {'manual', 'waypoint'}` (`wire/pin-events.ts`). A
   waypoint-biased staging is therefore emitted as an operator pin.
3. The kernel honours pins exactly: "the only thing the search does about a
   pin is pay for it" (`search/core.ts` header); pins ride every score as
   `Assumption {kind: 'operator-pin'}` (`contracts.ts`).

So a `goto` — designed, in the matrix path, as a bounded A1 bias that
"never overrides the move" and that survival heuristics outvote — arrives at
the joint search as an **A4 constraint**: the unit is removed from every
sweep, repair pair and polish set, and the rest of the team is re-planned
*around* a move the search never priced against alternatives. The safety
inversion is real: in the matrix path the death band outvotes the waypoint
by construction; in the kernel path the waypoint rung outranks the bot rung
in `computeIntendedMove`, and the joint plan's own de-confliction for that
unit is discarded. (The regicide veto and the fatal-consent gate still stand
above staging — the floor holds — but everything between "priced" and
"fatal" is silently ceded.)

This is the composition disease in miniature — an authority level and the
payload it was authored at travelling separately — and it sets the
integration's first goal:

> **G1. Guidance must enter the search context, not the staging ladder.**
> Under `engine === 'lobster'`, A1 payloads become terms the search weighs;
> the manager's waypoint rung remains only as the legacy-engine fallback and
> as the A4 rung for *manual* moves, which really are determinations.

Everything below is the port-by-port execution of G1.

---

## 2. The compiled object: `GuidanceContext`

One compilation per decision, from the durable utterance table (02-doc) and
the live board — the same once-per-decision, plain-serializable pattern as
`computeWaypointProgressByMove`, so the whole object crosses the structured
clone into workers unchanged:

```ts
interface GuidanceContext {
  /** Hash of the active utterance set + magnitudes; a coordinate of the
   *  premise index's CONFIG component. Two scores under different hashes
   *  refuse comparison; an edit mid-decision is a determination on it. */
  readonly guidanceId: GuidanceId

  /** A1 value-fields, compiled: per (unitId, candidate destination) bounded
   *  stats in [0,1], per scoped field, with the field's declared weight.
   *  Team-scoped fields compile to per-plan terms (participant scope). */
  readonly fields: ReadonlyArray<CompiledField>

  /** A0 attention: bounties over units / cells / plan footprints. */
  readonly bounties: ReadonlyArray<Bounty>

  /** A2 support-demands: units that must be treated as contestants, lines
   *  that must be in the priced support. */
  readonly demands: ReadonlyArray<SupportDemand>

  /** A1 appetite by scope (team default, unit overrides). */
  readonly appetite: AppetiteMap

  /** Deadline rows for the obligation lattice (MIN-composed). */
  readonly deadlines: ReadonlyArray<DeadlineRow>

  /** A3 licenses: (closureId, scope, condition memberId, expiry). */
  readonly licenses: ReadonlyArray<License>
}
```

Pins are deliberately NOT in it — they stay on the existing
`SearchContext.pins` path, which is already correct for A4. The context
object is data (Law N); compilation is kernel code (the constructors).

---

## 3. Port by port

### 3.1 value-field → `Evaluator.parts` + the ordering (A1)

Seam: `PlanEvaluation.parts` already carries per-feature contributions
before weighting, and the candidate ordering in `candidates.ts` is the
declared `order` member of the lifecycle. A compiled field adds:

- **a plan-level advised term**: `guidance:{utteranceId}` appears in
  `parts`, weighted into the *advised* est channel — "est is advisory
  ordering only — it must never gate a bound" is already the contract
  (`contracts.ts:112`), so the existing est discipline is exactly the
  guidance discipline. `estSound` never sees it. The Bound is untouched.
- **a per-unit ordering slot**: the compiled per-candidate stat enters the
  candidate order above the positional tail. This is the fix for the cap
  exhibit — the value lens showed A1-admission discards value the comparator
  cannot *name*; a guidance stat is a namable slot, so a slider's 4-of-71
  prefix contains the operator's direction when one is active.

Laws enforced at compile time, not by convention:
- Σ|A1 weights| < min(|death band|, |trapped|) — the guidance budget from
  00 §5.1, checked when the utterance table is accepted;
- every emitted `EmitRecord` and every bank memo key includes `guidanceId`,
  so a mid-turn magnitude edit can never compare pre-edit and post-edit
  scores silently (the fibration doing its normal job).

Invalidation: magnitude-only edits re-weight at read (parts are stored
unweighted — the platform's cheap-weight-edit rule holds natively);
structural edits (add/remove/retarget) change `guidanceId` → the citation
pass kills exactly the plans whose parts cite dead utterances, cutoff
compares, next tranche demotes softly.

### 3.2 attention-field → `voc.ts` lever choice + proposal registration (A0)

Two seams:

- **Lever market.** `voc.ts` orders levers under the corrected lever order
  and rations deepen by stability. A bounty enters as a tiebreak-and-boost
  term on levers whose footprint (`Substrate.influenceOf`, cluster
  membership, thread root) intersects the bounty's referent. It is metered:
  the bounty may reorder *within* a lever class and bias *which* cluster or
  thread is served first; it may never override the lever ORDER itself
  (catch-up → preview → narrow → advance → deepen), because that order is a
  correctness result, not a taste. Two currencies stay separate — a human
  aiming compute is not an exchange rate.
- **Proposal operator.** `guidance-directed proposals` register at the
  lifecycle's `admit@A2` beside the eight existing operators, with
  `cost(state)` = one conform + bounded polish around the field's gradient.
  This is how "region to hold" produces candidate joint plans the incumbent
  ordering would never generate, and how a `goto` on a piece board seeds a
  scout thread toward the target instead of relying on the per-unit ramp.

Falsifier for the port: with a bounty on a unit and zero A1 weight, staged
plans must be byte-identical to no-guidance runs (spend-only means
spend-only); the work distribution must not be.

### 3.3 support-demand → the contestant gate + bank rungs (A2)

Seam: the restricted matrix's column gate (search lens doc 09: five of nine
boards produce no columns because only contacting held units are admitted)
and the bank's min-side support declarations ("every min-side restriction is
a declared assumption" — `contracts.ts`). A demand:

- forces the named enemy unit into the contestant set for column
  generation, and into the priced support at the bank rungs that take
  restrictions — widening only. The floor may drop; it drops *honestly*.
- rides as `Assumption {kind: 'narrowing'}`'s dual — a declared WIDENING is
  not an assumption at all (it needs no discharge; it strictly strengthens
  the statement), so the honest representation is a note on the basis, not
  a new assumption kind. The demand's provenance still lands in the emit
  record via `guidanceId`.

Cost control: each demand adds a lattice dimension / bank rows, i.e. real
compute. Demands therefore carry an implicit bounty (§3.2) and count
against a small per-team demand cap in the schema — the operator-attention
analogue of the composed-K cap, and the honest place to say "no, you cannot
nominate all sixteen enemy units".

### 3.4 appetite → the reduction read sites (A1)

Seam: the belief lens's ε/appetite discipline — blend applied ONCE at the
root read of a projection, never persisted (Law B). The guidance map adds
scope resolution: the read site asks `appetite(scopeOf(consumer))` instead
of a global. Per-unit posture is then one lookup, the site-class table
stays the single place readings happen, and the sound channel is untouched
by construction. Nothing else changes; this port is deliberately thin
because the belief lens already built it — 00-doc M3 is the only amendment
(dial → dial kind, scope-indexed).

### 3.5 deadline → the obligation lattice + commitment agent (A1-on-time)

Seam: the time lens's reaction table composes obligations by MIN with the
kernel pin at deadline zero and humans-always-win at the bottom. Operator
deadline rows join the MIN: "commit by +3s" tightens, "hold for me" rows
CANNOT loosen the kernel's own obligations (MIN can only tighten) — a hold
directive instead *removes the automatic early-commit* the team submitter
would otherwise take, which is the Snek platform's `thinking` tempo toggle
landing in our machinery (their pipeline pauses auto-submission while any
operator is `thinking`; ours withholds the early commit while a hold row is
live; clock expiry still wins). Commit-timing *advice* stays OUT-direction
(ADVICE member reading `moveStatuses`); the deadline port is the IN half.

### 3.6 license → admission's priced-exception path (A3)

Seam: F1's amended closure law (kernel → kernel with a priced exception
path), gated on the owner's B5 decision. A license names `(closureId,
scope, condition, expiry)`; admission consults live licenses before
discarding; a licensed option enters ordered by the currency (the doomed
band splits into doomed-unwarranted / warranted). No license, no change —
the port ships as an empty table. Per 00 §4, per-instance authorization
(pin a surfaced warrant, A4) covers the first Centaur games without it.

### 3.7 determination → unchanged (A4)

Manual moves, Submit All, and per-warrant sacrifice pins keep the exact
shipped path: `onPinEvent` → epoch conform → pay for it. The one change is
subtractive: the *waypoint* rung leaves `PINNING_SOURCES` when the lobster
engine owns the unit, because its payload now travels as a field (§3.1) —
a waypoint staging that still reaches the wire from the legacy path remains
a pin for coherence. `matchPin`'s pruned-ledger resolution (the F1
precedent) is untouched.

---

## 4. The three-layer story, assembled

```
   utterance table (durable, per team+game, realtime-edited)     [02-doc]
        │  compile once per decision (constructors, kernel code)
        ▼
   GuidanceContext ── guidanceId → premise CONFIG coordinate
        │
        ├─ fields    → Evaluator.parts (advised) + candidate order   (A1)
        ├─ bounties  → voc lever market + proposal operator          (A0)
        ├─ demands   → contestant gate + bank support (widen-only)   (A2)
        ├─ appetite  → reduction read sites, scoped                  (A1)
        ├─ deadlines → obligation MIN + submitter hold               (A1)
        └─ licenses  → admission's priced exception                  (A3)

   pins (manual, per-warrant authorizations) → SearchContext.pins   (A4)
```

The staged plan's every score is fibered over `guidanceId`; a guidance edit
is a determination on that coordinate with the magnitude/structural split;
`botDiff` between two addresses shows guidance differences like any other
config difference, which is what makes "did the operator help" a measurable
question for the first time (the kit's per-seat address recording gives it
per-game provenance for free).

## 5. Falsifiers for the integration (each cheap, most behaviour-free)

1. **Empty-table identity**: `GuidanceContext` with no utterances compiles
   to the empty object and every path is byte-identical to today. (The L0
   standard — the object proves itself by changing nothing.)
2. **A0 purity** (AMENDED by 04-doc §6 — the MCTS-priors correction):
   bounty-only guidance never re-orders a priced comparison and never moves
   a bound; byte-identical staged plans are expected only on *saturated*
   cells (snake6 ≥ 500ms per the CPP curves). On starved cells attention
   changes which comparisons get priced by the deadline and may change the
   plan — that is its value, not a leak. Tested per-stratum: byte-identity
   on saturated cells; work-distribution shift + emit-record provenance on
   starved ones.
3. **The pin demotion** (G1): on a seeded board where `goto` points a unit
   at a cell the joint plan needs elsewhere, today's wiring stages the
   waypoint and re-plans around it; the integrated wiring prices both and
   the emit record shows the guidance term outvoted (or not) in `parts`.
   The frustration signal (00 M5) reads the same record.
4. **Widen-only soundness**: with a demand active, every floor ≤ its
   undemanded value on identical boards (equality when the demanded unit
   was already priced); any floor *rise* is a bug in the port.
5. **Budget refusal**: an utterance table whose A1 weights could outbid the
   death band is refused at accept time with the named rule.

## 6. Open questions raised by the wiring (beyond 00 §8)

- **Q5**: when the waypoint rung demotes (§3.7), what happens to a snake on
  the legacy engine path in the same game? Mixed-engine games need the rung
  split per-unit by owning engine, not per-game. Check whether the manager
  already knows the owning engine per unit at staging time.
- **Q6**: `conform()` after a guidance structural edit — is the epoch-change
  conformance path (built for pins) the right cost model for a retarget,
  or does a retarget want the softer next-tranche demotion only? Proposed:
  demotion only; retargets never force an epoch (they change no
  constraint, only preferences), which is exactly what C2 predicts.
- **Q7**: the demand cap's size (§3.3) — attention-budget shaped; needs a
  measured cost per demanded unit (lattice growth is multiplicative in the
  worst case). Cheap probe: columns/board with 1..k demanded units on the
  nine restricted-gap boards.
