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
 * ── THE CELL AN ENEMY IS STANDING ON, AND HOW CERTAIN THE MEETING IS ───────
 *
 * Two corrections, one rule, from `docs/design/BEHAVIOUR-AUDIT.md` D1.
 *
 * (1) THE ORIGIN IS IN THE FIELD. A trail unit has no `stay` in its grammar
 * ("staging their own square is not a move", `moveGrammar.ts`), so an enemy
 * snake's OWN cell was in no arrival set and cost nothing — the one square on
 * the board guaranteed to produce an adjudication this turn was the one square
 * this term priced at zero. All three `edge` deaths in the audit's 23-game
 * corpus are that: our unit stepped onto an adjacent enemy's head cell and
 * `turnEngine.ts` c1 settled the head-on exchange against it. The enemy either
 * HOLDS that cell (a c4 contest) or vacates it along our own edge (a c1
 * exchange), so a meeting there is certain either way. It is the rules, not a
 * heuristic: the field only ever WIDENS, which is the conservative direction.
 *
 * (2) THE CHARGE IS A CERTAINTY, NOT A FLAG. A boolean charge is equal across
 * every cell inside a slider's fan, so a queen that can reach all three of our
 * options cancels itself and decides nothing — while the one cell it is
 * standing on, which it cannot fail to meet us on, was charged the same as a
 * far corner of its ray. So each enemy carries the share of its own action set
 * that lands on the cell,
 *
 *     p_e(c) = 1                                        c is e's turn-start cell
 *            = |{a in actions(e) : a.to = c}| / |actions(e)|   otherwise
 *     cost(u) = CONTEST_LOSS x max over e BEATING u of p_e(c)
 *
 * `p` is a share of a legal move set and never a probability model of an
 * opponent: it is what the grammar admits, counted. `cost` stays in [0, 1] per
 * unit, so the term's [-1, 0] range, the cliff inequality and the contract's
 * monotonicity are all untouched.
 *
 * `contestField` — the boolean arrival field this file also exports, which
 * `window.ts` reads for the potion peril — takes the widening (1) and not the
 * grading (2): a cell an enemy occupies IS a cell it can be met on, and that
 * reading is a set, not a scale.
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
import { perBoard, perBoardPerTeam } from './memo';

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

/**
 * Every enemy of `asTeam`'s whole action set UNION ITS OWN TURN-START CELL, as
 * one arrival apiece.
 *
 * The origin is in the set because the rules put it there: the enemy either
 * holds that cell and we contest it (c4) or leaves it across our own edge and
 * we exchange (c1). A trail unit's grammar has no `stay`, so without this
 * clause a snake's own square is in no arrival set at all — see the header.
 */
function* enemyArrivals(sub: EngineSubstrate, asTeam: number): Iterable<Arrival> {
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    const origin = unit.cells[0];
    const cells = sub.actionsOf(unit.unitId).map((a) => a.to);
    yield {
      cells: origin === undefined ? cells : [...cells, origin],
      tier: frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn),
      weight: unit.weight,
    };
  }
}

/**
 * ONE ENEMY'S ARRIVAL CERTAINTY over the cells it can be met on: its frozen
 * (tier, weight), and `p_e(c)` for every cell in its reach.
 */
interface EnemyReach {
  readonly tier: number;
  readonly weight: number;
  /** cell -> `p_e(cell)` in (0, 1]. Absent means the enemy cannot be met there. */
  readonly p: ReadonlyMap<number, number>;
}

const REACHES = new WeakMap<object, Map<number, ReadonlyArray<EnemyReach>>>();

/**
 * Every enemy's reach with its certainty, one enumeration pass per enemy,
 * cached per marshalled board per subject team exactly as `contestField` is
 * and for the same reason (a modelled sibling is a `Proxy` over its parent).
 *
 * An enemy with NO legal action still holds its own cell at `p = 1`: it is
 * where it is and the rules give it nowhere to go.
 */
function enemyReaches(sub: EngineSubstrate, asTeam: number): ReadonlyArray<EnemyReach> {
  return perBoardPerTeam(REACHES, sub.marshalled, asTeam, () => {
    const out: EnemyReach[] = [];
    for (const unit of sub.roster()) {
      if (unit.team === asTeam) continue;
      const actions = sub.actionsOf(unit.unitId);
      const p = new Map<number, number>();
      if (actions.length > 0) {
        const hits = new Map<number, number>();
        for (const a of actions) hits.set(a.to, (hits.get(a.to) ?? 0) + 1);
        for (const [cell, n] of hits) p.set(cell, n / actions.length);
      }
      // THE ORIGIN LAST, and it overwrites: a meeting on the cell the enemy
      // already stands on is certain, whatever its action set says about it.
      const origin = unit.cells[0];
      if (origin !== undefined) p.set(origin, 1);
      out.push({
        tier: frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn),
        weight: unit.weight,
        p,
      });
    }
    return out;
  });
}

const PRESSURE = new WeakMap<object, Map<string, Float64Array>>();

/**
 * `max over e BEATING (tier, weight) of p_e(c)`, one plane per distinct
 * (team, tier, weight) our roster presents — three of them at most on the
 * boards this plays, built once per board and then read one array index per
 * unit per node, which is what the boolean field cost before.
 *
 * Keyed per RANK rather than per unit because the verdict is a function of the
 * frozen pair and nothing else: two of our units at the same tier and weight
 * are beaten by exactly the same enemies.
 */
export function contestPressure(
  sub: EngineSubstrate,
  asTeam: number,
  tier: number,
  weight: number
): Float64Array {
  const table = perBoard(PRESSURE, sub.marshalled, () => new Map<string, Float64Array>());
  const key = `${asTeam}|${tier}|${weight}`;
  const hit = table.get(key);
  if (hit !== undefined) return hit;
  const plane = new Float64Array(sub.grid.cells);
  for (const enemy of enemyReaches(sub, asTeam)) {
    // A trade we WIN is not a thing to avoid — the same clause the boolean
    // field expressed through `beatenAt`.
    if (winsContest(tier, weight, enemy.tier, enemy.weight)) continue;
    for (const [cell, p] of enemy.p) {
      if (cell < 0 || cell >= plane.length) continue;
      if (p > (plane[cell] as number)) plane[cell] = p;
    }
  }
  table.set(key, plane);
  return plane;
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
 * `CONTEST_LOSS x p` where this unit's destination is a contest it does not
 * win, and `p` is how certain the beating enemy's arrival there is — 1 on the
 * cell it already occupies.
 */
function costOf(ctx: EvalContext, s: Standing): number {
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return 0;
  // FROZEN, both sides: the rules adjudicate this turn's collisions on the
  // tier and weight held at the START of it, so a unit that grew on a meal in
  // the position being scored still contests at the weight it set out with.
  const ourTier = frozenTier(unit.tier, unit.tierExpiresAtTurn, ctx.sub.turn);
  const plane = contestPressure(ctx.sub, ctx.asTeam, ourTier, unit.weight);
  if (s.cell < 0 || s.cell >= plane.length) return 0;
  return CONTEST_LOSS * (plane[s.cell] as number);
}

/**
 * F9 — contest avoidance.
 *
 * OURS ONLY, for the same reason `momentum` is: it is a statement about the
 * destinations THIS decision is choosing. An enemy walking onto a square our
 * other enemy also wants is not our business, and pricing it would make the
 * term move whenever a claim interval moved.
 *
 * The two readings differ only in which of our contingent units are counted. A
 * dead unit costs nothing, which is the one direction that could invert the
 * bound, so the WORST reading counts the SUPERSET (best-world alive) and the
 * best reading the subset — the opposite way round from a positive term,
 * because this one is never positive.
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
    return ourUnitTerm(ctx, (s) => {
      const c = costOf(ctx, s);
      return [-c, -c];
    });
  },
};
