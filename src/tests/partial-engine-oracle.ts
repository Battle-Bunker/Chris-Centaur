/**
 * THE ORACLE HARNESS — this repo's OWN vendored resolver, and the translation
 * between its wire vocabulary and the possibility-cloud engine's.
 *
 * Upstream, the engine's differential runs against a JavaScript transpilation
 * of the TacticToes resolver kept in packages/engine/src/oracle/. Here it runs
 * against src/engine-vendor/ — the TypeScript module this bot already uses to
 * predict a turn, imported directly, no createRequire, no second copy. That
 * substitution is the point of porting the differential at all: upstream it
 * proves the engine agrees with a copy of the rules, and here it proves the
 * engine agrees with THE copy this repo will actually adjudicate against.
 * Anything that only held for upstream's copy shows up as a failure here.
 *
 * Everything a differential needs lives in this file so the directed tests,
 * the 2000-board random differential and any future one-off repro share ONE
 * translation. Two encodings of the rules is already the risk this whole
 * arrangement manages; two encodings of the TRANSLATION would make every
 * disagreement ambiguous about which layer was wrong.
 *
 * The wire/engine translation itself is NOT restated here — it is
 * src/partial-engine/wire-adapter.ts, called in both directions. So these 2000
 * boards are also the adapter's proof: a weight-stack collapse that dropped a
 * rook's weight would show up as a disagreement on the very first grown piece.
 *
 * ── THE ORACLE IS `settleTurn`, NOT `resolveTurn` ──────────────────────────
 *
 * It used to be `resolveTurn`, the board half. That answered "where is
 * everything and what died" and stopped, which left FOUR RULES the differential
 * never once executed: potion collection, effect expiry, the ally-buff cancel
 * and tier settlement. They are rules — VENDOR.md is explicit that a caller
 * deriving them itself has written the second encoding this whole arrangement
 * exists to prevent — and this repo's consumer (`logic/turn-oracle.ts`) reads
 * all three settlement outputs on every candidate move it prices.
 *
 * `settleTurn` is `resolveTurn` plus that bookkeeping, so every coordinate the
 * old oracle compared is compared unchanged; the settlement coordinates are
 * NEW, and they are checked differently, because the possibility-cloud engine
 * has no settlement layer to differ from. What they are checked against is
 * written down at `settlementDiff`, which is the only honest place to read it.
 */

import type { ResolveTurnInput, ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import { DEFAULT_POTION_WINDOW_TURNS, settleTurn } from '../engine-vendor/engine/settleTurn';
import type { Settlement } from '../engine-vendor/engine/settleTurn';
import type { Orientation } from '../engine-vendor/engine/moveGrammar';
import type { ActiveEffect, ClashKind } from '@shared/types/Game';
import { NO_ORDER } from '../partial-engine/index';
import type { Clash, PartialEngine, StateHandle, UnitSpec } from '../partial-engine/index';
import {
  WIRE_ORIENTATIONS,
  occupancyOfCells,
  ordersForSlots,
  toUnitSpec,
  wireTypeOfKind,
} from '../partial-engine/wire-adapter';

/** The perimeter, which is what every board in these tests walls off. */
export function perimeter(width: number, height: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) out.push(y * width + x);
    }
  }
  return out;
}

/**
 * One board, in the ONE shape both resolvers are fed from. `weight` is carried
 * separately from `cells` because the two encodings differ there and only
 * there: the wire stores a piece's weight as that many copies of its cell,
 * while `UnitSpec` wants exactly one cell plus an explicit weight. See
 * wire-adapter.ts, which is where that conditional lives.
 */
export interface OracleCase {
  width: number;
  height: number;
  units: Array<{
    unitId: number;
    kind: number;
    team: number;
    cells: number[];
    weight: number;
    health: number;
    tier: number;
    orientation: number;
  }>;
  food: number[];
  hazards: number[];
  hazardDamage: number;
  maxHealth: number;
  /** unitId -> staged destination. Absent means the kind's own default. */
  orders: Map<number, number>;

  // ── Settlement's inputs ───────────────────────────────────────────────────
  // OPTIONAL, and every one of them defaults to the inert value: a board that
  // names none of them settles exactly as `resolveTurn` alone once did, which
  // is what keeps every directed case written against the old oracle valid.
  /** The turn being resolved: expiry and the pickup window are arithmetic on it. */
  turn?: number;
  /** The invulnerability effect schedule as the turn opened. */
  effects?: ActiveEffect[];
  /** Potion cells on the board as the turn opened. */
  potions?: number[];
  /** Off, and potions are inert scenery: nothing collects. */
  potionsEnabled?: boolean;
  /** How long a pickup's debuff and its allies' buffs last. */
  potionWindowTurns?: number;
}

/** Settlement's inputs with the inert defaults filled in. ONE place. */
export function settlementInputsOf(tc: OracleCase): {
  turn: number;
  effects: ActiveEffect[];
  potions: number[];
  potionsEnabled: boolean;
  potionWindowTurns: number;
} {
  return {
    turn: tc.turn ?? 0,
    effects: tc.effects ?? [],
    potions: tc.potions ?? [],
    potionsEnabled: tc.potionsEnabled ?? false,
    potionWindowTurns: tc.potionWindowTurns ?? DEFAULT_POTION_WINDOW_TURNS,
  };
}

export interface Outcome {
  /** unitId -> occupancy (head first) and health, survivors only. */
  survivors: Map<number, { cells: number[]; health: number; weight: number }>;
  deaths: Map<number, { cell: number; subStep: number; cause: string }>;
  clashes: Array<{
    index: number;
    subStep: number;
    kind: string;
    playerIDs: number[];
    victimIDs: number[];
    survivorID: number | null;
    reason: string;
  }>;
  severedCells: Map<number, number[]>;
}

/**
 * The three coordinates settlement adds on top of the board half, in the
 * engine's numeric vocabulary. `tiers` is the tier the NEXT turn starts from,
 * survivors only; `effects` is the schedule as the turn closed; `potions` is
 * what is still lying on the board.
 */
export interface SettlementView {
  tiers: Map<number, number>;
  effects: Array<{
    unitId: number;
    kind: 'buff' | 'debuff';
    level: number;
    expiryTurn: number;
    sourceId: number;
  }>;
  potions: number[];
  /** Straight off the resolution: who was vulnerable when they collided. */
  vulnerableCollided: number[];
}

/** Unit ids become "u00007"-style strings so the wire's STRING sort is the numeric one. */
export const wireIdOf = (unitId: number): string => `u${String(unitId).padStart(5, '0')}`;
const wireId = wireIdOf;
const unitIdOf = (wire: string): number => Number.parseInt(wire.slice(1), 10);

const normaliseClashes = (clashes: Outcome['clashes']): Outcome['clashes'] =>
  [...clashes].sort(
    (a, b) =>
      a.subStep - b.subStep ||
      a.index - b.index ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.playerIDs.join() < b.playerIDs.join()
        ? -1
        : a.playerIDs.join() > b.playerIDs.join()
          ? 1
          : 0)
  );

/**
 * The board half of settlement's input, in the wire's own vocabulary. Shared
 * so the settlement differential and the held-unit soundness suite feed the
 * vendored resolver through ONE marshalling, exactly as the bot does.
 */
export function oracleInput(tc: OracleCase): ResolveTurnInput {
  const units: ResolveUnit[] = tc.units.map((u) => {
    const staged = tc.orders.get(u.unitId);
    const type = wireTypeOfKind(u.kind);
    return {
      id: wireId(u.unitId),
      type,
      teamID: String(u.team),
      tier: u.tier,
      health: u.health,
      // The wire's weight encoding, applied by the shared adapter rather than
      // spelled out again here.
      occupancy: occupancyOfCells(type, u.cells, u.weight),
      orientation: WIRE_ORIENTATIONS[u.orientation] as Orientation,
      ...(staged === undefined || staged === NO_ORDER ? {} : { stagedMove: staged }),
    };
  });
  return {
    units,
    boardWidth: tc.width,
    boardHeight: tc.height,
    walls: perimeter(tc.width, tc.height),
    hazards: tc.hazards,
    hazardDamage: tc.hazardDamage,
    food: tc.food,
    defaultMaxHealth: tc.maxHealth,
    regicideTeamIDs: [],
  };
}

/** unit id -> team id, for EVERY configured unit — what the ally cancel reads. */
export function teamOfMap(tc: OracleCase): { [unitID: string]: string } {
  const out: { [unitID: string]: string } = {};
  for (const u of tc.units) out[wireId(u.unitId)] = String(u.team);
  return out;
}

/** SETTLE one case with this repo's vendored engine — the ground truth. */
export function oracleSettlement(tc: OracleCase): {
  outcome: Outcome;
  settlement: SettlementView;
  settled: Settlement;
} {
  const result = settleTurn({
    ...oracleInput(tc),
    ...settlementInputsOf(tc),
    teamOf: teamOfMap(tc),
  });

  const trail = new Map(tc.units.map((u) => [u.unitId, u.kind === 0]));
  const survivors = new Map<number, { cells: number[]; health: number; weight: number }>();
  for (const [wire, unit] of Object.entries(result.board)) {
    const id = unitIdOf(wire);
    survivors.set(id, {
      // Back out of the weight encoding: a piece's occupancy is one cell
      // repeated, and its LENGTH is the weight the engine reports separately.
      cells: trail.get(id) === true ? [...unit.occupancy] : [unit.occupancy[0] as number],
      health: unit.health,
      weight: unit.occupancy.length,
    });
  }
  const deaths = new Map<number, { cell: number; subStep: number; cause: string }>();
  for (const [wire, death] of Object.entries(result.deaths)) {
    deaths.set(unitIdOf(wire), { cell: death.cell, subStep: death.subStep, cause: death.cause });
  }
  const severedCells = new Map<number, number[]>();
  for (const [wire, cells] of Object.entries(result.severedCells)) {
    severedCells.set(unitIdOf(wire), [...cells]);
  }
  const outcome: Outcome = {
    survivors,
    deaths,
    severedCells,
    clashes: normaliseClashes(
      result.clashes.map((c) => ({
        index: c.index,
        subStep: c.subStep,
        kind: c.kind as string,
        playerIDs: c.playerIDs.map(unitIdOf),
        victimIDs: c.victimIDs.map(unitIdOf),
        survivorID: c.survivorID === undefined ? null : unitIdOf(c.survivorID),
        reason: c.reason,
      }))
    ),
  };
  const settlement: SettlementView = {
    tiers: new Map(Object.entries(result.tiers).map(([wire, t]) => [unitIdOf(wire), t])),
    effects: result.effects.map((e) => ({
      unitId: unitIdOf(e.playerID),
      kind: e.type === 'invulnerability_buff' ? ('buff' as const) : ('debuff' as const),
      level: e.level,
      expiryTurn: e.expiryTurn,
      sourceId: unitIdOf(e.sourcePlayerID),
    })),
    potions: [...result.potions],
    vulnerableCollided: result.vulnerableCollided.map(unitIdOf),
  };
  return { outcome, settlement, settled: result };
}

/** The board half alone — what every existing caller compares. */
export function oracleOutcome(tc: OracleCase): Outcome {
  return oracleSettlement(tc).outcome;
}

/**
 * The other direction of the adapter: wire occupancy -> UnitSpec, in the roster
 * ORDER that becomes the engine's slot order. Building the spec by hand
 * anywhere would let a harness disagree with what the bot does at runtime,
 * which is the one thing a differential must not permit — so every suite that
 * puts one of these boards into the possibility-cloud engine comes through
 * here.
 */
export function engineSpecs(tc: OracleCase): UnitSpec[] {
  return tc.units.map((u) => {
    const type = wireTypeOfKind(u.kind);
    return toUnitSpec(
      {
        id: wireId(u.unitId),
        type,
        teamID: String(u.team),
        occupancy: occupancyOfCells(type, u.cells, u.weight),
        health: u.health,
        tier: u.tier,
        orientation: WIRE_ORIENTATIONS[u.orientation] as Orientation,
      },
      { unitId: u.unitId, team: u.team, defaultOrientation: u.orientation }
    );
  });
}

/** Resolve one case with the possibility-cloud engine, through the same translation. */
export function engineOutcome(engine: PartialEngine, tc: OracleCase): Outcome {
  const specs = engineSpecs(tc);

  const state: StateHandle = engine.create(specs, tc.food, tc.potions ?? [], tc.turn ?? 0);
  const orders = ordersForSlots(specs, engine.config.maxUnits, tc.orders);
  const r = engine.resolve(state, orders);

  const survivors = new Map<number, { cells: number[]; health: number; weight: number }>();
  for (const v of engine.units(r.state)) {
    if (!v.alive) continue;
    survivors.set(v.unitId, { cells: [...v.cells], health: v.health, weight: v.weight });
  }
  const deaths = new Map<number, { cell: number; subStep: number; cause: string }>();
  for (const d of r.deaths) {
    deaths.set(d.unitId, { cell: d.cell, subStep: d.subStep, cause: d.cause });
  }
  const severedCells = new Map<number, number[]>();
  for (const [id, cells] of r.severedCells) severedCells.set(id, [...cells]);
  const clashes = normaliseClashes(
    r.clashes.map((c: Clash) => ({
      index: c.index,
      subStep: c.subStep,
      kind: c.kind as ClashKind as string,
      playerIDs: [...c.playerIDs],
      victimIDs: [...c.victimIDs],
      survivorID: c.survivorID === undefined ? null : c.survivorID,
      reason: c.reason,
    }))
  );
  engine.release(r.state);
  return { survivors, deaths, severedCells, clashes };
}

/** A human-readable diff of two outcomes, for an assertion message. */
export function outcomeDiff(truth: Outcome, mine: Outcome): string[] {
  const notes: string[] = [];
  const ids = new Set([
    ...truth.survivors.keys(),
    ...mine.survivors.keys(),
    ...truth.deaths.keys(),
    ...mine.deaths.keys(),
  ]);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const a = truth.survivors.get(id);
    const b = mine.survivors.get(id);
    if ((a === undefined) !== (b === undefined)) {
      notes.push(`unit ${id}: truth ${a ? 'alive' : 'dead'}, engine ${b ? 'alive' : 'dead'}`);
      continue;
    }
    if (a === undefined || b === undefined) continue;
    if (a.cells.join('/') !== b.cells.join('/')) {
      notes.push(`unit ${id}: cells truth ${a.cells.join('/')} engine ${b.cells.join('/')}`);
    }
    if (a.health !== b.health) notes.push(`unit ${id}: health ${a.health} vs ${b.health}`);
    if (a.weight !== b.weight) notes.push(`unit ${id}: weight ${a.weight} vs ${b.weight}`);
  }
  return notes;
}

/**
 * THE SETTLEMENT COORDINATES, AND WHAT THEY ARE CHECKED AGAINST.
 *
 * There is no second encoding of potion collection, effect expiry, the ally
 * cancel or tier settlement anywhere in this repo — the possibility-cloud
 * engine stops at the board half — so there is nothing to run a two-sided
 * differential against, and inventing one HERE would be writing the second
 * encoding into the test that exists to forbid it. What is available is
 * cross-checking settlement's outputs against the OTHER encoding's board half
 * and against each other, which is exactly what a consumer's correctness rests
 * on. Four laws, none of which restates the pickup arithmetic:
 *
 *  1. TIER KEYS ARE THE SURVIVORS. `tiers` names every unit the possibility-
 *     cloud engine independently left standing, and no other. A settlement
 *     that carried a dead unit's tier forward, or dropped a live one's, has
 *     told its caller to adjudicate next turn against a roster that does not
 *     exist.
 *  2. COLLECTION IS ARRIVAL. The potions settlement removed are exactly the
 *     potion cells a survivor's HEAD finished the turn on — and the survivor
 *     heads come from the other engine. This is a genuine two-sided check:
 *     one side decides who collected, the other decides where everyone ended.
 *  3. TIER IS THE SUM OF ITS EFFECTS. On a board where each unit's opening
 *     tier is the sum of its opening effects' levels (what a real game
 *     maintains, and what `buildPotionCase` maintains), every survivor's
 *     settled tier must equal the sum of the levels of the effects settlement
 *     left it. This is the coordinate a consumer reads BOTH of — the tier to
 *     adjudicate with and the schedule to expire from — and they must not be
 *     able to disagree.
 *  4. EXPIRY IS TOTAL, AND THE DEAD TAKE THEIR EFFECTS WITH THEM. Nothing due
 *     at or before this turn survives it, and no effect outlives its owner.
 *
 * What these do NOT prove is stated in docs/design/differential-coverage.md:
 * a change that moved a tier and its effect TOGETHER in the same wrong
 * direction satisfies all four. Law 5 is the guard for that, and it is the
 * strongest statement available without a second encoding:
 *
 *  5. AN INERT TURN MOVES NOTHING. Where nothing was collected, nothing
 *     expired and nobody collided vulnerable, the tiers and the schedule come
 *     out of settlement byte-identical to the ones that went in.
 */
export function settlementDiff(
  tc: OracleCase,
  s: SettlementView,
  board: Outcome
): string[] {
  const notes: string[] = [];
  const { turn, effects: openEffects, potions, potionsEnabled } = settlementInputsOf(tc);
  const survivors = [...board.survivors.keys()].sort((a, b) => a - b);

  // 1. tier keys are the survivors
  const tierIds = [...s.tiers.keys()].sort((a, b) => a - b);
  if (tierIds.join(',') !== survivors.join(',')) {
    notes.push(`tiers name [${tierIds.join(',')}], survivors are [${survivors.join(',')}]`);
  }

  // 2. collection is arrival
  const heads = new Set<number>();
  for (const v of board.survivors.values()) heads.add(v.cells[0] as number);
  const expected = potionsEnabled ? potions.filter((c) => !heads.has(c)) : [...potions];
  const left = [...s.potions].sort((a, b) => a - b);
  if (left.join(',') !== [...expected].sort((a, b) => a - b).join(',')) {
    notes.push(
      `potions left [${left.join(',')}], arrival says [${[...expected].sort((a, b) => a - b).join(',')}]`
    );
  }

  // 3. tier is the sum of its effects (only meaningful when the opening board
  //    obeys the same invariant — a caller that hands in a free-floating tier
  //    gets this law skipped rather than a false failure).
  const openingLevel = new Map<number, number>();
  for (const u of tc.units) openingLevel.set(u.unitId, 0);
  for (const e of openEffects) {
    const id = unitIdOf(e.playerID);
    openingLevel.set(id, (openingLevel.get(id) ?? 0) + e.level);
  }
  const coherentOpening = tc.units.every((u) => u.tier === openingLevel.get(u.unitId));
  if (coherentOpening) {
    const closingLevel = new Map<number, number>();
    for (const id of survivors) closingLevel.set(id, 0);
    for (const e of s.effects) {
      closingLevel.set(e.unitId, (closingLevel.get(e.unitId) ?? 0) + e.level);
    }
    for (const id of survivors) {
      const tier = s.tiers.get(id) as number;
      const sum = closingLevel.get(id) ?? 0;
      if (tier !== sum) notes.push(`unit ${id}: settled tier ${tier}, effects sum to ${sum}`);
    }
  }

  // 4. expiry is total, and the dead take their effects with them
  for (const e of s.effects) {
    if (e.expiryTurn <= turn) {
      notes.push(`unit ${e.unitId}: effect due at ${e.expiryTurn} survived turn ${turn}`);
    }
    if (!board.survivors.has(e.unitId)) {
      notes.push(`unit ${e.unitId}: effect outlived its owner`);
    }
  }

  // 5. an inert turn moves nothing
  const collected = potionsEnabled && potions.some((c) => heads.has(c));
  const expiring = openEffects.some((e) => e.expiryTurn <= turn);
  if (!collected && !expiring && s.vulnerableCollided.length === 0) {
    for (const id of survivors) {
      const before = tc.units.find((u) => u.unitId === id)?.tier as number;
      const after = s.tiers.get(id) as number;
      if (before !== after) notes.push(`unit ${id}: inert turn moved tier ${before} -> ${after}`);
    }
    const opening = openEffects
      .filter((e) => board.survivors.has(unitIdOf(e.playerID)))
      .map((e) => `${unitIdOf(e.playerID)}:${e.type}:${e.level}:${e.expiryTurn}`)
      .sort();
    const closing = s.effects
      .map((e) => `${e.unitId}:invulnerability_${e.kind}:${e.level}:${e.expiryTurn}`)
      .sort();
    if (opening.join('|') !== closing.join('|')) {
      notes.push(`inert turn rewrote the schedule: [${opening.join('|')}] -> [${closing.join('|')}]`);
    }
  }
  return notes;
}
