/**
 * Unit-threat module: contest adjudication plus the per-decision UNIT threat
 * map — one mechanism answering, for every square, "which other units could
 * take this square next turn and hurt us there?" for BOTH unit kinds:
 * snakes (the old bespoke head-to-head adjacency scan) and chess pieces.
 *
 * CONTEST RULE (the engine's cell adjudication, tier FIRST, weight second):
 * when units contest a square, everyone below the top invulnerability tier at
 * the square dies with weight never consulted; among the top tier the unique
 * heaviest survives, and ties kill all. Both inputs are FROZEN at the start of
 * the turn — nothing a unit gains or loses during a turn can change how that
 * turn's collisions resolve — which is exactly what makes a snapshot of the
 * board a sound basis for this map. For pieces, `snake.length` carries the
 * WEIGHT (stack size), not a body cell count.
 * `winsStationaryContest` is the ONE encoding of that rule, shared by:
 *  - BoardGraph's subjective passability (may WE walk onto a piece square?),
 *  - the Simulator's mover-vs-stationary-piece resolution,
 *  - the threat map below (would the unit kill-or-tie US at a square?),
 *  - the projection's per-square adjudication (simulator.ts's projectPath),
 *  - the Voronoi BFS, twice over: `stationaryContestWinner` read as "who, if
 *    anyone, survives a multi-way race to one square?" for same-turn snake
 *    arrivals, and `winsStationaryContest` read as "could this piece hold that
 *    square against the snake that claimed it?" for piece displacement.
 *
 * PER-KIND REACH (one generator per unit kind). This is ATTACK reach, which
 * is deliberately NOT BoardGraph's movement adjacency (fillUnitNeighbors): a
 * pawn attacks its diagonals but moves only forward, and a snake's reach here
 * is unfiltered by legality. Two questions, two generators:
 *  - snake: the head's 4 orthogonal neighbors — deliberately UNfiltered by
 *    occupancy or legality (matching the legacy h2h scan: a snake whose only
 *    adjacent option is its own body still "threatens" the square; we don't
 *    model enemy-suicide filtering here).
 *  - sliders (rook/bishop/queen): rays from the current square, stopped by
 *    whichever comes first —
 *      · OCCUPANCY AT ARRIVAL: any unit body/stack stops the ray, but the
 *        blocker square itself IS reachable (contests happen there). Under
 *        frozen state an occupied square never clears mid-turn — not even when
 *        its occupant dies on it, because the corpse keeps fighting there for
 *        the rest of the turn — so the blocker really is the end of the ray.
 *        A multi-cell snake's LAST body index is excluded, because the engine
 *        pops every tail before collisions resolve: the square is guaranteed
 *        empty on arrival and the ray runs straight through it (a stacked
 *        tail's duplicate at the second-to-last index still blocks).
 *      · HEALTH: the engine charges 1 per square entered plus a full hazard
 *        dose per hazard square entered, per sub-step, and a unit whose health
 *        hits zero HALTS on that square. So a slider's range really is capped
 *        by what it can afford — a rook on 2 health cannot threaten a square
 *        five away, and it is not conservative to pretend it can, it is just
 *        wrong. The square where the health runs out IS still threatened: that
 *        sub-step's collisions are adjudicated before the charge, so an
 *        exhausted slider still kills on the square it halts on — and it halts
 *        there whether or not the cell goes on to feed it back to life.
 *  - knight: the 8 L-jumps; king: the 8 adjacent steps.
 *  - pawn: the faced square plus BOTH diagonal-forwards (from snake.orientation,
 *    wire convention — api cell of a wire delta d is {x + d.dx, y - d.dy}).
 *    Diagonals threaten regardless of current occupancy: occupancy can change
 *    under the pawn before the turn resolves.
 * Squares outside the api board are excluded.
 *
 * THREAT SEMANTICS (identical for both kinds): an ENEMY unit marks a
 * reachable square only when it would WIN OR TIE the contest against the
 * subject there (win-or-tie = the subject does not win — one rule, negated).
 * An ALLY unit marks every reachable square: we never want the trade,
 * whoever would survive it.
 *
 * TIER TIMING (one rule for both kinds): both sides' tiers are projected to
 * the ARRIVAL turn (currentTurn + 1) — a level counts iff
 * arrivalTurn <= invulnerabilityExpiryTurn — with fallback expiry =
 * arrivalTurn when no expiry schedule is derivable (a visible nonzero level
 * with unknown expiry is assumed to still govern the next resolution).
 *
 * Why this is safe AND matches the raw-current-level read on every real
 * document: the engine expires effects at the END of the resolution that
 * produces turn P (dropping expiryTurn <= P), AFTER collisions — so every
 * effect visible in a turn-T document has expiryTurn >= T+1 and always
 * governs the next resolution. Projection and raw read therefore agree
 * whenever expiry data exists; the fallback covers the remaining
 * missing-schedule case in the same direction (level still applies), which
 * is the conservative direction for assessing an ENEMY's tier. This differs
 * deliberately from BoardGraph/Simulator's own expires-now fallback, which
 * serves OWN-capability conservatism (assume our buff is gone) in
 * passability/severing.
 */

import { Board, Snake } from '../types/battlesnake';

/**
 * Does a unit with (ourTier, ourWeight) WIN a stationary-square contest
 * against (theirTier, theirWeight) — i.e. survive it while the other dies?
 * Tier first, weight second, ties kill all (so a tie is NOT a win).
 */
export function winsStationaryContest(
  ourTier: number,
  ourWeight: number,
  theirTier: number,
  theirWeight: number
): boolean {
  if (theirTier < ourTier) return true;
  if (theirTier > ourTier) return false;
  return ourWeight > theirWeight;
}

/**
 * The OTHER half of the same rule: do (ourTier, ourWeight) and
 * (theirTier, theirWeight) TIE — neither survives the square?
 *
 * `winsStationaryContest` is false for two very different outcomes: a LOSS
 * (they walk away, we die) and a TIE (nobody walks away). The engine's cell
 * contest leaves AT MOST ONE unique strict maximum standing and kills
 * everyone else, so a tie is MUTUAL DESTRUCTION — the
 * unit we tied with dies too, and that is a casualty the projection must
 * record. Same ordering as the win rule: tier first, then weight, so a tie is
 * exactly equal tier AND equal weight.
 */
export function tiesStationaryContest(
  ourTier: number,
  ourWeight: number,
  theirTier: number,
  theirWeight: number
): boolean {
  return ourTier === theirTier && ourWeight === theirWeight;
}

/**
 * The same rule applied to MANY contenders at once: given the first `count`
 * entries of parallel tier/weight arrays, which one — if any — walks off the
 * square alive? Tier first, weight second, ties kill all, so the answer is the
 * contender that WINS against every other one. Returns its index, or -1 when
 * nobody does (top tier shared by contenders whose heaviest weight is not
 * unique). Parallel arrays rather than objects so hot callers (the Voronoi
 * BFS) can reuse scratch buffers instead of allocating per contested square.
 */
export function stationaryContestWinner(
  tiers: ArrayLike<number>,
  weights: ArrayLike<number>,
  count: number
): number {
  if (count <= 0) return -1;
  // Best-so-far, then verify it beats everyone: a contender that fails to win
  // any single pairing does not survive, and no other can (it did not beat the
  // best), so the square has no survivor.
  let best = 0;
  for (let i = 1; i < count; i++) {
    if (winsStationaryContest(tiers[i], weights[i], tiers[best], weights[best])) best = i;
  }
  for (let i = 0; i < count; i++) {
    if (i === best) continue;
    if (!winsStationaryContest(tiers[best], weights[best], tiers[i], weights[i])) return -1;
  }
  return best;
}

/**
 * The unit's invulnerability tier as projected onto `arrivalTurn` — a level
 * counts iff the arrival turn is still within its expiry, with a missing
 * expiry schedule assumed to cover it (see TIER TIMING in the module doc).
 * The one place that projection is written; every consumer of arrival-turn
 * tiers reads it from here.
 */
export function tierAtTurn(unit: Snake, arrivalTurn: number): number {
  return arrivalTurn <= (unit.invulnerabilityExpiryTurn ?? arrivalTurn)
    ? (unit.invulnerabilityLevel ?? 0)
    : 0;
}

/**
 * Everything a contest needs to know about one unit, as of `baseTurn`: its
 * WEIGHT (`length` — stack size for pieces, body length for snakes) plus the
 * arrival-turn tier projection expressed against a number of turns from
 * `baseTurn`. Shaped to drop straight into a BFS source, which is why it
 * carries no game-state types outward.
 */
export function unitContestData(unit: Snake, baseTurn: number): {
  weight: number;
  tierAtDistance: (distance: number) => number;
} {
  return {
    weight: unit.length,
    tierAtDistance: (distance: number) => tierAtTurn(unit, baseTurn + distance),
  };
}

export const isPieceUnit = (s: Snake): boolean => (s.unitType ?? 'snake') !== 'snake';

/**
 * Is this unit a KING? The engine's regicide rule (TeamSnekProcessor's
 * applyRegicide) eliminates a team CONFIGURED with kings the moment its LAST
 * king dies, removing every remaining unit it owns that turn. A king only ever
 * enters play from the game setup (pawns promote to queens, never to kings),
 * so a team with a living king is exactly a team the rule applies to — which
 * is what lets the client decide regicide from the board alone.
 */
export const isKingUnit = (s: Snake): boolean => s.unitType === 'king';

export type UnitThreatKind = 'snake' | 'piece';

/** One unit threatening one square: who, which side, which reach/timing kind. */
export interface UnitThreatEntry {
  sourceUnitId: string;
  isAlly: boolean;
  sourceKind: UnitThreatKind;
}

export interface UnitThreatMap {
  width: number;
  height: number;
  /**
   * Sparse per-cell threat entries (index y * width + x); cells nobody
   * threatens hold undefined. Enemy entries already encode the contest
   * filter (an enemy the subject beats outright contributes nothing);
   * ally entries cover the unit's full reach.
   */
  entriesByCell: Array<UnitThreatEntry[] | undefined>;
}

/** Legacy piece-only projection of the unit threat map (counts per cell). */
export interface PieceThreatMap {
  width: number;
  height: number;
  /** Per-cell count of ENEMY pieces that could reach it next turn AND would win-or-tie the contest vs the subject. */
  enemyThreat: Uint8Array;
  /** Per-cell count of ALLY pieces that could reach it next turn (always an unwanted trade). */
  allyThreat: Uint8Array;
}

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/**
 * Every api-board square a SNAKE could move its head onto next turn: the 4
 * orthogonal neighbors, board-bounded but otherwise UNfiltered (no wall/body
 * legality — see the module doc). Cell indices (y * width + x).
 */
export function snakeReachableIdx(snakeUnit: Snake, board: Board): number[] {
  const W = board.width;
  const H = board.height;
  const { x, y } = snakeUnit.head;
  const out: number[] = [];
  for (const [dx, dy] of ORTHO) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) out.push(cy * W + cx);
  }
  return out;
}

/**
 * Every api-board square `piece` could reach with a single move next turn,
 * as cell indices (y * width + x). `occupied` marks unit occupancy AS OF THE
 * ARRIVAL TURN (any body/stack cell that has NOT vacated — see
 * computeUnitThreatMap's tail rule) and blocks slider rays beyond the blocker;
 * knight/king/pawn destinations ignore occupancy entirely (contests happen
 * on arrival). Slider rays are additionally capped by what the piece's health
 * can pay for (see PER-KIND REACH in the module doc). Exported for direct
 * geometry tests.
 */
export function pieceReachableIdx(piece: Snake, board: Board, occupied: Uint8Array): number[] {
  const W = board.width;
  const H = board.height;
  const { x, y } = piece.head;
  const out: number[] = [];
  const push = (cx: number, cy: number): void => {
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) out.push(cy * W + cx);
  };
  // The per-square bill a slider pays walking a ray. Hazard cells are the only
  // thing that makes a square cost more than 1, so a hazard-free board never
  // builds the set.
  const hazardDamage = board.hazardDamage ?? 100;
  const hazardIdx = new Set<number>();
  for (const h of board.hazards ?? []) {
    if (h.x >= 0 && h.x < W && h.y >= 0 && h.y < H) hazardIdx.add(h.y * W + h.x);
  }
  const rays = (dirs: ReadonlyArray<readonly [number, number]>): void => {
    for (const [dx, dy] of dirs) {
      let cx = x + dx;
      let cy = y + dy;
      // The health the piece carries into the ray. Each square it enters is
      // charged AFTER that square's collisions, so the square it can no longer
      // pay for is still threatened — it just cannot go on past it.
      let remaining = piece.health;
      while (cx >= 0 && cx < W && cy >= 0 && cy < H) {
        const idx = cy * W + cx;
        out.push(idx);
        if (occupied[idx] === 1) break; // blocker included, ray stops
        remaining -= 1 + (hazardIdx.has(idx) ? hazardDamage : 0);
        if (remaining <= 0) break; // exhausted: it halts on this square
        cx += dx;
        cy += dy;
      }
    }
  };

  switch (piece.unitType) {
    case 'rook':
      rays(ORTHO);
      break;
    case 'bishop':
      rays(DIAG);
      break;
    case 'queen':
      rays(ORTHO);
      rays(DIAG);
      break;
    case 'knight':
      for (const [dx, dy] of KNIGHT) push(x + dx, y + dy);
      break;
    case 'king':
      for (const [dx, dy] of [...ORTHO, ...DIAG]) push(x + dx, y + dy);
      break;
    case 'pawn': {
      const f = piece.orientation;
      // Wire deltas (y down); api cell of wire delta d is {x + d.dx, y - d.dy}.
      const deltas = [
        { dx: f.dx, dy: f.dy },                    // forward
        { dx: f.dx - f.dy, dy: f.dy + f.dx },      // diagonal-forward 1
        { dx: f.dx + f.dy, dy: f.dy - f.dx },      // diagonal-forward 2
      ];
      for (const d of deltas) push(x + d.dx, y - d.dy);
      break;
    }
    default:
      break; // unknown/snake: no piece moves
  }
  return out;
}

/**
 * Build the subject-relative UNIT threat map for one decision, or null when
 * no other living unit exists on the board. One computation covers both unit
 * kinds; per-kind reach and the shared tier-timing rule are documented in
 * the module header.
 */
export function computeUnitThreatMap(
  subject: Snake,
  board: Board,
  currentTurn: number,
  teamSnakeIds?: Set<string>
): UnitThreatMap | null {
  const others = board.snakes.filter((s) => s.health > 0 && s.id !== subject.id);
  if (others.length === 0) return null;

  const W = board.width;
  const H = board.height;
  const cells = W * H;

  // Occupancy AT ARRIVAL (every living unit's body/stack cells, heads
  // included, MINUS the squares guaranteed to be empty by then) is only
  // consulted by slider rays — built lazily so snake-only boards never pay
  // for it.
  //
  // The one square of the simultaneous body shift we can see from a pre-move
  // board is the TAIL: the engine pops every multi-cell snake's last segment
  // before any collision is resolved, eating or not (the advance that opens
  // each sub-step), so it has always vacated by the time an enemy ray gets
  // there. Nothing ELSE clears: under frozen state the board loses occupancy
  // only through movement, never through removal.
  // Blocking a ray on it would TRUNCATE the threat map and leave the squares
  // beyond it unmarked — an under-estimate of enemy reach, the one direction
  // a safety map must never err in. So the last body index of every multi-cell
  // snake is excluded, exactly the rule the cost projection already applies
  // (simulator.ts resolveTraversedSquare).
  //
  // A STACKED tail (the snake ate last turn, so the tail cell appears twice)
  // does NOT vacate: the duplicate at the second-to-last index is still there
  // after the pop and still blocks. Skipping only the LAST INDEX — rather than
  // clearing the tail SQUARE — is exact for that case, because the duplicate
  // marks the same cell on its own pass.
  let occupied: Uint8Array | null = null;
  const getOccupied = (): Uint8Array => {
    if (occupied) return occupied;
    occupied = new Uint8Array(cells);
    for (const s of board.snakes) {
      if (s.health <= 0) continue;
      // A piece is a 1-cell weight stack that never pops anything; only a
      // multi-cell SNAKE has a tail to vacate.
      const vacating = !isPieceUnit(s) && s.body.length > 1 ? s.body.length - 1 : -1;
      for (let i = 0; i < s.body.length; i++) {
        if (i === vacating) continue;
        const seg = s.body[i];
        if (seg.x >= 0 && seg.x < W && seg.y >= 0 && seg.y < H) {
          occupied[seg.y * W + seg.x] = 1;
        }
      }
    }
    return occupied;
  };

  // One tier-timing rule for both kinds (see module doc): arrival-turn
  // projection, with a missing expiry schedule assumed to still cover the
  // arrival turn.
  const arrivalTurn = currentTurn + 1;
  const tierOf = (s: Snake): number => tierAtTurn(s, arrivalTurn);

  const entriesByCell: Array<UnitThreatEntry[] | undefined> = new Array(cells);

  for (const unit of others) {
    const sourceKind: UnitThreatKind = isPieceUnit(unit) ? 'piece' : 'snake';
    const isAlly = teamSnakeIds?.has(unit.id) ?? false;
    // Enemy units only threaten where they would win-or-tie the contest —
    // exactly "the subject does NOT win" under the one shared rule. Allies
    // threaten their full reach regardless.
    if (!isAlly && winsStationaryContest(tierOf(subject), subject.length, tierOf(unit), unit.length)) {
      continue;
    }
    const reach = sourceKind === 'piece'
      ? pieceReachableIdx(unit, board, getOccupied())
      : snakeReachableIdx(unit, board);
    const entry: UnitThreatEntry = { sourceUnitId: unit.id, isAlly, sourceKind };
    for (const idx of reach) {
      (entriesByCell[idx] ??= []).push(entry);
    }
  }

  return { width: W, height: H, entriesByCell };
}

/**
 * Piece-only projection of the unit threat map (per-cell counts), or null on
 * a piece-free board (the common snake-only game — the caller pays nothing).
 * Kept as the module's piece-plane view; the mechanism lives entirely in
 * computeUnitThreatMap.
 */
export function computePieceThreatMap(
  subject: Snake,
  board: Board,
  currentTurn: number,
  teamSnakeIds?: Set<string>
): PieceThreatMap | null {
  const hasPiece = board.snakes.some(
    (s) => s.health > 0 && s.id !== subject.id && isPieceUnit(s)
  );
  if (!hasPiece) return null;

  const unitMap = computeUnitThreatMap(subject, board, currentTurn, teamSnakeIds)!;
  const cells = unitMap.width * unitMap.height;
  const enemyThreat = new Uint8Array(cells);
  const allyThreat = new Uint8Array(cells);
  for (let idx = 0; idx < cells; idx++) {
    const entries = unitMap.entriesByCell[idx];
    if (!entries) continue;
    for (const e of entries) {
      if (e.sourceKind !== 'piece') continue;
      const target = e.isAlly ? allyThreat : enemyThreat;
      if (target[idx] < 255) target[idx]++;
    }
  }
  return { width: unitMap.width, height: unitMap.height, enemyThreat, allyThreat };
}
