/**
 * THE LOCAL GAME RUNNER — watch the bot play, one line per unit per turn.
 *
 * Everything the repo had before this was RELATIVE: arm A against arm B, scored
 * on a paired margin. That measures which of two bots is better and says nothing
 * at all about whether either of them is sane. This runs the SHIPPED decision
 * path — the same substrate, generator, evaluator, search core and kernel
 * `team-decision-engine.ts` assembles, minus the wire — over the vendored rules,
 * and prints what every unit actually did, so a human can read thirty turns and
 * see whether a snake walks to the food.
 *
 * It is a tool, not a test: nothing here asserts. The gates that DO assert live
 * in `basic-intelligence.test.ts`, and they read the same counters this
 * produces.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { toApiCoord, apiCoordToIndex } from '../firebase/translate';
import { marshalBoard } from '../logic/turn-oracle';
import { resolveTurn } from '../engine-vendor/engine/resolveTurn';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import { EngineSubstrate, makeSubstrate, clearGeometryCache } from '../lobster/substrate';
import { GrammarCandidateGenerator, knobsForSafety } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import type { Evaluator, JointPlan, Candidate, UnitId, KernelInput } from '../lobster/contracts';
import { makeSearchCore } from '../lobster/search';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import { boardBearsPiece, resolveStagingSafety, stagingSafety } from '../lobster/staging-safety';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from '../logic/piece-moves';

// ---------------------------------------------------------------------------
// Board construction
// ---------------------------------------------------------------------------

export interface UnitSpec {
  readonly kind: string; // 'snake' | 'pawn' | 'knight' | 'queen' | ...
  readonly x: number;
  readonly y: number;
  /** Snake: body length (grown straight behind the head). Piece: weight. */
  readonly size?: number;
  readonly health?: number;
}

export interface TeamSpec {
  readonly id: string;
  readonly units: ReadonlyArray<UnitSpec>;
}

export interface GameSpec {
  readonly width: number;
  readonly height: number;
  readonly teams: ReadonlyArray<TeamSpec>;
  readonly food: ReadonlyArray<Coord>;
  /** Food kept on the board: a meal eaten is replaced next turn. */
  readonly foodTarget?: number;
  readonly maxTurns?: number;
  readonly budgetMs?: number;
  readonly seed?: number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isPiece = (kind: string): boolean => kind !== 'snake';

function makeUnit(
  id: string,
  teamId: string,
  letter: string,
  spec: UnitSpec,
  centre: Coord
): Snake {
  const size = spec.size ?? (isPiece(spec.kind) ? 1 : 3);
  const head: Coord = { x: spec.x, y: spec.y };
  const body: Coord[] = isPiece(spec.kind)
    ? [head]
    : Array.from({ length: size }, (_, i) => ({ x: spec.x, y: spec.y - i }));
  // Facing the board centre at spawn, in the wire's full-board convention
  // (dy grows DOWNWARD, so api dy is negated).
  const dx = Math.sign(centre.x - spec.x);
  const dy = -Math.sign(centre.y - spec.y);
  return {
    id,
    name: `${teamId} ${letter}`,
    latency: '0',
    health: spec.health ?? 100,
    body,
    head,
    length: size,
    shout: '',
    squad: teamId,
    customizations: { color: '#888888', head: 'default', tail: 'default' },
    letter,
    teamID: teamId,
    teamName: teamId,
    unitType: spec.kind,
    maxHealth: 100,
    orientation: { dx: dx === 0 && dy === 0 ? 0 : dx, dy: dx === 0 && dy === 0 ? 1 : dy },
  };
}

export function buildBoard(spec: GameSpec): Board {
  const centre: Coord = { x: (spec.width - 1) / 2, y: (spec.height - 1) / 2 };
  const snakes: Snake[] = [];
  for (const team of spec.teams) {
    team.units.forEach((u, i) => {
      snakes.push(makeUnit(`${team.id}-${LETTERS[i]}`, team.id, LETTERS[i] as string, u, centre));
    });
  }
  return {
    width: spec.width,
    height: spec.height,
    food: spec.food.map((f) => ({ ...f })),
    hazards: [],
    hazardDamage: 100,
    pawnPromotionWeight: DEFAULT_PAWN_PROMOTION_WEIGHT,
    maxHealthPerUnit: {},
    snakes,
  };
}

// ---------------------------------------------------------------------------
// One team's decision — the shipped path, minus the wire
// ---------------------------------------------------------------------------

export interface CandidateTrace {
  readonly to: Coord;
  readonly est: number;
  readonly lo: number;
}

export interface UnitTrace {
  readonly wireId: string;
  readonly letter: string;
  readonly kind: string;
  readonly health: number;
  readonly from: Coord;
  readonly to: Coord;
  /** The chosen move's rank among candidates, ordered by evaluated `est`. */
  readonly top: ReadonlyArray<CandidateTrace>;
  readonly reversed: boolean;
}

export interface TeamDecision {
  /** wireId -> the DESTINATION cell staged, exactly what the wire carries. */
  readonly staged: Map<string, number>;
  readonly traces: UnitTrace[];
  readonly horizon: number;
}

const monotonic = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

export async function decideTeam(
  board: Board,
  turn: number,
  teamId: string,
  budgetMs: number,
  evaluate: Evaluator = defaultEvaluator,
  trace = true
): Promise<TeamDecision> {
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const staged = new Map<string, number>();
  const traces: UnitTrace[] = [];
  if (ourIds.length === 0) return { staged, traces, horizon: 0 };

  const sub = makeSubstrate({ gameId: 'local', board, turn, asTeam: teamId, modeled: ourIds });
  try {
    const asTeam = sub.teamNumber(teamId);
    const safety = resolveStagingSafety(stagingSafety(), boardBearsPiece(sub));
    const gen = new GrammarCandidateGenerator(knobsForSafety(safety));
    const search = makeSearchCore({
      rungZeroRepair: safety === 'full',
      seedDeconflict: safety !== 'off',
    });
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      reserveMs: 5,
      sliceMs: 5,
      minWriteIntervalMs: 0,
    });
    const kin: KernelInput = {
      sub,
      gen,
      evaluate,
      search,
      asTeam,
      deadlineMs: monotonic() + budgetMs,
      initialPins: [],
      assumptions: [],
      now: monotonic,
    };
    let plan: JointPlan | null = null;
    let horizon = 0;
    for await (const rec of kernel.decide(kin)) {
      plan = rec.plan;
      horizon = rec.horizon;
    }
    if (plan === null) return { staged, traces, horizon };

    const w = board.width + 2;
    const h = board.height + 2;
    for (const [unitId, cand] of plan) {
      const unit = sub.unitOf(unitId);
      if (unit === undefined) continue;
      staged.set(unit.wireId, cand.to);
      if (!trace) continue;
      traces.push(traceFor(sub, evaluate, plan, asTeam, unitId, cand, w, h));
    }
    return { staged, traces, horizon };
  } finally {
    sub.release();
  }
}

/** Score every option this unit had, with the rest of the plan fixed. That is
 * exactly the comparison the evaluator makes when the sweep re-optimises this
 * unit, so a trace row shows what the bot BELIEVED about the move it took. */
function traceFor(
  sub: EngineSubstrate,
  evaluate: Evaluator,
  plan: JointPlan,
  asTeam: number,
  unitId: UnitId,
  chosen: Candidate,
  w: number,
  h: number
): UnitTrace {
  const unit = sub.unitOf(unitId);
  const from = (unit?.cells[0] ?? 0) as number;
  const scored: Array<CandidateTrace & { to_: number }> = [];
  for (const option of sub.actionsOf(unitId).slice(0, 24)) {
    const trial = new Map(plan);
    trial.set(unitId, option);
    let bound;
    try {
      bound = evaluate.scorePlan(sub, trial, asTeam);
    } catch {
      continue;
    }
    scored.push({ to: toApiCoord(option.to, w, h), est: bound.est, lo: bound.lo, to_: option.to });
  }
  scored.sort((a, b) => b.est - a.est || b.lo - a.lo);
  return {
    wireId: unit?.wireId ?? '?',
    letter: unit?.wireId.split('-')[1] ?? '?',
    kind: String(unit?.type ?? 'snake'),
    health: unit?.health ?? 0,
    from: toApiCoord(from, w, h),
    to: toApiCoord(chosen.to, w, h),
    top: scored.slice(0, 3),
    reversed: false,
  };
}

// ---------------------------------------------------------------------------
// One turn of the real rules
// ---------------------------------------------------------------------------

export interface TurnOutcome {
  readonly board: Board;
  readonly deaths: ReadonlyArray<{ id: string; cause: string }>;
  readonly ate: ReadonlyArray<string>;
}

export function stepGame(
  board: Board,
  turn: number,
  staged: ReadonlyMap<string, number>,
  rng: () => number,
  foodTarget: number
): TurnOutcome {
  const marshalled = marshalBoard(board, turn);
  // The wire stages a DESTINATION and the server's own movement grammar turns
  // it into a path — which is the only way a pawn's rotation, a slider's ray
  // and an illegal-move fallback stay the RULES' business and not the bot's.
  const units: ResolveUnit[] = marshalled.units.map((u) => {
    const to = staged.get(u.id);
    return to === undefined ? { ...u, path: [] } : { ...u, stagedMove: to };
  });
  const before = new Map(marshalled.units.map((u) => [u.id, u.occupancy.length]));
  const result = resolveTurn({ ...marshalled.config, units });

  const w = marshalled.fullWidth;
  const h = marshalled.fullHeight;
  const snakes: Snake[] = [];
  const ate: string[] = [];
  for (const snake of board.snakes ?? []) {
    const settled = result.board[snake.id];
    if (!settled) continue;
    const cells = settled.occupancy.map((c) => toApiCoord(c, w, h));
    const piece = snake.unitType !== undefined && snake.unitType !== 'snake';
    if (settled.occupancy.length > (before.get(snake.id) ?? 0)) ate.push(snake.id);
    const next: Snake = {
      ...snake,
      body: piece ? [cells[0] as Coord] : cells,
      head: { ...(cells[0] as Coord) },
      length: settled.occupancy.length,
      health: settled.health,
      customizations: { ...snake.customizations },
      orientation: result.rotations[snake.id]
        ? { ...result.rotations[snake.id] }
        : { ...snake.orientation },
    };
    promoteIfDue(next, board);
    snakes.push(next);
  }

  const deaths = Object.entries(result.deaths).map(([id, d]) => ({
    id,
    cause: String((d as { cause?: string }).cause ?? 'unknown'),
  }));

  const food = result.food.map((c) => toApiCoord(c, w, h));
  const occupied = new Set<number>();
  for (const s of snakes) for (const c of s.body) occupied.add(apiCoordToIndex(c, w, h));
  for (const f of food) occupied.add(apiCoordToIndex(f, w, h));
  let guard = 0;
  while (food.length < foodTarget && guard++ < 200) {
    const x = Math.floor(rng() * board.width);
    const y = Math.floor(rng() * board.height);
    const idx = apiCoordToIndex({ x, y }, w, h);
    if (occupied.has(idx)) continue;
    occupied.add(idx);
    food.push({ x, y });
  }

  return {
    board: { ...board, snakes, food },
    deaths,
    ate,
  };
}

function promoteIfDue(snake: Snake, board: Board): void {
  if (snake.unitType !== 'pawn') return;
  const threshold = board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT;
  if (snake.length < threshold) return;
  snake.unitType = 'queen';
  snake.length = 1;
  snake.body = [{ ...snake.head }];
  const cap = board.maxHealthPerUnit?.queen ?? 100;
  snake.health = Math.min(snake.health, cap);
  snake.maxHealth = cap;
}

// ---------------------------------------------------------------------------
// The game loop, and the counters a gate reads
// ---------------------------------------------------------------------------

export interface GameMetrics {
  turns: number;
  unitTurns: number;
  foodEaten: number;
  /** Moves that put a unit's head back on the cell it left last turn. */
  reversals: number;
  /** Unit-turns that ended where they began — a hold, or a pawn's rotation. */
  stationary: number;
  /**
   * THE DITHER SIGNATURE. The unit did not move, and the destination it staged
   * is not the one it staged last turn: a pawn rotating left, then right, then
   * left again is exactly this and nothing else.
   */
  dithers: number;
  /** Unit-turns that actually changed the unit's cell. */
  movesWithChoice: number;
  starvationDeaths: number;
  otherDeaths: number;
  deathsByCause: Record<string, number>;
  /** Health of every living unit at the end. */
  endHealth: number[];
  /** Wall time of the slowest single team decision, ms. */
  worstDecisionMs: number;
  crashed: string | null;
}

export interface GameResult {
  readonly metrics: GameMetrics;
  readonly log: string[];
  readonly finalBoard: Board;
}

export async function runGame(
  spec: GameSpec,
  opts: { evaluate?: Evaluator; trace?: boolean; onTurn?: (line: string) => void } = {}
): Promise<GameResult> {
  const rng = mulberry32(spec.seed ?? 1);
  const budget = spec.budgetMs ?? 150;
  const maxTurns = spec.maxTurns ?? 100;
  const foodTarget = spec.foodTarget ?? spec.food.length;
  let board = buildBoard(spec);
  const log: string[] = [];
  const emit = (line: string): void => {
    log.push(line);
    opts.onTurn?.(line);
  };

  const metrics: GameMetrics = {
    turns: 0,
    unitTurns: 0,
    foodEaten: 0,
    reversals: 0,
    stationary: 0,
    dithers: 0,
    movesWithChoice: 0,
    starvationDeaths: 0,
    otherDeaths: 0,
    deathsByCause: {},
    endHealth: [],
    worstDecisionMs: 0,
    crashed: null,
  };
  // wireId -> the cell it stood on BEFORE its last move.
  const previousCell = new Map<string, string>();
  /** wireId -> the destination it staged last turn, for the dither signature. */
  const previousStage = new Map<string, string>();
  const key = (c: Coord): string => `${c.x},${c.y}`;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const teams = new Set(
      (board.snakes ?? []).filter((s) => s.health > 0).map((s) => s.teamID as string)
    );
    if (teams.size <= 1) break;
    const staged = new Map<string, number>();
    const rows: string[] = [];
    try {
      for (const teamId of [...teams].sort()) {
        const t0 = monotonic();
        const decision = await decideTeam(
          board,
          turn,
          teamId,
          budget,
          opts.evaluate ?? defaultEvaluator,
          opts.trace ?? true
        );
        metrics.worstDecisionMs = Math.max(metrics.worstDecisionMs, monotonic() - t0);
        for (const [id, to] of decision.staged) staged.set(id, to);
        for (const tr of decision.traces) {
          const prev = previousCell.get(tr.wireId);
          const moved = key(tr.from) !== key(tr.to);
          const lastStage = previousStage.get(tr.wireId);
          if (moved) metrics.movesWithChoice++;
          else {
            metrics.stationary++;
            if (lastStage !== undefined && lastStage !== key(tr.to)) metrics.dithers++;
          }
          if (moved && prev !== undefined && prev === key(tr.to)) metrics.reversals++;
          previousStage.set(tr.wireId, key(tr.to));
          metrics.unitTurns++;
          const opts3 = tr.top
            .map((c) => `(${c.to.x},${c.to.y})=${c.est.toFixed(2)}`)
            .join(' ');
          rows.push(
            `  T${String(turn).padStart(3)} ${tr.wireId.padEnd(10)} ${tr.kind.padEnd(6)} ` +
              `hp${String(tr.health).padStart(3)} (${tr.from.x},${tr.from.y})->(${tr.to.x},${tr.to.y})` +
              `${prev === key(tr.to) && moved ? ' REVERSAL' : ''}` +
              `${!moved && lastStage !== undefined && lastStage !== key(tr.to) ? ' DITHER' : ''}` +
              `  top3: ${opts3}`
          );
          previousCell.set(tr.wireId, key(tr.from));
        }
      }
    } catch (err) {
      metrics.crashed = `turn ${turn}: ${(err as Error).message}`;
      break;
    }

    const outcome = stepGame(board, turn, staged, rng, foodTarget);
    metrics.foodEaten += outcome.ate.length;
    for (const d of outcome.deaths) {
      metrics.deathsByCause[d.cause] = (metrics.deathsByCause[d.cause] ?? 0) + 1;
      if (d.cause === 'exhaustion' || d.cause === 'hazard') metrics.starvationDeaths++;
      else metrics.otherDeaths++;
    }
    board = outcome.board;
    metrics.turns = turn;
    const food = board.food.map((f) => `(${f.x},${f.y})`).join(' ');
    emit(`turn ${turn}  food: ${food || '(none)'}`);
    for (const r of rows) emit(r);
    for (const d of outcome.deaths) emit(`  DEATH ${d.id} (${d.cause})`);
    if (outcome.ate.length > 0) emit(`  ATE ${outcome.ate.join(', ')}`);
    clearGeometryCache();
  }

  metrics.endHealth = (board.snakes ?? []).map((s) => s.health);
  return { metrics, log, finalBoard: board };
}

// ---------------------------------------------------------------------------
// Scenarios and CLI
// ---------------------------------------------------------------------------

/** A food-adequate snake board: three teams of two snakes, six meals standing. */
export const SNAKE_SCENARIO: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    { id: 'red', units: [{ kind: 'snake', x: 1, y: 1 }, { kind: 'snake', x: 1, y: 9 }] },
    { id: 'blue', units: [{ kind: 'snake', x: 9, y: 1 }, { kind: 'snake', x: 9, y: 9 }] },
    { id: 'green', units: [{ kind: 'snake', x: 5, y: 0 }, { kind: 'snake', x: 5, y: 10 }] },
  ],
  food: [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 3, y: 7 },
    { x: 7, y: 7 },
    { x: 5, y: 5 },
    { x: 0, y: 5 },
  ],
  foodTarget: 6,
  maxTurns: 100,
};

/** The mixed roster the owner watched: snakes, a pawn, a knight, a queen. */
export const MIXED_SCENARIO: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    {
      id: 'red',
      units: [
        { kind: 'snake', x: 1, y: 2 },
        { kind: 'pawn', x: 2, y: 1 },
        { kind: 'knight', x: 0, y: 0 },
      ],
    },
    {
      id: 'blue',
      units: [
        { kind: 'snake', x: 9, y: 8 },
        { kind: 'queen', x: 8, y: 9 },
        { kind: 'pawn', x: 10, y: 10 },
      ],
    },
    {
      id: 'green',
      units: [
        { kind: 'snake', x: 5, y: 0 },
        { kind: 'knight', x: 5, y: 10 },
      ],
    },
  ],
  food: [
    { x: 3, y: 3 },
    { x: 7, y: 7 },
    { x: 5, y: 5 },
    { x: 2, y: 8 },
    { x: 8, y: 2 },
  ],
  foodTarget: 5,
  maxTurns: 100,
};

/**
 * THE STARVATION BOARD. Two meals on a 13x13 and nothing else to do: a bot with
 * no food gradient wanders, its health counts down one per cell entered, and
 * every snake on it is dead by turn 100. A bot that walks to the food is not.
 */
export const SPARSE_SCENARIO: GameSpec = {
  width: 13,
  height: 13,
  teams: [
    { id: 'red', units: [{ kind: 'snake', x: 1, y: 1 }, { kind: 'snake', x: 1, y: 11 }] },
    { id: 'blue', units: [{ kind: 'snake', x: 11, y: 1 }, { kind: 'snake', x: 11, y: 11 }] },
  ],
  food: [
    { x: 6, y: 6 },
    { x: 3, y: 9 },
  ],
  foodTarget: 2,
  maxTurns: 100,
};

export const SCENARIOS: Record<string, GameSpec> = {
  snakes: SNAKE_SCENARIO,
  mixed: MIXED_SCENARIO,
  sparse: SPARSE_SCENARIO,
};

async function main(): Promise<void> {
  const which = process.argv[2] ?? 'snakes';
  const turns = Number(process.argv[3] ?? 30);
  const seed = Number(process.argv[4] ?? 1);
  const budget = Number(process.argv[5] ?? 150);
  const spec = SCENARIOS[which];
  if (spec === undefined) throw new Error(`unknown scenario ${which}`);
  const result = await runGame(
    { ...spec, maxTurns: turns, seed, budgetMs: budget },
    { onTurn: (l) => console.log(l) }
  );
  console.log('--- metrics ---');
  console.log(JSON.stringify(result.metrics, null, 2));
  const perHundred =
    result.metrics.unitTurns === 0
      ? 0
      : (100 * result.metrics.foodEaten) / result.metrics.unitTurns;
  console.log(`food per 100 unit-turns: ${perHundred.toFixed(2)}`);
  const pct = (n: number, d: number): string => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
  console.log(`reversal rate: ${pct(result.metrics.reversals, result.metrics.unitTurns)}%`);
  console.log(`dither rate:   ${pct(result.metrics.dithers, result.metrics.unitTurns)}%`);
  console.log(`stationary:    ${pct(result.metrics.stationary, result.metrics.unitTurns)}%`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
