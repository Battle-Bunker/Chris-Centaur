/**
 * OPERATOR-SIGNALS — builder-facing contracts sketch (design artifact, not
 * compiled). Consolidates docs 01/03/05/09/10 into one file so a builder
 * can see the whole wire at once. Version: tracks the branch tip; nothing
 * final (ruling 50).
 *
 * Laws in force here: flows-never-aggregates; complete-internally/
 * selected-externally (M27); ADVICE one-way (Law V); two currencies, no
 * exchange rate; humans-always-win bottom element; premise on everything.
 */

// ---------- addressing ----------------------------------------------------

type SignalRef = string        // stable name; names find, hashes validate (Law I)
type PlanRef = string
type FlowRef = string
type WitnessRef = string       // a banked reply; doubles as refuter id
type UtteranceId = string      // IN-lens guidance row id (their 02-WIRE-API)
type AffordanceId = string
type PremiseRef = string       // the one index; carries guidanceId, gate config, evalVersion, fit provenance
type SignalClassId = string    // (shape | edge-predicate | channel) class ids — open member vocabularies

type Anchor =
  | { kind: 'game' } | { kind: 'turn'; turn: number }
  | { kind: 'unit'; unitId: string } | { kind: 'cells'; cells: ReadonlyArray<[number, number]> }
  | { kind: 'plan'; plan: PlanRef } | { kind: 'account'; unitId: string }
  | { kind: 'member'; memberId: string } | { kind: 'operator'; operatorId: string }
  | { kind: 'clock' } | { kind: 'enemies' } | { kind: 'decision' }

interface Freshness {
  readonly turn: number
  readonly seq: number
  readonly quantaSpent: number          // ledger units — never wall ms (time lens's ledger law)
  readonly stagedPlanHash: string
  readonly voidIf: string | null        // invalidation condition id; checked at every assembly
}

// ---------- the four shapes ------------------------------------------------

interface Signal<P> {
  readonly ref: SignalRef
  readonly shape: 'set' | 'flow' | 'width' | 'held'
  readonly anchor: Anchor
  readonly premise: PremiseRef
  readonly asOf: Freshness
  readonly payload: P
}

interface SetPayload {                          // 01 §2.1 + 09 §2
  readonly options: ReadonlyArray<{
    readonly plan: PlanRef
    readonly floor: number | 'refuted'          // 'refuted' never renders numerically
    readonly refutedBy: WitnessRef | null
    readonly dominance: string | null           // condition id; LP feasible-region witness when the maximality member lands (prior-art 33)
    readonly paidBy: ReadonlyArray<FlowRef>
    readonly playable: 'stageable' | 'requires-pin' | 'closed'
  }>
  readonly staged: PlanRef
  readonly deciding: { rung: string; margin: number } | null
  readonly refutation: { liveCount: number; dominantColumn: WitnessRef | null; refutesCount: number } | null
}

interface FlowPayload {                         // 01 §2.2 — pre-fold, event-anchored
  readonly account: string | 'terminal'
  readonly channel: string                      // 'contest' | 'sever' | ... | `guidance:${UtteranceId}`
  readonly side: 'inflow' | 'outflow'
  readonly rate: number                         // weight units / turn
  readonly horizon: number
  readonly event: { units: ReadonlyArray<string>; cells: ReadonlyArray<[number, number]>; subStep?: number }
}

interface WidthPayload {                        // 01 §2.3
  readonly coordinate: string                   // hidden coordinate id
  readonly support: unknown                     // S projection (cloud marginal / count)
  readonly weight: unknown | null               // w projection at earned precision; null = quantifier-only
  readonly removal: 'deduce' | 'observe' | 'ask' | 'none-this-turn'
  readonly decisionRelevance: number            // weight units at the deciding rung (market pricing; v1: margin overlap)
}

interface HeldPayload {                         // 01 §2.4
  readonly kind: 'pin' | 'carried-premise' | 'commitment' | 'hypothesis' | 'incumbent' | 'setting' | 'ask-issued'
  readonly author: 'operator' | 'bot'
  readonly assertion: string                    // display form; structured drill behind ref
  readonly since: { turn: number }
  readonly invalidation: string                 // condition id (citation-law verdict classes)
  readonly health: 'live' | 'stale' | 'conflicting' | 'invalidated'
}

// ---------- operators ------------------------------------------------------

interface TracePoint { readonly at: number; readonly value: number }     // axis in the trace's declared units
interface Trace { readonly of: SignalRef; readonly axis: 'quanta' | 'turn' | 'wallMsIntoTurn'; readonly points: ReadonlyArray<TracePoint> }

/** Edge predicates are manifest members with alarm hygiene (06 §5). */
interface EdgePredicateMember {
  readonly id: SignalClassId
  readonly operatorAction: AffordanceId | 'awareness'   // rationalization law: 'awareness' caps class at ambient
  readonly hysteresis?: { minDwellTurns?: number; deadband?: number }
  readonly inhibitDuring?: ReadonlyArray<'post-commit' | 'pre-first-slice' | 'terminal-phase'>
  readonly rateBand?: { perTurns: number; count: number }  // flood mode above it (03 §4)
  readonly sticky?: boolean                                // requires ack (10 §A-2); true for soundness
}

interface Event {
  readonly predicate: SignalClassId
  readonly of: SignalRef
  readonly before: unknown
  readonly after: unknown
  readonly eventAnchor?: FlowPayload['event']              // enables coincidence/first-out joins (02 §6)
}

// ---------- presentation (selected externally) -----------------------------

interface AdviceItem {
  readonly signal: SignalRef
  readonly role: 'offer' | 'ask'
  readonly attentionWeight: 1 | 2 | 3            // glance | read | study (10 §A-1), template-declared
  readonly presentation: {
    readonly headline: string                    // BOUND PROJECTION: every noun binds a payload field/ref (10 §A-5)
    readonly foil?: { instead: PlanRef; because: string; margin: number }
    readonly causes: ReadonlyArray<FlowRef>      // length <= 2 (M27, type-checked)
    readonly affordance?: AffordanceId           // asks: pre-filled utterance template; NEVER an A3 license (05 §3)
  }
}

interface SignalStub { readonly ref: SignalRef; readonly shape: Signal<unknown>['shape']; readonly anchor: Anchor; readonly label: string; readonly count?: number }

interface AskStatus {
  readonly ref: SignalRef
  readonly since: { turn: number; seq: number }
  readonly state: 'open' | 'answered' | 'expired' | 'mooted'   // mooted excluded from uptake denominators
  readonly answeredBy?: UtteranceId                            // provokedBy join, uptake telemetry
  readonly routedTo?: string                                   // selection-lock holder / captain (10 §A-4)
}

interface DigestSlot {
  readonly cursor: string                        // 'sinceLook:...' | 'sinceCommit:...' | 'sinceTurn:N'
  readonly edges: ReadonlyArray<SignalRef>       // first-out ordered within bundles
  readonly rollups: ReadonlyArray<{ by: string; channels: Record<string, number>; drill: SignalRef }>  // per-(anchor, channel) ONLY — AGG-2
  readonly held: ReadonlyArray<{ ref: SignalRef; health: HeldPayload['health']; note?: string }>
  readonly verdicts: ReadonlyArray<{ trace: SignalRef; verdict: 'saturated' | 'climbing' | 'spent-through'; note?: string }>
  readonly segments?: ReadonlyArray<{ at: Freshness; reason: string }>   // premise changes segment digests (AGG-3)
}

// ---------- the frame (push; per (game, team[, operator]) view doc) --------

interface SignalFrame {
  readonly v: 1
  readonly gameId: string
  readonly teamId: string
  readonly scope: 'team' | { operatorId: string }
  readonly turn: number
  readonly seq: number
  readonly bot: { botId: string; behaviourId: string; evalVersion: string }   // needs B0; placeholder until then
  readonly asOf: Freshness
  readonly attention: { policyId: string; budget: number; spent: number }     // attention-weight units
  readonly items: ReadonlyArray<AdviceItem>
  readonly sticky: ReadonlyArray<AdviceItem>     // unacked sticky items, always present, off-budget
  readonly digest: DigestSlot | null
  readonly asksOpen: ReadonlyArray<AskStatus>
  readonly index: ReadonlyArray<SignalStub>      // entry points with counts, bounded by anchor vocabulary
}

// ---------- the policy (OUT-owned advice subscription; guidance H9) --------

interface AttentionPolicy {
  readonly v: 1
  readonly budget: number                        // attention-weight units per frame
  readonly pins: ReadonlyArray<SignalClassId>    // off-budget, always delivered
  readonly shelves: ReadonlyArray<{ class: SignalClassId; until: { turn: number } }>  // expiry mandatory
  readonly cursors: { look: string; commit: string }
  readonly acks: ReadonlyArray<SignalRef>        // sticky-item acknowledgements
  readonly askAppetite: 'eager' | 'normal' | 'quiet'
  readonly holdout?: { offerEpsilon: number; askEpsilon: number }  // exploration (doc 13); fitters refuse epsilon=0 strata
  readonly maxV: number
  // LAW (no-mix, guidance H9): nothing here may be read by the search
  // context; nothing in the guidance table may name a SignalClassId.
}

// ---------- the propensity log (doc 13; O1's obligation) -------------------

interface SelectionEntry {
  readonly itemRef: SignalRef
  readonly gainAtSelection: number
  readonly attentionWeight: 1 | 2 | 3
  readonly surfaced: boolean
  readonly cause: 'greedy' | 'holdout' | 'pin' | 'sticky' | 'ask-open' | 'not-surfaced'
  readonly propensity: number                    // exact P(surfaced | frame state, policy), logged at selection time
}

interface FrameLedger {
  readonly frameKey: string                      // (gameId, teamId, scope, turn, seq)
  readonly policyId: string
  readonly holdoutDraw: { seed: string; offerSlot: SignalRef | null; askSlot: SignalRef | null }  // ledger-seeded, replay-exact
  readonly entries: ReadonlyArray<SelectionEntry>
  readonly ineligible: ReadonlyArray<{ itemRef: SignalRef; why: 'shelved' | 'inhibited' | 'flood' }>  // P=0 by policy/hygiene: a distinct population, never extrapolated into
}

// ---------- the store (pull; team-private while live) ----------------------

interface SignalStore {
  get(ref: SignalRef): Signal<unknown>
  query(q: { anchor?: Anchor; shape?: Signal<unknown>['shape']; classes?: ReadonlyArray<SignalClassId>; turnRange?: [number, number]; cursor?: string }): { stubs: ReadonlyArray<SignalStub>; cursor?: string }
  trace(ref: SignalRef, axis: Trace['axis'], range?: [number, number]): Trace
  contrast(set: SignalRef, a: PlanRef, b: PlanRef): { fact: PlanRef; foil: PlanRef; rung: string; margin: number | 'refuted' }
  digest(cursor: string): DigestSlot
  /** What-if (10 §7): compiles to an A0 speculation utterance; priced in
   *  quanta by the metareasoning meter; answers arrive as signals whose
   *  premise is the hypothetical fiber (quarantined from play). */
  quote(hypothetical: { pin: { unitId: string; plan: PlanRef } }): { ticket: string }
}

// ---------- echo generators (one per IN port; 05 §1) -----------------------

type EchoGenerator =
  | { port: 'value-field'; emits: 'flow' }                    // guidance:<utteranceId> channel
  | { port: 'attention-field'; emits: 'trace+edges' }         // fundedBy tagging
  | { port: 'support-demand'; emits: 'edge' }                 // floor delta + staged-change, cites utterance
  | { port: 'belief-weight'; emits: 'edges+calibration' }     // decisions swung + log-loss trace (empathy scoreboard)
  | { port: 'appetite'; emits: 'held+edges' }
  | { port: 'deadline'; emits: 'held' }                       // current obligation meet + binding row author
  | { port: 'admission-edit'; emits: 'held+edges' }           // license/restriction standing + every exercise; early warning on remainder shrink
  | { port: 'determination'; emits: 'ack' }                   // received | incorporated | overridden-by-floor, <= 1 tranche
