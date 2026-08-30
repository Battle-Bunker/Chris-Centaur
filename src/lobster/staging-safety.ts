/**
 * STAGING SAFETY — the caller-side pre-filter the risk layer says it assumes,
 * and the last line behind it.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `RiskAssessor.assessPath` states its own contract in its header:
 *
 *   "Encounters fold in the engine's own adjudication tier order (edge -> wall
 *    -> self -> arrival -> body — WALLS AND SELF-COLLISIONS ARE THE MOVER'S OWN
 *    DETERMINISTIC FACTS AND ARE ASSUMED PRE-FILTERED BY THE CALLER'S PATH
 *    LEGALITY; what folds here is the risk overlay)."
 *
 * The risk layer is a reading of the CLAIM FIELD — the units this decision
 * holds frozen. Our own units are MODELLED, so they contribute no claim slot,
 * so `entriesAt` returns nothing at our own body cells; and the perimeter is
 * terrain, which the fold reads only for hazard damage. Both classes therefore
 * come back `NO_RISK` and are assessed `safe`.
 *
 * NOBODY WAS DOING THE PRE-FILTERING. The candidate layer takes the engine's
 * `enumerateActions` verbatim, and that enumerator deliberately offers wall
 * cells to trail units ("walking into the perimeter is a legal, fatal move")
 * and offers the neck, because `planAction` tests only the step vector. So the
 * certain-death prune in `candidates.ts` — which fires on `tier === 'doomed'` —
 * could never fire on the two move classes that are certainly fatal BY RULE,
 * and worse: a candidate assessed `safe` also sorts as `safe`, and among safe
 * ties the generator's last tie-break is ascending destination index, which for
 * a trail unit is exactly `up < left < right < down`.
 *
 * This module is that missing pre-filter, and nothing more. Every predicate
 * here is a RULE, evaluated against the mover's own turn-start occupancy and
 * the terrain — position-independent, no other unit's choice in it, no
 * resolution, no search. It re-implements no rule: `certainlySelfFatal` is a
 * statement about the mover's own body and the terrain's own wall board, and
 * `killsOwnKing` asks the resolver's own comparator (`cmpLex`) who wins.
 *
 * ── WHAT IS AND IS NOT CERTAIN ─────────────────────────────────────────────
 *
 * A trail unit's occupancy next turn is `[newHead, cells[0] .. cells[len-2]]`:
 * the body shifts by one and only the TAIL vacates. So for EVERY trail unit on
 * the board — ours, a team-mate's, an enemy's — `cells[0 .. len-2]` is occupied
 * in every world, whatever that unit chooses, because a trail unit must step and
 * its body follows. `cells[len-1]` is the tail and vacates (unless the unit
 * grows), so it is NOT in the certain set — which is exactly why a length-2
 * reversal is safe and a length-3 one is not, and why the corpus shows 1295 of
 * 1295 length->=3 reversals fatal and 0 of 3385 length-2 ones.
 *
 * A TEAM-MATE'S BODY IS ALMOST, BUT NOT QUITE, THE SAME FACT — see
 * `allyBodyCollision`, which is kept OUT of the certain set for the one reason
 * that breaks it: if the team-mate DIES this turn its occupancy becomes a
 * durable pile, and a pile is settled on WEIGHT, so a heavy enough mover
 * survives a cell a living body would have killed it on. The living-body rule
 * is tier-only; the corpse rule is not. That is a policy prune with a declared
 * cost, not a theorem.
 *
 * THE TEAM-MATE HALF WAS MEASURED, NOT ASSUMED. With only the mover's OWN body
 * refused, the queen-cell arm's rule-certain self-kills went 4.17 -> 0.00 per
 * game and its deaths did not fall at all: 22 of them reappeared as `bodyBlock`
 * on a team-mate's body (13 mid-body, 9 on the cell the team-mate's head was
 * vacating — which becomes its new neck). The blindness is not about the mover,
 * it is about the MODELLED set: our own units carry no claim slot, so the risk
 * layer reads every one of our bodies as empty. The mover's own body was just
 * the first instance of it anyone noticed.
 *
 * The one rule that is not pure geometry is the tier: a body cell kills an
 * arriver whose tier is at most the owner's, and a strictly higher tier SEVERS
 * and lives (`risk.ts` `bodyOutcome`). So the refusal asks the tier, and a
 * mover that would sever is not refused.
 *
 * A wall cell kills whatever enters it, and only a trail unit can even stage
 * one (`profile.mayEnterWall`); a piece's off-board destination is not
 * enumerated at all.
 *
 * `killsOwnKing` is DIFFERENT and is labelled differently: it is certain only
 * while the king stands where it stands. The king may move. That makes it a
 * policy prune with a declared cost rather than a rules-certain one, and it is
 * kept out of `certainlySelfFatal` for that reason.
 */

import { bbTest, cmpLex, profileOf, scalarOf } from '../partial-engine/index';
import type { EngineSubstrate, SubstrateUnit } from './substrate';
import type { Candidate, CellIndex } from './contracts';

// ---------------------------------------------------------------------------
// The level — a bot-config choice, formerly CENTAUR_STAGING_SAFETY
// ---------------------------------------------------------------------------

/**
 * How much of the staging-safety layer is live.
 *
 *   off    nothing. The build is the one that shipped, comparison by
 *          comparison — every predicate here is unreachable.
 *   guard  the candidate-layer pre-filter only: certainly-fatal moves are
 *          assessed `doomed` (so they sort last) and taken by a declared prune
 *          (so they leave the option set whenever anything else is offered).
 *   full   `guard`, plus the rung-0 self-harm repair in `SearchCore.conform`.
 *   auto   `full` on a board that bears a PIECE, `off` on a snake-only board.
 *          The default, and the ship condition — see below.
 *
 * ── WHY `auto` EXISTS, AND WHY IT IS THE DEFAULT (integ/round-a) ───────────
 *
 * The ledger's Stage 2.5 verdict on I1 does not ship this layer flat:
 *
 *   "SHIP the guard for PIECE boards as a rule-certainty defect fix; DO NOT
 *    SHIP UNCONDITIONALLY — the snake-only no-regression gate FAILS."
 *
 * Those are two different boards, not two different confidence levels. On
 * piece cells (n=48) the guard is worth place +0.146 [+0.031, +0.250] and
 * material +3.000, against its own null; on `r01-snakes6` it is
 * −0.500 [−0.708, −0.333] against a null of −0.083. The mechanism of the
 * failure is understood and is specific to that board: every snake staging
 * `up` is PARALLEL MOTION, which was accidentally collision-free, and a
 * per-unit refusal breaks that coherence without replacing it — a team-level
 * capability the layer does not have. The guard is not "less good" on
 * snake-only boards; it is harmful there, for a reason that does not apply
 * where a piece is on the board.
 *
 * The level as I1 built it is a blunt three-state and cannot express that: it
 * is the same answer on every board. `auto` is the ship condition made into
 * the DEFAULT POLICY, so the shipped build carries the verdict rather than
 * relying on an operator to know it. `guard` and `full` remain available as
 * UNCONDITIONAL levels, which is what a measurement arm needs — an arm that
 * wants the snake-only cell must be able to ask for it, and now asks by being
 * a differently-configured bot rather than by setting a variable.
 *
 * `full`, not `guard`, is what `auto` resolves to, because `full` is what was
 * measured: I1's `mine` arm is "guard + rung-0 repair + royal margin". (The
 * royal-margin reading is separate and its default is NOT changed here — see
 * `DEFAULT_ROYAL_REACHERS` below for the correction that is owed and why this
 * change deliberately does not make it.)
 */
export type StagingSafety = 'off' | 'auto' | 'guard' | 'full';

/** What a level resolves to once the board is known. `auto` is the only one
 * that is not already an answer. */
export type ResolvedStagingSafety = 'off' | 'guard' | 'full';

/**
 * THE SHIP CONDITION, as a value. It was `CENTAUR_STAGING_SAFETY`, whose four
 * levels a caller could name from the environment; the level is now a
 * `BotConfig` field (`bot-config.ts`) whose default is this constant, so the
 * shipped bot is the ship condition and an arm is a differently-configured bot.
 *
 * The core redesign (§1.4) sentences this layer to the KERNEL SAFETY FLOOR —
 * "no longer configurable" — because a refusal that removes an option from the
 * set is not a strategy under the seam rule. It stays configurable for exactly
 * as long as the exploration slice needs to be able to ask for the opposite
 * branch of a promoted policy, and no longer.
 */
export const STAGING_SAFETY_DEFAULT: StagingSafety = 'auto';

/**
 * Does this board bear a PIECE — a unit that leaves no trail?
 *
 * The whole roster, not just ours: the snake-only cell the guard regresses is
 * one where NOTHING on the board is a piece, which is what makes the parallel
 * motion it breaks coherent in the first place.
 *
 * One pass over the roster, once per decision, next to the other per-decision
 * board facts. `leavesTrail` is the engine's own profile bit, so this asks the
 * rules rather than inspecting wire types.
 */
export function boardBearsPiece(sub: EngineSubstrate): boolean {
  return sub.roster().some((unit) => !profileOf(unit.kind).leavesTrail);
}

/**
 * Turn a level into an answer, given the one board fact `auto` depends on.
 *
 * Callers that have no board — a generator or a search core built outside a
 * team decision — must pass `false`, which resolves `auto` to `off`. That is
 * the deliberately conservative direction: `off` is the behaviour that shipped,
 * and a guard that must not touch snake-only boards may not be switched on by
 * a caller that cannot tell whether this is one.
 */
export function resolveStagingSafety(
  level: StagingSafety,
  hasPiece: boolean
): ResolvedStagingSafety {
  if (level !== 'auto') return level;
  return hasPiece ? 'full' : 'off';
}

/**
 * THE ROYAL-MARGIN READING, AND A CORRECTION THIS TEARDOWN DID NOT MAKE.
 *
 * `kingMarginFeature` exists to answer "what is the heaviest thing that can
 * stand on my king's square next turn", and its code skips every unit on our
 * own team. These rules have NO FRIENDLY-FIRE EXEMPTION and 27.0% of all king
 * deaths in the measured corpus were inflicted by the king's own team, so the
 * feature is structurally blind to the largest single source of the event it
 * was built to price. By the argument in that sentence this is a CORRECTION and
 * it is owed an unconditional flip.
 *
 * IT IS NOT FLIPPED HERE, DELIBERATELY. This teardown's gate is that the default
 * bot is byte-identical except for the ONE correction the owner named
 * (mutual-wipe pricing); flipping a second evaluator reading in the same change
 * would put two deliberate behaviour changes behind one identity-gate
 * regeneration and make neither of them attributable. So `CENTAUR_ROYAL_MARGIN`
 * is deleted as a switch and the reading keeps the value that shipped: it is a
 * `CriterionProfile.royalReachers` param (`evaluate/features.ts`), false unless
 * a profile names it, which is a bot-config choice like every other profile
 * weight.
 *
 * OWED: flip `DEFAULT_ROYAL_REACHERS` to true as its own change, with its own
 * identity-gate regeneration and its own test. The redesign (§1.4) sentences it
 * to a kernel safety-floor param, which is where it lands once flipped.
 */
export const DEFAULT_ROYAL_REACHERS = false;

// ---------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------

/** Why a candidate is certainly fatal to its own mover, or `null`. */
export type SelfFatalKind = 'wall' | 'own-body';

/**
 * Is this candidate fatal to the mover BY RULE, with no other unit's choice in
 * it? Returns which rule, or `null`.
 *
 * Both arms are properties of the mover's own turn-start occupancy and of the
 * terrain, so the answer is the same in every world the search could enumerate.
 * A move is checked along its whole PATH, not only at its destination: a trail
 * unit's path is one cell, but the predicate is written for the general mover
 * so that a kind added later gets the same treatment without a new code path.
 */
export function certainlySelfFatal(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate
): SelfFatalKind | null {
  if (candidate.path.length === 0) return null; // a stay enters nothing
  const profile = profileOf(unit.kind);

  // WALL. Only a kind that may stage one can have one enumerated; every cell of
  // the path is tested because a ray that crosses the perimeter is the same
  // death wherever on the ray it happens.
  if (profile.mayEnterWall) {
    for (const cell of candidate.path) {
      if (bbTest(sub.terrain.wall, cell)) return 'wall';
    }
  }

  // OWN BODY. `cells[1 .. len-2]` is occupied next turn in every world: the body
  // shifts by one and only the tail vacates. Index 0 is the mover's own head,
  // which a trail unit cannot stage.
  if (profile.leavesTrail && unit.cells.length >= 3) {
    const last = unit.cells.length - 2;
    for (let i = 1; i <= last; i++) {
      if (candidate.path.includes(unit.cells[i] as CellIndex)) return 'own-body';
    }
  }

  return null;
}

/**
 * Would this candidate walk into a MODELLED TEAM-MATE's body?
 *
 * The same arithmetic as the mover's own body, one unit over: a trail unit's
 * `cells[0 .. len-2]` is occupied next turn whatever it chooses, INDEX 0
 * INCLUDED — the cell a team-mate's head is vacating becomes its own new neck.
 * And our team-mates are modelled, so they carry no claim slot and the risk
 * layer reads every one of their bodies as empty ground.
 *
 * NOT in the certain set, for one reason: if the team-mate dies this turn its
 * occupancy becomes a durable pile, and a pile is settled on WEIGHT where a
 * living body is settled on TIER alone. So a mover heavy enough to win the pile
 * survives a cell the living body would have killed it on. That makes this a
 * policy prune with a declared cost rather than a theorem — and the cost is
 * exactly "a slide that would have paid off because a team-mate was about to
 * die on it", which is not a tactic anyone is playing on purpose.
 *
 * ENEMY bodies are deliberately absent: they obey the same arithmetic, but the
 * risk layer already carries them as claims and answers for them, and a second
 * reading of the same units is the drift the one-pipeline rule forbids.
 */
export function allyBodyCollision(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate
): boolean {
  if (candidate.path.length === 0) return false;
  const modelled = sub.modeled();
  for (const other of sub.roster()) {
    if (other.unitId === unit.unitId) continue;
    if (other.team !== unit.team || !modelled.has(other.unitId)) continue;
    if (!profileOf(other.kind).leavesTrail) continue;
    // A strictly higher tier SEVERS the body and lives (risk.ts bodyOutcome).
    if (unit.tier > other.tier) continue;
    const last = other.cells.length - 2; // the tail vacates
    for (let i = 0; i <= last; i++) {
      if (candidate.path.includes(other.cells[i] as CellIndex)) return true;
    }
  }
  return false;
}

/**
 * Would this candidate kill our OWN king, if the king is still standing on its
 * square when the mover gets there?
 *
 * The rules give a king no friendly-fire exemption and spawn it at the lightest
 * weight on the board, so any team-mate that reaches its cell and wins-or-ties
 * the contest ends the whole team on the spot. Whether the mover wins is asked
 * of the RESOLVER'S OWN comparator, not restated here: `cmpLex(mover, king) >= 0`
 * is precisely the condition under which `headOutcome` reports the defender
 * defeated (a tie kills everyone, the king included).
 *
 * NOT CERTAIN, and labelled accordingly: the king may vacate. What makes this
 * worth a prune anyway is that the cheapest alternative is always available —
 * a ray is prefix-closed, so the cell one short of the king is itself an
 * enumerated candidate — and that the measured cost of being wrong is the game.
 */
export function killsOwnKing(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate
): boolean {
  if (unit.isKing || candidate.path.length === 0) return false;
  if (!sub.regicideTeamNumbers().has(unit.team)) return false;
  const mover = scalarOf(unit.tier, unit.weight);
  for (const other of sub.roster()) {
    if (!other.isKing || other.team !== unit.team || other.unitId === unit.unitId) continue;
    const seat = other.cells[0] as CellIndex;
    if (!candidate.path.includes(seat)) continue;
    if (cmpLex(mover, scalarOf(other.tier, other.weight)) >= 0) return true;
  }
  return false;
}
