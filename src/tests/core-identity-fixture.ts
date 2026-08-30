/**
 * THE REGISTRY BYTE-IDENTITY FIXTURE — the replay set, and the capture.
 *
 * ── WHY THIS IS A MODULE AND NOT A TEST ────────────────────────────────────
 *
 * The gate the core redesign's first increment owes is not "two runs of this
 * build agree" (that is determinism, and the suite already has it). It is
 * "THIS build agrees with the build BEFORE THE REGISTRY EXISTED". A gate like
 * that needs the same capture code to run on both sides of the change, so the
 * capture lives here, in a file with no `describe` in it, and
 * `core-registry-identity.test.ts` holds the frozen answer the pre-registry
 * build produced.
 *
 * Regenerating the golden is therefore a deliberate act with a paper trail:
 * check out the pre-change commit, drop this file in, run the capture, and
 * paste. A golden that is regenerated from the CURRENT build proves nothing,
 * which is exactly why the capture is separated from the assertion.
 *
 * ── WHAT MAKES THE CAPTURE COMPARABLE ACROSS TWO BUILDS ────────────────────
 *
 * A decision is an anytime loop against a clock, so a wall-clock run compares
 * two boxes and not two builds. Both clocks are therefore fake and both are
 * PURE FUNCTIONS OF CALL COUNT:
 *
 *   · the wall clock is a CONSTANT (`WALL`), so the deadline conversion is
 *     fixed;
 *   · the monotonic clock is a STEP CLOCK — every read advances it by a fixed
 *     tick — so elapsed time is exactly "how many times the kernel looked at
 *     the clock".
 *
 * Faking both is what makes the capture comparable at all. It does NOT make
 * the whole report reproducible: the loop's slice count still moves run to run
 * on the unchanged build, which is why `BoardCapture` excludes that family —
 * see its own note for the measurement.
 *
 * The environment is scrubbed of every promotable flag before each capture,
 * for the reason the CL7 report gives: a mistyped or inherited flag value is
 * an arm wearing another arm's name, and here it would be a golden wearing
 * another build's name.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import {
  TeamDecisionEngine,
  type TeamDecisionPorts,
  type TeamTurnResult,
} from '../lobster/team-decision-engine';

// ------------------------------------------------------------------- clocks

/** The fixed wall clock. Every deadline in the capture is relative to it. */
export const WALL = 1_000_000;

/** How long each board's decision is given, on the wall clock. */
export const BUDGET_MS = 250;

/**
 * A clock that advances by a fixed tick on every read. Elapsed time is a pure
 * function of how many times the code under test looked at it, which is what
 * makes a work count comparable across builds.
 */
class StepClock {
  private t: number;
  constructor(
    private readonly tick = 0.02,
    start = 1_000
  ) {
    this.t = start;
  }
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
}

// ------------------------------------------------------------------ boards

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

const piece = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  makeSnake(id, [at], { unitType, length: weight, teamID });

const boardOf = (snakes: Snake[], size: number, food: Coord[] = []): Board =>
  ({ width: size, height: size, food, hazards: [], snakes }) as Board;

/** One board in the replay set: the position, our team, and our units. */
export interface ReplayBoard {
  readonly name: string;
  readonly board: Board;
  readonly ourTeamId: string;
  readonly units: ReadonlyArray<string>;
  readonly turn: number;
}

/**
 * THE REPLAY SET. Three positions chosen to exercise different halves of the
 * decision: a pure piece board (tier and king caution), a mixed board with a
 * trail unit (the territory features and the health economy), and a
 * three-team board with food (the denominator, and a wider held set).
 *
 * Small on purpose. The gate is byte-identity, not coverage of the game: a
 * board that takes ten seconds buys no more identity than one that takes
 * two hundred milliseconds, and it makes the suite unrunnable.
 */
export const REPLAY_SET: ReadonlyArray<ReplayBoard> = [
  {
    name: 'pieces-7x7',
    turn: 9,
    ourTeamId: 'red',
    units: ['a', 'b'],
    board: boardOf(
      [
        piece('a', { x: 1, y: 3 }, 'king', 1, 'red'),
        piece('b', { x: 1, y: 1 }, 'rook', 2, 'red'),
        piece('K', { x: 5, y: 3 }, 'king', 1, 'blue'),
        piece('N', { x: 5, y: 5 }, 'knight', 1, 'blue'),
      ],
      7
    ),
  },
  {
    name: 'mixed-9x9',
    turn: 14,
    ourTeamId: 'red',
    units: ['t', 'q'],
    board: boardOf(
      [
        makeSnake('t', [
          { x: 2, y: 2 },
          { x: 2, y: 3 },
          { x: 2, y: 4 },
        ], { teamID: 'red' }),
        piece('q', { x: 4, y: 1 }, 'queen', 3, 'red'),
        piece('K', { x: 7, y: 7 }, 'king', 1, 'blue'),
        makeSnake('u', [
          { x: 6, y: 2 },
          { x: 6, y: 3 },
        ], { teamID: 'blue' }),
      ],
      9,
      [{ x: 4, y: 4 }]
    ),
  },
  {
    name: 'three-team-9x9',
    turn: 22,
    ourTeamId: 'red',
    units: ['a', 'b'],
    board: boardOf(
      [
        piece('a', { x: 1, y: 1 }, 'king', 1, 'red'),
        piece('b', { x: 3, y: 1 }, 'bishop', 2, 'red'),
        piece('K', { x: 7, y: 1 }, 'king', 1, 'blue'),
        piece('R', { x: 7, y: 4 }, 'rook', 2, 'blue'),
        piece('G', { x: 4, y: 7 }, 'king', 1, 'green'),
        piece('H', { x: 6, y: 7 }, 'knight', 1, 'green'),
      ],
      9,
      [
        { x: 4, y: 4 },
        { x: 2, y: 6 },
      ]
    ),
  },
];

const viewFor = (board: Board, snakeId: string, turn: number): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn,
    board,
    you: board.snakes.find((s) => s.id === snakeId) as Snake,
  }) as unknown as GameState;

// ----------------------------------------------------------------- capture

/**
 * ONE BOARD'S CAPTURE — the staged set, every emission's numbers, and the
 * shape of the plan table the decision built.
 *
 * ── WHAT IS IN, AND WHAT IS OUT, AND WHY ───────────────────────────────────
 *
 * IN: everything that IS the decision. The moves the fake manager received,
 * every emitted record's published numbers, the declared assumptions, and the
 * SET OF PLANS the decision held — plus the counters that are properties of
 * the decision rather than of the clock (emissions, epochs, conform calls,
 * bound violations, and every refusal channel except one).
 *
 * OUT: the slice-count family — `slices`, `improveCalls`, `refineCalls`,
 * `evaluateCalls`, the per-plan `visits`/`evaluations`, and the `worth`
 * refusal (which counts one per refined slice). MEASURED, on the UNCHANGED
 * build: three runs of the same binary on the piece board gave 178, 177, 178
 * slices. So the anytime loop's slice count is not reproducible run to run
 * even with both clocks faked, and a gate that pinned it would fail on the
 * build it was generated from. Everything downstream of the loop — which plan
 * was staged, what every record claimed, which plans were reached — was
 * IDENTICAL across those same runs, which is why the gate is drawn here.
 *
 * That is a pre-existing property of the loop and not a consequence of this
 * change; it is recorded rather than worked around silently.
 */
export interface BoardCapture {
  readonly name: string;
  /** `snakeId:move`, in the order the fake manager received them. */
  readonly staged: ReadonlyArray<string>;
  /** One row per emission: the record's own published numbers. */
  readonly journal: ReadonlyArray<{
    readonly lo: number;
    readonly est: number;
    readonly hi: number;
    readonly horizon: number;
    readonly slack: number;
    readonly posture: string;
    readonly epoch: number;
    readonly crossfade: string;
    readonly assumptions: number;
  }>;
  /** The decision's shape: what it reached and what it refused. */
  readonly structure: {
    readonly emits: number;
    readonly conformCalls: number;
    readonly epochs: number;
    readonly boundViolations: number;
    readonly stagedNothing: boolean;
    readonly leverOrderBinding: boolean;
    /** Every plan the decision ever held, by key, in table order. */
    readonly planKeys: ReadonlyArray<string>;
    /** Per-plan horizons, positionally aligned with `planKeys`. */
    readonly planHorizons: ReadonlyArray<number>;
    /** Refusals by channel, minus the per-slice `worth` counter. */
    readonly refusals: Readonly<Record<string, number>>;
  };
  /** The assumptions the forwarding path declared, as canonical strings. */
  readonly assumptions: ReadonlyArray<string>;
  readonly forwarded: number;
}

/**
 * WHAT IS LEFT OF THE SCRUB LIST.
 *
 * This used to name fifteen environment variables, because fifteen of them
 * could move a decision and any one inherited from a developer's shell would
 * have produced a golden wearing another build's name. Every variable this
 * agent owned is gone from the code, so nothing to clear: the bot is a value
 * (`lobster/bot-config.ts`) and `runBoard` below builds the default one, which
 * no environment can reach.
 *
 * TODO(teardown-search): the five below are the search-layer flags, still read
 * from `process.env` inside `makeSearchCore`. They are still scrubbed for the
 * original reason, and this list — and the scrub itself — goes away when they
 * become bot fields.
 */
const FLAG_ENVS = [
  'CENTAUR_CLUSTER_SEED',
  'CENTAUR_MULTISTART_SEED',
  'CENTAUR_EDGE_EV',
  'CENTAUR_CLUSTER_ENUM',
  'CENTAUR_SAMPLED_CAP',
  'CENTAUR_SCOUT',
];

function fakePorts(): TeamDecisionPorts & { staged: string[] } {
  const clock = new StepClock();
  const staged: string[] = [];
  return {
    staged,
    setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
      staged.push(`${snakeId}:${String(move)}`);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g: string, _s: (ev: PinEvent, turn?: number) => void) => () => undefined,
    pinSnakeIdOf: () => null,
    now: () => WALL,
    monotonic: clock.now,
    log: () => undefined,
  } as unknown as TeamDecisionPorts & { staged: string[] };
}

/**
 * Run every board with the remaining search-layer flags cleared. See
 * `FLAG_ENVS`: an inherited value would be a golden wearing another build's
 * name, and until those five are bot fields an inherited value is still
 * possible.
 */
export async function withScrubbedFlags<T>(fn: () => Promise<T>): Promise<T> {
  const saved = new Map(FLAG_ENVS.map((k) => [k, process.env[k]]));
  for (const k of FLAG_ENVS) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** One decision on one replay board, with both clocks faked. */
export async function runBoard(
  entry: ReplayBoard
): Promise<{ result: TeamTurnResult; staged: ReadonlyArray<string> }> {
  const ports = fakePorts();
  const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });
  const result = await engine.decideTurn({
    gameId: `identity-${entry.name}`,
    turn: entry.turn,
    board: entry.board,
    ourTeamId: entry.ourTeamId,
    units: entry.units.map((snakeId) => ({
      snakeId,
      view: viewFor(entry.board, snakeId, entry.turn),
    })),
    deadlineMs: WALL + BUDGET_MS,
  });
  return { result, staged: [...ports.staged] };
}

/** Run one board and capture what the decision did. */
export async function captureBoard(entry: ReplayBoard): Promise<BoardCapture> {
  const { result, staged } = await runBoard(entry);
  const report = result.report;
  return {
    name: entry.name,
    staged: [...staged],
    journal: (report?.journal ?? []).map((r) => ({
      lo: r.lo,
      est: r.est,
      hi: r.hi,
      horizon: r.horizon,
      slack: r.slack,
      posture: r.posture,
      epoch: r.epoch,
      crossfade: r.crossfade ?? 'absent',
      assumptions: r.assumptions.length,
    })),
    structure: {
      emits: report?.emits ?? -1,
      conformCalls: report?.conformCalls ?? -1,
      epochs: report?.epochs ?? -1,
      boundViolations: report?.boundViolations ?? -1,
      stagedNothing: report?.stagedNothing ?? true,
      leverOrderBinding: report?.leverOrderBinding ?? false,
      planKeys: (report?.planWork ?? []).map((w) => w.key),
      planHorizons: (report?.planWork ?? []).map((w) => w.horizon),
      refusals: Object.fromEntries(
        Object.entries(report?.refusals ?? {}).filter(([k]) => k !== 'worth')
      ),
    },
    assumptions: result.assumptions.map((a) => JSON.stringify(a)),
    forwarded: result.forwarded,
  };
}

/**
 * THE GOLDEN'S ENCODING — non-finite numbers survive the round trip.
 *
 * `WIN` is `+Infinity` and `DEAD` is the engine's lattice bottom, and both
 * reach a published ceiling on real boards (the piece board in this very set
 * emits `hi = Infinity`). `JSON.stringify` writes those as `null`, so a golden
 * stored as JSON would compare a real ceiling against a missing one and pass.
 * Every non-finite number is therefore tagged as its own string on both sides
 * of the comparison, which makes `Infinity` and `null` different values again.
 */
export function encodeCapture(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) return value.map(encodeCapture);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeCapture(v);
    }
    return out;
  }
  return value;
}

/**
 * The whole replay set, captured under a scrubbed environment.
 *
 * Sequential and not concurrent: two decisions sharing a process share the
 * geometry cache and the arena, and interleaving them would make the capture a
 * function of the scheduler.
 */
export async function captureReplaySet(): Promise<ReadonlyArray<BoardCapture>> {
  return withScrubbedFlags(async () => {
    const out: BoardCapture[] = [];
    for (const entry of REPLAY_SET) out.push(await captureBoard(entry));
    return out;
  });
}
