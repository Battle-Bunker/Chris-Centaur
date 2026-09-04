/**
 * THE FEATURE LIBRARY, and the context it reads.
 *
 * Five features, all class-level: nothing here branches on a kind name. What a
 * feature reads is a PROPERTY the rules read — occupancy shape, whether it
 * leaves a trail, whether staying is legal, what movement costs, whether the
 * unit is royal — which is the whole generality claim, and the reason a new
 * kind needs no new code. `leavesTrail` is what decides which plane of the
 * territory partition a unit belongs to, and it is a rule, not a taxonomy.
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
 * `reach` and `room` read each unit's OWN grammar through shells keyed by
 * absolute turn, so a unit last seen three turns ago starts its flood three
 * turns early — a SEED, not an inexpressible negative delay. The shells are the
 * engine's own dilation, and the seed is the record's `heldAtTurn`, so this
 * file only chooses the horizon and reads the answer.
 */

import { isPieceType, leavesTrail } from '../../engine-vendor/engine/moveGrammar';
import type { UnitType } from '../../engine-vendor/shared/types/Game';
import type { PartialSettlement } from '../../engine-vendor/engine/settlePartial';
import { bbSet, bbTest, boardOf } from '../bits';
import type { Bitboard } from '../bits';
import type { MaterialBounds } from '../bounds/material';
import {
  claimSurvivals,
  claimsById,
  moverSeverLoss,
  moverSurvival,
  moverWeightCeiling,
  remainsOf,
} from '../bounds/material';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { royalMargin } from '../staging-safety';
import { type Bound, type Feature, bound, envelope, point } from './bound';
import { REACH_HORIZON_TURNS } from './calibration';
import type { CommandKnobs, CriterionProfile } from './calibration';
import { ShellTable, buildShells } from './shells';
import type { UnitShells } from './shells';
import { perBoard } from './memo';
import { partitionOf, workspaceFor } from './territory';
import type { Admission, Partition } from './territory';
import { contestFeature } from './contest';
import { energyFeature } from './energy';
import { foodFeature } from './food';
import { momentumFeature } from './momentum';
import { potionFeature } from './potion';
import { tierFeature } from './tier';

// ---------------------------------------------------------------------------
// Standing: who is on the board, in each of the two worlds
// ---------------------------------------------------------------------------

export interface Standing {
  readonly unitId: UnitId;
  readonly team: number;
  /** The rules' own kind. Read for CLASS properties through the grammar. */
  readonly kind: UnitType;
  readonly isKing: boolean;
  /** True for a unit carried as a CLAIM rather than as a mover. */
  readonly held: boolean;
  readonly weightMin: number;
  readonly weightMax: number;
  /** Invulnerability tier, as an interval: a held unit's is not known exactly. */
  readonly tierMin: number;
  readonly tierMax: number;
  /** The tier this unit carries into the ARRIVAL turn if nothing moves it —
   * the engine's own lapse of the effect schedule, for a claim; its own frozen
   * tier for a mover. */
  readonly tierAtArrival: number;
  /** The turn the tier reverts toward 0, when known. */
  readonly tierExpiresAtTurn: number | null;
  /** Weight a trail unit could lose to a sever without dying. */
  readonly partialLossMax: number;
  /** Observed energy. A held unit's true energy is at most this. */
  readonly energy: number;
  readonly cell: number;
  /** The cells a HELD unit still occupies in every world it survives — the
   * engine's `Claim.certainIfAlive`. Empty for a mover: a mover's occupancy is
   * settled, not conditional. */
  readonly certainIfAlive: ReadonlyArray<number>;
  /**
   * WHETHER THIS UNIT ENDS THE TURN WHERE THE TIMELINE SAYS IT DOES.
   *
   * Survival and weight are bracketed; POSITION never was. The optimistic
   * timeline stops a mover where a held claim's body happens to be standing,
   * lets it through where the claim moved, and halts it on exhaustion where
   * the claim halted it — so a mover the ledger names for any of those has a
   * settled cell that is one world's answer rather than every world's, and a
   * term reading its front off that cell is reading one world.
   *
   * A HELD unit is certain by construction here: its "position" is its whole
   * claim cloud, which is the union over its worlds, and the readings already
   * choose which side of that union each term is entitled to.
   */
  readonly positionCertain: boolean;
  /** Alive in the subject's WORST world. */
  readonly worstAlive: boolean;
  /** Alive in the subject's BEST world. */
  readonly bestAlive: boolean;
}

/** One frozen empty list, so a mover's `certainIfAlive` is not an allocation. */
const EMPTY_CELLS: ReadonlyArray<number> = Object.freeze([]);

export interface EvalContext {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly resolution: PartialSettlement;
  /** The subject-frame material fold, carried for comparison and telemetry. */
  readonly engineMaterial: MaterialBounds;
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
   * What one team's worth of room is, on THIS board: the largest trail-unit
   * count any team started the turn with. A board constant — read off the
   * turn-start roster, not off who a reading admits — so dividing by it is a
   * positive rescale and nothing more. See `roomFeature`.
   */
  readonly roomScale: number;
  /**
   * The same board constant for PIECES: the largest number of non-trail units
   * any team started the turn with, floored at 1. `commandFeature` divides by
   * it for exactly the reason `room` divides by `roomScale` — a bare sum of
   * per-unit terms has a range that grows with the roster, so a weight safe on
   * a one-piece board is not safe on a four-piece one.
   */
  readonly pieceScale: number;
  /** The heaviest unit the turn OPENED with — see `RosterConstants.weightCap`. */
  readonly weightCap: number;
  /**
   * Absolute-turn arrival grids. Stamped from the same shells, so this is the
   * same array `CloudTimeline.arrival().earliest` returns — pinned cell for
   * cell by the drift differential — at none of its cost.
   */
  arrivals(): ReadonlyMap<UnitId, Int32Array>;
  /** See `CriterionProfile.royalReachers`. Read by `kingMargin` only. */
  readonly royalReachers: boolean;
  /** The command term's multipliers, or null when the feature is switched off. */
  readonly command: CommandKnobs | null;
  /** The energy-budget reserve fraction, or null for the linear reading. */
  readonly energyReserveRatio: number | null;
  /** The food board of the RESOLVED position — post food phase, so a meal this
   * turn is gone from it for every reader. Built once, on demand. */
  food(): Bitboard;
  /**
   * THE FOOD NO HELD UNIT COULD HAVE TAKEN — `food()` minus every cell a held
   * unit's cloud could have its head on when the turn closes.
   *
   * `food()` is the food the SETTLEMENT closed with, and a settlement leaves a
   * held unit's meal uneaten because it does not know whether the unit went
   * there. That is the right board for a term counting what THEY can reach and
   * the wrong one for a term counting what WE can: a meal a held enemy may
   * already have eaten is not ours to count in a floor. Equal to `food()` when
   * nothing is held, so the readings still collapse to a point.
   */
  certainFood(): Bitboard;
  /**
   * THE FOOD THAT MAY STILL BE THERE — `food()` plus every meal only a
   * CONTINGENT unit could have taken.
   *
   * `food()` is the board the OPTIMISTIC TIMELINE closed with, and that
   * timeline lets a unit eat that a held enemy could have killed first. So it
   * is not an upper bound on the food a world leaves standing, and a term that
   * SUBTRACTS a reading of food — their pieces in `lo`, ours in `hi` — read off
   * it was above its own worlds: measured as a floor of −35.72775 against a
   * world of −35.805875, on a board where our contingent queen ate the meal
   * their held queen was two cells from.
   *
   * A meal a unit that certainly survives is standing on is certainly gone;
   * every other cell the turn opened with and the timeline cleared comes back.
   * Equal to `food()` when nothing is contingent, so R3 is untouched, and it
   * can only shrink under a refinement, so R2 is too.
   */
  wideFood(): Bitboard;
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
/**
 * Divergence kinds that can change WHERE a mover ends the turn, or what its
 * front looks like from there. `sever` cuts a tail and leaves the head; `food`
 * and `potion` move weight and tier; `regicide` is death, which `worstAlive`
 * already carries. Everything else can stop the unit short, let it through, or
 * change the kind it moves as.
 */
const POSITION_KINDS: ReadonlySet<string> = new Set([
  'contest',
  'edge',
  'bodyBlock',
  'durable',
  'exhaustion',
  'grammar',
  'promotion',
]);

/** Movers whose settled cell is one world's answer rather than every world's. */
function displacedMovers(settlement: PartialSettlement): ReadonlySet<string> {
  const out = new Set<string>();
  for (const d of settlement.ledger) {
    if (POSITION_KINDS.has(d.kind)) out.add(d.unitId);
  }
  return out;
}

export function standingOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement,
  asTeam: number
): Standing[] {
  const out: Standing[] = [];
  const claimById = claimsById(settlement);
  const displaced = displacedMovers(settlement);
  // ONE READING OF SURVIVAL, shared with the material fold: the peril this
  // plan cannot change, united with the peril it just made. See
  // `bounds/material.ts` — a fold that disagreed with the bank about who is
  // alive would be a second scoring pipeline in the one place it matters.
  const survivals = claimSurvivals(settlement, sub.perilOf(), remainsOf(sub, settlement));

  for (const unit of sub.roster()) {
    const mine = unit.team === asTeam;
    const claim = claimById.get(unit.wireId);
    if (claim !== undefined) {
      // A HELD unit, bracketed by what could have become of it.
      const contested = (survivals.get(claim.id) ?? 'maybe') === 'maybe';
      out.push({
        unitId: unit.unitId,
        team: unit.team,
        kind: claim.kinds[0] ?? unit.type,
        isKing: unit.isKing,
        held: true,
        weightMin: claim.weightMin,
        weightMax: claim.weightMax,
        tierMin: claim.tierMin,
        tierMax: claim.tierMax,
        tierAtArrival: claim.tierAtArrival,
        tierExpiresAtTurn: unit.tierExpiresAtTurn,
        partialLossMax: Math.max(0, unit.weight - claim.weightMin),
        energy: claim.energyMax,
        cell: unit.cells[0] as number,
        certainIfAlive: claim.certainIfAlive,
        positionCertain: true,
        worstAlive: !claim.certainlyGone && (!mine || !contested),
        bestAlive: !claim.certainlyGone && (mine || !contested),
      });
      continue;
    }

    // A MOVER. The settlement says where it ended and what it weighs; the
    // ledger says whether anything unknown could have TAKEN it — which is not
    // the same as whether anything unknown could have changed its turn, and
    // not the same again as whether anything unknown could have CUT it: a
    // sever is the engine's one non-fatal contact, and a mover carries the
    // weight it could lose to one exactly as a held unit does
    // (`moverSeverLoss`).
    const settled = settlement.board[unit.wireId];
    const survival = moverSurvival(settlement, unit.wireId);
    const dead = survival === 'no';
    const contingent = survival === 'maybe';
    // A MOVER THE OPTIMISTIC TIMELINE KILLED AND THE LEDGER LEFT CONTINGENT is
    // alive in some world and has no settled board entry to read. Its weight
    // there is bounded by `moverWeightCeiling`, its energy by what it carried
    // in (a turn only spends energy), and its cell by the furthest the
    // settlement saw it get — which is where it stands in the world where
    // nothing stopped it and the closest thing the settlement holds to a
    // position for one where something did. See `bounds/material.ts`.
    const gone = settled === undefined;
    const possible = gone && !dead;
    const traversed = settlement.traversed[unit.wireId] ?? [];
    const weight = settled?.occupancy.length ?? 0;
    // See `moverWeightCeiling`: any mover the ledger names could have been fed
    // by a world this timeline did not take — and, at the other end, could
    // have gone hungry in one.
    const contingentWeight = settlement.fates[unit.wireId] === 'contingent';
    const weightMax =
      possible || contingentWeight ? Math.max(weight, moverWeightCeiling(sub, unit)) : weight;
    const weightFloor = contingentWeight ? Math.min(weight, unit.weight) : weight;
    // NOT `settlement.tiers`, which already carries this turn's pickup. A
    // standing's tier is the one the unit CARRIES IN, and the pickup's effect
    // enters the fold once, through `tiersAfterPickupBy`, priced over the
    // window it actually opens. Reading the settled figure here would charge
    // the same +1 twice, once for the window and once for the turn.
    out.push({
      unitId: unit.unitId,
      team: unit.team,
      kind: settlement.unitTypes[unit.wireId] ?? unit.type,
      isKing: unit.isKing,
      held: false,
      weightMin: weightFloor,
      weightMax,
      tierMin: unit.tier,
      tierMax: unit.tier,
      tierAtArrival: unit.tier,
      tierExpiresAtTurn: unit.tierExpiresAtTurn,
      partialLossMax: moverSeverLoss(settlement, unit.wireId, unit.cells[0] as number),
      energy: settled?.energy ?? (possible ? unit.energy : 0),
      cell:
        settled?.occupancy[0] ??
        (possible ? (traversed[traversed.length - 1] ?? (unit.cells[0] as number)) : (unit.cells[0] as number)),
      certainIfAlive: EMPTY_CELLS,
      positionCertain: !displaced.has(unit.wireId),
      worstAlive: !dead && (!mine || !contingent),
      bestAlive: !dead && (mine || !contingent),
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
  resolution: PartialSettlement,
  horizonTurns: number,
  table: ShellTable = new ShellTable(sub)
): Map<UnitId, Int32Array> {
  const out = new Map<UnitId, Int32Array>();
  for (const [unitId, sh] of buildShells(sub, resolution, horizonTurns, table)) {
    out.set(unitId, sh.earliest());
  }
  return out;
}

export function makeContext(
  sub: EngineSubstrate,
  resolution: PartialSettlement,
  engineMaterial: MaterialBounds,
  asTeam: number,
  horizonTurns: number = REACH_HORIZON_TURNS,
  /**
   * The profile's optional knobs. Absent means every optional term keeps the
   * reading it had: I2's two are off, and `royalReachers` falls back to
   * `CENTAUR_ROYAL_MARGIN` exactly as I1's defaulted parameter did.
   *
   * INTEGRATION NOTE (integ/round-a): I1 added a trailing positional
   * `royalReachers: boolean = royalMargin()` here and I2 added a trailing
   * `profile?` bag. Rather than stack two optional positionals — where the
   * order is invisible at the call site and every future knob makes it worse —
   * they are collapsed into the ONE bag, since `royalReachers` is already a
   * `CriterionProfile` field that I1 itself added. Both defaults are preserved
   * exactly; see the context construction below.
   */
  profile?: Pick<CriterionProfile, 'command' | 'energyReserveRatio' | 'royalReachers'>
): EvalContext {
  const standing = standingOf(sub, resolution, asTeam);
  const ws = workspaceFor(sub);
  // THE ROSTER CONSTANTS, ONCE PER SUBSTRATE. All three are folds over
  // `sub.roster()`, which is fixed for the life of a substrate — and this
  // function runs once per EVALUATION, tens of thousands of times a decision.
  // Cached on the substrate object, so a modelled sibling recomputes its own
  // (there are a handful of them) and nothing is shared across decisions.
  const constants = rosterConstantsOf(sub);
  const teams = constants.teams;
  const roomScale = constants.roomScale;
  const pieceScale = constants.pieceScale;
  let shellsCache: ReadonlyMap<UnitId, UnitShells> | null = null;
  let arrivalsCache: ReadonlyMap<UnitId, Int32Array> | null = null;
  let foodCache: Bitboard | null = null;
  let certainFoodCache: Bitboard | null = null;
  let wideFoodCache: Bitboard | null = null;
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
    roomScale,
    // I1's default was a defaulted PARAMETER (`= royalMargin()`), which fires
    // on `undefined`; reading it off the optional bag with the same fallback is
    // the identical behaviour for a caller that passes no profile and for a
    // profile that does not set the field.
    royalReachers: profile?.royalReachers ?? constants.royalReachers,
    pieceScale,
    weightCap: constants.weightCap,
    command: profile?.command ?? null,
    energyReserveRatio: profile?.energyReserveRatio ?? null,
    shells() {
      if (shellsCache === null) {
        shellsCache = buildShells(sub, resolution, horizonTurns, ws.table, ws.shellsOut);
      }
      return shellsCache;
    },
    partition(reading) {
      const hit = parts[reading];
      if (hit !== null) return hit;
      // ONE SWEEP WHEN THE TWO READINGS ADMIT THE SAME SUBJECTS.
      //
      // `partitionOf` is a pure function of (workspace, standing, shells,
      // asTeam, admission) — the domain board is an OUT parameter, not an
      // input — so two readings whose admission predicates agree on every
      // subject compute the same sweep twice. They agree exactly when nothing
      // is contingent and nothing is held, which is what a FULLY MODELLED
      // board is: 30.6% of the evaluations on `mixed 20 1 --nodes`, each
      // paying twice for one answer.
      //
      // The other reading is then this partition with its OWN domain board —
      // the two boards stay separate, as `Partition.domain` requires, and the
      // contents are the same because the sweep is. Every other field is a
      // number or a read-only array nothing here mutates, so it is shared.
      const other = reading === 'lo' ? 'hi' : 'lo';
      const twin = parts[other];
      if (twin !== null && sameAdmission(standing, asTeam)) {
        const board = ws.domainFor(reading);
        board.set(twin.domain);
        const certain = ws.certainDomainFor(reading);
        certain.set(twin.certainDomain);
        const shared: Partition<Standing> = { ...twin, domain: board, certainDomain: certain };
        parts[reading] = shared;
        return shared;
      }
      const made = partitionOf(
        ws,
        standing,
        ctx.shells(),
        asTeam,
        ADMISSION[reading],
        reading,
        ws.domainFor(reading),
        ws.certainDomainFor(reading)
      );
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
    certainFood() {
      if (certainFoodCache === null) {
        const board = ws.certainFoodOut;
        board.set(ctx.food());
        const words = sub.grid.words;
        // A HELD unit of EITHER side, because either can eat: our own held
        // team-mate is not admitted to `lo` and can still take the meal.
        for (const s of standing) {
          if (!s.held) continue;
          const sh = ctx.shells().get(s.unitId);
          if (sh === undefined) continue;
          const front = sh.frontAt(sub.arrivalTurn);
          if (front === null) continue;
          for (let i = 0; i < words; i++) {
            board[i] = ((board[i] as number) & ~(front[i] as number)) >>> 0;
          }
        }
        certainFoodCache = board;
      }
      return certainFoodCache;
    },
    wideFood() {
      if (wideFoodCache === null) {
        const board = ws.wideFoodOut;
        board.set(ctx.food());
        // The meals the turn OPENED with. A cell the timeline cleared is
        // certainly cleared only when the unit standing on it certainly lives:
        // a contingent eater is one an unknown could have taken first, and in
        // that world nobody ate.
        const opened = sub.marshalled.config.food;
        if (opened.length > 0) {
          let certainlyEaten: Set<number> | null = null;
          for (const cell of opened) {
            if (bbTest(board, cell)) continue;
            if (certainlyEaten === null) {
              certainlyEaten = new Set<number>();
              for (const s of standing) {
                if (s.held || !s.worstAlive || !s.bestAlive) continue;
                const settled = resolution.board[sub.unitOf(s.unitId)?.wireId ?? ''];
                if (settled === undefined) continue;
                for (const c of settled.occupancy) certainlyEaten.add(c);
              }
            }
            if (!certainlyEaten.has(cell)) bbSet(board, cell);
          }
        }
        wideFoodCache = board;
      }
      return wideFoodCache;
    },
    food() {
      if (foodCache === null) {
        // The food the turn CLOSED with: what a reach term should reach for is
        // what is still on the board once every eater has eaten.
        foodCache = boardOf(sub.grid, resolution.food);
      }
      return foodCache;
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
/**
 * The trail-unit count the WHOLE BOARD fielded at the START of the turn —
 * summed over teams, not the largest single team's.
 *
 * Read off the roster and NOT off who a reading admits, because that is what
 * makes it a CONSTANT: the same number in the partial reading, in every world
 * the soundness law enumerates, and under every refinement. A divisor derived
 * from the admitted set instead would turn a sum into a mean, and a mean is not
 * monotone in admission — our floor would read a single roomy unit as a whole
 * team's worth of room and then find the world, with two boxed teammates also
 * on the board, scoring below it.
 *
 * WHY THE SUM AND NOT THE MAX (O-P3). `roomFeature` divides
 * `Σ_ours g(u) − Σ_theirs g(u)` by this number, with `g(u) ∈ [0,1]` per unit.
 * Under the MAX, our admitted trails are at most one team's worth T = scale but
 * the OTHER K−1 teams each contribute up to T as well, so `room ∈ [−(K−1), +1]`
 * and its span is K, not 2. That is not a hypothetical: rf-falsifier measured
 * room's observed range as exactly [−2.000, +1.000] over 160,826 readings, with
 * 6.06% below −1 and every one of them on a three-team board, against
 * `territory-acceptance.test.ts`'s assertion that `room ∈ [−1,1]` holds "on ANY
 * board, by construction". Dividing by the whole board's trail population makes
 * that assertion true as written for every K: the numerator's positive part is
 * bounded by our share of the divisor and its negative part by the rest, so
 * `room ∈ [−1, +1]` and the rules-sound span certificate drops from `w·K` to
 * `w·2` (9.0 → 3.0 on a three-team board), which is what returns the certified
 * core reach+room+king to 5.5 and back under the lattice step of 10.
 *
 * This is a BEHAVIOUR CHANGE, deliberately, and on every board shape rather
 * than only the three-team ones: with identical per-team rosters the divisor
 * becomes K·T, so room's realised range contracts by a factor of K and the
 * feature carries proportionally less of the ordering everywhere. It is gated
 * on its own measured arm, not folded into anything else.
 */
interface RosterConstants {
  readonly teams: Set<number>;
  readonly roomScale: number;
  readonly pieceScale: number;
  /**
   * `CENTAUR_ROYAL_MARGIN`, read ONCE PER SUBSTRATE — which is once per
   * decision, the cadence `stagingSafety()` next to it already documents
   * ("read once per decision, never in a hot loop"). It was being read from
   * `process.env` on every evaluation, and a `process.env` lookup is a trip
   * through the real environment: 1.4% of total self time on `mixed 40 1
   * --nodes`. Still read LIVE rather than at import — a case that flips the
   * variable builds its own substrate, which is what the test that pins this
   * behaviour does.
   */
  readonly royalReachers: boolean;
  /**
   * THE WEIGHT SCALE, off the ROSTER and never off the survivors.
   *
   * `kingMargin` divides by "the heaviest thing on the board", and reading
   * that off `ctx.standing` made the DENOMINATOR a function of who a world
   * kills: the world in which a held snake ran into itself dropped the cap
   * from 3 to 2 and the same margin scored 0.5 against a ceiling of 0.333.
   * A normaliser that moves with the world is not a normaliser — it is a
   * second, unbracketed term — so it is a board constant like the other two
   * scales beside it, floored at 1 so a board of singletons divides by one.
   */
  readonly weightCap: number;
}

const rosterConstants = new WeakMap<EngineSubstrate, RosterConstants>();

/** `teams`, `trailScaleOf` and `pieceScaleOf` — one roster walk, memoised. */
function rosterConstantsOf(sub: EngineSubstrate): RosterConstants {
  return perBoard(rosterConstants, sub, () => ({
    teams: new Set(sub.roster().map((u) => u.team)),
    roomScale: trailScaleOf(sub),
    pieceScale: pieceScaleOf(sub),
    royalReachers: royalMargin(),
    weightCap: Math.max(1, ...sub.roster().map((u) => u.weight)),
  }));
}

export function trailScaleOf(sub: EngineSubstrate): number {
  let total = 0;
  for (const u of sub.roster()) {
    if (!leavesTrail(u.type)) continue;
    total += 1;
  }
  return Math.max(1, total);
}

/** The same constant for the OTHER plane: the largest piece count any team
 * started the turn with. Read off the roster for the same reason — see
 * `trailScaleOf` — and floored at 1 so a piece-free board divides by one and
 * a sum of nothing stays zero rather than becoming a division by zero. */
export function pieceScaleOf(sub: EngineSubstrate): number {
  const byTeam = new Map<number, number>();
  for (const u of sub.roster()) {
    if (leavesTrail(u.type)) continue;
    byTeam.set(u.team, (byTeam.get(u.team) ?? 0) + 1);
  }
  return Math.max(1, ...byTeam.values());
}

export const ADMISSION: Readonly<Record<'lo' | 'hi', Admission<Standing>>> = {
  lo: { ours: (s) => s.worstAlive && !s.held, theirs: (s) => s.worstAlive },
  hi: { ours: (s) => s.bestAlive, theirs: (s) => s.bestAlive && !s.held },
};

/**
 * Whether the two readings admit exactly the same subjects — the predicates
 * above, evaluated side by side rather than restated. A subject on which they
 * disagree is one the settlement left contingent (or a held stand-in), and one
 * such subject is enough to make the two sweeps different questions.
 */
function sameAdmission(standing: ReadonlyArray<Standing>, asTeam: number): boolean {
  const lo = ADMISSION.lo;
  const hi = ADMISSION.hi;
  for (const s of standing) {
    const mine = s.team === asTeam;
    if ((mine ? lo.ours(s) : lo.theirs(s)) !== (mine ? hi.ours(s) : hi.theirs(s))) return false;
  }
  return true;
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
    return envelope(lo, hi);
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
 *     room  ( Σ ours g(u) − Σ theirs g(u) ) / one team's worth of trail units
 *
 * A SUM OF SATURATING TERMS, NEVER A MIN. A min over our units is unbounded
 * below the moment any teammate is held — `lo` collapses to 0 and reproduces
 * exactly the vacuity the bound exists to avoid. The sum bounds cleanly (a held
 * teammate contributes between 0 and 1), still punishes confinement, collapses
 * under R3 and is monotone under R2.
 *
 * A BARE SUM, THOUGH, IS NOT A CONSTANT-WEIGHTABLE FEATURE. Its range across
 * candidates is roughly the number of units we command, so a weight that sits
 * safely under the cliff on a three-snake board sits over it on a five-snake
 * one — 3 × 5 = 15 against a lightest-unit cost of 10. `reach` already divides
 * by the open board for exactly this reason; `room` divides by the largest
 * trail count any team started the turn with, which is a BOARD constant rather
 * than a property of who a reading admits, so the sum keeps its monotonicity
 * and the feature keeps a bounded range on every board shape.
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
    const lo = roomSum(ctx.partition('lo'), 'lo') / ctx.roomScale;
    const hi = roomSum(ctx.partition('hi'), 'hi') / ctx.roomScale;
    return envelope(lo, hi);
  },
};

/**
 * A UNIT'S EXCLUSIVE ROOM IS A COMPETITION, AND ONLY ONE SIDE OF IT CAN BE
 * READ OFF ONE SWEEP.
 *
 * `owned` is "cells this unit reaches strictly before every OTHER admitted
 * trail unit", so it falls when another admitted unit crowds it. Every unit
 * the reading admits at a CLOUD — a held one, dilated from where it was last
 * observed — or at a life it may not have — a contingent mover — crowds cells
 * it may not be at in the world being priced. That direction is right for a
 * term the reading MINIMISES (ours in `lo`, theirs in `hi`): more crowding is
 * a smaller number, and a smaller number is the bound. It is exactly wrong for
 * the term the reading MAXIMISES, and reading it there is where the floor went
 * above the truth.
 *
 * Measured on `potions` seed 8: a held enemy snake's cloud crowded its own
 * LOCATED team-mate — the unit `B1` had just enumerated — out of four of the
 * six cells that team-mate owns in every world it enumerated. Their `−g` shrank,
 * the floor rose 0.37 above a complete world the bank went on to settle, and
 * the bank threw 77 times in one game. The crowder belonged to the enemy, the
 * cells it stole belonged to the enemy, and our floor collected the difference.
 *
 * So the maximised side is read off the sweep only when the crowd is CERTAIN —
 * every admitted trail unit located and alive in every world, which is what a
 * fully modelled board is, and which is what keeps R3 collapse exact. With one
 * uncertain crowder admitted the upper bound available without a second sweep
 * against a different crowd is the saturation point of `g` itself, and that is
 * what is used: `g ≤ 1` by construction, for every unit, on every board.
 */
function roomSum(partition: Partition<Standing>, reading: 'lo' | 'hi'): number {
  // A crowder that might not be where the sweep puts it can only be one of
  // these two, and either makes every maximised `owned` an under-count.
  const crowdCertain = partition.trails.every(
    (t) => !t.subject.held && t.subject.worstAlive && t.subject.bestAlive
  );
  let total = 0;
  for (const t of partition.trails) {
    // The endpoint that hurts the reading: our term shrinks, theirs grows.
    const wantSmall = reading === 'lo' ? t.mine : !t.mine;
    const len = Math.max(1, wantSmall ? t.subject.weightMax : t.subject.weightMin);
    const g = wantSmall || crowdCertain ? Math.min(1, Math.sqrt(t.owned / len)) : 1;
    total += t.mine ? g : -g;
  }
  return total;
}

// ---------------------------------------------------------------------------
// F4 — energy economy
// ---------------------------------------------------------------------------

/**
 * Energy is a movement budget, not a clock: a unit loses energy only by
 * entering cells, and a piece that stands still spends nothing and can stand
 * still forever. So this term is "how many cells may my side still enter",
 * normalised, minus theirs.
 *
 * A HELD unit's energy is bounded above by what we last observed and below by
 * zero, and nothing cheaper than a world enumeration tightens that. So the
 * worst reading gives our held units nothing and theirs everything, and the
 * best reading the reverse — loose, sound, and collapsing the moment nothing is
 * held.
 */
export const energyEconomyFeature: Feature<EvalContext> = {
  key: 'energyEconomy',
  defaultWeight: 0.5,
  contract: {
    reads: [
      { input: 'held-energy', monotone: 'up' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    const cap = Math.max(1, ctx.sub.defaultMaxEnergy);
    const reserve = ctx.energyReserveRatio;
    let lo = 0;
    let hi = 0;
    for (const s of ctx.standing) {
      const mine = s.team === ctx.asTeam;
      const share = budgetShare(s, cap, reserve);
      if (mine) {
        if (s.worstAlive && !s.held) lo += share;
        if (s.bestAlive) hi += share;
      } else {
        if (s.worstAlive) lo -= share;
        if (s.bestAlive && !s.held) hi -= share;
      }
    }
    return envelope(lo, hi);
  },
};

/**
 * A UNIT'S SHARE OF THE MOVEMENT BUDGET.
 *
 * `energy / max` is the reading for a kind that has no choice: a trail unit
 * must step every turn, so its energy really is a clock and every point of it
 * is worth the same. A kind that may DECLINE to spend — `stayLegal`, which is a
 * rule and not a taxonomy — is in a different situation, and the linear reading
 * misprices it badly: it charges the 98th energy point exactly as much as the
 * 2nd, which turns a survival term into a per-cell travel tax. Measured on the
 * budget ladder's own replays, that tax was the ONLY term with dynamic range
 * over a slider's own options — 0.23–0.37 weighted against `reach`'s
 * 0.0000–0.0076 — and it is why the territory profile's argmax is the
 * shortest-travel option among material ties in 73–96% of positions.
 *
 * With a reserve set, a stay-legal unit above it reads a flat 1: nothing it can
 * do in one turn brings the budget near binding, so the term says nothing about
 * where it should go. Below it the term slides to zero over the reserve rather
 * than over the whole maximum, so exhaustion is priced MORE sharply than before,
 * not less. Monotone increasing in energy either way, so both bound endpoints
 * keep the direction the contract declares.
 */
export function budgetShare(
  s: Pick<Standing, 'energy' | 'kind'>,
  cap: number,
  reserveRatio: number | null
): number {
  if (reserveRatio === null || !isPieceType(s.kind)) return s.energy / cap;
  const reserve = Math.max(1, reserveRatio * cap);
  return Math.min(1, s.energy / reserve);
}

// ---------------------------------------------------------------------------
// F6 — piece command (the gradient the displacement plane cannot carry)
// ---------------------------------------------------------------------------

/**
 * WHAT A PIECE IS WORTH WHERE IT STANDS.
 *
 * The two-plane rule is right that a piece does not DIVIDE the board — but the
 * consequence, measured, is that a piece's own move changes the partition by
 * nothing at all. Plane 2 credits a piece at `c` when `arrival_p(c) ≤ D(c)`, and
 * a slider's arrival is at most two turns to nearly every cell FROM ANY SQUARE,
 * so the displacement set is saturated: across all 71 legal actions of a queen
 * on a real board, `ours` and `theirs` do not move by a single cell. `room` is
 * plane 1 only, so it is identically zero for a piece. The territory objective
 * therefore has NO opinion about where a piece goes, and the profile's only
 * surviving preference is the travel tax above.
 *
 * This is the missing gradient, and it is the same doctrine read one turn
 * earlier. Plane 2 asks where a piece could eventually be; this asks what it
 * can act on NEXT TURN, which is the part of a slider's position that its
 * arrival grid throws away:
 *
 *     command(u) = ( |F_u ∩ domain| · ground  +  |F_u ∩ food| · food ) / open
 *     term       = ( Σ ours min(1, command)  −  Σ theirs min(1, command) )
 *                  / pieceScale
 *
 * where `F_u` is the unit's own arriving front at turn + 1 — a board the shells
 * already hold — and `domain` is the trail domain of the SAME reading's
 * partition: the ground plane 1 is actually contesting. Counting only contested
 * ground is what stops this being a chess mobility prior on a game that does not
 * reward mobility: a rook's front is 44 cells from every square on an empty
 * board and carries no information at all, and it is the intersection with the
 * trail domain and with food that discriminates.
 *
 * SOUNDNESS, AND WHY EACH SIDE READS ITS OWN BOARDS. It reads exactly the
 * inputs `reach` reads, through the same ADMISSION, and in the same direction.
 * A held enemy's front is its cloud's head-possible set, which is a SUPERSET of
 * the truth, so `theirs` is over-counted in `lo` and narrowing it can only
 * raise our floor (R2 up in held-arrival). Our own held units are dropped from
 * `lo` and theirs from `hi`, so with nothing held the two readings are the same
 * set at the same fronts and the feature collapses to a point (R3).
 *
 * A superset is only conservative on the side it SUBTRACTS from, though, and
 * both of this term's boards are supersets when something is held: the trail
 * domain carries a held enemy's whole claim cloud, and `resolution.food` still
 * carries the meal a held unit may already have taken. Read for OUR pieces
 * either one lifts the floor above worlds it claims to bound — measured by a
 * randomised R1 sweep at `command.lo` 1.000 against worlds of 0.776 and 0.694.
 * So a term the reading ADDS is read off `Partition.certainDomain` and
 * `EvalContext.certainFood` — the same two boards minus what a held cloud
 * merely MIGHT hold — and a term it SUBTRACTS off the wide ones. Which side
 * that makes ours is the READING's business and not the side's: `lo` adds our
 * pieces and subtracts theirs, `hi` does the reverse, and the boards swap with
 * it, or the ceiling ends up under its own worlds. Both narrowings vanish when
 * nothing is held, so R3 is untouched, and both can only shrink under a
 * refinement, so R2 is too.
 *
 * NOT FOR A ROYAL UNIT. `knobs.royal` is off, and it is off for a reason the
 * rules supply rather than a tuning one — see `CommandKnobs.royal`.
 *
 * OFF BY DEFAULT, and off costs one branch. A board with no piece on it scores
 * exactly zero here whatever the knobs say, which is what makes this profile
 * bit-identical to the plain territory one on an all-snake board.
 */
export const commandFeature: Feature<EvalContext> = {
  key: 'command',
  defaultWeight: 0,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    const knobs = ctx.command;
    if (knobs === null || ctx.horizonTurns <= 0) return point(0);
    const lo = commandSum(ctx, 'lo', knobs);
    const hi = commandSum(ctx, 'hi', knobs);
    return envelope(lo, hi);
  },
};

function commandSum(
  ctx: EvalContext,
  reading: 'lo' | 'hi',
  knobs: CommandKnobs
): number {
  const partition = ctx.partition(reading);
  const open = partition.open;
  if (open === 0) return 0;
  const admit = ADMISSION[reading];
  const words = ctx.sub.grid.words;
  // TWO DOMAINS, ONE PER DIRECTION THE ERROR MAY POINT — AND THE DIRECTION IS
  // THE READING'S, NOT THE SIDE'S.
  //
  // `partition.domain` is a SUPERSET of the contested ground: a held enemy
  // trail is dilated from where it was observed, so its front is its claim
  // cloud. `partition.certainDomain` is the same board minus what such a cloud
  // merely MIGHT hold, so it is a subset. Every term here is a bound in one
  // direction, and which board bounds it is decided by whether the reading is
  // MAXIMISING that term or minimising it:
  //
  //   lo  ours ← certain (a term we add, bounded below)
  //       theirs ← wide  (a term we subtract, bounded above)
  //   hi  ours ← wide    (added, bounded above)
  //       theirs ← certain (subtracted, bounded below)
  //
  // The floor half of that was the first repair (measured: `command.lo` 1.000
  // against worlds of 0.776 and 0.694 on a held-snake board). The ceiling half
  // is the same statement mirrored, and leaving it unmirrored made `hi` a
  // CEILING BELOW ITS OWN WORLDS: our piece was priced on the ground a held
  // cloud might take from it while their piece was priced on the ground that
  // cloud might give it, in the reading where both should be read the other
  // way. Measured by a randomised R1 sweep over 205 held boards: five ceilings
  // under a world, all of them here.
  //
  // Both fall back to the open board when plane 1 is contesting NOTHING — a
  // team whose last trail unit died has an empty domain, and a term that read
  // only the domain would go blind on exactly the position where the pieces
  // are the entire game. The fallback is gated on the FULL domain, never on
  // the certain one: an empty certain domain under a non-empty full one is the
  // defect above, not a piece-only board, and widening a side there would
  // restore precisely what this fixes.
  const wide = partition.domain;
  const certain = partition.certainDomain;
  let ourDomain = reading === 'lo' ? certain : wide;
  let theirDomain = reading === 'lo' ? wide : certain;
  let any = 0;
  for (let i = 0; i < words; i++) any |= wide[i] as number;
  if (any === 0) {
    ourDomain = partition.openBoard;
    theirDomain = partition.openBoard;
  }
  // TWO FOOD BOARDS, for the same reason and with the same flip: a meal a held
  // unit's cloud covers is one our floor may not count for our own piece and
  // one our ceiling may not withhold from it.
  const ourFood = reading === 'lo' ? ctx.certainFood() : ctx.wideFood();
  const theirFood = reading === 'lo' ? ctx.wideFood() : ctx.certainFood();
  const nextTurn = ctx.sub.arrivalTurn + 1;
  let total = 0;
  for (const s of ctx.standing) {
    if (leavesTrail(s.kind)) continue;
    // A royal unit is not paid for activity: see CommandKnobs.royal.
    if (s.isKing && !knobs.royal) continue;
    const mine = s.team === ctx.asTeam;
    if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;
    // A MOVER THE LEDGER DISPLACED HAS NO ONE FRONT TO READ. Its settled cell
    // is the optimistic timeline's, and this term is a number in [0, 1], so
    // the reading takes the end of that interval it is responsible for rather
    // than a front from a world it does not own: nothing for a term it is
    // adding, everything for one it is subtracting. Same rule as every other
    // interval here — see `territory.ts`'s endpoint header.
    if (!s.positionCertain) {
      const weakest = (reading === 'lo') === mine;
      const c = weakest ? 0 : 1;
      total += mine ? c : -c;
      continue;
    }
    const sh = ctx.shells().get(s.unitId);
    if (sh === undefined) continue;
    const front = sh.frontAt(nextTurn);
    if (front === null) continue;
    let ground = 0;
    let meals = 0;
    const domain = mine ? ourDomain : theirDomain;
    const food = mine ? ourFood : theirFood;
    for (let i = 0; i < words; i++) {
      const f = front[i] as number;
      if (f === 0) continue;
      ground += popcount32((f & (domain[i] as number)) >>> 0);
      meals += popcount32((f & (food[i] as number)) >>> 0);
    }
    const c = Math.min(1, (ground * knobs.ground + meals * knobs.food) / open);
    total += mine ? c : -c;
  }
  return total / ctx.pieceScale;
}

function popcount32(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0x3f;
}

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
 *
 * ── WHO COUNTS AS A REACHER (CENTAUR_ROYAL_MARGIN) ─────────────────────────
 *
 * "The heaviest THING that can stand on its square" — and the code read only
 * the units on other teams. These rules grant no friendly-fire exemption and
 * spawn the king at the lightest weight on the board, so a team-mate reaching
 * that square is not a lesser version of the danger, it is the SAME danger with
 * the same rule behind it; and it is the larger half of it in practice —
 * 27.0% of every king death in the measured corpus was inflicted by the dying
 * king's own team, against a bot whose own material term prices its king at one
 * point. Under the flag the loop reads every unit that is not this king,
 * team-mates included, which is what the sentence above already said.
 *
 * It stays an ORDERING term. The floor does not need it: a resolution in which
 * our king dies is `subjectGone`, which the terminal clamp replaces with DEAD.
 * What this moves is `est` and `hi` — the channels that lead under fog and that
 * order candidates the floor ties — so the king's danger is visible on the
 * channel a starved decision actually reads.
 *
 * ── WHICH THREATS EACH READING MAY COUNT ──────────────────────────────────
 *
 * `hi` is the LARGEST margin any admitted world leaves, so the threat it
 * subtracts has to be the smallest one every world keeps: a reacher that
 * merely MIGHT be alive is gone in some world, and its weight is an interval
 * whose bottom is what a world can hold it to. Counting a contingent reacher
 * at `weightMax` there made `hi` a ceiling under its own worlds — the world in
 * which the held unit killed our reacher scores a margin the ceiling forbids.
 * The same for a reacher the ledger DISPLACED: its front is read off one
 * timeline's cell, so `hi` may only count it where that cell is certain, and
 * `lo` has to count it whether it reaches on this timeline or not.
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
    const cap = ctx.weightCap;
    const nextTurn = ctx.sub.arrivalTurn + 1;

    const friendlyReachers = ctx.royalReachers;

    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    for (const king of kings) {
      if (!king.bestAlive) continue;
      let worstThreat = 0;
      let bestThreat = 0;
      for (const s of ctx.standing) {
        if (friendlyReachers ? s.unitId === king.unitId : s.team === ctx.asTeam) continue;
        const sh = shells.get(s.unitId);
        if (sh === undefined) continue;
        // A displaced mover's front is one timeline's; the worst reading may
        // not require it to reach on that timeline, and the best may not
        // believe it where it does.
        const reaches = sh.reachesBy(king.cell, nextTurn);
        if (s.worstAlive && (reaches || !s.positionCertain)) {
          worstThreat = Math.max(worstThreat, s.weightMax);
        }
        if (s.worstAlive && s.bestAlive && !s.held && s.positionCertain && reaches) {
          bestThreat = Math.max(bestThreat, Math.max(0, s.weightMin - s.partialLossMax));
        }
      }
      lo = Math.min(lo, (king.weightMin - worstThreat) / cap);
      // A king the ledger displaced has no one square to be threatened ON, so
      // the best reading claims no threat at all rather than one square's.
      hi = Math.min(hi, (king.weightMax - (king.positionCertain ? bestThreat : 0)) / cap);
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
  energyEconomyFeature,
  kingMarginFeature,
  commandFeature,
  foodFeature,
  momentumFeature,
  contestFeature,
  tierFeature,
  energyFeature,
  potionFeature,
];

export type { Bound };
export type { UnitShells } from './shells';
export type { Partition, TrailRoom } from './territory';
