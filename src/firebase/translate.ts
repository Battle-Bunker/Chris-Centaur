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
import { BoardSnapshot, Clash, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { TTClash, TTGameSetup, TTGameStateDoc, TTTurn, TTUnitType } from './tactictoes-types';

export function toApiCoord(index: number, boardWidth: number, boardHeight: number): Coord {
  const x = index % boardWidth;
  const y = Math.floor(index / boardWidth);
  return { x: x - 1, y: boardHeight - y - 2 };
}

/** Inverse of toApiCoord: api coord → FULL-board index (perimeter included). */
export function apiCoordToIndex(coord: Coord, boardWidth: number, boardHeight: number): number {
  const x = coord.x + 1;
  const y = boardHeight - coord.y - 2;
  return y * boardWidth + x;
}

/**
 * A player's CURRENT unit type: the turn's live map (promotion changes it
 * mid-game) first, then the setup's initial type, then "snake".
 */
export function unitTypeFor(setup: TTGameSetup, turn: TTTurn, playerID: string): TTUnitType {
  const fromTurn = turn.unitTypes?.[playerID];
  if (fromTurn) return fromTurn;
  return setup.gamePlayers.find((gp) => gp.id === playerID)?.unitType ?? 'snake';
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
 * when its turn resolves: step along its orientation (turn.orientation —
 * present for every living unit; a snake's orientation is always one of the four
 * orthogonals). Wire y grows downward, so wire dy -1 is api 'up'.
 */
export function continuationDirection(turn: TTTurn, playerID: string): Direction {
  const f = turn.orientation[playerID];
  if (f.dx === 1) return 'right';
  if (f.dx === -1) return 'left';
  return f.dy === -1 ? 'up' : 'down';
}

function mapIndices(indices: number[] | undefined, w: number, h: number): Coord[] {
  return (indices || []).map((i) => toApiCoord(i, w, h));
}

/**
 * Wire clashes → renderer clashes: the full-board index becomes an api cell,
 * everything else rides verbatim. Deliberately lossless — `kind`, `victimIDs`
 * and `survivorID` are what a renderer branches on, the sub-step dates the
 * event inside its turn, and `reason` is carried only so the UI can quote the
 * server's own wording.
 *
 * `subStep` is required on the wire (1 for whole-move units), but a
 * historic/hand-written document can still be missing it; it defaults to 1
 * rather than reappearing as `undefined`, so every record a renderer sees is
 * dated.
 */
function mapClashes(clashes: TTClash[], w: number, h: number): Clash[] {
  return clashes.map((c) => {
    const mapped: Clash = {
      cell: toApiCoord(c.index, w, h),
      subStep: c.subStep ?? 1,
      kind: c.kind,
      playerIDs: [...c.playerIDs],
      victimIDs: [...(c.victimIDs ?? [])],
      reason: c.reason,
    };
    if (c.survivorID !== undefined) mapped.survivorID = c.survivorID;
    return mapped;
  });
}

/**
 * The ONE place that interprets a TTGameStateDoc turn. Every consumer of a
 * turn document's raw fields (deadline, winners gating, alive set, per-snake
 * piece/head indices, board dimensions) goes through this view instead of
 * re-reading the doc inline, so each field has exactly one parse and one
 * fallback rule.
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
   * Full-board square the server's applied move for `id` resolved to, from
   * the turn's authoritative `moves` map. For a unit that died this turn this
   * is the square it actually died on (a piece stopped in flight records its
   * mid-path death square; a snake its attempted head square). Undefined only
   * when the wire carries no entry for `id` at all.
   */
  appliedMoveIndex(id: string): number | undefined;
  /**
   * Full-board squares the piece `id` actually traversed this turn, ending at
   * its stop square — for a dead piece, the square it died on. Undefined for
   * snakes and for pieces that did not move.
   */
  piecePath(id: string): number[] | undefined;
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
    appliedMoveIndex: (id) => turn.moves?.[id],
    piecePath: (id) => turn.paths?.[id],
    endTimeMs: (fallbackMs) =>
      turn.endTime instanceof Timestamp ? turn.endTime.toMillis() : fallbackMs,
  };
}

/** Parsed view over the doc's latest turn, or null when it has no turns. */
export function parseLatestTurn(doc: TTGameStateDoc): ParsedTurn | null {
  return parseTurn(doc, (doc.turns?.length ?? 0) - 1);
}

/**
 * Death cells for the transition into `curr`, read STRAIGHT OFF the turn's
 * authoritative death registry (`Turn.deaths`) — every unit removed that turn,
 * snakes and pieces, killed and fatally exhausted alike, at the api-coordinate cell the
 * server says it died on.
 *
 * The registry is the primary source, not a supplement, and nothing here
 * derives a death from the board or from a move direction any more. Two
 * reasons that matters under the current engine:
 *  - an EXHAUSTED unit halts wherever its health ran out — mid-ray for a
 *    slider, on its own square for a unit that never moved — and no move or
 *    direction on the wire says where that was. (Exhaustion is only
 *    provisionally fatal: one that halted on food recovers and is simply
 *    absent from the registry, which is another thing no derivation could
 *    have worked out.)
 *  - an EDGE-CONTEST loser never crosses, so it dies on the square it started
 *    from without moving at all; a direction-derived cell would put its marker
 *    one square away, on a cell it never reached.
 * `Turn.moves` still carries the same cell for anything that died (the
 * death-square guarantee), but it is the living unit's channel — this is the
 * dead one's.
 */
export function deriveDeathCells(curr: ParsedTurn): Record<string, Coord> {
  const result: Record<string, Coord> = {};
  const deaths = curr.turn.deaths ?? {};
  for (const [unitId, death] of Object.entries(deaths)) {
    if (!death || typeof death.cell !== 'number') continue;
    result[unitId] = toApiCoord(death.cell, curr.boardWidth, curr.boardHeight);
  }
  return result;
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
 * Returns null when there is no effects schedule at all (pre-activeEffects
 * game documents, hand-built fixtures), leaving BoardGraph on its conservative
 * "applies to this turn only" default rather than inventing a horizon.
 *
 * THIS IS NOT A GAME RULE and the engine has no equivalent: settlement keeps
 * effects individually and never collapses them. "How long is the aggregate
 * safe to bank on" is a question only a forward-looking client asks, so it is
 * answered here, once, over ANY schedule — the wire's `Turn.activeEffects` for
 * an observed turn, and `Settlement.effects` for a simulated one. Both callers
 * read a real schedule; neither synthesises one.
 */
export function aggregateExpiryTurn(
  effects: ReadonlyArray<{ readonly playerID: string; readonly expiryTurn: number }> | undefined,
  playerID: string
): number | null {
  if (!effects) return null;
  let earliest: number | null = null;
  for (const effect of effects) {
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
  const rawPieces = turn.playerPieces[playerID] || [];
  const gamePlayer = setup.gamePlayers.find((gp) => gp.id === playerID);
  const team = gamePlayer && setup.teams.find((t) => t.id === gamePlayer.teamID);
  const unitType = unitTypeFor(setup, turn, playerID);

  // Chess pieces arrive as a weight-stack — N copies of ONE square. Collapse
  // the stack to a single body cell (the engine treats a length-1 body as a
  // segment-free unit), but keep `length` = N: length is the piece's WEIGHT,
  // which is exactly what head-to-head adjudication compares, so H2H risk
  // against pieces stays weight-correct. Snakes are untouched.
  const isPiece = unitType !== 'snake';
  const body = isPiece
    ? rawPieces.slice(0, 1).map((i) => toApiCoord(i, w, h))
    : rawPieces.map((i) => toApiCoord(i, w, h));
  const length = isPiece ? rawPieces.length : body.length;

  const snake: Snake = {
    id: playerID,
    name: team && gamePlayer ? `${team.name} ${gamePlayer.letter}` : playerID,
    latency: '0',
    health: turn.playerHealth[playerID] ?? 0,
    body,
    head: body.length > 0 ? { ...body[0] } : { x: 0, y: 0 },
    length,
    shout: '',
    squad: gamePlayer?.teamID ?? '',
    customizations: {
      color: team?.color ?? '',
      head: 'default',
      tail: 'default',
    },
    invulnerabilityLevel: turn.playerInvulnerabilityLevel?.[playerID] ?? 0,
    // Orientation rides along verbatim for EVERY unit (wire convention, y down —
    // see the Snake type for the api/canvas mapping): the UI anchors icon
    // orientation and keyNav movement behaviour on this wire orientation.
    orientation: { ...turn.orientation[playerID] },
  };
  if (gamePlayer) snake.letter = gamePlayer.letter;
  snake.unitType = unitType;
  // Per-type max health from the setup config, resolved against the unit's
  // CURRENT type (promotion moves a pawn onto the queen's max). Engine
  // default is 100 when the map or key is absent.
  snake.maxHealth = setup.maxHealthPerUnit?.[unitType] ?? 100;
  const expiry = aggregateExpiryTurn(turn.activeEffects, playerID);
  if (expiry !== null) snake.invulnerabilityExpiryTurn = expiry;
  if (gamePlayer?.teamID) snake.teamID = gamePlayer.teamID;
  // The team's human name (the controlling centaur's, snapshotted into the
  // setup) rides on every unit so the UI never has to show the opaque team id.
  if (team?.name) snake.teamName = team.name;
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
  // Setup-derived hazard damage rides on the board so the simulator (and any
  // fatality reasoning) sees the configured value; readers default an absent
  // field to the engine's 100.
  if (setup.hazardDamage !== undefined) board.hazardDamage = setup.hazardDamage;
  // Setup-derived promotion threshold and per-type max health ride on the
  // board so the simulator can mirror the engine's pawn-promotion reset
  // (weight -> 1, health clamped to the queen's configured max) in
  // lookahead; readers default an absent field to the engine's values.
  if (setup.pawnPromotionWeight !== undefined) board.pawnPromotionWeight = setup.pawnPromotionWeight;
  if (setup.maxHealthPerUnit !== undefined) board.maxHealthPerUnit = setup.maxHealthPerUnit;
  // Collisions resolved into this board, mapped into api coords like every
  // other positional field. They ride on the board (not on a per-snake view)
  // because a clash is a fact about the board, readable by any spectator.
  if (turn.clashes?.length) board.clashes = mapClashes(turn.clashes, w, h);
  // Non-fatal sever damage, mapped like every other positional field. A fact
  // about the board (which snakes got shortened, and where the cut segments
  // used to be), so it rides beside the clashes rather than on a snake view.
  if (turn.severedCells && Object.keys(turn.severedCells).length > 0) {
    const severed: Record<string, Coord[]> = {};
    for (const [unitId, cells] of Object.entries(turn.severedCells)) {
      severed[unitId] = mapIndices(cells, w, h);
    }
    board.severedCells = severed;
  }
  if (turn.fertileTiles) board.fertileTiles = mapIndices(turn.fertileTiles, w, h);
  if (turn.invulnerabilityPotions?.length) {
    board.invulnerabilityPotions = mapIndices(turn.invulnerabilityPotions, w, h);
  }
  // The effect schedule and the two potion settings ride on the board so the
  // forward step can call `settleTurn` with the same inputs the server does,
  // and so the window length is an input on this side too rather than the
  // `+3` the processor used to hardcode. The schedule is coordinate-free, so
  // it crosses verbatim.
  if (turn.activeEffects) board.activeEffects = turn.activeEffects.map((e) => ({ ...e }));
  board.invulnerabilityPotionsEnabled = setup.invulnerabilityPotionEnabled === true;
  if (setup.invulnerabilityPotionWindowTurns !== undefined) {
    board.invulnerabilityPotionWindowTurns = setup.invulnerabilityPotionWindowTurns;
  }
  // The turn limit rides through untouched: absent stays absent (the engine's
  // default), null stays null (unlimited). resolveMaxTurns reads it at settle.
  if (setup.maxTurns !== undefined) {
    board.maxTurns = setup.maxTurns;
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
