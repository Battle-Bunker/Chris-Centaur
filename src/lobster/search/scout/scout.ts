/**
 * THE SCOUT — the runner. Threads over the door, scheduled by the tithe, with
 * exactly three sinks and a wall between them and everything else.
 *
 * ── WHAT A PLY IS HERE (la-outside §0) ─────────────────────────────────────
 *
 * A ply is a JOINT-MOVE NODE: every unit on the board acts, simultaneously,
 * once. There is no alternation and there is no such thing as "the opponent's
 * ply". A depth-2 thread is two turns of the real game, not one turn split in
 * half. Everything about the composition follows from that, and the thing that
 * follows first is the quantifier order.
 *
 * ── THE QUANTIFIER ORDER IS THE WHOLE BALLGAME (F-5) ───────────────────────
 *
 * `max_a min_b`, NEVER `min_b max_a`. The cluster picks ONE reply that is
 * shared across every enemy profile in an information set; conditioning the
 * depth-(j+1) choice on which profile was enumerated at depth `j` computes the
 * CLAIRVOYANT value, which is strictly above the security value and is not a
 * thing we can play. The code below never indexes a choice by a profile: the
 * inner loop mins over profiles into a scalar, and only then does the outer
 * loop max. That is a structural property of the two nested loops, and the
 * constructed-position test asserts it holds.
 *
 * ── WHAT A THREAD'S NUMBERS ARE, AND ARE NOT ───────────────────────────────
 *
 * NOT A BOUND, AND NOW VALUE-BEARING. `ThreadPly.advisory` is still a plain
 * `{lo, est, hi}` of numbers and deliberately NOT a `ScoreBounds`: a channel
 * that cannot be confused at the type level cannot be confused at the call
 * site. Nothing in this directory constructs, meets, tightens or publishes a
 * bound; `index.ts` states the import law and the structural test reads the
 * files to prove it. Every staged plan is still priced once, jointly, by the
 * unconditional one-ply bank, and the floors it writes are unchanged.
 *
 * What HAS changed is where the numbers go. They used to reach exactly one
 * place — an additive term on the enumeration surrogate — which meant a proved
 * two-turn refutation could change which plans were OFFERED and never which
 * one won. They now also leave this layer as `DeepObservation`s: a value, a
 * sigma and a ply count, all plain numbers, published per ply-1 root plan. The
 * consumer folds them into that branch's belief at the precision the sigma
 * earns. This module still cannot reach a belief, a bound or a comparator; it
 * publishes measurements and somebody else decides what they are worth.
 *
 * ── WHAT A DEEP VALUE MEANS, AND WHY IT MAY BE WORSE THAN THE NEAR ONE ─────
 *
 * A deepened line's value is priced ON THE ADVANCED BOARD, through the same
 * evaluator, in the same units. It is therefore CAUSALLY DOWNSTREAM of the
 * first turn and CARRIES it: a first move that certainly kills an enemy has
 * that kill already inside the ply-2 number, and a continuation that loses two
 * of ours nets out against it. A branch that kills one and then loses two
 * evaluates at roughly minus one unit — worse than a quiet alternative — and
 * that is a correct reading of the same quantity, not a foreign one competing
 * with a near fact.
 *
 * The backup is CONSERVATIVE: `scoreOptions` is `max_a min_b`, so the value is
 * the security value of our best continuation against the worst reply the
 * information set permits. Deep findings are therefore free to be POSITIVE as
 * well as negative — a discovered reliable two-turn kill raises the branch by
 * the same arithmetic that a discovered two-turn loss lowers it.
 *
 * ── THE CAP IS GONE, AND WHAT REPLACED IT ──────────────────────────────────
 *
 * `clampToLat` is DELETED, and so is the loser-only polarity rule. Both were
 * proxies for one real worry — that a time-skewed, model-conditional number
 * would outshout a solid this-turn fact — and both expressed it as a constant,
 * which caps exactly the discoveries depth exists to make.
 *
 * The replacement is arithmetic that scales in both directions with the thing
 * the constant was a crude proxy for: MODEL ERROR OF THE APPROXIMATE
 * SIMULATION, measured on the line itself and published as a sigma. See
 * `sigmaOfPly` for the terms and where each is read from. A finding from a
 * cleanly enumerated, fog-free, exactly-priced line arrives nearly at full
 * strength; a finding from a truncated enumeration under saturated clouds
 * arrives nearly information-free. Nothing is clamped, in either direction.
 *
 * ── THE ORDERING SINK, AND ITS CREDIT ASSIGNMENT ───────────────────────────
 *
 * Threads of the same cluster differ only in the ply-1 joint move they
 * continue from. When two of them differ in EXACTLY ONE unit's ply-1
 * candidate, the difference in their advisory values is attributable to that
 * candidate exactly — a first difference, which is the same Möbius shape CL2's
 * edge-EV store is built around. That pair is the only case this stage emits
 * advice for; a coarser attribution would be a number with the right sign and
 * the wrong owner, and an ordering channel with the wrong owner is worse than
 * none.
 *
 * `Surrogate.unary` adds φ_u and HIGHER IS BETTER, so the sign is the sign of
 * the difference: the loser of a first-difference pair is pushed down and the
 * winner is pushed up, by the same magnitude. The old rule gave the penalty to
 * the loser and nothing to the winner, on the ground that promotion is the
 * direction where being wrong costs a staging — which was the right instinct
 * for a channel nobody could discount, and is the wrong one now that the
 * discount is a measured precision.
 */

import { continueFrom } from './door';
import type { Continuation, RefusalReason } from './door';
import { ShellTable } from '../../evaluate';
import {
  accumulate,
  buildContactMatrix,
  cleanPrefixOf,
  contactOf,
  depthOf,
  threadKey,
} from './threads';
import type { ContactVerdict, Discrimination, ThreadEntry, ThreadPly } from './threads';
import { ThreadLedger } from './threads';
import {
  DEFAULT_SCOUT_TUNING,
  ScoutPurse,
  deepenNext,
  priceExpansion,
  reportOf,
  shouldPark,
} from './schedule';
import type { ScoutReport, ScoutTuning } from './schedule';
import { expandCluster } from '../cluster-partition';
import type { Partition } from '../cluster-partition';
import { SubtreeCertificate } from '../../../partial-engine/index';
import type { EngineSubstrate } from '../../substrate';
import type {
  Candidate,
  CandidateGenerator,
  CandidateSet,
  CellIndex,
  JointPlan,
  Posture,
  UnitId,
} from '../../contracts';

// ---------------------------------------------------------------------------

/** One piece of ordering advice: a ply-1 candidate, and what depth found. */
export interface ScoutFinding {
  readonly unitId: UnitId;
  readonly to: CellIndex;
  /** In score units, SIGNED so that negative is worse. NOT clamped. */
  readonly delta: number;
  /** Which ply of which thread found it — provenance for the operator. */
  readonly note: string;
}

/**
 * WHAT A DEEPENED LINE IS WORTH, PUBLISHED FOR THE BRANCH IT STARTED FROM.
 *
 * One per thread that reached at least one continuation and whose root is a
 * plan the search actually offers. It is plain data: three numbers and the
 * plan they are about. This module folds nothing and compares nothing.
 *
 * The consumer's contract, stated here because this is where the numbers are
 * made: `value` is denominated in the SAME score units as a ply-1 bank price,
 * on a board `plies` turns of play ahead of the decision; `sigma` is one
 * standard deviation of the MODEL ERROR of the approximate simulation that
 * produced it, in the same units, so `1/sigma^2` is the precision the reading
 * earned. There is no cap and no floor on either.
 */
export interface DeepObservation {
  /** The ply-1 joint plan this line started from — the ORIGIN BRANCH. */
  readonly root: JointPlan;
  /** The line's own security value, `max_a min_b`, on the advanced board. */
  readonly value: number;
  /** Model-error sigma, accumulated over the plies walked. See `sigmaOfPly`. */
  readonly sigma: number;
  /** Turns of play the value spans. 2 = this move plus one more turn. */
  readonly plies: number;
  /** Provenance for the operator: thread key and the depth it reached. */
  readonly note: string;
}

/**
 * THE MODEL ERROR OF ONE SIMULATED PLY, in score units.
 *
 * The redesign's rule is that a deep reading's influence is bounded by the
 * PRECISION IT EARNED and by nothing else, and that the precision is DERIVED
 * from the line's own discrimination state rather than chosen. This is that
 * derivation. Every input is a quantity the ply already measured; the only
 * structure imposed is that independent error sources add in quadrature, and
 * that the natural SCALE of "how much could being wrong about this node cost"
 * is the node's own spread across the options it priced.
 *
 *   world       the deep node's own interval half-width. Exactly the law
 *               `precisionOfInterval` applies to a ply-1 bound: what the
 *               engine itself could not resolve about this position.
 *   ourMiss     the fraction of OUR joint option space the enumeration did not
 *               price. Truncating our own max is conservative in VALUE (we
 *               under-state our best continuation) and is still uncertainty.
 *   theirMiss   the fraction of the enemy reply space the min did not cover.
 *               This one is optimistic in value, which is precisely why it has
 *               to be paid for in precision.
 *   fog         the share of this node's held claims whose possibility clouds
 *               have saturated — the point past which a countdown discriminates
 *               nothing and a dilated cloud is standing in for a fact.
 *   interfere   the share of held claims the parent resolution refused to price
 *               certainly-alive and that this root nonetheless prices alive
 *               (the door's I7/I8 residue). Un-modelled interference, named.
 *
 * A perfectly enumerated, fog-free, exactly-priced node returns 0 and the
 * reading is exact — which is the honest answer for a node where the model IS
 * the game. Every real board pays something on at least one term.
 */
export function sigmaOfPly(o: {
  readonly world: number;
  readonly spread: number;
  readonly ourMiss: number;
  readonly theirMiss: number;
  readonly fog: number;
  readonly interfere: number;
}): number {
  const share = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
  const world = Number.isFinite(o.world) ? Math.max(0, o.world) : Number.POSITIVE_INFINITY;
  const spread = Number.isFinite(o.spread) ? Math.max(0, o.spread) : Number.POSITIVE_INFINITY;
  const weight = share(o.ourMiss) + share(o.theirMiss) + share(o.fog) + share(o.interfere);
  const variance = world * world + spread * spread * weight;
  return Math.sqrt(variance);
}

export interface ScoutRequest {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly gen: CandidateGenerator;
  readonly partition: Partition;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  /** Ply-1 joint plans to open threads on, in the coordinator's own sampled
   *  order. The order is a pure function of (seed, board, epoch) before any
   *  thread runs — §3.0 note 3 — so a straggler cannot reorder anything. */
  readonly seeds: ReadonlyArray<JointPlan>;
  readonly epoch: number;
  readonly posture: Posture;
  /** The decision's whole budget in ms, or 0 when the handle models no clock —
   *  and then only the ply cap binds, which is what makes the probes
   *  deterministic. */
  readonly decisionMs: number;
  readonly kingUnits?: ReadonlySet<UnitId>;
}

/**
 * The scout. One per search session, alive for the session's life for the same
 * reason CL4's sampler is: a ledger rebuilt every slice would restart every
 * counter and destroy the property that a bigger budget's decision sequence is
 * an EXTENSION of a smaller one's.
 */
export class Scout {
  readonly ledger: ThreadLedger;
  readonly tuning: ScoutTuning;
  private table: ShellTable | null = null;
  private readonly findings = new Map<string, ScoutFinding>();
  private readonly refusals: Record<string, number> = {};
  /** Live continuation roots, by thread key. Slabs live here, not in the
   *  ledger: `ThreadEntry` is data and a data object that owns an arena slab
   *  is a leak waiting for someone to forget it. */
  private readonly roots = new Map<string, Continuation>();
  /** The best advisory value per thread key — the ordering sink's input. */
  private readonly values = new Map<string, number>();
  /**
   * THE VALUE-BEARING HALF, by thread key: the deepest line's own security
   * value, the model error accumulated getting there, and how many turns of
   * play it spans.
   *
   * Accumulated rather than replaced on the sigma channel: a ply-3 reading
   * carries the model error of plies 1..3, so a deeper line is automatically
   * less precise without anybody choosing a decay. The VALUE is the latest
   * ply's, because that is the deepest statement the thread has made.
   */
  private readonly deep = new Map<
    string,
    { value: number; sigmaSq: number; plies: number; root: JointPlan }
  >();
  /** Thread keys whose root is a plan the caller actually offers — the only
   *  ones a deep observation may name. See `run`. */
  private readonly offered = new Set<string>();
  /**
   * THE LINE THE THREAD PROVED, by thread key: the joint move over the
   * cluster's own units that `scoreOptions` found to be the argmax at the
   * thread's CURRENT root, i.e. at the root `roots` holds for the same key.
   *
   * It is what the next ply continues from. Holding it here rather than on
   * `ThreadPly` is deliberate twice over: a published ply is never edited
   * (contract rule 24), and a plan is a set of `Candidate`s AT A ROOT, so it
   * is only meaningful while that root is alive — which is exactly the
   * lifetime `roots` has, and why `releaseRoots` clears both.
   */
  private readonly lines = new Map<string, JointPlan>();
  /**
   * THE THREAD'S OWN PARTITION, which is the decision's until it expands.
   *
   * `expandCluster` RETURNS A NEW PARTITION and leaves the old one valid, and
   * CL3's comment says why in as many words: *"a thread that has already
   * published a prefix under the old partition must keep reading the object it
   * published against."* Pricing the next expansion against the decision's
   * original partition instead would read the pre-expansion variable count, so
   * the arity guard would never bind after the first growth — a table nothing
   * can afford, built one unit at a time.
   */
  private readonly partitions = new Map<string, Partition>();
  private purse: ScoutPurse;
  /**
   * WHY THE RUNNER WAS NEVER REACHED, or `null` once it has been.
   *
   * A scout is CONSTRUCTED whenever `CENTAUR_SCOUT` is on, and `run` is called
   * from one place only: below the cluster-enumeration gate, because the
   * threads' seeds are the enumeration's own proposals. The caller owns that
   * gate and so the caller states the reason; the scout only has to make sure
   * a report can never claim to be a null about the scout when it is a null
   * about the harness.
   */
  private gate: string | null = null;

  constructor(tuning: Partial<ScoutTuning> = {}, decisionMs = 0) {
    this.tuning = { ...DEFAULT_SCOUT_TUNING, ...tuning };
    this.ledger = new ThreadLedger(this.tuning.capacity);
    this.purse = new ScoutPurse(decisionMs, this.tuning);
  }

  /** Rebuild the purse for a new decision. The LEDGER survives — that is the
   *  point of a ledger — but the tithe does not roll over. */
  beginDecision(decisionMs: number): void {
    this.purse = new ScoutPurse(decisionMs, this.tuning);
  }

  /**
   * THE GATE THE CALLER IS STANDING AT — a reason string when the scout was
   * asked for and the call site was never reached, `null` when it was.
   *
   * Declared here rather than inferred from `threads === 0` because the two
   * readings are not the same claim. Zero threads with `gatedBy: null` is the
   * scout saying "I ran and there was nothing to open". Zero threads with a
   * reason is the scout saying "nobody ever called me" — which is a fact about
   * the configuration, and filing it against the scout is how an experiment
   * races three identical contenders and reports a null on the wrong flag.
   */
  gatedBy(reason: string | null): void {
    this.gate = reason;
  }

  /** The evaluator's own shell table, one per scout, allocated on the first
   *  ply because the grid is not known before a request arrives. Interning is
   *  the whole reason a per-ply contact test is a word-AND rather than a
   *  dilation. */
  private tableFor(sub: EngineSubstrate): ShellTable {
    if (this.table === null) this.table = new ShellTable(sub.grid);
    return this.table;
  }

  private refuse(reason: RefusalReason | 'no-cluster'): void {
    this.refusals[reason] = (this.refusals[reason] ?? 0) + 1;
  }

  /**
   * Run the scout for one decision, inside its tithe.
   *
   * Opens one thread per (cluster, seed plan), then deepens the SHALLOWEST
   * LIVE cluster until the purse is empty. The barrier rule is not a
   * preference here: a comparison the team makes at `d*` gets nothing from
   * depth above `d*`, so the marginal ply is worth most where the barrier is.
   */
  run(req: ScoutRequest): void {
    // Being here IS the proof that the call site was reached. Anything that
    // stops the scout from this line down is a scout finding — `no-cluster` is
    // a refusal, not a gate — and belongs in `refusals`, not in `gatedBy`.
    this.gate = null;
    // A DECISION'S PUBLICATIONS ARE A DECISION'S. The ledger survives — that
    // is what a ledger is for — but findings and deep observations are about
    // one board and must never be read on the next one.
    this.findings.clear();
    this.deep.clear();
    this.offered.clear();
    if (req.partition.clusters.length === 0 || req.seeds.length === 0) {
      this.refuse('no-cluster');
      return;
    }
    const isKing = (t: ThreadEntry): boolean => {
      if (req.kingUnits === undefined) return false;
      for (const id of t.cluster) if (req.kingUnits.has(id)) return true;
      return false;
    };

    const offeredRoots = new Set<JointPlan>(req.seeds);
    for (const cluster of req.partition.clusters) {
      for (const seed of this.seedFamily(cluster.members, req)) {
        if (!this.purse.canSpend()) break;
        const key = `${cluster.id}:${threadKey(cluster.members, seed)}`;
        // A PERTURBATION IS NOT AN OFFER. `seedFamily` invents one-unit
        // variations of the anchor so the first-difference sink has pairs to
        // attribute over; those plans are not in the caller's proposal list,
        // so no branch exists for a deep observation about them to name. They
        // still deepen and still feed the ordering channel — what they may not
        // do is publish a value for a branch nobody prices.
        if (offeredRoots.has(seed)) this.offered.add(key);
        if (this.ledger.get(key) !== undefined) continue;
        this.ledger.open({
          key,
          clusterId: cluster.id,
          cluster: new Set(cluster.members),
          rootPlan: seed,
          rootTurn: req.sub.turn,
          epochBaseline: req.epoch,
          postureBaseline: req.posture,
          plies: [],
          citedUnits: new Set(),
          accumulation: new Map(),
          carriedContingent: new Set(),
          skew: 0,
          assumptions: [],
          state: 'live',
          stepCost: 0,
        });
      }
    }

    // THE DEPTH LOOP. Every iteration deepens the shallowest live thread, so
    // the barrier rises evenly and no thread buys depth the decision cannot
    // use. Bounded by the purse in both currencies.
    let guard = this.tuning.plyCap * 4;
    while (this.purse.canSpend() && guard-- > 0) {
      const next = deepenNext(this.ledger.all(), isKing, this.tuning.depthMax);
      if (next === null) break;
      this.deepen(next, req);
      const verdict = shouldPark(next, this.tuning, this.purse);
      if (verdict.park) this.ledger.park(next, verdict.reason === 'flat' ? 'parked-flat' : 'parked-budget');
    }

    this.harvest();
    this.releaseRoots();
    this.partitions.clear();
  }

  /**
   * THE SEED FAMILY: the coordinator's plans, plus one-unit perturbations of
   * the first one.
   *
   * The ordering sink attributes a FIRST DIFFERENCE and nothing else, and
   * CL3's k-best joints are shrunk on a minimum Hamming distance — diverse by
   * construction, so almost never one move apart. Left alone, the sink would
   * be a channel that exists and never fires. So the scout supplies its own
   * pairs, exactly as `core.ts::perturb` does for the sweep: the anchor, and
   * the anchor with one cluster member moved.
   *
   * DETERMINISTIC: the members are walked in sorted order and each member's
   * options in the generator's own order, so the family is a pure function of
   * (board, partition, anchor) and a straggler cannot reorder it.
   */
  private seedFamily(
    members: ReadonlyArray<UnitId>,
    req: ScoutRequest
  ): ReadonlyArray<JointPlan> {
    const out: JointPlan[] = [...req.seeds];
    const anchor = req.seeds[0];
    if (anchor === undefined || this.tuning.perturbationsPerCluster <= 0) return out;
    let made = 0;
    for (const id of [...members].sort((a, b) => a - b)) {
      if (made >= this.tuning.perturbationsPerCluster) break;
      const current = anchor.get(id);
      const set = req.sets.get(id);
      if (current === undefined || set === undefined) continue;
      for (const option of set.candidates) {
        if (option.to === current.to) continue;
        const plan = new Map(anchor);
        plan.set(id, option);
        out.push(plan);
        made++;
        break;
      }
    }
    return out;
  }

  /** One ply on one thread. The door, the enumeration, the max-min, the
   *  countdown, the accumulator, the expansion price.
   *
   *  NO CLOCK IS READ. The ply's cost is the number of resolutions it priced,
   *  which is `refinementCost`'s currency and `la-inside` §4's, and which makes
   *  the park decision a pure function of the board rather than of the box. */
  private deepen(entry: ThreadEntry, req: ScoutRequest): void {
    const parent = this.roots.get(entry.key);
    const from = parent === undefined ? req.sub : parent.sub;
    // The plan this ply continues from. At ply 1 it is the seed over the whole
    // roster; deeper it is the cluster's own best joint from the ply before,
    // with everything else held (the plan-domain rule does the holding).
    const plan = parent === undefined ? entry.rootPlan : this.deepPlan(entry, parent, req);
    if (plan === null || plan.size === 0) {
      this.ledger.park(entry, 'parked-flat');
      return;
    }

    let out;
    try {
      out = from.resolveBoundedFor(plan, req.asTeam);
    } catch {
      this.ledger.park(entry, 'parked-flat');
      return;
    }

    const cont = continueFrom({
      from,
      resolution: out.resolution,
      cluster: entry.cluster,
      carriedContingent: entry.carriedContingent,
      ply: depthOf(entry) + 1,
    });
    if (!cont.ok) {
      this.refuse(cont.reason);
      from.releaseResolution(out.resolution);
      this.ledger.park(entry, 'parked-flat');
      return;
    }

    // ---- the countdown, off the resolution the ply just produced ----------
    const certificate = new SubtreeCertificate();
    certificate.addResolution(out.resolution.ledger, out.resolution.state.field);
    const claims = [...cont.held];
    const members = [...entry.cluster].filter((id) => cont.sub.unitOf(id) !== undefined);
    const matrix = buildContactMatrix({
      sub: from,
      resolution: out.resolution,
      members,
      claims,
      horizonPlies: this.tuning.horizonPlies,
      table: this.tableFor(from),
    });
    const contact = contactOf(matrix, members, certificate);

    // ---- max_a min_b over the cluster's own options at the NEW root -------
    const scored = this.scoreOptions(cont, req, members);
    const discrimination = this.discriminationOf(entry, scored, contact, cont);

    // ---- the line this ply proved, for the next one to continue from ------
    //
    // ONE argmax decision, not two: the plan is looked up by the very key
    // `discriminationOf` chose, so the line a thread follows and the key its
    // `argmaxMoved` compares against can never be two different options.
    const line = scored.perOption.find((o) => o.key === discrimination.argmax);
    if (line === undefined) this.lines.delete(entry.key);
    else this.lines.set(entry.key, line.plan);

    // ---- the accumulator, weighted by what this ply actually decided ------
    accumulate(
      entry,
      out.resolution,
      out.resolution.state.field.slots,
      Math.max(discrimination.floorSpread, discrimination.estSpread, 0) + (discrimination.argmaxMoved ? 1 : 0)
    );

    // One resolution for the ply's own root, plus every world `scoreOptions`
    // priced. Resolution-equivalents, exactly as `refinementCost` denominates
    // a catch-up, so the scheduler can compare a deepen against an expansion
    // in one currency.
    const cost = 1 + scored.priced;
    const ply: ThreadPly = {
      ply: depthOf(entry) + 1,
      move: plan,
      advisory: scored.best,
      contact,
      discrimination,
      cost,
    };
    entry.plies.push(ply);
    entry.skew = Math.max(entry.skew, ply.ply);
    entry.stepCost = cost;
    for (const a of cont.assumptions) entry.assumptions.push(a);
    for (const id of cont.carriedContingent) entry.carriedContingent.add(id);
    this.values.set(entry.key, scored.best.lo);
    this.ledger.counters.deepened++;
    this.purse.spend(cost);

    // ---- the VALUE-BEARING publication, and the error it earned -----------
    //
    // Every input below is a number this ply already measured. Nothing is
    // chosen, nothing is clamped, and the accumulation over plies is what
    // makes a deeper reading automatically less precise than a shallower one
    // without a decay constant existing anywhere.
    if (this.offered.has(entry.key)) {
      const held = cont.held.size;
      const sigma = sigmaOfPly({
        world: Number.isFinite(scored.best.hi) && Number.isFinite(scored.best.lo)
          ? Math.max(0, scored.best.hi - scored.best.lo) / 2
          : Number.POSITIVE_INFINITY,
        spread: Math.max(discrimination.floorSpread, discrimination.estSpread),
        ourMiss: 1 - scored.ourCoverage,
        theirMiss: 1 - scored.theirCoverage,
        fog: discrimination.saturation,
        interfere: held === 0 ? 0 : cont.distrusted.size / held,
      });
      const prior = this.deep.get(entry.key);
      this.deep.set(entry.key, {
        value: scored.best.lo,
        sigmaSq: (prior?.sigmaSq ?? 0) + sigma * sigma,
        plies: ply.ply + 1,
        root: entry.rootPlan,
      });
    }

    // ---- expansion, priced before it is paid (§7.2) -----------------------
    const partition = this.partitions.get(entry.key) ?? req.partition;
    const proposal = priceExpansion({
      entry,
      partition,
      ledger: out.resolution.ledger,
      field: out.resolution.state.field,
      currentTurn: out.resolution.state.turn,
      tuning: this.tuning,
    });
    if (proposal !== null && proposal.admitted && proposal.rate > 0) {
      const grown = expandCluster(
        partition,
        entry.clusterId,
        proposal.unitId,
        this.tuning.maxVariables
      );
      if (grown.applied) {
        this.partitions.set(entry.key, grown.partition);
        // MONOTONE ON THE MODELLED SET: added, never dropped. The prefix stays
        // published — this ply's `advisory` is not rewritten — and only future
        // plies see the wider cluster. Leaf-patching a stored suffix is
        // forbidden (contract rule 24), and the way this code cannot commit it
        // is that it never edits a `ThreadPly` after pushing one.
        (entry.cluster as Set<UnitId>).add(proposal.unitId);
        this.ledger.counters.expanded++;
      }
    }

    // The parent root is spent; this ply's is the new one.
    const previous = this.roots.get(entry.key);
    if (previous !== undefined) previous.release();
    this.roots.set(entry.key, cont);
    from.releaseResolution(out.resolution);
  }

  /**
   * The cluster's joint move at a deeper root: each member on its own best
   * option, AS THE PREVIOUS PLY'S MAX-MIN FOUND IT. Everything else is absent
   * from the plan and is therefore HELD — the plan-domain rule, which is what
   * makes shell 2 automatic rather than something this file has to remember.
   *
   * The proved line is `lines[entry.key]`, recorded by the ply that built
   * `parent` and therefore denominated at exactly this root. Before CL6a's
   * repair this method took `candidates[0]` — the generator's FIRST heuristic
   * option — for every member, so from the third turn onward a thread followed
   * a greedily-chosen line while its documentation, its `argmaxMoved` and its
   * security value all claimed the line the search had proved. A value of the
   * wrong line is not a cheaper value; it is a different question's answer.
   *
   * Two members are still on the heuristic, and both are honest:
   *   · IN-CLUSTER ENEMIES. The max-min mins over their profiles INTO A SCALAR
   *     (F-5) and never records which reply achieved the min, so there is no
   *     proved line for them to follow. Naming one would be inventing it.
   *   · A UNIT THE CLUSTER GREW INTO after the parent ply priced its options
   *     (§7.2 expansion is monotone), which the argmax cannot mention because
   *     it was not a variable when the argmax was taken.
   */
  private deepPlan(
    entry: ThreadEntry,
    parent: Continuation,
    req: ScoutRequest
  ): JointPlan | null {
    const line = this.lines.get(entry.key);
    const plan = new Map<UnitId, Candidate>();
    for (const id of entry.cluster) {
      if (parent.sub.unitOf(id) === undefined) continue;
      const proved = line?.get(id);
      if (proved !== undefined) {
        plan.set(id, proved);
        continue;
      }
      const set = req.gen.candidatesFor(parent.sub, id);
      const c = set.candidates[0];
      if (c !== undefined) plan.set(id, c);
    }
    return plan.size === 0 ? null : plan;
  }

  /**
   * `max_a min_b` over the cluster's own options, at the continuation root.
   *
   * The inner loop MINS INTO A SCALAR before the outer loop maxes, so no
   * choice is ever indexed by a profile and the information-set constraint
   * holds structurally (F-5). In-cluster enemies are enumerated explicitly and
   * are small by construction; out-of-cluster everything is a held cloud and
   * the engine's own bounded resolve takes the worst case over it, which is
   * where "worst-case composition" actually happens.
   */
  private scoreOptions(
    cont: Continuation,
    req: ScoutRequest,
    members: ReadonlyArray<UnitId>
  ): {
    readonly best: { readonly lo: number; readonly est: number; readonly hi: number };
    readonly perOption: ReadonlyArray<{
      readonly key: string;
      readonly lo: number;
      readonly hi: number;
      /** The option itself — OUR units' joint move at this root. Carried so
       *  the argmax the max-min proved can be continued from, rather than
       *  re-derived from a one-turn heuristic ordering. */
      readonly plan: JointPlan;
    }>;
    /** Worlds actually resolved — the ply's cost, in resolution-equivalents. */
    readonly priced: number;
    /**
     * ENUMERATION CLEANLINESS, one fraction per quantifier: joints priced over
     * the joint space the FULL candidate lists span. 1 means the `max` (or the
     * `min`) ranged over everything the generator offered; less means the value
     * is a max over a subset (conservative in value) or a min over a subset
     * (optimistic in value). Both are model error and both are paid for in the
     * precision, which is why they are measured here rather than assumed away.
     */
    readonly ourCoverage: number;
    readonly theirCoverage: number;
  } {
    const ours: Array<{ id: UnitId; options: ReadonlyArray<Candidate> }> = [];
    const theirs: Array<{ id: UnitId; options: ReadonlyArray<Candidate> }> = [];
    let ourSpace = 1;
    let theirSpace = 1;
    for (const id of members) {
      const unit = cont.sub.unitOf(id);
      if (unit === undefined) continue;
      const set = req.gen.candidatesFor(cont.sub, id);
      if (set.candidates.length === 0) continue;
      const trimmed = set.candidates.slice(0, 3);
      if (unit.team === req.asTeam) {
        ours.push({ id, options: trimmed });
        ourSpace *= set.candidates.length;
      } else {
        theirs.push({ id, options: trimmed });
        theirSpace *= set.candidates.length;
      }
    }
    if (ours.length === 0) {
      return {
        best: { lo: 0, est: 0, hi: 0 },
        perOption: [],
        priced: 0,
        ourCoverage: 0,
        theirCoverage: 0,
      };
    }

    const ourJoints = enumerateJoints(ours, 6);
    const theirJoints = theirs.length === 0 ? [new Map<UnitId, Candidate>()] : enumerateJoints(theirs, 4);
    const ourCoverage = ourSpace <= 0 ? 0 : Math.min(1, ourJoints.length / ourSpace);
    const theirCoverage =
      theirs.length === 0 ? 1 : theirSpace <= 0 ? 0 : Math.min(1, theirJoints.length / theirSpace);
    const perOption: Array<{ key: string; lo: number; hi: number; plan: JointPlan }> = [];
    let priced = 0;
    let bestLo = -Infinity;
    let bestHi = -Infinity;
    for (const a of ourJoints) {
      // min over b, INTO A SCALAR. One reply per information set.
      let worst = Infinity;
      let worstHi = Infinity;
      for (const b of theirJoints) {
        const joint = new Map<UnitId, Candidate>(a);
        for (const [id, c] of b) joint.set(id, c);
        let scored;
        try {
          scored = cont.sub.resolveBoundedFull(joint, req.asTeam);
        } catch {
          continue;
        }
        priced++;
        worst = Math.min(worst, scored.bounds.worst);
        worstHi = Math.min(worstHi, scored.bounds.best);
        cont.sub.releaseResolution(scored.resolution);
      }
      if (!Number.isFinite(worst)) continue;
      perOption.push({ key: keyOfJoint(a), lo: worst, hi: worstHi, plan: a });
      if (worst > bestLo) {
        bestLo = worst;
        bestHi = worstHi;
      }
    }
    if (perOption.length === 0) {
      return {
        best: { lo: 0, est: 0, hi: 0 },
        perOption: [],
        priced,
        ourCoverage: 0,
        theirCoverage: 0,
      };
    }
    return {
      best: { lo: bestLo, est: (bestLo + bestHi) / 2, hi: bestHi },
      perOption: perOption.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)),
      priced,
      ourCoverage,
      theirCoverage,
    };
  }

  /** The discrimination state — §7.1's numbers, and the park test's input. */
  private discriminationOf(
    entry: ThreadEntry,
    scored: ReturnType<Scout['scoreOptions']>,
    contact: ContactVerdict,
    cont: Continuation
  ): Discrimination {
    let lo = Infinity;
    let hiLo = -Infinity;
    let hi = Infinity;
    let hiHi = -Infinity;
    let argmax = '';
    let argmaxValue = -Infinity;
    for (const o of scored.perOption) {
      lo = Math.min(lo, o.lo);
      hiLo = Math.max(hiLo, o.lo);
      hi = Math.min(hi, o.hi);
      hiHi = Math.max(hiHi, o.hi);
      if (o.lo > argmaxValue) {
        argmaxValue = o.lo;
        argmax = o.key;
      }
    }
    const previous = entry.plies.length === 0 ? null : (entry.plies[entry.plies.length - 1] as ThreadPly);
    const previousArgmax = previous === null ? null : previous.discrimination.argmax ?? null;
    const spread = (a: number, b: number): number =>
      Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
    const saturation =
      cont.held.size === 0 ? 0 : contact.saturated.length / cont.held.size;
    return {
      floorSpread: spread(lo, hiLo),
      estSpread: spread(hi, hiHi),
      // The SOUND currency, and it is deliberately zero in this tranche: a
      // witness is a concrete punishing reply admitted through the bank's own
      // witness channel, and this layer may not write one. CL6b owes the
      // durable-witness path; until it exists, reporting a number here would
      // be reporting a currency nobody can spend.
      witnesses: 0,
      saturation,
      argmaxMoved: previousArgmax !== null && previousArgmax !== argmax,
      argmax,
    };
  }

  /**
   * THE ORDERING SINK. Threads of one cluster whose ply-1 plans differ in
   * EXACTLY ONE unit's candidate give a first difference, and a first
   * difference is attributable. Nothing else emits advice.
   */
  private harvest(): void {
    const byCluster = new Map<number, ThreadEntry[]>();
    for (const t of this.ledger.all()) {
      if (t.plies.length === 0) continue;
      const list = byCluster.get(t.clusterId);
      if (list === undefined) byCluster.set(t.clusterId, [t]);
      else list.push(t);
    }
    for (const [, threads] of byCluster) {
      threads.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (let i = 0; i < threads.length; i++) {
        for (let j = i + 1; j < threads.length; j++) {
          const a = threads[i] as ThreadEntry;
          const b = threads[j] as ThreadEntry;
          // L5: est compares only at EQUAL DEPTH. Two threads at different
          // depths are two different questions and their difference is not a
          // first difference of anything.
          if (depthOf(a) !== depthOf(b)) continue;
          const diff = soleDifference(a.rootPlan, b.rootPlan);
          if (diff === null) continue;
          const va = this.values.get(a.key);
          const vb = this.values.get(b.key);
          if (va === undefined || vb === undefined) continue;
          if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
          const delta = va - vb;
          if (delta === 0) continue;
          // BOTH DIRECTIONS, at the same magnitude. The first difference is
          // symmetric — it says this candidate is worth `delta` more than that
          // one, two turns out — and the loser-only rule threw away half of it
          // on the ground that a promotion cannot be discounted. It can now:
          // the value channel prices depth by earned precision, and an ordering
          // hint that can only ever push down cannot report a discovered kill.
          const note = `ply ${depthOf(a)} first-difference`;
          this.note(diff.a, delta, note);
          this.note(diff.b, -delta, note);
        }
      }
    }
  }

  private note(c: Candidate, delta: number, note: string): void {
    const key = `${c.unitId}:${c.to as number}`;
    const prior = this.findings.get(key);
    // THE LARGEST FINDING WINS, not the sum, and the sign is kept: two threads
    // finding the same danger is one danger, and summing would let the
    // sampler's own breadth inflate it. A magnitude tie is broken toward the
    // more negative reading, so the rule is total and the order it is applied
    // in cannot change the answer.
    if (prior !== undefined) {
      const a = Math.abs(prior.delta);
      const b = Math.abs(delta);
      if (a > b || (a === b && prior.delta <= delta)) return;
    }
    this.findings.set(key, { unitId: c.unitId, to: c.to, delta, note });
  }

  private releaseRoots(): void {
    for (const cont of this.roots.values()) cont.release();
    this.roots.clear();
    // A proved line is a plan AT A ROOT. The roots are gone, so the plans that
    // named their cells are no longer plans of anything.
    this.lines.clear();
  }

  /**
   * WHAT THE DEEPENED LINES ARE WORTH, in canonical order — one per offered
   * root that reached a continuation.
   *
   * Canonical means sorted by the note, which carries the thread key: the key
   * is a pure function of (cluster, root plan), so the order is a function of
   * the board and never of iteration or of which thread finished first.
   */
  deepObservations(): ReadonlyArray<DeepObservation> {
    const out: DeepObservation[] = [];
    for (const [key, d] of this.deep) {
      out.push({
        root: d.root,
        value: d.value,
        sigma: Math.sqrt(d.sigmaSq),
        plies: d.plies,
        note: `${key}@${d.plies}`,
      });
    }
    return out.sort((a, b) => (a.note < b.note ? -1 : a.note > b.note ? 1 : 0));
  }

  /** Every finding, in canonical order. */
  advice(): ReadonlyArray<ScoutFinding> {
    return [...this.findings.values()].sort(
      (a, b) => a.unitId - b.unitId || (a.to as number) - (b.to as number)
    );
  }

  /**
   * The advice as CL3's `UnaryLookup` — the seam CL3 built for exactly this and
   * left unsupplied. `undefined` when nothing was found, which is the one case
   * where re-running the enumeration under a new potential would be paying for
   * an identical answer.
   */
  unaryAdvice(): ((unitId: UnitId, candidate: Candidate) => number) | undefined {
    if (this.findings.size === 0) return undefined;
    const table = this.findings;
    return (unitId: UnitId, candidate: Candidate): number =>
      table.get(`${unitId}:${candidate.to as number}`)?.delta ?? 0;
  }

  report(): ScoutReport {
    let deepest = 0;
    for (const d of this.deep.values()) deepest = Math.max(deepest, d.plies);
    return reportOf(
      this.ledger,
      this.purse,
      this.findings.size,
      this.deep.size,
      deepest,
      { ...this.refusals },
      this.gate
    );
  }

  /** Sum of clean prefixes — the §7.1 measurement, exposed for the probe. */
  cleanPrefixes(): ReadonlyArray<number> {
    return this.ledger.all().map(cleanPrefixOf);
  }

  release(): void {
    this.releaseRoots();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Joint moves of a small domain list, capped. Deterministic order. */
function enumerateJoints(
  domains: ReadonlyArray<{ id: UnitId; options: ReadonlyArray<Candidate> }>,
  cap: number
): ReadonlyArray<Map<UnitId, Candidate>> {
  const out: Array<Map<UnitId, Candidate>> = [];
  const picks = new Array<number>(domains.length).fill(0);
  for (;;) {
    const joint = new Map<UnitId, Candidate>();
    for (let i = 0; i < domains.length; i++) {
      const d = domains[i] as { id: UnitId; options: ReadonlyArray<Candidate> };
      joint.set(d.id, d.options[picks[i] as number] as Candidate);
    }
    out.push(joint);
    if (out.length >= cap) break;
    let i = domains.length - 1;
    for (; i >= 0; i--) {
      const d = domains[i] as { id: UnitId; options: ReadonlyArray<Candidate> };
      const next = (picks[i] as number) + 1;
      if (next < d.options.length) {
        picks[i] = next;
        for (let j = i + 1; j < domains.length; j++) picks[j] = 0;
        break;
      }
    }
    if (i < 0) break;
  }
  return out;
}

function keyOfJoint(joint: ReadonlyMap<UnitId, Candidate>): string {
  return [...joint.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => `${id}>${c.to as number}`)
    .join('|');
}

/** The two plans' single differing assignment, or null. */
export function soleDifference(
  a: JointPlan,
  b: JointPlan
): { readonly unitId: UnitId; readonly a: Candidate; readonly b: Candidate } | null {
  if (a.size !== b.size) return null;
  let found: { unitId: UnitId; a: Candidate; b: Candidate } | null = null;
  for (const [id, ca] of a) {
    const cb = b.get(id);
    if (cb === undefined) return null;
    if (cb.to === ca.to) continue;
    if (found !== null) return null;
    found = { unitId: id, a: ca, b: cb };
  }
  return found;
}

/*
 * `clampToLat` USED TO LIVE HERE and is deleted.
 *
 * It capped every scout finding at one material lattice step, on the argument
 * that a time-skewed material fact may inform an ordering and may not outbid a
 * ply-1 one. The measurement that killed it is in the depth diagnosis: across
 * 258 findings on three probe families it never fired once, because real
 * findings ran three to eight score units against a cap of ten — so it was
 * never what held depth back, and it would have bitten exactly when a thread
 * finally proved something big.
 *
 * The argument it encoded was right about the WORRY and wrong about the
 * INSTRUMENT. What a deep reading is discounted by now is the model error of
 * the simulation that produced it, measured on the line (`sigmaOfPly`) and
 * spent as precision. That scales in both directions and has no ceiling, which
 * is the whole of the difference.
 */
