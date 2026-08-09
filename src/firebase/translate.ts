// Translates TacticToes Firestore turn documents into the Battlesnake-shaped
// GameState the decision engine consumes.
//
// TacticToes stores the board as flat indices over the FULL board (which
// includes a 1-cell perimeter wall) with y increasing downward. The
// Battlesnake API view — which the whole engine is written against — strips
// the perimeter and flips the y axis. This module reproduces exactly the
// mapping TacticToes' own HTTP notifier (functions/src/utils/notifyBots.ts)
// applies, so the engine sees identical boards on either transport:
//
//   api.x = full.x - 1
//   api.y = fullHeight - full.y - 2
//
// Move submission goes the other way: the engine's Direction is relative to
// api coords (up = api.y + 1), which in full-board coords is y - 1. The
// returned move is the FULL-board index of the target cell, matching what
// the server expects in privateMoves.move.

import { Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { TTGameSetup, TTTurn } from './tactictoes-types';

export function toApiCoord(index: number, boardWidth: number, boardHeight: number): Coord {
  const x = index % boardWidth;
  const y = Math.floor(index / boardWidth);
  return { x: x - 1, y: boardHeight - y - 2 };
}

/** Full-board index of the cell one step in `direction` from the head, clamped like the server. */
export function directionToMoveIndex(
  direction: Direction,
  headIndex: number,
  boardWidth: number,
  boardHeight: number
): number {
  const x = headIndex % boardWidth;
  const y = Math.floor(headIndex / boardWidth);

  // Engine directions are api-coord relative; api "up" is full-board y - 1.
  switch (direction) {
    case 'up':
      return y > 0 ? (y - 1) * boardWidth + x : headIndex;
    case 'down':
      return y < boardHeight - 1 ? (y + 1) * boardWidth + x : headIndex;
    case 'left':
      return x > 0 ? y * boardWidth + (x - 1) : headIndex;
    case 'right':
      return x < boardWidth - 1 ? y * boardWidth + (x + 1) : headIndex;
    default:
      return headIndex;
  }
}

/**
 * The engine-facing Direction that takes a snake from one FULL-board index to
 * an adjacent one, or null when the cells aren't orthogonally adjacent.
 * Full-board y grows downward, so a full-board step of y-1 is api 'up'.
 */
export function moveIndexToDirection(
  fromIndex: number,
  toIndex: number,
  boardWidth: number
): Direction | null {
  const fromX = fromIndex % boardWidth;
  const fromY = Math.floor(fromIndex / boardWidth);
  const toX = toIndex % boardWidth;
  const toY = Math.floor(toIndex / boardWidth);
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 1 && dy === 0) return 'right';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 0 && dy === -1) return 'up';
  if (dx === 0 && dy === 1) return 'down';
  return null;
}

/**
 * The TacticToes engine's default move for a snake that has nothing staged
 * when its turn resolves: continue the previous move, i.e. step in the
 * head−neck direction. Returns null when the snake has no direction yet
 * (single cell or stacked spawn) — the engine then falls back to its
 * adjacent-cell pick, which we don't reproduce.
 */
export function continuationDirection(
  pieces: number[] | undefined,
  boardWidth: number
): Direction | null {
  if (!pieces || pieces.length < 2) return null;
  const head = pieces[0];
  const neck = pieces[1];
  if (head === neck) return null;
  return moveIndexToDirection(neck, head, boardWidth);
}

function mapIndices(indices: number[] | undefined, w: number, h: number): Coord[] {
  return (indices || []).map((i) => toApiCoord(i, w, h));
}

function snakeColor(setup: TTGameSetup, playerID: string): string {
  const gamePlayer = setup.gamePlayers.find((gp) => gp.id === playerID);
  if (
    (setup.gameType === 'teamsnek' || setup.gameType === 'kingsnek') &&
    setup.teams &&
    gamePlayer?.teamID
  ) {
    const team = setup.teams.find((t) => t.id === gamePlayer.teamID);
    if (team) return team.color;
  }
  // Individual mode: leave color empty so team detection falls through to
  // per-snake ids (TeamDetector groups by squad || color || id).
  return '';
}

function buildSnake(
  setup: TTGameSetup,
  turn: TTTurn,
  playerID: string
): Snake {
  const w = setup.boardWidth;
  const h = setup.boardHeight;
  const body = (turn.playerPieces[playerID] || []).map((i) => toApiCoord(i, w, h));
  const gamePlayer = setup.gamePlayers.find((gp) => gp.id === playerID);

  const snake: Snake = {
    id: playerID,
    name: gamePlayer?.displayName ?? playerID,
    latency: '0',
    health: turn.playerHealth[playerID] ?? 0,
    body,
    head: body.length > 0 ? { ...body[0] } : { x: 0, y: 0 },
    length: body.length,
    shout: '',
    squad: gamePlayer?.teamID ?? '',
    customizations: {
      color: snakeColor(setup, playerID),
      head: 'default',
      tail: 'default',
    },
    invulnerabilityLevel: turn.playerInvulnerabilityLevel?.[playerID] ?? 0,
  };
  if (gamePlayer?.teamID) snake.teamID = gamePlayer.teamID;
  return snake;
}

/**
 * Builds the per-snake GameState view for one controlled snake, matching the
 * payload TacticToes sends over the Battlesnake HTTP interface.
 */
export function buildGameState(
  gameID: string,
  setup: TTGameSetup,
  turn: TTTurn,
  turnNumber: number,
  youID: string,
  turnExpiryTime: number | null
): GameState {
  const w = setup.boardWidth;
  const h = setup.boardHeight;
  const foodSpawnRate = setup.foodSpawnRate ?? 0.5;

  const game: GameState['game'] = {
    id: gameID,
    ruleset: {
      name: setup.gameType,
      version: 'v1',
      settings: {
        foodSpawnChance: (foodSpawnRate / 5) * 100,
        foodSpawnRate,
        invulnerabilityPotionSpawnRate: setup.invulnerabilityPotionSpawnRate ?? 0.15,
        minimumFood: 0,
        hazardDamagePerTurn: 100,
      },
    },
    map: 'standard',
    timeout: setup.maxTurnTime * 1000,
    source: 'tactictoes-firebase',
  };
  if (turnExpiryTime !== null) {
    (game as any).turnExpiryTime = turnExpiryTime;
  }

  const board: GameState['board'] = {
    height: h - 2,
    width: w - 2,
    food: mapIndices(turn.food, w, h),
    hazards: mapIndices(turn.hazards, w, h),
    snakes: Object.keys(turn.playerPieces).map((pid) => buildSnake(setup, turn, pid)),
  };
  if (turn.fertileTiles) board.fertileTiles = mapIndices(turn.fertileTiles, w, h);
  if (turn.invulnerabilityPotions?.length) {
    board.invulnerabilityPotions = mapIndices(turn.invulnerabilityPotions, w, h);
  }

  return {
    game,
    turn: turnNumber,
    board,
    you: buildSnake(setup, turn, youID),
  };
}

/** The in-game snake ids (originals and clones) a bot identity controls. */
export function controlledSnakeIDs(setup: TTGameSetup, botId: string): string[] {
  return setup.gamePlayers
    .filter((gp) => gp.type === 'bot' && (gp.botRef ?? gp.id) === botId)
    .map((gp) => gp.id);
}
