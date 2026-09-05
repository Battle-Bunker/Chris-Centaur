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

import { anchorWithSettlement, applyEvent, emptyStore, reviveLens } from '../store';
import { makeLiveSource, makeReplaySource } from '../store/sources';
import type { MovesetList } from './cursor';
import {
  boundingOf,
  clusterOf,
  incumbentCandidate,
  initialCursor,
  movesetListFor,
  rankOne,
  reservoirListKey,
  rowsFor,
  stagedCellOf,
} from './cursor';
import type {
  CandidateRow,
  CellIndex,
  ClusterId,
  DominanceCondition,
  Cursor,
  DecisionSource,
  DrawCall,
  DrawTranscript,
  FrameStore,
  LensCursor,
  LensFrame,
  LoudReading,
  Moveset,
  OperatorId,
  RowTrail,
  TurnEvent,
  TurnEventKind,
  UnitKey,
} from '../types';
import type { BoardSnapshot } from '../../types/battlesnake';

export * from './cursor';

// ---------------------------------------------------------------------------
// The two sources
// ---------------------------------------------------------------------------

export interface LiveSourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
  readonly isHead: boolean;
}

export interface ReplaySourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
}

/**
 * THE TWO SOURCES, WHICH ARE ONE SOURCE.
 *
 * The fold, the cursor, the subscriber set and the three badge fields all live
 * in `../store/sources` — a source is a cursor over an event array, and the
 * array and the reducer both belong to the store. These are the names the
 * browser reaches for; they are wrappers and not implementations, because a
 * second fold living up here is precisely the fork this module was written to
 * delete, and it would drift the same way the old one did — quietly, in the
 * empty states, where nobody looks.
 */

/**
 * LIVE. A CURSOR over a store, not a copy of one: the fold is pure and the
 * event array is shared, so the store is grown by whoever is receiving
 * `lens-frames` and this hands out the frame at whatever `seq` this connection
 * sits on. That is what makes a second operator's scrubbing cost nothing and
 * move nobody else's playhead.
 */
export function makeLiveDecisionSource(input: LiveSourceInput): DecisionSource {
  return makeLiveSource(input);
}

/**
 * REPLAY. Reads the persisted rows and calls THE SAME `applyEvent` with the
 * same objects; the only things it does differently are hand the events over
 * from Postgres instead of a socket, and answer that determinations are not
 * legal here. Its breakdowns come out of the frame the fold already produced,
 * so a drilled row in replay is the row the operator drilled live.
 */
export function makeReplayDecisionSource(input: ReplaySourceInput): DecisionSource {
  return makeReplaySource(input);
}

/**
 * THE PAGE'S ENTRY POINT. A turn's events in, the frame at one `seq` out —
 * folded by the reducer replay folds with, never by a second copy of it living
 * in the browser. The client holds the events; this holds the meaning.
 *
 * The anchor is the turn's own `board.arrived`: a fold never crosses a turn
 * boundary, so there is nothing to seek past and no game-length fold to avoid.
 */
/**
 * THE EVENTS AS THE SERVER BUILT THEM, from the JSON that reached the browser.
 *
 * `+∞` on an unproved upper bound is an ordinary reading here and plain JSON
 * cannot carry it, so the server names it and this restores it — same codec,
 * both directions. Call it once on whatever the socket or `/api/logs` handed
 * over; it is pure and total, so an event with nothing to restore comes back
 * unchanged.
 */
export function reviveEvents(events: ReadonlyArray<TurnEvent>): ReadonlyArray<TurnEvent> {
  return events.map((e) => reviveLens(e));
}

/**
 * THE FOLD, KEPT — one turn's fold, reused while the turn's array is the array
 * it was folded from.
 *
 * `storeOf` is a `reduce` over every event of the turn and `frameAt` is a
 * second pass over the same array; between them they are the fold, and the
 * page asks for one about forty-three times a turn for the twelve batches that
 * actually arrive (`docs/design/ux/03-LATENCY.md` §1.4). Nothing about that is
 * wrong except that the answer is the same answer: the fold is PURE, so the
 * only thing that can change it is the array growing.
 *
 * So the memo is keyed on the array's own identity and validated on the two
 * facts that make a prefix a prefix — its length, and the object that was last
 * in it. The page grows `lensEvents` by pushing and re-sorting, and events
 * arrive in `seq` order, so the common case is "the same events plus a few
 * more" and the extension folds ONLY the new ones onto the store it already
 * had. Anything else — a different anchor, a different settlement, an array
 * whose prefix moved — falls through to the full fold, which is the
 * un-memoised function exactly as it was.
 *
 * This is a cache and NOT a second fold: every entry in it was produced by
 * `applyEvent`, in order, from `emptyStore(anchor)`. `lens-determinism` and
 * `lens-replay-parity` are the gate, and they compare what comes out of here
 * against what the reducer produces with no memo in front of it.
 */
interface FoldMemo {
  readonly settlement: BoardSnapshot | null;
  readonly anchorEvent: TurnEvent;
  readonly length: number;
  readonly tail: TurnEvent | undefined;
  readonly store: FrameStore;
  readonly at: Cursor;
  readonly frames: Map<string, LensFrame>;
}

// Per events-array, and at most two entries — a live fold (no settlement) and
// a replayed one (the turn's board handed in). Weak, so a closed turn's fold
// is collected with the array the page dropped on the turn boundary.
const FOLDS = new WeakMap<object, FoldMemo[]>();
// A turn holds tens of events, so tens of distinct `seq` under the playhead.
// The cap is two orders above that and exists so a pathological caller cannot
// grow one turn's map without bound.
const FRAME_CACHE_CAP = 512;

function foldOf(
  events: ReadonlyArray<TurnEvent>,
  settlement?: BoardSnapshot | null
): FoldMemo {
  const found = events.find((e) => e.kind === 'board.arrived') ?? events[0];
  if (found === undefined) throw new Error('a turn with no events has no frame');
  const want = settlement ?? null;
  const held = FOLDS.get(events as object);
  const memo = held?.find((m) => m.settlement === want && m.anchorEvent === found);
  if (
    memo !== undefined &&
    events.length >= memo.length &&
    events[memo.length - 1] === memo.tail
  ) {
    if (events.length === memo.length) return memo;
    let store = memo.store;
    for (let i = memo.length; i < events.length; i++) {
      const event = events[i] as TurnEvent;
      if (event.seq > memo.at.seq) store = applyEvent(store, event);
    }
    return remember(events, held, {
      ...memo,
      length: events.length,
      tail: events[events.length - 1],
      store,
      frames: new Map(),
    });
  }
  // A STORED ANCHOR HAS NO BOARD. `logStoredEvent` drops the settlement on the
  // way to Postgres — `turn_boards` holds it — so a caller folding rows read
  // back out of `turn_events` must hand the board over, exactly as
  // `storeFromRows` does. Without it the frame's board is 0×0, and every unit
  // row it derives comes back nameless: kind `snake`, letter blank, hp 0, wt 0,
  // for pieces at full health. That is the same turn rendering DIFFERENTLY
  // live and in replay, which is the one thing Law C forbids.
  const anchor = settlement ? anchorWithSettlement(found, settlement) : found;
  const store = events
    .filter((e) => e.seq > anchor.seq)
    .reduce<FrameStore>((acc, e) => applyEvent(acc, e), emptyStore(anchor));
  return remember(events, held, {
    settlement: want,
    anchorEvent: found,
    length: events.length,
    tail: events[events.length - 1],
    store,
    at: { gameId: anchor.gameId, turn: anchor.turn, seq: anchor.seq },
    frames: new Map(),
  });
}

function remember(
  events: ReadonlyArray<TurnEvent>,
  held: FoldMemo[] | undefined,
  memo: FoldMemo
): FoldMemo {
  const kept = (held ?? []).filter(
    (m) => !(m.settlement === memo.settlement && m.anchorEvent === memo.anchorEvent)
  );
  kept.unshift(memo);
  FOLDS.set(events as object, kept.slice(0, 2));
  return memo;
}

/** One frame out of a kept fold, memoised on the cursor it answers for. */
function frameOf(memo: FoldMemo, key: string, build: () => LensFrame): LensFrame {
  const hit = memo.frames.get(key);
  if (hit !== undefined) return hit;
  const frame = build();
  if (memo.frames.size >= FRAME_CACHE_CAP) memo.frames.clear();
  memo.frames.set(key, frame);
  return frame;
}

export function frameAtSeq(
  events: ReadonlyArray<TurnEvent>,
  seq: number,
  isHead: boolean
): LensFrame {
  const memo = foldOf(events);
  return frameOf(memo, `live/${seq}/${isHead ? 'head' : 'scrub'}`, () =>
    makeLiveDecisionSource({ store: memo.store, at: { ...memo.at, seq }, isHead }).frame()
  );
}

/**
 * THE SAME FOLD, THROUGH THE REPLAY SOURCE. A recorded turn is not a live turn
 * an operator has scrubbed back on: it is closed, `N` returns to no head that
 * exists, and no determination may ever be issued from it. `frameAtSeq` could
 * not say that — every frame it built came out of the live source — so a
 * replayed turn badged itself `SCRUBBED`, offered `[N] return to now`, and one
 * keypress later would accept a lock against a frame from the past (09 §A1).
 *
 * The fold, the frame and the transcript are identical; the three badge fields
 * are the whole of the difference, which is Law C exactly as it is written.
 */
export function replayFrameAtSeq(
  events: ReadonlyArray<TurnEvent>,
  seq: number,
  settlement: BoardSnapshot | null = null
): LensFrame {
  const memo = foldOf(events, settlement);
  return frameOf(memo, `replay/${seq}`, () =>
    makeReplayDecisionSource({ store: memo.store, at: { ...memo.at, seq } }).frame()
  );
}

// ---------------------------------------------------------------------------
// The board's vocabulary
//
// ONE RULE: violet means hypothetical. Nothing else on the board is violet
// today and nothing else may become violet. Shape carries the meaning and
// colour only reinforces it — filled / hollow / dotted separate cursor,
// implied and foil with the hues collapsed — so the vocabulary survives a
// deuteranope reader and a dark board equally.
//
// THE TOKENS THEMSELVES LIVE WITH THE BRUSH THAT PAINTS THEM,
// `board-renderer.js::LENS_THEME`, which is the pair `lens-ink.test.ts`
// checks. A second copy here was a palette nothing drew with and everything
// could drift from.
// ---------------------------------------------------------------------------

/** α β γ … — a cluster's name on the board, stable within a partition. */
const CLUSTER_GLYPHS = 'αβγδεζηθικλμν';

export function clusterGlyph(index: number): string {
  return CLUSTER_GLYPHS[index] ?? `c${index}`;
}

function call(op: string, ...args: ReadonlyArray<unknown>): DrawCall {
  return { op, args };
}

/** One decimal, the rail's own resolution. A margin printed at float width is
 *  a number nobody reads and a false claim about how well it is known. */
const round1 = (n: number): number => Number(n.toFixed(1));

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
  readonly marks: ReadonlyArray<string>;
  readonly delta: number | null;
  readonly sorted: boolean;
}

/** The bracket width of the reading the cell is about — the DEEPEST one, which
 *  is the number `⌈w⌉` beside the aggregate is a width of. It equals the row's
 *  own `hi − lo` while nothing deepens, and stops equalling it on the first
 *  row that does. */
export function bracketWidth(row: Moveset): number {
  const { deepest } = row.depth;
  return Number((deepest.hi - deepest.lo).toFixed(2));
}

/**
 * `loud` is the frame's context and not a row's: the bank measured it on the
 * LEADER's own plan, so only the leader's cell may carry it. `Q` is the count
 * of enemy replies that touch our staged footprint — the quantity a ceiling
 * ply would have to enumerate — and `P` is the whole reply product beside it,
 * which is what makes Finding D-1's anti-correlation readable rather than
 * asserted (08 §4.4).
 */
export function depthCell(row: Moveset, loud: LoudReading | null = null): DepthCell {
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
  // THE ABSENCE OF DEPTH IS DRAWN, AND NOW IT IS DRAWN WITH ITS REASON. `h1 ·`
  // says a ply was not taken; `h1 · Q=340/4096` says how much there was to
  // enumerate and how much of it could touch us, which is the number the
  // decision to decline was made on (08 §4.5, gate G-D6).
  const decline = deepened || loud === null ? '·' : `· Q=${loud.q}/${loud.product}`;
  return {
    label: `h${deepest.horizon}`,
    marks: marks.length > 0 || deepened ? marks : [decline],
    delta: deepened ? Number((delta.lo !== 0 ? delta.lo : delta.hi).toFixed(2)) : null,
    // A declared narrowing means `compareFloors` refuses: the row is present
    // and is NOT sorted against the others.
    sorted: !narrowed,
  };
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

/**
 * The emptiness the frame actually has, in words. Not "no data" — and not one
 * sentence for four different situations either, which is what it was: a table
 * is empty because the decision has not spoken yet, because the unit under the
 * cursor is not a variable the bot is solving, because the conditional behind
 * this candidate has not answered, or because the reservoir honestly retained
 * nothing (07 §2: 13 of 90 `snakes` decisions). Those are four different
 * things to know and only the first of them was ever said.
 */
export function emptyStateLine(frame: LensFrame, cursor: LensCursor = initialCursor()): string {
  const unit = cursor.unit;

  // RULE E, IN THE RAIL. A unit with a fixity is not a member: the bot is not
  // choosing its move, and the sentence names the reason and its author rather
  // than blaming the kernel for a silence it is not responsible for.
  if (unit !== null) {
    const bound = boundingOf(frame, unit);
    if (bound !== null) {
      const author = authorOf(frame, unit, bound.bound.by);
      const by = author === null ? '' : ` by ${author}`;
      return (
        `${unit} is ${FIXITY_VERB[bound.bound.why]}${by} — it is a constant of cluster ` +
        `${bound.cluster.id}, not a variable the bot is solving`
      );
    }
    const dead = frame.units.find((u) => u.unit === unit)?.fixity ?? 'free';
    if (dead === 'dead') return `${unit} is dead — there is nothing left to choose for it`;
  }

  const emissions = frame.events.filter((e) => e.kind === 'emission').length;
  if (emissions === 0) {
    const fastpass = frame.events.some((e) => e.kind === 'stage.fastpass');
    const staged = fastpass ? 'fast-pass only' : 'nothing staged yet';
    return `${staged} — no kernel emission yet at seq ${frame.at.seq}`;
  }

  if (unit === null) return `${emissions} emissions at seq ${frame.at.seq} — no unit is focused`;
  return (
    `nothing retained for ${unit} at this candidate — ` +
    `${emissions} emissions by seq ${frame.at.seq} and no priced restriction plays it`
  );
}

/**
 * WHO FIXED IT. The partition's `boundedBy[].by` is the kernel's own field and
 * the kernel does not know operators — every producer fills it `null` — while
 * the fold DOES know, because it folds the `pin` rows the operator's gesture
 * writes. So the declared author wins where there is one, and the frame's own
 * unit row answers where there is not. Before the pin row existed both were
 * null and Rule E's sentence had no author at all.
 */
function authorOf(frame: LensFrame, unit: UnitKey, declared: OperatorId | null): string | null {
  if (declared !== null) return declared;
  const row = frame.units.find((u) => u.unit === unit);
  return row?.operator ?? row?.owner ?? null;
}

/**
 * A FIXITY REASON, AS A SENTENCE SAYS IT. `FixityReason` is a tag —
 * `pin | commit | reference | pin-unreachable` — and the rail was dropping the
 * tag straight into prose: "red-A is pin". The reason is worth saying in
 * words; it is the whole content of the UNIT-terminal state.
 */
const FIXITY_VERB: Readonly<Record<string, string>> = {
  pin: 'pinned',
  commit: 'committed',
  reference: 'held as a reference',
  'pin-unreachable': 'pinned at a cell it cannot reach',
};

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
      ops.push(
        call('fixed.chip', bound.unit, bound.why, authorOf(frame, bound.unit, bound.by), bound.to)
      );
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
    //
    // THE BADGE IS THAT MEMBER'S CONTRIBUTION DIFFERENCE (02 §3.5) and it is
    // drawn only where the frame actually holds one. It used to carry the
    // whole moveset's margin on every differing cell — the same cluster-level
    // number, on two units, labelled as each unit's own.
    for (const move of foil.moves) {
      const same = selected.moves.find((m) => m.unit === move.unit)?.to === move.to;
      if (same) continue;
      ops.push(call('foil.arrow', move.unit, move.to));
      const delta = memberDelta(frame, foil, selected, move.unit);
      if (delta !== null) ops.push(call('foil.delta', move.unit, delta));
    }
  }

  return ops;
}

/** One member's own contribution, foil minus selected, out of the two rows'
 *  breakdowns. Null when either breakdown is not in the frame — which is the
 *  ordinary case until a drill has been answered, and a missing badge is
 *  honest where a cluster-level number wearing a member's name is not. */
function memberDelta(
  frame: LensFrame,
  foil: Moveset,
  selected: Moveset,
  unit: UnitKey
): number | null {
  const of = (row: Moveset): number | null =>
    frame.breakdown[row.key]?.marginals.find((m) => m.unit === unit)?.delta.lo ?? null;
  const mine = of(foil);
  const theirs = of(selected);
  return mine === null || theirs === null ? null : Number((mine - theirs).toFixed(2));
}

function candidateOps(frame: LensFrame, cursor: LensCursor): DrawCall[] {
  if (cursor.unit === null) return [];
  const rows: ReadonlyArray<CandidateRow> = frame.candidates[cursor.unit] ?? [];
  const incumbent = incumbentCandidate(frame, cursor.unit);
  return [
    // WHAT THE LIST IS: the destinations THIS DECISION priced, scored as the
    // best the whole cluster can do given that candidate. It is not the unit's
    // legal-move count, and a header that read like one invited the operator
    // to conclude the bot had considered four moves when it had priced four.
    call('panel.candidates', rows.length, 'priced here · scored as best-of-cluster'),
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
  selected: Moveset | null,
  trails: ReadonlyArray<RowTrail>
): DrawCall[] {
  const list = movesetListFor(frame, cursor.unit, cursor.candidate);
  const rows = list.rows;
  if (rows.length === 0) return [call('panel.movesets.empty', emptyStateLine(frame, cursor))];

  const leader = rankOne(rows);
  const cluster = cursor.unit === null ? null : clusterOf(frame, cursor.unit);
  // The frame's own loud reading, measured on this cluster's leader. It rides
  // the leader's depth cell and no other row's, because that is the plan it
  // was taken on.
  const loud = cluster === null ? null : (frame.loud?.[reservoirListKey(cluster.id)] ?? null);
  const ops: DrawCall[] = [
    call(
      'panel.movesets',
      cluster?.id ?? null,
      cluster === null ? 0 : cluster.members.length,
      cluster === null ? 0 : cluster.boundedBy.length,
      frame.at.seq,
      // A stale complement is a row whose QUESTION changed while its answer
      // stayed sound. It is struck through and headed, never dropped.
      rows.some((r) => r.complement === 'stale'),
      // WHAT THIS LIST IS. On the shipped build it is one row — the cluster's
      // retained rows restricted to the ones that play this candidate — and a
      // table headed `MOVESETS` over a single row with two inert keys tells
      // the operator nothing about why. The head says which of the two lists
      // this is and how many rows the reservoir retained for the cluster, so
      // "there is nowhere for `]` to go" is a readable fact rather than a
      // suspicion (10 §4 O1).
      list.source,
      list.retained,
      // WHERE THE RANKING STOPPED. A conditional list that the reserve cut
      // short and a cluster with nothing else in it are the same table on
      // screen unless the head says which one this is — the same distinction
      // a typed refusal draws for a request nobody could serve (10 §4 O1).
      list.truncated
    ),
  ];

  // THE FOIL IS A PROPERTY OF A ROW, not only of the line under the table.
  // The rail draws rank 1 and the runner-up at full size — the contrastive
  // pair is what an operator actually decides on — so the row op has to carry
  // which row that is, computed once, here, and read by both the row and the
  // line below it.
  const foil = selected === null ? null : foilRow(frame, cursor, selected);

  for (const row of rows) {
    const cell = depthCell(row, row.key === leader?.key ? loud : null);
    // A ROW WITH NO PRICE DRAWS NO NUMBER. `conform` returns a plan; `0.0`
    // beside it would be a reading nobody took, and `—` is what F7 reserved
    // for a number that is genuinely not there.
    const priced = row.unpriced !== true;
    // The rank trail — `#3 ▲was #1` — and the displaced badge on the row a
    // re-resolution had to fall to. Both decay after two emissions: a trail
    // that outlives the change it describes is furniture.
    const trail = trails.find((t) => t.moveset === row.key) ?? null;
    ops.push(
      call(
        'panel.movesets.row',
        row.rank,
        // THE ROW'S OWN KEY. T6 names a click on a moveset row as a source of
        // the cursor transition, and the rail could not offer one because the
        // markup had no way to say which row was clicked (10 §4 O5).
        row.key,
        // ONE CHANNEL PER ROW, AND IT IS THE ONE THAT ADJUDICATES. `lo` is the
        // proved floor: the quantity the reservoir ranks on (`byBetter`), the
        // quantity `⌈w⌉` is a width of, and the quantity Δ measures. Showing
        // `est` here when the posture ordered by it put three numbers from two
        // channels on one row with nothing saying which was which — and `est`
        // is the channel that never adjudicates. It keeps its own voice in the
        // `unless` cell, where `advisory-only` prices it and names it.
        priced ? row.lo : null,
        priced ? bracketWidth(row) : null,
        cell,
        leader === null || !priced || leader.unpriced === true
          ? null
          : Number((row.lo - leader.lo).toFixed(2)),
        // THE `unless` CELL. Drawn on every row, leader included, and never
        // omitted: a row with no clause and a row that leads on the proved
        // floor are two different states and only "always draw it" tells them
        // apart (Law A, applied to the reduction).
        dominanceClause(row.dominance),
        row.moves.map((m) => `${m.unit}→${m.to}`),
        row.complement,
        row.key === selected?.key,
        row.staged,
        trail,
        // WHICH ROW IS THE RUNNER-UP, and the row's own estimate. Both are
        // appended rather than woven in, so every existing reader keeps its
        // indices: the rail marks the foil row at full size beside rank 1, and
        // draws the bracket as a BAND with `est` as its marked point rather
        // than as `-51.6 ⌈93.0⌉` text that one reader in three inverts.
        row.key === foil?.key,
        priced ? row.est : null
      )
    );
  }

  // The constants strip. A fixed unit keeps its staged arrow and its place in
  // the plan; it is not a member, and the row says who fixed it.
  for (const bound of cluster?.boundedBy ?? []) {
    ops.push(
      call(
        'panel.movesets.fixed',
        bound.unit,
        bound.to,
        bound.why,
        authorOf(frame, bound.unit, bound.by)
      )
    );
  }

  // THE FOIL LINE IS ALWAYS ON SCREEN (§3.5: *"Panel side: always visible as
  // one line under the moveset table"*). It used to be drawn only when the
  // list held a rank 2 — which by O1 is the uncommon case — so the highest-
  // value cheap signal on the surface was absent in the ordinary case and its
  // absence was silent. An absence is drawn WITH ITS REASON, exactly as the
  // depth cell draws `Q=0/33` rather than a bare `h1`.
  if (selected !== null) {
    ops.push(
      foil === null
        ? call('panel.foil', null, null, noFoilReason(list), null)
        : call(
            'panel.foil',
            foil.rank,
            // A MARGIN BETWEEN TWO UNPRICED ROWS IS NOT A NUMBER. The
            // conditional ranking's rows are assignments, so the line names
            // the runner-up and why it lost and draws `—` where a margin
            // would be, rather than a difference of two zeros.
            selected.unpriced === true || foil.unpriced === true
              ? null
              : Number((selected.lo - foil.lo).toFixed(2)),
            whyItLost(selected, foil),
            depthCell(foil).label
          )
    );
  }

  return ops;
}

/**
 * Why there is no runner-up, in the list's own terms. A conditional list of
 * one is the kernel saying this lock has one answer; a restricted list of one
 * is the reservoir having retained a single row that plays this candidate —
 * two different facts, and the operator is owed the difference.
 */
function noFoilReason(list: MovesetList): string {
  if (list.source === 'conditional') {
    // The conditional list's own shortness has a cause and the head already
    // knows it; the foil line is where it matters, because the foil is the
    // thing the operator lost by it.
    return list.truncated === null
      ? 'no runner-up — the conditional list has one row'
      : `no runner-up — ${list.truncated.detail}`;
  }
  return list.retained <= 1
    ? 'no runner-up — the reservoir retained one row for this cluster'
    : `no runner-up — only 1 of ${list.retained} retained rows plays this candidate`;
}

/**
 * THE THREAT/OPPORTUNITY MAP, one clause per row (03 §2.4, 08 §3.4).
 *
 * `better()`'s six refusal branches ARE the set-valued reduction: every one of
 * them already knows why it refused, the reservoir turns the reason into a
 * `DominanceCondition` at the barrier, and until now it reached the operator
 * for exactly one pair of rows — the selected row and its foil. This renders it
 * for EVERY retained row, which is what makes the table a map rather than a
 * ranking: per row it says what that moveset is BETTING ON, named by unit and
 * priced in the aggregate's own units.
 *
 * COST: ZERO SETTLEMENTS. Every input is a value the comparison already
 * produced, read in the order it was already produced in. Nothing here asks
 * the bank a question, so no node count moves and no frame changes.
 *
 * The clause is written to complete the sentence *"this moveset wins unless
 * …"*, which is why `contingent` reads as a condition and `dominated` as its
 * denial. `atStake` and the margins are rounded like every other number on the
 * rail: an unrounded float in a sentence is a number nobody can read.
 */
/**
 * The ledger's residue entry, as a `UnitKey`. `unitKeyOf` falls back to
 * `#${unitId}` for a number the wire cannot name, and the bounds layer's
 * `EVALUATOR_RESIDUE_UNIT` is `-1` — the gap the evaluator itself declares
 * when no held unit accounts for it. Naming it in the row is the whole point
 * of the clause; printing `#-1` at the operator would not be naming it.
 */
const RESIDUE_KEY = '#-1';

const namedUnit = (key: string): string => (key === RESIDUE_KEY ? 'the evaluator residue' : key);

export function dominanceClause(dominance: DominanceCondition | null): string {
  if (dominance === null) return 'unsealed — the barrier has not run';
  switch (dominance.kind) {
    case 'leader':
      return 'leads on the proved floor';
    case 'refuted-by-witness':
      // A CERTIFICATE, not an opinion: a concrete joint reply holds this plan
      // below the leader's PROVED floor, and it survives restarts by contract.
      return 'refuted by a witness';
    case 'incomparable-basis':
      return 'incomparable basis — not sorted against the leader';
    case 'contingent':
      // The owner's own row: what this moveset rides on, and what it is worth.
      // An empty `onUnits` is the honest case where the bracket is the
      // evaluator's own residue rather than any held unit, and it says so.
      return dominance.onUnits.length === 0
        ? `wins on nothing named — ${round1(dominance.atStake)} at stake`
        : `${dominance.onUnits.map(namedUnit).join(', ')} resolve against us · ` +
            `${round1(dominance.atStake)} at stake`;
    case 'dominated':
      return `cannot win — dominated by ${round1(dominance.by)}`;
    case 'advisory-only':
      return `floors equal — advisory ${round1(dominance.estMargin)}`;
    case 'indifferent':
      return 'my proof rungs are silent here — your call beats my tie-break';
  }
}

/**
 * WHY the losing half of the pair lost, taken from `better()`'s own branch
 * read backwards.
 *
 * The interesting half is the LOSER: `better()`'s branch is the reason the row
 * that did not win did not win, and reading the winner's "leads on the proved
 * floor" back at the operator answers nothing. WHICH IS EXACTLY WHAT IT DID —
 * the clause fell back to the OTHER row's condition whenever the loser's own
 * was still null, so the line offered the winner's reason as the loser's. A
 * row whose condition the barrier has not filled says so.
 */
function whyItLost(selected: Moveset, foil: Moveset): string {
  const loser = selected.rank > foil.rank ? selected : foil;
  return `#${loser.rank} ${dominanceClause(loser.dominance)}`;
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
  breakdown: 'kernel',
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
    // TWO SHAPES THE ATTENTION CHANNEL CAN ARRIVE IN, and both are hollow.
    // §2.1 names focus and candidate hover as `selection` with `hover: true`;
    // the same look also reaches the kernel as a TENTATIVE pin — a hint the
    // search may speculate on, never a constraint (`notePinConsideration` →
    // `PinEvents.tentativePin`) — and that is the form the log actually
    // carries. A tentative pin drawn as a solid operator tick would say a
    // determination was made where a look was taken.
    const payload = event.payload as { hover?: unknown; tentative?: unknown } | undefined;
    const hover = payload?.hover === true || payload?.tentative === true;
    ops.push(
      call(
        'timeline.tick',
        LANE_OF[event.kind] ?? 'operator',
        event.seq,
        event.atWorkMs,
        event.kind,
        event.actor.id,
        event.actor.color,
        hover ? 'hollow' : 'solid',
        // WHO AND ON WHAT. §2.2 asks for `●Ada near(s2)` — the verb, the unit
        // and the operator — and the tick carried the kind and the time and
        // nothing else, because no `pin` / `unpin` row existed to carry a name.
        event.actor.name,
        event.unit
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
/**
 * The stage line's content: one entry per unit this decision is about, in the
 * partition's own order, each carrying what is staged for it right now and
 * whether the bot is still free to change it.
 *
 * `to === null` is the honest reading "nothing is staged for this unit yet"
 * and is what the strip counts as unplanned; it is never rendered as a move.
 */
export function stageSummary(frame: LensFrame): ReadonlyArray<{
  unit: UnitKey;
  letter: string;
  to: number | null;
  source: 'staged' | 'plan' | 'none';
  fixity: string;
  by: string | null;
}> {
  const out: Array<{
    unit: UnitKey;
    letter: string;
    to: number | null;
    source: 'staged' | 'plan' | 'none';
    fixity: string;
    by: string | null;
  }> = [];
  const seen = new Set<UnitKey>();
  const push = (
    unit: UnitKey,
    clusterId: ClusterId | null,
    fixity: string,
    by: string | null,
    /** A CONSTANT'S OWN CELL, and the reason it is a separate argument. The
     *  cluster's retained rows may still carry a move for a unit that has
     *  since been pinned — they were priced before the determination, and the
     *  reservoir is not rewritten by it. Reading the plan for a bounded unit
     *  therefore printed `Q → 22 pinned` for a unit pinned to 30: a
     *  contradiction in one clause, on the line the operator reads fastest and
     *  doubts least. The bound IS the answer for a bounded unit; it is what
     *  the whole cluster is conditioning on. */
    boundTo: CellIndex | null = null
  ): void => {
    if (seen.has(unit)) return;
    seen.add(unit);
    const row = frame.units.find((u) => u.unit === unit);
    // TWO SOURCES, AND THE LINE SAYS WHICH. A staged move (or a determination
    // that fixed the unit) is a fact about the turn; where nothing is staged
    // yet, what the bot is ABOUT to do is the rank-1 moveset's assignment for
    // this unit — the incumbent, which is the definition the board's own
    // violet arrow draws. What it is NOT allowed to be is "the unit's first
    // legal candidate": that is a guess wearing a plan's clothes, and this
    // line is read in under a second by someone who will not have time to
    // doubt it.
    const staged = stagedCellOf(frame, unit) ?? boundTo;
    const planned =
      staged !== null || clusterId === null
        ? null
        : (rankOne(frame.movesets[reservoirListKey(clusterId)] ?? [])?.moves.find(
            (m) => m.unit === unit
          )?.to ?? null);
    out.push({
      unit,
      letter: row?.letter || unit,
      to: staged !== null ? staged : planned,
      source: staged !== null ? 'staged' : planned !== null ? 'plan' : 'none',
      fixity,
      by,
    });
  };
  for (const cluster of frame.partition) {
    for (const member of cluster.members) push(member, cluster.id, 'free', null);
    for (const bound of cluster.boundedBy) {
      push(
        bound.unit,
        cluster.id,
        FIXITY_VERB[bound.why] ?? bound.why,
        authorOf(frame, bound.unit, bound.by),
        bound.to
      );
    }
  }
  // THE UNIT KEEPS ITS PLACE IN THE SENTENCE. Collection order is partition
  // order — members first, then the constants — so the moment a unit is
  // pinned it leaves `members`, joins `boundedBy`, and JUMPS TO THE END of
  // the line. `A → 108 · B → 119 · C → 133` became `B → 119 · C → 133 ·
  // A → 108 pinned` on the next turn, measured: `05-EVALUATION.md` H-1.
  //
  // This line is L1 — read in one fixation, without a saccade, by an eye that
  // lands where it landed last turn — and §1.4's first placement rule is that
  // nothing above L2 may MOVE, only its text may change. A determination is
  // exactly when the operator most needs the sentence to hold still, because
  // it is the turn they are checking their own work on. Sorting by the
  // unit's LETTER is the order the roster, the board tags and the operator's
  // own habit already use, and it is a fact about the unit rather than about
  // its current fixity, so nothing the operator does can reorder it.
  return out
    .slice()
    .sort((a, b) => (a.letter === b.letter ? (a.unit < b.unit ? -1 : 1) : a.letter < b.letter ? -1 : 1));
}

export function renderFrame(
  frame: LensFrame,
  cursor: LensCursor = initialCursor(),
  trails: ReadonlyArray<RowTrail> = []
): DrawTranscript {
  const selected = selectedRow(frame, cursor);
  const ops: DrawCall[] = [call('frame', frame.at.turn, frame.at.seq, frame.at.tMono)];

  ops.push(...boardOps(frame, cursor, selected));

  ops.push(call('panel.advice', frame.advice.length));

  // WHAT THE BOT IS ABOUT TO DO, in one op, for the units this decision is
  // about — every cluster's members plus the constants it is conditioning on.
  // It is the question an operator asks every single turn and the shipped rail
  // answered it nowhere: it was derivable from the board's arrows, one unit at
  // a time, by eye. It lives on the TRANSCRIPT rather than in the page so a
  // replayed turn says the same sentence off the log as off the wire.
  ops.push(call('panel.stage', stageSummary(frame)));

  if (cursor.unit !== null) {
    const row = frame.units.find((u) => u.unit === cursor.unit);
    // A FIXED UNIT HAS A CLUSTER TOO — the one it is a constant of. It is not a
    // member, so `clusterOf` does not find it, and the panel used to answer
    // "unclustered" for a unit that is very much part of a cluster's problem.
    // Rule E is a display invariant in both directions: a member is a variable
    // the bot is still solving, and a constant says whose determination made
    // it one.
    const cluster = clusterOf(frame, cursor.unit);
    const bound = cluster === null ? boundingOf(frame, cursor.unit) : null;
    const home = cluster ?? bound?.cluster ?? null;
    const boundBy = bound === null ? null : authorOf(frame, bound.bound.unit, bound.bound.by);
    const why =
      bound === null
        ? null
        : `a constant of cluster ${bound.cluster.id}` +
          `${boundBy === null ? '' : `, by ${boundBy}`} — not a member`;
    ops.push(
      call(
        'panel.focus',
        cursor.unit,
        row?.kind ?? null,
        row?.letter ?? null,
        row?.health ?? null,
        row?.weight ?? null,
        // THE UNIT'S OWN FIXITY, AND THE PARTITION'S, ARE ONE ANSWER. `frameAt`
        // derives `UnitRow.fixity` from the turn's `pin` / `commit` events —
        // which nothing on the wire writes today — while the partition frame
        // carries the same fact as `boundedBy`. Reading only the first, the
        // rail printed `free · pin · a constant, not a member` on one line: a
        // unit that is simultaneously a free variable and a constant. The
        // partition wins, because it is the statement the kernel actually made.
        bound === null ? (row?.fixity ?? null) : FIXITY_VERB[bound.bound.why],
        home?.id ?? null,
        home?.members.length ?? 0,
        // "Locking narrows" is the word, everywhere: the header counts what is
        // still free, and a lock moves a unit into the bounded strip.
        why ??
          (home === null
            ? null
            : `${home.members.length} of ${home.members.length + home.boundedBy.length} free`)
      )
    );
  }

  ops.push(...candidateOps(frame, cursor));
  ops.push(...movesetOps(frame, cursor, selected, trails));
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

/**
 * THE DETERMINATION AFFORDANCE NEVER VANISHES — a greyed control teaches
 * nothing — so it RE-LABELS on `isHead`, the one field of the three badge
 * fields the transcript is allowed to read.
 *
 * IT DOES NOT TELL `replay` FROM `live-scrub`, AND IT MUST NOT. That was
 * recorded as a gap; it is a boundary. The transcript is the object the two
 * sources are compared on, and a frame carries no CONTENT that separates a
 * recorded turn from a scrubbed live one — `at.mode` is on the frame precisely
 * because the distinction is not derivable, which is why the structural gate
 * refuses a renderer that reads it. So the line splits at the seam the design
 * already draws:
 *
 *   · WHAT IS TRUE OF THE FRAME is here. At the head, the exact pin count.
 *     Off it, §1.4's own replay sentence where the frame's events hold a lock
 *     at this seq — `locked by Ada at +812ms → [jump]`, which is a READ of a
 *     recorded row and therefore identical from both sources — and
 *     `— read-only —` where they do not, which is true of both off-head modes:
 *     determinations are legal only from the live head.
 *   · THE WAY BACK is a fact about the SOURCE, so it rides `modeBadge`, the
 *     sanctioned home of the three fields that may differ. Only `live-scrub`
 *     has a `now` to return to, and only `live-scrub` now offers one; a
 *     replayed turn is no longer offered a `now` a closed turn does not have.
 *
 * Nothing here reads `at.mode`, and the rail is byte-identical between a
 * scrubbed live frame and a replayed one at the same seq — which is the gate,
 * and the gate is right.
 */
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
  return frame.at.isHead
    ? `[Space] lock — pins ${pins} of ${members.length}`
    : (recordedLock(frame, members) ?? '— read-only —');
}

/**
 * §1.4's replay affordance: *"`locked by Ada at +812ms → [jump]` if such a lock
 * exists at this `seq`"*. It is a read of the turn's own rows, so it says the
 * same sentence off the socket and off the log — and it could not be said at
 * all until the pin gesture became a row (O6). A TENTATIVE pin is a look and
 * not a determination, and is not a lock.
 */
function recordedLock(frame: LensFrame, members: ReadonlyArray<UnitKey>): string | null {
  const scope = new Set(members);
  const locked = [...frame.events]
    .reverse()
    .find(
      (e) =>
        (e.kind === 'pin' || e.kind === 'commit') &&
        e.unit !== null &&
        scope.has(e.unit) &&
        (e.payload as { tentative?: unknown } | undefined)?.tentative !== true
    );
  if (locked === undefined) return null;
  const who = locked.actor.name ?? locked.actor.id ?? 'an operator';
  const at = locked.atWorkMs === null ? '' : ` at +${locked.atWorkMs}ms`;
  return `locked by ${who}${at} → [jump]`;
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

/**
 * THE WAY BACK, and who has one.
 *
 * `[N] return to now` belongs to `live-scrub` and to nothing else: a closed
 * turn has no `now` to return to, and offering one on a replayed turn names a
 * thing that does not exist. It is a fact about the SOURCE rather than about
 * the frame's content, so it lives here — with the two other badge fields —
 * and not in the transcript, which must read identically from both sources.
 */
const WAY_BACK = {
  'live-head': '',
  'live-scrub': ' · [N] return to now',
  replay: '',
} as const;

/** `⏸ SEQ 14/21` — loud, because a determination issued against a frame whose
 *  ordering has moved would break the display contract at the moment it
 *  matters. One key (`N`) gets you back, and the badge is where it says so. */
export function modeBadge(frame: LensFrame): string {
  const head = headOf(frame);
  return `${MODE_BADGE[frame.at.mode]} · seq ${frame.at.seq}${head}${WAY_BACK[frame.at.mode]}`;
}

function headOf(frame: LensFrame): string {
  return frame.at.isHead ? '' : ' · read-only';
}

export function provenanceBadge(frame: LensFrame): string {
  return `${PROVENANCE_BADGE[frame.provenance.kind]} · ${frame.provenance.behaviourId}`;
}
