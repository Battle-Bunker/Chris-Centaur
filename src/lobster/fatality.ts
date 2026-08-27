/**
 * THE PER-UNIT FATALITY CLASSIFIER — rung 0, and the cheapest genuine
 * lookahead in the system.
 *
 * A third of every trail unit's option set is certainly fatal by the rules, on
 * 100% of unit-turns, and classifying all four destinations costs ~25 ns
 * against a `price()` of 115–707 µs. Three of the four clauses already ship
 * (`staging-safety.ts`). What this file adds is what the SET of verdicts says
 * about the unit, and what the position AFTER a move says about the option:
 *
 *   FORCED     exactly one option survives ⇒ the unit is a constant. Not a
 *              prune of that move — a prune of the SEARCH over that unit.
 *   SEALED     no option survives ⇒ the unit dies whatever it does. Stop
 *              spending on it, and tell the team, because its cells become a
 *              durable pile settled on WEIGHT where a living body is settled
 *              on TIER — a widening for everyone else, available for free.
 *   SURVIVORS  how many escapes the unit has AFTER the move. P(die within one
 *              turn) is monotone in this count with a 7.8–10.6× spread over
 *              ~90k unit-turns and three independent bots. Nothing else in the
 *              ladder puts that much discrimination on a singleton edge for
 *              35 ns.
 *
 * ── WHAT IS A THEOREM HERE AND WHAT IS NOT ─────────────────────────────────
 *
 * FORCED and SEALED are only as sound as the clauses that produced them, so
 * they carry their PROVENANCE rather than arriving as bare booleans. On the
 * rules-only subset (wall, own body, own tail) they are theorems: every fact
 * is a property of the mover's own turn-start occupancy and of terrain, both
 * frozen for the turn. Add the ally arm and they become policy, because a
 * team-mate that dies this turn leaves a pile settled on weight rather than a
 * body settled on tier.
 *
 * The survivor count is EV-ADVISORY, forever. It assumes every other unit
 * stands still, which is false. It is a prior, not a bound, and it may reach
 * an ordering and a sampler and nothing else.
 *
 * ── THE TAIL RULE, WHICH THE MEMOS GET WRONG ───────────────────────────────
 *
 * "A trail unit's tail vacates unless it eats this turn" is the received
 * reading, and it is false in this engine. Growth is
 * `arena[t+len] = arena[t+len-1]` at end of turn: it DUPLICATES the
 * post-shift last cell, which the unit already occupies, and never writes back
 * the cell the shift vacated. So eating this turn frees the tail exactly as
 * not eating does.
 *
 * What does NOT free a tail is a trail that ALREADY carries a duplicate —
 * a unit that ate LAST turn. Its shift consumes the duplicate and the cell
 * stays occupied for one more turn. The predicate is therefore
 * `cells[len-1] !== cells[len-2]`: one comparison, exact, no food board, no
 * quantifier over the ally's destinations. It is resolved against the real
 * engine in the suite rather than argued from the source, because the whole
 * point of the correction is that reading the source is how the error was
 * made.
 *
 * ── ONE PIPELINE ───────────────────────────────────────────────────────────
 *
 * Enemy occupancy is the risk layer's and is deliberately absent from the
 * escape count. That keeps the term free of enemy geometry entirely, which is
 * how it satisfies the polarity rule without needing a sign audit: a signal
 * that cannot see the enemy cannot be made attractive by the enemy's position.
 * It also makes the count an over-estimate of escapes, which is the safe
 * direction for an advisory prior — it under-penalises rather than inventing
 * danger that is not there.
 */

import { bbTest, profileOf } from '../partial-engine/index';
import { EngineSubstrate } from './substrate';
import type { SubstrateUnit } from './substrate';
import { allyBodyCollision, certainlySelfFatal } from './staging-safety';
import type { Candidate, CellIndex, UnitId } from './contracts';

// ---------------------------------------------------------------------------
// The tail rule
// ---------------------------------------------------------------------------

/**
 * Does this unit's tail cell become free this turn?
 *
 * True for every trail unit whose trail does not already carry a duplicate at
 * the tail; false for a piece (it has no trail to pop) and for a unit that ate
 * last turn. See the header for why eating THIS turn is not the question.
 */
export function tailVacates(unit: SubstrateUnit): boolean {
  if (!profileOf(unit.kind).leavesTrail) return false;
  const len = unit.cells.length;
  if (len < 2) return false;
  return (unit.cells[len - 1] as number) !== (unit.cells[len - 2] as number);
}

/** The cell this unit's tail pop frees, or `null`. */
export function freedTailCell(unit: SubstrateUnit): CellIndex | null {
  return tailVacates(unit) ? (unit.cells[unit.cells.length - 1] as CellIndex) : null;
}

// ---------------------------------------------------------------------------
// The verdicts
// ---------------------------------------------------------------------------

/** Why an option is certainly fatal, or `null` for one that is not. */
export type FatalCause = 'wall' | 'own-body' | 'ally-body';

/** Everything the classifier knows about one option. */
export interface CandidateFatality {
  readonly candidate: Candidate;
  /** Rules-certain death by the mover's own facts, or by an ally's body. */
  readonly cause: FatalCause | null;
  /**
   * Escapes from the landing cell once the mover has moved, or `-1` where the
   * count has no meaning — a piece, or an option that is already fatal.
   *
   * Zero is the sharp reading: the census puts P(survive) at 0.098 there,
   * against 0.904 at one escape and 0.990 at three.
   */
  readonly survivorsAfter: number;
  /** The calibrated survival prior for that count, or 1 where unknown. */
  readonly survivalPrior: number;
}

/**
 * The calibrated post-move survival prior, pooled over three bots and ~90 526
 * unit-turns. The three agree to within 0.02 in every row, which is why
 * pooling is honest.
 *
 * CAVEAT, and it rides with the table: the census measures the PRE-move
 * escape count. This applies it to the POST-move one, which is the right first
 * cut and is falsifiable in half an hour on replays that already exist.
 */
export const SURVIVAL_PRIOR: ReadonlyArray<number> = [0.098, 0.904, 0.976, 0.99];

export function survivalPriorFor(escapes: number): number {
  if (escapes < 0) return 1;
  const capped = Math.min(escapes, SURVIVAL_PRIOR.length - 1);
  return SURVIVAL_PRIOR[capped] as number;
}

/** Whether a unit-level mark rests on the rules alone or on a policy clause. */
export type FatalityProvenance = 'rules-only' | 'policy';

/** What the SET of verdicts says about the unit. */
export interface UnitFatality {
  readonly unitId: UnitId;
  readonly options: ReadonlyArray<CandidateFatality>;
  /** Options with no rules-certain death against them. */
  readonly survivors: number;
  /**
   * The one option left, when there is exactly one. A dimension of the joint
   * problem, collapsed exactly.
   */
  readonly forced: Candidate | null;
  /** Nothing survives. A near-perfect one-turn death oracle at zero cost. */
  readonly sealed: boolean;
  /**
   * Where the verdict came from. A `forced`/`sealed` mark derived with the
   * ally arm in it is not a theorem, and a consumer that treats it as one is
   * the bug this field exists to prevent.
   */
  readonly provenance: FatalityProvenance;
}

// ---------------------------------------------------------------------------
// The per-decision board
// ---------------------------------------------------------------------------

/**
 * The certain-occupancy reading the escape count tests against: terrain walls
 * plus every cell of OUR OWN team that is occupied next turn in every world.
 *
 * `cells[0 .. len-2]` for a trail unit — index 0 included, because the cell a
 * team-mate's head is vacating becomes its own new neck — extended to the tail
 * when the tail does not vacate. Built once per decision; the memo's 131 ns.
 */
export class CertainOccupancy {
  private readonly blocked: Set<number>;

  constructor(
    private readonly sub: EngineSubstrate,
    private readonly team: number,
  ) {
    this.blocked = new Set<number>();
    for (const unit of sub.roster()) {
      if (unit.team !== team) continue;
      if (!profileOf(unit.kind).leavesTrail) {
        // A piece is one cell and may move off it, so it blocks nothing with
        // certainty. Its claim is the claim channel's business, not this one.
        continue;
      }
      const len = unit.cells.length;
      const last = tailVacates(unit) ? len - 2 : len - 1;
      for (let i = 0; i <= last; i++) this.blocked.add(unit.cells[i] as number);
    }
  }

  /** Is this cell certainly unavailable next turn, ignoring the mover itself? */
  has(cell: number): boolean {
    return this.blocked.has(cell) || bbTest(this.sub.terrain.wall, cell);
  }
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * Classify one unit's whole option set.
 *
 * `withAlly` decides the provenance: with it off, every verdict rests on the
 * mover's own turn-start occupancy and terrain and the marks are theorems;
 * with it on the ally arm joins in and they are policy.
 */
export function classifyUnit(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidates: ReadonlyArray<Candidate>,
  occupancy: CertainOccupancy,
  withAlly: boolean,
): UnitFatality {
  const options: CandidateFatality[] = [];
  let survivors = 0;
  let only: Candidate | null = null;
  let usedAlly = false;
  for (const candidate of candidates) {
    let cause: FatalCause | null = certainlySelfFatal(sub, unit, candidate);
    if (cause === null && withAlly && allyBodyCollision(sub, unit, candidate)) {
      cause = 'ally-body';
      usedAlly = true;
    }
    const escapes = cause === null ? escapesAfter(sub, unit, candidate, occupancy) : -1;
    options.push({
      candidate,
      cause,
      survivorsAfter: escapes,
      survivalPrior: survivalPriorFor(escapes),
    });
    if (cause === null) {
      survivors++;
      only = survivors === 1 ? candidate : null;
    }
  }
  return {
    unitId: unit.unitId,
    options,
    survivors,
    forced: survivors === 1 ? only : null,
    sealed: candidates.length > 0 && survivors === 0,
    provenance: usedAlly ? 'policy' : 'rules-only',
  };
}

/**
 * ESCAPES FROM THE LANDING CELL, with the mover's own body advanced by one.
 *
 * Four tests against the prebuilt board plus the mover's own new occupancy.
 * Only trail units are counted: the census measures trail unit-turns, a
 * slider's escape set is its whole ray fan and is a different object, and
 * inventing a number for a piece would put an uncalibrated prior on an edge
 * the calibration says nothing about.
 *
 * WHERE IT LIES: it is static — a cell that looks open may be entered by
 * someone — and it is blind to the tail-vacating that makes a tight coil
 * survivable, so it under-counts escapes in exactly the dense positions where
 * it fires most.
 */
function escapesAfter(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  candidate: Candidate,
  occupancy: CertainOccupancy,
): number {
  const profile = profileOf(unit.kind);
  if (!profile.leavesTrail || candidate.path.length === 0) return -1;
  const grid = sub.grid;
  const dest = candidate.to as number;
  // The body one turn on: the destination in front, the tail dropped when it
  // pops. `cells[len-1]` survives a turn only when the trail carries a
  // duplicate, and then it is `cells[len-2]`'s own cell anyway.
  const len = unit.cells.length;
  const keep = tailVacates(unit) ? len - 1 : len;
  const x = dest % grid.width;
  const y = (dest / grid.width) | 0;
  let escapes = 0;
  for (const [dx, dy] of profile.steps) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
    const n = ny * grid.width + nx;
    if (n === dest) continue;
    if (occupancy.has(n)) continue;
    // The mover's own advanced body. Its old head is its new neck; its old
    // tail is gone if it pops.
    let ownBody = false;
    for (let i = 0; i < keep; i++) {
      if ((unit.cells[i] as number) === n) {
        ownBody = true;
        break;
      }
    }
    if (!ownBody) escapes++;
  }
  return escapes;
}
