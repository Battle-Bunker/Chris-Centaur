/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/exact.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// EXACT MODE — branch-and-resolve (cand-j, harvested) — and the joint-move
// matrix exposure (deliberation delta §6).
//
// The dilated claim (cloud.ts) is an abstraction; ITS ground truth is this
// file: fork the real resolution over a held unit's enumerated option list
// and join the outcomes. Exact, and immune to rule churn, because there is no
// second encoding of the rules to desynchronize — every branch runs the same
// `PartialEngine.resolve` the optimistic timeline runs, and every option list
// comes from the ONE free-function enumerator (grammar.ts enumerateActions).
//
// Three roles in the integrated design:
//   · the CI ORACLE the dilated claims are property-tested against;
//   · the FRONTIER TOOL for lazy determinization exactly where a decision
//     depends on the hidden variable (never globally — the ISMCTS lesson);
//   · the WITNESS-WORLD EXECUTOR for determinate ledger contacts (a
//     determinate contact may be resolved by running the concrete resolver on
//     one witness world, because determinacy means every world agrees).
//
// Cost is exponential in the frozen units that GENUINELY interact; relevance
// closure (provably lossless component decomposition) and the BUDGET REFUSAL
// contain it. Exactness is never traded for budget: past the budget the
// answer is a refusal naming the entangled units nearest first — the
// searcher's cue for what to go simulate.
//
// CONTAINMENT AUDITS (cand-j §4.3) run inside every branch: the action a
// frozen unit takes must be a member of its own enumeration (grammar
// containment), every cell it occupied must lie in startCells ∪ pathCells
// (displacement axiom), and its end-of-turn occupancy must lie inside the
// claim layer's cloud (T1 — the audit that welds exact mode to the claims as
// their oracle). A violation THROWS naming the unit: a rule change that
// breaks the possibility model fails while someone is looking at it.

import type { Board } from "./bitgrid.js";
import { bbSet, bbTest, newBoard } from "./bitgrid.js";
import type { ScoreBounds, UnitValueBounds } from "./bounds.js";
import { scopedTeamValueBounds, scoreBounds } from "./bounds.js";
import type { Resolution, StateHandle, UnitSpec, UnitView } from "./engine.js";
import { Fate, NO_ORDER, type PartialEngine } from "./engine.js";
import type { Candidate, UnitAction } from "./grammar.js";
import {
  defaultPath,
  enumerateActions,
  pawnTargetsInto,
  planAction,
  profileOf,
} from "./grammar.js";

// ---------------------------------------------------------------------------
// Matrix exposure — engine non-goals made structural (delta §6)
// ---------------------------------------------------------------------------

/**
 * Evolve one COMPLETE joint assignment: every live unit must be given a
 * disposition (a staged destination, or NO_ORDER for the kind's own default —
 * a rule of the game, not an assumption). A PARTIAL assignment is REFUSED:
 * serializing a simultaneous node is unsound, and defaulting a missing entry
 * silently would be the single-world bias this subsystem exists to remove.
 *
 * The engine NEVER takes a max or a min over the matrix. Reductions
 * (security value / paranoid / maxⁿ / best-reply) are consumer policy; what
 * the engine exposes is `evolveJoint`, `candidatesOf`, `teamOf` and the
 * vector-valued `teamScore`. (Best-Reply Search's "pass" is exactly a hold
 * here — sound by construction.)
 */
export function evolveJoint(
  engine: PartialEngine,
  state: StateHandle,
  assignment: ReadonlyMap<number, number>,
): Resolution {
  const live = engine.liveSlots(state);
  const orders = new Array<number>(engine.config.maxUnits).fill(NO_ORDER);
  for (const slot of live) {
    const view = engine.unitAt(state, slot);
    if (view === null) continue;
    if (!assignment.has(view.unitId)) {
      throw new Error(
        `evolveJoint refuses a partial assignment: live unit ${view.unitId} has no disposition (pass NO_ORDER explicitly for the kind's own default)`,
      );
    }
    orders[slot] = assignment.get(view.unitId) as number;
  }
  const fork = engine.fork(state);
  return engine.resolve(fork, orders);
}

/** The team a unit belongs to, or null. Frozen units answer too. */
export function teamOf(engine: PartialEngine, state: StateHandle, unitId: number): number | null {
  const slot = engine.slotOfUnit(state, unitId);
  if (slot >= 0) return engine.unitAt(state, slot)?.team ?? null;
  const frozen = state.field.slotOf(unitId);
  return frozen?.record.team ?? null;
}

/**
 * The vector-valued team score: aggregate weight per team, LIVE units only —
 * frozen units' weights are intervals, and mixing an interval into a scalar
 * vector would launder uncertainty into a fact. The bounds layer
 * (bounds.ts teamValueBounds) is where frozen material is priced.
 */
export function teamScore(engine: PartialEngine, state: StateHandle): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  for (const u of engine.units(state)) {
    out.set(u.team, (out.get(u.team) ?? 0) + u.weight);
  }
  return out;
}

/**
 * The ONE enumerator, applied to a live unit of the state: serves subject
 * branching, enemy branching and narrowing alike (delta D2). Pawn attack
 * legality reads the turn-start board — cells holding food or any unit.
 */
export function candidatesOf(engine: PartialEngine, state: StateHandle, slot: number): Candidate[] {
  const view = engine.unitAt(state, slot);
  if (view === null) throw new Error(`slot ${slot} holds no unit`);
  return enumerateActions(
    engine.terrain,
    view.kind,
    view.cells[0] as number,
    view.orientation,
    targetsBoard(engine, state),
  );
}

function targetsBoard(engine: PartialEngine, state: StateHandle): Board {
  // THE canonical construction (grammar.ts): food ∪ every unit's turn-start
  // occupancy. In exact mode every frozen unit's record cells ARE its
  // turn-start occupancy — the branch worlds put it back on the board there.
  const food = newBoard(engine.grid);
  engine.foodBoard(state, food);
  return pawnTargetsInto(engine.grid, newBoard(engine.grid), food, [
    ...engine.units(state).map((u) => u.cells),
    ...state.field.slots.map((s) => s.record.occupancy),
  ]);
}

/**
 * RESOLVE WITH PER-CONSUMER POLARITY — the convergent double-discovery (Bot A
 * `resolveBounded(staged, asTeam)`; Bot B's pessimism scope): two independent
 * builders hit the same silent floor-breaking bug without it. One resolution,
 * one ledger, one set of per-unit fates — and the interval fold applied IN
 * THE DECLARED SUBJECT'S FRAME: the subject's own contingent units price at
 * the cliff in `worst`, an opponent's contingent units price ALIVE at their
 * weight ceiling (the subject's worst world is the one where the enemy
 * thrives). Frozen units count for their teams at their claim intervals; a
 * trail unit's sever-only exposure rides the partial-loss coordinate.
 *
 * Returns the subject-frame ScoreBounds (own minus everyone else) with the
 * field's assumptions as its basis, plus the per-team scoped intervals.
 *
 * HELD SURVIVAL IS READ FROM BOTH HALVES OF THE BOARD (the R1 harness's
 * finding). `cloud.deathPossible` is a fact about the claim's own side only —
 * a cloud is branch-independent by design, so it cannot know that a unit
 * somebody IS modelling walked through a cell the held unit might occupy.
 * Reading it alone prices such a unit certainly-alive, which forbids the very
 * world the subject's CEILING is supposed to include, and a real resolution
 * then scores above the upper bound. `Resolution.mayHaveDied` supplies the
 * missing half and is folded in here, frame-neutrally: contests are team-blind,
 * so the subject's own held units blunder into the subject's own movers too,
 * and the same widening that raises an enemy-side ceiling lowers an own-side
 * floor. Both are the sound direction.
 */
export function resolveBounded(
  engine: PartialEngine,
  state: StateHandle,
  assignment: ReadonlyMap<number, number>,
  subjectTeam: number,
): {
  readonly resolution: Resolution;
  readonly perTeam: ReadonlyMap<number, { worst: number; best: number }>;
  readonly bounds: ScoreBounds;
} {
  const resolution = evolveJoint(engine, state, assignment);
  // `new Map(fates.map(f => [f.unitId, f.fate]))` reads well and builds a
  // two-element array per unit plus the array holding them, all of it dead the
  // moment the Map exists. This runs once per world a search prices.
  const fateById = new Map<number, Fate>();
  for (const f of resolution.fates) fateById.set(f.unitId, f.fate);
  const units: UnitValueBounds[] = [];
  for (const v of engine.units(resolution.state)) {
    const fate = fateById.get(v.unitId);
    units.push({
      unitId: v.unitId,
      team: v.team,
      survival: fate === Fate.Dead ? "no" : fate === Fate.Contingent ? "maybe" : "yes",
      weightMin: v.weight,
      weightMax: v.weight,
      partialLossMax: 0,
    });
  }
  for (const slot of resolution.state.field.slots) {
    const cloud = slot.cloud;
    const reachedByAMover = (resolution.mayHaveDied & (1 << slot.slot)) !== 0;
    units.push({
      unitId: slot.record.unitId,
      team: slot.record.team,
      survival: cloud.certainlyGone
        ? "no"
        : cloud.deathPossible || reachedByAMover
          ? "maybe"
          : "yes",
      weightMin: slot.bounds.weightMin,
      weightMax: slot.bounds.weightMax,
      partialLossMax: Math.max(0, slot.record.weight - slot.bounds.weightMin),
    });
  }
  // Likewise: the intermediate array of team numbers exists only to be
  // consumed by the Set. Insertion order — which is what fixes the order the
  // per-team frames are summed in, and so the last bit of the result — is
  // first-occurrence order in `units` either way.
  const teams = new Set<number>();
  for (const u of units) teams.add(u.team);
  const perTeam = new Map<number, { worst: number; best: number }>();
  for (const team of teams) {
    perTeam.set(team, scopedTeamValueBounds(units, team, subjectTeam));
  }
  const own = perTeam.get(subjectTeam) ?? { worst: 0, best: 0 };
  let othersWorstFrame = 0;
  let othersBestFrame = 0;
  for (const [team, v] of perTeam) {
    if (team === subjectTeam) continue;
    othersWorstFrame += v.worst; // enemy at its best — the subject's worst world
    othersBestFrame += v.best; // enemy at its worst — the subject's best world
  }
  const worst = own.worst - othersWorstFrame;
  const best = own.best - othersBestFrame;
  return {
    resolution,
    perTeam,
    bounds: scoreBounds(worst, best, { cloud: best - worst }, resolution.state.field.assumptions()),
  };
}

// ---------------------------------------------------------------------------
// Exact projection
// ---------------------------------------------------------------------------

export interface Presence {
  /** Branches in which the unit comes to REST on the cell. */
  readonly endBranches: number;
  /** Branches in which it occupies the cell at any point (rays kill in passing). */
  readonly touchBranches: number;
}

export interface UnitJoin {
  readonly unitId: number;
  readonly branches: number;
  readonly aliveIn: number;
  /** cell → presence counts. */
  readonly presence: ReadonlyMap<number, Presence>;
  /** Deduplicated whole post-turn states, for feed-forward. */
  readonly states: ReadonlyArray<UnitView>;
}

export interface ExactProjection {
  readonly ok: true;
  readonly branches: number;
  /** Independent relevance components, by the frozen unit ids each contains. */
  readonly components: ReadonlyArray<ReadonlyArray<number>>;
  readonly units: ReadonlyMap<number, UnitJoin>;
  /**
   * CAUSAL entanglement, read off the branch outcomes rather than geometry:
   * live unit u is entangled with frozen f when two branches agreeing on
   * every question but f's differ on u's outcome.
   */
  readonly entangled: ReadonlyMap<number, ReadonlyArray<number>>;
}

export interface BudgetRefusal {
  readonly ok: false;
  readonly kind: "entanglement_budget";
  /** Frozen units to go simulate, NEAREST FIRST. */
  readonly entangled: ReadonlyArray<number>;
  readonly needed: number;
  readonly budget: number;
}

export type ExactResult = ExactProjection | BudgetRefusal;

export interface ExactOptions {
  readonly budget?: number;
  readonly audit?: boolean;
}

/**
 * Project one turn EXACTLY: the live units take `liveOrders` (by unit id;
 * NO_ORDER for defaults), every frozen unit's action ranges over its own
 * enumeration, and the result is the join of one real resolution per
 * combination. Frozen units whose reach cannot intersect the modelled core
 * are projected in their own components independently (a product turned into
 * a sum — provably lossless: units in different components cannot touch the
 * same cell this turn).
 */
export function projectExact(
  engine: PartialEngine,
  state: StateHandle,
  liveOrders: ReadonlyMap<number, number>,
  options: ExactOptions = {},
): ExactResult {
  const budget = options.budget ?? 4096;
  const audit = options.audit ?? true;
  const live = engine
    .liveSlots(state)
    .map((slot) => engine.unitAt(state, slot))
    .filter((v): v is UnitView => v?.alive === true);
  const frozen = state.field.slots.map((s) => s.record);
  const targets = targetsBoard(engine, state);

  // ---- Enumerate every frozen unit's options through the ONE grammar ----
  const optionsByUnit = new Map<number, Candidate[]>();
  for (const record of frozen) {
    optionsByUnit.set(
      record.unitId,
      enumerateActions(
        engine.terrain,
        record.kind,
        record.occupancy[0] as number,
        record.orientation,
        targets,
      ),
    );
  }

  // ---- Relevance closure: reach-intersection components ----
  const reachOf = new Map<number, Board>();
  const unitCells = new Map<number, ReadonlyArray<number>>();
  const allUnits: Array<{ id: number; frozen: boolean }> = [];
  for (const v of live) {
    const b = newBoard(engine.grid);
    for (const c of v.cells) bbSet(b, c);
    const order = liveOrders.get(v.unitId) ?? NO_ORDER;
    // The live unit's reach is its occupancy plus its own staged path.
    const acts = enumerateActions(
      engine.terrain,
      v.kind,
      v.cells[0] as number,
      v.orientation,
      targets,
    );
    for (const a of acts) {
      if (a.action.kind !== "move") continue;
      if (order !== NO_ORDER && a.dest !== order) continue;
      for (const c of a.action.path) bbSet(b, c);
    }
    reachOf.set(v.unitId, b);
    unitCells.set(v.unitId, v.cells);
    allUnits.push({ id: v.unitId, frozen: false });
  }
  for (const record of frozen) {
    const b = newBoard(engine.grid);
    for (const c of record.occupancy) bbSet(b, c);
    for (const a of optionsByUnit.get(record.unitId) ?? []) {
      if (a.action.kind !== "move") continue;
      for (const c of a.action.path) bbSet(b, c);
    }
    reachOf.set(record.unitId, b);
    unitCells.set(record.unitId, record.occupancy);
    allUnits.push({ id: record.unitId, frozen: true });
  }
  const components = componentsOf(engine, allUnits, reachOf);

  // Components carrying a live unit branch JOINTLY over their frozen members;
  // components of only-frozen units are independent. Every component still
  // resolves over the FULL board (the decomposition claim is about who can
  // interact, not about who exists), holding the other components' frozen
  // units at... nothing: they are resolved through their own components. To
  // keep every branch a REAL whole-board resolution, the out-of-component
  // frozen units take their least-committal enumerated option per branch —
  // which cannot matter, because their reach does not intersect this
  // component (audited below).
  const coreComponents = components.filter((c) => c.some((u) => !u.frozen));
  const frozenOnly = components.filter((c) => c.every((u) => u.frozen));

  // Budget: the joint product over each component's frozen members, summed.
  const componentCost = (comp: ReadonlyArray<{ id: number; frozen: boolean }>): number => {
    let n = 1;
    for (const u of comp) {
      if (!u.frozen) continue;
      n *= Math.max(1, (optionsByUnit.get(u.id) ?? []).length);
    }
    return n;
  };
  let needed = 0;
  for (const comp of [...coreComponents, ...frozenOnly]) needed += componentCost(comp);
  if (needed > budget) {
    return {
      ok: false,
      kind: "entanglement_budget",
      entangled: nearestFirst(engine, live, frozen),
      needed,
      budget,
    };
  }

  // ---- Fork and resolve every combination, component by component ----
  const joins = new Map<number, MutableJoin>();
  const ensureJoin = (id: number): MutableJoin => {
    let j = joins.get(id);
    if (j === undefined) {
      j = { unitId: id, branches: 0, aliveIn: 0, presence: new Map(), states: new Map() };
      joins.set(id, j);
    }
    return j;
  };
  // decision vectors per live unit for causal entanglement
  const outcomes: Array<{ decisions: Map<number, number>; ends: Map<number, string> }> = [];

  const runComponent = (comp: ReadonlyArray<{ id: number; frozen: boolean }>): void => {
    const compFrozenIds = comp.filter((u) => u.frozen).map((u) => u.id);
    const inComp = new Set(comp.map((u) => u.id));
    const lists = compFrozenIds.map((id) => optionsByUnit.get(id) ?? []);
    const picks = new Array<number>(compFrozenIds.length).fill(0);
    const iterate = (): boolean => {
      for (let i = picks.length - 1; i >= 0; i--) {
        const next = (picks[i] as number) + 1;
        if (next < (lists[i] as Candidate[]).length) {
          picks[i] = next;
          for (let j = i + 1; j < picks.length; j++) picks[j] = 0;
          return true;
        }
      }
      return false;
    };
    do {
      // Build one concrete world: all live + ALL frozen units live again.
      const specs: UnitSpec[] = [];
      const orderByUnit = new Map<number, number>();
      for (const v of live) {
        specs.push({
          unitId: v.unitId,
          kind: v.kind,
          team: v.team,
          cells: v.cells,
          health: v.health,
          tier: v.tier,
          weight: v.weight,
          orientation: v.orientation,
        });
        orderByUnit.set(v.unitId, liveOrders.get(v.unitId) ?? NO_ORDER);
      }
      for (const record of frozen) {
        specs.push({
          unitId: record.unitId,
          kind: record.kind,
          team: record.team,
          cells: record.occupancy,
          health: record.health,
          tier: record.tier,
          tierExpiresAtTurn: record.tierExpiresAtTurn ?? null,
          weight: record.weight,
          orientation: record.orientation,
        });
        if (inComp.has(record.unitId)) {
          const idx = compFrozenIds.indexOf(record.unitId);
          const pick = (lists[idx] as Candidate[])[picks[idx] as number] as Candidate;
          orderByUnit.set(record.unitId, pick.dest);
        } else {
          // Out-of-component frozen units hold their kind's default — their
          // reach cannot touch this component, so the pick cannot matter.
          orderByUnit.set(record.unitId, NO_ORDER);
        }
      }
      const food: number[] = [];
      const potions: number[] = [];
      const foodB = newBoard(engine.grid);
      const potB = newBoard(engine.grid);
      engine.foodBoard(state, foodB);
      engine.potionBoard(state, potB);
      for (let c = 0; c < engine.grid.cells; c++) {
        if (bbTest(foodB, c)) food.push(c);
        if (bbTest(potB, c)) potions.push(c);
      }
      const world = engine.create(specs, food, potions, state.turn);
      const orders = new Array<number>(engine.config.maxUnits).fill(NO_ORDER);
      specs.forEach((spec, i) => {
        orders[i] = orderByUnit.get(spec.unitId) ?? NO_ORDER;
      });
      const resolution = engine.resolve(world, orders);

      // ---- Audits ----
      if (audit) {
        auditBranch(engine, resolution, specs, orderByUnit, optionsByUnit, state, inComp, targets);
      }

      // ---- Join ----
      const decisions = new Map<number, number>();
      compFrozenIds.forEach((id, i) => decisions.set(id, picks[i] as number));
      const ends = new Map<number, string>();
      for (let slot = 0; slot < specs.length; slot++) {
        const before = specs[slot] as UnitSpec;
        if (!inComp.has(before.unitId)) continue;
        const after = engine.unitAt(resolution.state, slot);
        const j = ensureJoin(before.unitId);
        j.branches++;
        if (after?.alive) {
          j.aliveIn++;
          for (const c of after.cells) bump(j.presence, c, false);
          bump(j.presence, after.cells[0] as number, true);
          const key = stateKey(after);
          if (!j.states.has(key)) j.states.set(key, after);
          ends.set(before.unitId, key);
        } else {
          ends.set(before.unitId, "dead");
        }
      }
      outcomes.push({ decisions, ends });
      engine.release(resolution.state);
    } while (iterate());
  };

  for (const comp of [...coreComponents, ...frozenOnly]) runComponent(comp);

  // ---- Causal entanglement from decision vectors (cand-j §7) ----
  const entangled = new Map<number, number[]>();
  for (const a of outcomes) {
    for (const b of outcomes) {
      const differing: number[] = [];
      for (const [fid, pick] of a.decisions) {
        if (b.decisions.get(fid) !== pick) differing.push(fid);
      }
      if (differing.length !== 1) continue;
      const f = differing[0] as number;
      for (const [uid, end] of a.ends) {
        if (uid === f) continue;
        if (b.ends.has(uid) && b.ends.get(uid) !== end) {
          const list = entangled.get(uid) ?? [];
          if (!list.includes(f)) list.push(f);
          entangled.set(uid, list);
        }
      }
    }
  }
  for (const list of entangled.values()) list.sort((a, b) => a - b);

  const units = new Map<number, UnitJoin>();
  for (const [id, j] of joins) {
    units.set(id, {
      unitId: id,
      branches: j.branches,
      aliveIn: j.aliveIn,
      presence: j.presence,
      states: [...j.states.values()],
    });
  }
  return {
    ok: true,
    branches: outcomes.length,
    components: components.map((c) => c.map((u) => u.id).sort((a, b) => a - b)),
    units,
    entangled,
  };
}

/** One concrete world, resolved by the real rules — the witness executor. */
export function resolveWitness(
  engine: PartialEngine,
  state: StateHandle,
  assignment: ReadonlyMap<number, number>,
): Resolution {
  const live = engine
    .liveSlots(state)
    .map((slot) => engine.unitAt(state, slot))
    .filter((v): v is UnitView => v !== null);
  const specs: UnitSpec[] = [];
  const orderByUnit = new Map<number, number>();
  for (const v of live) {
    specs.push({ ...v });
    orderByUnit.set(v.unitId, assignment.get(v.unitId) ?? NO_ORDER);
  }
  for (const s of state.field.slots) {
    const r = s.record;
    specs.push({
      unitId: r.unitId,
      kind: r.kind,
      team: r.team,
      cells: r.occupancy,
      health: r.health,
      tier: r.tier,
      tierExpiresAtTurn: r.tierExpiresAtTurn ?? null,
      weight: r.weight,
      orientation: r.orientation,
    });
    if (!assignment.has(r.unitId)) {
      throw new Error(
        `a witness world needs a disposition for every frozen unit; unit ${r.unitId} has none`,
      );
    }
    orderByUnit.set(r.unitId, assignment.get(r.unitId) as number);
  }
  const foodB = newBoard(engine.grid);
  const potB = newBoard(engine.grid);
  engine.foodBoard(state, foodB);
  engine.potionBoard(state, potB);
  const food: number[] = [];
  const potions: number[] = [];
  for (let c = 0; c < engine.grid.cells; c++) {
    if (bbTest(foodB, c)) food.push(c);
    if (bbTest(potB, c)) potions.push(c);
  }
  const world = engine.create(specs, food, potions, state.turn);
  const orders = new Array<number>(engine.config.maxUnits).fill(NO_ORDER);
  specs.forEach((spec, i) => {
    orders[i] = orderByUnit.get(spec.unitId) ?? NO_ORDER;
  });
  return engine.resolve(world, orders);
}

// ---------------------------------------------------------------------------

interface MutableJoin {
  unitId: number;
  branches: number;
  aliveIn: number;
  presence: Map<number, { endBranches: number; touchBranches: number }>;
  states: Map<string, UnitView>;
}

function bump(
  presence: Map<number, { endBranches: number; touchBranches: number }>,
  cell: number,
  end: boolean,
): void {
  let p = presence.get(cell);
  if (p === undefined) {
    p = { endBranches: 0, touchBranches: 0 };
    presence.set(cell, p);
  }
  if (end) p.endBranches++;
  else p.touchBranches++;
}

function stateKey(v: UnitView): string {
  // The WHOLE state, not a hand-listed subset: a field added to UnitView
  // reaches the dedupe automatically (cand-j's C12 defence).
  return JSON.stringify(v);
}

function componentsOf(
  engine: PartialEngine,
  units: ReadonlyArray<{ id: number; frozen: boolean }>,
  reachOf: ReadonlyMap<number, Board>,
): Array<Array<{ id: number; frozen: boolean }>> {
  const n = units.length;
  const parent = new Array<number>(n).fill(0).map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    parent[i] = r;
    return r;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const w = engine.grid.words;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = reachOf.get((units[i] as { id: number }).id) as Board;
      const b = reachOf.get((units[j] as { id: number }).id) as Board;
      let hit = false;
      for (let k = 0; k < w; k++) {
        if (((a[k] as number) & (b[k] as number)) !== 0) {
          hit = true;
          break;
        }
      }
      if (hit) unite(i, j);
    }
  }
  const byRoot = new Map<number, Array<{ id: number; frozen: boolean }>>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = byRoot.get(r);
    if (g === undefined) byRoot.set(r, [units[i] as { id: number; frozen: boolean }]);
    else g.push(units[i] as { id: number; frozen: boolean });
  }
  return [...byRoot.values()];
}

function nearestFirst(
  engine: PartialEngine,
  live: ReadonlyArray<UnitView>,
  frozen: ReadonlyArray<{ unitId: number; occupancy: ReadonlyArray<number> }>,
): number[] {
  const width = engine.grid.width;
  const dist = (a: number, b: number): number =>
    Math.max(Math.abs((a % width) - (b % width)), Math.abs(((a / width) | 0) - ((b / width) | 0)));
  const scored = frozen.map((f) => {
    let best = Number.POSITIVE_INFINITY;
    for (const v of live) {
      for (const c of v.cells) {
        for (const fc of f.occupancy) best = Math.min(best, dist(c, fc));
      }
    }
    return { id: f.unitId, best };
  });
  scored.sort((a, b) => a.best - b.best || a.id - b.id);
  return scored.map((s) => s.id);
}

function planActionOf(
  engine: PartialEngine,
  spec: UnitSpec,
  origin: number,
  dest: number,
  targets: Board,
): UnitAction | null {
  return planAction(engine.terrain, spec.kind, origin, dest, spec.orientation ?? 0, targets);
}

function defaultPathOf(
  engine: PartialEngine,
  spec: UnitSpec,
  origin: number,
  out: number[],
): number {
  return defaultPath(engine.terrain, spec.kind, origin, spec.orientation ?? 0, out);
}

/** The in-branch audits: loud, named, and welded to the claim layer. */
function auditBranch(
  engine: PartialEngine,
  resolution: Resolution,
  specs: ReadonlyArray<UnitSpec>,
  orderByUnit: ReadonlyMap<number, number>,
  optionsByUnit: ReadonlyMap<number, Candidate[]>,
  claimState: StateHandle,
  inComp: ReadonlySet<number>,
  targets: Board,
): void {
  for (let slot = 0; slot < specs.length; slot++) {
    const before = specs[slot] as UnitSpec;
    const after = engine.unitAt(resolution.state, slot);
    if (after === null) continue;
    const options = optionsByUnit.get(before.unitId);
    // GRAMMAR CONTAINMENT: the enumerated option the branch staged must be a
    // member of the unit's own enumeration.
    const staged = orderByUnit.get(before.unitId);
    if (
      options !== undefined &&
      staged !== undefined &&
      staged !== NO_ORDER &&
      !options.some((o) => o.dest === staged)
    ) {
      throw new Error(
        `containment audit: frozen unit ${before.unitId} (kind ${profileOf(before.kind).name}) was staged ${staged}, which its own grammar does not enumerate — either enumerateActions narrowed wrongly, or the intent came from outside the universe`,
      );
    }
    // DISPLACEMENT AXIOM: every cell occupied after the turn lies in the
    // unit's own start cells or on its own action's path — every placement in
    // the rules today (advance, capture-stop, edge squash-back, exhaustion
    // halt, death in place, sever truncation) is one of those two. The path
    // is read through the SAME grammar interpretation the mover plans with.
    const allowed = new Set<number>(before.cells);
    {
      const origin = before.cells[0] as number;
      const act =
        staged === undefined || staged === NO_ORDER
          ? null
          : planActionOf(engine, before, origin, staged, targets);
      if (act !== null && act.kind === "move") {
        for (const c of act.path) allowed.add(c);
      } else if (act === null || act.kind === "stay") {
        // Nothing legal staged: the kind's default (a trail unit's momentum
        // step; a piece's stay).
        const scratch: number[] = [];
        const n = defaultPathOf(engine, before, origin, scratch);
        for (let i = 0; i < n; i++) allowed.add(scratch[i] as number);
      }
    }
    for (const c of after.cells) {
      if (!allowed.has(c)) {
        throw new Error(
          `displacement audit: unit ${before.unitId} occupies cell ${c}, which is neither a start cell nor on its own action's path — a non-path displacement rule has been added without extending exact mode`,
        );
      }
    }
    // T1 vs THE CLAIM LAYER: a frozen unit's true post-turn occupancy must
    // lie inside the cloud the claim layer stands for it — exact mode is the
    // claims' oracle, and this is the weld.
    const claimSlot = claimState.field.slotOf(before.unitId);
    if (claimSlot !== undefined && after.alive && inComp.has(before.unitId)) {
      const cloud = claimSlot.timeline.at(claimState.turn + 1 - claimSlot.record.heldAtTurn);
      for (const c of after.cells) {
        if (!bbTest(cloud.possible, c)) {
          throw new Error(
            `claim containment audit: frozen unit ${before.unitId} really reaches cell ${c}, which its own cloud denies — the dilation under-approximates (THE unsound direction)`,
          );
        }
      }
    }
  }
}
