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

import type { Divergence, PartialSettlement } from '../../engine-vendor/engine/settlePartial';
import type { Claim } from '../../engine-vendor/engine/claims';
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
/**
 * PER-SETTLEMENT CACHES. Both of the derivations below are pure functions of
 * ONE settlement object — no substrate, no team, no plan — and both are asked
 * for repeatedly about the same object: `unitValuesOf` and `standingOf` each
 * want them once per evaluation, and the bank evaluates one plan under every
 * hold configuration it enumerates. `WeakMap`s from the settlement, so they
 * die with it and add no lifetime to anything.
 */
const reachedCache = new WeakMap<PartialSettlement, ReadonlySet<string>>();
const claimIndexCache = new WeakMap<PartialSettlement, ReadonlyMap<string, Claim>>();

/** The settlement's claims, indexed by wire id. Built once per settlement. */
export function claimsById(settlement: PartialSettlement): ReadonlyMap<string, Claim> {
  const hit = claimIndexCache.get(settlement);
  if (hit !== undefined) return hit;
  const made = new Map<string, Claim>();
  for (const claim of settlement.claims) made.set(claim.id, claim);
  claimIndexCache.set(settlement, made);
  return made;
}

export function reachedByMovers(
  settlement: PartialSettlement
): ReadonlySet<string> {
  const memo = reachedCache.get(settlement);
  if (memo !== undefined) return memo;
  const made = reachedByMoversUncached(settlement);
  reachedCache.set(settlement, made);
  return made;
}

function reachedByMoversUncached(
  settlement: PartialSettlement
): ReadonlySet<string> {
  const touched = new Set<number>();
  for (const id in settlement.traversed) {
    const cells = settlement.traversed[id] as ReadonlyArray<number>;
    for (const cell of cells) touched.add(cell);
  }
  // The claim test is an INDEX lookup rather than a scan of the claim list per
  // board entry — same predicate, same set, without the O(board x claims).
  const claims = claimsById(settlement);
  for (const id in settlement.board) {
    if (claims.has(id)) continue;
    const settled = settlement.board[id];
    if (settled === undefined) continue;
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
  return moverSurvivalVia(settlement, wireId, null);
}

/**
 * The king a `regicide` divergence is keyed to. The engine's own naming: the
 * chain's last link is the king whose fall carries the team, and an empty
 * chain means the held root IS that king.
 */
function regicideKingOf(d: Divergence): string {
  return d.via.length === 0 ? d.heldId : (d.via[d.via.length - 1] as string);
}

/**
 * A REGICIDE ENTRY IS NOT A CONTACT, AND PRICING IT AS ONE IS PESSIMISM WITH
 * NO SHOT BEHIND IT.
 *
 * `regicideSpread` writes one entry per surviving team-mate of a king that
 * could fall — `couldBeat: true` on all of them, because losing the king does
 * take them off the board. Read as ordinary contacts, those entries say that
 * every unit of the team is separately in a fight it might lose, and the fold
 * writes the whole team off in the worst reading. But there is only ONE event:
 * the king falling. So the entry is resolved by asking about THAT UNIT —
 * once — instead of charging each team-mate for it.
 *
 * The asymmetry that makes it worth doing: the ledger is built against the
 * wider reading and the king's own peril is settled afterwards, so a king that
 * is merely contingent in TIMING (every entry naming it carries
 * `couldBeat: false` — the engine saying it wins that contact in every world)
 * still spreads regicide entries across its team. Those team-mates are alive
 * in every world the ledger admits, and saying so raises a floor that had no
 * world under it.
 *
 * Conservative in every other direction: a held king (its fall is exactly what
 * its claim leaves open — `!selfDeathPossible && regicideKingId !== null` is
 * the same condition read from the claim side), a king that cannot itself be
 * proved alive, and a cycle between two kings of one team all fall back to
 * `maybe`.
 */
function moverSurvivalVia(
  settlement: PartialSettlement,
  wireId: string,
  seen: Set<string> | null
): Trit {
  if (settlement.board[wireId] === undefined || settlement.deaths[wireId] !== undefined) return 'no';
  let kings: string[] | null = null;
  for (const entry of settlement.ledger) {
    if (entry.unitId !== wireId) continue;
    if (entry.kind === 'regicide') {
      const king = regicideKingOf(entry);
      if (kings === null) kings = [king];
      else if (!kings.includes(king)) kings.push(king);
      continue;
    }
    if (entry.couldBeat) return 'maybe';
  }
  if (kings === null) return 'yes';
  const visited = seen ?? new Set<string>();
  visited.add(wireId);
  const claims = claimsById(settlement);
  for (const king of kings) {
    if (visited.has(king) || claims.has(king)) return 'maybe';
    if (moverSurvivalVia(settlement, king, visited) !== 'yes') return 'maybe';
  }
  return 'yes';
}

/**
 * WHAT A SEVER COULD TAKE OFF ONE OF OUR MOVERS.
 *
 * A `sever` divergence is the ONE contact the engine calls non-fatal: the cut
 * is recorded during the collision phase and applied afterwards, and the owner
 * keeps `occupancy[0 .. cutIndex - 1]` (`turnEngine.ts`: `cutIndex =
 * occupancy.indexOf(cell, 1)`, then `occupancy.length = min(severCuts)`). So a
 * mover the ledger says a held unit could sever is SHORTER in that world, and
 * the fold that reads its weight straight off the settled board is asserting a
 * length it does not have in every world.
 *
 * That is not a hypothetical. Measured on `potions` seed 2, a snake staged
 * 75→74 with its body still on 75 and a held knight one move from 75: `B0`
 * priced the snake at its full weight 3 and published a floor of 31.68, while
 * `B3` enumerated the knight's actual reply, settled the cut, and returned a
 * complete world worth 12.07 — a floor above a ceiling, 287 times in one game.
 * The floor was the wrong one.
 *
 * TWO KINDS OF ENTRY SHARE THE `sever` KIND, and only one of them is about us.
 * `settlePartial` writes one when a claim's body could be cut by THIS unit
 * (`cell` is our own head at that sub-step) and one when this unit's own trail
 * could be cut by a claim's head (`cell` is one of our body segments). The
 * discriminator is exact rather than a guess: `trackOf` deletes `head[k]` from
 * `body[k]`, so a segment entry can never name the head cell of its sub-step.
 *
 * POLARITY. Only `assumedPresent === false` entries move the floor: the
 * timeline read the cell empty and did NOT apply the cut, so the shorter world
 * is one it has not scored. An `assumedPresent === true` entry is a cut the
 * settled occupancy already carries.
 *
 * WHERE THE CUT LANDS. `indexOf` on the settled occupancy is the engine's own
 * arithmetic wherever the named cell survived to the end of the turn. Where it
 * did not — a trail cell the tail has since left, which `trackOf` unions into
 * `body[k]` from the pre-move record — the settlement does not say where the
 * cut fell, and the sound reading of "somewhere" is the deepest cut the engine
 * can produce: `indexOf(cell, 1)` never returns 0, so the head always survives
 * and nothing else is promised.
 */
export function moverSeverLoss(
  settlement: PartialSettlement,
  wireId: string,
  headAtTurnStart: number
): number {
  const settled = settlement.board[wireId];
  if (settled === undefined) return 0;
  const occupancy = settled.occupancy;
  if (occupancy.length <= 1) return 0;
  const traversed = settlement.traversed[wireId] ?? [];
  // The head at sub-step k, exactly as `trackOf` builds it: the turn-start
  // head, then one entry per cell the settlement says this unit entered, and
  // the last of those repeated once it has stopped.
  const headAt = (subStep: number): number => {
    if (subStep <= 0) return headAtTurnStart;
    const entered = traversed[Math.min(subStep, traversed.length) - 1];
    return entered ?? headAtTurnStart;
  };
  let keep = occupancy.length;
  for (const d of settlement.ledger) {
    if (d.kind !== 'sever' || d.unitId !== wireId || d.assumedPresent) continue;
    // Our head at that sub-step: this entry is the claim being cut BY us.
    if (d.cell === headAt(d.subStep)) continue;
    const cut = occupancy.indexOf(d.cell, 1);
    keep = Math.min(keep, cut < 1 ? 1 : cut);
  }
  return occupancy.length - keep;
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
 * A MOVER's weight is what the settled board says it is — the growth and the
 * severs THIS timeline applied — and its survival is the settlement's own
 * `fates`; the severs the timeline did not apply but the ledger admits are its
 * `partialLossMax`, exactly as a held unit's are. A HELD unit has no settled
 * board entry by construction; its interval is its claim's, and its partial
 * loss is the weight a sever could take without killing it.
 */
export function unitValuesOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement
): UnitValue[] {
  const out: UnitValue[] = [];
  const claimById = claimsById(settlement);
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
      // A MOVER CAN BE SEVERED TOO, and reading `partialLossMax` as zero for
      // one was the floor's own defect — see `moverSeverLoss`.
      partialLossMax: moverSeverLoss(settlement, unit.wireId, unit.cells[0] as number),
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
  // The distinct teams, in first-seen order — the same order `new Set(map(...))`
  // produced, without the intermediate array and Set per settlement.
  for (const u of units) {
    if (perTeam.has(u.team)) continue;
    perTeam.set(u.team, scopedTeamValue(units, u.team, subjectTeam));
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
