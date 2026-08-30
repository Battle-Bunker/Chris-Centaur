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
 *   · MACHINERY. The cluster-factored exact enumeration and the depth layer
 *     that roots its threads at that enumeration's proposals. Both always run;
 *     what a bot configures is depth's RATION (`depth`), never its existence.
 *     A switch on the enumeration was a silent switch on depth as well, which
 *     is the dependency class that made one experiment race three identical
 *     contenders.
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
import { SLATE_LEGACY } from './registry';
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
   * WHICH ENTRY PER SOCKET, as a slate id (`registry.ts`). `SlateId` has one
   * member today by construction, so this is the byte-identity bridge and not
   * yet a choice; it is here because it is the field every future strategy
   * alternative arrives through, and a contender file that already names it
   * does not change shape when the second slate lands.
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
}

/** A bot with every field settled — what the engine actually reads. */
export type ResolvedBotConfig = Required<Omit<BotConfig, 'candidates' | 'depth'>> & {
  readonly candidates: CandidateKnobs;
  readonly depth: Partial<ScoutTuning>;
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
    'engine',
    'workers',
    'workersAudit',
  ]);
  // The search-layer teardown landed: `scout` and `clusterEnum` are gone
  // entirely (depth and the cluster enumeration are machinery and always run),
  // `edgeEv` is a candidate knob, and the other two are fields above. Nothing
  // in the search reads an environment variable any more, so a batch that
  // names its bots names everything that ran.
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
  if (o.slate !== undefined && o.slate !== SLATE_LEGACY) {
    throw new TypeError(`bot config "slate" must be "${SLATE_LEGACY}"`);
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
      engine: o.engine as CentaurEngineKind | undefined,
      workers: o.workers as WorkerSetting | undefined,
      workersAudit: bool('workersAudit'),
    },
    log
  );
}
