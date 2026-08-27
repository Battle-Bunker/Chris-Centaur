/**
 * THE DILATION SHELLS, READ DIRECTLY.
 *
 * `CloudTimeline.arrival(h)` publishes two things together: `earliest` — the
 * per-cell absolute arrival turn, stamped from the dilation shells the timeline
 * already holds — and `minCost`, a two-phase Dijkstra over the whole board with
 * a binary heap, built EAGERLY on the first call. Every consumer in this
 * repository reads `earliest`; nothing reads `minCost`. Measured on a 13×13
 * board at 26 units, `minCost` is 94% of the cost of a cold arrival grid: 407 µs
 * of 431 µs, thrown away.
 *
 * So this module reads the shells and stops. It is the SAME loop `arrival()`
 * runs — same shells, same stamping order, same NEVER sentinel — because
 * `cloud.ts` is vendored under a byte-identity gate and cannot grow a
 * cost-free entry point on our schedule.
 *
 * ── THE RISK THIS CARRIES, AND WHAT PAYS FOR IT ────────────────────────────
 *
 * A second encoding of `earliest` is exactly the thing the one-pipeline rule
 * forbids, and the failure mode is silent: if upstream changes how a shell is
 * derived, this copy drifts, and it drifts only in a soft positional signal
 * nobody watches. The price of admission is therefore a DIFFERENTIAL that runs
 * whenever the vendor drift gate runs — `src/tests/arrival-shell-differential.ts`,
 * wired into `src/tests/partial-engine-vendor-sync.test.ts` — asserting cell for
 * cell, on random boards, over every kind, held and live, that this stamping and
 * `CloudTimeline.arrival().earliest` are the same array.
 *
 * ── WHY A TABLE, AND WHY IT IS DECISION-SCOPED ─────────────────────────────
 *
 * The engine's own `CloudSource` keeps 128 timelines by value, shared with
 * every other consumer. One decision's working set at 26 units is 96–97
 * distinct records; two overlapping decisions of the same game fill that cache
 * exactly and begin evicting, and an evicted timeline is a 24 µs rebuild — or,
 * through `arrival()`, a 431 µs one. Keeping the SHELLS in a table sized to the
 * decision's own working set means a miss in the engine's cache costs a
 * dilation, never a Dijkstra, and a hit costs nothing at all.
 */

import {
  NEVER,
  bbForEach,
  bbTest,
  frozenRecordKey,
} from '../../partial-engine/index';
import type {
  Board,
  CloudSource,
  CloudTimeline,
  FrozenRecord,
  Grid,
  Resolution,
  UnitView,
} from '../../partial-engine/index';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';

/**
 * One unit's reach over a horizon: the arriving front at each absolute turn,
 * as POINTERS into boards the timeline already owns, plus the stamped
 * `earliest` grid on demand.
 */
export interface UnitShells {
  readonly unitId: UnitId;
  /** Absolute turn of `fronts[0]` — the record's own freeze turn. */
  readonly heldAtTurn: number;
  /** `fronts[i]` is the head-possible board at absolute turn `heldAtTurn + i`. */
  readonly fronts: ReadonlyArray<Board>;
  /** The absolute turn `fronts` currently reaches. */
  readonly horizonTurn: number;
  /** The front at an ABSOLUTE turn, or null when the horizon does not cover it. */
  frontAt(turn: number): Board | null;
  /** True when this unit can be on `cell` at or before absolute turn `turn`. */
  reachesBy(cell: number, turn: number): boolean;
  /**
   * `earliest[c]`, stamped from the same shells in the same order
   * `CloudTimeline.arrival` stamps them. Built once, on demand: the bitboard
   * sweep never needs it, so a snake-only decision never pays for it.
   */
  earliest(): Int32Array;
}

/**
 * `earliest[c]` for a timeline, to absolute turn `horizonTurn`.
 *
 * This is `CloudTimeline.arrival`'s stamping loop with the `minCost` build
 * removed: for each absolute turn from the record's own `heldAtTurn` up to the
 * horizon, stamp the cells of that turn's arriving front with the turn, keeping
 * the smallest. `out` is reused when given.
 */
export function earliestShells(
  timeline: CloudTimeline,
  heldAtTurn: number,
  horizonTurn: number,
  grid: Grid,
  out: Int32Array | null = null
): Int32Array {
  const earliest = out ?? new Int32Array(grid.cells);
  earliest.fill(NEVER);
  for (let stamp = heldAtTurn; stamp <= horizonTurn; stamp++) {
    const front = timeline.at(Math.max(0, stamp - heldAtTurn)).headPossible;
    bbForEach(front, grid.words, (c) => {
      if ((earliest[c] as number) > stamp) earliest[c] = stamp;
    });
  }
  return earliest;
}

/** The same stamping, from fronts already collected. */
function stampFronts(
  fronts: ReadonlyArray<Board>,
  heldAtTurn: number,
  words: number,
  cells: number
): Int32Array {
  const earliest = new Int32Array(cells).fill(NEVER);
  for (let i = 0; i < fronts.length; i++) {
    const stamp = heldAtTurn + i;
    bbForEach(fronts[i] as Board, words, (c) => {
      if ((earliest[c] as number) > stamp) earliest[c] = stamp;
    });
  }
  return earliest;
}

class Shells implements UnitShells {
  readonly unitId: UnitId;
  readonly heldAtTurn: number;
  readonly fronts: Board[] = [];
  horizonTurn: number;
  private readonly timeline: CloudTimeline;
  private readonly grid: Grid;
  private stamped: Int32Array | null = null;

  constructor(unitId: UnitId, timeline: CloudTimeline, heldAtTurn: number, grid: Grid) {
    this.unitId = unitId;
    this.timeline = timeline;
    this.heldAtTurn = heldAtTurn;
    this.grid = grid;
    this.horizonTurn = heldAtTurn - 1;
  }

  /** Collect fronts out to an absolute turn. Idempotent and extending. */
  extendTo(horizonTurn: number): void {
    while (this.horizonTurn < horizonTurn) {
      const stamp = this.horizonTurn + 1;
      this.fronts.push(this.timeline.at(Math.max(0, stamp - this.heldAtTurn)).headPossible);
      this.horizonTurn = stamp;
      this.stamped = null;
    }
  }

  frontAt(turn: number): Board | null {
    const i = turn - this.heldAtTurn;
    return i < 0 || i >= this.fronts.length ? null : (this.fronts[i] as Board);
  }

  reachesBy(cell: number, turn: number): boolean {
    const last = Math.min(turn, this.horizonTurn);
    for (let t = this.heldAtTurn; t <= last; t++) {
      if (bbTest(this.fronts[t - this.heldAtTurn] as Board, cell)) return true;
    }
    return false;
  }

  earliest(): Int32Array {
    if (this.stamped === null) {
      this.stamped = stampFronts(this.fronts, this.heldAtTurn, this.grid.words, this.grid.cells);
    }
    return this.stamped;
  }
}

// ---------------------------------------------------------------------------
// The decision-scoped table
// ---------------------------------------------------------------------------

/**
 * A `CloudSource` is keyed on its PREMISE (the state's item boards), so two
 * resolutions that ate different food get different sources and must not share
 * shells. The id is part of every table key rather than a comment saying they
 * cannot collide.
 */
const sourceIds = new WeakMap<CloudSource, number>();
let nextSourceId = 1;
function sourceIdOf(src: CloudSource): number {
  let id = sourceIds.get(src);
  if (id === undefined) {
    id = nextSourceId++;
    sourceIds.set(src, id);
  }
  return id;
}

export class ShellTable {
  private readonly grid: Grid;
  private readonly map = new Map<string, Shells>();
  /**
   * The identity tier. A held unit's record is one stable object for the whole
   * decision, so recognising it by identity skips `frozenRecordKey` — which
   * builds a string, joins the occupancy array, and is otherwise paid once per
   * unit per evaluation at ten thousand evaluations a second.
   */
  private readonly byIdentity = new WeakMap<FrozenRecord, Shells>();
  private readonly capacity: number;
  hits = 0;
  misses = 0;
  identityHits = 0;
  evictions = 0;

  constructor(grid: Grid, capacity = 4096) {
    this.grid = grid;
    this.capacity = Math.max(1, capacity);
  }

  /** Entries currently retained. A working set larger than this is a warning. */
  get size(): number {
    return this.map.size;
  }

  /**
   * `held` carries the timeline the caller already holds; otherwise `source`
   * dilates one, and only on a miss. Two nullable parameters rather than the
   * `() => CloudTimeline` thunk this used to take: the thunk was allocated on
   * EVERY call, hit or miss, once per unit per evaluation, to be invoked on
   * roughly none of them.
   */
  private intern(
    record: FrozenRecord,
    prefix: string,
    held: CloudTimeline | null,
    source: CloudSource | null,
    horizonTurn: number
  ): UnitShells {
    const known = this.byIdentity.get(record);
    if (known !== undefined) {
      this.hits++;
      this.identityHits++;
      known.extendTo(horizonTurn);
      return known;
    }
    const key = prefix + frozenRecordKey(record);
    let entry = this.map.get(key);
    if (entry === undefined) {
      this.misses++;
      const timeline = held ?? (source as CloudSource).timelineFor(record);
      entry = new Shells(record.unitId, timeline, record.heldAtTurn, this.grid);
      this.map.set(key, entry);
      if (this.map.size > this.capacity) {
        const oldest = this.map.keys().next();
        if (!oldest.done) {
          this.map.delete(oldest.value);
          this.evictions++;
        }
      }
    } else {
      this.hits++;
    }
    this.byIdentity.set(record, entry);
    entry.extendTo(horizonTurn);
    return entry;
  }

  /** Shells for a record whose timeline the caller already holds. */
  forTimeline(timeline: CloudTimeline, record: FrozenRecord, horizonTurn: number): UnitShells {
    return this.intern(record, 'H|', timeline, null, horizonTurn);
  }

  /** Shells for a record the engine must dilate — never through `arrival()`. */
  forRecord(source: CloudSource, record: FrozenRecord, horizonTurn: number): UnitShells {
    return this.intern(record, `${sourceIdOf(source)}|`, null, source, horizonTurn);
  }

  /**
   * THE LIVE UNIT'S RECORD, REUSED WHEN IT HAS NOT CHANGED.
   *
   * `recordOfView` is a pure function of the view, and a fresh object out of it
   * is an `byIdentity` MISS by construction — so every live unit of every
   * evaluation paid `frozenRecordKey`, which interpolates eleven fields and
   * JOINS the occupancy array. Measured at 4.2% of a decision's self time,
   * entirely on records that were identical to the one built for the same unit
   * a moment earlier: across the branches of one price most units stand where
   * they stood.
   *
   * So the table keeps the last record per unit and hands the SAME OBJECT back
   * when every field of `FROZEN_RECORD_KEY_FIELDS` still matches — which is
   * exactly the condition under which the string key would have matched too.
   * Field-for-field, not by a shortcut: the fields are enumerated below in the
   * order that constant declares them, and `occupancy` is compared elementwise.
   */
  recordForView(view: UnitView, turn: number): FrozenRecord {
    const cached = this.lastRecord.get(view.unitId);
    if (cached !== undefined && sameAsView(cached, view, turn)) return cached;
    const made = recordOfView(view, turn);
    this.lastRecord.set(view.unitId, made);
    return made;
  }

  private readonly lastRecord = new Map<UnitId, FrozenRecord>();
}

/**
 * Would `recordOfView(view, turn)` produce a record equal to `r`?
 *
 * Every field `FROZEN_RECORD_KEY_FIELDS` names is compared. `narrowedTo` is
 * not: `recordOfView` always writes `null`, so a cached record that has
 * anything else in it did not come from here — the check refuses it.
 */
function sameAsView(r: FrozenRecord, view: UnitView, turn: number): boolean {
  if (
    r.unitId !== view.unitId ||
    r.kind !== view.kind ||
    r.team !== view.team ||
    r.heldAtTurn !== turn ||
    r.health !== view.health ||
    r.tier !== view.tier ||
    (r.tierExpiresAtTurn ?? null) !== (view.tierExpiresAtTurn ?? null) ||
    r.weight !== view.weight ||
    (r.orientation as number) !== (view.orientation as number) ||
    r.narrowedTo !== null
  ) {
    return false;
  }
  const a = r.occupancy;
  const b = view.cells;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A frozen-record descriptor for a LIVE unit view, exactly as `holdMany` would
 * build one — WITHOUT the fork, the hold set, or the state it would allocate.
 * A hold that exists only to read a dilation is 8–19 µs of ceremony per
 * evaluation, and the record is a pure function of the view.
 */
export function recordOfView(view: UnitView, turn: number): FrozenRecord {
  return {
    unitId: view.unitId,
    kind: view.kind,
    team: view.team,
    occupancy: view.cells,
    heldAtTurn: turn,
    health: view.health,
    tier: view.tier,
    tierExpiresAtTurn: view.tierExpiresAtTurn,
    weight: view.weight,
    orientation: view.orientation as FrozenRecord['orientation'],
    narrowedTo: null,
  };
}

/**
 * Shells for every unit on a resolved board.
 *
 * Already-claimed units keep their OWN timeline off the resolution's field, so
 * their `heldAtTurn` seed rides in exactly as it does in the engine's own
 * reading; live units get a record built the way `holdMany` would have built
 * one, and the table interns it by value.
 */
export function buildShells(
  sub: EngineSubstrate,
  resolution: Resolution,
  horizonTurns: number,
  table: ShellTable,
  into: Map<UnitId, UnitShells> = new Map()
): Map<UnitId, UnitShells> {
  into.clear();
  if (horizonTurns <= 0) return into;
  const horizon = resolution.state.turn + horizonTurns;

  for (const slot of resolution.state.field.slots) {
    into.set(slot.record.unitId, table.forTimeline(slot.timeline, slot.record, horizon));
  }

  const engine = sub.engine;
  const live = engine.liveSlots(resolution.state);
  if (live.length === 0) return into;
  const source = engine.sourceOf(resolution.state);
  for (const slot of live) {
    const view = engine.unitAt(resolution.state, slot);
    if (view === null || !view.alive) continue;
    if (into.has(view.unitId)) continue;
    into.set(
      view.unitId,
      table.forRecord(source, table.recordForView(view, resolution.state.turn), horizon)
    );
  }
  return into;
}
