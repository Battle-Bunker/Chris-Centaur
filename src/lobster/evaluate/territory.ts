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

  constructor(grid: Grid, terrain: Terrain, capacity: number) {
    this.grid = grid;
    const u32 = (n: number): Uint32Array => new Uint32Array(n);
    const i32 = (n: number): Int32Array => new Int32Array(n);
    this.table = new ShellTable(grid, capacity);
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
    this.entMineCol = new Uint8Column(64);
    this.entHeldCol = new Uint8Column(64);
    this.entTeamCol = new Int32Column(64);
    this.trailCol = new Int32Column(64);
    this.pieceCol = new Int32Column(64);
    this.teamCol = new Int32Column(16);
    this.rankCol = new Int32Column(512);
    this.strengthIdxCol = new Int32Column(128);
  }

  planeFor(index: number): Uint32Array {
    return this.planes.at(index);
  }

  /** Grow the per-team slabs to cover `team`, then read them directly. Two
   * accessors rather than one returning a pair: a pair is an allocation, and
   * this is called once per team per unit per horizon turn. */
  ensureTeam(team: number): void {
    while (this.seenByTeam.length <= team) {
      this.seenByTeam.push(new Uint32Array(this.grid.words));
      this.multiByTeam.push(new Uint32Array(this.grid.words));
    }
  }

  /** The shells map handed to one evaluation. Reused: one evaluation runs at a
   * time, and a fresh Map per plan is pure garbage at ten thousand a second. */
  readonly shellsOut = new Map<UnitId, UnitShells>();
}

const workspaces = new WeakMap<EngineSubstrate, TerritoryWorkspace>();

/**
 * The workspace for a substrate — which is the decision's scope, because a
 * substrate is built per decision and released with it. The shell table's
 * capacity is sized to the decision's own working set (Σ over units of legal
 * destinations), not to a constant somebody else picked.
 */
export function workspaceFor(sub: EngineSubstrate): TerritoryWorkspace {
  let ws = workspaces.get(sub);
  if (ws === undefined) {
    const roster = sub.roster().length;
    ws = new TerritoryWorkspace(sub.grid, sub.terrain, Math.max(256, roster * 64));
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
 * them and only the small columns are flattened.
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

  // PLANE 1 — set cover over the horizon's turns, on the boards the timelines
  // already hold.
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

  // --- counts -------------------------------------------------------------
  // `owned[k]` and the domain board are two whole-board passes off the planes
  // the sweep just wrote. Three fields per admitted trail unit, and one of them
  // is the SUBJECT.
  const trailRooms: Array<TrailRoom<S>> = new Array<TrailRoom<S>>(nT);
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

  let ours = 0;
  let theirs = 0;
  if (nP === 0 || nT === 0) {
    for (let i = 0; i < w; i++) {
      const mask = notWall[i] as number;
      ours += popcount32(((oursBoard[i] as number) & mask) >>> 0);
      theirs += popcount32(((theirsBoard[i] as number) & mask) >>> 0);
    }
  } else {
    const turns = tMax - tMin + 1;
    fillRanks(ws, slots, turns, tMin);
    for (let e = 0; e < slots; e++) {
      entEarliest[e] = (entShells[e] as UnitShells).earliest();
    }
    ours = displace(ws, nT, nP, asTeam, tMin, turns, domain);
    theirs = ws.displacedTheirs;
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
