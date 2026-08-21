/**
 * Mid-path DEATH in the one shared cost projection (simulator.ts's
 * projectPath / projectedHealthCost), and how it is valued.
 *
 * Reported from live play: a bishop planned a long ray that CROSSED a snake
 * body — an ALLY's — and ate food at the far end, and the client valued it as
 * a free, health-restoring move. Per the engine (TacticToes
 * functions/src/gameprocessors/engine/turnEngine.ts) a slider genuinely
 * ARRIVES on every square of its ray and every square is contested, so a body
 * segment is an absolute wall: the mover dies there unless its invulnerability
 * tier is STRICTLY higher, in which case it severs and CAPTURE-STOPS on that
 * square. The engine compares tiers and weights and never teams — an ally's
 * body kills exactly like an enemy's — and a mover KILLED OUTRIGHT is removed
 * before the food phase, so it cannot eat, not even on its death square.
 * (Exhaustion is the one death the food phase can undo — a separate rule, and
 * a separate block below.)
 *
 * SIMULTANEITY. The engine resolves every snake's whole move in sub-step 1, so
 * a slider contests POST-move bodies. From the pre-move board the client can
 * see exactly one square of that shift — the tail always vacates — so that is
 * the one segment the projection lets through. Every other segment is treated
 * as still occupied, and the square a head moves INTO is not modelled here at
 * all. Index 0 is the interesting one: it is the owner's start-of-turn head
 * cell, which by arrival is either the NECK it swept in behind itself (it
 * stepped away) or an EDGE EXCHANGE (it stepped into us). The projection
 * models the neck, as a deliberate policy — see the conservative-policy
 * verification block below, which checks the direction rather than asserting
 * it. Both choices are conservative in the same direction: never bank on a
 * body clearing out of our way.
 */

import { projectPath, projectedHealthCost } from '../logic/simulator';
import { BoardEvaluator } from '../logic/board-evaluator';
import { ActiveGameManager } from '../server/active-game-manager';
import { apiCoordToIndex } from '../firebase/translate';
import { DEFAULT_CONFIG } from '../config/game-config';
import { HEURISTICS } from '../config/heuristics';
import { GameState, Snake, Coord } from '../types/battlesnake';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

const FULL_W = 13;
const FULL_H = 13;
const fullIdx = (api: Coord) => apiCoordToIndex(api, FULL_W, FULL_H);

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
  };
}

function makePiece(id: string, at: Coord, unitType: string, extra: Partial<Snake> = {}): Snake {
  return makeSnake(id, [at], { unitType, length: 1, ...extra });
}

function makeState(
  snakes: Snake[],
  youId: string,
  opts: { food?: Coord[]; hazards?: Coord[]; hazardDamage?: number; turn?: number } = {}
): GameState {
  return {
    game: { id: 'test', ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn: opts.turn ?? 10,
    board: {
      width: 11,
      height: 11,
      food: opts.food ?? [],
      hazards: opts.hazards ?? [],
      hazardDamage: opts.hazardDamage,
      snakes,
    },
    you: snakes.find(s => s.id === youId)!,
  };
}

// The reported shape, as a board: a bishop at (2,2) whose up-right ray runs
// (3,3) → (4,4) → (5,5) → (6,6), with FOOD at the far end (6,6) and a snake
// body segment sitting on (4,4). `blockerBody` picks whose body and where in
// it (4,4) sits.
const BISHOP_RAY: Coord[] = [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }];

function bishopVsBody(
  blockerId: string,
  blockerBody: Coord[],
  opts: { moverTier?: number; blockerTier?: number } = {}
): GameState {
  const bishop = makePiece('B', { x: 2, y: 2 }, 'bishop', {
    length: 3,
    ...(opts.moverTier
      ? { invulnerabilityLevel: opts.moverTier, invulnerabilityExpiryTurn: 99 }
      : {}),
  });
  const blocker = makeSnake(blockerId, blockerBody, {
    ...(opts.blockerTier
      ? { invulnerabilityLevel: opts.blockerTier, invulnerabilityExpiryTurn: 99 }
      : {}),
  });
  return makeState([bishop, blocker], 'B', { food: [{ x: 6, y: 6 }] });
}

// (4,4) as segment index 1 of a 3-cell body — an interior segment that does
// NOT vacate this turn.
const WALL_BODY: Coord[] = [{ x: 4, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 3 }];

describe('projectPath: a snake body is an absolute wall on a slider ray', () => {
  test('the reported bishop: an ALLY body mid-ray is death — projected health 0, path truncated, meal NOT credited', () => {
    const gs = bishopVsBody('ally', WALL_BODY);
    const outcome = projectPath(gs, BISHOP_RAY);

    // Death on the body square: projected health 0 (the cost zeroes it).
    expect(outcome.fatal).toBe(true);
    expect(outcome.cost).toBe(gs.you.health);
    expect(gs.you.health - outcome.cost).toBe(0);
    // The traversal ends ON the square it died on — it never reaches (5,5)
    // or the staged destination (6,6).
    expect(outcome.path).toEqual([{ x: 3, y: 3 }, { x: 4, y: 4 }]);
    // Food sits at (6,6), which the bishop never reaches: no meal, and so no
    // cancellation of the movement cost.
    expect(outcome.eats).toBe(false);
    expect(projectedHealthCost(gs, BISHOP_RAY)).toBe(100);
  });

  test('an ENEMY body is byte-identical to an ally body — the projection has no team input at all', () => {
    const ally = projectPath(bishopVsBody('ally', WALL_BODY), BISHOP_RAY);
    const enemy = projectPath(
      bishopVsBody('enemy', WALL_BODY, { }),
      BISHOP_RAY
    );
    expect(enemy).toEqual(ally);
  });

  test('a STRICTLY higher tier severs and capture-stops on the segment: survives, stops there, no meal at the far end', () => {
    const gs = bishopVsBody('ally', WALL_BODY, { moverTier: 1 });
    const outcome = projectPath(gs, BISHOP_RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.captureStopped).toBe(true);
    expect(outcome.path).toEqual([{ x: 3, y: 3 }, { x: 4, y: 4 }]);
    // Two squares actually entered, and the far-end food is never reached, so
    // the movement cost is NOT cancelled.
    expect(outcome.cost).toBe(2);
    expect(outcome.eats).toBe(false);
  });

  test('equal tiers are still death — a tie never grants passage', () => {
    const gs = bishopVsBody('ally', WALL_BODY, { moverTier: 2, blockerTier: 2 });
    expect(projectPath(gs, BISHOP_RAY).fatal).toBe(true);
  });

  test('a LOWER tier than the body owner is death too', () => {
    const gs = bishopVsBody('ally', WALL_BODY, { moverTier: 1, blockerTier: 3 });
    expect(projectPath(gs, BISHOP_RAY).fatal).toBe(true);
  });

  test('a segment that VACATES before arrival is not fatal: the ray passes through and eats', () => {
    // (4,4) is the blocker's TAIL — the engine pops every tail before
    // collisions resolve, eating or not, so it is empty when the slider
    // arrives. This is the ONE square of the simultaneous body shift the
    // client can see from a pre-move board.
    const gs = bishopVsBody('ally', [{ x: 3, y: 5 }, { x: 4, y: 4 }]);
    const outcome = projectPath(gs, BISHOP_RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.captureStopped).toBe(false);
    expect(outcome.path).toEqual(BISHOP_RAY);
    expect(outcome.eats).toBe(true);
    expect(outcome.cost).toBe(0); // reaching the food alive cancels the movement
  });

  test('a STACKED tail still blocks: the duplicate at the second-to-last index is a wall', () => {
    // Ate last turn: the tail cell appears twice. Only the last index vacates.
    const gs = bishopVsBody('ally', [{ x: 3, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 4 }]);
    expect(projectPath(gs, BISHOP_RAY).fatal).toBe(true);
  });

  test("the owner's pre-move HEAD square is a wall — it becomes a body segment once the snake steps forward", () => {
    const gs = bishopVsBody('ally', [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }]);
    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.path).toEqual([{ x: 3, y: 3 }, { x: 4, y: 4 }]);
  });
});

describe('projectPath: the other ways a traversal ends', () => {
  test('a stationary PIECE on the ray is the same tier-then-weight contest — a loss is death', () => {
    const bishop = makePiece('B', { x: 2, y: 2 }, 'bishop', { length: 3 });
    const rook = makePiece('R', { x: 4, y: 4 }, 'rook', { length: 5 }); // heavier
    const gs = makeState([bishop, rook], 'B', { food: [{ x: 6, y: 6 }] });
    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.cost).toBe(100);
    expect(outcome.eats).toBe(false);
  });

  test('a stationary PIECE the mover outweighs is killed, and the mover capture-stops on its square', () => {
    const bishop = makePiece('B', { x: 2, y: 2 }, 'bishop', { length: 5 });
    const rook = makePiece('R', { x: 4, y: 4 }, 'rook', { length: 3 });
    const gs = makeState([bishop, rook], 'B', { food: [{ x: 6, y: 6 }] });
    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.captureStopped).toBe(true);
    expect(outcome.path).toEqual([{ x: 3, y: 3 }, { x: 4, y: 4 }]);
    expect(outcome.eats).toBe(false);
  });

  test('the mover’s OWN body is a wall with no tier exemption — nothing severs itself', () => {
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }], {
      invulnerabilityLevel: 3,
      invulnerabilityExpiryTurn: 99,
    });
    const gs = makeState([us], 'us');
    // Stepping onto our own neck.
    const outcome = projectPath(gs, [{ x: 6, y: 5 }]);
    expect(outcome.fatal).toBe(true);
    expect(outcome.cost).toBe(100);
  });

  test('off the board is death on that square', () => {
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook');
    const gs = makeState([rook], 'R');
    const outcome = projectPath(gs, [{ x: 0, y: 5 }, { x: -1, y: 5 }]);
    expect(outcome.fatal).toBe(true);
    expect(outcome.path).toEqual([{ x: 0, y: 5 }, { x: -1, y: 5 }]);
  });

  test('hazard doses that exhaust health kill mid-flight and TRUNCATE — later doses never accrue', () => {
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 55 });
    const gs = makeState([rook], 'R', {
      hazards: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }],
      hazardDamage: 30,
    });
    const outcome = projectPath(gs, [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }]);
    // 55 - 30 = 25 survives (3,5); 25 - 30 <= 0 dies there.
    expect(outcome.fatal).toBe(true);
    expect(outcome.path).toEqual([{ x: 2, y: 5 }, { x: 3, y: 5 }]);
    // Two squares entered and TWO doses charged, not four: 2 + 2 × 30 = 62.
    // The cost never under-reports, and it always takes the health to zero or
    // below — the remaining two doses of the staged ray never accrue.
    expect(outcome.cost).toBe(62);
    expect(gs.you.health - outcome.cost).toBeLessThanOrEqual(0);
  });

  test('a survivable hazard crossing keeps accruing and stays non-fatal', () => {
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 100 });
    const gs = makeState([rook], 'R', {
      hazards: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
      hazardDamage: 30,
    });
    const outcome = projectPath(gs, [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }]);
    expect(outcome.fatal).toBe(false);
    expect(outcome.cost).toBe(4 + 3 * 30);
  });

});

/**
 * MID-RAY EXHAUSTION, AND WHAT SETTLES IT.
 *
 * The engine charges movement cost per sub-step, strictly after that sub-step's
 * collisions. Health reaching <= 0 is EXHAUSTION, which stops MOVEMENT and
 * nothing else: the slider HALTS on the square it reached. Whether it also
 * DIES is settled at end of turn by the food phase, which runs at the unit's
 * FINAL square — so halting ON food is a full recovery, and halting anywhere
 * else is death on the halt square.
 *
 * The distinction that survives every revision of this rule: food at the
 * STAGED DESTINATION, beyond the halt, is worth nothing. A meal only ever
 * saves a unit that actually ends the turn on top of it.
 */
describe('projectPath: a ray the health cannot pay for halts, and the halt square decides', () => {
  const RAY: Coord[] = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }];

  test('a movement cost that outruns health kills on the square it runs out', () => {
    // Health 3: 3 → 2 → 1 → 0 on the THIRD square, which is where it stops.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 3 });
    const gs = makeState([rook], 'R');
    const outcome = projectPath(gs, RAY);

    expect(outcome.fatal).toBe(true);
    expect(outcome.path).toEqual([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
    // Three squares entered, not four: the fourth is never walked, and the
    // cost reported zeroes the health exactly.
    expect(outcome.cost).toBe(3);
    expect(gs.you.health - outcome.cost).toBe(0);
  });

  test('FOOD AT THE STAGED DESTINATION DOES NOT RESCUE IT — the ray dies short of the meal', () => {
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 3 });
    const fed = makeState([rook], 'R', { food: [{ x: 5, y: 5 }] });
    const outcome = projectPath(fed, RAY);

    expect(outcome.fatal).toBe(true);
    expect(outcome.eats).toBe(false);
    expect(outcome.path).toEqual([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
    expect(outcome.cost).toBe(3);
    // Byte-identical to the unfed ray: the food is not an input to any of it.
    expect(outcome).toEqual(projectPath(makeState([rook], 'R'), RAY));
  });

  test('one more point of health pays the whole ray, and THEN the meal counts', () => {
    // Health 5: 5 → 4 → 3 → 2 → 1 on arrival, alive, so the food phase runs.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 5 });
    const outcome = projectPath(makeState([rook], 'R', { food: [{ x: 5, y: 5 }] }), RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.eats).toBe(true);
    expect(outcome.path).toEqual(RAY);
    expect(outcome.cost).toBe(0);
  });

  // THE RECOVERY CASE (piece). Health 4 over 4 squares: the last square takes
  // it to exactly 0, so it exhausts ON the staged destination — and that
  // square holds the food, so it eats there, restores to its type max and
  // lives. Exhaustion is provisional; the halt square is what settles it.
  test('exhausting ON food is a full recovery — halted, fed, alive', () => {
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 4 });
    const outcome = projectPath(makeState([rook], 'R', { food: [{ x: 5, y: 5 }] }), RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.eats).toBe(true);
    expect(outcome.path).toEqual(RAY);
    // The meal cancels the whole bill, exactly as any other meal does — `cost`
    // is a LOSS measure, so a recovery from zero reports 0 just like a stroll
    // onto food at full health.
    expect(outcome.cost).toBe(0);
  });

  test('the same ray one square SHORT of the food is still death', () => {
    // Health 4, food moved to (6,5): the rook halts at (5,5) with nothing
    // under it. One square, and the whole outcome flips.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 4 });
    const outcome = projectPath(makeState([rook], 'R', { food: [{ x: 6, y: 5 }] }), RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.eats).toBe(false);
    expect(outcome.path).toEqual(RAY);
    expect(outcome.cost).toBe(4);
  });

  test('a mid-ray halt ON food recovers too — it just stops short of the staged square', () => {
    // Health 2 over a 4-square ray with food on the SECOND square: it halts
    // there, eats, and lives, having entered two squares of four.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 2 });
    const outcome = projectPath(makeState([rook], 'R', { food: [{ x: 3, y: 5 }] }), RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.eats).toBe(true);
    expect(outcome.path).toEqual([{ x: 2, y: 5 }, { x: 3, y: 5 }]);
    expect(outcome.cost).toBe(0);
  });

  test('a hazard halt on food recovers, doses and all', () => {
    // 34 - 1 = 33, then a 30-dose square takes it to 2, then 1, then 0 on
    // (5,5) — where the food is. The food phase ASSIGNS the max, so the doses
    // go with the movement cost.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 34 });
    const gs = makeState([rook], 'R', {
      hazards: [{ x: 3, y: 5 }], hazardDamage: 30, food: [{ x: 5, y: 5 }],
    });
    const outcome = projectPath(gs, RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.eats).toBe(true);
    expect(outcome.cost).toBe(0);
  });

  test('hazard doses count toward the same running bill, not a separate one', () => {
    // Health 34, one 30-damage hazard on the second square:
    // 34 → 33, then 33 - 31 = 2, then 1, then 0 on the fourth square.
    const rook = makePiece('R', { x: 1, y: 5 }, 'rook', { health: 34 });
    const gs = makeState([rook], 'R', { hazards: [{ x: 3, y: 5 }], hazardDamage: 30 });
    const outcome = projectPath(gs, RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.path).toEqual(RAY);
    expect(outcome.cost).toBe(34);
  });

  // THE RECOVERY CASE (snake). A snake's path is one square, so its halt
  // square is always its destination — the recovery case and the ordinary
  // arrival collapse into one.
  test('a SNAKE step is the same rule with a one-square path', () => {
    // Health 1 onto food: the step exhausts it, and the same square feeds it.
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 5, y: 4 }], { health: 1 });
    const gs = makeState([us], 'us', { food: [{ x: 6, y: 5 }] });
    const outcome = projectPath(gs, [{ x: 6, y: 5 }]);
    expect(outcome.fatal).toBe(false);
    expect(outcome.eats).toBe(true);
    expect(outcome.cost).toBe(0);

    // The same step onto a bare square is death: there is nothing to recover on.
    const bare = projectPath(makeState([us], 'us'), [{ x: 6, y: 5 }]);
    expect(bare.fatal).toBe(true);
    expect(bare.eats).toBe(false);
  });

  test('a mover that WINS a square and then exhausts on it still takes its victim', () => {
    // Collisions are adjudicated before the charge, so the dying mover is a
    // killer first and a corpse second — the trade is real and must be scored.
    const bishop = makePiece('B', { x: 2, y: 2 }, 'bishop', { length: 5, health: 2, teamID: 'ours' });
    const pawn = makePiece('P', { x: 4, y: 4 }, 'pawn', { length: 1, teamID: 'theirs' });
    const gs = makeState([bishop, pawn], 'B');
    const outcome = projectPath(gs, BISHOP_RAY);

    // (3,3) takes it to 1, (4,4) is won and then takes it to 0.
    expect(outcome.path).toEqual([{ x: 3, y: 3 }, { x: 4, y: 4 }]);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.kills).toBe(1);
  });
});

describe('valuing it: the health-loss component ranks a fatal path below any survivable one', () => {
  test('SNAKES — a step into a body projects the full health as loss, dwarfing an ordinary step', () => {
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }]);
    const them = makeSnake('them', [{ x: 6, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 }]);
    const gs = makeState([us, them], 'us');

    const fatalCost = projectedHealthCost(gs, [{ x: 6, y: 5 }]); // into their body
    const safeCost = projectedHealthCost(gs, [{ x: 4, y: 5 }]);  // open square
    expect(fatalCost).toBe(100);
    expect(safeCost).toBe(1);

    // The stat is injected per candidate move exactly as h2hRisk/pieceThreat
    // are (DecisionEngine.healthCostContexts), so the ordering is the weighted
    // health-loss term itself.
    const evaluator = new BoardEvaluator();
    const team = new Set(['us']);
    const fatalEval = evaluator.evaluateBoard(gs, 'us', team, { healthCost: fatalCost });
    const safeEval = evaluator.evaluateBoard(gs, 'us', team, { healthCost: safeCost });

    expect(fatalEval.stats.healthLoss).toBe(100);
    expect(fatalEval.weighted.healthLossScore).toBe(100 * HEURISTICS.healthLoss.default);
    // -500 at the default weight: the same order as the deaths penalty, and
    // 495 points below the ordinary step.
    expect(fatalEval.weighted.healthLossScore).toBe(-500);
    expect(fatalEval.score).toBeLessThan(safeEval.score);
  });
});

describe('valuing it: chess-piece candidate rows and staging', () => {
  let mgr: ActiveGameManager;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    mgr.setMoveSubmitter(async () => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function feed(gameId: string, gs: GameState) {
    if (!mgr.getGame(gameId)?.controlledSnakes.has('B')) mgr.registerGame(gs, 'B');
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, 'B', gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    return mgr.getGame(gameId)!.controlledSnakes.get('B')!;
  }

  test('the reported move is annotated fatal on its own row and ranks below every survivable candidate', () => {
    const gameId = 'g-fatal-ray';
    const gs = { ...bishopVsBody('ally', WALL_BODY), game: { ...bishopVsBody('ally', WALL_BODY).game, id: gameId } };
    const cs = feed(gameId, gs);

    const evals = cs.latestTurnData!.moveEvaluations;
    const byMove = new Map(evals.map(e => [e.move, e]));

    // ANNOTATED, NOT HIDDEN: the board-legal ray is still enumerated, so a
    // human commander can still choose the sacrifice.
    const fatalRow = byMove.get(fullIdx({ x: 6, y: 6 }))!;
    expect(fatalRow).toBeDefined();
    expect(fatalRow.breakdown.healthLoss).toBe(100); // projected health 0, not a free meal
    expect(fatalRow.breakdown.deaths).toBe(1);
    expect(fatalRow.score).toBe(
      DEFAULT_CONFIG.healthLoss * 100 + DEFAULT_CONFIG.deaths
    );

    // The first square of the same ray is survivable and costs one step.
    const safeRow = byMove.get(fullIdx({ x: 3, y: 3 }))!;
    expect(safeRow.breakdown.healthLoss).toBe(1);
    expect(safeRow.breakdown.deaths).toBe(0);
    expect(fatalRow.score).toBeLessThan(safeRow.score);

    // And below EVERY candidate that is not itself fatal.
    for (const e of evals) {
      if (e.breakdown.deaths === 1) continue;
      expect(fatalRow.score).toBeLessThan(e.score);
    }
    // The squares BEYOND the body are fatal too — the ray dies before them.
    expect(byMove.get(fullIdx({ x: 5, y: 5 }))!.breakdown.deaths).toBe(1);
    // The squares before it are not.
    expect(byMove.get(fullIdx({ x: 4, y: 4 }))!.breakdown.deaths).toBe(1); // the body square itself
  });

  test('a goto on the far side of the body never stages the fatal ray; with the body gone it stages it again', () => {
    const blocked = 'g-fatal-goto';
    const gsBlocked = bishopVsBody('ally', WALL_BODY);
    gsBlocked.game.id = blocked;
    const csBlocked = feed(blocked, gsBlocked);
    csBlocked.selectedBy = 'u1';
    mgr.setWaypoint(blocked, 'B', { type: 'green', x: 6, y: 6 }, 'u1');
    expect(csBlocked.staged?.move).not.toBe(fullIdx({ x: 6, y: 6 }));

    // Positive control: the same geometry with the blocking segment vacating
    // (it is the tail) stages the arrival, meal and all.
    const open = 'g-fatal-goto-open';
    const gsOpen = bishopVsBody('ally', [{ x: 3, y: 5 }, { x: 4, y: 4 }]);
    gsOpen.game.id = open;
    const csOpen = feed(open, gsOpen);
    csOpen.selectedBy = 'u1';
    mgr.setWaypoint(open, 'B', { type: 'green', x: 6, y: 6 }, 'u1');
    expect(csOpen.staged?.move).toBe(fullIdx({ x: 6, y: 6 }));
  });
});

/**
 * THE i = 0 POLICY, VERIFIED RATHER THAN ASSERTED.
 *
 * An enemy snake's start-of-turn head cell is, by the time we arrive, exactly
 * one of two things — and the projection cannot know which, because it never
 * gives other units a move:
 *
 *  (a) CHASE — the owner stepped away or aside, so the cell is now its NECK
 *      (post-move index 1), a living body cell. Equal-or-lower tier dies on
 *      it; strictly higher tier severs it and capture-stops.
 *  (b) EXCHANGE — the owner stepped into OUR origin, so the heads crossed the
 *      same edge. That is an edge contest, uniform across every unit kind and
 *      length: frozen tier, then frozen weight. No trail exemption.
 *
 * simulator.ts models (a) always. This block does not take that on trust: it
 * walks every tier × weight combination, computes what (b) would have decided,
 * and checks the direction — the model must never say we SURVIVE where the
 * exchange would have killed us. It also records, rather than hides, the one
 * place the choice is not purely conservative: the casualty LEDGER when we
 * strictly out-tier the owner.
 */
describe('the i = 0 policy: modelling the chase, and checking it is the worse branch', () => {
  const OWNER_HEAD: Coord = { x: 4, y: 4 };
  const STEP: Coord[] = [OWNER_HEAD];

  /** Our mover stepping one square onto `owner`'s start-of-turn head cell. */
  function meeting(
    moverTier: number, moverWeight: number,
    ownerTier: number, ownerWeight: number,
    ownerTeam = 'theirs'
  ) {
    const mover = makePiece('M', { x: 3, y: 4 }, 'rook', {
      length: moverWeight, teamID: 'ours',
      invulnerabilityLevel: moverTier, invulnerabilityExpiryTurn: 99,
    });
    // A body of `ownerWeight` cells with its HEAD on the contested square.
    const body: Coord[] = [];
    for (let i = 0; i < ownerWeight; i++) body.push({ x: 4, y: 4 - i });
    const owner = makeSnake('O', body, {
      teamID: ownerTeam,
      invulnerabilityLevel: ownerTier, invulnerabilityExpiryTurn: 99,
    });
    return projectPath(makeState([mover, owner], 'M'), STEP);
  }

  /** What the EDGE EXCHANGE would decide: tier first, then frozen weight. */
  function exchangeKillsUs(
    moverTier: number, moverWeight: number, ownerTier: number, ownerWeight: number
  ): boolean {
    if (moverTier !== ownerTier) return moverTier < ownerTier;
    return moverWeight <= ownerWeight; // equal weight is a deadlock: nobody lives
  }

  const TIERS: Array<[number, number, string]> = [
    [0, 1, 'we out-tier them'],
    [1, 1, 'equal tier'],
    [1, 0, 'they out-tier us'],
  ];
  // Owner weights >= 2 keep the cell a genuine head-of-a-body case; weight 1
  // is the degenerate owner the model treats as a head-class contest instead.
  const WEIGHTS: Array<[number, number, string]> = [
    [5, 2, 'we outweigh them'],
    [3, 3, 'equal weight'],
    [2, 5, 'they outweigh us'],
  ];

  test('every tier x weight combination: the model is never the more optimistic branch', () => {
    const optimistic: string[] = [];
    const strictlyConservative: string[] = [];
    let checked = 0;

    for (const [ownerTier, moverTier, tierLabel] of TIERS) {
      for (const [moverWeight, ownerWeight, weightLabel] of WEIGHTS) {
        checked++;
        const modelFatal = meeting(moverTier, moverWeight, ownerTier, ownerWeight).fatal;
        const exchangeFatal = exchangeKillsUs(moverTier, moverWeight, ownerTier, ownerWeight);
        const label = `${tierLabel} / ${weightLabel}`;
        // THE DIRECTION: model-fatal >= exchange-fatal. Saying we survive
        // where the exchange would have killed us is the one answer the
        // projection may never give.
        if (!modelFatal && exchangeFatal) optimistic.push(label);
        if (modelFatal && !exchangeFatal) strictlyConservative.push(label);
      }
    }

    expect(checked).toBe(TIERS.length * WEIGHTS.length);
    expect(optimistic).toEqual([]);
    // ...and the check is not vacuous: exactly one combination is where the
    // two branches genuinely disagree — equal tier with us the heavier, where
    // the exchange would have let us through and the model calls it death.
    expect(strictlyConservative).toEqual(['equal tier / we outweigh them']);
  });

  test('at or below the owner tier the model is fatal outright — the worse branch every time', () => {
    // Equal tier: the exchange lets a heavier mover through, the model does
    // not. Strictly conservative, and the case that matters most in play.
    expect(meeting(1, 5, 1, 2).fatal).toBe(true);
    expect(exchangeKillsUs(1, 5, 1, 2)).toBe(false);
    // Equal tier, equal weight: both agree we die.
    expect(meeting(1, 3, 1, 3).fatal).toBe(true);
    expect(exchangeKillsUs(1, 3, 1, 3)).toBe(true);
    // Lower tier: both agree we die.
    expect(meeting(0, 5, 1, 2).fatal).toBe(true);
    expect(exchangeKillsUs(0, 5, 1, 2)).toBe(true);
  });

  test('strictly out-tiering the owner: both branches let us live, and we capture-stop', () => {
    const modelled = meeting(2, 3, 0, 4);
    expect(modelled.fatal).toBe(false);
    expect(modelled.captureStopped).toBe(true);
    expect(exchangeKillsUs(2, 3, 0, 4)).toBe(false);
  });

  // The honest corner, pinned so it cannot drift into a silent assumption.
  test('the LEDGER is where the policy is not conservative: an out-tiered owner', () => {
    // Chase: we cut the owner at its neck and it walks away as one segment, so
    // the model charges weight - 1 and reports it alive. Exchange: it would
    // have died outright, for its whole weight.
    const enemy = meeting(2, 3, 0, 4);
    expect(enemy.casualties.kills).toBe(0); // under-credits our own gain: safe
    // The same shape against an ALLY under-CHARGES us by one weight, which is
    // the optimistic direction — and it is why an ally king cut here does not
    // raise our own regicide flag.
    const ally = meeting(2, 3, 0, 4, 'ours');
    expect(ally.casualties.allyCasualty).toBe(3); // 4 - 1, not the full 4
    expect(ally.casualties.regicide).toBe(0);
  });

  test('a LENGTH-1 owner is modelled as the contest, which is the exchange branch exactly', () => {
    // Its only segment pops, so a chase would leave the cell EMPTY. Modelling
    // the contest keeps the frozen-occupancy assumption and matches (b).
    const modelled = meeting(2, 3, 0, 1);
    expect(modelled.fatal).toBe(false);
    expect(modelled.captureStopped).toBe(true);
    expect(modelled.casualties.kills).toBe(1);
  });
});
