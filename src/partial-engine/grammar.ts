/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/grammar.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// The multi-unit grammar seam — the one place unit-kind names still matter.
// Everything downstream is property-driven: it asks whether a unit leaves a
// trail, whether it traverses edges, what a cell of movement costs, and what
// path it walks. (Substrate harvested from cand-i; pawn, orientation, the
// profile registry, per-cell cost and the free-function action enumerator
// added per the deliberation delta and cand-j's churn-guard pattern.)
//
// THE CHURN GUARD (cand-j §4.2): a kind declares exactly one movement
// interpretation — `planAction` reads its profile — and `enumerateActions` is
// a FREE FUNCTION that folds the kind-agnostic intent universe (every cell of
// the board) through that one interpretation. A new kind therefore has no
// dilation and no enumerator of its own to forget: dilation (cloud.ts), the
// mover (engine.ts) and enumeration all consume the same profile, so a rule
// tweak made in the profile reaches all three or none.
//
// Scope: snake (trail), knight (jump), king (step), rook/bishop/queen
// (sliders), pawn (oriented steps, rotation, promotion threshold read by the
// engine and the cloud from config). Custom kinds may be registered through
// `registerKindProfile`; offsets are bounded by |dx| ≤ MAX_DX (bitgrid.ts),
// and a profile that exceeds it FAILS LOUDLY at registration.

import type { Board, Grid } from "./bitgrid.js";
import { MAX_DX, bbAnd, bbCopy, bbFill, bbOr, bbShift, bbTest, bbZero } from "./bitgrid.js";

export const UnitKind = {
  Snake: 0,
  Knight: 1,
  King: 2,
  Rook: 3,
  Bishop: 4,
  Queen: 5,
  Pawn: 6,
} as const;
/**
 * A kind is an index into the profile registry. The seven shipped kinds have
 * named constants; a registered custom kind is an ordinary index past them.
 * Everything downstream is property-driven, so widening this to `number` costs
 * no exhaustiveness anywhere — no switch on kind exists outside this file.
 */
export type UnitKind = number;

export const UNIT_KIND_NAMES: ReadonlyArray<string> = [
  "snake",
  "knight",
  "king",
  "rook",
  "bishop",
  "queen",
  "pawn",
];

export type Offset = readonly [dx: number, dy: number];

export const ORTHOGONALS: ReadonlyArray<Offset> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIAGONALS: ReadonlyArray<Offset> = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT_OFFSETS: ReadonlyArray<Offset> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const NO_OFFSETS: ReadonlyArray<Offset> = [];

export interface KindProfile {
  readonly kind: UnitKind;
  readonly name: string;
  /** Occupancy trails the head; trail cells are severable body-walls. */
  readonly leavesTrail: boolean;
  /** False for a jump, the only thing that exempts a unit from an edge exchange. */
  readonly traversesEdges: boolean;
  /** Pieces may hold; a trail unit has momentum and must step. */
  readonly stayLegal: boolean;
  /** Single-cell offsets this kind may take (empty for pure sliders). */
  readonly steps: ReadonlyArray<Offset>;
  /** Ray directions this kind may slide along (empty for steppers). */
  readonly rays: ReadonlyArray<Offset>;
  /** A trail unit may stage a wall cell: walking into the perimeter is legal and fatal. */
  readonly mayEnterWall: boolean;
  /** A bishop never leaves its own colour — free, permanent, exact narrowing. */
  readonly colourBound: boolean;
  /**
   * Health charged per cell ENTERED — the one number the mover, the cloud's
   * reach cap and the arrival-grid recurrence all read. Changing what movement
   * costs is one edit here, and the uncertainty layer adapts with zero edits
   * (the churn demonstration pins this).
   */
  readonly costPerCell: number;
  /**
   * Legality depends on the unit's orientation (pawn). An oriented kind's
   * `steps` are interpreted RELATIVE to orientation index o (into ORTHOGONALS):
   * forward, the two diagonal-forwards; rotation and stay are handled by
   * planAction. Its cloud is dilated per-pose (cloud.ts).
   */
  readonly oriented: boolean;
  /**
   * The kind this one promotes to when its weight reaches the configured
   * threshold (engine config `pawnPromotionWeight`), or null. Promotion RESETS
   * weight to 1 — the one place weight goes down without a death.
   */
  readonly promotesTo: UnitKind | null;
}

const PROFILES: KindProfile[] = [
  {
    kind: UnitKind.Snake,
    name: "snake",
    leavesTrail: true,
    traversesEdges: true,
    stayLegal: false,
    steps: ORTHOGONALS,
    rays: NO_OFFSETS,
    mayEnterWall: true,
    colourBound: false,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    kind: UnitKind.Knight,
    name: "knight",
    leavesTrail: false,
    traversesEdges: false,
    stayLegal: true,
    steps: KNIGHT_OFFSETS,
    rays: NO_OFFSETS,
    mayEnterWall: false,
    colourBound: false,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    kind: UnitKind.King,
    name: "king",
    leavesTrail: false,
    traversesEdges: true,
    stayLegal: true,
    steps: [...ORTHOGONALS, ...DIAGONALS],
    rays: NO_OFFSETS,
    mayEnterWall: false,
    colourBound: false,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    kind: UnitKind.Rook,
    name: "rook",
    leavesTrail: false,
    traversesEdges: true,
    stayLegal: true,
    steps: NO_OFFSETS,
    rays: ORTHOGONALS,
    mayEnterWall: false,
    colourBound: false,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    kind: UnitKind.Bishop,
    name: "bishop",
    leavesTrail: false,
    traversesEdges: true,
    stayLegal: true,
    steps: NO_OFFSETS,
    rays: DIAGONALS,
    mayEnterWall: false,
    colourBound: true,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    kind: UnitKind.Queen,
    name: "queen",
    leavesTrail: false,
    traversesEdges: true,
    stayLegal: true,
    steps: NO_OFFSETS,
    rays: [...ORTHOGONALS, ...DIAGONALS],
    mayEnterWall: false,
    colourBound: false,
    costPerCell: 1,
    oriented: false,
    promotesTo: null,
  },
  {
    // The pawn: oriented, rotating, promoting. Its `steps` field is empty
    // because its steps are orientation-relative and owned by planAction /
    // orientedStepsOf; the generic step loop must not read absolute offsets
    // for it.
    kind: UnitKind.Pawn,
    name: "pawn",
    leavesTrail: false,
    traversesEdges: true,
    stayLegal: true,
    steps: NO_OFFSETS,
    rays: NO_OFFSETS,
    mayEnterWall: false,
    colourBound: false,
    costPerCell: 1,
    oriented: true,
    promotesTo: UnitKind.Queen,
  },
];

export function profileOf(kind: UnitKind): KindProfile {
  const p = PROFILES[kind];
  if (p === undefined) throw new Error(`unknown unit kind ${kind}`);
  return p;
}

/**
 * Register a custom kind. Fails loudly on offsets the bitboard geometry cannot
 * shift (|dx| > MAX_DX) — a silent clamp here would be a silently-too-small
 * cloud, the one error class this subsystem exists to exclude.
 */
export function registerKindProfile(profile: Omit<KindProfile, "kind">): UnitKind {
  for (const [dx] of [...profile.steps, ...profile.rays]) {
    if (Math.abs(dx) > MAX_DX) {
      throw new Error(
        `kind "${profile.name}" declares a step with |dx| = ${Math.abs(dx)} > ${MAX_DX}; the bitboard shift masks cannot express it (bitgrid.ts MAX_DX)`,
      );
    }
  }
  if (!Number.isFinite(profile.costPerCell) || profile.costPerCell <= 0) {
    throw new Error(`kind "${profile.name}" declares a non-positive costPerCell`);
  }
  const kind = PROFILES.length;
  PROFILES.push({ ...profile, kind });
  return kind;
}

/** Registered kind count — custom kinds live at indices ≥ the shipped seven. */
export function kindCount(): number {
  return PROFILES.length;
}

/**
 * THE PROPERTY TABLE AS DATA (bot-workstream demand): a snapshot of every
 * registered kind's profile — steps, rays, trail/edge/stay/wall properties,
 * per-cell cost, orientation-bearing flag, promotion target. Published so no
 * client ever transcribes the grammar (a transcription is a second encoding
 * that WILL drift); consume this table, or the functions above, never a copy.
 */
export function kindProfiles(): ReadonlyArray<KindProfile> {
  return PROFILES.map((p) => ({ ...p, steps: [...p.steps], rays: [...p.rays] }));
}

// ---------------------------------------------------------------------------
// Orientation (pawns; also every unit's cosmetic facing)
// ---------------------------------------------------------------------------

/**
 * Orientation index into ORTHOGONALS: 0 up, 1 right, 2 down, 3 left.
 *
 * FOUR-WAY, DELIBERATELY, and it does not round-trip the wire's eight.
 * TacticToes carries orientation as a `{dx, dy}` that may be diagonal for a
 * king, queen or bishop; there is no index for that here, so a consumer must
 * project onto the nearest orthogonal — through `orientationOf`, never by
 * hand.
 *
 * That projection is LOSSY AND CURRENTLY HARMLESS, which is exactly the
 * combination that rots silently, so the reasoning is written down rather than
 * left to be rediscovered. Orientation is read in exactly two places:
 *
 *   · pawn legality (`oriented` kinds) — and the pawn is orthogonal-facing;
 *   · the trail unit's default action, "continue straight" — and a trail unit
 *     is orthogonal-facing.
 *
 * No diagonal-facing kind reads it: for a king, queen or bishop it is
 * cosmetic, and the engine's own end-of-turn rewrite sets it from the
 * direction of the unit's first step. So a projected facing cannot change an
 * adjudication today. It WOULD the moment a diagonal-facing kind became
 * `oriented` (a diagonal pawn, a facing-gated ability), and that change must
 * widen this type rather than pick a nearest orthogonal — see
 * ENGINEERING-BACKLOG.md.
 */
export type OrientationIndex = number;

/**
 * The orientation index for a direction vector, projecting a diagonal onto
 * the nearest orthogonal (ties to the horizontal, matching the engine's own
 * end-of-turn rewrite). NAMED so the projection is a decision a consumer can
 * find, not four lines it wrote itself and forgot were lossy.
 */
export function orientationOf(dx: number, dy: number): OrientationIndex {
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy < 0 ? 0 : 2;
  if (dy === 0) return dx > 0 ? 1 : 3;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
}

/** The direction vector an orientation index stands for. */
export function vectorOf(o: OrientationIndex): { dx: number; dy: number } {
  const [dx, dy] = ORTHOGONALS[o & 3] as Offset;
  return { dx, dy };
}

export const rotLeft = (o: OrientationIndex): OrientationIndex => (o + 3) & 3;
export const rotRight = (o: OrientationIndex): OrientationIndex => (o + 1) & 3;

/** Forward and the two diagonal-forward offsets for orientation `o`. */
export function orientedStepsOf(o: OrientationIndex): {
  forward: Offset;
  diagonals: [Offset, Offset];
  sides: [Offset, Offset];
} {
  const [fx, fy] = ORTHOGONALS[o & 3] as Offset;
  // Perpendiculars: rotate forward ±90°.
  const l: Offset = [fy, -fx];
  const r: Offset = [-fy, fx];
  return {
    forward: [fx, fy],
    diagonals: [
      [fx + fy, fy - fx],
      [fx - fy, fy + fx],
    ],
    sides: [l, r],
  };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** Static board data every geometry question is asked against. */
export interface Terrain {
  readonly grid: Grid;
  /** Cells that kill a unit entering them. */
  readonly wall: Board;
  readonly hazard: Board;
  /** Non-wall cells — where a trail unit may stand alive. */
  readonly open: Board;
  /** Interior non-wall cells — where a piece may stand at all. */
  readonly pieceOpen: Board;
}

export function makeTerrain(
  grid: Grid,
  wallCells: Iterable<number>,
  hazardCells: Iterable<number>,
): Terrain {
  const wall = new Uint32Array(grid.words);
  const hazard = new Uint32Array(grid.words);
  // The perimeter ring is wall by convention; callers may add more.
  for (let c = 0; c < grid.cells; c++) {
    const x = c % grid.width;
    const y = (c / grid.width) | 0;
    if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) {
      wall[c >>> 5] = (wall[c >>> 5] as number) | (1 << (c & 31));
    }
  }
  for (const c of wallCells) wall[c >>> 5] = (wall[c >>> 5] as number) | (1 << (c & 31));
  for (const c of hazardCells) hazard[c >>> 5] = (hazard[c >>> 5] as number) | (1 << (c & 31));
  const open = new Uint32Array(grid.words);
  const pieceOpen = new Uint32Array(grid.words);
  for (let i = 0; i < grid.words; i++) {
    open[i] = (grid.full[i] as number) & ~(wall[i] as number);
    pieceOpen[i] = (grid.interior[i] as number) & ~(wall[i] as number);
  }
  return { grid, wall, hazard, open, pieceOpen };
}

/** Where a unit of this kind may legally stand. */
export const standableFor = (terrain: Terrain, kind: UnitKind): Board =>
  profileOf(kind).mayEnterWall ? terrain.open : terrain.pieceOpen;

// ---------------------------------------------------------------------------
// Actions — the ONE interpretation of a staged intent
// ---------------------------------------------------------------------------

/**
 * What a staged destination cell means for a unit. `move` carries the cells
 * entered, one per sub-step; `rotate` is a whole-turn action that enters
 * nothing (pawns; staged as a side cell, which is signalling and never
 * entered, so it is legal wherever that cell falls — including the wall);
 * `stay` enters nothing and costs nothing.
 */
export type UnitAction =
  | { readonly kind: "stay" }
  | { readonly kind: "move"; readonly path: ReadonlyArray<number> }
  | { readonly kind: "rotate"; readonly orientation: OrientationIndex };

/**
 * Interpret a staged destination as this kind's action, or null when the
 * destination is not legal for it — the caller substitutes the kind's default.
 *
 * `targets` is the set of cells a pawn's diagonal-forward attack step may
 * enter: every cell holding food or another unit at the start of the turn.
 * Pass `null` when unknown; a pawn's diagonal is then treated as ILLEGAL for a
 * concrete mover (conservative for the mover) — the cloud, which cannot know
 * future targets, over-approximates separately (dilateOriented).
 *
 * Chess-style blocking does not exist at staging time: moves are simultaneous
 * and hidden, so whether a ray is actually blocked is discovered in flight.
 */
export function planAction(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  dest: number,
  orientation: OrientationIndex,
  targets: Board | null,
): UnitAction | null {
  const n = planActionInto(terrain, kind, origin, dest, orientation, targets, ACTION_SCRATCH);
  if (n === ACTION_ILLEGAL) return null;
  // A FRESH object, exactly as before. A shared singleton would be cheaper and
  // would also change what `===` says about two callers' actions, and this is
  // the published surface.
  if (n === 0) return { kind: "stay" };
  if (n > 0) {
    const path = new Array<number>(n);
    for (let i = 0; i < n; i++) path[i] = ACTION_SCRATCH[i] as number;
    return { kind: "move", path };
  }
  return { kind: "rotate", orientation: (ACTION_ROTATE - n) as OrientationIndex };
}

/**
 * `planAction`, WITHOUT THE ACTION OBJECT.
 *
 * The resolver asks this question once per live unit per turn and throws the
 * answer's shape away immediately — it copies `path` into its own scratch and
 * reads `orientation` into an array. Building `{ kind, path }` for it was
 * pure garbage on the hottest path the grammar has; on a 23×23 piece board
 * `planAction` was 12% of everything a resolution allocated.
 *
 * The encoding, and it is deliberately not an object:
 *
 *   `ACTION_ILLEGAL` (−1)  the destination is not legal for this kind; the
 *                          caller substitutes the kind's own default.
 *   `0`                    STAY. Nothing is written to `out`.
 *   `n > 0`                MOVE. `out[0..n)` are the cells entered, in order.
 *   `n ≤ −2`               ROTATE, to orientation `ACTION_ROTATE − n`.
 *
 * `out` must have room for a whole ray — `max(width, height)` cells, which is
 * what the resolver's `maxPath` already is.
 *
 * NOT EXPORTED FROM `index.ts`: this is the internal form, and `planAction` /
 * `pathFor` remain the surface every consumer outside this directory sees.
 */
export const ACTION_ILLEGAL = -1;
/** `orientation = ACTION_ROTATE − code` for a rotate code (−2 ⇒ 0, −5 ⇒ 3). */
export const ACTION_ROTATE = -2;
const ACTION_SCRATCH: number[] = [];

export function planActionInto(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  dest: number,
  orientation: OrientationIndex,
  targets: Board | null,
  out: number[],
): number {
  const grid = terrain.grid;
  if (!Number.isInteger(dest) || dest < 0 || dest >= grid.cells) return ACTION_ILLEGAL;
  const profile = profileOf(kind);
  const ox = origin % grid.width;
  const oy = (origin / grid.width) | 0;
  const dx = (dest % grid.width) - ox;
  const dy = ((dest / grid.width) | 0) - oy;

  if (dest === origin) return profile.stayLegal ? 0 : ACTION_ILLEGAL;

  const standable = standableFor(terrain, kind);
  const legalTarget = bbTest(standable, dest);

  if (profile.oriented) {
    const steps = orientedStepsOf(orientation);
    const forward = steps.forward;
    const sides = steps.sides;
    if (dx === forward[0] && dy === forward[1]) {
      if (!legalTarget) return ACTION_ILLEGAL;
      out[0] = dest;
      return 1;
    }
    // Side squares: a full-turn quarter rotation toward that side. Never
    // entered, so legal wherever the cell falls — walls included.
    if (dx === sides[0][0] && dy === sides[0][1]) return ACTION_ROTATE - rotLeft(orientation);
    if (dx === sides[1][0] && dy === sides[1][1]) return ACTION_ROTATE - rotRight(orientation);
    const diagonals = steps.diagonals;
    for (let k = 0; k < diagonals.length; k++) {
      const g = diagonals[k] as Offset;
      if (dx === g[0] && dy === g[1]) {
        if (!legalTarget || targets === null || !bbTest(targets, dest)) return ACTION_ILLEGAL;
        out[0] = dest;
        return 1;
      }
    }
    return ACTION_ILLEGAL;
  }

  const steps = profile.steps;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k] as Offset;
    if (s[0] === dx && s[1] === dy) {
      // A trail unit may stage a wall cell — walking into the perimeter is a
      // legal, fatal move. A piece may only ever enter the interior.
      if (!legalTarget && !profile.mayEnterWall) return ACTION_ILLEGAL;
      out[0] = dest;
      return 1;
    }
  }

  const rays = profile.rays;
  for (let k = 0; k < rays.length; k++) {
    const r = rays[k] as Offset;
    const rx = r[0];
    const ry = r[1];
    // Same direction and a whole number of steps along it?
    const n = rx !== 0 ? dx / rx : dy / ry;
    if (!Number.isInteger(n) || n <= 0) continue;
    if (dx !== rx * n || dy !== ry * n) continue;
    if (!legalTarget) return ACTION_ILLEGAL;
    const stride = ry * grid.width + rx;
    for (let i = 1; i <= n; i++) out[i - 1] = origin + stride * i;
    return n;
  }
  return ACTION_ILLEGAL;
}

/**
 * The cells a staged destination makes the unit enter, one per sub-step
 * written into `out`, or `null` when the destination is not a legal MOVE for
 * this kind (stays and rotations are not moves). The move-only view of
 * planAction, kept allocation-free for the cloud and the narrower.
 */
export function pathFor(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  dest: number,
  out: number[],
  orientation: OrientationIndex = 0,
  targets: Board | null = null,
): number | null {
  // It says allocation-free at the top of this block and now it is one: it used
  // to go through `planAction`, which built the very object this signature
  // exists to avoid.
  const n = planActionInto(terrain, kind, origin, dest, orientation, targets, out);
  return n >= 0 ? n : null;
}

/**
 * What a unit does when nothing legal was staged. A trail unit has momentum and
 * continues straight along its orientation, wherever that leads (walls
 * included). A piece has none, so it holds — and holding is never an assumed
 * move, because it is the kind's own default, not a guess about a frozen agent.
 */
export function defaultPath(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  orientation: number,
  out: number[],
): number {
  const profile = profileOf(kind);
  if (!profile.leavesTrail) return 0;
  const grid = terrain.grid;
  const [dx, dy] = ORTHOGONALS[orientation & 3] as Offset;
  const x = (origin % grid.width) + dx;
  const y = ((origin / grid.width) | 0) + dy;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  out[0] = y * grid.width + x;
  return 1;
}

/** Every legal destination for a unit of this kind standing at `origin`. */
export function legalMoves(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  orientation: OrientationIndex = 0,
  targets: Board | null = null,
): number[] {
  const grid = terrain.grid;
  const profile = profileOf(kind);
  const standable = standableFor(terrain, kind);
  const out: number[] = [];
  const ox = origin % grid.width;
  const oy = (origin / grid.width) | 0;
  const push = (dx: number, dy: number, wallsToo: boolean): void => {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
    const c = y * grid.width + x;
    if (wallsToo || bbTest(standable, c)) out.push(c);
  };
  if (profile.stayLegal) out.push(origin);
  if (profile.oriented) {
    const { forward, diagonals, sides } = orientedStepsOf(orientation);
    push(forward[0], forward[1], false);
    // Side squares stage rotations and are legal wherever they fall.
    push(sides[0][0], sides[0][1], true);
    push(sides[1][0], sides[1][1], true);
    for (const [gx, gy] of diagonals) {
      const x = ox + gx;
      const y = oy + gy;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      const c = y * grid.width + x;
      if (bbTest(standable, c) && targets !== null && bbTest(targets, c)) out.push(c);
    }
    return out;
  }
  for (const [dx, dy] of profile.steps) push(dx, dy, profile.mayEnterWall);
  for (const [dx, dy] of profile.rays) {
    let x = ox + dx;
    let y = oy + dy;
    while (x >= 0 && y >= 0 && x < grid.width && y < grid.height) {
      const c = y * grid.width + x;
      if (!bbTest(standable, c)) break;
      out.push(c);
      x += dx;
      y += dy;
    }
  }
  return out;
}

/**
 * THE CANONICAL PAWN-TARGET SET: every cell holding food or ANY unit's
 * occupancy at the start of the turn — the set a pawn's diagonal-forward
 * attack step is legal into. Exported because any client enumerating pawn
 * candidates must reproduce this set EXACTLY or it silently disagrees with
 * the engine's own legality; building it twice is how the disagreement
 * happens. `occupancies` covers live units AND frozen records alike — a
 * frozen unit's record cells are its turn-start occupancy, which is known
 * even though nobody modelled its choice.
 *
 * Writes into `dst` (cleared first) and returns it.
 */
export function pawnTargetsInto(
  grid: Grid,
  dst: Board,
  food: Board | null,
  occupancies: Iterable<ReadonlyArray<number>>,
): Board {
  bbZero(dst, grid.words);
  if (food !== null) bbOr(dst, food, grid.words);
  for (const cells of occupancies) {
    for (const c of cells) dst[c >>> 5] = (dst[c >>> 5] as number) | (1 << (c & 31));
  }
  return dst;
}

// ---------------------------------------------------------------------------
// The free-function enumerator — cand-j's churn guard, and the delta's D2:
// ONE enumerator serves subject branching, enemy branching (exact mode) and
// narrowing. Paths are prefix-closed by construction: a slider's every ray
// prefix is itself a legal destination, so "it halted early" is an outcome
// already inside the enumerated set and blocking never has to be modelled to
// keep a claim sound.
// ---------------------------------------------------------------------------

/** One enumerated candidate: the staged destination and the action it means. */
export interface Candidate {
  readonly dest: number;
  readonly action: UnitAction;
}

/**
 * Every distinct action a unit could take, computed by folding the intent
 * universe — every cell of the board — through the kind's ONE interpretation
 * (`planAction`), deduplicating by canonical effect, and adding the kind's
 * default. NOT a member of the profile: a new kind has no enumerator of its
 * own to forget, and containment is a theorem rather than a check — the mover
 * computes `planAction(intent) ?? default`, which is a member of this set for
 * ANY intent.
 */
export function enumerateActions(
  terrain: Terrain,
  kind: UnitKind,
  origin: number,
  orientation: OrientationIndex = 0,
  targets: Board | null = null,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (dest: number, action: UnitAction): void => {
    const key =
      action.kind === "move"
        ? `m:${action.path.join(",")}`
        : action.kind === "rotate"
          ? `r:${action.orientation}`
          : "s";
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ dest, action });
  };
  for (let dest = 0; dest < terrain.grid.cells; dest++) {
    const action = planAction(terrain, kind, origin, dest, orientation, targets);
    if (action !== null) add(dest, action);
  }
  // The default: what the mover does when nothing legal was staged. For a
  // piece that is "stay" (already enumerated); for a trail unit it is the
  // momentum step, whose destination may be a wall cell the loop above already
  // offered (snakes may stage walls) — dedupe covers both.
  const scratch: number[] = [];
  const n = defaultPath(terrain, kind, origin, orientation, scratch);
  if (n > 0) add(scratch[0] as number, { kind: "move", path: scratch.slice(0, n) });
  else if (profileOf(kind).stayLegal) add(origin, { kind: "stay" });
  return out;
}

// ---------------------------------------------------------------------------
// Cloud dilation — the same grammar, expressed as set operations
// ---------------------------------------------------------------------------

/** Scratch boards a dilation needs. Owned by the caller, never allocated here. */
export interface DilateScratch {
  readonly a: Board;
  readonly b: Board;
  readonly c: Board;
}

export function makeScratch(grid: Grid): DilateScratch {
  return {
    a: new Uint32Array(grid.words),
    b: new Uint32Array(grid.words),
    c: new Uint32Array(grid.words),
  };
}

/**
 * `dst := ` where a unit of this kind might stand one turn after standing
 * somewhere in `src`.
 *
 * Blockers are STATIC terrain only: mobile units never narrow a cloud, which
 * over-approximates (sound) and keeps the result a pure function of the frozen
 * unit, so it can be memoized once and shared by pointer across every sibling
 * state in the tree.
 *
 * `maxRay` caps ray length by the unit's health budget: movement costs
 * `costPerCell` health per cell entered, so a unit can never enter more cells
 * than its health affords. Real narrowing on a damaged slider, free when it is
 * healthy.
 *
 * For an ORIENTED kind (pawn) this pose-blind form takes the union over every
 * orientation — sound whenever the pose is unknown. The pose-exact dilation is
 * `dilateOriented`, which the cloud timeline uses.
 */
export function dilate(
  terrain: Terrain,
  kind: UnitKind,
  dst: Board,
  src: Board,
  maxRay: number,
  scratch: DilateScratch,
): void {
  const grid = terrain.grid;
  const w = grid.words;
  const profile = profileOf(kind);
  const standable = standableFor(terrain, kind);

  if (profile.stayLegal) bbCopy(dst, src, w);
  else bbZero(dst, w);

  if (profile.oriented) {
    // Union over poses: forward + both diagonals for each of the four
    // orientations = the 8 neighbours; stay already copied. Rotation stays on
    // the cell, which stay covers.
    for (const [dx, dy] of [...ORTHOGONALS, ...DIAGONALS]) {
      bbShift(grid, scratch.a, src, dx, dy);
      bbAnd(scratch.a, standable, w);
      bbOr(dst, scratch.a, w);
    }
    return;
  }

  for (const [dx, dy] of profile.steps) {
    bbShift(grid, scratch.a, src, dx, dy);
    bbAnd(scratch.a, standable, w);
    bbOr(dst, scratch.a, w);
  }
  for (const [dx, dy] of profile.rays) {
    bbFill(grid, dst, src, dx, dy, standable, scratch.a, scratch.b, maxRay);
  }
}

/**
 * Pose-exact one-turn dilation for an oriented kind: `dstByPose[o]` becomes
 * where the unit could stand FACING o after one more turn, given the per-pose
 * fronts in `srcByPose`. The pawn's moves per pose: stay (same cell, same
 * pose), forward (enter, same pose), diagonal-forward ×2 (enter, same pose —
 * over-approximated as always-legal, because whether a target stood there in
 * an unrecorded turn is exactly the unmodelled fact), rotate left/right (same
 * cell, adjacent pose).
 *
 * `dstByPose` must not alias `srcByPose` entries.
 */
export function dilateOriented(
  terrain: Terrain,
  kind: UnitKind,
  dstByPose: ReadonlyArray<Board>,
  srcByPose: ReadonlyArray<Board>,
  scratch: DilateScratch,
): void {
  const grid = terrain.grid;
  const w = grid.words;
  const standable = standableFor(terrain, kind);
  for (let o = 0; o < 4; o++) {
    const dst = dstByPose[o] as Board;
    const src = srcByPose[o] as Board;
    // stay + rotations INTO this pose.
    bbCopy(dst, src, w);
    bbOr(dst, srcByPose[rotLeft(o)] as Board, w);
    bbOr(dst, srcByPose[rotRight(o)] as Board, w);
    // forward and the two diagonal-forwards, staying in pose o.
    const { forward, diagonals } = orientedStepsOf(o);
    for (const [dx, dy] of [forward, ...diagonals]) {
      bbShift(grid, scratch.a, src, dx, dy);
      bbAnd(scratch.a, standable, w);
      bbOr(dst, scratch.a, w);
    }
  }
}
