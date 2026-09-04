/**
 * THE RECORDED RUN — G1 and G2's instrument.
 *
 * A live decision cannot be re-run bit-exactly and this module does not
 * pretend otherwise: production reads the wall clock, and the same 150 ms
 * bought 18 slices on one run and 92 on another. What IS bit-exact is a
 * decision under the NODE clock, where `now()` is a work counter and both its
 * terms are pure functions of the program's own execution.
 *
 * THREE CHOICES MAKE THE PREFIX CLAIM (G2) MEAN SOMETHING, and each is here
 * rather than in the test because each is a property of the RUN:
 *
 *  1. ONE DECISION. The board is played to `turns` at a FIXED setup budget and
 *     then one decision is recorded on it. A multi-turn recording could not
 *     have a prefix property at all: a longer budget stages different moves,
 *     the board diverges at turn 2, and every later frame is a frame about a
 *     different game.
 *
 *  2. A FIXED SLICE LENGTH. `sliceMs` is a constant and `maxSliceFraction` is
 *     0, so the slice cap resolves to the slice floor and both runs take
 *     slices of the same size. A slice length proportional to the budget would
 *     make the `2b` run take DOUBLE-length slices, and "extends" would be
 *     false about a correct implementation.
 *
 *  3. THE RUN STOPS ON WORK, NOT ON A DEADLINE. The kernel's deadline is set
 *     far out and the decision is ABANDONED at `nodes` work units, so the loop
 *     never reaches its final flush. The flush is a deadline artefact — it
 *     waives the improvement threshold and stages whatever stands — and its
 *     frames would sit in the `b` run's stream at a position where the `2b`
 *     run is still searching. The gates that own the flush test it directly.
 *
 * The setup board is memoised per `(scenario, seed, turns)`: it is a pure
 * function of them, and the determinism suite asks for the same three setups
 * fourteen times.
 */

import type { Board } from '../../types/battlesnake';
import type { JointPlan, KernelInput, PinEvent, UnitId } from '../../lobster/contracts';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../../lobster/kernel';
import { rigFor } from '../../lobster/candidates';
import { defaultEvaluator } from '../../lobster/evaluate';
import { clearGeometryCache, makeSubstrate } from '../../lobster/substrate';
import {
  DecisionClock,
  MIXED_SCENARIO,
  SNAKE_SCENARIO,
  SPARSE_SCENARIO,
  buildBoard,
  decideTeam,
  meteredEvaluator,
  stepGame,
  type GameSpec,
} from '../../tests/local-game';
import type { EventId, LensEvent } from '../types';

/** One fixture decision, run with the `lens` sink attached, under the node
 *  clock. G1 byte-compares two runs at the same seed and budget; G2 asserts a
 *  `2b`-work run's frames EXTEND the `b` run's. */
export interface LensRunSpec {
  readonly scenario: string;
  readonly seed: number;
  readonly nodes: number;
  readonly turns: number;
  /**
   * THE TURN'S LOG, when the run is being recorded into one.
   *
   * The scripted operator's command is written HERE FIRST and the id the
   * writer stamped is what the kernel is handed, so the `operator` frame that
   * comes back answers an event that exists — which is the whole content of
   * `answers`, and the reason the one writer refuses an answer whose question
   * it has never seen. Production wires the same way round: the active game
   * manager writes the `pin`, then hands its id to `onPinEvent`.
   *
   * Absent ⇒ the command is queued with a NULL id. A recorded run with
   * nowhere to write the question must not invent an answer to it, and a
   * fabricated id would be the one kind of lie the total order cannot survive.
   */
  readonly command?: (event: PinEvent, atWorkMs: number) => EventId | null;
  /**
   * A SECOND consumer of the same frames, called synchronously as each one is
   * produced — the server-side sink, when the run is being recorded through
   * one. It sees the events in the order the kernel emitted them and
   * interleaved with the operator's commands above, which is the whole
   * content of a total order and the thing a post-hoc replay of the returned
   * array cannot reproduce.
   */
  readonly sink?: (event: LensEvent) => void;
}

const SCENARIOS: Readonly<Record<string, GameSpec>> = {
  snake: SNAKE_SCENARIO,
  snakes: SNAKE_SCENARIO,
  mixed: MIXED_SCENARIO,
  sparse: SPARSE_SCENARIO,
};

/** The budget the SETUP turns are played at — a constant, and deliberately not
 *  `spec.nodes`: the board a recorded decision is taken on must be the same
 *  board at `b` and at `2b`, or the two runs are not two readings of one
 *  question. */
const SETUP_NODES = 550;
/** One slice, in work units. Fixed across budgets — see (2) above. */
const SLICE_WORK = SETUP_NODES / 6;

/** A deterministic stream for the runner's own food placement. Not the
 *  search's salt: that is `SearchTuning.seed`, which the scenario carries. */
function rngOf(seed: number): () => number {
  let t = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const setups = new Map<string, Board>();

/** The board `turns − 1` settled turns in, played by the shipped path at a
 *  fixed budget. Pure in `(scenario, seed, turns)`, so it is memoised. */
async function setupBoard(spec: GameSpec, seed: number, turns: number, cacheKey: string): Promise<Board> {
  const hit = setups.get(cacheKey);
  if (hit !== undefined) return hit;
  const rng = rngOf(seed);
  let board = buildBoard({ ...spec, seed });
  const foodTarget = spec.foodTarget ?? spec.food.length;
  for (let turn = 1; turn < turns; turn++) {
    const staged = new Map<string, number>();
    for (const team of spec.teams) {
      const decision = await decideTeam(
        board,
        turn,
        team.id,
        { kind: 'nodes', nodes: SETUP_NODES },
        defaultEvaluator,
        false
      );
      for (const [wireId, to] of decision.staged) staged.set(wireId, to);
    }
    board = stepGame(board, turn, staged, rng, foodTarget).board;
    clearGeometryCache();
  }
  setups.set(cacheKey, board);
  return board;
}

/**
 * The decision, watched.
 *
 * The synthetic operator is scripted on EMISSION COUNT and not on the clock:
 * an operator whose acts were scheduled on time would act at different work
 * positions in the two runs, and the prefix claim would be measuring the
 * script rather than the search. It pins its first unit onto whatever the bot
 * has just staged for it (which is what a Space press does), inspects the
 * cluster on every emission, and lets the pin go two emissions later.
 */
export async function recordLensRun(spec: LensRunSpec): Promise<ReadonlyArray<LensEvent>> {
  const scenario = SCENARIOS[spec.scenario];
  if (scenario === undefined) throw new Error(`unknown scenario ${spec.scenario}`);
  const turns = Math.max(1, spec.turns);
  const board = await setupBoard(scenario, spec.seed, turns, `${spec.scenario}/${spec.seed}/${turns}`);
  const teamId = (scenario.teams[0] as { id: string }).id;
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const sub = makeSubstrate({ gameId: 'lens-record', board, turn: turns, asTeam: teamId, modeled: ourIds });
  const frames: LensEvent[] = [];
  try {
    const asTeam = sub.teamNumber(teamId);
    const clock = new DecisionClock(true);
    const { gen, search } = rigFor(sub, { seed: spec.seed });
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      crossfade: 'teammate',
      reserveMs: 0,
      sliceMs: SLICE_WORK,
      // The cap resolves to the floor: one slice length, both budgets.
      maxSliceFraction: 0,
      pinCacheCapacity: 32,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
    });
    const t0 = clock.now();
    const stop = t0 + spec.nodes;
    const kin: KernelInput = {
      sub,
      gen,
      evaluate: meteredEvaluator(defaultEvaluator, clock),
      search,
      asTeam,
      // Far out on purpose: the run stops on WORK (see (3) above), so the
      // deadline never arrives and the final flush never runs.
      deadlineMs: t0 + spec.nodes * 4,
      initialPins: [],
      assumptions: [],
      now: clock.now,
      abandoned: () => clock.work() >= stop,
      lens: (event) => {
        frames.push(event);
        if (spec.sink !== undefined) spec.sink(event);
      },
    };
    const port = kernel.lensPort();
    const roster = sub.commandable(asTeam);
    const subject = roster[0];
    let emitted = 0;
    for await (const rec of kernel.decide(kin)) {
      emitted++;
      // THE INSPECTOR, hovering. One conditional per emission, on the cluster
      // the subject is in — the first paint, which is a read of rows the
      // decision already priced and costs it no evaluation.
      const cluster = port.partition().find((c) => c.members.length > 0);
      if (cluster !== undefined) {
        const lock = lockFor(cluster.members[0] as string, rec.plan, sub.unitIdOf(cluster.members[0] as string));
        if (lock !== null) port.rankConditional(cluster.id, [lock]);
      }
      if (subject !== undefined && emitted === 2) {
        const to = rec.plan.get(subject)?.to;
        if (to !== undefined) {
          command(kernel, spec, clock, { kind: 'pin', pin: { unitId: subject, to, tentative: false } }, t0);
        }
      }
      if (subject !== undefined && emitted === 4) {
        command(kernel, spec, clock, { kind: 'unpin', unitId: subject }, t0);
      }
    }
  } finally {
    sub.release();
    clearGeometryCache();
  }
  return frames;
}

/**
 * The operator acts: the command is written to the turn's log first, and the
 * kernel is told about it with the id it was written under. The order is the
 * causal one and not a convenience — an answer that precedes its question is
 * unreadable in a total order, which is why the writer refuses one.
 */
function command(
  kernel: LobsterKernel,
  spec: LensRunSpec,
  clock: DecisionClock,
  event: PinEvent,
  t0: number
): void {
  const id = spec.command === undefined ? null : spec.command(event, clock.now() - t0);
  kernel.onPinEvent(event, id);
}

function lockFor(
  unit: string,
  plan: JointPlan,
  unitId: UnitId | undefined
): { unit: string; to: number } | null {
  if (unitId === undefined) return null;
  const to = plan.get(unitId)?.to;
  return to === undefined ? null : { unit, to };
}

/**
 * The byte form G1 and G2 compare.
 *
 * Stable field order, because object key order is an implementation detail and
 * a comparison that depended on it would fail for a reason that is not about
 * the search. Maps are expanded — `EmitRecord.plan` is one, and
 * `JSON.stringify` renders a Map as `{}`, which would quietly compare nothing
 * at all. Non-finite numbers are named rather than nulled: `-inf` is the
 * lattice bottom this bot proves floors against, and a serialiser that erased
 * it would erase the difference between "dead" and "unknown".
 */
export function serialiseLensEvent(event: LensEvent): string {
  return stable(event);
}

/**
 * A number, on the byte form, at TWELVE SIGNIFICANT DIGITS.
 *
 * Not a rounding of the decision — the values themselves are untouched — but a
 * property of the comparison, and it buys one thing: no digit run in the
 * serialisation can be thirteen long, so the gate's own "no wall clock in the
 * bytes" check cannot fire on the tail of an ordinary score. A double carries
 * ~16 significant digits and a divergence hidden in the 13th would have to
 * leave no other trace in a whole decision's frames to escape here, which is
 * not a shape any of G1's real failure modes have: a wall-clock read moves the
 * first digits, and mutable state the fold does not own moves the fields.
 *
 * `-inf` is NAMED rather than nulled: it is the lattice bottom this bot proves
 * floors against, and a serialiser that erased it would erase the difference
 * between "dead" and "unknown".
 */
function num(value: number): string {
  if (Number.isNaN(value)) return '"nan"';
  if (!Number.isFinite(value)) return value > 0 ? '"+inf"' : '"-inf"';
  const rounded = Number(value.toPrecision(12));
  if (rounded !== 0 && (Math.abs(rounded) >= 1e12 || Math.abs(rounded) < 1e-6)) {
    return JSON.stringify(rounded.toExponential(11));
  }
  return String(rounded);
}

function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return num(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value instanceof Map) {
    const parts = [...value.entries()].map(([k, v]) => `${JSON.stringify(String(k))}:${stable(v)}`);
    return `{${parts.sort().join(',')}}`;
  }
  if (value instanceof Set) return `[${[...value].map(stable).sort().join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(record[k])}`);
    return `{${parts.join(',')}}`;
  }
  return '"?"';
}
