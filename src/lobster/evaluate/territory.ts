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
 * are BOARDS, so the fold is word ops over 6–8 words across 5–8 turns. It used
 * to yield the PER-UNIT ownership planes alongside, for free, because it walks
 * every unit's front at every turn anyway — and that is exactly what made the
 * per-unit reading a race. See below.
 *
 * ── THE PER-UNIT READING IS A REGION, NOT A RACE ───────────────────────────
 *
 * The team planes above are a race and are right to be one: `reach` asks who
 * gets to a cell first. The PER-UNIT reading is a different question and used
 * to be answered with the same machinery — plane 1 restricted to one unit, on
 * shells that step against the PERMISSIVE board after the first unknown turn.
 * On a permissive board a snake's own body is not there, so a snake coiled into
 * a pocket of four cells walked out through itself on the second shell and read
 * as roomy several turns before it suffocated.
 *
 * So the per-unit reading is a REGION: a flood from the unit's settled head in
 * which every cell a body still holds, and every cell somebody else can hold
 * first, is barred — ON THE SCHEDULE THE RULES GIVE, which is the whole
 * finding. A trail unit's body vacates one cell per turn, so `O[i]` is barred
 * at horizon turn `t` exactly while `i ≤ L − 1 − t`. Its own coil therefore
 * opens behind it and A SNAKE CANNOT TRAP ITSELF: the region bounded by its own
 * trail is always at least its own length, so the coil is a tail-chase and not
 * a tomb. Every real entrapment is closed by somebody else's body or lost as a
 * race.
 *
 * THAT DELETES THREE SPECIAL CASES WITH IT. There is no per-unit ownership
 * plane, so there is no per-team `seen`/`multi` sweep deciding a unique argmin
 * per cell; and there is no tie to exempt a held teammate from, because a
 * barrier is "AT OR BEFORE" rather than "strictly before" — a tie kills both,
 * so a cell we tie for is not a cell we keep. Refinement monotonicity is then a
 * property of the barrier set rather than of a tie rule: narrowing a held unit
 * shrinks its cloud, and a smaller cloud can only REMOVE a barrier from the
 * worst reading.
 *
 * `docs/design/entrapment.md` is the derivation — §3 the geometry, §5 the two
 * endpoints, §7.1 the two constructed boards `src/tests/entrapment.test.ts`
 * pins them on.
 */

import { NEVER } from '../../engine-vendor/engine/claims';
import { leavesTrail } from '../../engine-vendor/engine/moveGrammar';
import { outranks } from '../../engine-vendor/engine/turnEngine';
import { bbPopcount, bbSet, bbTest, popcount32 } from '../bits';
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
  /**
   * THE CELLS THIS UNIT STANDS ON, HEAD FIRST — the settled occupancy for a
   * mover, the observed record's for a held unit. The vacating schedule of §3.2
   * is an INDEX into this list, which is why the barrier reads occupancy and
   * not `certainIfAlive`: the claim's own set is sorted by cell and carries no
   * order, so it cannot say which cell leaves next.
   */
  readonly occupancy: ReadonlyArray<number>;
  /** The smallest weight this unit could carry. See `weightMax`; the two are
   *  equal for a mover, and the pair is what makes `need` an interval. */
  readonly weightMin: number;
  /** Alive in the subject's WORST world / BEST world. A barrier is admitted to
   *  `lo` on the first and to `hi` only on both — a barrier from a unit that
   *  might be dead would push `hi` below a world it claims to bound. */
  readonly worstAlive: boolean;
  readonly bestAlive: boolean;
}

/**
 * Which units each side admits, in one reading.
 *
 * ONE method, not two: every reader dispatches on the same `mine` boolean, so
 * the dispatch is the type's and the caller writes the test one way only.
 */
export interface Admission<S> {
  admits(s: S, mine: boolean): boolean;
}

export interface TrailRoom<S> {
  readonly subject: S;
  readonly mine: boolean;
  /**
   * THE CELLS THIS UNIT CAN KEEP over its own horizon, capped at `need` — the
   * barred flood of `docs/design/entrapment.md` §3, measured from the unit's
   * settled head.
   *
   * Filled only for one of OURS that is not held. The enemy half of `room` is
   * retired (§4.2): a held enemy is a cloud and has no head cell to flood from,
   * and `reach` already carries the contested-ground difference at the team
   * level. A `TrailRoom` this reading does not price reads `kept === need`,
   * which is the term declining to say anything about it rather than a claim
   * that it is boxed.
   */
  readonly kept: number;
  /** `max(4, L + 2)` at this reading's own length endpoint. */
  readonly need: number;
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
  /** Decisive turn per cell. Only filled when a piece could displace. */
  readonly decisive: Int32Array;
  /**
   * THE BODY-BARRIER SCHEDULE, AS A STAMPED GRID RATHER THAN A BOARD FILL.
   *
   * `bodyUntil[c]` is the last horizon turn at which some trail body still
   * holds `c`; `bodyStamp[c]` says which partition wrote it. Nothing is ever
   * cleared — only the forty-odd cells a body actually occupies are touched per
   * reading, against the whole-board fill per unit the ownership planes cost.
   */
  readonly bodyUntil: Int32Array;
  readonly bodyStamp: Int32Array;
  bodyGen = 0;
  /** The flood's region, the same way: a stamp per cell and a list of the
   *  handful of cells actually in it. A capped flood never holds more than
   *  `need` cells, so the list is a few dozen numbers reused forever. */
  readonly regionStamp: Int32Array;
  readonly regionCells: number[] = [];
  regionGen = 0;
  /** Pooled `(unitId, earliest)` pairs for the claims-as-barriers clause, so a
   *  reading that admits eight units allocates none. */
  readonly cloudPool: Array<{ unitId: UnitId; earliest: Int32Array }> = [];
  readonly clouds: Array<{ unitId: UnitId; earliest: Int32Array }> = [];
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
    this.decisive = new Int32Array(grid.cells);
    this.bodyUntil = new Int32Array(grid.cells);
    this.bodyStamp = new Int32Array(grid.cells);
    this.regionStamp = new Int32Array(grid.cells);
    this.domains = { lo: new Uint32Array(w), hi: new Uint32Array(w) };
    this.certainDomains = { lo: new Uint32Array(w), hi: new Uint32Array(w) };
    this.foodOut = new Uint32Array(w);
    this.certainFoodOut = new Uint32Array(w);
  }

  /** One pooled cloud entry, rewritten in place. */
  takeCloud(unitId: UnitId, earliest: Int32Array): { unitId: UnitId; earliest: Int32Array } {
    let e = this.cloudPool[this.clouds.length];
    if (e === undefined) {
      e = { unitId, earliest };
      this.cloudPool.push(e);
    } else {
      e.unitId = unitId;
      e.earliest = earliest;
    }
    return e;
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
  /**
   * WHICH ENDPOINT THIS SWEEP IS. `admit` alone cannot say it: the barred flood
   * takes a length endpoint per reading and admits a barrier on a different
   * survival test in each, and both are §5's, not the admission's.
   */
  reading: 'lo' | 'hi',
  /** The turn the settled board belongs to — the clock `earliest ≤ arrivalTurn
   *  + t` is read against, and the age a held unit's schedule is offset by. */
  arrivalTurn: number,
  /**
   * THE LAST TURN A CLAIM CLOUD IS READ AT, and it is a parameter rather than
   * `sh.horizonTurn` for a reason that cost a day: `Shells` are INTERNED per
   * decision and `extendTo` is monotone, so a shells object another caller
   * pushed further carries stamps past this reading's horizon — and
   * `earliest()` would then hand back barriers whose existence depends on the
   * cache's history rather than on the board. The clamp makes the reading a
   * function of the position again: `earliest` takes a MINIMUM over fronts, so
   * every stamp at or below this turn is already final however far the shells
   * are later extended. It is also exactly §3.1's rule for a horizon that runs
   * past the shells' own — the enemy front is held at its last front.
   */
  claimHorizonTurn: number
): Partition<S> {
  const grid = ws.grid;
  const w = grid.words;
  // THE TWO OUT BOARDS ARE THE WORKSPACE'S, ONE PER READING, AND ARE TAKEN
  // HERE RATHER THAN PASSED. `Partition.domain` requires the two readings to
  // hold SEPARATE boards — a context caches both partitions side by side, so a
  // shared board would have the second reading silently overwrite the first's
  // — and `reading` is already a parameter, so the choice is derivable and
  // there is nothing for a caller to get wrong.
  const domain = ws.domainFor(reading);
  const certainDomain = ws.certainDomainFor(reading);
  ws.resetEntries();
  const trails = ws.trailScratch as unknown as Array<Entry<S>>;
  const pieces = ws.pieceScratch as unknown as Array<Entry<S>>;

  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    const mine = s.team === asTeam;
    if (!admit.admits(s, mine)) continue;
    if (sh.fromTurn < tMin) tMin = sh.fromTurn;
    if (sh.horizonTurn > tMax) tMax = sh.horizonTurn;
    (leavesTrail(s.kind) ? trails : pieces).push(ws.takeEntry(s, sh, mine));
  }
  if (trails.length === 0 && pieces.length === 0) {
    return emptyPartition<S>(ws.open, domain, certainDomain, ws.notWall);
  }

  const needDecisive = pieces.length > 0 && trails.length > 0;
  const { ourCum, theirCum, ourStep, theirStep, oursBoard, theirsBoard } = ws;
  const { coveredPrev, coveredNow, newT, decisive, notWall } = ws;
  ourCum.fill(0);
  theirCum.fill(0);
  oursBoard.fill(0);
  theirsBoard.fill(0);
  coveredPrev.fill(0);
  certainDomain.fill(0);
  if (needDecisive) decisive.fill(NEVER);

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

  // --- what each of ours can KEEP (docs/design/entrapment.md §3) -----------
  //
  // The barriers are built from EVERY subject, not only the admitted ones: a
  // unit the reading declines to count ground for still has a body, and §5's
  // two endpoints are about what is HELD and what is contingent, which the
  // admission predicate answers for a different question.
  const bodyGen = bodyBarriersOf(ws, subjects, shells, reading, arrivalTurn);
  const clouds = cloudsOf(ws, subjects, shells, reading);
  const trailRooms: Array<TrailRoom<S>> = [];
  const priced = new Set<UnitId>();
  // ONE PRICING RULE, READ FROM BOTH LOOPS BELOW.
  //
  // THE TWO ENDPOINTS PULL IN OPPOSITE DIRECTIONS AND THAT IS NOT A TYPO.
  // `fear` is `1 − kept/need`, so the worst reading wants the LARGEST
  // denominator and the SMALLEST region, and a region grows with its horizon:
  // `lo` therefore takes `weightMax` for `need` and `weightMin` for the
  // horizon, and `hi` the reverse. For a located mover the two weights are
  // equal and all four numbers are one number, which is every unit this term
  // actually prices.
  //
  // A unit this reading cannot flood from — one of theirs, one of ours that is
  // held, or one with no settled head — reads `kept === need`, which is the
  // term declining to say anything about it rather than a claim it is roomy.
  const roomFor = (s: S, mine: boolean): TrailRoom<S> => {
    const need = needOf(reading === 'lo' ? s.weightMax : s.weightMin);
    const horizon = needOf(reading === 'lo' ? s.weightMin : s.weightMax);
    const head = s.occupancy[0];
    const kept =
      mine && !s.held && head !== undefined
        ? keptOf(ws, head, s.kind, s.unitId, clouds, bodyGen, arrivalTurn, claimHorizonTurn, need, horizon)
        : need;
    return { subject: s, mine, kept, need };
  };
  for (let k = 0; k < trails.length; k++) {
    const e = trails[k] as Entry<S>;
    priced.add(e.s.unitId);
    trailRooms.push(roomFor(e.s, e.mine));
  }

  // AND OUR OWN UNITS THIS READING DOES NOT ADMIT, WHICH IS NOT THE SAME
  // QUESTION. `ADMISSION.lo.ours` drops a CONTINGENT unit of ours because it
  // may own no ground in the worst world — right for a term that COUNTS
  // ground. `room` is a fear, folded through `ourUnitTerm`, which charges a
  // cost over the superset so that a death can never raise our floor; a unit
  // missing from the reading is charged the full fear instead, and a jump of a
  // whole fear between two plans is a cliff in a term that must slide. It is
  // still a mover with a settled body, so its region is measurable, and
  // measuring it is both tighter and continuous. It never enters `ours`,
  // `theirs`, the domain boards or plane 2 — only this list.
  for (const s of subjects) {
    if (s.team !== asTeam || s.held || !s.bestAlive) continue;
    if (!leavesTrail(s.kind) || priced.has(s.unitId)) continue;
    if (s.occupancy[0] === undefined) continue;
    trailRooms.push(roomFor(s, true));
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

// ---------------------------------------------------------------------------
// THE BARRED FLOOD — what a unit can KEEP (docs/design/entrapment.md §3)
// ---------------------------------------------------------------------------

/** One unit's claim cloud, as the stamped arrival grid the shells already hold. */
interface Cloud {
  unitId: UnitId;
  earliest: Int32Array;
}

/**
 * `need(u) = max(4, L + 2)`, and the horizon is the same arithmetic.
 *
 * A region of exactly `L` cells is survivable only if it admits a Hamiltonian
 * cycle — the tail-chase; `+1` buys one meal's growth and `+2` one cell lost to
 * a crowder. The floor at 4 covers the lengths where `L + 2` is smaller than a
 * snake's own immediate neighbourhood. It is ALSO the horizon, and it has to
 * be: a snake dies of a pocket when its own tail stops feeding it slack, the
 * tail takes `L` turns to clear the body, and `REACH_HORIZON_TURNS` = 4 stops
 * looking one turn after the front is blocked and before the body vacates.
 */
export const needOf = (length: number): number => Math.max(4, length + 2);

/**
 * WHICH SUBJECTS BAR, IN THIS READING (§5).
 *
 * A BARRIER IS THE THING BEING FEARED, NOT A THING BEING COUNTED, AND THE TWO
 * WANT OPPOSITE ENDS. Everything else this file computes is ground OWNED, where
 * a barrier costs the reading and the worst world is the one with fewest of
 * them. `kept` is the input to `room`, which is a FEAR — fewer crowders means a
 * larger region, a smaller shortfall and a HIGHER floor. So the floor takes
 * every unit that could be standing there, `s.worstAlive || s.bestAlive`, and
 * not only the ones our worst world leaves alive.
 *
 * The predicate used to read `s.worstAlive` here, with the reasoning of a
 * counted quantity ("`lo` is our worst world, so a unit that is alive in it
 * bars"), and the two disagree on exactly one kind of subject: one of OURS the
 * settlement left contingent. Measured on `law-sweep.test.ts`'s 240 boards, 73
 * worlds had `room`'s own floor above `room`'s own value, and all 73 were that
 * one shape — a contingent teammate that the `lo` flood walked through and the
 * world did not (`docs/design/RATCHET-2.md` §3). For THEIRS the change is
 * nothing at all: `worstAlive` is already the weaker of the two predicates on
 * that side, held or not.
 *
 * `hi` is unchanged and admits a barrier only from a unit alive in BOTH — a
 * barrier from a unit that might be dead would push `hi` DOWN below a world it
 * claims to bound, which is precisely the direction that unsounds a ceiling.
 *
 * NOTHING BUT `room` MOVES. `barsIn` is read by `bodyBarriersOf` and
 * `cloudsOf`, whose output reaches `keptOf` and therefore `TrailRoom.kept`, and
 * `kept` is read by `features.ts::fearsOf` and by nothing else. The domain
 * boards, `ours`, `theirs` and plane 2 are all built above this line.
 */
const barsIn = (s: TerritorySubject & { worstAlive: boolean; bestAlive: boolean }, reading: 'lo' | 'hi'): boolean =>
  reading === 'lo' ? s.worstAlive || s.bestAlive : s.worstAlive && s.bestAlive;

/**
 * CLAUSES (b) AND (c): every trail unit's body on its own vacating schedule,
 * the flooding unit's own included, written into the workspace's stamped grid.
 *
 * `O[i]` is barred at horizon turn `t` iff `i ≤ L − 1 − age − t`, where `age`
 * is how many turns the record is behind the settled board (zero for a mover).
 * That is the neck argument `Claim.certainIfAlive` is built from, generalised
 * from one turn to `t`: a trail unit's occupancy after `t` further turns still
 * retains its old cells `0 … L − 1 − t` whatever it chooses, because it must
 * step and its body follows. At `t = 1` it is exactly `cells[0..len-2]`; at
 * `t = L` it is empty, and THAT is why a snake cannot trap itself.
 *
 * The length is the endpoint that hurts the reading — `weightMax` in `lo`
 * (bodies persist longest) and `weightMin` in `hi`. The occupancy is read in
 * ORDER, which `certainIfAlive` cannot give: the claim sorts its set by cell,
 * so it says which cells are held and never which one leaves next.
 *
 * Returns the generation the grid was written at.
 */
function bodyBarriersOf<S extends TerritorySubject>(
  ws: TerritoryWorkspace,
  subjects: ReadonlyArray<S>,
  shells: ReadonlyMap<UnitId, UnitShells>,
  reading: 'lo' | 'hi',
  arrivalTurn: number
): number {
  const gen = ++ws.bodyGen;
  const stamp = ws.bodyStamp;
  const until = ws.bodyUntil;
  for (const s of subjects) {
    if (!leavesTrail(s.kind)) continue;
    if (!barsIn(s, reading)) continue;
    const sh = shells.get(s.unitId);
    const age = s.held ? Math.max(0, arrivalTurn - (sh?.fromTurn ?? arrivalTurn)) : 0;
    const last = (reading === 'lo' ? s.weightMax : s.weightMin) - 1 - age;
    const occ = s.occupancy;
    const n = Math.min(occ.length, last + 1);
    for (let i = 0; i < n; i++) {
      const c = occ[i] as number;
      const t = last - i;
      if (stamp[c] !== gen) {
        stamp[c] = gen;
        until[c] = t;
      } else if ((until[c] as number) < t) {
        until[c] = t;
      }
    }
  }
  return gen;
}

/**
 * CLAUSE (d): the claims as barriers — ground an enemy or a teammate can hold
 * first, read off the engine's own dilation and never re-derived.
 *
 * A cell is barred at `t` when some OTHER admitted unit's head can be on it AT
 * OR BEFORE `arrivalTurn + t`, which is exactly `earliest ≤ arrivalTurn + t`.
 * `at or before`, not `strictly before`: a tie kills both, so a cell we tie for
 * is not a cell we keep — and that is the whole of what retires the asymmetric
 * tie rule and its held-teammate exemption.
 *
 * A HELD unit contributes its cloud to `lo` only. Its head is a possibility and
 * not a fact, and a ceiling that barred a cell the unit may never reach would
 * sit below a world. On the `hi` side a held unit still bars through its body
 * schedule above, which IS a fact in every world it survives uncut.
 *
 * ONLY A TRAIL UNIT BARS THIS WAY, AND IT IS THE SAME RELAXATION THE TWO-PLANE
 * RULE AT THE TOP OF THIS FILE MAKES, FOR THE SAME MEASURED REASON. A held
 * slider's dilation is a whole line per turn and covers most of an 11x11
 * interior inside two, so admitting pieces here made every snake on `mixed`
 * read a shortfall on every option: 383 of 1115 living unit-turns entrapped by
 * the runner's own instrument, and `room` pinned within 0.018 of −1 across the
 * king's nine options on the `mid11` acceptance board. A saturated set carries
 * no information about the unit's own position — the exact degeneracy
 * `docs/design/entrapment.md` §4.4 exists to guard against, and the one the
 * discarded first arm died of. Excluding pieces is a change to what `v(w)` IS,
 * not a bound loosened: the same function is computed in every world, so R1
 * still holds by §5's first paragraph, and it makes the term identically zero
 * for a board whose only crowders are pieces rather than identically −1.
 *
 * Where `k` runs past the shells' own horizon the front is simply held at its
 * last one — `earliest` is `NEVER` beyond it — which is the cumulative reading
 * `Shells.extendTo` already takes when a front comes back empty.
 */
function cloudsOf<S extends TerritorySubject>(
  ws: TerritoryWorkspace,
  subjects: ReadonlyArray<S>,
  shells: ReadonlyMap<UnitId, UnitShells>,
  reading: 'lo' | 'hi'
): ReadonlyArray<Cloud> {
  const out = ws.clouds;
  out.length = 0;
  for (const s of subjects) {
    if (!leavesTrail(s.kind)) continue;
    if (!barsIn(s, reading)) continue;
    if (s.held && reading === 'hi') continue;
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    out.push(ws.takeCloud(s.unitId, sh.earliest()));
  }
  return out;
}

/**
 * ONE UNIT'S KEPT REGION, capped at `need`.
 *
 *     R_0 = { the settled head cell of u }
 *     R_t = R_{t-1} ∪ { c ∈ step(R_{t-1}) : c is not barred at t }
 *
 * `step` is the engine's own relation through `ShellTable.stepBoard`; this
 * file's whole addition to the dilation is the `∩ ¬barrier` that
 * `Shells.extendTo` does not apply. `stepBoard` is the right reader because
 * `leavesTrail` is the grammar's own `type === "snake"` and a snake reads no
 * facing; a trail kind that did would need `stepsFrom` here.
 *
 * THE UNION-CARRY is what lets the region grow through a cell that only opens
 * later — the head loiters while its own body clears, and §7.1's length-8 coil
 * comes out at ten cells only because of it. It stops at a SINGLETON with no
 * unbarred step: a unit holding one cell has nowhere to wait, it must move, and
 * every move it has is barred. Carrying there would credit it with an escape it
 * cannot walk to, so the flood ends and the region is the cell it stands on.
 */
function keptOf(
  ws: TerritoryWorkspace,
  head: number,
  kind: UnitType,
  self: UnitId,
  clouds: ReadonlyArray<Cloud>,
  bodyGen: number,
  arrivalTurn: number,
  claimHorizonTurn: number,
  need: number,
  horizon: number
): number {
  const words = ws.grid.words;
  const gen = ++ws.regionGen;
  const region = ws.regionCells;
  region.length = 0;
  const stamp = ws.regionStamp;
  const bodyStamp = ws.bodyStamp;
  const bodyUntil = ws.bodyUntil;
  const notWall = ws.notWall;
  stamp[head] = gen;
  region.push(head);
  for (let t = 1; t <= horizon && region.length < need; t++) {
    const before = region.length;
    // Held at the last front once the flood's horizon runs past the shells' —
    // and never read past it, so the answer cannot depend on how far some other
    // caller happened to extend the same interned shells.
    const by = Math.min(arrivalTurn + t, claimHorizonTurn);
    for (let i = 0; i < before && region.length < need; i++) {
      const step = ws.table.stepBoard(kind, region[i] as number);
      for (let wi = 0; wi < words && region.length < need; wi++) {
        // (a) TERRAIN, at every t. A trail unit may legally STAGE the
        // perimeter, so the step relation offers it and this refuses it.
        let word = (((step[wi] as number) & (notWall[wi] as number)) >>> 0);
        const base = wi << 5;
        while (word !== 0) {
          const lowest = word & -word;
          const to = base + (31 - Math.clz32(lowest));
          word = (word & (word - 1)) >>> 0;
          if (stamp[to] === gen) continue;
          if (bodyStamp[to] === bodyGen && (bodyUntil[to] as number) >= t) continue;
          let taken = false;
          for (let c = 0; c < clouds.length; c++) {
            const cloud = clouds[c] as Cloud;
            if (cloud.unitId === self) continue;
            if ((cloud.earliest[to] as number) <= by) {
              taken = true;
              break;
            }
          }
          if (taken) continue;
          stamp[to] = gen;
          region.push(to);
          if (region.length >= need) break;
        }
      }
    }
    if (region.length === before && before === 1) break;
  }
  return Math.min(region.length, need);
}
