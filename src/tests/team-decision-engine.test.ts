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
import type {
  Candidate,
  JointPlan,
  PinEvent,
  SearchContext,
  SearchCore,
  UnitId,
} from '../lobster/contracts';
import { NO_ORDER_MOVE } from '../lobster/contracts';
import { EngineSubstrate, TooManyHeldError, clearGeometryCache, makeSubstrate } from '../lobster/substrate';
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
  /** Deliver one wire event. `turn` is what the real stream stamps on it. */
  fire(ev: PinEvent, turn?: number): void;
}

/** The fake manager/transport surface — the mandate's "fake submitter". */
function fakePorts(registry: ReadonlyArray<string>): FakePorts {
  const staged: Recorded[] = [];
  const enabled: string[] = [];
  let sink: ((ev: PinEvent, turn?: number) => void) | null = null;
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
    fire: (ev, turn) => {
      if (sink === null) throw new Error('no pin sink subscribed');
      sink(ev, turn);
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

  const spec = (
    key: string,
    lo: number,
    hi: number,
    cursor: number,
    over: { posture?: 'SIGHTED' | 'FOGGED-VACUOUS'; epoch?: number } = {}
  ) => ({ key, lo, hi, cursor, posture: over.posture ?? ('SIGHTED' as const), epoch: over.epoch ?? 0 });

  test('prices a considered pin against the staged incumbent, above threshold only', () => {
    const alternative = { unitId: 4 as UnitId, from: 10, to: 11, path: [11] };
    const plan = new Map([[4 as UnitId, alternative]]);
    const report = {
      journal: [record(plan, 20, 60)],
      speculative: [spec('spec:[4@77?]', 5, 40, 8), spec('spec:[9@12?]', 20, 60, 2)],
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
      speculative: [spec('spec:[4@77?]', 30, 70, 4)],
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

  test('V4 B3: a pin is matched by TOKEN, never by substring', () => {
    // "1@5?" is a substring of "31@5?". Matching by text read unit 31's
    // speculative context as unit 1's and surfaced a fabricated 100-point
    // price to the operator — confirmed empirically before the fix.
    const plan = new Map([[1 as UnitId, { unitId: 1 as UnitId, from: 4, to: 5, path: [5] }]]);
    const report = {
      journal: [record(plan, 100, 100)],
      speculative: [spec('spec:[31@5?]', 0, 0, 8)],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 1, to: 5, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toEqual([]);

    // The real unit's own context still prices, of course.
    const own = adviseFromReport({
      report: {
        journal: [record(plan, 100, 100)],
        speculative: [spec('spec:[31@5?]', 0, 0, 8), spec('spec:[1@5?]', 40, 40, 8)],
      } as unknown as KernelReport,
      tentative: [{ unitId: 1, to: 5, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(own).toHaveLength(1);
    expect(own[0]?.costLo).toBe(60);
  });

  test('V4 B7: costLo is the LO channel and costHi the HI channel, never crossed', () => {
    // A pin that gives up a lot of floor and little ceiling. A min/max across
    // the two channels reports the ceiling's delta as the floor's.
    const plan = new Map([[4 as UnitId, { unitId: 4 as UnitId, from: 10, to: 11, path: [11] }]]);
    const report = {
      journal: [record(plan, 50, 60)],
      speculative: [spec('spec:[4@77?]', 10, 58, 8)],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    expect(advice[0]?.costLo).toBe(40); // 50 − 10, the floor channel
    expect(advice[0]?.costHi).toBe(2); // 60 − 58, the ceiling channel
    expect(advice[0]?.degraded).toBe(false);
  });

  test('V1-BUG-6: an unbounded speculative ceiling is not a free pin', () => {
    const plan = new Map([[4 as UnitId, { unitId: 4 as UnitId, from: 10, to: 11, path: [11] }]]);
    const report = {
      journal: [record(plan, 10, 20)],
      speculative: [spec('spec:[4@77?]', 10, Number.POSITIVE_INFINITY, 8)],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    // [0,0] "free" is a lie about a pin whose real cost is unknown.
    expect(advice).toEqual([]);
  });

  test('V1-BUG-7: the context from the RECORD\u2019s own epoch is the one priced', () => {
    // A speculative key names the committed pins it was searched under, so one
    // hover leaves a trail across epochs and both keys mention the pin.
    const plan = new Map([[4 as UnitId, { unitId: 4 as UnitId, from: 10, to: 11, path: [11] }]]);
    const report = {
      journal: [{ ...record(plan, 20, 60), epoch: 1 }],
      speculative: [
        spec('spec:[4@77?]', 0, 0, 4, { epoch: 0 }),
        spec('spec:[0@30,4@77?]', 15, 55, 20, { epoch: 1 }),
      ],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    // The epoch-1 context: 20−15 and 60−55, not 20−0 and 60−0.
    expect(advice[0]?.costLo).toBe(5);
    expect(advice[0]?.costHi).toBe(5);
    expect(advice[0]?.degraded).toBe(false);
    expect(advice[0]?.basis.speculative.epoch).toBe(1);
  });

  test('a cross-basis reading is surfaced DEGRADED, never as a clean price', () => {
    const plan = new Map([[4 as UnitId, { unitId: 4 as UnitId, from: 10, to: 11, path: [11] }]]);
    const report = {
      journal: [record(plan, 20, 60)],
      speculative: [spec('spec:[4@77?]', 5, 40, 8, { posture: 'FOGGED-VACUOUS' })],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    expect(advice[0]?.degraded).toBe(true);
    expect(advice[0]?.basis.staged.posture).toBe('SIGHTED');
    expect(advice[0]?.basis.speculative.posture).toBe('FOGGED-VACUOUS');
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

// ---------------------------------------------- overlapping decisions (V4 B1)

/**
 * A core that stages the real candidate layer's choices (pins honoured) and
 * reports a bracket that halves every call.
 *
 * WHY A SCRIPTED CORE HERE. The bug under test is about two decisions running
 * at once, and a kernel only ever hands the event loop back when it EMITS. A
 * converged search stops emitting, so a real trio would let whichever decision
 * is running monopolise the thread and the two would never interleave at all —
 * the test would pass or fail on scheduling luck. A geometric bracket emits
 * every slice by construction, so the interleaving is deterministic. Every
 * other part of the path is real: the substrate, the candidate layer, the
 * ledger, the kernel, the wire routing.
 */
function alwaysImprovingCore(): SearchCore {
  let n = 0;
  const planFor = (ctx: SearchContext): JointPlan => {
    const plan = new Map<UnitId, Candidate>();
    for (const unitId of ctx.sub.commandable(ctx.asTeam)) {
      const set = ctx.gen.candidatesFor(ctx.sub, unitId);
      const pin = ctx.pins.find((p) => !p.tentative && p.unitId === unitId);
      const pick =
        (pin ? set.candidates.find((c) => c.to === pin.to) : undefined) ??
        (set.candidates[0] as Candidate);
      plan.set(unitId, pick);
    }
    return plan;
  };
  return {
    conform: (ctx) => planFor(ctx),
    improve: (ctx) => {
      n++;
      const half = Math.pow(0.5, n);
      return {
        plan: planFor(ctx),
        bounds: {
          worst: -1000 * half,
          best: 1000 * half,
          ledger: [],
          assumptions: [],
          exact: false,
        },
        witnesses: [],
      };
    },
  };
}

const WIDE_EVALUATOR = {
  scorePlan: () => ({ lo: -2000, est: 0, hi: 2000 }),
  evaluatePlan: () => ({
    bound: { lo: -2000, est: 0, hi: 2000 },
    parts: {},
    exact: false,
    basis: [],
    ledgerSize: 0,
  }),
};

describe('two decisions overlap by design: the live handle is turn-keyed', () => {
  const smokeBoard = (): Board =>
    boardOf([
      piece('a', { x: 1, y: 3 }, 'king', 1, { teamID: 'red' }),
      piece('b', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red' }),
      piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    ]);

  const unitsOf = (board: Board) => [
    { snakeId: 'a', view: viewFor(board, 'a') },
    { snakeId: 'b', view: viewFor(board, 'b') },
  ];

  test('a pin after the OLD decision expires still reaches the NEW kernel', async () => {
    // T1 fact 5: a turn resolves the instant every alive player commits, so
    // turn N+1's snapshot lands long before turn N's endTime and two decisions
    // run at once. When turn N then reached its own deadline, its `finally`
    // nulled `game.live` — turn N+1's handle — and every pin, unpin and commit
    // for the LIVE turn was folded into the ledger and never reached the
    // kernel: no epoch, no conformance re-stage, no counter. The ordinary
    // human action the feature exists for, silently ignored.
    const board = smokeBoard();
    const probe = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const aUnit = probe.unitOfWireId('a')?.unitId as UnitId;
    const aHead = probe.unitOfWireId('a')?.cells[0] as number;
    const pinTo = probe
      .actionsOf(aUnit)
      .map((c) => c.to)
      .find((to) => to !== aHead) as number;
    probe.release();

    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, {
      makeCore: () => alwaysImprovingCore(),
      evaluate: WIDE_EVALUATOR as never,
      kernel: { reserveMs: 20, sliceMs: 5, minWriteIntervalMs: 0 },
    });

    // Turn N: a SHORT decision. Turn N+1: a long one, started while N runs.
    const oldTurn = engine.decideTurn({
      gameId: 'g-overlap',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: unitsOf(board),
      deadlineMs: Date.now() + 200,
    });
    const newTurn = engine.decideTurn({
      gameId: 'g-overlap',
      turn: TURN + 1,
      board,
      ourTeamId: 'red',
      units: unitsOf(board),
      deadlineMs: Date.now() + 900,
    });

    // THE OPERATOR PINS THE INSTANT THE OLD DECISION DIES. Its `finally` has
    // just run; the new decision is still emitting and still owns the wire.
    // This is the exact moment the bug lived in.
    let fired = false;
    void oldTurn.then((oldResult) => {
      expect(oldResult.report?.stagedNothing).toBe(false);
      fired = true;
      ports.fire({ kind: 'pin', pin: { unitId: 0, to: pinTo, tentative: false } }, TURN + 1);
    });

    const result = await newTurn;
    expect(fired).toBe(true);
    const report = result.report as KernelReport;
    expect(report).not.toBeNull();
    // The pin reached kernel₂: a constraint epoch, and a conformance sample.
    expect(report.epochs).toBe(2);
    expect(report.conformance.length).toBeGreaterThanOrEqual(1);
    expect(report.conformance[0]?.epoch).toBe(1);
    // And every record staged after it honours the operator exactly.
    const after = report.journal.filter((rec) => rec.epoch >= 1);
    expect(after.length).toBeGreaterThan(0);
    for (const rec of after) expect(rec.plan.get(aUnit)?.to).toBe(pinTo);
  }, 30_000);
});

// ------------------------------------------- the turn-boundary gap (V4 B5)

describe('an operator event in the turn-boundary gap is delivered, never wiped', () => {
  const board = (): Board =>
    boardOf([
      piece('a', { x: 1, y: 3 }, 'king', 1, { teamID: 'red' }),
      piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    ]);

  test('a pin stamped for the NEXT turn survives that turn beginning', async () => {
    const b = board();
    const probe = makeSubstrate({ board: b, turn: TURN, asTeam: 'red' });
    const aUnit = probe.unitOfWireId('a')?.unitId as UnitId;
    const aHead = probe.unitOfWireId('a')?.cells[0] as number;
    const pinTo = probe
      .actionsOf(aUnit)
      .map((c) => c.to)
      .find((to) => to !== aHead) as number;
    probe.release();

    const ports = fakePorts(['a']);
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    const units = [{ snakeId: 'a', view: viewFor(b, 'a') }];

    // Turn N runs and finishes; the subscription now exists.
    await engine.decideTurn({
      gameId: 'g-gap',
      turn: TURN,
      board: b,
      ourTeamId: 'red',
      units,
      deadlineMs: Date.now() + 250,
    });

    // THE GAP: turn N+1's snapshot has landed on the wire and the operator has
    // pinned on it, but this engine has not begun turn N+1 yet. The ledger is
    // still reporting on turn N.
    ports.fire({ kind: 'pin', pin: { unitId: 0, to: pinTo, tentative: false } }, TURN + 1);

    const result = await engine.decideTurn({
      gameId: 'g-gap',
      turn: TURN + 1,
      board: b,
      ourTeamId: 'red',
      units,
      deadlineMs: Date.now() + 400,
    });
    const report = result.report as KernelReport;
    // It arrived as an INITIAL pin of the decision it constrained — honoured
    // from the very first staged set, not lost at the turn boundary.
    expect(report.journal.length).toBeGreaterThan(0);
    for (const rec of report.journal) expect(rec.plan.get(aUnit)?.to).toBe(pinTo);
    expect(result.refusals['pin-event-late']).toBe(0);
  }, 30_000);

  test('an event for a turn already resolved is COUNTED, never silently dropped', async () => {
    const b = board();
    const ports = fakePorts(['a']);
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
    const units = [{ snakeId: 'a', view: viewFor(b, 'a') }];
    await engine.decideTurn({
      gameId: 'g-late',
      turn: TURN,
      board: b,
      ourTeamId: 'red',
      units,
      deadlineMs: Date.now() + 200,
    });
    // Late arrival for a turn that is over.
    ports.fire({ kind: 'pin', pin: { unitId: 0, to: 9, tentative: false } }, TURN - 1);
    const result = await engine.decideTurn({
      gameId: 'g-late',
      turn: TURN + 1,
      board: b,
      ourTeamId: 'red',
      units,
      deadlineMs: Date.now() + 250,
    });
    expect(result.refusals['pin-event-late']).toBe(1);
  }, 30_000);
});

// ------------------------------------ an unexpressible staged move (V4 B6)

describe('a staged move the wire cannot say is a named narrowing, not a skip', () => {
  test('counted as a refusal and declared on every record after it', async () => {
    const body = [
      { x: 3, y: 3 },
      { x: 3, y: 2 },
    ];
    const b = boardOf([
      makeSnake('s', body, { teamID: 'red', orientation: { dx: 0, dy: -1 } }),
      piece('K', { x: 6, y: 6 }, 'king', 1, { teamID: 'blue' }),
    ]);
    const probe = makeSubstrate({ board: b, turn: TURN, asTeam: 'red' });
    const sUnit = probe.unitOfWireId('s')?.unitId as UnitId;
    const head = probe.unitOfWireId('s')?.cells[0] as number;
    // Two cells up-board: a destination NO direction can express.
    const unreachable = head - 2 * probe.grid.width;
    probe.release();

    // A scripted core that stages exactly that, and a stub evaluator so the
    // engine is never asked to resolve a cell its rules do not admit — the
    // question here is what the FORWARDING path does with a destination the
    // wire has no word for.
    const candidate = { unitId: sUnit, from: head, to: unreachable, path: [unreachable] };
    const plan = new Map([[sUnit, candidate]]);
    const bounds = { worst: 1, best: 1, ledger: [], assumptions: [], exact: false };
    const scripted = {
      improve: () => ({ plan, bounds, witnesses: [] }),
      conform: () => plan,
    };
    // A wide bracket from the evaluator and a tight one from the core, so the
    // second emission has a real improvement to sell and the worth gate lets
    // it through — otherwise rung 0 is the only record there is.
    const stubEvaluate = {
      scorePlan: () => ({ lo: 1, est: 1, hi: 100 }),
      evaluatePlan: () => ({
        bound: { lo: 1, est: 1, hi: 100 },
        parts: {},
        exact: false,
        basis: [],
        ledgerSize: 0,
      }),
    };

    const ports = fakePorts(['s']);
    const engine = new TeamDecisionEngine(ports, {
      makeCore: () => scripted as never,
      evaluate: stubEvaluate as never,
      kernel: { reserveMs: 20, sliceMs: 10, minWriteIntervalMs: 0 },
    });
    const result = await engine.decideTurn({
      gameId: 'g-unexpressible',
      turn: TURN,
      board: b,
      ourTeamId: 'red',
      units: [{ snakeId: 's', view: viewFor(b, 's') }],
      deadlineMs: Date.now() + 250,
    });

    // Nothing was forwarded — but it is not a silent skip any more.
    expect(result.forwarded).toBe(0);
    expect(ports.staged).toEqual([]);
    expect(result.refusals['unexpressible-move']).toBeGreaterThan(0);

    // A default is a narrowing and must be NAMED: every record emitted after
    // the discovery carries one, shaped exactly like the pin-unreachable
    // precedent (kind narrowing, the unit, a note naming the destination).
    const report = result.report as KernelReport;
    const later = report.journal.slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const rec of later) {
      const narrowing = rec.assumptions.find(
        (a) => a.kind === 'narrowing' && a.unitId === sUnit
      );
      expect(narrowing).toBeDefined();
      if (narrowing?.kind === 'narrowing') {
        expect(narrowing.note).toContain(`staged-move-unexpressible@${unreachable}`);
      }
    }
  }, 30_000);
});

// -------------------------------- a wire→substrate lookup miss (V4 R5)

describe('a modelling choice the substrate cannot name degrades, never crashes', () => {
  const SIZE = 12;
  const bigBoard = (): Board => {
    const snakes: Snake[] = [
      piece('a', { x: 0, y: 5 }, 'king', 1, { teamID: 'red' }),
      piece('b', { x: 0, y: 7 }, 'king', 1, { teamID: 'red' }),
      piece('n1', { x: 1, y: 5 }, 'king', 1, { teamID: 'blue' }),
      piece('n2', { x: 1, y: 7 }, 'king', 1, { teamID: 'green' }),
    ];
    let i = 0;
    for (let y = 0; y < SIZE && i < 32; y++) {
      for (let x = SIZE - 4; x < SIZE && i < 32; x++) {
        snakes.push(piece(`e${i}`, { x, y }, 'king', 1, { teamID: i % 2 === 0 ? 'blue' : 'green' }));
        i++;
      }
    }
    return boardOf(snakes, SIZE);
  };

  test('the miss is a counted refusal and a declared narrowing — not an UnknownUnitError', async () => {
    const board = bigBoard();
    // `unitId: sub.unitOfWireId(id)?.unitId as UnitId` used to carry `undefined`
    // through the cast into a reference-action, into the plan, and out the
    // other side as an UnknownUnitError deep inside resolveBounded — a whole
    // turn lost to a lookup miss. The lookup is simulated here because the
    // production probe and the real substrate are built from the same board,
    // which is exactly why the cast looked safe.
    const real = EngineSubstrate.prototype.unitOfWireId;
    const spy = jest
      .spyOn(EngineSubstrate.prototype, 'unitOfWireId')
      .mockImplementation(function (this: EngineSubstrate, wireId: string) {
        return wireId === 'n1' ? undefined : real.call(this, wireId);
      });
    try {
      const ports = fakePorts(['a', 'b']);
      const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
      const result = await engine.decideTurn({
        gameId: 'g-miss',
        turn: TURN,
        board,
        ourTeamId: 'red',
        units: [
          { snakeId: 'a', view: viewFor(board, 'a') },
          { snakeId: 'b', view: viewFor(board, 'b') },
        ],
        deadlineMs: Date.now() + 400,
      });
      // The decision survived and still staged a set.
      expect(result.report?.stagedNothing).toBe(false);
      expect(result.refusals['unit-lookup-miss']).toBe(1);
      // One reference-action for the unit it could name, one NAMED narrowing
      // for the one it could not — and no assumption carrying an undefined id.
      // The choice it could not name was REPLACED from the ranked remainder,
      // so the held set still fits — two reference actions, and one named
      // narrowing recording the substitution.
      const refs = result.assumptions.filter((a) => a.kind === 'reference-action');
      const narrowings = result.assumptions.filter((a) => a.kind === 'narrowing');
      expect(refs).toHaveLength(2);
      expect(narrowings).toHaveLength(1);
      for (const a of result.assumptions) {
        if (a.kind !== 'posture') expect(a.unitId).toBeDefined();
      }
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});
