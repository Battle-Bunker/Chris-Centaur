/**
 * model/terminal@1 — THE TURN CAP.
 *
 * Its own module, and not `closing.ts`, for a reason that is itself a rule this
 * repo holds: `closing.ts` carries a HELD feature (`approach`, at weight 1 in
 * its own profile) and a tripwire test asserting that no non-test module
 * imports it, so that the held feature cannot ship by accident. A boundary
 * correction is not a strategy knob and must not ride in on one.
 *
 * The member is one addressed object because that is what makes it checkable:
 * the terminal functional the bot evaluates toward and the functional the
 * harness measures by are the same thing, rather than two implementations and
 * one hope.
 */


import type { EvalContext } from './features';

/**
 * THE BOUNDARY IS NOT A PREFERENCE (06 F-7, 16-TERMINAL §2–3).
 *
 * The flow fold is defined only in the INTERIOR; it has no value at the
 * terminal step and must be supplied one rather than extrapolate. Half of that
 * supply was seated — `terminalVerdicts` reads elimination, in both worlds —
 * and the other half was not: `grep -rn 'maxTurns' src/lobster` returned three
 * hits, all of them the substrate passing the number THROUGH to the engine and
 * none of them the evaluator reading it. Every real game is played to a limit,
 * 100 by default, and the measured residual of the whole flow decomposition
 * sits entirely at the boundary carrying all of the game-length dependence
 * (corr +0.969; mean |gap| 0.0097 without an elimination against 0.1248 with
 * one). So a bot with no turn cap prices every line as if the game were
 * infinite, has no reason to prefer a shorter one, and — the check that costs
 * nothing to state — cannot decline a trade three turns from the cap that a
 * capless bot accepts, because nothing in it knows the game ends.
 *
 * That matters most exactly where depth does. Depth's only route to a LEVEL
 * change rather than a width change is the boundary (the interior fold is
 * potential-based and telescopes, so deepening cannot touch the path), and a
 * boundary with half its rule missing sends every level change into the
 * residual.
 *
 * ── ONE ENCODING, READ ONCE ────────────────────────────────────────────────
 *
 * The rule already exists exactly once, in `engine/adjudicate`, and the receipts
 * for writing it a second time are on file: it lived in the server, the harness
 * and the bot, disagreed three ways, and the bot priced a winning mutual trade
 * as a flat loss and therefore refused winning trades. So this member does not
 * decide anything, and it does not adjudicate a second board either: `settlePartial`
 * already brackets the turn's ending — `ctx.resolution.outcome`, an
 * `OutcomeBracket` (`engine/settlePartial.ts`) — over EVERY world the held units
 * could have chosen, proved by enumeration rather than picked by a caller's own
 * pair of extremes. This member reads that bracket; it does not rebuild one.
 *
 * `certain` is the settlement's own reduction when every world agrees, kept as
 * is. When worlds disagree, `possibleWinners`/`certainWinners` are read only
 * while `possibleKinds` names turn-limit as the ONLY reachable ending here — the
 * one case in which those two sets are not also carrying an elimination
 * branch's winners, which is `terminalVerdicts`'s to read, not this member's.
 * `certainWinners.includes(us)` is `us`'s own worst-board win-or-tie, exactly —
 * the bracket's per-team floor-vs-rivals'-ceiling test worked out algebraically
 * to the same corner `viewOf` used to build by hand — and its dual,
 * `possibleWinners.includes(us)`, is the best-board's. See `capFrom` for the
 * one further step (win vs. tie) the exposed sets can, and cannot, still prove.
 *
 * ── WHAT IT DOES NOT CLAIM ─────────────────────────────────────────────────
 *
 * Only the `turn-limit` branch. Elimination is already clamped, in both worlds,
 * by `terminalVerdicts`, and reading it here too would be the second encoding
 * this member exists to refuse. And a DRAW is left alone: tied teams draw, a
 * draw is neither a win nor a loss, and replacing the interior value with
 * either lattice element would be the "mutual annihilation reads as a wash"
 * error running in the other direction.
 */
export type TerminalCap = 'none' | 'win' | 'loss' | 'draw';

/**
 * A verdict off one fully-resolved winners list — the settlement's own
 * `certain.winners`, or a bracket corner the comment below proves exact:
 * `us` excluded is a loss, `us` alone is a win, anything else is a tie.
 */
function capFrom(winners: ReadonlyArray<string>, us: string): TerminalCap {
  if (!winners.includes(us)) return 'loss';
  return winners.length === 1 ? 'win' : 'draw';
}

/**
 * The turn cap's verdict in each of the two worlds, or `none` in both when the
 * board is not at the limit.
 *
 * ONE COMPARISON in the overwhelmingly common case: a game that is not at its
 * last turn cannot end on the count, so nothing is read off the bracket at
 * all. The evaluator runs tens of thousands of times per decision and this
 * member must cost nothing on every board but the last one.
 */
export function capVerdicts(ctx: EvalContext): {
  worst: TerminalCap;
  best: TerminalCap;
} {
  const limit = ctx.sub.marshalled.maxTurns;
  if (limit === null || ctx.sub.arrivalTurn < limit) return NO_CAP;
  const us = ctx.sub.teamLabel(ctx.asTeam);
  if (us === undefined) return NO_CAP;

  // The settlement this evaluation is already scoring — `ctx.standing` is
  // folded from the very same object — carries its own ending, bracketed over
  // every world the held units could have chosen. Read it; do not rebuild it.
  const bracket = ctx.resolution.outcome;

  // EVERY WORLD AGREES. The settlement's own reduction, kept — `certain` is
  // set with `kind: "continues"` too, so a running game reaches here and is
  // turned away by the kind check below rather than by a coincidental null.
  if (bracket.certain !== null) {
    if (bracket.certain.kind !== 'turn-limit') return NO_CAP;
    const cap = capFrom(bracket.certain.winners, us);
    return { worst: cap, best: cap };
  }

  // WORLDS DISAGREE. `possibleWinners`/`certainWinners` are unioned/intersected
  // across EVERY reachable branch — a wipe or a last-team ending fireable
  // alongside turn-limit folds THAT branch's winners into the same two sets,
  // which is `terminalVerdicts`'s reading to make, not a second one made here
  // from the aggregate. So this member reads them only when turn-limit is the
  // one and only reachable ending at this settlement.
  if (bracket.possibleKinds.length !== 1 || bracket.possibleKinds[0] !== 'turn-limit') {
    return NO_CAP;
  }

  // THE TWO CORNERS, off the bracket's own per-team stakes rather than a
  // second adjudication. `certainWinners` is, per team, "wins or ties at its
  // own floor against every rival's ceiling" — which is `us`'s WORST-board
  // question exactly, because a team in `certainWinners` bounds EVERY rival's
  // ceiling at or under its own floor, and only a rival reaching that floor
  // can still appear anywhere in the winners sets. So once `us` is in
  // `certainWinners`, a SECOND team surfacing in `possibleWinners` can only be
  // one that reaches exactly `us`'s floor — a tie, not a separate win — which
  // makes `possibleWinners = { us }` alone the proof of a WORST-board sole win.
  //
  // `possibleWinners` is the dual for the BEST board (`us` at its own ceiling,
  // every rival at its own floor), but the matching proof does not carry over:
  // a third team's unrelated, unbounded ceiling can knock it out of
  // `certainWinners` while it still ties `us` at the BEST board's floor, so
  // this bracket cannot certify a sole win there from these two sets alone.
  // BOARD (2 teams, both fully modelled — no held units at all, so `certain`
  // is not null and this branch is never reached for it; the shape is the
  // same with a lone held claim on either side): us weightMin=5, weightMax=10;
  // them weightMin=1, weightMax=5, at the turn limit. `us` is a certain winner
  // (floor 5 ≥ their ceiling 5) and the BEST board ties at 5-vs-5 — a draw —
  // yet `possibleWinners` still contains `them` (their ceiling 5 ≥ our floor
  // 5), so `possibleWinners.length === 1` correctly withholds 'win'. Nothing
  // symmetric protects the reverse: a hidden third team's ceiling can make
  // `certainWinners.length === 1` true on a BEST-board tie. So `best` never
  // reports 'win' from this branch — a known, provably weaker reading than a
  // per-team floor/ceiling table would give, accepted rather than restated by
  // hand, because 'draw' and 'none' clamp identically in `finish` and the gap
  // costs nothing this repo's boards have been seen to reach at the cap.
  const worst: TerminalCap = !bracket.certainWinners.includes(us)
    ? 'loss'
    : bracket.possibleWinners.length === 1
      ? 'win'
      : 'draw';
  const best: TerminalCap = bracket.possibleWinners.includes(us) ? 'draw' : 'loss';
  return { worst, best };
}

const NO_CAP: { worst: TerminalCap; best: TerminalCap } = { worst: 'none', best: 'none' };

