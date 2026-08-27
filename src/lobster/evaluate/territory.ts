/**
 * TERRITORY — the two-plane partition, on the engine's own dilation shells.
 *
 * ── WHY TWO PLANES ─────────────────────────────────────────────────────────
 *
 * An argmin over EVERY kind's arrival is a fiction, and it is measurably one: a
 * held slider's `earliest` is `turn + 1` along its whole line, computed per cell
 * INDEPENDENTLY, so one enemy queen concedes the board. Measured on a mixed
 * board at horizon 4: our side soundly owned 0.4 cells of 121 and the floor sat
 * pinned at −1 — a term that costs throughput and returns no gradient.
 *
 * The relaxation is only tight for a unit whose front really is a front. So the
 * board is partitioned by TRAIL UNITS, and pieces do not divide it — they
 * DISPLACE:
 *
 *   PLANE 1  D(c) = min over admitted trail units of arrival_u(c). The unique
 *            argmin's team owns c; a tie owns nothing (NEUTRAL, and it expands
 *            nothing, because nobody got there first).
 *   PLANE 2  a piece p takes c off its owner iff arrival_p(c) ≤ D(c) AND p wins
 *            the stationary contest at D(c) — tier projected onto D, then
 *            strictly greater weight, through the resolver's own comparator.
 *            An inconclusive contest leaves the trail claim standing.
 *
 * Gating a piece's claim on the contest only ever REMOVES claims, and a removed
 * enemy claim raises `lo` — legitimate exactly because the claim exists in no
 * world: in any world where the piece stands on c at D and loses the contest,
 * the resolver says it does not hold c. Held enemies enter that contest at their
 * strongest admissible endpoint (`weightMax`, best tier), which is what keeps
 * the removal on the pessimistic side.
 *
 * ── AND WHAT PIECES CANNOT DO: DIVIDE GROUND NOBODY WALKS ──────────────────
 *
 * A cell no admitted trail unit reaches is counted for NOBODY. The doctrine
 * this transplants decides such cells among the pieces by earliest arrival, and
 * that was measured degenerate here for the same reason the all-kinds fold is:
 * a held enemy is a turn behind us on the clock, so its one-move cloud already
 * covers the board while ours starts from where we actually landed, and every
 * unwalked cell goes to whoever moved last. On a real mixed board that was 31
 * cells of 121 handed over for free, on top of a plane-1 reading that was
 * healthy (31 ours / 53 theirs / 6 tied).
 *
 * Ignoring them is a NARROWER claim than making them, so it stays sound: a
 * cell no admitted trail unit reaches is not reached by any enemy trail unit at
 * its OPTIMISTIC arrival either, so no world turns it into theirs — only our
 * own held teammates, becoming located, can bring it into the count, and they
 * bring it in on our side. Under refinement it behaves the same way round.
 * A piece-only board therefore scores zero territory rather than a fiction,
 * which is what it is worth.
 *
 * ── THE SWEEP ──────────────────────────────────────────────────────────────
 *
 * Plane 1 is not `units × cells` integer compares. It is set cover over the
 * horizon's handful of turns, on the boards the timelines already hold:
 *
 *     c is ours  ⟺  ourEarliest(c) < theirEarliest(c)
 *                ⟺  ∃t : c ∈ ourCum(t) ∧ c ∉ theirCum(t)
 *
 * where `Cum(t)` is the running OR of that side's arriving fronts. Both sides
 * are BOARDS, so the fold is word ops over 6–8 words across 5–8 turns. The same
 * sweep yields the PER-UNIT ownership planes for free, because it already walks
 * every unit's front at every turn.
 *
 * ── THE TIE RULE, AND WHY IT IS NOT SYMMETRIC ──────────────────────────────
 *
 * Per-unit ownership is "u arrives strictly before every other admitted unit,
 * teammates included" — with ONE exemption: a HELD teammate that merely TIES
 * does not take the cell away. Without the exemption the feature is not
 * refinement-monotone, and the counterexample is small: two held enemies tie at
 * a cell, so neither owns it; narrow one of them and the other suddenly does,
 * which RAISES the enemy's room and drops our floor on a refinement. With the
 * exemption a narrowing can only ever shrink the narrowed unit's own plane. The
 * exemption is gated on `held`, so with nothing held it vanishes and the two
 * readings coincide — R3 collapse, by construction rather than by luck.
 */

import {
  NEVER,
  bbPopcount,
  cmpLex,
  profileOf,
} from '../../partial-engine/index';
import type { Grid, Scalar, Terrain } from '../../partial-engine/index';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { DenseRanker, Int32Column, SlabPool, Uint8Column } from '../scratch';
import { WasmArena } from '../wasm/arena';
import { wasmModeFor } from '../wasm/policy';
import type { UnitShells } from './shells';
import { ShellTable } from './shells';

/** A standing the partition can read. Structural, so `features.ts` owns it. */
export interface TerritorySubject {
  readonly unitId: UnitId;
  readonly team: number;
  readonly kind: number;
  readonly held: boolean;
  readonly weightMax: number;
  readonly tierMax: number;
  readonly tierExpiresAtTurn: number | null;
}

/** Which units each side admits, in one reading. */
export interface Admission<S> {
  ours(s: S): boolean;
  theirs(s: S): boolean;
}

export interface TrailRoom<S> {
  readonly subject: S;
  readonly mine: boolean;
  /** Cells this unit alone reaches first, on plane 1. */
  readonly owned: number;
}

export interface Partition<S> {
  /** `(ours − theirs) / open`, after displacement. */
  readonly balance: number;
  readonly ours: number;
  readonly theirs: number;
  readonly open: number;
  readonly trails: ReadonlyArray<TrailRoom<S>>;
  /**
   * THE TRAIL DOMAIN, as a board: every cell some admitted trail unit reaches
   * inside the horizon — plane 2's whole arena, since a cell outside it is
   * counted for nobody. It falls out of the sweep (it is `coveredPrev` at the
   * last turn), and `commandFeature` reads it to ask what CONTESTED ground a
   * piece can act on. Empty when nothing that leaves a trail is admitted.
   *
   * Owned by the caller's slab, not the workspace's: the two readings are
   * cached side by side on one context, so a shared scratch board would have
   * the second reading silently overwrite the first's.
   */
  readonly domain: Uint32Array;
  /**
   * Every non-wall cell — the substrate's own slab, read-only. A consumer that
   * restricts itself to `domain` needs this the moment `domain` is EMPTY: a
   * team whose last trail unit died contests no ground on plane 1, and a term
   * that reads only plane-1 ground would go silently blind exactly there. On a
   * piece-only position the pieces are the whole contest.
   */
  readonly openBoard: Uint32Array;
}

/** Nobody admitted: no ground is claimed either way, and `open` is still the
 * board's, so a consumer dividing by it does not meet a zero. */
const emptyPartition = <S>(
  open: number,
  domain: Uint32Array,
  openBoard: Uint32Array
): Partition<S> => {
  domain.fill(0);
  return { balance: 0, ours: 0, theirs: 0, open, trails: [], domain, openBoard };
};

/** The invulnerability tier a unit still carries at an absolute turn. */
export function tierAtTurn(s: TerritorySubject, turn: number): number {
  if (s.tierExpiresAtTurn !== null && turn >= s.tierExpiresAtTurn) return 0;
  return s.tierMax;
}

// ---------------------------------------------------------------------------
// Reusable scratch — the evaluator is inside the engine's slab discipline now
// ---------------------------------------------------------------------------

/** A `Scalar` this file OWNS and overwrites. Never published; see `strengths`. */
interface MutableScalar {
  tier: number;
  weight: number;
}

/**
 * Every slab this file needs, allocated once per substrate. The fold used to
 * allocate four `Int32Array(cells)` per evaluation at roughly ten thousand
 * evaluations a second; reusing them was worth 15–27% of plan throughput on its
 * own, measured across four board/roster shapes.
 *
 * W2 EXTENSION — the ENTRY COLUMNS. The classification step used to build one
 * `{s, sh, mine, scalars: []}` object per admitted unit per reading, and
 * `fillScalars` then pushed one `Scalar` per unit PER HORIZON TURN into those
 * arrays: on the profiled board that is ~24 entry objects, 24 arrays and ~144
 * `Scalar`s per reading, twice per evaluation, at ten thousand evaluations a
 * second. All of it is now flat typed-array columns indexed by entry slot, plus
 * a reused `Scalar` pool that never escapes this module. Measured: see
 * `scratchpad/perf-w2-report.md`.
 */
export class TerritoryWorkspace {
  readonly grid: Grid;
  readonly table: ShellTable;
  readonly notWall: Uint32Array;
  readonly open: number;

  readonly ourCum: Uint32Array;
  readonly theirCum: Uint32Array;
  readonly ourStep: Uint32Array;
  readonly theirStep: Uint32Array;
  readonly oursBoard: Uint32Array;
  readonly theirsBoard: Uint32Array;
  readonly coveredPrev: Uint32Array;
  readonly coveredNow: Uint32Array;
  readonly newT: Uint32Array;
  readonly hit: Uint32Array;
  readonly others: Uint32Array;
  /** Per-team `seen` / `multi` over the non-held-teammate subset. */
  readonly seenByTeam: Uint32Array[] = [];
  readonly multiByTeam: Uint32Array[] = [];
  /** Where the two above come from, so the arena gets them under the flag. */
  private readonly mkU32: (n: number) => Uint32Array;
  /** Per-admitted-trail-unit ownership planes, grown on demand. */
  private readonly planes: SlabPool<Uint32Array>;
  /** Decisive turn per cell. Only filled when a piece could displace. */
  readonly decisive: Int32Array;
  /**
   * One trail-domain board PER READING. Two boards rather than one because a
   * context caches both partitions and hands both out; a single scratch board
   * would let the second reading rewrite the first's answer.
   */
  private readonly domains: { lo: Uint32Array; hi: Uint32Array };
  /** Scratch for the resolved food board — one evaluation runs at a time. */
  readonly foodOut: Uint32Array;

  // --- entry columns, one slot per ADMITTED unit of the current reading ----
  /** The subject at each entry slot. Typed at the use site; see `partitionOf`. */
  readonly entSubject: unknown[] = [];
  /** The shells at each entry slot. */
  readonly entShells: (UnitShells | null)[] = [];
  /** `earliest()` grid at each entry slot — a POINTER, never a copy. */
  readonly entEarliest: (Int32Array | null)[] = [];
  private readonly entMineCol: Uint8Column;
  private readonly entHeldCol: Uint8Column;
  private readonly entTeamCol: Int32Column;
  private readonly trailCol: Int32Column;
  private readonly pieceCol: Int32Column;
  private readonly teamCol: Int32Column;
  /** Contest strength RANKS, flat: `[slot * turns + (t - tMin)]`. */
  private readonly rankCol: Int32Column;
  /** Batch indices of a slot's two distinct strengths: `[slot*2 + expired?]`.
   * Read only by `fillRanks`, never by a kernel, so it stays on the heap. */
  private readonly strengthIdxCol: Int32Column;
  /**
   * A reused `Scalar` per (slot, expired?) — the ONLY objects the contest
   * comparator ever sees, and they never leave this module.
   */
  private readonly strengths: MutableScalar[] = [];
  readonly ranker = new DenseRanker<Scalar>();
  /** `displace`'s second count. A returned pair would be an allocation on the
   * hottest path in the system; this is the same value, one field over. */
  displacedTheirs = 0;
  /** The same, for the wasm arm, which cannot return a pair either. */
  displacedOurs = 0;

  // --- the WASM arm (CENTAUR_WASM=on) --------------------------------------
  /**
   * The linear memory every slab above is a VIEW onto, or null when this
   * workspace runs the JS path. See `lobster/wasm/arena.ts`.
   */
  readonly arena: WasmArena | null;
  /** Descriptor block the kernels read their arguments out of. */
  private readonly desc: Int32Array | null;
  /** Byte offset of each entry slot's resident `earliest()` grid. */
  private readonly earliestOffCol: Int32Column;
  /** Per-unit pointers the kernel hoists out of the cell walk. */
  private readonly hoistCol: Int32Column;
  /** `sweepTurn`'s descriptor, and the pointer tables it indexes through. */
  private readonly sweepDesc: Int32Array | null;
  private readonly sweepDescPtr: number;
  private readonly frontRowCol: Int32Column;
  private readonly planePtrCol: Int32Column;
  private readonly seenPtrCol: Int32Column;
  private readonly multiPtrCol: Int32Column;
  private readonly ownedCol: Int32Column;
  private readonly pairCol: Int32Column;
  /** The trail units whose fronts are resident, for the turn loop. */
  private readonly sweepFronts: (Uint32Array | null)[] = [];

  /**
   * THE RESIDENCY CHECK, and why it runs per partition rather than once.
   *
   * Every buffer the kernel reads is asked for its pointer, and a single −1
   * sends the whole partition down the JS path. Most of them cannot move — the
   * bitboards and `decisive` are allocated once in the constructor — but three
   * genuinely can: the entry columns double when a roster outgrows them, the
   * caller supplies the domain board, and a unit's arrival grid is a heap array
   * whenever the arena had no room for it.
   *
   * MEASURED: `pointerOf` is 1.07% of a one-second decision's self time
   * (`scratchpad/w3bench/prof-on.txt`), against a whole-decision gain of ~10%.
   * So caching the immovable two thirds is worth roughly 0.7 points — a tenth
   * of the win — in exchange for a cache that goes stale silently and hands the
   * kernel a pointer into a buffer nobody owns any more. Not taken; recorded so
   * the next person does not have to re-derive the size of it.
   */
  private readonly descPtr: number;

  /**
   * Telemetry, and the only way to tell an arm that RAN from an arm that
   * silently declined. `refused` counts partitions that had an arena and still
   * took the JS path because something was not resident — nonzero means the
   * measurement is not measuring what its name says.
   */
  wasmRuns = 0;
  wasmRefused = 0;
  wasmSweepRuns = 0;
  wasmSweepRefused = 0;

  get entMine(): Uint8Array {
    return this.entMineCol.array;
  }
  get entHeld(): Uint8Array {
    return this.entHeldCol.array;
  }
  get entTeam(): Int32Array {
    return this.entTeamCol.array;
  }
  get trailSlots(): Int32Array {
    return this.trailCol.array;
  }
  get pieceSlots(): Int32Array {
    return this.pieceCol.array;
  }
  get teamList(): Int32Array {
    return this.teamCol.array;
  }
  get ranks(): Int32Array {
    return this.rankCol.array;
  }

  /** Grow every per-entry column to `n` slots. */
  ensureEntries(n: number): void {
    this.entMineCol.ensure(n);
    this.entHeldCol.ensure(n);
    this.entTeamCol.ensure(n);
    this.trailCol.ensure(n);
    this.pieceCol.ensure(n);
    this.teamCol.ensure(n);
    while (this.entSubject.length < n) {
      this.entSubject.push(null);
      this.entShells.push(null);
      this.entEarliest.push(null);
    }
  }

  /** Grow the flat rank column to `slots × turns`. */
  ensureRanks(n: number): Int32Array {
    return this.rankCol.ensure(n);
  }

  /** Grow the strength-index column to `slots × 2`. */
  ensureStrengthIndex(n: number): Int32Array {
    return this.strengthIdxCol.ensure(n);
  }

  /**
   * Run plane 2 in WebAssembly, or answer false when anything it reads is not
   * resident in the arena. False is not a failure — it is the JS path, which is
   * the source of truth and always available.
   *
   * On success `ours` is returned in `displacedOurs` and `theirs` in
   * `displacedTheirs`, exactly where the JS kernel leaves them.
   */
  wasmDisplace(
    slots: number,
    nT: number,
    nP: number,
    asTeam: number,
    tMin: number,
    turns: number,
    domain: Uint32Array
  ): boolean {
    if (this.arena === null) return false;
    const ok = this.runWasmDisplace(slots, nT, nP, asTeam, tMin, turns, domain);
    if (ok) this.wasmRuns++;
    else this.wasmRefused++;
    return ok;
  }

  private runWasmDisplace(
    slots: number,
    nT: number,
    nP: number,
    asTeam: number,
    tMin: number,
    turns: number,
    domain: Uint32Array
  ): boolean {
    const a = this.arena;
    const d = this.desc;
    if (a === null || d === null) return false;
    const pDomain = a.pointerOf(domain);
    const pDecisive = a.pointerOf(this.decisive);
    const pRanks = a.pointerOf(this.ranks);
    const pTeam = a.pointerOf(this.entTeam);
    const pTrail = a.pointerOf(this.trailSlots);
    const pPiece = a.pointerOf(this.pieceSlots);
    const pOurs = a.pointerOf(this.oursBoard);
    const pTheirs = a.pointerOf(this.theirsBoard);
    if (
      pDomain < 0 ||
      pDecisive < 0 ||
      pRanks < 0 ||
      pTeam < 0 ||
      pTrail < 0 ||
      pPiece < 0 ||
      pOurs < 0 ||
      pTheirs < 0
    ) {
      return false;
    }
    const offs = this.earliestOffCol.ensure(slots);
    const pOffs = a.pointerOf(offs);
    // 5 hoisted i32 per unit: two for trails, three for pieces (see the kernel).
    const hoist = this.hoistCol.ensure(5 * slots + 8);
    const pHoist = a.pointerOf(hoist);
    if (pOffs < 0 || pHoist < 0) return false;
    for (let e = 0; e < slots; e++) {
      const p = a.pointerOf(this.entEarliest[e]);
      if (p < 0) return false;
      offs[e] = p;
    }
    const L = a.layout;
    d[L['D_WORDS'] as number] = this.grid.words;
    d[L['D_CELLS'] as number] = this.grid.cells;
    d[L['D_NT'] as number] = nT;
    d[L['D_NP'] as number] = nP;
    d[L['D_TURNS'] as number] = turns;
    d[L['D_TMIN'] as number] = tMin;
    d[L['D_AS_TEAM'] as number] = asTeam;
    d[L['D_DOMAIN'] as number] = pDomain;
    d[L['D_DECISIVE'] as number] = pDecisive;
    d[L['D_RANKS'] as number] = pRanks;
    d[L['D_EARLIEST'] as number] = pOffs;
    d[L['D_ENT_TEAM'] as number] = pTeam;
    d[L['D_TRAIL_SLOTS'] as number] = pTrail;
    d[L['D_PIECE_SLOTS'] as number] = pPiece;
    d[L['D_OURS_BOARD'] as number] = pOurs;
    d[L['D_THEIRS_BOARD'] as number] = pTheirs;
    d[L['D_SCRATCH'] as number] = pHoist;
    a.kernels.displace(this.descPtr);
    this.displacedOurs = d[L['D_OUT_OURS'] as number] as number;
    this.displacedTheirs = d[L['D_OUT_THEIRS'] as number] as number;
    return true;
  }

  /**
   * PLANE 1 IN WASM — prepare, or decline.
   *
   * Everything the sweep touches has to be resident, and one of them is not a
   * workspace slab at all: each trail unit's arriving FRONTS are boards a
   * vendored `CloudTimeline` owns. `residentFronts()` copies them into the arena
   * once per `Shells` object — the same trade the arrival grids make, and the
   * reason the sweep can move at all.
   *
   * Returns false without touching a single byte of state, so the JS loop that
   * follows starts from exactly the state it would have started from.
   */
  wasmSweepPrepare(nT: number, nTeams: number, needDecisive: boolean): boolean {
    if (this.arena === null) return false;
    const ok = this.runSweepPrepare(nT, nTeams, needDecisive);
    if (ok) this.wasmSweepRuns++;
    else this.wasmSweepRefused++;
    return ok;
  }

  private runSweepPrepare(nT: number, nTeams: number, needDecisive: boolean): boolean {
    const a = this.arena;
    const d = this.sweepDesc;
    if (a === null || d === null || nT === 0) return false;
    const trailSlots = this.trailSlots;
    const frontsOf = this.sweepFronts;
    while (frontsOf.length < nT) frontsOf.push(null);
    for (let k = 0; k < nT; k++) {
      const sh = this.entShells[trailSlots[k] as number] as UnitShells;
      const flat = sh.residentFronts();
      if (flat === null || a.pointerOf(flat) < 0) return false;
      frontsOf[k] = flat;
    }
    const planePtr = this.planePtrCol.ensure(nT);
    const pPlanes = a.pointerOf(planePtr);
    if (pPlanes < 0) return false;
    for (let k = 0; k < nT; k++) {
      const p = a.pointerOf(this.planeFor(k));
      if (p < 0) return false;
      planePtr[k] = p;
    }
    const teams = this.seenByTeam.length;
    const seenPtr = this.seenPtrCol.ensure(teams);
    const multiPtr = this.multiPtrCol.ensure(teams);
    const pSeen = a.pointerOf(seenPtr);
    const pMulti = a.pointerOf(multiPtr);
    if (pSeen < 0 || pMulti < 0) return false;
    for (let t = 0; t < teams; t++) {
      const s = a.pointerOf(this.seenByTeam[t]);
      const m = a.pointerOf(this.multiByTeam[t]);
      if (s < 0 || m < 0) return false;
      seenPtr[t] = s;
      multiPtr[t] = m;
    }
    const rows = this.frontRowCol.ensure(nT);
    const pRows = a.pointerOf(rows);
    const pMine = a.pointerOf(this.entMine);
    const pHeld = a.pointerOf(this.entHeld);
    const pTeam = a.pointerOf(this.entTeam);
    const pTrail = a.pointerOf(this.trailSlots);
    const pTeamList = a.pointerOf(this.teamList);
    const pDecisive = a.pointerOf(this.decisive);
    if (
      pRows < 0 ||
      pMine < 0 ||
      pHeld < 0 ||
      pTeam < 0 ||
      pTrail < 0 ||
      pTeamList < 0 ||
      pDecisive < 0
    ) {
      return false;
    }
    const L = a.layout;
    d[L['S_WORDS'] as number] = this.grid.words;
    d[L['S_NT'] as number] = nT;
    d[L['S_NTEAMS'] as number] = nTeams;
    d[L['S_NEED_DECISIVE'] as number] = needDecisive ? 1 : 0;
    d[L['S_FRONT_ROWS'] as number] = pRows;
    d[L['S_ENT_MINE'] as number] = pMine;
    d[L['S_ENT_HELD'] as number] = pHeld;
    d[L['S_ENT_TEAM'] as number] = pTeam;
    d[L['S_TRAIL_SLOTS'] as number] = pTrail;
    d[L['S_TEAM_LIST'] as number] = pTeamList;
    d[L['S_SEEN_ROWS'] as number] = pSeen;
    d[L['S_MULTI_ROWS'] as number] = pMulti;
    d[L['S_PLANE_ROWS'] as number] = pPlanes;
    d[L['S_OUR_CUM'] as number] = a.pointerOf(this.ourCum);
    d[L['S_THEIR_CUM'] as number] = a.pointerOf(this.theirCum);
    d[L['S_OUR_STEP'] as number] = a.pointerOf(this.ourStep);
    d[L['S_THEIR_STEP'] as number] = a.pointerOf(this.theirStep);
    d[L['S_OURS_BOARD'] as number] = a.pointerOf(this.oursBoard);
    d[L['S_THEIRS_BOARD'] as number] = a.pointerOf(this.theirsBoard);
    d[L['S_COVERED_PREV'] as number] = a.pointerOf(this.coveredPrev);
    d[L['S_NEW_T'] as number] = a.pointerOf(this.newT);
    d[L['S_HIT'] as number] = a.pointerOf(this.hit);
    d[L['S_OTHERS'] as number] = a.pointerOf(this.others);
    d[L['S_DECISIVE'] as number] = pDecisive;
    // These are constructor slabs; a −1 among them would mean the arena ran out
    // during construction, which the columns above would already have caught.
    for (let i = L['S_OUR_CUM'] as number; i <= (L['S_OTHERS'] as number); i++) {
      if ((d[i] as number) < 0) return false;
    }
    return true;
  }

  /** One absolute turn of the resident sweep. `wasmSweepPrepare` must have run. */
  wasmSweepAt(turn: number, nT: number): void {
    const a = this.arena as WasmArena;
    const d = this.sweepDesc as Int32Array;
    const L = a.layout;
    const rows = this.frontRowCol.array;
    const w = this.grid.words;
    for (let k = 0; k < nT; k++) {
      const sh = this.entShells[this.trailSlots[k] as number] as UnitShells;
      const i = turn - sh.heldAtTurn;
      const flat = this.sweepFronts[k] as Uint32Array;
      rows[k] = i < 0 || i >= sh.fronts.length ? 0 : flat.byteOffset + i * w * 4;
    }
    d[L['S_TURN'] as number] = turn;
    a.kernels.sweepTurn(this.sweepDescPtr);
  }

  /** `owned[k]` and the domain board, from the planes the sweep just wrote. */
  wasmFoldPlanes(nT: number, domain: Uint32Array): Int32Array | null {
    const a = this.arena;
    if (a === null) return null;
    const owned = this.ownedCol.ensure(Math.max(1, nT));
    const pOwned = a.pointerOf(owned);
    const pPlanes = a.pointerOf(this.planePtrCol.array);
    const pNotWall = a.pointerOf(this.notWall);
    const pCovered = a.pointerOf(this.coveredPrev);
    const pDomain = a.pointerOf(domain);
    if (pOwned < 0 || pPlanes < 0 || pNotWall < 0 || pCovered < 0 || pDomain < 0) return null;
    a.kernels.foldPlanes(pPlanes, nT, this.grid.words, pNotWall, pOwned, pCovered, pDomain);
    return owned;
  }

  /** `ours`/`theirs` when nothing displaces. Leaves them in `displaced*`. */
  wasmCountSides(): boolean {
    const a = this.arena;
    if (a === null) return false;
    const pair = this.pairCol.ensure(2);
    const pPair = a.pointerOf(pair);
    const pOurs = a.pointerOf(this.oursBoard);
    const pTheirs = a.pointerOf(this.theirsBoard);
    const pNotWall = a.pointerOf(this.notWall);
    if (pPair < 0 || pOurs < 0 || pTheirs < 0 || pNotWall < 0) return false;
    a.kernels.countSides(pOurs, pTheirs, pNotWall, this.grid.words, pPair);
    this.displacedOurs = pair[0] as number;
    this.displacedTheirs = pair[1] as number;
    return true;
  }

  /** The `i`-th pooled strength, overwritten in place. */
  strengthAt(i: number, tier: number, weight: number): Scalar {
    while (this.strengths.length <= i) this.strengths.push({ tier: 0, weight: 0 });
    const s = this.strengths[i] as MutableScalar;
    s.tier = tier;
    s.weight = weight;
    return s as Scalar;
  }

  domainFor(reading: 'lo' | 'hi'): Uint32Array {
    return this.domains[reading];
  }

  constructor(grid: Grid, terrain: Terrain, capacity: number, arena: WasmArena | null = null) {
    this.grid = grid;
    this.arena = arena;
    const u32 = (n: number): Uint32Array => arena?.allocU32(n) ?? new Uint32Array(n);
    const i32 = (n: number): Int32Array => arena?.allocI32(n) ?? new Int32Array(n);
    const colI32 = arena === null ? null : (n: number): Int32Array | null => arena.allocI32(n);
    const colU8 = arena === null ? null : (n: number): Uint8Array | null => arena.allocU8(n);
    this.table = new ShellTable(
      grid,
      capacity,
      arena === null
        ? null
        : {
            grid: (cells) => arena.allocI32(cells),
            fronts: (count, wds) => arena.allocU32(count * wds),
          }
    );
    const w = grid.words;
    this.notWall = u32(w);
    for (let i = 0; i < w; i++) {
      this.notWall[i] = ((grid.full[i] as number) & ~(terrain.wall[i] as number)) >>> 0;
    }
    this.open = bbPopcount(this.notWall, w);
    this.ourCum = u32(w);
    this.theirCum = u32(w);
    this.ourStep = u32(w);
    this.theirStep = u32(w);
    this.oursBoard = u32(w);
    this.theirsBoard = u32(w);
    this.coveredPrev = u32(w);
    this.coveredNow = u32(w);
    this.newT = u32(w);
    this.hit = u32(w);
    this.others = u32(w);
    this.decisive = i32(grid.cells);
    this.domains = { lo: u32(w), hi: u32(w) };
    this.foodOut = u32(w);
    this.planes = new SlabPool<Uint32Array>(w, u32);
    this.mkU32 = u32;
    this.entMineCol = new Uint8Column(64, colU8);
    this.entHeldCol = new Uint8Column(64, colU8);
    this.entTeamCol = new Int32Column(64, colI32);
    this.trailCol = new Int32Column(64, colI32);
    this.pieceCol = new Int32Column(64, colI32);
    this.teamCol = new Int32Column(16, colI32);
    this.rankCol = new Int32Column(512, colI32);
    this.strengthIdxCol = new Int32Column(128);
    this.earliestOffCol = new Int32Column(64, colI32);
    this.hoistCol = new Int32Column(320, colI32);
    this.frontRowCol = new Int32Column(64, colI32);
    this.planePtrCol = new Int32Column(64, colI32);
    this.seenPtrCol = new Int32Column(16, colI32);
    this.multiPtrCol = new Int32Column(16, colI32);
    this.ownedCol = new Int32Column(64, colI32);
    this.pairCol = new Int32Column(4, colI32);
    this.sweepDesc = arena === null ? null : arena.allocI32(DESC_SLOTS);
    this.sweepDescPtr = arena === null ? -1 : arena.pointerOf(this.sweepDesc);
    this.desc = arena === null ? null : arena.allocI32(DESC_SLOTS);
    this.descPtr = arena === null ? -1 : arena.pointerOf(this.desc);
  }

  planeFor(index: number): Uint32Array {
    return this.planes.at(index);
  }

  /** Grow the per-team slabs to cover `team`, then read them directly. Two
   * accessors rather than one returning a pair: a pair is an allocation, and
   * this is called once per team per unit per horizon turn. */
  ensureTeam(team: number): void {
    while (this.seenByTeam.length <= team) {
      this.seenByTeam.push(this.mkU32(this.grid.words));
      this.multiByTeam.push(this.mkU32(this.grid.words));
    }
  }

  /** The shells map handed to one evaluation. Reused: one evaluation runs at a
   * time, and a fresh Map per plan is pure garbage at ten thousand a second. */
  readonly shellsOut = new Map<UnitId, UnitShells>();
}

const workspaces = new WeakMap<EngineSubstrate, TerritoryWorkspace>();

/** Descriptor slots reserved in the arena. `D_LEN` is 19 today. */
const DESC_SLOTS = 64;

/**
 * How many `Shells` objects get a resident arrival grid before the rest fall
 * back to the heap.
 *
 * MEASURED, not chosen. A one-second decision creates SEVEN OR EIGHT
 * workspaces, not one — the evaluator runs on `withModelled` siblings and each
 * gets its own — and across them 611 distinct `Shells`, i.e. 46–142 each, with
 * no evictions (`scratchpad/w3bench/shellstats.js`, `wscount.js`). 256 is ~1.8×
 * the worst of those per workspace, which at 625 cells reserves 640 KB of
 * arrival grids against ~220 KB actually used.
 *
 * The reservation is what costs, not the use: the memory cannot grow (see
 * `wasm/arena.ts`), so it is committed at construction. Seven arenas a decision
 * is the number to keep an eye on, and it is why this is 256 and not 4 096 —
 * see the RSS column in `scratchpad/perf-w3-report.md`.
 */
const RESIDENT_SHELLS = 256;

/** Horizon turns budgeted per resident front block. The shipped profile is 4–8. */
const MAX_RESIDENT_TURNS = 12;

/** The arena is refused outright past this, and the workspace runs JS. */
const MAX_ARENA_BYTES = 64 * 1024 * 1024;

/** Bytes an arena needs for one grid: the slabs, the columns, the grids. */
export function arenaBytesFor(grid: Grid, roster: number): number {
  const w = grid.words;
  const slots = Math.max(64, roster * 2);
  const boards = 15 * w * 4; // the fixed bitboards, plus both domains and foodOut
  const planes = (slots + 16 * 2) * w * 4; // ownership planes + seen/multi per team
  const decisive = grid.cells * 4;
  // entMine/entHeld are bytes; the six i32 columns are slots wide; the rank
  // column is slots × turns and the hoist column 5 × slots. Doubling means a
  // column can be allocated twice, so this is the sum of a geometric series.
  const columns = 2 * (slots * 2 + slots * 10 * 4 + slots * 32 * 4 + slots * 5 * 4 + DESC_SLOTS * 8);
  const grids = RESIDENT_SHELLS * grid.cells * 4;
  // The arriving fronts, laid flat per `Shells`. `MAX_RESIDENT_TURNS` is a
  // ceiling on a horizon, not the horizon: an evaluator that asks for more just
  // overruns the budget and degrades, which is what the refusal counter is for.
  const fronts = RESIDENT_SHELLS * MAX_RESIDENT_TURNS * w * 4;
  return boards + planes + decisive + columns + grids + fronts;
}

/**
 * The workspace for a substrate — which is the decision's scope, because a
 * substrate is built per decision and released with it. The shell table's
 * capacity is sized to the decision's own working set (Σ over units of legal
 * destinations), not to a constant somebody else picked.
 *
 * The WASM ARENA is decided here, once, and never again for this substrate: the
 * slabs below are VIEWS onto its memory, so a mode flip after the fact would
 * mean rebuilding them underneath live readers. `wasmModeFor` answers what the
 * decision pinned when it built the substrate (see `wasm/policy.ts`); an arena
 * that cannot be made — no WebAssembly, a grid too big for the cap — leaves
 * `arena` null and every kernel takes the JS path.
 */
export function workspaceFor(sub: EngineSubstrate): TerritoryWorkspace {
  let ws = workspaces.get(sub);
  if (ws === undefined) {
    const roster = sub.roster().length;
    let arena: WasmArena | null = null;
    if (wasmModeFor(sub) === 'on') {
      const bytes = arenaBytesFor(sub.grid, roster);
      if (bytes <= MAX_ARENA_BYTES) arena = WasmArena.make(bytes);
      // The kernel's `NEVER` and the engine's must be the same integer, or a
      // cell that is unreachable to one is turn 2 147 483 647 to the other.
      if (arena !== null && arena.never !== NEVER) arena = null;
    }
    ws = new TerritoryWorkspace(sub.grid, sub.terrain, Math.max(256, roster * 64), arena);
    workspaces.set(sub, ws);
  }
  return ws;
}

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

/**
 * THE ENTRY COLUMNS, and why there is no `Entry` object any more.
 *
 * The classification step assigns every admitted unit an ENTRY SLOT, and every
 * per-unit fact the two planes read lives in a flat typed-array column of the
 * workspace at that slot: `entTeam`, `entMine`, `entHeld`, the `earliest()`
 * POINTER, and the contest-strength ranks. `trailSlots[0..nT)` and
 * `pieceSlots[0..nP)` are the two subsets, in subject order — the same order
 * the two `Entry[]` arrays used to be built in, which is what keeps the
 * per-unit ownership planes and `Partition.trails` byte-identical.
 *
 * What is deliberately NOT flattened: the `earliest()` grids themselves. The
 * prototype's fastest JS arm copied all of them into one contiguous buffer and
 * measured 1.41× — but it did the copying OUTSIDE the timed region. At ~23
 * admitted units on a 625-cell board that copy is ~57 KB per reading, which is
 * bigger than the whole win. The grids stay where the shell table already put
 * them and only the small columns are flattened. (A WASM port that keeps the
 * grids resident in linear memory ACROSS evaluations is a different trade, and
 * is where that arm's number becomes real.)
 *
 * ── STRENGTH RANKS, NOT A PACKED KEY ───────────────────────────────────────
 *
 * `displace` compares unit strengths through the resolver's lexicographic
 * comparator, on `Scalar` objects this file used to allocate one of per unit
 * PER HORIZON TURN. They are now dense integer RANKS over the handful of
 * distinct strengths on the board, so the inner loop compares two int32s.
 *
 * The ranks are computed BY CALLING `cmpLex` — not by bit-packing
 * `(tier << 16) | weight`. Packing is a hair faster still, but it silently
 * assumes both coordinates are small non-negative integers and `contest.ts`
 * promises nothing of the sort: it is a restatement of the contest, which is
 * the one thing that file's header forbids. Ranking is exact for ANY total
 * preorder, so a weight that goes fractional or a tier that goes negative
 * changes nothing here, and the comparator stays the resolver's own.
 */

/**
 * One reading's partition: plane 1 by sweep, then plane 2 where pieces exist.
 *
 * `asTeam` decides `mine`; `admit` decides who is on the board at all. Nothing
 * here branches on a kind NAME — `leavesTrail` is a property the rules read.
 */
export function partitionOf<S extends TerritorySubject>(
  ws: TerritoryWorkspace,
  subjects: ReadonlyArray<S>,
  shells: ReadonlyMap<UnitId, UnitShells>,
  asTeam: number,
  admit: Admission<S>,
  /** Where this reading's trail domain is written. One per reading — see
   * `Partition.domain`. Defaults to a fresh board for callers that ignore it. */
  domain: Uint32Array = new Uint32Array(ws.grid.words)
): Partition<S> {
  const grid = ws.grid;
  const w = grid.words;

  ws.ensureEntries(subjects.length);
  const entSubject = ws.entSubject;
  const entShells = ws.entShells;
  const entEarliest = ws.entEarliest;
  const entMine = ws.entMine;
  const entHeld = ws.entHeld;
  const entTeam = ws.entTeam;
  const trailSlots = ws.trailSlots;
  const pieceSlots = ws.pieceSlots;

  let nT = 0;
  let nP = 0;
  let slots = 0;
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (let si = 0; si < subjects.length; si++) {
    const s = subjects[si] as S;
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    const mine = s.team === asTeam;
    if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;
    if (sh.heldAtTurn < tMin) tMin = sh.heldAtTurn;
    if (sh.horizonTurn > tMax) tMax = sh.horizonTurn;
    entSubject[slots] = s;
    entShells[slots] = sh;
    entEarliest[slots] = null;
    entMine[slots] = mine ? 1 : 0;
    entHeld[slots] = s.held ? 1 : 0;
    entTeam[slots] = s.team;
    if (profileOf(s.kind).leavesTrail) trailSlots[nT++] = slots;
    else pieceSlots[nP++] = slots;
    slots++;
  }
  if (nT === 0 && nP === 0) {
    return emptyPartition<S>(ws.open, domain, ws.notWall);
  }

  const needDecisive = nP > 0 && nT > 0;
  const { ourCum, theirCum, ourStep, theirStep, oursBoard, theirsBoard } = ws;
  const { coveredPrev, coveredNow, newT, hit, others, decisive, notWall } = ws;
  const seenByTeam = ws.seenByTeam;
  const multiByTeam = ws.multiByTeam;
  ourCum.fill(0);
  theirCum.fill(0);
  oursBoard.fill(0);
  theirsBoard.fill(0);
  coveredPrev.fill(0);
  for (let k = 0; k < nT; k++) ws.planeFor(k).fill(0);
  // MEASURED NULL RESULT, kept because the next person will think of it too:
  // this fill is now redundant. `displace` reads `decisive` only over the trail
  // domain, and the domain is exactly the cells the sweep below stamps, so no
  // read can reach a stale turn. Removing it — or replacing it with a
  // generation stamp from `scratch.ts` — is worth 0.7% of `partitionOf` on the
  // 23×23 board, inside the noise of two interleaved arms over nine rounds: 625
  // word stores against a ~385-cell write set is not a trade worth making. It
  // stays as the executable statement of the invariant `displace` relies on.
  if (needDecisive) decisive.fill(NEVER);

  const teams = ws.teamList;
  let nTeams = 0;
  for (let k = 0; k < nT; k++) {
    const team = entTeam[trailSlots[k] as number] as number;
    ws.ensureTeam(team);
    let known = false;
    for (let i = 0; i < nTeams; i++) {
      if (teams[i] === team) {
        known = true;
        break;
      }
    }
    if (!known) teams[nTeams++] = team;
  }

  // PLANE 1, in WASM when every board it touches is resident. The two loops are
  // written out separately rather than sharing a body: the JS one below is the
  // shipped kernel and stays EXACTLY as it was, so a flag that is off costs it
  // nothing — not a hoist, not a function call, not a re-read of a local.
  const wasmSweep = ws.wasmSweepPrepare(nT, nTeams, needDecisive);
  if (wasmSweep) {
    for (let t = tMin; t <= tMax; t++) ws.wasmSweepAt(t, nT);
  } else {
    for (let t = tMin; t <= tMax; t++) {
      // --- team-level cover, the exact `ours ⟺ ∃t` identity -------------------
      ourStep.fill(0);
      theirStep.fill(0);
      for (let k = 0; k < nT; k++) {
        const e = trailSlots[k] as number;
        const f = (entShells[e] as UnitShells).frontAt(t);
        if (f === null) continue;
        const dst = entMine[e] === 1 ? ourStep : theirStep;
        for (let i = 0; i < w; i++) dst[i] |= f[i] as number;
      }
      for (let i = 0; i < w; i++) {
        const oc = ((ourCum[i] as number) | (ourStep[i] as number)) >>> 0;
        const tc = ((theirCum[i] as number) | (theirStep[i] as number)) >>> 0;
        ourCum[i] = oc;
        theirCum[i] = tc;
        oursBoard[i] = ((oursBoard[i] as number) | (oc & ~tc)) >>> 0;
        theirsBoard[i] = ((theirsBoard[i] as number) | (tc & ~oc)) >>> 0;
      }

      if (nT === 0) continue;

      // --- cells decided at t, and who decided them --------------------------
      let anyNew = 0;
      for (let i = 0; i < w; i++) {
        const now = ((coveredPrev[i] as number) | (ourStep[i] as number) | (theirStep[i] as number)) >>> 0;
        coveredNow[i] = now;
        const fresh = (now & ~(coveredPrev[i] as number)) >>> 0;
        newT[i] = fresh;
        anyNew |= fresh;
      }
      coveredPrev.set(coveredNow);
      if (anyNew === 0) continue;

      for (let ti = 0; ti < nTeams; ti++) {
        const team = teams[ti] as number;
        const seen = seenByTeam[team] as Uint32Array;
        const multi = multiByTeam[team] as Uint32Array;
        seen.fill(0);
        multi.fill(0);
        for (let k = 0; k < nT; k++) {
          const e = trailSlots[k] as number;
          // A HELD teammate is not in this team's blocking set: its tie must not
          // take a cell off a unit it is standing in for.
          if (entHeld[e] === 1 && entTeam[e] === team) continue;
          const f = (entShells[e] as UnitShells).frontAt(t);
          if (f === null) continue;
          for (let i = 0; i < w; i++) {
            const h = ((f[i] as number) & (newT[i] as number)) >>> 0;
            multi[i] = ((multi[i] as number) | (h & (seen[i] as number))) >>> 0;
            seen[i] = ((seen[i] as number) | h) >>> 0;
          }
        }
      }

      for (let k = 0; k < nT; k++) {
        const e = trailSlots[k] as number;
        const f = (entShells[e] as UnitShells).frontAt(t);
        if (f === null) continue;
        const seen = seenByTeam[entTeam[e] as number] as Uint32Array;
        const multi = multiByTeam[entTeam[e] as number] as Uint32Array;
        for (let i = 0; i < w; i++) hit[i] = (((f[i] as number) & (newT[i] as number)) >>> 0);
        if (entHeld[e] === 1) {
          for (let i = 0; i < w; i++) others[i] = seen[i] as number;
        } else {
          for (let i = 0; i < w; i++) {
            others[i] =
              (((seen[i] as number) & ~(hit[i] as number)) |
                ((multi[i] as number) & (hit[i] as number))) >>> 0;
          }
        }
        const own = ws.planeFor(k);
        for (let i = 0; i < w; i++) {
          own[i] = ((own[i] as number) | ((hit[i] as number) & ~(others[i] as number))) >>> 0;
        }
      }

      if (needDecisive) {
        for (let i = 0; i < w; i++) {
          let word = newT[i] as number;
          const base = i << 5;
          while (word !== 0) {
            // Lowest set bit, then its index. Inlined rather than `bbForEach`
            // because that takes a callback, and a closure per horizon turn per
            // reading is an allocation on the hot path.
            const lowest = word & -word;
            decisive[base + (31 - Math.clz32(lowest))] = t;
            word = (word & (word - 1)) >>> 0;
          }
        }
      }
    }
  }

  // --- counts -------------------------------------------------------------
  // `owned[k]` and the domain board are two whole-board passes; the wasm arm
  // folds them in one call off the same planes. The published `TrailRoom`
  // objects are built in JS either way — three fields per admitted trail unit
  // is not a marshalling problem, and one of them is the SUBJECT.
  const foldedOwned = wasmSweep ? ws.wasmFoldPlanes(nT, domain) : null;
  const trailRooms: Array<TrailRoom<S>> = new Array<TrailRoom<S>>(nT);
  if (foldedOwned !== null) {
    for (let k = 0; k < nT; k++) {
      const e = trailSlots[k] as number;
      trailRooms[k] = {
        subject: entSubject[e] as S,
        mine: entMine[e] === 1,
        owned: foldedOwned[k] as number,
      };
    }
  } else {
    for (let k = 0; k < nT; k++) {
      const own = ws.planeFor(k);
      let owned = 0;
      for (let i = 0; i < w; i++) owned += popcount32(((own[i] as number) & (notWall[i] as number)) >>> 0);
      const e = trailSlots[k] as number;
      trailRooms[k] = { subject: entSubject[e] as S, mine: entMine[e] === 1, owned };
    }

    // The trail domain is `coveredPrev` after the last turn: the running OR of
    // every admitted trail unit's arriving fronts. Masked to open ground, because
    // a consumer counting cells is counting places a unit can stand.
    //
    // Written BEFORE the piece plane rather than after, because it is exactly the
    // cell set `displace` has to walk: `decisive[c] !== NEVER` holds on the cells
    // the sweep stamped, which is `coveredPrev`, and the wall test is the mask.
    // Both used to be discovered by testing every one of `grid.cells` cells.
    for (let i = 0; i < w; i++) {
      domain[i] = (((coveredPrev[i] as number) & (notWall[i] as number)) >>> 0);
    }
  }

  let ours = 0;
  let theirs = 0;
  if (nP === 0 || nT === 0) {
    if (wasmSweep && ws.wasmCountSides()) {
      ours = ws.displacedOurs;
      theirs = ws.displacedTheirs;
    } else {
      for (let i = 0; i < w; i++) {
        const mask = notWall[i] as number;
        ours += popcount32(((oursBoard[i] as number) & mask) >>> 0);
        theirs += popcount32(((theirsBoard[i] as number) & mask) >>> 0);
      }
    }
  } else {
    const turns = tMax - tMin + 1;
    fillRanks(ws, slots, turns, tMin);
    for (let e = 0; e < slots; e++) {
      entEarliest[e] = (entShells[e] as UnitShells).earliest();
    }
    // The wasm arm reads exactly these buffers, in place. It declines whenever
    // one of them is not in the arena, and the line below is then the whole
    // fallback: the JS kernel, unchanged, on the same inputs.
    if (ws.wasmDisplace(slots, nT, nP, asTeam, tMin, turns, domain)) {
      ours = ws.displacedOurs;
      theirs = ws.displacedTheirs;
    } else {
      ours = displace(ws, nT, nP, asTeam, tMin, turns, domain);
      theirs = ws.displacedTheirs;
    }
  }

  const open = ws.open;
  return {
    balance: open === 0 ? 0 : (ours - theirs) / open,
    ours,
    theirs,
    open,
    trails: trailRooms,
    domain,
    openBoard: notWall,
  };
}

/**
 * DENSE CONTEST-STRENGTH RANKS for every (entry slot, absolute turn) of the
 * sweep, flat at `[slot * turns + (t - tMin)]`.
 *
 * `tierAtTurn` takes one of two values for a unit — `tierMax` before expiry and
 * 0 at or after it — so a unit contributes at most TWO distinct strengths
 * however long the horizon is, and the batch handed to the ranker is at most
 * `2 × units` entries rather than `units × turns`. The `Scalar`s it ranks come
 * from the workspace's pool and are overwritten on the next call; none of them
 * ever leaves this file.
 */
function fillRanks(ws: TerritoryWorkspace, slots: number, turns: number, tMin: number): void {
  const ranker = ws.ranker;
  ranker.reset();
  const col = ws.ensureRanks(slots * turns);
  const liveIdx = ws.ensureStrengthIndex(slots * 2);
  const entSubject = ws.entSubject;

  // Pass 1 — the distinct strengths, into the ranking batch.
  for (let e = 0; e < slots; e++) {
    const s = entSubject[e] as TerritorySubject;
    const live = ranker.count;
    ranker.add(ws.strengthAt(live, s.tierMax, s.weightMax));
    liveIdx[e * 2] = live;
    if (s.tierExpiresAtTurn === null || s.tierMax === 0) {
      liveIdx[e * 2 + 1] = live;
    } else {
      const expired = ranker.count;
      ranker.add(ws.strengthAt(expired, 0, s.weightMax));
      liveIdx[e * 2 + 1] = expired;
    }
  }

  const ranks = ranker.rank(cmpLex);

  // Pass 2 — expand to (slot, turn), applying `tierAtTurn`'s own cutover.
  for (let e = 0; e < slots; e++) {
    const s = entSubject[e] as TerritorySubject;
    const base = e * turns;
    const liveRank = ranks[liveIdx[e * 2] as number] as number;
    const expiresAt = s.tierExpiresAtTurn;
    if (expiresAt === null || s.tierMax === 0) {
      for (let i = 0; i < turns; i++) col[base + i] = liveRank;
      continue;
    }
    const expiredRank = ranks[liveIdx[e * 2 + 1] as number] as number;
    for (let i = 0; i < turns; i++) {
      col[base + i] = tMin + i >= expiresAt ? expiredRank : liveRank;
    }
  }
}

/**
 * PLANE 2. Per cell, because a contest is not a set operation: the challenger
 * set is "pieces that arrive by D and beat what stands there", the earliest of
 * those wins, an equal-arrival tie is settled by the resolver's own comparator,
 * and a mutual kill leaves the trail claim alone. Skipped entirely on a
 * piece-free board, which is the shape the flag decision is measured on.
 *
 * Walks the TRAIL DOMAIN bitboard rather than every cell of the grid. Returns
 * `ours` and leaves `theirs` in `ws.displacedTheirs` — a pair object here is an
 * allocation on the hottest path in the system.
 */
function displace(
  ws: TerritoryWorkspace,
  nT: number,
  nP: number,
  asTeam: number,
  tMin: number,
  turns: number,
  domainBoard: Uint32Array
): number {
  const decisive = ws.decisive;
  const ranks = ws.ranks;
  const entEarliest = ws.entEarliest;
  const entTeam = ws.entTeam;
  const trailSlots = ws.trailSlots;
  const pieceSlots = ws.pieceSlots;
  const oursBoard = ws.oursBoard;
  const theirsBoard = ws.theirsBoard;
  const w = ws.grid.words;
  let ours = 0;
  let theirs = 0;

  for (let word = 0; word < w; word++) {
    let bits = domainBoard[word] as number;
    if (bits === 0) continue;
    const base = word << 5;
    const oursWord = oursBoard[word] as number;
    const theirsWord = theirsBoard[word] as number;
    while (bits !== 0) {
      const lowest = bits & -bits;
      const c = base + (31 - Math.clz32(lowest));
      bits = (bits & (bits - 1)) >>> 0;

      // Ground no trail unit walks belongs to nobody — the domain IS the set of
      // cells the sweep stamped, so `decisive` is live at every one of them.
      const D = decisive[c] as number;
      const at = D - tMin;

      // The claim standing on the cell: the strongest pair among a tie.
      let claim = -1;
      for (let k = 0; k < nT; k++) {
        const e = trailSlots[k] as number;
        if ((entEarliest[e] as Int32Array)[c] !== D) continue;
        const m = ranks[e * turns + at] as number;
        if (m > claim) claim = m;
      }
      if (claim < 0) continue;

      // Challengers: pieces that get there in time AND beat what is standing.
      let bestArrival = NEVER;
      let winner = -1;
      let winnerRank = -1;
      let tied = false;
      for (let k = 0; k < nP; k++) {
        const e = pieceSlots[k] as number;
        const a = (entEarliest[e] as Int32Array)[c] as number;
        if (a > D) continue;
        const m = ranks[e * turns + at] as number;
        if (m <= claim) continue;
        if (winner < 0 || a < bestArrival) {
          bestArrival = a;
          winner = e;
          winnerRank = m;
          tied = false;
        } else if (a === bestArrival) {
          if (m > winnerRank) {
            winner = e;
            winnerRank = m;
            tied = false;
          } else if (m === winnerRank) {
            tied = true;
          }
        }
      }

      if (winner >= 0 && !tied) {
        if (entTeam[winner] === asTeam) ours++;
        else theirs++;
        continue;
      }
      // A mutual kill among challengers settles nothing: a piece layer can change
      // WHO holds ground, never vacate ground a trail unit holds.
      if ((oursWord & lowest) !== 0) ours++;
      else if ((theirsWord & lowest) !== 0) theirs++;
    }
  }
  ws.displacedTheirs = theirs;
  return ours;
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}
