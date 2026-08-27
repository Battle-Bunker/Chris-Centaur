/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/field.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// The cloud field: every frozen unit's claim, as one immutable object shared by
// pointer across every sibling state in a search tree. DESIGN.md §3.5.
//
// A field is what makes forking cheap. Its contents depend only on which units
// are frozen and how long they have been frozen — never on what any particular
// branch of the search did — so a fork copies a pointer and nothing else. The
// derived per-cell indexes are built lazily and live on the field, so the cost
// of building them is paid once and amortized over every node that shares it.

import type { Board, Grid } from "./bitgrid.js";
import { bbAnd, bbCopy, bbForEach, bbIntersects, bbOr, bbSubset, bbTest } from "./bitgrid.js";
import type { Cloud, CloudSource, CloudTimeline, FrozenRecord, StrengthBounds } from "./cloud.js";
import { BUFF_LEVEL } from "./cloud.js";
import { cmpLex, cornerForEndpointEvaluation } from "./contest.js";
import { profileOf } from "./grammar.js";

/** One frozen unit's standing in a field. Slot index is its bit in every mask. */
export interface FieldSlot {
  readonly slot: number;
  readonly record: FrozenRecord;
  readonly timeline: CloudTimeline;
  readonly cloud: Cloud;
  /**
   * The cloud's own interval, widened for what the OTHER clouds make possible:
   * a weight floor another claim could have severed, and a tier ceiling a
   * TEAM-MATE's potion could have raised. See `build` for both derivations.
   */
  readonly bounds: StrengthBounds;
}

/** Bitmask over slot indices. At most 32 units may be frozen at once. */
export type SlotMask = number;

export const MAX_FROZEN = 32;

export class CloudField {
  readonly grid: Grid;
  /** The turn this field describes. */
  readonly turn: number;
  readonly slots: ReadonlyArray<FieldSlot>;
  /** Union over every slot — the whole-field short-circuit. */
  readonly unionPossible: Board;
  readonly unionEver: Board;
  /** Union of certain occupancy, with contested cells already demoted. */
  readonly unionCertain: Board;
  /**
   * Slots whose unit LEAVES A TRAIL, so has a body an arrival can be blocked
   * by. A fact about the field, computed once and shared by every sibling —
   * the resolver reads it once per mover and used to derive it per resolution.
   */
  readonly trailSlots: SlotMask;
  /**
   * Slots whose claim could conceivably be read as PRESENT — those whose owner
   * cannot have killed itself. It is only a candidacy: a resolution still has
   * to rule out this turn's modelled movers and the other claims (see
   * `PartialEngine.markUnconditionalClaims`). Zero here means no resolution
   * over this field need do any of that work at all, which is the common case
   * and worth one number to know.
   */
  readonly unconditionalCandidates: SlotMask;
  /**
   * THE THIRD HALF OF `deathPossible` — slots whose claim ANOTHER CLAIM could
   * have killed.
   *
   * `Cloud.deathPossible` answers from the claim's own side of the board
   * (a wall, a hazard, exhaustion, its own body) and `Resolution.mayHaveDied`
   * supplies this turn's modelled footprint. Neither can answer for a pair of
   * FROZEN claims, because a cloud is a pure function of its own record and a
   * resolution is per-branch while the overlap is not. So it lives here, on
   * the object that holds every claim of the turn at once, computed when the
   * field is built and shared by pointer with every state that reads it.
   *
   * WHY IT IS NOT A CURIOSITY. Two claims whose grammars overlap can kill each
   * other, and a tie kills BOTH. Naming only one side leaves a WIN world — the
   * one where both of them are gone — outside a ceiling that reads finite, and
   * a searcher's decisive test `hi[m] <= lo[best]` then retires that line
   * PERMANENTLY. It fires for any two held units with overlapping grammars,
   * same-team included: a king and a knight of one team sharing a square is
   * self-regicide, and the rules have no friendly-fire exemption.
   *
   * WHAT IT ASKS, per ordered pair, and it is deliberately not "do the clouds
   * overlap":
   *
   *   · HEAD TO HEAD — both arriving fronts admit one cell, and the other
   *     claim does not strictly lose there. Strength is a box, so the question
   *     is asked at the two corners the lex contest attains
   *     (`cornerForEndpointEvaluation`): this claim's lex-min against the
   *     other's lex-max. A claim that strictly beats every world of its
   *     neighbour keeps its tight ceiling; the neighbour does not.
   *   · A LIVING BODY — this claim's front admits a cell the other's body
   *     might hold, at a tier the body rule condemns. TIER ONLY: the rules'
   *     body rule is `mover.tier <= maxOwnerTier` and weight is not in it
   *     anywhere (DECISIONS 4.12).
   *
   * NOT included, because neither is a death of the claim: being severed by
   * another claim (a partial loss, already priced by the weight-floor
   * widening), and a durable corpse pile on a body cell (engine backlog 6,
   * which has no verdict anywhere yet).
   */
  readonly contestedClaims: SlotMask;

  /**
   * The field one turn on, memoized. Sibling states share a field by pointer, so
   * the first of a thousand siblings to resolve pays for the advance and the
   * rest read it — which is the whole reason a field is immutable.
   */
  private advanced: CloudField | null = null;
  private transposePossible: Uint32Array | null = null;
  private transposeEver: Uint32Array | null = null;
  private certainOwner: Uint16Array | null = null;
  /** Instrumentation: how often a lazy per-cell index actually had to be paid for. */
  transposeBuilds = 0;

  constructor(grid: Grid, turn: number, slots: ReadonlyArray<FieldSlot>) {
    for (const s of slots) {
      if (s.slot < 0 || s.slot >= MAX_FROZEN) {
        throw new Error(`frozen slot ${s.slot} outside 0..${MAX_FROZEN - 1}`);
      }
    }
    this.grid = grid;
    this.turn = turn;
    this.slots = slots;
    const w = grid.words;
    this.unionPossible = new Uint32Array(w);
    this.unionEver = new Uint32Array(w);
    this.unionCertain = new Uint32Array(w);
    let trail = 0;
    let candidates = 0;
    for (const s of slots) {
      bbOr(this.unionPossible, s.cloud.possible, w);
      bbOr(this.unionEver, s.cloud.everPossible, w);
      const bit = 1 << s.slot;
      if (profileOf(s.record.kind).leavesTrail) trail |= bit;
      if (!s.cloud.deathPossible) candidates |= bit;
    }
    this.trailSlots = trail;
    this.unconditionalCandidates = candidates;
    // Two units cannot both CERTAINLY stand on one cell, so if their claims
    // overlap at least one of them is dead. Weakening `certain` is always safe,
    // so every claimant loses the cell. DESIGN.md §3.5.
    const seen = new Uint32Array(w);
    const clash = new Uint32Array(w);
    for (const s of slots) {
      for (let i = 0; i < w; i++) {
        clash[i] = (clash[i] as number) | ((seen[i] as number) & (s.cloud.certain[i] as number));
        seen[i] = (seen[i] as number) | (s.cloud.certain[i] as number);
      }
    }
    for (let i = 0; i < w; i++) this.unionCertain[i] = (seen[i] as number) & ~(clash[i] as number);
    // One claim cannot contest itself, so a field of one is the common case
    // that pays nothing at all.
    this.contestedClaims = slots.length > 1 ? contestedAmong(grid, slots) : 0;
  }

  get size(): number {
    return this.slots.length;
  }

  get isEmpty(): boolean {
    return this.slots.length === 0;
  }

  slotOf(unitId: number): FieldSlot | undefined {
    for (const s of this.slots) if (s.record.unitId === unitId) return s;
    return undefined;
  }

  /** By slot NUMBER, which is not the array index once anything has been unfrozen. */
  bySlot(slot: number): FieldSlot | undefined {
    for (const s of this.slots) if (s.slot === slot) return s;
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Queries — the hot surface
  // -------------------------------------------------------------------------

  /**
   * Which frozen units MIGHT stand at this cell right now, as a slot mask —
   * "maybe bishop X and maybe knight Y might occupy this cell this turn".
   *
   * One array read once the transpose exists. The transpose is built lazily,
   * because a search that only asks whole-trajectory questions should not pay
   * for a per-cell index it never reads.
   */
  maybeAt(cell: number): SlotMask {
    if (this.slots.length === 0) return 0;
    const t = this.transposePossible ?? this.buildTranspose().possible;
    return t[cell] as number;
  }

  /**
   * Which frozen units might EVER have stood here since being frozen — the set
   * that matters for persistent collision objects, because a corpse keeps
   * fighting at the cell it died on. DESIGN.md §4.2 channel 5.
   */
  everAt(cell: number): SlotMask {
    if (this.slots.length === 0) return 0;
    const t = this.transposeEver ?? this.buildTranspose().ever;
    return t[cell] as number;
  }

  /** The single unit certainly standing here, or -1. */
  certainAt(cell: number): number {
    if (this.slots.length === 0) return -1;
    const owner = this.certainOwner ?? this.buildCertainOwner();
    return (owner[cell] as number) - 1;
  }

  /**
   * Which frozen units might touch ANY cell of this set — the entanglement test,
   * and the hottest operation in the system. A whole-board bitset scan, so its
   * cost is flat in trajectory length and in how saturated the clouds are.
   */
  intersecting(cells: Board): SlotMask {
    const w = this.grid.words;
    if (this.slots.length === 0 || !bbIntersects(this.unionPossible, cells, w)) return 0;
    let mask = 0;
    for (const s of this.slots) {
      if (bbIntersects(s.cloud.possible, cells, w)) mask |= 1 << s.slot;
    }
    return mask;
  }

  /** As `intersecting`, over cumulative claims — corpses included. */
  intersectingEver(cells: Board): SlotMask {
    const w = this.grid.words;
    if (this.slots.length === 0 || !bbIntersects(this.unionEver, cells, w)) return 0;
    let mask = 0;
    for (const s of this.slots) {
      if (bbIntersects(s.cloud.everPossible, cells, w)) mask |= 1 << s.slot;
    }
    return mask;
  }

  /** Whether anything at all is uncertain about this cell set. One word scan. */
  anyUncertainty(cells: Board): boolean {
    return this.slots.length !== 0 && bbIntersects(this.unionEver, cells, this.grid.words);
  }

  /** Whether anything at all is uncertain about ONE cell. One bit test. */
  anyUncertaintyAt(cell: number): boolean {
    return this.slots.length !== 0 && bbTest(this.unionEver, cell);
  }

  // -------------------------------------------------------------------------
  // Structural operations — all O(slots) pointer work
  // -------------------------------------------------------------------------

  /** The same frozen units, read at a later turn. */
  advanceTo(turn: number): CloudField {
    const memo = this.advanced;
    if (memo !== null && memo.turn === turn) return memo;
    const next =
      this.slots.length === 0
        ? new CloudField(this.grid, turn, this.slots)
        : build(this.grid, turn, this.members());
    if (turn === this.turn + 1) this.advanced = next;
    return next;
  }

  /** This field plus one more frozen unit, in the lowest free slot. */
  withHeld(source: CloudSource, record: FrozenRecord, turn: number): CloudField {
    return this.withHeldMany(source, [record], turn);
  }

  /**
   * This field plus several frozen units, assembled ONCE. Freezing a whole
   * opposing side is the archetypal use, and doing it one unit at a time rebuilds
   * the field k times for a k-unit side — quadratic in exactly the case a search
   * hits most.
   */
  withHeldMany(
    source: CloudSource,
    records: ReadonlyArray<FrozenRecord>,
    turn: number,
  ): CloudField {
    if (records.length === 0) return this;
    const taken = new Set(this.slots.map((s) => s.slot));
    const added: Member[] = [];
    let slot = 0;
    for (const record of records) {
      while (taken.has(slot)) slot++;
      if (slot >= MAX_FROZEN) throw new Error(`at most ${MAX_FROZEN} units may be frozen at once`);
      taken.add(slot);
      added.push({ slot, record, timeline: source.timelineFor(record) });
    }
    return build(this.grid, turn, [...this.members(), ...added]);
  }

  /**
   * This field minus one unit — what unfreezing costs the field: O(slots).
   *
   * Slot NUMBERS are stable across this: a caller holding a slot mask (the
   * per-branch "certainty I no longer trust" word) must not have it silently
   * re-point at a different unit.
   */
  without(unitId: number): CloudField {
    const kept = this.members().filter((m) => m.record.unitId !== unitId);
    if (kept.length === this.slots.length) return this;
    return build(this.grid, this.turn, kept);
  }

  /**
   * Replace one unit's claim with a claim NARROWED to the given first-move
   * destinations — an ASSUMPTION the caller owns, recorded on the claim's
   * basis so it can never be mistaken for a proof. REFUSES any widening: the
   * narrowed possibility set must be a subset of the free one at this field's
   * own turn (monotone refinement — delta §5). The unit's claim version is
   * bumped, so every branch sharing the interned claim sees the refinement.
   */
  withNarrowed(
    source: CloudSource,
    unitId: number,
    destinations: ReadonlyArray<number>,
  ): CloudField {
    const slot = this.slotOf(unitId);
    if (slot === undefined) throw new Error(`unit ${unitId} is not frozen in this field`);
    const record: FrozenRecord = { ...slot.record, narrowedTo: [...destinations] };
    const timeline = source.timelineFor(record);
    const n = this.turn - record.heldAtTurn;
    const narrowed = timeline.at(Math.max(0, n));
    const free = slot.timeline.at(Math.max(0, n));
    if (!bbSubset(narrowed.possible, free.possible, this.grid.words)) {
      throw new Error(
        `narrowing unit ${unitId} WIDENED its claim — a narrowing may only shrink (monotone refinement)`,
      );
    }
    source.bumpClaimVersion(unitId);
    const members = this.members().map((m) =>
      m.record.unitId === unitId ? { slot: m.slot, record, timeline } : m,
    );
    return build(this.grid, this.turn, members);
  }

  /**
   * The units whose claims rest on a caller's narrowing — the field's
   * ASSUMPTION SET. A field with an empty assumption set makes absolute
   * claims; otherwise every claim is conditional on these units choosing
   * within their narrowed sets, and bounds built over it must carry the same
   * basis (delta §4: basis identity).
   */
  assumptions(): ReadonlyArray<number> {
    const out: number[] = [];
    for (const s of this.slots) {
      if (s.cloud.basis === "narrowed") out.push(s.record.unitId);
    }
    return out.sort((a, b) => a - b);
  }

  private members(): Member[] {
    return this.slots.map((s) => ({ slot: s.slot, record: s.record, timeline: s.timeline }));
  }

  // -------------------------------------------------------------------------

  private buildTranspose(): { possible: Uint32Array; ever: Uint32Array } {
    const possible = new Uint32Array(this.grid.cells);
    const ever = new Uint32Array(this.grid.cells);
    const w = this.grid.words;
    for (const s of this.slots) {
      const bit = 1 << s.slot;
      bbForEach(s.cloud.possible, w, (c) => {
        possible[c] = (possible[c] as number) | bit;
      });
      bbForEach(s.cloud.everPossible, w, (c) => {
        ever[c] = (ever[c] as number) | bit;
      });
    }
    this.transposePossible = possible;
    this.transposeEver = ever;
    this.transposeBuilds++;
    return { possible, ever };
  }

  private buildCertainOwner(): Uint16Array {
    const owner = new Uint16Array(this.grid.cells);
    const w = this.grid.words;
    const scratch = new Uint32Array(w);
    for (const s of this.slots) {
      bbCopy(scratch, s.cloud.certain, w);
      bbAnd(scratch, this.unionCertain, w);
      bbForEach(scratch, w, (c) => {
        owner[c] = s.slot + 1;
      });
    }
    this.certainOwner = owner;
    return owner;
  }
}

/**
 * Assemble a field from records and their timelines, reading each cloud at the
 * requested turn and widening every strength interval for what the OTHER
 * clouds make possible. Two widenings live here, and both are here for the
 * same reason: they are facts about a PAIR of claims, and a cloud is a pure
 * function of its own record.
 *
 * WEIGHT FLOOR — a trail unit whose claim overlaps another frozen unit's may
 * have been severed by it while nobody was watching, and a sever the field
 * cannot see is weight the field cannot vouch for. Pieces are not severed —
 * they die — so they keep their floor.
 *
 * TIER CEILING — a potion COLLECTOR takes the debuff and every other living
 * member of its team takes the buff (game-engine/team-potion-effects), so the
 * thing that can raise a held unit's tier is never its own reach: it is a
 * TEAM-MATE's. `Cloud.couldCollectPotion` is the per-unit half of that
 * question, and this is the only place a field-wide answer may be assembled
 * from it — combining tier intervals across team-mates is exactly what the
 * per-unit-marginal rule forbids a CONSUMER to do, and the reason it forbids
 * it is that the combination has to happen once, here, where every claim of
 * the team is in hand.
 *
 * The widening is deliberately coarse in the one direction that is sound: it
 * asks only WHETHER a team-mate could have collected, never how many times,
 * because one collection is the whole effect (replace semantics) and a second
 * changes nothing. It is exactly inert on a potion-free board, where no cloud
 * ever sets the flag.
 *
 * WHAT IT STILL DOES NOT SEE, recorded so nobody reads more into it than it
 * says: a MODELLED team-mate of a held unit — a mover this branch is
 * simulating — can collect a potion too, and its buff reaches the held unit on
 * the turn after the one being resolved. That is outside the field entirely
 * (the field is the frozen half of the board), and it cannot affect the
 * resolution the field was built for, because a collection at turn U first
 * governs a contest at U+1. A consumer that carries a claim forward across its
 * own collection re-observes it; one that does not, holds a ceiling that is
 * low by one level for as long as it does not.
 */
interface Member {
  readonly slot: number;
  readonly record: FrozenRecord;
  readonly timeline: CloudTimeline;
}

function build(grid: Grid, turn: number, members: ReadonlyArray<Member>): CloudField {
  const w = grid.words;
  const clouds: Cloud[] = members.map((m) => m.timeline.at(turn - m.record.heldAtTurn));
  // Only a trail unit can be severed, and only by something else that is frozen,
  // so with fewer than two frozen units nothing can widen and the O(K²) scan is
  // skipped entirely.
  const canWiden = members.length > 1 && members.some((m) => profileOf(m.record.kind).leavesTrail);
  // Likewise for the tier ceiling: it takes a second claim, on the same team,
  // that could have collected. Nothing on a potion-free board sets the flag, so
  // this is a cheap `some` and then no scan at all.
  const anyCollector = members.length > 1 && clouds.some((c) => c.couldCollectPotion);
  const slots: FieldSlot[] = members.map((m, i) => {
    const cloud = clouds[i] as Cloud;
    let bounds = cloud.bounds;
    if (canWiden && profileOf(m.record.kind).leavesTrail) {
      for (let j = 0; j < clouds.length; j++) {
        if (j === i) continue;
        if (bbIntersects(cloud.everPossible, (clouds[j] as Cloud).everPossible, w)) {
          bounds = { ...bounds, weightMin: 1 };
          break;
        }
      }
    }
    if (anyCollector && bounds.tierMax < BUFF_LEVEL) {
      for (let j = 0; j < clouds.length; j++) {
        if (j === i) continue;
        if (members[j]?.record.team !== m.record.team) continue;
        if (!(clouds[j] as Cloud).couldCollectPotion) continue;
        bounds = { ...bounds, tierMax: BUFF_LEVEL };
        break;
      }
    }
    return { slot: m.slot, record: m.record, timeline: m.timeline, cloud, bounds };
  });
  return new CloudField(grid, turn, slots);
}

/**
 * `CloudField.contestedClaims` — see its docblock for what the question is and
 * why it is asked here. This is the shape of the answer.
 *
 * O(K²) over slots, with a bitboard intersection as the gate on each pair and
 * an early break as soon as one killer is found, so the real cost is closer to
 * O(K) on the boards where nothing overlaps. Held-held pairs are the term that
 * grows — 15 pairs at five held units, 120 at sixteen — which is why the
 * strength comparison is a pair of integer compares behind an intersection
 * test rather than anything per cell.
 *
 * A claim that is CERTAINLY GONE is skipped as a victim: every reader takes
 * `certainlyGone` first and never consults the mask for it. It is NOT skipped
 * as a killer — a unit that starves at end of turn still moved, still arrived,
 * and a head-to-head tie there kills its opponent just the same.
 */
function contestedAmong(grid: Grid, slots: ReadonlyArray<FieldSlot>): SlotMask {
  const w = grid.words;
  let mask = 0;
  for (const victim of slots) {
    if (victim.cloud.certainlyGone) continue;
    const front = victim.cloud.headPossible;
    // The lex contest is antitone, so this claim is safe from another exactly
    // when its WEAKEST world still strictly beats the other's STRONGEST.
    const weakest = cornerForEndpointEvaluation(victim.bounds.tierMin, victim.bounds.weightMin);
    for (const other of slots) {
      if (other.slot === victim.slot) continue;
      let killed = false;
      if (bbIntersects(front, other.cloud.headPossible, w)) {
        const strongest = cornerForEndpointEvaluation(other.bounds.tierMax, other.bounds.weightMax);
        killed = cmpLex(weakest, strongest) <= 0;
      }
      if (
        !killed &&
        profileOf(other.record.kind).leavesTrail &&
        victim.bounds.tierMin <= other.bounds.tierMax &&
        bbIntersects(front, other.cloud.bodyPossible, w)
      ) {
        killed = true;
      }
      if (killed) {
        mask |= 1 << victim.slot;
        break;
      }
    }
  }
  return mask;
}

export function emptyField(grid: Grid, turn: number): CloudField {
  return new CloudField(grid, turn, []);
}

/**
 * THE TEAM-UNION ARRIVAL GRID (bot-workstream demand): per-cell minimum of
 * `earliest` and `minCost` over one team's frozen units, written into dense
 * caller-owned typed arrays (heuristics iterate these at every leaf — Map
 * overhead is material at their rates). Cells no unit of the team reaches
 * keep the NEVER sentinel. Returns how many units contributed.
 */
export function teamArrivalInto(
  field: CloudField,
  team: number,
  horizonTurn: number,
  dstEarliest: Int32Array,
  dstMinCost: Int32Array,
): number {
  const cells = field.grid.cells;
  dstEarliest.fill(0x7fffffff, 0, cells);
  dstMinCost.fill(0x7fffffff, 0, cells);
  let contributed = 0;
  for (const s of field.slots) {
    if (s.record.team !== team) continue;
    contributed++;
    const g = s.timeline.arrival(horizonTurn);
    for (let c = 0; c < cells; c++) {
      const e = g.earliest[c] as number;
      if (e < (dstEarliest[c] as number)) dstEarliest[c] = e;
      const m = g.minCost[c] as number;
      if (m < (dstMinCost[c] as number)) dstMinCost[c] = m;
    }
  }
  return contributed;
}

/** Whether a specific frozen unit might be at a cell — the direct path, no transpose. */
export function slotMaybeAt(field: CloudField, slot: number, cell: number): boolean {
  const s = field.bySlot(slot);
  return s !== undefined && bbTest(s.cloud.possible, cell);
}

/** Test/inspection helper: the cells a slot might occupy, as a plain list. */
export function slotCells(field: CloudField, slot: number): number[] {
  const s = field.bySlot(slot);
  if (s === undefined) return [];
  const out: number[] = [];
  bbForEach(s.cloud.possible, field.grid.words, (c) => out.push(c));
  return out;
}

/** Every frozen unit that might be at this cell, by unit id. Cold path. */
export function maybeUnitsAt(field: CloudField, cell: number): number[] {
  const mask = field.maybeAt(cell);
  const out: number[] = [];
  for (const s of field.slots) if ((mask & (1 << s.slot)) !== 0) out.push(s.record.unitId);
  return out;
}
