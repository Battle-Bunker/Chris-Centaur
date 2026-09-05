/**
 * STAGING SAFETY — the caller-side pre-filter the risk layer says it assumes,
 * and the last line behind it.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `pathrisk.assessPath` inherits the contract the risk fold stated:
 *
 *   "Encounters fold in the engine's own adjudication tier order (edge -> wall
 *    -> self -> arrival -> body — WALLS AND SELF-COLLISIONS ARE THE MOVER'S OWN
 *    DETERMINISTIC FACTS AND ARE ASSUMED PRE-FILTERED BY THE CALLER'S PATH
 *    LEGALITY; what folds here is the risk overlay)."
 *
 * The risk fold is a reading of the SETTLEMENT — and the settlement is run with
 * our own units modelled, so nothing in it stands in our own way. Our own units are MODELLED, so they contribute no claim slot,
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
 * `killsOwnKing` asks the rule's own comparator (`outranks`) who wins.
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
 * one — `legalTargets` offers a wall to a trail unit and to nothing else, and a
 * piece's off-board destination is not a legal target at all.
 *
 * `killsOwnKing` is DIFFERENT and is labelled differently: it is certain only
 * while the king stands where it stands. The king may move. That makes it a
 * policy prune with a declared cost rather than a rules-certain one, and it is
 * kept out of `certainlySelfFatal` for that reason.
 */

import { leavesTrail } from '../engine-vendor/engine/moveGrammar';
import { outranks } from '../engine-vendor/engine/turnEngine';
import type { EngineSubstrate, SubstrateUnit } from './substrate';
import type { Candidate, CellIndex } from './contracts';

// ---------------------------------------------------------------------------
// The flag
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
 *   auto   `full` on a board that bears a PIECE, `guard` on a snake-only
 *          board. The default — see below.
 *
 * ── WHY `auto` EXISTS, AND WHAT IT RESOLVES TO ON A SNAKE-ONLY BOARD ───────
 *
 * The ledger's Stage 2.5 verdict on I1 did not ship this layer flat:
 *
 *   "SHIP the guard for PIECE boards as a rule-certainty defect fix; DO NOT
 *    SHIP UNCONDITIONALLY — the snake-only no-regression gate FAILS."
 *
 * On piece cells (n=48) the guard was worth place +0.146 [+0.031, +0.250] and
 * material +3.000 against its own null; on `r01-snakes6` it was
 * −0.500 [−0.708, −0.333] against a null of −0.083. The stated mechanism of
 * that failure was specific to the board: every snake staging `up` is PARALLEL
 * MOTION, which was accidentally collision-free, and a per-unit refusal breaks
 * that coherence "without replacing it — a team-level capability the layer does
 * not have".
 *
 * THAT VERDICT WAS RE-MEASURED AND IT NO LONGER HOLDS, for two reasons that
 * are both changes to the build under it, not to the argument:
 *
 *   1. THE REFUSAL NO LONGER MOVES ANY UNIT. The certain-self-fatal TIER
 *      correction became unconditional (docs/BASIC-INTELLIGENCE.md fix 6), so
 *      a wall or own-body move is already `doomed` and already sorts last, and
 *      the always-on `pruneFatalNoGain` knob already takes it. Over 1750
 *      snake-only unit-decisions the guard removes 96 of 5382 options — 68 of
 *      them the ALLY-BODY policy prune, 28 own-body, ZERO wall — and it changes
 *      the generator's ordered-first option in 0 of 1750. A refusal that never
 *      changes a unit's first pick cannot be what breaks parallel motion.
 *   2. THE MISSING TEAM-LEVEL CAPABILITY EXISTS NOW. `seedPlan`'s de-confliction
 *      (`search/core.ts`) is switched on by the same level, and it is a
 *      team-level answer to exactly the coherence the old verdict said a
 *      per-unit refusal destroyed and could not replace.
 *
 * Measured, 10 seeds x 100 turns, per board class, never pooled (the numbers
 * and the full matrix are in docs/BASIC-INTELLIGENCE.md): at 150 ms the level
 * is a WASH on `snakes` — every counter identical to `off`, 43 deaths either
 * way — and on `sparse` it trades the one wall death for one exhaustion. At the
 * deterministic 20 ms budget, where the decision IS the seed, it is a large
 * win on `snakes`: unit-turns 1350 -> 3295, deaths per 100 unit-turns
 * 3.11 -> 1.18, contest deaths 30 -> 17. Nothing measured HARM in any cell.
 *
 * `guard`, NOT `full`, is what `auto` resolves to here, and the two reasons are
 * separate. It is the level that removes only what a RULE calls fatal: `full`
 * adds `SearchCore`'s rung-0 self-harm repair, which re-picks on the
 * resolution's PROJECTED casualties — a risk reading, not a rule. And `full`
 * measured worse on `sparse` (unit-turns 3100 -> 2750, meals/100 3.19 -> 2.95)
 * and crashed one seed there on a `bounds_inversion` that `repairSelfHarm`
 * does not absorb. Piece boards keep `full`: that is the cell where `full` was
 * measured and shipped, and nothing here re-opens it.
 *
 * `off`, `guard` and `full` remain available as UNCONDITIONAL levels, which is
 * what a measurement arm needs — an arm that wants a particular cell must be
 * able to ask for it. (CENTAUR_ROYAL_MARGIN is a separate flag and its default
 * is NOT changed here — D2 shipped as a defect fix, not a placement claim.)
 */
export type StagingSafety = 'off' | 'auto' | 'guard' | 'full';

/** What a level resolves to once the board is known. `auto` is the only one
 * that is not already an answer. */
export type ResolvedStagingSafety = 'off' | 'guard' | 'full';

export const STAGING_SAFETY_ENV = 'CENTAUR_STAGING_SAFETY';

/** Absent, empty or unrecognised resolves here — the ship condition. */
export const STAGING_SAFETY_DEFAULT: StagingSafety = 'auto';

export function stagingSafetyFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): StagingSafety {
  const raw = env[STAGING_SAFETY_ENV];
  if (raw === undefined || raw === '') return STAGING_SAFETY_DEFAULT;
  if (raw === 'off' || raw === 'auto' || raw === 'guard' || raw === 'full') return raw;
  log(
    `[staging-safety] Ignoring ${STAGING_SAFETY_ENV}="${raw}" — expected "off", "auto", ` +
      `"guard" or "full"; keeping ${STAGING_SAFETY_DEFAULT}`
  );
  return STAGING_SAFETY_DEFAULT;
}

/** Read live, not cached at import: a test flips it per case, production sets
 * it once at process start. Read once per decision, never in a hot loop. */
export function stagingSafety(): StagingSafety {
  return stagingSafetyFrom(process.env);
}

/**
 * Does this board bear a PIECE — a unit that leaves no trail?
 *
 * The whole roster, not just ours: the two cells the levels differ on are
 * "something on the board is a piece" and "nothing is", and a snake-only board
 * is the second one whoever owns the snakes.
 *
 * One pass over the roster, once per decision, next to the other per-decision
 * board facts. `leavesTrail` is the engine's own profile bit, so this asks the
 * rules rather than inspecting wire types.
 */
export function boardBearsPiece(sub: EngineSubstrate): boolean {
  return sub.roster().some((unit) => !leavesTrail(unit.type));
}

/**
 * Turn a level into an answer, given the one board fact `auto` depends on.
 *
 * Callers that have no board — a generator or a search core built outside a
 * team decision — must pass `false`, and so get the SNAKE-ONLY answer. That is
 * still the conservative direction, and it is now the conservative direction in
 * the same sense on both sides: `guard` is the weaker of the two answers `auto`
 * can give, it removes only what a rule calls fatal, and the snake-only cell it
 * used to be withheld from is the cell that was re-measured (see above) and
 * came back a wash at 150 ms and a win at 20 ms. What a no-board caller must
 * not do is claim the PIECE cell's `full`, and it does not.
 */
export function resolveStagingSafety(
  level: StagingSafety,
  hasPiece: boolean
): ResolvedStagingSafety {
  if (level !== 'auto') return level;
  return hasPiece ? 'full' : 'guard';
}

/**
 * The royal-margin correction, flagged separately so its effect can be
 * measured apart from the staging guard.
 *
 * `kingMarginFeature` exists to answer "what is the heaviest thing that can
 * stand on my king's square next turn", and its code skipped every unit on our
 * own team. These rules have NO FRIENDLY-FIRE EXEMPTION and 27.0% of all king
 * deaths in the measured corpus were inflicted by the king's own team, so the
 * feature was structurally blind to the largest single source of the event it
 * was built to price.
 */
export const ROYAL_MARGIN_ENV = 'CENTAUR_ROYAL_MARGIN';

export function royalMarginFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env[ROYAL_MARGIN_ENV];
  return raw === '1' || raw === 'on' || raw === 'true';
}

export function royalMargin(): boolean {
  return royalMarginFrom(process.env);
}

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
  const trail = leavesTrail(unit.type);

  // WALL. Only a trail unit can have one enumerated at all — a piece's
  // off-board destination is not a legal target — and every cell of the path is
  // tested because a ray that crosses the perimeter is the same death wherever
  // on the ray it happens.
  for (const cell of candidate.path) {
    if (sub.isWall(cell)) return 'wall';
  }

  // OWN BODY. `cells[1 .. len-2]` is occupied next turn in every world: the body
  // shifts by one and only the tail vacates. Index 0 is the mover's own head,
  // which a trail unit cannot stage.
  if (trail && unit.cells.length >= 3) {
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
    if (!leavesTrail(other.type)) continue;
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
 * of the RESOLVER'S OWN comparator, not restated here: `!outranks(king, mover)`
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
  const mover = { tier: unit.tier, weight: unit.weight };
  for (const other of sub.roster()) {
    if (!other.isKing || other.team !== unit.team || other.unitId === unit.unitId) continue;
    const seat = other.cells[0] as CellIndex;
    if (!candidate.path.includes(seat)) continue;
    // Wins-or-ties, asked of the rule: the king survives only if it strictly
    // outranks the mover, because a tie kills everyone in it.
    if (!outranks({ tier: other.tier, weight: other.weight }, mover)) return true;
  }
  return false;
}
