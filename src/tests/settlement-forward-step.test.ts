/**
 * THE FORWARD STEP SETTLES — tier, effects and potions are outputs now.
 *
 * The bot's simulated turn used to run `resolveTurn` and carry every unit's
 * invulnerability state across untouched. That froze the tier window at its
 * observed value in three separate ways:
 *
 *   1. an effect due to lapse at the arrival turn still governed the turn
 *      after it, so a three-turn buff was priced as a permanent one;
 *   2. a potion the simulated move landed on cost the collector nothing and
 *      bought its allies nothing, so "arm, collect, spend" was three turns
 *      that all looked the same;
 *   3. the potion stayed on the simulated board forever, so a second unit
 *      could be shown collecting a potion that no longer existed.
 *
 * All three are `settleTurn` outputs and none of them is computed on this side
 * any more. These tests pin the outputs, not the arithmetic: if the engine's
 * window length or pickup polarity changes upstream, they follow it.
 */

import { Simulator, MoveSet } from '../logic/simulator';
import { DEFAULT_POTION_WINDOW_TURNS, marshalBoard, resolvePartialTurn } from '../logic/turn-oracle';
import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import type { ActiveEffect } from '@shared/types/Game';

const TURN = 10;
const ARRIVAL = TURN + 1;

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

const board = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({
    width: 11,
    height: 11,
    food: [],
    hazards: [],
    snakes,
    invulnerabilityPotionsEnabled: true,
    activeEffects: [],
    ...extra,
  } as Board);

const gameState = (b: Board, youId: string): GameState =>
  ({
    game: {
      id: 'settle',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test',
    },
    turn: TURN,
    board: b,
    you: b.snakes.find((s) => s.id === youId)!,
  } as GameState);

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

const snakeOf = (b: Board, id: string): Snake => b.snakes.find((s) => s.id === id) as Snake;

describe('a simulated turn advances the tier window', () => {
  test('an effect due to lapse at the arrival turn is gone from the next board', () => {
    const buffed = makeSnake('buffed', [{ x: 5, y: 5 }, { x: 5, y: 6 }], {
      squad: 'A',
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: ARRIVAL,
    });
    const effects: ActiveEffect[] = [
      {
        playerID: 'buffed',
        type: 'invulnerability_buff',
        level: 1,
        expiryTurn: ARRIVAL,
        sourcePlayerID: 'other',
      },
    ];
    const b = board([buffed], { activeEffects: effects });
    const next = new Simulator().simulateNextBoardState(
      gameState(b, 'buffed'),
      moves([['buffed', 'right']])
    );

    // The buff decided every contest resolved during the arrival turn, and
    // only then gave its level back. The NEXT turn opens at tier 0.
    expect(snakeOf(next.board, 'buffed').invulnerabilityLevel).toBe(0);
    expect(next.board.activeEffects).toEqual([]);
  });

  test('an effect that outlives the arrival turn survives it', () => {
    const buffed = makeSnake('buffed', [{ x: 5, y: 5 }, { x: 5, y: 6 }], {
      squad: 'A',
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: ARRIVAL + 2,
    });
    const b = board([buffed], {
      activeEffects: [
        {
          playerID: 'buffed',
          type: 'invulnerability_buff',
          level: 1,
          expiryTurn: ARRIVAL + 2,
          sourcePlayerID: 'other',
        },
      ],
    });
    const next = new Simulator().simulateNextBoardState(
      gameState(b, 'buffed'),
      moves([['buffed', 'right']])
    );

    expect(snakeOf(next.board, 'buffed').invulnerabilityLevel).toBe(1);
    expect(snakeOf(next.board, 'buffed').invulnerabilityExpiryTurn).toBe(ARRIVAL + 2);
  });

  test('a potion collected on the simulated move charges the collector and pays its ally', () => {
    const collector = makeSnake('collector', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { squad: 'A' });
    const ally = makeSnake('ally', [{ x: 1, y: 1 }, { x: 1, y: 2 }], { squad: 'A' });
    const enemy = makeSnake('enemy', [{ x: 9, y: 9 }, { x: 9, y: 8 }], { squad: 'B' });
    const b = board([collector, ally, enemy], {
      invulnerabilityPotions: [{ x: 6, y: 5 }],
    });

    const next = new Simulator().simulateNextBoardState(
      gameState(b, 'collector'),
      moves([['collector', 'right']])
    );

    // The pickup rule is INVERTED and settlement writes BOTH halves.
    expect(snakeOf(next.board, 'collector').invulnerabilityLevel).toBe(-1);
    expect(snakeOf(next.board, 'ally').invulnerabilityLevel).toBe(1);
    expect(snakeOf(next.board, 'enemy').invulnerabilityLevel).toBe(0);
    // ...and the potion is off the board, so nobody collects it twice.
    expect(next.board.invulnerabilityPotions).toEqual([]);
    // The window is an input on this side now, not a hardcoded `+3`.
    for (const id of ['collector', 'ally']) {
      expect(snakeOf(next.board, id).invulnerabilityExpiryTurn).toBe(
        ARRIVAL + DEFAULT_POTION_WINDOW_TURNS
      );
    }
  });

  test('the setup’s window length is what the pickup schedules', () => {
    const collector = makeSnake('collector', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { squad: 'A' });
    const b = board([collector], {
      invulnerabilityPotions: [{ x: 6, y: 5 }],
      invulnerabilityPotionWindowTurns: 8,
    });
    const next = new Simulator().simulateNextBoardState(
      gameState(b, 'collector'),
      moves([['collector', 'right']])
    );
    expect(snakeOf(next.board, 'collector').invulnerabilityExpiryTurn).toBe(ARRIVAL + 8);
  });

  test('potions off makes the cell inert scenery', () => {
    const collector = makeSnake('collector', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { squad: 'A' });
    const b = board([collector], {
      invulnerabilityPotions: [{ x: 6, y: 5 }],
      invulnerabilityPotionsEnabled: false,
    });
    const next = new Simulator().simulateNextBoardState(
      gameState(b, 'collector'),
      moves([['collector', 'right']])
    );
    expect(snakeOf(next.board, 'collector').invulnerabilityLevel).toBe(0);
    expect(next.board.invulnerabilityPotions).toEqual([{ x: 6, y: 5 }]);
  });
});

describe('the frozen contract covers potions too', () => {
  test('a FROZEN unit parked on a potion does not collect it', () => {
    // Not a board the rules can produce — collection empties the cell the turn
    // a unit arrives on it — but a fixture can build one, and a frozen unit
    // has not moved, so it cannot have arrived on anything.
    const frozen = makeSnake('frozen', [{ x: 6, y: 5 }, { x: 6, y: 6 }], { squad: 'A' });
    const mover = makeSnake('mover', [{ x: 1, y: 1 }, { x: 1, y: 2 }], { squad: 'A' });
    const b = board([frozen, mover], { invulnerabilityPotions: [{ x: 6, y: 5 }] });

    const m = marshalBoard(b, TURN);
    const settled = resolvePartialTurn(
      m,
      new Map([['mover', { path: [m.toIndex({ x: 2, y: 1 })] }]])
    );

    expect(settled.tiers['frozen']).toBe(0);
    expect(settled.tiers['mover']).toBe(0);
    expect(settled.potions).toEqual([m.toIndex({ x: 6, y: 5 })]);
    expect(settled.effects).toEqual([]);
  });
});
