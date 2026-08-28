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
 * ADVISORY. `ThreadPly.advisory` is a plain `{lo, est, hi}` of numbers and is
 * deliberately NOT a `ScoreBounds`: a channel that cannot be confused at the
 * type level cannot be confused at the call site. Nothing in this directory
 * constructs, meets, tightens or publishes a bound; `index.ts` states the
 * import law and the structural test reads the files to prove it. Under L1
 * depth is provenance and never denomination, under L2 depth may move est,
 * candidate order and scheduler priors and nothing else, and under L9 every
 * staged plan is still priced once, jointly, by the unconditional one-ply bank
 * and accepted by `better()`. With L9 in place the worst case of every
 * composition subtlety in this file is a WASTED PRICE, never a wrong staging.
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
 * The sign follows the polarity rule: `Surrogate.unary` adds φ_u and HIGHER IS
 * BETTER, so a discovered next-ply danger is a NEGATIVE term. The magnitude is
 * clamped to one material lattice step, because the advice is a time-skewed
 * quantity and a time-skewed quantity may not outbid a ply-1 material fact —
 * the EV-cliff law's own reasoning, applied across the ply boundary.
 */

import { LAT } from '../edge-ev';
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
import type { ScoutMode, ScoutReport, ScoutTuning } from './schedule';
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
  /** In lat, SIGNED so that negative is worse. Clamped to ±1 LAT. */
  readonly delta: number;
  /** Which ply of which thread found it — provenance for the operator. */
  readonly note: string;
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

  constructor(
    readonly mode: ScoutMode,
    tuning: Partial<ScoutTuning> = {},
    decisionMs = 0
  ) {
    this.tuning = { ...DEFAULT_SCOUT_TUNING, ...tuning };
    this.ledger = new ThreadLedger(this.tuning.capacity);
    this.purse = new ScoutPurse(decisionMs, this.tuning);
  }

  /** Rebuild the purse for a new decision. The LEDGER survives — that is the
   *  point of a ledger — but the tithe does not roll over. */
  beginDecision(decisionMs: number): void {
    this.purse = new ScoutPurse(decisionMs, this.tuning);
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
    if (this.mode === 'off') return;
    if (req.partition.clusters.length === 0 || req.seeds.length === 0) {
      this.refuse('no-cluster');
      return;
    }
    const isKing = (t: ThreadEntry): boolean => {
      if (req.kingUnits === undefined) return false;
      for (const id of t.cluster) if (req.kingUnits.has(id)) return true;
      return false;
    };

    for (const cluster of req.partition.clusters) {
      for (const seed of this.seedFamily(cluster.members, req)) {
        if (!this.purse.canSpend()) break;
        const key = `${cluster.id}:${threadKey(cluster.members, seed)}`;
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
          stepCostMs: 0,
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

    this.harvest(req);
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
   *  countdown, the accumulator, the expansion price. */
  private deepen(entry: ThreadEntry, req: ScoutRequest): void {
    const started = Date.now();
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

    // ---- the accumulator, weighted by what this ply actually decided ------
    accumulate(
      entry,
      out.resolution,
      out.resolution.state.field.slots,
      Math.max(discrimination.floorSpread, discrimination.estSpread, 0) + (discrimination.argmaxMoved ? 1 : 0)
    );

    const ms = Date.now() - started;
    const ply: ThreadPly = {
      ply: depthOf(entry) + 1,
      move: plan,
      advisory: scored.best,
      contact,
      discrimination,
      ms,
    };
    entry.plies.push(ply);
    entry.skew = Math.max(entry.skew, ply.ply);
    entry.stepCostMs = ms;
    for (const a of cont.assumptions) entry.assumptions.push(a);
    for (const id of cont.carriedContingent) entry.carriedContingent.add(id);
    this.values.set(entry.key, scored.best.lo);
    this.ledger.counters.deepened++;
    this.purse.spend(ms);

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
   * option, as the previous ply's max-min found it. Everything else is absent
   * from the plan and is therefore HELD — the plan-domain rule, which is what
   * makes shell 2 automatic rather than something this file has to remember.
   */
  private deepPlan(
    entry: ThreadEntry,
    parent: Continuation,
    req: ScoutRequest
  ): JointPlan | null {
    const plan = new Map<UnitId, Candidate>();
    for (const id of entry.cluster) {
      if (parent.sub.unitOf(id) === undefined) continue;
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
    readonly perOption: ReadonlyArray<{ readonly key: string; readonly lo: number; readonly hi: number }>;
  } {
    const ours: Array<{ id: UnitId; options: ReadonlyArray<Candidate> }> = [];
    const theirs: Array<{ id: UnitId; options: ReadonlyArray<Candidate> }> = [];
    for (const id of members) {
      const unit = cont.sub.unitOf(id);
      if (unit === undefined) continue;
      const set = req.gen.candidatesFor(cont.sub, id);
      if (set.candidates.length === 0) continue;
      const trimmed = set.candidates.slice(0, 3);
      if (unit.team === req.asTeam) ours.push({ id, options: trimmed });
      else theirs.push({ id, options: trimmed });
    }
    if (ours.length === 0) {
      return { best: { lo: 0, est: 0, hi: 0 }, perOption: [] };
    }

    const ourJoints = enumerateJoints(ours, 6);
    const theirJoints = theirs.length === 0 ? [new Map<UnitId, Candidate>()] : enumerateJoints(theirs, 4);
    const perOption: Array<{ key: string; lo: number; hi: number }> = [];
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
        worst = Math.min(worst, scored.bounds.worst);
        worstHi = Math.min(worstHi, scored.bounds.best);
        cont.sub.releaseResolution(scored.resolution);
      }
      if (!Number.isFinite(worst)) continue;
      perOption.push({ key: keyOfJoint(a), lo: worst, hi: worstHi });
      if (worst > bestLo) {
        bestLo = worst;
        bestHi = worstHi;
      }
    }
    if (perOption.length === 0) return { best: { lo: 0, est: 0, hi: 0 }, perOption: [] };
    return {
      best: { lo: bestLo, est: (bestLo + bestHi) / 2, hi: bestHi },
      perOption: perOption.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)),
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
    const previousArgmax = previous === null ? null : (previous as ThreadPly & { argmax?: string }).argmax ?? null;
    const spread = (a: number, b: number): number =>
      Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
    const saturation =
      cont.held.size === 0 ? 0 : contact.saturated.length / cont.held.size;
    const d: Discrimination & { argmax?: string } = {
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
    };
    d.argmax = argmax;
    return d;
  }

  /**
   * THE ORDERING SINK. Threads of one cluster whose ply-1 plans differ in
   * EXACTLY ONE unit's candidate give a first difference, and a first
   * difference is attributable. Nothing else emits advice.
   */
  private harvest(req: ScoutRequest): void {
    if (this.mode !== 'advise') return;
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
          // The loser takes the penalty. The winner takes nothing: a positive
          // term would be a time-skewed number PROMOTING a candidate, and
          // promotion is the direction where being wrong costs a staging.
          const loser = delta < 0 ? diff.a : diff.b;
          this.note(loser, -clampToLat(Math.abs(delta)), `ply ${depthOf(a)} first-difference`);
        }
      }
    }
  }

  private note(c: Candidate, delta: number, note: string): void {
    const key = `${c.unitId}:${c.to as number}`;
    const prior = this.findings.get(key);
    // The WORST finding wins, not the sum: two threads finding the same danger
    // is one danger, and summing would let the sampler's own breadth inflate a
    // penalty.
    if (prior !== undefined && prior.delta <= delta) return;
    this.findings.set(key, { unitId: c.unitId, to: c.to, delta, note });
  }

  private releaseRoots(): void {
    for (const cont of this.roots.values()) cont.release();
    this.roots.clear();
  }

  /** Every finding, in canonical order. */
  advice(): ReadonlyArray<ScoutFinding> {
    return [...this.findings.values()].sort(
      (a, b) => a.unitId - b.unitId || (a.to as number) - (b.to as number)
    );
  }

  /**
   * The advice as CL3's `UnaryLookup` — the seam CL3 built for exactly this and
   * left unsupplied. `undefined` in `observe`, which is what makes the mode's
   * byte-identity claim structural rather than a promise.
   */
  unaryAdvice(): ((unitId: UnitId, candidate: Candidate) => number) | undefined {
    if (this.mode !== 'advise' || this.findings.size === 0) return undefined;
    const table = this.findings;
    return (unitId: UnitId, candidate: Candidate): number =>
      table.get(`${unitId}:${candidate.to as number}`)?.delta ?? 0;
  }

  report(): ScoutReport {
    return reportOf(this.mode, this.ledger, this.purse, this.findings.size, { ...this.refusals });
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

/**
 * ONE MATERIAL LATTICE STEP, and no further.
 *
 * The EV-cliff law says a non-material ordering feature may not outbid one
 * unit's life, and excludes `fatal` by name because it IS the lattice. A
 * thread's finding is denominated in the lattice too — but at a DIFFERENT
 * TURN, and L1 says depth is provenance. So the clamp is the cross-ply form of
 * the same rule: a time-skewed material fact may inform an ordering, and may
 * not outweigh a ply-1 one.
 */
export function clampToLat(v: number): number {
  return Math.min(Math.abs(v), LAT);
}
