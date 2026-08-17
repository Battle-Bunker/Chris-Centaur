/**
 * Board graph representation for unified pathfinding.
 *
 * Two layers, deliberately separated:
 *  - PHYSICAL passability (`isPassableStaticIdx` / `isPassableAtTurnIdx`):
 *    walls, hazards and body segments with tail-vacate timing. This is
 *    subject-agnostic — it knows nothing about "us" — and is what the shared
 *    Voronoi territory BFS walks.
 *  - SUBJECTIVE passability (`passabilityIdxFor`): the single source of truth
 *    for "where can THIS snake walk", layering own-body/own-tail handling and
 *    invulnerability severability on top of the physical layer. Severability
 *    is inherently relative to who is moving, so it lives ONLY here and never
 *    in the shared physical graph.
 *
 * BoardGraph has no concept of `you`: every perspective-dependent query takes a
 * subject snake id.
 *
 * Passability answers "may this square be entered"; ADJACENCY answers "which
 * squares are one move away", and it is per unit type. `fillUnitNeighbors` is
 * its single source, keyed by the unit's type and orientation and validated
 * through the engine-mirroring legality module (piece-moves.ts). Every search
 * — territory Voronoi, flood fills, goto/waypoint pathing — enumerates through
 * it, so a knight searches in L-jumps and a rook along rays without a single
 * call site knowing what a knight is.
 *
 * Starvation-aware body vacating: health loss is movement-tied (snakes always
 * move, so they lose exactly 1/turn unless they eat), so a snake with health h
 * dies during relative turn h unless it eats by then. If a walls-only BFS
 * (ignoring all bodies and hazards — a deliberately generous LOWER bound on
 * its earliest possible eat, e) cannot reach any ALREADY-SPAWNED food within h
 * turns (e > h), the snake certainly starves and its ENTIRE body is treated as
 * vacated from arrival turn h+1 onward (floored at turn 2 — never the very
 * next turn) in the optimistic and physical layers; the conservative layer
 * keeps its usual +1 safety buffer on top. Like the tail-vacate projections,
 * this ACCEPTS new-food-spawn risk: food spawning after this board snapshot
 * could save the snake, in which case we briefly treat a still-alive body as
 * passable. Chess pieces (`(unitType ?? 'snake') !== 'snake'`) never starve —
 * they can stand still and lose nothing — and a subject's OWN body is never
 * starvation-vacated for itself in the subjective layer.
 *
 * Chess-piece squares: a piece is a 1-cell unit whose `length` is its WEIGHT.
 * Its square is a WALL in the physical layer (frozen at its current square,
 * the documented v1 approximation), while the subjective layer grants passage
 * exactly when the subject would WIN the stationary-square contest there —
 * tier first, weight second, ties kill all (see piece-threats.ts) — the same
 * physical-wall/subjective-grant split as snake-body severability.
 *
 * The graph is integer-indexed throughout (cell index = y * width + x): the
 * evaluation pipeline runs thousands of flood fills per turn, and string-keyed
 * Maps/Sets plus per-neighbor object allocation were measured at a ~28x tax
 * over flat typed arrays.
 */

import { BoardSnapshot, Coord, Snake } from '../types/battlesnake';
import { isPieceUnit, winsStationaryContest } from './piece-threats';
import { Orientation, isInterior, legalOrientations, planPieceAction, toIndex } from './piece-moves';

export interface BoardGraphConfig {
  // Maximum turns to look ahead for optimistic passability
  maxLookaheadTurns: number;
}

// Subject-relative passability bundle returned by `passabilityIdxFor`.
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
  // Skip the hazard veto. Hazards are damage-based in the engine
  // (board.hazardDamage on entry, default 100; death only at health <= 0),
  // so a high-health unit CAN survive stepping onto one. Callers that model
  // that survival themselves (MoveAnalyzer's health-aware one-step fatality,
  // the staged-move fatality probe) opt out of the veto here and layer the
  // simulator's exact health rule (healthAfterEntering) on top of the raw
  // wall/body passability this then returns. Multi-turn pathing must NOT set
  // this — see the veto's comment in passableIdx.
  ignoreHazards?: boolean;
}

const NO_SNAKE = -1;

/**
 * Fill `out` with the in-bounds orthogonal neighbor cell indices of `idx` on a
 * W-wide grid of N cells, returning how many were written (2-4). THE one
 * implementation of the n0..n3 neighbor arithmetic — every grid walker
 * (evaluation flood fills, the multi-source BFS, waypoint pathing, adjacency
 * builds) calls this instead of re-deriving it inline.
 *
 * Scratch-array form rather than a callback: these are the measured hot loops
 * and the fill compiles to straight-line stores with no closure allocation.
 * Callers own their scratch buffer, so nested use (e.g. the Warnsdorff walk's
 * candidate + degree buffers) stays safe. Order (+W, -W, -1, +1) is the
 * historical enumeration order — BFS parent/first-visit choices depend on it.
 */
export function fillNeighbors4(idx: number, W: number, N: number, out: Int32Array): number {
  const x = idx % W;
  let count = 0;
  if (idx + W < N) out[count++] = idx + W;
  if (idx - W >= 0) out[count++] = idx - W;
  if (x > 0) out[count++] = idx - 1;
  if (x < W - 1) out[count++] = idx + 1;
  return count;
}

/**
 * What a unit needs to know to enumerate its own graph edges: its type and the
 * orientation it currently faces (read by the pawn, whose only step is
 * forward). A `Snake` satisfies this structurally, so callers holding the unit
 * itself pass it directly.
 */
export interface UnitAdjacency {
  unitType?: string;
  orientation: Orientation;
}

/** The adjacency of an ordinary snake — orthogonal steps, orientation unread. */
export const SNAKE_ADJACENCY: UnitAdjacency = { unitType: 'snake', orientation: { dx: 0, dy: -1 } };

export class BoardGraph {
  private width: number;
  private height: number;
  private cells: number;              // width * height
  private config: BoardGraphConfig;
  private currentTurn: number;

  // Per-cell layers (length = cells).
  private hazard: Uint8Array;
  private segOwner: Int16Array;       // snake index owning a body segment here, or NO_SNAKE
  // Snake index of the stationary chess piece standing here, or NO_SNAKE. A
  // piece is a 1-cell unit (its weight-stack collapses at translate time), so
  // it contributes no body segments — this layer is how its square becomes a
  // wall. Pieces are modeled FROZEN at their current square (the documented
  // v1 approximation shared with the Simulator), so the layer is not
  // turn-aware: a piece square never recedes.
  private pieceOwner: Int16Array;
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
  // Contest weight: snake.length. For pieces `length` is the WEIGHT (stack
  // size), which is exactly what stationary-square adjudication compares.
  private snakeWeight: number[] = [];
  // Per-snake adjacency descriptor (unit type + faced orientation), the input
  // to fillUnitNeighbors for every search that walks the board on a subject's
  // behalf.
  private snakeUnit: UnitAdjacency[] = [];
  // Relative arrival turn from which the snake's whole body counts as vacated
  // because it certainly starves first (Infinity = no certain starvation).
  // Optimistic/physical timing; the conservative layer adds its usual +1.
  private snakeStarveVacate: number[] = [];

  // Scratch buffers for internal BFS (epoch-stamped visited avoids clearing).
  private visitStamp: Int32Array;
  private stamp = 0;
  private queue: Int32Array;

  constructor(state: BoardSnapshot, config?: Partial<BoardGraphConfig>) {
    this.width = state.board.width;
    this.height = state.board.height;
    this.cells = this.width * this.height;
    this.config = {
      maxLookaheadTurns: 5,
      ...config
    };
    this.currentTurn = state.turn ?? 0;

    this.hazard = new Uint8Array(this.cells);
    this.segOwner = new Int16Array(this.cells).fill(NO_SNAKE);
    this.pieceOwner = new Int16Array(this.cells).fill(NO_SNAKE);
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

  // ── Per-unit adjacency ───────────────────────────────────────────────────

  /**
   * The adjacency descriptor of a unit known to this graph. Unknown/dead ids
   * fall back to snake steps, so a caller with a stale id still walks a sane
   * graph instead of throwing.
   */
  unitAdjacencyFor(snakeId: string): UnitAdjacency {
    const idx = this.snakeIndexById.get(snakeId);
    return idx === undefined ? SNAKE_ADJACENCY : this.snakeUnit[idx];
  }

  /** Upper bound on a single unit's neighbor count here (the queen's 8 rays). */
  neighborCapacity(): number {
    return 8 * Math.max(this.width, this.height);
  }

  /** A scratch buffer large enough for any unit's neighbor list on this board. */
  neighborBuffer(): Int32Array {
    return new Int32Array(this.neighborCapacity());
  }

  /**
   * THE per-unit adjacency: fill `out` with the cells `unit` can reach from
   * `idx` in ONE move, returning how many were written. Every graph search —
   * territory Voronoi, food-reach and space flood fills, goto/waypoint pathing
   * — enumerates neighbors through here, so a knight's searches advance in
   * L-jumps and a rook's along rays with no unit-type logic at any call site.
   *
   * The geometry is NOT re-derived: each candidate square is validated by
   * `planPieceAction` (the engine-mirroring legality module), so an edge exists
   * exactly where staging that square would plan a MOVE. Consequences worth
   * naming: a knight and a king stop after one step in each of their
   * orientations; sliders extend along theirs; and a pawn contributes only its
   * forward step, because its side squares plan a ROTATE (a turn spent turning,
   * not a displacement) and its diagonals need a capture target on the square
   * that a multi-turn search cannot promise will still be there.
   *
   * Snakes are the one unit the legality module does not speak for — it mirrors
   * the engine's PIECE rules — so they keep the plain orthogonal step.
   *
   * `passable` is the caller's own passability layer (optimistic / physical /
   * conservative, subject-relative or not) and stops rays: a ray extends
   * through passable squares and ends AT the first impassable one, which is
   * still offered so the caller's layer decides whether entering it is legal
   * (a won contest, a capture) without this root duplicating that judgement.
   */
  fillUnitNeighbors(
    unit: UnitAdjacency,
    idx: number,
    passable: (cellIdx: number) => boolean,
    out: Int32Array,
  ): number {
    const type = unit.unitType ?? 'snake';
    if (type === 'snake') return fillNeighbors4(idx, this.width, this.cells, out);

    // Piece geometry is defined in FULL-BOARD coordinates (perimeter wall
    // included, y growing downward), so the walk runs there and each accepted
    // square converts back to a graph cell index.
    const W = this.width;
    const H = this.height;
    const fullW = W + 2;
    const fullH = H + 2;
    const ox = (idx % W) + 1;
    const oy = H - Math.floor(idx / W);
    const origin = toIndex(ox, oy, fullW);

    let count = 0;
    for (const o of legalOrientations(type)) {
      for (let step = 1; ; step++) {
        const fx = ox + o.dx * step;
        const fy = oy + o.dy * step;
        if (!isInterior(fx, fy, fullW, fullH)) break;
        const action = planPieceAction(type, origin, toIndex(fx, fy, fullW), fullW, fullH, unit.orientation);
        if (!action || action.kind !== 'move') break;
        const cell = (H - fy) * W + (fx - 1);
        out[count++] = cell;
        if (!passable(cell)) break;
      }
    }
    return count;
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

    // Food mask, used for the food-reach BFS.
    const foodMask = new Uint8Array(this.cells);
    for (const f of board.food) foodMask[this.cellIndexOf(f)] = 1;

    // Phase 0: per-snake metadata (invulnerability, head/tail indices).
    this.buildSnakeMeta(board.snakes);

    // Phase 1: segments + hazards + static blocked layer. After this,
    // passabilityIdxFor({ clearance: 'static' }) is fully functional.
    this.buildSegments(board.snakes, board.hazards);

    // Phase 2: food reach via the static predicate, then fill in each segment's
    // optimistic + conservative disappear turns. After this, the turn-aware
    // clearance layers ('optimistic' and 'conservative') are correct.
    const foodReach = this.calculateSnakeFoodReachability(board.snakes, foodMask);
    this.fillDisappearTurns(board.snakes, foodReach);

    // Phase 3: starvation-aware body vacating (see the header doc). Only needs
    // walls + the food mask, so it composes freely on top of the tail
    // projections filled in phase 2.
    this.applyStarvationVacates(board.snakes, foodMask, board.food.length);
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
      this.snakeWeight.push(snake.length);
      this.snakeStarveVacate.push(Infinity);
      this.snakeUnit.push({
        unitType: snake.unitType ?? 'snake',
        orientation: snake.orientation ?? SNAKE_ADJACENCY.orientation,
      });
      // A chess piece's square is a wall in the physical layer (it stands
      // still in lookahead); the subjective layer grants passage only on a
      // WON contest — see passabilityIdxFor.
      if (isPieceUnit(snake)) this.pieceOwner[this.cellIndexOf(snake.head)] = idx;
    }
  }

  private buildSegments(snakes: Snake[], hazards: Coord[]): void {
    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      const snakeIdx = this.snakeIndexById.get(snake.id)!;

      // Body segments, excluding the head at index 0. A 1-cell unit (a chess
      // piece, whose stack is collapsed to a single body cell at translate
      // time) therefore contributes NO segments — its square participates in
      // head/H2H reasoning only, with `length` carrying its weight. The
      // engine may stack several segments on one cell (a snake that ate last
      // turn carries a duplicated tail; spawns start fully stacked), so treat
      // each run of consecutive duplicates as ONE cell whose vacate turn
      // counts from the run's FIRST index — the cell only frees once its last
      // copy pops.
      // Later snakes overwrite overlapping cells (same last-writer-wins as
      // the old Map-based build).
      for (let i = 1; i < snake.body.length; i++) {
        const idx = this.cellIndexOf(snake.body[i]);
        let last = i;
        while (last + 1 < snake.body.length &&
               this.cellIndexOf(snake.body[last + 1]) === idx) last++;
        // A run that also covers the HEAD cell (spawn stacks [H,H,H]; the
        // two-copy stack [H,H] right after a sever) really starts at index 0:
        // once the head moves, its copy is just another body copy the tail
        // still has to pop through, so the engine-truth vacate turn is
        // body.length − 0. A NON-stacked head stays a non-segment (this loop
        // never visits index 0 alone), so other subjects still read a normal
        // head cell as empty.
        const runStart = i === 1 && this.cellIndexOf(snake.body[0]) === idx ? 0 : i;
        const isTail = last === snake.body.length - 1;
        const stacked = last > runStart;
        const turnsFromTail = snake.body.length - runStart;

        // The engine pops tails before resolving collisions, eating or not —
        // so the tail cell vacates on the very next move unless it is
        // stacked, in which case one pop still leaves a copy behind.
        const staticBlocked = isTail ? stacked : true;

        // Both disappear turns start at the pure-geometry base (turnsFromTail)
        // and are pushed out by fillDisappearTurns once food reach is known.
        this.segOwner[idx] = snakeIdx;
        this.segIsTail[idx] = isTail ? 1 : 0;
        this.segStaticBlocked[idx] = staticBlocked ? 1 : 0;
        this.optimisticDisappear[idx] = turnsFromTail;
        this.physicalDisappear[idx] = turnsFromTail;
        this.conservativeDisappear[idx] = turnsFromTail;
        i = last;
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
      const nbuf = this.neighborBuffer();
      const unit = this.snakeUnit[snakeIdx];
      let turn = 1;
      const rayOpen = (cell: number): boolean => pass.passableIdx(cell, turn);

      for (; turn <= this.config.maxLookaheadTurns; turn++) {
        let nextEnd = levelEnd;
        let foodFoundThisTurn = 0;
        for (let q = levelStart; q < levelEnd; q++) {
          const cur = this.queue[q];
          const nCount = this.fillUnitNeighbors(unit, cur, rayOpen, nbuf);
          for (let t = 0; t < nCount; t++) {
            const n = nbuf[t];
            if (this.visitStamp[n] === stamp) continue;
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
   * The engine pops the tail BEFORE food is processed, so an eat at turn t
   * adds a body copy that delays only segments whose vacate turn is STRICTLY
   * greater than t (the tail vacating at turn t itself has already moved when
   * the eat lands). A snake that ate LAST turn needs no eat accounting here:
   * its duplicated tail is plain geometry, handled in buildSegments.
   *
   *  - optimistic  = base + only the eats we can CONFIRM: a food cell one
   *    step from the owner's head (it can eat this turn), applied per segment.
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

      // Apply eats (count per turn) to a segment's base vacate turn. An eat
      // at turn t delays only segments vacating STRICTLY after t (the engine
      // pops tails before food is processed).
      const applyEats = (base: number, eatsAtTurn: (t: number) => number, maxTurn: number): number => {
        let vacate = base;
        for (let t = 0; t <= maxTurn; t++) {
          const eats = eatsAtTurn(t);
          if (eats > 0 && vacate > t) vacate += eats;
        }
        return vacate;
      };

      // Confirmed eats only: a food cell reachable in a single move this turn.
      const canEatThisTurn = (foodByTurn[1] ?? 0) > 0 ? 1 : 0;
      const confirmedEats = (t: number): number => (t === 1 ? canEatThisTurn : 0);
      const potentialEats = (t: number): number => foodByTurn[t] ?? 0;

      for (let i = 1; i < snake.body.length; i++) {
        const idx = this.cellIndexOf(snake.body[i]);
        // Consume a run of consecutive duplicates as one cell, counting the
        // vacate turn from the run's FIRST index (same as buildSegments).
        let last = i;
        while (last + 1 < snake.body.length &&
               this.cellIndexOf(snake.body[last + 1]) === idx) last++;
        // Skip cells overwritten by another snake's overlapping segment.
        if (this.segOwner[idx] !== snakeIdx) { i = last; continue; }

        // Head-overlapping run counts from index 0 (same as buildSegments).
        const runStart = i === 1 && this.cellIndexOf(snake.body[0]) === idx ? 0 : i;
        const base = snake.body.length - runStart; // pure-geometry disappear turn (turnsFromTail)

        this.optimisticDisappear[idx] = applyEats(base, confirmedEats, 1);

        if (base <= this.config.maxLookaheadTurns) {
          this.physicalDisappear[idx] = applyEats(base, potentialEats, foodByTurn.length - 1);
        } else {
          this.physicalDisappear[idx] = base;
        }
        this.conservativeDisappear[idx] = this.physicalDisappear[idx] + 1;
        i = last;
      }
    }
  }

  /**
   * Starvation-aware body vacating (phase 3). For every snake S:
   *  - deathTurn h = S.health: health loss is movement-tied and snakes always
   *    move, so S dies during relative turn h unless it eats first (the engine
   *    checks the eat branch before the starvation branch, so eating ON turn h
   *    saves it).
   *  - earliestFoodTurn e = a LOWER bound on S's earliest possible eat of any
   *    ALREADY-SPAWNED food: BFS from S's head blocked only by walls, ignoring
   *    all bodies and hazards (they might vacate / only cost health — being
   *    generous to S keeps OUR prediction conservative). e = Infinity when the
   *    board has no food.
   *  - S certainly starves iff e > h; then its whole body vacates from arrival
   *    turn max(h + 1, 2) — never the very next turn (with h >= 1 for a living
   *    snake the clamp is automatic, but it is pinned explicitly).
   *
   * Chess pieces never starve: their health only ticks when they move, and
   * they can stand still indefinitely. New-food-spawn risk is accepted, same
   * risk class as the tail projections (see the header doc).
   */
  private applyStarvationVacates(snakes: Snake[], foodMask: Uint8Array, foodCount: number): void {
    for (const snake of snakes) {
      if (snake.health <= 0) continue;
      if ((snake.unitType ?? 'snake') !== 'snake') continue; // pieces don't starve
      const snakeIdx = this.snakeIndexById.get(snake.id)!;
      const h = snake.health;
      const canEatInTime =
        foodCount > 0 && this.wallsOnlyFoodWithin(snakeIdx, foodMask, h);
      if (!canEatInTime) {
        this.snakeStarveVacate[snakeIdx] = Math.max(h + 1, 2);
      }
    }
  }

  /**
   * Can any food cell be reached from the snake's head within `maxDepth` moves
   * of its OWN unit adjacency, ignoring everything except walls (board bounds)?
   * The generous lower bound on a snake's earliest eat used by
   * applyStarvationVacates.
   */
  private wallsOnlyFoodWithin(snakeIdx: number, foodMask: Uint8Array, maxDepth: number): boolean {
    const headIdx = this.snakeHeadIdx[snakeIdx];
    if (foodMask[headIdx] === 1) return true;
    const stamp = ++this.stamp;
    this.visitStamp[headIdx] = stamp;
    this.queue[0] = headIdx;
    let levelStart = 0;
    let levelEnd = 1;
    const nbuf = this.neighborBuffer();
    const unit = this.snakeUnit[snakeIdx];
    // Walls only: every in-bounds square is open, so rays run to the wall.
    const rayOpen = (): boolean => true;

    for (let depth = 1; depth <= maxDepth; depth++) {
      let nextEnd = levelEnd;
      for (let q = levelStart; q < levelEnd; q++) {
        const nCount = this.fillUnitNeighbors(unit, this.queue[q], rayOpen, nbuf);
        for (let t = 0; t < nCount; t++) {
          const n = nbuf[t];
          if (this.visitStamp[n] === stamp) continue;
          this.visitStamp[n] = stamp;
          if (foodMask[n] === 1) return true;
          this.queue[nextEnd++] = n;
        }
      }
      levelStart = levelEnd;
      levelEnd = nextEnd;
      if (levelStart === levelEnd) break;
    }
    return false;
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
    const ignoreHazards = opts?.ignoreHazards ?? false;

    const clearanceArr =
      clearance === 'conservative' ? this.conservativeDisappear :
      clearance === 'optimistic' ? this.optimisticDisappear : null;
    // Starvation vacate timing per layer: optimistic/physical use the stored
    // turn (h + 1) directly; conservative keeps its usual +1 safety buffer,
    // mirroring how the tail projections differ across layers.
    const starveExtra = clearance === 'conservative' ? 1 : 0;

    const passableIdx = (idx: number, arrivalTurn: number): boolean => {
      // Hazard veto — DELIBERATE CONSERVATISM under damage-based hazards.
      // The engine deals board.hazardDamage per hazard ENTRY (death only at
      // health <= 0), so a high-health unit could survive crossing hazard
      // cells. Multi-turn walkers (flood fills, food-reach, Voronoi/territory
      // BFS, waypoint pathing) stay health-unaware here: health varies along
      // a path and per-entry damage compounds across hazard cells, so making
      // this layer exact would thread health state through every BFS. We
      // therefore keep hazards impassable — never banking on surviving one —
      // and leave the health-aware exception to the single-step fatality
      // callers that opt out via `ignoreHazards` and apply the simulator's
      // exact rule themselves.
      if (!ignoreHazards && this.hazard[idx] === 1) return false;
      if (idx === headIdx) return false; // origin, never a destination

      // Stationary chess-piece square: entering it is a CONTEST the engine
      // adjudicates tier-first, weight-second (weights are only compared
      // within the top tier; ties kill all — `length` is a piece's weight).
      // The subject may pass iff it WINS outright: the piece is strictly
      // lower-tier at the arrival turn, or equal-tier and strictly lighter.
      // Losing AND tying are both death, so they stay impassable. This
      // mirrors the severability pattern below — piece squares are physical
      // walls, and the win-grant is subject-relative so it lives ONLY here.
      // Same frozen approximation as the Simulator: the piece is modeled at
      // its current square (it could really move away or toward us), and the
      // subject's CURRENT weight is used for every arrival turn.
      const pieceIdx = this.pieceOwner[idx];
      if (pieceIdx !== NO_SNAKE && pieceIdx !== subjectIdx) {
        const absTurn = this.currentTurn + arrivalTurn;
        return subjectIdx >= 0 && winsStationaryContest(
          this.invulnAtIdx(subjectIdx, absTurn),
          this.snakeWeight[subjectIdx],
          this.invulnAtIdx(pieceIdx, absTurn),
          this.snakeWeight[pieceIdx]
        );
      }

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

      // Starvation vacate — OTHER snakes only (own-body handling returned
      // above: a subject never banks on walking through its own still-alive
      // body, starving or not). Turn-aware clearances only: 'static' projects
      // nothing. Applies to the whole body, stacked tails included.
      if (clearanceArr && this.snakeStarveVacate[owner] + starveExtra <= arrivalTurn) {
        return true;
      }

      // Otherwise the cell is passable only once the owner's body has receded
      // there under the chosen clearance timing (tail and interior alike).
      return receded;
    };

    return { headIdx, tailIdx, passableIdx };
  }

  private isStaticBlockedIdx(idx: number): boolean {
    return this.hazard[idx] === 1 ||
           this.pieceOwner[idx] !== NO_SNAKE ||
           (this.segOwner[idx] !== NO_SNAKE && this.segStaticBlocked[idx] === 1);
  }

  /**
   * Physical turn-aware passability (no severability). For body segments, the
   * cell is passable once its PHYSICAL disappear turn has passed (no survival
   * safety buffer — that buffer belongs to the 'conservative' clearance mode).
   */
  isPassableAtTurnIdx(idx: number, arrivalTurn: number): boolean {
    // Chess-piece squares never recede: pieces are modeled FROZEN at their
    // current square (they don't starve and this layer banks on nothing
    // moving). Winning a contest there is subject-relative and lives only in
    // passabilityIdxFor — exactly like snake-body severability.
    if (this.pieceOwner[idx] !== NO_SNAKE) return false;
    const owner = this.segOwner[idx];
    if (owner !== NO_SNAKE) {
      // Starvation vacate: a certainly-starving owner's body is gone from
      // this arrival turn on (not gated by maxLookaheadTurns — the starve
      // turn is exact, not a projection horizon).
      if (this.snakeStarveVacate[owner] <= arrivalTurn) return true;
      if (arrivalTurn <= this.config.maxLookaheadTurns) {
        return this.physicalDisappear[idx] <= arrivalTurn;
      }
    }
    return !this.isStaticBlockedIdx(idx);
  }

  /**
   * Physical static passability (not a static wall). No severability — that
   * lives in passabilityIdxFor.
   */
  isPassableStaticIdx(idx: number): boolean {
    return !this.isStaticBlockedIdx(idx);
  }

  /**
   * The PHYSICAL vacate turn of the body segment at `idx` — geometry plus
   * every food its owner could reach in time to still be growing — or 0 for
   * cells with no segment (already free). This is the same timing
   * isPassableAtTurnIdx gates on; exposed so UI payloads can explain WHY a
   * body cell counts as future territory.
   */
  physicalVacateTurn(idx: number): number {
    const owner = this.segOwner[idx];
    if (owner === NO_SNAKE) return 0;
    // Starvation vacate caps the physical timing (min stays finite because
    // physicalDisappear always is).
    return Math.min(this.physicalDisappear[idx], this.snakeStarveVacate[owner]);
  }

  // Memoized whole-board physicalVacateTurn snapshot (below).
  private vacateTurnsCache: number[] | null = null;

  /**
   * The physicalVacateTurn of EVERY cell as a JSON-ready array, built once
   * per graph and shared: the per-candidate cell-ownership payloads all
   * describe the same graph, so each used to rebuild an identical array per
   * call. Treat as READ-ONLY — the same instance is embedded in every
   * CellOwnership snapshot for this graph (consumers only serialize it).
   */
  physicalVacateTurns(): number[] {
    if (!this.vacateTurnsCache) {
      const arr = new Array<number>(this.cells);
      for (let idx = 0; idx < this.cells; idx++) arr[idx] = this.physicalVacateTurn(idx);
      this.vacateTurnsCache = arr;
    }
    return this.vacateTurnsCache;
  }

  // Lazily-built static SNAKE-step adjacency in CSR form: adjNeighbors[adjStart[i]
  // .. adjStart[i+1]) are the statically-passable neighbor cell indices of cell
  // i. A statically-blocked cell has an empty neighbor list (it is not a
  // usable origin). Cached once per graph — a shared resource for heuristics
  // that iterate neighborhoods repeatedly and don't need turn-aware timing;
  // it costs nothing until first access. Cell-keyed, so it holds one unit
  // type's edges: searches on a piece's behalf take fillUnitNeighbors instead.
  private adjStart: Int32Array | null = null;
  private adjNeighbors: Int32Array | null = null;

  /**
   * Statically-passable neighbor cell indices of `idx`, as a zero-copy view
   * into the cached adjacency table. Built lazily on first call.
   */
  staticNeighborsOf(idx: number): Int32Array {
    if (!this.adjStart) this.buildAdjacency();
    return this.adjNeighbors!.subarray(this.adjStart![idx], this.adjStart![idx + 1]);
  }

  private buildAdjacency(): void {
    const N = this.cells;
    const start = new Int32Array(N + 1);
    const neighbors = new Int32Array(N * 4);
    const nbuf = this.neighborBuffer();
    const staticOpen = (cell: number): boolean => !this.isStaticBlockedIdx(cell);
    let filled = 0;
    for (let idx = 0; idx < N; idx++) {
      start[idx] = filled;
      if (this.isStaticBlockedIdx(idx)) continue;
      const nCount = this.fillUnitNeighbors(SNAKE_ADJACENCY, idx, staticOpen, nbuf);
      for (let t = 0; t < nCount; t++) {
        const n = nbuf[t];
        if (!this.isStaticBlockedIdx(n)) neighbors[filled++] = n;
      }
    }
    start[N] = filled;
    this.adjStart = start;
    this.adjNeighbors = neighbors.subarray(0, filled);
  }

  /**
   * Check if a coordinate is within board bounds.
   */
  isInBounds(coord: Coord): boolean {
    return coord.x >= 0 && coord.x < this.width &&
           coord.y >= 0 && coord.y < this.height;
  }
}
