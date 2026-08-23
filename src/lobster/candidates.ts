/**
 * THE CANDIDATE LAYER — every action worth handing to the search, ordered, with
 * a ledger saying exactly what was left out and why.
 *
 *   PRUNE ON CERTAINTY. BRANCH ON POSSIBILITY. RANK ON BOUNDS.
 *
 * It scores nothing. It prunes hard, and it says out loud what each prune
 * costs. Everything below is either a consequence of that line or an argument
 * for it.
 *
 * ── WHERE THE RULES COME FROM ──────────────────────────────────────────────
 *
 * Nowhere in this file. The option set is the engine's own `enumerateActions`
 * — the single enumerator that also serves enemy branching and narrowing, so a
 * candidate this layer generates is a candidate the resolver will accept, by
 * construction rather than by agreement. Whether a move survives, halts,
 * captures or exhausts is `RiskAssessor.assessPath`, the engine's own risk fold
 * over its own claim field. This file's whole job is to decide which of those
 * answers licenses dropping a candidate, and to write down what dropping it
 * could cost.
 *
 * ── EXACT VERSUS LOSSY, AND WHY THE SPLIT IS THE WHOLE DESIGN ──────────────
 *
 * `exact: true` means the pruned action provably resolves IDENTICALLY to one
 * that stayed, so no search above can be misled by its absence. All three exact
 * prunes descend from first-contact termination: a move ends at the first cell
 * where anything happens, and the engine truncates the path there, so a whole
 * tail of staged distances collapses onto one representative.
 *
 *   suffix-collapse        a CERTAIN stop (contest or certain death) at index j
 *   health-horizon         the mover cannot afford cell j+1 in any world
 *   certain-edge-horizon   a certain edge exchange at j, which is adjudicated
 *                          before walls, arrivals and bodies in its sub-step
 *
 * A piece merely standing in the way is NOT a stop: staying and moving are both
 * legal for it and moves are simultaneous, so it may not be there when we
 * arrive. Collapsing a suffix at an unpinned piece deletes real candidates.
 * Only certainty collapses.
 *
 * Everything else is `exact: false`, sits behind a knob, and names in the
 * ledger the class of tactic it can cost. Nothing is dropped silently, because
 * a conservative assumption nobody wrote down is a hidden bias toward one
 * world.
 *
 * ── THE TWO RULES LEARNED THE HARD WAY ─────────────────────────────────────
 *
 * 1. A HARD FILTER MUST NEVER EMPTY THE OPTION SET. The king filter keeps the
 *    best available TIER — every `safe` option if there is one, otherwise every
 *    `atRisk` one, otherwise everything. A per-candidate "must be safe" filter
 *    deletes every king move on a crowded board, where any possible arrival
 *    makes a square `atRisk`, and leaves only "stay", which is itself under
 *    fire. That loses the king and with it the team. The same guard is applied
 *    to the option set as a whole, so no combination of knobs can return
 *    nothing.
 *
 * 2. A REFUSAL RESTS ON PRESENCE-CERTAINTY, NOT STRENGTH-DETERMINACY. A cloud
 *    entry can be determinately fatal AND entirely avoidable. Only a verdict
 *    the claim layer reports as certain (`survival === "no"`) may make a
 *    candidate doomed; "this contest would go badly IF it happened" may not.
 *
 * ── ORDERED, NEVER FILTERED ────────────────────────────────────────────────
 *
 * `candidates` is ordered best-first and the anytime path may stop early, but
 * it is never truncated here: truncated maximin is optimistic — the direction
 * that walks into the reply you did not reach. Sizing the hypothesis set to the
 * budget is the caller's job, done up front, worst-first inside.
 */

import { profileOf, scalarOf } from '../partial-engine/index';
import type { EncounterVerdict, RiskAssessor, TraversalVerdict } from '../partial-engine/index';
import { EngineSubstrate } from './substrate';
import type { SubstrateUnit } from './substrate';
import type {
  Candidate,
  CandidateGenerator,
  CandidateSet,
  CellIndex,
  Substrate,
  UnitId,
} from './contracts';

// ---------------------------------------------------------------------------
// The prune vocabulary
// ---------------------------------------------------------------------------

/** Stable prune ids. The ledger carries these; prose lives in PRUNE_NOTES. */
export const PRUNE = {
  suffixCollapse: 'suffix-collapse',
  healthHorizon: 'health-horizon',
  certainEdgeHorizon: 'certain-edge-horizon',
  quietThinning: 'quiet-thinning',
  fatalNoGain: 'fatal-no-gain',
  kingUnsafe: 'king-unsafe',
  selfRegicide: 'self-regicide',
  promotionRefusal: 'promotion-refusal',
} as const;

export type PruneId = (typeof PRUNE)[keyof typeof PRUNE];

/** Whether a prune is outcome-preserving. Exactly three of them are. */
export const PRUNE_EXACT: Readonly<Record<PruneId, boolean>> = {
  [PRUNE.suffixCollapse]: true,
  [PRUNE.healthHorizon]: true,
  [PRUNE.certainEdgeHorizon]: true,
  [PRUNE.quietThinning]: false,
  [PRUNE.fatalNoGain]: false,
  [PRUNE.kingUnsafe]: false,
  [PRUNE.selfRegicide]: false,
  [PRUNE.promotionRefusal]: false,
};

/** What each lossy prune can cost, in the class of tactic it deletes. */
export const PRUNE_NOTES: Readonly<Record<PruneId, string>> = {
  [PRUNE.suffixCollapse]:
    'the move ends at a certain stop before this staged distance, so it resolves identically to the representative',
  [PRUNE.healthHorizon]:
    'the mover cannot afford the next cell in any world, so every longer staging resolves identically',
  [PRUNE.certainEdgeHorizon]:
    'a certain edge exchange settles the move at an earlier sub-step whichever way it goes',
  [PRUNE.quietThinning]:
    'a purely positional intermediate stop — blocking a line, parking out of a ring, or approaching a maybe without contesting it',
  [PRUNE.fatalNoGain]:
    'a deliberate sacrifice whose CORPSE blocks a cell for the rest of this turn (a durable collision object)',
  [PRUNE.kingUnsafe]:
    'a king move that gambles — kept whenever nothing safer exists, because an empty escape set loses the team',
  [PRUNE.selfRegicide]:
    'a move that ends our own team — kept only when the option set would otherwise be empty',
  [PRUNE.promotionRefusal]:
    'the promotion itself — a weight-1 queen is fragile, but promoting is the only way a pawn ever gains range',
};

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

export interface CandidateKnobs {
  /** Quiet ray prefixes kept per ray. `Infinity` disables the thinning. */
  readonly keepQuiet?: number;
  /** Drop moves that certainly kill us and certainly gain nothing. */
  readonly pruneFatalNoGain?: boolean;
  /** For a king, keep only the best available safety tier. */
  readonly kingHardSafety?: boolean;
  /** For a pawn one meal short of promotion, drop the promoting meal. */
  readonly refusePromotion?: boolean;
  /** Order slider destinations that shadow an enemy ray to our king first. */
  readonly escortShadowOrdering?: boolean;
}

export const DEFAULT_KNOBS: Required<CandidateKnobs> = {
  keepQuiet: 2,
  pruneFatalNoGain: true,
  kingHardSafety: true,
  refusePromotion: false,
  escortShadowOrdering: true,
};

// ---------------------------------------------------------------------------
// What the risk layer says about one action
// ---------------------------------------------------------------------------

/** The safety tier a set-level filter keeps whole. Order is the filter order. */
export type SafetyTier = 'safe' | 'atRisk' | 'doomed';
const TIERS: ReadonlyArray<SafetyTier> = ['safe', 'atRisk', 'doomed'];

export interface AssessedCandidate {
  readonly candidate: Candidate;
  readonly tier: SafetyTier;
  /** Does this move take something? 'yes' in every world, 'maybe', or 'no'. */
  readonly capture: 'yes' | 'maybe' | 'no';
  /** Health the move spends, at its interval endpoints. */
  readonly healthSpent: { readonly lo: number; readonly hi: number };
  /** Terminal cells the move could come to rest on. */
  readonly landing: ReadonlyArray<CellIndex>;
  /** How many held units' claims this move's outcome rests on. */
  readonly contingencies: number;
  /** Ordering hint only — never a bound. See SPECIALIST ordering below. */
  readonly shadowBonus: number;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export class GrammarCandidateGenerator implements CandidateGenerator {
  private readonly knobs: Required<CandidateKnobs>;
  /** Ray-shadow cells, per substrate. An ordering hint, computed once. */
  private readonly shadows = new WeakMap<EngineSubstrate, ReadonlySet<CellIndex>>();

  constructor(knobs: CandidateKnobs = {}) {
    this.knobs = { ...DEFAULT_KNOBS, ...knobs };
  }

  candidatesFor(sub: Substrate, unitId: UnitId): CandidateSet {
    if (!(sub instanceof EngineSubstrate)) {
      // The Substrate interface carries the resolution surface but not the
      // grammar surface this layer needs (see the amendment proposed in the
      // build report). Refuse loudly rather than guess at the rules.
      throw new TypeError(
        'candidatesFor needs the engine substrate: the grammar enumerator and the ' +
          'risk layer are not on the Substrate interface'
      );
    }
    return generate(sub, unitId, this.knobs, this.shadowsFor(sub));
  }

  /** The assessment behind a candidate set — ordering keys, tiers, ledgers. */
  assess(sub: EngineSubstrate, unitId: UnitId): ReadonlyArray<AssessedCandidate> {
    return generateAssessed(sub, unitId, this.knobs, this.shadowsFor(sub)).kept;
  }

  private shadowsFor(sub: EngineSubstrate): ReadonlySet<CellIndex> {
    const hit = this.shadows.get(sub);
    if (hit !== undefined) return hit;
    const made = this.knobs.escortShadowOrdering ? rayShadowCells(sub) : new Set<CellIndex>();
    this.shadows.set(sub, made);
    return made;
  }
}

/** The default generator, with the calibrated knobs. */
export const defaultCandidateGenerator = new GrammarCandidateGenerator();

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface PrunedEntry {
  candidate: Candidate;
  prune: string;
  exact: boolean;
}

interface Generated {
  kept: AssessedCandidate[];
  pruned: PrunedEntry[];
  legalCount: number;
}

function generate(
  sub: EngineSubstrate,
  unitId: UnitId,
  knobs: Required<CandidateKnobs>,
  shadows: ReadonlySet<CellIndex>
): CandidateSet {
  const { kept, pruned, legalCount } = generateAssessed(sub, unitId, knobs, shadows);
  return {
    unitId,
    candidates: kept.map((k) => k.candidate),
    prunedLedger: pruned,
    legalCount,
  };
}

function generateAssessed(
  sub: EngineSubstrate,
  unitId: UnitId,
  knobs: Required<CandidateKnobs>,
  shadows: ReadonlySet<CellIndex>
): Generated {
  const unit = sub.unitOf(unitId);
  if (unit === undefined) throw new Error(`candidates: no unit ${unitId} on this board`);

  // THE OPTION SET IS THE ENGINE'S. `enumerateActions` folds every cell of the
  // board through the kind's ONE interpretation and dedupes by canonical
  // effect, so `legalCount` counts distinct ACTIONS: two staged cells that mean
  // the same action are the same option, and the engine proves it rather than
  // this file asserting it.
  const actions = sub.enumerate(unitId);
  const legalCount = actions.length;
  const pruned: PrunedEntry[] = [];

  const raw: Candidate[] = actions.map((a) => ({
    unitId,
    to: a.dest,
    path: a.action.kind === 'move' ? [...a.action.path] : [],
  }));

  // ---- exact prunes: first-contact termination, per ray -------------------
  const surviving = collapseSuffixes(sub, unit, raw, pruned);

  // ---- assessment ---------------------------------------------------------
  const assessed = surviving.map((candidate) => assessOne(sub, unit, candidate, shadows));

  // ---- lossy prunes, each behind its knob ---------------------------------
  const afterQuiet = thinQuiet(sub, unit, assessed, pruned, knobs);
  const afterPolicy = policyPrunes(sub, unit, afterQuiet, pruned, knobs);
  const afterKing = keepBestTier(unit, afterPolicy, pruned, knobs);

  // ---- the emptiness guarantee -------------------------------------------
  // No combination of knobs may hand the search nothing. If every option was
  // taken by a LOSSY prune, the least-bad tier comes back — exact prunes are
  // never restored, because their representatives are still in the set.
  const kept = afterKing.length > 0 ? afterKing : restoreLeastBad(assessed, pruned);

  kept.sort(orderKey);
  return { kept, pruned, legalCount };
}

// ---------------------------------------------------------------------------
// Exact prunes
// ---------------------------------------------------------------------------

/**
 * First-contact termination, applied per ray.
 *
 * Actions that share a first path cell are prefixes of one ray. If the mover
 * can never occupy past index h of that ray, every action reaching beyond h
 * resolves identically to the one that ends AT h — which is itself a legal
 * staged cell, because the enumerator's paths are prefix-closed by
 * construction.
 *
 * ONE `assessPath` per ray, not per candidate: the horizon is a property of the
 * prefix, so the longest path answers for every shorter one.
 */
function collapseSuffixes(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  raw: ReadonlyArray<Candidate>,
  pruned: PrunedEntry[]
): Candidate[] {
  const rays = new Map<CellIndex, Candidate[]>();
  const kept: Candidate[] = [];
  for (const candidate of raw) {
    if (candidate.path.length === 0) {
      kept.push(candidate);
      continue;
    }
    const first = candidate.path[0] as CellIndex;
    const group = rays.get(first);
    if (group === undefined) rays.set(first, [candidate]);
    else group.push(candidate);
  }

  for (const group of rays.values()) {
    group.sort((a, b) => a.path.length - b.path.length);
    if (group.length === 1) {
      kept.push(group[0] as Candidate);
      continue;
    }
    const longest = group[group.length - 1] as Candidate;
    const verdict = assessPathOf(sub, unit, longest.path);
    const horizon = reachHorizonIndex(verdict);
    if (horizon < 0 || horizon >= longest.path.length - 1) {
      kept.push(...group);
      continue;
    }
    const reason = stopReason(verdict, horizon);
    for (const candidate of group) {
      if (candidate.path.length <= horizon + 1) kept.push(candidate);
      else pruned.push({ candidate, prune: reason, exact: true });
    }
  }
  return kept;
}

/**
 * THE REACH HORIZON: the furthest path index the mover can occupy in ANY
 * world, or −1 for a move that enters no cell.
 *
 * It is read straight off the risk fold's own stopping rule rather than
 * recomputed, and that is what makes it exact. `assessPath` evaluates cell i
 * only while reach is still possible and stops in exactly three places:
 *
 *   · reach became `no` — the previous cell was a CERTAIN halt or a CERTAIN
 *     death, so nothing gets past it;
 *   · a certain capture-stop at i, which truncates the ray;
 *   · the spend to STAND at i exceeds the mover's health. Movement cost is a
 *     function of the cells entered and the terrain alone — no other unit's
 *     choice enters it — so a mover that cannot afford cell i has halted at or
 *     before it in every world that reaches i, and stopped earlier in every
 *     world that does not.
 *
 * In all three the mover never occupies index `perCell.length` or beyond. So
 * every staged distance past the horizon executes the SAME prefix in the same
 * worlds: identical resolutions, and the collapse is a theorem rather than a
 * policy.
 *
 * A MAYBE-stop earlier on the ray does not shorten the horizon and must not:
 * it forks the ray, and both halves stay. That is the difference between this
 * and a "first blocker" rule, and it is the difference that stops the layer
 * deleting real candidates at unpinned pieces.
 */
function reachHorizonIndex(verdict: TraversalVerdict): number {
  return verdict.perCell.length - 1;
}

/**
 * Which exact prune fired, read off the engine's own verdict rather than
 * recomputed. `assessPath` breaks out of its fold in exactly two places: a
 * certain halt, and a spend the mover's health cannot cover. So a stop the
 * verdict does not call a halt is an exhaustion horizon, and a halt whose
 * causes name the edge is the edge horizon.
 *
 * A mislabel here costs a slightly wrong ledger line and nothing else — the
 * prune itself is licensed by the certainty, not by the label.
 */
function stopReason(verdict: TraversalVerdict, index: number): PruneId {
  const at = verdict.perCell[index];
  if (at === undefined) return PRUNE.healthHorizon;
  if (at.halt === 'yes') {
    return at.causes.some((c) => c.role === 'edge' && c.axis === 'halt')
      ? PRUNE.certainEdgeHorizon
      : PRUNE.suffixCollapse;
  }
  if (at.survival === 'no') return PRUNE.suffixCollapse;
  return PRUNE.healthHorizon;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

function assessPathOf(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  path: ReadonlyArray<CellIndex>
): TraversalVerdict {
  const assessor: RiskAssessor = sub.freshAssessor();
  return assessor.assessPath({
    unitId: unit.unitId,
    kind: unit.kind,
    strength: scalarOf(unit.tier, unit.weight),
    health: unit.health,
    path,
    origin: unit.cells[0] as number,
  });
}

const EMPTY_VERDICT = {
  perCell: [] as ReadonlyArray<EncounterVerdict>,
  survival: 'yes' as const,
  landing: { certain: null, cells: [] as ReadonlyArray<number> },
  healthSpent: { lo: 0, hi: 0 },
  exhaustionFatal: 'no' as const,
};

function assessOne(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate,
  shadows: ReadonlySet<CellIndex>
): AssessedCandidate {
  // A stay or a rotation enters no cell, so there is no traversal to assess:
  // the unit stands where it already stands, and whatever contests that square
  // contests it either way. The risk of STANDING is the evaluator's business,
  // not the candidate layer's.
  const verdict =
    candidate.path.length === 0 ? EMPTY_VERDICT : assessPathOf(sub, unit, candidate.path);

  const tier: SafetyTier =
    verdict.survival === 'no' || verdict.exhaustionFatal === 'yes'
      ? 'doomed'
      : verdict.survival === 'yes' && verdict.exhaustionFatal === 'no'
        ? 'safe'
        : 'atRisk';

  let capture: AssessedCandidate['capture'] = 'no';
  let contingencies = 0;
  for (const cell of verdict.perCell) {
    if (cell.defeat === 'yes') capture = 'yes';
    else if (cell.defeat === 'maybe' && capture === 'no') capture = 'maybe';
    for (const cause of cell.causes) if (cause.contingent) contingencies++;
  }

  const landing =
    verdict.landing.cells.length > 0
      ? [...verdict.landing.cells]
      : [candidate.path.length > 0 ? (candidate.path[candidate.path.length - 1] as number) : (unit.cells[0] as number)];

  let shadowBonus = 0;
  for (const cell of landing) if (shadows.has(cell)) shadowBonus = 1;

  return {
    candidate,
    tier,
    capture,
    healthSpent: verdict.healthSpent,
    landing,
    contingencies,
    shadowBonus,
  };
}

// ---------------------------------------------------------------------------
// Lossy prunes
// ---------------------------------------------------------------------------

/**
 * Ray-prefix thinning. Every prefix of a ray is a distinct outcome, but the
 * interesting ones are few: the first index (whose edge-exchange rule differs
 * from every other cell on the ray), the horizon, every maybe-stop (a genuine
 * fork) and the index before it (approach without contesting), and every
 * terrain event. Everything else is QUIET, and quiet is what gets thinned.
 */
function thinQuiet(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[],
  knobs: Required<CandidateKnobs>
): AssessedCandidate[] {
  if (!Number.isFinite(knobs.keepQuiet)) return [...assessed];
  const rays = new Map<CellIndex, AssessedCandidate[]>();
  const out: AssessedCandidate[] = [];
  for (const a of assessed) {
    if (a.candidate.path.length === 0) {
      out.push(a);
      continue;
    }
    const first = a.candidate.path[0] as CellIndex;
    const group = rays.get(first);
    if (group === undefined) rays.set(first, [a]);
    else group.push(a);
  }

  for (const group of rays.values()) {
    group.sort((a, b) => a.candidate.path.length - b.candidate.path.length);
    if (group.length <= 1) {
      out.push(...group);
      continue;
    }
    const interesting = new Set<number>();
    interesting.add(0); // the edge-exchange index
    interesting.add(group.length - 1); // the horizon
    group.forEach((a, i) => {
      const end = a.candidate.path[a.candidate.path.length - 1] as number;
      if (sub.foodAt(end) || sub.hazardAt(end)) interesting.add(i);
      if (a.tier !== 'safe') {
        interesting.add(i); // a maybe-stop is a genuine fork
        if (i > 0) interesting.add(i - 1); // approach without contesting
      }
    });
    let quietKept = 0;
    group.forEach((a, i) => {
      if (interesting.has(i)) {
        out.push(a);
        return;
      }
      if (quietKept < knobs.keepQuiet) {
        quietKept++; // near-before-far: the first quiet indices survive
        out.push(a);
        return;
      }
      pruned.push({ candidate: a.candidate, prune: PRUNE.quietThinning, exact: false });
    });
  }
  void unit;
  return out;
}

/** The per-candidate policy prunes. Each is optional and each is reported. */
function policyPrunes(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[],
  knobs: Required<CandidateKnobs>
): AssessedCandidate[] {
  const lastKing = isLastKingOfItsTeam(sub, unit);
  const out: AssessedCandidate[] = [];
  for (const a of assessed) {
    // Standing still is the baseline every prune is judged against, and it is
    // never pruned: it costs no health and cannot walk into anything.
    if (a.candidate.path.length === 0) {
      out.push(a);
      continue;
    }
    if (lastKing && a.tier === 'doomed') {
      pruned.push({ candidate: a.candidate, prune: PRUNE.selfRegicide, exact: false });
      continue;
    }
    if (knobs.pruneFatalNoGain && a.tier === 'doomed' && a.capture === 'no') {
      pruned.push({ candidate: a.candidate, prune: PRUNE.fatalNoGain, exact: false });
      continue;
    }
    if (knobs.refusePromotion && promotes(sub, unit, a)) {
      pruned.push({ candidate: a.candidate, prune: PRUNE.promotionRefusal, exact: false });
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * The king filter, applied to the SET rather than to each candidate.
 *
 * It keeps the best available tier: every `safe` option if there is one,
 * otherwise every `atRisk` one, otherwise everything. Monotone, and it can
 * never hand back fewer options than it was given when they are all equally
 * bad — which is exactly the property a per-candidate safety filter lacks, and
 * exactly why that filter loses the king.
 */
function keepBestTier(
  unit: SubstrateUnit,
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[],
  knobs: Required<CandidateKnobs>
): AssessedCandidate[] {
  if (!unit.isKing || !knobs.kingHardSafety) return [...assessed];
  for (const tier of TIERS) {
    const kept = assessed.filter((a) => a.tier === tier);
    if (kept.length === 0) continue;
    for (const dropped of assessed) {
      if (dropped.tier === tier) continue;
      pruned.push({ candidate: dropped.candidate, prune: PRUNE.kingUnsafe, exact: false });
    }
    return kept;
  }
  return [...assessed];
}

/**
 * The emptiness guarantee. Every lossy prune is reversible, and this is where
 * it is reversed: if policy emptied the set, the least-bad tier comes back and
 * its ledger entries are withdrawn. Exact prunes are never restored — their
 * representatives are already in the set, so restoring them would add nothing
 * but duplicates.
 */
function restoreLeastBad(
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[]
): AssessedCandidate[] {
  for (const tier of TIERS) {
    const kept = assessed.filter((a) => a.tier === tier);
    if (kept.length === 0) continue;
    const restored = new Set(kept.map((a) => a.candidate.to));
    for (let i = pruned.length - 1; i >= 0; i--) {
      const entry = pruned[i] as PrunedEntry;
      if (entry.exact) continue;
      if (restored.has(entry.candidate.to)) pruned.splice(i, 1);
    }
    return kept;
  }
  return [...assessed];
}

// ---------------------------------------------------------------------------
// Ordering — best-first, deterministic, and never a bound
// ---------------------------------------------------------------------------

/**
 * The order the anytime path walks. It carries no soundness weight whatsoever:
 * a search that stops early loses only the moves it did not reach, and every
 * move it did reach was scored by the evaluator, not by this comparator.
 *
 * Tiers first (danger order), then captures, then the escort ray-shadow hint,
 * then health preserved, then the number of held units the outcome rests on
 * (fewer contingencies first: a decision that needs less refinement is worth
 * more per millisecond), and finally the destination, so the order is total and
 * reproducible.
 */
function orderKey(a: AssessedCandidate, b: AssessedCandidate): number {
  const tier = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier);
  if (tier !== 0) return tier;
  const capture = captureRank(b.capture) - captureRank(a.capture);
  if (capture !== 0) return capture;
  if (a.shadowBonus !== b.shadowBonus) return b.shadowBonus - a.shadowBonus;
  if (a.healthSpent.hi !== b.healthSpent.hi) return a.healthSpent.hi - b.healthSpent.hi;
  if (a.contingencies !== b.contingencies) return a.contingencies - b.contingencies;
  return a.candidate.to - b.candidate.to;
}

const captureRank = (c: AssessedCandidate['capture']): number =>
  c === 'yes' ? 2 : c === 'maybe' ? 1 : 0;

// ---------------------------------------------------------------------------
// The one imported specialist geometry: escort ray-shadowing
// ---------------------------------------------------------------------------

/**
 * ESCORT RAY-SHADOWING, as an ORDERING HINT and nothing more.
 *
 * The only protection geometry these rules admit: an ally standing IN an enemy
 * slider's line truncates it, because occupancy never clears mid-turn under
 * frozen state. Standing NEXT to the king does nothing — there is no recapture,
 * so a defended square is not a protected one. That is the opposite of the
 * chess intuition, which is why it is worth a hint at all.
 *
 * Computed once per substrate: the open cells strictly between an enemy slider
 * and one of our kings, along one of that slider's own ray directions.
 */
function rayShadowCells(sub: EngineSubstrate): ReadonlySet<CellIndex> {
  const out = new Set<CellIndex>();
  const kings = sub.roster().filter((u) => u.isKing && sub.modeled().has(u.unitId));
  if (kings.length === 0) return out;
  const width = sub.grid.width;
  for (const enemy of sub.roster()) {
    if (kings.some((k) => k.team === enemy.team)) continue;
    const profile = profileOf(enemy.kind);
    if (profile.rays.length === 0) continue;
    const from = enemy.cells[0] as number;
    for (const king of kings) {
      const to = king.cells[0] as number;
      const dx = (to % width) - (from % width);
      const dy = Math.floor(to / width) - Math.floor(from / width);
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      if (steps < 2) continue;
      const ux = Math.sign(dx);
      const uy = Math.sign(dy);
      // Only a direction the slider actually has, and only a straight line.
      if (dx !== ux * steps || dy !== uy * steps) continue;
      if (!profile.rays.some(([rx, ry]) => rx === ux && ry === uy)) continue;
      for (let i = 1; i < steps; i++) {
        out.add(from + (uy * i) * width + ux * i);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small predicates
// ---------------------------------------------------------------------------

/** Is this unit the last living king of a team that plays under regicide? */
function isLastKingOfItsTeam(sub: EngineSubstrate, unit: SubstrateUnit): boolean {
  if (!unit.isKing) return false;
  if (!sub.regicideTeamNumbers().has(unit.team)) return false;
  let kings = 0;
  for (const other of sub.roster()) if (other.team === unit.team && other.isKing) kings++;
  return kings === 1;
}

/**
 * Would this move take the meal that promotes the mover? The threshold is the
 * engine's configured `pawnPromotionWeight`, and whether the KIND promotes at
 * all is `profilesTo` — never a name comparison.
 */
function promotes(sub: EngineSubstrate, unit: SubstrateUnit, a: AssessedCandidate): boolean {
  if (profileOf(unit.kind).promotesTo === null) return false;
  if (unit.weight + 1 < sub.engine.config.pawnPromotionWeight) return false;
  return a.landing.some((cell) => sub.foodAt(cell));
}
