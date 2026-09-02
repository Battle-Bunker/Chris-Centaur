/**
 * THE BOT BINDING SITE — which bot a given game, played by a given centaur,
 * is actually playing.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * Production had no binding site at all. `firebaseInterfaceConfigFromEnv`
 * never named a bot, so `TeamDecisionEngine` fell through to its own
 * module-level default and the live process played ONE bot for every game and
 * every seat it held. Three consequences, all of them ones a centaur operator
 * hits immediately:
 *
 *   - selecting a validated member in production meant EDITING THE DEFAULT and
 *     redeploying, i.e. changing the bot every running game plays in order to
 *     change the bot one game plays;
 *   - two Centaur teams could not play different bots, so a head-to-head
 *     between two candidate configurations needed two processes;
 *   - an operator's dial excursion — "run this arm with gainOrdering off for
 *     the next three games" — had nowhere to persist, so it lived in someone's
 *     shell history and appeared in no row.
 *
 * ── THE SMALLEST REAL SOURCE ───────────────────────────────────────────────
 *
 * A binding is looked up per (game, centaur) at the decision seam, which is
 * already per-game. The lookup consults, most specific first:
 *
 *     bot.game.<gameId>       this one game                       (source 'game')
 *     bot.centaur.<centaurId> every game this centaur plays       (source 'centaur')
 *     bot.default             this deployment                     (source 'store-default')
 *     CENTAUR_BOT / built-in  today's behaviour, unchanged        (source 'env-default')
 *
 * The first three are rows in the EXISTING `config_store` table — no schema
 * change, no new store, and an operator binds a bot with one row and no
 * redeploy. The fourth is the floor: with an empty table and an unset
 * `CENTAUR_BOT` the resolved bot is exactly the configuration that shipped, so
 * introducing this file moves nothing.
 *
 * ── VALIDATION IS LOUD AND THE FALLBACK IS THE DEFAULT ─────────────────────
 *
 * A stored binding is operator-typed JSON that reaches the objective function
 * of a live game. Every one is parsed structurally and then run through
 * `checkWeights` — the same construction-time check every shipped profile
 * passes — because the failure it catches is silent: a weight table missing a
 * key does not fold at zero, it folds at whatever default the feature's author
 * chose, and a typo'd key is a number that does nothing while looking like it
 * does something. A binding that fails is REFUSED, named in the log and in
 * `warnings()`, and the lookup falls through to the next level. It is never
 * partially applied: half of an invalid bot is a bot nobody chose.
 */

import { FEATURES, MATERIAL_ONLY_PROFILE, ROYAL_COMMAND_PROFILE, TERRITORY_PROFILE, checkWeights } from '../lobster/evaluate';
import type { CriterionProfile } from '../lobster/evaluate';
import type { CandidateKnobs } from '../lobster/candidates';
import { stagingSafetyFrom } from '../lobster/staging-safety';
import type { StagingSafety } from '../lobster/staging-safety';
import { behaviourId as processBehaviourId } from './build-identity';
import { botIdentityOf, type BotIdentity, type BotSpec } from './bot-identity';
import type { CentaurEngineKind } from './centaur-engine';

// ------------------------------------------------------------------- catalog

/**
 * The bots this build ships, addressable by name from a stored binding.
 *
 * Every one is a profile that already exists and is already measured — see
 * `src/config/centaur-engine.ts` for the numbers that made `lobster-territory`
 * the default and `src/lobster/evaluate/calibration.ts` for what the other two
 * are for. This map adds no bot; it makes the ones there NAMEABLE, which is
 * the difference between "the process plays whatever it was compiled with" and
 * "the operator selects a validated member".
 */
export const BUILTIN_BOTS: Readonly<Record<string, BotSpec>> = {
  'lobster-territory': {
    name: 'lobster-territory',
    engine: 'lobster',
    profile: TERRITORY_PROFILE,
  },
  'lobster-territory-a': {
    name: 'lobster-territory-a',
    engine: 'lobster',
    profile: ROYAL_COMMAND_PROFILE,
  },
  'material-only': {
    name: 'material-only',
    engine: 'lobster',
    profile: MATERIAL_ONLY_PROFILE,
  },
};

/** The bot an unconfigured deployment plays — today's behaviour exactly. */
export const DEFAULT_BOT_NAME = 'lobster-territory';

export const BOT_ENV = 'CENTAUR_BOT';

/** config_store keys. Documented in `docs/BOT-BINDING.md`. */
export const BOT_DEFAULT_KEY = 'bot.default';
export const BOT_GAME_KEY_PREFIX = 'bot.game.';
export const BOT_CENTAUR_KEY_PREFIX = 'bot.centaur.';
export const BOT_CATALOG_KEY = 'bot.catalog';

/**
 * The env-level default. `CENTAUR_BOT` names a built-in; an unrecognised value
 * keeps the shipped default and SAYS SO, for the same reason `CENTAUR_ENGINE`
 * does: a typo must never silently reroute production decisions.
 */
export function defaultBotSpecFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): BotSpec {
  const raw = env[BOT_ENV];
  if (raw === undefined || raw === '') return BUILTIN_BOTS[DEFAULT_BOT_NAME];
  const hit = BUILTIN_BOTS[raw];
  if (hit !== undefined) return hit;
  log(
    `[bot-binding] Ignoring ${BOT_ENV}="${raw}" — no such built-in bot ` +
      `(have ${Object.keys(BUILTIN_BOTS).join(', ')}); keeping ${DEFAULT_BOT_NAME}`
  );
  return BUILTIN_BOTS[DEFAULT_BOT_NAME];
}

// --------------------------------------------------------------- the binding

export type BotBindingSource = 'env-default' | 'store-default' | 'centaur' | 'game';

/** A resolved binding: the bot, its address, and the reason it was chosen. */
export interface BotBinding {
  readonly identity: BotIdentity;
  readonly spec: BotSpec;
  readonly source: BotBindingSource;
  /** The config_store key that decided it, or null for the env-level floor. */
  readonly key: string | null;
}

// ---------------------------------------------------------------- parsing

const STAGING_SAFETY_VALUES: ReadonlyArray<StagingSafety> = ['off', 'auto', 'guard', 'full'];
const ENGINE_VALUES: ReadonlyArray<CentaurEngineKind> = ['legacy', 'lobster'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A profile as an operator may write it. Refuses anything the fold would then
 * have to guess at: every weight must be a finite number, the horizon must be
 * a non-negative integer, and the optional knobs must be the types the
 * evaluator reads. Returns the reason on refusal so the log can name it. */
function parseProfile(raw: unknown): { profile: CriterionProfile } | { error: string } {
  if (!isRecord(raw)) return { error: 'profile must be an object' };
  if (typeof raw.name !== 'string' || raw.name === '') {
    return { error: 'profile.name must be a non-empty string' };
  }
  if (!isRecord(raw.weights)) return { error: 'profile.weights must be an object' };
  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.weights)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `profile.weights.${key} must be a finite number` };
    }
    weights[key] = value;
  }
  const horizon = raw.reachHorizonTurns;
  if (typeof horizon !== 'number' || !Number.isInteger(horizon) || horizon < 0) {
    return { error: 'profile.reachHorizonTurns must be a non-negative integer' };
  }
  const profile: {
    name: string;
    weights: Record<string, number>;
    reachHorizonTurns: number;
    royalReachers?: boolean;
    command?: { ground: number; food: number; royal: boolean };
    energyReserveRatio?: number;
  } = { name: raw.name, weights, reachHorizonTurns: horizon };

  if (raw.royalReachers !== undefined) {
    if (typeof raw.royalReachers !== 'boolean') {
      return { error: 'profile.royalReachers must be a boolean' };
    }
    profile.royalReachers = raw.royalReachers;
  }
  if (raw.command !== undefined) {
    const c = raw.command;
    if (
      !isRecord(c) ||
      typeof c.ground !== 'number' ||
      !Number.isFinite(c.ground) ||
      typeof c.food !== 'number' ||
      !Number.isFinite(c.food) ||
      typeof c.royal !== 'boolean'
    ) {
      return { error: 'profile.command must be {ground: number, food: number, royal: boolean}' };
    }
    profile.command = { ground: c.ground, food: c.food, royal: c.royal };
  }
  if (raw.energyReserveRatio !== undefined) {
    if (typeof raw.energyReserveRatio !== 'number' || !Number.isFinite(raw.energyReserveRatio)) {
      return { error: 'profile.energyReserveRatio must be a finite number' };
    }
    profile.energyReserveRatio = raw.energyReserveRatio;
  }
  return { profile };
}

/** Candidate-layer overrides. Every knob is a boolean except `keepQuiet`, and
 * a key the layer has no knob for is refused rather than ignored — an inert
 * dial an operator believes in is worse than no dial. */
function parseCandidates(raw: unknown): { knobs: CandidateKnobs } | { error: string } {
  if (!isRecord(raw)) return { error: 'candidates must be an object' };
  const booleans = new Set([
    'pruneFatalNoGain',
    'kingHardSafety',
    'refusePromotion',
    'tierSafeStaging',
    'selfDebuffOrdering',
    'escortShadowOrdering',
    'chargeStandingTerrain',
    'refuseTerrainFatal',
    'gainOrdering',
    'pruneCertainSelfFatal',
    'pruneRoyalPath',
  ]);
  const knobs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'keepQuiet') {
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
        return { error: 'candidates.keepQuiet must be a non-negative number' };
      }
      knobs[key] = value;
      continue;
    }
    if (!booleans.has(key)) return { error: `candidates.${key} is not a candidate knob` };
    if (typeof value !== 'boolean') return { error: `candidates.${key} must be a boolean` };
    knobs[key] = value;
  }
  return { knobs: knobs as CandidateKnobs };
}

/**
 * One stored binding value → a bot, or a named refusal.
 *
 * Two spellings, both useful:
 *   "material-only"                             a catalog member, by name
 *   { bot: "lobster-territory",                 a catalog member with the
 *     candidates: { gainOrdering: false } }     operator's dial excursion
 *   { name: "arm-b", profile: { ... } }         a profile written out in full
 */
export function parseBotSpec(
  raw: unknown,
  catalog: Readonly<Record<string, BotSpec>>
): { spec: BotSpec } | { error: string } {
  if (typeof raw === 'string') {
    const hit = catalog[raw];
    if (hit === undefined) {
      return { error: `no bot named "${raw}" (have ${Object.keys(catalog).sort().join(', ')})` };
    }
    return { spec: hit };
  }
  if (!isRecord(raw)) return { error: 'a binding must be a bot name or an object' };

  let base: BotSpec | undefined;
  if (raw.bot !== undefined) {
    if (typeof raw.bot !== 'string') return { error: '"bot" must be the name of a bot' };
    base = catalog[raw.bot];
    if (base === undefined) {
      return {
        error: `no bot named "${raw.bot}" (have ${Object.keys(catalog).sort().join(', ')})`,
      };
    }
  }

  let profile: CriterionProfile;
  if (raw.profile !== undefined) {
    const parsed = parseProfile(raw.profile);
    if ('error' in parsed) return parsed;
    profile = parsed.profile;
  } else if (base !== undefined) {
    profile = base.profile;
  } else {
    return { error: 'a binding must name a "bot" or carry a "profile"' };
  }

  let candidates = base?.candidates;
  if (raw.candidates !== undefined) {
    const parsed = parseCandidates(raw.candidates);
    if ('error' in parsed) return parsed;
    candidates = { ...(base?.candidates ?? {}), ...parsed.knobs };
  }

  let stagingSafety = base?.stagingSafety;
  if (raw.stagingSafety !== undefined) {
    if (!STAGING_SAFETY_VALUES.includes(raw.stagingSafety as StagingSafety)) {
      return {
        error: `stagingSafety must be one of ${STAGING_SAFETY_VALUES.join(', ')}`,
      };
    }
    stagingSafety = raw.stagingSafety as StagingSafety;
  }

  let engine: CentaurEngineKind = base?.engine ?? 'lobster';
  if (raw.engine !== undefined) {
    if (!ENGINE_VALUES.includes(raw.engine as CentaurEngineKind)) {
      return { error: `engine must be one of ${ENGINE_VALUES.join(', ')}` };
    }
    engine = raw.engine as CentaurEngineKind;
  }

  const name =
    typeof raw.name === 'string' && raw.name !== ''
      ? raw.name
      : typeof raw.bot === 'string'
        ? raw.bot
        : profile.name;

  // THE CHECK THAT MATTERS. Structural parsing above catches a malformed
  // value; this catches a well-formed one that would fold terms nobody chose.
  try {
    checkWeights(profile, FEATURES);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const spec: BotSpec = { name, engine, profile, candidates, stagingSafety };
  return { spec };
}

// -------------------------------------------------------------- the registry

/** How the registry reads the store. A port, so a test binds a plain object
 * and no suite is one import away from a live Postgres connection. */
export type BotBindingReader = () => Promise<Record<string, unknown>>;

export interface BotRegistryDeps {
  /**
   * Where stored bindings come from. REQUIRED, and deliberately so: the real
   * one reads `config_store` over Postgres and lives in `./bot-store.ts`,
   * which nothing in the decision layer imports. A registry that reached for
   * the database itself would put a live connection attempt one import away
   * from every lobster test — the same rule `TeamDecisionPorts.logDecision`
   * is built on.
   */
  readonly read: BotBindingReader;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (message: string) => void;
  readonly behaviourId?: () => string;
  readonly now?: () => number;
  /** How long a load stays fresh. */
  readonly ttlMs?: number;
  /**
   * The staging-safety LEVEL a binding that does not name one inherits.
   * Defaults to the `CENTAUR_STAGING_SAFETY` flag. Filled in here rather than
   * left absent so a resolved binding is COMPLETE — see `normalise`.
   */
  readonly stagingSafety?: () => StagingSafety;
}

const DEFAULT_TTL_MS = 60_000;

interface LoadedBindings {
  readonly catalog: Readonly<Record<string, BotSpec>>;
  readonly storeDefault: BotSpec | null;
  readonly byGame: ReadonlyMap<string, BotSpec>;
  readonly byCentaur: ReadonlyMap<string, BotSpec>;
  readonly warnings: ReadonlyArray<string>;
}

const EMPTY_LOAD: LoadedBindings = {
  catalog: BUILTIN_BOTS,
  storeDefault: null,
  byGame: new Map(),
  byCentaur: new Map(),
  warnings: [],
};

/**
 * The process's bot bindings, refreshed from `config_store` on a TTL.
 *
 * SYNCHRONOUS AT THE SEAM, ASYNCHRONOUS AT THE EDGE. `bindingFor` is called
 * inside a decision that is already racing a wall-clock deadline, so it never
 * awaits a database: it answers from the last successful load and kicks a
 * refresh in the background when that load is stale. The cost of the TTL is
 * that an operator's new binding takes effect within a minute rather than
 * instantly; the cost of the alternative would be a Postgres round trip on the
 * critical path of every turn.
 *
 * A FAILED LOAD CHANGES NOTHING. If the database is unreachable the previous
 * bindings stand — a transport blip must not silently re-bind every live game
 * to the default mid-experiment.
 */
export class BotRegistry {
  private readonly read: BotBindingReader;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (message: string) => void;
  private readonly behaviourIdOf: () => string;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly stagingSafetyOf: () => StagingSafety;

  private loaded: LoadedBindings = EMPTY_LOAD;
  private loadedAt = -Infinity;
  private inFlight: Promise<void> | null = null;
  /** The binding each game was last resolved to — what `/api/play/game/:id/bot`
   * reports, because "which bot is this game playing" is a question about what
   * the decision seam actually did, not about what the store says now. */
  private readonly observed = new Map<string, BotBinding>();

  constructor(deps: BotRegistryDeps) {
    this.read = deps.read;
    this.env = deps.env ?? process.env;
    this.log = deps.log ?? ((m) => console.warn(m));
    this.behaviourIdOf = deps.behaviourId ?? processBehaviourId;
    this.now = deps.now ?? (() => Date.now());
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.stagingSafetyOf = deps.stagingSafety ?? (() => stagingSafetyFrom(this.env, this.log));
  }

  /**
   * COMPLETE THE SPEC BEFORE ADDRESSING IT.
   *
   * A binding that does not name a staging-safety level means "follow the
   * process flag", and the flag is a behaviour-relevant knob. Left absent, two
   * deployments running the same stored binding under different flags would
   * derive the SAME `botId` while playing measurably differently — the exact
   * confusion the id exists to prevent. So the inherited value is filled in
   * here, once, before the address is taken, and the resolved binding is a
   * total description of the bot rather than a partial one.
   *
   * The BOARD-resolved level (`auto` → `full` on a piece board, `off` on a
   * snake-only one) is deliberately NOT what is filled in: that is a
   * consequence of the board, not a choice in the configuration, and folding
   * it into the id would make one bot into two depending on what it was
   * playing.
   */
  private normalise(spec: BotSpec): BotSpec {
    if (spec.stagingSafety !== undefined) return spec;
    return { ...spec, stagingSafety: this.stagingSafetyOf() };
  }

  /** Load bindings from the store now. Never throws. */
  async refresh(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    let entries: Record<string, unknown>;
    try {
      entries = await this.read();
    } catch (err) {
      this.log(
        `[bot-binding] Could not read bot bindings — keeping the previous set: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    this.loaded = this.interpret(entries);
    this.loadedAt = this.now();
  }

  /** Store rows → bindings. Every refusal is logged AND kept, so an operator
   * can see a rejected binding on the read-only route without shelling in. */
  private interpret(entries: Record<string, unknown>): LoadedBindings {
    const warnings: string[] = [];
    const refuse = (key: string, error: string): void => {
      const message = `[bot-binding] REFUSED ${key}: ${error} — falling through to the next binding`;
      this.log(message);
      warnings.push(`${key}: ${error}`);
    };

    // The catalog first: a game binding may name one of its members.
    const catalog: Record<string, BotSpec> = { ...BUILTIN_BOTS };
    const rawCatalog = entries[BOT_CATALOG_KEY];
    if (rawCatalog !== undefined) {
      if (!isRecord(rawCatalog)) {
        refuse(BOT_CATALOG_KEY, 'must be an object of name → bot');
      } else {
        for (const [name, value] of Object.entries(rawCatalog)) {
          const parsed = parseBotSpec(value, catalog);
          if ('error' in parsed) refuse(`${BOT_CATALOG_KEY}.${name}`, parsed.error);
          else catalog[name] = { ...parsed.spec, name };
        }
      }
    }

    const one = (key: string, raw: unknown): BotSpec | null => {
      const parsed = parseBotSpec(raw, catalog);
      if ('error' in parsed) {
        refuse(key, parsed.error);
        return null;
      }
      return parsed.spec;
    };

    let storeDefault: BotSpec | null = null;
    if (entries[BOT_DEFAULT_KEY] !== undefined) {
      storeDefault = one(BOT_DEFAULT_KEY, entries[BOT_DEFAULT_KEY]);
    }
    const byGame = new Map<string, BotSpec>();
    const byCentaur = new Map<string, BotSpec>();
    for (const [key, value] of Object.entries(entries)) {
      if (key.startsWith(BOT_GAME_KEY_PREFIX)) {
        const spec = one(key, value);
        if (spec !== null) byGame.set(key.slice(BOT_GAME_KEY_PREFIX.length), spec);
      } else if (key.startsWith(BOT_CENTAUR_KEY_PREFIX)) {
        const spec = one(key, value);
        if (spec !== null) byCentaur.set(key.slice(BOT_CENTAUR_KEY_PREFIX.length), spec);
      }
    }
    return { catalog, storeDefault, byGame, byCentaur, warnings };
  }

  /** Refusals from the last load, for the read-only route. */
  warnings(): ReadonlyArray<string> {
    return this.loaded.warnings;
  }

  /** The catalog a binding may name, built-ins plus whatever the store adds. */
  catalog(): Readonly<Record<string, BotSpec>> {
    return this.loaded.catalog;
  }

  /**
   * WHICH BOT THIS GAME PLAYS. Most specific binding wins; the env-level
   * default is the floor and is today's behaviour unchanged.
   *
   * Calling this RECORDS the answer as the game's observed binding, because
   * the caller is the decision seam and the seam's answer is what was played.
   * A reader that only wants to know what the next decision WOULD resolve to
   * asks `resolveFor`, which records nothing.
   */
  bindingFor(gameId: string, centaurId: string): BotBinding {
    const binding = this.resolveFor(gameId, centaurId);
    this.observed.set(gameId, binding);
    return binding;
  }

  /** The resolution, without recording it. */
  resolveFor(gameId: string, centaurId: string): BotBinding {
    if (this.now() - this.loadedAt >= this.ttlMs) {
      // Fire and forget: this call is inside a deadline-bounded decision.
      void this.refresh();
    }
    const behaviour = this.behaviourIdOf();
    const make = (raw: BotSpec, source: BotBindingSource, key: string | null): BotBinding => {
      const spec = this.normalise(raw);
      return { identity: botIdentityOf(spec, behaviour), spec, source, key };
    };

    const game = this.loaded.byGame.get(gameId);
    if (game !== undefined) return make(game, 'game', `${BOT_GAME_KEY_PREFIX}${gameId}`);
    const centaur = this.loaded.byCentaur.get(centaurId);
    if (centaur !== undefined) {
      return make(centaur, 'centaur', `${BOT_CENTAUR_KEY_PREFIX}${centaurId}`);
    }
    if (this.loaded.storeDefault !== null) {
      return make(this.loaded.storeDefault, 'store-default', BOT_DEFAULT_KEY);
    }
    return make(defaultBotSpecFrom(this.env, this.log), 'env-default', null);
  }

  /** The binding a game was last DECIDED under, or null if it has not decided
   * a turn yet. Distinct from `bindingFor` on purpose — a store edit mid-game
   * changes what the next turn resolves to, not what the last turn did. */
  observedFor(gameId: string): BotBinding | null {
    return this.observed.get(gameId) ?? null;
  }

  /** Game over: the binding record has no future. */
  release(gameId: string): void {
    this.observed.delete(gameId);
  }
}
