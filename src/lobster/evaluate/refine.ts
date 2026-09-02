/**
 * DOOR C — THE CONTESTED REACH/ROOM REFINER.
 *
 * `reach` and `room` read arrival floods that are UNCONTESTED: a dilation over
 * terrain, per unit, ignoring every other unit on the board. That is sound in
 * both directions and it is loose in exactly one place — a held unit's flood
 * walks straight through our own units' living bodies, and a body is not
 * ground. This module removes those cells from the held unit's reading, on the
 * cells CL3's enumeration has already paid to resolve, and publishes the result
 * as a MEET with the unrefined reading. It is a tighten and never a widen.
 *
 * ── THE ONE FACT IT USES, AND WHERE THE CODEBASE ALREADY STATES IT ─────────
 *
 * `staging-safety.ts:allyBodyCollision` says it in as many words: *"a trail
 * unit's `cells[0 .. len-2]` is occupied next turn whatever it chooses, INDEX 0
 * INCLUDED — the cell a team-mate's head is vacating becomes its own new
 * neck"*. And `cluster-seed.ts:bodyPotential` states the adjudication: *"A
 * living body is adjudicated by TIER ALONE ... at parity the entrant dies
 * whatever it weighs, and at strictly higher tier it SEVERS the body"*.
 *
 * Put together: for one of our units `u` that is certainly alive and that
 * nothing on the board out-tiers, the cells `u.cells[0 .. len-2]` are a LIVING
 * BODY at the resolved turn, and any unit whose head enters one of them dies
 * there. It therefore holds that cell in NO WORLD — which is the only kind of
 * statement plane 1 is allowed to act on.
 *
 * That same docstring also names the one exception, and it is the reason for
 * the alive gate here: *"if the team-mate dies this turn its occupancy becomes
 * a durable pile, and a pile is settled on WEIGHT where a living body is
 * settled on TIER alone"*. A dead unit's cells are not a shield. So a
 * contributor must be certainly alive in THIS resolution — `worstAlive &&
 * bestAlive` — and not merely alive in the optimistic reading.
 *
 * ── WHY ONLY HELD UNITS ARE MASKED, WHICH IS THE STAGE'S REAL FINDING ──────
 *
 * The same shield would delay OUR OWN located units' floods too: our flood also
 * walks through our own bodies. Masking it would be a true statement and it
 * would still be WRONG HERE, because it moves the value on a board with nothing
 * held — and a determinate position must produce the same point before and
 * after (R3, and the "the refined floor never crosses the unrefined one" gate).
 * A correction to a located unit's flood is a change to what the FEATURE MEANS;
 * only a correction to a HELD unit's flood is a narrowing of what is uncertain.
 * Door C's soundness lens therefore forces the refiner to touch exactly the
 * held side — which is also the honest statement of where its value is: fog and
 * held boards, as `la-outside.md` said, and nowhere else.
 *
 * Concretely, per reading, and note the two are mirror images because the two
 * admissions are (`features.ts:ADMISSION`):
 *
 *   lo   admits held ENEMIES (`theirs: worstAlive`) and drops held teammates.
 *        Masking an enemy's flood on the shield removes a claim that exists in
 *        no world, so `ours − theirs` can only RISE. The floor rises.
 *   hi   admits held TEAMMATES (`ours: bestAlive`) and drops held enemies.
 *        Masking a teammate's flood on the shield removes one of OUR claims, so
 *        `ours − theirs` can only FALL. The ceiling falls.
 *
 * With nothing held both sets are empty, the refiner declines before building
 * anything, and the evaluation is byte-identical. R3 collapse is therefore not
 * preserved by argument but by construction.
 *
 * ── WHY THE PUBLICATION IS A MEET AND NOT A REPLACEMENT ────────────────────
 *
 * At the TEAM level the masking is monotone: a cell's side is decided by
 * `ourFirst(c) < theirFirst(c)` over cumulative fronts, so delaying one side's
 * arrival at `c` can only move `c` toward the other side or to nobody. Per-unit
 * `owned` — what `room` folds — is NOT monotone in the same way: plane 1 gives a
 * cell to a unit only when it is the UNIQUE first arrival, so removing one
 * enemy from a tie at `c` can hand `c` to the enemy it was tied with and raise
 * THEIR room. Both readings remain sound; neither dominates.
 *
 * So both intervals are computed and the tighter endpoints are taken:
 * `lo* = max(lo, lo')`, `hi* = min(hi, hi')`. Two independently sound bounds on
 * one quantity meet into the tightest one — this is `bounds/score.ts:tighten`'s
 * own rule, at the feature's own basis, and it makes "never a widen" a fact
 * about the arithmetic rather than a property to be tested for.
 *
 * R2 lifts through the meet for free: a narrowing of a held unit shrinks its
 * fronts, which shrinks its claims in the refined reading exactly as it does in
 * the unrefined one, and `max` of two non-decreasing floors is non-decreasing
 * while `min` of two non-increasing ceilings is non-increasing.
 *
 * ── WHERE THE CLUSTER COMES IN ─────────────────────────────────────────────
 *
 * The shield is built from OUR UNITS THAT CL3'S ENUMERATION RESOLVED, and from
 * nothing else. That restriction is a COST GATE and not a soundness input, and
 * saying so plainly matters: the body cells are certain because the resolution
 * places them, not because the enumeration ranked them. What the enumeration
 * buys is the licence to spend anything here at all — the refinement runs only
 * over units a partition and an exact joint solve have already been paid for
 * this decision, which is the budget rule this stage was given
 * (`RefineScope`, registered by `search/core.ts:openCluster`).
 */

import { bbTest } from '../../partial-engine/index';
import type { Board, Grid } from '../../partial-engine/index';
import type { UnitId } from '../contracts';
import { EngineSubstrate } from '../substrate';
import { profileOf } from '../../partial-engine/index';
import type { UnitShells } from './shells';
import { tierAtTurn } from './territory';
import type { TerritorySubject } from './territory';

// ---------------------------------------------------------------------------
// Whether the refiner runs — a BOT CONFIG choice, not an environment switch
// ---------------------------------------------------------------------------

/**
 * DOOR C IS A STRATEGY ALTERNATIVE, so it is a configured bot and not a flag.
 *
 * It used to be `CENTAUR_TERRITORY_REFINE`, process-wide with a per-engine
 * override — which is a shape the branch learned five times over is unmeasurable
 * from the environment: a process-wide switch moves every lobster seat on the
 * board at once, so a paired experiment on it measures nothing. The answer is
 * not a better switch. The answer is that the two arms are TWO BOTS:
 * `DEFAULT_BOT_CONFIG` and one that names `territoryRefine: true`, each a plain
 * data value a harness can hand to one seat (`bot-config.ts`).
 *
 * THE SHIPPED DEFAULT IS OFF (`DEFAULT_BOT_CONFIG.territoryRefine`). With it off
 * no scope is registered, no shield is built, and the evaluator is byte-for-byte
 * the one that shipped — which is what makes the default bot's identity gate a
 * statement about this seam too.
 *
 * The core redesign (§1.4) sentences the refiner to an OBSERVATION TYPE consumed
 * by socket 4; the sound tighten it publishes through is unchanged either way.
 * Until that entry exists this stays a bot-config boolean, which is the same
 * kind of thing one layer down.
 */
export const DEFAULT_TERRITORY_REFINE = false;

// ---------------------------------------------------------------------------
// The scope — what the enumeration paid for
// ---------------------------------------------------------------------------

/**
 * OUR UNITS WHOSE CLUSTER THE ENUMERATION RESOLVED THIS DECISION.
 *
 * Registered once per decision by the search, cleared with the substrate. Null
 * — the default — means the refiner does not run, which is what happens under
 * every caller that is not CL3's enumeration: the bounds harness, the memo
 * proxies, and the whole flag-off world.
 */
export interface RefineScope {
  readonly members: ReadonlySet<UnitId>;
}

const scopes = new WeakMap<EngineSubstrate, RefineScope>();

/** Register (or, with `null`, withdraw) this decision's refinement scope. */
export function setRefineScope(sub: EngineSubstrate, scope: RefineScope | null): void {
  if (scope === null || scope.members.size === 0) scopes.delete(sub);
  else scopes.set(sub, scope);
}

export function refineScopeOf(sub: EngineSubstrate): RefineScope | null {
  return scopes.get(sub) ?? null;
}

// ---------------------------------------------------------------------------
// The masked shells
// ---------------------------------------------------------------------------

/**
 * ONE HELD UNIT'S SHELLS, WITH THE SHIELD REMOVED AT ONE ABSOLUTE TURN.
 *
 * ONE turn, and that is not a shortcut being taken lightly. `cells[0..len-2]`
 * is certain at the resolved turn; a turn later the body has shifted again and
 * the argument needs the unit to have SURVIVED that turn, which is precisely
 * what a one-ply frame does not know. Masking beyond the turn the certainty
 * covers is how a refiner becomes an assumption without declaring one.
 *
 * Everything else delegates to the base shells, including `heldAtTurn` and
 * `horizonTurn`, so the sweep sees the same time window it always did.
 */
class MaskedShells implements UnitShells {
  private masked: Uint32Array[] | null = null;
  private done: boolean[] | null = null;
  private stamped: Int32Array | null = null;
  private stampedFor = -1;

  constructor(
    private readonly base: UnitShells,
    private readonly shield: Shield,
    private readonly grid: Grid
  ) {}

  get unitId(): UnitId {
    return this.base.unitId;
  }
  get heldAtTurn(): number {
    return this.base.heldAtTurn;
  }
  get horizonTurn(): number {
    return this.base.horizonTurn;
  }
  get fronts(): ReadonlyArray<Board> {
    return this.base.fronts;
  }

  frontAt(turn: number): Board | null {
    const raw = this.base.frontAt(turn);
    const k = turn - this.shield.turn;
    if (raw === null || k < 0 || k >= this.shield.boards.length) return raw;
    if (this.masked === null) {
      this.masked = this.shield.boards.map(() => new Uint32Array(this.grid.words));
      this.done = this.shield.boards.map(() => false);
    }
    const out = this.masked[k] as Uint32Array;
    // COMPUTED ONCE PER WRAPPER, not once per call. The sweep asks for every
    // turn's front on every reading of every plan, and the base fronts of a
    // HELD unit are one stable object for the whole decision — so the AND-NOT
    // is a per-decision cost and this loop must not be a per-plan one.
    if ((this.done as boolean[])[k] !== true) {
      const mask = this.shield.boards[k] as Uint32Array;
      for (let i = 0; i < out.length; i++) {
        out[i] = (((raw[i] as number) & ~(mask[i] as number)) >>> 0);
      }
      (this.done as boolean[])[k] = true;
    }
    return out;
  }

  reachesBy(cell: number, turn: number): boolean {
    const last = Math.min(turn, this.horizonTurn);
    for (let t = this.heldAtTurn; t <= last; t++) {
      const f = this.frontAt(t);
      if (f !== null && bbTest(f, cell)) return true;
    }
    return false;
  }

  /**
   * The arrival grid, re-stamped through the mask.
   *
   * The same loop `shells.ts:stampFronts` runs — smallest turn wins — because a
   * cell whose only arrival was a masked turn must fall back to the NEXT turn
   * the front covers it, and for a trail unit that is two turns later by
   * parity, not one. Subtracting the masked turns from a copied grid would give
   * `NEVER` and be wrong in the unsound direction on the ceiling side.
   *
   * `frontAt` reuses one scratch board per masked turn, so this loop reads each
   * masked front exactly once and in order — which it does.
   */
  earliest(): Int32Array {
    if (this.stamped !== null && this.stampedFor === this.base.horizonTurn) return this.stamped;
    const grid = this.grid;
    const out = new Int32Array(grid.cells);
    out.fill(NEVER_TURN);
    for (let t = this.heldAtTurn; t <= this.base.horizonTurn; t++) {
      const f = this.frontAt(t);
      if (f === null) continue;
      for (let w = 0; w < grid.words; w++) {
        let word = f[w] as number;
        const base = w << 5;
        while (word !== 0) {
          const lowest = word & -word;
          const c = base + (31 - Math.clz32(lowest));
          if ((out[c] as number) > t) out[c] = t;
          word = (word & (word - 1)) >>> 0;
        }
      }
    }
    this.stamped = out;
    this.stampedFor = this.base.horizonTurn;
    return out;
  }
}

/** `partial-engine`'s NEVER, re-declared where the stamping loop reads it. The
 * differential in `src/tests/arrival-shell-differential.ts` pins the two. */
const NEVER_TURN = 0x7fffffff;

// ---------------------------------------------------------------------------
// The shield
// ---------------------------------------------------------------------------

/** What the refiner needs about one unit, structurally — `Standing` supplies
 * it, and this file must not import `features.ts` (that way lies a cycle). */
export interface RefineSubject extends TerritorySubject {
  readonly worstAlive: boolean;
  readonly bestAlive: boolean;
  readonly tierMin: number;
  readonly weightMin: number;
}

export interface Shield {
  /**
   * `boards[k]` is the cell set certainly occupied at absolute turn `turn + k`.
   *
   * SHRINKING IN `k`, and that is the theorem rather than a safety margin. A
   * trail unit's pre-move body `P[0 .. L-1]` becomes `[h, P0 .. P_{L-2}]` after
   * one move and loses one more segment off the back per turn after that, so
   * `P[0 .. L-2-k]` is what survives to turn `turn + k` in every SURVIVING
   * continuation — and, by the pile rule, in every continuation where it dies
   * as well, since a corpse's occupancy is durable and a superset of what the
   * living body would have held. The intersection over both is the shrinking
   * suffix, and it runs out exactly when the body does.
   */
  readonly boards: ReadonlyArray<Uint32Array>;
  /** The absolute turn `boards[0]` covers. */
  readonly turn: number;
  /** Which units contributed, for telemetry and for the cache key. */
  readonly contributors: ReadonlyArray<UnitId>;
}

/**
 * HOW MANY TURNS THE SHIELD MAY COVER, when the board lets it.
 *
 * One turn is what `certainlySelfFatal`'s own claim covers, and it is immune to
 * everything: a potion collected on the move is not in force until two turns
 * later (`cloud.ts` — "a claim that has made n moves has resolved turns
 * heldAtTurn..heldAtTurn+n−1, so nothing it could have picked up can be in
 * force before n = 2"), so nothing can acquire the tier that would sever us in
 * time. Beyond one turn that immunity is gone, so the extension runs only on a
 * board carrying NO potion and NO tier at all — where nothing can ever sever
 * anything — and stops at four, which is half the reach horizon and past the
 * point where a same-parity front has re-covered whatever it lost.
 */
export const SHIELD_TURNS_MAX = 4;

/**
 * THE SHIELD, from the units the enumeration resolved.
 *
 * Four gates, and each one closes a way the certainty could be false:
 *
 *  · **IN SCOPE.** A unit CL3 did not resolve is not one this stage may spend
 *    on (the budget rule), whatever its body is doing.
 *  · **A LOCATED TRAIL UNIT.** The `cells[0..len-2]` argument is the trail
 *    unit's drag-front argument. A piece may stand still, so nothing about its
 *    occupancy next turn is certain from its position alone; and a HELD unit
 *    of ours has no located body to read.
 *  · **NOTHING OUT-TIERS IT.** A strictly higher tier severs the body and lives
 *    (`bodyPotential`), and a severed unit's cells beyond the cut are gone —
 *    so the drag-front set is no longer certain at all. On a potion-free board
 *    every tier is 0 and this gate is free; on a potion board it turns the
 *    shield off, which is the conservative direction.
 *  · **ALIVE, OR HEAVY ENOUGH THAT DYING DOES NOT MATTER.** `allyBodyCollision`
 *    names the exception exactly: *"if the team-mate dies this turn its
 *    occupancy becomes a durable pile, and a pile is settled on WEIGHT where a
 *    living body is settled on TIER alone. So a mover heavy enough to win the
 *    pile survives a cell the living body would have killed it on."*
 *
 *    TWO WAYS TO CLOSE THAT, AND TAKING ONLY THE FIRST WOULD HAVE MADE THIS
 *    STAGE A NO-OP. The obvious gate is "certainly alive in this resolution",
 *    and it is sound — but on exactly the boards Door C is for, a held enemy
 *    near enough for its cloud to swallow our body is also near enough to make
 *    that unit CONTINGENT, so the gate closes on every board that matters. The
 *    second gate is the pile rule read literally: an entrant that does not
 *    strictly out-WEIGH the pile does not win it either (`contest.ts` —
 *    survival is being the unique strict maximum, and a tie leaves nobody
 *    standing). So a unit whose weight floor is at least the weight ceiling of
 *    every held unit shields whether it lives or dies, and BOTH branches are
 *    admitted. On a same-length snake board the second is what fires.
 */
export function buildShield(
  sub: EngineSubstrate,
  subjects: ReadonlyArray<RefineSubject>,
  scope: RefineScope,
  turn: number,
  slabs: Uint32Array[],
  /** True when nothing on this board can ever acquire a severing tier. */
  quiet: boolean
): Shield | null {
  // The tier ceiling of everything else on the board, at the shield's turn, and
  // the weight ceiling of everything HELD — the two numbers the gates read.
  // Held only, for the weight: the pile rule matters against the units this
  // refinement would mask, and those are exactly the held ones.
  let othersTier = 0;
  let heldWeight = 0;
  for (const s of subjects) {
    const t = tierAtTurn(s, turn);
    if (t > othersTier) othersTier = t;
    if (s.held && s.weightMax > heldWeight) heldWeight = s.weightMax;
  }

  // Who contributes, and how deep each one's suffix runs.
  const chosen: Array<{ cells: ReadonlyArray<number>; id: UnitId }> = [];
  for (const s of subjects) {
    if (s.held || !scope.members.has(s.unitId)) continue;
    // Alive for certain, or heavy enough that a corpse-pile settles the same
    // way a living body would. See the header's fourth gate.
    if (!(s.worstAlive && s.bestAlive) && !(s.weightMin >= heldWeight)) continue;
    if (!profileOf(s.kind).leavesTrail) continue;
    // A located unit's tier is exact, so `tierMin` and `tierMax` agree; reading
    // the LOW end is the endpoint that hurts this claim, which is the right one
    // to read when the claim is what removes an opponent's option.
    if (tierAtTurn({ ...s, tierMax: s.tierMin }, turn) < othersTier) continue;
    const unit = sub.unitOf(s.unitId);
    if (unit === undefined || unit.cells.length < 2) continue;
    chosen.push({ cells: unit.cells, id: s.unitId });
  }
  if (chosen.length === 0) return null;

  // Depth: one turn always, more only where nothing can sever.
  let depth = 1;
  if (quiet && othersTier === 0) {
    let longest = 0;
    for (const c of chosen) longest = Math.max(longest, c.cells.length - 1);
    depth = Math.max(1, Math.min(SHIELD_TURNS_MAX, longest));
  }

  const boards: Uint32Array[] = [];
  const contributors: UnitId[] = [];
  for (let k = 0; k < depth; k++) {
    const out = slabs[k] as Uint32Array;
    out.fill(0);
    boards.push(out);
  }
  for (const c of chosen) {
    // `cells[0 .. len-2-k]`, index 0 INCLUDED at k = 0: the cell the head
    // vacates becomes the unit's own new neck. The tail — and only the tail —
    // pops, and one more segment goes with each further turn.
    let wrote = false;
    for (let k = 0; k < depth; k++) {
      const last = c.cells.length - 2 - k;
      if (last < 0) break;
      const out = boards[k] as Uint32Array;
      for (let i = 0; i <= last; i++) {
        const cell = c.cells[i] as number;
        out[cell >>> 5] = ((out[cell >>> 5] as number) | (1 << (cell & 31))) >>> 0;
      }
      wrote = true;
    }
    if (wrote) contributors.push(c.id);
  }
  if (contributors.length === 0) return null;
  return { boards, turn, contributors };
}

/** Does any word of the shield survive? (A contributor with a length-2 body
 * still writes one cell, so this is not implied by `contributors.length`.) */
export function shieldIsEmpty(shield: Shield): boolean {
  for (const board of shield.boards) {
    for (let i = 0; i < board.length; i++) if (board[i] !== 0) return false;
  }
  return true;
}

/** Cells the shield covers at its first turn — telemetry only. */
export function shieldCells(shield: Shield): number {
  let n = 0;
  const board = shield.boards[0] as Uint32Array;
  for (let i = 0; i < board.length; i++) {
    let word = board[i] as number;
    while (word !== 0) {
      n++;
      word = (word & (word - 1)) >>> 0;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// The masked shells map
// ---------------------------------------------------------------------------

/**
 * The shells one refined reading runs on: the base map with the units this
 * reading ADMITS AND HOLDS replaced by masked wrappers, and everything else
 * shared by reference.
 *
 * Returns null when nothing would be masked — the byte-identity path, and the
 * one that makes R3 collapse structural. A wrapper is built only when the
 * unit's flood actually meets the shield inside the horizon; a held unit three
 * rooms away costs one board test and nothing else.
 */
export function maskedShellsFor(
  base: ReadonlyMap<UnitId, UnitShells>,
  admitted: (unitId: UnitId) => boolean,
  shield: Shield,
  grid: Grid,
  into: Map<UnitId, UnitShells>,
  /** Wrappers already built for this shield. Cleared when the shield changes. */
  wrappers: Map<UnitId, UnitShells>
): ReadonlyMap<UnitId, UnitShells> | null {
  let masked = 0;
  into.clear();
  for (const [unitId, sh] of base) {
    const hit = wrappers.get(unitId);
    if (hit !== undefined) {
      into.set(unitId, hit);
      masked++;
      continue;
    }
    if (!admitted(unitId) || !touches(sh, shield)) {
      into.set(unitId, sh);
      continue;
    }
    // A HELD unit's base shells are one object for the whole decision, so the
    // wrapper — and the masked fronts and re-stamped arrival grid inside it —
    // is built once and read by every plan.
    const wrapper = new MaskedShells(sh, shield, grid);
    wrappers.set(unitId, wrapper);
    into.set(unitId, wrapper);
    masked++;
  }
  if (masked === 0) {
    into.clear();
    return null;
  }
  return into;
}

/** Does this unit's flood meet the shield at any turn the shield covers? A
 * held unit three rooms away costs a handful of word ANDs and nothing else. */
function touches(sh: UnitShells, shield: Shield): boolean {
  for (let k = 0; k < shield.boards.length; k++) {
    const front = sh.frontAt(shield.turn + k);
    if (front !== null && meets(front, shield.boards[k] as Uint32Array)) return true;
  }
  return false;
}

function meets(a: Board, b: Uint32Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if ((((a[i] as number) & (b[i] as number)) >>> 0) !== 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * What the refiner did, per decision. Telemetry and nothing else: no bound, no
 * plan, no behaviour reads it. A layer whose cost and coverage cannot be read
 * off is a layer nobody can promote, and every stage of this program has paid
 * that bill later.
 */
export interface RefineReport {
  /** Evaluations that reached the refiner at all. */
  readonly evaluations: number;
  /** Evaluations where a shield existed and something was masked, per reading. */
  readonly refinedLo: number;
  readonly refinedHi: number;
  /** Endpoints the meet actually moved. */
  readonly movedLo: number;
  readonly movedHi: number;
  /** Summed |width before| − |width after|, over `reach` and over `room`. */
  readonly narrowedReach: number;
  readonly narrowedRoom: number;
  /**
   * Evaluations where the refined and unrefined intervals were DISJOINT.
   *
   * Two sound bounds on one quantity cannot be disjoint, so this is a soundness
   * alarm and not a policy counter. It must be zero; the probe asserts it, and
   * the meet falls back to the unrefined interval so a bug here degrades to
   * "the refinement did nothing" rather than to a wrong bound.
   */
  readonly inverted: number;
  readonly shieldCells: number;
}

export class RefineCounters {
  evaluations = 0;
  refinedLo = 0;
  refinedHi = 0;
  movedLo = 0;
  movedHi = 0;
  narrowedReach = 0;
  narrowedRoom = 0;
  inverted = 0;
  shieldCells = 0;

  report(): RefineReport {
    return {
      evaluations: this.evaluations,
      refinedLo: this.refinedLo,
      refinedHi: this.refinedHi,
      movedLo: this.movedLo,
      movedHi: this.movedHi,
      narrowedReach: this.narrowedReach,
      narrowedRoom: this.narrowedRoom,
      inverted: this.inverted,
      shieldCells: this.shieldCells,
    };
  }
}

// ---------------------------------------------------------------------------
// The per-decision workspace
// ---------------------------------------------------------------------------

/**
 * Everything the refiner allocates, once per substrate — which is once per
 * DECISION, since `makeSubstrate` is per decision. The evaluator runs at ten
 * thousand plans a second and a refiner that allocated three boards per plan
 * would spend its whole budget in the collector.
 *
 * The masked-shell wrappers are cached on the SHIELD SIGNATURE (which of our
 * units contributed a body). Held units' base shells are one stable object for
 * the whole decision, and the shield changes only when a contributor's fate
 * changes between plans — so on the overwhelming majority of plans this is a
 * string compare and nothing else.
 */
export class RefineWorkspace {
  readonly shieldSlabs: Uint32Array[];
  readonly domains: { lo: Uint32Array; hi: Uint32Array };
  readonly shellsOut: { lo: Map<UnitId, UnitShells>; hi: Map<UnitId, UnitShells> };
  readonly counters = new RefineCounters();
  /** Which contributors the cached wrappers were built for. */
  key = '';
  readonly wrappers: { lo: Map<UnitId, UnitShells>; hi: Map<UnitId, UnitShells> } = {
    lo: new Map(),
    hi: new Map(),
  };

  /** Whether this board can ever grow a severing tier. Answered once. */
  quiet: boolean | null = null;

  constructor(grid: Grid) {
    this.shieldSlabs = Array.from(
      { length: SHIELD_TURNS_MAX },
      () => new Uint32Array(grid.words)
    );
    this.domains = { lo: new Uint32Array(grid.words), hi: new Uint32Array(grid.words) };
    this.shellsOut = { lo: new Map(), hi: new Map() };
  }
}

const workspaces = new WeakMap<EngineSubstrate, RefineWorkspace>();

export function refineWorkspaceFor(sub: EngineSubstrate): RefineWorkspace {
  let ws = workspaces.get(sub);
  if (ws === undefined) {
    ws = new RefineWorkspace(sub.grid);
    workspaces.set(sub, ws);
  }
  return ws;
}

/** This decision's refiner telemetry, or null when the refiner never ran. */
export function refineReportOf(sub: EngineSubstrate): RefineReport | null {
  const ws = workspaces.get(sub);
  return ws === undefined ? null : ws.counters.report();
}

// ---------------------------------------------------------------------------
// The meet
// ---------------------------------------------------------------------------

export interface MeetResult {
  readonly lo: number;
  readonly hi: number;
  /** True when the two intervals were disjoint — a soundness alarm. */
  readonly inverted: boolean;
}

/**
 * TWO SOUND INTERVALS ON ONE QUANTITY, JOINED INTO THE TIGHTEST ONE.
 *
 * `bounds/score.ts:tighten`'s rule, at the feature's own basis: the floor rises
 * to the better floor and the ceiling falls to the better ceiling. Because both
 * inputs contain the truth, so does the result — and "never a widen" is then a
 * fact about `max` and `min` rather than something a test has to catch.
 *
 * DISJOINT INPUTS ARE IMPOSSIBLE and are therefore not silently repaired: two
 * sound brackets on one number must overlap. If they do not, something upstream
 * is unsound, and the honest response is to keep the reading that was already
 * shipping, count the event, and let the probe's assertion fail loudly.
 */
export function meetIntervals(
  loA: number,
  hiA: number,
  loB: number,
  hiB: number
): MeetResult {
  const lo = Math.max(loA, loB);
  const hi = Math.min(hiA, hiB);
  if (lo > hi) return { lo: loA, hi: hiA, inverted: true };
  return { lo, hi, inverted: false };
}
