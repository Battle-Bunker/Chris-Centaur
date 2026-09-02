# 02 — The wire: realtime guidance configuration as data

OPERATOR-GUIDANCE lens, third document. The durable shapes, the transport,
the validation, and the replay story for the IN direction. Starting points:
the Snek platform's shapes (`snake_drives`, `heuristic_config`, the
migrate-operator-control and migrate-bot-framework OpenSpec designs), our
shipped wire (`SnakeIntent`, `CommandTurnState`, `pin-events.ts`,
`privateMoves`/`moveStatuses` precedents), and the joints lens's generated
knob schema (Law N: config is data). 00-doc gives the carve; 01-doc gives
the search-side consumption; this document gives everything between the
operator's click and `GuidanceContext`.

---

## 1. The durable object: one guidance table per (game, team)

```ts
/** One row per live directive. THE ROW IS THE DURABLE STATE; every field a
 *  search consumes is derived from it per decision (fields, routes, stats —
 *  the twice-invented rule: targets and magnitudes are state, everything
 *  else recomputes from the live board). */
interface GuidanceUtterance {
  readonly id: UtteranceId                  // stable; premise tags cite it
  readonly author: OperatorRef              // who; the platform's operator colours
  readonly provenance: 'authored' | 'ratified'   // 00 §5.4 — ratification rider
  readonly provokedBy?: AdviceArtifactId    // OUT→IN handshake, uptake telemetry

  readonly scope: { kind: 'unit'; unitIds: string[] }
                | { kind: 'team' }

  /** WHAT, generatively: a constructor member + its referent + magnitudes.
   *  Law N: memberIds and data only — no expressions, no cross-references. */
  readonly payload: {
    readonly constructor: MemberId          // e.g. 'guidance/goto-ramp@1'
    readonly referent:                      // the constructor's declared type
        { kind: 'cell'; cells: Coord[] }    // singleton = cell, set = region
      | { kind: 'unit'; targetId: string }
      | { kind: 'event'; predicate: MemberId; params: Record<string, number> }
      | { kind: 'none' }
    readonly magnitude: Record<string, number>  // within schema-declared ranges
  }

  readonly lifecycle: { kind: 'turn' }
                    | { kind: 'turns'; n: number }
                    | { kind: 'until'; mode: 'latched' | 'maintenance' }
                    | { kind: 'standing' }

  readonly authority: 'A0' | 'A1' | 'A2' | 'A3'   // A4 never lives here (§4)
  readonly born: { turn: number; at: Timestamp }
}
```

Notes against the sources:

- **This is `snake_drives`, generalized.** The platform row is
  `(gameId, snakeId, driveType, targetType, targetId, portfolioWeight)`;
  ours adds scope beyond one snake, lifecycle beyond satisfied-retirement,
  authority, and provenance — and drops nothing: a platform Drive is a row
  with `scope: unit`, `until`, `A1`(+`A2` for its nominations, compiled).
- **The port is NOT a stored field.** A constructor member *declares* which
  ports it compiles to (a goto-ramp declares value+attention; a
  threat-demand declares support+attention). Storing the port would let the
  table disagree with the constructor — one truth, generated the other way.
- **`lifecycle.until` carries a mode**, adopted from the current-generation
  platform spec's sharpest refinement: retirement is *re-derived from the
  observed board, never latched* — a Drive satisfied on turn n comes back if
  its predicate stops holding on turn n+k. That is a **maintenance**
  semantic (dormant while satisfied, alive when violated) and it is the
  natural reading of "hold this region" and "escort the ally". `goto` is the
  `latched` mode (arrival consumes the queue head — a one-shot event). Both
  modes re-derive from the authoritative board on restart; nothing latches
  in process state. The `until` predicate itself is the constructor's
  declared completion member evaluated on (scope, referent, board).

## 2. The generated schema: what the UI may offer

The joints lens's manifest generates the knob schema; guidance extends it
with **constructor rows** — the same generation, one more table:

```
constructor row := { memberId, label, referentType, targetEligibility: MemberId,
                     ports: [..], defaultMagnitudes, magnitudeRanges,
                     authorityCeiling, lifecycleDefault, uiOrder }
```

This is the platform's `heuristic_config` (`defaultWeight`,
`activeByDefault`, `dropdownOrder`) made a *generated artifact* instead of a
hand-edited table: the dropdown an operator sees, the targeting mode the
board enters (`eligibleTargets` highlighting, Tab-cycles-by-distance — the
platform UI carries over whole), the ranges a magnitude slider may take, and
the validation the wire runs are all read off the same rows the manifest
generated the bot's knob schema from. A constructor no roster bot could
consume fails reachability like any other member.

Team defaults (the platform's global heuristic config — which Preferences
are on by default, at what weight) are the same rows evaluated at
config-time instead of in-game; the split the platform draws (defaults for
future games vs live per-snake overrides) maps to bot-config-time guidance
vs in-game utterances, one schema serving both (answers 00 Q4).

## 3. Transport and events

**Today (Firestore product):** one document per (game, team) —
`guidance/{gameId}/{teamId}` — utterance rows keyed by id, LWW per row,
rules-gated to team members (the `privateMoves` pattern; enemy teams never
read it). The active-game manager subscribes and feeds a typed stream:

```ts
type GuidanceEvent =
  | { kind: 'add' | 'remove'; utterance: GuidanceUtterance }
  | { kind: 'retarget'; id: UtteranceId; referent: Referent }   // structural
  | { kind: 'reweight'; id: UtteranceId; magnitude: {...} }     // magnitude-only
type GuidanceEventSink = (ev: GuidanceEvent, turn: number | undefined) => void
```

mirroring `pin-events.ts` exactly, including its hard-won rule: **every
event carries the turn it constrains** (turn N+1 edits land while turn N's
decision still runs; a consumer that cannot tell them apart applies guidance
to the wrong board — the V4 B5 lesson, inherited verbatim). The
`add`/`remove`/`retarget` vs `reweight` split on the wire is what lets the
kernel route structural edits to citation-invalidation and magnitude edits
to re-fold-at-read without diffing rows.

**Platform later (team Convex):** the same rows in a `guidance` table; the
platform's selection lock gates unit-scoped writes (operator must hold the
snake's selection — their invariant "Drive management exposed only to the
current selector"), team-scoped writes gated per team policy. The
`centaur_action_log` gains guidance events, which the platform's replay
timeline already anticipates ("heuristic output evolution as Drives were
added/removed and weights adjusted").

## 4. What never travels on this wire

- **A4 determinations.** Manual moves, Submit All, and per-warrant
  authorizations stay on the staging wire (`SnakeIntent`, `privateMoves`,
  `matchPin`) — they are moves, not guidance, and their humans-always-win
  path must not acquire a second home. The guidance table's authority field
  therefore tops out at A3.
- **A3 licenses, until the owner opens them** (B5 / 00 Q1). The schema row
  exists so the table shape is stable; the validator refuses the rung while
  the decision is pending, and `authorityCeiling` in every constructor row
  is A1/A2 at launch.
- **Bot opinions.** ADVICE artifacts flow on their own OUT surface; the only
  trace here is `provokedBy` — an id, never content (one-way law intact).

## 5. Validation at accept time (typed refusals, surfaced to the UI)

1. **Budget** (00 §5.1): Σ|A1 weights| over the live table stays under the
   death band; the refusal names the rule and the headroom.
2. **Demand cap** (01 §3.3): at most k A2 demands live per team.
3. **Eligibility**: the constructor's `targetEligibility` member accepts the
   referent (the platform's dimmed-targets UI, enforced server-side too).
4. **Authority ceiling**: row authority ≤ constructor ceiling, A3 gated.
5. **Scope validity**: named units exist, are ours, and — on the platform —
   are selected by the author.
6. **Range**: magnitudes inside schema ranges (generated, not hand-checked).

A refused edit changes nothing and says why — guidance must never fail into
silence, because a directive the operator believes is live and the bot never
saw is the worst trust failure this surface can produce (worse than
refusing: the platform's "quietly substitutes a default move" legality gap
is the cautionary exhibit).

## 6. Compilation, addressing, and replay

Per decision: live rows × board → `GuidanceContext` (01 §2), with
`guidanceId = hash(canonical live rows)`. That hash is a CONFIG-coordinate
component of the premise index, so:

- every bank memo, emit record and telemetry row carries it (fibration);
- a mid-decision edit is a determination on it (kill-by-citation for
  structural, re-fold for magnitude, next-tranche-softly for both);
- **botDiff shows guidance** — two seats differing only in a live directive
  print as different addresses, so "did the operator's guidance help" is a
  measurable A/B for the first time, with the kit's per-seat address
  recording providing provenance for free;
- the per-turn command snapshot (`CommandTurnState`) gains the active row
  set + `guidanceId`, so the history viewer replays *what was asked* beside
  what was played through the same render paths as live play (the command
  logger already snapshots waypoints per turn — this widens that column).

## 7. Telemetry this wire makes possible (reads, not new instruments)

| question | read |
|---|---|
| did the bot follow the directive? | staged plan's `parts` cite the utterance's term; ordering premise tags |
| why not? (frustration signal, 00 M5) | lifecycle ledger `set_aside` dispositions for the guidance-proposed plans + which rung outvoted the term |
| was the advice taken? | `provokedBy` join between ADVICE artifacts and utterances |
| did guidance help? | per-game address (with/without live rows) vs outcome, the standard paired harness |
| operator attention spent | utterance add/edit rate per operator per game — the second currency, finally measured on the IN side |

## 8. Open questions (this document's own)

- **Q8**: per-row LWW vs per-field merge on concurrent edits to one row by
  two operators — the platform's selection exclusivity makes unit-scope
  conflicts structurally rare; team-scope rows (deadlines, appetite) need
  either a captain gate (platform precedent: Captain-only overrides) or
  last-write-wins with visible attribution. Leaning: LWW + attribution,
  captain gate only for A2+.
- **Q9**: does the guidance doc live inside the existing game doc tree or
  beside it? The pin stream's turn-attribution lesson says whichever home
  lets events carry the turn cheaply; the manager already owns that clock.
- **Q10**: schema versioning across mid-game deploys — utterance rows cite
  constructor memberIds; a redeploy that retires a member must either keep
  serving it for live games or visibly retire the row (silent drop violates
  §5's no-silence rule). Suggest: constructors are engine-versioned like
  evaluators (the time lens's evalVersion discipline applies).
