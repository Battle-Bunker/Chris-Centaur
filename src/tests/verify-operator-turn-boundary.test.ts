/**
 * VERIFIER V1 — the turn boundary, end to end through `TeamDecisionEngine`.
 *
 * The wire layer's rule is "turn change discards silently": no unpin flurry is
 * emitted, the pins simply stop existing. This suite checks that the rule
 * survives all the way through the engine — the ledger, the kernel's pin
 * context cache, and the emitted records' assumptions — for pins, for commits,
 * and for a pin that arrives in the gap BETWEEN two decisions.
 *
 * Deterministic: the kernel's clock is a step clock injected through
 * `TeamDecisionPorts.monotonic`, and the wall clock is a constant.
 */

import type { Board as ApiBoard, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent, UnitId } from '../lobster/contracts';
import type { KernelReport } from '../lobster/kernel';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';

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

function makeSnakeUnit(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
  makeSnakeUnit(id, [at], { unitType, length: weight, teamID } as Partial<Snake>);

const board = (): ApiBoard =>
  ({
    width: 7,
    height: 7,
    food: [],
    hazards: [],
    snakes: [
      piece('a', { x: 1, y: 3 }, 'king', 1, 'red'),
      piece('b', { x: 1, y: 1 }, 'rook', 2, 'red'),
      piece('K', { x: 5, y: 3 }, 'king', 1, 'blue'),
      piece('N', { x: 5, y: 5 }, 'knight', 1, 'blue'),
    ],
  }) as ApiBoard;

const WALL = 10_000;

interface FakePorts extends TeamDecisionPorts {
  readonly staged: Array<{ snakeId: string; move: CentaurMove; turn: number }>;
  fire(ev: PinEvent): void;
  turn: number;
}

function fakePorts(registry: ReadonlyArray<string>): FakePorts {
  const clock = new StepClock();
  const staged: Array<{ snakeId: string; move: CentaurMove; turn: number }> = [];
  let sink: ((ev: PinEvent) => void) | null = null;
  const ports: FakePorts = {
    staged,
    turn: 0,
    setBotRecommendation: (_g, snakeId, move) => {
      staged.push({ snakeId, move, turn: ports.turn });
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g, s) => {
      sink = s;
      return () => {
        sink = null;
      };
    },
    pinSnakeIdOf: (_g, unitId) => registry[unitId] ?? null,
    now: () => WALL,
    monotonic: clock.now,
    log: () => undefined,
    fire: (ev) => {
      if (sink === null) throw new Error('no pin sink subscribed');
      sink(ev);
    },
  };
  return ports;
}

const viewFor = (b: ApiBoard, snakeId: string, turn: number): GameState =>
  ({
    game: {
      id: 'g',
      ruleset: { name: 't', version: 'v', settings: {} },
      map: 'm',
      timeout: 10_000,
      source: 't',
    },
    turn,
    board: b,
    you: b.snakes.find((s) => s.id === snakeId) as Snake,
  }) as GameState;

/** A legal, non-stay destination for wire unit `wireId` on this board. */
function destinationFor(b: ApiBoard, wireId: string, turn: number): { unitId: UnitId; to: number } {
  const sub = makeSubstrate({ board: b, turn, asTeam: 'red' });
  try {
    const u = sub.unitOfWireId(wireId);
    if (u === undefined) throw new Error(`no unit ${wireId}`);
    const at = u.cells[0] as number;
    const to = sub
      .actionsOf(u.unitId)
      .map((c) => c.to)
      .find((d) => d !== at) as number;
    return { unitId: u.unitId, to };
  } finally {
    sub.release();
  }
}

async function decide(
  engine: TeamDecisionEngine,
  ports: FakePorts,
  b: ApiBoard,
  turn: number
): Promise<KernelReport> {
  ports.turn = turn;
  const result = await engine.decideTurn({
    gameId: 'g1',
    turn,
    board: b,
    ourTeamId: 'red',
    units: [
      { snakeId: 'a', view: viewFor(b, 'a', turn) },
      { snakeId: 'b', view: viewFor(b, 'b', turn) },
    ],
    deadlineMs: WALL + 200,
  });
  return result.report as KernelReport;
}

afterEach(() => clearGeometryCache());

describe('the turn boundary discards the operator state, silently and completely', () => {
  test('a pin taken mid-turn N does not exist in turn N+1', async () => {
    const b = board();
    const { unitId, to } = destinationFor(b, 'a', 9);
    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, {
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
    });

    // --- turn 9: the operator pins unit `a` mid-decision.
    let fired = false;
    const original = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation =
      (gameId, snakeId, move, turnData) => {
        original(gameId, snakeId, move, turnData);
        if (!fired && ports.turn === 9) {
          fired = true;
          ports.fire({ kind: 'pin', pin: { unitId: 0, to, tentative: false } });
        }
      };
    const nine = await decide(engine, ports, b, 9);
    expect(fired).toBe(true);
    expect(nine.epochs).toBe(2);
    const pinnedRecords = nine.journal.filter((r) => r.epoch >= 1);
    expect(pinnedRecords.length).toBeGreaterThan(0);
    for (const rec of pinnedRecords) {
      expect(rec.plan.get(unitId)?.to).toBe(to);
      expect(
        rec.assumptions.some((a) => a.kind === 'operator-pin' && a.unitId === unitId && a.to === to)
      ).toBe(true);
    }

    // --- turn 10: nothing carries over.
    const ten = await decide(engine, ports, b, 10);
    expect(ten.epochs).toBe(1); // no epoch: the pin is simply gone
    expect(ten.activeContextKey).toBe('pin:[]');
    expect(ten.contexts.map((c) => c.key)).toEqual(['pin:[]']);
    expect(ten.cache.creates).toBe(1); // a FRESH cache, not the turn-9 one
    expect(ten.conformance).toHaveLength(0);
    for (const rec of ten.journal) {
      expect(rec.assumptions.some((a) => a.kind === 'operator-pin')).toBe(false);
      expect(rec.epoch).toBe(0);
    }
    expect(ten.stagedNothing).toBe(false);
  }, 60_000);

  test('a COMMIT in turn N does not make the unit permanent in turn N+1', async () => {
    const b = board();
    const { unitId, to } = destinationFor(b, 'a', 9);
    const other = (() => {
      const sub = makeSubstrate({ board: b, turn: 11, asTeam: 'red' });
      try {
        const u = sub.unitOfWireId('a');
        if (u === undefined) throw new Error('no unit a');
        const at = u.cells[0] as number;
        const dests = sub
          .actionsOf(u.unitId)
          .map((c) => c.to)
          .filter((d) => d !== at);
        return dests[dests.length - 1] as number;
      } finally {
        sub.release();
      }
    })();
    expect(other).not.toBe(to);

    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, {
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
    });

    let firedTurn: number | null = null;
    const original = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation =
      (gameId, snakeId, move, turnData) => {
        original(gameId, snakeId, move, turnData);
        if (firedTurn === ports.turn) return;
        if (ports.turn === 9) {
          firedTurn = 9;
          ports.fire({ kind: 'pin', pin: { unitId: 0, to, tentative: false } });
          ports.fire({ kind: 'commit', unitId: 0 });
        } else if (ports.turn === 11) {
          firedTurn = 11;
          // If the commit had survived the turn change, this pin would be
          // refused and no second epoch would open.
          ports.fire({ kind: 'pin', pin: { unitId: 0, to: other, tentative: false } });
        }
      };

    const nine = await decide(engine, ports, b, 9);
    expect(nine.epochs).toBeGreaterThanOrEqual(2);

    const eleven = await decide(engine, ports, b, 11);
    expect(firedTurn).toBe(11);
    expect(eleven.epochs).toBe(2); // the new pin took effect
    for (const rec of eleven.journal.filter((r) => r.epoch >= 1)) {
      expect(rec.plan.get(unitId)?.to).toBe(other);
    }
  }, 60_000);

  test('a pin that arrives BETWEEN two decisions is discarded by the turn change, not applied to the next turn', async () => {
    const b = board();
    const { unitId, to } = destinationFor(b, 'a', 9);
    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, {
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
    });

    await decide(engine, ports, b, 9);
    // The gap: no decision is live, so the kernel never sees this.
    ports.fire({ kind: 'pin', pin: { unitId: 0, to, tentative: false } });
    const ten = await decide(engine, ports, b, 10);

    expect(ten.epochs).toBe(1);
    expect(ten.contexts.map((c) => c.key)).toEqual(['pin:[]']);
    for (const rec of ten.journal) {
      expect(rec.assumptions.some((a) => a.kind === 'operator-pin' && a.unitId === unitId)).toBe(
        false
      );
    }
  }, 60_000);

  test('the pin-context cache is per decision: turn N+1 starts cold even after an oscillating turn N', async () => {
    const b = board();
    const { to } = destinationFor(b, 'a', 9);
    const ports = fakePorts(['a', 'b']);
    const engine = new TeamDecisionEngine(ports, {
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
    });

    let n = 0;
    const original = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation =
      (gameId, snakeId, move, turnData) => {
        original(gameId, snakeId, move, turnData);
        if (ports.turn !== 9 || n >= 1) return;
        n++;
        ports.fire({ kind: 'pin', pin: { unitId: 0, to, tentative: false } });
      };

    const nine = await decide(engine, ports, b, 9);
    expect(nine.cache.creates).toBeGreaterThanOrEqual(2);
    expect(nine.contexts.length).toBeGreaterThanOrEqual(2);

    const ten = await decide(engine, ports, b, 10);
    expect(ten.cache).toEqual({
      hits: 0,
      misses: 1,
      resumes: 0,
      invalidations: 0,
      evictions: 0,
      creates: 1,
      // [CHANGE 2]'s counter, shipped with the change it defends: this turn
      // had no epoch, so nothing went looking for a hover to promote.
      promotionAttempts: 0,
      promotions: 0,
    });
  }, 60_000);
});
