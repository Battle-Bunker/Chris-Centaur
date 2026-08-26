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
  beats,
  bbForEach,
  bbPopcount,
  bbTest,
  profileOf,
  scalarOf,
} from '../../partial-engine/index';
import type { Grid, Terrain } from '../../partial-engine/index';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
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
}

const EMPTY: Partition<never> = { balance: 0, ours: 0, theirs: 0, open: 0, trails: [] };

/** The invulnerability tier a unit still carries at an absolute turn. */
export function tierAtTurn(s: TerritorySubject, turn: number): number {
  if (s.tierExpiresAtTurn !== null && turn >= s.tierExpiresAtTurn) return 0;
  return s.tierMax;
}

// ---------------------------------------------------------------------------
// Reusable scratch — the evaluator is inside the engine's slab discipline now
// ---------------------------------------------------------------------------

/**
 * Every slab this file needs, allocated once per substrate. The fold used to
 * allocate four `Int32Array(cells)` per evaluation at roughly ten thousand
 * evaluations a second; reusing them was worth 15–27% of plan throughput on its
 * own, measured across four board/roster shapes.
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
  readonly own: Uint32Array[] = [];
  /** Decisive turn per cell. Only filled when a piece could displace. */
  readonly decisive: Int32Array;

  constructor(grid: Grid, terrain: Terrain, capacity: number) {
    this.grid = grid;
    this.table = new ShellTable(grid, capacity);
    const w = grid.words;
    this.notWall = new Uint32Array(w);
    for (let i = 0; i < w; i++) {
      this.notWall[i] = ((grid.full[i] as number) & ~(terrain.wall[i] as number)) >>> 0;
    }
    this.open = bbPopcount(this.notWall, w);
    this.ourCum = new Uint32Array(w);
    this.theirCum = new Uint32Array(w);
    this.ourStep = new Uint32Array(w);
    this.theirStep = new Uint32Array(w);
    this.oursBoard = new Uint32Array(w);
    this.theirsBoard = new Uint32Array(w);
    this.coveredPrev = new Uint32Array(w);
    this.coveredNow = new Uint32Array(w);
    this.newT = new Uint32Array(w);
    this.hit = new Uint32Array(w);
    this.others = new Uint32Array(w);
    this.decisive = new Int32Array(grid.cells);
  }

  planeFor(index: number): Uint32Array {
    while (this.own.length <= index) this.own.push(new Uint32Array(this.grid.words));
    return this.own[index] as Uint32Array;
  }

  teamSlabs(team: number): { seen: Uint32Array; multi: Uint32Array } {
    while (this.seenByTeam.length <= team) {
      this.seenByTeam.push(new Uint32Array(this.grid.words));
      this.multiByTeam.push(new Uint32Array(this.grid.words));
    }
    return {
      seen: this.seenByTeam[team] as Uint32Array,
      multi: this.multiByTeam[team] as Uint32Array,
    };
  }
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

interface Entry<S> {
  readonly s: S;
  readonly sh: UnitShells;
  readonly mine: boolean;
}

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
  admit: Admission<S>
): Partition<S> {
  const grid = ws.grid;
  const w = grid.words;
  const trails: Array<Entry<S>> = [];
  const pieces: Array<Entry<S>> = [];

  for (const s of subjects) {
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    const mine = s.team === asTeam;
    if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;
    (profileOf(s.kind).leavesTrail ? trails : pieces).push({ s, sh, mine });
  }
  if (trails.length === 0 && pieces.length === 0) return EMPTY as unknown as Partition<S>;

  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const e of [...trails, ...pieces]) {
    if (e.sh.heldAtTurn < tMin) tMin = e.sh.heldAtTurn;
    if (e.sh.horizonTurn > tMax) tMax = e.sh.horizonTurn;
  }

  const needDecisive = pieces.length > 0;
  const { ourCum, theirCum, ourStep, theirStep, oursBoard, theirsBoard } = ws;
  const { coveredPrev, coveredNow, newT, hit, others } = ws;
  ourCum.fill(0);
  theirCum.fill(0);
  oursBoard.fill(0);
  theirsBoard.fill(0);
  coveredPrev.fill(0);
  for (let k = 0; k < trails.length; k++) ws.planeFor(k).fill(0);
  if (needDecisive) ws.decisive.fill(NEVER);

  const teams = new Set<number>();
  for (const e of trails) teams.add(e.s.team);

  for (let t = tMin; t <= tMax; t++) {
    // --- team-level cover, the exact `ours ⟺ ∃t` identity -------------------
    ourStep.fill(0);
    theirStep.fill(0);
    for (const e of trails) {
      const f = e.sh.frontAt(t);
      if (f === null) continue;
      const dst = e.mine ? ourStep : theirStep;
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

    if (trails.length === 0) continue;

    // --- cells decided at t, and who decided them --------------------------
    for (let i = 0; i < w; i++) {
      const now = ((coveredPrev[i] as number) | (ourStep[i] as number) | (theirStep[i] as number)) >>> 0;
      coveredNow[i] = now;
      newT[i] = (now & ~(coveredPrev[i] as number)) >>> 0;
    }

    for (const team of teams) {
      const { seen, multi } = ws.teamSlabs(team);
      seen.fill(0);
      multi.fill(0);
      for (const e of trails) {
        // A HELD teammate is not in this team's blocking set: its tie must not
        // take a cell off a unit it is standing in for.
        if (e.s.held && e.s.team === team) continue;
        const f = e.sh.frontAt(t);
        if (f === null) continue;
        for (let i = 0; i < w; i++) {
          const h = ((f[i] as number) & (newT[i] as number)) >>> 0;
          multi[i] = ((multi[i] as number) | (h & (seen[i] as number))) >>> 0;
          seen[i] = ((seen[i] as number) | h) >>> 0;
        }
      }
    }

    for (let k = 0; k < trails.length; k++) {
      const e = trails[k] as Entry<S>;
      const f = e.sh.frontAt(t);
      if (f === null) continue;
      const { seen, multi } = ws.teamSlabs(e.s.team);
      for (let i = 0; i < w; i++) hit[i] = (((f[i] as number) & (newT[i] as number)) >>> 0);
      if (e.s.held) {
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
      const decisive = ws.decisive;
      bbForEach(newT, w, (c) => {
        decisive[c] = t;
      });
    }
    coveredPrev.set(coveredNow);
  }

  // --- counts -------------------------------------------------------------
  const trailRooms: Array<TrailRoom<S>> = [];
  for (let k = 0; k < trails.length; k++) {
    const own = ws.planeFor(k);
    let owned = 0;
    for (let i = 0; i < w; i++) owned += popcount32(((own[i] as number) & (ws.notWall[i] as number)) >>> 0);
    trailRooms.push({ subject: (trails[k] as Entry<S>).s, mine: (trails[k] as Entry<S>).mine, owned });
  }

  let ours = 0;
  let theirs = 0;
  if (pieces.length === 0) {
    for (let i = 0; i < w; i++) {
      const mask = ws.notWall[i] as number;
      ours += popcount32(((oursBoard[i] as number) & mask) >>> 0);
      theirs += popcount32(((theirsBoard[i] as number) & mask) >>> 0);
    }
  } else {
    const counted = displace(ws, trails, pieces, asTeam);
    ours = counted.ours;
    theirs = counted.theirs;
  }

  const open = ws.open;
  return {
    balance: open === 0 ? 0 : (ours - theirs) / open,
    ours,
    theirs,
    open,
    trails: trailRooms,
  };
}

/**
 * PLANE 2. Per cell, because a contest is not a set operation: the challenger
 * set is "pieces that arrive by D and beat what stands there", the earliest of
 * those wins, an equal-arrival tie is settled by the resolver's own comparator,
 * and a mutual kill leaves the trail claim alone. Skipped entirely on a
 * piece-free board, which is the shape the flag decision is measured on.
 */
function displace<S extends TerritorySubject>(
  ws: TerritoryWorkspace,
  trails: ReadonlyArray<Entry<S>>,
  pieces: ReadonlyArray<Entry<S>>,
  asTeam: number
): { ours: number; theirs: number } {
  const grid = ws.grid;
  const cells = grid.cells;
  const trailGrids = trails.map((e) => e.sh.earliest());
  const pieceGrids = pieces.map((e) => e.sh.earliest());
  let ours = 0;
  let theirs = 0;

  for (let c = 0; c < cells; c++) {
    if (!bbTest(ws.notWall, c)) continue;
    const D = ws.decisive[c] as number;
    // Ground no trail unit walks belongs to nobody — see the header.
    if (D === NEVER) continue;

    // The claim standing on the cell, and the strongest pair among a tie.
    let claimTier = 0;
    let claimWeight = 0;
    for (let k = 0; k < trails.length; k++) {
      if ((trailGrids[k] as Int32Array)[c] !== D) continue;
      const s = (trails[k] as Entry<S>).s;
      const tier = tierAtTurn(s, D);
      if (tier > claimTier || (tier === claimTier && s.weightMax > claimWeight)) {
        claimTier = tier;
        claimWeight = s.weightMax;
      }
    }
    const claim = scalarOf(claimTier, claimWeight);

    // Challengers: pieces that get there in time AND beat what is standing.
    let bestArrival = NEVER;
    let winner: Entry<S> | null = null;
    let tied = false;
    for (let k = 0; k < pieces.length; k++) {
      const e = pieces[k] as Entry<S>;
      const a = (pieceGrids[k] as Int32Array)[c] as number;
      if (a > D) continue;
      const mine = scalarOf(tierAtTurn(e.s, D), e.s.weightMax);
      if (!beats(mine, claim)) continue;
      if (winner === null || a < bestArrival) {
        bestArrival = a;
        winner = e;
        tied = false;
      } else if (a === bestArrival) {
        const cur = winner as Entry<S>;
        const held = scalarOf(tierAtTurn(cur.s, D), cur.s.weightMax);
        if (beats(mine, held)) {
          winner = e;
          tied = false;
        } else if (!beats(held, mine)) {
          tied = true;
        }
      }
    }

    if (winner !== null && !tied) {
      if (winner.s.team === asTeam) ours++;
      else theirs++;
      continue;
    }
    // A mutual kill among challengers settles nothing: a piece layer can change
    // WHO holds ground, never vacate ground a trail unit holds.
    if (bbTest(ws.oursBoard, c)) ours++;
    else if (bbTest(ws.theirsBoard, c)) theirs++;
  }
  return { ours, theirs };
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}
