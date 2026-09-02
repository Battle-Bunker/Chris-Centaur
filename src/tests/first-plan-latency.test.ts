/**
 * THE FIRST-PLAN TOLL — the gate, and the two halves it has to hold at once.
 *
 * ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
 *
 * Batch `20260831-batch2` mined the per-turn telemetry of 2,472 games and
 * found that this branch pays a FIXED setup toll before its anytime kernel
 * produces anything at all. Time to the first staged plan on a 25×25 mixed
 * king board, p50 / p90 / max:
 *
 *     turn budget    this branch          the shipped bot
 *     500 ms         343 / 527 / 1123     46 / 132 / 475
 *     1000 ms        311 / 469 / 1080     31 / 102 / 962
 *     2000 ms        326 / 492 / 1462     38 / 111 / 590
 *
 * 343 / 311 / 326 across three budgets is a PRICE, not a share — a setup toll
 * paid before the kernel starts thinking rather than slow thinking. At the
 * 500 ms rung it ate the whole turn: every one of the 100 missed deadlines in
 * that cell was a decision still waiting for its first plan, and the baseline
 * missed none.
 *
 * ── WHAT THE FIX IS ───────────────────────────────────────────────────────
 *
 * Two things moved, and neither is a change to what the search believes:
 *
 *   · THE ENUMERATION AND ITS DEPTH THREADS are no longer built when a session
 *     opens. `conform` opens a session too, so rung 0 — the call whose whole
 *     contract is *"a legal joint plan on the wire before any refinement
 *     runs"* — was paying for the entire pass before it could stage anything,
 *     and nothing in `conform` reads the result. It is materialised on first
 *     demand instead, which is the first refinement slice
 *     (`search/core.ts::clusterOf`).
 *   · RUNG 0 IS GIVEN A REAL SLICE. `conformNow` handed its one `price()` a
 *     budget spanning the whole decision, so the bank's B1/B2/B3 ladder had
 *     nothing to stop it — 210 ms mean, 415 ms worst, for a plan whose only
 *     job is to be legal and on the wire. It now gets
 *     `KernelOptions.rungZeroFraction` of the turn, the same share every other
 *     slice is capped at, and truncates the way every other bounded sweep does
 *     (`kernel.ts::conformNow`).
 *
 * ── WHAT THIS FILE GATES ──────────────────────────────────────────────────
 *
 * Two claims, and they pull against each other, which is why both are here:
 *
 *  1. THE TOLL IS GONE. On piece-bearing boards at the 500 ms rung, the first
 *     plan is on the wire in tens of milliseconds and NO decision reaches its
 *     deadline without one. That second half is the batch's own definition of
 *     the misses it measured, so it is the one stated as a count.
 *  2. THE CHEAP PLAN DID NOT BECOME THE ANSWER. A fix that ended the search
 *     early would pass every latency assertion here and be a catastrophe. The
 *     frozen-golden half of that claim lives in
 *     `core-registry-identity.test.ts`, on a step clock, where one side of the
 *     comparison can be frozen; this file's half is that the decision keeps
 *     searching after it stages and never gives ground on its proved floor.
 *
 * Wall clock is used deliberately and the thresholds are loose. The quantity
 * under test IS a latency, so a counting clock cannot measure it; the numbers
 * being separated are 30 ms against 900 ms, which survives a slow box with two
 * orders of magnitude to spare.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import { clearGeometryCache } from '../lobster/substrate';
import {
  TeamDecisionEngine,
  type TeamDecisionPorts,
  type TeamTurnResult,
} from '../lobster/team-decision-engine';

jest.setTimeout(240_000);

const BUDGET_MS = 500;
/**
 * THE GATE, AND WHY IT IS LOOSER THAN THE RESULT.
 *
 * The acceptance the batch's own numbers set is the shipped bot's 46 ms p50,
 * and the measured p50 on these boards is 31–47 ms. The gate is set at a fifth
 * of the turn because this file runs inside a parallel suite on whatever box
 * the suite is on, and a latency assertion pinned to its own best case is a
 * flake. 125 ms is still seven times under the 907 ms p50 the same probe
 * measures on the build before this fix, which is the separation that matters.
 */
const FIRST_PLAN_CEILING_MS = BUDGET_MS / 4;

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

/**
 * A trail unit whose body runs away from its head along `dy`, so no two units
 * ever share a turn-start cell (the substrate refuses such a board outright).
 */
const trail = (id: string, at: Coord, dy: number, teamID: string): Snake =>
  makeSnake(
    id,
    [at, { x: at.x, y: at.y + dy }, { x: at.x, y: at.y + 2 * dy }],
    { teamID }
  );

/**
 * THE BOARDS. 25×25 with a mixed roster and a king, and a 25×25 with a queen —
 * the two families the toll was measured on. Big, because the toll is a
 * function of reach and roster and a small board does not have one to pay.
 */
const BOARDS: ReadonlyArray<{ name: string; board: Board }> = [
  {
    name: 'mixed-king-25',
    board: {
      width: 25,
      height: 25,
      food: [
        { x: 12, y: 12 },
        { x: 4, y: 20 },
      ],
      hazards: [],
      snakes: [
        piece('k', { x: 6, y: 6 }, 'king', 1, 'red'),
        piece('q', { x: 9, y: 4 }, 'queen', 3, 'red'),
        piece('r', { x: 3, y: 9 }, 'rook', 2, 'red'),
        piece('n', { x: 11, y: 8 }, 'knight', 1, 'red'),
        trail('t1', { x: 14, y: 6 }, -1, 'red'),
        trail('t2', { x: 16, y: 14 }, 1, 'red'),
        piece('K', { x: 19, y: 19 }, 'king', 1, 'blue'),
        piece('Q', { x: 21, y: 16 }, 'queen', 3, 'blue'),
        trail('T1', { x: 18, y: 11 }, 1, 'blue'),
        trail('T2', { x: 8, y: 20 }, -1, 'blue'),
      ],
    } as unknown as Board,
  },
  {
    name: 'queen-25',
    board: {
      width: 25,
      height: 25,
      food: [{ x: 12, y: 12 }],
      hazards: [],
      snakes: [
        piece('q', { x: 7, y: 7 }, 'queen', 3, 'red'),
        trail('t1', { x: 5, y: 4 }, -1, 'red'),
        trail('t2', { x: 10, y: 4 }, -1, 'red'),
        trail('t3', { x: 5, y: 11 }, 1, 'red'),
        trail('t4', { x: 10, y: 11 }, 1, 'red'),
        piece('Q', { x: 18, y: 18 }, 'queen', 3, 'blue'),
        trail('T1', { x: 16, y: 15 }, -1, 'blue'),
        trail('T2', { x: 20, y: 15 }, -1, 'blue'),
      ],
    } as unknown as Board,
  },
];

const viewFor = (board: Board, snakeId: string, turn: number, timeout: number): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout },
    turn,
    board,
    you: board.snakes.find((s) => s.id === snakeId) as Snake,
  }) as unknown as GameState;

interface Run {
  /** Wall ms from the call to the FIRST move reaching the manager, or null. */
  readonly firstStageMs: number | null;
  readonly wallMs: number;
  readonly result: TeamTurnResult;
  readonly staged: ReadonlyArray<string>;
}

async function decide(board: Board, turn: number, budgetMs: number): Promise<Run> {
  const ours = board.snakes.filter((s) => (s as { teamID?: string }).teamID === 'red');
  const staged: string[] = [];
  let firstStageMs: number | null = null;
  let t0 = 0;
  const ports = {
    setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
      if (firstStageMs === null) firstStageMs = Date.now() - t0;
      staged.push(`${snakeId}:${String(move)}`);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g: string, _s: (ev: PinEvent, t?: number) => void) => () => undefined,
    pinSnakeIdOf: () => null,
    log: () => undefined,
  } as unknown as TeamDecisionPorts;
  const engine = new TeamDecisionEngine(ports, {});
  t0 = Date.now();
  try {
    const result = await engine.decideTurn({
      gameId: `first-plan-${turn}-${budgetMs}`,
      turn,
      board,
      ourTeamId: 'red',
      units: ours.map((s) => ({ snakeId: s.id, view: viewFor(board, s.id, turn, budgetMs) })),
      deadlineMs: Date.now() + budgetMs,
    });
    return { firstStageMs, wallMs: Date.now() - t0, result, staged: [...staged] };
  } finally {
    engine.release(`first-plan-${turn}-${budgetMs}`);
  }
}

afterEach(() => clearGeometryCache());

// ------------------------------------------------- 1. the toll, and the misses

describe('the first plan is on the wire before the enumeration begins', () => {
  for (const { name, board } of BOARDS) {
    test(`${name}: stages inside ${FIRST_PLAN_CEILING_MS} ms and misses no deadline at ${BUDGET_MS} ms`, async () => {
      const runs: Run[] = [];
      for (let turn = 4; turn < 12; turn++) runs.push(await decide(board, turn, BUDGET_MS));

      // THE BATCH'S OWN DEFINITION OF THE MISS: a decision that reached its
      // deadline with no plan staged. It was 100 of 100 overrunning decisions
      // at this rung; the acceptance is zero.
      const misses = runs.filter((r) => r.firstStageMs === null || r.firstStageMs > BUDGET_MS);
      expect(misses).toHaveLength(0);

      // And the toll itself, against the shipped bot's own p50.
      const latencies = runs
        .map((r) => r.firstStageMs as number)
        .sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length / 2)] as number;
      expect(p50).toBeLessThanOrEqual(FIRST_PLAN_CEILING_MS);

      // THE WHOLE DISTRIBUTION, NOT ONLY ITS MIDDLE — the toll was FIXED, so a
      // fix that only moved the median would have moved nothing. Stated as a
      // RATIO because that is the form that cannot flake: before the fix the
      // first plan arrived when the decision ENDED, `firstStageMs` and `wallMs`
      // being the same number to within a millisecond because the whole turn
      // WAS the setup toll. After it, the stage is a small fraction of a turn
      // that then keeps searching. A loaded box moves both numbers together and
      // leaves the ratio where it is, which an absolute millisecond ceiling on
      // the tail does not survive — this suite shares its cores.
      for (const r of runs) {
        expect(r.firstStageMs as number).toBeLessThan(r.wallMs / 2);
      }

      // Nothing above is worth anything if the decision did not actually
      // decide: every unit staged, and the report says a plan stands.
      for (const r of runs) {
        expect(r.result.report?.stagedNothing).toBe(false);
        expect(r.staged.length).toBeGreaterThan(0);
      }
    });
  }

  test('the toll is gone at EVERY rung, because it was a price and not a share', async () => {
    // The diagnostic that identified this as a setup toll was that 343 / 311 /
    // 326 ms did not move with the budget. So the fix has to hold at every
    // rung too, and a fix that merely scaled with the budget would fail here.
    const board = (BOARDS[0] as { board: Board }).board;
    for (const budget of [500, 1000, 2000]) {
      const r = await decide(board, 7, budget);
      expect(r.firstStageMs).not.toBeNull();
      expect(r.firstStageMs as number).toBeLessThan(budget);
      expect(r.firstStageMs as number).toBeLessThan(r.wallMs / 2);
    }
  });
});

// ------------------------------------- 2. the answer at a generous budget

describe('the early stage is a checkpoint, not the answer', () => {
  /**
   * ── WHERE THE "SAME CONCLUSION" CLAIM IS ACTUALLY GATED ──────────────────
   *
   * In `core-registry-identity.test.ts`, against a FROZEN golden on a STEP
   * CLOCK — every staged move, every emitted record, every refusal count and
   * every declared assumption on the replay set, unchanged. That is the gate,
   * and it is there rather than here because "two builds agree" needs one side
   * of the comparison frozen and a wall clock cannot supply one.
   *
   * What THIS instrument can say, and says: the cheap first plan did not become
   * the answer. A latency fix that ended the search early would pass every
   * assertion above and be a catastrophe, and it would look exactly like this
   * one from the outside — first plan at 30 ms, no missed deadlines — so the
   * distinguishing property is asserted separately.
   */
  for (const { name, board } of BOARDS) {
    test(`${name}: the decision keeps searching after it stages, and never gives ground`, async () => {
      const r = await decide(board, 7, 2000);
      const journal = r.result.report?.journal ?? [];
      expect(journal.length).toBeGreaterThan(0);

      // It staged early…
      expect(r.firstStageMs as number).toBeLessThan(r.wallMs / 2);
      // …and then spent the rest of the turn on refinement slices, which is
      // the whole point of moving the enumeration behind the first plan.
      expect(r.result.report?.improveCalls ?? 0).toBeGreaterThan(0);
      expect(r.wallMs).toBeGreaterThan((r.firstStageMs as number) * 3);

      // AND THE SLICES REACHED THE LAYER THE DEFERRAL MOVED. `improveCalls > 0`
      // says the loop ran; it does NOT say the enumeration was materialised,
      // and those are the two halves of what this fix actually did. A build
      // that ran refinement slices which never reached `clusterOf` would pass
      // every other assertion in this file and would have deferred the layer
      // into never — the exact failure a batch of sweep analysis spent itself
      // wrongly believing had happened here. It is one line, so it is asserted
      // where the trade is made rather than only next door.
      // Full tripwire, on its own boards and budgets: `depth-engagement.test.ts`.
      expect(r.result.mechanism?.loop?.improveCalls ?? 0).toBeGreaterThan(0);
      expect(r.result.mechanism?.cluster).not.toBeNull();
      expect(r.result.mechanism?.cluster?.jointsEnumerated ?? 0).toBeGreaterThan(0);
      expect(r.result.mechanism?.scout?.plies ?? 0).toBeGreaterThan(0);

      // THE RATCHET, WHICH IS WHAT MAKES THE EARLY STAGE FREE. Within a BASIS
      // a plan may only replace the staged one on a provably better floor, so
      // the floor can never fall — staging sooner cannot cost the decision
      // anything it would otherwise have had.
      //
      // Per basis, and not across one: an epoch change or a posture flip opens
      // a new basis deliberately, because a floor proved under one channel's
      // weighting is not the same statement as one proved under another's, and
      // comparing across the flip is exactly what the basis exists to prevent.
      // So the comparison is made inside each run of same-(epoch, posture)
      // records, which is the only place the claim means anything.
      const rows = journal as ReadonlyArray<{ lo: number; epoch: number; posture: string }>;
      for (let i = 1; i < rows.length; i++) {
        const previous = rows[i - 1] as { lo: number; epoch: number; posture: string };
        const current = rows[i] as { lo: number; epoch: number; posture: string };
        if (current.epoch !== previous.epoch || current.posture !== previous.posture) continue;
        expect(current.lo).toBeGreaterThanOrEqual(previous.lo);
      }

      // And the turn ended with a plan on the wire for every unit.
      expect(r.result.report?.stagedNothing).toBe(false);
      expect(r.staged.length).toBeGreaterThan(0);
    });
  }
});
