/**
 * Board graph representation for unified pathfinding.
 *
 * Two layers, deliberately separated:
 *  - PHYSICAL passability (`isPassable` / `isPassableAtTurn` / adjacency):
 *    walls, hazards and body segments with tail-vacate timing. This is
 *    subject-agnostic — it knows nothing about "us" — and is what the shared
 *    Voronoi territory BFS walks.
 *  - SUBJECTIVE passability (`passabilityFor` / `isPassableForSnake`): the
 *    single source of truth for "where can THIS snake walk", layering
 *    own-body/own-tail handling and invulnerability severability on top of the
 *    physical layer. Severability is inherently relative to who is moving, so it
 *    lives ONLY here and never in the shared physical graph.
 *
 * BoardGraph has no concept of `you`: every perspective-dependent query takes a
 * subject snake id.
 *
 * INTERNALS are integer-indexed typed arrays (cell index = y * width + x): the
 * evaluation pipeline runs thousands of flood fills per turn, and string-keyed
 * Maps/Sets plus per-neighbor object allocation were measured at a ~28x tax
 * over flat arrays. The string-based helpers (coordToKey, getNeighbors, …)
 * remain as thin compatibility wrappers; hot paths use the *Idx variants.
 */

import { BoardSnapshot, Coord, Snake } from '../types/battlesnake';

export type CellKey = string;

export interface BoardGraphConfig {
  // Tail growth variant:
  // 'grow-same-turn' - snake grows immediately when eating (tail doesn't move)
  // 'grow-next-turn' - snake grows on turn after eating (tail moves when eating)
  tailGrowthTiming: 'grow-same-turn' | 'grow-next-turn';

  // Maximum turns to look ahead for optimistic passability
  maxLookaheadTurns: number;
}

// Subject-relative passability bundle returned by `passabilityFor`.
export interface SnakePassability {
  headKey: CellKey;
  tailKey: CellKey;
  // Can the subject occupy `coord` arriving `arrivalTurn` turns from now?
  passable: (coord: Coord, arrivalTurn: number) => boolean;
}

// Integer-index variant for hot paths (no string keys, no Coord allocation).
export interface SnakePassabilityIdx {
  headIdx: number;   // -1 when the subject is unknown/dead
  tailIdx: number;   // -1 when the subject is unknown/dead
  // Can the subject occupy cell `idx` (already bounds-checked by the caller's
  // neighbor arithmetic) arriving `arrivalTurn` turns from now?
  passableIdx: (idx: number, arrivalTurn: number) => boolean;
}

// How much body-segment clearance to assume when deciding passability:
//  - 'static':       no look-ahead. A body cell is passable only if it is an
//                    immediately-vacating tail (!staticBlocked); interior body
//                    is always a wall. Bodies treated as static walls.
//  - 'conservative': a cell is passable once its conservative disappear turn has
//                    passed. Conservative timing accounts for food the owner
//                    could eat (keeps growing) plus a one-turn safety buffer, so
//                    this is the timing used by survival reasoning.
//  - 'optimistic':   a cell is passable once its optimistic disappear turn has
//                    passed. Optimistic timing is pure tail geometry plus only
//                    the single eat we can confirm this turn.
export type ClearanceMode = 'static' | 'conservative' | 'optimistic';

export interface PassabilityOptions {
  // Body-segment clearance model. Defaults to 'static'.
  clearance?: ClearanceMode;
}

const NO_SNAKE = -1;

export class BoardGraph {
  private width: number;
  private height: number;
  private cells: number;              // width * height
  private config: BoardGraphConfig;
  private currentTurn: number;

  // Per-cell layers (length = cells).
  private hazard: Uint8Array;
  private segOwner: Int16Array;       // snake index owning a body segment here, or NO_SNAKE
  private segIsTail: Uint8Array;
  private segStaticBlocked: Uint8Array;
  private optimisticDisappear: Int16Array;
  private physicalDisappear: Int16Array;
  private conservativeDisappear: Int16Array;

  // Per-snake metadata, indexed by snake index.
  private snakeIds: string[] = [];
  private snakeIndexById = new Map<string, number>();
  private snakeInvuln: number[] = [];
  private snakeExpiryTurn: number[] = [];
  private snakeHeadIdx: number[] = [];
  private snakeTailIdx: number[] = [];

  // Scratch buffers for internal BFS (epoch-stamped visited avoids clearing).
  private visitStamp: Int32Array;
  private stamp = 0;
  private queue: Int32Array;

  // Lazily-built string-keyed compatibility structures.
  private adjacencyList: Map<CellKey, Set<CellKey>> | null = null;
  private blockedCellSet: Set<CellKey> | null = null;

  constructor(state: BoardSnapshot, config?: Partial<BoardGraphConfig>) {
    this.width = state.board.width;
    this.height = state.board.height;
    this.cells = this.width * this.height;
    this.config = {
      tailGrowthTiming: 'grow-next-turn',
      maxLookaheadTurns: 5,
      ...config
    };
    this.currentTurn = state.turn ?? 0;

    this.hazard = new Uint8Array(this.cells);
    this.segOwner = new Int16Array(this.cells).fill(NO_SNAKE);
    this.segIsTail = new Uint8Array(this.cells);
    this.segStaticBlocked = new Uint8Array(this.cells);
    this.optimisticDisappear = new Int16Array(this.cells);
    this.physicalDisappear = new Int16Array(this.cells);
    this.conservativeDisappear = new Int16Array(this.cells);
    this.visitStamp = new Int32Array(this.cells);
    this.queue = new Int32Array(this.cells);

    this.buildGraph(state);
  }

  // ── Integer cell indexing ────────────────────────────────────────────────

  /** Cell index for (x, y). Caller guarantees bounds. */
  cellIndex(x: number, y: number): number {
    return y * this.width + x;
  }

  cellIndexOf(coord: Coord): number {
    return coord.y * this.width + coord.x;
  }

  xOf(idx: number): number { return idx % this.width; }
  yOf(idx: number): number { return Math.floor(idx / this.width); }
  get cellCount(): number { return this.cells; }
  get boardWidth(): number { return this.width; }
  get boardHeight(): number { return this.height; }

  /** Snake index for a snake id, or -1 if unknown/dead at build time. */
  snakeIndexOf(id: string): number {
    return this.snakeIndexById.get(id) ?? -1;
  }

  /**
   * Build the graph in two phases to break a circular dependency: the optimistic
   * (turn-aware) passability needs each segment's conservativeDisappearTurn,
   * which is produced by the food-reach BFS — but that BFS only needs STATIC
   * passability. So we build the static layer first, run food reach over it,
   * then fill the results back in.
   */
  private buildGraph(state: BoardSnapshot): void {
    const { board } = state;

    // Food mask, used for justAte checks and the food-reach BFS.
    const foodMask = new Uint8Array(this.cells);
    for (const f of board.food) foodMask[this.cellIndexOf(f)] = 1;

    // Phase 0: per-snake metadata (invulnerability, head/tail indices).
    this.buildSnakeMeta(board.snakes);

    // Phase 1: segments + hazards + static blocked layer. After this,
    // passabilityFor({ clearance: 'static' }) is fully functional.
    this.buildSegments(board.snakes, foodMask, board.hazards);

    // Phase 2: food reach via the static predicate, then fill in each segment's
    // optimistic + conservative disappear turns. After this, the turn-aware
    // clearance layers ('optimistic' and 'conservative') are correct.
    const foodReach = this.calculateSnakeFoodReachability(board.snakes, foodMask);
    this.fillDisappearTurns(board.snakes, foodReach);
  }

  private buildSnakeMeta(snakes: Snake[]): void {
    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      const idx = this.snakeIds.length;
      this.snakeIds.push(snake.id);
      this.snakeIndexById.set(snake.id, idx);
      this.snakeInvuln.push(snake.invulnerabilityLevel ?? 0);
      // Last absolute game turn on which invuln still applies; falls back to
      // the current turn (applies to this turn only) when the server omits it.
      this.snakeExpiryTurn.push(snake.invulnerabilityExpiryTurn ?? this.currentTurn);
      this.snakeHeadIdx.push(this.cellIndexOf(snake.head));
      this.snakeTailIdx.push(this.cellIndexOf(snake.body[snake.body.length - 1]));
    }
  }

  private buildSegments(snakes: Snake[], foodMask: Uint8Array, hazards: Coord[]): void {
    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      const snakeIdx = this.snakeIndexById.get(snake.id)!;
      const justAte = foodMask[this.cellIndexOf(snake.head)] === 1;

      // Body segments, excluding the head at index 0. Later snakes overwrite
      // overlapping cells (same last-writer-wins as the old Map-based build).
      for (let i = 1; i < snake.body.length; i++) {
        const idx = this.cellIndexOf(snake.body[i]);
        const isTail = i === snake.body.length - 1;
        const turnsFromTail = snake.body.length - i;

        let staticBlocked = true;
        if (isTail) {
          if (justAte) {
            // Head on food => snake grows => tail does NOT vacate next turn.
            staticBlocked = true;
          } else if (this.config.tailGrowthTiming === 'grow-same-turn') {
            staticBlocked = false; // tail moves this turn
          } else {
            // grow-next-turn: tail moves unless it's the only segment after head.
            staticBlocked = snake.body.length === 2;
          }
        }

        // Both disappear turns start at the pure-geometry base (turnsFromTail)
        // and are pushed out by fillDisappearTurns once food reach is known.
        this.segOwner[idx] = snakeIdx;
        this.segIsTail[idx] = isTail ? 1 : 0;
        this.segStaticBlocked[idx] = staticBlocked ? 1 : 0;
        this.optimisticDisappear[idx] = turnsFromTail;
        this.physicalDisappear[idx] = turnsFromTail;
        this.conservativeDisappear[idx] = turnsFromTail;
      }
    }

    for (const h of hazards) {
      this.hazard[this.cellIndexOf(h)] = 1;
    }
  }

  /**
   * Food reachability from each snake's head via its OWN subjective static
   * passability. Returns, per snake index, the count of NEW food reached at each
   * turn — used to push out disappear turns (a snake that can eat keeps growing).
   */
  private calculateSnakeFoodReachability(snakes: Snake[], foodMask: Uint8Array): number[][] {
    const reach: number[][] = [];
    const W = this.width;

    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      const snakeIdx = this.snakeIndexById.get(snake.id)!;

      // Static clearance so this does not read the disappear turns, which don't
      // exist yet — this is what breaks the build-order cycle.
      const pass = this.passabilityIdxFor(snake.id, { clearance: 'static' });

      const headIdx = this.snakeHeadIdx[snakeIdx];
      const foodByTurn: number[] = [foodMask[headIdx] === 1 ? 1 : 0];

      const stamp = ++this.stamp;
      this.visitStamp[headIdx] = stamp;
      let levelStart = 0;
      let levelEnd = 1;
      this.queue[0] = headIdx;

      for (let turn = 1; turn <= this.config.maxLookaheadTurns; turn++) {
        let nextEnd = levelEnd;
        let foodFoundThisTurn = 0;
        for (let q = levelStart; q < levelEnd; q++) {
          const cur = this.queue[q];
          const x = cur % W;
          // Orthogonal neighbors via index arithmetic; -1 marks out-of-bounds.
          const n0 = cur + W < this.cells ? cur + W : -1;
          const n1 = cur - W >= 0 ? cur - W : -1;
          const n2 = x > 0 ? cur - 1 : -1;
          const n3 = x < W - 1 ? cur + 1 : -1;
          for (const n of [n0, n1, n2, n3]) {
            if (n < 0 || this.visitStamp[n] === stamp) continue;
            if (!pass.passableIdx(n, turn)) continue;
            this.visitStamp[n] = stamp;
            this.queue[nextEnd++] = n;
            if (foodMask[n] === 1) foodFoundThisTurn++;
          }
        }
        foodByTurn.push(foodFoundThisTurn);
        levelStart = levelEnd;
        levelEnd = nextEnd;
        if (levelStart === levelEnd) break;
      }

      reach[snakeIdx] = foodByTurn;
    }

    return reach;
  }

  /**
   * Fill each segment's optimistic + conservative disappear turns from the
   * pure-geometry base (turnsFromTail) and the owner's food reach.
   *
   * Eat accounting is PER SEGMENT: an eat at turn t only delays segments whose
   * (current, already-delayed) vacate turn comes after the eat takes effect.
   * Under 'grow-next-turn' timing an eat at turn t delays only segments whose
   * vacate turn is STRICTLY greater than t (the tail vacating at turn t itself
   * has already moved when the eat lands). Under 'grow-same-turn' the tail
   * stays put on the eating turn itself, so an eat at turn t delays segments
   * whose vacate turn is >= t. Turn-0 "eats" (head already on food — justAte)
   * delay everything, matching the static-layer blocked tail.
   *
   *  - optimistic  = base + only the eats we can CONFIRM: turn 0 (head on
   *    food) and turn 1 (food one step away), applied per segment.
   *  - physical    = base + every food the owner could reach in time to still
   *    be growing when the segment would vacate, applied per segment with NO
   *    safety buffer. Used by the subject-agnostic Voronoi layer.
   *  - conservative = physical + 1. The physical vacate turn plus a one-turn
   *    safety buffer; this is what pessimistic survival reasoning banks on.
   */
  private fillDisappearTurns(snakes: Snake[], foodReach: number[][]): void {
    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      const snakeIdx = this.snakeIndexById.get(snake.id)!;
      const foodByTurn = foodReach[snakeIdx] || [];

      // Does an eat at turn t delay a segment currently vacating at `vacate`?
      const growSame = this.config.tailGrowthTiming === 'grow-same-turn';

      // Apply eats (count per turn) to a segment's base vacate turn.
      const applyEats = (base: number, eatsAtTurn: (t: number) => number, maxTurn: number): number => {
        let vacate = base;
        for (let t = 0; t <= maxTurn; t++) {
          const eats = eatsAtTurn(t);
          if (eats > 0 && (growSame ? vacate >= t : vacate > t)) vacate += eats;
        }
        return vacate;
      };

      // Confirmed eats only: turn 0 = head already on food (justAte); turn 1 =
      // a food cell reachable in a single move this turn.
      const justAte = (foodByTurn[0] ?? 0) > 0 ? 1 : 0;
      const canEatThisTurn = (foodByTurn[1] ?? 0) > 0 ? 1 : 0;
      const confirmedEats = (t: number): number =>
        t === 0 ? justAte : t === 1 ? Math.min(canEatThisTurn, 1) : 0;
      const potentialEats = (t: number): number => foodByTurn[t] ?? 0;

      for (let i = 1; i < snake.body.length; i++) {
        const idx = this.cellIndexOf(snake.body[i]);
        // Skip cells overwritten by another snake's overlapping segment.
        if (this.segOwner[idx] !== snakeIdx) continue;

        const base = snake.body.length - i; // pure-geometry disappear turn (turnsFromTail)

        this.optimisticDisappear[idx] = applyEats(base, confirmedEats, 1);

        if (base <= this.config.maxLookaheadTurns) {
          this.physicalDisappear[idx] = applyEats(base, potentialEats, foodByTurn.length - 1);
        } else {
          this.physicalDisappear[idx] = base;
        }
        this.conservativeDisappear[idx] = this.physicalDisappear[idx] + 1;
      }
    }
  }

  /** Invulnerability level of a snake (by index) projected to an absolute game turn. */
  private invulnAtIdx(snakeIdx: number, absoluteTurn: number): number {
    if (snakeIdx < 0) return 0;
    return absoluteTurn <= this.snakeExpiryTurn[snakeIdx] ? this.snakeInvuln[snakeIdx] : 0;
  }

  /**
   * The single source of truth for "where can THIS snake walk", integer-index
   * variant. Rules, from the subject's perspective:
   *  - own head: not a destination (it's the BFS origin);
   *  - own interior body: never passable;
   *  - own tail: passable per the vacate rule (it can chase its tail);
   *  - another snake STRICTLY less invulnerable than us (at the arrival turn):
   *    fully severable, so its body is passable;
   *  - other bodies: recede per the chosen `clearance` mode. Enemy-tail risk is
   *    modelled by the conservative clearance timing (which never banks on an
   *    opponent's tail vacating early), not by a separate force-block flag.
   *
   * Severability uses a STRICT inequality (owner < subject): equal invulnerability
   * never grants passage, so we never bank on winning on equal footing.
   */
  passabilityIdxFor(subjectId: string, opts?: PassabilityOptions): SnakePassabilityIdx {
    const subjectIdx = this.snakeIndexById.get(subjectId) ?? -1;
    const headIdx = subjectIdx >= 0 ? this.snakeHeadIdx[subjectIdx] : -1;
    const tailIdx = subjectIdx >= 0 ? this.snakeTailIdx[subjectIdx] : -1;
    const clearance: ClearanceMode = opts?.clearance ?? 'static';

    const clearanceArr =
      clearance === 'conservative' ? this.conservativeDisappear :
      clearance === 'optimistic' ? this.optimisticDisappear : null;

    const passableIdx = (idx: number, arrivalTurn: number): boolean => {
      if (this.hazard[idx] === 1) return false;
      if (idx === headIdx) return false; // origin, never a destination

      const owner = this.segOwner[idx];
      if (owner === NO_SNAKE) return true; // empty cell (including other snakes' heads)

      // Has this segment receded (become passable) by arrivalTurn under the
      // clearance mode? Under 'static' only an immediately-vacating tail counts.
      const receded = clearanceArr
        ? clearanceArr[idx] <= arrivalTurn
        : this.segStaticBlocked[idx] === 0;

      if (owner === subjectIdx) {
        // Our own body: interior is always a wall (we cannot count on our own
        // body vacating ahead of our head); only our tail follows the vacate rule.
        if (this.segIsTail[idx] === 0) return false;
        return receded;
      }

      // Another snake's segment. Severable if we strictly out-invulnerate the
      // owner at the turn we would arrive.
      const absTurn = this.currentTurn + arrivalTurn;
      if (this.invulnAtIdx(owner, absTurn) < this.invulnAtIdx(subjectIdx, absTurn)) {
        return true;
      }

      // Otherwise the cell is passable only once the owner's body has receded
      // there under the chosen clearance timing (tail and interior alike).
      return receded;
    };

    return { headIdx, tailIdx, passableIdx };
  }

  /**
   * Coord-based subjective passability (compatibility wrapper over the integer
   * core). Returns a bound predicate plus the subject's head/tail keys.
   */
  passabilityFor(subjectId: string, opts?: PassabilityOptions): SnakePassability {
    const idx = this.passabilityIdxFor(subjectId, opts);
    const headKey = idx.headIdx >= 0 ? this.keyOfIndex(idx.headIdx) : '';
    const tailKey = idx.tailIdx >= 0 ? this.keyOfIndex(idx.tailIdx) : '';

    const passable = (coord: Coord, arrivalTurn: number): boolean => {
      if (!this.isInBounds(coord)) return false;
      return idx.passableIdx(this.cellIndexOf(coord), arrivalTurn);
    };

    return { headKey, tailKey, passable };
  }

  /** Thin convenience wrapper over `passabilityFor` for one-off queries. */
  isPassableForSnake(coord: Coord, arrivalTurn: number, subjectId: string, opts?: PassabilityOptions): boolean {
    return this.passabilityFor(subjectId, opts).passable(coord, arrivalTurn);
  }

  private isStaticBlockedIdx(idx: number): boolean {
    return this.hazard[idx] === 1 || (this.segOwner[idx] !== NO_SNAKE && this.segStaticBlocked[idx] === 1);
  }

  /**
   * Get passable neighbors for a cell (physical, subject-agnostic).
   * Compatibility path — the adjacency table is built lazily on first use,
   * since the optimistic evaluation pipeline never touches it.
   */
  getNeighbors(coord: Coord): Coord[] {
    if (!this.adjacencyList) this.buildAdjacency();
    const key = this.coordToKey(coord);
    const neighborKeys = this.adjacencyList!.get(key);
    if (!neighborKeys) return [];
    return Array.from(neighborKeys).map(k => this.keyToCoord(k));
  }

  private buildAdjacency(): void {
    this.adjacencyList = new Map();
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const idx = this.cellIndex(x, y);
        const cellKey = this.coordToKey({ x, y });
        if (this.isStaticBlockedIdx(idx)) {
          this.adjacencyList.set(cellKey, new Set());
          continue;
        }
        const passableNeighbors = new Set<CellKey>();
        for (const neighbor of [
          { x, y: y + 1 }, { x, y: y - 1 }, { x: x - 1, y }, { x: x + 1, y }
        ]) {
          if (!this.isInBounds(neighbor)) continue;
          if (!this.isStaticBlockedIdx(this.cellIndexOf(neighbor))) {
            passableNeighbors.add(this.coordToKey(neighbor));
          }
        }
        this.adjacencyList.set(cellKey, passableNeighbors);
      }
    }
  }

  /**
   * Get passable neighbors for a cell with optimistic (turn-aware) physical
   * passability: body segments are passable once they will have receded by
   * arrivalTurn. Subject-agnostic (no severability) — used by the shared
   * Voronoi territory BFS.
   */
  getNeighborsOptimistic(coord: Coord, arrivalTurn: number): Coord[] {
    const passable: Coord[] = [];
    for (const neighbor of [
      { x: coord.x, y: coord.y + 1 },
      { x: coord.x, y: coord.y - 1 },
      { x: coord.x - 1, y: coord.y },
      { x: coord.x + 1, y: coord.y }
    ]) {
      if (!this.isInBounds(neighbor)) continue;
      if (this.isPassableAtTurnIdx(this.cellIndexOf(neighbor), arrivalTurn)) passable.push(neighbor);
    }
    return passable;
  }

  /**
   * Physical turn-aware passability (no severability), integer-index variant.
   * For body segments, the cell is passable once its PHYSICAL disappear turn has
   * passed (no survival safety buffer — that buffer belongs to the
   * 'conservative' clearance mode).
   */
  isPassableAtTurnIdx(idx: number, arrivalTurn: number): boolean {
    if (this.segOwner[idx] !== NO_SNAKE) {
      if (arrivalTurn <= this.config.maxLookaheadTurns) {
        return this.physicalDisappear[idx] <= arrivalTurn;
      }
      return !this.isStaticBlockedIdx(idx);
    }
    return !this.isStaticBlockedIdx(idx);
  }

  /** Coord-based wrapper over isPassableAtTurnIdx. */
  isPassableAtTurn(coord: Coord, arrivalTurn: number): boolean {
    if (!this.isInBounds(coord)) return false;
    return this.isPassableAtTurnIdx(this.cellIndexOf(coord), arrivalTurn);
  }

  /**
   * Check if a coordinate is within board bounds.
   */
  isInBounds(coord: Coord): boolean {
    return coord.x >= 0 && coord.x < this.width &&
           coord.y >= 0 && coord.y < this.height;
  }

  /**
   * Physical static passability (in bounds and not a static wall). No
   * severability — that lives in passabilityFor.
   */
  isPassable(coord: Coord): boolean {
    if (!this.isInBounds(coord)) return false;
    return !this.isStaticBlockedIdx(this.cellIndexOf(coord));
  }

  /**
   * Get the set of blocked cell keys (for direct iteration if needed).
   * Built lazily — compatibility path only.
   */
  getBlockedCells(): Set<CellKey> {
    if (!this.blockedCellSet) {
      this.blockedCellSet = new Set();
      for (let idx = 0; idx < this.cells; idx++) {
        if (this.isStaticBlockedIdx(idx)) this.blockedCellSet.add(this.keyOfIndex(idx));
      }
    }
    return this.blockedCellSet;
  }

  /** String key for a cell index. */
  keyOfIndex(idx: number): CellKey {
    return `${idx % this.width},${Math.floor(idx / this.width)}`;
  }

  /**
   * Convert coordinate to string key.
   */
  coordToKey(coord: Coord): CellKey {
    return `${coord.x},${coord.y}`;
  }

  /**
   * Convert string key to coordinate.
   */
  keyToCoord(key: CellKey): Coord {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }

  /**
   * Get all cells in the board.
   */
  getAllCells(): Coord[] {
    const cells: Coord[] = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        cells.push({ x, y });
      }
    }
    return cells;
  }

  /**
   * Get board dimensions.
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
