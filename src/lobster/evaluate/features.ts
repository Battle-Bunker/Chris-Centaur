/**
 * THE FEATURE LIBRARY, and the context it reads.
 *
 * Four features, all class-level: nothing here branches on a kind name. What a
 * feature reads is a PROPERTY the rules read — occupancy shape, whether staying
 * is legal, what movement costs, whether the unit is royal — which is the whole
 * generality claim, and the reason a new kind needs no new code.
 *
 * ── ONE PIPELINE ───────────────────────────────────────────────────────────
 *
 * Nothing here re-runs the rules. Every number is folded from the per-unit
 * outcomes of the ONE `resolveBounded` call that produced the resolution being
 * scored: fates, claim intervals, arrival grids. A second pass over the board
 * through a second encoding would be measurably slower AND free to disagree
 * with the thing it is supposed to be scoring.
 *
 * `material` is that fold, in the subject's frame, with the cliff inside it —
 * which is why survival is not a separate feature that could drift out of step
 * with material. It differs from the engine's own `resolveBounded` fold in
 * exactly one place, the held-unit survival widening in `standingOf`, and
 * `ctx.engineMaterial` carries the engine's answer alongside so a test can pin
 * that the two agree wherever the widening does not apply.
 *
 * ── THE TWO WORLDS ─────────────────────────────────────────────────────────
 *
 * Every feature is evaluated twice against the same resolution, in the two
 * extremal alive-sets:
 *
 *   WORST (the subject's)   our contingent units are dead; theirs are alive.
 *   BEST  (the subject's)   our contingent units are alive; theirs are dead.
 *
 * The polarity flips PER PARTICIPANT relative to the subject, and that flip is
 * the whole of the pessimism scope: adjudicating every participant at its own
 * worst endpoint would kill the enemy's movers too, which is the subject's best
 * case wearing its worst case's clothing.
 *
 * ── ABSOLUTE-TURN SEEDING ──────────────────────────────────────────────────
 *
 * `reach` floods each unit's OWN grammar with shells keyed by absolute turn, so
 * a unit last seen three turns ago starts its flood three turns early — a SEED,
 * not an inexpressible negative delay. The flood is the engine's `arrival`
 * grid, and the seed is the record's `heldAtTurn`, so this file only chooses
 * the horizon and reads the answer.
 */

import { Fate } from '../../partial-engine/index';
import type {
  FieldSlot,
  Resolution,
  ScoreBounds,
  UnitKind,
} from '../../partial-engine/index';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { type Bound, type Feature, bound, point } from './bound';
import { REACH_HORIZON_TURNS } from './calibration';
import { ShellTable, buildShells } from './shells';
import type { UnitShells } from './shells';
import { partitionOf, workspaceFor } from './territory';
import type { Admission, Partition } from './territory';

// ---------------------------------------------------------------------------
// Standing: who is on the board, in each of the two worlds
// ---------------------------------------------------------------------------

export interface Standing {
  readonly unitId: UnitId;
  readonly team: number;
  /** The rules' own kind index. Read for CLASS properties, never by name. */
  readonly kind: UnitKind;
  readonly isKing: boolean;
  /** True for a unit carried as a CLAIM rather than as a mover. */
  readonly held: boolean;
  readonly weightMin: number;
  readonly weightMax: number;
  /** Invulnerability tier, as an interval: a held unit's is not known exactly. */
  readonly tierMin: number;
  readonly tierMax: number;
  /** The turn the tier reverts toward 0, when known. Contests read tier at the
   * ARRIVAL turn, so a claim's tier ceiling drops at the expiry. */
  readonly tierExpiresAtTurn: number | null;
  /** Weight a trail unit could lose to a sever without dying. */
  readonly partialLossMax: number;
  /** Observed health. A held unit's true health is at most this. */
  readonly health: number;
  readonly cell: number;
  /** Alive in the subject's WORST world. */
  readonly worstAlive: boolean;
  /** Alive in the subject's BEST world. */
  readonly bestAlive: boolean;
}

export interface EvalContext {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly resolution: Resolution;
  /** The ENGINE's own subject-frame fold, carried for comparison and telemetry. */
  readonly engineMaterial: ScoreBounds;
  readonly standing: ReadonlyArray<Standing>;
  readonly horizonTurns: number;
  /**
   * Every team that had a unit at the START of the turn, subject included.
   * Read from the roster and NOT from the survivors, because a team is
   * eliminated exactly when none of its units is left — and a team read off the
   * survivors can never be eliminated, which silently deletes every terminal
   * clamp.
   */
  readonly teams: ReadonlySet<number>;
  /**
   * Absolute-turn dilation shells, one set per unit, interned per DECISION.
   * These are the boards the engine's own timelines hold; nothing here builds
   * an `ArrivalGrid`, so the eager `minCost` Dijkstra behind `arrival()` — 94%
   * of a cold flood, and read by nothing — never runs.
   */
  shells(): ReadonlyMap<UnitId, UnitShells>;
  /** The two-plane partition, per reading, computed once and shared by every
   * feature that reads territory. */
  partition(reading: 'lo' | 'hi'): Partition<Standing>;
  /**
   * Absolute-turn arrival grids. Stamped from the same shells, so this is the
   * same array `CloudTimeline.arrival().earliest` returns — pinned cell for
   * cell by the drift differential — at none of its cost.
   */
  arrivals(): ReadonlyMap<UnitId, Int32Array>;
}

/**
 * Per-unit standing, in the subject's frame.
 *
 * A CONTINGENT unit is one the optimistic timeline leaves standing but some
 * recorded unknown could have killed. Which world it belongs to depends on
 * whose it is: ours prices at the cliff in the worst reading, theirs prices
 * ALIVE there — the subject's worst world is the one where the enemy came
 * through.
 */
export function standingOf(
  sub: EngineSubstrate,
  resolution: Resolution,
  asTeam: number
): Standing[] {
  const fates = new Map(resolution.fates.map((f) => [f.unitId, f.fate]));
  const out: Standing[] = [];

  for (const view of sub.engine.units(resolution.state)) {
    const mine = view.team === asTeam;
    const fate = fates.get(view.unitId);
    const dead = fate === Fate.Dead || !view.alive;
    const contingent = fate === Fate.Contingent;
    out.push({
      unitId: view.unitId,
      team: view.team,
      kind: view.kind,
      isKing: sub.unitOf(view.unitId)?.isKing === true,
      held: false,
      weightMin: view.weight,
      weightMax: view.weight,
      tierMin: view.tier,
      tierMax: view.tier,
      tierExpiresAtTurn: view.tierExpiresAtTurn,
      partialLossMax: 0,
      health: view.health,
      cell: view.cells[0] as number,
      worstAlive: !dead && (!mine || !contingent),
      bestAlive: !dead && (mine || !contingent),
    });
  }

  for (const slot of resolution.state.field.slots) {
    const mine = slot.record.team === asTeam;
    const cloud = slot.cloud;
    // A cloud's `deathPossible` is derived from terrain and from the other
    // CLAIMS — mobile units never narrow a cloud — so on its own it still
    // reports a held unit that would walk straight into one of this turn's
    // movers as certainly alive. That is harmless in a FLOOR (an enemy we
    // assume survives is the pessimistic reading anyway) and a false proof in
    // a CEILING: the world where the enemy blunders into us really exists.
    //
    // This file used to widen it here, by intersecting the cloud with a
    // snapshot of every cell a mover touched. THE ENGINE ANSWERS IT NOW:
    // `Resolution.mayHaveDied` is exactly that question, computed inside the
    // resolution that knows it, and the engine's own reading of a slot's fate
    // is `deathPossible || mayHaveDied`. Reading the engine's answer instead
    // of recomputing it is what stops the two drifting apart.
    const contested = cloud.deathPossible || (resolution.mayHaveDied & (1 << slot.slot)) !== 0;
    out.push({
      unitId: slot.record.unitId,
      team: slot.record.team,
      kind: slot.record.kind,
      isKing: sub.unitOf(slot.record.unitId)?.isKing === true,
      held: true,
      weightMin: slot.bounds.weightMin,
      weightMax: slot.bounds.weightMax,
      tierMin: slot.bounds.tierMin,
      tierMax: slot.bounds.tierMax,
      tierExpiresAtTurn: slot.record.tierExpiresAtTurn ?? null,
      partialLossMax: Math.max(0, slot.record.weight - slot.bounds.weightMin),
      health: slot.record.health,
      cell: slot.record.occupancy[0] as number,
      worstAlive: !cloud.certainlyGone && (!mine || !contested),
      bestAlive: !cloud.certainlyGone && (mine || !contested),
    });
  }
  return out;
}

/**
 * ABSOLUTE-TURN ARRIVAL GRIDS for every unit on the resolved board.
 *
 * Live units are read at the resolution's own turn, which gives a located unit
 * exactly its true reach; already-held units keep their OWN `heldAtTurn`, so
 * their head start rides in as a seed.
 *
 * There is no fork and no hold set here any more: a live unit's frozen record
 * is a pure function of its view, and building one directly is 8–19 µs per
 * evaluation cheaper than asking the engine to stage the unit just so we can
 * read its dilation. And the grids are stamped from the shells rather than
 * taken off `arrival()`, so the eager `minCost` Dijkstra never runs.
 */
export function buildArrivals(
  sub: EngineSubstrate,
  resolution: Resolution,
  horizonTurns: number,
  table: ShellTable = new ShellTable(sub.grid)
): Map<UnitId, Int32Array> {
  const out = new Map<UnitId, Int32Array>();
  for (const [unitId, sh] of buildShells(sub, resolution, horizonTurns, table)) {
    out.set(unitId, sh.earliest());
  }
  return out;
}

export function makeContext(
  sub: EngineSubstrate,
  resolution: Resolution,
  engineMaterial: ScoreBounds,
  asTeam: number,
  horizonTurns: number = REACH_HORIZON_TURNS
): EvalContext {
  const standing = standingOf(sub, resolution, asTeam);
  const teams = new Set(sub.roster().map((u) => u.team));
  const ws = workspaceFor(sub);
  let shellsCache: ReadonlyMap<UnitId, UnitShells> | null = null;
  let arrivalsCache: ReadonlyMap<UnitId, Int32Array> | null = null;
  const parts: { lo: Partition<Standing> | null; hi: Partition<Standing> | null } = {
    lo: null,
    hi: null,
  };
  const ctx: EvalContext = {
    sub,
    asTeam,
    resolution,
    engineMaterial,
    standing,
    horizonTurns,
    teams,
    shells() {
      if (shellsCache === null) {
        shellsCache = buildShells(sub, resolution, horizonTurns, ws.table);
      }
      return shellsCache;
    },
    partition(reading) {
      const hit = parts[reading];
      if (hit !== null) return hit;
      const made = partitionOf(ws, standing, ctx.shells(), asTeam, ADMISSION[reading]);
      parts[reading] = made;
      return made;
    },
    arrivals() {
      if (arrivalsCache === null) {
        const out = new Map<UnitId, Int32Array>();
        for (const [unitId, sh] of ctx.shells()) out.set(unitId, sh.earliest());
        arrivalsCache = out;
      }
      return arrivalsCache;
    },
  };
  return ctx;
}

/**
 * WHO IS ON THE BOARD, per reading. Not mirror images, and the asymmetry is the
 * soundness: a cloud's `earliest` is a LOWER bound on when a unit could be
 * somewhere, so it is optimistic about that unit — right for an ENEMY in our
 * worst reading and for OURSELVES in our best, and exactly wrong the other way
 * round. A held teammate contributes nothing to `lo` because nothing bounds its
 * arrival from above; a held enemy contributes nothing to `hi` for the same
 * reason. With nothing held both readings admit the same units at the same
 * exact arrivals, so every territory feature collapses to a point.
 */
export const ADMISSION: Readonly<Record<'lo' | 'hi', Admission<Standing>>> = {
  lo: { ours: (s) => s.worstAlive && !s.held, theirs: (s) => s.worstAlive },
  hi: { ours: (s) => s.bestAlive, theirs: (s) => s.bestAlive && !s.held },
};

// ---------------------------------------------------------------------------
// F1 — material (the cliff lives inside it)
// ---------------------------------------------------------------------------

/**
 * Subject-frame material: own minus everyone else, with every contingent unit
 * priced at the cliff on the side that fears it and alive on the side that
 * hopes for it. The engine computed it; this feature only names it and gives it
 * an estimate.
 *
 * The cliff is denominated in the material it loses BY CONSTRUCTION here: a
 * unit that might die contributes 0 to `worst` and its weight to `best`, so
 * "might die" and "dies" score identically in `worst`, and no separate survival
 * scale exists to disagree with material about the same event.
 */
export const materialFeature: Feature<EvalContext> = {
  key: 'material',
  defaultWeight: 10,
  contract: {
    reads: [
      { input: 'contingent-survival', monotone: 'down' },
      { input: 'held-weight', monotone: 'down' },
    ],
    cliff: true,
    dischargeable: true,
  },
  evaluate(ctx) {
    const { worst, best } = materialBounds(ctx);
    return bound(worst, (worst + best) / 2, best);
  },
};

/**
 * The subject-frame material fold: own minus everyone else, over the two
 * extremal alive-sets, at the endpoint each reading needs.
 *
 * This is the ENGINE's fold with one correction — the widened held-unit
 * survival above — and not a second scoring pipeline: the per-unit values it
 * folds come from the one resolution that produced them. `ctx.engineMaterial`
 * carries the engine's own answer alongside, and a test pins that the two agree
 * exactly whenever no claim is contested, so the correction cannot quietly
 * become a divergence.
 */
export function materialBounds(ctx: EvalContext): { worst: number; best: number } {
  let worst = 0;
  let best = 0;
  for (const s of ctx.standing) {
    const mine = s.team === ctx.asTeam;
    const low = Math.max(0, s.weightMin - s.partialLossMax);
    if (mine) {
      if (s.worstAlive) worst += low;
      if (s.bestAlive) best += s.weightMax;
    } else {
      // The subject's worst world is the one where the enemy thrives.
      if (s.worstAlive) worst -= s.weightMax;
      if (s.bestAlive) best -= low;
    }
  }
  return { worst, best };
}

// ---------------------------------------------------------------------------
// F2 — reach (grammar-flooded, absolute-turn seeded)
// ---------------------------------------------------------------------------

/**
 * Contested reach: cells our team holds under the two-plane rule, minus theirs,
 * normalised by the open board.
 *
 * The partition is `./territory.ts` — trail units divide the board, pieces
 * displace at the decisive turn — and it is computed once per reading and
 * shared with `room`, because two features reading the same partition through
 * two encodings is exactly the drift the one-pipeline rule exists to forbid.
 */
export const reachFeature: Feature<EvalContext> = {
  key: 'reach',
  defaultWeight: 1,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'held-weight', monotone: 'down' },
      { input: 'held-tier', monotone: 'down' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    if (ctx.horizonTurns <= 0) return point(0);
    const lo = ctx.partition('lo').balance;
    const hi = ctx.partition('hi').balance;
    return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));
  },
};

// ---------------------------------------------------------------------------
// F3 — per-unit room (the death predictor a team partition cannot see)
// ---------------------------------------------------------------------------

/**
 * A team-partition difference is blind to WHICH of our units is suffocating:
 * one boxed snake and two roomy ones nets a perfectly healthy team territory,
 * and then the boxed one dies. The signal that actually discriminates is
 * per-unit and continuous — a unit's own region dropping through its own body
 * length, five to nine turns before the death, on positions where material is
 * flat and the binary trapped flag never fires at all.
 *
 *     R(u)  cells u reaches strictly before every other admitted trail unit,
 *           teammates included — plane 1 only, so the tie-dominated all-kinds
 *           reading can never starve it
 *     g(u)  min(1, sqrt(R(u) / len(u)))
 *     room  Σ ours g(u) − Σ theirs g(u)
 *
 * A SUM OF SATURATING TERMS, NEVER A MIN. A min over our units is unbounded
 * below the moment any teammate is held — `lo` collapses to 0 and reproduces
 * exactly the vacuity the bound exists to avoid. The sum bounds cleanly (a held
 * teammate contributes between 0 and 1), still punishes confinement, collapses
 * under R3 and is monotone under R2.
 *
 * The LENGTH each term divides by is an interval endpoint too, and it is chosen
 * against the term: a term being maximised in a reading takes the SMALLEST
 * admissible length, one being minimised takes the largest. For a located unit
 * the two are equal, so this only moves where something is genuinely held.
 */
export const roomFeature: Feature<EvalContext> = {
  key: 'room',
  defaultWeight: 3,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'held-weight', monotone: 'down' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    if (ctx.horizonTurns <= 0) return point(0);
    const lo = roomSum(ctx.partition('lo'), 'lo');
    const hi = roomSum(ctx.partition('hi'), 'hi');
    return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));
  },
};

function roomSum(partition: Partition<Standing>, reading: 'lo' | 'hi'): number {
  let total = 0;
  for (const t of partition.trails) {
    // The endpoint that hurts the reading: our term shrinks, theirs grows.
    const wantSmall = reading === 'lo' ? t.mine : !t.mine;
    const len = Math.max(1, wantSmall ? t.subject.weightMax : t.subject.weightMin);
    const g = Math.min(1, Math.sqrt(t.owned / len));
    total += t.mine ? g : -g;
  }
  return total;
}

// ---------------------------------------------------------------------------
// F4 — health economy
// ---------------------------------------------------------------------------

/**
 * Health is a movement budget, not a clock: a unit loses health only by
 * entering cells, and a piece that stands still spends nothing and can stand
 * still forever. So this term is "how many cells may my side still enter",
 * normalised, minus theirs.
 *
 * A HELD unit's health is bounded above by what we last observed and below by
 * zero, and nothing cheaper than a world enumeration tightens that. So the
 * worst reading gives our held units nothing and theirs everything, and the
 * best reading the reverse — loose, sound, and collapsing the moment nothing is
 * held.
 */
export const healthEconomyFeature: Feature<EvalContext> = {
  key: 'healthEconomy',
  defaultWeight: 0.5,
  contract: {
    reads: [
      { input: 'held-health', monotone: 'up' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    const cap = Math.max(1, ctx.sub.engine.config.maxHealth);
    let lo = 0;
    let hi = 0;
    for (const s of ctx.standing) {
      const mine = s.team === ctx.asTeam;
      const share = s.health / cap;
      if (mine) {
        if (s.worstAlive && !s.held) lo += share;
        if (s.bestAlive) hi += share;
      } else {
        if (s.worstAlive) lo -= share;
        if (s.bestAlive && !s.held) hi -= share;
      }
    }
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    return bound(a, (a + b) / 2, b);
  },
};

// ---------------------------------------------------------------------------
// F5 — the king weight margin (specialist data row 2)
// ---------------------------------------------------------------------------

/**
 * A KING SHOULD EAT.
 *
 * Under these rules a king does not have to be outweighed to die: a tie kills
 * everyone, and regicide then removes the whole team. There is no recapture, so
 * a defended square is not a protected one. That leaves exactly three
 * protections — unreachability, out-weighing everything that reaches you, and
 * tier — and weight is the only one the king can buy.
 *
 * So: our king's weight minus the heaviest thing that can stand on its square
 * next turn at a tier it cannot beat. Negative means a unit that can take it;
 * zero means a tie, which is also fatal; positive is the only safe reading.
 *
 * The two readings differ in WHO counts as a reacher: `lo` admits every unit a
 * claim allows onto the square, `hi` only located ones. With nothing held they
 * are the same set.
 */
export const kingMarginFeature: Feature<EvalContext> = {
  key: 'kingMargin',
  defaultWeight: 0.25,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'held-weight', monotone: 'down' },
      { input: 'held-tier', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    if (ctx.horizonTurns <= 0) return point(0);
    const kings = ctx.standing.filter((s) => s.isKing && s.team === ctx.asTeam);
    if (kings.length === 0) return point(0);
    // One membership test on the shells, not a whole arrival grid: the question
    // is "can this unit be on that ONE square by next turn".
    const shells = ctx.shells();
    const cap = Math.max(1, ...ctx.standing.map((s) => s.weightMax));
    const nextTurn = ctx.resolution.state.turn + 1;

    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    for (const king of kings) {
      if (!king.bestAlive) continue;
      let worstThreat = 0;
      let bestThreat = 0;
      for (const s of ctx.standing) {
        if (s.team === ctx.asTeam) continue;
        const sh = shells.get(s.unitId);
        if (sh === undefined) continue;
        if (!sh.reachesBy(king.cell, nextTurn)) continue;
        if (s.worstAlive) worstThreat = Math.max(worstThreat, s.weightMax);
        if (s.bestAlive && !s.held) bestThreat = Math.max(bestThreat, s.weightMax);
      }
      lo = Math.min(lo, (king.weightMin - worstThreat) / cap);
      hi = Math.min(hi, (king.weightMax - bestThreat) / cap);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return point(0);
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    return bound(a, (a + b) / 2, b);
  },
};

// ---------------------------------------------------------------------------
// Terminal clamps — ORDERED, and a lattice meet rather than an addend
// ---------------------------------------------------------------------------

export interface TerminalVerdict {
  readonly subjectGone: boolean;
  readonly othersGone: boolean;
}

/** Is `team` eliminated in the given world? */
function eliminated(
  ctx: EvalContext,
  team: number,
  alive: (s: Standing) => boolean,
  regicide: ReadonlySet<number>
): boolean {
  let standing = 0;
  let king = false;
  for (const s of ctx.standing) {
    if (s.team !== team || !alive(s)) continue;
    standing++;
    if (s.isKing) king = true;
  }
  if (standing === 0) return true;
  return regicide.has(team) && !king;
}

/**
 * The two terminal readings. `subjectGone` is checked FIRST by every caller,
 * because the ordering is the rules' own: a team whose last unit dies has lost,
 * whatever happened to anyone else.
 */
export function terminalVerdicts(ctx: EvalContext): {
  worst: TerminalVerdict;
  best: TerminalVerdict;
} {
  const regicide = ctx.sub.regicideTeamNumbers();
  const others = [...ctx.teams].filter((t) => t !== ctx.asTeam);
  const read = (alive: (s: Standing) => boolean): TerminalVerdict => ({
    subjectGone: eliminated(ctx, ctx.asTeam, alive, regicide),
    othersGone:
      others.length > 0 && others.every((t) => eliminated(ctx, t, alive, regicide)),
  });
  return {
    worst: read((s) => s.worstAlive),
    best: read((s) => s.bestAlive),
  };
}

/** Every feature, in summation order. Order is load-bearing for reproducibility. */
export const FEATURES: ReadonlyArray<Feature<EvalContext>> = [
  materialFeature,
  reachFeature,
  roomFeature,
  healthEconomyFeature,
  kingMarginFeature,
];

/** Re-exported so a consumer can read a held unit's interval without the engine. */
export type { FieldSlot };
export type { Bound };
export type { UnitShells } from './shells';
export type { Partition, TrailRoom } from './territory';
