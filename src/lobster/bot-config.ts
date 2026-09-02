/**
 * A BOT, AS DATA — what replaced the feature flags.
 *
 * ── THE RULING THIS FILE IS ────────────────────────────────────────────────
 *
 * The owner's ruling of 2026-08-29: *"rip out the entire feature flags system
 * and stop using it and stop priming your future self to use this strategy."*
 * Corrections go in unconditionally. Rejected code is deleted. Version and
 * speed experiments are git branches judged by benchmarks. And what is left —
 * the genuine strategy alternatives, the ones where two reasonable bots
 * disagree — becomes CONFIGURATION, so that a comparison is between two named
 * bots rather than between two settings of one process.
 *
 * That last sentence is the whole design. A `BotConfig` is a plain JSON-able
 * value naming which registry entry sits in each socket plus the knobs and
 * weights those entries read. It has no methods, no environment, no lazy read
 * and no "resolved at call time" behaviour: a bot is fixed for the life of the
 * engine that plays it, exactly as a chess engine's settings are fixed for a
 * match.
 *
 * ── WHY THE ENVIRONMENT COULD NEVER HAVE DONE THIS ─────────────────────────
 *
 * Not a style objection — a measurement one, and the branch learned it five
 * separate times before the ruling landed. A process-wide variable moves EVERY
 * lobster seat on the board at once. The thing that has to be measurable is one
 * seat against unchanged opponents, so a paired experiment run from the
 * environment compares a board where everybody changed against a board where
 * nobody did, and measures nothing about the change. Every flag in the system
 * grew a per-engine override to work around this, which left every setting with
 * two sources of truth, an `X ?? XEnabled()` at every call site, and a
 * mechanism report whose whole job was to record which of the two had actually
 * won. All of that is gone: there is one source, and it is this value.
 *
 * The second cost was the one the owner named directly. A flag is a promise to
 * keep a code path that nothing runs, and the paths accumulated: the off-arms
 * rot, the on-arms are never quite the shipped build, and "dark and gated"
 * becomes the default way to add anything. A config field makes no such
 * promise. An alternative that loses is a deleted field and a deleted branch,
 * not a variable nobody sets.
 *
 * ── WHAT IS AND IS NOT IN HERE ─────────────────────────────────────────────
 *
 * IN: strategy alternatives, where two bots may reasonably differ and the
 * question is empirical (`territoryRefine`, the candidate knobs, the
 * staging-safety level), plus deployment choices that change speed and never
 * the decision (`workers`, `workersAudit`) and the substrate selection
 * (`engine`).
 *
 * NOT IN, and the rule that decides it is the registry's seam rule — IF IT CAN
 * CHANGE A SOUND BOUND IT IS KERNEL, IF IT CAN ONLY CHANGE ORDER OR SPEND IT IS
 * CONFIGURABLE:
 *
 *   · MACHINERY, WITH ONE MEASURED EXCEPTION. The depth layer always runs and
 *     has no field: what a bot rations is `depth`, never depth's existence.
 *     The cluster-factored exact enumeration it roots its threads at is the
 *     exception, and `search.clusterEnum` is the field — because the pass was
 *     measured at ~20% of a piece board's whole decision budget and no
 *     configuration could ask what that 20% buys (`depth.plyCap = 0` stops the
 *     threads and leaves the pass running). The dependency that kept it out —
 *     a switch on the enumeration is a silent switch on depth as well — is not
 *     dissolved: it is PUBLISHED. The scout names the reason on every decision
 *     and the cluster row reads zero rather than null, so an arm that sets it
 *     prices the pair and cannot be mistaken for a depth arm that found
 *     nothing. See `SearchSelections.clusterEnum`.
 *   · CORRECTIONS. The mutual-wipe terminal pricing, the tier-truth premise
 *     the substrate feeds the cloud, the tier-defense policy. Each is a
 *     statement about what the rules say or what the board is, and there is no
 *     bot for which the wrong one is right. They are unconditional and they
 *     have no field here.
 *   · THE SAFETY FLOOR. The rules-certain fatality refusals, the royal-path
 *     refusal, the never-empty candidate guard, the deadline and the emission
 *     barrier. No entry and no config may reach them.
 *
 * ── DEFAULTS ARE THE SHIPPED BOT, AND THAT IS A GATE ───────────────────────
 *
 * `DEFAULT_BOT_CONFIG` is not "sensible values". It is the bot that ships, term
 * for term, and the cross-build identity gate
 * (`src/tests/core-registry-identity.test.ts`) is the assertion that it is: a
 * decision taken under these defaults reproduces the pre-teardown build's plans,
 * emissions, tables, assumptions and refusals. So a field added here whose
 * default is anything other than what already ran is a gate failure, not a
 * review question.
 */

import { CENTAUR_ENGINE_DEFAULT, centaurEngineOf } from '../config/centaur-engine';
import type { CentaurEngineKind } from '../config/centaur-engine';
import type { CandidateKnobs } from './candidates';
import { DEFAULT_TERRITORY_REFINE } from './evaluate/refine';
import { DEFAULT_WORKERS, DEFAULT_WORKERS_AUDIT, parseWorkerSetting } from './parallel';
import type { WorkerSetting } from './parallel';
import { STAGING_SAFETY_DEFAULT } from './staging-safety';
import type { StagingSafety } from './staging-safety';
import type { ScoutTuning } from './search/scout';
import { SLATE_IDS, SLATE_LEGACY } from './registry';
import type { SlateId } from './registry';

/**
 * ONE BOT. Every field optional, because a contender file is a DIFF from the
 * shipped bot and reads better that way — `{ name: 'refiner', territoryRefine:
 * true }` is the whole of an arm. `resolveBotConfig` fills the rest in.
 */
export interface BotConfig {
  /**
   * WHAT THE COMPARISON IS BETWEEN. A sweep's rows are keyed on this, a
   * manifest records it, and the promotion ledger's `selection` fields name it
   * — so it is the one field with no default worth guessing.
   */
  readonly name?: string;

  // ---------------------------------------------------------------- sockets

  /**
   * WHICH ENTRY PER SOCKET, as a slate id (`registry.ts`).
   *
   * `'legacy'` is the shipped bot and the byte-identity bridge: it names the
   * entries that describe what already runs. `'potion-aware'` is the shipped
   * lineup plus the four merged potion terms — the first selectable
   * alternative at the evaluator socket, and the field's whole reason for
   * existing. Every term it adds is advisory, so selecting it changes the
   * ORDER over plans the floor ties and moves no bound.
   *
   * There is no default worth guessing here either: an unnamed slate is
   * `'legacy'`, and a contender that wants the other one says so.
   */
  readonly slate?: SlateId;

  // ------------------------------------------------------- strategy choices

  /**
   * DOOR C — the contested reach/room refiner (`evaluate/refine.ts`). Off in
   * the shipped bot; a probe-passed alternative with no live verdict, which is
   * exactly the shape a config entry exists for.
   */
  readonly territoryRefine?: boolean;

  /**
   * HOW MUCH OF THE STAGING-SAFETY LAYER IS LIVE (`staging-safety.ts`).
   * `'auto'` — the ship condition, board-conditional — is the shipped bot. The
   * unconditional levels are what an exploration-slice arm asks for.
   */
  readonly stagingSafety?: StagingSafety;

  /**
   * CANDIDATE-LAYER KNOBS (`candidates.ts` `CandidateKnobs`). A partial: what
   * is named overrides `DEFAULT_KNOBS`, what is not keeps it. This is where a
   * bot says `unitFatality: true`, or turns the tier-defense policy off to get
   * the corrected-beliefs-only bot.
   */
  readonly candidates?: CandidateKnobs;

  /**
   * THE MULTI-START SEED (`search/multistart-seed.ts`) — a random safe
   * baseline, then sampled multi-start hill climbing inside a slice of the
   * decision budget, then a weighted-random selection among what was found.
   * Off in the shipped bot: probe-passed, no live verdict.
   */
  readonly multistartSeed?: boolean;

  /**
   * THE SEEDED WEIGHTED LOTTERY (`selection/`) — the same NUMBER of options is
   * tried and WHICH ones is a Gumbel-top-k draw over the same priors, cooling
   * with the turn's clock. Off in the shipped bot, for the same reason.
   */
  readonly sampledCap?: boolean;

  /**
   * DEPTH'S RATION (`search/scout/schedule.ts`). Not whether depth runs — it
   * always runs, because it is machinery and not a strategy — but how much of
   * the decision it may buy: the tithe, the reserve that caps the tithe, the
   * ply ceiling and the park hysteresis.
   *
   * The shipped bot takes `DEFAULT_SCOUT_TUNING` whole. A bot that wants no
   * depth sets `{ plyCap: 0 }` and spends nothing on it, which is a budget
   * statement rather than a dark path — and it is the arm the depth-effect
   * rate is measured against.
   */
  readonly depth?: Partial<ScoutTuning>;

  // ------------------------------------------------------------- deployment

  /**
   * WHICH SUBSTRATE plays the full pass — `'lobster'` (shipped) or `'legacy'`
   * (the per-snake fan-out). See `config/centaur-engine.ts` for the measured
   * verdict that made lobster the default.
   */
  readonly engine?: CentaurEngineKind;

  /**
   * EVALUATION WORKERS. `'off'` is the shipped bot and the benchmark-winning
   * setting; see `parallel/config.ts`. Speed only — the pool cannot change
   * which decision is reached, which is why it is deployment config rather than
   * a strategy entry.
   */
  readonly workers?: WorkerSetting;

  /**
   * RECOMPUTE EVERY WORKER RESULT ON THE MAIN THREAD and throw on a
   * disagreement. Roughly doubles the evaluator's work; a soak instrument, and
   * false in every bot that plays.
   */
  readonly workersAudit?: boolean;

  /**
   * SEARCH-LAYER SELECTIONS. A partial: what is named overrides the shipped
   * search, what is not keeps it. See `SearchSelections`.
   */
  readonly search?: SearchSelections;
}

/**
 * WHAT A BOT MAY SELECT INSIDE THE SEARCH.
 *
 * Kept as its own nested object rather than as more top-level fields, because
 * these are choices about how a decision SPENDS rather than about what it
 * believes, and a reader deciding whether a contender is a strategy arm or a
 * budget arm should be able to see that from the shape of the file.
 */
export interface SearchSelections {
  /**
   * DOES THE CLUSTER-FACTORED EXACT ENUMERATION RUN AT ALL.
   *
   * Unset — and it is unset in the shipped bot — the enumeration runs, which
   * is what has always happened and what the byte-identity gates assert. Set
   * `false`, the partition is not built, no joint is enumerated and the pass
   * costs nothing.
   *
   * ── WHY THIS IS A FIELD AND NOT MACHINERY ─────────────────────────────────
   *
   * The header above says machinery has no field, and the enumeration was
   * classified as machinery on the argument that switching it was a silent
   * switch on depth as well. That argument stands and is NOT dissolved here —
   * it is stated (below, and in `SearchTuning.clusterEnum`) instead of being
   * enforced by absence. What changed is that the cost was measured: on a
   * piece board the enumeration is ~20% of the whole decision budget
   * (2,985 ms/game against 60 × 250 ms) versus 3.5% on snakes, and no
   * configuration could price what that 20% buys. `depth.plyCap = 0` stops the
   * deep threads and leaves the enumeration pass running, so it does not
   * answer the question either.
   *
   * ── THE DEPENDENCY, SAID OUT LOUD ─────────────────────────────────────────
   *
   * A bot that sets this false runs WITHOUT DEPTH TOO. The scout's threads are
   * rooted at this enumeration's own proposals and there is no other seed, so
   * turning the enumeration off turns depth off with it. That is one arm
   * carrying two changes and it must be read as such: it prices the pair, not
   * the enumeration alone, and `ScoutReport.gatedBy` names the reason on every
   * decision so the arm cannot be mistaken for a depth arm that merely found
   * nothing.
   */
  readonly clusterEnum?: boolean;
  /**
   * THE SIZE RATION — how much reach-expansion arithmetic ONE cluster may buy,
   * in pair-table claim slots. Unset keeps the shipped
   * `DEFAULT_CLUSTER_TUNING.maxClusterCells`; `0` lifts the ration entirely,
   * which is the arm that measures what the ration costs.
   *
   * A FIELD RATHER THAN MACHINERY, on the same measured argument that bought
   * `clusterEnum`. Batch 2 priced the enumeration per decision and found two
   * cost regimes: a SLIDER regime (`snake5-queen`, 223.8 ms a decision at 4.23
   * ms per joint — ten times any other board — on only 1.25× the clusters) and
   * a CROWD regime (the mix-king boards, 0.19 ms a joint on 2,500 of them).
   * A knight costs nothing at all, so the axis is REACH, not piece-presence.
   * `clusterEnum: false` skips the partition wholesale and is the wrong
   * instrument for either; these two are the right ones, and until they exist
   * no configuration can price what the enumeration buys.
   *
   * See `search/cluster-enum.ts`'s `maxClusterCells` for the ladder it
   * degrades down, which is coarser pricing and never a refusal.
   */
  readonly maxClusterCells?: number;
  /**
   * THE COUNT RATION — how many clusters one decision may SOLVE per slider
   * branch. Unset keeps the shipped default; `0` lifts the ration.
   *
   * The crowd regime's half. Beyond it a cluster keeps the seed's own
   * ordered-first assignment and no table is built for it.
   */
  readonly maxClustersSolved?: number;
}

/** A bot with every field settled — what the engine actually reads. */
export type ResolvedBotConfig = Required<
  Omit<BotConfig, 'candidates' | 'depth' | 'search'>
> & {
  readonly candidates: CandidateKnobs;
  readonly depth: Partial<ScoutTuning>;
  readonly search: SearchSelections;
};

/**
 * THE SHIPPED BOT. Every value here is the one that already ran; see the
 * header for why that is a gate rather than a preference.
 */
export const DEFAULT_BOT_CONFIG: ResolvedBotConfig = {
  name: 'default',
  slate: SLATE_LEGACY,
  territoryRefine: DEFAULT_TERRITORY_REFINE,
  stagingSafety: STAGING_SAFETY_DEFAULT,
  candidates: {},
  multistartSeed: false,
  sampledCap: false,
  depth: {},
  search: {},
  engine: CENTAUR_ENGINE_DEFAULT,
  workers: DEFAULT_WORKERS,
  workersAudit: DEFAULT_WORKERS_AUDIT,
};

/**
 * Fill a partial bot in against the shipped one.
 *
 * TOTAL AND LOUD, for the same reason `StrategyRegistry.resolve` is: a
 * contender whose `engine` is misspelled must not silently become the default
 * bot wearing an arm's name. `centaurEngineOf` warns and falls back;
 * `parseWorkerSetting` warns and falls back; everything else is a type the
 * compiler already checked, or — from JSON — is checked by
 * `botConfigFromJson`.
 */
export function resolveBotConfig(
  config: BotConfig = {},
  log: (message: string) => void = (m) => console.warn(m)
): ResolvedBotConfig {
  return {
    name: config.name ?? DEFAULT_BOT_CONFIG.name,
    slate: config.slate ?? DEFAULT_BOT_CONFIG.slate,
    territoryRefine: config.territoryRefine ?? DEFAULT_BOT_CONFIG.territoryRefine,
    stagingSafety: config.stagingSafety ?? DEFAULT_BOT_CONFIG.stagingSafety,
    candidates: config.candidates ?? DEFAULT_BOT_CONFIG.candidates,
    multistartSeed: config.multistartSeed ?? DEFAULT_BOT_CONFIG.multistartSeed,
    sampledCap: config.sampledCap ?? DEFAULT_BOT_CONFIG.sampledCap,
    depth: config.depth ?? DEFAULT_BOT_CONFIG.depth,
    search: config.search ?? DEFAULT_BOT_CONFIG.search,
    engine:
      config.engine === undefined
        ? DEFAULT_BOT_CONFIG.engine
        : centaurEngineOf(config.engine, log),
    workers:
      config.workers === undefined
        ? DEFAULT_BOT_CONFIG.workers
        : parseWorkerSetting(config.workers, log),
    workersAudit: config.workersAudit ?? DEFAULT_BOT_CONFIG.workersAudit,
  };
}

const STAGING_LEVELS: ReadonlyArray<StagingSafety> = ['off', 'auto', 'guard', 'full'];

/**
 * A CONTENDER FILE, VALIDATED — the entry point the sim harness uses.
 *
 * Throws on anything it cannot read, and never coerces silently. The whole
 * point of moving contenders out of the environment is that a batch can say
 * which bots it raced; a config that quietly became something else would put
 * the old ambiguity back in a new file format.
 */
export function botConfigFromJson(
  raw: unknown,
  log: (message: string) => void = (m) => console.warn(m)
): ResolvedBotConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError(`a bot config must be a JSON object, got ${JSON.stringify(raw)}`);
  }
  const o = raw as Record<string, unknown>;
  const known = new Set([
    'name',
    'slate',
    'territoryRefine',
    'stagingSafety',
    'candidates',
    'multistartSeed',
    'sampledCap',
    'depth',
    'search',
    'engine',
    'workers',
    'workersAudit',
  ]);
  // The search-layer teardown landed: `scout` is gone entirely (depth always
  // runs; what a bot rations is `depth`), `edgeEv` is a candidate knob, and the
  // rest are fields above. `clusterEnum` came BACK, as `search.clusterEnum` and
  // as a field rather than an environment variable — see `SearchSelections`
  // for the measurement that bought it and the depth dependency it carries.
  // Nothing in the search reads an environment variable, so a batch that names
  // its bots names everything that ran.
  for (const key of Object.keys(o)) {
    if (!known.has(key)) throw new TypeError(`unknown bot config field "${key}"`);
  }
  const bool = (key: string): boolean | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') throw new TypeError(`bot config "${key}" must be a boolean`);
    return v;
  };
  if (o.stagingSafety !== undefined && !STAGING_LEVELS.includes(o.stagingSafety as StagingSafety)) {
    throw new TypeError(
      `bot config "stagingSafety" must be one of ${STAGING_LEVELS.join(', ')}`
    );
  }
  if (o.slate !== undefined && !SLATE_IDS.includes(o.slate as SlateId)) {
    throw new TypeError(`bot config "slate" must be one of ${SLATE_IDS.join(', ')}`);
  }
  if (
    o.candidates !== undefined &&
    (typeof o.candidates !== 'object' || o.candidates === null || Array.isArray(o.candidates))
  ) {
    throw new TypeError('bot config "candidates" must be an object of candidate knobs');
  }
  if (o.name !== undefined && typeof o.name !== 'string') {
    throw new TypeError('bot config "name" must be a string');
  }
  if (
    o.depth !== undefined &&
    (typeof o.depth !== 'object' || o.depth === null || Array.isArray(o.depth))
  ) {
    throw new TypeError('bot config "depth" must be an object of depth-ration knobs');
  }
  // The nested object is checked to the same standard as the top level: an
  // unknown key inside it is refused, so a misspelled `clusterEnumeration`
  // cannot quietly become the default bot wearing an arm's name.
  if (o.search !== undefined) {
    if (typeof o.search !== 'object' || o.search === null || Array.isArray(o.search)) {
      throw new TypeError('bot config "search" must be an object of search selections');
    }
    const searchKnown = new Set(['clusterEnum', 'maxClusterCells', 'maxClustersSolved']);
    const sub = o.search as Record<string, unknown>;
    for (const key of Object.keys(sub)) {
      if (!searchKnown.has(key)) throw new TypeError(`unknown bot config field "search.${key}"`);
    }
    if (sub.clusterEnum !== undefined && typeof sub.clusterEnum !== 'boolean') {
      throw new TypeError('bot config "search.clusterEnum" must be a boolean');
    }
    // A ration is a COUNT, so a negative or fractional one is a typo rather
    // than a preference — and a typo that resolved to "no ration" would be an
    // arm silently wearing the default's behaviour.
    for (const key of ['maxClusterCells', 'maxClustersSolved']) {
      const v = sub[key];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
        throw new TypeError(
          `bot config "search.${key}" must be a non-negative integer (0 lifts the ration)`
        );
      }
    }
  }
  return resolveBotConfig(
    {
      name: o.name as string | undefined,
      slate: o.slate as SlateId | undefined,
      territoryRefine: bool('territoryRefine'),
      stagingSafety: o.stagingSafety as StagingSafety | undefined,
      candidates: o.candidates as CandidateKnobs | undefined,
      multistartSeed: bool('multistartSeed'),
      sampledCap: bool('sampledCap'),
      depth: o.depth as Partial<ScoutTuning> | undefined,
      search: o.search as SearchSelections | undefined,
      engine: o.engine as CentaurEngineKind | undefined,
      workers: o.workers as WorkerSetting | undefined,
      workersAudit: bool('workersAudit'),
    },
    log
  );
}
