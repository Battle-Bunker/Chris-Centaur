/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/twin.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// THE TWIN-TIMELINE PROPERTY, SHIPPED WITH THE ENGINE (Bot B's demand: it
// found two genuine bugs in a bot's claim engine within minutes, and every
// bot author needs it).
//
// An INDEPENDENT WALKER whose movement tables are RE-DECLARED here — never
// imported from grammar.ts — walks one unit alone through seeded random legal
// turns with its own health, body-drag, growth and promotion arithmetic. A
// solo walk is a legal completion world (clouds ignore mobile blockers), so
// every cell it occupies must be inside any sound possible-presence claim.
// Run your claim against it: a null result is a few thousand walks' worth of
// evidence; a violation string is a bug with its coordinates.
//
// The walker covers the seven shipped kinds. A custom kind needs its own
// walker — re-declare its table here-style in your test, or the property is a
// tautology over the code it is checking.

import { UnitKind } from "./grammar.js";

export interface TwinClaim {
  /** Might ANY part of the unit stand at `cell`, `n` turns after the freeze? */
  readonly possibleAt: (n: number, cell: number) => boolean;
  /** Might its ARRIVING front (head / stack) stand there at exactly `n`? */
  readonly headPossibleAt: (n: number, cell: number) => boolean;
  /** Is the unit certainly gone by `n`? */
  readonly certainlyGoneAt: (n: number) => boolean;
}

export interface TwinWorld {
  readonly width: number;
  readonly height: number;
  /** Wall cells, the perimeter included if your board has one. */
  readonly walls: ReadonlySet<number>;
  readonly hazards: ReadonlySet<number>;
  /** Food cells at the freeze turn; the walker consumes them as it eats. */
  readonly food: ReadonlySet<number>;
  readonly hazardDamage: number;
  readonly maxHealth: number;
  /**
   * Per-kind maximum health, indexed by `UnitKind`; falls back to `maxHealth`.
   * The walker needs its own copy because the unit it walks CHANGES KIND at
   * promotion, and a pawn that promotes and then eats restores to the queen's
   * maximum. Leave it out for a flat game.
   */
  readonly maxHealthPerKind?: ReadonlyArray<number> | null;
  readonly promotionWeight: number;
}

export interface TwinUnit {
  readonly kind: UnitKind;
  /** Occupancy at the freeze, head first. */
  readonly cells: ReadonlyArray<number>;
  readonly health: number;
  readonly weight: number;
  readonly orientation: number;
}

/** mulberry32 — small, fast, fully seeded. */
function mulberry(seedN: number): () => number {
  let a = seedN >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORTH: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];
const LJUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

type Action =
  | { kind: "stay" }
  | { kind: "rotate"; orientation: number }
  | { kind: "move"; path: number[] };

interface WalkState {
  kind: number;
  cells: number[];
  health: number;
  weight: number;
  orientation: number;
  alive: boolean;
}

/**
 * Run seeded twin-timeline containment for one unit's claim: `turns` turns
 * per walk, `walks` independent walks. Returns null, or the first violation
 * with its coordinates. The claim's `n` is turns-held (1-based relative to
 * the freeze).
 */
export function twinTimelineViolation(
  claim: TwinClaim,
  unit: TwinUnit,
  world: TwinWorld,
  options: { readonly walks?: number; readonly turns?: number; readonly seed?: number } = {},
): string | null {
  const walks = options.walks ?? 200;
  const turns = options.turns ?? 5;
  const baseSeed = options.seed ?? 1;
  for (let w = 0; w < walks; w++) {
    const r = mulberry(baseSeed * 7919 + w * 104729);
    const food = new Set(world.food);
    const u: WalkState = {
      kind: unit.kind,
      cells: [...unit.cells],
      health: unit.health,
      weight: unit.weight,
      orientation: unit.orientation,
      alive: true,
    };
    for (let n = 1; n <= turns && u.alive; n++) {
      step(u, world, food, (r() * 4096) | 0);
      if (!u.alive) break;
      if (claim.certainlyGoneAt(n)) {
        return `walk ${w} turn ${n}: claim says certainly gone, walker is alive`;
      }
      for (const c of u.cells) {
        if (!claim.possibleAt(n, c)) {
          return `walk ${w} turn ${n}: walker occupies cell ${c}, OUTSIDE the possible claim`;
        }
      }
      const head = u.cells[0] as number;
      if (!claim.headPossibleAt(n, head)) {
        return `walk ${w} turn ${n}: walker stands at ${head}, outside the head claim`;
      }
    }
  }
  return null;
}

function inBoard(world: TwinWorld, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

function interior(world: TwinWorld, x: number, y: number): boolean {
  return x >= 1 && y >= 1 && x <= world.width - 2 && y <= world.height - 2;
}

function actionsOf(u: WalkState, world: TwinWorld, food: ReadonlySet<number>): Action[] {
  const W = world.width;
  const out: Action[] = [];
  const hx = (u.cells[0] as number) % W;
  const hy = ((u.cells[0] as number) / W) | 0;
  const openPiece = (c: number): boolean =>
    interior(world, c % W, (c / W) | 0) && !world.walls.has(c);
  if (u.kind === UnitKind.Snake) {
    for (const [dx, dy] of ORTH) {
      if (inBoard(world, hx + dx, hy + dy)) {
        out.push({ kind: "move", path: [(hy + dy) * W + hx + dx] }); // walls included: legal, fatal
      }
    }
    return out;
  }
  out.push({ kind: "stay" });
  if (u.kind === UnitKind.Pawn) {
    const [fx, fy] = ORTH[u.orientation & 3] as readonly [number, number];
    if (inBoard(world, hx + fx, hy + fy) && openPiece((hy + fy) * W + hx + fx)) {
      out.push({ kind: "move", path: [(hy + fy) * W + hx + fx] });
    }
    for (const [gx, gy] of [
      [fx + fy, fy - fx],
      [fx - fy, fy + fx],
    ]) {
      const c = (hy + (gy as number)) * W + hx + (gx as number);
      if (inBoard(world, hx + (gx as number), hy + (gy as number)) && openPiece(c) && food.has(c)) {
        out.push({ kind: "move", path: [c] });
      }
    }
    out.push({ kind: "rotate", orientation: (u.orientation + 1) & 3 });
    out.push({ kind: "rotate", orientation: (u.orientation + 3) & 3 });
    return out;
  }
  const steps =
    u.kind === UnitKind.Knight ? LJUMPS : u.kind === UnitKind.King ? [...ORTH, ...DIAG] : [];
  for (const [dx, dy] of steps) {
    if (inBoard(world, hx + dx, hy + dy) && openPiece((hy + dy) * W + hx + dx)) {
      out.push({ kind: "move", path: [(hy + dy) * W + hx + dx] });
    }
  }
  const rays =
    u.kind === UnitKind.Rook
      ? ORTH
      : u.kind === UnitKind.Bishop
        ? DIAG
        : u.kind === UnitKind.Queen
          ? [...ORTH, ...DIAG]
          : [];
  for (const [dx, dy] of rays) {
    const path: number[] = [];
    let x = hx + dx;
    let y = hy + dy;
    while (inBoard(world, x, y) && openPiece(y * W + x)) {
      path.push(y * W + x);
      out.push({ kind: "move", path: [...path] });
      x += dx;
      y += dy;
    }
  }
  return out;
}

function step(u: WalkState, world: TwinWorld, food: Set<number>, pick: number): void {
  const actions = actionsOf(u, world, food);
  if (actions.length === 0) {
    u.alive = false;
    return;
  }
  const action = actions[pick % actions.length] as Action;
  if (action.kind === "rotate") {
    u.orientation = action.orientation;
  } else if (action.kind === "move") {
    const isTrail = u.kind === UnitKind.Snake;
    for (const c of action.path) {
      if (isTrail) {
        u.cells.pop();
        u.cells.unshift(c);
      } else {
        u.cells = [c];
      }
      if (world.walls.has(c)) {
        u.alive = false;
        return;
      }
      u.health -= 1;
      if (world.hazards.has(c)) u.health -= world.hazardDamage;
      if (u.health <= 0) break;
    }
  } else if (world.hazards.has(u.cells[0] as number)) {
    u.health -= world.hazardDamage;
  }
  const standing = u.cells[0] as number;
  if (food.has(standing)) {
    food.delete(standing);
    u.health = world.maxHealthPerKind?.[u.kind] ?? world.maxHealth;
    u.weight += 1;
    if (u.kind === UnitKind.Snake) u.cells.push(u.cells[u.cells.length - 1] as number);
  }
  if (u.health <= 0) u.alive = false;
  if (u.kind === UnitKind.Pawn && u.weight >= world.promotionWeight) {
    u.kind = UnitKind.Queen;
    u.weight = 1;
  }
}
