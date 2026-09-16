/**
 * CONTEST AVOIDANCE — the cheapest thing that stops two heads walking into one
 * square.
 *
 * ── THE PATHOLOGY ──────────────────────────────────────────────────────────
 *
 * After the basic-intelligence fixes, contests are the dominant death cause:
 * 22 of 28 non-starvation deaths on five 100-turn `mixed` games, 8 of 20 on
 * `snakes` (`docs/BASIC-INTELLIGENCE.md`, "What is still wrong"). The shape is
 * always the same — two units, often two mirror-symmetric bots reading the same
 * board, pick the same cell and both die on it.
 *
 * ── WHAT THE RULES DO WITH TWO ARRIVALS ────────────────────────────────────
 *
 * `src/engine-vendor/engine/turnEngine.ts` c4 puts every unit that reached a
 * cell into ONE contest and asks `strictMaximum` for a survivor: highest frozen
 * TIER first, then highest frozen WEIGHT among that tier, and a survivor only
 * where that maximum is UNIQUE. So against one enemy head at the same cell:
 *
 *   lower tier, or equal tier and lighter   we die
 *   equal tier and EQUAL weight             nobody survives — we die too
 *   higher tier, or equal tier and heavier  we live, and capture-stop
 *
 * "Equal-or-heavier kills us" is therefore not a heuristic reading of the
 * rules; it is the rule, negated. Both inputs are frozen at the START of the
 * turn — nothing gained or lost during the turn changes that turn's collisions
 * — which is exactly what makes a turn-start snapshot a sound basis for asking
 * the question before the turn is resolved.
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 *
 * One pass over the enemy roster through the ENGINE'S OWN move enumerator
 * (`EngineSubstrate.enumerate`), stamping each enemy's frozen (tier, weight)
 * onto every cell that enemy could legally end this turn on. That is the same
 * grammar the resolver accepts, so the reach set is exact rather than an
 * estimate: a pawn's diagonal is legal only onto a cell that held food or a
 * unit at the START of the turn, and the target board is frozen, so our own
 * move cannot open one. Sliders stop where the rules stop them.
 *
 * Computed ONCE per substrate per subject team and cached against the
 * substrate, exactly like `foodDistance` — one enumeration pass per decision,
 * not one per evaluation. What the feature itself then does, per node, is one
 * array read per unit of ours.
 *
 * EVERY enemy on the roster, and no test for whether the plan models it. A
 * plan is one TEAM's joint move — `commandable(asTeam)` is the domain the
 * search stages from — so an enemy is a claim by construction, and asking the
 * substrate which units it models is not even allowed here: a modelled sibling
 * shares its parent's claim view and `modeled()` throws on the narrower ones
 * (`SharedClaimViewError`). Reading the roster instead makes the field a pure
 * function of the board, which is also what lets it be cached.
 *
 * ── WHERE THE UNIT ENDS UP IS ITSELF A CLAIM ───────────────────────────────
 *
 * The charge is a fact about the cell our unit ENDS on, and on a board with
 * held units that cell is not always known: the optimistic timeline walks a
 * mover as far as an empty board allows, and a world that puts a held unit in
 * its way halts it earlier along the same path — or leaves it where it started.
 * So the per-unit charge is CONTINGENT, and reading it as a point is a floor
 * above worlds the resolver itself produces. `settlesOn` names the set and
 * `costOf` brackets over it.
 *
 * ── WHY AN EVALUATOR TERM ──────────────────────────────────────────────────
 *
 * The floor already knows a contested cell is dangerous, and that is precisely
 * the problem: a FLOOR concedes every cell an optimistic enemy could reach, so
 * `material`'s cliff fires on nearly every option a unit has and carries no
 * gradient between them. What it cannot say is WHICH of those cells we lose on.
 * That distinction is weight-and-tier arithmetic over the enemy's own reach,
 * it is a fact about our own destination, and it survives a pessimistic
 * reading — the same argument that put `food` in the fold rather than in the
 * ordering. The candidate generator sees the same information a turn earlier
 * but its output is a SEED and an ordering; only a weighted term reaches the
 * move that is actually staged.
 *
 * ── SCALE, AND THE TWO GATES ───────────────────────────────────────────────
 *
 * One losing unit costs `CONTEST_LOSS / |ours|`, so the whole term's range is
 * [-1, 0] on every board shape and `w x 1` sits an order of magnitude inside
 * the cliff ceiling of `10 x lightest unit weight`. It can order moves and it
 * can never buy a unit's life.
 *
 * FREEZING. The term is zero wherever a unit has no losing option and equal
 * across every option where it has nothing else, so it adds no preference for
 * standing still; a piece that holds still pays `momentum`'s idle cost, and a
 * trail unit has no hold in its grammar at all. Two mirror bots both declining
 * the same square is the intended outcome, not the failure — the failure would
 * be a term that made the decline cost more than the square is worth.
 *
 * STARVATION. `food` is weighted 4 against a pull that reaches 1 for a starving
 * unit standing on the meal, and this term is weighted 3. A hungry unit
 * therefore still takes a contested meal — dying in a contest it might win
 * beats dying of hunger for certain — while a healthy one (pull scaled by
 * `HUNGER_FLOOR`) declines it. That ordering is deliberate and is what keeps
 * the food gate green.
 */

import type { CellIndex } from '../contracts';
import type { EngineSubstrate } from '../substrate';
import { type Feature, ourUnitTerm } from './bound';
import type { EvalContext, Standing } from './features';
import { perBoardPerTeam } from './memo';

/**
 * What one of our units standing on a cell it cannot win costs. One, so the
 * feature's range is [-1, 0] after the division by our unit count — the same
 * construction `food` and `momentum` use, and the reason one weight is safe on
 * every roster size.
 */
export const CONTEST_LOSS = 1;

/**
 * The best enemy arrival at every cell: the highest frozen tier any enemy could
 * bring there, and the heaviest frozen weight among the enemies at
 * that tier. That pair is all `strictMaximum` needs — beating the best of them
 * is exactly being the unique maximum of the whole set.
 *
 * `reached` is a mask and not a sentinel in `tier`, because a tier may be
 * NEGATIVE — `turnEngine` tracks a `vulnerableCollided` set for exactly those
 * — and a sentinel inside the value range is a bug waiting for its first
 * debuff potion.
 */
export interface ArrivalField {
  readonly reached: Uint8Array;
  readonly tier: Int32Array;
  readonly weight: Int32Array;
}

/** @deprecated use `ArrivalField` — same shape, kept so existing importers compile. */
export type ContestField = ArrivalField;

/**
 * Keyed on the MARSHALLED BOARD rather than on the substrate, because a
 * modelled sibling is a `Proxy` over its parent — a distinct WeakMap key for
 * the same board, rebuilt on every sibling. The marshalled board is the one
 * object the proxy hands straight through, so parent and siblings share the
 * one field, which is correct precisely because the field reads the roster and
 * the grammar and not the modelled set.
 */
const FIELDS = new WeakMap<object, Map<number, ContestField>>();

/**
 * The tier a unit still carries at the turn its arrival is adjudicated on.
 * `expiresAtTurn` is EXCLUSIVE — the first turn at which the tier no longer
 * governs — and the conversion from the wire's inclusive figure happens once,
 * in `marshalBoard`.
 */
export function frozenTier(tier: number, expiresAtTurn: number | null, turn: number): number {
  return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier;
}

/**
 * Do we survive a contest at a cell whose best enemy arrival is
 * `(theirTier, theirWeight)`? Tier first, weight second, and a TIE IS NOT A WIN
 * — `strictMaximum` returns a survivor only where the maximum is unique.
 */
export function winsContest(
  ourTier: number,
  ourWeight: number,
  theirTier: number,
  theirWeight: number
): boolean {
  if (ourTier !== theirTier) return ourTier > theirTier;
  return ourWeight > theirWeight;
}

/**
 * One arrival: everything that lands on `cells` carries the same frozen
 * `(tier, weight)`. `contestField` yields one per enemy unit (its whole
 * action set at once); `potion.ts`'s window read yields one per enemy claim.
 */
export interface Arrival {
  readonly cells: Iterable<CellIndex>;
  readonly tier: number;
  readonly weight: number;
}

/**
 * The best arrival at every cell, over `cells` total cells: the highest
 * frozen tier any arrival brings, and the heaviest frozen weight among the
 * arrivals at that tier. That pair is all `strictMaximum` needs — beating the
 * best of them is exactly being the unique maximum of the whole set.
 *
 * `reached` is a mask and not a sentinel in `tier`, because a tier may be
 * NEGATIVE — `turnEngine` tracks a `vulnerableCollided` set for exactly those
 * — and a sentinel inside the value range is a bug waiting for its first
 * debuff potion.
 */
export function arrivalField(cells: number, arrivals: Iterable<Arrival>): ArrivalField {
  const reached = new Uint8Array(cells);
  const tier = new Int32Array(cells);
  const weight = new Int32Array(cells);
  for (const arrival of arrivals) {
    const t = arrival.tier;
    const w = arrival.weight;
    for (const cell of arrival.cells) {
      if (cell < 0 || cell >= cells) continue;
      if (reached[cell] === 0) {
        reached[cell] = 1;
        tier[cell] = t;
        weight[cell] = w;
        continue;
      }
      const seenTier = tier[cell] as number;
      if (t > seenTier) {
        tier[cell] = t;
        weight[cell] = w;
      } else if (t === seenTier && w > (weight[cell] as number)) {
        weight[cell] = w;
      }
    }
  }
  return { reached, tier, weight };
}

/** True where some arrival reaches this cell and `(tier, weight)` does not beat it. */
export function beatenAt(field: ArrivalField, tier: number, weight: number, cell: number): boolean {
  if (cell < 0 || cell >= field.reached.length) return false;
  if (field.reached[cell] !== 1) return false;
  return !winsContest(tier, weight, field.tier[cell] as number, field.weight[cell] as number);
}

/** Every enemy of `asTeam`'s whole action set, as one arrival apiece. */
function* enemyArrivals(sub: EngineSubstrate, asTeam: number): Iterable<Arrival> {
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    yield {
      cells: sub.actionsOf(unit.unitId).map((a) => a.to),
      tier: frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn),
      weight: unit.weight,
    };
  }
}

/**
 * Every cell an enemy of `asTeam` could end this turn on, with the best arrival
 * it could bring there. One enumeration pass per enemy, cached per board per
 * subject team.
 */
export function contestField(sub: EngineSubstrate, asTeam: number): ContestField {
  return perBoardPerTeam(FIELDS, sub.marshalled, asTeam, () =>
    arrivalField(sub.grid.cells, enemyArrivals(sub, asTeam))
  );
}

/** `CONTEST_LOSS` where a unit of `(tier, weight)` ending on `cell` loses there. */
function chargeAt(field: ArrivalField, tier: number, weight: number, cell: number): number {
  return beatenAt(field, tier, weight, cell) ? CONTEST_LOSS : 0;
}

/**
 * WHERE THIS UNIT'S ARRIVAL COULD SETTLE — the contingent set, and the reason
 * this term has two readings at all.
 *
 * `settlePartial` settles the turn with every held unit ABSENT, so a mover
 * walks as far along its own staged path as an empty board lets it. A concrete
 * world can only ADD obstacles: a body where the timeline read empty ground, a
 * pile, a contact that capture-stops it, or a staged action the world makes
 * illegal outright. So the cell a world settles this unit on is one of the
 * cells it ENTERED in this timeline (`traversed`, in order) or the cell it set
 * out from — a world cannot walk it further than the optimistic timeline did,
 * and cannot walk it anywhere else.
 *
 * The gate is the engine's own verdict, not a guess: `fates` says
 * `contingent` exactly when the ledger names this unit at all, and
 * `settlePartial`'s contract is that a unit it does not name has the same
 * disposition — "where it went, whether it lived, its energy, its weight" — in
 * every world the claims admit. So a non-contingent mover settles on its
 * settled cell, full stop, and this function returns nothing for it: the term
 * stays a POINT wherever nothing is held, which is the discharge property its
 * contract declares.
 *
 * Measured on the law sweep's own 240 boards: over 8 637 completion worlds and
 * 1 956 relocations of one of our movers, the world's settle cell was inside
 * this set every time, and it was OUTSIDE `traversed` alone 1 854 times — the
 * commonest world is the one where the move does not happen and the unit is
 * still standing where it started. Dropping the origin from the set is
 * therefore not a tightening but the defect itself.
 */
function settlesOn(ctx: EvalContext, s: Standing, wireId: string): ReadonlyArray<number> | null {
  if (ctx.resolution.fates[wireId] !== 'contingent') return null;
  const walked = ctx.resolution.traversed[wireId];
  const origin = ctx.sub.unitOf(s.unitId)?.cells[0];
  const cells: number[] = [s.cell];
  if (origin !== undefined && origin !== s.cell) cells.push(origin);
  if (walked !== undefined) for (const cell of walked) if (!cells.includes(cell)) cells.push(cell);
  return cells.length > 1 ? cells : null;
}

/**
 * The charge for one of our units, as an interval over the cells its arrival
 * could settle on.
 *
 * A FLOOR MAY NOT READ A CONTINGENT CELL AS A POINT. The charge is a fact
 * about the cell this unit ENDS on, and where a held unit could halt it that
 * cell is not one cell but a set — so the worst reading pays the DEAREST cell
 * of the set and the best reading the cheapest, and `held.lo ≤ real.lo` holds
 * in every completion world rather than in the ones the optimistic timeline
 * happens to agree with. Where the arrival is settled the set is a singleton
 * and the two ends coincide, which is every unit on a board with nothing held.
 */
function costOf(ctx: EvalContext, s: Standing, field: ArrivalField): readonly [lo: number, hi: number] {
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return ZERO_CHARGE;
  // FROZEN, both sides: the rules adjudicate this turn's collisions on the
  // tier and weight held at the START of it, so a unit that grew on a meal in
  // the position being scored still contests at the weight it set out with.
  const ourTier = frozenTier(unit.tier, unit.tierExpiresAtTurn, ctx.sub.turn);
  const settled = chargeAt(field, ourTier, unit.weight, s.cell);
  const contingent = settlesOn(ctx, s, unit.wireId);
  if (contingent === null) return settled === 0 ? ZERO_CHARGE : [settled, settled];
  let worst = settled;
  let best = settled;
  for (const cell of contingent) {
    const c = chargeAt(field, ourTier, unit.weight, cell);
    if (c > worst) worst = c;
    if (c < best) best = c;
  }
  return [worst, best];
}

/** One frozen pair, so the common "nothing to pay" answer is not an allocation. */
const ZERO_CHARGE: readonly [number, number] = Object.freeze([0, 0] as [number, number]);

/**
 * F9 — contest avoidance.
 *
 * OURS ONLY, for the same reason `momentum` is: it is a statement about the
 * destinations THIS decision is choosing. An enemy walking onto a square our
 * other enemy also wants is not our business, and pricing it would make the
 * term move whenever a claim interval moved.
 *
 * The two readings differ in which of our contingent units are counted AND in
 * where a contingent one is standing. A dead unit costs nothing, which is the
 * one direction that could invert the bound, so the WORST reading counts the
 * SUPERSET (best-world alive) and the best reading the subset — the opposite
 * way round from a positive term, because this one is never positive. And a
 * unit the ledger names could have been halted short of the cell this timeline
 * settled it on, so the worst reading charges it at the dearest cell of the set
 * its arrival could settle on and the best at the cheapest; see `settlesOn`.
 */
export const contestFeature: Feature<EvalContext> = {
  key: 'contest',
  defaultWeight: 3,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'up' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    let field: ContestField | undefined;
    return ourUnitTerm(ctx, (s) => {
      if (field === undefined) field = contestField(ctx.sub, ctx.asTeam);
      const [worst, best] = costOf(ctx, s, field);
      return [-worst, -best];
    });
  },
};
