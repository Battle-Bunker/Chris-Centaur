/**
 * THE MECHANISM REPORT — CL7's telemetry closure.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * Every stage of this program built the counters its own gate needs —
 * `ClusterReport`, `SelectionReport`, `ScoutReport`, `RefineReport`,
 * `AdjudicationReport`. What none of them did was give the SWEEP a way to read
 * them: `TeamTurnResult` carried a `KernelReport` and nothing else, and the
 * kernel report does not fold any of them in. So the live harness — the one
 * authority a promotion has — could see wall time, emissions, refusals and
 * bounds, and could not see whether the treatment arm had engaged at all.
 *
 * A null from an arm that never ran is a different finding from a null from an
 * arm that ran and did not help, and only these counters tell them apart.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * READ-ONLY, AND OFF THE DECISION PATH ENTIRELY. It is assembled once, after
 * the kernel loop has finished, from state the decision already produced.
 * Nothing here is consulted by a comparator, a bound, a candidate set or a
 * schedule; nothing here can move a plan. It is assembled from the existing
 * per-stage reports rather than from new counters precisely so that adding it
 * cannot perturb a hot loop: with every flag off, building this report reads a
 * handful of already-finished objects and allocates one.
 *
 * The flag-off byte-identity gate that every CL stage owes is therefore
 * satisfied structurally, not by measurement: no code above runs inside a
 * decision.
 *
 * ── THE ARM AUDIT, AND WHY IT IS THE MOST IMPORTANT FIELD ──────────────────
 *
 * `config` is the RESOLVED bot for the engine that produced this decision. It
 * exists because a batch manifest records what a run was ASKED for, and a
 * verdict depends on what the engine actually played.
 *
 * IT USED TO BE CALLED `flags`, AND THE RENAME IS THE POINT. Under the flag
 * system this field was load-bearing in a way a stamp should never have to be:
 * every switch parsed only `1|on|true`, warned on nothing, and was overridable
 * per engine, so a mistyped value or a per-engine option that silently beat the
 * environment produced an A/A null wearing a treatment's name, and this row was
 * the only way to catch it. With the bot resolved once from one source
 * (`bot-config.ts`) that whole failure mode is gone. The stamp stays, because
 * recording which bot played is worth doing on its own terms — but it is now a
 * record, not a defence.
 *
 * ── CHANNEL DISCIPLINE ─────────────────────────────────────────────────────
 *
 * Operator-side, never on the wire — the same argument `EmitRecord.selection`
 * and `EmitRecord.scout` carry. The emission path out of a decision is
 * `TeamDecisionEngine.forwardPlan`, which sends a `CentaurMove` and nothing
 * else; this report reaches only the caller of `decideTurn`, which is the
 * firebase interface (which ignores it) and the sim harness (which is the
 * point). An opponent sees the move and never the seed, the depth or the
 * cluster shape.
 */

import type { AdjudicationReport, ClusterReport, SearchCore } from '../contracts';
import type { BeliefReport } from '../belief';
import type { SlateStamp } from '../registry';
import type { CandidateKnobs } from '../candidates';
import type { MutualWipeReport, RefineReport } from '../evaluate';
import { mutualWipeReportOf, refineReportOf } from '../evaluate';
import type { SelectionReport } from '../selection';
import type { ScoutMode, ScoutReport } from '../search/scout';
import type { MultiStartReport } from '../search/multistart-seed';
import type { EngineSubstrate } from '../substrate';
import type { ResolvedStagingSafety } from '../staging-safety';
import type { ResolvedBotConfig } from '../bot-config';
import type { CentaurEngineKind } from '../../config/centaur-engine';

/**
 * The resolved bot for THIS decision's engine.
 *
 * One row per choice that could differ between two contenders. `stagingSafety`
 * and `gainOrdering` are the shipped defaults and are carried anyway: the
 * exploration slice runs the opposite branch of a settled policy, and a slice
 * whose arm cannot be audited is a slice nobody can read.
 *
 * WHAT IS DELIBERATELY ABSENT. The corrections have no row, because there is no
 * arm for them to name: the mutual-wipe terminal pricing is unconditional (its
 * ENGAGEMENT still shows, on `mutualWipe` below, which is the number a rare
 * event actually needs), and the tier-truth premise is a kernel constant. A
 * stamp field whose value cannot vary is a field that teaches the next reader
 * to look for a switch.
 */
export interface BotStamp {
  /** The contender name (`BotConfig.name`), which is what a sweep's rows key
   * on. `'default'` is the shipped bot. */
  readonly name: string;
  /** The substrate that played the full pass. */
  readonly engine: CentaurEngineKind;
  /** Door C's contested reach/room refiner (additionally requires
   * `clusterEnum`). */
  readonly territoryRefine: boolean;
  /** The staging-safety level RESOLVED against this board (`auto` is
   * board-conditional, so the configured level is not the arm). */
  readonly stagingSafety: ResolvedStagingSafety;
  /** The rung-0 fatality classifier (`BotConfig.candidates.unitFatality`). */
  readonly unitFatality: boolean;
  /** The shipped gain ordering (`BotConfig.candidates.gainOrdering`). */
  readonly gainOrdering: boolean;
  /** Evaluation workers, as the pool actually resolved it. 0 = no pool. */
  readonly workers: number;
  // TODO(teardown-search): the five rows below still resolve from
  // `process.env` inside `makeSearchCore` rather than from the bot. They move
  // to `BotConfig` with the search-layer teardown; until then this stamp is
  // still the only record of which arm a decision actually ran for them.
  /** CL1 — `CENTAUR_CLUSTER_SEED`. REJECTED on measurement; carried so an arm
   * that still sets it is legible. */
  readonly clusterSeed: boolean;
  /** The seeding redesign — `CENTAUR_MULTISTART_SEED`. Supersedes
   * `clusterSeed`: where both resolve on, the multi-start is the seed. */
  readonly multistartSeed: boolean;
  /** CL2 — `CENTAUR_EDGE_EV`. */
  readonly edgeEv: boolean;
  /** CL3 — `CENTAUR_CLUSTER_ENUM`. */
  readonly clusterEnum: boolean;
  /** CL4 — `CENTAUR_SAMPLED_CAP`. */
  readonly sampledCap: boolean;
  /** CL6 — `CENTAUR_SCOUT`. */
  readonly scout: ScoutMode;
}

/**
 * Everything one decision can say about what its mechanisms did.
 *
 * A `null` member means "this layer never ran", which is a distinguishable and
 * meaningful state — not zero. An ingest that folds nulls into zeros will
 * report an arm that refused as an arm that did nothing, which is the exact
 * confusion P5 hit.
 */
export interface MechanismReport {
  readonly config: BotStamp;
  /**
   * THE ENTRY REGISTRY'S RESOLUTION for this decision — the core redesign's
   * unit of account, alongside the flag stamp that is its predecessor.
   *
   * One entry id per socket. It is the same argument `flags` carries, moved to
   * the thing the redesign judges: a batch manifest records what a slate was
   * SET to; this records the entries the decision actually resolved, and an
   * entry id is what a measurement attaches to under the identity law.
   *
   * Always `slate: 'legacy'` in this increment, which is not a placeholder but
   * the claim being gated: the legacy entries ARE what ships, so a decision
   * that resolves them must be byte-identical to one taken before the registry
   * existed.
   */
  readonly slate: SlateStamp;
  /**
   * THE PER-BRANCH BELIEFS this decision carried (core redesign §3.1). Null
   * only when the decision produced no kernel report at all.
   *
   * `belief.deciding` is false here and says so on the wire of the report: the
   * structure is computed and carried and no decision reads it.
   */
  readonly belief: BeliefReport | null;
  /** CL3's per-decision cluster accounting; null unless `clusterEnum` ran. */
  readonly cluster: ClusterReport | null;
  /** CL4's lottery ledger, seed included; null unless `sampledCap` ran. */
  readonly selection: SelectionReport | null;
  /** CL6's thread accounting; null unless the scout ran. */
  readonly scout: ScoutReport | null;
  /** The multi-start seed's stage-0/stage-1 accounting for the last slice that
   * ran one; null unless the layer ran. */
  readonly multistart: MultiStartReport | null;
  /** Which slot of `better()` decided, over the decision. Always present when
   * the core publishes it — L17's instrument is not flag-gated. */
  readonly adjudication: AdjudicationReport | null;
  /** CL5's Door-C refiner telemetry; null unless the refiner ran. */
  readonly refine: RefineReport | null;
  /**
   * The mutual-wipe correction's engagement counters; null when no evaluation
   * ever reached a world with every team gone — which, at a measured 0.076%
   * base rate for that end kind, is most games. Null and not zero: a decision
   * that never reached the branch is a different finding from one that reached
   * it and refused, and with the correction unconditional this counter is the
   * ONLY way to tell a replay where it fired from one where it could not.
   */
  readonly mutualWipe: MutualWipeReport | null;
}

/** What the assembler needs that it cannot derive from the search core. */
export interface MechanismInputs {
  readonly search: SearchCore;
  readonly sub: EngineSubstrate;
  /** The bot this engine plays, resolved. */
  readonly bot: ResolvedBotConfig;
  /** The knobs the candidate generator resolved (`resolvedKnobs()`). */
  readonly knobs: Required<CandidateKnobs>;
  /** The staging-safety level RESOLVED against this board. */
  readonly stagingSafety: ResolvedStagingSafety;
  /** The pool size this decision actually had. */
  readonly workers: number;
  // TODO(teardown-search): the core's own answers for the five search-side
  // flags, until they move to the bot.
  readonly clusterSeed: boolean;
  readonly multistartSeed: boolean;
  readonly clusterEnum: boolean;
  readonly sampledCap: boolean;
  readonly scout: ScoutMode;
  /** The slate this decision resolved, as entry ids. */
  readonly slate: SlateStamp;
  /** The kernel's folded belief row, or null when no kernel report exists. */
  readonly belief: BeliefReport | null;
}

/**
 * Assemble the report. Pure with respect to the decision: it reads, it never
 * writes, and every optional accessor it calls is one the stage that built it
 * documented as telemetry.
 */
export function mechanismReportOf(inputs: MechanismInputs): MechanismReport {
  const { search, sub, knobs, bot } = inputs;
  return {
    config: {
      name: bot.name,
      engine: bot.engine,
      territoryRefine: bot.territoryRefine,
      stagingSafety: inputs.stagingSafety,
      unitFatality: knobs.unitFatality,
      gainOrdering: knobs.gainOrdering,
      workers: inputs.workers,
      clusterSeed: inputs.clusterSeed,
      multistartSeed: inputs.multistartSeed,
      edgeEv: knobs.edgeEv,
      clusterEnum: inputs.clusterEnum,
      sampledCap: inputs.sampledCap,
      scout: inputs.scout,
    },
    slate: inputs.slate,
    belief: inputs.belief,
    cluster: search.clusterReport?.() ?? null,
    selection: search.selectionReport?.() ?? null,
    scout: search.scoutReport?.() ?? null,
    multistart: search.multistartReport?.() ?? null,
    adjudication: search.adjudicationReport?.() ?? null,
    refine: refineReportOf(sub),
    mutualWipe: mutualWipeReportOf(sub),
  };
}
