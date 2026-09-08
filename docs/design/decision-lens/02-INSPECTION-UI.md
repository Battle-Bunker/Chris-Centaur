# 02 — The inspection interface and interaction model

DECISION-LENS, UI lens. Mandate: the operator-facing half of the decision
lens — what an operator selects, what they see, what they press, and what
their press does. Sibling lenses own the kernel's emissions (what a cluster
and a moveset *are*) and the data model (how a turn's events are shaped,
carried and stored). This document is written for an implementer: every
state, every transition, every glyph, every key.

Grounded on `lens-ui` @ `04744a1`. Sources read and cited inline:
`src/web/play-game.html`, `src/web/board-renderer.js`,
`src/web/keynav-machine.js`, `src/web/history.html`,
`src/server/websocket-server.ts`, `src/server/active-game-manager.ts`,
`src/logic/command-logger.ts`, `src/logic/turn-timeline.ts`,
`src/database/schema.ts`, `README.md` (§How it plays), and the design
branches `origin/design/operator-guidance`, `origin/design/operator-signals`,
`origin/design/joints-composition`, `origin/design/search-theory`.

Nothing here is final. §5 lists what I assumed and what must come back from
the other two lenses.

---

## 0. The thesis in one paragraph

The shipped UI answers *"why is this unit moving there?"* with a table of
thirty heuristic components for one unit's four candidate moves
(`board-renderer.js::updateStatsTable`, line 4278). The bot has stopped
thinking that way: it solves **clusters** of interacting units jointly and
emits **movesets** — one joint assignment of a move to every cluster member,
scored as a whole. A per-unit heuristic table is therefore not a lossy view
of the decision; it is a view of a decision that is no longer taken. The
replacement is a four-level cursor — **unit → candidate → moveset → member
term** — where each level's numbers are *conditional on the level above*,
and where the operator's one determination gesture (`Space`) is defined to
make **exactly the thing on screen** become the thing that is staged. That
last clause is the whole design: everything else in this document exists to
keep it literally true, live and in replay, under concurrent edits by other
operators.

---

## 1. The inspection model

### 1.1 Vocabulary

| term | meaning |
|---|---|
| **unit** | a snake or chess piece; `snakeId` on the wire today |
| **fixity** | why a unit is *not* a free variable: `pinned` (operator determination this turn), `held` (standing hold — `README.md` §Hold), `committed` (observed in `moveStatuses.movedPlayerIDs`), `dead`, `foreign` (not ours) |
| **cluster** | the kernel's connected component of the interaction graph over the **free** units. Fixed units are *excluded* — their moves are constants the kernel conditions on, never variables it solves. |
| **candidate** | one legal move for one unit. Snakes: a `Direction`. Pieces: a full-board destination index plus a `stay`/`move`/`rotate` kind (`active-game-manager.ts` `PieceCandidateScore`, `board-renderer.js::processMoveEvaluations`). Unchanged. |
| **moveset** | one assignment `member → candidate` covering every member of one cluster, with an aggregate score. |
| **conditional list** `L(C, u↦m)` | the top-k movesets of cluster `C` under the constraint that unit `u` plays candidate `m`, ranked by aggregate. |
| **incumbent** | the moveset the kernel would stage right now if the turn resolved: `L(C, ∅)` rank 1. |
| **lens frame** | everything the renderer consumes at one `(turn, seq)`. §2.3. |

**Rule E (exclusion).** A unit with any fixity is drawn, is rostered, keeps
its staged arrow — and is **not** a cluster member. Its move appears in the
moveset panel only as a greyed *constant row* beneath the members, labelled
with its fixity reason and the operator who caused it. This is the owner's
"operator-pinned moves are excluded from unit clusters because those
decisions are immutable to the bot", made a display invariant rather than a
convention: if the panel shows a unit as a member, the bot is still choosing
its move, full stop.

### 1.2 The cursor

```ts
type LensCursor = {
  unit:      UnitId  | null;   // focus
  candidate: MoveKey | null;   // requires unit
  moveset:   MovesetId | null; // requires cluster; ∈ L(cluster, unit↦candidate)
  drill:     UnitId  | null;   // requires moveset; which member's terms are open
  foil:      'off' | 'peek' | 'latched';
};
```

**Law D (defaults cascade, choices pin).** Every level below the deepest
*explicitly chosen* level is auto-filled by a deterministic default:

| level | default |
|---|---|
| candidate | the unit's **incumbent** move (what the bot has staged for it right now) |
| cluster | the cluster containing `unit`; if several (see §5, Q6), the one with the largest aggregate at stake |
| moveset | rank 1 of `L(cluster, unit↦candidate)` |
| drill | closed |

Consequences worth stating because they drive the code: (a) a focused unit is
**never** in a state where the moveset panel is empty — selecting a unit
immediately answers "why is it doing what it's doing"; (b) choosing a
candidate re-defaults moveset and drill, but choosing a *moveset* does not
touch the candidate; (c) the cursor stores, per level, an `explicit: boolean`
so re-resolution (§1.5) knows what to preserve.

### 1.3 States and transitions

Five cursor states, named by the deepest non-null level.

```
                    focus(u)                candidate(m)
   ┌──────┐  ────────────────▶  ┌──────┐ ───────────────▶ ┌────────────┐
   │ NONE │                     │ UNIT │◀───────────────  │ CANDIDATE  │
   └──────┘  ◀────────────────  └──────┘   candidate(∅)   └────────────┘
       ▲          blur / Esc        │                       │        ▲
       │                            │ (auto, always)        │moveset │[ ]
       └────────────────────────────┘                       ▼        │
                                                        ┌────────────┐
                                              drill(v)  │  MOVESET   │
                                            ◀──────────▶│ (= default)│
                                             ┌──────────┴────────────┘
                                             ▼
                                        ┌──────────┐
                                        │ BREAKDOWN│
                                        └──────────┘
```

`UNIT` is transient: Law D auto-advances it to `CANDIDATE` on the same tick
unless the unit has no candidates at all (dead, committed, foreign) — in
which case `UNIT` is terminal and the rail shows the fixity reason instead of
a moveset list. `MOVESET` is `CANDIDATE` with `drill = null`; they are the
same state with the drill panel collapsed and are separated here only so the
transition table can name the drill.

**Transition table.** `⟳` = re-default everything below. `≡` = unchanged.

| # | event | source | precondition | effect |
|---|---|---|---|---|
| T1 | `focus(u)` | click unit on board / click roster row / `Tab` | u is inspectable | `unit←u`, ⟳. Also emits `notePinConsideration(gameId,u,default candidate)` — the A0 attention channel (`active-game-manager.ts:659`) |
| T2 | `blur` | `Esc`, click empty board | — | cursor ← all null; emits `clearPinConsideration` |
| T3 | `candidate(m)` | arrow-pad / numpad (`keynav-machine.js`) / click candidate cell | m ∈ candidates(u) | `candidate←m` explicit, ⟳ below. Re-emits consideration |
| T4 | `candidate.hover(m)` | pointer over a candidate cell | — | **no cursor change.** Draws a peek of `L(C,u↦m)` rank 1 at alpha .4 and shows its aggregate in the candidate row. Emits consideration. Hover never commits the cursor: the board is a place to look, and a lens that re-ranks under the pointer is unusable |
| T6 | `moveset(i)` | `[` / `]` / click row | i ∈ L | `moveset←i` explicit, `drill←null` |
| T7 | `drill(v)` | `B` / click member row | v ∈ members(moveset) ∪ {constants} | toggles `drill` |
| T8 | `foil(mode)` | `F` tap / hold | rank 2 exists | sets `foil`; board draws §3.5 |
| T9 | **`lock`** | `Space` | live head, u ours, turn not committed | §1.4 |
| T10 | `lock.moveset` | `Shift+Space` | as T9 | §1.4, explicit all-member form |
| T11 | `release(u)` | `U` | u pinned by me (or takeover confirmed) | clears **only** the pin, leaving goto/near intact. Widens the cluster for everyone (§1.6) |
| T12 | `clear(u)` | `Del` | u ours | existing `clear-human-input` — kills every command. ⟳ |
| T13 | `seek(seq)` | timeline scrub, `,` `.` | — | frame changes; cursor re-resolved (§1.5); determinations disabled off-head |
| T14 | `now` | `N` | mode ≠ live-head | returns playhead to the live head, re-resolves |
| T15 | `emission(seq+1)` | kernel | — | §1.5 |
| T16 | `partition-change` | kernel / peer fixity change | — | §1.6 |
| T17 | `turn-boundary` | new board arrives | — | `candidate/cluster/moveset/drill ← null` (the old board's moves are meaningless), `unit ≡`. Board flashes the turn chip. Deliberately keeps focus: an operator watching one unit across turns must not have to re-click it every turn |

### 1.4 Lock — the one determination gesture

> "the same ranking that would immediately select the actual next staged
> moveset if that candidate were locked by the operator" — the owner.

The display contract: **the moveset drawn on the board when you press `Space`
is the moveset that is staged.** Two facts make that non-trivial:

1. Pinning `u` at `m` only forces the *rest* of the cluster to whatever
   `L(C,u↦m)` rank 1 says. If the operator has walked down to rank 3, a
   pin on `u` alone stages rank 1 — a different picture than the one on
   screen. That is a lie, and the whole design fails on it.
2. Pinning *every* member always works but is maximally authoritative: it
   spends A4 determination (`operator-guidance/00-FACTORING.md` §2.5) on
   units the operator never looked at, and A4 outranks every standing
   guidance any other operator has given those units.

**Resolution — minimum-pin lock.** `Space` issues the set of pins that makes
the displayed moveset the one that is staged:

```
P* = {u} ∪ {v ∈ members(C) : K(v) ≠ staged(v)}
```

That is not an upper bound and there is no `≤` anywhere near it. `conform`
splices pins and repairs legality without searching, so the members that
already agree with `K` need no pin and the set is EXACT — which is why the
count can be rendered before the press. (This was written as a fallback for a
`minimalPinSet` the kernel might not answer; 04 §2.4 settled it the other way,
the kernel is never asked, and the affordance is exact rather than bounded.)

- `K` = rank 1 ⇒ `P* = {u}`. The overwhelmingly common case, and the cheap
  one: one determination, the bot keeps authority over the rest.
- `K` ≠ rank 1 ⇒ `P*` is larger. The HUD and the lock affordance always
  render the count *before* the press: `[Space] lock — pins 1 of 4`.
- If `|P*| > 1`, the first such lock in a game raises a one-shot confirm
  ("this pins Q and s1 as well as C — they leave the cluster") with a
  don't-ask-again-this-game checkbox. After that it is silent, because the
  count was always on screen.
- `Shift+Space` = pin every member, unconditionally. For the operator who
  wants the whole cluster nailed down regardless of what the kernel would
  have inferred.

**Ownership guard.** `P*` may contain units another operator owns
(`selections` / `owners`, `websocket-server.ts:901`). Lock is then **refused
at the client**, with the offer: *"locking rank 3 needs a pin on Q, which Ben
holds. [Ask Ben] · [Take over Q] · [Lock rank 1 instead — pins 1]"*. Never
issue a cross-owner determination without an explicit takeover, which already
has a dialog (`confirmDialog`, `play-game.html:650`).

**Post-lock re-derivation, and the verification that makes the contract
checkable.** A lock immediately changes the partition: every unit in `P*`
acquires fixity `pinned` and by Rule E leaves the cluster. `C` becomes
`C∖P*`, and the moveset the operator was looking at becomes, for the
remainder, the incumbent of a *narrower* cluster. The client therefore:

1. Optimistically applies the pins, redraws the cluster as `C∖P*` with the
   pinned units demoted to constant rows (violet arrow → solid staged arrow
   in the operator's colour, as today).
2. Records `expected = K` and, on the **next kernel emission**, compares
   `expected` against the new incumbent for `C∖P*`.
3. On mismatch, raises a **divergence banner** naming exactly which members
   differ and why (the emission's own reason: advanced search, a peer
   command, a board change): *"R went b1→c1 after the lock — deeper search
   at e4; your other three held."* Never silently re-render.

The divergence check is the only reason the display contract is falsifiable
rather than aspirational, and it costs one comparison per emission.

**Wire.** Lock compiles to one `select-move` per member of `P*` (the existing
message, `websocket-server.ts:498`) plus a new `lens-lock` envelope carrying
`{clusterId, movesetId, expected, emissionSeq}` for the log and the
divergence check. The staging path itself is unchanged — write-through to
Firebase through `setUserSelection` → `stageMove`. Fatal-move consent
(`fatalMoveDialog`) still gates any member whose assignment is certain death,
per member, before any pin is written; a refused member aborts the whole lock
(atomicity: a half-locked moveset is not the picture on screen).

**Replay.** T9/T10/T11/T12 are disabled off the live head. The affordance
does not vanish (a greyed control teaches nothing); it re-labels: in replay
it reads `locked by Ada at +812ms → [jump]` if such a lock exists at this
`seq`, or `— read-only —` if not.

### 1.5 Re-resolution: how the cursor survives new data

Every incoming emission (T15) and every seek (T13) replaces the frame. The
cursor must not be replaced with it. **Nothing under the operator's cursor
ever re-orders itself.** Re-resolution is by identity, in this order:

| level | re-resolved by | on miss |
|---|---|---|
| unit | `UnitId` | unit died/committed → `UNIT` terminal with the reason; keep focus |
| candidate | `MoveKey` (direction string / destination index — stable within a turn) | candidate became illegal → fall to incumbent, badge `your candidate is no longer legal` |
| cluster | `ClusterId` if the kernel provides a stable one, else member-set hash (§5, Q1) | §1.6 |
| moveset | `MovesetId` if stable, else the **assignment tuple** restricted to the members present in both frames | miss → §1.6 rules |
| drill | `UnitId` | member gone → close drill |

The moveset list is then re-rendered with a **rank trail** on any row whose
rank moved since the previous frame: `#3 ▲was #1`. Trails decay after two
emissions. The selected row keeps its selection at its new rank; the list
scrolls to keep it under the pointer's row, not at a fixed index.

### 1.6 The reactive case: a peer widens the cluster mid-inspection

The owner's case, spelled out: *Ada is inspecting cluster α = {C, Q, s1};
Ben presses `U` on R, releasing his pin. R returns to bot control, the
interaction partition recomputes, and α widens to {C, Q, s1, R}. The
conditional lists Ada is reading are now over a smaller problem than the one
the bot is solving.*

Widening is the disorienting direction (new variables, new movesets,
different aggregates, possibly a different rank 1). Narrowing (a peer *adds*
fixity) is the calm direction. They get different treatment.

**Widening — staged behind one gesture.**

1. **Nothing under the cursor moves.** The old list stays rendered,
   selection intact, board drawing intact — but every aggregate in it is
   struck through and the panel header gains `stale @ seq 14`.
2. A **widen banner** appears above the moveset table:
   ```
   ⚑ Ben released R — cluster α is now 4 units.   [Show] (auto 6s)
   ```
   The countdown is visible and pausable. **Auto-accept is suspended while
   the drill panel is open**: reading a table of numbers is a commitment,
   and swapping it out from under a reader is the specific failure this
   whole section exists to prevent.
3. On accept (or timeout), the list swaps to `L(C', u↦m)` and the cursor
   re-resolves by the §1.5 rules with one addition: the old selection's
   assignment is matched against new rows **restricted to the old members**.
   Best match wins the selection and carries the trail `▲was α#1 of 3`.
4. If no new row contains the old assignment (the new member changes what is
   worth doing for everyone — the interesting case), selection falls to rank
   1 and the row carries a **displaced badge**: *"your moveset is not in
   α′'s top-5 · [find it]"*, where `[find it]` opens the candidate ledger
   drill and shows its new rank and aggregate, or its disposition if it was
   pruned (`search/10-CANDIDATE-LIFECYCLE`).
5. On the board, R's cells get a 600 ms **arrival pulse** (violet ring
   expanding once) and R's tether animates in. One pulse, never a loop:
   the point is to move the eye once, not to nag.
6. If a lock is in flight (pins written, expected-vs-emission not yet
   checked), the widen is **queued** behind it and the banner reads
   `⚑ … — will apply after your lock settles`.

**Narrowing — applied immediately, announced quietly.** A peer pinning or
holding a member removes a variable; every surviving moveset is still a valid
picture of a smaller problem. Apply at once, move the removed unit into the
constant rows with its new fixity and attribution (`held by Ben`), and put a
one-line note in the panel footer for two emissions. No banner, no timer.

**The rule behind both.** *Additive uncertainty is staged; subtractive
certainty is applied.* It generalises: a new ADVICE ask is staged (it wants
attention); a resolved ask is applied. This is the one policy the whole
reactive surface follows, and it is the operator-signals attention-budget law
(`02-AGGREGATION.md` §3) arriving at the widget level.

---

## 2. The timeline within a turn, and the single view-model

### 2.1 The event vocabulary

A turn is a sequence of events with a per-turn monotonic `seq`. This is the
complete list the timeline renders; the data lens owns their persistence.

| kind | fires | carries | lane |
|---|---|---|---|
| `board.arrival` | authoritative board for turn N ingested | `GameState`, `turnExpiryTime` | — (t₀ anchor) |
| `fastpass.staged` | the immediate "nothing is unstaged" pass | per-unit move + source | kernel |
| `kernel.emission` | an anytime emission | `partition`, per-cluster top-k + aggregates, `quantaSpent`, `bot` identity, `guidanceId` | kernel |
| `operator.command` | every row `command-logger` already writes: `manual-move`, `goto-set/append/remove`, `near-set`, `waypoint-clear`, `hold`/`unhold`, `input-clear`, `fatal-move-confirmed`, `suicide`, `commit`, plus new `pin`/`unpin`/`lens-lock` | `OperatorRef`, payload | operator |
| `operator.attention` | focus / candidate hover — the tentative-pin channel (`notePinConsideration`) | unit, candidate | operator (**off by default**) |
| `staging.requested` | `stageMove` binds a move | unit, move, source rung | staging |
| `staging.confirmed` | Firebase readback matches the request | unit, move | staging |
| `staging.committed` | observed in `moveStatuses.movedPlayerIDs` | unit | staging |
| `guidance.activated` / `.retired` | a carried premise's lifecycle fires (`operator-guidance` §2.4) | utterance id, reason | operator |
| `advice.surfaced` / `ask.opened` / `.answered` / `.mooted` | the operator-signals frame | item id, role | advice |
| `system.transition` | `goto-target-reached`, `command-cleared-on-death` | — | operator (system-attributed) |
| `turn.resolution` | server resolved the turn | realized moves, deaths | — (t₁ anchor) |

Every event: `{ seq, tMono, tWall, kind, unit?, cluster?, operator?, payload, causes?[] }`. `tMono` is ms since `board.arrival` — it is what the
timeline lays out spatially; `tWall` is for absolute display and for
cross-referencing the connection log. `causes` carries refs, never nested
payloads (AGG-1: an aggregate names its constituents).

Two properties this list is designed for: it is **complete** (any moment in
the turn is reconstructible from `board.arrival` plus the prefix), and it is
**attributed** (every event names an operator or is explicitly system).

### 2.2 The scrubber

Two nested time axes. The outer one exists (`playTurnSlider`, `navPrevTurn`,
`viewModeBadge` — `play-game.html:461`) and is unchanged. The inner one is
new: a lane strip under the board, spanning `board.arrival → deadline`.

```
┌ TURN 41 ────── 0ms ──────────────────────────── 1,412ms ── deadline 1,500 ┐
│ kernel    ▲fast   ▲e1        ▲e2          ▲e3              ▲e4            │
│ operator        ●Ada near(s2)      ●Ben unpin(R)      ○Ada focus C        │
│ staging     ┆req C ┆conf C      ┆req R ┆conf R              ┆commit R      │
│ advice                 ✦w7 warrant              ?q3 ask                   │
│ ──────────────────────────────────────╫───────────────────────────────────│
│  seq 14 / 21  ·  +812 ms  ·  emission e3  ·  1,180q  ·  ⏸ SCRUBBED  [N]   │
└───────────────────────────────────────────────────────────────────────────┘
```

- Ticks are clickable; the playhead snaps to events, never to pixels
  (a frame between two events is the earlier event's frame).
- `,` / `.` step one event; `Shift+,` / `Shift+.` jump kernel emission to
  kernel emission; `Home` / `End` go to arrival / head.
- Operator ticks carry the operator's colour (the same stable per-game colour
  the arrows use — `resolveOperator`, `active-game-manager.ts:2110`), so
  "who did that" is answerable without hovering.
- `operator.attention` ticks are hollow (`○`) and hidden unless the lane is
  expanded — they are numerous and low-grade.

**Three modes, not two.** Today `viewMode ∈ {live, historic}`. The lens needs
`live-head | live-scrub | replay`:

| mode | frame source | playhead | determinations |
|---|---|---|---|
| `live-head` | live, latest seq | pinned right, follows | enabled |
| `live-scrub` | live, earlier seq **of the current turn** | dragged | **disabled** |
| `replay` | database | dragged | disabled |

`live-scrub` must be loud — badge `⏸ SEQ 14/21`, the board's violet ink
desaturated 30 %, and every determination affordance replaced by
`[N] return to now and lock`. **Determinations are only ever issued from the
live head**: locking against a frame whose ordering has since moved would
break the display contract at exactly the moment it matters. One key (`N`)
gets you back, and the lock offer is one gesture away, so the discipline
costs a keystroke rather than a workflow.

### 2.3 `LensFrame`: the single view-model

The renderer consumes this and nothing else. No component reaches for a
websocket message, a database row, or a live-vs-replay flag.

```ts
interface LensFrame {
  at: {
    gameId: string; turn: number; seq: number;
    tMono: number; tWall: number;
    mode: 'live-head' | 'live-scrub' | 'replay';
    isHead: boolean;              // determinations legal iff true
  };
  board: GameState;               // authoritative board for `turn`
  units: UnitRow[];               // id, kind, letter, weight, health, orientation,
                                  // fixity, owner, operator
  partition: ClusterView[];       // members[], excluded[{unit, reason, by}], lineage
  candidates: Record<UnitId, CandidateRow[]>;
                                  // key, move, kind, dest, legality,
                                  // conditionalBest {aggregate, grade}, disposition
  movesets: Record<MovesetKey, MovesetRow[]>;
                                  // key = `${clusterId}|${unitId}|${moveKey}`
  breakdown: Record<MovesetId, MemberBreakdown[]>;
                                  // per member: contribution + terms[]; plus jointResidual
  staged: Record<UnitId, StagedMoveView>;   // UNCHANGED shape (active-game-manager.ts:283)
  routes: Record<UnitId, RouteView>;        // UNCHANGED
  waypoints: Record<UnitId, {type, cells}>; // UNCHANGED
  advice: AdviceItem[];           // the selected items + asksOpen (operator-signals 03)
  events: TurnEvent[];            // this turn, seq ≤ at.seq
  provenance: {
    botId; behaviourId; evalVersion; guidanceId;
    emissionSeq; quantaSpent; premise;
  };
}
```

Three deliberate choices:

- **`staged` / `routes` / `waypoints` keep their current shapes.** They
  already serve live and replay identically (`CommandTurnState`,
  `active-game-manager.ts:311`) and the arrow renderer already reads one
  contract for both (`renderBoard`, `board-renderer.js:2363`). Rewriting a
  working dual-source contract to prove a point would be the junk this
  exercise is supposed to throw away.
- **`provenance` is mandatory on every frame.** A number without its
  `evalVersion` / `guidanceId` is a cross-fiber comparison waiting to happen
  (`operator-signals/02-AGGREGATION.md` AGG-3). The panel footer renders it
  small and always.
- **`events` is in the frame, not beside it.** The timeline is a view of the
  frame, so scrubbing is a pure function of the same object the board reads.

### 2.4 The two sources, one reducer

```ts
type FrameStore = { turn: number; checkpoint: LensFrame; events: TurnEvent[] };

applyEvent(store: FrameStore, e: TurnEvent): FrameStore   // pure
frameAt(store: FrameStore, seq: number): LensFrame        // pure fold
```

- **`LiveFrameSource`** subscribes to the websocket, maps each inbound
  message to one or more `TurnEvent`s, and calls `applyEvent`. It keeps the
  whole current turn's events (a turn is bounded by the deadline; this is
  kilobytes) so `live-scrub` needs no fetch. On `board.arrival` it snapshots
  a new checkpoint and ships the closed turn to the ring buffer.
- **`ReplayFrameSource`** reads the persisted rows (`turn_states` for the
  board checkpoint — `turn-timeline.ts`; the intra-turn event log for the
  rest) and calls **the same `applyEvent`**, with the same event objects.

**This is the identical-display-logic guarantee, and it is stronger than
"both call the same render function".** It is the same *state machine* over
the same *event type*; the only difference between live and replay is who
hands the events over and whether `at.isHead` is true. The cost of the
guarantee is one requirement on the data lens: **the persisted event rows
must be byte-shaped like the wire events** (§5, D4). `command_events`
(`schema.ts:120`) is already 90 % of this: it has timestamp, game, snake,
turn, event type, operator identity and a JSONB payload. It needs `seq` and
`tMono`, and it needs the kernel emissions and the staging transitions added
to the same table (or a sibling with the same columns).

The existing `command_turn_states` end-of-turn snapshot (`schema.ts:151`)
survives — not as a display source but as the **fold checkpoint** that lets
replay seek to a turn without folding the game. Keeping it is cheap and it is
already written.

**What this deletes.** The entire live-vs-replay fork in `play-game.html`:
`renderHistoricAtTurn`, `historicMoveState`, `historicRenderCtx`,
`sharedTerritoryMoveState`, `showHistoricSelectionPanel`,
`showHistoricNoDataPanel`, `renderPreviewFrame`'s parallel path, and the
"replay's counterpart of selectMove" (line 4776). Roughly 900 lines of
duplicated display logic, which today drifts (the replay's evaluation panel
and the live one already diverge in their empty states). §4.

---

## 3. Board vocabulary

### 3.1 What is already on the board (do not collide)

From `board-renderer.js`: unit icon upright (`drawUnitIcon`), **orientation
eye** on the faced cell edge in `rgba(56,174,255,.8)` (`EYE_STROKE`:2 52),
**hold shield** in amber above the head (`HOLD_SHIELD_COLORS`:356), **solid
arrow** in the controller's colour or bot grey `#9E9E9E` = confirmed staged,
**dashed translucent arrow** in the same colour = requested (ghost), **double
chevron** = committed, **thin dashed grey** = bot recommendation hint
(`secondaryMove`), **red ⃠** = fatal (`#ff1744`), **green** goto route /
**blue** near target, **amber corner arms** = clash affordance (`CLASH_INK`
`#FF8F00`:1507), health bars, body plates, unit tags, hazard cells, death
markers. Ground is white `#ffffff`; page chrome is dark `#1a1a1a`
(`chrome.css`).

Claimed hues: blue (eye), amber (hold, clash), red (fatal), grey (bot),
green (goto), light blue/teal-ish blue (near), plus arbitrary operator
colours on arrows.

### 3.2 The lens ink

**One rule: violet means hypothetical.** Everything the lens draws that is
*being considered rather than staged* is violet; nothing else on the board is
violet today, and nothing else may become violet.

| token | light board | dark board | used for |
|---|---|---|---|
| `--lens` | `#7B4FE0` | `#B39DFF` | cluster tethers, chips, implied arrows, cursor arrow |
| `--lens-wash` | `rgba(123,79,224,.07)` | `rgba(179,157,255,.12)` | cluster interior wash |
| `--foil` | `#00897B` | `#4DB6AC` | the contrastive runner-up |
| `--fixed` | `#6B6B6B` | `#9A9A9A` | exclusion padlock chips, constant rows |
| `--refuter` | `#D84315` | `#FF8A65` | the dominant refuting reply (§5, Q7) |

Tokens are declared once and read by every glyph; no literal colour is
written at a draw site. The board today hardcodes `#ffffff` ground; the pair
above exists so that when a dark board is asked for, the lens does not have
to be redesigned. **Shape always carries the meaning; colour only reinforces
it** — filled vs hollow vs dotted distinguishes cursor / implied / foil for a
deuteranope with the hues collapsed.

### 3.3 Cluster membership — constellation tethers, not outlines

A hull or a cell-frame collides with the clash corner arms and looks like
noise on a body-covered board. Instead:

- **Cluster chip.** A small violet chip on the unit's head plate, opposite
  the letter, carrying the cluster's glyph (`α β γ …`). Fixed units get a
  **grey padlock chip** instead. A held unit keeps its amber shield and the
  shield gains a thin grey ring — the shield *is* the reason; do not draw a
  padlock as well.
- **Tethers.** Thin (1 px) violet dashed lines from each member's head to
  the cluster's centroid, alpha .35, drawn beneath units and beneath arrows.
  A four-unit cluster reads instantly as a constellation; nothing else on
  the board radiates thin line-art from heads.
- **Wash.** `--lens-wash` fill on member origin cells only. Optional, off on
  small cell sizes (< 22 px), where it turns to mud.
- No tether is ever drawn to an excluded unit. That is the exclusion, drawn.

### 3.4 The moveset on the board

The selected moveset assigns a move to every member. Rendering rules, in
draw order:

1. **The focused unit's candidate** — a **filled violet arrow**, one weight
   heavier than a staged arrow, same geometry as `drawArrow`.
2. **Other members whose implied move DIFFERS from what is staged** — a
   **hollow violet arrow**: 2 px stroked outline, unfilled head. It overlaps
   a solid staged arrow legibly instead of hiding it.
3. **Other members whose implied move EQUALS what is staged** — no second
   arrow. A **violet ring around the existing arrowhead** (agreement mark).

Rule 3 is the important one: **only disagreement draws.** In the common case
(the operator is looking at the incumbent) the board gains a constellation
and one heavier arrow, and nothing else changes. When the operator walks down
the moveset list, the members that would move differently light up one by
one. The board becomes a difference display, which is what it should have
been all along.

4. **Rotations** reuse the existing rotation badge (`drawRotationBadge`) in
   violet rather than inventing a hypothetical-rotation glyph.
5. **Constants** (excluded units) keep exactly their current rendering. They
   are facts, not hypotheses, and must not be violet.

### 3.5 The contrastive foil

Per `operator-signals/00-SIGNAL-INVENTORY.md` §1 and `09-REFUTATION-AND-
AUTHORITY`, the foil — (runner-up, deciding feature, margin) — is computed
and discarded today. It is the highest-value cheap signal on the surface.

- **Panel side:** always visible as one line under the moveset table:
  `foil #2 · deciding: room(s1) −1.1 · margin 0.7`.
- **Board side:** `F` (tap = latch, hold = peek) draws the runner-up in
  `--foil`, **dotted hollow arrows, only where it differs** from the selected
  moveset, plus a small Δ badge on each differing member's cell carrying that
  member's contribution difference. Two movesets that differ in one unit
  produce exactly one teal arrow and one badge — the picture of the decision.
- When the deciding rung is a **tie-break** rather than a term (the
  authority-collapse signal, `operator-signals/09` §3), the foil line
  changes to the ask form: `my proof rungs are silent here — your call beats
  my tie-break` and the ask chip pulses. This is where operator attention is
  worth the most, and it is the one place the lens actively asks for it.

### 3.6 Advice and asks on the board

ADVICE items anchored on a unit draw a small **notch chip** on the unit tag:
violet outline, `i` for an offer, `!` for an ask; asks pulse at 2 s until
answered or mooted. Never an arrow — advice is not a move, and giving it
arrow-shaped ink would collide with the one vocabulary we are protecting.
Clicking opens the item in the rail. Off-board items live in the rail's
`index` strip (the not-selected middle — selection is not censorship).

### 3.7 Panels

Right rail, widened from 300 px to 380 px. Four stacked panels plus the
advice strip.

```
┌ ADVICE ─ 4 of 11 ─────────────── budget ▮▮▮▮ ─┐
│ ! Between the top plans my proof rungs are    │
│   silent — your call beats my tie-break.      │
│ i near(s2) is outvoted by contest (0.4 v 2.1) │
│                                    [⌄ index]  │
└───────────────────────────────────────────────┘
┌ FOCUS ────────────────────────────────────────┐
│ ♞ C  knight   hp 74  wt 3        cluster α(4) │
│ intent heuristic · staged e5→f7 · confirmed   │
├ CANDIDATES ─ 9 legal ─ scored as best-of-α ───┤
│ ▸ f7   move    α 12.4   ← incumbent           │
│   d7   move    α 11.9   Δ0.5                  │
│   g5   move    α 10.2   Δ2.2                  │
│   e5   stay    α  9.8   Δ2.6                  │
│   c6   move    α  8.1~  Δ4.3   estimated      │
│                              …4 more  [⌄ all] │
└───────────────────────────────────────────────┘
┌ MOVESETS · α given C→f7 ·············· seq 14 ┐
│  #  aggregate   Δ     assignment              │
│ ▸1     12.4     —     C f7 · Q d4 · s1↑ · R b1│
│  2     11.7   −0.7    C f7 · Q d4 · s1→ · R b1│
│  3     11.1   −1.3    C f7 · Q g4 · s1↑ · R b1│
│  4      9.6   −2.8    C f7 · Q d4 · s1↑ · R c1│
│ ── fixed ──────────────────────────────────── │
│  🔒 K  g1  held (Ben)   🔒 s2  ←  pinned (Ada)│
│ foil #2 · deciding room(s1) −1.1 · margin 0.7 │
│ [F] foil   [Space] lock — pins 1 of 4         │
└───────────────────────────────────────────────┘
┌ BREAKDOWN · α#1 = 12.4 ───────────────────────┐
│ unit  move  contrib   top terms               │
│ ▾ C    f7    +4.10    reach +2.20 threat +1.40│
│    reach     0.71 × 3.1 = +2.20               │
│    threat    0.35 × 4.0 = +1.40               │
│    room      0.62 × 1.5 = +0.93               │
│    …7 more                            [all]   │
│   Q    d4    +3.60    command +2.90 …         │
│   s1   ↑     +2.90    territory +1.80 …       │
│   R    b1    +1.80    —                       │
│ ── joint (pairwise C×Q)        +0.00  [why?]  │
│ bot b_default · bh_9f2 · e17 · g41a · 1,180q  │
└───────────────────────────────────────────────┘
```

Notes an implementer needs:

- The candidate list's number is **`aggregate(L(C, u↦m) rank 1)`** — the best
  the *cluster* can do given that candidate — not the unit's own score. This
  is the single largest semantic change from the shipped panel and the rail
  header says so in words (`scored as best-of-α`).
- A candidate whose conditional list was never computed shows a **grade**:
  `~` for estimated, `·` for unpriced, and never a bare number. Grades come
  from the ledger disposition (`search/10-CANDIDATE-LIFECYCLE`).
- The **joint row is mandatory** whenever it is non-zero. A cluster exists
  *because* of cross terms; a breakdown that presents the aggregate as the
  sum of per-unit contributions when it is not would reintroduce the exact
  dishonesty the old per-unit table had. If the joint residual is zero, say
  zero and offer `[why?]` — a zero cross term is itself a finding.
- The whole rail is one scroll region; on narrow screens the panels collapse
  to accordion sections with the moveset table expanded by default.

### 3.8 Keyboard model

Extends the shipped schema (`play-game.html:533`) without touching a single
existing binding. Free keys verified against the shortcuts pane and the
keydown handlers: Tab, Esc, ↑↓←→, WASD, 1–9, Space, H, Del, Enter,
Ctrl+Enter, Ctrl+/, Alt are taken; the following are not.

| key | action |
|---|---|
| `[` / `]` | previous / next **moveset** in the conditional list |
| `F` | **foil** — tap latches, hold peeks |
| `B` | toggle the **breakdown drill** on the highlighted member |
| `Shift+B` | expand every member's terms |
| `,` / `.` | step the intra-turn **timeline** one event back / forward |
| `Shift+,` / `Shift+.` | jump to previous / next **kernel emission** |
| `Home` / `End` | timeline to board arrival / to the head |
| `N` | return to **now** (live head) from `live-scrub` |
| `U` | **release** the focused unit's pin only (leaves goto/near) |
| `Space` | **lock** — unchanged key, strictly more meaning (§1.4) |
| `Shift+Space` | lock the whole moveset (pin every member) |
| `Shift+Tab` | cycle units backwards |

`Space` deserves a note: today it stages the selected candidate. Under the
lens it stages the selected candidate *and thereby* the displayed moveset,
via minimum pins. An operator who never opens the moveset list presses
`Space` and gets precisely today's behaviour, because rank 1 conditional on
their candidate needs one pin — theirs. The gesture is not re-taught; it is
re-explained.

The shortcuts pane gains two groups, **Inspecting the decision** and
**The turn timeline**, written in the pane's existing voice. That pane is
load-bearing ("Every keydown handler on this page is described here; there is
no other shortcuts UI" — `play-game.html:531`) and the rule holds.

---

## 4. The delete list

Radical ruthlessness, with the reason each thing stops explaining anything.

**D1 — The per-unit heuristic table.** `board-renderer.js::updateStatsTable`
(4278) and `updateLobsterStatsTable` (4676), the `.decision-stats` markup and
`statsTableBody` (`play-game.html:502`), and the `averageWeighted`
cross-candidate averaging inside them. *Why:* it is a view of a per-unit
decision the bot no longer takes. **Keep the lesson, delete the code:**
`updateLobsterStatsTable` exists because a hardcoded metric list rendered
thirty zero rows for an engine with a different vocabulary — the new
breakdown must derive its rows from the row's **own** weights table, always,
with no engine special-case.

**D2 — The Voronoi territory overlay, whole.** `territoryCells`
(`TurnData`), `boardTerritory` on `board-update` and `snake-turn-update`
(`websocket-server.ts:239,262`), `wantsTerritoryOverlay` +
`set-display-prefs` + `stripUnwantedDisplayData`, the `territoryOverlayToggle`
checkbox, `sharedTerritoryMoveState`, `territoryGridForOverlay`,
`findTerritoryOwnerAtCell`, `moveState.territoryCells`, and the per-candidate
`projectedTerritoryCells` / `projectedCellOwnership`. *Why:* it paints one
unit's reachable region — the pre-cluster question. It cannot show what a
moveset trades between members, which is the only question the new lens
asks. **Exception, deliberately kept:** the Alt+click cell inspector's
"which unit owns this cell, at what distance" is genuine orientation and
survives — but it reads a number from the frame's feature store, not a
shipped-per-turn paint layer.

**D3 — The grey `secondaryMove` recommendation hint arrow** and
`chosenMoveStyle: 'recommendation-only'`. *Why:* the bot's recommendation is
now, by definition, the rank-1 moveset's assignment for that unit, drawn as
the violet incumbent. Two vocabularies for one fact is the collision this
design exists to prevent.

**D4 — The whole live/replay fork in `play-game.html`.**
`renderHistoricAtTurn`, `renderHistoricBoard`, `historicMoveState`,
`historicRenderCtx`, `showHistoricSelectionPanel`, `showHistoricNoDataPanel`,
`switchHistoricSnake`'s parallel selection path, `renderPreviewFrame`'s
duplicate render, and the replay's counterpart of `selectMove` (4776).
*Why:* §2.4 replaces them with one reducer and two sources. This is ~900
lines and the highest-value deletion in the list: the two paths have already
drifted (their empty states differ).

**D5 — `moveEvaluations` as a UI contract.** The client stops consuming the
per-snake `snake-turn-update` evaluation fan-out and
`processMoveEvaluations`'s scoring/colouring half (`quality`, `getMoveQuality`,
`getScoreColor`, `candidateTint`, `displayScore`). *Keep* its candidate
*enumeration* half — the direction-keyed / destination-keyed split and
`candidatesByPosition` / `holdCandidate` that `keynav-machine` depends on.
That code is correct and hard-won; only its scoring is superseded.

**D6 — `safeMoves` as a display concept.** Candidate admissibility is now a
ledger disposition with a grade (recoverable / closed / unpriced), which says
strictly more. The **fatal marker stays** — it is a warning about a
determination, not a score.

**D7 — The `Decision Breakdown` "waiting for turn data" / "no data" panels.**
Replaced by the frame's honest emptiness: *"fast-pass only — no kernel
emission yet at seq 2"*, which is a different and much more useful sentence.

**D8 — `board-test.html`'s territory fixtures.** It carries no heuristic
table (verified: no `statsTable`), but it builds `moveState.territoryCells`
by hand at lines 729–735 to exercise the overlay. Those fixtures go with D2;
its `processMoveEvaluations` call at line 151 survives, since D5 keeps the
enumeration half.

Not deleted, explicitly: staged/ghost/committed arrows, the orientation eye,
the hold shield, the fatal marker, goto/near overlays and routes, clash
affordances, unit tags and body plates, death markers, the turn slider, the
roster, `CommandTurnState` (demoted to fold checkpoint), the shortcuts pane.

---

## 5. Open questions, and what I assumed of the other lenses

### Demands on the data-model lens (assumed, must be confirmed)

- **D-a. Stable `ClusterId` with lineage.** Cursor re-resolution (§1.5) and
  the widen/narrow banners (§1.6) need to tell *"α gained a member"* from
  *"α was replaced by a different cluster"*. Give clusters an id stable
  within a turn plus `derivedFrom: ClusterId[]`. Without it the UI must key
  on member-set hash, and every membership change reads as a replacement —
  which makes §1.6 step 3 impossible.
- **D-b. Decomposed aggregates.** Every moveset aggregate must arrive as
  per-member contributions **plus a named joint residual**, not as a scalar.
  §3.7's joint row is not optional; without it the breakdown panel lies in
  exactly the way the old table did.
- **D-c. Graded conditional lists.** `L(C, u↦m)` for **every** candidate `m`
  of the focused unit, each aggregate carrying a grade
  (`computed | estimated | unpriced`). If computing all of them is too
  expensive, grade them — but never ship a bare number the operator will
  read as exact.
- **D-d. Wire-shaped persistence.** The persisted intra-turn event rows must
  be the same objects as the wire events, with `seq` and `tMono` added.
  `command_events` is 90 % there; kernel emissions and staging transitions
  must land in the same shape. This is the load-bearing requirement for
  §2.4's identical-display guarantee.
- **D-e. Retention policy for emissions.** Do we persist every emission's
  full top-k and breakdowns, or the partition + top-k always and breakdowns
  only for emissions an operator actually looked at plus the last one? The
  second is much cheaper and makes replay of an unexamined moment
  undrillable. I lean toward: partition + top-k + aggregates always;
  breakdowns lazily reconstructible from the premise coordinates. Needs the
  data lens's ruling.

### Demands on the kernel lens

- **Q1 → D-a** above (it is the kernel that must mint the id).
- **Q2. `minimalPinSet(C, K)`. CLOSED (04 §2.4): never asked.** The client's
  own set is exact, so the kernel is not asked for a smaller one and the
  affordance carries no `≤`. §1.4 rewritten.
- **Q3. Do clusters overlap? CLOSED (04 §3): no.** Components of one graph
  partition the vertex set, so a unit is in exactly one cluster, there is
  nothing to cycle, and T5 and its `\` binding are deleted rather than left
  in the table as a transition the machine does not have.
- **Q4. Does focus/hover really fund compute?** `notePinConsideration` exists
  and is documented as "a hint the search may speculate on". If the kernel
  acts on it, the operator is owed the A0 echo (`operator-signals` §6: every
  IN affordance owes an OUT echo) — something like *"your look bought 200q
  on C"* in the rail footer. If it does not, the `operator.attention` lane
  should be dropped from the timeline rather than logged as noise.
- **Q5. Emission cadence.** How many emissions per turn, realistically? The
  timeline lane's design (ticks, snapping, `Shift+,` jumps) assumes tens,
  not thousands. If it is thousands, the lane needs decimation with a
  visible "showing 40 of 1,200" and the scrubber snaps to decimated points.

### Open for the synthesis round

- **Q6. Multi-operator lock arbitration.** §1.4's ownership guard refuses a
  lock whose minimal pin set crosses another operator's units. Is refusal
  right, or should it downgrade to "lock rank 1, which needs only mine"?
  Refusal is safer and I chose it, but it means an operator can be blocked
  from the picture they are looking at by a colleague who has walked away.
  There is a real product decision here (a timeout on idle ownership?) that
  is above this lens.
- **Q7. Do we draw the refuter?** The dominant refuting enemy reply is,
  per `operator-signals/07-WORKED-FRAME` Moment A, the single most
  information-dense item on a contested board (one column refuting 19 of 23
  plans). Drawing it as a `--refuter` hollow arrow on moveset-row hover
  would be the most valuable board glyph after the moveset itself. I have
  reserved the token and left it undesigned, because it depends on the
  search lens's refutation retention landing.
- **Q8. Auto-accept timing.** §1.6's 6 s widen timer is a guess. It should
  be measured, and it probably wants to scale with the turn deadline
  (`turnExpiryTime` is on every frame already) rather than being a constant.
- **Q9. Replaying `operator.attention`.** Logging where every operator
  looked is powerful for post-game review and slightly uncomfortable. Off by
  default in the timeline; should it be off by default in *storage*?
- **Q10. The 380 px rail on a phone.** The shipped UI is usable on a narrow
  screen (`@media (min-width: 768px)` gates the two-column layout). The
  four-panel accordion in §3.7 is my answer, and it is untested. A cluster
  of five with a nine-term breakdown may simply not fit, in which case the
  narrow layout should drop the breakdown panel to a modal rather than
  compress it into illegibility.
