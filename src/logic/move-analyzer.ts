/**
 * Unified move analyzer that provides a single source of truth for move safety.
 * Returns both safe moves (definite survival) and risky moves (possible death
 * by head-to-head or by a chess piece attacking the landing square).
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { BoardGraph } from './board-graph';
import { healthAfterEntering } from './simulator';
import { UnitThreatMap, computeUnitThreatMap } from './piece-threats';

export interface H2HRiskInfo {
  hasEnemyRisk: boolean;   // Risk of h2h with equal/larger enemy
  hasAllyRisk: boolean;    // Risk of h2h with equal/larger ally
  enemyRiskCount: number;  // Number of threatening enemies
  allyRiskCount: number;   // Number of threatening allies
}

// Piece-threat classification for one candidate landing square, the piece
// counterpart of H2HRiskInfo (same enemy/ally split, same 'risky, never safe'
// consequence). Sourced from the per-decision piece threat map: an ENEMY
// piece threatens a square when it could reach it next turn AND would win or
// tie the contest there; an ALLY piece threatens every square it could reach
// (we never want the trade, whoever would survive it — mirroring ally h2h).
export interface PieceThreatInfo {
  hasEnemyThreat: boolean;
  hasAllyThreat: boolean;
  enemyThreatCount: number;  // Number of threatening enemy pieces
  allyThreatCount: number;   // Number of ally pieces that could take the square
}

export interface MoveAnalysis {
  safe: Direction[];   // Moves that definitely won't cause death or damage
  // Moves that could result in head-to-head death, piece-attack death (the
  // landing square is on a threatening piece's next-turn reach), plus
  // survivable hazard entries (non-lethal but real hazardDamage).
  // Certain-death moves — walls, unpassable bodies, losing/tying stationary
  // piece squares, hazard steps the snake's health cannot survive — are
  // excluded from both lists entirely.
  risky: Direction[];
  h2hRiskByMove: Map<Direction, H2HRiskInfo>;  // H2H risk details per move
  pieceThreatByMove: Map<Direction, PieceThreatInfo>;  // Piece threat details per move
}

const NO_PIECE_THREAT: PieceThreatInfo = {
  hasEnemyThreat: false,
  hasAllyThreat: false,
  enemyThreatCount: 0,
  allyThreatCount: 0,
};

export class MoveAnalyzer {
  /**
   * Analyzes available moves for a snake and categorizes them as safe or risky.
   * This is the single source of truth for move safety in the entire codebase.
   * Uses BoardGraph as the single source of truth for passability.
   */
  public analyzeMoves(snake: Snake, gameState: GameState, graph: BoardGraph, teamSnakeIds?: Set<string>): MoveAnalysis {
    const head = snake.head;
    const allDirections: Direction[] = ['up', 'down', 'left', 'right'];
    const safe: Direction[] = [];
    const risky: Direction[] = [];
    const h2hRiskByMove = new Map<Direction, H2HRiskInfo>();
    const pieceThreatByMove = new Map<Direction, PieceThreatInfo>();

    // Our own subjective passability (walls, hazards, own body, severable
    // enemies, winnable chess-piece squares).
    const ourPassability = graph.passabilityIdxFor(snake.id);
    // Hazard-blind variant, consulted ONLY for hazard cells the snake can
    // SURVIVE entering: hazards deal board.hazardDamage on entry (default
    // 100, death only at health <= 0) rather than killing outright, so the
    // FATALITY decision for a hazard step is made health-aware here with the
    // simulator's exact rule while wall/body passability still applies.
    // Built lazily — boards without hazards never pay for it.
    let hazardBlindPassability: ReturnType<BoardGraph['passabilityIdxFor']> | null = null;
    const board = gameState.board;

    // Unit threat map, computed once per analysis (null when no other living
    // unit exists). ONE mechanism for both unit kinds: where could each other
    // unit (snake head-step or piece move) land next turn, and would it win
    // or tie the contest against us there? Snake-sourced entries feed the
    // h2h risk info, piece-sourced entries the piece threat info.
    const threatMap = computeUnitThreatMap(snake, board, gameState.turn, teamSnakeIds);

    // Analyze each possible move
    for (const direction of allDirections) {
      const newPosition = this.getNextPosition(head, direction);

      if (!graph.isInBounds(newPosition)) continue;
      const cellIdx = graph.cellIndexOf(newPosition);
      const isHazard = board.hazards.some(
        h => h.x === newPosition.x && h.y === newPosition.y
      );

      if (isHazard) {
        // Health-aware hazard fatality, mirroring the Simulator exactly:
        // moving costs 1 unless the cell holds food (eating restores to the
        // type max BEFORE the hazard damage lands); dead iff health <= 0.
        if (healthAfterEntering(snake, board, newPosition) <= 0) continue;
        // Survivable damage — but the cell must still be otherwise passable.
        hazardBlindPassability ??= graph.passabilityIdxFor(snake.id, { ignoreHazards: true });
        if (!hazardBlindPassability.passableIdx(cellIdx, 1)) continue;
      } else if (!ourPassability.passableIdx(cellIdx, 1)) {
        // This move causes certain death - exclude it entirely
        continue;
      }

      // Both risk shapes for the landing square, derived from the one unit
      // threat map (RISKY, never safe — the other unit may well not move, so
      // each is a weighted deterrent, not death).
      const { h2hRisk, pieceThreat } = this.threatInfoAt(threatMap, cellIdx);
      h2hRiskByMove.set(direction, h2hRisk);
      pieceThreatByMove.set(direction, pieceThreat);

      // Check for head-to-head risk (any risk = risky move). A survivable
      // hazard entry is never "safe" either: the damage is real even when
      // non-lethal, so it joins the risky pool and lets the evaluation
      // (which simulates the health loss) weigh it against alternatives.
      if (isHazard || h2hRisk.hasEnemyRisk || h2hRisk.hasAllyRisk ||
          pieceThreat.hasEnemyThreat || pieceThreat.hasAllyThreat) {
        risky.push(direction);
      } else {
        safe.push(direction);
      }
    }

    return { safe, risky, h2hRiskByMove, pieceThreatByMove };
  }

  /**
   * Both risk classifications for one landing cell, derived from the one unit
   * threat map: snake-sourced entries become H2HRiskInfo (the legacy bespoke
   * adjacency scan, now subsumed by the map's snake 4-neighborhood reach and
   * shared contest rule), piece-sourced entries become PieceThreatInfo.
   * Ally entries of either kind are always risks (we never want the trade);
   * enemy entries already passed the win-or-tie contest filter in the map.
   */
  private threatInfoAt(
    threatMap: UnitThreatMap | null,
    cellIdx: number
  ): { h2hRisk: H2HRiskInfo; pieceThreat: PieceThreatInfo } {
    const h2hRisk: H2HRiskInfo = {
      hasEnemyRisk: false,
      hasAllyRisk: false,
      enemyRiskCount: 0,
      allyRiskCount: 0
    };
    const entries = threatMap?.entriesByCell[cellIdx];
    if (!entries) return { h2hRisk, pieceThreat: NO_PIECE_THREAT };

    let enemyThreatCount = 0;
    let allyThreatCount = 0;
    for (const entry of entries) {
      if (entry.sourceKind === 'snake') {
        if (entry.isAlly) {
          // Never pursue a head-to-head with a teammate, even one we would
          // win — always risky, regardless of which snake would survive.
          h2hRisk.hasAllyRisk = true;
          h2hRisk.allyRiskCount++;
        } else {
          h2hRisk.hasEnemyRisk = true;
          h2hRisk.enemyRiskCount++;
        }
      } else if (entry.isAlly) {
        allyThreatCount++;
      } else {
        enemyThreatCount++;
      }
    }

    const pieceThreat: PieceThreatInfo =
      enemyThreatCount === 0 && allyThreatCount === 0
        ? NO_PIECE_THREAT
        : {
            hasEnemyThreat: enemyThreatCount > 0,
            hasAllyThreat: allyThreatCount > 0,
            enemyThreatCount,
            allyThreatCount,
          };
    return { h2hRisk, pieceThreat };
  }

  /**
   * Gets the next position given a current position and direction.
   */
  private getNextPosition(position: Coord, direction: Direction): Coord {
    switch (direction) {
      case 'up':
        return { x: position.x, y: position.y + 1 };
      case 'down':
        return { x: position.x, y: position.y - 1 };
      case 'left':
        return { x: position.x - 1, y: position.y };
      case 'right':
        return { x: position.x + 1, y: position.y };
    }
  }
}
