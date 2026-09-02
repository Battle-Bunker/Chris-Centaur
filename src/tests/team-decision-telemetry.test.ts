/**
 * REPLAY TELEMETRY UNDER THE DEFAULT ENGINE.
 *
 * The defect these pin: with `CENTAUR_ENGINE=lobster` the full pass returns
 * through `TeamDecisionEngine.decideTurn`, so the legacy VoronoiStrategy path
 * that wrote `decision_logs` rows never ran. Postgres kept receiving the
 * canonical board and the server's resolved moves and NOTHING in between — no
 * candidate, no number, no account of why the staged move was staged. The
 * back-fills (`recordSubmittedMove` / `recordServerMoves`) then updated a row
 * that did not exist.
 *
 * So: one row per unit per turn, snakes AND pieces; the row keyed in the
 * decision-log turn domain the back-fills use; every candidate carrying the
 * wire move, the risk layer's verdict and the evaluator's per-feature
 * contributions; and the decision-level account — kernel report, emission
 * journal, contrastive foil, modelling basis — riding alongside.
 */

jest.mock('../database/db', () => {
  const chain: Record<string, unknown> = {};
  chain.values = () => chain;
  chain.onConflictDoNothing = () => chain;
  chain.then = (onOk: unknown, onErr: unknown) =>
    Promise.resolve(undefined).then(onOk as never, onErr as never);
  chain.catch = (onErr: unknown) => Promise.resolve(undefined).catch(onErr as never);
  return {
    db: { insert: () => chain, execute: async () => ({ rows: [] }) },
    pool: { end: async () => undefined },
    dbConfigured: true,
  };
});

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';
import { buildDecisionRows, type UnitDecisionRow } from '../lobster/telemetry';
import type { TurnData } from '../server/active-game-manager';
import { ActiveGameManager } from '../server/active-game-manager';
import { DecisionLogger } from '../logic/decision-logger';

// ------------------------------------------------------------------ fixtures

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: `Team Red ${id.toUpperCase()}`,
    latency: '0',
    health: 92,
    body,
    head: body[0] as Coord,
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#cc2222', head: 'default', tail: 'default' },
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

const TURN = 12;

/** A MIXED board: one snake and one piece of ours, two enemies. Mixed on
 * purpose — the owner's complaint is that neither kind was logged. */
function mixedBoard(): Board {
  return {
    width: 7,
    height: 7,
    food: [{ x: 3, y: 3 }],
    hazards: [],
    snakes: [
      makeSnake('s1', [{ x: 1, y: 1 }, { x: 1, y: 0 }], { teamID: 'red' }),
      piece('p1', { x: 1, y: 4 }, 'rook', 2, { teamID: 'red' }),
      makeSnake('e1', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { teamID: 'blue', name: 'Team Blue E' }),
      piece('K', { x: 5, y: 2 }, 'king', 1, { teamID: 'blue', name: 'Team Blue K' }),
    ],
  } as Board;
}

const viewFor = (board: Board, snakeId: string, turn = TURN): GameState => ({
  game: {
    id: 'g1',
    ruleset: { name: 't', version: 'v', settings: {} },
    map: 'm',
    timeout: 500,
    source: 't',
  },
  turn,
  board,
  you: board.snakes.find((s) => s.id === snakeId) as Snake,
});

interface Staged {
  readonly snakeId: string;
  readonly move: CentaurMove;
  readonly turnData: TurnData;
}

interface FakePorts extends TeamDecisionPorts {
  readonly staged: Staged[];
  readonly logged: UnitDecisionRow[];
}

function fakePorts(registry: ReadonlyArray<string> = []): FakePorts {
  const staged: Staged[] = [];
  const logged: UnitDecisionRow[] = [];
  return {
    staged,
    logged,
    setBotRecommendation: (_g, snakeId, move, turnData) => {
      staged.push({ snakeId, move, turnData });
    },
    enableTeamStaging: () => undefined,
    // Nothing in this suite drives operator events; the engine only needs a
    // subscription to exist so its pin routing has somewhere to attach.
    onPinEvent: () => () => undefined,
    pinSnakeIdOf: (_g, unitId) => registry[unitId] ?? null,
    logDecision: (row) => {
      logged.push(row);
    },
    log: () => undefined,
  };
}

const decide = (
  engine: TeamDecisionEngine,
  board: Board,
  ids: ReadonlyArray<string>,
  budgetMs = 400,
  turn = TURN
) =>
  engine.decideTurn({
    gameId: 'g1',
    turn,
    board,
    ourTeamId: 'red',
    units: ids.map((id) => ({ snakeId: id, view: viewFor(board, id, turn) })),
    deadlineMs: Date.now() + budgetMs,
  });

/**
 * ONE DECISION, MANY ASSERTIONS.
 *
 * Every question below is about the SAME settled decision, so it is run once
 * here rather than once per test. That is not only tidier: these are real
 * wall-clock-budgeted anytime searches, and jest runs suites in parallel — a
 * suite that burns eleven of them starves the timing-sensitive games in
 * `basic-intelligence.test.ts` running beside it and makes THAT suite flaky.
 */
let shared: FakePorts;
let sharedResult: Awaited<ReturnType<TeamDecisionEngine['decideTurn']>>;

beforeAll(async () => {
  const board = mixedBoard();
  shared = fakePorts();
  const engine = new TeamDecisionEngine(shared, { kernel: { reserveMs: 20, sliceMs: 10 } });
  sharedResult = await decide(engine, board, ['s1', 'p1']);
}, 30_000);

afterAll(() => clearGeometryCache());

// ------------------------------------------------------------------- the row

describe('one decision_logs row per unit per turn, under the default engine', () => {
  test('every unit we command gets a row — snakes and chess pieces alike', async () => {
    const ports = shared;
    expect(ports.logged.map((r) => r.snakeId).sort()).toEqual(['p1', 's1']);
    // Ours only: an enemy is not a unit we decide for and never was logged.
    expect(ports.logged.some((r) => r.snakeId === 'e1' || r.snakeId === 'K')).toBe(false);
  }, 20_000);

  test('the row is keyed in the DECISION-LOG turn domain (board turn + 1)', async () => {
    const ports = shared;
    for (const row of ports.logged) {
      expect(row.turn).toBe(TURN + 1);
      // And the blob says which domain the other number is in, so a reader of
      // the stored row never has to undo the offset by guesswork.
      expect(row.decision.boardTurn).toBe(TURN);
    }
  }, 20_000);

  test('the columns the viewer and /api/logs read are populated', async () => {
    const ports = shared;
    const snake = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;
    expect(snake.position).toEqual({ x: 1, y: 1 });
    expect(snake.health).toBe(92);
    expect(snake.snakeName).toBe('Team Red S1');
    expect(snake.safeMoves.length).toBeGreaterThan(0);
    // A snake's candidates are DIRECTION-keyed, exactly as every historic row
    // is: the viewer's four-way candidate model keys on `String(move)`.
    expect(['up', 'down', 'left', 'right']).toContain(snake.botRecommendation);
    for (const evaluation of snake.moveEvaluations) {
      expect(typeof evaluation.move).toBe('string');
      expect(evaluation.dest).toEqual(expect.objectContaining({ x: expect.any(Number) }));
      expect(evaluation.breakdown.weights).toEqual(expect.any(Object));
      expect(evaluation.breakdown.weighted).toEqual(expect.any(Object));
      expect(Number.isFinite(evaluation.score)).toBe(true);
    }
  }, 20_000);

  test("a piece's wire move is its destination index, and it fits varchar(10)", async () => {
    const ports = shared;
    const rook = ports.logged.find((r) => r.snakeId === 'p1') as UnitDecisionRow;
    expect(typeof rook.botRecommendation).toBe('number');
    // `bot_recommendation` is varchar(10). A destination index on any board
    // this centaur plays is four digits at the outside, so the canonical
    // decimal form fits — and the row is only addressable if it does.
    expect(String(rook.botRecommendation).length).toBeLessThanOrEqual(10);
    // Piece candidates are DESTINATION-keyed, which is what makes the viewer
    // treat the evaluation rows themselves as the candidate set.
    expect(rook.moveEvaluations.length).toBeGreaterThan(1);
    for (const evaluation of rook.moveEvaluations) {
      expect(typeof evaluation.move).toBe('number');
    }
    // The staged move is always among them, whatever its ordering rank.
    expect(rook.moveEvaluations.some((e) => e.move === rook.botRecommendation)).toBe(true);
    expect(rook.moveEvaluations.filter((e) => e.chosen)).toHaveLength(1);
  }, 20_000);
});

// ---------------------------------------------------------- candidate detail

describe('what one candidate row says', () => {
  test('the risk verdict, the ordering rank and the score bracket all ride on it', async () => {
    const ports = shared;
    const snake = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;
    const chosen = snake.moveEvaluations.find((e) => e.chosen);
    expect(chosen).toBeDefined();
    const row = chosen as NonNullable<typeof chosen>;

    expect(['safe', 'atRisk', 'doomed']).toContain(row.tier);
    expect(['yes', 'maybe', 'no']).toContain(row.capture);
    expect(typeof row.captureValue).toBe('number');
    expect(typeof row.contingencies).toBe('number');
    expect(row.rank).toBeGreaterThanOrEqual(0);
    expect(row.healthSpent.lo).toBeLessThanOrEqual(row.healthSpent.hi);

    // A bounds engine's answer is a BRACKET, and the row carries the whole of
    // it plus the channel `score` reports.
    expect(row.bounds).not.toBeNull();
    const bounds = row.bounds as NonNullable<typeof row.bounds>;
    expect(bounds.lo).toBeLessThanOrEqual(bounds.est);
    expect(bounds.est).toBeLessThanOrEqual(bounds.hi);
    expect(['lo', 'est']).toContain(row.scoreChannel);
    expect(row.score).toBe(row.scoreChannel === 'lo' ? bounds.lo : bounds.est);
  }, 20_000);

  test('the per-feature breakdown is value × weight = contribution, and it adds up', async () => {
    const ports = shared;
    const snake = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;
    const row = snake.moveEvaluations.find((e) => e.chosen) as UnitDecisionRow['moveEvaluations'][number];

    // The production profile folds these; a reader can name the term that won.
    const keys = row.features.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['material', 'reach', 'room', 'food', 'momentum', 'contest'])
    );

    let sum = 0;
    for (const f of row.features) {
      // The arithmetic the breakdown claims, checked rather than trusted.
      expect(f.contribution.lo).toBeCloseTo(f.value.lo * f.weight, 9);
      expect(f.contribution.hi).toBeCloseTo(f.value.hi * f.weight, 9);
      sum += f.contribution.lo;
      // And the two legacy-shaped tables agree with the array.
      expect(row.breakdown.weights[f.key]).toBe(f.weight);
      expect(row.breakdown.weighted[`${f.key}Score`]).toBeCloseTo(f.contribution.lo, 9);
    }
    // The fold IS a weighted sum, so the parts have to reconstruct the whole.
    // (No terminal clamp fires on this board: nobody is eliminated.)
    expect(sum).toBeCloseTo((row.bounds as { lo: number }).lo, 6);
    expect(row.breakdown.engine).toBe('lobster');
    expect(row.breakdown.profile).toBe('lobster-territory');
  }, 20_000);
});

// -------------------------------------------------------------- decision meta

describe('the decision-level account', () => {
  test('the contrastive foil names the runner-up, the margin and the deciding feature', async () => {
    const ports = shared;
    const snake = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;
    const contrast = snake.decision.contrast;
    expect(contrast.chosen).toBe(snake.botRecommendation);
    expect(contrast.runnerUp).not.toBeNull();
    expect(contrast.runnerUp).not.toBe(contrast.chosen);
    expect(contrast.margin).not.toBeNull();

    // The margin is the difference between the two rows' own scores, on the
    // channel the foil names — not a number computed somewhere else.
    const scoreOf = (m: CentaurMove | null) =>
      snake.moveEvaluations.find((e) => e.move === m)?.score as number;
    expect(contrast.margin as number).toBeCloseTo(
      scoreOf(contrast.chosen) - scoreOf(contrast.runnerUp),
      9
    );
    // The deciding feature is the largest of the per-feature deltas, and every
    // delta is a real feature of the fold.
    if (contrast.deltas.length > 0) {
      expect(contrast.decidedBy).toBe(contrast.deltas[0]?.key);
      const known = new Set(snake.moveEvaluations[0]?.features.map((f) => f.key));
      for (const d of contrast.deltas) expect(known.has(d.key)).toBe(true);
    }
  }, 20_000);

  test('the emission journal carries every write, its elapsed time and why it superseded', async () => {
    const ports = shared;
    const result = sharedResult;
    const snake = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;
    const journal = snake.decision.journal;
    // ONE ROW PER UNIT PER TURN carrying the WHOLE journal — never a row per
    // emission.
    expect(journal.length).toBe(result.report?.journal.length);
    expect(journal.length).toBeGreaterThan(0);
    expect(journal[0]?.reason).toBe('first staged set');
    let previous = -1;
    journal.forEach((emission, i) => {
      expect(emission.seq).toBe(i);
      // Measured on the kernel's own clock, monotonically, and never a silent
      // zero standing in for "not recorded".
      expect(emission.elapsedMs).not.toBeNull();
      expect(emission.elapsedMs as number).toBeGreaterThanOrEqual(previous);
      previous = emission.elapsedMs as number;
      expect(emission.reason.length).toBeGreaterThan(0);
      expect(emission.lo).toBeLessThanOrEqual(emission.hi);
      expect(typeof emission.epoch).toBe('number');
    });
    expect(journal.filter((e) => e.changed).length).toBeGreaterThan(0);
  }, 20_000);

  test('the kernel report summary, the modelling basis and the pins ride on every row', async () => {
    const ports = shared;
    const result = sharedResult;
    for (const row of ports.logged) {
      const decision = row.decision;
      expect(decision.engine).toBe('lobster');
      expect(decision.profile).toBe('lobster-territory');

      const kernel = decision.kernel as NonNullable<typeof decision.kernel>;
      expect(kernel.elapsedMs).toBe(result.report?.elapsedMs);
      expect(kernel.budgetMs).toBe(result.report?.budgetMs);
      expect(kernel.slices).toBe(result.report?.slices);
      expect(kernel.emits).toBe(result.report?.emits);
      expect(kernel.abandoned).toBe(false);
      expect(kernel.stagedNothing).toBe(false);
      expect(typeof kernel.yields).toBe('number');
      expect(kernel.refusals).toEqual(expect.any(Object));

      // The units NOT ours to command, and not modelled, are held — and the
      // bounds are wide about exactly their unmade choices.
      expect([...decision.held].sort()).toEqual(['K', 'e1']);
      expect(decision.modelled).toEqual([]);
      expect(decision.pins).toEqual([]);
      // The decision's standing basis is declared, posture included.
      expect(decision.assumptions.some((a) => a.kind === 'posture')).toBe(true);
      expect(decision.candidates.reported).toBeGreaterThan(0);
      expect(decision.candidates.explained).toBeGreaterThan(0);
    }
  }, 20_000);

  test('a decision ABANDONED because the turn resolved early still writes its rows', async () => {
    const board = mixedBoard();
    const ports = fakePorts();
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 20, sliceMs: 10 } });

    // A newer turn arriving IS the abandonment signal: the older decision is
    // working on a board the server has already resolved. That turn is
    // precisely the one a replay has nothing to say about unless the row is
    // written from a `finally`.
    const older = decide(engine, board, ['s1', 'p1'], 5_000, TURN);
    await new Promise((r) => setTimeout(r, 60));
    const newer = decide(engine, board, ['s1', 'p1'], 400, TURN + 1);
    await Promise.all([older, newer]);

    const abandonedRows = ports.logged.filter((r) => r.turn === TURN + 1);
    expect(abandonedRows.length).toBe(2);
    expect(abandonedRows.every((r) => r.decision.kernel?.abandoned === true)).toBe(true);
    // Abandoned or not, the row still explains the staged set.
    for (const row of abandonedRows) {
      expect(row.moveEvaluations.length).toBeGreaterThan(0);
    }
  }, 30_000);
});

// ------------------------------------------------------------------ live UI

describe('the live UI is fed the same evaluations', () => {
  test("a snake's final turn data carries the per-candidate rows, not []", async () => {
    const ports = shared;
    const forSnake = ports.staged.filter((s) => s.snakeId === 's1');
    expect(forSnake.length).toBeGreaterThan(0);
    const last = forSnake[forSnake.length - 1] as Staged;
    expect(last.turnData.moveEvaluations.length).toBeGreaterThan(0);
    expect(last.turnData.safeMoves.length).toBeGreaterThan(0);
    // The final publish never changes the move — it attaches the reasons to
    // the move already staged.
    const interim = forSnake[forSnake.length - 2];
    if (interim !== undefined) expect(last.move).toBe(interim.move);

    // A PIECE's rows are the manager's own (they carry the stay/rotate
    // discriminant the client labels candidates with), so this layer does not
    // overwrite them — its piece detail goes to the database instead.
    const forPiece = ports.staged.filter((s) => s.snakeId === 'p1');
    expect(forPiece.every((s) => s.turnData.moveEvaluations.length === 0)).toBe(true);
  }, 20_000);
});

// ------------------------------------------------------------------ back-fill

describe('the back-fills find the row the team engine wrote', () => {
  test('recordSubmittedMove targets exactly the (game, snake, turn) the row was inserted at', async () => {
    const board = mixedBoard();
    const ports = shared;

    const row = ports.logged.find((r) => r.snakeId === 's1') as UnitDecisionRow;

    // A fresh logger (not the singleton) so the queue is ours to inspect. The
    // insert goes in exactly as the wire layer's port forwards it.
    const logger = new (DecisionLogger as unknown as { new (): DecisionLogger })();
    const queue = () => (logger as unknown as { queue: Array<Record<string, never>> }).queue;
    logger.logDecision({
      gameId: row.gameId,
      snakeId: row.snakeId,
      snakeName: row.snakeName,
      turn: row.turn,
      position: row.position,
      health: row.health,
      safeMoves: row.safeMoves,
      botRecommendation: row.botRecommendation,
      moveEvaluations: row.moveEvaluations,
      decision: row.decision,
      gameState: row.gameState,
    });

    // THE MANAGER'S OWN KEY, not a restatement of it: drive the real
    // `applyResolvedMoves` for the BOARD turn and capture what it asks the
    // logger to back-fill.
    const mgr = ActiveGameManager.getInstance();
    const view = viewFor(board, 's1');
    mgr.registerGame(view, 's1');
    mgr.updateBoard('g1', view);
    const spy = jest
      .spyOn(DecisionLogger.getInstance(), 'recordSubmittedMove')
      .mockImplementation((gameId, snakeId, turn, move, fatal) => {
        logger.recordSubmittedMove(gameId, snakeId, turn, move, fatal);
      });
    try {
      mgr.applyResolvedMoves('g1', TURN, { s1: 'up' });
    } finally {
      spy.mockRestore();
      mgr.endGame('g1');
    }

    const items = queue() as unknown as Array<
      | { kind: 'insert'; row: { gameId: string; snakeId: string; turn: number } }
      | { kind: 'moveUpdate'; update: { gameId: string; snakeId: string; turn: number } }
    >;
    const insert = items.find((q) => q.kind === 'insert') as Extract<
      (typeof items)[number],
      { kind: 'insert' }
    >;
    const update = items.find((q) => q.kind === 'moveUpdate') as Extract<
      (typeof items)[number],
      { kind: 'moveUpdate' }
    >;
    expect(insert).toBeDefined();
    expect(update).toBeDefined();
    // The UPDATE's WHERE clause is (game_id, snake_id, turn). If the engine
    // wrote its row on the BOARD turn, this is the assertion that fails —
    // which is the whole point of the +1.
    expect({
      gameId: update.update.gameId,
      snakeId: update.update.snakeId,
      turn: update.update.turn,
    }).toEqual({
      gameId: insert.row.gameId,
      snakeId: insert.row.snakeId,
      turn: insert.row.turn,
    });
    expect(insert.row.turn).toBe(TURN + 1);
  }, 20_000);
});

// ------------------------------------------------------------- failure paths

describe('telemetry never takes a decision down with it', () => {
  test('a unit whose row throws still gets a row, carrying the error', () => {
    const board = mixedBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      const unit = sub.unitOfWireId('s1');
      expect(unit).toBeDefined();
      const plan = new Map(
        sub.commandable(asTeam).map((id) => [id, sub.actionsOf(id)[0]])
      ) as never;

      const rows = buildDecisionRows({
        gameId: 'g1',
        turn: TURN,
        sub,
        asTeam,
        gen: new GrammarCandidateGenerator(),
        // An evaluator whose explain surface throws stands in for anything
        // that can go wrong while building a row.
        evaluate: {
          scorePlan: defaultEvaluator.scorePlan.bind(defaultEvaluator),
          evaluatePlan: defaultEvaluator.evaluatePlan.bind(defaultEvaluator),
          explainPlan: () => {
            throw new Error('explain exploded');
          },
        },
        report: null,
        finalPlan: plan,
        views: new Map([['s1', viewFor(board, 's1')]]),
        forwarded: new Map([['s1', 'up' as CentaurMove]]),
        assumptions: [],
        modelled: [],
        pins: [],
        engineName: 'lobster',
        bot: { botId: 'lobster:test@000000000000', behaviourId: 'test' },
        moveOf: () => 'up',
      });

      expect(rows).toHaveLength(1);
      // Even the DEGRADED row says who played it: a turn whose explanation
      // blew up is exactly the turn a reader most needs attributed.
      expect(rows[0]?.decision.botId).toBe('lobster:test@000000000000');
      expect(rows[0]?.decision.behaviourId).toBe('test');
      // The row still exists, still keyed where the back-fills look for it.
      expect(rows[0]?.turn).toBe(TURN + 1);
      expect(rows[0]?.decision.error).toContain('explain exploded');
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------------------ the cost

describe('the explain surface costs what it claims to', () => {
  /**
   * The local-game runner does NOT go through `TeamDecisionEngine` — it builds
   * a kernel directly in `decideTeam` — so it cannot measure this. Measured
   * here instead: `explainPlan` is `evaluatePlan` plus a map over the fold's
   * nine parts, so the overhead is a small constant multiple of nothing, and
   * it runs after the deadline in any case.
   */
  test('explainPlan is one ordinary evaluation plus a map over the parts', () => {
    const board = mixedBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      const plan = new Map(
        sub.commandable(asTeam).map((id) => [id, sub.actionsOf(id)[0]])
      ) as never;

      const N = 200;
      // Warm both paths so neither pays the other's first-call costs.
      for (let i = 0; i < 30; i++) {
        defaultEvaluator.evaluatePlan(sub, plan, asTeam);
        defaultEvaluator.explainPlan(sub, plan, asTeam);
      }
      // BOTH ORDERS, AVERAGED. Whichever of the two runs second measures
      // ~25% faster off the other's warmed state, which is larger than the
      // difference being measured — timing them in one fixed order reports
      // that artefact as the result (and reported `explainPlan` as the
      // CHEAPER of the two, which it cannot be: it calls the other).
      let evalNs = 0;
      let explainNs = 0;
      for (const explainFirst of [true, false]) {
        const a = process.hrtime.bigint();
        for (let i = 0; i < N; i++) {
          if (explainFirst) defaultEvaluator.explainPlan(sub, plan, asTeam);
          else defaultEvaluator.evaluatePlan(sub, plan, asTeam);
        }
        const b = process.hrtime.bigint();
        for (let i = 0; i < N; i++) {
          if (explainFirst) defaultEvaluator.evaluatePlan(sub, plan, asTeam);
          else defaultEvaluator.explainPlan(sub, plan, asTeam);
        }
        const c = process.hrtime.bigint();
        evalNs += Number(explainFirst ? c - b : b - a);
        explainNs += Number(explainFirst ? b - a : c - b);
      }
      const evalUs = evalNs / 1000 / (N * 2);
      const explainUs = explainNs / 1000 / (N * 2);
      console.log(
        `[explain-cost] evaluatePlan ${evalUs.toFixed(1)} us, ` +
          `explainPlan ${explainUs.toFixed(1)} us (x${(explainUs / evalUs).toFixed(2)})`
      );
      // Generous, because a shared CI box is noisy and this is a shape
      // assertion, not a benchmark: the point is that explaining is a constant
      // factor over evaluating and not a second scoring pipeline.
      expect(explainUs).toBeLessThan(evalUs * 3 + 20);
    } finally {
      sub.release();
    }
  }, 60_000);
});
