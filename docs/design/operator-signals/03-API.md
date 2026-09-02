# 03 — The API: frames, views, attention as a parameter, cadence

Wire-ready shape, targeting the platform's stated conventions (read from
the Snek Centaur Platform openspec, as context only — that repo is not
written to from here): hosting-server sole-writership, full-snapshot
replacement semantics, published-slots-only rendering (no client
recomputation; absent renders absent), filtered per-team views as the sole
client read surface, team-private deliberation while a game is live.
Transport-neutral below; a Convex or Firestore mapping is a table at the
end.

## 1. Two surfaces: the frame (push) and the store (pull)

**The frame** is the selected surface — one document per (game, team,
operatorScope), replaced whole, small (attention-budget-bounded by
construction: |items| ≤ budget + pins).

```ts
interface SignalFrame {                       // @v1
  readonly v: 1
  readonly gameId: GameId
  readonly teamId: TeamId
  readonly scope: OperatorScope               // 'team' | operatorId — §3
  readonly turn: number
  readonly seq: number                        // monotone within turn; replacement order
  readonly bot: { botId: BotId; behaviourId: BehaviourId; evalVersion: string }
  readonly asOf: Freshness                    // §5
  readonly attention: { policyId: PolicyRef; budget: number; spent: number }
  readonly items: ReadonlyArray<AdviceItem>   // 01 §5 — selected, presentation-face forward
  readonly digest: DigestSlot | null          // 02 §4 — bot-composed against cursors
  readonly asksOpen: ReadonlyArray<AskStatus> // every unanswered ask, always present (never budget-dropped once issued)
  readonly index: ReadonlyArray<SignalStub>   // ref + shape + anchor + one-line label for EVERYTHING currently held — the pull surface's table of contents, so the operator can see what was NOT selected
}
```

`index` is the anti-paternalism field: selection chooses what headlines,
never what exists. A stub costs ~one line of payload; the operator who
wants the seventh item pulls it. This is how "selected externally" avoids
becoming "hidden externally" — M27 without a censor.

**The store** is the complete surface — per-decision signal records,
premise-attached, retained per the retention policy (doc 04 §2):

```ts
signals.get(ref): Signal<Shape>                       // one record, full payload + premise
signals.query({ anchor?, shape?, kinds?, turnRange?, cursor? }): Page<SignalStub>
signals.trace(ref, axis, range): Trace                // curves are pull
signals.contrast(setRef, a, b): Foil                  // the foil projection, server-computed
signals.digest(cursor): DigestSlot                    // re-derivable on demand (read-time fold)
```

The client never recomputes and never diff-merges: every query is answered
by the engine-side store doing read-time folds (02 §5). Absent renders
absent.

## 2. The attention policy — the budget as a first-class input

```ts
interface AttentionPolicy {                   // operator-authored; versioned like any config
  readonly v: 1
  readonly budget: number                     // items per frame; THE dial
  readonly pins: ReadonlyArray<SignalClassId>   // delivered always, off-budget (bottom element)
  readonly shelves: ReadonlyArray<{ class: SignalClassId; until: TurnStamp }>
      // temporary suppression WITH EXPIRY (ISA shelving, doc 06 §3) — a
      // permanent mute does not exist; expiry restores delivery;
      // soundness classes are unshelvable. Default shelf life is a
      // policy constant with provenance.
  readonly cursors: { look: Cursor; commit: Cursor }   // client-maintained, sent up
  readonly askAppetite: 'eager' | 'normal' | 'quiet'   // multiplies the ask price, never zero
}
```

- The policy is an **IN-direction object configuring the OUT surface** — it
  lives with the operator-guidance capability's config machinery and is
  read here. Shared-vocabulary item #3: both lenses treat AttentionPolicy
  as one object; neither forks it.
- The budget is per-frame cardinality, not a rate: attention is spent by
  *looking*, so the unit is items-per-look. Frame cadence (§4) is governed
  separately; budget × cadence is deliberately not collapsed into one
  number because the two knobs answer different failure modes (overwhelm
  vs staleness).
- Multiple operators per team get per-operator frames (scope=operatorId)
  differing only in policy and cursors, from one store, by read-time folds
  — cheap by construction, and the team-scope frame remains for shared
  displays.

## 3. Observer scoping

The fog design's per-team view documents are the precedent, and the rule
generalizes: **any observer-scoped signal rides an observer-scoped view
doc; the store is team-private while the game is live** (platform
invariant: a team's deliberation is team-private; spectators get
intersection semantics). Consequences:

- Signals derived from the team's own hidden information (clouds over
  *enemy* units, the team's plan set) exist only in that team's view.
- A spectator/broadcast surface, if ever built, is a *different frame* from
  a *different selection* over the public projection — never a filtered
  read of a team frame. (Filtering at read is where masking bugs live; the
  fog lens learned this for game state, and it holds for signals.)
- Post-game, the store's privacy expires with the game (replay/audit story
  owns it from there) — the full signal store is precisely the "decision
  transparency" record replay wants.

## 4. Priority and cadence — the obligation law applied

Every item carries an obligation class; classes compose by meet (tightest
binds), and the bottom element is operator-initiated:

| class | meaning | delivery |
|---|---|---|
| `operator` (bottom) | answers/echoes of this operator's own actions: conformance acks, ask status changes, pinned classes | immediate frame replacement, always, off-budget |
| `soundness` | oracle violations, premise breaks — "stop trusting the surface" | immediate, unmutable |
| `turn-critical` | edges that bear on the *current* staged decision before commit: threat edges, saturation verdict, sacrifice-warrant asks | next frame within the current turn |
| `turn-boundary` | digests, share-state updates, curve refreshes | at ADVANCE; ride the turn note |
| `ambient` | everything else selected | whenever a frame is next assembled |
| `archival` | never framed; store-only (ledgers, matrices, full traces) | pull |

Cadence rules:

- **Frames replace at most once per `frameQuantum`** (an operator-experience
  constant, ~1s-class, owned by the ADVICE economy — NOT by the search's
  EmissionWindow), except `operator`/`soundness` items, which flush
  immediately. Rationale: the wire's staged-move rate limiter exists to
  stop plan thrash on the game server; the signal surface's limiter exists
  to stop *display* thrash in a human's eyes. Different failure modes,
  different constants, deliberately not one mechanism — coupling them
  would let a starving emission window silence alarms.
- **Flood mode** (doc 06 §3): each class declares a rate band; when firing
  exceeds it, frame assembly degrades that class to first-out-led bundles
  with counts — never a scroll of individual items. The band values are
  members with provenance; nothing numeric transfers from other industries,
  only the shape (a declared band + a defined degradation).
- **The turn boundary is the digest point.** ADVANCE transports the
  sinceTurn cursor; the turn note is assembled once, at resolution, when
  the machine knows what actually happened (realized resolution, replay-
  rebase checksum) rather than what it staged.
- **Pull never blocks push.** Store queries are answered from retained
  records; a heavy drill-down cannot delay a frame (the store is written
  behind the frame's emission, read on a separate path).

## 5. Freshness — the honest timestamp

```ts
interface Freshness {
  readonly turn: number
  readonly seq: number
  readonly quantaSpent: number            // ledger units into this decision — the search-progress clock
  readonly stagedPlanHash: string          // what the incumbent was when this was computed
  readonly voidIf: InvalidationCondition | null   // HELD-style: the condition under which this item is already dead
}
```

- Ledger units, not wall clock, per the time lens's ledger law: a frame's
  age in ms says nothing; its age in quanta and turns says everything, and
  it replays.
- `stagedPlanHash` lets the client render "computed against a plan that has
  since changed" — the one staleness that matters most to a human deciding
  whether to intervene.
- Signals frequently outlive their validity mid-turn; `voidIf` makes decay
  a *condition* the next frame's assembly checks, not a TTL guess. An item
  whose voidIf fired is removed or re-issued, never silently left.
- The conformance stream closes the loop: every operator intervention gets
  an `operator`-class edge within ≤1 tranche (received → incorporated |
  overridden-by-floor, with the floor's citation). This is the OUT half of
  the IN surface's contract, and its latency budget (the tranche) is the
  time lens's conform gate — the one place the two surfaces share a
  deadline.

## 6. Versioning and evolution

- `v` on every frame and store record; shapes and roles are **closed enums
  per version**; edges' predicates and flows' channels are **open member
  vocabularies** (new alarm/channel = new member id, no schema bump) — the
  manifest generates the id tables, per the joints lens's codegen rule.
- **Clients render unknown member ids opaquely** (stub + drill); **miners
  and analytic readers REFUSE unknown schemas** — never default-to-zero
  (the depth-idle lesson, standing pin: a zero that means "field absent"
  is how a false crisis reads as data).
- Additive changes (new optional field, new member id) do not bump `v`;
  any change to selection semantics, shape payloads, or freshness
  semantics does. Two live versions max during migration; the frame writer
  emits the version the team's client roster asks for (the policy carries
  a `maxV`).

## 7. Transport mapping (informative)

| API object | platform mapping |
|---|---|
| SignalFrame | per-(game, team[, operator]) view doc; hosting server sole writer; full-snapshot replacement on write (dirty-flag trigger); realtime subscription |
| store queries | server endpoints on the team's hosting server (deliberation-private, so they terminate where the deliberation lives, not in shared platform state) |
| AttentionPolicy | operator-config doc under the operator-control/guidance capability; read by the hosting server |
| asks / answers | ask status in the frame; answers arrive as ordinary IN affordances (pin, observation, dial) — no dedicated answer channel exists |
