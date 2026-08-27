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
 */
export type StagingSafety = 'off' | 'guard' | 'full';

export const STAGING_SAFETY_ENV = 'CENTAUR_STAGING_SAFETY';

/** Absent, empty or unrecognised resolves here. Additive behind a flag: the
 * default is the behaviour that shipped. */
export const STAGING_SAFETY_DEFAULT: StagingSafety = 'off';

export function stagingSafetyFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): StagingSafety {
  const raw = env[STAGING_SAFETY_ENV];
  if (raw === undefined || raw === '') return STAGING_SAFETY_DEFAULT;
  if (raw === 'off' || raw === 'guard' || raw === 'full') return raw;
  log(
    `[staging-safety] Ignoring ${STAGING_SAFETY_ENV}="${raw}" — expected "off", "guard" or ` +
      `"full"; keeping ${STAGING_SAFETY_DEFAULT}`
  );
  return STAGING_SAFETY_DEFAULT;
}

/** Read live, not cached at import: a test flips it per case, production sets
 * it once at process start. Read once per decision, never in a hot loop. */
export function stagingSafety(): StagingSafety {
  return stagingSafetyFrom(process.env);
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
