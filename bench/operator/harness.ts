/**
 * V1 OPERATOR-LANE HARNESS — shared rig for the scripted-operator measurements.
 *
 * Everything here drives the REAL trio (EngineSubstrate + GrammarCandidateGenerator
 * + BoundEvaluator + makeSearchCore) under the REAL LobsterKernel. Nothing is
 * stubbed except the operator and the clock:
 *
 *  - THE CLOCK is a STEP clock: every read advances it by a fixed tick. That
 *    makes the whole run a deterministic function of how many clock reads the
 *    search performs, which is itself deterministic, so slice counts, cache
 *    statistics, emission sequences and final bounds reproduce exactly on any
 *    machine under any load. No wall-clock reads anywhere on the measured path.
 *
 *  - THE OPERATOR is scripted off SLICE BOUNDARIES rather than wall time: the
 *    SearchCore is wrapped, and one `improve()` call is exactly one refinement
 *    slice (the real core exposes no lever surface, so the kernel's slice is
 *    always an improve). Firing from inside the wrapper puts the event in the
 *    kernel's pending queue mid-slice, which is what a real operator does.
 */

import type { Board as ApiBoard, Coord, GameState, Snake } from '../../src/types/battlesnake';
import type {
  Assumption,
  Candidate,
  EmitRecord,
  Evaluator,
  JointPlan,
  Pin,
  PinEvent,
  PlanScore,
  SearchContext,
  SearchCore,
  UnitId,
} from '../../src/lobster/contracts';
import { EngineSubstrate, makeSubstrate, clearGeometryCache } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import { LobsterKernel, type KernelOptions, type KernelReport } from '../../src/lobster/kernel';

export { clearGeometryCache };

// --------------------------------------------------------------------- clock

/** Monotonic, deterministic, and *not* wall clock: each read costs one tick. */
export class StepClock {
  private t: number;
  reads = 0;
  constructor(
    readonly tick = 0.02,
    start = 1_000
  ) {
    this.t = start;
  }
  readonly now = (): number => {
    this.reads++;
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  /** Read WITHOUT charging a tick — for instrumentation only. */
  readonly peek = (): number => this.t;
}

// -------------------------------------------------------------------- boards

export function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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

export const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

export const boardOf = (snakes: Snake[], size = 7): ApiBoard =>
  ({ width: size, height: size, food: [], hazards: [], snakes }) as ApiBoard;

export const viewFor = (board: ApiBoard, snakeId: string, turn: number): GameState => {
  const you = board.snakes.find((s) => s.id === snakeId) as Snake;
  return {
    game: {
      id: 'g',
      ruleset: { name: 't', version: 'v', settings: {} },
      map: 'm',
      timeout: 10_000,
      source: 't',
    },
    turn,
    board,
    you,
  } as GameState;
};

export interface BoardCase {
  readonly name: string;
  readonly size: number;
  readonly board: ApiBoard;
  readonly ourTeam: string;
  /** Wire ids of our units, in board order. */
  readonly ours: ReadonlyArray<string>;
}

/**
 * The measurement boards. Mixed snakes and pieces, enemies always HELD (the
 * substrate models only our team unless told otherwise), sizes 7×7 … 11×11.
 */
export function boardCases(): BoardCase[] {
  const cases: BoardCase[] = [];

  // 7×7: two pieces of ours, two enemy pieces held.
  cases.push({
    name: '7x7-pieces',
    size: 7,
    ourTeam: 'red',
    ours: ['a', 'b'],
    board: boardOf(
      [
        piece('a', { x: 1, y: 3 }, 'king', 1, { teamID: 'red' }),
        piece('b', { x: 1, y: 1 }, 'rook', 2, { teamID: 'red' }),
        piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
        piece('N', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
      ],
      7
    ),
  });

  // 8×8: a snake and a piece of ours; a snake and two pieces held.
  cases.push({
    name: '8x8-mixed',
    size: 8,
    ourTeam: 'red',
    ours: ['s1', 'r1'],
    board: boardOf(
      [
        makeSnake(
          's1',
          [
            { x: 2, y: 4 },
            { x: 2, y: 5 },
            { x: 2, y: 6 },
          ],
          { teamID: 'red', orientation: { dx: 0, dy: -1 } }
        ),
        piece('r1', { x: 3, y: 2 }, 'rook', 2, { teamID: 'red' }),
        makeSnake(
          'e1',
          [
            { x: 6, y: 3 },
            { x: 6, y: 2 },
          ],
          { teamID: 'blue', orientation: { dx: 0, dy: 1 } }
        ),
        piece('eK', { x: 6, y: 6 }, 'king', 1, { teamID: 'blue' }),
        piece('eB', { x: 5, y: 1 }, 'bishop', 2, { teamID: 'blue' }),
      ],
      8
    ),
  });

  // 9×9: three of ours (king, knight, snake) against three held.
  cases.push({
    name: '9x9-three',
    size: 9,
    ourTeam: 'red',
    ours: ['k', 'n', 's'],
    board: boardOf(
      [
        piece('k', { x: 1, y: 4 }, 'king', 1, { teamID: 'red' }),
        piece('n', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
        makeSnake(
          's',
          [
            { x: 3, y: 6 },
            { x: 2, y: 6 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        piece('eK', { x: 7, y: 4 }, 'king', 1, { teamID: 'blue' }),
        piece('eR', { x: 7, y: 7 }, 'rook', 2, { teamID: 'blue' }),
        piece('eP', { x: 6, y: 1 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      9
    ),
  });

  // 11×11: four of ours against four held, wide open board.
  cases.push({
    name: '11x11-four',
    size: 11,
    ourTeam: 'red',
    ours: ['k', 'r', 'b', 's'],
    board: boardOf(
      [
        piece('k', { x: 1, y: 5 }, 'king', 1, { teamID: 'red' }),
        piece('r', { x: 2, y: 2 }, 'rook', 2, { teamID: 'red' }),
        piece('b', { x: 2, y: 8 }, 'bishop', 2, { teamID: 'red' }),
        makeSnake(
          's',
          [
            { x: 4, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 4 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        piece('eK', { x: 9, y: 5 }, 'king', 1, { teamID: 'blue' }),
        piece('eR', { x: 8, y: 2 }, 'rook', 2, { teamID: 'blue' }),
        piece('eN', { x: 8, y: 8 }, 'knight', 1, { teamID: 'blue' }),
        makeSnake(
          'es',
          [
            { x: 6, y: 5 },
            { x: 7, y: 5 },
          ],
          { teamID: 'blue', orientation: { dx: -1, dy: 0 } }
        ),
      ],
      11
    ),
  });

  return cases;
}

/**
 * The TACTICAL family: boards on which the rung-0 `conform` plan is provably
 * worse than what `improve` finds, so "how much does oscillation cost in final
 * lo" has something to measure. (On the quiet boards above the search converges
 * at rung 0 and every later slice is refused on `worth`.)
 */
export function tacticalBoard(size: number): ApiBoard {
  const snakes: Snake[] = [
    piece('a', { x: 2, y: 2 }, 'rook', 2, { teamID: 'red' }),
    piece('b', { x: 4, y: 6 }, 'knight', 1, { teamID: 'red' }),
    piece('e1', { x: 3, y: 3 }, 'pawn', 1, { teamID: 'blue' }),
    piece('e2', { x: 3, y: 5 }, 'pawn', 1, { teamID: 'blue' }),
  ];
  if (size >= 9) {
    snakes.push(piece('e3', { x: size - 2, y: size - 2 }, 'king', 1, { teamID: 'blue' }));
    snakes.push(
      makeSnake(
        's',
        [
          { x: 1, y: size - 2 },
          { x: 1, y: size - 3 },
        ],
        { teamID: 'red', orientation: { dx: 0, dy: 1 } }
      )
    );
  }
  if (size >= 11) {
    snakes.push(piece('c', { x: size - 3, y: 1 }, 'bishop', 2, { teamID: 'red' }));
    snakes.push(
      makeSnake(
        'es',
        [
          { x: size - 2, y: 4 },
          { x: size - 2, y: 3 },
        ],
        { teamID: 'blue', orientation: { dx: 0, dy: 1 } }
      )
    );
  }
  return boardOf(snakes, size);
}

export function tacticalCases(): BoardCase[] {
  return [7, 8, 9, 11].map((size) => ({
    name: `tactical-${size}x${size}`,
    size,
    ourTeam: 'red',
    ours:
      size >= 11 ? ['a', 'b', 's', 'c'] : size >= 9 ? ['a', 'b', 's'] : ['a', 'b'],
    board: tacticalBoard(size),
  }));
}

// ------------------------------------------------------------- scripted core

export interface SliceHook {
  /** Called AFTER each refinement slice, with the 1-based slice number. */
  (slice: number, ctx: SearchContext): void;
}

/** Wrap the real core so each `improve` (== one kernel slice) can be scripted. */
export function scriptedCore(
  core: SearchCore,
  hooks: { before?: SliceHook; after?: SliceHook },
  counters: { improves: number; conforms: number; conformSeeds: JointPlan[] }
): SearchCore {
  const wrapped: SearchCore = {
    improve: (ctx) => {
      hooks.before?.(counters.improves + 1, ctx);
      const out = core.improve(ctx);
      counters.improves++;
      hooks.after?.(counters.improves, ctx);
      return out;
    },
    conform: (ctx, incumbent) => {
      counters.conforms++;
      counters.conformSeeds.push(incumbent);
      return core.conform(ctx, incumbent);
    },
  };
  return wrapped;
}

// --------------------------------------------------------------- kernel drive

export interface ScriptedEvent {
  /** Fire after this many completed refinement slices (1-based). */
  readonly atSlice: number;
  readonly event: PinEvent;
  readonly label: string;
}

export interface DriveResult {
  readonly report: KernelReport;
  readonly emissions: ReadonlyArray<EmitRecord>;
  readonly fired: ReadonlyArray<{
    readonly label: string;
    readonly atSlice: number;
    readonly clock: number;
    readonly emissionsAtFire: number;
  }>;
  readonly clock: StepClock;
  readonly improves: number;
  readonly conforms: number;
  readonly conformSeeds: ReadonlyArray<JointPlan>;
  /** Wall-clock of the run, purely informational (never asserted on). */
  readonly wallMs: number;
}

export interface DriveOptions {
  readonly board: ApiBoard;
  readonly turn: number;
  readonly ourTeam: string;
  readonly budgetMs: number;
  readonly kernel?: Partial<KernelOptions>;
  readonly initialPins?: ReadonlyArray<Pin>;
  readonly script?: ReadonlyArray<ScriptedEvent>;
  readonly tick?: number;
  readonly evaluate?: Evaluator;
  readonly assumptions?: ReadonlyArray<Assumption>;
  /** Called with the substrate before the run — to translate wire ids. */
  readonly withSubstrate?: (sub: EngineSubstrate) => void;
}

/**
 * Drive one decision through the real kernel with a scripted operator.
 * The kernel's own emission stream is drained here, exactly as the team
 * decision engine drains it.
 */
export async function drive(options: DriveOptions): Promise<DriveResult> {
  const clock = new StepClock(options.tick ?? 0.02);
  const sub = makeSubstrate({
    board: options.board,
    turn: options.turn,
    asTeam: options.ourTeam,
  });
  options.withSubstrate?.(sub);
  const gen = new GrammarCandidateGenerator();
  const evaluate = options.evaluate ?? materialEvaluator;
  const counters = { improves: 0, conforms: 0, conformSeeds: [] as JointPlan[] };
  const emissions: EmitRecord[] = [];
  const fired: DriveResult['fired'] = [];
  const script = [...(options.script ?? [])];

  const kernel = new LobsterKernel({
    reserveMs: 1,
    sliceMs: 2,
    minWriteIntervalMs: 0,
    ...options.kernel,
  });

  const core = scriptedCore(
    makeSearchCore(),
    {
      after: (slice) => {
        for (const s of script) {
          if (s.atSlice !== slice) continue;
          (fired as DriveResult['fired'][number][]).push({
            label: s.label,
            atSlice: slice,
            clock: clock.peek(),
            emissionsAtFire: emissions.length,
          });
          kernel.onPinEvent(s.event);
        }
      },
    },
    counters
  );

  const t0 = Date.now();
  try {
    for await (const rec of kernel.decide({
      sub,
      gen,
      evaluate,
      search: core,
      asTeam: sub.teamNumber(options.ourTeam),
      deadlineMs: clock.peek() + options.budgetMs,
      initialPins: options.initialPins ?? [],
      assumptions: options.assumptions,
      now: clock.now,
    })) {
      emissions.push(rec);
    }
  } finally {
    sub.release();
  }
  return {
    report: kernel.lastReport as KernelReport,
    emissions,
    fired,
    clock,
    improves: counters.improves,
    conforms: counters.conforms,
    conformSeeds: counters.conformSeeds,
    wallMs: Date.now() - t0,
  };
}

// ------------------------------------------------------------- unit lookups

export interface UnitHandle {
  readonly wireId: string;
  readonly unitId: UnitId;
  readonly at: number;
  readonly options: ReadonlyArray<Candidate>;
}

/** Resolve wire ids to substrate unit numbers + their legal destinations. */
export function probeUnits(
  board: ApiBoard,
  turn: number,
  ourTeam: string,
  wireIds: ReadonlyArray<string>
): Map<string, UnitHandle> {
  const sub = makeSubstrate({ board, turn, asTeam: ourTeam });
  try {
    const out = new Map<string, UnitHandle>();
    for (const wireId of wireIds) {
      const u = sub.unitOfWireId(wireId);
      if (u === undefined) continue;
      out.set(wireId, {
        wireId,
        unitId: u.unitId,
        at: u.cells[0] as number,
        options: sub.actionsOf(u.unitId),
      });
    }
    return out;
  } finally {
    sub.release();
  }
}

// ------------------------------------------------------------------- summary

export const quantile = (xs: ReadonlyArray<number>, q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i] as number;
};

export const mean = (xs: ReadonlyArray<number>): number =>
  xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

export const round = (x: number, n = 3): number =>
  Number.isFinite(x) ? Number(x.toFixed(n)) : x;

export const planOf = (score: PlanScore | null): JointPlan | null => score?.plan ?? null;
