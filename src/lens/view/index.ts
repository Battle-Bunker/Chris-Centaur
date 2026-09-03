/**
 * THE REDUCER'S CONSUMER — one view-model, two sources, one transcript.
 *
 * `LensFrame` in, draw transcript out. Everything the operator sees is a pure
 * function of the frame the reducer folded, and the frame is a pure fold of
 * the turn's events, so live play and replay are the same state machine over
 * the same event type rather than two code paths that happen to agree.
 *
 * NO FUNCTION HERE BRANCHES ON THE VIEW MODE, and `lens-view-model.test.ts`
 * asserts that structurally against this file's own source, because a
 * behavioural test only catches the branches a fixture happens to walk. The
 * ~900-line live/replay fork this module replaces had already drifted in
 * production — its two empty states differed and nothing noticed. What is
 * legitimately different between the two sources is CONTENT: which side
 * handed the events over, whether determinations are legal, and where a
 * derived number came from. All three are rendered as badges, by the badge
 * component at the bottom of this file, and never as a branch.
 *
 * The cursor machine, the lock and the reactive policy live in `./cursor.ts`
 * and are re-exported here so the whole U surface has one import path.
 */

import { frameAt } from '../store';
import {
  clusterOf,
  incumbentCandidate,
  initialCursor,
  rankOne,
  rowsFor,
  stagedCellOf,
} from './cursor';
import type {
  CandidateRow,
  ConditionalHandle,
  ConditionalRequest,
  Cursor,
  DecisionSource,
  DrawCall,
  DrawTranscript,
  FrameStore,
  LensCursor,
  LensFrame,
  LensRefusal,
  LensRefusalReason,
  Moveset,
  MovesetBreakdown,
  MovesetKey,
  Provenanced,
  RequestId,
  SourceDelta,
  TurnEvent,
  TurnEventKind,
  UnitKey,
} from '../types';

export * from './cursor';

// ---------------------------------------------------------------------------
// The two sources
// ---------------------------------------------------------------------------

/**
 * The transport a LIVE source asks its two questions through: the conditional
 * ranking behind a candidate, and the breakdown behind a row. Both are served
 * out of the kernel's declared inspection reserve, so both can be REFUSED —
 * and a refusal comes back typed, on the same channel, never as silence.
 *
 * Absent ⇒ the source still folds, still frames, still draws. It simply has
 * nothing to ask with, which it says in words.
 */
export interface LensTransport {
  conditional(req: ConditionalRequest): Promise<ConditionalHandle | LensRefusal>;
  breakdown(
    moveset: MovesetKey,
    members?: ReadonlyArray<UnitKey>
  ): Promise<Provenanced<MovesetBreakdown> | LensRefusal>;
  cancel?(requestId: RequestId): void;
}

export interface LiveSourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
  readonly isHead: boolean;
  readonly transport?: LensTransport;
}

export interface ReplaySourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
}

/** The one legitimate difference, as data. A live cursor dragged back off the
 *  head is SCRUBBING — loud, and with determinations disabled — which is a
 *  different thing from reading a finished game. */
const LIVE_MODE = { true: 'live-head', false: 'live-scrub' } as const;

function refuse(reason: LensRefusalReason, detail: string): LensRefusal {
  return { ok: false, refusal: reason, detail };
}

function headSeqOf(store: FrameStore): number {
  return store.events.reduce((max, e) => Math.max(max, e.seq), store.anchor.seq);
}

function subscribers(): {
  add: (fn: (d: SourceDelta) => void) => () => void;
  emit: (d: SourceDelta) => void;
} {
  const fns = new Set<(d: SourceDelta) => void>();
  return {
    add: (fn) => {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
    emit: (d) => {
      for (const fn of fns) fn(d);
    },
  };
}

/**
 * LIVE. Maps the websocket's `lens-frames` events into the store through the
 * reducer and hands out frames at whatever `seq` this connection's cursor sits
 * on — which is per CONNECTION, so a second operator scrubbing does not move
 * anyone else's playhead.
 */
export function makeLiveDecisionSource(input: LiveSourceInput): DecisionSource {
  let store = input.store;
  let at: Cursor = input.at;
  const listeners = subscribers();

  const source: DecisionSource = {
    kind: 'live',
    get at(): Cursor {
      return at;
    },
    seek(to: Cursor): void {
      at = to;
      listeners.emit({ kind: 'cursor', at: to });
    },
    frame(): LensFrame {
      const head = input.isHead && at.seq >= headSeqOf(store);
      const base = frameAt(store, at.seq);
      return {
        ...base,
        at: { ...base.at, ...at, mode: LIVE_MODE[`${head}`], isHead: head },
      };
    },
    timeline(): ReadonlyArray<TurnEvent> {
      return store.events.filter((e) => e.seq <= at.seq);
    },
    breakdown(moveset: MovesetKey): Promise<Provenanced<MovesetBreakdown> | LensRefusal> {
      const transport = input.transport;
      return transport === undefined
        ? Promise.resolve(refuse('unknown-cluster', 'no inspection transport is attached'))
        : transport.breakdown(moveset);
    },
    conditional(req: ConditionalRequest): Promise<ConditionalHandle | LensRefusal> {
      const transport = input.transport;
      return transport === undefined
        ? Promise.resolve(refuse('unknown-cluster', 'no inspection transport is attached'))
        : transport.conditional(req);
    },
    subscribe(fn: (d: SourceDelta) => void): () => void {
      return listeners.add(fn);
    },
  };

  /** The wire's own events, folded by THE SAME reducer replay folds with. */
  (source as { ingest?: (events: ReadonlyArray<TurnEvent>) => void }).ingest = (
    events: ReadonlyArray<TurnEvent>
  ): void => {
    for (const event of events) {
      store = { ...store, events: [...store.events, event] };
      listeners.emit({ kind: 'event', event });
    }
  };

  return source;
}

/**
 * REPLAY. Reads the persisted rows and calls THE SAME `applyEvent` with the
 * same objects; the only things it does differently are hand the events over
 * from Postgres instead of a socket, and answer that determinations are not
 * legal here. Its breakdowns come out of the frame the fold already produced,
 * so a drilled row in replay is the row the operator drilled live.
 */
export function makeReplayDecisionSource(input: ReplaySourceInput): DecisionSource {
  let at: Cursor = input.at;
  const listeners = subscribers();

  return {
    kind: 'replay',
    get at(): Cursor {
      return at;
    },
    seek(to: Cursor): void {
      at = to;
      listeners.emit({ kind: 'cursor', at: to });
    },
    frame(): LensFrame {
      const base = frameAt(input.store, at.seq);
      return { ...base, at: { ...base.at, ...at, mode: 'replay', isHead: false } };
    },
    timeline(): ReadonlyArray<TurnEvent> {
      return input.store.events.filter((e) => e.seq <= at.seq);
    },
    breakdown(moveset: MovesetKey): Promise<Provenanced<MovesetBreakdown> | LensRefusal> {
      const frame = frameAt(input.store, at.seq);
      const stored = frame.breakdown[moveset];
      return Promise.resolve(
        stored === undefined
          ? refuse('unknown-cluster', `no breakdown was retained for ${moveset}`)
          : {
              value: stored,
              basis: stored.basis,
              provenance: { kind: 'observed' as const, at },
            }
      );
    },
    conditional(_req: ConditionalRequest): Promise<ConditionalHandle | LensRefusal> {
      return Promise.resolve(
        refuse('off-head', 'a conditional ranking is a question for a running decision')
      );
    },
    subscribe(fn: (d: SourceDelta) => void): () => void {
      return listeners.add(fn);
    },
  };
}

export function requestConditional(
  source: DecisionSource,
  req: ConditionalRequest
): Promise<ConditionalHandle | LensRefusal> {
  return source.conditional(req);
}

export function requestBreakdown(
  source: DecisionSource,
  moveset: MovesetKey
): Promise<Provenanced<MovesetBreakdown> | LensRefusal> {
  return source.breakdown(moveset);
}

// ---------------------------------------------------------------------------
// The ink
//
// ONE RULE: violet means hypothetical. Nothing else on the board is violet
// today and nothing else may become violet. Shape carries the meaning and
// colour only reinforces it — filled / hollow / dotted separate cursor,
// implied and foil with the hues collapsed — so the vocabulary survives a
// deuteranope reader and a dark board equally.
// ---------------------------------------------------------------------------

export const LENS_INK = {
  lens: { light: '#7B4FE0', dark: '#B39DFF' },
  lensWash: { light: 'rgba(123,79,224,.07)', dark: 'rgba(179,157,255,.12)' },
  foil: { light: '#00897B', dark: '#4DB6AC' },
  fixed: { light: '#6B6B6B', dark: '#9A9A9A' },
  refuter: { light: '#D84315', dark: '#FF8A65' },
} as const;

/** α β γ … — a cluster's name on the board, stable within a partition. */
const CLUSTER_GLYPHS = 'αβγδεζηθικλμν';

export function clusterGlyph(index: number): string {
  return CLUSTER_GLYPHS[index] ?? `c${index}`;
}

function call(op: string, ...args: ReadonlyArray<unknown>): DrawCall {
  return { op, args };
}

// ---------------------------------------------------------------------------
// The depth cell (06 §2.2)
//
// The absence of depth is DRAWN, never omitted — the same rule as Law A's
// zero residual. On today's build every row reads `h1 ·`, which is the honest
// display of a bot that does not look ahead, and the day one row reads `h2`
// the operator will see it arrive rather than have to be told.
// ---------------------------------------------------------------------------

export interface DepthCell {
  readonly label: string;
  readonly width: number;
  readonly marks: ReadonlyArray<string>;
  readonly delta: number | null;
  readonly sorted: boolean;
}

export function depthCell(row: Moveset): DepthCell {
  const { h1, deepest, delta, confidence, terminal } = row.depth;
  const deepened = deepest.horizon > h1.horizon;
  const narrowed = deepest.basis !== h1.basis;
  const marks: string[] = [];
  if (delta.lo > 0) marks.push('▲');
  if (delta.hi < 0) marks.push('▽');
  if (delta.rank !== 0) marks.push('◂');
  if (confidence === 'incomparable') marks.push('↕');
  if (narrowed) marks.push('✂');
  if (terminal !== 'none') marks.push('⊤');
  return {
    label: `h${deepest.horizon}`,
    width: Number((deepest.hi - deepest.lo).toFixed(2)),
    marks: marks.length > 0 || deepened ? marks : ['·'],
    delta: deepened ? Number((delta.lo !== 0 ? delta.lo : delta.hi).toFixed(2)) : null,
    // A declared narrowing means `compareFloors` refuses: the row is present
    // and is NOT sorted against the others.
    sorted: !narrowed,
  };
}

/** 06 §4.2: depth is not an event. It is one predicate over two frames, and
 *  the timeline draws it as a badge on the kernel tick that carried it. */
export function depthArrivals(prev: LensFrame, next: LensFrame): ReadonlyArray<MovesetKey> {
  const before = new Map<MovesetKey, number>();
  for (const rows of Object.values(prev.movesets)) {
    for (const row of rows) before.set(row.key, row.depth.deepest.horizon);
  }
  const arrived: MovesetKey[] = [];
  for (const rows of Object.values(next.movesets)) {
    for (const row of rows) {
      const was = before.get(row.key);
      if (was !== undefined && row.depth.deepest.horizon > was) arrived.push(row.key);
    }
  }
  return arrived;
}

// ---------------------------------------------------------------------------
// The four panels and the board, as one transcript
// ---------------------------------------------------------------------------

function selectedRow(frame: LensFrame, cursor: LensCursor): Moveset | null {
  const rows = rowsFor(frame, cursor.unit, cursor.candidate);
  return rows.find((r) => r.key === cursor.moveset) ?? rankOne(rows);
}

function foilRow(frame: LensFrame, cursor: LensCursor, selected: Moveset | null): Moveset | null {
  if (selected === null) return null;
  const rows = rowsFor(frame, cursor.unit, cursor.candidate);
  return rows.filter((r) => r.key !== selected.key).sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/** The emptiness the frame actually has, in words. Not "no data": the honest
 *  sentence names what HAS happened and at which seq, which is a different
 *  and much more useful thing to read. */
export function emptyStateLine(frame: LensFrame): string {
  const emissions = frame.events.filter((e) => e.kind === 'emission').length;
  const fastpass = frame.events.some((e) => e.kind === 'stage.fastpass');
  const staged = fastpass ? 'fast-pass only' : 'nothing staged yet';
  return `${staged} — no kernel emission yet at seq ${frame.at.seq}` + (emissions > 0 ? '' : '');
}

function boardOps(frame: LensFrame, cursor: LensCursor, selected: Moveset | null): DrawCall[] {
  const ops: DrawCall[] = [];
  const board = frame.board.board;
  ops.push(call('board', frame.at.turn, board.width, board.height));

  // Cluster chips on every member, padlock chips on every bounded unit. That
  // is the exclusion, drawn: if a unit carries a cluster chip the bot is still
  // choosing its move, full stop.
  frame.partition.forEach((cluster, index) => {
    const glyph = clusterGlyph(index);
    for (const member of cluster.members) ops.push(call('cluster.chip', member, glyph, cluster.id));
    for (const bound of cluster.boundedBy) {
      ops.push(call('fixed.chip', bound.unit, bound.why, bound.by, bound.to));
    }
  });

  const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
  if (cluster !== null) {
    // Tethers from each member's head to the cluster centroid: a four-unit
    // cluster reads instantly as a constellation, and nothing else on the
    // board radiates thin line-art from heads. Never to an excluded unit.
    for (const member of cluster.members) ops.push(call('cluster.tether', cluster.id, member));
    ops.push(call('cluster.wash', cluster.id, cluster.members));
  }

  if (selected !== null && cursor.unit !== null) {
    // ONLY DISAGREEMENT DRAWS. The focused unit's candidate is a filled violet
    // arrow; a member whose implied move differs from what is staged gets a
    // hollow one that overlaps the staged arrow legibly instead of hiding it;
    // a member that agrees gets a ring on the existing arrowhead. In the
    // common case the board gains a constellation and one heavier arrow, and
    // walking down the list lights the disagreements up one by one.
    for (const move of selected.moves) {
      const agrees = stagedCellOf(frame, move.unit) === move.to;
      const focused = move.unit === cursor.unit;
      ops.push(
        focused
          ? call('moveset.arrow', move.unit, move.to, 'filled')
          : agrees
            ? call('moveset.ring', move.unit, move.to)
            : call('moveset.arrow', move.unit, move.to, 'hollow')
      );
    }
  }

  const foil = foilRow(frame, cursor, selected);
  if (foil !== null && selected !== null && cursor.foil !== 'off') {
    // The foil draws where it DIFFERS and nowhere else: two movesets that
    // differ in one unit produce exactly one teal arrow and one Δ badge,
    // which is the picture of the decision.
    for (const move of foil.moves) {
      const same = selected.moves.find((m) => m.unit === move.unit)?.to === move.to;
      if (!same) {
        ops.push(call('foil.arrow', move.unit, move.to));
        ops.push(call('foil.delta', move.unit, Number((foil.lo - selected.lo).toFixed(2))));
      }
    }
  }

  return ops;
}

function candidateOps(frame: LensFrame, cursor: LensCursor): DrawCall[] {
  if (cursor.unit === null) return [];
  const rows: ReadonlyArray<CandidateRow> = frame.candidates[cursor.unit] ?? [];
  const incumbent = incumbentCandidate(frame, cursor.unit);
  return [
    call('panel.candidates', rows.length, 'scored as best-of-cluster'),
    ...rows.map((row) =>
      call(
        'panel.candidates.row',
        row.to,
        row.legal,
        // A candidate whose conditional list was never computed shows a GRADE
        // and never a bare number: `~` estimated, `·` unpriced. Pricing every
        // candidate is one queen at 6.4x a whole decision, so the rail grades
        // instead of guessing.
        row.conditionalBest === null ? null : row.conditionalBest.aggregate,
        row.conditionalBest === null ? '·' : row.conditionalBest.grade === 'exact' ? '' : '~',
        row.disposition,
        row.to === incumbent,
        row.to === cursor.candidate
      )
    ),
  ];
}

function movesetOps(
  frame: LensFrame,
  cursor: LensCursor,
  selected: Moveset | null
): DrawCall[] {
  const rows = rowsFor(frame, cursor.unit, cursor.candidate);
  if (rows.length === 0) return [call('panel.movesets.empty', emptyStateLine(frame))];

  const leader = rankOne(rows);
  const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
  const ops: DrawCall[] = [
    call(
      'panel.movesets',
      cluster?.id ?? null,
      cluster === null ? 0 : cluster.members.length,
      cluster === null ? 0 : cluster.boundedBy.length,
      frame.at.seq,
      // A stale complement is a row whose QUESTION changed while its answer
      // stayed sound. It is struck through and headed, never dropped.
      rows.some((r) => r.complement === 'stale')
    ),
  ];

  for (const row of rows) {
    const cell = depthCell(row);
    ops.push(
      call(
        'panel.movesets.row',
        row.rank,
        row.channel === 'lo' ? row.lo : row.est,
        Number((row.hi - row.lo).toFixed(2)),
        cell,
        leader === null ? 0 : Number((row.lo - leader.lo).toFixed(2)),
        row.moves.map((m) => `${m.unit}→${m.to}`),
        row.complement,
        row.key === selected?.key,
        row.staged
      )
    );
  }

  // The constants strip. A fixed unit keeps its staged arrow and its place in
  // the plan; it is not a member, and the row says who fixed it.
  for (const bound of cluster?.boundedBy ?? []) {
    ops.push(call('panel.movesets.fixed', bound.unit, bound.to, bound.why, bound.by));
  }

  const foil = foilRow(frame, cursor, selected);
  if (foil !== null && selected !== null) {
    ops.push(
      call(
        'panel.foil',
        foil.rank,
        Number((selected.lo - foil.lo).toFixed(2)),
        decidingRung(selected, foil),
        depthCell(foil).label
      )
    );
  }

  return ops;
}

/**
 * WHY this row is not the leader, taken from `better()`'s own branch read
 * backwards. When the deciding rung is a TIE rather than a term, the line
 * changes to the ask form: the proof rungs are silent and the operator's call
 * beats a salted coin-flip, which is the one place the lens actively asks for
 * attention.
 */
function decidingRung(selected: Moveset, foil: Moveset): string {
  const dominance = foil.dominance ?? selected.dominance;
  if (dominance === null) return 'unsealed — the barrier has not run';
  switch (dominance.kind) {
    case 'leader':
      return 'leads on the proved floor';
    case 'refuted-by-witness':
      return 'refuted by a witness';
    case 'incomparable-basis':
      return 'incomparable basis — not sorted against this row';
    case 'contingent':
      return `contingent on ${dominance.onUnits.join(', ')} (${dominance.atStake} at stake)`;
    case 'dominated':
      return `dominated by ${dominance.by}`;
    case 'advisory-only':
      return `floors equal — advisory margin ${dominance.estMargin}`;
    case 'indifferent':
      return 'my proof rungs are silent here — your call beats my tie-break';
  }
}

function breakdownOps(frame: LensFrame, cursor: LensCursor, selected: Moveset | null): DrawCall[] {
  if (selected === null) return [];
  const breakdown = frame.breakdown[selected.key];
  if (breakdown === undefined) {
    return [call('panel.breakdown.pending', selected.key, '[B] to price this row')];
  }

  const ops: DrawCall[] = [
    call(
      'panel.breakdown',
      selected.key,
      // An evaluator that does not explain is NOT an error state. The panel
      // says so in words rather than drawing thirty zero rows, which is the
      // lesson the deleted per-unit table paid for.
      breakdown.aggregate === null ? 'this evaluator does not explain' : breakdown.aggregate.profile
    ),
  ];

  for (const marginal of breakdown.marginals) {
    ops.push(
      call(
        'panel.breakdown.member',
        marginal.unit,
        marginal.delta,
        marginal.against.to,
        marginal.unit === cursor.drill
          ? marginal.features.map((f) => [f.key, f.delta])
          : marginal.features.slice(0, 2).map((f) => [f.key, f.delta])
      )
    );
  }

  // THE JOINT ROW IS MANDATORY, and it is drawn at zero. A cluster exists
  // because of cross terms; presenting the aggregate as the sum of per-unit
  // contributions when it is not is the exact dishonesty the old table had,
  // and omitting a zero residual and omitting a large one are the same bug.
  ops.push(
    call(
      'panel.breakdown.residual',
      breakdown.residual.total,
      breakdown.residual.features.map((f) => [f.key, f.delta]),
      '[why?]'
    )
  );
  return ops;
}

const LANE_OF: Readonly<Record<TurnEventKind, string>> = {
  partition: 'kernel',
  movesets: 'kernel',
  emission: 'kernel',
  operator: 'operator',
  posture: 'kernel',
  conditional: 'kernel',
  refusal: 'kernel',
  'board.arrived': 'anchor',
  'stage.fastpass': 'kernel',
  'decision.begin': 'kernel',
  'decision.end': 'kernel',
  'operator.command': 'operator',
  pin: 'operator',
  unpin: 'operator',
  commit: 'operator',
  'pin.refused': 'operator',
  'stage.requested': 'staging',
  'stage.confirmed': 'staging',
  'stage.retry': 'staging',
  'commit.observed': 'staging',
  advice: 'advice',
  selection: 'operator',
  'turn.resolved': 'anchor',
};

/**
 * The lane strip under the board: `board.arrival → deadline`, one tick per
 * event, snapped to events rather than to pixels — a frame between two events
 * is the earlier event's frame. Attention ticks are hollow and are hidden
 * unless the lane is expanded: they are numerous, low-grade, and they fund
 * compute, so they are logged and not thrown in the operator's face.
 */
export function renderTimeline(events: ReadonlyArray<TurnEvent>): DrawTranscript {
  const ops: DrawCall[] = [call('timeline', events.length)];
  for (const event of events) {
    const hover = (event.payload as { hover?: unknown } | undefined)?.hover === true;
    ops.push(
      call(
        'timeline.tick',
        LANE_OF[event.kind] ?? 'operator',
        event.seq,
        event.atWorkMs,
        event.kind,
        event.actor.id,
        event.actor.color,
        hover ? 'hollow' : 'solid'
      )
    );
  }
  return ops;
}

/**
 * THE WHOLE SURFACE, as a transcript of draw calls: the board's ink, the four
 * panels, the timeline lane and the footers. It reads the frame and the
 * cursor and nothing else — no websocket message, no database row, no
 * live-versus-replay flag — which is what makes two sources produce one
 * picture.
 */
export function renderFrame(frame: LensFrame, cursor: LensCursor = initialCursor()): DrawTranscript {
  const selected = selectedRow(frame, cursor);
  const ops: DrawCall[] = [call('frame', frame.at.turn, frame.at.seq, frame.at.tMono)];

  ops.push(...boardOps(frame, cursor, selected));

  ops.push(call('panel.advice', frame.advice.length));

  if (cursor.unit !== null) {
    const row = frame.units.find((u) => u.unit === cursor.unit);
    const cluster = clusterOf(frame, cursor.unit);
    ops.push(
      call(
        'panel.focus',
        cursor.unit,
        row?.kind ?? null,
        row?.letter ?? null,
        row?.health ?? null,
        row?.weight ?? null,
        row?.fixity ?? null,
        cluster?.id ?? null,
        cluster?.members.length ?? 0,
        // "Locking narrows" is the word, everywhere: the header counts what is
        // still free, and a lock moves a unit into the bounded strip.
        cluster === null ? null : `${cluster.members.length} of ${cluster.members.length + cluster.boundedBy.length} free`
      )
    );
  }

  ops.push(...candidateOps(frame, cursor));
  ops.push(...movesetOps(frame, cursor, selected));
  ops.push(...breakdownOps(frame, cursor, selected));
  ops.push(...renderTimeline(frame.events));

  // The determination affordance. Its LABEL is content — what this frame
  // permits — and its op is the same op either way, because the shape of the
  // drawing is one shape.
  ops.push(call('affordance.lock', lockLabel(frame, cursor, selected)));

  // Provenance, small and always: a number without its `evalVersion` and its
  // `guidanceId` is a cross-fiber comparison waiting to happen.
  ops.push(
    call(
      'panel.provenance',
      frame.provenance.botId,
      frame.provenance.behaviourId,
      frame.provenance.evalVersion,
      frame.provenance.guidanceId,
      frame.provenance.emissionSeq,
      frame.provenance.quantaSpent,
      frame.provenance.premise
    )
  );

  return ops;
}

const LOCK_AFFORDANCE = {
  true: (pins: number, members: number) => `[Space] lock — pins ${pins} of ${members}`,
  false: () => '[N] return to now and lock',
} as const;

function lockLabel(frame: LensFrame, cursor: LensCursor, selected: Moveset | null): string {
  const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
  const members = cluster?.members ?? [];
  const pins =
    selected === null || cursor.unit === null
      ? 0
      : members.filter(
          (v) =>
            v === cursor.unit ||
            (selected.moves.find((m) => m.unit === v)?.to ?? null) !== stagedCellOf(frame, v)
        ).length;
  return LOCK_AFFORDANCE[`${frame.at.isHead}`](pins, members.length);
}

// ---------------------------------------------------------------------------
// The badge component
//
// The three fields that legitimately differ between a live frame and a replay
// frame are rendered HERE and only here, as text the operator reads. That is
// the whole of the difference: everything above this line draws one picture
// from one object.
// ---------------------------------------------------------------------------

const MODE_BADGE = {
  'live-head': 'LIVE',
  'live-scrub': '⏸ SCRUBBED',
  replay: 'REPLAY',
} as const;

const PROVENANCE_BADGE = {
  observed: 'observed',
  rerun: 're-derived',
} as const;

/** `⏸ SEQ 14/21` — loud, because a determination issued against a frame whose
 *  ordering has moved would break the display contract at the moment it
 *  matters. One key (`N`) gets you back. */
export function modeBadge(frame: LensFrame): string {
  const head = headOf(frame);
  return `${MODE_BADGE[frame.at.mode]} · seq ${frame.at.seq}${head}`;
}

function headOf(frame: LensFrame): string {
  return frame.at.isHead ? '' : ' · read-only';
}

export function provenanceBadge(frame: LensFrame): string {
  return `${PROVENANCE_BADGE[frame.provenance.kind]} · ${frame.provenance.behaviourId}`;
}
