import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { isPieceUnit, winsStationaryContest } from './piece-threats';

// MoveSet type definition (previously from move-enumerator)
export type MoveSet = Map<string, Direction>;

/**
 * The engine's exact health rule for a unit ENTERING `dest` this turn, shared
 * by the Simulator, MoveAnalyzer's health-aware hazard fatality and the
 * staged-move fatality probe so the three can never drift:
 *  - health loss is MOVEMENT-based (no universal per-turn decay): a snake
 *    that moves pays 1 — unless it eats, which restores health to the unit's
 *    configured type max (snake.maxHealth, engine default 100);
 *  - a hazard square deals board.hazardDamage (default 100) on ENTRY, applied
 *    AFTER the eat/step update, so food on a hazard cell restores to max
 *    first and the damage lands on the restored value.
 * Death is health <= 0 — hazards are damage-based, never instant death.
 * Call with the PRE-move snake and a board whose food has not yet been
 * spliced for this move.
 */
export function healthAfterEntering(snake: Snake, board: Board, dest: Coord): number {
  const eats = (board.food ?? []).some(f => f.x === dest.x && f.y === dest.y);
  let health = eats ? (snake.maxHealth ?? 100) : snake.health - 1;
  if ((board.hazards ?? []).some(h => h.x === dest.x && h.y === dest.y)) {
    health -= board.hazardDamage ?? 100;
  }
  return health;
}

export interface SimulatedBoardState {
  board: Board;
  deadSnakeIds: Set<string>;
}

export class Simulator {
  /**
   * Simulate the next board state given a set of moves for all snakes
   */
  public simulateNextBoardState(
    gameState: GameState,
    moveSet: MoveSet,
    teamSnakeIds?: Set<string>
  ): SimulatedBoardState {
    // Deep copy the board
    const newBoard = this.deepCopyBoard(gameState.board);
    const deadSnakeIds = new Set<string>();

    // Invulnerability projected to the turn the simulated moves resolve on
    // (gameState.turn + 1). A level only governs a collision while the arrival
    // turn is <= its server-provided expiry; absent an expiry the level is
    // assumed to apply this turn only — the same convention as BoardGraph, so
    // the simulator and the passability layer agree on what a move can do.
    const arrivalTurn = gameState.turn + 1;
    const invulnAtArrival = new Map<string, number>();
    for (const snake of newBoard.snakes) {
      const expiry = snake.invulnerabilityExpiryTurn ?? gameState.turn;
      invulnAtArrival.set(snake.id, arrivalTurn <= expiry ? (snake.invulnerabilityLevel ?? 0) : 0);
    }
    const invulnOf = (id: string): number => invulnAtArrival.get(id) ?? 0;

    // Track new head positions for collision detection
    const newHeadPositions = new Map<string, Coord>();
    const headCollisions = new Map<string, string[]>(); // position -> snake ids
    
    // Step 1: Move all snake heads
    for (const snake of newBoard.snakes) {
      if (!this.isAlive(snake)) {
        deadSnakeIds.add(snake.id);
        continue;
      }
      
      const move = moveSet.get(snake.id);
      // No move provided = FROZEN in place. This is also the documented v1
      // chess approximation: pieces (ours and enemies) enter the board as
      // 1-cell "snakes" whose `length` is their weight, are never given a
      // move by the enumerator, and therefore stand still in lookahead. A
      // stationary 1-cell body contributes no wall segments (index 0 is the
      // head), so a piece's square is only contested via the stationary-
      // square rule in step 3 — weight-correct because length = weight.
      if (!move) continue;
      
      const newHead = this.getNewHead(snake.head, move);
      newHeadPositions.set(snake.id, newHead);
      
      // Track potential head-to-head collisions
      const posKey = `${newHead.x},${newHead.y}`;
      if (!headCollisions.has(posKey)) {
        headCollisions.set(posKey, []);
      }
      headCollisions.get(posKey)!.push(snake.id);
    }
    
    // Step 2: Resolve head-to-head collisions
    for (const [, snakeIds] of headCollisions.entries()) {
      if (snakeIds.length > 1) {
        // Multiple snakes moved to same position
        const collidingSnakes = snakeIds.map(id => 
          newBoard.snakes.find(s => s.id === id)!
        );
        
        // Invulnerability decides head-to-head first: a more-invulnerable snake
        // "acts as the bigger snake" and wins regardless of length. Length is only
        // the tiebreaker among snakes sharing the top invulnerability level.
        const maxInvulnerability = Math.max(...collidingSnakes.map(s => invulnOf(s.id)));
        const topInvulnerable = collidingSnakes.filter(s => invulnOf(s.id) === maxInvulnerability);
        
        // Among the most-invulnerable snakes, the longest survives
        const maxLength = Math.max(...topInvulnerable.map(s => s.length));
        const survivors = topInvulnerable.filter(s => s.length === maxLength);
        
        // Determine who dies in this collision group under standard resolution.
        const groupDead = new Set<string>();
        if (survivors.length > 1) {
          // No unique survivor (tie among equal-invulnerability, equal-length
          // snakes) — all colliding snakes die.
          for (const snake of collidingSnakes) {
            groupDead.add(snake.id);
          }
        } else {
          // Single survivor; every other colliding snake dies.
          const survivorId = survivors[0].id;
          for (const snake of collidingSnakes) {
            if (snake.id !== survivorId) {
              groupDead.add(snake.id);
            }
          }
        }
        
        // Team-awareness: never let our snake benefit from a teammate's
        // head-to-head death. If our snake would survive this collision while a
        // teammate dies in it, flip the outcome — our snake dies and teammates
        // are spared — so the evaluated move gains no territory/space from
        // eliminating an ally. Enemy collision resolution is left unchanged.
        if (teamSnakeIds) {
          const ourId = gameState.you.id;
          const ourSurvives = snakeIds.includes(ourId) && !groupDead.has(ourId);
          const allyDies = snakeIds.some(
            id => id !== ourId && teamSnakeIds.has(id) && groupDead.has(id)
          );
          if (ourSurvives && allyDies) {
            groupDead.add(ourId);
            for (const id of snakeIds) {
              if (id !== ourId && teamSnakeIds.has(id)) {
                groupDead.delete(id);
              }
            }
          }
        }
        
        for (const id of groupDead) {
          deadSnakeIds.add(id);
        }
      }
    }
    
    // Step 3: Check for wall and body collisions
    for (const [snakeId, newHead] of newHeadPositions.entries()) {
      if (deadSnakeIds.has(snakeId)) continue;
      
      // Check wall collision
      if (newHead.x < 0 || newHead.x >= newBoard.width ||
          newHead.y < 0 || newHead.y >= newBoard.height) {
        deadSnakeIds.add(snakeId);
        continue;
      }
      
      // The moving snake's invulnerability level at the arrival turn
      const movingInvulnerability = invulnOf(snakeId);
      const mover = newBoard.snakes.find(s => s.id === snakeId)!;

      // Check body collision (including other snakes)
      for (const snake of newBoard.snakes) {
        if (!this.isAlive(snake) || deadSnakeIds.has(snake.id)) continue;

        // Stationary chess piece: entering its (single) square is a CONTEST
        // the engine adjudicates tier-first, weight-second — everyone below
        // the top tier at the square dies with weight never consulted; within
        // the top tier the unique heaviest survives and ties kill all
        // (`length` is a piece's WEIGHT). A won contest KILLS the piece: the
        // mover occupies the square with no growth and no health restore —
        // a piece is not food (the normal movement rule in step 4 applies).
        if (snake.id !== snakeId && isPieceUnit(snake)) {
          const sq = snake.body[0];
          if (sq && sq.x === newHead.x && sq.y === newHead.y) {
            const moverWins = winsStationaryContest(
              movingInvulnerability, mover.length, invulnOf(snake.id), snake.length);
            const pieceWins = winsStationaryContest(
              invulnOf(snake.id), snake.length, movingInvulnerability, mover.length);
            if (!moverWins) deadSnakeIds.add(snakeId);
            if (!pieceWins) deadSnakeIds.add(snake.id);
          }
          continue; // a 1-cell piece has no other segments to collide with
        }

        // If moving into a foreign snake's body and we have higher invulnerability,
        // skip collision — the mover severs through it (applied in step 5)
        if (snake.id !== snakeId &&
            movingInvulnerability > invulnOf(snake.id)) {
          continue;
        }
        
        // Check collision with each body segment
        for (let i = 0; i < snake.body.length; i++) {
          const segment = snake.body[i];

          // The engine pops every snake's tail BEFORE resolving collisions,
          // eating or not, so the final segment always vacates. A snake that
          // ate last turn carries a stacked (duplicated) tail: the duplicate
          // at the second-to-last index still blocks the cell, so skipping
          // the last index is exact for stacked tails too. Own tail and
          // foreign tails behave identically.
          if (i === snake.body.length - 1 && snake.body.length > 1) continue;

          if (segment.x === newHead.x && segment.y === newHead.y) {
            deadSnakeIds.add(snakeId);
            break;
          }
        }
      }
    }
    
    // Step 4: Update snake positions for surviving snakes
    for (const snake of newBoard.snakes) {
      if (deadSnakeIds.has(snake.id)) continue;
      
      const newHead = newHeadPositions.get(snake.id);
      if (!newHead) continue;
      
      // Check if snake is eating
      const foodIndex = newBoard.food.findIndex(f =>
        f.x === newHead.x && f.y === newHead.y
      );
      const isEating = foodIndex !== -1;

      // Health via the ONE shared movement/eat/hazard rule, computed BEFORE
      // the eaten food is spliced off the board (the rule reads dest food).
      // Movement-based decay only: units absent from the moveSet — frozen
      // snakes and stationary chess pieces — never reach this block (the
      // `if (!newHead) continue` above) and lose NO health; there is no
      // universal per-turn tick. Frozen units SITTING on hazard squares are
      // deliberately unmodeled: they don't move in lookahead, and hazard
      // damage triggers on ENTERING a hazard square.
      const newHealth = healthAfterEntering(snake, newBoard, newHead);

      // Update body the way the engine does: pop the tail first (it vacates
      // whether or not the snake eats), then grow by duplicating the NEW tail
      // — which is how "ate last turn" stays visible as a stacked tail.
      const newBody = [newHead, ...snake.body];
      newBody.pop();
      if (isEating) {
        const tail = newBody[newBody.length - 1];
        newBody.push({ x: tail.x, y: tail.y });
        // Remove the eaten food
        newBoard.food.splice(foodIndex, 1);
      }

      // Update snake
      snake.head = newHead;
      snake.body = newBody;
      snake.length = newBody.length;
      snake.health = newHealth;

      // Death only at health <= 0, for starvation and hazard damage alike
      // (hazards are damage-based, no longer instant death). Starvation is
      // decided HERE, before any food spawn could help: the engine spawns
      // food AFTER movement, so this-turn survival is fully decidable from
      // the pre-move board and the simulator must NEVER invent food — a move
      // that doesn't land on existing food and takes health to 0 is certain
      // death (pinned by the conservative-starvation tests).
      if (newHealth <= 0) {
        deadSnakeIds.add(snake.id);
      }
    }
    
    // Step 5: Severing. A snake that moved onto a strictly-less-invulnerable
    // snake's body doesn't just survive there (step 3 skipped that collision) —
    // it CUTS the body: the contacted segment and everything behind it are
    // removed, and the owner survives shortened. Mirrors the server's tiered
    // collision pass (SnekProcessor.checkSnakeCollisionsTiered), which severs
    // against post-move bodies with higher levels acting first.
    const severingMovers = newBoard.snakes
      .filter(s => !deadSnakeIds.has(s.id) && newHeadPositions.has(s.id))
      .sort((a, b) => invulnOf(b.id) - invulnOf(a.id));
    for (const mover of severingMovers) {
      const moverLevel = invulnOf(mover.id);
      for (const target of newBoard.snakes) {
        if (target.id === mover.id || deadSnakeIds.has(target.id)) continue;
        if (invulnOf(target.id) >= moverLevel) continue;
        // Index 0 is the target's head — head contacts resolve as head-to-head
        // in step 2, never as a sever.
        const segIdx = target.body.findIndex(
          (seg, i) => i >= 1 && seg.x === mover.head.x && seg.y === mover.head.y
        );
        if (segIdx === -1) continue;
        target.body = target.body.slice(0, segIdx);
        target.length = target.body.length;
      }
    }

    // Step 6: Remove dead snakes from the board
    newBoard.snakes = newBoard.snakes.filter(s => !deadSnakeIds.has(s.id));
    
    return {
      board: newBoard,
      deadSnakeIds
    };
  }

  private getNewHead(head: Coord, move: Direction): Coord {
    switch (move) {
      case 'up':
        return { x: head.x, y: head.y + 1 };
      case 'down':
        return { x: head.x, y: head.y - 1 };
      case 'left':
        return { x: head.x - 1, y: head.y };
      case 'right':
        return { x: head.x + 1, y: head.y };
      default:
        return head;
    }
  }

  private isAlive(snake: Snake): boolean {
    return snake.health > 0 && snake.body.length > 0;
  }

  private deepCopyBoard(board: Board): Board {
    return {
      height: board.height,
      width: board.width,
      food: (board.food ?? []).map(f => ({ x: f.x, y: f.y })),
      hazards: (board.hazards ?? []).map(h => ({ x: h.x, y: h.y })),
      // Must survive the copy: the hazard branch of healthAfterEntering reads
      // this configured damage on boards simulated FROM this copy.
      hazardDamage: board.hazardDamage,
      fertileTiles: board.fertileTiles ? board.fertileTiles.map(f => ({ x: f.x, y: f.y })) : undefined,
      snakes: (board.snakes ?? []).map(snake => ({
        id: snake.id,
        name: snake.name,
        latency: snake.latency,
        health: snake.health,
        // Must survive the copy: the eat branch above restores health to this
        // configured per-type max on boards simulated FROM this copy.
        maxHealth: snake.maxHealth,
        body: (snake.body ?? []).map(b => ({ x: b.x, y: b.y })),
        head: { x: snake.head.x, y: snake.head.y },
        length: snake.length,
        shout: snake.shout,
        squad: snake.squad,
        customizations: { ...(snake.customizations ?? {}) },
        // Must survive the copy: the stationary-piece contest in step 3, the
        // BoardGraph piece layers (piece squares as walls, the starvation
        // guard) and the piece threat map all key off the unit's type — and
        // pawn threat geometry reads its facing.
        unitType: snake.unitType,
        facing: { dx: snake.facing.dx, dy: snake.facing.dy },
        invulnerabilityLevel: snake.invulnerabilityLevel,
        // Must survive the copy: evaluators build a BoardGraph over the
        // simulated board, and BoardGraph reads severability lookahead from
        // this expiry (absent = "level applies this turn only").
        invulnerabilityExpiryTurn: snake.invulnerabilityExpiryTurn
      }))
    };
  }
}