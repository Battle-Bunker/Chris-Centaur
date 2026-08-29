/**
 * THE MUTUAL-WIPE AWARD — the game's own rule for a game that ends with
 * everybody dead, behind a flag, off by default.
 *
 * ── WHAT THE RULES SAY, AND WHAT THIS EVALUATOR SAID INSTEAD ───────────────
 *
 * TacticToes settles a game in which every remaining team dies on the SAME turn
 * from the PREVIOUS COMMITTED TURN's board
 * (`TeamSnekProcessor.calculatePreviousTurnTeamOutcome`): the team alive there
 * wins if it is the only one, otherwise the highest total weight on that board
 * wins, and an exact tie there is a draw in which every tied team is paid as a
 * winner. So **a team ahead on weight that trades its last units for the last
 * units of everyone else WINS.**
 *
 * This evaluator's terminal clamps are ORDERED — our own elimination is read
 * before anyone else's — and that ordering was calibrated against blunder
 * attribution rather than against the rules (`calibration.ts` fact 2: optimality
 * 78.9% → 81.3%, blunders 4.4% → 3.1%). It is right about every ordinary trade
 * and wrong about exactly one position: the mutual final wipe. There the
 * evaluator prices a WIN as the lattice bottom and refuses it, and it refuses it
 * hardest when we are ahead, which is precisely when the option arises.
 *
 * This module is the repair, gated on `CENTAUR_MUTUAL_WIPE_AWARD` and DARK by
 * default. With the flag off `awardsMutualWipe` is never called and `finish`'s
 * two clamp expressions collapse, term for term, to the ones that shipped.
 *
 * ── THE CONSERVATIVE BOUNDARY, AND WHY IT IS DRAWN HERE ────────────────────
 *
 * The award fires only when all four of these hold. Each one is a refusal, and
 * each refusal costs at most a win we decline to see:
 *
 *  1. **We strictly lead.** Our total weight on the previous board must be
 *     STRICTLY greater than every other team's. TacticToes pays a tie as a
 *     joint win — every tied team is a `Winner` and places first — so refusing
 *     the tie gives up real value. It is refused anyway: a tie is the position
 *     where a one-square error in either direction flips the verdict, and the
 *     whole point of this flag is that it may not manufacture a win.
 *  2. **The board is fully observed.** Any unit with `staleness > 0` refuses
 *     the whole award. The previous board's weights are the input to the rule,
 *     and a unit we have not seen this turn may have eaten, grown, severed or
 *     been severed since. There is no sound pessimistic weight for it — a
 *     piece's stack can grow by more than one in a turn — so the honest move is
 *     to decline rather than to guess a bound. Under the harness and under the
 *     centaur's live Firebase feed the board IS fully observed every turn, so
 *     this refuses nothing in the regimes we measure in; it refuses in exactly
 *     the regime where the answer would be a guess.
 *  3. **There is somebody to beat.** A single-team board has no rule to apply.
 *  4. **Our own weight is positive.** A team with no weight on the previous
 *     board was not alive on it, and the branch does not apply to it.
 *
 * The reading itself is FOG-PESSIMISTIC in the sense the bounds laws care
 * about: `awardsMutualWipe` is a function of the PREVIOUS board alone. It does
 * not read the resolution, it does not read `worstAlive`/`bestAlive`, and it
 * therefore returns the same answer in the worst reading and the best. That is
 * what keeps the clamp's case analysis valid — see `finish`.
 *
 * ── HOW IT KEEPS R1-R3 ─────────────────────────────────────────────────────
 *
 * Write S_w, S_b for `subjectGone` in the worst and best readings and O_w, O_b
 * for `othersGone`. The readings are nested — ours contingent-dead and theirs
 * contingent-alive in the worst, the mirror in the best — so S_b ⇒ S_w and
 * O_w ⇒ O_b. With `award` true the clamps become
 *
 *     lo = S_w ? (O_w ? WIN : DEAD) : (O_w ? WIN : total.lo)
 *     hi = S_b ? (O_b ? WIN : DEAD) : (O_b ? WIN : total.hi)
 *
 * **R1 SOUNDNESS.** `lo = WIN` is claimed only when O_w — every other team is
 * gone even in the reading that keeps all of their contingent units alive, so
 * they are gone in every consistent world. Then either we survive (last team
 * standing: a win) or we die with them (a mutual wipe we lead: a win). Every
 * consistent world is a win, so WIN is a sound floor. `hi = WIN` is claimed
 * when O_b — a world in which everyone else is gone is consistent — and WIN is
 * the lattice top, so it is sound as a ceiling wherever it is claimed. `DEAD`
 * survives at `hi` only when S_b and not O_b: we are certainly gone and
 * somebody else is certainly not, which is a loss in every consistent world.
 *
 * **R2 MONOTONICITY.** `award` does not move under refinement (it reads only
 * the previous board), so refining can only move S and O, and each of them
 * moves one way: refinement turns maybe-gone into gone-or-not without ever
 * widening the pair. `[DEAD, WIN]` (we certainly gone, others maybe gone)
 * narrows to `[WIN, WIN]` when they turn out gone and to `[DEAD, DEAD]` when
 * they do not. Both are subintervals.
 *
 * **R3 COLLAPSE.** One world means worst === best, so S_w = S_b and O_w = O_b
 * and the two expressions above are the same expression: lo === hi in all five
 * reachable combinations.
 *
 * **NON-INVERSION.** `lo = WIN` requires O_w, which implies O_b, which forces
 * `hi = WIN` down both of its branches. So `lo = WIN ⇒ hi = WIN`, and `clampTo`
 * never sees an inverted interval. This is the same argument the flag-off code
 * makes, with `othersGone` promoted above `subjectGone` instead of below it.
 *
 * ── WHAT THE FLAG COSTS WHEN IT IS WRONG ───────────────────────────────────
 *
 * If the lead read off the previous board is wrong, the evaluator prices a loss
 * as a win and will walk into it — which is the worst failure this codebase has
 * a name for. That is why the guards above are refusals rather than
 * approximations, and why the flag is dark. The event is also RARE: mutual
 * final wipes are 0.076% of the simulation corpus (10 of 13,245 games), so the
 * flag's whole expected effect on a placement column is under a tenth of a
 * percent of games. It is a correctness repair with an audit trail, not a lever.
 */

import { EngineSubstrate } from '../substrate';

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

export const MUTUAL_WIPE_AWARD_ENV = 'CENTAUR_MUTUAL_WIPE_AWARD';

/**
 * DEFAULT OFF. With it off nothing in this module is called: `finish` guards
 * every use behind this predicate, and its clamp expressions reduce term for
 * term to the ones that shipped.
 */
export function mutualWipeAwardFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env[MUTUAL_WIPE_AWARD_ENV];
  return raw === '1' || raw === 'on' || raw === 'true';
}

export function mutualWipeAwardEnabled(): boolean {
  return mutualWipeAwardFrom(process.env);
}

// ---------------------------------------------------------------------------
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
 * Does the previous committed turn's board award us a mutual wipe?
 *
 * The previous committed turn IS the board this decision is being made on: the
 * resolution being evaluated is the turn about to be played, so the board it
 * starts from is the last turn the game committed. That is the same board
 * `TeamSnekProcessor` rebuilds, read through the substrate's roster.
 */
export function mutualWipeVerdict(sub: EngineSubstrate, asTeam: number): MutualWipeVerdict {
  let ours = 0;
  const theirs = new Map<number, number>();
  for (const u of sub.roster()) {
    // Guard 2: any unobserved unit refuses the whole award. See the header —
    // there is no sound pessimistic weight for a unit we have not seen.
    if (u.staleness > 0) return 'stale-board';
    if (u.team === asTeam) ours += u.weight;
    else theirs.set(u.team, (theirs.get(u.team) ?? 0) + u.weight);
  }
  if (theirs.size === 0) return 'no-rivals'; // Guard 3.
  if (ours <= 0) return 'no-weight'; // Guard 4.
  for (const w of theirs.values()) {
    if (w >= ours) return 'not-ahead'; // Guard 1: STRICTLY ahead of everyone.
  }
  return 'awarded';
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

  record(verdict: MutualWipeVerdict): boolean {
    this.reached += 1;
    switch (verdict) {
      case 'awarded':
        this.awarded += 1;
        return true;
      case 'not-ahead':
        this.refusedNotAhead += 1;
        return false;
      case 'stale-board':
        this.refusedStale += 1;
        return false;
      case 'no-rivals':
        this.refusedNoRivals += 1;
        return false;
      default:
        this.refusedNoWeight += 1;
        return false;
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
const verdicts = new WeakMap<EngineSubstrate, Map<number, MutualWipeVerdict>>();

/**
 * THE ONE ENTRY POINT THE CLAMP CALLS, and the whole of the dark gate.
 *
 * Called only from a world in which we and everyone else are gone together, so
 * the environment read and the roster walk sit behind a branch an ordinary
 * evaluation never takes. With the flag off this returns false before touching
 * anything, no counters are allocated, and `mutualWipeReportOf` stays null —
 * which is what makes "flag off" byte-identical rather than merely equivalent.
 *
 * The verdict itself is memoized per (substrate, team): the previous committed
 * turn's board is fixed for the whole decision, so the roster walk happens once
 * however many plans reach a mutual wipe. The COUNTERS are not memoized — they
 * count evaluations, which is what an engagement row has to be.
 */
export function mutualWipeAwardFor(sub: EngineSubstrate, asTeam: number): boolean {
  if (!mutualWipeAwardEnabled()) return false;
  let byTeam = verdicts.get(sub);
  if (byTeam === undefined) {
    byTeam = new Map();
    verdicts.set(sub, byTeam);
  }
  let verdict = byTeam.get(asTeam);
  if (verdict === undefined) {
    verdict = mutualWipeVerdict(sub, asTeam);
    byTeam.set(asTeam, verdict);
  }
  return mutualWipeCountersFor(sub).record(verdict);
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
 * This decision's award telemetry, or null when the flag never reached a
 * mutual-wipe world — which, off the flag, is always. Null and not zero: a
 * counter a decision never had did not read zero, and P5 is the exhibit for
 * why that distinction has to survive to the manifest.
 */
export function mutualWipeReportOf(sub: EngineSubstrate): MutualWipeReport | null {
  const c = counters.get(sub);
  return c === undefined ? null : c.report();
}
