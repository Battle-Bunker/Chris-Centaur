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

import type { EngineSubstrate } from '../substrate';
import { type Feature, bound, point } from './bound';
import type { EvalContext, Standing } from './features';

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
export interface ContestField {
  readonly reached: Uint8Array;
  readonly tier: Int32Array;
  readonly weight: Int32Array;
}

/**
 * Keyed on the MARSHALLED BOARD rather than on the substrate, because a
 * modelled sibling is a `Proxy` over its parent — a distinct WeakMap key for
 * the same board, rebuilt on every sibling. The marshalled board is the one
 * object the proxy hands straight through, so parent and siblings share the
 * one field, which is correct precisely because the field reads the roster and
 * the grammar and not the modelled set.
 */
const FIELDS = new WeakMap<object, Map<number, ContestField>>();

/** The tier a unit still carries at the turn its arrival is adjudicated on. */
function frozenTier(tier: number, expiresAtTurn: number | null, turn: number): number {
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
 * Every cell an enemy of `asTeam` could end this turn on, with the best arrival
 * it could bring there. One enumeration pass per enemy, cached per board per
 * subject team.
 */
export function contestField(sub: EngineSubstrate, asTeam: number): ContestField {
  let perTeam = FIELDS.get(sub.marshalled);
  if (perTeam === undefined) {
    perTeam = new Map<number, ContestField>();
    FIELDS.set(sub.marshalled, perTeam);
  }
  const hit = perTeam.get(asTeam);
  if (hit !== undefined) return hit;

  const cells = sub.grid.cells;
  const reached = new Uint8Array(cells);
  const tier = new Int32Array(cells);
  const weight = new Int32Array(cells);
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    const t = frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn);
    const w = unit.weight;
    for (const action of sub.actionsOf(unit.unitId)) {
      const cell = action.to;
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
  const field: ContestField = { reached, tier, weight };
  perTeam.set(asTeam, field);
  return field;
}

/** `CONTEST_LOSS` where this unit's destination is a contest it does not win. */
function costOf(ctx: EvalContext, s: Standing, field: ContestField): number {
  if (field.reached[s.cell] !== 1) return 0;
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return 0;
  // FROZEN, both sides: the rules adjudicate this turn's collisions on the
  // tier and weight held at the START of it, so a unit that grew on a meal in
  // the position being scored still contests at the weight it set out with.
  const ourTier = frozenTier(unit.tier, unit.tierExpiresAtTurn, ctx.sub.turn);
  return winsContest(
    ourTier,
    unit.weight,
    field.tier[s.cell] as number,
    field.weight[s.cell] as number
  )
    ? 0
    : CONTEST_LOSS;
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
    let ours = 0;
    for (const s of ctx.standing) if (s.team === ctx.asTeam && !s.held) ours++;
    if (ours === 0) return point(0);

    const field = contestField(ctx.sub, ctx.asTeam);
    let worst = 0;
    let best = 0;
    for (const s of ctx.standing) {
      if (s.team !== ctx.asTeam || s.held) continue;
      if (!s.bestAlive && !s.worstAlive) continue;
      const cost = costOf(ctx, s, field);
      if (cost === 0) continue;
      if (s.bestAlive) worst -= cost;
      if (s.worstAlive) best -= cost;
    }
    const lo = worst / ours;
    const hi = best / ours;
    return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));
  },
};
