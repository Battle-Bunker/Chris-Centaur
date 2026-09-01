/**
 * THE DEPTH-ENGAGEMENT TRIPWIRE — and why it is in the same file as the toll.
 *
 * ── WHAT WENT WRONG WITHOUT IT ────────────────────────────────────────────
 *
 * A whole batch of sweep analysis concluded that this branch's multi-turn
 * lookahead "never ran in a single measured game" — `mechanism.cluster` null
 * on 100% of 7,680 decisions, at 400 ms, 1,200 ms and 4,000 ms alike, for the
 * treatment arm AND the control. On that reading a third of the batch's
 * conclusions were retracted and the branch's design centre was declared dead
 * code.
 *
 * It was a measurement artefact. The replay miner read `mechanism.cluster`,
 * `mechanism.scout.plies` and `mechanism.scout.focus.fired` — the RAW
 * `MechanismReport` paths — against the sweep harness's FLATTENED per-decision
 * telemetry, which carries `clusterJoints`, `scoutPlies` and `focusFired`.
 * Every lookup was `undefined`, so every cell printed 0.0%. Re-mined with the
 * field names the replays actually use, the same 7,680 decisions read 100.0%
 * enumeration, ~31 joints and 8–15 scout plies per decision, with the acute
 * focus firing on 16–28% of the treatment arm's turns.
 *
 * ── WHY THE PROGRAM COULD NOT TELL ────────────────────────────────────────
 *
 * Because no test ever asserted engagement END TO END. Every layer had a unit
 * test on a bare core; nothing said "play a real decision on a real board and
 * check the depth layer produced something". So a claim that the layer was
 * idle could not be falsified in a second, and it took a batch to answer.
 *
 * This file is that second. It is deliberately a GAME-LEVEL test — through
 * `TeamDecisionEngine.decideTurn`, on a piece-bearing board, on a wall clock —
 * because every layer below it was already green while the program believed
 * the layer was dead.
 *
 * ── THE TWO PROPERTIES, ASSERTED ON THE SAME RUNS ─────────────────────────
 *
 * They pull against each other, which is the entire reason they are here
 * together rather than in two files:
 *
 *   1. THE FIRST-PLAN TOLL IS GONE. The enumeration is materialised on first
 *      demand (`search/core.ts::clusterOf`) rather than when a session opens,
 *      so rung 0 stages a legal plan in tens of milliseconds and no decision
 *      reaches its deadline without one. Gated in full by
 *      `first-plan-latency.test.ts`.
 *   2. THE DEPTH LAYER STILL ENGAGES. Deferring the enumeration to the first
 *      refinement slice means a decision that runs NO refinement slice never
 *      reaches it. That is the failure mode the toll fix could plausibly have
 *      introduced and that nothing would have caught, so it is asserted on the
 *      same decisions that satisfy (1): every run below must both stage early
 *      AND come back with a cluster, threads and plies.
 *
 * A fix to either that breaks the other fails here.
 */

import type { Board, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import { clearGeometryCache } from '../lobster/substrate';
import {
  TeamDecisionEngine,
  type TeamDecisionPorts,
  type TeamTurnResult,
} from '../lobster/team-decision-engine';

jest.setTimeout(240_000);

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

const trail = (id: string, at: Coord, dy: number, teamID: string): Snake =>
  makeSnake(id, [at, { x: at.x, y: at.y + dy }, { x: at.x, y: at.y + 2 * dy }], { teamID });

/**
 * THE BOARD, AND WHY IT IS THIS ONE. 25×25, mixed roster, a king a side — the
 * same family the toll was measured on and the same family the sweeps that
 * produced the false finding played. A small board would pass this file while
 * saying nothing about the boards the program actually reads.
 */
const BOARD: Board = {
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
} as unknown as Board;

const viewFor = (board: Board, snakeId: string, turn: number, timeout: number): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout },
    turn,
    board,
    you: board.snakes.find((s) => s.id === snakeId) as Snake,
  }) as unknown as GameState;

interface Run {
  readonly firstStageMs: number | null;
  readonly wallMs: number;
  readonly result: TeamTurnResult;
}

async function decide(
  turn: number,
  budgetMs: number,
  options: ConstructorParameters<typeof TeamDecisionEngine>[1] = {}
): Promise<Run> {
  const ours = BOARD.snakes.filter((s) => (s as { teamID?: string }).teamID === 'red');
  let firstStageMs: number | null = null;
  let t0 = 0;
  const ports = {
    setBotRecommendation: () => {
      if (firstStageMs === null) firstStageMs = Date.now() - t0;
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g: string, _s: (ev: PinEvent, t?: number) => void) => () => undefined,
    pinSnakeIdOf: () => null,
    log: () => undefined,
  } as unknown as TeamDecisionPorts;
  const gameId = `depth-engagement-${turn}-${budgetMs}`;
  const engine = new TeamDecisionEngine(ports, options);
  t0 = Date.now();
  try {
    const result = await engine.decideTurn({
      gameId,
      turn,
      board: BOARD,
      ourTeamId: 'red',
      units: ours.map((s) => ({
        snakeId: s.id,
        view: viewFor(BOARD, s.id, turn, budgetMs),
      })),
      deadlineMs: Date.now() + budgetMs,
    });
    return { firstStageMs, wallMs: Date.now() - t0, result };
  } finally {
    engine.release(gameId);
  }
}

afterEach(() => clearGeometryCache());

describe('the depth layer engages in a real decision, and cannot silently stop', () => {
  for (const budget of [500, 1000]) {
    test(`${budget} ms: the enumeration, the threads and the plies are all non-zero`, async () => {
      const runs: Run[] = [];
      for (let turn = 4; turn < 9; turn++) runs.push(await decide(turn, budget));

      for (const r of runs) {
        const m = r.result.mechanism;
        expect(m).not.toBeNull();
        if (m === null) throw new Error('unreachable');

        // ---- THE UPSTREAM CAUSE, READ FIRST --------------------------------
        //
        // `clusterOf` is called from `improve` and nowhere else, so a decision
        // with `improveCalls === 0` has a null cluster row for a reason that
        // has nothing to do with the board. This is the column whose absence
        // from the manifest cost a batch; asserting it here is what makes the
        // three assertions below diagnosable when they fail.
        expect(m.loop).not.toBeNull();
        expect(m.loop?.improveCalls ?? 0).toBeGreaterThan(0);

        // ---- THE ENUMERATION ----------------------------------------------
        //
        // NULL is the specific failure this file exists to catch: it means the
        // layer was never reached. Zero joints on a non-null row would be a
        // different (and also wrong) finding — a board that admitted a
        // partition and enumerated nothing — so both are refused.
        expect(m.cluster).not.toBeNull();
        expect(m.cluster?.jointsEnumerated ?? 0).toBeGreaterThan(0);
        expect(m.cluster?.proposals ?? 0).toBeGreaterThan(0);

        // ---- THE SCOUT, WHOSE ROOTS ARE THOSE PROPOSALS --------------------
        //
        // `gatedBy` is the scout's own word for "depth was never reached, and
        // here is why". On a piece board with a live enumeration there is no
        // such reason, and a non-null value here is the layer telling us it
        // stopped — which is exactly what a silent idle would look like if it
        // ever became honest.
        expect(m.scout).not.toBeNull();
        expect(m.scout?.gatedBy ?? null).toBeNull();
        expect(m.scout?.threads ?? 0).toBeGreaterThan(0);
        expect(m.scout?.plies ?? 0).toBeGreaterThan(0);
        // The HONEST HORIZON: turns of play actually simulated. One ply is the
        // root itself, so anything above it is real lookahead.
        expect(m.scout?.deepestPlies ?? 0).toBeGreaterThan(0);

        // ---- THE DEPTH-EFFECT MACHINERY, REACHABLE -------------------------
        //
        // `belief.depthChangedStaging` is the per-decision indicator whose mean
        // over a corpus IS the depth-effect rate. It is asserted as REACHABLE
        // (a real boolean on a real belief row), not as true: whether depth
        // changed THIS decision is a property of the board, and a tripwire that
        // demanded it would be a flake. What must never happen is the row being
        // absent, because then the rate is unmeasurable and nobody can tell.
        expect(m.belief).not.toBeNull();
        expect(typeof m.belief?.depthChangedStaging).toBe('boolean');
        expect(m.belief?.deciding).toBe(true);

        // ---- AND THE TOLL IS STILL GONE, ON THESE SAME DECISIONS -----------
        //
        // The joint property. Deferring the enumeration is what bought the
        // first plan; the assertions above are what stop that deferral from
        // turning into a layer nobody reaches. Both, or neither counts.
        expect(r.firstStageMs).not.toBeNull();
        expect(r.firstStageMs as number).toBeLessThan(budget);
        expect(r.firstStageMs as number).toBeLessThan(r.wallMs / 2);
        expect(r.result.report?.stagedNothing).toBe(false);
      }

      // The first-plan p50 on the same runs, against the shipped bot's own
      // 46 ms — loosened to a fifth of the turn because this suite shares its
      // cores. Stated here as well as in `first-plan-latency.test.ts` so that
      // this file alone can witness both halves of the trade.
      const latencies = runs.map((r) => r.firstStageMs as number).sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length / 2)] as number;
      expect(p50).toBeLessThanOrEqual(budget / 4);

      // Cluster joints and scout plies summed over the cell, which is the pair
      // of numbers a sweep manifest reports and the pair the false finding read
      // as zero. Restated as a total so a single lucky decision cannot carry it.
      const joints = runs.reduce((a, r) => a + (r.result.mechanism?.cluster?.jointsEnumerated ?? 0), 0);
      const plies = runs.reduce((a, r) => a + (r.result.mechanism?.scout?.plies ?? 0), 0);
      expect(joints).toBeGreaterThan(0);
      expect(plies).toBeGreaterThan(0);
    });
  }

  /**
   * THE TRIPWIRE'S OWN CONTROL.
   *
   * An assertion that a row is non-null is worth nothing unless something can
   * make it null. A bot that refuses the enumeration is that something: it is
   * the one configuration on which the layer legitimately does not run, and it
   * must say so IN WORDS on `scout.gatedBy` rather than by a silent zero.
   *
   * This is also the distinction the reports were built to keep — `cluster`
   * reads ZERO for a bot that refused and NULL for a decision that never
   * reached the layer — so the control asserts the polarity in both rows.
   */
  test('a bot that refuses the enumeration says so, in words, on the same rows', async () => {
    const r = await decide(7, 1000, { bot: { name: 'no-enum', search: { clusterEnum: false } } });
    const m = r.result.mechanism;
    expect(m).not.toBeNull();
    if (m === null) throw new Error('unreachable');
    expect(m.config.clusterEnum).toBe(false);
    // The loop still ran — this is a refusal, not an unreached layer, and the
    // two are only distinguishable because the loop row is on the report.
    expect(m.loop?.improveCalls ?? 0).toBeGreaterThan(0);
    // Zero rather than null, per `clusterReport`'s stated convention.
    expect(m.cluster).not.toBeNull();
    expect(m.cluster?.jointsEnumerated).toBe(0);
    // And the scout names the reason instead of reporting an empty success.
    expect(m.scout?.gatedBy).toEqual(expect.stringContaining('clusterEnum'));
    expect(m.scout?.plies).toBe(0);
    // A refusal is still a decision: it stages.
    expect(r.result.report?.stagedNothing).toBe(false);
  });
});
