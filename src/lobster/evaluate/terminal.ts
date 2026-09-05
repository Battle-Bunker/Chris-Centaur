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


import type { EndKind } from '../../engine-vendor/engine/adjudicate';

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
 * Anything before the cap. `arrivalTurn < limit` is the overwhelmingly common
 * board and costs one comparison; past it, the member reads whatever verdict
 * the settlement's bracket carries in every world that has ENDED (see `ended`
 * and the ENDGAME note in `capVerdicts`). It does not RE-adjudicate, and it
 * does not race `terminalVerdicts`: `finish` tests elimination first, so this
 * verdict is reached only where that one said nothing, and where both speak
 * they agree because both read the same `adjudicate`.
 *
 * And a DRAW is left alone: tied teams draw, a draw is neither a win nor a
 * loss, and replacing the interior value with either lattice element would be
 * the "mutual annihilation reads as a wash" error running in the other
 * direction.
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
 * HAS THE GAME STOPPED IN EVERY WORLD THE SETTLEMENT ADMITS?
 *
 * The one predicate the cap reads, and the whole of the ENDGAME rule. `kinds`
 * is `OutcomeBracket.possibleKinds` (or the singleton a `certain` reduction
 * carries): "continues" is the only member of `EndKind` that leaves a next
 * turn, so its absence is the proof that every branch of this settlement has
 * a verdict. Never empty by the bracket's own contract, and an empty list is
 * treated as "not ended" rather than vacuously ended.
 */
const ended = (kinds: ReadonlyArray<EndKind>): boolean =>
  kinds.length > 0 && !kinds.includes('continues');

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
  // turned away by the ENDED test rather than by a coincidental null.
  if (bracket.certain !== null) {
    if (!ended([bracket.certain.kind])) return NO_CAP;
    const cap = capFrom(bracket.certain.winners, us);
    return { worst: cap, best: cap };
  }

  // WORLDS DISAGREE, AND THE ONLY QUESTION THAT MATTERS IS WHETHER ANY OF THEM
  // GOES ON (the ENDGAME rule).
  //
  // This test used to be `possibleKinds === ['turn-limit']` — turn-limit and
  // nothing else — on the argument that a wipe or a last-team ending reachable
  // alongside it folds THAT branch's winners into the same two sets, and that
  // reading them here would be a second encoding of what `terminalVerdicts`
  // already reads. The argument is sound about DUPLICATION and wrong about
  // SOUNDNESS, and the second is the one the bank checks.
  //
  // THE DEFECT, measured. Past the cap the abstention leaves the interior fold
  // standing as a LOWER bound on a board that has ended. `mixed` seed 1 against
  // `material-only`, run to 120 turns: 16,510 `BoundsInversionError`s from turn
  // 100 on, 12,615 of them `bank floor=B0 ceiling=B2`, and the decision at turn
  // 104 died of one. The shape is always the same and it is this member's:
  //
  //     CAPABSTAIN turn=100 limit=100 us=blue kinds=["last-team","turn-limit"]
  //                certainW=[] possibleW=["red","blue","green"]
  //
  // B0's complete cover abstained here and kept an interior floor of -292; a B2
  // witness on the SAME plan resolved its one reply tuple, reached the branch
  // above with `certain.kind === "turn-limit"`, clamped to DEAD and certified a
  // ceiling of -Infinity. A complete floor above a sound ceiling is the fatal
  // bug class, and the bank throws rather than clamping it.
  //
  // THE RULE. At `arrivalTurn >= limit`, `adjudicate` cannot return "continues"
  // — `decide` emits it only when `reachedTurnLimit` is false — so EVERY
  // reachable branch here is a decided ending, and the bracket's two sets mean
  // exactly what the corners below need:
  //
  //   * `us` ∉ `certainWinners` ⇒ some reachable world does not have us
  //     winning or tying ⇒ in that world the game is over and we did not win
  //     ⇒ DEAD is a sound FLOOR. Which KIND of ending that world was does not
  //     enter the implication, which is why the kinds test can be dropped.
  //   * `us` ∉ `possibleWinners` ⇒ NO reachable world has us winning or tying
  //     ⇒ DEAD is a sound CEILING.
  //
  // So the gate is not "turn-limit alone" but "no world leaves the game
  // running", and the only thing it still refuses is the mixed bracket that
  // still contains `continues` — which cannot arise at the cap, and is refused
  // rather than assumed away.
  //
  // NOT a second encoding of `terminalVerdicts`: `finish` tests elimination
  // FIRST and this member's verdict is reached only where that one said
  // nothing. Where both speak they agree, because both are reading the same
  // adjudication.
  if (!ended(bracket.possibleKinds)) return NO_CAP;

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

