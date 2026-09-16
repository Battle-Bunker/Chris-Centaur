/**
 * ROUND-TRIP AND PROJECTION.
 *
 * Four claims, and the fourth is the one that licenses a table to exist at all.
 *
 *   1. Every `TurnEvent` kind survives write → read BYTE-IDENTICALLY through
 *      `turn_events.payload`. The payload is the event verbatim, so live and
 *      replay fold identical bytes (02 D-d).
 *   2. `DecisionInput` round-trips — it is the audit seed and the seed of every
 *      lazy re-derivation, and a seed that does not survive storage is not one.
 *   3. `unit_outcomes` reconstructs the per-unit result without the blob
 *      `decision_logs` used to carry.
 *   4. THE `movesets` TABLE EQUALS THE FOLD OF THE `movesets` FRAMES, and the
 *      rebuild command regenerates it byte-identically after a `DELETE`.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is a materialised table drifting
 * from its source — the exact defect that killed `command_turn_states`, which
 * was a copy of the fold's OUTPUT kept beside the inputs that generate it. The
 * general rule 04 §2.7 settles is that such a table is legitimate IFF a
 * boundary test asserts the fold reproduces it and a rebuild command exists.
 * This file is that test, and the operator-attribution property that
 * `command-logging.test.ts` used to carry is re-asserted at the bottom.
 */

import {
  decodeDecisionInput,
  decodeEventRow,
  encodeDecisionInput,
  encodeEventRow,
  foldForRetention,
  projectMovesets,
  rebuildMovesets,
  reconstructUnitOutcomes,
} from '../lens/store';
import type { TurnEvent, TurnEventKind } from '../lens/types';
import {
  FIXTURE_GAME,
  anchorEvent,
  clusterView,
  decisionInput,
  moveset,
  operatorActor,
  turnEvent,
} from './lens-fixtures';

const TURN = 1;
const DECISION = 'd:lens-fixture:1';
const UNIT = 'A-A';

/** One event of EVERY kind 04 §4.2 names. A kind with no case here is a kind
 *  whose round-trip nobody has checked. */
const ONE_OF_EACH: ReadonlyArray<TurnEvent> = [
  anchorEvent(),
  turnEvent({ kind: 'stage.fastpass', seq: 1, unit: UNIT, payload: { unit: UNIT, to: 20, source: 'fastpass' } }),
  turnEvent({ kind: 'decision.begin', seq: 2, payload: { decisionId: DECISION, input: decisionInput() } }),
  turnEvent({
    kind: 'partition',
    seq: 3,
    atWorkMs: 1,
    payload: { generation: 0, epoch: 0, posture: 'SIGHTED', clusters: [clusterView()], changes: [] },
  }),
  turnEvent({
    kind: 'movesets',
    seq: 4,
    atWorkMs: 7,
    payload: {
      cluster: 0,
      generation: 0,
      emissionSeq: 5,
      complementKey: 'comp:live',
      rows: [moveset({ rank: 1, lo: 12.4, est: 12.9, hi: 15.3, staged: true })],
    },
  }),
  turnEvent({
    kind: 'emission',
    seq: 5,
    atWorkMs: 9,
    payload: { planKey: 'plan:1', lo: 12.4, est: 12.9, hi: 15.3, slack: 3, horizon: 1, epoch: 0 },
  }),
  turnEvent({
    kind: 'operator',
    seq: 6,
    actor: operatorActor('ada'),
    unit: UNIT,
    atWorkMs: 11,
    payload: { verb: 'pin', arrivedAtWorkMs: 10, epoch: 1, latencyMs: 18, slicesBefore: 0 },
  }),
  turnEvent({ kind: 'posture', seq: 7, payload: { from: 'SIGHTED', to: 'FOGGED-DISCRIMINATING', channel: 'est' } }),
  turnEvent({
    kind: 'conditional',
    seq: 8,
    payload: {
      requestId: 'r1',
      cluster: 0,
      generation: 0,
      locks: [{ unit: UNIT, to: 20 }],
      rows: [moveset()],
      source: 'speculative-context',
      cursor: 2,
      final: false,
    },
  }),
  // THE DRILLED ROW. `aggregate` is level 1, `marginals` level 2, and the
  // `residual` is `aggregate − Σ marginals` — mandatory, and carried even
  // when it is zero (Law C2).
  turnEvent({
    kind: 'breakdown',
    seq: 23,
    atWorkMs: 12,
    payload: {
      moveset: 'ms:0:1',
      basis: 'basis:[]',
      aggregate: {
        profile: 'territory',
        bound: { lo: 12.4, est: 12.9, hi: 15.3 },
        features: [{ key: 'space', value: { lo: 1, est: 1.5, hi: 2 }, weight: 3, contribution: { lo: 3, est: 4.5, hi: 6 } }],
        exact: false,
        ledgerSize: 4,
      },
      marginals: [
        {
          unit: UNIT,
          delta: { lo: 1.1, est: 1.4, hi: 1.9 },
          features: [{ key: 'space', delta: { lo: 0.4, est: 0.5, hi: 0.7 } }],
          against: { to: 21 },
        },
      ],
      residual: { total: { lo: 0.3, est: 0.4, hi: 0.6 }, features: [{ key: 'space', delta: { lo: 0.1, est: 0.1, hi: 0.2 } }] },
    },
  }),
  turnEvent({ kind: 'refusal', seq: 9, payload: { refusal: 'ratchet-floor', planKey: 'plan:2' } }),
  turnEvent({
    kind: 'operator.command',
    seq: 10,
    actor: operatorActor('ben'),
    unit: UNIT,
    payload: { verb: 'goto-set', target: UNIT, detail: { cells: [20, 21] } },
  }),
  turnEvent({ kind: 'pin', seq: 11, actor: operatorActor('ada'), unit: UNIT, payload: { unit: UNIT, to: 20, tentative: false } }),
  turnEvent({ kind: 'unpin', seq: 12, actor: operatorActor('ben'), unit: UNIT, payload: { unit: UNIT, to: 20, tentative: false } }),
  turnEvent({ kind: 'commit', seq: 13, actor: operatorActor('ada'), unit: UNIT, payload: { unit: UNIT, to: 20, tentative: false } }),
  turnEvent({ kind: 'pin.refused', seq: 14, unit: UNIT, payload: { unit: UNIT, to: 99, reason: 'pin-unreachable' } }),
  turnEvent({ kind: 'stage.requested', seq: 15, unit: UNIT, payload: { unit: UNIT, to: 20, source: 'kernel' } }),
  turnEvent({ kind: 'stage.confirmed', seq: 16, unit: UNIT, payload: { unit: UNIT, to: 20, source: 'kernel', serverTs: 5 } }),
  turnEvent({ kind: 'stage.retry', seq: 17, unit: UNIT, payload: { unit: UNIT, to: 20, source: 'kernel', why: 'readback-mismatch' } }),
  turnEvent({ kind: 'commit.observed', seq: 18, unit: UNIT, payload: { unit: UNIT } }),
  turnEvent({
    kind: 'advice',
    seq: 19,
    unit: UNIT,
    payload: { unit: UNIT, costLo: 0.2, costHi: 1.1, degraded: false, basis: 'basis:[]' },
  }),
  turnEvent({
    kind: 'selection',
    seq: 20,
    actor: operatorActor('ada'),
    unit: UNIT,
    payload: { cluster: 0, unit: UNIT, candidate: 20, hover: true },
  }),
  turnEvent({
    kind: 'decision.end',
    seq: 21,
    payload: { decisionId: DECISION, abandoned: false, stagedNothing: false, summary: { emits: 3 } },
  }),
  turnEvent({
    kind: 'turn.resolved',
    seq: 22,
    payload: { moves: [{ unit: UNIT, to: 20 }], deaths: [], winners: [] },
  }),
];

describe('every kind survives the row round-trip byte-identically', () => {
  it('covers every TurnEventKind the model names', () => {
    const kinds: ReadonlyArray<TurnEventKind> = [
      'partition', 'movesets', 'emission', 'operator', 'posture', 'conditional', 'breakdown',
      'refusal',
      'board.arrived', 'stage.fastpass', 'decision.begin', 'decision.end', 'operator.command',
      'pin', 'unpin', 'commit', 'pin.refused', 'stage.requested', 'stage.confirmed',
      'stage.retry', 'commit.observed', 'advice', 'selection', 'turn.resolved',
    ];
    expect(new Set(ONE_OF_EACH.map((e) => e.kind))).toEqual(new Set(kinds));
  });

  for (const event of ONE_OF_EACH) {
    it(`${event.kind} → row → event is the same bytes`, () => {
      const row = encodeEventRow(event);
      expect(JSON.stringify(decodeEventRow(row))).toBe(JSON.stringify(event));
      // `payload` is the event VERBATIM, not a projection of it.
      expect(JSON.stringify(row.payload)).toBe(JSON.stringify(event));
    });
  }

  it('keeps atWorkMs NULL, never 0, where nothing measured it', () => {
    const outside = ONE_OF_EACH.filter((e) => e.kind === 'operator.command');
    expect(outside.length).toBeGreaterThan(0);
    for (const e of outside) expect(encodeEventRow(e).atWorkMs).toBeNull();
  });

  it('indexes the columns it indexes without duplicating the payload', () => {
    const pin = ONE_OF_EACH.find((e) => e.kind === 'pin') as TurnEvent;
    const row = encodeEventRow(pin);
    expect(row.seq).toBe(pin.seq);
    expect(row.unitKey).toBe(pin.unit);
    expect(row.actorId).toBe('ada');
  });
});

describe('DecisionInput round-trips', () => {
  it('survives encode → decode unchanged', () => {
    const input = decisionInput({ initialPins: [{ unit: UNIT, to: 20 }] });
    expect(decodeDecisionInput(encodeDecisionInput(input))).toEqual(input);
  });

  it('stores WIRE-keyed pins and assumptions, never substrate numbers', () => {
    const raw = encodeDecisionInput(decisionInput({ initialPins: [{ unit: UNIT, to: 20 }] }));
    expect(JSON.stringify(raw)).toContain(UNIT);
    expect(JSON.stringify(raw)).not.toMatch(/"unitId"/);
  });
});

describe('unit_outcomes reconstructs the per-unit result', () => {
  it('carries staged, confirmed, committed and resolved without a blob', () => {
    const outcomes = reconstructUnitOutcomes(FIXTURE_GAME, TURN, ONE_OF_EACH);
    const row = outcomes.find((o) => o.unitKey === UNIT);
    expect(row).toBeDefined();
    expect(row?.stagedMove).toBe(20);
    expect(row?.confirmedMove).toBe(20);
    expect(row?.committed).toBe(true);
    expect(row?.resolvedMove).toBe(20);
    expect(row?.operatorId).toBe('ada');
  });
});

describe('the movesets table equals the fold, and the rebuild is exact', () => {
  it('projects the same rows the movesets frames carry', () => {
    const rows = projectMovesets(DECISION, ONE_OF_EACH);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[0]?.staged).toBe(true);
    expect(rows[0]?.lo).toBeCloseTo(12.4, 10);
  });

  it('regenerates byte-identically from turn_events after a DELETE', () => {
    const projected = projectMovesets(DECISION, ONE_OF_EACH);
    const rebuilt = rebuildMovesets(DECISION, ONE_OF_EACH.map(encodeEventRow));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(projected));
  });

  it('keeps the depth delta on every row and the LINE on the staged row only', () => {
    const rows = projectMovesets(DECISION, ONE_OF_EACH);
    for (const row of rows) {
      expect(typeof row.h1Lo).toBe('number');
      expect(typeof row.deepHorizon).toBe('number');
      if (!row.staged) expect(row.line).toBeNull();
    }
  });
});

describe('the retention fold leaves a turn inspectable', () => {
  it('keeps commands, pins, staging outcomes and decision begin/end', () => {
    const folded = foldForRetention(
      FIXTURE_GAME,
      TURN,
      ONE_OF_EACH,
      projectMovesets(DECISION, ONE_OF_EACH)
    );
    const kept = new Set(folded.kept.map((e) => e.kind));
    for (const kind of ['operator.command', 'pin', 'commit', 'stage.confirmed', 'decision.begin', 'decision.end'] as const) {
      expect(kept.has(kind)).toBe(true);
    }
  });

  it('drops refusals, non-staging emissions and every attention tick', () => {
    const folded = foldForRetention(
      FIXTURE_GAME,
      TURN,
      ONE_OF_EACH,
      projectMovesets(DECISION, ONE_OF_EACH)
    );
    const kept = new Set(folded.kept.map((e) => e.kind));
    expect(kept.has('refusal')).toBe(false);
    expect(kept.has('breakdown')).toBe(false);
    expect(folded.kept.some((e) => e.kind === 'selection' && (e.payload as { hover: boolean }).hover)).toBe(false);
    expect(folded.dropped).toBeGreaterThan(0);
  });

  it('keeps the board, the basis and the staged rows — retention is latency, not loss', () => {
    const folded = foldForRetention(
      FIXTURE_GAME,
      TURN,
      ONE_OF_EACH,
      projectMovesets(DECISION, ONE_OF_EACH)
    );
    expect(folded.kept.some((e) => e.kind === 'board.arrived')).toBe(true);
    expect(folded.stagedRows.every((r) => r.staged)).toBe(true);
    expect(folded.stagedRows.length).toBeGreaterThan(0);
  });
});

/** Re-homed from the deleted `command-logging.test.ts`, whose intent was right
 *  and whose mechanism — the denormalised `command_turn_states` snapshot — was
 *  not (04 §2.7, 05 §a). */
describe('every operator command names its issuing operator', () => {
  it('records an operator id, name and colour on every operator-actored row', () => {
    const operatorKinds: ReadonlyArray<TurnEventKind> = [
      'operator.command', 'pin', 'unpin', 'commit', 'selection',
    ];
    const rows = ONE_OF_EACH.filter((e) => operatorKinds.includes(e.kind)).map(encodeEventRow);
    expect(rows.length).toBe(operatorKinds.length);
    for (const row of rows) {
      expect(row.actorKind).toBe('operator');
      expect(row.actorId).not.toBeNull();
      expect(row.actorName).not.toBeNull();
      expect(row.actorColor).not.toBeNull();
    }
  });

  it('attributes an unpin to the operator who released it, not the one who pinned', () => {
    const unpin = encodeEventRow(ONE_OF_EACH.find((e) => e.kind === 'unpin') as TurnEvent);
    expect(unpin.actorId).toBe('ben');
  });
});
