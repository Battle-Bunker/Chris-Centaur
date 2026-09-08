/**
 * GATE G-L1 — A RECORDED SESSION REPLAYS TO IDENTICAL FRAMES.
 *
 * `lens-frame-fold.test.ts` asserts this property at the unit level, between
 * two folds of one in-memory array. This is the same property promoted to an
 * END-TO-END gate across the four places a shape can drift (05 §(d) 6):
 *
 *    the kernel's sink  →  the one `seq` writer  →  the wire envelope
 *                              ↘  the stored rows  →  the replay reader
 *
 * A real decision runs under the node clock with the full server-side sink and
 * writer attached. Every websocket envelope the live client would receive is
 * captured, and so is every row the writer sends to storage — through the
 * SHIPPED codecs, and through a JSON round trip, because `payload` reaches
 * Postgres as `jsonb` and a `Map`, an `undefined` or a `-Infinity` that
 * survives in memory does not survive that.
 *
 * Then, FROM THE ROWS ALONE, the store is rebuilt with `storeFromRows` — the
 * one the replay path builds through, two reads from the tables — and folded
 * to every `(turn, seq)` the live client visited. The two frames must be deep-equal
 * except `at.mode`, `at.isHead` and `provenance.kind`, which are content the
 * operator is entitled to and are rendered as badges, never as branches.
 *
 * A FAILURE NAMES THE SEQ AND THE FIELD. A gate that says "the frames differ"
 * about a frame with a board, a partition, a reservoir and an event list in it
 * is a gate nobody can act on, so the comparison walks both objects and
 * reports the first path that disagrees.
 *
 * THE THREE HOPS THAT ARE REAL HERE, and the one that is not: the sink, the
 * writer and the codecs are the shipped ones; the SQL is not — the rows live
 * in a list instead of in Postgres. What Postgres would add to this test is a
 * connection, and what it would catch — a column that drops a field — is
 * caught by the JSON round trip below, because every column but `payload` is
 * a scalar and `payload` is the whole event.
 *
 * BOTH HOPS ARE JSON, and that is load-bearing rather than incidental. The
 * websocket sends and `turn_events.payload` is `jsonb`, so both consumers are
 * handed an ENCODING of the object rather than the object. Plain JSON cannot
 * carry a non-finite bound — `hi: +∞` is the lattice top, before anything is
 * proved above the incumbent, and `JSON.stringify` turns it into `null` — so
 * both hops use `lensStringify` / `reviveLens`, which name it and put it back.
 * The last test below asserts the encoding is LOSSLESS in both directions and
 * that a real decision actually produces such a value, so the assertion is
 * testing something. It used not to be lossless, and the cost of that was not
 * cosmetic: the `movesets` projection is derived from the stored event and its
 * `hi` column is NOT NULL, so a rebuild read `null` back and failed outright —
 * gate 8, refusing a real recorded session.
 */

import { recordLensRun, unitKeyOf } from '../lens/kernel';
import {
  decodeEventRow,
  encodeEventRow,
  ingestLensEvents,
  lensStringify,
  makeSeqWriter,
  projectMovesets,
  rebuildMovesets,
  reviveLens,
  storeFromRows,
} from '../lens/store';
import {
  applyCursorEvent,
  frameAtSeq,
  initialCursor,
  makeReplayDecisionSource,
  renderFrame,
} from '../lens/view';
import { makeSubstrate } from '../lobster/substrate';
import type {
  CursorEvent,
  DrawTranscript,
  LensCursor,
  LensEvent,
  LensFrame,
  Moveset,
  TurnBoardRow,
  TurnEvent,
  TurnEventRow,
  UnitKey,
} from '../lens/types';
import type { BoardSnapshot, Game } from '../types/battlesnake';
import { MIXED_SCENARIO, buildBoard } from './local-game';
/** The three fields the two sources are entitled to disagree about, removed. */
import { comparableFrame as comparable } from './board-fixtures';

const GAME = 'gate-g-l1';
const TURN = 1;
const SEED = 1;
const NODES = 550;

const META: Game = {
  id: GAME,
  ruleset: { name: 'standard', version: 'v1', settings: {} },
  map: 'standard',
  timeout: 500,
  source: 'gate',
};

/** The S→C envelope of 04 §4.5, exactly as `broadcastLensFrames` sends it. */
interface LensFramesEnvelope {
  readonly type: 'lens-frames';
  readonly gameId: string;
  readonly turn: number;
  readonly events: ReadonlyArray<TurnEvent>;
  readonly head: boolean;
}

interface Recorded {
  /** What the live client received, in the order it received it — through
   *  `JSON.stringify`, because that is what a websocket send is. */
  readonly envelopes: ReadonlyArray<LensFramesEnvelope>;
  /** The same envelopes before the wire encoded them, for the symmetry check. */
  readonly sent: ReadonlyArray<LensFramesEnvelope>;
  /** What storage holds: `turn_events` rows and the turn's `turn_boards` row. */
  readonly eventRows: ReadonlyArray<TurnEventRow>;
  readonly boardRow: TurnBoardRow;
  /** The projection the live writer queued, for gate 8's in-process form. */
  readonly projected: ReturnType<typeof projectMovesets>;
}

/** `jsonb` and the socket, in one line — the SHIPPED codec, so anything an
 *  encoding cannot carry dies here rather than in production: a `Map` becomes
 *  `{}` and an `undefined` key vanishes, while a non-finite bound is named and
 *  restored rather than flattened to null. */
function stored<T>(row: T): T {
  return reviveLens(JSON.parse(lensStringify(row)) as T);
}

/**
 * THE SERVER SIDE, assembled out of the three functions the active game
 * manager assembles it out of: one `seq` writer per `(gameId, turn)`, the
 * kernel's frames ingested through it, and the projection re-folded whenever a
 * reservoir frame lands. What the manager adds on top is a database queue and
 * a socket, and both of them are replaced here by a list.
 */
async function record(drill = false): Promise<Recorded> {
  const board = buildBoard({ ...MIXED_SCENARIO, seed: SEED });
  const settlement: BoardSnapshot = { game: META, turn: TURN, board };
  const roster = (board.snakes ?? []).map((s) => s.id);

  // The substrate the run will build, built again here for the ONE translation
  // the sink owes: `EmitRecord.plan` is keyed by substrate unit number, and a
  // stored substrate number cannot be read one turn later. Same board, same
  // team, same modelled set, so the same numbering.
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  const ours = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const sub = makeSubstrate({
    gameId: GAME,
    board,
    turn: TURN,
    asTeam: teamId,
    modeled: ours,
  });

  const writer = makeSeqWriter(GAME, TURN);
  const eventRows: TurnEventRow[] = [];
  const envelopes: LensFramesEnvelope[] = [];
  const sent: LensFramesEnvelope[] = [];
  let batch: TurnEvent[] = [];

  /** The wire is a BATCH envelope, flushed at each emission barrier and each
   *  operator event — 04 §4.5, and what the manager's outbox does. */
  function flush(): void {
    if (batch.length === 0) return;
    const envelope: LensFramesEnvelope = {
      type: 'lens-frames',
      gameId: GAME,
      turn: TURN,
      events: batch,
      head: true,
    };
    sent.push(envelope);
    // THE WIRE IS JSON. A client holds what `JSON.parse(JSON.stringify(...))`
    // gives it and never the object the server built, so the live side of this
    // gate must hold that too — otherwise the gate compares an in-memory
    // object against a stored one and reports the encoding as a drift.
    envelopes.push(stored(envelope));
    batch = [];
  }

  function persist(event: TurnEvent): void {
    // The anchor's settlement is dropped on the way to storage — `turn_boards`
    // holds it under its own key, and a board stored twice is two boards
    // waiting to disagree. This is `logStoredEvent`, in one line.
    if (event.kind !== 'board.arrived') {
      eventRows.push(stored(encodeEventRow(event)));
      return;
    }
    const payload = { ...(event.payload as Record<string, unknown>) };
    delete payload.settlement;
    eventRows.push(stored(encodeEventRow({ ...event, payload })));
  }

  const t0Wall = 1_700_000_000_000;
  const anchor = writer.write({
    gameId: GAME,
    turn: TURN,
    atWall: t0Wall,
    atWorkMs: null,
    kind: 'board.arrived',
    actor: { kind: 'server', id: null, name: null, color: null },
    unit: null,
    causedBy: null,
    answers: null,
    payload: {
      boardHash: 'hash:gate',
      deadlineMs: 150,
      turnExpiryTime: t0Wall + 500,
      roster,
      alive: roster,
      settlement,
    },
  });
  persist(anchor);
  batch.push(anchor);
  flush();

  const context = {
    t0AtWall: t0Wall,
    unitKeyOf: (unitId: number): UnitKey | null => unitKeyOf(sub, unitId),
  };

  try {
    await recordLensRun({
      scenario: 'mixed',
      seed: SEED,
      nodes: NODES,
      turns: 1,
      // The parity run does not drill; the run below does. A recorded drill
      // is the fact 09 §A6 says the log never held.
      drill,
      // The operator's command is written to the log FIRST and the kernel is
      // handed the id it was written under, which is the order production
      // wires: an answer cannot precede its question in a total order.
      command: (event, atWorkMs) => {
        const verb = event.kind;
        const unitId = verb === 'pin' ? event.pin.unitId : event.unitId;
        const key = unitKeyOf(sub, unitId);
        const to = verb === 'pin' ? event.pin.to : -1;
        const written = writer.write({
          gameId: GAME,
          turn: TURN,
          atWall: t0Wall + atWorkMs,
          atWorkMs: null,
          kind: verb === 'pin' ? 'pin' : 'unpin',
          actor: { kind: 'operator', id: 'ada', name: 'Ada', color: '#7c4dff' },
          unit: key,
          causedBy: null,
          answers: null,
          payload: { unit: key, to, tentative: false },
        });
        persist(written);
        batch.push(written);
        flush();
        return written.id;
      },
      sink: (event: LensEvent) => {
        for (const written of ingestLensEvents(writer, [event], context)) {
          persist(written);
          batch.push(written);
        }
        if (event.kind === 'emission' || event.kind === 'operator') flush();
      },
    });
  } finally {
    sub.release();
  }
  flush();

  return {
    envelopes,
    sent,
    eventRows,
    boardRow: {
      gameId: GAME,
      turn: TURN,
      settlement,
      boardHash: 'hash:gate',
      deadlineMs: 150,
      roster,
    },
    projected: projectMovesets(`${GAME}:${TURN}`, writer.written),
  };
}

/**
 * THE FIRST PATH ON WHICH TWO OBJECTS DISAGREE, or null.
 *
 * Written out rather than delegated to `toEqual` because the gate's whole
 * value is in the message: a `LensFrame` carries a board, a partition, a
 * reservoir and the turn's event list, and "the objects differ" about that is
 * a report nobody can act on. `NaN` compares equal to itself here — it is a
 * legitimate reading in a lattice with an unmeasured channel, and a walker
 * that called two NaNs different would fail on correct data.
 */
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return null;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path || '<root>'}: live ${JSON.stringify(a)} ≠ replay ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `${path}: one side is an array and the other is not`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return `${path}: live has ${a.length} entries, replay has ${b.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    const found = firstDifference(left[key], right[key], path ? `${path}.${key}` : key);
    if (found !== null) return found;
  }
  return null;
}

describe('G-L1 — a recorded session replays to identical frames', () => {
  let session: Recorded;

  beforeAll(async () => {
    session = await record();
  }, 180_000);

  it('recorded a real decision: envelopes on the wire and rows in storage', () => {
    expect(session.envelopes.length).toBeGreaterThan(1);
    expect(session.eventRows.length).toBeGreaterThan(4);
    const kinds = new Set(session.eventRows.map((r) => r.kind));
    // The four producers the gate is about: the turn's anchor, the kernel's
    // partition and emission, and the operator. Without all four the parity
    // claim is about a stream too thin to have drifted.
    expect(kinds.has('board.arrived')).toBe(true);
    expect(kinds.has('partition')).toBe(true);
    expect(kinds.has('emission')).toBe(true);
    expect(kinds.has('operator')).toBe(true);
  });

  it('the wire and storage carry the SAME events, in the same order', () => {
    const wire = session.envelopes.flatMap((e) => e.events);
    expect(wire.map((e) => e.seq)).toEqual(session.eventRows.map((r) => r.seq));
    // Gapless and monotone from the anchor: one writer, one order (O6).
    expect(wire.map((e) => e.seq)).toEqual(wire.map((_, i) => i));
  });

  it('is deep-equal at EVERY seq the live client visited', () => {
    // THE LIVE CLIENT: the events as the socket delivered them, folded by the
    // page's own entry point. The anchor still carries the settlement here —
    // it came over the wire — which is exactly the asymmetry the replay side
    // has to reconstruct.
    const wire = session.envelopes.flatMap((e) => e.events);

    // THE REPLAY READER: the store rebuilt from the rows alone, through the
    // same decode production reads them with.
    const replayStore = storeFromRows(
      session.boardRow,
      session.eventRows.map((row) => decodeEventRow(row))
    );

    const differences: string[] = [];
    for (const event of wire) {
      const live = frameAtSeq(wire, event.seq, true);
      const replay = makeReplayDecisionSource({
        store: replayStore,
        at: { gameId: GAME, turn: TURN, seq: event.seq },
      }).frame();
      const found = firstDifference(comparable(live), comparable(replay));
      if (found !== null) differences.push(`seq ${event.seq} (${event.kind}) — ${found}`);
    }
    expect(differences).toEqual([]);
  });

  it('differs in exactly the three badge fields, and they carry real content', () => {
    const wire = session.envelopes.flatMap((e) => e.events);
    const last = wire[wire.length - 1] as TurnEvent;
    const replayStore = storeFromRows(
      session.boardRow,
      session.eventRows.map((row) => decodeEventRow(row))
    );
    const live = frameAtSeq(wire, last.seq, true);
    const replay = makeReplayDecisionSource({
      store: replayStore,
      at: { gameId: GAME, turn: TURN, seq: last.seq },
    }).frame();
    expect(live.at.mode).toBe('live-head');
    expect(live.at.isHead).toBe(true);
    expect(replay.at.mode).toBe('replay');
    expect(replay.at.isHead).toBe(false);
    expect(replay.provenance.kind).toBe('observed');
    // And the frame is not empty on either side — a parity claim about two
    // empty objects is a claim about nothing.
    expect(replay.partition.length).toBeGreaterThan(0);
    expect(Object.keys(replay.movesets).length).toBeGreaterThan(0);
    expect(replay.board.board.snakes?.length ?? 0).toBeGreaterThan(0);
  });

  it('names the seq and the field when a stored row has drifted', () => {
    // The gate's own failure mode, exercised: one row is corrupted the way a
    // dropped column would corrupt it, and the report must say WHERE.
    const wire = session.envelopes.flatMap((e) => e.events);
    const rows = session.eventRows.map((row) => decodeEventRow(row));
    const target = rows.findIndex((e) => e.kind === 'emission');
    expect(target).toBeGreaterThan(-1);
    const broken = rows.map((e, i) =>
      i === target
        ? { ...e, payload: { ...(e.payload as object), lo: -12345 } }
        : e
    );
    const seq = (rows[target] as TurnEvent).seq;
    const live = frameAtSeq(wire, seq, true);
    const replay = makeReplayDecisionSource({
      store: storeFromRows(session.boardRow, broken),
      at: { gameId: GAME, turn: TURN, seq },
    }).frame();
    const found = firstDifference(comparable(live), comparable(replay));
    expect(found).not.toBeNull();
    expect(found).toContain('-12345');
  });

  it('carries a non-finite bound through both encodings, losslessly', () => {
    // `+∞` on an unproved upper bound and `NaN` on an unmeasured channel are
    // ordinary readings on this bot's scale, and plain JSON turns both into
    // `null` — which reads as "unmeasured" and erases the difference the whole
    // bound vocabulary exists to keep. Both hops name them instead.
    const wire = session.envelopes.flatMap((e) => e.events);
    const rows = session.eventRows.map((row) => decodeEventRow(row));
    const bySeq = new Map(rows.map((e) => [e.seq, e]));
    for (const event of wire) {
      // The ANCHOR is the one deliberate asymmetry and it is the opposite of a
      // loss: the wire carries the settlement so a live fold has a board to
      // draw, storage does not because `turn_boards` holds it under its own
      // key, and `storeFromRows` puts it back. A board stored twice is two
      // boards waiting to disagree.
      if (event.kind === 'board.arrived') continue;
      const row = bySeq.get(event.seq);
      expect(row).toBeDefined();
      expect(JSON.stringify(event.payload)).toBe(JSON.stringify((row as TurnEvent).payload));
    }
    // And a real decision DOES produce one, so the check above is testing
    // something rather than passing vacuously — on the wire, after the round
    // trip, not merely in the object the server built.
    const nonFinite = wire.some((e) =>
      Object.values((e.payload ?? {}) as Record<string, unknown>).some(
        (v) => typeof v === 'number' && !Number.isFinite(v)
      )
    );
    expect(nonFinite).toBe(true);
  });

  it("gate 8 — the projection rebuilds byte-identically from the stored rows", () => {
    // 05 §(d) 8, in process: the licence the `movesets` table lives under is
    // that `DELETE` plus the rebuild command reproduces it from `turn_events`.
    // The command's fold and the writer's fold are the same function, so what
    // is proved here is that the STORED bytes are enough to run it — which is
    // the half a live database cannot check without one.
    const rebuilt = rebuildMovesets(`${GAME}:${TURN}`, session.eventRows);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(session.projected));
  });
});

/**
 * THE DRILLED ROW IS A RECORDED FACT (09 §A6).
 *
 * `explainMoveset` used to answer the asking socket and emit nothing: the
 * fold's `breakdown` was `{}` by construction, so the BREAKDOWN panel — and
 * with it the MANDATORY joint-residual row (01 §3.3's Law C2) — had never been
 * drawn in production, live or in replay, and `[B] to price this row` was the
 * only state the panel had ever been in.
 *
 * The run below scripts the operator's drill, and the answer travels the whole
 * pipe:
 * kernel sink → the one `seq` writer → the wire envelope → the stored row →
 * the replay reader. The claim is the panel's, not the number's: the same
 * breakdown, with its residual, on both sides of the seam.
 */
describe('a recorded drill folds into the frame, live and in replay', () => {
  let session: Recorded;

  beforeAll(async () => {
    session = await record(true);
  }, 180_000);

  it('records the drill as its own event, on the wire and in storage', () => {
    const wire = session.envelopes.flatMap((e) => e.events);
    expect(wire.some((e) => e.kind === 'breakdown')).toBe(true);
    expect(session.eventRows.some((r) => r.kind === 'breakdown')).toBe(true);
  });

  it('folds it under the moveset key, with the joint residual on the row', () => {
    const wire = session.envelopes.flatMap((e) => e.events);
    const last = wire[wire.length - 1] as TurnEvent;
    const live = frameAtSeq(wire, last.seq, true);
    const keys = Object.keys(live.breakdown);
    expect(keys.length).toBeGreaterThan(0);
    const breakdown = live.breakdown[keys[0] as string];
    expect(breakdown).toBeDefined();
    // LEVEL 1, LEVEL 2 and the residual: the three the model names, and the
    // residual is present whatever it reads — a zero cross term is a finding.
    expect(breakdown?.aggregate).not.toBeNull();
    expect(breakdown?.marginals.length).toBeGreaterThan(0);
    expect(typeof breakdown?.residual.total.lo).toBe('number');
    expect(Array.isArray(breakdown?.residual.features)).toBe(true);
  });

  it('the panel draws the same rows off the stored bytes', () => {
    const wire = session.envelopes.flatMap((e) => e.events);
    const last = wire[wire.length - 1] as TurnEvent;
    const replayStore = storeFromRows(
      session.boardRow,
      session.eventRows.map((row) => decodeEventRow(row))
    );
    const live = frameAtSeq(wire, last.seq, true);
    const replay = makeReplayDecisionSource({
      store: replayStore,
      at: { gameId: GAME, turn: TURN, seq: last.seq },
    }).frame();
    expect(JSON.stringify(replay.breakdown)).toBe(JSON.stringify(live.breakdown));

    // AND IT REACHES THE TRANSCRIPT. The cursor is walked to the drilled row
    // the way an operator walks to it — focus a member, take its destination,
    // name the row — and the joint row must be in the ops on both sides.
    const key = Object.keys(live.breakdown)[0] as string;
    const row = Object.values(live.movesets)
      .flat()
      .find((r) => r.key === key);
    expect(row).toBeDefined();
    const move = (row as Moveset).moves[0] as { unit: UnitKey; to: number };
    const walk = (frame: LensFrame): DrawTranscript =>
      renderFrame(
        frame,
        [
          { t: 'focus', unit: move.unit },
          { t: 'candidate', to: move.to },
          { t: 'moveset', key },
        ].reduce<LensCursor>(
          (c, e) => applyCursorEvent(c, frame, e as CursorEvent),
          initialCursor()
        )
      );
    for (const [side, transcript] of [
      ['live', walk(live)],
      ['replay', walk(replay)],
    ] as const) {
      expect(`${side}:${transcript.some((c) => c.op === 'panel.breakdown')}`).toBe(`${side}:true`);
      expect(`${side}:${transcript.some((c) => c.op === 'panel.breakdown.residual')}`).toBe(
        `${side}:true`
      );
      expect(transcript.some((c) => c.op === 'panel.breakdown.pending')).toBe(false);
    }
  });

  it('leaves the movesets projection exactly as it was — a breakdown is not a row', () => {
    const rebuilt = rebuildMovesets(`${GAME}:${TURN}`, session.eventRows);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(session.projected));
    expect(session.eventRows.some((r) => r.kind === 'breakdown')).toBe(true);
  });
});
