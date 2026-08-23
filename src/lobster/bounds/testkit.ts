/**
 * MINIMAL FAITHFUL STUBS for the three components B1 owns — Substrate,
 * CandidateGenerator, Evaluator — plus the ground truth the soundness harness
 * measures against.
 *
 * "Faithful" is doing real work here. These are not fakes: every one of them
 * runs the REAL possibility-cloud engine from `../../partial-engine/index`,
 * builds its boards through the REAL wire adapter (never a hand-rolled
 * `UnitSpec` — the weight-stack encoding is exactly the thing a hand-rolled
 * one drops), and names every live unit on every resolve, because
 * `resolveBounded` refuses a partial assignment by design.
 *
 * A property that only ever passes against a fake is a property about the
 * fake. So the ground truth here is computed by the same resolver the bounds
 * are computed by, with nothing held — a second ENCODING of the rules would
 * prove nothing about either.
 *
 * When B1's real components land, these stay: two implementations of one
 * interface is the cheapest differential test there is.
 */

import type {
  Bound,
  BoundedResolution,
  Candidate,
  CandidateGenerator,
  CandidateSet,
  CellIndex,
  Evaluator,
  JointPlan,
  PlanEvaluation,
  Substrate,
  SubStep,
  UnitId,
} from "../contracts";
import type { UnitType } from "@shared/types/Game";
import type { Orientation } from "../../engine-vendor/engine/moveGrammar";
import {
  NO_ORDER,
  PartialEngine,
  bbSet,
  bbTest,
  enumerateActions,
  makeGrid,
  makeTerrain,
  newBoard,
  pawnTargetsInto,
  resolveBounded,
  scopedTeamValueBounds,
} from "../../partial-engine/index";
import type {
  Board,
  Resolution,
  StateHandle,
  Terrain,
  UnitSpec,
  UnitValueBounds,
} from "../../partial-engine/index";
import { toUnitSpecs, type WireUnit } from "../../partial-engine/wire-adapter";
import { planKey } from "./plan";
import type { ModellingSubstrate, RosterSubstrate } from "./substrate-ext";

// ------------------------------------------------------------------- boards

export interface TestUnitSpec {
  readonly id: number;
  readonly team: number;
  readonly type: UnitType;
  /** Head first; a piece's weight is that many copies of one cell (the wire's
   *  own encoding — the adapter is what collapses it). */
  readonly occupancy: ReadonlyArray<number>;
  readonly health?: number;
  readonly tier?: number;
  readonly orientation?: Orientation;
}

export interface BoardSpec {
  readonly width: number;
  readonly height: number;
  readonly units: ReadonlyArray<TestUnitSpec>;
  readonly food?: ReadonlyArray<number>;
  readonly turn?: number;
}

export interface TestBoard {
  readonly engine: PartialEngine;
  readonly terrain: Terrain;
  readonly spec: BoardSpec;
  readonly specs: ReadonlyArray<UnitSpec>;
  /** The master state: NOTHING held. Every view forks from it. */
  readonly master: StateHandle;
  readonly food: Board;
}

const wireOf = (u: TestUnitSpec): WireUnit => ({
  id: `u${u.id}`,
  type: u.type,
  teamID: `t${u.team}`,
  occupancy: [...u.occupancy],
  health: u.health ?? 60,
  tier: u.tier ?? 0,
  orientation: u.orientation,
});

/**
 * Two units sharing a cell at turn start is not a board the rules can produce,
 * and the engine's `create` does not check it. It is worth checking HERE
 * because a bound measured on an impossible board is a statement about
 * nothing: the additive per-enemy lemma was observed to fail outright on one
 * (a floor above the exhaustive truth), which looks exactly like a soundness
 * bug in the bank until you look at the board.
 */
function assertDisjoint(spec: BoardSpec): void {
  const owner = new Map<number, number>();
  for (const unit of spec.units) {
    // A piece's weight IS its cell repeated, so only cells shared between
    // DIFFERENT units are impossible.
    for (const cell of new Set(unit.occupancy)) {
      const held = owner.get(cell);
      if (held !== undefined) {
        throw new Error(
          `testkit: units ${held} and ${unit.id} both occupy cell ${cell} at turn start — ` +
            'not a reachable board, so nothing measured on it means anything',
        );
      }
      owner.set(cell, unit.id);
    }
  }
}

export function makeTestBoard(spec: BoardSpec): TestBoard {
  assertDisjoint(spec);
  const grid = makeGrid(spec.width, spec.height);
  const terrain = makeTerrain(grid, [], []);
  const food = newBoard(grid);
  for (const cell of spec.food ?? []) bbSet(food, cell);
  const engine = new PartialEngine(terrain, { food, potions: newBoard(grid) }, { maxUnits: 12 });
  // THE ADAPTER, not a literal: it is the one place that knows a piece's
  // weight arrives as repeated cells and a trail unit's does not.
  const specs = toUnitSpecs(spec.units.map(wireOf), (_u, i) => ({
    unitId: (spec.units[i] as TestUnitSpec).id,
    team: (spec.units[i] as TestUnitSpec).team,
  }));
  const master = engine.create(specs, spec.food ?? [], [], spec.turn ?? 0);
  return { engine, terrain, spec, specs, master, food };
}

export const at = (spec: BoardSpec, x: number, y: number): number => y * spec.width + x;

// --------------------------------------------------------------- substrate

/**
 * The unified contract's `resolveBoundedFor` returns the whole bounded triple,
 * so `boundedFor` is now only the harness's own convenience face over it (it
 * carries the scalar-vs-interval pricing arm the negative controls need).
 *
 * SLAB NOTE. This stub releases every resolution slab as soon as the fold is
 * computed and caches the result as plain data — the arrays its consumers
 * (bank, search, ground truth) read survive release. It is therefore paired
 * with the STUB evaluator only: the real BoundEvaluator reads live unit views
 * off a resolution's slab and belongs on the real EngineSubstrate.
 */
export interface BoundedSubstrate extends Substrate {
  boundedFor(
    plan: JointPlan,
    asTeam: number,
  ): { resolution: Resolution; worst: number; best: number };
  /** Held-unit pricing mode, so the harness can measure the interval law. */
  readonly heldPricing: "interval" | "scalar";
  /** Real engine resolutions this substrate and its children have spent. */
  readonly resolves: number;
}

export type HeldPricing = "interval" | "scalar";

interface CachedResolve {
  readonly full: BoundedResolution;
  /** Per the heldPricing arm — the scalar negative control lives HERE, in the
   * harness's own face, never in the contract-shaped triple. */
  readonly worst: number;
  readonly best: number;
}

class TestSubstrate implements BoundedSubstrate, ModellingSubstrate, RosterSubstrate {
  readonly state: StateHandle;
  /** Shared with every modelled child, so the count is per DECISION. */
  private readonly meter: { resolves: number };
  private readonly cache = new Map<string, CachedResolve>();
  private readonly children: Substrate[] = [];
  private released = false;

  constructor(
    private readonly board: TestBoard,
    /** Units this decision commands — never held. */
    private readonly commanded: ReadonlySet<UnitId>,
    /** Uncontrolled units to keep LIVE (modelled) rather than held. */
    modelled: ReadonlyArray<UnitId>,
    readonly heldPricing: HeldPricing,
    /** Extra staleness for held units, in turns. */
    private readonly staleness: number,
    meter?: { resolves: number },
  ) {
    this.meter = meter ?? { resolves: 0 };
    const engine = board.engine;
    let state = engine.fork(board.master);
    const keepLive = new Set<UnitId>([...commanded, ...modelled]);
    const holdSlots: number[] = [];
    for (const slot of engine.liveSlots(state)) {
      const view = engine.unitAt(state, slot);
      if (view === null) continue;
      if (keepLive.has(view.unitId)) continue;
      holdSlots.push(slot);
    }
    if (holdSlots.length > 0) {
      state = engine.holdMany(state, holdSlots, state.turn - this.staleness);
    }
    this.state = state;
  }

  /** Every live unit named, exactly once — silence is an error, not a default. */
  private assignmentOf(plan: JointPlan): ReadonlyMap<number, number> {
    const orders = new Map<number, number>();
    for (const slot of this.board.engine.liveSlots(this.state)) {
      const view = this.board.engine.unitAt(this.state, slot);
      if (view === null) continue;
      const chosen = plan.get(view.unitId);
      orders.set(view.unitId, chosen === undefined ? NO_ORDER : chosen.to);
    }
    return orders;
  }

  private resolveInto(plan: JointPlan, asTeam: number): CachedResolve {
    const key = `${asTeam}#${planKey(plan)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.meter.resolves++;
    const engine = this.board.engine;
    const out = resolveBounded(engine, this.state, this.assignmentOf(plan), asTeam);
    const grid = this.board.terrain.grid;
    const touched = newBoard(grid);
    touched.set(engine.touched.subarray(0, grid.words));
    const scalar =
      this.heldPricing === "interval" ? null : scalarFold(engine, out.resolution, asTeam);
    // The forked slab has served its purpose; the arrays we keep reading
    // (ledger, clashes, deaths, the shared CloudField) are plain objects.
    engine.release(out.resolution.state);
    const value: CachedResolve = {
      full: { resolution: out.resolution, perTeam: out.perTeam, bounds: out.bounds, touched },
      worst: scalar === null ? out.bounds.worst : scalar.worst,
      best: scalar === null ? out.bounds.best : scalar.best,
    };
    this.cache.set(key, value);
    return value;
  }

  boundedFor(plan: JointPlan, asTeam: number): { resolution: Resolution; worst: number; best: number } {
    const v = this.resolveInto(plan, asTeam);
    return { resolution: v.full.resolution, worst: v.worst, best: v.best };
  }

  get resolves(): number {
    return this.meter.resolves;
  }

  /** The contract triple is always the engine's honest interval — the scalar
   * negative control is only ever visible through `boundedFor`. */
  resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolution {
    return this.resolveInto(plan, asTeam).full;
  }

  /** Slabs are returned at resolve time here (see the class note), so the
   * contract's release door has nothing left to do. Idempotent by contract. */
  releaseResolution(_resolution: Resolution): void {
    /* already returned at resolve time */
  }

  withResolution<T>(plan: JointPlan, asTeam: number, fn: (r: BoundedResolution) => T): T {
    return fn(this.resolveBoundedFor(plan, asTeam));
  }

  unitIds(): ReadonlyArray<UnitId> {
    return [...this.board.spec.units.map((u) => u.id)].sort((a, b) => a - b);
  }

  actionsOf(unitId: UnitId): ReadonlyArray<Candidate> {
    return this.optionsFor(unitId);
  }

  pathOf(unitId: UnitId, to: CellIndex): ReadonlyArray<CellIndex> | null {
    const match = this.optionsFor(unitId).find((c) => c.to === to);
    return match === undefined ? null : match.path;
  }

  outstanding(): number {
    // One live state per substrate; resolution slabs are returned eagerly.
    return this.released ? 0 : 1;
  }

  entangled(
    cells: ReadonlyArray<{ cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }>
  ): ReadonlyArray<UnitId> {
    const field = this.state.field.advanceTo(this.state.turn + 1);
    const out: UnitId[] = [];
    for (const slot of field.slots) {
      if (cells.some(({ cell }) => bbTest(slot.cloud.possible, cell))) out.push(slot.record.unitId);
    }
    return out;
  }

  influenceOf(unitId: UnitId): ReadonlySet<CellIndex> {
    const out = new Set<CellIndex>();
    const field = this.state.field.advanceTo(this.state.turn + 1);
    const frozen = field.slotOf(unitId);
    if (frozen !== undefined) {
      for (let cell = 0; cell < this.board.terrain.grid.cells; cell++) {
        if (bbTest(frozen.cloud.possible, cell)) out.add(cell);
      }
      return out;
    }
    for (const candidate of this.optionsFor(unitId)) {
      out.add(candidate.to);
      for (const cell of candidate.path) out.add(cell);
    }
    return out;
  }

  withModelled(modelled: ReadonlyArray<UnitId>): Substrate {
    const child = new TestSubstrate(
      this.board,
      this.commanded,
      modelled,
      this.heldPricing,
      this.staleness,
      this.meter,
    );
    this.children.push(child);
    return child;
  }

  commandable(asTeam: number): ReadonlyArray<UnitId> {
    return this.board.engine
      .units(this.state)
      .filter((u) => u.team === asTeam && this.commanded.has(u.unitId))
      .map((u) => u.unitId);
  }

  /** The complete legal option list for a LIVE unit, engine-enumerated. */
  optionsFor(unitId: UnitId): ReadonlyArray<Candidate> {
    const engine = this.board.engine;
    const slot = engine.slotOfUnit(this.state, unitId);
    if (slot < 0) return [];
    const view = engine.unitAt(this.state, slot);
    if (view === null) return [];
    const targets = targetsBoardOf(this.board, this.state);
    return enumerateActions(
      this.board.terrain,
      view.kind,
      view.cells[0] as number,
      view.orientation,
      targets,
    ).map((c) => ({
      unitId,
      from: view.cells[0] as number,
      to: c.dest,
      path: c.action.kind === "move" ? [...c.action.path] : [],
    }));
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const child of this.children) child.release();
    this.children.length = 0;
    this.cache.clear();
    this.board.engine.release(this.state);
  }
}

function targetsBoardOf(board: TestBoard, state: StateHandle): Board {
  const grid = board.terrain.grid;
  const food = newBoard(grid);
  board.engine.foodBoard(state, food);
  return pawnTargetsInto(grid, newBoard(grid), food, [
    ...board.engine.units(state).map((u) => u.cells),
    ...state.field.slots.map((s) => s.record.occupancy),
  ]);
}

/**
 * The SCALAR held-unit fold — the negative control.
 *
 * A held unit's payoff contribution is priced at its FROZEN SNAPSHOT weight
 * instead of its strength INTERVAL per consumer polarity. It is the obvious
 * thing to write and it is not a bound: presence-soundness is not
 * payoff-soundness. The harness runs it precisely to watch it fail.
 */
function scalarFold(
  engine: PartialEngine,
  resolution: Resolution,
  subjectTeam: number,
): { worst: number; best: number } {
  const fateById = new Map(resolution.fates.map((f) => [f.unitId, f.fate]));
  const units: UnitValueBounds[] = [];
  for (const v of engine.units(resolution.state)) {
    const fate = fateById.get(v.unitId);
    units.push({
      unitId: v.unitId,
      team: v.team,
      survival: fate === 1 ? "no" : fate === 2 ? "maybe" : "yes",
      weightMin: v.weight,
      weightMax: v.weight,
      partialLossMax: 0,
    });
  }
  for (const slot of resolution.state.field.slots) {
    units.push({
      unitId: slot.record.unitId,
      team: slot.record.team,
      survival: slot.cloud.certainlyGone ? "no" : slot.cloud.deathPossible ? "maybe" : "yes",
      // THE BUG UNDER TEST: the frozen snapshot, not the interval.
      weightMin: slot.record.weight,
      weightMax: slot.record.weight,
      partialLossMax: 0,
    });
  }
  const teams = new Set(units.map((u) => u.team));
  let worst = 0;
  let best = 0;
  for (const team of teams) {
    const v = scopedTeamValueBounds(units, team, subjectTeam);
    if (team === subjectTeam) {
      worst += v.worst;
      best += v.best;
    } else {
      worst -= v.worst;
      best -= v.best;
    }
  }
  return { worst: Math.min(worst, best), best: Math.max(worst, best) };
}

export interface SubstrateOptions {
  readonly heldPricing?: HeldPricing;
  /** Turns of extra staleness for held units. */
  readonly staleness?: number;
}

/** The substrate a decision starts from: our team live, everything else held. */
export function makeSubstrate(
  board: TestBoard,
  ourTeam: number,
  options: SubstrateOptions = {},
): BoundedSubstrate & ModellingSubstrate & RosterSubstrate {
  const commanded = new Set<UnitId>(
    board.spec.units.filter((u) => u.team === ourTeam).map((u) => u.id),
  );
  return new TestSubstrate(
    board,
    commanded,
    [],
    options.heldPricing ?? "interval",
    options.staleness ?? 0,
  );
}

// --------------------------------------------------------------- generator

export interface GeneratorOptions {
  /**
   * Drop this many options from the END of every unit's list, recording them
   * in the pruned ledger. This is the ADVERSARIAL TRUNCATION the harness runs
   * the bank against: an incomplete option list must never be allowed to raise
   * a floor.
   */
  readonly pruneTail?: number;
  /** Only prune these units (default: all). */
  readonly pruneOnly?: ReadonlySet<UnitId>;
}

export function makeGenerator(options: GeneratorOptions = {}): CandidateGenerator {
  const prune = options.pruneTail ?? 0;
  return {
    // `purpose` is deliberately IGNORED: this generator is the harness's
    // adversarial control, and its whole point is to hand the bank an
    // A4-violating truncated adversary list and watch the bank refuse to
    // raise a floor on it. The pruned ledger keeps it honest about the count.
    candidatesFor(sub: Substrate, unitId: UnitId, _purpose?: "ours" | "adversary"): CandidateSet {
      const all = (sub as TestSubstrate).optionsFor(unitId);
      const wanted = prune > 0 && (options.pruneOnly === undefined || options.pruneOnly.has(unitId));
      const keep = wanted ? Math.max(1, all.length - prune) : all.length;
      return {
        unitId,
        candidates: all.slice(0, keep),
        prunedLedger: all.slice(keep).map((candidate) => ({
          candidate,
          prune: "testkit tail truncation",
          exact: false,
        })),
        legalCount: all.length,
      };
    },
  };
}

// --------------------------------------------------------------- evaluator

/**
 * The stub evaluator: the engine's own interval fold, in the subject's frame.
 * `est` is the midpoint — an ordering channel and nothing else, which is why
 * the bank clamps it into the bracket rather than trusting it.
 */
export function makeEvaluator(): Evaluator {
  const scorePlan = (sub: Substrate, plan: JointPlan, asTeam: number): Bound => {
    const { worst, best } = (sub as BoundedSubstrate).boundedFor(plan, asTeam);
    return { lo: worst, est: (worst + best) / 2, hi: best };
  };
  return {
    scorePlan,
    evaluatePlan(sub: Substrate, plan: JointPlan, asTeam: number): PlanEvaluation {
      const bound = scorePlan(sub, plan, asTeam);
      return {
        bound,
        parts: {},
        exact: bound.lo === bound.hi,
        basis: [],
        ledgerSize: 0,
      };
    },
  };
}

// ------------------------------------------------------------ ground truth

/** Every joint plan for a team, capped. Ordered, so a failure reproduces. */
export function allPlans(
  sub: BoundedSubstrate & RosterSubstrate,
  gen: CandidateGenerator,
  asTeam: number,
  cap = 64,
): ReadonlyArray<JointPlan> {
  const units = sub.commandable(asTeam);
  let out: JointPlan[] = [new Map()];
  for (const unitId of units) {
    const options = gen.candidatesFor(sub, unitId).candidates;
    const next: JointPlan[] = [];
    for (const prefix of out) {
      for (const candidate of options) {
        const plan = new Map(prefix);
        plan.set(unitId, candidate);
        next.push(plan);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    out = next;
  }
  return out;
}

/**
 * THE GROUND TRUTH: the true worst case of one plan, by EXHAUSTIVE
 * enumeration of every uncontrolled unit's complete option list, resolved
 * through the same engine with NOTHING held.
 *
 * Every held unit's completions are exactly its enumerated actions, so this
 * minimum ranges over every world the bracket claims to contain — which makes
 * `floor ≤ this ≤ ceiling` the whole soundness property in one line.
 */
export function trueWorstCase(
  board: TestBoard,
  ourTeam: number,
  plan: JointPlan,
): { value: number; worstReply: ReadonlyMap<UnitId, Candidate> } {
  const commanded = new Set<UnitId>(board.spec.units.filter((u) => u.team === ourTeam).map((u) => u.id));
  const others = board.spec.units.filter((u) => u.team !== ourTeam).map((u) => u.id);
  const live = new TestSubstrate(board, commanded, others, "interval", 0);
  try {
    const lists = others.map((id) => ({ id, options: live.optionsFor(id) }));
    let value = Number.POSITIVE_INFINITY;
    let worstReply = new Map<UnitId, Candidate>();
    const walk = (i: number, acc: Candidate[]): void => {
      const list = lists[i];
      if (list === undefined) {
        const full = new Map(plan);
        for (const c of acc) full.set(c.unitId, c);
        const out = live.boundedFor(full, ourTeam);
        // Nothing is held, so the bracket is a point: this IS the value.
        if (out.worst < value) {
          value = out.worst;
          worstReply = new Map(acc.map((c) => [c.unitId, c]));
        }
        return;
      }
      for (const option of list.options) walk(i + 1, [...acc, option]);
    };
    walk(0, []);
    return { value, worstReply };
  } finally {
    live.release();
  }
}

/** How many resolutions `trueWorstCase` costs — the harness reports it. */
export function replySpaceSize(board: TestBoard, ourTeam: number): number {
  const commanded = new Set<UnitId>(board.spec.units.filter((u) => u.team === ourTeam).map((u) => u.id));
  const others = board.spec.units.filter((u) => u.team !== ourTeam).map((u) => u.id);
  const live = new TestSubstrate(board, commanded, others, "interval", 0);
  try {
    return others.reduce((n, id) => n * Math.max(1, live.optionsFor(id).length), 1);
  } finally {
    live.release();
  }
}

// ------------------------------------------------------------ seeded boards

/** Deterministic and reproducible: a failing seed replays exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEEDED_KINDS: readonly UnitType[] = ['knight', 'king', 'rook', 'bishop', 'pawn', 'snake'];

/**
 * Small, crowded boards — the regime where the bracket is hardest and where
 * the exhaustive reply space is still affordable.
 *
 * `foodCount` is 0 by default ON PURPOSE. Eating is the one thing that changes
 * a unit's weight while it is frozen, so it is a confound for any property
 * about contests and deaths — and the whole point for the one property that is
 * about held material.
 */
export function seededBoard(seed: number, size = 6, perSide = 1, foodCount = 0): BoardSpec {
  const random = mulberry32(seed);
  const interior: number[] = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) interior.push(y * size + x);
  for (let i = interior.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = interior[i] as number;
    interior[i] = interior[j] as number;
    interior[j] = tmp;
  }
  let next = 0;
  const units: TestUnitSpec[] = [];
  const used = new Set<number>();
  const inside = new Set(interior);
  let id = 1;
  for (const team of [0, 1]) {
    for (let n = 0; n < perSide; n++) {
      let kind = SEEDED_KINDS[Math.floor(random() * SEEDED_KINDS.length)] as UnitType;
      while (next < interior.length && used.has(interior[next] as number)) next++;
      const head = interior[next++] as number;
      used.add(head);
      const weight = 1 + Math.floor(random() * 2);
      // A TRAIL unit's body must occupy its own distinct cells. Two units
      // sharing a cell at turn start is not a board the rules can produce, and
      // a bound measured on one is a statement about nothing.
      let body = -1;
      if (kind === 'snake') {
        for (const step of [-1, 1, -size, size]) {
          const cell = head + step;
          if (inside.has(cell) && !used.has(cell)) {
            body = cell;
            break;
          }
        }
        if (body < 0) kind = 'king';
        else used.add(body);
      }
      const occupancy: number[] =
        kind === 'snake' ? [head, body] : new Array<number>(weight).fill(head);
      units.push({
        id: id++,
        team,
        type: kind,
        occupancy,
        health: 40 + Math.floor(random() * 40),
        tier: random() < 0.15 ? 1 : 0,
        orientation: [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
        ][Math.floor(random() * 4)] as TestUnitSpec['orientation'],
      });
    }
  }
  const food: number[] = [];
  while (food.length < foodCount && next < interior.length) {
    const cell = interior[next++] as number;
    if (!used.has(cell)) food.push(cell);
  }
  return { width: size, height: size, units, food };
}

// --------------------------------------------------------------- the clock

/** A budget that never stops — the exhaustive arm of the harness. */
export function unboundedBudget(): {
  remainingMs(): number;
  elapsedMs(): number;
  shouldStop(): boolean;
  now(): number;
} {
  const start = Date.now();
  return {
    remainingMs: () => Number.POSITIVE_INFINITY,
    elapsedMs: () => Date.now() - start,
    shouldStop: () => false,
    now: () => Date.now(),
  };
}

/**
 * A budget that trips after exactly `n` questions — an ADVERSARIAL clock. It
 * cuts sweeps short at every possible point, which is precisely the condition
 * under which an unfinished enumeration must lower a ceiling and never raise a
 * floor. `now()` advances one unit per question asked, so it is deterministic.
 */
export function countingBudget(n: number): {
  remainingMs(): number;
  elapsedMs(): number;
  shouldStop(): boolean;
  now(): number;
  asked: number;
} {
  const handle = {
    asked: 0,
    remainingMs: (): number => Math.max(0, n - handle.asked),
    elapsedMs: (): number => handle.asked,
    now: (): number => handle.asked,
    shouldStop: (): boolean => {
      handle.asked++;
      return handle.asked > n;
    },
  };
  return handle;
}

/** A budget that has already expired — the pathological anytime entry point. */
export function expiredBudget(): {
  remainingMs(): number;
  elapsedMs(): number;
  shouldStop(): boolean;
  now(): number;
} {
  return { remainingMs: () => 0, elapsedMs: () => 0, shouldStop: () => true, now: () => 0 };
}
