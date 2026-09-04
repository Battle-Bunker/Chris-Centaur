/**
 * One test board harness — the fixture factories that were sixteen, seven,
 * six, three and two copies across `src/tests/**` (see
 * `docs/design/SIMPLIFY-PLAN-2.md` item 1). Every copy was the same shape
 * with the same `Partial<…>` override seam; this file is that seam hoisted
 * into one signature each.
 */

import { TurnData } from '../server/active-game-manager';
import { GameState, Snake, Coord, CentaurMove } from '../types/battlesnake';
import type { LensFrame } from '../lens/types';

/** The body-list form: caller states the full body. */
export function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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

/**
 * The head-and-length form: body extends straight DOWN from the head, so
 * `body[1]` (the neck) is at `(head.x, head.y - 1)` and 'down' is always a
 * 180° reversal / certain death — the shape the manager suites drive.
 */
export function makeSnakeAt(id: string, head: Coord, length = 3, extra: Partial<Snake> = {}): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  return {
    orientation: { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    ...extra,
  } as Snake;
}

export function makeGameState(
  gameId: string,
  turn: number,
  snakes: Snake[],
  youId: string,
  over: Partial<GameState> = {}
): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
    ...over,
  };
}

export function makeTurnData(
  gs: GameState,
  botMove: CentaurMove | null,
  over: Partial<TurnData> = {}
): TurnData {
  return {
    gameState: gs,
    moveEvaluations: [],
    territoryCells: {},
    botRecommendation: botMove,
    timestamp: Date.now(),
    ...over,
  };
}

// --------------------------------------------------------------- canvas mock

export type Op = { op: string; args: unknown[] };

export function recordingContext(ops: Op[]): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  return new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        ops.push({ op: prop, args });
        return undefined;
      };
    },
    set(target, prop: string, value) {
      ops.push({ op: `set:${prop}`, args: [value] });
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

// ------------------------------------------------------------- lens frames

/** Strips the fields the replay/live comparison deliberately does not pin. */
export function comparableFrame(frame: LensFrame): unknown {
  const at: Record<string, unknown> = { ...frame.at };
  delete at.mode;
  delete at.isHead;
  const provenance: Record<string, unknown> = { ...frame.provenance };
  delete provenance.kind;
  return { ...frame, at, provenance };
}
