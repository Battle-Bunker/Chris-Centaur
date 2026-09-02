/**
 * THE MATERIAL FOLD — what a settled board is worth to a declared team, as an
 * interval.
 *
 * This used to be welded to the resolver, which meant a rules change that
 * altered survival altered the bound in the same commit. It is bot-side now,
 * and the weld becomes a theorem `bounds/soundness.test.ts` checks: "what is a
 * team's material worth" is a SCORING question, and the engine answers only
 * the two questions underneath it — who is alive (`fates`, `Claim.certainlyGone`
 * / `deathPossible`) and how heavy they are (the settled board, and a claim's
 * weight interval).
 *
 * ── THE CLIFF ──────────────────────────────────────────────────────────────
 *
 * `worst` scores "might die" exactly as "dies": a unit whose fate is
 * contingent contributes nothing to the floor. A graded penalty would make the
 * floor FALL when a feared death is merely confirmed, which breaks monotone
 * refinement — the one property the whole bound bank rests on. And the cliff is
 * denominated in the material the death loses rather than in a fixed scalar,
 * so certain death is never cheaper than possible death.
 *
 * ── THE PESSIMISM SCOPE ────────────────────────────────────────────────────
 *
 * Worst case is worst FOR A DECLARED SUBJECT. Adjudicating every participant
 * at its own worst endpoint kills the enemy's movers too — the subject's best
 * case wearing its worst case's clothes. So the endpoint selection flips per
 * participant relative to the subject: our contingent units are dead in the
 * worst reading and alive in the best; theirs are alive in our worst and dead
 * in our best.
 */

import type { PartialSettlement } from '../../engine-vendor/engine/settlePartial';
import type { EngineSubstrate } from '../substrate';
import type { Trit, UnitId } from '../contracts';

/** One unit's contribution coordinates. Monotone in each, which is what makes
 * the fold's endpoints true bounds. */
export interface UnitValue {
  readonly unitId: UnitId;
  readonly team: number;
  readonly survival: Trit;
  readonly weightMin: number;
  readonly weightMax: number;
  /** Weight that could be lost WITHOUT death (a sever). 0 for a stack. */
  readonly partialLossMax: number;
}

/** The subject-frame interval, with the basis it rides on. */
export interface MaterialBounds {
  /** worst ≤ true ≤ best, both under the SAME world set. */
  readonly worst: number;
  readonly best: number;
  /** How much of the gap the unknown movers own. */
  readonly gapBy: { readonly cloud: number };
  /** Sorted unit ids whose claims were NARROWED — the bounds' basis. */
  readonly assumptions: ReadonlyArray<UnitId>;
  /** worst === best and nothing was assumed. */
  readonly exact: boolean;
}

/** A team's value, folded at its interval endpoints, in its OWN frame. */
export function teamValue(
  units: ReadonlyArray<UnitValue>,
  team: number
): { worst: number; best: number } {
  let worst = 0;
  let best = 0;
  for (const u of units) {
    if (u.team !== team) continue;
    if (u.survival === 'yes') worst += Math.max(0, u.weightMin - u.partialLossMax);
    if (u.survival !== 'no') best += u.weightMax;
  }
  return { worst, best };
}

/** The same fold with the endpoints flipped for a team that is not the subject. */
export function scopedTeamValue(
  units: ReadonlyArray<UnitValue>,
  scoringTeam: number,
  subjectTeam: number
): { worst: number; best: number } {
  if (scoringTeam === subjectTeam) return teamValue(units, scoringTeam);
  let subjectWorst = 0; // the enemy at ITS best — the subject's worst world
  let subjectBest = 0; // the enemy at its worst
  for (const u of units) {
    if (u.team !== scoringTeam) continue;
    if (u.survival !== 'no') subjectWorst += u.weightMax;
    if (u.survival === 'yes') subjectBest += Math.max(0, u.weightMin - u.partialLossMax);
  }
  return { worst: subjectWorst, best: subjectBest };
}

/**
 * The held units this settlement's MOVERS could have killed: the ones whose
 * possible occupancy meets a cell one of them actually entered, or came to
 * rest on.
 *
 * This is the half of a claim's peril that the plan owns, and reading it per
 * settlement is what makes a capture worth something: `Claim.deathPossible` is
 * hoisted across every plan and so cannot tell the plan that takes a piece
 * from the plan that walks away from it. The test itself is geometry over the
 * engine's own answers — the traversal it settled, and the cells the claim
 * says it could hold — never a rule restated here.
 */
export function reachedByMovers(
  settlement: PartialSettlement
): ReadonlySet<string> {
  const touched = new Set<number>();
  for (const cells of Object.values(settlement.traversed)) {
    for (const cell of cells) touched.add(cell);
  }
  for (const [id, settled] of Object.entries(settlement.board)) {
    if (settlement.claims.some((c) => c.id === id)) continue;
    for (const cell of settled.occupancy) touched.add(cell);
  }
  const out = new Set<string>();
  if (touched.size === 0) return out;
  for (const claim of settlement.claims) {
    if (claim.everPossible.some((cell) => touched.has(cell))) out.add(claim.id);
  }
  return out;
}

/**
 * Whether a MOVER could be gone by the end of the turn.
 *
 * `fates` says `contingent` for any unit the ledger names at all, and the
 * ledger names timing as well as survival: a queen that walks onto a rook it
 * outranks is ledgered — the contact is real and the turn could have gone
 * differently — with `couldBeat: false`, which is the engine saying in so many
 * words that this unit wins the contact in every world its interval admits.
 * Reading `contingent` as "might die" prices that capture as a possible death
 * of our own queen, and a plan that takes a piece then scores below one that
 * does not.
 *
 * So survival is read off `couldBeat`, which is the axis it is about, and the
 * rest of the ledger stays what it is: a work list about energy, weight and
 * where things ended up.
 */
export function moverSurvival(settlement: PartialSettlement, wireId: string): Trit {
  if (settlement.board[wireId] === undefined || settlement.deaths[wireId] !== undefined) return 'no';
  for (const entry of settlement.ledger) {
    if (entry.unitId === wireId && entry.couldBeat) return 'maybe';
  }
  return 'yes';
}

/**
 * Whether a held unit could be gone by the end of the turn: the peril the plan
 * cannot change (`Substrate.perilOf`) united with the peril it just made
 * (`reachedByMovers`). Both halves are the engine's; the union is the reading.
 */
export function claimSurvival(
  claim: { readonly id: string; readonly certainlyGone: boolean; readonly deathPossible: boolean },
  peril: ReadonlySet<string>,
  reached: ReadonlySet<string>
): Trit {
  if (claim.certainlyGone) return 'no';
  if (!claim.deathPossible) return 'yes';
  return peril.has(claim.id) || reached.has(claim.id) ? 'maybe' : 'yes';
}

/**
 * Every unit's coordinates, read off one settlement.
 *
 * A MOVER's weight is what the settled board says it is — growth and sever
 * already applied — and its survival is the settlement's own `fates`. A HELD
 * unit has no settled board entry by construction; its interval is its claim's,
 * and its partial loss is the weight a sever could take without killing it.
 */
export function unitValuesOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement
): UnitValue[] {
  const out: UnitValue[] = [];
  const claimById = new Map(settlement.claims.map((c) => [c.id, c]));
  const peril = sub.perilOf();
  const reached = reachedByMovers(settlement);
  for (const unit of sub.roster()) {
    const claim = claimById.get(unit.wireId);
    if (claim !== undefined) {
      out.push({
        unitId: unit.unitId,
        team: unit.team,
        survival: claimSurvival(claim, peril, reached),
        weightMin: claim.weightMin,
        weightMax: claim.weightMax,
        partialLossMax: Math.max(0, unit.weight - claim.weightMin),
      });
      continue;
    }
    const settled = settlement.board[unit.wireId];
    const weight = settled?.occupancy.length ?? 0;
    out.push({
      unitId: unit.unitId,
      team: unit.team,
      survival: moverSurvival(settlement, unit.wireId),
      weightMin: weight,
      weightMax: weight,
      partialLossMax: 0,
    });
  }
  return out;
}

/**
 * The subject-frame material of one settlement: every team's interval, and the
 * difference that scores it.
 *
 * The basis is the claims a caller's narrowing licensed — carried on the
 * bounds, never folded away, because a bound conditional on an assumption may
 * not be compared with an unconditional one.
 */
export function materialOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement,
  subjectTeam: number
): {
  perTeam: ReadonlyMap<number, { worst: number; best: number }>;
  bounds: MaterialBounds;
} {
  const units = unitValuesOf(sub, settlement);
  const perTeam = new Map<number, { worst: number; best: number }>();
  for (const team of new Set(units.map((u) => u.team))) {
    perTeam.set(team, scopedTeamValue(units, team, subjectTeam));
  }
  const own = perTeam.get(subjectTeam) ?? { worst: 0, best: 0 };
  let othersWorst = 0;
  let othersBest = 0;
  for (const [team, value] of perTeam) {
    if (team === subjectTeam) continue;
    othersWorst += value.worst;
    othersBest += value.best;
  }
  const worst = own.worst - othersWorst;
  const best = own.best - othersBest;
  if (best < worst) throw new Error(`inverted material bounds: [${worst}, ${best}]`);

  const assumptions: UnitId[] = [];
  for (const claim of settlement.claims) {
    if (!claim.narrowed) continue;
    const unit = sub.unitOfWireId(claim.id);
    if (unit !== undefined) assumptions.push(unit.unitId);
  }
  assumptions.sort((a, b) => a - b);

  return {
    perTeam,
    bounds: {
      worst,
      best,
      gapBy: { cloud: best - worst },
      assumptions,
      exact: worst === best && assumptions.length === 0,
    },
  };
}
