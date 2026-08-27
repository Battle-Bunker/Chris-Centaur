/**
 * CONFIG -> the initial board, in the exact shape the vendored resolver's
 * caller consumes.
 *
 * The object built here is a plain api `Board` (src/types/battlesnake.ts) —
 * byte-for-byte the thing `firebase-interface.ts` assembles from a Firestore
 * turn document and hands the decision layer, and the thing `marshalBoard`
 * turns into `ResolveTurnInput`. Nothing here re-implements a rule: placement,
 * food layout, hazard layout and fertile ground are all SPAWNING, which the
 * resolver deliberately does not carry (`resolveTurn.ts:35-39`), and which the
 * server does in `TeamSnekProcessor`.
 *
 * FIDELITY NOTES, where this departs from the server:
 *  - the server draws spawn positions and fertile noise offsets from
 *    `Math.random()`; here every draw comes from a seeded substream, which is
 *    what makes a replay replayable. The DISTRIBUTIONS are the server's.
 *  - `generateFertileTiles` is ported cell-for-cell from
 *    `TeamSnekProcessor.generateFertileTiles`, including its fractal-noise
 *    hash, so a density/clustering pair produces the server's shape of blob.
 *  - placement follows `bench/prod/boards.ts` (anchored corner regions, one
 *    unit per cell) rather than the server's team-cluster placement, because
 *    the bench ladder's boards are the ones every prior comparison was run on.
 *
 * PLACEMENT INVARIANT: no two units share a turn-start cell. A shared start
 * cell breaks the additive floor lemma and the lobster substrate throws
 * `OverlappingUnitsError` on it, so a generator that emitted one would be
 * measuring an unreachable board.
 */

import type { Board, Coord, Snake } from '../src/types/battlesnake';
import { apiCoordToIndex, toApiCoord } from '../src/firebase/translate';
import {
  ConfigError,
  MATERIAL_WEIGHT,
  type MatchConfig,
  type UnitKind,
  resolveHazardDamage,
  rosterFor,
} from './config';
import { streamRng, type Rng } from './rng';

const KEY = (c: Coord): string => `${c.x},${c.y}`;

/**
 * Minimum Chebyshev distance between spawned units.
 *
 * THREE, not two, and the difference is the whole point. At distance 2 two
 * units are not adjacent but their one-step neighbourhoods still overlap on the
 * cell between them, so both can stage it and CO-ARRIVE — which the rules
 * adjudicate as a contest, tier then weight, with no friendly-fire exemption.
 * Measured on a 23x23 3-team board at spacing 2: a team's own queen outweighed
 * its own king on turn 1 and regicide wiped the whole team. At distance 3 the
 * neighbourhoods are disjoint and a turn-1 co-arrival between two single-step
 * units is unreachable.
 *
 * Sliders can still reach across the board and contest whatever they like; that
 * is a bot's choice and the sweep should see it. What this removes is the
 * mechanical artifact of cramped spawns.
 */
const SPAWN_SPACING = 3;

/**
 * Units spawn one cell in from the board edge.
 *
 * A snake on the outer ring whose orientation faces outward walks into the wall
 * the moment nothing better is staged — the trail default is "continue
 * straight" (moveGrammar.ts:226-233) — and dies for a reason that says more
 * about where it spawned than how it played. The server spawns on an inset
 * rectangle for the same reason.
 */
const SPAWN_INSET = 1;

const DIRS: ReadonlyArray<Coord> = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
];

/**
 * Team anchors.
 *
 * 'anchored' is the bench ladder's layout — opposite edges for 2 teams, three
 * corners for 3 — and is what every prior comparison in this workspace ran on.
 * 'ring' walks the inset rectangle's corners and then its edge midpoints,
 * approximating the server's `generateStartingPositions`, including its inset
 * flip at `(dim-1) % 4 === 0`.
 */
function anchorsFor(config: MatchConfig): Coord[] {
  const size = config.size;
  const teams = config.teams.length;

  if (config.placement === 'ring') {
    const inset = (size - 1) % 4 === 0 ? 2 : 1;
    const lo = inset;
    const hi = size - 1 - inset;
    const mid = Math.floor(size / 2);
    const ring: Coord[] = [
      { x: lo, y: lo },
      { x: hi, y: hi },
      { x: hi, y: lo },
      { x: lo, y: hi },
      { x: mid, y: lo },
      { x: mid, y: hi },
    ];
    return ring.slice(0, teams);
  }

  const lo = 1;
  const hi = size - 2;
  if (teams <= 2) {
    return [
      { x: Math.floor(size / 2), y: lo },
      { x: Math.floor(size / 2), y: hi },
    ];
  }
  return [
    { x: lo, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
  ];
}

/**
 * Cells within Chebyshev radius `r` of `anchor`, clipped to the spawnable
 * inset rectangle rather than to the raw board.
 */
function region(anchor: Coord, r: number, size: number): Coord[] {
  const lo = SPAWN_INSET;
  const hi = size - 1 - SPAWN_INSET;
  const out: Coord[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = anchor.x + dx;
      const y = anchor.y + dy;
      if (x < lo || y < lo || x > hi || y > hi) continue;
      out.push({ x, y });
    }
  }
  return out;
}

// ------------------------------------------------------- fertile ground
// Ported from TeamSnekProcessor.generateFertileTiles / fractalNoise /
// perlinNoise / dotGridGradient / hashCoord. The only change is that the two
// seed offsets come from a seeded stream instead of Math.random().

function hashCoord(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263 + 1013904223) & 0x7fffffff;
  h = ((h >> 13) ^ h) & 0x7fffffff;
  h = (h * 1274126177 + 1013904223) & 0x7fffffff;
  return (h & 0xffff) / 0xffff;
}

function dotGridGradient(ix: number, iy: number, x: number, y: number): number {
  const angle = hashCoord(ix, iy) * 2.0 * Math.PI;
  return Math.cos(angle) * (x - ix) + Math.sin(angle) * (y - iy);
}

function perlinNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const sx = dx * dx * (3 - 2 * dx);
  const sy = dy * dy * (3 - 2 * dy);
  const n00 = dotGridGradient(x0, y0, x, y);
  const n10 = dotGridGradient(x0 + 1, y0, x, y);
  const n01 = dotGridGradient(x0, y0 + 1, x, y);
  const n11 = dotGridGradient(x0 + 1, y0 + 1, x, y);
  const ix0 = n00 + sx * (n10 - n00);
  const ix1 = n01 + sx * (n11 - n01);
  return ix0 + sy * (ix1 - ix0);
}

function fractalNoise(x: number, y: number, octaves: number, baseFrequency: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = baseFrequency;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i++) {
    value += perlinNoise(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / maxAmplitude;
}

function clusteringToFrequency(clustering: number): number {
  const t = (clustering - 1) / 19;
  return 0.7553 + t * (0.0662 - 0.7553);
}

/**
 * Fertile tiles as api coords. Computed on the FULL board's coordinate grid
 * (walls included, interior only) exactly as the server does, so a given
 * density/clustering pair draws the server's blobs.
 */
export function generateFertileTiles(config: MatchConfig, hazards: ReadonlyArray<Coord>, rng: Rng): Coord[] {
  if (!config.fertile.enabled) return [];
  const density = Math.max(0, Math.min(100, config.fertile.density));
  if (density === 0) return [];
  const clustering = Math.max(1, Math.min(20, config.fertile.clustering));

  const fullWidth = config.size + 2;
  const fullHeight = config.size + 2;
  const hazardSet = new Set(hazards.map((h) => apiCoordToIndex(h, fullWidth, fullHeight)));

  const seedX = rng.next() * 1000;
  const seedY = rng.next() * 1000;
  const baseFrequency = clusteringToFrequency(clustering);

  const noiseValues: Array<{ pos: number; value: number }> = [];
  for (let y = 1; y < fullHeight - 1; y++) {
    for (let x = 1; x < fullWidth - 1; x++) {
      const pos = y * fullWidth + x;
      if (hazardSet.has(pos)) continue;
      noiseValues.push({ pos, value: fractalNoise(x + seedX, y + seedY, 4, baseFrequency) });
    }
  }
  if (noiseValues.length === 0) return [];

  noiseValues.sort((a, b) => b.value - a.value || a.pos - b.pos);
  const targetCount = Math.max(1, Math.floor((noiseValues.length * density) / 100));
  return noiseValues.slice(0, targetCount).map((n) => toApiCoord(n.pos, fullWidth, fullHeight));
}

// ------------------------------------------------------------- hazards

/**
 * Hazard cells for a layout. The geometric layouts are the harness's own — the
 * server only offers a random `hazardPercentage` — and exist because "where the
 * hazards are" is a sweep axis that a uniform scatter cannot express.
 */
export function hazardCells(config: MatchConfig, free: Coord[], rng: Rng): Coord[] {
  const n = config.size;
  const mid = Math.floor(n / 2);
  const inBounds = (c: Coord): boolean => c.x >= 0 && c.y >= 0 && c.x < n && c.y < n;
  const freeSet = new Set(free.map(KEY));
  const keep = (cs: Coord[]): Coord[] => cs.filter((c) => inBounds(c) && freeSet.has(KEY(c)));

  switch (config.hazards.layout) {
    case 'none':
      return [];
    case 'random': {
      const pool = rng.shuffle([...free]);
      return pool.slice(0, Math.min(config.hazards.count, pool.length));
    }
    case 'border': {
      const out: Coord[] = [];
      for (let i = 0; i < n; i++) {
        out.push({ x: i, y: 0 }, { x: i, y: n - 1 }, { x: 0, y: i }, { x: n - 1, y: i });
      }
      return keep(dedupe(out));
    }
    case 'ring': {
      // One inset ring — a donut the units start outside and the food falls into.
      const r = Math.max(2, Math.floor(n / 4));
      const out: Coord[] = [];
      for (let i = mid - r; i <= mid + r; i++) {
        out.push({ x: i, y: mid - r }, { x: i, y: mid + r }, { x: mid - r, y: i }, { x: mid + r, y: i });
      }
      return keep(dedupe(out));
    }
    case 'cross': {
      const out: Coord[] = [];
      for (let i = 0; i < n; i++) out.push({ x: mid, y: i }, { x: i, y: mid });
      return keep(dedupe(out));
    }
    case 'quadrant': {
      const out: Coord[] = [];
      for (let y = mid + 1; y < n; y++) for (let x = mid + 1; x < n; x++) out.push({ x, y });
      return keep(out);
    }
    case 'preset':
      return keep((config.hazards.cells ?? []).map((c) => ({ x: c.x, y: c.y })));
    default:
      throw new ConfigError(`unknown hazard layout "${config.hazards.layout}"`);
  }
}

/**
 * `initializeFood` (TeamSnekProcessor.ts:1033-1111): one food at the board
 * centre, or the first free cell if the centre is taken, plus one on the first
 * free diagonal neighbour of every unit's head. The count is therefore
 * `1 + totalUnits` and `food.initial` is ignored for this layout.
 */
function centreDiagonalFood(
  config: MatchConfig,
  snakes: ReadonlyArray<Snake>,
  occupied: ReadonlySet<string>,
  spawnable: ReadonlyArray<Coord>
): Coord[] {
  const size = config.size;
  const taken = new Set<string>(occupied);
  const out: Coord[] = [];

  const centre: Coord = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  const first = !taken.has(KEY(centre)) ? centre : spawnable.find((c) => !taken.has(KEY(c)));
  if (first !== undefined) {
    taken.add(KEY(first));
    out.push({ ...first });
  }

  const DIAGONALS: ReadonlyArray<Coord> = [
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];
  for (const snake of snakes) {
    for (const d of DIAGONALS) {
      const c: Coord = { x: snake.head.x + d.x, y: snake.head.y + d.y };
      if (c.x < 0 || c.y < 0 || c.x >= size || c.y >= size) continue;
      if (taken.has(KEY(c))) continue;
      taken.add(KEY(c));
      out.push(c);
      break;
    }
  }
  return out;
}

function dedupe(cs: Coord[]): Coord[] {
  const seen = new Set<string>();
  const out: Coord[] = [];
  for (const c of cs) {
    if (seen.has(KEY(c))) continue;
    seen.add(KEY(c));
    out.push(c);
  }
  return out;
}

// -------------------------------------------------------------- the board

export interface BuiltGame {
  readonly board: Board;
  readonly config: MatchConfig;
  /** Wire ids per team id, in roster order. */
  readonly unitsByTeam: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Fertile tiles, held out of the Board when fertile ground is off. */
  readonly fertile: ReadonlyArray<Coord>;
}

export function buildGame(config: MatchConfig): BuiltGame {
  const size = config.size;
  const place = streamRng(config.seed, 'placement');
  const items = streamRng(config.seed, 'items');
  const terrain = streamRng(config.seed, 'terrain');

  const occupied = new Set<string>();
  /**
   * Every cell a unit was PLACED on (heads, not whole snake bodies).
   *
   * SPAWN SPACING IS A BOARD-QUALITY INVARIANT, not an axis. There is no
   * friendly-fire exemption anywhere in the rules, so units packed shoulder to
   * shoulder at spawn kill each other on turn 1: a piece steps onto an ally's
   * snake body and dies `bodyBlock`, a snake turns into its neighbour and dies
   * `self`. Measured on a 23x23 3-team 6-unit board without this, four of
   * eighteen units were gone by turn 3, every one of them to its own side.
   * That is opening noise that would swamp whatever a sweep cell is actually
   * varying.
   *
   * So placement keeps unit anchors at Chebyshev distance >= SPAWN_SPACING,
   * relaxing only when the board genuinely has no room — the same instinct as
   * the server's cluster mode, which enforces a minimum Manhattan distance of 2
   * and parity cells. It is deliberately NOT configurable: a sweep that varied
   * it would be varying how much turn-1 suicide each arm suffers.
   */
  const anchorCells = new Set<string>();
  const snakes: Snake[] = [];
  const unitsByTeam = new Map<string, string[]>();
  const anchors = anchorsFor(config);

  const farEnough = (c: Coord, spacing: number): boolean => {
    if (spacing <= 0) return true;
    for (let dy = -spacing + 1; dy < spacing; dy++) {
      for (let dx = -spacing + 1; dx < spacing; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (anchorCells.has(KEY({ x: c.x + dx, y: c.y + dy }))) return false;
      }
    }
    return true;
  };

  config.teams.forEach((teamID, t) => {
    const anchor = anchors[t] as Coord;
    const roster = rosterFor(config, teamID);
    // The team faces the board centre — pawn legality reads orientation.
    const centre = { x: (size - 1) / 2, y: (size - 1) / 2 };
    const faceApi: Coord = { x: Math.sign(centre.x - anchor.x), y: Math.sign(centre.y - anchor.y) };
    const facing: Coord = faceApi.y !== 0 ? { x: 0, y: faceApi.y } : { x: faceApi.x, y: 0 };

    const ids: string[] = [];
    // Start at the bench ladder's radius and GROW ONLY AS NEEDED.
    //
    // Starting wide instead would be a quiet disaster: sized for spacing up
    // front, a 6-unit team on an 11x11 opens with a radius-8 region, both
    // teams' regions then cover the whole board, and the teams spawn
    // INTERMINGLED rather than facing each other across it. Measured that way,
    // mid11 games ended by turn 4 on early regicide against a historical mean
    // of 24 turns. The radius has to be discovered, not assumed.
    let radius = Math.max(2, Math.ceil(Math.sqrt(roster.length)) + 1);
    // ...and capped at half the distance between anchors, so one team's region
    // can never swallow another's however hard placement struggles.
    const maxRadius = Math.max(radius, Math.floor((size - 3) / 2));
    let pool: Coord[] = place.shuffle(region(anchor, radius, size));
    let cursor = 0;
    let spacing = SPAWN_SPACING;

    const takeFree = (): Coord => {
      for (;;) {
        while (cursor < pool.length) {
          const c = pool[cursor++] as Coord;
          if (!occupied.has(KEY(c)) && farEnough(c, spacing)) return c;
        }
        // Widen first, but only to the cap; past it, relax the spacing instead
        // of sprawling into another team's half.
        if (radius < maxRadius) radius += 1;
        else if (spacing > 0) {
          spacing -= 1;
        } else {
          throw new ConfigError(
            `could not place team "${teamID}"'s ${roster.length} units on a ${size}x${size} board`
          );
        }
        pool = place.shuffle(region(anchor, radius, size));
        cursor = 0;
      }
    };

    roster.forEach((kind, i) => {
      const id = `${teamID}-${i}`;
      ids.push(id);
      const maxHealth = config.maxHealth[kind];
      const common = {
        id,
        name: id,
        latency: '0',
        health: maxHealth ?? 100,
        shout: '',
        squad: '',
        letter: String.fromCharCode(65 + i),
        customizations: { color: '#ffffff', head: 'default', tail: 'default' },
        teamID,
        ...(maxHealth !== undefined ? { maxHealth } : {}),
      };

      if (kind === 'snake') {
        let body: Coord[] | null = null;
        for (let attempt = 0; attempt < 400 && body === null; attempt++) {
          const head = takeFree();
          for (const d of place.shuffle([...DIRS])) {
            const cells: Coord[] = [head];
            let ok = true;
            for (let k = 1; k < config.snakeLength; k++) {
              const c = { x: head.x - d.x * k, y: head.y - d.y * k };
              // The tail obeys the same inset as the head: a body cell on the
              // wall ring is a cell the snake has to back out of.
              const lo = SPAWN_INSET;
              const hi = size - 1 - SPAWN_INSET;
              if (c.x < lo || c.y < lo || c.x > hi || c.y > hi || occupied.has(KEY(c))) {
                ok = false;
                break;
              }
              cells.push(c);
            }
            if (!ok) continue;
            body = cells;
            break;
          }
        }
        if (body === null) throw new ConfigError(`could not place snake ${id} (board too crowded)`);
        // Every body cell blocks and spaces: a piece placed next to an ally's
        // TAIL walks into it on turn 1 just as surely as one placed next to its
        // head, and dies `bodyBlock` for it.
        for (const c of body) {
          occupied.add(KEY(c));
          anchorCells.add(KEY(c));
        }
        const head = body[0] as Coord;
        const mid = body[1] as Coord;
        snakes.push({
          ...common,
          body: body.map((c) => ({ ...c })),
          head: { ...head },
          length: body.length,
          // Full-board convention: dy grows DOWNWARD, so api dy is negated.
          orientation: { dx: head.x - mid.x, dy: -(head.y - mid.y) },
        } as Snake);
        return;
      }

      const at = takeFree();
      occupied.add(KEY(at));
      anchorCells.add(KEY(at));
      snakes.push({
        ...common,
        body: [{ ...at }],
        head: { ...at },
        length: config.spawnWeights === 'material' ? MATERIAL_WEIGHT[kind] : 1,
        unitType: kind,
        orientation: { dx: facing.x, dy: -facing.y },
      } as Snake);
    });

    unitsByTeam.set(teamID, ids);
  });

  // Everything else lands on cells nothing occupies. Order matters: hazards
  // first (fertile ground avoids them, as the server's does), then fertile,
  // then food, then potions.
  const free: Coord[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!occupied.has(KEY({ x, y }))) free.push({ x, y });
    }
  }

  const hazards = hazardCells(config, free, terrain);
  for (const h of hazards) occupied.add(KEY(h));

  const fertile = generateFertileTiles(config, hazards, terrain);
  const fertileSet = new Set(fertile.map(KEY));

  const spawnable = free.filter((c) => !occupied.has(KEY(c)));

  // TURN-1 FOOD IGNORES FERTILE GROUND. That is not an oversight but the
  // server's own behaviour: `initializeFood` (TeamSnekProcessor.ts:1033-1111)
  // never consults `fertileTiles`, so a fertile game always opens with food on
  // infertile ground and only the ONGOING spawn is restricted. Restricting the
  // opening too would quietly make fertile games start easier than live ones.
  void fertileSet;
  const food =
    config.food.initialLayout === 'centre-diagonal'
      ? centreDiagonalFood(config, snakes, occupied, spawnable)
      : items.shuffle([...spawnable]).slice(0, Math.min(config.food.initial, spawnable.length));
  for (const f of food) occupied.add(KEY(f));

  const potionPool = items.shuffle(spawnable.filter((c) => !occupied.has(KEY(c))));
  const potions = config.potions.enabled
    ? potionPool.slice(0, Math.min(config.potions.initial, potionPool.length))
    : [];

  const board: Board = {
    width: size,
    height: size,
    food,
    hazards,
    snakes,
    // The RESOLVED absolute figure — `marshalBoard` reads `board.hazardDamage`
    // and hands it straight to the resolver. The ratio never leaves the config.
    hazardDamage: resolveHazardDamage(config).damage,
    pawnPromotionWeight: config.pawnPromotionWeight,
    ...(Object.keys(config.maxHealth).length > 0 ? { maxHealthPerUnit: { ...config.maxHealth } } : {}),
    ...(fertile.length > 0 ? { fertileTiles: fertile.map((c) => ({ ...c })) } : {}),
    ...(potions.length > 0 ? { invulnerabilityPotions: potions.map((c) => ({ ...c })) } : {}),
  } as Board;

  return { board, config, unitsByTeam, fertile };
}

/** Material weight of a unit kind — what `standings` sums. */
export function weightOf(kind: UnitKind): number {
  return MATERIAL_WEIGHT[kind];
}
