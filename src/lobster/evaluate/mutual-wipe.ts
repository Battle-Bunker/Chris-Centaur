/**
 * THE MUTUAL-WIPE AWARD — the game's own rule for a game that ends with
 * everybody dead. UNCONDITIONAL: this is a CORRECTION, not a strategy.
 *
 * ── WHAT THE RULES SAY, AND WHAT THIS EVALUATOR SAID INSTEAD ───────────────
 *
 * TacticToes settles a game in which every remaining team dies on the SAME turn
 * from the PREVIOUS COMMITTED TURN's board
 * (`TeamSnekProcessor.calculatePreviousTurnTeamOutcome`). And the metric this
 * program optimizes is not the winner flag that rule produces — it is the
 * owner's cross-game score, stated 2026-08-29:
 *
 *     sharePar = (a team's share of the total weight owned at game end)
 *              x (the number of teams competing)
 *
 * par 1, commensurate across team counts, and CONTINUOUS IN THE WEIGHT MARGIN.
 * So a mutual final wipe is not a binary win or a binary loss. **It banks the
 * previous turn's position**, and it is worth more the further ahead we were.
 *
 * This evaluator's terminal clamps are ORDERED — our own elimination is read
 * before anyone else's — and that ordering was calibrated against blunder
 * attribution rather than against the rules (`calibration.ts` fact 2: optimality
 * 78.9% -> 81.3%, blunders 4.4% -> 3.1%). It is right about every ordinary trade
 * and wrong about exactly one position: the mutual final wipe. There it prices
 * the lattice bottom — a total loss — for a world whose real value is whatever
 * share we were holding a turn earlier, and it is most wrong when that share is
 * largest.
 *
 * This module is the repair, and it is ALWAYS ON. It was built behind
 * `CENTAUR_MUTUAL_WIPE_AWARD`; the owner's ruling of 2026-08-29 removed the
 * flag system and named this one explicitly — *"aren't you talking about a
 * correction to previously wrong logic here?"* A correction to logic that did
 * not match the rules is not a strategy alternative and has no off-arm to
 * measure: the shipped clamp priced a mutual final wipe at the lattice bottom,
 * the rules bank the previous turn's position, and one of those two is wrong.
 *
 * WHAT SURVIVED THE FLAG, AND WHY IT IS NOT ONE. The four guards below stay
 * exactly where they were. They are not a gate on the correction — they are
 * PART of it: each one is a refusal to price a world whose inputs are not
 * exact, and each errs toward the shipped `DEAD`. The strict-lead guard and the
 * fully-observed guard are the two that matter, and the header's own argument
 * for them ("the direction to be wrong in") is a soundness argument, not a
 * rollout argument.
 *
 * ── THE VALUE, AND WHY IT IS DENOMINATED THE WAY IT IS ─────────────────────
 *
 * The award prices the wiped world at the SUBJECT-FRAME MATERIAL FOLD OF THE
 * PREVIOUS COMMITTED TURN'S BOARD, in the evaluator's own currency:
 *
 *     V = w_material x (our previous-turn weight - every rival's, summed)
 *
 * That is the same quantity `materialFeature` computes, read off the board the
 * game is about to score instead of the resolved board where every team is at
 * zero. It says the plain thing: **a mutual wipe is worth exactly what the
 * position was worth materially the moment before**, which is what the rules
 * say happens.
 *
 * It is the previous-turn share, expressed in the currency the rest of the fold
 * speaks. Within one decision the previous board is FIXED, so with `total` its
 * total weight and `n` the team count,
 *
 *     V / w_material = 2 x ourWeight - total = total x (2 x sharePar / n - 1)
 *
 * — an increasing affine function of `sharePar`. So ordering candidate plans by
 * V and ordering them by the owner's metric are the same ordering, and no
 * second scale is introduced. THE BOUNDARY, stated rather than hidden: the two
 * are only affine-equivalent WITHIN a decision, and on a board of three or more
 * teams the subject-frame fold is not itself a share (holding 6 against rivals
 * on 5 and 5 is above par at 1.125 and negative as a differential). That gap is
 * a property of `materialFeature`, which is subject-frame everywhere and always
 * has been; this module inherits it deliberately rather than inventing a second
 * currency the rest of the fold could not be compared against.
 *
 * A finite terminal value is a departure from `calibration.ts` fact 3 — "DEAD is
 * a lattice bottom, never a scalar on the heuristic scale", whose reason is that
 * a scalar makes terminal states tradeable against material. Under the owner's
 * continuous metric that is exactly what a mutual wipe IS. The cliff is
 * untouched everywhere it was actually protecting something: dying while
 * anyone else survives is still `DEAD`, still a lattice bottom, still not
 * tradeable. Only the all-teams-gone branch becomes a number.
 *
 * ── THE CONSERVATIVE BOUNDARY, AND WHY IT IS DRAWN HERE ────────────────────
 *
 * The award fires only when all four of these hold. Each one is a refusal, and
 * each refusal costs at most a value we decline to see:
 *
 *  1. **We strictly lead.** Our total weight on the previous board must be
 *     STRICTLY greater than every other team's. Under a continuous metric this
 *     guard is deliberately stricter than the metric needs — a wipe while level
 *     or behind also has a real, finite value, and refusing it leaves `DEAD`
 *     standing, which is PESSIMISTIC: the flag can decline a trade it should
 *     have taken, and can never take one it should have declined. That is the
 *     direction to be wrong in, and it is why the guard stays where the binary
 *     reading put it.
 *  2. **The board is fully observed.** Any unit with `staleness > 0` refuses
 *     the whole award. The previous board's weights are the input to the value,
 *     and a unit we have not seen this turn may have eaten, grown, severed or
 *     been severed since. There is no sound pessimistic weight for it — a
 *     piece's stack can grow by more than one in a turn — so the honest move is
 *     to decline rather than to guess a bound. It also makes V EXACT: a
 *     constant of the decision, identical in both readings, which is what keeps
 *     the case analysis below valid. Under the harness and under the centaur's
 *     live Firebase feed the board IS fully observed every turn, so this
 *     refuses nothing in the regimes we measure in; it refuses in exactly the
 *     regime where the answer would be a guess.
 *  3. **There is somebody to beat.** A single-team board has no rule to apply.
 *  4. **Our own weight is positive.** A team with no weight on the previous
 *     board was not alive on it, and the branch does not apply to it.
 *
 * ── HOW IT KEEPS R1-R3 ─────────────────────────────────────────────────────
 *
 * Write S_w, S_b for `subjectGone` in the worst and best readings and O_w, O_b
 * for `othersGone`. The readings are nested — ours contingent-dead and theirs
 * contingent-alive in the worst, the mirror in the best — so S_b => S_w and
 * O_w => O_b. With the award firing, the clamps become
 *
 *     lo = S_w ? (O_w ? V : DEAD) : (O_w ? WIN : total.lo)
 *     hi = S_b ? (O_b ? V : DEAD) : (O_b ? WIN : total.hi)
 *
 * **R1 SOUNDNESS.** `lo = V` is claimed under S_w and O_w. O_w is every rival
 * gone even in the reading that keeps all their contingent units alive, so they
 * are gone in every consistent world; our own contingent units may live or die,
 * so the world is either "we survive, alone" (worth `WIN`, since every rival
 * holds nothing and our share is the whole board) or "we die with them" (worth
 * V). V is the minimum of those two, so it is a sound floor. `hi = V` is
 * claimed under S_b and O_b: we are certainly gone, so the world is either the
 * wipe (V) or "we alone are gone" (`DEAD`), and V is the maximum of those — a
 * sound AND TIGHT ceiling, which is the part a binary `WIN` could not give.
 * `DEAD` survives at `hi` only when S_b and not O_b: certainly gone, somebody
 * else certainly not, a loss in every consistent world.
 *
 * **R2 MONOTONICITY.** V does not move under refinement (it reads only the
 * previous board), so refining can only move S and O, and each moves one way.
 * `[DEAD, V]` — we certainly gone, rivals maybe — narrows to `[V, V]` when they
 * turn out gone and to `[DEAD, DEAD]` when they do not. Both are subintervals.
 *
 * **R3 COLLAPSE.** One world means worst === best, so S_w = S_b and O_w = O_b
 * and the two expressions above are the same expression: lo === hi in all five
 * reachable combinations.
 *
 * **NON-INVERSION.** `lo = V` requires O_w, which implies O_b, so `hi` is
 * either V (when S_b) or `WIN` (when not) — and V <= WIN. `lo = DEAD` is below
 * everything. `lo = total.lo` requires not-S_w, hence not-S_b, so `hi` is
 * `WIN` or `total.hi`. `clampTo` never sees an inverted interval.
 *
 * ── WHAT IT COSTS WHEN IT IS WRONG ─────────────────────────────────────────
 *
 * If the weights read off the previous board are wrong, the evaluator prices a
 * loss above the bottom and may walk into it. That is why the guards above are
 * refusals rather than approximations. The event is also RARE: mutual final
 * wipes are 0.076% of the simulation corpus (10 of 13,245 games), so the
 * blast radius of the correction is small and its counters
 * (`MutualWipeReport`) are how a replay says whether it fired at all.
 */

import { EngineSubstrate } from '../substrate';

// ---------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/** Why an award was refused, or `'awarded'`. Telemetry; nothing branches on it. */
export type MutualWipeVerdict =
  | 'awarded'
  | 'no-rivals'
  | 'stale-board'
  | 'no-weight'
  | 'not-ahead';

/**
 * The award, and what the wiped world is worth if it fires.
 *
 * `differential` is the SUBJECT-FRAME material fold of the previous committed
 * turn's board — our weight minus every rival's, summed — in raw weight units,
 * exactly as `materialBounds` folds the resolved board. `finish` multiplies it
 * by the profile's `material` weight to land on the fold's own scale. It is
 * `null` on every refusal, so a caller cannot accidentally price a world the
 * guards declined.
 *
 * Also carried, and used by nothing but the telemetry and the tests:
 * `sharePar`, the owner's metric on that same board — our share of its total
 * weight times the number of teams on it, par 1. It is here so an arm can be
 * read in the currency the program is scored in without recovering the board,
 * and so the affine identity in the header is checkable rather than asserted.
 */
export interface MutualWipeAward {
  readonly verdict: MutualWipeVerdict;
  /** Subject-frame previous-turn differential, in weight units. Null if refused. */
  readonly differential: number | null;
  /**
   * The owner's metric on the previous board: share x teams, par 1.
   *
   * `teams` here is the teams still HOLDING WEIGHT on that board, because that
   * is all a roster of live units can see — a team eliminated on an earlier
   * turn is not on it. The game counts every team that ever played and scores
   * the dead ones zero, so this reads high by that factor whenever somebody
   * died earlier. Telemetry only: nothing prices a world off this number, and
   * `differential` — which is unaffected, being a plain sum — is what does.
   */
  readonly sharePar: number | null;
}

/**
 * Does the previous committed turn's board award us a mutual wipe, and at what?
 *
 * The previous committed turn IS the board this decision is being made on: the
 * resolution being evaluated is the turn about to be played, so the board it
 * starts from is the last turn the game committed. That is the same board
 * `TeamSnekProcessor` rebuilds, read through the substrate's roster.
 */
export function mutualWipeVerdict(sub: EngineSubstrate, asTeam: number): MutualWipeAward {
  const refuse = (verdict: MutualWipeVerdict): MutualWipeAward => ({
    verdict,
    differential: null,
    sharePar: null,
  });
  let ours = 0;
  const theirs = new Map<number, number>();
  for (const u of sub.roster()) {
    // Guard 2: any unobserved unit refuses the whole award. See the header —
    // there is no sound pessimistic weight for a unit we have not seen, and a
    // guessed one would make the value inexact, which the case analysis needs.
    if (u.staleness > 0) return refuse('stale-board');
    if (u.team === asTeam) ours += u.weight;
    else theirs.set(u.team, (theirs.get(u.team) ?? 0) + u.weight);
  }
  if (theirs.size === 0) return refuse('no-rivals'); // Guard 3.
  if (ours <= 0) return refuse('no-weight'); // Guard 4.
  let rivals = 0;
  for (const w of theirs.values()) {
    if (w >= ours) return refuse('not-ahead'); // Guard 1: STRICTLY ahead of everyone.
    rivals += w;
  }
  const total = ours + rivals;
  return {
    verdict: 'awarded',
    differential: ours - rivals,
    // `total > 0` is guaranteed by guard 4, but the guard and the division are
    // in different functions' worth of code apart, so it is checked here too.
    sharePar: total > 0 ? ((theirs.size + 1) * ours) / total : 1,
  };
}

// ---------------------------------------------------------------------------
// Telemetry — per decision, on the substrate, exactly as the refiner does it
// ---------------------------------------------------------------------------

/**
 * What the award did this decision.
 *
 * `awarded` is the ENGAGEMENT counter, and it is the only one that matters for
 * reading an arm: a mutual final wipe is a 0.076% event, so an arm that carries
 * the flag and never reached the branch is indistinguishable from a null unless
 * this number is on the row. `reached` counts the evaluations that got as far
 * as a mutual-wipe world at all; `refused` splits by why.
 */
export interface MutualWipeReport {
  /** Evaluations whose clamp consulted the award (a mutual-wipe world). */
  readonly reached: number;
  /** Of those, the ones the previous board awarded to us. */
  readonly awarded: number;
  /** Of those, the ones refused, by guard. */
  readonly refusedNotAhead: number;
  readonly refusedStale: number;
  readonly refusedNoRivals: number;
  readonly refusedNoWeight: number;
  /** Clamp endpoints this award actually MOVED off `DEAD`. */
  readonly movedLo: number;
  readonly movedHi: number;
}

export class MutualWipeCounters {
  reached = 0;
  awarded = 0;
  refusedNotAhead = 0;
  refusedStale = 0;
  refusedNoRivals = 0;
  refusedNoWeight = 0;
  movedLo = 0;
  movedHi = 0;

  record(award: MutualWipeAward): number | null {
    this.reached += 1;
    switch (award.verdict) {
      case 'awarded':
        this.awarded += 1;
        return award.differential;
      case 'not-ahead':
        this.refusedNotAhead += 1;
        return null;
      case 'stale-board':
        this.refusedStale += 1;
        return null;
      case 'no-rivals':
        this.refusedNoRivals += 1;
        return null;
      default:
        this.refusedNoWeight += 1;
        return null;
    }
  }

  report(): MutualWipeReport {
    return {
      reached: this.reached,
      awarded: this.awarded,
      refusedNotAhead: this.refusedNotAhead,
      refusedStale: this.refusedStale,
      refusedNoRivals: this.refusedNoRivals,
      refusedNoWeight: this.refusedNoWeight,
      movedLo: this.movedLo,
      movedHi: this.movedHi,
    };
  }
}

const counters = new WeakMap<EngineSubstrate, MutualWipeCounters>();
const awards = new WeakMap<EngineSubstrate, Map<number, MutualWipeAward>>();

/**
 * THE ONE ENTRY POINT THE CLAMP CALLS.
 *
 * Returns what a mutual wipe is worth on the fold's own scale, or `null` when a
 * guard refused — and `null` is what makes the clamp collapse to the expression
 * that shipped, which is still the answer on every board the guards decline.
 *
 * Called only from a world in which we and everyone else are gone together, so
 * the roster walk sits behind a branch an ordinary evaluation never takes: on
 * a decision that never reaches a mutual-wipe world nothing here runs, no
 * counters are allocated, and `mutualWipeReportOf` stays null.
 *
 * The award itself is memoized per (substrate, team): the previous committed
 * turn's board is fixed for the whole decision, so the roster walk happens once
 * however many plans reach a mutual wipe, and — the part the bounds laws need —
 * every plan and every reading gets the SAME value. The COUNTERS are not
 * memoized; they count evaluations, which is what an engagement row has to be.
 */
export function mutualWipeAwardFor(
  sub: EngineSubstrate,
  asTeam: number,
  materialWeight: number
): number | null {
  let byTeam = awards.get(sub);
  if (byTeam === undefined) {
    byTeam = new Map();
    awards.set(sub, byTeam);
  }
  let award = byTeam.get(asTeam);
  if (award === undefined) {
    award = mutualWipeVerdict(sub, asTeam);
    byTeam.set(asTeam, award);
  }
  const differential = mutualWipeCountersFor(sub).record(award);
  return differential === null ? null : differential * materialWeight;
}

export function mutualWipeCountersFor(sub: EngineSubstrate): MutualWipeCounters {
  let c = counters.get(sub);
  if (c === undefined) {
    c = new MutualWipeCounters();
    counters.set(sub, c);
  }
  return c;
}

/**
 * This decision's award telemetry, or null when no evaluation ever reached a
 * mutual-wipe world — which, at a 0.076% base rate for that end kind, is most
 * decisions. Null and not zero: a counter a decision never had did not read
 * zero, and P5 is the exhibit for why that distinction has to survive to the
 * manifest.
 */
export function mutualWipeReportOf(sub: EngineSubstrate): MutualWipeReport | null {
  const c = counters.get(sub);
  return c === undefined ? null : c.report();
}
