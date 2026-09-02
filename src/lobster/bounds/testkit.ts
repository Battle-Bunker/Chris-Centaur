/**
 * MINIMAL FAITHFUL STUBS for the three components B1 owns — Substrate,
 * CandidateGenerator, Evaluator — plus the ground truth the soundness harness
 * measures against.
 *
 * "Faithful" is doing all the work here. These are not fakes: the substrate IS
 * the production `EngineSubstrate`, over a board built in the engine's own
 * coordinates, so every property the harness proves is a property of the code
 * that ships. The stub half is only the two pieces a test is entitled to
 * control — a generator that can be told to truncate an option list, and an
 * evaluator that is the material fold and nothing else.
 *
 * THE GROUND TRUTH IS THE SAME ENGINE WITH NOTHING HELD. `trueWorstCase`
 * enumerates every joint reply and settles each one with every unit named,
 * which by `settlePartial`'s own reduction is `settleTurn` — the rules,
 * exactly once. A second encoding of them would prove only that the two
 * encodings agree.
 */

import type {
  Bound,
  BoundedResolution,
  Candidate,
  CandidateGenerator,
  CandidateSet,
  Evaluator,
  JointPlan,
  PlanEvaluation,
  Substrate,
  UnitId,
} from "../contracts";
import type { UnitType } from "@shared/types/Game";
import type { Orientation } from "../../engine-vendor/engine/moveGrammar";
import type { ResolveUnit, ResolveTurnInput } from "../../engine-vendor/engine/resolveTurn";
import type { PartialSettlement } from "../../engine-vendor/engine/settlePartial";
import type { MarshalledBoard } from "../../logic/turn-oracle";
import { EngineSubstrate } from "../substrate";
import { unitValuesOf, scopedTeamValue } from "./material";
import { planKey } from "./plan";
import type { ModellingSubstrate, RosterSubstrate } from "./substrate-ext";

// ------------------------------------------------------------------- boards

export interface TestUnitSpec {
  readonly id: number;
  readonly team: number;
  readonly type: UnitType;
  /** Head first; a piece's weight is that many copies of one cell — the
   *  engine's own encoding, which is why it is written out here rather than
   *  collapsed and re-expanded. */
  readonly occupancy: ReadonlyArray<number>;
  readonly energy?: number;
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
  readonly spec: BoardSpec;
  readonly marshalled: MarshalledBoard;
  readonly turn: number;
}

const DEFAULT_ENERGY = 60;

/**
 * Two units sharing a cell at turn start is not a board the rules can produce,
 * and a bound measured on one is a statement about nothing: the additive
 * per-enemy lemma was observed to fail outright on such a board, which looks
 * exactly like a soundness bug in the bank until you look at the board.
 */
function assertDisjoint(spec: BoardSpec): void {
  const owner = new Map<number, number>();
  for (const unit of spec.units) {
    // A piece's weight IS its cell repeated, so only cells shared between
    // DIFFERENT units are impossible.
    for (const cell of new Set(unit.occupancy)) {
      const held = owner.get(cell);
      if (held !== undefined && held !== unit.id) {
        throw new Error(
          `testkit: units ${held} and ${unit.id} both occupy cell ${cell} at turn start — ` +
            'not a reachable board, so nothing measured on it means anything',
        );
      }
      owner.set(cell, unit.id);
    }
  }
}

export const wireIdOf = (id: number): string => `u${id}`;
export const teamIdOf = (team: number): string => `t${team}`;

/**
 * A board in the engine's own coordinates, marshalled by hand.
 *
 * The decision path marshals an api board through `marshalBoard`; a harness
 * board is already in engine cells, so there is nothing to translate and
 * nothing is translated. It is the same struct either way, which is what lets
 * the harness run the production substrate rather than a second one.
 */
export function makeTestBoard(spec: BoardSpec): TestBoard {
  assertDisjoint(spec);
  const turn = spec.turn ?? 0;
  const width = spec.width;
  const units: ResolveUnit[] = spec.units.map((u) => ({
    id: wireIdOf(u.id),
    type: u.type,
    teamID: teamIdOf(u.team),
    isKing: u.type === "king",
    tier: u.tier ?? 0,
    energy: u.energy ?? DEFAULT_ENERGY,
    occupancy: [...u.occupancy],
    orientation: u.orientation ?? { dx: 0, dy: -1 },
  }));
  const config: Omit<ResolveTurnInput, "units"> = {
    boardWidth: width,
    boardHeight: spec.height,
    walls: [],
    hazards: [],
    hazardDamage: 100,
    food: [...(spec.food ?? [])],
    regicideTeamIDs: [
      ...new Set(units.filter((u) => u.isKing === true).map((u) => u.teamID)),
    ],
  };
  const marshalled: MarshalledBoard = {
    fullWidth: width,
    fullHeight: spec.height,
    units,
    config,
    potions: [],
    arrivalTurn: turn + 1,
    effects: [],
    potionsEnabled: false,
    potionWindowTurns: 3,
    pawnPromotionWeight: 10,
    maxTurns: null,
    tierExpiry: units.map(() => null),
    startWeight: new Map(units.map((u) => [u.id, u.occupancy.length])),
    startHealth: new Map(units.map((u) => [u.id, u.energy])),
    teamOf: new Map(units.map((u) => [u.id, u.teamID])),
    toIndex: (cell) => cell.y * width + cell.x,
    toCell: (index) => ({ x: index % width, y: Math.floor(index / width) }),
  };
  return { spec, marshalled, turn };
}

export const at = (spec: BoardSpec, x: number, y: number): number => y * spec.width + x;

// --------------------------------------------------------------- substrate

/**
 * The production substrate, plus the two things the harness needs of it: a
 * settlement counter, and the SCALAR held-unit pricing arm the negative
 * controls measure against.
 */
export interface BoundedSubstrate extends EngineSubstrate {
  boundedFor(
    plan: JointPlan,
    asTeam: number,
  ): { resolution: PartialSettlement; worst: number; best: number };
  /** Held-unit pricing mode, so the harness can measure the interval law. */
  readonly heldPricing: "interval" | "scalar";
  /** Real settlements this substrate and its children have spent. */
  readonly resolves: number;
  /** The complete legal option list for a live unit. */
  optionsFor(unitId: UnitId): ReadonlyArray<Candidate>;
}

export type HeldPricing = "interval" | "scalar";

interface CachedResolve {
  readonly full: BoundedResolution;
  readonly worst: number;
  readonly best: number;
}

class TestSubstrate extends EngineSubstrate implements BoundedSubstrate {
  private readonly cache = new Map<string, CachedResolve>();
  private readonly meter: { resolves: number };

  constructor(
    board: TestBoard,
    /** Units this decision commands — never held. */
    private readonly commanded: ReadonlySet<UnitId>,
    /** Uncontrolled units to keep LIVE (modelled) rather than held. */
    modelled: ReadonlyArray<UnitId>,
    readonly heldPricing: HeldPricing,
    /** Extra staleness for held units, in turns. */
    staleness: number,
    meter?: { resolves: number },
  ) {
    const observed = new Map<string, number>();
    if (staleness > 0) {
      for (const unit of board.marshalled.units) {
        observed.set(unit.id, board.turn - staleness);
      }
    }
    super({
      marshalled: board.marshalled,
      turn: board.turn,
      observedTurns: observed,
      modeled: [...commanded, ...modelled].map(wireIdOf),
      // The harness NAMES its units: a fixture that says "unit 3 killed unit 1"
      // has to be readable as that, so the spec's own id is the unit id.
      identify: (wireId) => Number(wireId.slice(1)),
    });
    this.meter = meter ?? { resolves: 0 };
  }

  get resolves(): number {
    return this.meter.resolves;
  }

  private resolveInto(plan: JointPlan, asTeam: number): CachedResolve {
    const key = `${asTeam}#${planKey(plan)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.meter.resolves++;
    const full = super.resolveBoundedFor(plan, asTeam);
    const scalar = this.heldPricing === "interval" ? null : scalarFold(this, full.resolution, asTeam);
    const value: CachedResolve = {
      full,
      worst: scalar === null ? full.bounds.worst : scalar.worst,
      best: scalar === null ? full.bounds.best : scalar.best,
    };
    this.cache.set(key, value);
    return value;
  }

  boundedFor(
    plan: JointPlan,
    asTeam: number,
  ): { resolution: PartialSettlement; worst: number; best: number } {
    const v = this.resolveInto(plan, asTeam);
    return { resolution: v.full.resolution, worst: v.worst, best: v.best };
  }

  /** The contract triple is always the engine's honest interval — the scalar
   * negative control is only ever visible through `boundedFor`. */
  override resolveBoundedFor(plan: JointPlan, asTeam: number): BoundedResolution {
    return this.resolveInto(plan, asTeam).full;
  }

  /** The complete legal option list for a live unit, engine-enumerated. */
  optionsFor(unitId: UnitId): ReadonlyArray<Candidate> {
    return this.actionsOf(unitId);
  }

  override commandable(asTeam: number): ReadonlyArray<UnitId> {
    return super.commandable(asTeam).filter((id) => this.commanded.has(id));
  }

  override release(): void {
    this.cache.clear();
    super.release();
  }
}

/**
 * The SCALAR held-unit fold — the negative control.
 *
 * A held unit's payoff contribution is priced at its OBSERVED weight instead
 * of its interval per consumer polarity. It is the obvious thing to write and
 * it is not a bound: presence-soundness is not payoff-soundness. The harness
 * runs it precisely to watch it fail.
 */
function scalarFold(
  sub: EngineSubstrate,
  settlement: PartialSettlement,
  subjectTeam: number,
): { worst: number; best: number } {
  const heldIds = new Set(settlement.claims.map((c) => c.id));
  const units = unitValuesOf(sub, settlement).map((u) => {
    const unit = sub.unitOf(u.unitId);
    if (unit === undefined || !heldIds.has(unit.wireId)) return u;
    // THE BUG UNDER TEST: the observed snapshot, not the interval.
    return { ...u, weightMin: unit.weight, weightMax: unit.weight, partialLossMax: 0 };
  });
  const teams = new Set(units.map((u) => u.team));
  let worst = 0;
  let best = 0;
  for (const team of teams) {
    const v = scopedTeamValue(units, team, subjectTeam);
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
      const all = (sub as BoundedSubstrate).optionsFor(unitId);
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
        energy: 40 + Math.floor(random() * 40),
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
