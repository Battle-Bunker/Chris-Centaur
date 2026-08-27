/**
 * THE CONFIG SURFACE — one plain object that names a whole game.
 *
 * The axes here mirror `GameSetup` (src/engine-vendor/shared/types/Game.ts),
 * which is the authoritative upstream config the real server is handed. Where a
 * name differs it is because this harness exposes the axis the sweep varies
 * rather than the wire field: `food.spawnRate` is `GameSetup.foodSpawnRate`,
 * `hazards.count` is a resolved `hazardPercentage`, and so on. Every departure
 * is noted on the field.
 *
 * A config is COMPLETE and HASHABLE: `normalizeConfig` fills every default, and
 * `configHash` is a stable digest of the normalized object, so a manifest row
 * can cite the exact game shape without carrying the whole object.
 */

import { createHash } from 'crypto';

export type UnitKind = 'snake' | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export const UNIT_KINDS: ReadonlyArray<UnitKind> = [
  'snake',
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];

/**
 * Piece weight (stack size) at spawn — the `length` field a piece carries.
 * Mirrors `bench/prod/boards.ts`'s WEIGHT table, which mirrors the server's
 * own spawn weights (pieces spawn at weight 1 upstream; the bench ladder gives
 * them their material weight so that material margin means something on turn
 * 1). `spawnWeights: 'material' | 'unit'` selects between the two.
 */
export const MATERIAL_WEIGHT: Record<UnitKind, number> = {
  snake: 3,
  pawn: 1,
  knight: 2,
  bishop: 2,
  rook: 3,
  queen: 4,
  king: 1,
};

export type HazardLayout = 'none' | 'random' | 'border' | 'cross' | 'quadrant' | 'ring' | 'preset';

/** Where the fixed-cadence disturbance third team comes from on a 3-team board. */
export type SeatKind = 'bot' | 'neutral';

export type FoodLayout = 'scatter' | 'centre-diagonal';

export interface FoodConfig {
  /**
   * Food on the board at turn 1.
   *
   * UPSTREAM DIFFERENCE: the server does not expose a count — `initializeFood`
   * (TeamSnekProcessor.ts:1033) always places one food at the board centre plus
   * one on a free diagonal neighbour of every unit's head, so its count is
   * `1 + totalUnits`. Layout `'centre-diagonal'` reproduces that; the default
   * `'scatter'` honours this count instead, which is the axis a sweep varies
   * and the shape every prior bench board was built on.
   */
  readonly initial: number;
  readonly initialLayout: FoodLayout;
  /**
   * Expected food spawned per turn — `GameSetup.foodSpawnRate`. Fractional
   * rates spawn probabilistically exactly as `TeamSnekProcessor.generateNewFood`
   * does: floor(rate) guaranteed plus one more with probability frac(rate).
   *
   * RANGE IS [0, 5] AND THE CEILING IS LOAD-BEARING. Upstream applies
   * `rawRate > 5 ? rawRate / 100 : rawRate` (TeamSnekProcessor.ts:89), so a
   * config that says 50 silently means 0.5 — a 100x difference from intent.
   * `validateConfig` refuses anything above 5 rather than reproducing the trap.
   */
  readonly spawnRate: number;
  /**
   * Restrict the ONGOING spawn to fertile tiles when fertile ground is live.
   * Defaults true, which is the server's only fertile rule
   * (TeamSnekProcessor.ts:688-691).
   *
   * It does NOT affect turn-1 food: upstream's `initializeFood` ignores fertile
   * tiles entirely, so a fertile game always opens with food on infertile
   * ground, and reproducing that is what keeps the opening honest.
   */
  readonly restrictToFertile: boolean;
}

export interface FertileConfig {
  readonly enabled: boolean;
  /** Percent of non-wall, non-hazard tiles that are fertile. 0-100. */
  readonly density: number;
  /** 1 = scattered, 20 = blobby, 10 = server default. */
  readonly clustering: number;
}

export interface HazardConfig {
  readonly layout: HazardLayout;
  /** Cell count for 'random'; ignored by the geometric layouts. */
  readonly count: number;
  /**
   * Health lost on ENTERING a hazard cell (`GameSetup.hazardDamage`), as a
   * RATIO of the reference kind's max health. This is the axis, not the
   * absolute figure, because the absolute figure does not mean anything on its
   * own: `hazardDamage >= maxHealth[kind]` makes hazards WALLS for that kind
   * (instant exhaustion on entry) and anything below makes them a survivable
   * COST — and with the upstream defaults (damage 100, maxHealth 100) the
   * boundary sits exactly on the default, so hazards are instant death unless
   * a config says otherwise.
   *
   * Because max health is PER KIND, one absolute damage figure can be a wall
   * for a king and a scratch for a queen. `hazardRegimes()` reports the
   * resolved regime per fielded kind, and the replay header carries it.
   *
   *   ratio << 1     cost      a dose is a nick; the economy is attrition
   *   ratio ~ 0.3-0.9 attrition a few doses kill; routing matters
   *   ratio >= 1     wall      entry is death for that kind
   */
  readonly damageRatio: number;
  /**
   * The kind `damageRatio` is measured against. Defaults to the fielded kind
   * with the LOWEST max health, so a stated ratio of 1.0 means "a wall for
   * everything" rather than "a wall for the toughest unit and overkill for
   * the rest".
   */
  readonly damageRef?: UnitKind;
  /**
   * Absolute override. When set it wins over `damageRatio` — for reproducing a
   * historical board that stated an absolute figure.
   */
  readonly damage?: number;
  /** Explicit api coords for layout 'preset'. */
  readonly cells?: ReadonlyArray<{ x: number; y: number }>;
}

export interface PotionConfig {
  /**
   * `GameSetup.invulnerabilityPotionEnabled`. Gates BOTH collection and
   * spawning; potions already on the board when it is off persist but are
   * inert.
   *
   * SCOPE WARNING, from the axis audit: the lobster possibility clouds do not
   * see potions at all — `substrate.ts:378` constructs the cloud's potion
   * board EMPTY and `substrate.ts:1128` hard-wires `tierExpiresAtTurn: null`,
   * so `CloudSource.boundsAt`'s tier-ceiling machinery is present, correct and
   * unreachable. A potion arm therefore exercises the vendored resolver and the
   * observed-tier reading, NOT the clouds' tier reasoning.
   */
  readonly enabled: boolean;
  /** `GameSetup.invulnerabilityPotionSpawnRate`, expected potions per turn. */
  readonly spawnRate: number;
  /**
   * Potions on the board at turn 1. HARNESS EXTENSION — the server always
   * starts at `[]` and lets the per-turn spawn fill the board, so a nonzero
   * value here is a shape no live game produces. It exists so a potion arm
   * reaches its first pickup inside a short turn cap.
   */
  readonly initial: number;
  /**
   * Turns an effect lasts. HARNESS EXTENSION — upstream hard-codes +3
   * (TeamSnekProcessor.ts:601, 619) with no config axis at all. Exposed so the
   * sweep can vary it; leave at 3 for anything meant to match live play.
   */
  readonly effectTurns: number;
}

export interface MatchConfig {
  /** Free-form label carried into the manifest and replay. */
  readonly name?: string;
  /** Square board edge, 11..25. `GameSetup.boardWidth`/`boardHeight`. */
  readonly size: number;
  /** Team ids, 2 or 3 of them. Order is SEAT order. */
  readonly teams: ReadonlyArray<string>;
  /**
   * Units per team, 4..8. Either one roster shared by every team (the fair
   * case, and what a sweep almost always wants) or one roster per team id.
   * `GameSetup.unitsPerTeam` expanded into a spawn ORDER.
   */
  readonly roster: ReadonlyArray<UnitKind> | Readonly<Record<string, ReadonlyArray<UnitKind>>>;
  /**
   * Where teams start. 'anchored' is the bench ladder's layout (opposite edges
   * for 2 teams, three corners for 3) and is what every prior comparison ran
   * on. 'ring' walks the inset rectangle's corners then its edge midpoints,
   * approximating the server's `generateStartingPositions`.
   *
   * `teamClustersEnabled` is NOT supported — see UNSUPPORTED_AXES.
   */
  readonly placement: 'anchored' | 'ring';
  /**
   * Snake body length at spawn. HARNESS EXTENSION — upstream hard-codes 3
   * (TeamSnekProcessor.ts:937, a stacked triple on one cell) with no axis for
   * it. Note the harness lays the body out along a line rather than stacking
   * it, which is the shape a snake has after its first move either way.
   */
  readonly snakeLength: number;
  /**
   * Piece weight at spawn. HARNESS EXTENSION — upstream always spawns pieces at
   * weight 1 (TeamSnekProcessor.ts:936). 'unit' reproduces that; 'material'
   * gives each kind its material weight so that material margin is meaningful
   * on turn 1, which is what the bench ladder does and what the h2h rows this
   * harness has to reproduce were measured on.
   */
  readonly spawnWeights: 'material' | 'unit';
  readonly food: FoodConfig;
  readonly fertile: FertileConfig;
  readonly hazards: HazardConfig;
  readonly potions: PotionConfig;
  /** Per-kind max health. `GameSetup.maxHealthPerUnit`; absent keys mean 100. */
  readonly maxHealth: Partial<Record<UnitKind, number>>;
  /** `GameSetup.pawnPromotionWeight`. */
  readonly pawnPromotionWeight: number;
  /**
   * Turns before the match is adjudicated on survival + material —
   * `GameSetup.maxTurns`, and MANDATORY here rather than optional.
   *
   * A pieces-only roster on a hazard-free board can run forever: a piece that
   * holds enters nothing and pays nothing (`cost = (entered?1:0) +
   * (onHazard?dmg:0)`, turnEngine.ts:512-517), so nothing forces contact and
   * nothing starves. Snakes cannot stall — their default action is to continue
   * straight — but a config with no snakes and no cap is a non-terminating
   * game. Every match this harness runs has a cap, and the manifest records
   * whether a game ENDED or merely hit it.
   */
  readonly turnCap: number;
  /** Per-decision wall budget in ms, handed to every bot identically. */
  readonly budgetMs: number;
  /** Board seed. The whole stochastic state of a game. */
  readonly seed: number;
}

export type MatchConfigInput = Partial<Omit<MatchConfig, 'food' | 'fertile' | 'hazards' | 'potions' | 'maxHealth'>> & {
  readonly size: number;
  readonly teams: ReadonlyArray<string>;
  readonly roster: MatchConfig['roster'];
  readonly food?: Partial<FoodConfig>;
  readonly fertile?: Partial<FertileConfig>;
  readonly hazards?: Partial<HazardConfig>;
  readonly potions?: Partial<PotionConfig>;
  readonly maxHealth?: Partial<Record<UnitKind, number>>;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const MIN_SIZE = 11;
export const MAX_SIZE = 25;
export const MIN_UNITS = 4;
export const MAX_UNITS = 8;

/** Held-unit capacity of the lobster cloud field — see `partial-engine/field.ts`. */
export const MAX_FROZEN_CAPACITY = 32;

/** The universal max health when no kind-specific figure is configured. */
export const DEFAULT_MAX_HEALTH = 100;

const DEFAULTS = {
  placement: 'anchored' as const,
  snakeLength: 3,
  spawnWeights: 'material' as const,
  pawnPromotionWeight: 10,
  turnCap: 60,
  budgetMs: 150,
  seed: 1,
  food: { initial: 4, initialLayout: 'scatter' as FoodLayout, spawnRate: 0.5, restrictToFertile: true },
  fertile: { enabled: false, density: 30, clustering: 10 },
  // A COST, not a wall: 0.15 of the reference kind's max health. Upstream's
  // default is 1.0 (damage 100 against maxHealth 100), i.e. instant death on
  // entry, which is a poor default for a sweep because it collapses the whole
  // hazard axis onto "extra walls". A config that wants the upstream default
  // says damageRatio: 1 and means it.
  hazards: { layout: 'none' as HazardLayout, count: 0, damageRatio: 0.15 },
  potions: { enabled: false, spawnRate: 0.15, initial: 0, effectTurns: 3 },
};

/**
 * Config axes the upstream game HAS that this harness does NOT support, with
 * the reason. Carried into every replay header so a miner never has to guess
 * whether an absent axis was off or absent.
 */
export const UNSUPPORTED_AXES: Readonly<Record<string, string>> = {
  teamClustersEnabled:
    'Cluster spawning cuts the board into equal-angle pie slices at a random rotation and ' +
    'needs one parity cell ((x+y)%2===0) per unit; after 8 failed attempts it silently reverts ' +
    'to the ring layout and flags Turn.teamClusterFallback. Reproducing the silent fallback ' +
    'faithfully is the only honest way to offer it, and an arm that is secretly half ring-layout ' +
    'is worse than no arm. Use placement: "ring" or "anchored", both of which always do what they say.',
  usePreviewBoard:
    'The preset* family (presetHazards / presetFertileTiles / presetFood / presetPlayerPositions) ' +
    'is upstream\'s determinism lever. This harness gets determinism from a seeded RNG instead, ' +
    'which pins strictly more than presets do (presets do not pin spawn-orientation ties). ' +
    'hazards.layout "preset" covers the one preset axis a sweep actually varies.',
  maxTurnTime:
    'Live-only. The turn window is stamped by processTurn and only affects which staged moves ' +
    'are accepted; a harness that constructs the staged set itself has no use for it. The ' +
    'per-decision wall budget is budgetMs.',
  firstTurnTime: 'Live-only, same reason as maxTurnTime.',
  'tournamentMode / scheduledStartTime / remainingRounds / interludeDuration':
    'Session and scheduler plumbing. Irrelevant to a headless single-game sweep.',
  hazardRespawn:
    'Not an upstream axis either — hazards are static after turn 0 (newHazards is only ever ' +
    'copied through). Listed so nobody looks for it.',
};

/**
 * The absolute hazard damage this config resolves to, and the reference kind it
 * was measured against.
 */
export function resolveHazardDamage(c: MatchConfig): { damage: number; ref: UnitKind; refMaxHealth: number } {
  const fielded = new Set<UnitKind>();
  for (const t of c.teams) for (const k of rosterFor(c, t)) fielded.add(k);
  // A pawn promotes to a queen, so a queen's max health is live in any game
  // that fields a pawn even when no queen starts on the board.
  if (fielded.has('pawn')) fielded.add('queen');

  const maxHealthOf = (k: UnitKind): number => c.maxHealth[k] ?? DEFAULT_MAX_HEALTH;
  let ref = c.hazards.damageRef;
  if (ref === undefined) {
    for (const k of fielded) {
      if (ref === undefined || maxHealthOf(k) < maxHealthOf(ref)) ref = k;
    }
  }
  ref = ref ?? 'snake';
  const refMaxHealth = maxHealthOf(ref);
  const damage = c.hazards.damage ?? Math.round(c.hazards.damageRatio * refMaxHealth);
  return { damage, ref, refMaxHealth };
}

export type HazardRegime = 'wall' | 'attrition' | 'cost' | 'inert';

/**
 * What hazards actually DO to each fielded kind under this config. A single
 * damage figure is a wall for a kind whose max health it meets and a scratch
 * for one it does not, so this is per kind and it belongs in the replay header.
 */
export function hazardRegimes(c: MatchConfig): Record<string, { damage: number; maxHealth: number; doses: number; regime: HazardRegime }> {
  const { damage } = resolveHazardDamage(c);
  const out: Record<string, { damage: number; maxHealth: number; doses: number; regime: HazardRegime }> = {};
  if (c.hazards.layout === 'none') return out;

  const fielded = new Set<UnitKind>();
  for (const t of c.teams) for (const k of rosterFor(c, t)) fielded.add(k);
  if (fielded.has('pawn')) fielded.add('queen');

  for (const k of fielded) {
    const maxHealth = c.maxHealth[k] ?? DEFAULT_MAX_HEALTH;
    const doses = damage <= 0 ? Infinity : Math.ceil(maxHealth / damage);
    const ratio = damage / maxHealth;
    const regime: HazardRegime =
      damage <= 0 ? 'inert' : ratio >= 1 ? 'wall' : ratio >= 0.3 ? 'attrition' : 'cost';
    out[k] = { damage, maxHealth, doses: doses === Infinity ? -1 : doses, regime };
  }
  return out;
}

export function rosterFor(config: MatchConfig, teamId: string): ReadonlyArray<UnitKind> {
  const r = config.roster;
  if (Array.isArray(r)) return r as ReadonlyArray<UnitKind>;
  const per = r as Record<string, ReadonlyArray<UnitKind>>;
  const own = per[teamId];
  if (own === undefined) throw new ConfigError(`roster has no entry for team "${teamId}"`);
  return own;
}

/** Total units the config fields across every team. */
export function totalUnits(config: MatchConfig): number {
  return config.teams.reduce((n, t) => n + rosterFor(config, t).length, 0);
}

/**
 * The largest number of units one team's decision has to HOLD — every unit on
 * the board that is not its own. This is what `MAX_FROZEN` caps: a decision
 * whose held set overflows 32 stops modelling its farthest opponents and says
 * so in `report.assumptions`, which is a silently degraded decision rather than
 * an error. `validateConfig` refuses a config that would reach it.
 */
export function worstHeldCount(config: MatchConfig): number {
  const total = totalUnits(config);
  let worst = 0;
  for (const t of config.teams) worst = Math.max(worst, total - rosterFor(config, t).length);
  return worst;
}

export function normalizeConfig(input: MatchConfigInput): MatchConfig {
  const roster = Array.isArray(input.roster)
    ? ([...(input.roster as ReadonlyArray<UnitKind>)] as ReadonlyArray<UnitKind>)
    : Object.fromEntries(
        Object.entries(input.roster as Record<string, ReadonlyArray<UnitKind>>).map(([k, v]) => [k, [...v]])
      );

  const config: MatchConfig = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    size: input.size,
    teams: [...input.teams],
    roster,
    placement: input.placement ?? DEFAULTS.placement,
    snakeLength: input.snakeLength ?? DEFAULTS.snakeLength,
    spawnWeights: input.spawnWeights ?? DEFAULTS.spawnWeights,
    food: { ...DEFAULTS.food, ...(input.food ?? {}) },
    fertile: { ...DEFAULTS.fertile, ...(input.fertile ?? {}) },
    hazards: { ...DEFAULTS.hazards, ...(input.hazards ?? {}) } as HazardConfig,
    potions: { ...DEFAULTS.potions, ...(input.potions ?? {}) },
    maxHealth: { ...(input.maxHealth ?? {}) },
    pawnPromotionWeight: input.pawnPromotionWeight ?? DEFAULTS.pawnPromotionWeight,
    turnCap: input.turnCap ?? DEFAULTS.turnCap,
    budgetMs: input.budgetMs ?? DEFAULTS.budgetMs,
    seed: input.seed ?? DEFAULTS.seed,
  };
  validateConfig(config);
  return config;
}

/**
 * Refuse a degenerate config with a clear error. "Degenerate" here means a game
 * that cannot be built, cannot be adjudicated, or that would quietly measure
 * something other than what it names.
 */
export function validateConfig(c: MatchConfig): void {
  const bad = (msg: string): never => {
    throw new ConfigError(msg);
  };

  if (!Number.isInteger(c.size) || c.size < MIN_SIZE || c.size > MAX_SIZE) {
    bad(`size must be an integer in [${MIN_SIZE}, ${MAX_SIZE}]; got ${c.size}`);
  }
  if (c.teams.length < 2 || c.teams.length > 3) {
    bad(`teams must number 2 or 3; got ${c.teams.length} (${c.teams.join(',')})`);
  }
  if (new Set(c.teams).size !== c.teams.length) {
    bad(`team ids must be distinct; got ${c.teams.join(',')}`);
  }
  for (const t of c.teams) {
    if (typeof t !== 'string' || t.length === 0) bad(`team ids must be non-empty strings`);
  }

  for (const t of c.teams) {
    const r = rosterFor(c, t);
    if (r.length < MIN_UNITS || r.length > MAX_UNITS) {
      bad(`team "${t}" fields ${r.length} units; the supported range is ${MIN_UNITS}..${MAX_UNITS}`);
    }
    for (const k of r) {
      if (!UNIT_KINDS.includes(k)) bad(`team "${t}" roster names unknown unit kind "${k}"`);
    }
    if (r.filter((k) => k === 'king').length > 1) {
      // Regicide keys on "this team has a living king". Two kings is a legal
      // board but a config the sweep would misread: the team survives its first
      // king's death, so a "regicide" axis would not mean what it says.
      bad(`team "${t}" fields more than one king; regicide is a per-TEAM rule and a second king masks it`);
    }
  }

  // Placement headroom. A team's units are placed inside a Chebyshev region
  // around its anchor; a snake additionally needs `snakeLength-1` trailing
  // cells. The generator grows its radius, but a board with no room at all is
  // a config error, not a runtime surprise.
  if (!['anchored', 'ring'].includes(c.placement)) {
    bad(`placement must be 'anchored' or 'ring'; got "${c.placement}"`);
  }

  const cells = c.size * c.size;
  const occupancy =
    c.teams.reduce(
      (n, t) => n + rosterFor(c, t).reduce((m, k) => m + (k === 'snake' ? c.snakeLength : 1), 0),
      0
    ) + c.food.initial + (c.hazards.layout === 'random' ? c.hazards.count : 0) + c.potions.initial;
  if (occupancy > cells * 0.6) {
    bad(
      `config asks for ${occupancy} occupied cells on a ${c.size}x${c.size} board (${cells} cells); ` +
        `over 60% occupancy leaves no room to move — reduce roster, food, hazards or potions`
    );
  }

  if (!Number.isInteger(c.snakeLength) || c.snakeLength < 2 || c.snakeLength > 8) {
    bad(`snakeLength must be an integer in [2, 8]; got ${c.snakeLength}`);
  }

  if (!Number.isInteger(c.food.initial) || c.food.initial < 0) {
    bad(`food.initial must be a non-negative integer; got ${c.food.initial}`);
  }
  if (!(c.food.spawnRate >= 0)) {
    bad(`food.spawnRate must be >= 0; got ${c.food.spawnRate}`);
  }
  if (c.food.spawnRate > 5) {
    // Upstream's `rawRate > 5 ? rawRate / 100 : rawRate` normalization
    // (TeamSnekProcessor.ts:89) makes 50 mean 0.5. Refusing is the only reading
    // that cannot silently be 100x off what the sweep intended.
    bad(
      `food.spawnRate must be in [0, 5] (expected food per turn); got ${c.food.spawnRate}. ` +
        `Values above 5 are silently divided by 100 upstream (TeamSnekProcessor.ts:89), so ` +
        `${c.food.spawnRate} would mean ${c.food.spawnRate / 100}/turn — state the per-turn rate directly.`
    );
  }
  // No food at all and no spawn is a starvation clock, not a game: every snake
  // dies of movement cost on a fixed turn regardless of play, and every team
  // dies at once.
  if (c.food.initial === 0 && c.food.spawnRate === 0) {
    const hasSnake = c.teams.some((t) => rosterFor(c, t).includes('snake'));
    if (hasSnake) {
      bad(
        `food.initial=0 with food.spawnRate=0 starves every snake at exactly ` +
          `maxHealth.snake turns regardless of play — set one of them, or field a pieces-only roster`
      );
    }
  }
  if (!['scatter', 'centre-diagonal'].includes(c.food.initialLayout)) {
    bad(`food.initialLayout must be 'scatter' or 'centre-diagonal'; got "${c.food.initialLayout}"`);
  }

  // THE STALL. A piece that holds enters nothing and pays nothing
  // (turnEngine.ts:512-517), so a pieces-only roster with no hazard pressure
  // has no clock at all: every game runs to the cap and adjudicates on
  // material that never moved. The cap makes it terminate; this makes it
  // legible, because a sweep cell where every game is a cap-draw measures
  // nothing.
  const anySnake = c.teams.some((t) => rosterFor(c, t).includes('snake'));
  const hazardsBite = c.hazards.layout !== 'none' && resolveHazardDamage(c).damage > 0;
  if (!anySnake && !hazardsBite && c.food.spawnRate === 0) {
    bad(
      `a pieces-only roster with no hazards and no food spawn has no clock: a holding piece ` +
        `enters nothing and pays nothing (turnEngine.ts:512-517), so nothing forces contact and ` +
        `nothing starves. Every game would run to the turn cap. Add a snake, hazards, or food pressure.`
    );
  }

  if (c.fertile.enabled) {
    if (!(c.fertile.density > 0) || c.fertile.density > 100) {
      bad(`fertile.density must be in (0, 100] when fertile ground is enabled; got ${c.fertile.density}`);
    }
    if (!Number.isInteger(c.fertile.clustering) || c.fertile.clustering < 1 || c.fertile.clustering > 20) {
      bad(`fertile.clustering must be an integer in [1, 20]; got ${c.fertile.clustering}`);
    }
    if (c.food.restrictToFertile === true && c.food.spawnRate > 0 && c.fertile.density < 2) {
      bad(
        `fertile.density=${c.fertile.density}% with food restricted to fertile tiles leaves almost ` +
          `nowhere for food to land — raise the density or set food.restrictToFertile=false`
      );
    }
  }

  if (!(c.hazards.damageRatio >= 0)) {
    bad(`hazards.damageRatio must be >= 0; got ${c.hazards.damageRatio}`);
  }
  if (c.hazards.damage !== undefined && (!(c.hazards.damage >= 0) || c.hazards.damage > 1000)) {
    bad(`hazards.damage, when set, must be in [0, 1000]; got ${c.hazards.damage}`);
  }
  if (c.hazards.damageRef !== undefined && !UNIT_KINDS.includes(c.hazards.damageRef)) {
    bad(`hazards.damageRef names unknown unit kind "${c.hazards.damageRef}"`);
  }
  if (c.hazards.layout === 'random' && (!Number.isInteger(c.hazards.count) || c.hazards.count < 0)) {
    bad(`hazards.count must be a non-negative integer for layout 'random'; got ${c.hazards.count}`);
  }
  if (c.hazards.layout === 'preset' && (c.hazards.cells === undefined || c.hazards.cells.length === 0)) {
    bad(`hazards.layout='preset' requires a non-empty hazards.cells list`);
  }
  if (c.hazards.layout !== 'none') {
    // A hazard field that is a wall for every fielded kind is a maze, not a
    // damage economy — legal, and a fine arm, but it must be asked for rather
    // than arrived at by leaving the ratio at a default.
    const regimes = hazardRegimes(c);
    const kinds = Object.keys(regimes);
    if (kinds.length > 0 && kinds.every((k) => regimes[k]!.regime === 'inert')) {
      bad(
        `hazards.layout='${c.hazards.layout}' with a resolved damage of 0 places hazard cells ` +
          `that do nothing — set hazards.damageRatio above 0 or hazards.layout='none'`
      );
    }
  }

  if (c.potions.enabled) {
    if (!(c.potions.spawnRate >= 0) || c.potions.spawnRate > 2) {
      bad(`potions.spawnRate must be in [0, 2]; got ${c.potions.spawnRate}`);
    }
    if (!Number.isInteger(c.potions.effectTurns) || c.potions.effectTurns < 1) {
      bad(`potions.effectTurns must be a positive integer; got ${c.potions.effectTurns}`);
    }
    if (c.potions.initial === 0 && c.potions.spawnRate === 0) {
      bad(`potions.enabled with no initial potions and spawnRate=0 is an axis that never fires`);
    }
  }

  for (const [kind, hp] of Object.entries(c.maxHealth)) {
    if (!UNIT_KINDS.includes(kind as UnitKind)) bad(`maxHealth names unknown unit kind "${kind}"`);
    if (typeof hp !== 'number' || !(hp > 0) || hp > 1000) {
      bad(`maxHealth.${kind} must be in (0, 1000]; got ${hp}`);
    }
  }

  if (!Number.isInteger(c.pawnPromotionWeight) || c.pawnPromotionWeight < 2) {
    bad(`pawnPromotionWeight must be an integer >= 2; got ${c.pawnPromotionWeight}`);
  }
  if (!Number.isInteger(c.turnCap) || c.turnCap < 1 || c.turnCap > 2000) {
    bad(`turnCap must be an integer in [1, 2000]; got ${c.turnCap}`);
  }
  if (!(c.budgetMs >= 1) || c.budgetMs > 600_000) {
    bad(`budgetMs must be in [1, 600000]; got ${c.budgetMs}`);
  }
  if (!Number.isInteger(c.seed)) bad(`seed must be an integer; got ${c.seed}`);

  // Held capacity. Over MAX_FROZEN the lobster decision silently drops its
  // farthest opponents from the model. The supported envelope (3 teams x 8
  // units = 24 units, worst held 16) is well inside it; this guard is what
  // makes that a checked fact rather than an assumption.
  const held = worstHeldCount(c);
  if (held > MAX_FROZEN_CAPACITY) {
    bad(
      `this config would hold ${held} units in one decision, over the cloud field's ` +
        `MAX_FROZEN capacity of ${MAX_FROZEN_CAPACITY} — decisions would silently stop modelling ` +
        `their farthest opponents`
    );
  }
}

/**
 * A stable digest of the normalized config. Key order is fixed by
 * `stableStringify`, so two configs that differ only in literal key order hash
 * the same — which is what a manifest row needs to group games by shape.
 */
export function configHash(c: MatchConfig): string {
  const { name: _name, seed: _seed, ...shape } = c;
  return createHash('sha256').update(stableStringify(shape)).digest('hex').slice(0, 16);
}

/** The digest INCLUDING the seed — identifies one exact starting board. */
export function boardHash(c: MatchConfig): string {
  const { name: _name, ...shape } = c;
  return createHash('sha256').update(stableStringify(shape)).digest('hex').slice(0, 16);
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
