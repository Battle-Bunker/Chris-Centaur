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
 * onto every cell that enemy could legally end this turn on, AND ONTO THE CELL
 * IT IS STANDING ON. That is the same grammar the resolver accepts, so the
 * reach set is exact rather than an estimate: a pawn's diagonal is legal only
 * onto a cell that held food or a unit at the START of the turn, and the target
 * board is frozen, so our own move cannot open one. Sliders stop where the
 * rules stop them. The enemy's own cell is not in that grammar for a trail unit
 * — a snake has no `stay` — and is added because the rules adjudicate a meeting
 * there whether the enemy holds (c4) or vacates along our edge (c1); see
 * `enemyArrivals`.
 *
 * Each stamp also carries HOW CERTAIN it is — 1 on the enemy's own cell,
 * `k/|actions|` on a cell k of its actions reach — and the charge is the flat
 * loss lightened by that certainty through one knob, `CONTEST_CERTAINTY`; see
 * `chargeAt`.
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
import { CONTEST_CERTAINTY } from './calibration';
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
  /**
   * HOW CERTAIN the most certain arrival at this cell is, in [0, 1]: 1 where
   * some enemy is standing on it or has no other continuation, `k/|actions|`
   * where k of an enemy's legal actions land there. Meaningless where
   * `reached` is 0, and left at 0 there.
   *
   * It is the maximum over EVERY arrival at the cell, not over the arrivals
   * that beat the unit asking — which is what D1's rule writes, and which
   * would need the whole per-enemy list kept per cell rather than the one
   * best `(tier, weight)` this field collapses to. The difference is one
   * direction only: a cell where a slower enemy is certain and a faster one
   * merely possible is charged at the certain enemy's weight, i.e. ABOVE the
   * rule, never below it. Over-charging a contested cell is the same
   * conservative direction the widened field itself moves in, and the whole
   * spread between the two readings is the certainty knob `ε`.
   */
  readonly certainty: Float64Array;
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
  /**
   * The share of the arriving unit's own options this arrival accounts for, in
   * [0, 1]. Omitted means 1 — a CLAIM (`potion.ts`'s window read) is one cell
   * the enemy is asserted to reach, not one of several guesses, so the default
   * is the reading every producer but `enemyArrivals` wants.
   */
  readonly certainty?: number;
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
  const certainty = new Float64Array(cells);
  for (const arrival of arrivals) {
    const t = arrival.tier;
    const w = arrival.weight;
    const p = arrival.certainty ?? 1;
    for (const cell of arrival.cells) {
      if (cell < 0 || cell >= cells) continue;
      // The certainty is a plain maximum and so does not follow the
      // (tier, weight) winner: see `ArrivalField.certainty` for why that is
      // the reading, and which way it errs.
      if (p > (certainty[cell] as number)) certainty[cell] = p;
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
  return { reached, tier, weight, certainty };
}

/** True where some arrival reaches this cell and `(tier, weight)` does not beat it. */
export function beatenAt(field: ArrivalField, tier: number, weight: number, cell: number): boolean {
  if (cell < 0 || cell >= field.reached.length) return false;
  if (field.reached[cell] !== 1) return false;
  return !winsContest(tier, weight, field.tier[cell] as number, field.weight[cell] as number);
}

/**
 * Every enemy of `asTeam`'s whole action set UNION ITS OWN TURN-START CELL,
 * carrying how certain each landing is.
 *
 * THE ORIGIN CLAUSE is the rules, not a heuristic. A trail unit has no `stay`
 * in its grammar (`moveGrammar.ts`: "staging their own square is not a move"),
 * so its head cell was in no arrival set and the charge at the one square on
 * the board where a meeting is CERTAIN was exactly nothing — D1 of
 * `docs/design/BEHAVIOUR-AUDIT.md`, and three `edge` deaths in its corpus. The
 * enemy either holds that cell (`turnEngine.ts` c4 contest) or vacates it along
 * our edge (c1 exchange), and both adjudicate on the same frozen (tier, weight)
 * this field already carries, so the meeting is priced the same either way.
 *
 * The certainty is `k/|actions|` on a landing k of the enemy's actions reach,
 * and 1 on its own cell. It is what makes the origin clause bite: with a flat
 * charge every option inside one enemy's fan is charged alike, they cancel, and
 * the tie-break still takes the enemy's square.
 */
function* enemyArrivals(sub: EngineSubstrate, asTeam: number): Iterable<Arrival> {
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    const tier = frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn);
    const weight = unit.weight;
    const origin = unit.cells[0];
    if (origin !== undefined) yield { cells: [origin], tier, weight, certainty: 1 };
    const actions = sub.actionsOf(unit.unitId);
    if (actions.length === 0) continue;
    // Cells first, so a cell two of the enemy's actions reach is counted twice
    // and carries twice the certainty; then one arrival per certainty, because
    // an `Arrival` is a set of cells at one certainty and not one cell.
    const landings = new Map<CellIndex, number>();
    for (const a of actions) landings.set(a.to, (landings.get(a.to) ?? 0) + 1);
    const byHits = new Map<number, CellIndex[]>();
    for (const [cell, hits] of landings) {
      const group = byHits.get(hits);
      if (group === undefined) byHits.set(hits, [cell]);
      else group.push(cell);
    }
    for (const [hits, cells] of byHits) {
      yield { cells, tier, weight, certainty: hits / actions.length };
    }
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

/**
 * The charge where a unit of `(tier, weight)` ending on `cell` loses there: the
 * whole `CONTEST_LOSS`, LIGHTENED by how uncertain the meeting is —
 *
 *     CONTEST_LOSS × (1 − ε + ε · p)
 *
 * with `ε = CONTEST_CERTAINTY` and `p` the field's certainty at the cell. At
 * `ε = 0` this is the boolean charge the weight `contest: 3` was seated on, and
 * the origin clause alone; at `ε = 1` it is the certainty itself, which is the
 * shape that was measured and reverted (it divides every non-origin charge by
 * the enemy's action count and spends about three quarters of the term's seated
 * strength — see the D1 status note). In between, the enemy's own cell is the
 * only full certainty and every reachable cell keeps at least `1 − ε` of the
 * charge it has today.
 *
 * Still in [0, CONTEST_LOSS] for any `ε` in [0, 1], so the term's [-1, 0] range
 * and the cliff inequality that rests on it are untouched.
 */
function chargeAt(field: ArrivalField, tier: number, weight: number, cell: number): number {
  if (!beatenAt(field, tier, weight, cell)) return 0;
  const p = field.certainty[cell] as number;
  return CONTEST_LOSS * (1 - CONTEST_CERTAINTY + CONTEST_CERTAINTY * p);
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
