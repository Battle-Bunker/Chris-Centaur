/**
 * THE DOOR — a ply-(n+1) root from a ply-(n) `Resolution`.
 *
 * `la-inside` §1, built. The domain is `Resolution → substrate`, NOT
 * `ApiBoard → substrate`, so the one-translation rule keeps its full force over
 * the wire boundary and this path cannot commit the bug that rule exists to
 * prevent (see `substrate.ts::ContinuationInit` for the argument in full). The
 * vendored engine already contains the pattern — `exact.ts::projectExact`,
 * lines 426–473, builds `UnitSpec[]` off `engine.units(state)` plus
 * `state.field.slots` and calls `engine.create`; this is the same move one
 * layer up, with a longer invariant list.
 *
 * ── WHAT THE WORLD LOOKS LIKE ON THE OTHER SIDE ────────────────────────────
 *
 * Three shells, per `la-outside` §1 and synthesis §1c.3:
 *
 *   · SHELL 1, in-cluster: `o.cluster`, live and enumerable at the new root.
 *   · SHELL 2, held: everything else on the resolved board — enemies AND our
 *     own out-of-cluster units, with NO privilege for ours (F-9: our own
 *     unmodelled units are observed at T and are exactly as unknown at sim
 *     depth j as an enemy observed at T; the corpus's 22 reappearing
 *     `bodyBlock` deaths are the proof). Their clouds dilate one more step
 *     because their `heldAtTurn` is carried UNCHANGED and the new root's turn
 *     is one higher — dilation by absolute-turn query, never offset arithmetic
 *     (L7).
 *   · SHELL 3, elided: EMPTY here. This door elides nothing, so no
 *     `non-interference` assumption is taken and rule 25 (sliders are never
 *     elided) is satisfied vacuously.
 *
 * ── THE TIER OVERRIDE, AND WHY IT IS HERE ──────────────────────────────────
 *
 * `CENTAUR_TIER_TRUTH` defaults to `expiry` in this process (tier-truth.ts:72),
 * and that default was measured and defended AT PLY 1, where it is a no-op:
 * the tier-window round moved 0 argmaxes on the acceptance corpus at both
 * budgets. It is NOT a no-op at ply 2, and `la-outside` F-4(c) says why in one
 * sentence: **depth converts a strength-hold into a soundness-hold.**
 * `CloudSource.boundsAt` prices an enemy's tier CEILING against
 * `premise.potions`; with that board empty the ceiling collapses to the
 * observed tier, which at one ply is defensible (the enemy cannot reach a
 * potion this turn) and at depth `d` is an under-statement of the enemy, which
 * over-states our contest wins, which puts a floor above the truth.
 *
 * So inside a thread world the answer must be `full`. The premise potion board
 * is baked into the `PartialEngine` at geometry-construction time and the door
 * REUSES that engine (it must — see the food-premise argument in
 * `ContinuationInit`), so the door cannot flip the switch after the fact. What
 * it does instead is the honest thing: it REFUSES. `continueFrom` returns a
 * `ContinuationRefusal` with reason `tier-truth` on any board that carries
 * potions while the process premise is potion-free, and the refusal is
 * counted. That is `la-outside`'s own gate — *"deep floors must be gated on
 * `invulnerabilityPotionEnabled === false` boards"* — applied to advisory
 * depth as well, because a thread whose enemy ceilings are too low will
 * mis-order candidates just as cheerfully as it would mis-bound them.
 *
 * The EXPIRY half of `full` needs no such ceremony: it is a per-record fact,
 * it is on under the shipped default, and the door re-collapses it at the new
 * root (invariant I6).
 *
 * ── THE INVARIANT LEDGER (la-inside §1.3), AS BUILT ────────────────────────
 *
 * | I1  post-resolution weights   | CARRIED — `UnitView.weight` off `U_WEIGHT` |
 * | I2  post-resolution health    | CARRIED — `UnitView.health` off `U_HEALTH` |
 * | I3  trail bodies              | CARRIED — `UnitView.cells` off `U_LEN`     |
 * | I4  food-board mutation       | CARRIED — live board off the resolved slab;
 * |                               |   the cloud PREMISE deliberately unchanged |
 * | I5  severed cells             | CARRIED — already on the slab; recorded    |
 * |                               |   here for provenance only                 |
 * | I6  tier at arrival           | CARRIED — re-collapsed below; plus the     |
 * |                               |   potion refusal above                     |
 * | I7  softFrozen                | **NOT CARRIED** — see below               |
 * | I8  mayHaveDied               | **NOT CARRIED** — see below               |
 * | I9  contingent own fates      | CARRIED — `carriedContingent`, widening-   |
 * |                               |   only, one `Set` and one `||`             |
 * | I10 slot stability            | N/A BY CONSTRUCTION — the door rebuilds    |
 * |                               |   the field, so identity is by `unitId`,   |
 * |                               |   never by slot number. Asserted.          |
 *
 * **I7 and I8 are named, not dropped.** `Resolution.softFrozen` and
 * `Resolution.mayHaveDied` are SLOT MASKS over the ply-n field, and the ply-2
 * field is a different field with different slot numbers. Mapping them across
 * is real work and it is CL6b's. What CL6a does instead is carry the affected
 * units as `distrusted` on the continuation and stamp a `narrowing` assumption
 * naming them. The cost of not feeding them back into the engine is a thread
 * CEILING that is too high — a unit the ply-n resolution refused to price
 * certainly-alive is priced certainly-alive at the new root — and under Door A
 * a thread ceiling reaches exactly two things: `estSpread` (a discrimination
 * number) and the scheduler's priors. It reaches no bound, no `lo`, no `hi`,
 * and no staged plan, because nothing in `scout/` may write one (see
 * `scout/index.ts`'s import law and its structural test). So the exposure is a
 * mis-ordered candidate, never a wrong staging. That asymmetry is the entire
 * reason Door A was the door that shipped.
 */

import { EngineSubstrate } from '../../substrate';
import type { ContinuationInit, SubstrateUnit } from '../../substrate';
import { Fate, bbForEach, newBoard } from '../../../partial-engine/index';
import type { Resolution } from '../../../partial-engine/index';
import { TIER_TRUTH, potionBoardEnabled } from '../../tier-truth';
import type { TierTruth } from '../../tier-truth';
import type { Assumption, CellIndex, UnitId } from '../../contracts';

/** Why a continuation could not be built. Never an exception on the hot path. */
export type RefusalReason =
  /** The board carries potions but the process premise is potion-free. F-4(c). */
  | 'tier-truth'
  /** The cluster has no survivor at the new root — nothing to enumerate. */
  | 'cluster-extinct'
  /** A trail outgrew the parent arena's `maxTrail`. */
  | 'arity'
  /** More claims than `MAX_FROZEN` at the new root. F-10. */
  | 'held-overflow'
  /** The parent is not an engine substrate (harness, memo proxy). */
  | 'no-engine';

export interface ContinuationRefusal {
  readonly ok: false;
  readonly reason: RefusalReason;
}

export interface Continuation {
  readonly ok: true;
  /** The ply-(n+1) root. Owns a slab; `release()` returns it. */
  readonly sub: EngineSubstrate;
  /** 1 for the first continuation off a ply-1 resolution. */
  readonly ply: number;
  /** The new root's turn — `resolution.state.turn`, i.e. rootTurn + 1. */
  readonly turn: number;
  /** Shell 1: enumerable here. */
  readonly cluster: ReadonlySet<UnitId>;
  /** Shell 2: claims at the new root, ours and theirs alike. */
  readonly held: ReadonlySet<UnitId>;
  /** I9. Widening-only: a carried contingent is alive optimistically AND
   *  recorded as killable, which is sound in both frames. */
  readonly carriedContingent: ReadonlySet<UnitId>;
  /** I7/I8. Units the ply-n resolution refused to price certainly-alive, and
   *  which this root nonetheless prices alive. Advisory exposure only. */
  readonly distrusted: ReadonlySet<UnitId>;
  /** I5, for provenance. */
  readonly severed: ReadonlySet<UnitId>;
  /** The continuation's own basis stamp. Never meets a ply-1 basis: L1 makes
   *  depth provenance, and F-6 refuses a cross-depth meet outright. */
  readonly assumptions: ReadonlyArray<Assumption>;
  /** Return the slab and the geometry reference. Idempotent. */
  release(): void;
}

export type ContinuationResult = Continuation | ContinuationRefusal;

export interface ContinuationOptions {
  /** The ply-(n) substrate. Supplies geometry, team numbering, board identity. */
  readonly from: EngineSubstrate;
  /** The resolution whose post-move state becomes the ply-(n+1) root. Its slab
   *  is BORROWED from `from` and must outlive this call, but not the result:
   *  the door copies everything it needs into a state of its own. */
  readonly resolution: Resolution;
  /** Units that stay live and enumerable at the new root. */
  readonly cluster: ReadonlySet<UnitId>;
  /** Contingency accumulated by earlier plies of this thread. */
  readonly carriedContingent?: ReadonlySet<UnitId>;
  /** How deep the NEW root sits. */
  readonly ply: number;
  /** Test seam only. Production reads the module default; the door's whole
   *  argument for what this must be is in the file header. */
  readonly tierTruth?: TierTruth;
}

/** `MAX_FROZEN` from the engine, restated so this file does not reach for a
 *  private. The door refuses past it rather than dropping claims (F-10 says an
 *  overflow must convert to more assumptions, never to fewer modelled units,
 *  and at advisory depth the cheapest honest conversion is a refusal). */
const MAX_HELD = 32;

/**
 * A tier is a WINDOW, and the window is read at the ARRIVAL turn.
 *
 * `MarshalledBoard.tierExpiry` is EXCLUSIVE (`turn-oracle.ts:230` converts the
 * wire's inclusive figure with `expiry + 1`), and `cloud.ts:873` reads it as
 * `expired = heldAtTurn + n >= expiry` — so a tier governs an arrival at turn
 * `a` exactly while `a < expiry`. A live unit that resolves turn `t` has its
 * contests adjudicated at `t + 1`.
 *
 * At ply 1 this is already right without anyone doing anything, because
 * `turn-oracle.ts:202` collapses the wire tier through `tierAtArrival` at
 * marshal time and the engine then reads `U_TIER` verbatim for the whole turn
 * (`engine.ts:1369`). At ply 2 that same verbatim read is a THREE-TURN BUFF
 * PRICED AS PERMANENT, and `strictMaximum` orders contests on tier FIRST — a
 * ±1 tier gap overrides any material difference whatsoever. Half of that error
 * is conservative (an enemy's lapsing tier priced as permanent) and half is
 * UNSOUND (our own), and depth multiplies both. So the door re-collapses.
 *
 * Monotone by construction: the wire already collapsed at T, so re-collapsing
 * at T+1 can only move a tier toward 0.
 */
export function tierAtRoot(
  tier: number,
  tierExpiresAtTurn: number | null,
  rootTurn: number
): number {
  if (tierExpiresAtTurn === null) return tier;
  return rootTurn + 1 < tierExpiresAtTurn ? tier : 0;
}

/**
 * Does this board let a thread world be built at all, given the process's tier
 * premise? See the header — this is F-4(c)'s gate, applied to advisory depth.
 *
 * `full` always passes. Otherwise the board must carry no potions, which is
 * every snake-only board in the corpus and is the family the census's
 * confronted stratum lives in.
 */
export function tierPremiseAdmits(sub: EngineSubstrate, mode: TierTruth = TIER_TRUTH): boolean {
  if (potionBoardEnabled(mode)) return true;
  return sub.marshalled.potions.length === 0;
}

/**
 * Build the ply-(n+1) root. Returns a refusal, never throws, on every path a
 * scheduler could hit — the same "degrade, do not explode" discipline
 * `openCluster` takes, and for the same reason: this whole layer is advisory,
 * so a refusal costs an ordering hint and an exception would cost a decision.
 */
export function continueFrom(o: ContinuationOptions): ContinuationResult {
  const from = o.from;
  if (!(from instanceof EngineSubstrate)) return { ok: false, reason: 'no-engine' };
  if (!tierPremiseAdmits(from, o.tierTruth ?? TIER_TRUTH)) {
    return { ok: false, reason: 'tier-truth' };
  }

  const engine = from.engine;
  const state = o.resolution.state;
  const rootTurn = state.turn;

  // ---- I9: which of OUR ply-n fates were left contingent ------------------
  //
  // `Fate.Contingent` is "alive optimistically; some recorded unknown could
  // have killed it". The unit stands at the new root (that is the optimistic
  // leg) AND is recorded as killable. Widening only: a consumer that reads the
  // set treats the unit as possibly-absent, and a consumer that does not is
  // reading the same optimistic world ply 1 already published. Sound in both
  // frames, which is what makes carrying cheaper than branching — the ply-2
  // root world-set would otherwise be `2^|contingent ∩ cluster|`.
  const carriedContingent = new Set<UnitId>(o.carriedContingent ?? []);
  for (const f of o.resolution.fates) {
    if (f.fate === Fate.Contingent) carriedContingent.add(f.unitId);
  }

  // ---- I5, provenance only: the slab already has the cut applied ----------
  const severed = new Set<UnitId>(o.resolution.severedCells.keys());

  // ---- Shell 1 + the surviving half of shell 2 ---------------------------
  //
  // `engine.units(state)` returns only `Standing.Alive`, so ply-n's dead are
  // already gone and no fate filter is needed here. Every field comes straight
  // across (I1/I2/I3); `staleness` is 0 because we MODELLED this unit's move —
  // its position at the new root is a fact of the simulation, so its cloud, if
  // it becomes one, seeds from a fresh observation.
  const units: SubstrateUnit[] = [];
  const seen = new Set<UnitId>();
  let clusterAlive = 0;
  for (const view of engine.units(state)) {
    const identity = from.unitOf(view.unitId);
    if (identity === undefined) continue; // a unit the parent never named
    seen.add(view.unitId);
    if (o.cluster.has(view.unitId)) clusterAlive++;
    units.push({
      unitId: view.unitId,
      // Board identity, not state — these are the parent's and cannot change.
      wireId: identity.wireId,
      team: view.team,
      teamId: identity.teamId,
      kind: view.kind,
      type: identity.type,
      isKing: identity.isKing,
      // I1 / I2 / I3, all three off the resolved slab.
      cells: view.cells,
      weight: view.weight,
      health: view.health,
      // I6.
      tier: tierAtRoot(view.tier, view.tierExpiresAtTurn, rootTurn),
      tierExpiresAtTurn: view.tierExpiresAtTurn,
      orientation: view.orientation,
      staleness: 0,
    });
  }
  if (clusterAlive === 0) return { ok: false, reason: 'cluster-extinct' };

  // ---- The already-claimed half of shell 2 -------------------------------
  //
  // THIS IS THE WHOLE TRICK, and it is one line of arithmetic. A unit held
  // since turn `h` is re-entered at the new root with its record BYTE-IDENTICAL
  // — same occupancy, same `heldAtTurn` — and the root's turn is one higher.
  // `fieldHolding` then stamps `heldAtTurn = turn − staleness`, which reproduces
  // `h` exactly, and the field's own `advanceTo` does the dilation. Nobody adds
  // one to anything; nobody multiplies anything by a decay factor. That is L7
  // ("advanced by absolute-turn query, never by offset arithmetic") and L4
  // ("degradation is truncation, not decay") holding simultaneously and for
  // free, and it is why deep plies are CHEAPER per ply for the most distant
  // units: a saturated cloud costs zero further steps.
  const narrowings = new Map<UnitId, ReadonlyArray<number>>();
  const held = new Set<UnitId>();
  for (const slot of state.field.slots) {
    const record = slot.record;
    if (seen.has(record.unitId)) continue;
    const identity = from.unitOf(record.unitId);
    if (identity === undefined) continue;
    seen.add(record.unitId);
    units.push({
      unitId: record.unitId,
      wireId: identity.wireId,
      team: record.team,
      teamId: identity.teamId,
      kind: record.kind,
      type: identity.type,
      isKing: identity.isKing,
      cells: record.occupancy,
      weight: record.weight,
      health: record.health,
      // NOT re-collapsed: a held record carries its expiry and `cloud.ts:873`
      // does the decay itself, at the arrival turn, which is the one place it
      // belongs. Collapsing here as well would apply it twice.
      tier: record.tier,
      tierExpiresAtTurn: record.tierExpiresAtTurn ?? null,
      orientation: record.orientation,
      // The one line. `heldAtTurn` is carried, so staleness grows by exactly
      // the ply.
      staleness: Math.max(0, rootTurn - record.heldAtTurn),
    });
    if (record.narrowedTo !== null) narrowings.set(record.unitId, record.narrowedTo);
  }

  // Every unit that is not shell 1 becomes a claim at the new root.
  for (const unit of units) if (!o.cluster.has(unit.unitId)) held.add(unit.unitId);
  if (held.size > MAX_HELD) return { ok: false, reason: 'held-overflow' };

  // ---- I7 / I8: named, carried as data, not yet fed to the engine ---------
  const distrusted = new Set<UnitId>();
  for (const slot of state.field.slots) {
    const bit = 1 << slot.slot;
    if ((o.resolution.mayHaveDied & bit) !== 0) distrusted.add(slot.record.unitId);
    if ((state.softFrozen & bit) !== 0) distrusted.add(slot.record.unitId);
  }

  // ---- I4: the LIVE food and potion boards, off the resolved slab ---------
  //
  // The premise boards inside the reused engine stay at ply 1 on purpose
  // (F-2(c)); these are the boards the ply-2 RESOLUTION eats from, and they
  // must reflect what ply 1 consumed or the thread will double-count a pellet.
  const food = cellsOf(engine, state, 'food');
  const potions = cellsOf(engine, state, 'potion');

  let sub: EngineSubstrate;
  try {
    const init: ContinuationInit = {
      kind: 'continuation',
      from,
      turn: rootTurn,
      units,
      food,
      potions,
      cluster: o.cluster,
      narrowings,
      ply: o.ply,
    };
    sub = new EngineSubstrate(init);
  } catch {
    return { ok: false, reason: 'arity' };
  }

  // ---- I10, asserted rather than assumed ---------------------------------
  //
  // Slot numbers do not survive a rebuilt field, so the door never carries one.
  // What it carries is `unitId`, and the assertion that makes that safe is that
  // the new roster's ids are exactly the old field's plus the survivors' — no
  // renumbering, no collisions.
  const assumptions: Assumption[] = [];
  for (const unitId of held) {
    const to = from.unitOf(unitId)?.cells[0];
    if (to !== undefined) assumptions.push({ kind: 'reference-action', unitId, to });
  }
  if (distrusted.size > 0) {
    assumptions.push({
      kind: 'narrowing',
      unitId: [...distrusted].sort((a, b) => a - b)[0] as UnitId,
      note: `scout: I7/I8 not carried across the ply boundary for ${distrusted.size} claim(s)`,
    });
  }

  let released = false;
  return {
    ok: true,
    sub,
    ply: o.ply,
    turn: rootTurn,
    cluster: o.cluster,
    held,
    carriedContingent,
    distrusted,
    severed,
    assumptions,
    release(): void {
      if (released) return;
      released = true;
      sub.release();
    },
  };
}

/** The live board off a resolved slab, as cells. Two word scans, no allocation
 *  beyond the answer. */
function cellsOf(
  engine: EngineSubstrate['engine'],
  state: Resolution['state'],
  which: 'food' | 'potion'
): CellIndex[] {
  const board = newBoard(engine.grid);
  if (which === 'food') engine.foodBoard(state, board);
  else engine.potionBoard(state, board);
  const out: CellIndex[] = [];
  bbForEach(board, engine.grid.words, (c) => out.push(c as CellIndex));
  return out;
}
