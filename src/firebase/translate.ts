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

import { Timestamp } from 'firebase/firestore';
import { BoardSnapshot, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { TTGameSetup, TTGameStateDoc, TTTurn } from './tactictoes-types';

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

/**
 * The ONE place that interprets a TTGameStateDoc turn. Every consumer of a
 * turn document's raw fields (deadline, winners gating, alive set, per-snake
 * piece/head indices, board dimensions) goes through this view instead of
 * re-reading the doc inline — the Firebase interface used to parse endTime
 * alone in three places, with two different fallbacks.
 */
export interface ParsedTurn {
  /** The raw turn document (for buildBoardState and field-level access). */
  turn: TTTurn;
  turnNumber: number;
  /** FULL-board dimensions from the setup (include the 1-cell perimeter). */
  boardWidth: number;
  boardHeight: number;
  /** winners.length > 0 — the game is over as of this turn. */
  isFinal: boolean;
  /** Whether `id` is alive at this turn's start. */
  alive(id: string): boolean;
  /** Full-board piece indices (head first) for `id`, or undefined. */
  pieces(id: string): number[] | undefined;
  /** Full-board head index for `id`, or undefined when absent/empty. */
  headIndex(id: string): number | undefined;
  /**
   * The turn's resolution deadline in epoch ms. The server always stamps
   * endTime; `fallbackMs` is what a caller banks on when it is missing or
   * malformed. Call sites deliberately differ — 0 ("no deadline known") for
   * the listener watchdog vs Date.now() + 10s ("assume a near deadline") for
   * turn processing — so the fallback is an explicit parameter, never a
   * silently unified default.
   */
  endTimeMs(fallbackMs: number): number;
}

/** Parsed view over doc.turns[turnNumber], or null when that turn is absent. */
export function parseTurn(doc: TTGameStateDoc, turnNumber: number): ParsedTurn | null {
  const turn = doc.turns?.[turnNumber];
  if (!turn) return null;
  return {
    turn,
    turnNumber,
    boardWidth: doc.setup.boardWidth,
    boardHeight: doc.setup.boardHeight,
    isFinal: turn.winners.length > 0,
    alive: (id) => turn.alivePlayers.includes(id),
    pieces: (id) => turn.playerPieces?.[id],
    headIndex: (id) => turn.playerPieces?.[id]?.[0],
    endTimeMs: (fallbackMs) =>
      turn.endTime instanceof Timestamp ? turn.endTime.toMillis() : fallbackMs,
  };
}

/** Parsed view over the doc's latest turn, or null when it has no turns. */
export function parseLatestTurn(doc: TTGameStateDoc): ParsedTurn | null {
  return parseTurn(doc, (doc.turns?.length ?? 0) - 1);
}


/**
 * The last absolute game turn on which a player's CURRENT aggregate
 * invulnerability level still governs a collision — i.e. how long the level
 * we can see is safe to bank on when looking ahead.
 *
 * The level is the sum of independently-expiring effects, so the aggregate
 * holds only until the EARLIEST of them expires. The server expires effects at
 * the end of turn processing, after collisions are resolved, so an effect with
 * `expiryTurn = E` still decides a collision resolved during turn E itself —
 * which is exactly the `currentTurn + arrivalTurn` figure BoardGraph tests
 * against, so the minimum expiry maps across directly with no offset.
 *
 * Returns null when the turn carries no effects schedule at all (pre-
 * activeEffects game documents), leaving BoardGraph on its conservative
 * "applies to this turn only" default rather than inventing a horizon.
 */
function invulnerabilityExpiryTurn(turn: TTTurn, playerID: string): number | null {
  if (!turn.activeEffects) return null;
  let earliest: number | null = null;
  for (const effect of turn.activeEffects) {
    if (effect.playerID !== playerID) continue;
    if (earliest === null || effect.expiryTurn < earliest) earliest = effect.expiryTurn;
  }
  // No effects on this player: their level is 0 and stays 0, so nothing can
  // expire — the (zero) level applies indefinitely.
  return earliest ?? Number.MAX_SAFE_INTEGER;
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
  const team = gamePlayer && setup.teams.find((t) => t.id === gamePlayer.teamID);

  const snake: Snake = {
    id: playerID,
    name: team && gamePlayer ? `${team.name} ${gamePlayer.letter}` : playerID,
    latency: '0',
    health: turn.playerHealth[playerID] ?? 0,
    body,
    head: body.length > 0 ? { ...body[0] } : { x: 0, y: 0 },
    length: body.length,
    shout: '',
    squad: gamePlayer?.teamID ?? '',
    customizations: {
      color: team?.color ?? '',
      head: 'default',
      tail: 'default',
    },
    invulnerabilityLevel: turn.playerInvulnerabilityLevel?.[playerID] ?? 0,
  };
  if (gamePlayer) snake.letter = gamePlayer.letter;
  const expiry = invulnerabilityExpiryTurn(turn, playerID);
  if (expiry !== null) snake.invulnerabilityExpiryTurn = expiry;
  if (gamePlayer?.teamID) snake.teamID = gamePlayer.teamID;
  return snake;
}

/**
 * Builds the CANONICAL, you-less board state for a turn — the single shared
 * truth the whole server operates on. One Firestore turn document maps to
 * exactly one of these; per-snake views are derived from it with `withYou`
 * only at the decision-engine boundary.
 */
export function buildBoardState(
  gameID: string,
  setup: TTGameSetup,
  turn: TTTurn,
  turnNumber: number,
  turnExpiryTime: number | null
): BoardSnapshot {
  const w = setup.boardWidth;
  const h = setup.boardHeight;

  const game: GameState['game'] = {
    id: gameID,
    ruleset: {
      name: 'teamsnek',
      version: 'v1',
      // Mirrors the TacticToes setup verbatim — nothing in the decision logic
      // reads these; they exist for logs and dashboards only.
      settings: {
        foodSpawnRate: setup.foodSpawnRate ?? 0.5,
        invulnerabilityPotionSpawnRate: setup.invulnerabilityPotionEnabled
          ? setup.invulnerabilityPotionSpawnRate ?? 0.15
          : 0,
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
  };
}

/**
 * Per-snake GameState view over a canonical board state. The `you` object is a
 * DEEP COPY of the matching board snake (own head/body arrays), preserving the
 * historical guarantee that mutating a view's `you` never bleeds into the
 * shared board — buildGameState always built `you` via a second buildSnake
 * call, and downstream code may rely on that isolation.
 * Returns null when the snake is not on the board (e.g. it died).
 */
export function withYou(canonical: BoardSnapshot, snakeId: string): GameState | null {
  const snake = canonical.board.snakes.find((s) => s.id === snakeId);
  if (!snake) return null;
  return {
    ...canonical,
    you: {
      ...snake,
      head: { ...snake.head },
      body: snake.body.map((c) => ({ ...c })),
    },
  };
}

/**
 * Builds the per-snake GameState view for one controlled snake, matching the
 * payload TacticToes sends over the Battlesnake HTTP interface. Thin wrapper
 * over buildBoardState + a per-snake `you`; kept for callers/tests that want
 * the one-shot shape. `you` is built even for snakes absent from the board
 * (buildSnake returns an empty-bodied snake), matching historical behavior.
 */
export function buildGameState(
  gameID: string,
  setup: TTGameSetup,
  turn: TTTurn,
  turnNumber: number,
  youID: string,
  turnExpiryTime: number | null
): GameState {
  return {
    ...buildBoardState(gameID, setup, turn, turnNumber, turnExpiryTime),
    you: buildSnake(setup, turn, youID),
  };
}

/** The in-game snake ids a centaur identity controls: its whole team. */
export function controlledSnakeIDs(setup: TTGameSetup, centaurId: string): string[] {
  return setup.gamePlayers
    .filter((gp) => gp.teamID === centaurId)
    .map((gp) => gp.id);
}

/**
 * A snake's display identity straight from the SETUP, so it resolves even for
 * a snake that is no longer on the board (dead snakes are absent from
 * playerPieces). Same naming rule buildSnake applies.
 */
export function snakeIdentity(setup: TTGameSetup, snakeId: string): { name: string; letter: string } {
  const gamePlayer = setup.gamePlayers.find((gp) => gp.id === snakeId);
  const team = gamePlayer && setup.teams.find((t) => t.id === gamePlayer.teamID);
  return {
    name: team && gamePlayer ? `${team.name} ${gamePlayer.letter}` : snakeId,
    letter: gamePlayer?.letter ?? '',
  };
}
