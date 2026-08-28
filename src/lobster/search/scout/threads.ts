/**
 * THE THREAD LEDGER — what a cluster is currently looking at, one ply at a
 * time, and the one number that governs all of it.
 *
 * `la-inside` §2 and §3, built. A thread is (cluster, ply depth, joint-move
 * sequence, per-ply bounds marked ADVISORY, contact countdown), and it is
 * FIRST-CLASS KERNEL-ADJACENT STATE for the same reason `PinContextEntry` is:
 * anything held in a closure dies at the slice boundary, and anything held at
 * module scope is the arena-latch bug class the kernel has a standing rule
 * against (`kernel.ts:239-243`).
 *
 * ── ONE NUMBER (synthesis §1c.3) ───────────────────────────────────────────
 *
 * `contactIn` is simultaneously the shell assignment, the branching schedule,
 * the degradation clock and — under §7.1 — a *scheduler input* rather than a
 * lifecycle verdict. It is MIN-DECOMPOSABLE: `contact(C, u) = min over members
 * of contact(m, u)`, verified 588/588 by M4. That is what lets one unit×unit
 * matrix answer every cluster policy for the whole decision, at ~56 µs to
 * build and 0.006–0.019 µs per read, and it is why `expandCluster` is cheap to
 * price — adding a member can only LOWER a countdown, never raise it, so a
 * post-expansion countdown is a min over one more row.
 *
 * ── THE THREE COSTS WE REFUSE TO PAY ───────────────────────────────────────
 *
 *   1. **`arrival()` — never.** `CloudTimeline.arrival()` runs a `minCost`
 *      Dijkstra that is 407 µs of a 431 µs cold arrival grid on a 13×13 board
 *      at 26 units — 94% of the cost, and read by nothing on this path. The
 *      countdown is built on `earliestShells`/`UnitShells.frontAt`, which is
 *      the same stamping loop with the Dijkstra removed. `teamArrivalInto` is
 *      out for the same reason. This is the single easiest way to make the
 *      lookahead 10× slower than it needs to be, so the module carries a
 *      counter (`dijkstraReads`) that a test asserts is zero.
 *   2. **Per-ply dilation — never repeated.** `ShellTable` interns `UnitShells`
 *      per decision and `extendTo` extends IN PLACE; `fronts[i]` is a POINTER
 *      into a board the timeline already owns. So a per-ply contact test is
 *      one word-AND loop with no allocation.
 *   3. **A search — never.** `everPossible` is cumulative and `advanceTo` is
 *      monotone, so "has anything reached the region by ply j" is monotone in
 *      j. The countdown is therefore a SCAN with early exit, not a search.
 *
 * ── F-8: CONTACT IS DEFINED ON DEPENDENCY, NOT OCCUPANCY ───────────────────
 *
 * A cluster that depends on a food cell it never stands on has an undetected
 * interference channel. The region is `EngineSubstrate.influenceOf` over the
 * members — occupancy plus every cell the grammar can enter — which is already
 * documented at its own definition as a deliberate over-approximation in the
 * safe direction. Resource-read is subsumed: in these rules consumption IS
 * entry, so a pellet the cluster can eat is a cell it can enter. Terrain-read
 * is static and cannot be contested. What is NOT subsumed is a race margin
 * against food outside the region (merged-ladder row #10), so the region takes
 * an `extra` board and the scheduler may widen it; widening only ever LOWERS a
 * countdown, which is the safe direction for a trigger.
 *
 * ── SATURATION ─────────────────────────────────────────────────────────────
 *
 * A queen's cloud reaches everything at T+1, so a naive trigger would report
 * contact-now for every thread on every slider board and the scheduler would
 * have no gradient at all. The countdown gates on saturation and falls back to
 * the ONE arrival quantity that survives it and that nothing currently reads:
 * `Cloud.costFeasible`/`minCost` (OB-E5). Here the fallback is stated in the
 * cheapest honest form — a saturated claim reports `contactIn = 0` but is
 * flagged `saturated`, and the scheduler reads the flag rather than the zero,
 * because a number every thread shares discriminates nothing.
 */

import { bbIntersects, bbSet, newBoard } from '../../../partial-engine/index';
import type { Board, FieldSlot, Grid } from '../../../partial-engine/index';
import { ShellTable, buildShells } from '../../evaluate';
import type { EngineSubstrate } from '../../substrate';
import type { Resolution } from '../../../partial-engine/index';
import type { Assumption, CellIndex, JointPlan, Posture, UnitId } from '../../contracts';

// ---------------------------------------------------------------------------
// The countdown
// ---------------------------------------------------------------------------

export interface ContactVerdict {
  /** Plies until the first distant claim touches the region. 0 = in contact
   *  already; `Infinity` = provably isolated to the horizon scanned. */
  readonly contactIn: number;
  /** Who arrives at `contactIn` — the expansion roster, and the re-simulation
   *  roster if the scheduler ever chooses to pay for one. */
  readonly arrivals: ReadonlyArray<UnitId>;
  /** Claims whose cloud already covers the whole scanned horizon. Their zero
   *  is not information; the scheduler reads this instead. */
  readonly saturated: ReadonlyArray<UnitId>;
  /** Distant units this thread's ledgers already name. T2 says these are NOT
   *  free to unfreeze — the prefix already depends on them. */
  readonly entangledAlready: ReadonlyArray<UnitId>;
  /** How far the scan actually looked. Reading `Infinity` as "cannot arrive"
   *  when the horizon is short is an under-approximation and F-1 forbids it —
   *  every consumer must compare against this before believing an isolation. */
  readonly horizon: number;
}

/**
 * THE MATRIX. One row per claim, one column per member, built once per
 * decision and read O(1) per ply per cluster.
 *
 * `earliestTouch[u][m]` is the first ABSOLUTE turn `u`'s head-possible front
 * intersects `m`'s dependency footprint, or `Infinity` inside the horizon.
 * Min-decomposability means a cluster's answer is a min over its columns and
 * an expansion's answer is a min over one more, so nothing is ever rebuilt.
 */
export class ContactMatrix {
  private readonly rows = new Map<UnitId, Map<UnitId, number>>();
  private readonly saturatedClaims = new Set<UnitId>();
  private readonly regions = new Map<UnitId, Board>();
  /** Must stay 0. See the header's cost 1. */
  readonly dijkstraReads = 0;
  readonly rootTurn: number;
  readonly horizonTurn: number;

  constructor(
    private readonly grid: Grid,
    rootTurn: number,
    horizonTurn: number
  ) {
    this.rootTurn = rootTurn;
    this.horizonTurn = horizonTurn;
  }

  /** The dependency footprint of one member, cached. */
  regionOf(sub: EngineSubstrate, unitId: UnitId, extra?: Board): Board {
    const hit = this.regions.get(unitId);
    if (hit !== undefined && extra === undefined) return hit;
    const board = newBoard(this.grid);
    for (const cell of sub.influenceOf(unitId)) bbSet(board, cell);
    if (extra !== undefined) for (let w = 0; w < this.grid.words; w++) board[w] |= extra[w] as number;
    if (extra === undefined) this.regions.set(unitId, board);
    return board;
  }

  set(claim: UnitId, member: UnitId, turn: number): void {
    let row = this.rows.get(claim);
    if (row === undefined) {
      row = new Map();
      this.rows.set(claim, row);
    }
    row.set(member, turn);
  }

  markSaturated(claim: UnitId): void {
    this.saturatedClaims.add(claim);
  }

  isSaturated(claim: UnitId): boolean {
    return this.saturatedClaims.has(claim);
  }

  /** `contact(C, u) = min over members` — the decomposition, as one read. */
  touchOf(claim: UnitId, members: Iterable<UnitId>): number {
    const row = this.rows.get(claim);
    if (row === undefined) return Infinity;
    let best = Infinity;
    for (const m of members) {
      const t = row.get(m);
      if (t !== undefined && t < best) best = t;
    }
    return best;
  }

  claims(): ReadonlyArray<UnitId> {
    return [...this.rows.keys()];
  }
}

/**
 * Build the matrix off a resolution, using the evaluator's own shell table.
 *
 * `buildShells` is on the production evaluation path today and already does
 * the ply-2-shaped thing: it takes a `Resolution` and produces shells for both
 * the resolved live units and the already-held slots, reading everything at
 * `resolution.state.turn`. The contact detector is a consumer of a function
 * every scored plan already calls.
 */
export function buildContactMatrix(args: {
  readonly sub: EngineSubstrate;
  readonly resolution: Resolution;
  readonly members: ReadonlyArray<UnitId>;
  readonly claims: ReadonlyArray<UnitId>;
  readonly horizonPlies: number;
  readonly table: ShellTable;
  /** Extra dependency cells per member — the race-margin widening (F-8). */
  readonly extra?: ReadonlyMap<UnitId, Board>;
}): ContactMatrix {
  const rootTurn = args.resolution.state.turn;
  const horizonTurn = rootTurn + Math.max(1, args.horizonPlies);
  const m = new ContactMatrix(args.sub.grid, rootTurn, horizonTurn);
  const shells = buildShells(args.sub, args.resolution, Math.max(1, args.horizonPlies), args.table);

  for (const claim of args.claims) {
    const s = shells.get(claim);
    if (s === undefined) continue;
    let sawEmpty = false;
    let sawAll = true;
    for (const member of args.members) {
      const region = m.regionOf(args.sub, member, args.extra?.get(member));
      let touch = Infinity;
      // The SCAN, with early exit. Monotone in `t` because `everPossible` is
      // cumulative, so the first hit is the answer and nothing after it can
      // change the verdict.
      for (let t = rootTurn + 1; t <= horizonTurn; t++) {
        const front = s.frontAt(t);
        if (front === null) {
          sawEmpty = true;
          break;
        }
        if (bbIntersects(front, region, args.sub.grid.words)) {
          touch = t;
          break;
        }
      }
      if (touch !== rootTurn + 1) sawAll = false;
      m.set(claim, member, touch);
    }
    // A claim that reaches EVERY member's footprint on the very first step is
    // reporting the shape of its own grammar, not a fact about this cluster.
    // That is the saturation the trigger must not read as urgency.
    if (sawAll && args.members.length > 0 && !sawEmpty) m.markSaturated(claim);
  }
  return m;
}

/** The verdict for one cluster, off the matrix. O(claims × members). */
export function contactOf(
  matrix: ContactMatrix,
  members: ReadonlyArray<UnitId>,
  certificate: { earliestEntangledTurn(unitId: number): number | null }
): ContactVerdict {
  let best = Infinity;
  const arrivals: UnitId[] = [];
  const saturated: UnitId[] = [];
  const entangledAlready: UnitId[] = [];
  for (const claim of matrix.claims()) {
    if (matrix.isSaturated(claim)) saturated.push(claim);
    if (certificate.earliestEntangledTurn(claim) !== null) entangledAlready.push(claim);
    const t = matrix.touchOf(claim, members);
    if (t < best) best = t;
  }
  for (const claim of matrix.claims()) {
    if (matrix.touchOf(claim, members) === best) arrivals.push(claim);
  }
  return {
    contactIn: best === Infinity ? Infinity : Math.max(0, best - matrix.rootTurn - 1),
    arrivals: best === Infinity ? [] : arrivals.sort((a, b) => a - b),
    saturated: saturated.sort((a, b) => a - b),
    entangledAlready: entangledAlready.sort((a, b) => a - b),
    horizon: matrix.horizonTurn,
  };
}

// ---------------------------------------------------------------------------
// Discrimination — what a thread is still WORTH, per §7.1
// ---------------------------------------------------------------------------

/**
 * THE OWNER'S RULING, IN NUMBERS. Contact is demoted from a lifecycle event to
 * a telemetry event: the contacting outsider was already a shell-2 cloud, and
 * contact means only that its cloud now intersects the dependency footprint —
 * i.e. the thread's bounds begin to FEEL it. The thread keeps simulating, with
 * every heuristic reading the thread's dilated field, and what decays is
 * DISCRIMINATION, not correctness (F1 / Design H: nested maximin over held,
 * dilated clouds is unconditionally sound at ANY depth).
 *
 * So the parking question is not "has contact happened" but "is this thread
 * still telling the cluster anything about its own options". The honest cheap
 * proxy for that, and the one this tranche implements, is ARGMAX INSTABILITY
 * among the cluster's own root options: how much the thread's per-option
 * advisory values still SPREAD, and whether the spread is still MOVING.
 *
 * `floorSpread` and `estSpread` are max−min over the cluster's root options.
 * Both are advisory by construction — they are computed inside a time-skewed
 * world and L1 makes depth provenance, never denomination — and the field
 * names say so. `witnessRate` is the sound currency and is rationed
 * SEPARATELY: the two-currency law forbids adding witness-Γ to a flip rate,
 * so they are two fields and never a sum.
 */
export interface Discrimination {
  /** max − min of the root options' ADVISORY worst-case values at this ply.
   *  0 once the cloud has flattened them, which is the fog horizon arriving. */
  readonly floorSpread: number;
  /** The same for the est channel, which retains spread longer than floors do. */
  readonly estSpread: number;
  /** Sound-currency yield: punishing replies found this ply. Never added to
   *  the spreads — different currency, fixed tithe split. */
  readonly witnesses: number;
  /** Fraction of the thread's claims whose clouds have saturated. */
  readonly saturation: number;
  /** Did the argmax over root options move at this ply? The instability the
   *  value proxy is actually about. */
  readonly argmaxMoved: boolean;
}

export const FLAT: Discrimination = {
  floorSpread: 0,
  estSpread: 0,
  witnesses: 0,
  saturation: 1,
  argmaxMoved: false,
};

/**
 * Marginal discrimination per millisecond — `ρ_thread` of synthesis §7.1.
 *
 * Deliberately NOT a weighted sum of the two currencies. The advisory half
 * (spread consumed by the root decision, plus the instability bonus) is what
 * this returns; the sound half (witness yield) is returned separately by
 * `soundYield` and the scheduler rations the two by a fixed tithe split. A
 * function that added them would be exactly the two-currency violation rule 23
 * forbids, and it would be invisible the moment either currency was zero.
 */
export function advisoryRate(d: Discrimination, units: number): number {
  if (units <= 0) return 0;
  const spread = Math.max(d.floorSpread, d.estSpread);
  return (spread * (d.argmaxMoved ? 2 : 1)) / units;
}

export function soundYield(d: Discrimination, units: number): number {
  return units <= 0 ? 0 : d.witnesses / units;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export type ThreadState =
  | 'live'
  /** Parked because discrimination per ms fell below the alternatives. NOT
   *  because contact happened — §7.1 demotes that to telemetry. */
  | 'parked-flat'
  /** Parked because the tithe ran out this decision. */
  | 'parked-budget'
  /** The premise it was proved under no longer holds. */
  | 'invalidated';

/** One ply of a thread: the joint move it took, and what that ply bought. */
export interface ThreadPly {
  readonly ply: number;
  /** The cluster's joint move at this ply. Part of the thread's identity. */
  readonly move: JointPlan;
  /** ADVISORY. Never a `ScoreBounds`, never denominated at the root, never
   *  legal to meet with a ply-1 interval (L1, L5, F-6). The type is separate
   *  from `ScoreBounds` on purpose: a channel that cannot be confused at the
   *  type level cannot be confused at the call site either. */
  readonly advisory: { readonly lo: number; readonly est: number; readonly hi: number };
  readonly contact: ContactVerdict;
  readonly discrimination: Discrimination;
  /** What this ply cost, in RESOLUTION-EQUIVALENTS — never milliseconds. The
   *  scout reads no clock, so its rate is a count and its decisions are a pure
   *  function of the board. See `ScoutPurse`. */
  readonly cost: number;
}

export interface ThreadEntry {
  /** Canonical: clusterKey ‖ ply-1 planKey. Stable for the thread's life. */
  readonly key: string;
  readonly clusterId: number;
  readonly cluster: ReadonlySet<UnitId>;
  /** The ply-1 joint plan this thread continues from. FIXED for the thread's
   *  life — the timeline-sharing economy depends on it, because the non-cluster
   *  ply-1 assignment is what keys the premise and a changed food board is the
   *  single most expensive thing in the whole cost model (0.17–0.50 ms). */
  readonly rootPlan: JointPlan;
  readonly rootTurn: number;
  readonly epochBaseline: number;
  readonly postureBaseline: Posture;
  /** Every ply this thread got, in order. The joint-move SEQUENCE. */
  readonly plies: ThreadPly[];
  /** Units cited by any ply's ledger — the invalidation key, exactly as
   *  `PinContextEntry.citedUnits`. */
  readonly citedUnits: Set<UnitId>;
  /** Citation mass per outsider — `accum(thread, u)` of §7.2, the expansion
   *  trigger. Weighted by the ply's share of the thread's value. */
  readonly accumulation: Map<UnitId, number>;
  readonly carriedContingent: Set<UnitId>;
  /** Plies of dilation the distant claims have taken past their last
   *  observation. Monotone. The degradation currency, and never a decay
   *  factor: a skew of 3 means the clouds are three steps wider, full stop. */
  skew: number;
  /** Whatever the door could not carry — I7/I8 today. Rides the basis. */
  readonly assumptions: Assumption[];
  state: ThreadState;
  /** Per-thread, as at `kernel.ts:243`, and PER-THREAD is the load-bearing
   *  word: threads on different clusters cost wildly different amounts.
   *  In resolution-equivalents. */
  stepCost: number;
  lastUsed: number;
}

/** Where a thread stands, for the scheduler and the telemetry. */
export function depthOf(t: ThreadEntry): number {
  return t.plies.length;
}

export function lastDiscrimination(t: ThreadEntry): Discrimination {
  return t.plies.length === 0 ? FLAT : (t.plies[t.plies.length - 1] as ThreadPly).discrimination;
}

/**
 * The CLEAN PREFIX: how many plies ran before the first contact.
 *
 * §7.1 reinterprets M4's [8.5%, 13.7%] decision-level bracket: it is the
 * PROVABLY-CLEAN-PREFIX fraction, not the thread-lifetime estimate. This is
 * the number that measures against it, and it is deliberately NOT the thread's
 * depth — post-contact plies are a primary mode and they count toward depth
 * while counting against cleanliness.
 */
export function cleanPrefixOf(t: ThreadEntry): number {
  let n = 0;
  for (const ply of t.plies) {
    if (ply.contact.contactIn <= 0) break;
    n++;
  }
  return n;
}

/**
 * THE LEDGER — coordinator-owned, capacity-bounded, LRU.
 *
 * Modelled on `PinContextCache` (`kernel.ts:327-350`), including its
 * invalidation vocabulary, because a thread and a pin context are the same
 * KIND of object: a suspended line of work whose premise can be revoked by
 * something that happened elsewhere.
 */
export class ThreadLedger {
  private readonly entries = new Map<string, ThreadEntry>();
  private tick = 0;
  /** Counters. Telemetry only; a scheduler that read them would be reading its
   *  own history, which is how a bandit talks itself into a corner. */
  readonly counters = {
    opened: 0,
    deepened: 0,
    parked: 0,
    resumed: 0,
    expanded: 0,
    invalidatedByEpoch: 0,
    invalidatedByCatchUp: 0,
    refoldedByPosture: 0,
    evicted: 0,
  };

  constructor(readonly capacity: number = 64) {}

  get size(): number {
    return this.entries.size;
  }

  all(): ReadonlyArray<ThreadEntry> {
    return [...this.entries.values()];
  }

  get(key: string): ThreadEntry | undefined {
    const hit = this.entries.get(key);
    if (hit !== undefined) hit.lastUsed = ++this.tick;
    return hit;
  }

  open(entry: Omit<ThreadEntry, 'lastUsed'>): ThreadEntry {
    const made: ThreadEntry = { ...entry, lastUsed: ++this.tick };
    this.entries.set(made.key, made);
    this.counters.opened++;
    this.evict();
    return made;
  }

  /**
   * EPOCH — an operator pin. `kernel.ts:1234-1246` clears `run.plans` outright
   * on any epoch change, and its comment is decisive: *"Plans proved under the
   * old pins are not comparable under the new ones — and neither is the
   * refinement view that ranked them."* A thread's `rootPlan` IS a plan.
   *
   * Safest v1, and it is deliberately the blunt one: clear the ledger, exactly
   * as `run.plans.clear()` does, and measure what that costs before optimising
   * it into the speculative-survival rule the pin cache already has machinery
   * for (`PinContextEntry.speculative`).
   */
  onEpochChange(): number {
    const n = this.entries.size;
    this.entries.clear();
    this.counters.invalidatedByEpoch += n;
    return n;
  }

  /**
   * CATCH-UP — `PinContextCache.invalidateCitingUnit`'s twin, and the same
   * argument holds verbatim: *"A catch-up consumes OBSERVATIONS: it replaces a
   * premise rather than refining it, so every cached evaluation that cited the
   * unit is now about a board that never existed."* A catch-up on a DISTANT
   * unit is precisely the case where a whole family of parked threads become
   * answers about a board that never existed.
   */
  invalidateCitingUnit(unitId: UnitId): number {
    let n = 0;
    for (const [key, entry] of [...this.entries]) {
      if (!entry.citedUnits.has(unitId) && !entry.cluster.has(unitId)) continue;
      this.entries.delete(key);
      n++;
    }
    this.counters.invalidatedByCatchUp += n;
    return n;
  }

  /**
   * POSTURE FLIP — re-fold, never discard.
   *
   * The thread's numbers were proved under `postureBaseline`; a flip makes
   * them cross-basis. But the arch-synthesis ruling is that framing gates
   * COMPARABILITY and not discharge, so the resolutions are still resolutions:
   * the thread keeps its plies and re-stamps its baseline, and the scheduler
   * re-prices from what is cached. Discarding here would throw away the
   * expensive half (the simulation) to avoid re-doing the cheap half (the
   * fold), which is the wrong trade in both directions.
   *
   * What it does NOT do is keep publishing the old advisory numbers: the entry
   * is marked so a consumer knows the fold is owed.
   */
  onPostureFlip(posture: Posture): number {
    let n = 0;
    for (const entry of this.entries.values()) {
      if (entry.postureBaseline === posture) continue;
      (entry as { postureBaseline: Posture }).postureBaseline = posture;
      entry.plies.length = 0;
      entry.state = 'live';
      n++;
    }
    this.counters.refoldedByPosture += n;
    return n;
  }

  park(entry: ThreadEntry, why: 'parked-flat' | 'parked-budget'): void {
    if (entry.state === 'live') this.counters.parked++;
    entry.state = why;
  }

  resume(entry: ThreadEntry): void {
    if (entry.state !== 'live') this.counters.resumed++;
    entry.state = 'live';
    entry.lastUsed = ++this.tick;
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      let victimKey: string | null = null;
      let oldest = Infinity;
      for (const [key, e] of this.entries) {
        // A LIVE thread is never evicted ahead of a parked one: eviction is a
        // memory decision and parking is a value decision, and letting the
        // memory decision override the value one is how a cache starts
        // steering a search.
        const rank = e.state === 'live' ? e.lastUsed + this.capacity * 4 : e.lastUsed;
        if (rank < oldest) {
          oldest = rank;
          victimKey = key;
        }
      }
      if (victimKey === null) return;
      this.entries.delete(victimKey);
      this.counters.evicted++;
    }
  }
}

/**
 * ENTANGLEMENT ACCUMULATION — `accum(thread, u)` of synthesis §7.2, the
 * standing escalation trigger.
 *
 * The citation mass of outsider `u` across the thread's ply ledgers, weighted
 * by the branch's share of the thread's value. `SubtreeCertificate` already
 * accumulates exactly this shape (`addResolution` folds a ledger, `merge`
 * backs up, `earliestEntangledTurn` says how far a re-simulation must rewind),
 * so the trigger is a fold over the resolution's own ledger and not a second
 * bookkeeping system.
 *
 * The WEIGHT is the ply's share of the thread's discrimination: an outsider
 * cited on a branch that decided nothing has earned nothing. That is what
 * makes this "entanglement accumulation on HIGH-VALUE paths" rather than a
 * raw citation count, and it is the difference between an expansion that
 * recovers discrimination and one that just makes the table bigger.
 */
export function accumulate(
  entry: ThreadEntry,
  resolution: Resolution,
  slots: ReadonlyArray<FieldSlot>,
  weight: number
): void {
  for (const e of resolution.ledger) {
    for (const slot of slots) {
      if ((e.frozen & (1 << slot.slot)) === 0) continue;
      const id = slot.record.unitId;
      entry.citedUnits.add(id);
      entry.accumulation.set(id, (entry.accumulation.get(id) ?? 0) + weight);
    }
  }
}

/** The heaviest outsider, and its mass. The expansion candidate. */
export function heaviestOutsider(
  entry: ThreadEntry
): { readonly unitId: UnitId; readonly mass: number } | null {
  let best: { unitId: UnitId; mass: number } | null = null;
  for (const [unitId, mass] of entry.accumulation) {
    if (entry.cluster.has(unitId)) continue;
    if (best === null || mass > best.mass || (mass === best.mass && unitId < best.unitId)) {
      best = { unitId, mass };
    }
  }
  return best;
}

/** The canonical thread key. Sorted ids and sorted destinations, so two
 *  equivalent threads are one thread and the ledger cannot fork. */
export function threadKey(cluster: Iterable<UnitId>, rootPlan: JointPlan): string {
  const ids = [...cluster].sort((a, b) => a - b).join(',');
  const moves = [...rootPlan.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => `${id}>${c.to as number}`)
    .join('|');
  return `${ids}#${moves}`;
}

/** A cell board from an iterable, for the `extra` dependency widening. */
export function boardOfCells(grid: Grid, cells: Iterable<CellIndex>): Board {
  const board = newBoard(grid);
  for (const cell of cells) bbSet(board, cell);
  return board;
}
