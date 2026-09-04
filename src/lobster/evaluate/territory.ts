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

import { NEVER } from '../../engine-vendor/engine/claims';
import { leavesTrail } from '../../engine-vendor/engine/moveGrammar';
import { outranks } from '../../engine-vendor/engine/turnEngine';
import { bbPopcount, bbSet, bbTest } from '../bits';
import type { Grid, Terrain } from '../bits';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import type { UnitType } from '../../engine-vendor/shared/types/Game';
import type { UnitShells } from './shells';
import { ShellTable } from './shells';
import { perBoard } from './memo';

/** A standing the partition can read. Structural, so `features.ts` owns it. */
export interface TerritorySubject {
  readonly unitId: UnitId;
  readonly team: number;
  readonly kind: UnitType;
  readonly held: boolean;
  readonly weightMax: number;
  readonly tierMax: number;
  readonly tierExpiresAtTurn: number | null;
  /**
   * The cells this unit STILL OCCUPIES in every world it is alive in — the
   * engine's own `Claim.certainIfAlive`, empty for a mover (whose settled
   * occupancy is not conditional at all). Read only for a HELD unit, and only
   * to build `certainDomain`.
   */
  readonly certainIfAlive: ReadonlyArray<number>;
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
   * THE SAME DOMAIN, MINUS WHAT A HELD ENEMY MERELY MIGHT HOLD.
   *
   * `domain` is a SUPERSET of the ground plane 1 really contests, because a
   * held enemy trail unit is dilated from where it was OBSERVED and its front
   * is its whole claim cloud. That direction is right for a term counting what
   * THEIR pieces can act on and exactly wrong for one counting what OURS can:
   * it hands our own pieces ground no world guarantees, and a floor read off it
   * is above worlds it claims to bound. Here a held ENEMY trail contributes
   * only the cells it certainly still occupies (`Claim.certainIfAlive`);
   * everything else contributes exactly what it does to `domain`. Subset of
   * `domain` by construction, and equal to it when nothing of theirs is held —
   * so the two readings still collapse to a point on a fully modelled board.
   */
  readonly certainDomain: Uint32Array;
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
  certainDomain: Uint32Array,
  openBoard: Uint32Array
): Partition<S> => {
  domain.fill(0);
  certainDomain.fill(0);
  return { balance: 0, ours: 0, theirs: 0, open, trails: [], domain, certainDomain, openBoard };
};

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
  /**
   * One trail-domain board PER READING. Two boards rather than one because a
   * context caches both partitions and hands both out; a single scratch board
   * would let the second reading rewrite the first's answer.
   */
  private readonly domains: { lo: Uint32Array; hi: Uint32Array };
  /** The same, for `Partition.certainDomain` — one board per reading, for the
   * same reason: both readings are cached side by side on one context. */
  private readonly certainDomains: { lo: Uint32Array; hi: Uint32Array };
  /** Scratch for the resolved food board — one evaluation runs at a time. */
  readonly foodOut: Uint32Array;
  /** The same, for the held-cloud-free food board (`EvalContext.certainFood`).
   * A second slab because both boards are read side by side. */
  readonly certainFoodOut: Uint32Array;

  domainFor(reading: 'lo' | 'hi'): Uint32Array {
    return this.domains[reading];
  }

  certainDomainFor(reading: 'lo' | 'hi'): Uint32Array {
    return this.certainDomains[reading];
  }

  constructor(grid: Grid, terrain: Terrain, table: ShellTable) {
    this.grid = grid;
    this.table = table;
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
    this.domains = { lo: new Uint32Array(w), hi: new Uint32Array(w) };
    this.certainDomains = { lo: new Uint32Array(w), hi: new Uint32Array(w) };
    this.foodOut = new Uint32Array(w);
    this.certainFoodOut = new Uint32Array(w);
  }

  planeFor(index: number): Uint32Array {
    while (this.own.length <= index) this.own.push(new Uint32Array(this.grid.words));
    return this.own[index] as Uint32Array;
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

  // --- the partition's own scratch ----------------------------------------
  /** Pooled entries, handed out in order and reset per partition. */
  private readonly entryPool: Array<Entry<TerritorySubject>> = [];
  private entriesTaken = 0;
  /** The two buckets one partition sorts its admitted subjects into. */
  readonly trailScratch: Array<Entry<TerritorySubject>> = [];
  readonly pieceScratch: Array<Entry<TerritorySubject>> = [];
  /** `earliest()` grids, one array per plane, for the piece sweep. */
  readonly trailGrids: Int32Array[] = [];
  readonly pieceGrids: Int32Array[] = [];

  /** Start a partition: every entry handed out before now is free again. */
  resetEntries(): void {
    this.entriesTaken = 0;
    this.trailScratch.length = 0;
    this.pieceScratch.length = 0;
  }

  takeEntry<S extends TerritorySubject>(s: S, sh: UnitShells, mine: boolean): Entry<S> {
    let e = this.entryPool[this.entriesTaken];
    if (e === undefined) {
      e = { s, sh, mine, scalars: [] };
      this.entryPool.push(e);
    } else {
      e.s = s;
      e.sh = sh;
      e.mine = mine;
    }
    this.entriesTaken++;
    return e as Entry<S>;
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
  // Per FAMILY, not per view. Every slab in here is a function of the board's
  // geometry and the roster, and the shell table caches a dilation that reads
  // the board's SHAPE — none of it depends on which units a view models. A
  // per-view copy meant a fresh set of slabs and a cold shell cache for every
  // hold configuration the bank enumerated and for every bank the runner's
  // trace pricing opened; sharing them keeps one of each per decision. Safe
  // for exactly the reason the reuse across evaluations is: one evaluation
  // runs at a time, which is what the scratch fields already assume.
  const family = sub.family;
  return perBoard(workspaces, family, () => {
    const roster = family.roster().length;
    return new TerritoryWorkspace(
      family.grid,
      family.terrain,
      new ShellTable(family, Math.max(256, roster * 64))
    );
  });
}

// ---------------------------------------------------------------------------
// The partition
// ---------------------------------------------------------------------------

/** The only two coordinates a contest reads (`outranks`). */
interface Strength {
  readonly tier: number;
  readonly weight: number;
}

/** A `Strength` a pooled entry may rewrite. Nothing outside this file sees it. */
interface MutableStrength {
  tier: number;
  weight: number;
}

interface Entry<S> {
  s: S;
  sh: UnitShells;
  mine: boolean;
  /**
   * This unit's contest strength at each absolute turn of the sweep, indexed
   * `turn - tMin`. Built once per partition, because the alternative is
   * constructing a strength pair per challenger PER CELL — 169 cells times thirteen
   * pieces of pure garbage per reading, which measured as most of the piece
   * plane's cost. The comparator stays the resolver's own.
   *
   * The pairs are POOLED on the workspace and rewritten in place: an entry and
   * its strengths are read only inside the `partitionOf` call that filled them
   * — the `Partition` this returns carries `TrailRoom`s and boards, never an
   * entry — so the eight entries and their forty-odd pairs per reading were,
   * at 190 750 evaluations, some twenty million objects of pure garbage.
   */
  readonly scalars: MutableStrength[];
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
  admit: Admission<S>,
  /** Where this reading's trail domain is written. One per reading — see
   * `Partition.domain`. Defaults to a fresh board for callers that ignore it. */
  domain: Uint32Array = new Uint32Array(ws.grid.words),
  /** Where the same reading's `certainDomain` is written. Same rule. */
  certainDomain: Uint32Array = new Uint32Array(ws.grid.words)
): Partition<S> {
  const grid = ws.grid;
  const w = grid.words;
  ws.resetEntries();
  const trails = ws.trailScratch as unknown as Array<Entry<S>>;
  const pieces = ws.pieceScratch as unknown as Array<Entry<S>>;

  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    const mine = s.team === asTeam;
    if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;
    if (sh.fromTurn < tMin) tMin = sh.fromTurn;
    if (sh.horizonTurn > tMax) tMax = sh.horizonTurn;
    (leavesTrail(s.kind) ? trails : pieces).push(ws.takeEntry(s, sh, mine));
  }
  if (trails.length === 0 && pieces.length === 0) {
    return emptyPartition<S>(ws.open, domain, certainDomain, ws.notWall);
  }

  const needDecisive = pieces.length > 0 && trails.length > 0;
  const { ourCum, theirCum, ourStep, theirStep, oursBoard, theirsBoard } = ws;
  const { coveredPrev, coveredNow, newT, hit, others, decisive, notWall } = ws;
  const seenByTeam = ws.seenByTeam;
  const multiByTeam = ws.multiByTeam;
  ourCum.fill(0);
  theirCum.fill(0);
  oursBoard.fill(0);
  theirsBoard.fill(0);
  coveredPrev.fill(0);
  certainDomain.fill(0);
  for (let k = 0; k < trails.length; k++) ws.planeFor(k).fill(0);
  if (needDecisive) decisive.fill(NEVER);

  const teams: number[] = [];
  for (let k = 0; k < trails.length; k++) {
    const team = (trails[k] as Entry<S>).s.team;
    ws.ensureTeam(team);
    if (!teams.includes(team)) teams.push(team);
  }

  for (let t = tMin; t <= tMax; t++) {
    // --- team-level cover, the exact `ours ⟺ ∃t` identity -------------------
    ourStep.fill(0);
    theirStep.fill(0);
    for (let k = 0; k < trails.length; k++) {
      const e = trails[k] as Entry<S>;
      const f = e.sh.frontAt(t);
      if (f === null) continue;
      const dst = e.mine ? ourStep : theirStep;
      for (let i = 0; i < w; i++) dst[i] |= f[i] as number;
      // The certain domain takes this front only when the front IS the unit's
      // reach rather than its claim cloud. A held enemy's is a cloud, and it
      // rejoins below at the cells it cannot have left.
      if (!e.s.held || e.mine) {
        for (let i = 0; i < w; i++) certainDomain[i] |= f[i] as number;
      }
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

    for (let ti = 0; ti < teams.length; ti++) {
      const team = teams[ti] as number;
      const seen = seenByTeam[team] as Uint32Array;
      const multi = multiByTeam[team] as Uint32Array;
      seen.fill(0);
      multi.fill(0);
      for (let k = 0; k < trails.length; k++) {
        const e = trails[k] as Entry<S>;
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
      const seen = seenByTeam[e.s.team] as Uint32Array;
      const multi = multiByTeam[e.s.team] as Uint32Array;
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
  const trailRooms: Array<TrailRoom<S>> = [];
  for (let k = 0; k < trails.length; k++) {
    const own = ws.planeFor(k);
    let owned = 0;
    for (let i = 0; i < w; i++) owned += popcount32(((own[i] as number) & (notWall[i] as number)) >>> 0);
    trailRooms.push({ subject: (trails[k] as Entry<S>).s, mine: (trails[k] as Entry<S>).mine, owned });
  }

  let ours = 0;
  let theirs = 0;
  if (pieces.length === 0 || trails.length === 0) {
    for (let i = 0; i < w; i++) {
      const mask = notWall[i] as number;
      ours += popcount32(((oursBoard[i] as number) & mask) >>> 0);
      theirs += popcount32(((theirsBoard[i] as number) & mask) >>> 0);
    }
  } else {
    for (const e of trails) fillScalars(e, tMin, tMax);
    for (const e of pieces) fillScalars(e, tMin, tMax);
    const counted = displace(ws, trails, pieces, asTeam, tMin);
    ours = counted.ours;
    theirs = counted.theirs;
  }

  // The trail domain is `coveredPrev` after the last turn: the running OR of
  // every admitted trail unit's arriving fronts. Masked to open ground, because
  // a consumer counting cells is counting places a unit can stand.
  // A held enemy trail rejoins the certain domain at exactly the cells its
  // claim says it still occupies in every world it survives.
  for (let k = 0; k < trails.length; k++) {
    const e = trails[k] as Entry<S>;
    if (!e.s.held || e.mine) continue;
    for (const cell of e.s.certainIfAlive) bbSet(certainDomain, cell);
  }
  for (let i = 0; i < w; i++) {
    const mask = notWall[i] as number;
    domain[i] = (((coveredPrev[i] as number) & mask) >>> 0);
    certainDomain[i] = (((certainDomain[i] as number) & mask) >>> 0);
  }

  const open = ws.open;
  return {
    balance: open === 0 ? 0 : (ours - theirs) / open,
    ours,
    theirs,
    open,
    trails: trailRooms,
    domain,
    certainDomain,
    openBoard: notWall,
  };
}

/** One strength pair per absolute turn of the sweep, so the cell loop allocates none.
 *  The pairs are grown once and then REWRITTEN: only `[0, tMax - tMin]` is ever
 *  read (`displace` indexes `D - tMin`), so a longer pooled array is simply
 *  slack, never a stale answer. */
function fillScalars<S extends TerritorySubject>(e: Entry<S>, tMin: number, tMax: number): void {
  const out = e.scalars;
  const weight = e.s.weightMax;
  for (let t = tMin, i = 0; t <= tMax; t++, i++) {
    let pair = out[i];
    if (pair === undefined) {
      pair = { tier: 0, weight: 0 };
      out.push(pair);
    }
    pair.tier = tierAtTurn(e.s, t);
    pair.weight = weight;
  }
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
  asTeam: number,
  tMin: number
): { ours: number; theirs: number } {
  const grid = ws.grid;
  const trailGrids = ws.trailGrids;
  const pieceGrids = ws.pieceGrids;
  for (let k = 0; k < trails.length; k++) trailGrids[k] = (trails[k] as Entry<S>).sh.earliest();
  for (let k = 0; k < pieces.length; k++) pieceGrids[k] = (pieces[k] as Entry<S>).sh.earliest();
  const decisive = ws.decisive;
  let ours = 0;
  let theirs = 0;

  // THE CELLS THIS SWEEP CAN DECIDE, AS A BOARD RATHER THAN A SCAN.
  //
  // The two guards the per-cell loop opened with — "on open ground" and "some
  // trail unit's front arrived here" — are exactly `notWall & coveredPrev`:
  // `decisive` is filled with NEVER and written only for cells in `newT`, and
  // the union of `newT` over the sweep IS `coveredPrev`. So walking the set
  // bits of that intersection visits the same cells, in the same ascending
  // order, and skips the rest without touching them. On a 23x23 board that is
  // 529 cell probes per reading per evaluation replaced by a word walk over
  // the ground actually contested.
  const notWall = ws.notWall;
  const coveredPrev = ws.coveredPrev;
  const words = grid.words;
  for (let i = 0; i < words; i++) {
    let word = (((coveredPrev[i] as number) & (notWall[i] as number)) >>> 0);
    const base = i << 5;
    while (word !== 0) {
    const lowest = word & -word;
    const c = base + (31 - Math.clz32(lowest));
    word = (word & (word - 1)) >>> 0;
    const D = decisive[c] as number;
    // Ground no trail unit walks belongs to nobody — see the header.
    if (D === NEVER) continue;
    const at = D - tMin;

    // The claim standing on the cell: the strongest pair among a tie.
    let claim: Strength | null = null;
    for (let k = 0; k < trails.length; k++) {
      if ((trailGrids[k] as Int32Array)[c] !== D) continue;
      const mine = (trails[k] as Entry<S>).scalars[at] as Strength;
      if (claim === null || outranks(mine, claim)) claim = mine;
    }
    if (claim === null) continue;

    // Challengers: pieces that get there in time AND beat what is standing.
    let bestArrival = NEVER;
    let winner: Entry<S> | null = null;
    let winnerScalar: Strength | null = null;
    let tied = false;
    for (let k = 0; k < pieces.length; k++) {
      const a = (pieceGrids[k] as Int32Array)[c] as number;
      if (a > D) continue;
      const e = pieces[k] as Entry<S>;
      const mine = e.scalars[at] as Strength;
      if (!outranks(mine, claim)) continue;
      if (winner === null || a < bestArrival) {
        bestArrival = a;
        winner = e;
        winnerScalar = mine;
        tied = false;
      } else if (a === bestArrival) {
        const held = winnerScalar as Strength;
        if (outranks(mine, held)) {
          winner = e;
          winnerScalar = mine;
          tied = false;
        } else if (!outranks(held, mine)) {
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
  }
  return { ours, theirs };
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}
