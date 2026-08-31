/**
 * THE POTION-AWARE LINEUP — the four merged potion entries, seated.
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 *
 * `./attack-window.ts`, `./potion-seek.ts`, `./potion-control.ts` and
 * `./dodge-discount.ts` each publish a `StrategyEntry` for the `evaluator`
 * socket, and until this file existed none of them was in any slate: they were
 * merged members of the evaluator collection that nothing could select, so no
 * configurable bot read a potion at all. This module is the selection half —
 * the adapter that hands those terms the live position, and the lineup the
 * `potion-aware` slate resolves to.
 *
 * It adds no joint. The evaluator socket already existed, the entries already
 * existed, and what arrives here is a way to name them from a `BotConfig`.
 *
 * ── WHY EVERY TERM IS ADVISORY, AND WHAT THAT COSTS THEM ───────────────────
 *
 * All four entries declare `soundness: 'advisory'`, and the registry's seam
 * rule is that an entry which can change a sound bound owes the law harness as
 * its admission gate. None of these can supply that certificate: a potion's
 * value depends on a window three turns wide over a board whose enemies move,
 * and no term here can state, per uncertain input, which way it is monotone in
 * that input.
 *
 * So they reach the decision through `advisoryEst` (`./bound.ts`) and nowhere
 * else. The weighted sum lands on `est`, clamped back inside the interval the
 * sound features proved; `lo` and `hi` are handed back untouched. `est` orders
 * moves among floor ties and adjudicates nothing (`better()` in
 * `../search/core.ts` reads it only after `compareFloors` has tied), so what a
 * potion-aware bot buys is a different ORDER over plans its floor cannot
 * separate — which is exactly the claim these four terms make and the only
 * claim their evidence supports.
 *
 * ── THE COMPOSITION, AND WHERE IT REFUSES TO DOUBLE-COUNT ──────────────────
 *
 * The four are not four independent sums. They are one reading of a potion
 * board, split the way the modules themselves split it:
 *
 *   · `eval/potion-seek@3` prices a pickup NOT YET MADE — what the allies could
 *     cut at +1 once a collector pays −1 to open the window, net of what the
 *     collector is exposed to. It is the only term that reads the potion cells
 *     as a destination.
 *   · `eval/attack-window@2` prices a window ALREADY OPEN, at `tierDelta: 0` —
 *     the units whose own live tier already beats a body's owner. That is why
 *     the id is `@2` and not `@1`: `@1` judges at `+1`, which is potion-seek's
 *     prospective gain and would be counted twice. At `tierDelta: 0` the term
 *     is identically zero unless some unit of ours is carrying a live buff,
 *     which is precisely the half of the potion story potion-seek stops at.
 *   · `eval/potion-control@2` prices the GROUND — option value on potions we
 *     reach first minus threat value on the ones they do. Denial, which
 *     potion-seek deliberately excludes as a different decision.
 *   · `eval/dodge-discount@2` is a MODIFIER and carries weight zero. Its
 *     presence in the lineup is what switches potion-seek's exposure from the
 *     undiscounted `window` endpoint to the `near` endpoint with the collector's
 *     escape fan priced — which is what `eval/potion-seek@2`'s own params
 *     already say the near reading is. Absent, nothing walks a ray and the
 *     exposure is the worst case exactly as the module ships it.
 *
 * ── THE CURRENCY ───────────────────────────────────────────────────────────
 *
 * Every term is in ENEMY-WEIGHT units except potion-seek, which folds itself to
 * OUR-weight units through `severExchangeRate` — the share-metric rate computed
 * off the live board, never a knob. The other two are multiplied by that same
 * rate here, so the whole lineup speaks the fold's own currency: the same one
 * `material` is denominated in, at weight 10.
 *
 * ── THE GATES ARE FREE, AND THAT IS THE POINT ──────────────────────────────
 *
 * On a potions-off board — and on a potions-on board with none standing —
 * `anyPotionStanding` is false, `teamHasLiveWindow` is false, and every term
 * returns zero having read one bitboard. No ray is walked, no reach is read and
 * no `RayBoard` is built. The lineup's cost is a cost of potion boards.
 */

import { bbForEach } from '../../partial-engine/index';
import type { Board } from '../../partial-engine/index';
import type { AdvisoryCache, AdvisoryTerm } from './bound';
import type { EvalContext } from './features';
import { indexOccupancy } from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import { UNREACHABLE, teamAttackWindow } from './attack-window';
import type { ArrivalReach } from './attack-window';
import { bestPotionSeek, teamHasLiveWindow } from './potion-seek';
import type { ExposureReading } from './potion-seek';
import { anyPotionStanding, potionControlSummary } from './potion-control';
import { severExchangeRate } from './slider-attack-vector';
import { EngineSubstrate } from '../substrate';
import { BoundEvaluator, defaultEvaluator } from './index';
import type { Evaluator } from '../contracts';
// The ids and the weights are the ENTRIES' — `../registry.ts` owns them, so a
// slate and the lineup that implements it cannot drift apart. A value import
// of the registry is safe here and not circular: the registry imports the four
// potion modules and this file, never the other way round.
import {
  EVAL_ATTACK_WINDOW_BOLD_ID,
  EVAL_ATTACK_WINDOW_ID,
  EVAL_DODGE_DISCOUNT_BOLD_ID,
  EVAL_DODGE_DISCOUNT_ID,
  EVAL_POTION_CONTROL_BOLD_ID,
  EVAL_POTION_CONTROL_ID,
  EVAL_POTION_SEEK_BOLD_ID,
  EVAL_POTION_SEEK_ID,
  POTION_TERM_WEIGHTS,
} from '../registry';

// ---------------------------------------------------------------------------
// The board adapter
// ---------------------------------------------------------------------------

/**
 * One scratch potion bitboard per substrate. The terms run once per plan
 * evaluation and a decision prices thousands of plans, so allocating a
 * `Uint32Array` per evaluation would be the largest single cost in the lineup.
 * Keyed weakly on the substrate for the same reason `territory.ts` keys its
 * workspace there: a released substrate takes its scratch with it.
 */
const potionScratch = new WeakMap<EngineSubstrate, Board>();

/**
 * THE POTION CELLS OF THE RESOLVED POSITION — read once per evaluation, over
 * the bitboard's WORDS and not its cells.
 *
 * The cell-at-a-time scan this replaces cost `grid.cells` `bbTest` calls on
 * every evaluation of every plan, whether or not a potion was standing: 441 on
 * a 21x21, paid ~4,700 times a game by the gate and again by the view. A board
 * bearing two potions has two set bits in fourteen words, so `bbForEach` skips
 * the empty words and does thirteen loads instead of four hundred and forty-one
 * tests. Identical output, by construction — same board, same ascending order.
 */
const CELLS_KEY = 'potion-lineup:cells';

function potionCellsOf(sub: EngineSubstrate, ctx: EvalContext): ReadonlyArray<number> {
  let dst = potionScratch.get(sub);
  if (dst === undefined) {
    dst = new Uint32Array(sub.grid.words) as unknown as Board;
    potionScratch.set(sub, dst);
  }
  sub.engine.potionBoard(ctx.resolution.state, dst);
  const cells: number[] = [];
  bbForEach(dst, sub.grid.words, (c) => cells.push(c));
  return cells;
}

/** The same list, shared across the lineup's terms for one evaluation — so the
 * gate and the view read one scan rather than two. */
function potionCellsShared(
  sub: EngineSubstrate,
  ctx: EvalContext,
  shared: AdvisoryCache
): ReadonlyArray<number> {
  return shared.for(CELLS_KEY, () => potionCellsOf(sub, ctx));
}

/**
 * THE TIER-EXPIRY CONVENTION, CONVERTED ONCE, HERE.
 *
 * The engine reads `tierExpiresAtTurn` as "at this turn the tier has already
 * reverted" (`partial-engine/cloud.ts`: expired when `heldAtTurn + n >=
 * tierExpiresAtTurn`). `RayUnit.tierExpiresAtTurn` is the INCLUSIVE last turn
 * the tier still governs a contest (`ray-crossing.ts`: `turn <= expiry`). The
 * two differ by exactly one and the conversion belongs at the boundary rather
 * than inside either module, or one of them silently rounds the wrong way on
 * the last turn of every window.
 */
const inclusiveExpiry = (engineExpiry: number | null): number | null =>
  engineExpiry === null ? null : engineExpiry - 1;

/**
 * THE RESOLVED POSITION, AS THE POTION MODULES READ A BOARD — and it is TWO
 * sources, which is the one thing a reader has to know about this function.
 *
 * `PartialEngine.units()` returns the LOCATED units only. Everything the
 * decision did not simulate — every enemy, on almost every board — is FROZEN
 * into `state.field.slots` as a claim with a possibility cloud, and is absent
 * from the unit arena entirely. A board built from `units()` alone therefore
 * has no enemies on it at all, which makes `severExchangeRate` divide by our
 * own weight (returning `Infinity`), makes every enemy body invisible to a ray
 * walk, and makes all four potion terms identically zero on every board. That
 * is not a hypothetical: it is what this adapter did before it read the field,
 * and the symptom was a slate that resolved correctly and changed nothing.
 *
 * So a held unit enters at its FROZEN RECORD — the occupancy, weight, tier and
 * health it was frozen with, at the cell it was frozen on. That is the honest
 * reading for these terms and not a convenience: `ray-crossing.ts` is a static
 * read at one instant by construction ("nothing here predicts"), and the
 * prediction the caller would otherwise have to make is exactly the one
 * `attackWindow` makes for itself out of the movement rule.
 *
 * A unit the cloud has proved gone is left off. A unit that MIGHT have died is
 * left on, which is the pessimistic reading for a gain term (an enemy body we
 * may not get to cut is one we do not bank) and the pessimistic reading for an
 * exposure term (an enemy that may be dead can still contest the collector).
 */
function rayBoardOf(sub: EngineSubstrate, ctx: EvalContext): RayBoard {
  const units: RayUnit[] = [];
  for (const u of sub.engine.units(ctx.resolution.state)) {
    units.push({
      unitId: String(u.unitId),
      team: u.team,
      kind: u.kind,
      occupancy: u.cells,
      weight: u.weight,
      tier: u.tier,
      tierExpiresAtTurn: inclusiveExpiry(u.tierExpiresAtTurn),
      health: u.health,
    });
  }
  for (const slot of ctx.resolution.state.field.slots) {
    if (slot.cloud.certainlyGone) continue;
    const r = slot.record;
    units.push({
      unitId: String(r.unitId),
      team: r.team,
      kind: r.kind,
      occupancy: r.occupancy,
      weight: r.weight,
      tier: r.tier,
      tierExpiresAtTurn: inclusiveExpiry(r.tierExpiresAtTurn ?? null),
      health: r.health,
    });
  }
  return {
    width: sub.grid.width,
    height: sub.grid.height,
    units,
    turn: ctx.resolution.state.turn,
  };
}

/**
 * REACH, BORROWED — never rebuilt.
 *
 * `EvalContext.arrivals()` is the same absolute-turn grid the territory
 * reading already stamped from this decision's interned shells, keyed by the
 * numeric `UnitId`. `ArrivalReach` is keyed by the string id a `RayBoard`
 * carries, so this is a re-key and nothing else: no flood is run and no grid
 * is copied. That is what makes the four terms' cost the cost of their own
 * fans rather than of a second arrival pass.
 */
function reachOf(ctx: EvalContext): ArrivalReach {
  const grids = ctx.arrivals();
  const byString = new Map<string, Int32Array>();
  for (const [unitId, grid] of grids) byString.set(String(unitId), grid);
  return {
    earliestAt(unitId: string, cell: number): number {
      const g = byString.get(unitId);
      if (g === undefined) return UNREACHABLE;
      const t = g[cell];
      if (t === undefined) return UNREACHABLE;
      return t >= UNREACHABLE ? UNREACHABLE : t;
    },
  };
}

/** Everything the four terms share for one (plan, board). Built at most once
 * per evaluation, and only when some term's gate has already opened. */
export interface PotionView {
  readonly sub: EngineSubstrate;
  readonly board: RayBoard;
  readonly index: OccupancyIndex;
  readonly reach: ArrivalReach;
  readonly turn: number;
  readonly asTeam: number;
  readonly potionCells: ReadonlyArray<number>;
  /** `p / (1 − p)` off the live board — what one unit of enemy weight removed
   * is worth in units of our own. Never a knob. */
  readonly exchangeRate: number;
}

const VIEW_KEY = 'potion-lineup:view';

/** The shared view, or null when this evaluation has no engine substrate to
 * read (the bounds harness and the memo proxies stand in a `Substrate` that is
 * not the engine's; the lineup declines rather than guessing). */
function viewOf(ctx: EvalContext, shared: AdvisoryCache): PotionView | null {
  return shared.for(VIEW_KEY, () => {
    const sub = ctx.sub;
    if (!(sub instanceof EngineSubstrate)) return null;
    const board = rayBoardOf(sub, ctx);
    const turn = ctx.resolution.state.turn;
    const rate = severExchangeRate(board, ctx.asTeam);
    return {
      sub,
      board,
      index: indexOccupancy(board, turn),
      reach: reachOf(ctx),
      turn,
      asTeam: ctx.asTeam,
      potionCells: potionCellsShared(sub, ctx, shared),
      exchangeRate: rate,
    };
  });
}

/**
 * THE CHEAP GATE, TAKEN BEFORE THE VIEW IS BUILT.
 *
 * One bitboard read and a scan of the living units. A board with no potion
 * standing and no live window on our side cannot make any of the four terms
 * non-zero, and this is where that is paid for instead of in a `RayBoard`.
 */
const GATE_KEY = 'potion-lineup:gate';

interface Gate {
  readonly potions: boolean;
  readonly liveWindow: boolean;
}

function gateOf(ctx: EvalContext, shared: AdvisoryCache): Gate {
  return shared.for(GATE_KEY, () => {
    const sub = ctx.sub;
    if (!(sub instanceof EngineSubstrate)) return { potions: false, liveWindow: false };
    const cells = potionCellsShared(sub, ctx, shared);
    // `teamHasLiveWindow` wants a board; at the gate `EvalContext.standing`
    // answers the same question without building one, and it is the merged
    // view — located units and held claims together — so a buffed unit the
    // decision never simulated is not missed.
    const turn = ctx.resolution.state.turn;
    let live = false;
    for (const s of ctx.standing) {
      if (s.team !== ctx.asTeam || !s.bestAlive) continue;
      const expiry = s.tierExpiresAtTurn === null ? null : s.tierExpiresAtTurn - 1;
      const tier = expiry === null || turn <= expiry ? s.tierMax : 0;
      if (tier > 0) {
        live = true;
        break;
      }
    }
    return { potions: cells.length > 0, liveWindow: live };
  });
}

// ---------------------------------------------------------------------------
// The four terms
// ---------------------------------------------------------------------------

/**
 * `eval/attack-window@2` — the window we are ALREADY holding.
 *
 * `tierDelta: 0` judges every unit at its own live tier, and a body cut needs a
 * tier strictly above the owner's, so the reading is identically zero unless
 * some unit of ours is carrying a buff. That is the exact complement of
 * potion-seek, which prices the window nobody has bought yet.
 */
const attackWindowTerm = (key: string): AdvisoryTerm<EvalContext> => ({
  key,
  weight: POTION_TERM_WEIGHTS[key] ?? 0,
  estimate(ctx, shared) {
    if (!gateOf(ctx, shared).liveWindow) return 0;
    const view = viewOf(ctx, shared);
    if (view === null || !Number.isFinite(view.exchangeRate)) return 0;
    // Asserted through the module's own predicate as well as the gate's scan:
    // the two must agree, and the module's is the one that owns the rule.
    if (!teamHasLiveWindow(view.board, view.asTeam, view.turn)) return 0;
    const window = teamAttackWindow(
      view.board,
      view.asTeam,
      { turn: view.turn, tierDelta: 0, reach: view.reach },
      view.index
    );
    return view.exchangeRate * window.total.est;
  },
});

/**
 * `eval/potion-seek@3` — the best pickup on the board, netted.
 *
 * The exposure endpoint is decided by the LINEUP and not by this term: with
 * `eval/dodge-discount@2` seated the near reading is charged with the
 * collector's escape fan priced, and without it the undiscounted window
 * endpoint is, which is the worst case the module ships and the reading its
 * retrodiction was taken at.
 */
function potionSeekTerm(
  key: string,
  exposure: ExposureReading,
  dodge: boolean
): AdvisoryTerm<EvalContext> {
  return {
    key,
    weight: POTION_TERM_WEIGHTS[key] ?? 0,
    estimate(ctx, shared) {
      if (!gateOf(ctx, shared).potions) return 0;
      const view = viewOf(ctx, shared);
      if (view === null || !Number.isFinite(view.exchangeRate)) return 0;
      const choice = bestPotionSeek(
        view.board,
        view.asTeam,
        view.potionCells,
        view.exchangeRate,
        {
          turn: view.turn,
          reach: view.reach,
          exposure,
          // TERRAIN, BORROWED. `dodgeDiscount` builds one by walking every cell
          // of the board when it is not handed one, which costs more than the
          // ray fan it exists to walk. The substrate's own terrain is the
          // terrain of this board — same grid, same hazards — so it is passed
          // straight through and nothing is rebuilt.
          dodge: dodge
            ? { turn: view.turn, reach: view.reach, terrain: view.sub.terrain }
            : null,
        },
        view.index
      );
      return choice === null ? 0 : choice.net;
    },
  };
}

/** `eval/potion-control@2` — option value on the ground we reach first, minus
 * the threat value on the ground they do. */
const potionControlTerm = (key: string): AdvisoryTerm<EvalContext> => ({
  key,
  weight: POTION_TERM_WEIGHTS[key] ?? 0,
  estimate(ctx, shared) {
    if (!gateOf(ctx, shared).potions) return 0;
    const view = viewOf(ctx, shared);
    if (view === null || !Number.isFinite(view.exchangeRate)) return 0;
    if (!anyPotionStanding(view.potionCells)) return 0;
    const summary = potionControlSummary(
      view.board,
      view.asTeam,
      view.potionCells,
      { turn: view.turn, reach: view.reach },
      view.index
    );
    return view.exchangeRate * summary.net;
  },
});

/**
 * `eval/dodge-discount@2` — the modifier, seated as a member so the slate can
 * name it and a measurement can attach to it.
 *
 * Weight zero and a reading of zero: everything it does happens by being
 * present, which switches potion-seek's exposure endpoint above. A term that
 * summed its own multiplier into the fold would be double-charging the same
 * exposure it exists to discount.
 */
const dodgeDiscountTerm = (key: string): AdvisoryTerm<EvalContext> => ({
  key,
  weight: POTION_TERM_WEIGHTS[key] ?? 0,
  estimate: () => 0,
});

/**
 * THE LINEUP, BUILT FROM THE ENTRY IDS A SLATE NAMES.
 *
 * Ids the lineup does not implement are ignored here and refused earlier: the
 * registry resolves a slate by id and throws on a name it does not hold, so an
 * id that reaches this function is an entry that exists. What this function
 * decides is only the COMPOSITION — which is why dodge-discount changes
 * potion-seek's construction rather than appending a term of its own.
 */
/**
 * THE TWO DECLARED SCALES, side by side — quiet and bold. One row per volume,
 * so a slate names four ids and this table says which term each one is. The
 * WEIGHTS are not here: they live in `POTION_TERM_WEIGHTS` beside the entries
 * that declare them, because a weight is a params value and a lineup that
 * carried a second copy of one could drift from the entry it implements.
 */
const SCALES: ReadonlyArray<{
  readonly window: string;
  readonly seek: string;
  readonly control: string;
  readonly dodge: string;
}> = [
  {
    window: EVAL_ATTACK_WINDOW_ID,
    seek: EVAL_POTION_SEEK_ID,
    control: EVAL_POTION_CONTROL_ID,
    dodge: EVAL_DODGE_DISCOUNT_ID,
  },
  {
    window: EVAL_ATTACK_WINDOW_BOLD_ID,
    seek: EVAL_POTION_SEEK_BOLD_ID,
    control: EVAL_POTION_CONTROL_BOLD_ID,
    dodge: EVAL_DODGE_DISCOUNT_BOLD_ID,
  },
];

export function advisoryLineupFor(
  evaluatorIds: ReadonlyArray<string>
): ReadonlyArray<AdvisoryTerm<EvalContext>> {
  const named = new Set(evaluatorIds);
  const out: AdvisoryTerm<EvalContext>[] = [];
  for (const scale of SCALES) {
    // THE MODIFIER IS SCALE-LOCAL. `eval/dodge-discount@3` switches the bold
    // seek's exposure endpoint and the `@2` row switches the quiet one; a
    // slate that mixed the two would be asking one term to be discounted by
    // another term's declaration.
    const dodge = named.has(scale.dodge);
    if (named.has(scale.window)) out.push(attackWindowTerm(scale.window));
    if (named.has(scale.seek)) {
      out.push(potionSeekTerm(scale.seek, dodge ? 'near' : 'window', dodge));
    }
    if (named.has(scale.control)) out.push(potionControlTerm(scale.control));
    if (dodge) out.push(dodgeDiscountTerm(scale.dodge));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The slate's evaluator
// ---------------------------------------------------------------------------

/**
 * THE EVALUATOR A RESOLVED SLATE RUNS.
 *
 * ── THE DEFAULT PATH IS AN IDENTITY, NOT A REBUILD ─────────────────────────
 *
 * A slate whose evaluator list names only sound-writing entries resolves to
 * `defaultEvaluator` — the very object, not an equal one. That matters twice
 * over: the bound bank's evaluation memo keys on `evaluationIdentity`, and
 * `evaluatorSpecOf` decides worker eligibility by identity, so returning a
 * fresh-but-equal evaluator would be a change with no behaviour attached and
 * one more thing for a byte-identity gate to be surprised by. The shipped bot
 * therefore evaluates through exactly the object it always did.
 *
 * ── AND THE FRAME STAYS THE SOUND ONE ──────────────────────────────────────
 *
 * The profile is the production profile in both cases. An advisory lineup adds
 * no feature to the fold and changes no weight in it — the bounds a
 * potion-aware bot proves are the bounds the default bot proves, on every
 * board, and the two differ only in the order they hold over plans those
 * bounds tie.
 */
export function evaluatorForSlate(
  evaluatorIds: ReadonlyArray<string>,
  base: Evaluator = defaultEvaluator
): Evaluator {
  const advisory = advisoryLineupFor(evaluatorIds);
  if (advisory.length === 0) return base;
  if (!(base instanceof BoundEvaluator)) {
    // A REFUSAL, NEVER A SILENT DROP. Returning `base` here is exactly the
    // defect this parameter exists to close: the caller asked for a slate with
    // an advisory lineup and would have got the shipped bot wearing that
    // slate's stamp, which is the single most expensive thing a measurement
    // harness can be handed.
    throw new TypeError(
      `slate names ${advisory.length} advisory evaluator entr${advisory.length === 1 ? 'y' : 'ies'} ` +
        `(${advisory.map((t) => t.key).join(', ')}) but the base evaluator supplied is not a ` +
        'BoundEvaluator, so there is no feature fold to overlay them onto. Supply a ' +
        'BoundEvaluator profile or select a slate with no advisory entries.'
    );
  }
  return new BoundEvaluator(base.profile, base.features, advisory);
}
