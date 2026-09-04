/**
 * LIVE AND REPLAY, OVER ONE REDUCER — the data side of Law C.
 *
 * `lens-view-model.test.ts` asserts the same property at the renderer, over a
 * recorded session, and is the U track's to make green. This file asserts it
 * where it is cheap and where it is actually decided: the two sources are one
 * function with two stamps, so there is no second fold to drift, and the ONLY
 * fields they may differ on are `at.mode`, `at.isHead` and `provenance.kind` —
 * all three content the operator is entitled to, rendered as a badge.
 *
 * It also exercises the kernel seam with a TEST DOUBLE. `KernelLensPort` and
 * `LensSink` are declared in the frozen `types.ts` precisely so the storage
 * track can be built against them before the kernel track lands: the sink's
 * events go through the one `seq` writer, and the projection they produce
 * rebuilds byte-identically from the stored rows. When K's real sink arrives
 * it satisfies the same two declarations, and nothing here has to change.
 */

import {
  applyEvent,
  emptyStore,
  encodeEventRow,
  ingestLensEvents,
  makeSeqWriter,
  projectMovesets,
  rebuildMovesets,
} from '../lens/store';
import { makeLiveSource, makeReplaySource } from '../lens/store/sources';
import type {
  ClusterView,
  EmitRecord,
  FrameStore,
  KernelLensPort,
  LensEvent,
  LensFrame,
  LensSink,
  Moveset,
  TurnEvent,
} from '../lens/types';
import {
  FIXTURE_GAME,
  anchorEvent,
  clusterView,
  moveset,
  operatorActor,
  turnEvent,
} from './lens-fixtures';

const TURN = 1;
const ANCHOR = anchorEvent();
const UNIT = 'A-A';

const STREAM: ReadonlyArray<TurnEvent> = [
  turnEvent({ kind: 'decision.begin', seq: 1, payload: { decisionId: 'd1', input: {} } }),
  turnEvent({
    kind: 'partition',
    seq: 2,
    atWorkMs: 0,
    payload: {
      generation: 0,
      epoch: 0,
      posture: 'SIGHTED',
      clusters: [clusterView({ id: 0, members: [UNIT] })],
      changes: [],
    },
  }),
  turnEvent({
    kind: 'stage.requested',
    seq: 3,
    unit: UNIT,
    payload: { unit: UNIT, to: 20, source: 'bot' },
  }),
  turnEvent({
    kind: 'movesets',
    seq: 4,
    atWorkMs: 11,
    payload: {
      cluster: 0,
      generation: 0,
      emissionSeq: 5,
      complementKey: 'comp:live',
      rows: [moveset({ rank: 1, lo: 3, est: 4, hi: 6, units: [UNIT], staged: true })],
    },
  }),
  turnEvent({
    kind: 'pin',
    seq: 5,
    actor: operatorActor('ada'),
    unit: UNIT,
    payload: { unit: UNIT, to: 20, tentative: false },
  }),
];

function storeOf(events: ReadonlyArray<TurnEvent>): FrameStore {
  return events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(ANCHOR));
}

/** Everything the two sources are NOT entitled to disagree about. */
function withoutBadges(frame: LensFrame): unknown {
  const { at, provenance, ...rest } = frame;
  const atRest: Record<string, unknown> = { ...at };
  delete atRest.mode;
  delete atRest.isHead;
  const provenanceRest: Record<string, unknown> = { ...provenance };
  delete provenanceRest.kind;
  return { ...rest, at: atRest, provenance: provenanceRest };
}

describe('a live source and a replay source fold to the same frame', () => {
  const store = storeOf(STREAM);
  const at = { gameId: FIXTURE_GAME, turn: TURN, seq: 5 };

  it('agrees on every field but the three badges', () => {
    const live = makeLiveSource({ store, at, isHead: true }).frame();
    const replay = makeReplaySource({ store, at }).frame();
    expect(withoutBadges(replay)).toEqual(withoutBadges(live));
  });

  it('differs on exactly the three badges, and they are CONTENT', () => {
    const live = makeLiveSource({ store, at, isHead: true }).frame();
    const replay = makeReplaySource({ store, at }).frame();
    expect(live.at.mode).toBe('live-head');
    expect(replay.at.mode).toBe('replay');
    expect(live.at.isHead).toBe(true);
    expect(replay.at.isHead).toBe(false);
    // Both are observations of a decision that happened. `rerun` is stamped
    // where a re-derivation is produced, and it is never a refusal.
    expect(live.provenance.kind).toBe('observed');
    expect(replay.provenance.kind).toBe('observed');
  });

  it('scrubbing a live source is the same fold, loudly not at the head', () => {
    const scrubbed = makeLiveSource({ store, at: { ...at, seq: 3 }, isHead: false }).frame();
    expect(scrubbed.at.mode).toBe('live-scrub');
    expect(scrubbed.at.isHead).toBe(false);
    // Determinations are legal iff `isHead`; the frame still carries the whole
    // state at that seq rather than being blanked.
    expect(withoutBadges(scrubbed)).toEqual(
      withoutBadges(makeReplaySource({ store, at: { ...at, seq: 3 } }).frame())
    );
  });

  it('reaches the same frame whether the events arrived one at a time or all at once', () => {
    const incremental = makeLiveSource({ store: emptyStore(ANCHOR), at, isHead: true });
    for (const event of STREAM) incremental.ingest(event);
    expect(withoutBadges(incremental.frame())).toEqual(
      withoutBadges(makeReplaySource({ store, at }).frame())
    );
  });

  it('refuses a duplicate seq rather than folding it twice', () => {
    const source = makeLiveSource({ store: emptyStore(ANCHOR), at, isHead: true });
    for (const event of STREAM) source.ingest(event);
    for (const event of STREAM) source.ingest(event);
    expect(source.frame().events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('an ask with no running kernel is a typed refusal, never silence', () => {
  const store = storeOf(STREAM);
  const at = { gameId: FIXTURE_GAME, turn: TURN, seq: 5 };

  it('refuses a conditional off the head', async () => {
    const source = makeReplaySource({ store, at });
    const answer = await source.conditional({
      cluster: 0,
      clusterGeneration: 0,
      lock: { unit: UNIT, to: 20 },
    });
    expect(answer).toMatchObject({ ok: false, refusal: 'off-head' });
    expect((answer as { detail: string }).detail.length).toBeGreaterThan(0);
  });

  it('refuses a breakdown off the head', async () => {
    const answer = await makeReplaySource({ store, at }).breakdown('m:0/0/0/0');
    expect(answer).toMatchObject({ ok: false, refusal: 'off-head' });
  });

  it('refuses a conditional whose generation has been superseded', async () => {
    const port: KernelLensPort = {
      partition: () => [clusterView({ id: 0, members: [UNIT], generation: 4 }) as ClusterView],
      movesets: () => [],
      rankConditional: () => ({
        ok: true,
        cluster: 0,
        locks: [{ unit: UNIT, to: 20 }],
        clusterAfter: clusterView({ id: 0, members: [UNIT], generation: 4 }),
        rows: [],
        source: 'speculative-context',
        cursor: 1,
        provisional: true,
        degraded: false,
        contextKey: 'spec:[A-A@20]',
        final: false,
      }),
      explainMoveset: async () => ({ ok: false, refusal: 'reserve-spent', detail: 'spent' }),
      reserve: { budgetMs: 20, spentMs: 0, queued: 0 },
    };
    const answer = await makeLiveSource({ store, at, isHead: true, port }).conditional({
      cluster: 0,
      clusterGeneration: 0,
      lock: { unit: UNIT, to: 20 },
    });
    expect(answer).toMatchObject({ ok: false, refusal: 'generation-superseded' });
  });
});

/**
 * The kernel seam, before the kernel. `LensSink` is the declaration K fills;
 * this double emits the same event shapes so the writer, the codecs and the
 * projection are exercised end to end on the storage side alone.
 */
function emitRecord(over: Partial<EmitRecord> = {}): EmitRecord {
  return {
    plan: new Map(),
    lo: 3,
    est: 4,
    hi: 6,
    horizon: 1,
    slack: 3,
    posture: 'SIGHTED',
    assumptions: [],
    epoch: 0,
    elapsedMs: 12,
    ...over,
  };
}

describe('the kernel sink, through the one writer', () => {
  function run(): { events: ReadonlyArray<TurnEvent>; rows: ReadonlyArray<Moveset> } {
    const writer = makeSeqWriter(FIXTURE_GAME, TURN);
    writer.write({
      gameId: FIXTURE_GAME,
      turn: TURN,
      atWall: 1_700_000_000_000,
      atWorkMs: null,
      kind: 'board.arrived',
      actor: { kind: 'server', id: null, name: null, color: null },
      unit: null,
      causedBy: null,
      answers: null,
      payload: { boardHash: 'h', deadlineMs: 150, turnExpiryTime: 0, roster: [UNIT], alive: [UNIT] },
    });

    const rows = [moveset({ rank: 1, lo: 3, est: 4, hi: 6, units: [UNIT], staged: true })];
    const frames: LensEvent[] = [
      {
        kind: 'partition',
        at: 0,
        epoch: 0,
        posture: 'SIGHTED',
        clusters: [clusterView({ id: 0, members: [UNIT] })],
        changes: [],
        cause: 'decision-start',
      },
      { kind: 'emission', at: 12, record: emitRecord() },
      { kind: 'movesets', at: 13, clusterId: 0, rows, complementKey: 'comp:live', loud: null },
      { kind: 'posture', at: 20, from: 'SIGHTED', to: 'FOGGED-DISCRIMINATING', channel: 'est' },
      { kind: 'refusal', at: 21, refusal: 'ratchet-floor', planKey: 'plan:2' },
    ];

    // The sink K provides has this exact type; nothing below knows it is a
    // double, which is the point of writing against the declaration.
    const collected: LensEvent[] = [];
    const sink: LensSink = (e) => collected.push(e);
    for (const frame of frames) sink(frame);

    ingestLensEvents(writer, collected);
    return { events: writer.written, rows };
  }

  it('stamps a gapless, monotone seq across the anchor and every frame', () => {
    const { events } = run();
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.map((e) => e.kind)).toEqual([
      'board.arrived',
      'partition',
      'emission',
      'movesets',
      'posture',
      'refusal',
    ]);
  });

  it('keeps the kernel clock on every frame and null on everything outside one', () => {
    const { events } = run();
    expect(events[0].atWorkMs).toBeNull();
    for (const event of events.slice(1)) expect(typeof event.atWorkMs).toBe('number');
  });

  it("names the movesets frame's emission, so a row knows which emission it is about", () => {
    const { events } = run();
    const emission = events.find((e) => e.kind === 'emission') as TurnEvent;
    const frame = events.find((e) => e.kind === 'movesets') as TurnEvent;
    expect((frame.payload as { emissionSeq: number }).emissionSeq).toBe(emission.seq);
  });

  it('projects, and rebuilds byte-identically from the stored rows', () => {
    const { events } = run();
    const projected = projectMovesets('d1', events);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.staged).toBe(true);
    expect(JSON.stringify(rebuildMovesets('d1', events.map(encodeEventRow)))).toBe(
      JSON.stringify(projected)
    );
  });

  it('leaves the emission moves empty rather than storing a substrate number', () => {
    // `EmitRecord.plan` is keyed by SUBSTRATE unit id, which is meaningless one
    // turn later. Without the translation the sink owes, the honest answer is
    // an empty list and the staged assignment read off the movesets frame
    // beside it — never a number nobody can resolve.
    const { events } = run();
    const emission = events.find((e) => e.kind === 'emission') as TurnEvent;
    expect((emission.payload as { moves: unknown[] }).moves).toEqual([]);
    expect(JSON.stringify(emission)).not.toMatch(/"unitId"/);
  });
});
