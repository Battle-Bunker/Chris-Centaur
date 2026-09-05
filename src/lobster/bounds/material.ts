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
  if (settlement.board[wireId] === undefined || settlement.deaths[wireId] !== undefined) {
    // A DEATH IN THE OPTIMISTIC TIMELINE IS NOT A PROOF OF DEATH.
    //
    // `settlePartial` settles with every held unit ABSENT, which is optimistic
    // about contacts WITH those units and, through the movers it thereby lets
    // run further than any world does, PESSIMISTIC about everything downstream.
    // Measured on `potions` seed 5: our queen was staged along a slide whose
    // second cell is a held snake's body, the timeline read that cell empty,
    // the queen ran on to the cell our own snake had come to rest on and took
    // it — and the fold, reading the settled board, wrote our snake off as
    // certainly dead. In every world the body IS there, the queen is severed
    // at it, and the snake lives. `best` was 3 material below a world the bank
    // then enumerated: a ceiling under the truth, 26 times in one game, and on
    // the minimal board of `soundness.test.ts` it clamps the whole team to
    // DEAD and publishes `hi = −∞`.
    //
    // `fates` is the engine's own verdict and the only one entitled to close
    // this: "'dead' and 'alive' are proofs; 'contingent' is a work list"
    // (`settlePartial.ts`), and a mover is contingent exactly when the ledger
    // names it at all. So a death the ledger does not touch is proved and
    // scores as one; a death the ledger names is a death in THIS timeline and
    // nothing more.
    return settlement.fates[wireId] === 'dead' ? 'no' : 'maybe';
  }
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
 * A SEVER ENTRY IS A PROOF OF SURVIVAL AGAIN, BECAUSE THE ENGINE NOW LEDGERS
 * THE PILE THAT MADE IT ONE.
 *
 * The second half of the body rule — "this unit's own trail is what the claim
 * could be arriving on, and a cut is a weight loss rather than a death" — used
 * to be written with `couldBeat: false` unconditionally, and that reasoning
 * only ever covered ONE arrival. A claim that DIES on our segment leaves a
 * corpse the cell holds for the rest of the turn, and the resolver enters the
 * segment's OWNER into that pile with it; a second arrival then contests the
 * whole pile and condemns every member that is not its unique strict maximum.
 * So the owner could be killed at a cell it merely had a tail on, by a contact
 * its own ledger entry called survivable — sixteen of four hundred enumerated
 * worlds on the board `src/tests/settle-partial-sever-pile.test.ts` pins.
 *
 * The fold answered that by refusing the PROOF rather than the pricing: it
 * re-derived, from the ledger, which segment cells two unknown presences could
 * stand on, and called the mover `maybe` at those. That derivation is gone,
 * because the engine now writes the pile down itself — `entangle`'s trail
 * branch adds a `contest` with `couldBeat: true` at the same cell and sub-step
 * whenever the claim could die on the segment and something else could arrive
 * after it, or the timeline already piled the owner there. The loop above
 * returns `maybe` on any `couldBeat` entry, so that contest is read before the
 * sever is, and a second encoding of the same reasoning bot-side could only
 * ever drift away from the engine's.
 *
 * A LONE claim over one of our segments still writes no contest, and still
 * proves survival: one arrival either dies on the segment or cuts it, and the
 * owner lives in every world. That asymmetry is the whole content of the rule,
 * and it is the engine's to state.
 */

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
 *
 * ── THE HALF THE UNION DOES NOT COVER ──────────────────────────────────────
 *
 * `peril ∪ reached` is a NARROWING of `Claim.deathPossible`, and a narrowing
 * has to cover every route the wider reading admits or it is a ceiling with no
 * world under it. `deathPossible` folds TWO routes: this unit's own peril
 * (`selfDeathPossible`) and the fall of its team's king
 * (`regicideKingId`). The union covers the first — `perilOf` is the peril
 * without us on the board and `reachedByMovers` is the peril we just made by
 * touching a cell the claim could hold — and it covers NOTHING of the second,
 * because the cell a cascade travels through is the KING's, not the victim's.
 *
 * Measured, on `closing.test.ts`'s three-team board: our queen steps onto the
 * blue king, blue's knight sits in the far corner where no mover has been and
 * nothing without us could touch it, and the narrowing calls it certainly
 * alive. `applyRegicide` takes it off the board with the king, so a real world
 * scores +1 against a ceiling of −1 — the R1 violation, 60 worlds of it, in
 * the material profile too.
 *
 * So the cascade route is narrowed at the place it actually runs through: the
 * victim is possibly-gone exactly when its king is not certainly alive, asked
 * of the king ONCE, by the same two readings (a held king by its own claim, a
 * modelled one by `moverSurvival`). A king names no king of its own
 * (`regicideKingId` is null for a king), so this recurses one level and stops;
 * the visiting guard is there for the contract, not for a board.
 */
export function claimSurvival(
  claim: {
    readonly id: string;
    readonly certainlyGone: boolean;
    readonly deathPossible: boolean;
    readonly selfDeathPossible: boolean;
    readonly regicideKingId: string | null;
  },
  peril: ReadonlySet<string>,
  reached: ReadonlySet<string>,
  kingSurvival: (kingId: string) => Trit = () => 'maybe'
): Trit {
  if (claim.certainlyGone) return 'no';
  if (!claim.deathPossible) return 'yes';
  // Route one: its own peril, which the plan narrows.
  if (claim.selfDeathPossible && (peril.has(claim.id) || reached.has(claim.id))) return 'maybe';
  // Route two: the cascade. `regicideKingId !== null` is documented as exactly
  // the condition `deathPossible` adds to `selfDeathPossible`.
  if (claim.regicideKingId !== null) {
    return kingSurvival(claim.regicideKingId) === 'yes' ? 'yes' : 'maybe';
  }
  // Possibly-dead, with no peril of its own the plan left standing and no king
  // to name: the team plays regicide with no king on the roster and is lost
  // when the turn resolves. There is nothing here to narrow.
  if (!claim.selfDeathPossible) return 'maybe';
  return 'yes';
}

/**
 * Every claim's survival off ONE settlement, with the cascade closed.
 *
 * One map rather than a per-claim call, because the closure asks about a king
 * that is itself a claim and the two readers of this — the material fold and
 * `standingOf` — must not answer that question differently. Cached on the
 * settlement AND on the peril set's identity, which is the one input a
 * modelled sibling can answer differently from its parent (`substrate.ts`).
 */
const claimSurvivalCache = new WeakMap<
  PartialSettlement,
  { peril: object; survivals: ReadonlyMap<string, Trit> }
>();

export function claimSurvivals(
  settlement: PartialSettlement,
  peril: ReadonlySet<string>
): ReadonlyMap<string, Trit> {
  const hit = claimSurvivalCache.get(settlement);
  if (hit !== undefined && hit.peril === (peril as object)) return hit.survivals;
  const made = claimSurvivalsUncached(settlement, peril);
  claimSurvivalCache.set(settlement, { peril: peril as object, survivals: made });
  return made;
}

function claimSurvivalsUncached(
  settlement: PartialSettlement,
  peril: ReadonlySet<string>
): ReadonlyMap<string, Trit> {
  const claims = claimsById(settlement);
  const reached = reachedByMovers(settlement);
  const out = new Map<string, Trit>();
  const visiting = new Set<string>();
  const resolve = (id: string): Trit => {
    const memo = out.get(id);
    if (memo !== undefined) return memo;
    const claim = claims.get(id);
    // Not a claim: a MODELLED king, whose fall the settlement has settled, or
    // a unit that is not on the board at all — `moverSurvival` reads 'no' for
    // that, and a king that is already gone is a cascade that already ran.
    if (claim === undefined) return moverSurvival(settlement, id);
    if (visiting.has(id)) return 'maybe';
    visiting.add(id);
    const made = claimSurvival(claim, peril, reached, resolve);
    visiting.delete(id);
    out.set(id, made);
    return made;
  };
  for (const claim of settlement.claims) resolve(claim.id);
  return out;
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
/**
 * THE MOST A MOVER CAN WEIGH IN ANY WORLD.
 *
 * Read for a mover the timeline killed and the ledger did not prove dead: the
 * settled board has no entry for it, so there is no weight to read off, and
 * the reading that bounds every world it might be alive in is the weight it
 * stood at when the turn opened plus the one meal a turn can add. That cap is
 * the engine's own — `claims.ts` prices a held unit's weight ceiling as
 * `length + min(span, foodInReach)`, and a mover's span is one — and the two
 * ways weight goes DOWN (a sever, a promotion) only ever make it smaller.
 *
 * Over-stating it is safe in both frames and understating it is not: a
 * possibly-alive unit of ours enters only `best` (which a larger figure
 * raises) and a possibly-alive unit of theirs only the subject's `worst`
 * (which a larger figure lowers). Both directions widen.
 */
export function moverWeightCeiling(
  sub: EngineSubstrate,
  unit: { readonly weight: number }
): number {
  return unit.weight + (sub.marshalled.config.food.length > 0 ? 1 : 0);
}

export function unitValuesOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement
): UnitValue[] {
  const out: UnitValue[] = [];
  const claimById = claimsById(settlement);
  const survivals = claimSurvivals(settlement, sub.perilOf());
  for (const unit of sub.roster()) {
    const claim = claimById.get(unit.wireId);
    if (claim !== undefined) {
      out.push({
        unitId: unit.unitId,
        team: unit.team,
        survival: survivals.get(claim.id) ?? 'maybe',
        weightMin: claim.weightMin,
        weightMax: claim.weightMax,
        partialLossMax: Math.max(0, unit.weight - claim.weightMin),
      });
      continue;
    }
    const settled = settlement.board[unit.wireId];
    const survival = moverSurvival(settlement, unit.wireId);
    const weight = settled?.occupancy.length ?? 0;
    // A mover the timeline killed but the ledger left contingent weighs
    // nothing on the settled board and something in every world it survives.
    const possible = settled === undefined && survival !== 'no';
    out.push({
      unitId: unit.unitId,
      team: unit.team,
      survival,
      weightMin: weight,
      weightMax: possible ? moverWeightCeiling(sub, unit) : weight,
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
