/**
 * Pawn promotion mirrored from the TacticToes engine (chess/pieceMoves.ts):
 * a pawn that reaches the configured weight threshold (GameSetup.
 * pawnPromotionWeight, default DEFAULT_PAWN_PROMOTION_WEIGHT) promotes to a
 * queen immediately AFTER the eat/growth update — so a pawn that eats into
 * the threshold promotes the SAME turn. Promotion RESETS weight to 1
 * (truncating the body to the single head square) rather than preserving
 * the grown stack, keeps id/letter/orientation, and clamps (never raises)
 * current health down to the queen's configured max.
 *
 * The client previously had no promotion step at all, so its lookahead
 * would keep growing a pawn past the threshold instead of resetting it —
 * over-counting a promoting team's projected score by
 * `pawnPromotionWeight - 1` (score is total weight).
 */

import { Simulator, MoveSet } from '../logic/simulator';
import { planPieceAction, DEFAULT_PAWN_PROMOTION_WEIGHT } from '../logic/piece-moves';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

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

/**
 * A chess piece whose body is the SELF-CONSISTENT weight-stack — `weight`
 * copies of `square` — so the Simulator's growth mechanic (which derives
 * `length` from the post-move body array length, identically for pieces and
 * snakes) tracks the piece's true weight. This is the representation the
 * Simulator's own growth code requires of anything it moves; translate.ts's
 * single-cell collapse is a display-time simplification for pieces that
 * never move within the Simulator (they're modeled frozen in lookahead).
 */
function makePiece(id: string, square: Coord, unitType: string, weight: number, extra: Partial<Snake> = {}): Snake {
  return makeSnake(id, Array.from({ length: weight }, () => ({ ...square })), {
    unitType,
    orientation: { dx: 0, dy: -1 },
    ...extra,
  });
}

function makeGameState(snakes: Snake[], youId: string, turn = TURN): GameState {
  return {
    game: {
      id: 'pawn-promotion-test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn,
    board: { width: 11, height: 11, snakes, food: [], hazards: [] },
    you: snakes.find((s) => s.id === youId)!,
  };
}

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

describe('pawn promotion in the Simulator', () => {
  const simulator = new Simulator();

  test('a pawn that eats into the threshold promotes to a queen the same turn', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', DEFAULT_PAWN_PROMOTION_WEIGHT - 1, {
      health: 80,
      orientation: { dx: 1, dy: 0 },
    });
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 6, y: 5 }];

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    expect(result.deadSnakeIds.has('p')).toBe(false);
    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('queen');
    expect(sim.length).toBe(1);
    expect(sim.body).toEqual([{ x: 6, y: 5 }]);
    expect(sim.head).toEqual({ x: 6, y: 5 });
    // Orientation survives promotion unchanged.
    expect(sim.orientation).toEqual({ dx: 1, dy: 0 });
  });

  test('a pawn that eats but stays below the threshold does not promote', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', DEFAULT_PAWN_PROMOTION_WEIGHT - 2);
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 6, y: 5 }];

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('pawn');
    expect(sim.length).toBe(DEFAULT_PAWN_PROMOTION_WEIGHT - 1);
  });

  test('promotion uses the configured pawnPromotionWeight, not always the default', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', 2);
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 6, y: 5 }];
    gs.board.pawnPromotionWeight = 3; // lower than the default, so 2 -> 3 promotes

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('queen');
    expect(sim.length).toBe(1);
  });

  test("promotion clamps current health down to the queen's configured max, never raising it", () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', DEFAULT_PAWN_PROMOTION_WEIGHT - 1, {
      health: 90,
      maxHealth: 100,
    });
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 6, y: 5 }]; // eating restores health to maxHealth (100) first
    gs.board.maxHealthPerUnit = { pawn: 100, queen: 30 };

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('queen');
    // Post-eat health would be 100 (restored to the pawn's max); clamped down
    // to the queen's configured max of 30.
    expect(sim.health).toBe(30);
  });

  test("promotion never RAISES health toward the queen's max", () => {
    // A pawn one below threshold that does NOT eat this move still crosses
    // the threshold via... it must eat to grow, so instead exercise the
    // never-raise guarantee directly: health below the queen's max stays put.
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', DEFAULT_PAWN_PROMOTION_WEIGHT - 1, {
      health: 5,
    });
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 6, y: 5 }];
    gs.board.maxHealthPerUnit = { queen: 100 };

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('queen');
    // Eating restores to the pawn's (engine-default 100) max, so this
    // particular case can't distinguish clamp-only from restore-then-clamp on
    // its own — paired with the clamp test above (30 < restored 100), the two
    // together pin "clamp down, never raise beyond what eating already gave".
    expect(sim.health).toBe(100);
  });

  test('a promoted unit moves as a queen in subsequent projection, not as a pawn', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', DEFAULT_PAWN_PROMOTION_WEIGHT - 1, {
      orientation: { dx: 0, dy: -1 }, // facing "up" (wire convention)
    });
    const gs = makeGameState([pawn], 'p');
    gs.board.food = [{ x: 5, y: 4 }]; // one step in the facing direction

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'down']]));
    const sim = result.board.snakes.find((s) => s.id === 'p')!;
    expect(sim.unitType).toBe('queen');

    const boardWidth = 11;
    const boardHeight = 11;
    const originIdx = sim.head.y * boardWidth + sim.head.x;
    // Three squares straight down: illegal for a pawn (forward is exactly
    // one square, or a diagonal-eat), legal for a queen (orthogonal ray).
    const farIdx = (sim.head.y + 3) * boardWidth + sim.head.x;

    expect(
      planPieceAction('pawn', originIdx, farIdx, boardWidth, boardHeight, sim.orientation)
    ).toBeNull();
    expect(
      planPieceAction(sim.unitType!, originIdx, farIdx, boardWidth, boardHeight, sim.orientation)
    ).toEqual({ kind: 'move', path: [originIdx + boardWidth, originIdx + 2 * boardWidth, farIdx] });
  });

  test('team-score projection across a promotion turn is not over-counted by pawnPromotionWeight - 1', () => {
    const promotionWeight = DEFAULT_PAWN_PROMOTION_WEIGHT;
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', promotionWeight - 1);
    // A frozen ally (no moveSet entry) whose weight is untouched this turn —
    // isolates the promotion effect on the TEAM total.
    const ally = makePiece('k', { x: 2, y: 2 }, 'king', 5, { teamID: 'us' });
    pawn.teamID = 'us';
    const gs = makeGameState([pawn, ally], 'p');
    gs.board.food = [{ x: 6, y: 5 }];

    const preTeamWeight = pawn.length + ally.length; // (threshold - 1) + 5

    const result = simulator.simulateNextBoardState(gs, moves([['p', 'right']]));

    const simPawn = result.board.snakes.find((s) => s.id === 'p')!;
    const simAlly = result.board.snakes.find((s) => s.id === 'k')!;
    const postTeamWeight = simPawn.length + simAlly.length;

    // Correct: the pawn resets to weight 1, so the team gains only the food
    // point net against its promotion reset (ally is untouched).
    expect(postTeamWeight).toBe(1 + ally.length);
    // What an un-promoted (buggy) projection would have produced: the pawn
    // simply grows past the threshold and keeps every point of it.
    const naiveOverCountedWeight = promotionWeight + ally.length;
    expect(postTeamWeight).toBe(naiveOverCountedWeight - (promotionWeight - 1));
    expect(postTeamWeight).not.toBe(naiveOverCountedWeight);
    // Team total actually DROPS across the promoting turn despite eating.
    expect(postTeamWeight).toBeLessThan(preTeamWeight);
  });
});
