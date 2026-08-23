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

import { Fate, NEVER, bbIntersects, bbTest } from '../../partial-engine/index';
import type {
  Board,
  FieldSlot,
  Resolution,
  ScoreBounds,
  StateHandle,
} from '../../partial-engine/index';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { type Bound, type Feature, bound, point } from './bound';
import { REACH_HORIZON_TURNS } from './calibration';

// ---------------------------------------------------------------------------
// Standing: who is on the board, in each of the two worlds
// ---------------------------------------------------------------------------

export interface Standing {
  readonly unitId: UnitId;
  readonly team: number;
  readonly isKing: boolean;
  /** True for a unit carried as a CLAIM rather than as a mover. */
  readonly held: boolean;
  readonly weightMin: number;
  readonly weightMax: number;
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
  /** Absolute-turn arrival grids, one per unit, built once and shared. */
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
  asTeam: number,
  touched: Board
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
      isKing: sub.unitOf(view.unitId)?.isKing === true,
      held: false,
      weightMin: view.weight,
      weightMax: view.weight,
      partialLossMax: 0,
      health: view.health,
      cell: view.cells[0] as number,
      worstAlive: !dead && (!mine || !contingent),
      bestAlive: !dead && (mine || !contingent),
    });
  }

  const words = sub.grid.words;
  for (const slot of resolution.state.field.slots) {
    const mine = slot.record.team === asTeam;
    const cloud = slot.cloud;
    // THE WIDENING THE CLAIM LAYER CANNOT DO FOR ITSELF. A cloud's
    // `deathPossible` is derived from terrain and from the other CLAIMS —
    // mobile units never narrow a cloud — so a held unit that would walk
    // straight into one of this turn's movers is still reported as certainly
    // alive. Priced into a FLOOR that is harmless (an enemy we assume survives
    // is the pessimistic reading anyway). Priced into a CEILING it is a false
    // proof: the world where the enemy blunders into us really exists, and the
    // law harness finds it in one board. So a claim that touches any cell a
    // mover occupied is treated as killable in the reading that hopes for it.
    const contested = cloud.deathPossible || bbIntersects(cloud.possible, touched, words);
    out.push({
      unitId: slot.record.unitId,
      team: slot.record.team,
      isKing: sub.unitOf(slot.record.unitId)?.isKing === true,
      held: true,
      weightMin: slot.bounds.weightMin,
      weightMax: slot.bounds.weightMax,
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
 * Live units are held at the resolution's own turn, which gives a located unit
 * exactly its true reach; already-held units keep their OWN `heldAtTurn`, so
 * their head start rides in as a seed. One fork, one hold, one grid per unit,
 * and the fork goes straight back.
 */
export function buildArrivals(
  sub: EngineSubstrate,
  resolution: Resolution,
  horizonTurns: number
): Map<UnitId, Int32Array> {
  const out = new Map<UnitId, Int32Array>();
  if (horizonTurns <= 0) return out;
  const engine = sub.engine;
  const horizon = resolution.state.turn + horizonTurns;

  // Already-claimed units first: their timelines are on the resolution's own
  // field and need no fork at all.
  for (const slot of resolution.state.field.slots) {
    out.set(slot.record.unitId, slot.timeline.arrival(horizon).earliest);
  }

  const live = engine.liveSlots(resolution.state);
  if (live.length === 0) return out;
  let fork: StateHandle | null = null;
  try {
    fork = engine.fork(resolution.state);
    const held = engine.holdMany(fork, live);
    for (const slot of held.field.slots) {
      if (out.has(slot.record.unitId)) continue;
      out.set(slot.record.unitId, slot.timeline.arrival(horizon).earliest);
    }
  } finally {
    if (fork !== null) engine.release(fork);
  }
  return out;
}

export function makeContext(
  sub: EngineSubstrate,
  resolution: Resolution,
  engineMaterial: ScoreBounds,
  touched: Board,
  asTeam: number,
  horizonTurns: number = REACH_HORIZON_TURNS
): EvalContext {
  const standing = standingOf(sub, resolution, asTeam, touched);
  const teams = new Set(sub.roster().map((u) => u.team));
  let cached: ReadonlyMap<UnitId, Int32Array> | null = null;
  return {
    sub,
    asTeam,
    resolution,
    engineMaterial,
    standing,
    horizonTurns,
    teams,
    arrivals() {
      if (cached === null) cached = buildArrivals(sub, resolution, horizonTurns);
      return cached;
    },
  };
}

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
 * Contested reach: cells our team arrives at strictly before anyone else, minus
 * theirs, normalised by the open board.
 *
 * THE TWO READINGS ARE NOT MIRROR IMAGES, and the asymmetry is the soundness.
 * A cloud's `earliest` is a LOWER bound on when a unit could be somewhere, so
 * it is optimistic about that unit — which is what we want for an ENEMY in our
 * worst reading and for OURSELVES in our best reading, and exactly wrong the
 * other way round. So:
 *
 *   lo  our LOCATED units only, against every enemy the worst world admits at
 *       its earliest possible arrival. A held teammate contributes nothing,
 *       because nothing bounds its arrival from above.
 *   hi  every unit of ours the best world admits, at its earliest, against our
 *       enemies' located units only.
 *
 * With nothing held both readings see the same units at the same exact
 * arrivals, so the feature collapses to a point — R3, visibly rather than by
 * assertion.
 */
export const reachFeature: Feature<EvalContext> = {
  key: 'reach',
  defaultWeight: 1,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    if (ctx.horizonTurns <= 0) return point(0);
    const arrivals = ctx.arrivals();
    if (arrivals.size === 0) return point(0);

    const lo = territory(ctx, arrivals, {
      ours: (s) => s.worstAlive && !s.held,
      theirs: (s) => s.worstAlive,
    });
    const hi = territory(ctx, arrivals, {
      ours: (s) => s.bestAlive,
      theirs: (s) => s.bestAlive && !s.held,
    });
    return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));
  },
};

function territory(
  ctx: EvalContext,
  arrivals: ReadonlyMap<UnitId, Int32Array>,
  admit: { ours: (s: Standing) => boolean; theirs: (s: Standing) => boolean }
): number {
  const cells = ctx.sub.grid.cells;
  const wall = ctx.sub.terrain.wall;
  const ourBest = new Int32Array(cells).fill(NEVER);
  const theirBest = new Int32Array(cells).fill(NEVER);

  for (const s of ctx.standing) {
    const grid = arrivals.get(s.unitId);
    if (grid === undefined) continue;
    const mine = s.team === ctx.asTeam;
    if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;
    const dst = mine ? ourBest : theirBest;
    for (let c = 0; c < cells; c++) {
      const e = grid[c] as number;
      if (e < (dst[c] as number)) dst[c] = e;
    }
  }

  let ours = 0;
  let theirs = 0;
  let open = 0;
  for (let c = 0; c < cells; c++) {
    if (bbTest(wall, c)) continue;
    open++;
    const a = ourBest[c] as number;
    const b = theirBest[c] as number;
    if (a < b) ours++;
    else if (b < a) theirs++;
  }
  return open === 0 ? 0 : (ours - theirs) / open;
}

// ---------------------------------------------------------------------------
// F3 — health economy
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
// F4 — the king weight margin (specialist data row 2)
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
    const arrivals = ctx.arrivals();
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
        const grid = arrivals.get(s.unitId);
        if (grid === undefined) continue;
        if ((grid[king.cell] as number) > nextTurn) continue;
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
  healthEconomyFeature,
  kingMarginFeature,
];

/** Re-exported so a consumer can read a held unit's interval without the engine. */
export type { FieldSlot };
export type { Bound };
