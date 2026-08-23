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
 */

import { resolveTurn } from '../engine-vendor/engine/resolveTurn';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import type { Orientation } from '../engine-vendor/engine/moveGrammar';
import type { ClashKind } from '@shared/types/Game';
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

/** Unit ids become "u00007"-style strings so the wire's STRING sort is the numeric one. */
const wireId = (unitId: number): string => `u${String(unitId).padStart(5, '0')}`;
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

/** Resolve one case with this repo's vendored resolver — the ground truth. */
export function oracleOutcome(tc: OracleCase): Outcome {
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

  const result = resolveTurn({
    units,
    boardWidth: tc.width,
    boardHeight: tc.height,
    walls: perimeter(tc.width, tc.height),
    hazards: tc.hazards,
    hazardDamage: tc.hazardDamage,
    food: tc.food,
    defaultMaxHealth: tc.maxHealth,
    regicideTeamIDs: [],
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
  return {
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
}

/** Resolve one case with the possibility-cloud engine, through the same translation. */
export function engineOutcome(engine: PartialEngine, tc: OracleCase): Outcome {
  // The other direction of the adapter: wire occupancy -> UnitSpec. Building
  // the spec by hand here would let this harness disagree with what the bot
  // does at runtime, which is the one thing a differential must not permit.
  const specs: UnitSpec[] = tc.units.map((u) => {
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

  const state: StateHandle = engine.create(specs, tc.food, [], 0);
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
