/**
 * THE CURSOR STATE MACHINE, and the reactive policy that keeps it still.
 *
 * T1–T17 of `02-INSPECTION-UI.md` §1.3, minus the deleted T5 (clusters
 * partition the vertex set, so a unit is in exactly one cluster and there is
 * nothing to cycle — 04 §3 Q3). Every transition is a PURE FUNCTION of
 * `(cursor, frame, event)`: the machine is driven from the frame, which is
 * what makes the display contract a property of a function rather than of the
 * DOM.
 *
 * LAW D — defaults cascade, choices pin. Every level below the deepest
 * explicitly chosen level is auto-filled by a deterministic default, so a
 * focused unit is NEVER in a state where the moveset panel is empty:
 * selecting a unit immediately answers "why is it doing what it's doing".
 * `explicit` records, per level, whether the operator chose it, because
 * re-resolution (§1.5) has to know what to preserve.
 *
 * LOCK — `P* = {u} ∪ {v ∈ members : K(v) ≠ staged(v)}` (04 §2.4). That is not
 * an upper bound: `conform` splices pins and repairs legality without
 * searching, and the members that already agree with `K` need no pin, so the
 * set is EXACT and the count is rendered before the press with no `≤`.
 * `minimalPinSet` is refused and is never asked for.
 *
 * THE REACTIVE POLICY — additive uncertainty is staged; subtractive certainty
 * is applied. A widen (a peer unlocks; the cluster gains a variable) holds
 * behind a banner on a deadline-scaled timer, suspended while the drill panel
 * is open and queued behind an in-flight lock, with the old list struck
 * through and NEVER blanked. A narrow applies at once with a footer note.
 */

import type {
  BoundedUnit,
  CellIndex,
  ClusterView,
  CursorEvent,
  DivergenceReport,
  LensCursor,
  LensCursorState,
  LensFrame,
  LockPlan,
  Moveset,
  MovesetKey,
  MovesetMove,
  NarrowNote,
  OperatorId,
  RowTrail,
  UnitKey,
  WidenNotice,
} from '../types';

/** 04 §3 Q8: the 6 s constant became a CAP on a deadline-scaled value. */
const WIDEN_AUTO_ACCEPT_CAP_MS = 6_000;
const WIDEN_AUTO_ACCEPT_SHARE = 0.25;
/** `#3 ▲was #1` decays after two emissions (02 §1.5). */
const TRAIL_DECAY_EMISSIONS = 2;

// ---------------------------------------------------------------------------
// The gesture state: what the operator's HANDS are doing, which is a property
// of this session and not of the frame.
//
// Three facts live here because no frame can carry them: whether the drill
// panel is open (it suspends the widen timer), whether a lock is in flight
// (it queues the widen behind it), and whether the last re-resolution
// displaced the selection (it badges one row for two emissions). All three
// are set by the gestures that cause them and read by the notices that owe
// the operator an answer about them.
// ---------------------------------------------------------------------------

interface Displacement {
  readonly moveset: MovesetKey;
  readonly wasRank: number;
  readonly atSeq: number;
}

interface GestureState {
  drillOpen: boolean;
  lockInFlight: boolean;
  /** Set by `Shift+Space`, consumed by the next `planLock`. */
  lockEveryMember: boolean;
  displaced: Displacement | null;
}

const gesture: GestureState = {
  drillOpen: false,
  lockInFlight: false,
  lockEveryMember: false,
  displaced: null,
};

// ---------------------------------------------------------------------------
// Frame readers. Every one of them is a question about the frame and nothing
// else — the cursor never reaches for a websocket message or a database row.
// ---------------------------------------------------------------------------

export function clusterOf(frame: LensFrame, unit: UnitKey): ClusterView | null {
  return frame.partition.find((c) => c.members.includes(unit)) ?? null;
}

/**
 * The cluster a FIXED unit is bounding, and the bound itself — the reason it
 * is not a member and the operator who caused it. Rule E's other half: a unit
 * with a fixity is drawn and rostered and keeps its arrow, and the rail owes
 * the operator the sentence that says why the bot is not choosing its move.
 */
export function boundingOf(
  frame: LensFrame,
  unit: UnitKey
): { readonly cluster: ClusterView; readonly bound: BoundedUnit } | null {
  for (const cluster of frame.partition) {
    const found = cluster.boundedBy.find((b) => b.unit === unit);
    if (found) return { cluster, bound: found };
  }
  return null;
}

/** `${clusterId}|${unitKey}|${to}` — one list per conditional (04 §4.2). */
export function movesetListKey(cluster: number, unit: UnitKey, to: CellIndex): string {
  return `${cluster}|${unit}|${to}`;
}

/** The reservoir's own entry for a cluster: `String(clusterId)`, the key the
 *  `movesets` frame folds under (`store::reservoirKey`). */
export function reservoirListKey(cluster: number): string {
  return String(cluster);
}

/**
 * The rows behind one `(unit, candidate)`, in the order the reservoir ranked
 * them.
 *
 * THE CONDITIONAL LIST FIRST. `L(C, u↦m)` is the exact answer to *"what would
 * a lock here stage"*, and where the kernel has answered one it is the list.
 *
 * FAILING THAT, THE CLUSTER'S OWN RETAINED ROWS, restricted to the ones that
 * play `m` for `u`. That restriction is a SELECTION over rows the search
 * really priced — not a ranking nobody computed — and without it the panel is
 * empty exactly when nobody asked a conditional, which on the measured runs is
 * every bot-only decision there has ever been (07 §1: zero conditional frames
 * in 180 decisions). A replayed turn was drawing an empty table while the
 * frame it was drawing from held the rows.
 */
export function rowsFor(
  frame: LensFrame,
  unit: UnitKey | null,
  to: CellIndex | null
): ReadonlyArray<Moveset> {
  if (unit === null || to === null) return [];
  const cluster = clusterOf(frame, unit);
  if (cluster === null) return [];
  const conditional = frame.movesets[movesetListKey(cluster.id, unit, to)];
  if (conditional !== undefined) return conditional;
  const retained = frame.movesets[reservoirListKey(cluster.id)] ?? [];
  return retained.filter((row) => row.moves.some((m) => m.unit === unit && m.to === to));
}

export function rankOne(rows: ReadonlyArray<Moveset>): Moveset | null {
  return rows.reduce<Moveset | null>(
    (best, row) => (best === null || row.rank < best.rank ? row : best),
    null
  );
}

function hasCandidate(frame: LensFrame, unit: UnitKey, to: CellIndex): boolean {
  return (frame.candidates[unit] ?? []).some((c) => c.to === to && c.legal);
}

/** The cell a unit is STAGED at right now — the constant `K(v) ≠ staged(v)`
 *  is measured against, and the default candidate. `staged` keeps its shipped
 *  shape (02 §2.3), so it is read defensively and never re-declared. */
export function stagedCellOf(frame: LensFrame, unit: UnitKey): CellIndex | null {
  const view = frame.staged[unit] as { to?: unknown } | undefined;
  return typeof view?.to === 'number' ? view.to : null;
}

/** Law D's candidate default: the unit's incumbent — what the bot has staged
 *  for it right now — falling to its first legal candidate when nothing is
 *  staged yet, and to null when the unit has no candidates at all (dead,
 *  committed, foreign), which is the one terminal `UNIT` state. */
export function incumbentCandidate(frame: LensFrame, unit: UnitKey): CellIndex | null {
  const all = frame.candidates[unit] ?? [];
  const legal = all.filter((c) => c.legal);
  const pool = legal.length > 0 ? legal : all;
  if (pool.length === 0) return null;
  const staged = stagedCellOf(frame, unit);
  if (staged !== null && pool.some((c) => c.to === staged)) return staged;
  return pool[0]?.to ?? null;
}

// ---------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------

export function initialCursor(): LensCursor {
  return {
    unit: null,
    candidate: null,
    moveset: null,
    drill: null,
    foil: 'off',
    explicit: { candidate: false, moveset: false, drill: false },
  };
}

/** Named by the deepest non-null level. `MOVESET` is `CANDIDATE` with the
 *  drill collapsed; they are one state and are separated only so the
 *  transition table can name the drill. */
export function cursorState(cursor: LensCursor): LensCursorState {
  if (cursor.unit === null) return 'NONE';
  if (cursor.candidate === null) return 'UNIT';
  if (cursor.moveset === null) return 'CANDIDATE';
  if (cursor.drill === null) return 'MOVESET';
  return 'BREAKDOWN';
}

/**
 * LAW D, as one function. Given a cursor whose `explicit` flags say what the
 * operator chose, fill every other level from the frame — and demote a level
 * whose choice the frame no longer offers, so `explicit` is always the truth
 * about what is still a choice rather than a memory of one.
 */
function settle(frame: LensFrame, base: LensCursor): LensCursor {
  const unit = base.unit;
  if (unit === null) return { ...initialCursor(), foil: base.foil };

  const keptCandidate =
    base.explicit.candidate && base.candidate !== null && hasCandidate(frame, unit, base.candidate)
      ? base.candidate
      : null;
  const candidate = keptCandidate ?? incumbentCandidate(frame, unit);

  const rows = rowsFor(frame, unit, candidate);
  const keptMoveset =
    base.explicit.moveset && base.moveset !== null && rows.some((r) => r.key === base.moveset)
      ? base.moveset
      : null;
  const moveset = keptMoveset ?? rankOne(rows)?.key ?? null;

  const members = clusterOf(frame, unit)?.members ?? [];
  const keptDrill =
    base.explicit.drill && base.drill !== null && moveset !== null && members.includes(base.drill)
      ? base.drill
      : null;

  return {
    unit,
    candidate,
    moveset,
    drill: keptDrill,
    foil: base.foil,
    explicit: {
      candidate: keptCandidate !== null,
      moveset: keptMoveset !== null,
      drill: keptDrill !== null,
    },
  };
}

const NO_CHOICES = { candidate: false, moveset: false, drill: false } as const;

/**
 * The transition table. `⟳` — re-default everything below — is `settle` with
 * the chosen level's flag set and the flags under it cleared.
 */
export function applyCursorEvent(
  cursor: LensCursor,
  frame: LensFrame,
  event: CursorEvent
): LensCursor {
  const next = transition(cursor, frame, event);
  gesture.drillOpen = next.drill !== null;
  return next;
}

function transition(cursor: LensCursor, frame: LensFrame, event: CursorEvent): LensCursor {
  switch (event.t) {
    // T1 — focus. Law D auto-advances past UNIT on the same tick.
    case 'focus':
      return settle(frame, {
        ...initialCursor(),
        unit: event.unit,
        foil: cursor.foil,
      });

    // T2 — blur.
    case 'blur':
      return initialCursor();

    // T3 — a candidate is chosen; moveset and drill re-default beneath it.
    case 'candidate':
      return settle(frame, {
        ...cursor,
        candidate: event.to,
        moveset: null,
        drill: null,
        explicit: { candidate: event.to !== null, moveset: false, drill: false },
      });

    // T4 — hover NEVER commits the cursor. The board is a place to look, and
    // a lens that re-ranks under the pointer is unusable.
    case 'candidate.hover':
      return cursor;

    // T6 — choosing a moveset does NOT touch the candidate.
    case 'moveset':
      return settle(frame, {
        ...cursor,
        moveset: event.key,
        drill: null,
        explicit: { ...cursor.explicit, moveset: true, drill: false },
      });

    // T7 — the drill toggles on the member it names.
    case 'drill': {
      const open = cursor.drill === event.unit ? null : event.unit;
      return settle(frame, {
        ...cursor,
        drill: open,
        explicit: { ...cursor.explicit, drill: open !== null },
      });
    }

    // T8 — the contrastive foil. It touches nothing else.
    case 'foil':
      return { ...cursor, foil: event.mode };

    // T9 / T10 — the two determination gestures. Neither moves the cursor:
    // the whole point is that what is staged is what is already drawn.
    case 'lock':
      gesture.lockInFlight = true;
      return cursor;
    case 'lock.moveset':
      gesture.lockInFlight = true;
      gesture.lockEveryMember = true;
      return cursor;

    // T11 — release one unit's pin. The cluster widens for everyone, so the
    // moveset list beneath the cursor is about to be a different list.
    case 'release':
      return settle(frame, {
        ...cursor,
        explicit: { ...cursor.explicit, moveset: false, drill: false },
      });

    // T12 — clear every command on the unit, and re-default everything below.
    case 'clear':
      return settle(frame, { ...cursor, explicit: { ...NO_CHOICES } });

    // T13 / T14 / T15 / T16 — the frame moves, the cursor does not. Identity
    // re-resolution against the new frame is `resolveCursor`, which the caller
    // runs when the frame it holds actually changes.
    case 'seek':
    case 'now':
    case 'emission':
    case 'partition-change':
      return cursor;

    // T17 — a turn boundary. The old board's moves are meaningless, so every
    // board-specific level clears; FOCUS SURVIVES, because an operator
    // watching one unit across turns must not have to re-click it every turn.
    case 'turn-boundary':
      gesture.lockInFlight = false;
      gesture.displaced = null;
      return { ...initialCursor(), unit: cursor.unit };
  }
}

// ---------------------------------------------------------------------------
// Lock — the one determination gesture
// ---------------------------------------------------------------------------

export class LensOffHeadError extends Error {
  constructor(seq: number) {
    super(
      `determinations are legal only from the live head; this frame is at seq ${seq}. ` +
        'Press [N] to return to now.'
    );
    this.name = 'LensOffHeadError';
  }
}

export class LensNoMovesetError extends Error {
  constructor(detail: string) {
    super(`nothing to lock: ${detail}`);
    this.name = 'LensNoMovesetError';
  }
}

function assignmentOf(row: Moveset, unit: UnitKey): CellIndex | null {
  return row.moves.find((m) => m.unit === unit)?.to ?? null;
}

/**
 * What `Space` would stage, computed client-side from the frame alone.
 *
 * Refused off the head — locking against a frame whose ordering has since
 * moved would break the display contract at exactly the moment it matters.
 * The refusal is an exception rather than a null because a caller that forgets
 * to check must not be able to issue a determination by accident.
 */
export function planLock(frame: LensFrame, cursor: LensCursor): LockPlan {
  const everyMember = gesture.lockEveryMember;
  gesture.lockEveryMember = false;

  const legal = frame.at.isHead;
  if (!legal) throw new LensOffHeadError(frame.at.seq);

  const unit = cursor.unit;
  if (unit === null) throw new LensNoMovesetError('no unit is focused');

  const rows = rowsFor(frame, unit, cursor.candidate);
  const row = rows.find((r) => r.key === cursor.moveset) ?? rankOne(rows);
  if (row === null) throw new LensNoMovesetError(`no moveset list for ${unit}`);

  const cluster = clusterOf(frame, unit);
  const members = cluster?.members ?? [unit];

  // P* = {u} ∪ {v ∈ members : K(v) ≠ staged(v)}. Shift+Space takes the whole
  // cluster unconditionally, for the operator who wants it nailed down
  // regardless of what the kernel would have inferred.
  const pinned = members.filter((v) => {
    if (everyMember || v === unit) return true;
    const to = assignmentOf(row, v);
    return to !== null && to !== stagedCellOf(frame, v);
  });

  const pins = pinned
    .map((v) => ({ unit: v, to: assignmentOf(row, v) }))
    .filter((p): p is { unit: UnitKey; to: CellIndex } => p.to !== null);

  // The ownership guard: never issue a cross-owner determination. The client
  // refuses and offers the three ways out; it does not quietly write a pin on
  // a unit someone else holds.
  const mine = frame.units.find((u) => u.unit === unit)?.owner ?? null;
  const blockedBy: Array<{ unit: UnitKey; owner: OperatorId }> = [];
  for (const pin of pins) {
    const owner = frame.units.find((u) => u.unit === pin.unit)?.owner ?? null;
    if (owner !== null && owner !== mine) blockedBy.push({ unit: pin.unit, owner });
  }

  return {
    moveset: row.key,
    pins,
    count: pins.length,
    members: members.length,
    blockedBy,
    expected: row.moves,
    emissionSeq: frame.at.seq,
  };
}

/**
 * The divergence check, which is the only reason the display contract is
 * falsifiable rather than aspirational. One comparison per emission: what the
 * operator was shown, against what the kernel went on to stage for the members
 * the lock did NOT pin.
 */
export function checkDivergence(plan: LockPlan, next: LensFrame): DivergenceReport | null {
  gesture.lockInFlight = false;
  const pinned = new Set(plan.pins.map((p) => p.unit));
  const differing = plan.expected
    .filter((m: MovesetMove) => !pinned.has(m.unit))
    .map((m: MovesetMove) => ({
      unit: m.unit,
      expected: m.to,
      actual: stagedCellOf(next, m.unit),
      why: divergenceReason(next),
    }))
    .filter(
      (d): d is { unit: UnitKey; expected: CellIndex; actual: CellIndex; why: string } =>
        d.actual !== null && d.actual !== d.expected
    );
  return differing.length === 0 ? null : { moveset: plan.moveset, differing };
}

function divergenceReason(next: LensFrame): string {
  const emission = [...next.events].reverse().find((e) => e.kind === 'emission');
  const operator = [...next.events].reverse().find((e) => e.kind === 'operator.command');
  if (operator) return `a peer command at seq ${operator.seq}`;
  if (emission) return `a later emission at seq ${emission.seq}`;
  return 'the board changed';
}

// ---------------------------------------------------------------------------
// Re-resolution: how the cursor survives new data
// ---------------------------------------------------------------------------

function restrictedAssignment(
  row: Moveset,
  members: ReadonlySet<UnitKey>
): string {
  return row.moves
    .filter((m) => members.has(m.unit))
    .map((m) => `${m.unit}@${m.to}`)
    .sort()
    .join(',');
}

function commonMembers(prev: LensFrame, next: LensFrame, unit: UnitKey): ReadonlySet<UnitKey> {
  const before = clusterOf(prev, unit)?.members ?? [];
  const after = new Set(clusterOf(next, unit)?.members ?? []);
  return new Set(before.filter((m) => after.has(m)));
}

interface Resolution {
  readonly key: MovesetKey | null;
  readonly displaced: boolean;
  readonly wasRank: number;
}

/**
 * IDENTITY, in the order of 02 §1.5, with one clause the design implies and
 * this code has to say out loud.
 *
 *   1. the same `MovesetKey` — the row is literally still there;
 *   2. the assignment, restricted to the members present in BOTH frames —
 *      but ONLY when that assignment identifies exactly one row on each side.
 *      A cluster whose top rows share an assignment over the surviving
 *      members (every widen where the new member is what varies) is not
 *      identified by its assignment at all, and pretending otherwise picks a
 *      row by accident;
 *   3. failing that, the row at the same RANK carrying that assignment — the
 *      cursor holds its place in a table it can still recognise;
 *   4. failing that, rank 1, DISPLACED — and the badge says so rather than
 *      the selection silently becoming someone else's row.
 */
function resolveMovesetIdentity(
  oldRow: Moveset | null,
  prevRows: ReadonlyArray<Moveset>,
  nextRows: ReadonlyArray<Moveset>,
  members: ReadonlySet<UnitKey>
): Resolution {
  const fallback = rankOne(nextRows)?.key ?? null;
  if (oldRow === null) return { key: fallback, displaced: false, wasRank: 0 };

  const wasRank = oldRow.rank;
  if (nextRows.some((r) => r.key === oldRow.key)) {
    return { key: oldRow.key, displaced: false, wasRank };
  }

  const want = restrictedAssignment(oldRow, members);
  const sameBefore = prevRows.filter((r) => restrictedAssignment(r, members) === want);
  const sameAfter = nextRows.filter((r) => restrictedAssignment(r, members) === want);

  if (sameBefore.length === 1 && sameAfter.length === 1) {
    return { key: (sameAfter[0] as Moveset).key, displaced: false, wasRank };
  }

  const atRank = sameAfter.find((r) => r.rank === wasRank);
  if (atRank) return { key: atRank.key, displaced: false, wasRank };

  return { key: fallback, displaced: fallback !== null, wasRank };
}

/**
 * §1.5. NOTHING UNDER THE OPERATOR'S CURSOR EVER RE-ORDERS ITSELF. Every
 * incoming emission and every seek replaces the frame; the cursor is
 * re-resolved by identity against it, never replaced with it.
 */
export function resolveCursor(
  cursor: LensCursor,
  prev: LensFrame,
  next: LensFrame
): LensCursor {
  const unit = cursor.unit;
  if (unit === null) return cursor;

  const candidateSurvives =
    cursor.candidate !== null && hasCandidate(next, unit, cursor.candidate);
  const candidate = candidateSurvives ? cursor.candidate : incumbentCandidate(next, unit);

  const prevRows = rowsFor(prev, unit, cursor.candidate);
  const nextRows = rowsFor(next, unit, candidate);
  const oldRow = prevRows.find((r) => r.key === cursor.moveset) ?? null;
  const resolved = resolveMovesetIdentity(
    oldRow,
    prevRows,
    nextRows,
    commonMembers(prev, next, unit)
  );

  gesture.displaced =
    resolved.displaced && resolved.key !== null
      ? { moveset: resolved.key, wasRank: resolved.wasRank, atSeq: next.at.seq }
      : null;

  return settle(next, {
    ...cursor,
    candidate,
    moveset: resolved.key,
    explicit: {
      candidate: cursor.explicit.candidate && candidateSurvives,
      moveset: cursor.explicit.moveset && resolved.key !== null,
      drill: cursor.explicit.drill,
    },
  });
}

/**
 * The rank trail on every row that has a predecessor in the previous frame —
 * `#3 ▲was #1` — plus the displaced badge on the row a re-resolution had to
 * fall to. Trails decay after two emissions; a trail older than that is not
 * drawn faintly, it is not drawn.
 */
export function rowTrails(
  prev: LensFrame,
  next: LensFrame,
  cursor: LensCursor
): ReadonlyArray<RowTrail> {
  const unit = cursor.unit;
  if (unit === null) return [];

  const emissionsAgo = Math.max(0, next.at.seq - prev.at.seq);
  if (emissionsAgo > TRAIL_DECAY_EMISSIONS) return [];

  const candidate = hasCandidate(next, unit, cursor.candidate ?? -1)
    ? cursor.candidate
    : incumbentCandidate(next, unit);
  const prevRows = rowsFor(prev, unit, cursor.candidate ?? candidate);
  const nextRows = rowsFor(next, unit, candidate);
  const members = commonMembers(prev, next, unit);

  const trails: RowTrail[] = nextRows.flatMap((row) => {
    const wasRank = predecessorRank(row, prevRows, members);
    return wasRank === null
      ? []
      : [{ moveset: row.key, wasRank, rank: row.rank, emissionsAgo, displaced: false }];
  });

  // The displaced badge belongs to the row the selection FELL TO, and it
  // replaces that row's ordinary trail rather than sitting beside it: one row,
  // one story.
  const displaced = gesture.displaced;
  const fresh = displaced !== null && next.at.seq - displaced.atSeq <= TRAIL_DECAY_EMISSIONS;
  if (displaced === null || !fresh) return trails;

  const row = nextRows.find((r) => r.key === displaced.moveset);
  if (row === undefined) return trails;
  const badge: RowTrail = {
    moveset: row.key,
    wasRank: displaced.wasRank,
    rank: row.rank,
    emissionsAgo,
    displaced: true,
  };
  return [...trails.filter((t) => t.moveset !== row.key), badge];
}

function predecessorRank(
  row: Moveset,
  prevRows: ReadonlyArray<Moveset>,
  members: ReadonlySet<UnitKey>
): number | null {
  const byKey = prevRows.find((r) => r.key === row.key);
  if (byKey) return byKey.rank;
  const want = restrictedAssignment(row, members);
  const same = prevRows.filter((r) => restrictedAssignment(r, members) === want);
  if (same.length === 1) return (same[0] as Moveset).rank;
  const atRank = same.find((r) => r.rank === row.rank);
  return atRank?.rank ?? null;
}

// ---------------------------------------------------------------------------
// The reactive case
// ---------------------------------------------------------------------------

/** The turn's deadline, read from the fold's own t0 anchor. */
function turnExpiryOf(frame: LensFrame): number | null {
  const anchor = frame.events.find((e) => e.kind === 'board.arrived');
  const payload = anchor?.payload as { turnExpiryTime?: unknown } | undefined;
  return typeof payload?.turnExpiryTime === 'number' ? payload.turnExpiryTime : null;
}

/**
 * `min(6 s, 0.25 × (turnExpiryTime − now))` (04 §3 Q8): the constant is a CAP
 * on a deadline-scaled value, because a six-second banner on a turn with two
 * seconds left is a banner that expires after the turn does.
 */
export function widenAutoAcceptMs(frame: LensFrame): number {
  const expiry = turnExpiryOf(frame);
  if (expiry === null) return WIDEN_AUTO_ACCEPT_CAP_MS;
  const remaining = expiry - frame.at.tWall;
  return Math.max(0, Math.min(WIDEN_AUTO_ACCEPT_CAP_MS, Math.round(WIDEN_AUTO_ACCEPT_SHARE * remaining)));
}

/**
 * ADDITIVE UNCERTAINTY IS STAGED; SUBTRACTIVE CERTAINTY IS APPLIED.
 *
 * A widen is the disorienting direction — new variables, new movesets,
 * possibly a different rank 1 — so it waits behind one gesture. A narrow is
 * the calm one: every surviving moveset is still a valid picture of a smaller
 * problem, so it lands at once with a footer note and no timer.
 */
export function reactiveNotice(
  prev: LensFrame,
  next: LensFrame
): WidenNotice | NarrowNote | null {
  for (const before of prev.partition) {
    const after = successorOf(before, next);
    if (after === undefined) continue;

    const gained = after.members.filter((m) => !before.members.includes(m));
    if (gained.length > 0) {
      return {
        cluster: before.id,
        fromGeneration: before.generation,
        toGeneration: after.generation,
        gained,
        by: attributionFor(before.boundedBy, gained),
        // What the cluster WAS. The banner adds the gained members to it, so
        // "cluster α is now 4 units" is arithmetic the reader can check
        // against the two halves of the same sentence.
        members: before.members.length,
        autoAcceptMs: widenAutoAcceptMs(next),
        suspended: gesture.drillOpen,
        queuedBehindLock: gesture.lockInFlight,
        staleAtSeq: prev.at.seq,
      };
    }

    const lost = before.members.filter((m) => !after.members.includes(m));
    if (lost.length > 0) {
      const bound = after.boundedBy.find((b) => lost.includes(b.unit));
      return {
        cluster: before.id,
        lost,
        // A unit leaves a cluster because somebody FIXED it — and also because
        // it died, or resolved, or is simply not on the board any more. Only
        // the first of those has a reason and an author in `boundedBy`, and
        // naming the others `pin` would attribute a determination nobody made.
        why: bound?.why ?? 'gone',
        by: bound?.by ?? null,
      };
    }
  }
  return null;
}

/**
 * The cluster `before` BECAME, which is not always the cluster with the same
 * id: a `ClusterId` is the smallest member's unit id (`kernel/partition.ts`),
 * so a released unit that sorts below the anchor RENAMES the cluster it joins.
 * Matching on the id alone missed every such widen — the owner's own reactive
 * case, silently undrawn about half the time. `lineage` is the field that
 * survives it and is why the kernel mints it.
 */
function successorOf(before: ClusterView, next: LensFrame): ClusterView | undefined {
  const sameId = next.partition.find((c) => c.id === before.id);
  if (sameId !== undefined) return sameId;
  return next.partition.find((c) => c.lineage.includes(before.id));
}

/** Who caused the widen: the operator whose fixity the gained unit just lost. */
function attributionFor(
  boundedBy: ReadonlyArray<BoundedUnit>,
  gained: ReadonlyArray<UnitKey>
): OperatorId | null {
  return boundedBy.find((b) => gained.includes(b.unit))?.by ?? null;
}
