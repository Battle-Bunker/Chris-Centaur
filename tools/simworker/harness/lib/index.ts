/**
 * The harness's public surface — one import for stage-1 sweep agents and
 * stage-2 miners.
 *
 *   const H = require('<harness>/build/lib/index.js');
 *
 * A miner that only reads replays should import `./replay` directly instead:
 * it pulls in no engine code, so it loads in milliseconds and cannot be broken
 * by a change to the bots.
 */

export {
  type MatchConfig,
  type MatchConfigInput,
  type UnitKind,
  type HazardLayout,
  type FoodConfig,
  type FertileConfig,
  type HazardConfig,
  type PotionConfig,
  ConfigError,
  normalizeConfig,
  validateConfig,
  configHash,
  boardHash,
  hazardRegimes,
  resolveHazardDamage,
  rosterFor,
  totalUnits,
  worstHeldCount,
  UNIT_KINDS,
  MATERIAL_WEIGHT,
  MAX_FROZEN_CAPACITY,
  MIN_SIZE,
  MAX_SIZE,
  MIN_UNITS,
  MAX_UNITS,
  UNSUPPORTED_AXES,
} from './config';

export { PRESETS, PRESET_NAMES, preset } from './presets';
export { buildGame, type BuiltGame } from './build-game';

export {
  BOT_NAMES,
  isBotName,
  makeBot,
  shutdownDecisionPool,
  encodeBound,
  decodeBound,
  type Bot,
  type BotName,
  type BoundValue,
  type DecisionTelemetry,
} from './bots';

export { runMatch, placementsOf, describeConfig, type MatchOutcome, type RunMatchOptions } from './match';

export {
  planSweep,
  rotations,
  manifestRow,
  readManifest,
  ManifestWriter,
  type SweepJob,
  type SweepSpec,
  type ManifestRow,
} from './sweep';

export { runJobs, runInline, runForked, poolSizeFor, type RunOptions } from './runner';

export {
  loadReplay,
  loadHeader,
  iterateRows,
  iterateTurns,
  replayDigest,
  ReplayWriter,
  REPLAY_FORMAT_VERSION,
  type LoadedReplay,
  type ReplayHeader,
  type ReplayTurn,
  type ReplayResult,
  type ReplayRow,
  type ReplayStagedMove,
} from './replay';

export {
  standings,
  standingFor,
  teamAlive,
  unitsOf,
  livingTeams,
  resolveFullTurn,
  judgeLegality,
  type TurnEvents,
  type TurnOutcome,
  type TeamStanding,
} from './sim';

export { type TeamStandingRow } from './match-types';
