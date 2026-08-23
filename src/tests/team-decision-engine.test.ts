/**
 * The team decision engine: one joint decision per team per turn, consuming
 * the wire surface exactly as documented and nothing wider.
 *
 * The SMOKE here is the build's end-to-end gate: a scripted 7×7 team decision
 * through the real trio with a pin event arriving MID-decision, asserting a
 * conforming staged set reaches the fake manager surface before the deadline.
 * Alongside it: the held-capacity ruling on a 3-team board that exceeds
 * MAX_FROZEN (declared modelling of the nearest units, never truncation), the
 * wire-policy derivation of the kernel's write interval, and the pin-advice
 * seam.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';
import { MAX_FROZEN } from '../partial-engine/index';
import type { PinEvent, UnitId } from '../lobster/contracts';
import { NO_ORDER_MOVE } from '../lobster/contracts';
import { TooManyHeldError, clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import type { KernelReport } from '../lobster/kernel';
import { adviseFromReport } from '../lobster/pins';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';
import {
  DEFAULT_MIN_WRITE_INTERVAL_MS,
  MIN_WRITE_INTERVAL_ENV,
} from '../wire/stage-throttle';

// ------------------------------------------------------------------ fixtures

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], size = 7, extra: Partial<Board> = {}): Board =>
  ({ width: size, height: size, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 9;

interface Recorded {
  readonly snakeId: string;
  readonly move: CentaurMove;
  readonly at: number;
}

interface FakePorts extends TeamDecisionPorts {
  readonly staged: Recorded[];
  readonly enabled: string[];
  fire(ev: PinEvent): void;
}

/** The fake manager/transport surface — the mandate's "fake submitter". */
function fakePorts(registry: ReadonlyArray<string>): FakePorts {
  const staged: Recorded[] = [];
  const enabled: string[] = [];
  let sink: ((ev: PinEvent) => void) | null = null;
  return {
    staged,
    enabled,
    setBotRecommendation: (_gameId, snakeId, move) => {
      staged.push({ snakeId, move, at: Date.now() });
    },
    enableTeamStaging: (gameId) => {
      enabled.push(gameId);
    },
    onPinEvent: (_gameId, s) => {
      sink = s;
      return () => {
        sink = null;
      };
    },
    pinSnakeIdOf: (_gameId, unitId) => registry[unitId] ?? null,
    fire: (ev) => {
      if (sink === null) throw new Error('no pin sink subscribed');
      sink(ev);
    },
    log: () => undefined,
  };
}

const viewFor = (board: Board, snakeId: string): GameState => {
  const you = board.snakes.find((s) => s.id === snakeId) as Snake;
  return {
    game: { id: 'g', ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 10_000, source: 't' },
    turn: TURN,
    board,
    you,
  };
};

afterEach(() => clearGeometryCache());

// -------------------------------------------------------------------- smoke

describe('SMOKE: a 7×7 team decision end-to-end with a mid-decision pin', () => {
  test('a conforming staged set reaches the fake submitter before the deadline', async () => {
    const board = boardOf([
      piece('a', { x: 1, y: 3 }, 'king', 1, { teamID: 'red' }),
      piece('b', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red' }),
      piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
      piece('N', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    // The operator will pin unit 'a' (registry id 0) one square up-board.
    const probe = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const aUnit = probe.unitOfWireId('a')?.unitId as UnitId;
    const pinTo = probe
      .actionsOf(aUnit)
      .map((c) => c.to)
      .find((to) => to !== probe.unitOfWireId('a')?.cells[0]) as number;
    probe.release();

    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });

    // Fire the pin the moment the FIRST staged set lands — mid-decision by
    // construction: the kernel is inside its emission loop.
    let fired = false;
    const originalSet = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation = (
      gameId,
      snakeId,
      move,
      turnData
    ) => {
      originalSet(gameId, snakeId, move, turnData);
      if (!fired) {
        fired = true;
        ports.fire({ kind: 'pin', pin: { unitId: 0, to: pinTo, tentative: false } });
      }
    };

    const deadlineMs = Date.now() + 450;
    const result = await engine.decideTurn({
      gameId: 'g1',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: [
        { snakeId: 'a', view: viewFor(board, 'a') },
        { snakeId: 'b', view: viewFor(board, 'b') },
      ],
      deadlineMs,
    });

    // The wire was activated for team batching, once.
    expect(ports.enabled).toEqual(['g1']);

    // The decision ran, staged something, and observed the pin as an epoch.
    const report = result.report as KernelReport;
    expect(report).not.toBeNull();
    expect(report.stagedNothing).toBe(false);
    expect(fired).toBe(true);
    expect(report.epochs).toBe(2);
    // Conformance latency: no refinement slice ran between the operator's
    // event and the conforming re-stage.
    expect(report.conformance).toHaveLength(1);
    expect(report.conformance[0]?.slicesBefore).toBe(0);

    // Every record staged after the pin epoch honours it exactly.
    const pinnedRecords = report.journal.filter((rec) => rec.epoch >= 1);
    expect(pinnedRecords.length).toBeGreaterThan(0);
    for (const rec of pinnedRecords) {
      expect(rec.plan.get(aUnit)?.to).toBe(pinTo);
    }

    // The CONFORMING SET reached the fake submitter surface: the last move
    // forwarded for the pinned piece is the pinned destination (a piece's
    // wire move IS the destination index), and it landed before the deadline.
    const forA = ports.staged.filter((r) => r.snakeId === 'a');
    expect(forA.length).toBeGreaterThan(0);
    const last = forA[forA.length - 1] as Recorded;
    expect(last.move).toBe(pinTo);
    expect(last.at).toBeLessThanOrEqual(deadlineMs);
    // Both units were spoken for.
    expect(new Set(ports.staged.map((r) => r.snakeId))).toEqual(new Set(['a', 'b']));
    expect(result.forwarded).toBeGreaterThanOrEqual(2);
  }, 20_000);
});

// -------------------------------------------------------------- held capacity

describe('MAX_FROZEN on a 3-team board with nothing modelled', () => {
  const SIZE = 12;
  const threeTeamBoard = (): Board => {
    const snakes: Snake[] = [
      piece('a', { x: 0, y: 5 }, 'king', 1, { teamID: 'red' }),
      piece('b', { x: 0, y: 7 }, 'king', 1, { teamID: 'red' }),
      // The two NEAREST enemies, right against our line.
      piece('n1', { x: 1, y: 5 }, 'king', 1, { teamID: 'blue' }),
      piece('n2', { x: 1, y: 7 }, 'king', 1, { teamID: 'green' }),
    ];
    // 32 more enemies, far side of the board: 34 uncontrolled in total.
    let i = 0;
    for (let y = 0; y < SIZE && i < 32; y++) {
      for (let x = SIZE - 4; x < SIZE && i < 32; x++) {
        const team = i % 2 === 0 ? 'blue' : 'green';
        snakes.push(piece(`e${i}`, { x, y }, 'king', 1, { teamID: team }));
        i++;
      }
    }
    return boardOf(snakes, SIZE);
  };

  test('unmitigated, the claim view refuses: TooManyHeldError, never truncation', () => {
    const board = threeTeamBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const gen = new GrammarCandidateGenerator();
      const ours = sub.unitOfWireId('a')?.unitId as UnitId;
      expect(() => gen.candidatesFor(sub, ours)).toThrow(TooManyHeldError);
    } finally {
      sub.release();
    }
  });

  test('the engine models the NEAREST units at their defaults, declared, and decides', async () => {
    const board = threeTeamBoard();
    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    const result = await engine.decideTurn({
      gameId: 'g3',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: [
        { snakeId: 'a', view: viewFor(board, 'a') },
        { snakeId: 'b', view: viewFor(board, 'b') },
      ],
      deadlineMs: Date.now() + 450,
    });

    const report = result.report as KernelReport;
    expect(report).not.toBeNull();
    expect(report.stagedNothing).toBe(false);
    expect(result.forwarded).toBeGreaterThanOrEqual(2);

    // Exactly the overflow is modelled: 34 uncontrolled − 32 capacity = 2,
    // each a DECLARED reference-action at the kind's own default.
    expect(result.assumptions).toHaveLength(34 - MAX_FROZEN);
    for (const a of result.assumptions) {
      expect(a.kind).toBe('reference-action');
      if (a.kind === 'reference-action') expect(a.to).toBe(NO_ORDER_MOVE);
    }
    // And they are the NEAREST by arrival — the two touching our line.
    const probe = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: board.snakes.map((s) => s.id),
    });
    try {
      const modelled = result.assumptions
        .map((a) => (a.kind === 'reference-action' ? probe.unitOf(a.unitId)?.wireId : null))
        .sort();
      expect(modelled).toEqual(['n1', 'n2']);
    } finally {
      probe.release();
    }

    // The declared narrowings ride every emitted record.
    for (const rec of report.journal) {
      const refs = rec.assumptions.filter((a) => a.kind === 'reference-action');
      expect(refs).toHaveLength(34 - MAX_FROZEN);
    }
  }, 30_000);
});

// ------------------------------------------------------------- wire policy

describe('the kernel runs under the WIRE rate policy, not the search default', () => {
  test('minWriteIntervalMs follows StageThrottle policy: 1000 ms default', () => {
    const engine = new TeamDecisionEngine(fakePorts([]), {});
    const opts = engine.kernelOptions();
    expect(opts.minWriteIntervalMs).toBe(DEFAULT_MIN_WRITE_INTERVAL_MS);
    expect(opts.minWriteIntervalMs).toBe(1000);
    expect(opts.crossfade).toBe('teammate');
  });

  test('CENTAUR_STAGE_MIN_WRITE_MS overrides; junk keeps the default', () => {
    const withEnv = (value: string): number => {
      const ports = fakePorts([]);
      (ports as { env?: NodeJS.ProcessEnv }).env = { [MIN_WRITE_INTERVAL_ENV]: value };
      return new TeamDecisionEngine(ports, {}).kernelOptions().minWriteIntervalMs;
    };
    expect(withEnv('250')).toBe(250);
    expect(withEnv('0')).toBe(DEFAULT_MIN_WRITE_INTERVAL_MS);
    expect(withEnv('nonsense')).toBe(DEFAULT_MIN_WRITE_INTERVAL_MS);
  });
});

// ------------------------------------------------------------------- advice

describe('pin advice from the speculative seam', () => {
  const record = (plan: Map<UnitId, { unitId: UnitId; from: number; to: number; path: number[] }>, lo: number, hi: number) => ({
    plan,
    lo,
    est: (lo + hi) / 2,
    hi,
    horizon: 1,
    slack: 0,
    posture: 'SIGHTED' as const,
    assumptions: [],
    epoch: 0,
  });

  test('prices a considered pin against the staged incumbent, above threshold only', () => {
    const alternative = { unitId: 4 as UnitId, from: 10, to: 11, path: [11] };
    const plan = new Map([[4 as UnitId, alternative]]);
    const report = {
      journal: [record(plan, 20, 60)],
      speculative: [
        { key: 'spec:[4@77?]', lo: 5, hi: 40, cursor: 8 },
        { key: 'spec:[9@12?]', lo: 20, hi: 60, cursor: 2 },
      ],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [
        { unitId: 4, to: 77, tentative: true },
        { unitId: 9, to: 12, tentative: true },
      ],
      witnesses: [],
      snakeIdOf: (unitId) => (unitId === 4 ? 'a' : null),
    });
    // The free pin (9@12 costs nothing) is below threshold and not surfaced.
    expect(advice).toHaveLength(1);
    const a = advice[0];
    expect(a?.pin.unitId).toBe(4);
    expect(a?.costLo).toBe(15); // 20 − 5
    expect(a?.costHi).toBe(20); // 60 − 40
    expect(a?.alternative).toEqual(alternative);
    expect(a?.confidence).toBe(1);
    expect(a?.snakeId).toBe('a');
  });

  test('a helping pin prices free, never negative', () => {
    const plan = new Map([[4 as UnitId, { unitId: 4 as UnitId, from: 10, to: 11, path: [11] }]]);
    const report = {
      journal: [record(plan, 20, 60)],
      speculative: [{ key: 'spec:[4@77?]', lo: 30, hi: 70, cursor: 4 }],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    expect(advice[0]?.costLo).toBe(0);
    expect(advice[0]?.costHi).toBe(0);
  });
});

// ------------------------------------------------------------- snake moves

describe('a snake unit is forwarded as a Direction', () => {
  test('the emitted destination becomes the wire direction for its head', async () => {
    const body = [
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ];
    const board = boardOf([
      makeSnake('s', body, { teamID: 'red', orientation: { dx: 0, dy: -1 } }),
      piece('K', { x: 5, y: 5 }, 'king', 1, { teamID: 'blue' }),
    ]);
    const ports = fakePorts(['s']);
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    const result = await engine.decideTurn({
      gameId: 'g2',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: [{ snakeId: 's', view: viewFor(board, 's') }],
      deadlineMs: Date.now() + 350,
    });
    const report = result.report as KernelReport;
    expect(report.stagedNothing).toBe(false);
    const forS = ports.staged.filter((r) => r.snakeId === 's');
    expect(forS.length).toBeGreaterThan(0);
    for (const r of forS) {
      expect(['up', 'down', 'left', 'right']).toContain(r.move);
    }
    // The last forwarded direction matches the last emitted plan's staged cell.
    const probe = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const sUnit = probe.unitOfWireId('s');
      const last = report.journal[report.journal.length - 1];
      const to = last?.plan.get(sUnit?.unitId as UnitId)?.to as number;
      const head = sUnit?.cells[0] as number;
      const dx = (to % probe.grid.width) - (head % probe.grid.width);
      const dy = Math.floor(to / probe.grid.width) - Math.floor(head / probe.grid.width);
      const expected =
        dx === 1 ? 'right' : dx === -1 ? 'left' : dy === -1 ? 'up' : 'down';
      expect(forS[forS.length - 1]?.move).toBe(expected);
    } finally {
      probe.release();
    }
  }, 20_000);
});

// The board index helper is exercised implicitly by the smoke (a piece's wire
// move is its full-board destination); keep one direct pin so a coordinate
// regression fails loudly rather than as a mysteriously non-conforming smoke.
describe('index space sanity', () => {
  test('the substrate speaks the wire full-board indexing', () => {
    const board = boardOf([piece('a', { x: 2, y: 3 }, 'king', 1, { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const head = sub.unitOfWireId('a')?.cells[0];
      expect(head).toBe(apiCoordToIndex({ x: 2, y: 3 }, board.width + 2, board.height + 2));
    } finally {
      sub.release();
    }
  });
});
