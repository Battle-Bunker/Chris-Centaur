/**
 * THE EXACT-REPLY ORACLE — a floor checked against worlds, not against rungs.
 *
 * The standing `CENTAUR_DEBUG_INVERSION` gate compares the bank's OWN members
 * against each other: it fires when a floor from one rung crosses a ceiling
 * from another. That catches a rung that disagrees with its siblings and it is
 * blind to the one failure that matters most — a floor that is wrong on EVERY
 * rung at once. Both bounds move together, the bracket stays the right way up,
 * and the bank publishes a proof about a game it has mis-read.
 *
 * This file is the other instrument. For a priced plan it takes the held set,
 * enumerates each held unit's COMPLETE option list out of the engine's own
 * enumerator, names every one of them at once, and settles the result. Nothing
 * is held in that world, so the bracket the evaluator returns is a POINT and
 * that point is the value of a game the two sides could really play. Then:
 *
 *     floor  ≤  value(w)          for EVERY enumerated world w
 *     ceiling ≥ min over w value(w)     when the enumeration is COMPLETE
 *
 * The first line is the whole B1 lemma turned around. B1 proves
 * `min over o of B0-with-e-modelled(a, e := o) ≤ SV(a)` by arguing that the
 * enemy's real choice contributes a term that is itself a lower bound at that
 * choice; a concrete world whose value sits BELOW that min is a counterexample
 * to the argument, and it is a counterexample no comparison between rungs can
 * produce. It holds for any SUBSET of worlds, which is why the sampled arm is
 * still a proof — every world is a real one, so any one of them can refute.
 *
 * The second line needs completeness: the ceiling bounds the MIN over all
 * replies, and a min over a subset over-estimates it. So a capped enumeration
 * checks the floor only, and says so.
 *
 * ── WHY IT MAY NOT SPEND THE DECISION'S CLOCK ──────────────────────────────
 *
 * The deterministic runner's clock IS the evaluator: `now() = nodes × cost +
 * reads × cost`, and `nodes` counts calls that reach the metered evaluator
 * (`local-game.ts`). An oracle that scored its worlds through the bank's own
 * evaluator would therefore spend the budget of the decision it is watching,
 * and every arm would take a different game from the arm it is supposed to be
 * auditing. So the check scores through an UNMETERED evaluator of the same
 * identity, and refuses to run at all when the bank's evaluator is not the one
 * this module can reproduce — an audit that changed the run would be measuring
 * itself. Everything else it touches (the resolution memo, the view cache) is
 * value-transparent: eviction order changes what is recomputed, never what is
 * computed. It deliberately does NOT touch the bank's evaluation memo, whose
 * hit sequence the clock is a function of, and it banks no witnesses.
 *
 * ── HOW IT IS TURNED ON ────────────────────────────────────────────────────
 *
 *     CENTAUR_EXACT_CHECK=<n>   check one priced plan in every n (n ≥ 1)
 *     CENTAUR_EXACT_CAP=<w>     worlds per check, default 64
 *     CENTAUR_EXACT_DUMP=<k>    print the first k failing boards as JSON
 *
 * Off, this file costs one null check per priced plan.
 */

import type { ActiveEffect } from "../../engine-vendor/shared/types/Game";
import type { ResolveUnit } from "../../engine-vendor/engine/resolveTurn";
import type { MarshalledBoard } from "../../logic/turn-oracle";
import type { Candidate, Evaluator, JointPlan, Substrate, UnitId } from "../contracts";
import { defaultEvaluator, isPoint } from "../evaluate";
import { evaluatorIdentity } from "./evalmemo";

/** Two values are the same number for this file's purposes. */
const EPS = 1e-6;

/**
 * THE SAME EVALUATOR, WITHOUT THE METER — or nothing.
 *
 * `evaluatorIdentity` is the bank's own soundness boundary for its evaluation
 * memo: two evaluations may share an entry only if they agree there. That is
 * exactly the question this file has to answer, so it is asked with the same
 * function rather than with a new one. The runner wraps the shipped evaluator
 * to count nodes and FORWARDS its declared identity, so the metered evaluator
 * and `defaultEvaluator` agree here and the oracle can score through the
 * unwrapped one without spending the decision's clock. A bank running some
 * other profile gets `null` and the check declines: an audit whose subject is
 * not the thing it can reproduce is worse than no audit.
 */
export function shippedEvaluator(metered: Evaluator): Evaluator | null {
  if (metered === defaultEvaluator) return metered;
  return evaluatorIdentity(metered) === evaluatorIdentity(defaultEvaluator)
    ? defaultEvaluator
    : null;
}

// ------------------------------------------------------------------ the ask

export interface ExactCheckRequest {
  /** A view in which EVERY unit named below is a live mover, not a claim. */
  readonly sub: Substrate;
  /** Ours, plus any reference actions — everything the decision has fixed. */
  readonly base: JointPlan;
  /** The units the base plan does not name: what this file enumerates. */
  readonly held: ReadonlyArray<UnitId>;
  /** UNMETERED. See the header. */
  readonly evaluate: Evaluator;
  readonly asTeam: number;
  /** The floor the bank published, and the rung that justified it. */
  readonly floor: number;
  readonly floorFrom: string;
  readonly ceiling: number;
  /** Per-member floors, so a violation names the member rather than the bank. */
  readonly memberFloors: ReadonlyArray<{
    readonly rung: string;
    readonly unitId: UnitId | null;
    readonly floor: number;
  }>;
  /** How many worlds this check may settle. */
  readonly cap: number;
}

export interface ExactViolation {
  readonly side: "floor" | "ceiling";
  /** The bound that was wrong. */
  readonly bound: number;
  /** The value of the world that refutes it. */
  readonly value: number;
  readonly from: string;
  /** Every member whose own floor sits above this world. */
  readonly members: ReadonlyArray<string>;
  /** The reply that produced the world, as `unit>cell` pairs. */
  readonly replies: string;
}

export interface ExactCheckResult {
  /** Worlds actually settled. */
  readonly worlds: number;
  /** The full product, before the cap. */
  readonly product: number;
  /** Whether every world was taken — the ceiling half needs this. */
  readonly complete: boolean;
  /** Why nothing was checked, when nothing was. */
  readonly skipped: string | null;
  readonly minValue: number | null;
  readonly violations: ReadonlyArray<ExactViolation>;
}

const skip = (why: string): ExactCheckResult => ({
  worlds: 0,
  product: 0,
  complete: false,
  skipped: why,
  minValue: null,
  violations: [],
});

/**
 * The `i`-th world of the product, mixed-radix. Enumerating an INDEX rather
 * than recursing is what lets the capped arm take a STRIDE across the whole
 * product instead of a prefix: a prefix varies only the last unit's reply,
 * and the reply that refutes a floor is rarely the last unit's.
 */
function worldAt(
  lists: ReadonlyArray<{ id: UnitId; options: ReadonlyArray<Candidate> }>,
  index: number,
): Candidate[] {
  const out: Candidate[] = [];
  let rest = index;
  for (const list of lists) {
    const n = list.options.length;
    out.push(list.options[rest % n] as Candidate);
    rest = Math.floor(rest / n);
  }
  return out;
}

/**
 * ONE CHECK: settle the worlds, compare, and report what refuted what.
 *
 * The worlds come from `actionsOf` — the engine's own enumerator, the same one
 * `evaluate/laws.ts` builds R1's world set from and the same one the bank's
 * completeness check corroborates its generator against. There is no second
 * encoding of the grammar here, so a grammar change moves the subject and the
 * oracle together.
 */
export function exactReplyCheck(request: ExactCheckRequest): ExactCheckResult {
  const { sub, base, held, evaluate, asTeam, cap } = request;
  if (held.length === 0) return skip("nothing-held");

  const lists: Array<{ id: UnitId; options: ReadonlyArray<Candidate> }> = [];
  for (const id of held) {
    const options = sub.actionsOf(id);
    // A unit with no enumerated reply still DOES something — its kind's own
    // default — and that default is not always a member of the enumerated set
    // (a trail unit has no hold, so its own square is not a legal target).
    // Naming one here would build a world outside the set B1 takes its min
    // over, and a "violation" found on such a world would be this file's
    // error rather than the floor's. There is no honest world to build, so
    // the check declines the plan.
    if (options.length === 0) return skip("unit-without-options");
    lists.push({ id, options });
  }

  let product = 1;
  for (const list of lists) product *= list.options.length;
  const worlds = Math.min(product, Math.max(1, cap));
  const complete = worlds === product;

  const violations: ExactViolation[] = [];
  let minValue: number | null = null;
  for (let i = 0; i < worlds; i++) {
    // Evenly spread across the product when capped, the whole product in order
    // when not. Deterministic either way: a failing arm replays exactly.
    const index = complete ? i : Math.floor((i * product) / worlds);
    const reply = worldAt(lists, index);
    const full = new Map(base);
    for (const c of reply) full.set(c.unitId, c);
    const bound = evaluate.scorePlan(sub, full, asTeam);
    // NOTHING IS HELD, so the bracket must be a point. A gap here is an R3
    // failure — a determinate world that produced an interval — and comparing
    // a floor against an interval would be comparing it against nothing.
    // `isPoint` is the evaluator's own predicate, and it is used rather than a
    // subtraction because the two LATTICE ends subtract to NaN: DEAD === DEAD
    // is a determinate world whose value is the bottom, not a gap.
    if (!isPoint(bound, EPS)) return skip("world-not-a-point");
    const value = bound.lo;
    if (minValue === null || value < minValue) minValue = value;
    if (value < request.floor - EPS) {
      violations.push({
        side: "floor",
        bound: request.floor,
        value,
        from: request.floorFrom,
        members: request.memberFloors
          .filter((m) => m.floor > value + EPS)
          .map((m) => (m.unitId === null ? m.rung : `${m.rung}@${m.unitId}`)),
        replies: reply.map((c) => `${c.unitId}>${c.to}`).join(","),
      });
    }
  }
  // The ceiling bounds the MIN over every reply, so only a complete
  // enumeration can refute it: a min over a subset over-estimates the min.
  if (complete && minValue !== null && request.ceiling < minValue - EPS) {
    violations.push({
      side: "ceiling",
      bound: request.ceiling,
      value: minValue,
      from: "ceiling",
      members: [],
      replies: "min over the complete reply space",
    });
  }
  return { worlds, product, complete, skipped: null, minValue, violations };
}

// --------------------------------------------------------------- the switch

export interface ExactCheckSettings {
  /** Check one priced plan in every `rate`. */
  readonly rate: number;
  readonly cap: number;
  readonly dump: number;
}

let settings: ExactCheckSettings | null | undefined;

/** The env-declared settings, read once. `null` means the check is off. */
export function exactCheckSettings(): ExactCheckSettings | null {
  if (settings !== undefined) return settings;
  const raw = process.env.CENTAUR_EXACT_CHECK;
  const rate = raw === undefined ? 0 : Number.parseInt(raw, 10);
  if (!Number.isFinite(rate) || rate < 1) {
    settings = null;
    return settings;
  }
  const cap = Number.parseInt(process.env.CENTAUR_EXACT_CAP ?? "64", 10);
  const dump = Number.parseInt(process.env.CENTAUR_EXACT_DUMP ?? "0", 10);
  settings = {
    rate,
    cap: Number.isFinite(cap) && cap > 0 ? cap : 64,
    dump: Number.isFinite(dump) && dump > 0 ? dump : 0,
  };
  installSummary();
  return settings;
}

/** Test hook: forget the env reading so a test can set its own. */
export function resetExactCheckSettings(): void {
  settings = undefined;
}

export interface ExactStats {
  checks: number;
  worlds: number;
  complete: number;
  floorViolations: number;
  ceilingViolations: number;
  skips: Record<string, number>;
}

export const exactStats: ExactStats = {
  checks: 0,
  worlds: 0,
  complete: 0,
  floorViolations: 0,
  ceilingViolations: 0,
  skips: {},
};

/** A plan the audit declined before it could build a world. */
export function noteExactSkip(why: string): void {
  exactStats.skips[why] = (exactStats.skips[why] ?? 0) + 1;
}

export function resetExactStats(): void {
  exactStats.checks = 0;
  exactStats.worlds = 0;
  exactStats.complete = 0;
  exactStats.floorViolations = 0;
  exactStats.ceilingViolations = 0;
  exactStats.skips = {};
}

let observer: ((v: ExactViolation, dump: ExactBoardDump | null) => void) | null = null;

/** Watch every violation until the returned function is called. */
export function observeExact(
  fn: (v: ExactViolation, dump: ExactBoardDump | null) => void,
): () => void {
  const previous = observer;
  observer = fn;
  return () => {
    observer = previous;
  };
}

let summaryInstalled = false;

/** One line at exit, so an arm that found nothing says so out loud. */
function installSummary(): void {
  if (summaryInstalled) return;
  summaryInstalled = true;
  process.on("exit", () => {
    process.stderr.write(
      `EXACT-REPLY checks=${exactStats.checks} worlds=${exactStats.worlds} ` +
        `complete=${exactStats.complete} floorViolations=${exactStats.floorViolations} ` +
        `ceilingViolations=${exactStats.ceilingViolations} ` +
        `skips=${JSON.stringify(exactStats.skips)}\n`,
    );
  });
}

let dumped = 0;

/** Record one check's outcome, print what it found, and count it. */
export function reportExact(
  result: ExactCheckResult,
  board: () => ExactBoardDump | null,
): void {
  if (result.skipped !== null) {
    exactStats.skips[result.skipped] = (exactStats.skips[result.skipped] ?? 0) + 1;
    return;
  }
  exactStats.checks++;
  exactStats.worlds += result.worlds;
  if (result.complete) exactStats.complete++;
  if (result.violations.length === 0) return;
  const limit = exactCheckSettings()?.dump ?? 0;
  let dump: ExactBoardDump | null = null;
  if (dumped < limit) {
    dump = board();
    dumped++;
  }
  for (const v of result.violations) {
    if (v.side === "floor") exactStats.floorViolations++;
    else exactStats.ceilingViolations++;
    process.stderr.write(
      `EXACT-INVERSION ${v.side} ${v.from} bound=${v.bound} value=${v.value} ` +
        `members=[${v.members.join(" ")}] replies=${v.replies}\n`,
    );
    observer?.(v, dump);
  }
  if (dump !== null) {
    process.stderr.write(`EXACT-BOARD ${JSON.stringify(dump)}\n`);
  }
}

// ----------------------------------------------------------------- the board

/**
 * A FAILING POSITION, in a shape a test can stand back up.
 *
 * The point of the dump is the next step of the repair: a violation found in a
 * sixty-turn game is a fact about one board, and the fix belongs beside a LAW
 * case that fails on it. `MarshalledBoard` carries two closures and three maps
 * that are pure functions of the rest, so what is written down is everything
 * else and `boardOfDump` rebuilds them — the same board, not a summary of one.
 */
export interface ExactBoardDump {
  readonly turn: number;
  readonly asTeam: string;
  readonly width: number;
  readonly height: number;
  readonly units: ReadonlyArray<ResolveUnit>;
  readonly walls: ReadonlyArray<number>;
  readonly hazards: ReadonlyArray<number>;
  readonly hazardDamage: number;
  readonly food: ReadonlyArray<number>;
  readonly regicideTeamIDs: ReadonlyArray<string>;
  readonly defaultMaxEnergy?: number;
  readonly potions: ReadonlyArray<number>;
  readonly potionsEnabled: boolean;
  readonly potionWindowTurns: number;
  readonly pawnPromotionWeight: number;
  readonly maxTurns: number | null;
  readonly arrivalTurn: number;
  readonly effects: ReadonlyArray<ActiveEffect>;
  readonly tierExpiry: ReadonlyArray<number | null>;
  readonly observedTurns: ReadonlyArray<[string, number]>;
  /** The staged plan, by wire id and destination cell. */
  readonly plan: ReadonlyArray<[string, number]>;
  /** Wire ids of the units the plan left held. */
  readonly held: ReadonlyArray<string>;
}

export function dumpBoard(
  marshalled: MarshalledBoard,
  turn: number,
  asTeam: string,
  observedTurns: ReadonlyArray<[string, number]>,
  plan: ReadonlyArray<[string, number]>,
  held: ReadonlyArray<string>,
): ExactBoardDump {
  const config = marshalled.config;
  return {
    turn,
    asTeam,
    width: marshalled.fullWidth,
    height: marshalled.fullHeight,
    units: marshalled.units.map((u) => ({ ...u, occupancy: [...u.occupancy] })),
    walls: [...config.walls],
    hazards: [...config.hazards],
    hazardDamage: config.hazardDamage,
    food: [...config.food],
    regicideTeamIDs: [...(config.regicideTeamIDs ?? [])],
    ...(config.defaultMaxEnergy === undefined ? {} : { defaultMaxEnergy: config.defaultMaxEnergy }),
    potions: [...marshalled.potions],
    potionsEnabled: marshalled.potionsEnabled,
    potionWindowTurns: marshalled.potionWindowTurns,
    pawnPromotionWeight: marshalled.pawnPromotionWeight,
    maxTurns: marshalled.maxTurns,
    arrivalTurn: marshalled.arrivalTurn,
    effects: marshalled.effects.map((e) => ({ ...e })),
    tierExpiry: [...marshalled.tierExpiry],
    observedTurns,
    plan,
    held,
  };
}

/** The dump, back as the board it was taken from. */
export function boardOfDump(dump: ExactBoardDump): MarshalledBoard {
  const width = dump.width;
  const units = dump.units.map((u) => ({ ...u, occupancy: [...u.occupancy] }));
  return {
    fullWidth: width,
    fullHeight: dump.height,
    units,
    config: {
      boardWidth: width,
      boardHeight: dump.height,
      walls: [...dump.walls],
      hazards: [...dump.hazards],
      hazardDamage: dump.hazardDamage,
      food: [...dump.food],
      regicideTeamIDs: [...dump.regicideTeamIDs],
      ...(dump.defaultMaxEnergy === undefined ? {} : { defaultMaxEnergy: dump.defaultMaxEnergy }),
    },
    potions: [...dump.potions],
    arrivalTurn: dump.arrivalTurn,
    effects: dump.effects.map((e) => ({ ...e })),
    potionsEnabled: dump.potionsEnabled,
    potionWindowTurns: dump.potionWindowTurns,
    pawnPromotionWeight: dump.pawnPromotionWeight,
    maxTurns: dump.maxTurns,
    tierExpiry: [...dump.tierExpiry],
    startWeight: new Map(units.map((u) => [u.id, u.occupancy.length])),
    startHealth: new Map(units.map((u) => [u.id, u.energy])),
    teamOf: new Map(units.map((u) => [u.id, u.teamID])),
    toIndex: (cell) => cell.y * width + cell.x,
    toCell: (index) => ({ x: index % width, y: Math.floor(index / width) }),
  };
}
