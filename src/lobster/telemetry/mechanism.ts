/**
 * THE MECHANISM REPORT — CL7's telemetry closure.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * Every stage of this program shipped its flag OFF and named an empirical
 * promotion gate that some later live sweep would have to run. Each stage also
 * built the counters its own gate needs — `ClusterReport`, `SelectionReport`,
 * `ScoutReport`, `RefineReport`, `AdjudicationReport`, the territory
 * workspace's `wasmRuns`/`wasmRefused`. What none of them did was give the
 * SWEEP a way to read them: `TeamTurnResult` carried a `KernelReport` and
 * nothing else, and the kernel report does not fold any of them in. So the
 * live harness — the one authority a promotion has — could see wall time,
 * emissions, refusals and bounds, and could not see whether the treatment arm
 * had engaged at all.
 *
 * That was not hypothetical. Batch 20260827's P5 cell (`CENTAUR_WASM`) had to
 * be reported as "placement NULL, and engagement UNVERIFIED", because the wasm
 * arm is refused per partition, silently, whenever an input it needs is not
 * resident — and `wasmRuns` was unreachable from outside `evaluate/territory`.
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
 * `flags` is the RESOLVED state of every promotable flag for the engine that
 * produced this decision. It exists because every CL flag parses only
 * `1|on|true`, warns on nothing, and is overridable per engine — so an arm
 * with a mistyped value, or an arm whose per-engine option silently won over
 * the environment, is an A/A null wearing a treatment's name. A batch manifest
 * records what the environment was SET to. This records what the engine
 * actually resolved, which is the quantity a verdict depends on.
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
import type { CandidateKnobs } from '../candidates';
import type { RefineReport, WasmEngagement } from '../evaluate';
import { refineReportOf, wasmEngagementOf } from '../evaluate';
import type { SelectionReport } from '../selection';
import type { ScoutMode, ScoutReport } from '../search/scout';
import type { EngineSubstrate } from '../substrate';
import type { ResolvedStagingSafety } from '../staging-safety';
import type { TierTruth } from '../tier-truth';
import type { WasmMode } from '../wasm/policy';

/**
 * The resolved position of every promotable flag, for THIS decision's engine.
 *
 * One row per flag the promotion ledger tracks. `stagingSafety` and
 * `gainOrdering` are already promoted and are carried anyway: the exploration
 * slice runs the opposite branch of a promoted flag, and a slice whose arm
 * cannot be audited is a slice nobody can read.
 */
export interface FlagStamp {
  /** CL1 — `CENTAUR_CLUSTER_SEED`. */
  readonly clusterSeed: boolean;
  /** CL1 — `CENTAUR_UNIT_FATALITY`. */
  readonly unitFatality: boolean;
  /** CL2 — `CENTAUR_EDGE_EV`. */
  readonly edgeEv: boolean;
  /** CL3 — `CENTAUR_CLUSTER_ENUM`. */
  readonly clusterEnum: boolean;
  /** CL4 — `CENTAUR_SAMPLED_CAP`. */
  readonly sampledCap: boolean;
  /** CL5 — `CENTAUR_TERRITORY_REFINE` (additionally requires `clusterEnum`). */
  readonly territoryRefine: boolean;
  /** CL6 — `CENTAUR_SCOUT`. */
  readonly scout: ScoutMode;
  /** W3 — `CENTAUR_WASM`, as pinned onto this decision's substrate. */
  readonly wasm: WasmMode;
  /** W1 — `CENTAUR_WORKERS`, as the pool actually resolved it. 0 = no pool. */
  readonly workers: number;
  /** Stage 2.5 — `CENTAUR_TIER_TRUTH`. */
  readonly tierTruth: TierTruth;
  /** I1 — `CENTAUR_STAGING_SAFETY`, RESOLVED against this board (`auto` is
   * board-conditional, so the raw level is not the arm). */
  readonly stagingSafety: ResolvedStagingSafety;
  /** Promoted at integ/round-a; carried for the exploration slice. */
  readonly gainOrdering: boolean;
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
  readonly flags: FlagStamp;
  /** CL3's per-decision cluster accounting; null unless `clusterEnum` ran. */
  readonly cluster: ClusterReport | null;
  /** CL4's lottery ledger, seed included; null unless `sampledCap` ran. */
  readonly selection: SelectionReport | null;
  /** CL6's thread accounting; null unless the scout ran. */
  readonly scout: ScoutReport | null;
  /** Which slot of `better()` decided, over the decision. Always present when
   * the core publishes it — L17's instrument is not flag-gated. */
  readonly adjudication: AdjudicationReport | null;
  /** CL5's Door-C refiner telemetry; null unless the refiner ran. */
  readonly refine: RefineReport | null;
  /** W3's engagement counters; null when no territory workspace was built. */
  readonly wasm: WasmEngagement | null;
}

/** What the assembler needs that it cannot derive from the search core. */
export interface MechanismInputs {
  readonly search: SearchCore;
  readonly sub: EngineSubstrate;
  /** The knobs the candidate generator resolved (`resolvedKnobs()`). */
  readonly knobs: Required<CandidateKnobs>;
  /** The staging-safety level RESOLVED against this board. */
  readonly stagingSafety: ResolvedStagingSafety;
  /** The core's own answers for the five search-side flags. */
  readonly clusterSeed: boolean;
  readonly clusterEnum: boolean;
  readonly territoryRefine: boolean;
  readonly sampledCap: boolean;
  readonly scout: ScoutMode;
  readonly wasm: WasmMode;
  readonly workers: number;
  readonly tierTruth: TierTruth;
}

/**
 * Assemble the report. Pure with respect to the decision: it reads, it never
 * writes, and every optional accessor it calls is one the stage that built it
 * documented as telemetry.
 */
export function mechanismReportOf(inputs: MechanismInputs): MechanismReport {
  const { search, sub, knobs } = inputs;
  return {
    flags: {
      clusterSeed: inputs.clusterSeed,
      unitFatality: knobs.unitFatality,
      edgeEv: knobs.edgeEv,
      clusterEnum: inputs.clusterEnum,
      sampledCap: inputs.sampledCap,
      territoryRefine: inputs.territoryRefine,
      scout: inputs.scout,
      wasm: inputs.wasm,
      workers: inputs.workers,
      tierTruth: inputs.tierTruth,
      stagingSafety: inputs.stagingSafety,
      gainOrdering: knobs.gainOrdering,
    },
    cluster: search.clusterReport?.() ?? null,
    selection: search.selectionReport?.() ?? null,
    scout: search.scoutReport?.() ?? null,
    adjudication: search.adjudicationReport?.() ?? null,
    refine: refineReportOf(sub),
    wasm: wasmEngagementOf(sub),
  };
}
