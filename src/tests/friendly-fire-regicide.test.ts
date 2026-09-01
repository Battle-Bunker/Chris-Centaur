/**
 * Killing our OWN units, and the catastrophe of killing our own KING.
 *
 * Reported from live play: one of the owner's own snakes stepped onto their
 * own king, won the contest, and the engine's regicide rule eliminated their
 * whole team — and nothing in the client's scoring had any opinion about it.
 *
 * The engine is unambiguous on both halves (TacticToes
 * functions/src/gameprocessors/):
 *  - engine/turnEngine.ts adjudicates a contested cell by
 *    invulnerability tier first and weight second, and NEVER by team. An ally
 *    kills an ally exactly as an enemy would.
 *  - TeamSnekProcessor.ts `applyRegicide` eliminates a team whose config
 *    includes kings the moment its LAST king dies, removing every remaining
 *    unit it owns that turn. Team score is total weight, so the team's score
 *    goes from all of it to zero.
 *
 * The client can decide regicide from the live board alone: a king only ever
 * enters play from the game setup (pawns promote to queens, never to kings),
 * and a team configured with kings cannot still be playing with none alive —
 * the rule would already have eliminated it. So "subject to regicide" is
 * exactly "has a living king", and "this is its last" is exactly "we are
 * killing every living king it has".
 */

import { evaluatePathOnBoard } from '../logic/turn-oracle';
import { BoardEvaluator } from '../logic/board-evaluator';
import { DecisionEngine, pickBestMove } from '../logic/decision-engine';
import { ActiveGameManager } from '../server/active-game-manager';
import { apiCoordToIndex } from '../firebase/translate';
import { DEFAULT_CONFIG } from '../config/game-config';
import { HEURISTICS } from '../config/heuristics';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

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

// The reported shape: OUR snake at (5,5), heavy enough to win any equal-tier
// contest, with one of OUR OWN units sitting on the square to its right.
const OUR_BODY: Coord[] = [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }];
const RIGHT: Coord = { x: 6, y: 5 };

const teamOf = (...ids: string[]) => new Set(ids);

describe('the reported move: our own snake steps onto our own king', () => {
  test('the contest is won, the king dies, and it is OUR team that ends', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const king = makePiece('K', OURS, RIGHT, 'king');
    const gs = makeState([us, king], 'us');

    const outcome = projectPath(gs, [RIGHT]);

    // INVERTED, by the engine itself. The old hand-written projection reported
    // this as a move we SURVIVE (cost 1) that merely flags regicide for the
    // scorer. The engine disagrees: taking our own last king eliminates the
    // whole team, and our snake is on that team — so it is removed too, with
    // cause "regicide", and the move costs us everything.
    expect(outcome.fatal).toBe(true);
    expect(outcome.deathCause).toBe('regicide');
    expect(outcome.cost).toBe(gs.you.health);
    // And it destroys our own weight-1 king, which is what ended the team.
    expect(outcome.casualties.allyCasualty).toBe(1);
    expect(outcome.casualties.regicide).toBe(1);
    // Nothing on the enemy's side of the ledger.
    expect(outcome.casualties.kills).toBe(0);
    expect(outcome.casualties.enemyRegicide).toBe(0);
  });

  test('the two components dominate the matrix — a mildly bad alternative outranks it', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const king = makePiece('K', OURS, RIGHT, 'king');
    // A "mildly bad" alternative: stepping left into a hazard, which is the
    // worst thing the pre-regicide matrix knew how to say about a survivable
    // move (a full hazard dose at the default weight is -500).
    const gs = makeState([us, king], 'us', { hazards: [{ x: 4, y: 5 }], hazardDamage: 30 });

    const regicidal = projectPath(gs, [RIGHT]);
    const mildlyBad = projectPath(gs, [{ x: 4, y: 5 }]);

    const evaluator = new BoardEvaluator();
    const team = teamOf('us', 'K');
    const regicidalEval = evaluator.evaluateBoard(gs, 'us', team, {
      healthCost: regicidal.cost,
      casualties: regicidal.casualties,
    });
    const mildEval = evaluator.evaluateBoard(gs, 'us', team, {
      healthCost: mildlyBad.cost,
      casualties: mildlyBad.casualties,
    });

    expect(regicidalEval.stats.regicide).toBe(1);
    expect(regicidalEval.stats.allyCasualty).toBe(1);
    expect(regicidalEval.weighted.regicideScore).toBe(HEURISTICS.regicide.default);
    expect(regicidalEval.weighted.regicideScore).toBe(-100000);
    expect(regicidalEval.weighted.allyCasualtyScore).toBe(HEURISTICS.allyCasualty.default);

    // No sum of everything else is in the same universe.
    expect(mildEval.score - regicidalEval.score).toBeGreaterThan(50000);
    expect(regicidalEval.score).toBeLessThan(mildEval.score);
  });

  test('and it is VETOED, not merely outscored — even when it scores highest', () => {
    // The veto is the hard guarantee: pickBestMove drops regicidal candidates
    // before it ever compares scores, so a candidate that somehow carried a
    // huge positive score (an operator waypoint sitting on the king) still
    // cannot be chosen while anything else exists.
    const picked = pickBestMove([
      { move: 'right', score: 9999, trapped: 0, regicide: 1 },
      { move: 'left', score: -400, trapped: 0, regicide: 0 },
    ]);
    expect(picked).toBe('left');

    // It outranks the fatal-pocket veto: losing the team beats losing one unit.
    expect(
      pickBestMove([
        { move: 'right', score: 100, trapped: 1, regicide: 1 },
        { move: 'left', score: 0, trapped: 1, regicide: 0 },
      ])
    ).toBe('left');

    // Only when EVERY candidate ends the team does it fall through to scoring.
    expect(
      pickBestMove([
        { move: 'right', score: 10, trapped: 0, regicide: 1 },
        { move: 'left', score: 5, trapped: 0, regicide: 1 },
      ])
    ).toBe('right');
  });

  test('end to end: the reported move is the top-scoring one and is still not picked', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const king = makePiece('K', OURS, RIGHT, 'king');
    const gs = makeState([us, king], 'us');
    const team = teamOf('us', 'K');

    // INVERTED, and this is the clearest single illustration of what running
    // the real game bought us. The bug this test was written for was that the
    // move LOOKED GOOD: with the regicide and ally-casualty weights switched
    // off, the old projection scored stepping onto our own king as the
    // best candidate on the board — it won a contest, opened space, and cost
    // one point of health — and only two bespoke weights held it back.
    //
    // Now the engine reports the move as OUR OWN DEATH, because regicide takes
    // our snake with the team. So it is dead last on health-loss alone, before
    // any combat weight is consulted at all: the catastrophe is visible in the
    // most basic stat the bot has.
    const blind = new DecisionEngine({
      timeoutMs: 50,
      weights: { regicide: 0, allyCasualty: 0 },
    }).decide(gs, team);
    const blindRows = new Map(blind.evaluations.map(e => [e.move, e.worstScore]));
    const rivals = [...blindRows].filter(([m]) => m !== 'right').map(([, s]) => s);
    expect(blindRows.get('right' as Direction)!).toBeLessThan(Math.max(...rivals));
    // The veto refuses it as well, whatever the weights say.
    expect(blind.move).not.toBe('right' as Direction);

    // And at the shipped weights it is both vetoed and hopelessly outscored.
    const decision = new DecisionEngine({ timeoutMs: 50 }).decide(gs, team);
    expect(decision.move).not.toBe('right' as Direction);
    const scored = new Map(decision.evaluations.map(e => [e.move, e.worstScore]));
    for (const [move, score] of scored) {
      if (move === 'right') continue;
      expect(scored.get('right' as Direction)!).toBeLessThan(score);
    }
  });
});

describe('when the king is NOT our last: friendly fire, no catastrophe', () => {
  test('a second living king on our team leaves regicide silent', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const king = makePiece('K1', OURS, RIGHT, 'king');
    const spare = makePiece('K2', OURS, { x: 1, y: 1 }, 'king');
    const gs = makeState([us, king, spare], 'us');

    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.casualties.regicide).toBe(0);
    // Still a real loss: the king's whole weight, off our own score.
    expect(outcome.casualties.allyCasualty).toBe(1);

    const evaluator = new BoardEvaluator();
    const evaluation = evaluator.evaluateBoard(gs, 'us', teamOf('us', 'K1', 'K2'), {
      healthCost: outcome.cost,
      casualties: outcome.casualties,
    });
    expect(evaluation.stats.regicide).toBe(0);
    expect(evaluation.weighted.regicideScore).toBeCloseTo(0, 9);
    expect(evaluation.weighted.allyCasualtyScore).toBe(HEURISTICS.allyCasualty.default);
    // Decisive, but survivable: a friendly kill is not the end of the game.
    expect(evaluation.weighted.allyCasualtyScore).toBeGreaterThan(HEURISTICS.regicide.default);
  });
});

describe('killing an ally that is not a king: scaled by what is lost', () => {
  test('an ally PIECE costs its whole weight', () => {
    for (const weight of [1, 3, 5]) {
      const us = makeSnake('us', OURS, [...OUR_BODY, { x: 5, y: 2 }, { x: 5, y: 1 }, { x: 5, y: 0 }]);
      const rook = makePiece('R', OURS, RIGHT, 'rook', weight);
      const gs = makeState([us, rook], 'us');

      const outcome = projectPath(gs, [RIGHT]);
      expect(outcome.casualties.allyCasualty).toBe(weight);
      expect(outcome.casualties.regicide).toBe(0);
      expect(outcome.casualties.kills).toBe(0);

      const evaluation = new BoardEvaluator().evaluateBoard(gs, 'us', teamOf('us', 'R'), {
        healthCost: outcome.cost,
        casualties: outcome.casualties,
      });
      expect(evaluation.weighted.allyCasualtyScore).toBe(weight * HEURISTICS.allyCasualty.default);
    }
  });

  test('severing an ally SNAKE costs the segments cut off, not the whole snake', () => {
    // Strictly higher tier: we cut through instead of dying on the body.
    const us = makeSnake('us', OURS, OUR_BODY, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: 99,
    });
    // (6,5) is segment index 1 of a 5-cell ally: segments 1..4 are cut away.
    const ally = makeSnake('ally', OURS, [
      { x: 6, y: 6 }, RIGHT, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 },
    ]);
    const gs = makeState([us, ally], 'us');

    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.fatal).toBe(false);
    expect(outcome.casualties.allyCasualty).toBe(4);
    expect(outcome.casualties.regicide).toBe(0);
    // A severed snake is shortened, not eliminated — no kill is claimed.
    expect(outcome.casualties.kills).toBe(0);
  });

  test('no friendly fire when nobody dies: an ordinary step into open ground', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const gs = makeState([us], 'us');
    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.casualties).toEqual({
      allyCasualty: 0, regicide: 0, kills: 0, enemyRegicide: 0,
    });
  });
});

describe('killing an ENEMY: no friendly-fire penalty, and the winning move is visible', () => {
  test('an enemy piece we beat is a kill, not a casualty', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const rook = makePiece('R', THEIRS, RIGHT, 'rook', 2);
    const gs = makeState([us, rook], 'us');

    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.casualties.allyCasualty).toBe(0);
    expect(outcome.casualties.regicide).toBe(0);
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.enemyRegicide).toBe(0);

    const evaluation = new BoardEvaluator().evaluateBoard(gs, 'us', teamOf('us'), {
      healthCost: outcome.cost,
      casualties: outcome.casualties,
    });
    expect(evaluation.stats.kills).toBe(1);
    expect(evaluation.weighted.allyCasualtyScore).toBeCloseTo(0, 9);
    // The kills weight ships at 0 — computing the stat does not switch on a
    // behaviour change; the owner decides that on the config page.
    expect(HEURISTICS.kills.default).toBe(0);
    expect(evaluation.weighted.killsScore).toBe(0);
  });

  test("taking the enemy's LAST king ends THEIR team, and the bot can see it", () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const theirKing = makePiece('EK', THEIRS, RIGHT, 'king');
    const theirRook = makePiece('ER', THEIRS, { x: 1, y: 1 }, 'rook', 3);
    const gs = makeState([us, theirKing, theirRook], 'us');

    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.casualties.enemyRegicide).toBe(1);
    expect(outcome.casualties.regicide).toBe(0);
    expect(outcome.casualties.allyCasualty).toBe(0);

    const evaluation = new BoardEvaluator().evaluateBoard(gs, 'us', teamOf('us'), {
      healthCost: outcome.cost,
      casualties: outcome.casualties,
    });
    expect(evaluation.weighted.enemyRegicideScore).toBe(HEURISTICS.enemyRegicide.default);
    expect(evaluation.weighted.enemyRegicideScore).toBe(2000);
    // Worth taking — but never worth trading our own king for.
    expect(HEURISTICS.enemyRegicide.default).toBeLessThan(-HEURISTICS.regicide.default / 10);
  });

  test('a spare enemy king means their team survives the capture', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const theirKing = makePiece('EK1', THEIRS, RIGHT, 'king');
    const theirOtherKing = makePiece('EK2', THEIRS, { x: 1, y: 1 }, 'king');
    const gs = makeState([us, theirKing, theirOtherKing], 'us');
    expect(projectPath(gs, [RIGHT]).casualties.enemyRegicide).toBe(0);
  });
});

describe('a team with no kings is never subject to regicide', () => {
  test('killing an ally, dying ourselves, and both at once all leave regicide at 0', () => {
    const us = makeSnake('us', OURS, OUR_BODY);
    const allyRook = makePiece('R', OURS, RIGHT, 'rook', 2);
    // Only the ENEMY fields a king — their rule, not ours.
    const theirKing = makePiece('EK', THEIRS, { x: 0, y: 0 }, 'king');
    const gs = makeState([us, allyRook, theirKing], 'us', { hazards: [{ x: 4, y: 5 }] });

    const killsAlly = projectPath(gs, [RIGHT]);
    expect(killsAlly.casualties.allyCasualty).toBe(2);
    expect(killsAlly.casualties.regicide).toBe(0);

    // Walking into a fatal hazard: our unit dies, our team plays on.
    const suicidal = projectPath(gs, [{ x: 4, y: 5 }]);
    expect(suicidal.fatal).toBe(true);
    expect(suicidal.casualties.regicide).toBe(0);
  });

  test('our own KING dying on its own move IS regicide — the same catastrophe, one step earlier', () => {
    const king = makePiece('K', OURS, { x: 5, y: 5 }, 'king', 1, { health: 40 });
    const ally = makeSnake('ally', OURS, [{ x: 0, y: 0 }, { x: 0, y: 1 }]);
    const gs = makeState([king, ally], 'K', { hazards: [RIGHT], hazardDamage: 100 });

    const outcome = projectPath(gs, [RIGHT]);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.regicide).toBe(1);
    // Nobody else was killed — the loss is the king itself, which the deaths
    // and health-loss terms already price; allyCasualty does not double-count.
    expect(outcome.casualties.allyCasualty).toBe(0);

    // A non-king unit walking into the same square is an ordinary death.
    const pawnGs = makeState(
      [makePiece('P', OURS, { x: 5, y: 5 }, 'pawn', 1, { health: 40 }), ally],
      'P',
      { hazards: [RIGHT], hazardDamage: 100 }
    );
    expect(projectPath(pawnGs, [RIGHT]).casualties.regicide).toBe(0);
  });
});

describe('the piece candidate path obeys exactly the same rules', () => {
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

  // A bishop whose up-right ray runs (3,3) → (4,4) → (5,5) → (6,6).
  const RAY_END: Coord = { x: 6, y: 6 };

  test('a ray that crosses an ALLY snake severs it, and the row carries the casualty', () => {
    const gameId = 'g-ff-ray';
    // Strictly higher tier, so the bishop cuts through instead of dying there.
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: 99,
    });
    // (4,4) is segment index 1 of a 3-cell ally: 2 segments are cut away.
    const ally = makeSnake('ally', OURS, [{ x: 4, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 3 }]);
    const gs = makeState([bishop, ally], 'B', { id: gameId });
    feed(gameId, gs, 'B');

    const candidates = mgr.computePieceCandidates(gameId, 'B');
    const row = candidates.find(e => e.move === fullIdx({ x: 4, y: 4 }))!;
    expect(row).toBeDefined();
    expect(row.casualties.allyCasualty).toBe(2);
    expect(row.casualties.regicide).toBe(0);
    // Ranked below the harmless squares of the very same ray.
    const clean = candidates.find(e => e.move === fullIdx({ x: 3, y: 3 }))!;
    expect(clean.casualties.allyCasualty).toBe(0);
    expect(row.score).toBeLessThan(clean.score);
    expect(row.score - clean.score).toBeLessThanOrEqual(2 * DEFAULT_CONFIG.allyCasualty);
  });

  test('a ray onto our own LAST king is annotated regicide and never staged', () => {
    const gameId = 'g-ff-regicide-ray';
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('K', OURS, { x: 4, y: 4 }, 'king');
    const gs = makeState([bishop, king], 'B', { id: gameId });
    const cs = feed(gameId, gs, 'B');

    const rows = mgr.computePieceCandidates(gameId, 'B');
    const regicidal = rows.find(e => e.move === fullIdx({ x: 4, y: 4 }))!;
    expect(regicidal.casualties.regicide).toBe(1);
    expect(regicidal.casualties.allyCasualty).toBe(1);
    // ANNOTATED, NOT HIDDEN — a human commander can still spend the king, and
    // the candidate is still enumerated for the board.
    expect(cs.latestTurnData!.moveEvaluations.some(e => e.move === fullIdx({ x: 4, y: 4 }))).toBe(true);
    for (const other of rows) {
      if (other.casualties.regicide === 1) continue;
      expect(regicidal.score).toBeLessThan(other.score);
    }

    // And a waypoint on the far side of the king never stages the capture, nor
    // the squares beyond it (the ray capture-stops on the king).
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'B', { type: 'green', x: RAY_END.x, y: RAY_END.y }, 'u1');
    expect(cs.staged?.move).not.toBe(fullIdx({ x: 4, y: 4 }));
  });

  test('the same ray onto an ENEMY king is a kill and their regicide, with no penalty on us', () => {
    const gameId = 'g-ff-enemy-king';
    const bishop = makePiece('B', OURS, { x: 2, y: 2 }, 'bishop', 3);
    const king = makePiece('EK', THEIRS, { x: 4, y: 4 }, 'king');
    const gs = makeState([bishop, king], 'B', { id: gameId });
    feed(gameId, gs, 'B');

    const rows = mgr.computePieceCandidates(gameId, 'B');
    const row = rows.find(e => e.move === fullIdx({ x: 4, y: 4 }))!;
    expect(row.casualties.allyCasualty).toBe(0);
    expect(row.casualties.regicide).toBe(0);
    expect(row.casualties.kills).toBe(1);
    expect(row.casualties.enemyRegicide).toBe(1);
    // The winning capture now outranks every candidate that does NOT take the
    // king. (The squares BEYOND it on the same ray tie with it: the ray
    // capture-stops on the king, so they are the same move by another name.)
    for (const other of rows) {
      if (other.casualties.enemyRegicide === 1) continue;
      expect(other.score).toBeLessThan(row.score);
    }
  });
});
