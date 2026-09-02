/**
 * Outcomes the projection used to get WRONG, verified against the engine
 * (TacticToes functions/src/gameprocessors/engine/turnEngine.ts and
 * TeamSnekProcessor.ts):
 *
 *  1. A TIED stationary contest is MUTUAL destruction, not a plain loss.
 *     A cell contest leaves AT MOST ONE unique strict maximum standing (tier
 *     first, then frozen weight) and kills everyone else, so equal tier +
 *     equal weight kills both. The
 *     projection used to answer `winsStationaryContest === false` with a bare
 *     death and no victim, which scored a game-winning king trade as pure
 *     suicide — kills 0, enemyRegicide 0 — and (symmetrically) charged nothing
 *     for trading with an ALLY.
 *
 *  2. Entering a multi-cell snake's CURRENT head square is modelled as a
 *     SEVER, not a kill. Snakes always move, so by the time a slider arrives
 *     that square is the owner's NECK — post-move index 1, the segment it
 *     swept in behind itself — and a strictly higher tier cuts from there,
 *     leaving the owner alive as a single segment. (The other thing that
 *     square can be is an EDGE EXCHANGE, if the owner stepped into our origin;
 *     modelling the neck instead is the deliberate conservative policy pinned
 *     in fatal-path-projection.test.ts.) Only a LENGTH-1 owner — which leaves
 *     nothing behind when its one segment pops — is modelled as a head-class
 *     contest and dies outright.
 *
 *  3. A meal WIPES mid-flight hazard damage. Hazard doses are deducted inside
 *     the sub-step sim; the food phase afterwards ASSIGNS the type max
 *     (`newPlayerHealth[id] = maxHealthFor(type)`), so it restores the doses
 *     along with the movement cost it never charged. But a mover the doses
 *     kill mid-flight is removed before that phase ever runs, so food at the
 *     far end saves nothing.
 */

import { evaluatePathOnBoard } from '../logic/turn-oracle';
import { ActiveGameManager } from '../server/active-game-manager';
import { apiCoordToIndex } from '../firebase/translate';
import { GameState, Snake, Coord } from '../types/battlesnake';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

const FULL_W = 13;
const FULL_H = 13;
const fullIdx = (api: Coord) => apiCoordToIndex(api, FULL_W, FULL_H);

const OURS = 'red';
const THEIRS = 'blue';

function makeSnake(id: string, teamID: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: teamID,
    teamID,
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  };
}

function makePiece(
  id: string,
  teamID: string,
  at: Coord,
  unitType: string,
  weight = 1,
  extra: Partial<Snake> = {}
): Snake {
  return makeSnake(id, teamID, [at], { unitType, length: weight, ...extra });
}

function makeState(
  snakes: Snake[],
  youId: string,
  opts: { food?: Coord[]; hazards?: Coord[]; hazardDamage?: number; turn?: number; id?: string } = {}
): GameState {
  return {
    game: {
      id: opts.id ?? 'test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test',
    },
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

// A bishop at (2,2) whose up-right ray runs (3,3) → (4,4) → (5,5) → (6,6);
// the contested square is always (4,4).
/**
 * The candidate-outcome oracle, in the shape these tests read.
 *
 * There is no hand-written projection any more: this runs the REAL turn
 * through the vendored TacticToes engine (turn-oracle.ts over
 * src/engine-vendor/) and reads the settled result. So every assertion below
 * is now a test of MARSHALLING and READING — did we hand the engine the right
 * board, and did we read its answer correctly — rather than a test of rules
 * arithmetic the bot no longer performs.
 */
function projectPath(state: GameState, path: Coord[]) {
  return evaluatePathOnBoard(state.board, state.turn, state.you.id, path);
}

const BISHOP_RAY: Coord[] = [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }];
const CONTESTED: Coord = { x: 4, y: 4 };

describe('a TIED stationary contest is a TRADE: both units die, and the victim is recorded', () => {
  test('equal tier and equal weight kills the enemy piece as well as us', () => {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const rook = makePiece('ER', THEIRS, CONTESTED, 'rook', 3); // same tier, same weight
    const gs = makeState([bishop, rook], 'B');

    const outcome = projectPath(gs, BISHOP_RAY);

    // We do not survive it — that half was never in doubt.
    expect(outcome.fatal).toBe(true);
    expect(outcome.cost).toBe(gs.you.health);
    expect(outcome.traversed).toEqual([{ x: 3, y: 3 }, CONTESTED]);
    // A death, not a capture-stop: we stopped short of (6,6) because we died
    // on the contested square, and the registry says so.
    expect(outcome.deathCause).toBe('contest');
    expect(outcome.finalCell).toEqual(CONTESTED);
    // ...but the enemy dies with us. That is the half that used to be lost.
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.allyCasualty).toBe(0);
    expect(outcome.casualties.regicide).toBe(0);
    expect(outcome.casualties.enemyRegicide).toBe(0);
  });

  test('a LOSS is still a bare suicide — no victim, nothing traded', () => {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const rook = makePiece('ER', THEIRS, CONTESTED, 'rook', 5); // heavier: we simply lose
    const gs = makeState([bishop, rook], 'B');

    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties).toEqual({
      allyCasualty: 0, regicide: 0, kills: 0, enemyRegicide: 0,
    });
  });

  test("tying with the enemy's LAST king ends their team — the winning trade the bot could not see", () => {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('EK', THEIRS, CONTESTED, 'king', 3); // dead level with us
    const spareRook = makePiece('ER', THEIRS, { x: 9, y: 9 }, 'rook', 4);
    const gs = makeState([bishop, king, spareRook], 'B');

    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.enemyRegicide).toBe(1);
    // Our own side pays nothing beyond the mover, which deaths/health already
    // price — no ally weight, no regicide of ours.
    expect(outcome.casualties.allyCasualty).toBe(0);
    expect(outcome.casualties.regicide).toBe(0);
  });

  test('a spare enemy king means the tie is only a kill, never their regicide', () => {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('EK1', THEIRS, CONTESTED, 'king', 3);
    const otherKing = makePiece('EK2', THEIRS, { x: 9, y: 9 }, 'king', 3);
    const gs = makeState([bishop, king, otherKing], 'B');

    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.enemyRegicide).toBe(0);
  });

  test('OUR king tying with THEIR last king ends BOTH teams — the trade we must never make', () => {
    const ourKing = makePiece('K', OURS, { x: 2, y: 2 }, 'king', 3);
    const theirKing = makePiece('EK', THEIRS, CONTESTED, 'king', 3);
    const gs = makeState([ourKing, theirKing], 'K');

    const outcome = projectPath(gs, BISHOP_RAY.slice(0, 2));
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.enemyRegicide).toBe(1);
    // The mover IS our last king and it dies in the trade.
    expect(outcome.casualties.regicide).toBe(1);
  });
});

describe('a tie with an ALLY is charged — the engine has no friendly exemption', () => {
  test('an equal ally piece costs its whole weight, and we die too', () => {
    for (const weight of [1, 3, 5]) {
      const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', weight);
      const rook = makePiece('R', OURS, CONTESTED, 'rook', weight);
      const gs = makeState([bishop, rook], 'B');

      const outcome = projectPath(gs, BISHOP_RAY);
      expect(outcome.fatal).toBe(true);
      expect(outcome.casualties.allyCasualty).toBe(weight);
      // An ally is never counted as a kill, tied or won.
      expect(outcome.casualties.kills).toBe(0);
      expect(outcome.casualties.enemyRegicide).toBe(0);
    }
  });

  test('tying with our own LAST king is regicide — our whole team goes with it', () => {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('K', OURS, CONTESTED, 'king', 3);
    const gs = makeState([bishop, king], 'B');

    const outcome = projectPath(gs, BISHOP_RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.allyCasualty).toBe(3);
    expect(outcome.casualties.regicide).toBe(1);
    expect(outcome.casualties.kills).toBe(0);
  });

  test('a TIER difference is decided before weight ever gets a look — equal weights are no tie', () => {
    // Same weight, but they out-tier us: a loss, not a trade.
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const rook = makePiece('ER', THEIRS, CONTESTED, 'rook', 3, {
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: 99,
    });
    const gs = makeState([bishop, rook], 'B');
    expect(projectPath(gs, BISHOP_RAY).casualties.kills).toBe(0);

    // Same weight, and WE out-tier them: a clean win, not a trade.
    const strong = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3, {
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: 99,
    });
    const won = projectPath(
      makeState([strong, makePiece('ER', THEIRS, CONTESTED, 'rook', 3)], 'B'),
      BISHOP_RAY
    );
    expect(won.fatal).toBe(false);
    expect(won.halted).toBe(true);
    expect(won.casualties.kills).toBe(1);
  });
});

/**
 * ENTERING A SNAKE'S HEAD CELL, under the assumption we actually make.
 *
 * INVERTED, and the inversion is instructive. The old hand-written projection
 * modelled this square as the owner's NECK — reasoning that snakes always move,
 * so by our arrival the head has swept forward and index 0 has become index 1 —
 * and therefore called it a SEVER costing weight - 1.
 *
 * The bot no longer models anything: it hands the board to the engine with the
 * assumption it can actually defend, which is that the other unit HOLDS. And a
 * held snake's head cell is exactly that — a head. So the engine adjudicates a
 * head-class CONTEST there, and a strictly-higher-tier arrival kills the whole
 * snake rather than trimming it.
 *
 * The old answer was not more correct; it was a different assumption smuggled
 * into the rules layer, and one the bot could not state consistently (it froze
 * enemies everywhere else). This one is stated once, in turn-oracle.ts, and
 * everything downstream follows from it.
 */
describe("entering a HELD snake's head cell is a head-class contest, not a sever", () => {
  // Strictly higher tier, so we win the contest instead of dying on the body.
  const cutter = (teamID: string) =>
    makePiece('B', teamID, { x: 2, y: 2 }, 'bishop', 3, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: 99,
    });

  test('a LENGTH-4 owner dies outright, for its whole weight', () => {
    const ally = makeSnake('ally', OURS, [
      CONTESTED, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 },
    ]);
    const outcome = projectPath(makeState([cutter(OURS), ally], 'B'), BISHOP_RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.halted).toBe(true); // capture-stopped on the contested cell
    expect(outcome.traversed).toEqual([{ x: 3, y: 3 }, CONTESTED]);
    // The whole snake, not weight - 1: it never got to sweep its head forward.
    expect(outcome.casualties.allyCasualty).toBe(4);
    expect(outcome.casualties.kills).toBe(0);
    expect(outcome.casualties.regicide).toBe(0);
  });

  test('the same square on an ENEMY length-4 snake is a kill, counted once', () => {
    const enemy = makeSnake('enemy', THEIRS, [
      CONTESTED, { x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 },
    ]);
    const outcome = projectPath(makeState([cutter(OURS), enemy], 'B'), BISHOP_RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.halted).toBe(true);
    // `kills` counts UNITS destroyed, not weight — one snake is one kill.
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.allyCasualty).toBe(0);
  });

  test('a LENGTH-1 owner dies the same way — nothing special about it any more', () => {
    const enemy = makeSnake('enemy', THEIRS, [CONTESTED]);
    const outcome = projectPath(makeState([cutter(OURS), enemy], 'B'), BISHOP_RAY);

    expect(outcome.fatal).toBe(false);
    expect(outcome.halted).toBe(true);
    expect(outcome.casualties.kills).toBe(1);

    // And on our own side it is charged as the full weight-1 loss it is.
    const ally = makeSnake('ally', OURS, [CONTESTED]);
    const friendly = projectPath(makeState([cutter(OURS), ally], 'B'), BISHOP_RAY);
    expect(friendly.casualties.allyCasualty).toBe(1);
    expect(friendly.casualties.kills).toBe(0);
  });

  test('a length-2 owner costs its two cells', () => {
    const ally = makeSnake('ally', OURS, [CONTESTED, { x: 4, y: 3 }]);
    const outcome = projectPath(makeState([cutter(OURS), ally], 'B'), BISHOP_RAY);
    expect(outcome.casualties.allyCasualty).toBe(2);
    expect(outcome.casualties.kills).toBe(0);
  });

  // INTERIOR segments are the case that never depended on the assumption: a
  // body cell is a body cell whether or not its owner moved, so this really is
  // a sever, and it costs exactly what the engine reports it cut.
  test('an INTERIOR segment is still a sever: index i costs everything from i back', () => {
    // (4,4) as index 1 of a 4-cell snake: segments 1..3 are cut away.
    const ally = makeSnake('ally', OURS, [
      { x: 4, y: 5 }, CONTESTED, { x: 4, y: 3 }, { x: 4, y: 2 },
    ]);
    const outcome = projectPath(makeState([cutter(OURS), ally], 'B'), BISHOP_RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.halted).toBe(true);
    // Cut, not killed: three cells lost and the owner walks away.
    expect(outcome.casualties.allyCasualty).toBe(3);
    expect(outcome.casualties.kills).toBe(0);
  });
});

describe('a meal wipes the hazard doses the traversal accrued', () => {
  // A rook at (1,5) sliding right along row 5.
  const RAY: Coord[] = [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }];

  test('a survivable hazard crossing that ends on FOOD costs nothing at all', () => {
    const rook = makePiece('R', OURS, { x: 1, y: 5 }, 'rook', 3, { health: 100 });
    const gs = makeState([rook], 'R', {
      hazards: [{ x: 2, y: 5 }, { x: 3, y: 5 }],
      hazardDamage: 20,
      food: [{ x: 5, y: 5 }],
    });

    const outcome = projectPath(gs, RAY);
    expect(outcome.fatal).toBe(false);
    expect(outcome.ate).toBe(true);
    // 100 → 60 through the two doses → the food phase ASSIGNS 100 again.
    expect(outcome.cost).toBe(0);

    // Same ray with the food removed is the full bill: 4 steps + 2 doses.
    const unfed = makeState([rook], 'R', {
      hazards: [{ x: 2, y: 5 }, { x: 3, y: 5 }],
      hazardDamage: 20,
    });
    expect(projectPath(unfed, RAY).cost).toBe(4 + 2 * 20);
  });

  test('food at the far end does NOT save a mover the doses kill mid-flight', () => {
    // 55 - 30 = 25 survives (2,5); 25 - 30 <= 0 dies on (3,5) — long before
    // the food at (5,5), and the engine removes it before the food phase runs.
    const rook = makePiece('R', OURS, { x: 1, y: 5 }, 'rook', 3, { health: 55 });
    const gs = makeState([rook], 'R', {
      hazards: [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
      hazardDamage: 30,
      food: [{ x: 5, y: 5 }],
    });

    const outcome = projectPath(gs, RAY);
    expect(outcome.fatal).toBe(true);
    expect(outcome.ate).toBe(false);
    expect(outcome.traversed).toEqual([{ x: 2, y: 5 }, { x: 3, y: 5 }]);
    // A fatal traversal costs exactly the health it had — the oracle reports
    // what the engine took, not a hypothetical bill larger than the unit.
    expect(outcome.cost).toBe(55);
    expect(gs.you.health - outcome.cost).toBeLessThanOrEqual(0);
  });

  test('a capture-stop short of the food credits no meal, so the doses stand', () => {
    const rook = makePiece('R', OURS, { x: 1, y: 5 }, 'rook', 5, { health: 100 });
    // A lighter enemy piece on (3,5): we win, and stop there.
    const victim = makePiece('EP', THEIRS, { x: 3, y: 5 }, 'pawn', 1);
    const gs = makeState([rook, victim], 'R', {
      hazards: [{ x: 2, y: 5 }],
      hazardDamage: 20,
      food: [{ x: 5, y: 5 }],
    });

    const outcome = projectPath(gs, RAY);
    expect(outcome.halted).toBe(true);
    expect(outcome.ate).toBe(false);
    expect(outcome.cost).toBe(2 + 20);
  });

  // The other half of the same rule, which the food phase running at the
  // FINAL cell (not the staged destination) makes true: a capture-stop ON food
  // does credit the meal. The mover ends the turn standing on it, which is the
  // only question the engine's food phase asks.
  test('a capture-stop ON food DOES credit the meal — the food phase reads the final cell', () => {
    const rook = makePiece('R', OURS, { x: 1, y: 5 }, 'rook', 5, { health: 100 });
    const victim = makePiece('EP', THEIRS, { x: 3, y: 5 }, 'pawn', 1);
    const gs = makeState([rook, victim], 'R', {
      hazards: [{ x: 2, y: 5 }],
      hazardDamage: 20,
      food: [{ x: 3, y: 5 }], // the square we capture and stop on
    });

    const outcome = projectPath(gs, RAY);
    expect(outcome.halted).toBe(true);
    expect(outcome.ate).toBe(true);
    expect(outcome.cost).toBe(0);
    expect(outcome.casualties.kills).toBe(1);
  });
});

describe('the piece candidate path: a winning king trade is scored, not discarded', () => {
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

  function feed(gameId: string, gs: GameState, unitId: string) {
    if (!mgr.getGame(gameId)?.controlledSnakes.has(unitId)) mgr.registerGame(gs, unitId);
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, unitId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    return mgr.getGame(gameId)!.controlledSnakes.get(unitId)!;
  }

  function tradeBoard(gameId: string): GameState {
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('EK', THEIRS, CONTESTED, 'king', 3); // dead level: a tie
    const spare = makePiece('ER', THEIRS, { x: 9, y: 9 }, 'rook', 4);
    return makeState([bishop, king, spare], 'B', { id: gameId });
  }

  test('the row carries the kill, their regicide AND our death — a trade, not a suicide', () => {
    const gameId = 'g-tie-trade-row';
    const cs = feed(gameId, tradeBoard(gameId), 'B');

    const row = mgr.computePieceCandidates(gameId, 'B').find(e => e.move === fullIdx(CONTESTED))!;
    expect(row).toBeDefined();
    expect(row.fatal).toBe(true);
    expect(row.healthCost).toBe(100);
    expect(row.casualties.kills).toBe(1);
    expect(row.casualties.enemyRegicide).toBe(1);
    expect(row.casualties.regicide).toBe(0);
    expect(row.casualties.allyCasualty).toBe(0);
    // Enumerated for the board too — annotated, never hidden.
    expect(cs.latestTurnData!.moveEvaluations.some(e => e.move === fullIdx(CONTESTED))).toBe(true);

    // The reward outweighs the death and the health it costs, so the trade is
    // genuinely SCORABLE rather than pinned below every alternative.
    expect(row.score).toBeGreaterThan(0);
  });

  test('and it is actually staged: the fatal veto exempts a move that ends an enemy team', () => {
    const gameId = 'g-tie-trade-staged';
    const cs = feed(gameId, tradeBoard(gameId), 'B');
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'B', { type: 'green', x: CONTESTED.x, y: CONTESTED.y }, 'u1');
    expect(cs.staged?.move).toBe(fullIdx(CONTESTED));
  });

  test('the exemption is narrow: a fatal tie that WINS nothing is still vetoed', () => {
    const gameId = 'g-tie-plain';
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    // An ordinary enemy rook — a tie kills it, but no team ends.
    const rook = makePiece('ER', THEIRS, CONTESTED, 'rook', 3);
    const gs = makeState([bishop, rook], 'B', { id: gameId });
    const cs = feed(gameId, gs, 'B');
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'B', { type: 'green', x: CONTESTED.x, y: CONTESTED.y }, 'u1');
    expect(cs.staged?.move).not.toBe(fullIdx(CONTESTED));
  });

  test('and never at the price of our OWN last king', () => {
    const gameId = 'g-tie-king-for-king';
    const ourKing = makePiece('K', OURS, { x: 2, y: 2 }, 'king', 3);
    const theirKing = makePiece('EK', THEIRS, CONTESTED, 'king', 3);
    const gs = makeState([ourKing, theirKing], 'K', { id: gameId });
    const cs = feed(gameId, gs, 'K');
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'K', { type: 'green', x: CONTESTED.x, y: CONTESTED.y }, 'u1');
    // Our own regicide is filtered BEFORE the fatal veto and carries no
    // exemption, so trading kings is never the staged move.
    expect(cs.staged?.move).not.toBe(fullIdx(CONTESTED));
  });
});
