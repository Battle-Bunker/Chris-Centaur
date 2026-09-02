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
import type { EncounterVerdict, RiskAssessor, TraversalVerdict, Trit } from '../partial-engine/index';
import { EngineSubstrate } from './substrate';
import type { SubstrateUnit } from './substrate';
import { TIER_DEFENSE } from './tier-truth';
import { exposureOf, gradePath, selfDebuffOf, selfDebuffRank, tierGradeRank } from './tier-window';
import type { SelfDebuff, TierExposure, TierGrade } from './tier-window';
import {
  allyBodyCollision,
  certainlySelfFatal,
  killsOwnKing,
  resolveStagingSafety,
  stagingSafety,
} from './staging-safety';
import type { StagingSafety } from './staging-safety';
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
  terrainFatal: 'terrain-fatal',
  kingUnsafe: 'king-unsafe',
  kingTierUnsafe: 'king-tier-unsafe',
  tierDecisive: 'tier-decisive',
  selfRegicide: 'self-regicide',
  promotionRefusal: 'promotion-refusal',
  certainSelfFatal: 'certain-self-fatal',
  allyBody: 'ally-body',
  royalPath: 'royal-path',
} as const;

export type PruneId = (typeof PRUNE)[keyof typeof PRUNE];

/**
 * Whether a prune is outcome-preserving.
 *
 * `suffix-collapse` WAS one, and is not any more — UPSTREAM DEMAND. The engine's
 * living-body encounter is now answered by TIER alone (weight is absent from
 * the rule), so a strictly higher-tier mover SEVERS the body and continues
 * where the old weight comparator halted it. `risk.ts`'s halt axis has not
 * followed: `assessPath` still reports a certain halt at a claim's body cell,
 * so the collapse deletes a staged distance the resolver would genuinely
 * reach. Reproduced against the real resolver — a weight-3 rook at (1,3) with
 * 10 health, a weight-2 snake claim at (1,4), 11x11: staging the cell BEYOND
 * the claim resolves to the rook standing there with 8 health, not to the
 * representative's stop with 9.
 *
 * The prune still fires — it is worth its cost — but it is DECLARED lossy, so
 * the ledger names what it can delete instead of asserting an exactness it no
 * longer has. Restore `true` when the halt axis is tier-only too, and the
 * exactness suite will prove it.
 */
export const PRUNE_EXACT: Readonly<Record<PruneId, boolean>> = {
  [PRUNE.suffixCollapse]: false,
  [PRUNE.healthHorizon]: true,
  [PRUNE.certainEdgeHorizon]: true,
  [PRUNE.quietThinning]: false,
  [PRUNE.fatalNoGain]: false,
  [PRUNE.terrainFatal]: false,
  [PRUNE.kingUnsafe]: false,
  [PRUNE.kingTierUnsafe]: false,
  [PRUNE.tierDecisive]: false,
  [PRUNE.selfRegicide]: false,
  [PRUNE.promotionRefusal]: false,
  // NOT exact, and the distinction matters. The pruned action really is fatal
  // by rule, so no candidate that stayed resolves identically to it — the
  // action is DELETED, not represented. That is a policy, and a policy is
  // lossy however certain its premise.
  [PRUNE.certainSelfFatal]: false,
  [PRUNE.allyBody]: false,
  [PRUNE.royalPath]: false,
};

/** What each lossy prune can cost, in the class of tactic it deletes. */
export const PRUNE_NOTES: Readonly<Record<PruneId, string>> = {
  [PRUNE.suffixCollapse]:
    'the move ends at a stop the claim layer calls certain before this staged distance — outcome-preserving except where a higher-tier mover severs a living body and continues, which the halt axis does not yet model',
  [PRUNE.healthHorizon]:
    'the mover cannot afford the next cell in any world, so every longer staging resolves identically',
  [PRUNE.certainEdgeHorizon]:
    'a certain edge exchange settles the move at an earlier sub-step whichever way it goes',
  [PRUNE.quietThinning]:
    'a purely positional intermediate stop — blocking a line, parking out of a ring, or approaching a maybe without contesting it',
  [PRUNE.fatalNoGain]:
    'a deliberate sacrifice whose CORPSE blocks a cell for the rest of this turn (a durable collision object)',
  [PRUNE.terrainFatal]:
    'a sacrifice to TERRAIN paid for a capture that is only possible — the mover certainly cannot afford its own move, and the kill it might make does not depend on that',
  [PRUNE.kingUnsafe]:
    'a king move that gambles — kept whenever nothing safer exists, because an empty escape set loses the team',
  [PRUNE.kingTierUnsafe]:
    'a king move into reach of something that outranks it on tier, or onto a potion it would debuff itself with — kept whenever no tier-clear square exists at the same certainty',
  [PRUNE.tierDecisive]:
    'a move into reach of a unit that beats it ON TIER ALONE — the trade where our own weight advantage is thrown away, kept whenever every option carries it',
  [PRUNE.selfRegicide]:
    'a move that ends our own team — kept only when the option set would otherwise be empty',
  [PRUNE.promotionRefusal]:
    'the promotion itself — a weight-1 queen is fragile, but promoting is the only way a pawn ever gains range',
  [PRUNE.certainSelfFatal]:
    'a move that is fatal to its own mover BY RULE with no other unit involved — a step into the perimeter, or into a body cell of the mover that cannot vacate. It costs the sacrifice whose CORPSE is worth more than the unit, which these rules do not otherwise reward: nothing is captured by walking into a wall',
  [PRUNE.allyBody]:
    "a move into a MODELLED team-mate's body, whose cells cannot vacate before we arrive — near-certain rather than certain, because a team-mate that dies this turn leaves a pile settled on weight instead of a body settled on tier. It costs a slide that would have paid off precisely because the team-mate was about to die on it",
  [PRUNE.royalPath]:
    'a move whose path crosses our own king at a strength that wins or ties the contest — certain team elimination WHILE THE KING STANDS THERE, and only while it does. It costs an escort that would have been safe because the king was leaving',
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
  /**
   * Drop moves into reach of something that beats this unit ON TIER ALONE,
   * when an option that is not tier-decisively exposed exists. Set-level and
   * monotone, so it can never empty the option list. Inert on a board with no
   * live tier — which is every board with potions disabled.
   */
  readonly tierSafeStaging?: boolean;
  /**
   * Let the ordering see what ending a turn on a potion cell costs the unit
   * that ends there (it takes the −1; its allies take the +1). Ordering only —
   * no candidate is ever refused for it.
   */
  readonly selfDebuffOrdering?: boolean;
  /** Order slider destinations that shadow an enemy ray to our king first. */
  readonly escortShadowOrdering?: boolean;
  /**
   * Charge the STATIONARY terrain dose against a hold. See `restVerdict`.
   * Off restores the pre-fix reading, where holding a square was free
   * everywhere — including on a hazard, where the rules charge a full dose.
   */
  readonly chargeStandingTerrain?: boolean;
  /**
   * Drop a move the mover certainly cannot AFFORD unless the kill it makes is
   * certain too. See the `terrain-fatal` prune in `policyPrunes`.
   */
  readonly refuseTerrainFatal?: boolean;
  /**
   * ORDER BY WHAT THE MOVE TAKES, before ordering by what it costs.
   *
   * Two measured mis-orderings, both of them in `orderKey` and neither of them
   * a bound:
   *
   * 1. A MEAL IS FREE AND IS CHARGED FULL PRICE. `resolveTurn` sets an eater's
   *    health to its kind's max, so a nine-cell queen slide onto food costs
   *    nothing in health. The order sorts on `healthSpent.hi` ascending and
   *    knows nothing about the refund, so a `stay` — zero health, always legal,
   *    always generated — outranks every eat a slider has. With `candidateCap`
   *    at 8 on a queen with two dozen distinct actions, the eat is not merely
   *    ranked below `stay`: it is often not handed to the search at all. The
   *    corpus reads that back as pieces staging `stay` on 51–64% of decisions
   *    and queens converting 11–15% of the cheap, legal, unblocked eats they
   *    have on 26% of their turns, against 85% for a trail unit on the same
   *    boards under the same evaluator.
   *
   * 2. EVERY CAPTURE RANKS THE SAME. Stepping onto the square of a team's last
   *    king ends that team outright under `applyRegicide`; stepping onto a pawn
   *    takes a pawn. `capture` cannot tell them apart, so the one move on the
   *    board that can win the game sorts among the rest on health and cell
   *    index.
   *
   * Ordering "carries no soundness weight whatsoever" — this changes which
   * moves the anytime path reaches first and nothing else.
   *
   * DEFAULT ON as of integ/round-a (it was off on I3's branch). The ledger's
   * I3 verdict is "promote gainOrdering FIRST — reproduces the WHOLE effect
   * alone", and its mechanism evidence sits 5–25x outside the null band in
   * every arm, cell and budget. The placement CI was the only part not
   * claimable, and mechanism metrics are the promotion currency (A3 section
   * 4.2). Set it false to get the pre-promotion order back.
   */
  readonly gainOrdering?: boolean;
  /**
   * Assess a rules-certainly-self-fatal move as `doomed` and take it with a
   * declared prune. See `./staging-safety.ts` for why the risk layer cannot.
   */
  readonly pruneCertainSelfFatal?: boolean;
  /** Take a move whose path crosses our own king at a winning-or-tying strength. */
  readonly pruneRoyalPath?: boolean;
}

export const DEFAULT_KNOBS: Required<CandidateKnobs> = {
  keepQuiet: 2,
  pruneFatalNoGain: true,
  kingHardSafety: true,
  refusePromotion: false,
  tierSafeStaging: TIER_DEFENSE,
  selfDebuffOrdering: TIER_DEFENSE,
  escortShadowOrdering: true,
  chargeStandingTerrain: true,
  refuseTerrainFatal: true,
  gainOrdering: true,
  // Both default OFF; `flaggedKnobs()` turns them on when the staging-safety
  // flag asks for them, so an explicit knob in a test still wins.
  pruneCertainSelfFatal: false,
  pruneRoyalPath: false,
};

/**
 * The knobs the CENTAUR_STAGING_SAFETY flag implies. Read once per generator —
 * that is once per team decision — and overridden by anything the caller passes
 * explicitly, so a test can exercise either polarity without touching the
 * environment.
 */
export function knobsForSafety(level: StagingSafety): CandidateKnobs {
  // Both polarities NAMED, never omitted. An omitted knob falls through to
  // `flaggedKnobs()`, which reads the environment — so a caller that asked for
  // 'off' would get whatever the process-wide flag said, and the one thing a
  // per-engine override exists to guarantee is that it does not.
  //
  // `auto` is board-conditional and this function has no board, so it resolves
  // OFF here — see `resolveStagingSafety`. A caller that HAS a board resolves
  // the level first and passes the answer; `TeamDecisionEngine` does exactly
  // that, so the shipped path never reaches this fallback with 'auto'.
  const on = resolveStagingSafety(level, false) !== 'off';
  return { pruneCertainSelfFatal: on, pruneRoyalPath: on };
}

/** The knobs the process-wide flag implies, for a caller that names none. */
export function flaggedKnobs(): CandidateKnobs {
  return knobsForSafety(stagingSafety());
}

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
  /**
   * Does the mover run out of health paying for this move? Read straight off
   * the risk fold (`TraversalVerdict.exhaustionFatal`), and for a HOLD off the
   * stationary terrain charge. Kept beside the tier because the two ways to be
   * `doomed` are not the same fact: a contest loss is something an enemy does,
   * exhaustion is something the mover does to itself.
   */
  readonly exhaustionFatal: Trit;
  /** Terminal cells the move could come to rest on. */
  readonly landing: ReadonlyArray<CellIndex>;
  /**
   * How this move stands against the units that OUTRANK it on tier — clear,
   * exposed, or exposed to something that beats it on tier alone. Always
   * `clear` on a board with no live invulnerability effects.
   */
  readonly tierGrade: TierGrade;
  /** What ending the turn on this move's landing cell would cost, tier-wise. */
  readonly selfDebuff: SelfDebuff;
  /** How many held units' claims this move's outcome rests on. */
  readonly contingencies: number;
  /** Ordering hint only — never a bound. See SPECIALIST ordering below. */
  readonly shadowBonus: number;
  /**
   * Could this move come to rest on food? Ordering hint only. `landing` is the
   * set of cells the move could END on, so this is "a world exists in which the
   * mover eats", which is the right question for an ordering key: the search
   * decides whether that world is worth anything.
   */
  readonly foodGain: number;
  /**
   * Could this move come to rest on the square of an enemy team's LAST king,
   * with a capture the engine does not rule out? Ordering hint only.
   */
  readonly regicideShot: number;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export class GrammarCandidateGenerator implements CandidateGenerator {
  private readonly knobs: Required<CandidateKnobs>;
  /** Ray-shadow cells, per substrate. An ordering hint, computed once. */
  private readonly shadows = new WeakMap<EngineSubstrate, ReadonlySet<CellIndex>>();
  /** Enemy last-king squares, per substrate. An ordering hint, computed once. */
  private readonly regicideCells = new WeakMap<EngineSubstrate, ReadonlyMap<CellIndex, number>>();

  constructor(knobs: CandidateKnobs = {}) {
    this.knobs = { ...DEFAULT_KNOBS, ...flaggedKnobs(), ...knobs };
  }

  candidatesFor(sub: Substrate, unitId: UnitId, purpose: 'ours' | 'adversary' = 'ours'): CandidateSet {
    if (!(sub instanceof EngineSubstrate)) {
      // This implementation is engine-specific: the risk layer behind the
      // assessment is not on the Substrate interface. The contract's modelled
      // siblings and memo wrappers are proxies over an EngineSubstrate, so
      // they pass this check; only a genuinely foreign substrate is refused.
      throw new TypeError(
        'candidatesFor needs the engine substrate: the grammar enumerator and the ' +
          'risk layer are not on the Substrate interface'
      );
    }
    if (purpose === 'adversary') {
      // ADVERSARY COMPLETENESS (contract A4): the complete legal option list,
      // nothing pruned, nothing assessed. Pruning an enemy's replies is a
      // WHICH-truncation only the bound bank may declare — and the exact
      // prunes, though outcome-preserving, would read as incompleteness to a
      // consumer counting candidates against legalCount.
      const candidates = sub.actionsOf(unitId);
      return { unitId, candidates, prunedLedger: [], legalCount: candidates.length };
    }
    return generate(sub, unitId, this.knobs, this.shadowsFor(sub), this.regicideFor(sub));
  }

  /** The assessment behind a candidate set — ordering keys, tiers, ledgers. */
  assess(sub: EngineSubstrate, unitId: UnitId): ReadonlyArray<AssessedCandidate> {
    return generateAssessed(sub, unitId, this.knobs, this.shadowsFor(sub), this.regicideFor(sub))
      .kept;
  }

  private shadowsFor(sub: EngineSubstrate): ReadonlySet<CellIndex> {
    const hit = this.shadows.get(sub);
    if (hit !== undefined) return hit;
    const made = this.knobs.escortShadowOrdering ? rayShadowCells(sub) : new Set<CellIndex>();
    this.shadows.set(sub, made);
    return made;
  }

  private regicideFor(sub: EngineSubstrate): ReadonlyMap<CellIndex, number> | null {
    if (!this.knobs.gainOrdering) return null;
    const hit = this.regicideCells.get(sub);
    if (hit !== undefined) return hit;
    const made = enemyRegicideCells(sub);
    this.regicideCells.set(sub, made);
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
  shadows: ReadonlySet<CellIndex>,
  regicideCells: ReadonlyMap<CellIndex, number> | null
): CandidateSet {
  const { kept, pruned, legalCount } = generateAssessed(
    sub,
    unitId,
    knobs,
    shadows,
    regicideCells
  );
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
  shadows: ReadonlySet<CellIndex>,
  regicideCells: ReadonlyMap<CellIndex, number> | null
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

  const from = unit.cells[0] as CellIndex;
  const raw: Candidate[] = actions.map((a) => ({
    unitId,
    from,
    to: a.dest,
    path: a.action.kind === 'move' ? [...a.action.path] : [],
  }));

  // ---- exact prunes: first-contact termination, per ray -------------------
  const surviving = collapseSuffixes(sub, unit, raw, pruned);

  // ---- assessment ---------------------------------------------------------
  // ONE tier reading per unit per decision, not one per candidate: who
  // outranks this unit at the arrival turn is a fact about the board and the
  // clock, and on a potion-free board the answer is "nobody" in one loop.
  const exposure = exposureOf(sub, unit);
  // The risk layer answers for the CLAIM FIELD; the mover's own body and the
  // perimeter are not in it (see ./staging-safety.ts). Correcting the tier here
  // rather than in the prune is deliberate: `doomed` is what a certainly-fatal
  // move IS, so the danger ORDER is right even with the prune knob off, and a
  // sweep's candidate cap stops being spent on moves that cannot survive.
  //
  // INTEGRATION NOTE (integ/round-a): I1's tier CORRECTION wraps I4's and I6's
  // assessment rather than replacing it. The order is load-bearing in one
  // direction only — the correction can lower a tier to `doomed`/`atRisk` but
  // never raise one, so a move I6's terrain dose already made `doomed` keeps
  // that reading (the early return), and I4's tier grade is computed inside
  // `assessOne` on the untouched verdict and is not disturbed by a later
  // SafetyTier correction. The two layers answer different questions: I4's
  // `tierGrade` is invulnerability rank, this is survival.
  //
  // THE CORRECTION IS UNCONDITIONAL; THE PRUNE IS NOT. The paragraph above says
  // the assessment belongs here rather than in the prune "so the danger ORDER
  // is right even with the prune knob off" — and then gated the assessment on
  // the prune knob anyway, which made the sentence false. It is true now.
  //
  // What it cost while it was false: a move into the perimeter is assessed
  // `safe` by the risk layer (walls are terrain and the layer reads the claim
  // field), so it sorted among the safe options, and the last tie-break there
  // is ascending destination index — which for a trail unit is `up` first. So
  // the SEED, the plan the search starts from and the plan it plays whenever
  // nothing outranks it, was a wall move whenever `up` was into the wall. Two
  // recorded games ended with a snake walking off the board from a position
  // where every option's floor read DEAD and only `est` could tell the wall
  // from a survivable square (docs/BASIC-INTELLIGENCE.md).
  //
  // The ordering half carries none of the risk the prune half was measured to
  // carry: it removes nothing from the option set, so no team-level coherence
  // can be broken by it. It only stops a move that cannot survive from being
  // the one the search starts on.
  const assessed = surviving.map((candidate) => {
    const one = assessOne(sub, unit, candidate, shadows, exposure, knobs, regicideCells);
    if (one.tier === 'doomed') return one;
    if (certainlySelfFatal(sub, unit, candidate) !== null) {
      return { ...one, tier: 'doomed' as SafetyTier };
    }
    // A team-mate's body is NOT certain (see allyBodyCollision), so it earns
    // `atRisk` and not `doomed`: the tier says what is known, and what is known
    // here is that the mover might not survive, not that it cannot.
    if (one.tier === 'safe' && allyBodyCollision(sub, unit, candidate)) {
      return { ...one, tier: 'atRisk' as SafetyTier };
    }
    return one;
  });

  // ---- lossy prunes, each behind its knob ---------------------------------
  const afterQuiet = thinQuiet(sub, unit, assessed, pruned, knobs);
  const afterPolicy = policyPrunes(sub, unit, afterQuiet, pruned, knobs);
  const afterTier = keepTierSafe(afterPolicy, pruned, knobs);
  const afterKing = keepBestTier(unit, afterTier, pruned, knobs);

  // ---- the emptiness guarantee -------------------------------------------
  // No combination of knobs may hand the search nothing. If every option was
  // taken by a LOSSY prune, the least-bad tier comes back — exact prunes are
  // never restored, because their representatives are still in the set.
  const kept = afterKing.length > 0 ? afterKing : restoreLeastBad(assessed, pruned);

  kept.sort(knobs.gainOrdering ? gainOrderKey : orderKey);
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
    // The polarity is the vocabulary's, not this loop's: `suffix-collapse` is
    // declared lossy until the engine's halt axis is tier-only (see
    // PRUNE_EXACT), and the other two horizons remain outcome-preserving.
    const exact = PRUNE_EXACT[reason];
    for (const candidate of group) {
      if (candidate.path.length <= horizon + 1) kept.push(candidate);
      else pruned.push({ candidate, prune: reason, exact });
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

/** The part of a `TraversalVerdict` a resting unit has an answer for. */
interface RestVerdict {
  readonly perCell: ReadonlyArray<EncounterVerdict>;
  readonly survival: Trit;
  readonly landing: { readonly certain: number | null; readonly cells: ReadonlyArray<number> };
  readonly healthSpent: { readonly lo: number; readonly hi: number };
  readonly exhaustionFatal: Trit;
}

const EMPTY_VERDICT: RestVerdict = {
  perCell: [],
  survival: 'yes',
  landing: { certain: null, cells: [] },
  healthSpent: { lo: 0, hi: 0 },
  exhaustionFatal: 'no',
};

/**
 * WHAT A HOLD COSTS. A stay or a rotation enters no cell, and for everything
 * another unit might do that is the end of it: whatever contests the square
 * contests it either way, so the risk of STANDING is the evaluator's business
 * and not this layer's.
 *
 * TERRAIN IS NOT LIKE THAT, AND IT IS THE ONE ASYMMETRY THE RULES CONTAIN.
 * `PartialEngine.healthPhase` charges a unit that staged no path a full
 * stationary hazard dose at sub-step 1 — the vendored resolver's
 * `turnEngine.ts` does the same — while stepping onto ordinary ground costs
 * the kind's `costPerCell`, which is one. So on a hazard, holding is strictly
 * dominated by any safe step, by the whole dose minus one; and when the dose
 * is at least the health the mover has LEFT, holding is not a cost at all but
 * a death, indistinguishable from walking into the same cell.
 *
 * Reading a hold as free made both of those invisible at once. It priced the
 * dominated move at zero, which put the hold FIRST in `orderKey` (least health
 * spent) and therefore made it rung 0's seed for every unit standing on a
 * hazard; and it tiered a certainly-fatal hold `safe`, where no policy prune
 * can reach it. Neither is a judgement call — the charge is in the resolver.
 *
 * Only terrain is priced here, and only the mover's own square. The interval
 * is a point (`lo === hi`) because the charge depends on nothing anyone else
 * chooses. Off a hazard the answer is byte-for-byte the old `EMPTY_VERDICT`,
 * so a board without hazards cannot tell the difference.
 */
function restVerdict(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  charge: boolean
): RestVerdict {
  const at = unit.cells[0] as CellIndex;
  if (!charge || !sub.hazardAt(at)) return EMPTY_VERDICT;
  const dose = sub.engine.config.hazardDamage;
  if (dose <= 0) return EMPTY_VERDICT;
  // The food phase runs after the health phase and restores in full, so a unit
  // standing on food that the dose would exhaust may yet recover — the same
  // rescue `RiskAssessor.assessPath` grades for a mover. We cannot know here
  // whether a frozen claim eats it first, so the rescue only ever softens the
  // verdict to `maybe`; it never proves survival.
  const fatal: Trit = unit.health - dose > 0 ? 'no' : sub.foodAt(at) ? 'maybe' : 'yes';
  return {
    perCell: EMPTY_VERDICT.perCell,
    survival: 'yes',
    landing: { certain: at, cells: [at] },
    healthSpent: { lo: dose, hi: dose },
    exhaustionFatal: fatal,
  };
}

function assessOne(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate,
  shadows: ReadonlySet<CellIndex>,
  exposure: TierExposure,
  knobs: Required<CandidateKnobs>,
  /** Enemy last-king squares, or null when `gainOrdering` is off — in which
   * case neither gain key is computed at all, so the shipped path pays nothing
   * for a key it does not read. */
  regicideCells: ReadonlyMap<CellIndex, number> | null
): AssessedCandidate {
  const verdict =
    candidate.path.length === 0
      ? restVerdict(sub, unit, knobs.chargeStandingTerrain)
      : assessPathOf(sub, unit, candidate.path);

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

  let foodGain = 0;
  let regicideShot = 0;
  if (regicideCells !== null) {
    for (const cell of landing) {
      if (sub.foodAt(cell)) foodGain = 1;
      // A capture the engine rules OUT is not a shot; `maybe` is, because the
      // king only has to still be there. The map carries the king's TEAM, so
      // our own king's square can never be read as a target — the one way an
      // offensive ordering hint could turn into the self-regicide class.
      const owner = regicideCells.get(cell);
      if (capture !== 'no' && owner !== undefined && owner !== unit.team) regicideShot = 1;
    }
  }

  // The tier reading is over the WHOLE PATH — a slider is adjudicated at every
  // cell of its ray, so a destination-only reading roughly doubles how much
  // room a slider looks to have. The self-debuff reading is over the LANDING
  // set instead, because collection is destination-only by rule.
  const tierGrade = gradePath(sub, exposure, unit.cells[0] as CellIndex, candidate.path);
  const selfDebuff = knobs.selfDebuffOrdering
    ? selfDebuffOf(sub, unit, exposure, landing)
    : ('none' as SelfDebuff);

  return {
    candidate,
    tier,
    capture,
    healthSpent: verdict.healthSpent,
    exhaustionFatal: verdict.exhaustionFatal,
    landing,
    tierGrade,
    selfDebuff,
    contingencies,
    shadowBonus,
    foodGain,
    regicideShot,
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
    // never pruned WHERE IT IS FREE — which off a hazard is everywhere. On one
    // it is not free (see `restVerdict`), and a hold the stationary dose kills
    // is exactly as doomed as walking into the same cell, so it is judged on
    // the same evidence as every other option rather than waved through.
    if (a.candidate.path.length === 0 && a.tier !== 'doomed') {
      out.push(a);
      continue;
    }
    if (lastKing && a.tier === 'doomed') {
      pruned.push({ candidate: a.candidate, prune: PRUNE.selfRegicide, exact: false });
      continue;
    }
    // Before `fatal-no-gain`, and separately from it, because the two have
    // different premises: this one needs no assessment at all, it needs the
    // rules. It also does not exempt a capture — nothing is captured by walking
    // into a wall or into your own neck, so the exemption has no instances, and
    // stating that is cheaper than relying on it.
    if (knobs.pruneCertainSelfFatal && certainlySelfFatal(sub, unit, a.candidate) !== null) {
      pruned.push({ candidate: a.candidate, prune: PRUNE.certainSelfFatal, exact: false });
      continue;
    }
    if (knobs.pruneCertainSelfFatal && allyBodyCollision(sub, unit, a.candidate)) {
      pruned.push({ candidate: a.candidate, prune: PRUNE.allyBody, exact: false });
      continue;
    }
    if (knobs.pruneRoyalPath && killsOwnKing(sub, unit, a.candidate)) {
      pruned.push({ candidate: a.candidate, prune: PRUNE.royalPath, exact: false });
      continue;
    }
    if (knobs.pruneFatalNoGain && a.tier === 'doomed' && a.capture === 'no') {
      pruned.push({ candidate: a.candidate, prune: PRUNE.fatalNoGain, exact: false });
      continue;
    }
    // THE SACRIFICE THAT PAYS FOR NOTHING CERTAIN.
    //
    // `fatal-no-gain` above asks for `capture === 'no'`, and on lethal terrain
    // that condition is met for free: nothing survives standing on a cell whose
    // dose exceeds every kind's maximum, so no enemy is ever there to take and
    // the prune fires every time. Drop the dose below the kind's maximum and
    // enemies cross those cells like any other — the same square now offers a
    // POSSIBLE capture, `capture` reads `maybe`, and the prune stops firing for
    // a mover whose own health the dose already exceeds. That is the whole of
    // the asymmetry the corpus measured as "the lethality line is drawn against
    // the kind's maximum, not against the health this unit has left": no code
    // ever compared against a maximum, but the CONDITION that hides the
    // comparison is satisfied exactly in the maximum-exceeding regime.
    //
    // So exhaustion gets its own refusal. Running out of health is unilateral —
    // the mover cannot afford its own path, whatever anyone else does — while
    // the capture it is buying is only possible. A CERTAIN kill still buys the
    // trade, and the emptiness guarantee still owns the case where refusing
    // leaves nothing.
    if (knobs.refuseTerrainFatal && a.exhaustionFatal === 'yes' && a.capture !== 'yes') {
      pruned.push({ candidate: a.candidate, prune: PRUNE.terrainFatal, exact: false });
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
 * THE TIER FILTER, applied to the SET rather than to each candidate.
 *
 * A contest is decided on TIER FIRST and weight second, so a unit that steps
 * into reach of something one tier above it loses whatever it weighs. When the
 * unit would have WON that contest on weight — the `decisive` grade — the buff
 * did not confirm the outcome, it reversed it, and walking into it throws away
 * a material advantage that is otherwise the whole point of having it.
 *
 * The filter drops exactly that class, and only when the unit has somewhere
 * else to be. It is monotone by construction (the keeper set is non-empty
 * before anything is dropped) and it is INERT on a board with no live tier,
 * because `gradePath` returns `clear` for every candidate when nothing
 * outranks the unit — which is every decision in a game with potions off.
 *
 * It is DECLARED LOSSY, not exact. What it can cost is a trade: accepting a
 * tier loss to take a piece, block a line, or shield a king. The ledger names
 * it, and the emptiness guarantee restores it if policy took everything.
 */
function keepTierSafe(
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[],
  knobs: Required<CandidateKnobs>
): AssessedCandidate[] {
  if (!knobs.tierSafeStaging) return [...assessed];
  const kept: AssessedCandidate[] = [];
  const dropped: AssessedCandidate[] = [];
  for (const a of assessed) {
    if (a.tierGrade === 'decisive') dropped.push(a);
    else kept.push(a);
  }
  if (dropped.length === 0 || kept.length === 0) return [...assessed];
  for (const a of dropped) {
    pruned.push({ candidate: a.candidate, prune: PRUNE.tierDecisive, exact: false });
  }
  return kept;
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
    return knobs.tierSafeStaging ? keepBestKingTier(kept, pruned) : kept;
  }
  return [...assessed];
}

/**
 * The king's SECOND key, applied inside its best certainty tier: prefer the
 * squares nothing outranks it on, and prefer not to hand itself a −1.
 *
 * A king carries the team. Regicide fires the same turn its last king dies, so
 * a tier gap on a king is the one channel in the whole potion system that
 * moves a placement by rule rather than by association. The two things it must
 * not do are walk into reach of a higher tier and stand on a potion — the
 * second being entirely self-inflicted and needing no enemy modelling at all.
 *
 * Same shape as the filter above it: keep the best available class, whatever
 * that class is, so the set can never come back empty.
 */
function keepBestKingTier(
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[]
): AssessedCandidate[] {
  let best = Number.POSITIVE_INFINITY;
  for (const a of assessed) best = Math.min(best, kingTierRisk(a));
  const kept = assessed.filter((a) => kingTierRisk(a) === best);
  if (kept.length === 0 || kept.length === assessed.length) return [...assessed];
  for (const a of assessed) {
    if (kingTierRisk(a) === best) continue;
    pruned.push({ candidate: a.candidate, prune: PRUNE.kingTierUnsafe, exact: false });
  }
  return kept;
}

/** Tier exposure and self-debuff, as one comparable number for a king. */
const kingTierRisk = (a: AssessedCandidate): number =>
  tierGradeRank(a.tierGrade) + (a.selfDebuff === 'none' ? 0 : 3);

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
  // TIER RISK BEFORE CAPTURES, and the order is the argument: a capture made
  // by walking into something that outranks us is not a capture, it is a
  // donation. Both terms are identically zero on a board with no live
  // invulnerability effect, so this comparison is a no-op wherever potions are
  // off and the order below it is byte-for-byte what it always was.
  const risk = tierRisk(a) - tierRisk(b);
  if (risk !== 0) return risk;
  const capture = captureRank(b.capture) - captureRank(a.capture);
  if (capture !== 0) return capture;
  if (a.shadowBonus !== b.shadowBonus) return b.shadowBonus - a.shadowBonus;
  if (a.healthSpent.hi !== b.healthSpent.hi) return a.healthSpent.hi - b.healthSpent.hi;
  if (a.contingencies !== b.contingencies) return a.contingencies - b.contingencies;
  return a.candidate.to - b.candidate.to;
}

const captureRank = (c: AssessedCandidate['capture']): number =>
  c === 'yes' ? 2 : c === 'maybe' ? 1 : 0;

/**
 * THE GAIN ORDER — `orderKey` with what a move TAKES sorted before what it
 * COSTS. Behind `gainOrdering`; see the knob for the two measured
 * mis-orderings it exists to correct.
 *
 * Two deliberate placements:
 *
 * · `regicideShot` above `capture`, because ending a team is not a capture that
 *   happens to be worth more — under `applyRegicide` it removes every unit that
 *   team has left, and there is exactly one square on the board where that is
 *   true per enemy team.
 * · `foodGain` above `healthSpent`, and health charged at ZERO when the move
 *   could eat. That is not a fudge: `resolveTurn` sets an eater's health to its
 *   kind's max, so the health a slider spends reaching food is refunded on
 *   arrival, and charging it is simply wrong about the rules. Everything else
 *   is charged exactly as before.
 *
 * `tier` stays first. Ordering never licenses a move — it decides which of the
 * generated options the anytime path reaches before its budget runs out — so a
 * doomed regicide shot still sorts behind a safe one, and whether the trade is
 * worth taking remains the evaluator's ordered terminal clamps' question.
 *
 * INTEGRATION NOTE (integ/round-a): `tierRisk` is carried here too, in the same
 * slot it occupies in `orderKey` — after `tier`, ahead of every capture-class
 * term. It is not optional. I3 wrote this comparator against a base that had no
 * tier ordering in it, so selecting it at the sort site
 * (`kept.sort(knobs.gainOrdering ? gainOrderKey : orderKey)`) would otherwise
 * discard I4's tier defense wholesale the moment `gainOrdering` is promoted —
 * which the ledger names as the FIRST promotion to make. I4's own argument
 * carries over verbatim and applies with more force here, not less: a capture
 * made by walking into something that outranks us is a donation, and a REGICIDE
 * SHOT taken that way is the most expensive donation on the board. Both terms
 * are identically zero wherever no invulnerability effect is live, so on the
 * food-and-king boards I3 measured this comparator is byte-for-byte the one it
 * measured.
 */
function gainOrderKey(a: AssessedCandidate, b: AssessedCandidate): number {
  const tier = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier);
  if (tier !== 0) return tier;
  const risk = tierRisk(a) - tierRisk(b);
  if (risk !== 0) return risk;
  if (a.regicideShot !== b.regicideShot) return b.regicideShot - a.regicideShot;
  const capture = captureRank(b.capture) - captureRank(a.capture);
  if (capture !== 0) return capture;
  if (a.foodGain !== b.foodGain) return b.foodGain - a.foodGain;
  if (a.shadowBonus !== b.shadowBonus) return b.shadowBonus - a.shadowBonus;
  const ha = a.foodGain === 1 ? 0 : a.healthSpent.hi;
  const hb = b.foodGain === 1 ? 0 : b.healthSpent.hi;
  if (ha !== hb) return ha - hb;
  if (a.contingencies !== b.contingencies) return a.contingencies - b.contingencies;
  return a.candidate.to - b.candidate.to;
}

/**
 * The one ordering number for everything tier.
 *
 * `tierGradeRank` is what the enemy's window does to us; `selfDebuffRank` is
 * what our own pickup would do. They add rather than max because they are
 * genuinely additive risks: stepping into a higher tier's reach AND handing
 * ourselves a −1 on the same move is worse than either alone.
 */
const tierRisk = (a: AssessedCandidate): number =>
  tierGradeRank(a.tierGrade) + selfDebuffRank(a.selfDebuff);

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
// The offensive mirror of the escort geometry: where regicide lives
// ---------------------------------------------------------------------------

/**
 * The squares on which an enemy team's LAST king is standing.
 *
 * Not "every enemy king": the rule that makes this square special is
 * `applyRegicide`, which fires when a team's last king dies, so a team fielding
 * two of them offers no such square at all. The test is the same one
 * `isLastKingOfItsTeam` runs for our own side, read the other way round — and
 * "enemy" is every team that is not the one whose kings we are counting, so
 * this is correct in a three-team game without knowing which seat is ours.
 *
 * Computed once per substrate. It is an ORDERING hint and never a bound: the
 * king may not be there next turn, which is precisely why the corpus's attempt
 * rate converts at only one in five.
 */
function enemyRegicideCells(sub: EngineSubstrate): ReadonlyMap<CellIndex, number> {
  const out = new Map<CellIndex, number>();
  const regicide = sub.regicideTeamNumbers();
  const kingsByTeam = new Map<number, SubstrateUnit[]>();
  for (const u of sub.roster()) {
    if (!u.isKing || !regicide.has(u.team)) continue;
    const group = kingsByTeam.get(u.team);
    if (group === undefined) kingsByTeam.set(u.team, [u]);
    else group.push(u);
  }
  for (const [team, group] of kingsByTeam) {
    if (group.length !== 1) continue;
    out.set((group[0] as SubstrateUnit).cells[0] as CellIndex, team);
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
