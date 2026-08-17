/**
 * The per-decision piece threat map and its ride through the pipeline:
 *
 *  - geometry: slider rays blocked by current occupancy (blocker square
 *    included), knight L-jumps, king steps, pawn forward + both
 *    diagonal-forwards from its orientation — board-bounded, health-uncapped;
 *  - threat rule: an enemy piece threatens a square iff it would WIN or TIE
 *    the contest there (higher tier, or equal tier and weight >= ours); an
 *    ally piece threatens every square it can reach (we never want the
 *    trade), mirroring ally h2h risk;
 *  - MoveAnalyzer: a candidate landing on a threatened square is RISKY,
 *    never safe;
 *  - evaluation: the pieceThreat stats ride into decide()'s evaluations with
 *    the registry weights (a heavier queen's ray square carries the penalty,
 *    a lighter piece's does not);
 *  - decide(): between two otherwise-comparable squares the bot prefers the
 *    one off a threatening queen's ray.
 */

import { computePieceThreatMap } from '../logic/piece-threats';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { DecisionEngine } from '../logic/decision-engine';
import { BoardGraph } from '../logic/board-graph';
import { HEURISTICS } from '../config/heuristics';
import { GameState, Snake, Coord } from '../types/battlesnake';

const TURN = 10;

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  };
}

/** A chess piece: 1-cell body, `length` = WEIGHT. */
function makePiece(
  id: string,
  square: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake {
  return makeSnake(id, [square], { length: weight, unitType, ...extra });
}

function makeGameState(snakes: Snake[], youId: string, food: Coord[] = []): GameState {
  return {
    game: {
      id: 'piece-threat-test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn: TURN,
    board: { width: 11, height: 11, snakes, food, hazards: [] },
    you: snakes.find((s) => s.id === youId)!,
  };
}

const W = 11;
const idx = (x: number, y: number): number => y * W + x;

// Our reference snake: length 3, head (0,0) corner, far from the action.
const farUs = (): Snake => makeSnake('us', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);

describe('piece threat map geometry', () => {
  test('a queen ray is blocked by current occupancy — the blocker square included, nothing beyond', () => {
    const us = farUs();
    // Heavier than us -> threatens everywhere it can reach. Health 1 pins
    // that slider range is NOT capped by piece health.
    const queen = makePiece('q', { x: 5, y: 5 }, 'queen', 10, { health: 1 });
    const blocker = makeSnake('b', [{ x: 5, y: 8 }, { x: 6, y: 8 }, { x: 7, y: 8 }]);
    const gs = makeGameState([us, queen, blocker], 'us');
    const map = computePieceThreatMap(us, gs.board, TURN)!;

    // Up the column: reachable through empty squares...
    expect(map.enemyThreat[idx(5, 6)]).toBe(1);
    expect(map.enemyThreat[idx(5, 7)]).toBe(1);
    // ...the blocker square itself is reachable (a contest can happen there)...
    expect(map.enemyThreat[idx(5, 8)]).toBe(1);
    // ...but the ray stops there.
    expect(map.enemyThreat[idx(5, 9)]).toBe(0);
    expect(map.enemyThreat[idx(5, 10)]).toBe(0);
    // Unblocked rays run to the board edge (orthogonal and diagonal).
    expect(map.enemyThreat[idx(0, 5)]).toBe(1);
    expect(map.enemyThreat[idx(10, 5)]).toBe(1);
    expect(map.enemyThreat[idx(10, 10)]).toBe(1);
    expect(map.enemyThreat[idx(1, 1)]).toBe(1);
    // Off-ray squares are not threatened; neither is the queen's own square.
    expect(map.enemyThreat[idx(4, 7)]).toBe(0);
    expect(map.enemyThreat[idx(5, 5)]).toBe(0);
  });

  test('knight L-jumps (board-bounded)', () => {
    const us = farUs();
    const knight = makePiece('n', { x: 5, y: 5 }, 'knight', 10);
    const gs = makeGameState([us, knight], 'us');
    const map = computePieceThreatMap(us, gs.board, TURN)!;

    const jumps: Array<[number, number]> = [
      [6, 7], [7, 6], [7, 4], [6, 3], [4, 3], [3, 4], [3, 6], [4, 7],
    ];
    for (const [x, y] of jumps) expect(map.enemyThreat[idx(x, y)]).toBe(1);
    // A knight does not threaten adjacency or its own square.
    expect(map.enemyThreat[idx(5, 6)]).toBe(0);
    expect(map.enemyThreat[idx(6, 6)]).toBe(0);
    expect(map.enemyThreat[idx(5, 5)]).toBe(0);
    // Threatened square count is exactly the 8 jumps.
    expect(map.enemyThreat.reduce((a, b) => a + b, 0)).toBe(8);

    // Corner knight: only the two in-bounds jumps.
    const cornerKnight = makePiece('n', { x: 0, y: 0 }, 'knight', 10);
    const gs2 = makeGameState([makeSnake('us', [{ x: 9, y: 9 }, { x: 9, y: 8 }, { x: 9, y: 7 }]), cornerKnight], 'us');
    const map2 = computePieceThreatMap(gs2.you, gs2.board, TURN)!;
    expect(map2.enemyThreat[idx(1, 2)]).toBe(1);
    expect(map2.enemyThreat[idx(2, 1)]).toBe(1);
    expect(map2.enemyThreat.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('king steps and pawn forward + diagonal-forwards by orientation (occupancy-independent)', () => {
    const us = farUs();
    const king = makePiece('k', { x: 9, y: 9 }, 'king', 10);
    // Wire orientation +x (y down): api forward (6,5); diagonal-forwards (6,4), (6,6).
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', 10, { orientation: { dx: 1, dy: 0 } });
    const gs = makeGameState([us, king, pawn], 'us');
    const map = computePieceThreatMap(us, gs.board, TURN)!;

    // King: all 8 neighbors.
    for (const [x, y] of [[8, 8], [8, 9], [8, 10], [9, 8], [9, 10], [10, 8], [10, 9], [10, 10]]) {
      expect(map.enemyThreat[idx(x, y)]).toBe(1);
    }
    // Pawn: forward and BOTH empty diagonal-forwards (occupancy may change
    // under it before the turn resolves), nothing sideways or backwards.
    expect(map.enemyThreat[idx(6, 5)]).toBe(1);
    expect(map.enemyThreat[idx(6, 4)]).toBe(1);
    expect(map.enemyThreat[idx(6, 6)]).toBe(1);
    expect(map.enemyThreat[idx(4, 5)]).toBe(0);
    expect(map.enemyThreat[idx(5, 6)]).toBe(0);
    expect(map.enemyThreat[idx(5, 4)]).toBe(0);
  });

  test('a lighter enemy piece (equal tier) threatens nothing; equal weight threatens', () => {
    const us = farUs(); // length 3
    const light = makeGameState([us, makePiece('q', { x: 5, y: 5 }, 'queen', 2)], 'us');
    const lightMap = computePieceThreatMap(us, light.board, TURN)!;
    expect(lightMap.enemyThreat.reduce((a, b) => a + b, 0)).toBe(0);

    const equal = makeGameState([us, makePiece('q', { x: 5, y: 5 }, 'queen', 3)], 'us');
    const equalMap = computePieceThreatMap(us, equal.board, TURN)!;
    expect(equalMap.enemyThreat[idx(5, 6)]).toBe(1); // w >= ours ties -> threat
  });

  test('an ally piece threatens every reachable square regardless of weight', () => {
    const us = farUs();
    const allyRook = makePiece('r', { x: 5, y: 5 }, 'rook', 1); // we would win the trade — still unwanted
    const gs = makeGameState([us, allyRook], 'us');
    const map = computePieceThreatMap(us, gs.board, TURN, new Set(['us', 'r']))!;
    expect(map.allyThreat[idx(5, 8)]).toBe(1);
    expect(map.enemyThreat.reduce((a, b) => a + b, 0)).toBe(0);
  });

  test('a piece-free board yields no map at all', () => {
    const us = farUs();
    const enemy = makeSnake('e', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }]);
    const gs = makeGameState([us, enemy], 'us');
    expect(computePieceThreatMap(us, gs.board, TURN)).toBeNull();
  });
});

// Us mid-board: head (5,5), body to the left, so 'left' is neck-blocked and
// the live candidates are up / down / right.
const midUs = (): Snake => makeSnake('us', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);

describe('MoveAnalyzer: threatened squares are RISKY, never safe', () => {
  const analyzer = new MoveAnalyzer();

  test('a heavier queen ray flips the on-ray move from safe to risky', () => {
    // Queen at (5,9): its down-column ray reaches (5,6) and stops at our head.
    const gs = makeGameState([midUs(), makePiece('q', { x: 5, y: 9 }, 'queen', 10)], 'us');
    const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));

    expect(analysis.risky).toEqual(['up']);
    expect(analysis.safe).toEqual(expect.arrayContaining(['down', 'right']));
    const threat = analysis.pieceThreatByMove.get('up')!;
    expect(threat.hasEnemyThreat).toBe(true);
    expect(threat.enemyThreatCount).toBe(1);
    expect(threat.hasAllyThreat).toBe(false);
    // Off-ray squares carry no threat: the ray was blocked by our own head.
    expect(analysis.pieceThreatByMove.get('down')!.hasEnemyThreat).toBe(false);
  });

  test('the same queen, lighter than us, threatens nothing — every move stays safe', () => {
    const gs = makeGameState([midUs(), makePiece('q', { x: 5, y: 9 }, 'queen', 1)], 'us');
    const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));
    expect(analysis.risky).toEqual([]);
    expect(analysis.safe).toEqual(expect.arrayContaining(['up', 'down', 'right']));
    expect(analysis.pieceThreatByMove.get('up')!.hasEnemyThreat).toBe(false);
  });

  test('an ALLY queen marks its reach as ally threat — risky even though we would win the trade', () => {
    const gs = makeGameState([midUs(), makePiece('q', { x: 5, y: 9 }, 'queen', 1)], 'us');
    const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs), new Set(['us', 'q']));
    expect(analysis.risky).toEqual(['up']);
    const threat = analysis.pieceThreatByMove.get('up')!;
    expect(threat.hasAllyThreat).toBe(true);
    expect(threat.allyThreatCount).toBe(1);
    expect(threat.hasEnemyThreat).toBe(false);
  });
});

describe('decide(): the pieceThreat penalty rides the evaluation pipeline', () => {
  // Us on row 1 with body left; a hazard at (6,1) makes 'right' certain death
  // (default hazardDamage 100), leaving exactly two candidates: 'up' (5,2) on
  // the queen's down-column ray, and 'down' (5,0) shielded by our own head.
  // Absent the threat, 'up' is the otherwise-better square — 'down' is the
  // board edge and takes the edge penalty — pinned by the lighter-queen case
  // below, so only the threat penalty can flip the choice. The queen claims
  // nearly every square either way (its Voronoi territory expands along its
  // rays, one square per MOVE, against our one step per move), which is what
  // makes the edge penalty rather than territory the tiebreaker here.
  function scenario(queenWeight: number): GameState {
    const gs = makeGameState(
      [
        makeSnake('us', [{ x: 5, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 1 }]),
        makePiece('q', { x: 5, y: 5 }, 'queen', queenWeight),
      ],
      'us'
    );
    gs.board.hazards = [{ x: 6, y: 1 }];
    return gs;
  }

  test('a heavier queen ray square carries the enemyPieceThreat penalty; the bot steps off the ray', () => {
    const engine = new DecisionEngine();
    const decision = engine.decide(scenario(10), new Set(['us']));

    expect(decision.candidateMoves.sort()).toEqual(['down', 'up']);
    const up = decision.evaluations.find((e) => e.move === 'up')!;
    const down = decision.evaluations.find((e) => e.move === 'down')!;
    expect(up.worstEvaluation.stats.enemyPieceThreat).toBe(1);
    expect(up.worstEvaluation.weighted.enemyPieceThreatScore)
      .toBe(HEURISTICS.enemyPieceThreat.default); // 1 × default weight
    expect(down.worstEvaluation.stats.enemyPieceThreat).toBe(0);
    expect(down.worstEvaluation.weighted.enemyPieceThreatScore).toBeCloseTo(0, 10);

    // 'up' scores higher on everything else: the threat penalty flips the
    // choice off the queen's ray.
    expect(decision.move).toBe('down');
  });

  test('a lighter queen carries no penalty — the bot takes the otherwise-better square', () => {
    const engine = new DecisionEngine();
    const decision = engine.decide(scenario(1), new Set(['us']));

    for (const evaluation of decision.evaluations) {
      expect(evaluation.worstEvaluation.stats.enemyPieceThreat).toBe(0);
    }
    expect(decision.move).toBe('up');
  });
});
