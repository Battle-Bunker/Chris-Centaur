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


import type { EvalContext, Standing } from './features';
import type { EngineSubstrate } from '../substrate';
import { adjudicate, type BoardView } from '../../engine-vendor/engine/adjudicate';
import { perBoard } from './memo';

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
 * ── ONE ENCODING, READ TWICE ───────────────────────────────────────────────
 *
 * The rule already exists exactly once, in `engine/adjudicate`, and the receipts
 * for writing it a second time are on file: it lived in the server, the harness
 * and the bot, disagreed three ways, and the bot priced a winning mutual trade
 * as a flat loss and therefore refused winning trades. So this member does not
 * decide anything. It builds the two board views the evaluator ALREADY brackets
 * — the subject's worst world and its best — and asks the engine, with the
 * board's own `maxTurns` (already `resolveMaxTurns`d at marshalling) and the
 * arrival turn every contest is adjudicated at.
 *
 * Monotone, so the two answers really are endpoints: our units at their minimum
 * weight and alive only where the worst world keeps them, theirs at maximum and
 * alive wherever they might be, is a board on which we can only do worse than
 * on the real one; the best world is the dual. The conjunction is the same
 * rectangular relaxation the bounds layer takes everywhere else — never
 * optimistic, only imprecise.
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

/** Occupancy stand-ins by length: `weighTeams` reads `pieces[id].length` and
 *  nothing else, and only a board AT the cap ever builds one. */
const weightArrays: ReadonlyArray<number>[] = [];
function ofWeight(n: number): ReadonlyArray<number> {
  const hit = weightArrays[n];
  if (hit !== undefined) return hit;
  const made = Object.freeze(new Array<number>(Math.max(0, n)).fill(0));
  weightArrays[n] = made;
  return made;
}

/** `unitID → teamID`, per substrate family — the map `adjudicate` weighs by,
 *  and it must name EVERY configured unit so a wiped team weighs 0 rather than
 *  going missing. */
const teamMaps = new WeakMap<EngineSubstrate, { readonly [unitID: string]: string }>();
function teamOfAll(sub: EngineSubstrate): { readonly [unitID: string]: string } {
  return perBoard(teamMaps, sub, () => {
    const made: { [unitID: string]: string } = {};
    for (const u of sub.roster()) made[u.wireId] = u.teamId;
    return made;
  });
}

function viewOf(
  ctx: EvalContext,
  alive: (s: Standing) => boolean,
  weightOf: (s: Standing) => number
): BoardView {
  const standing: string[] = [];
  const pieces: { [unitID: string]: ReadonlyArray<number> } = {};
  for (const s of ctx.standing) {
    if (!alive(s)) continue;
    const wireId = ctx.sub.unitOf(s.unitId)?.wireId;
    if (wireId === undefined) continue;
    standing.push(wireId);
    pieces[wireId] = ofWeight(weightOf(s));
  }
  return { alive: standing, pieces };
}

function capOf(ctx: EvalContext, view: BoardView, limit: number): TerminalCap {
  const outcome = adjudicate(
    view,
    undefined,
    teamOfAll(ctx.sub),
    ctx.sub.arrivalTurn,
    limit
  );
  // ONLY the branch this member owns. Elimination is `terminalVerdicts`'s, in
  // both worlds, and saying it twice is how a rule starts disagreeing with
  // itself.
  if (outcome.kind !== 'turn-limit') return 'none';
  const us = ctx.sub.teamLabel(ctx.asTeam);
  if (us === undefined) return 'none';
  if (!outcome.winners.includes(us)) return 'loss';
  return outcome.winners.length === 1 ? 'win' : 'draw';
}

/**
 * The turn cap's verdict in each of the two worlds, or `none` in both when the
 * board is not at the limit.
 *
 * ONE COMPARISON in the overwhelmingly common case: a game that is not at its
 * last turn cannot end on the count, so nothing is built and nothing is
 * adjudicated. The evaluator runs tens of thousands of times per decision and
 * this member must cost nothing on every board but the last one.
 */
export function capVerdicts(ctx: EvalContext): {
  worst: TerminalCap;
  best: TerminalCap;
} {
  const limit = ctx.sub.marshalled.maxTurns;
  if (limit === null || ctx.sub.arrivalTurn < limit) return NO_CAP;
  return {
    // The subject's WORST world: ours at their lightest and only where the
    // worst world keeps them, theirs at their heaviest and wherever they might
    // still be. The `Standing` flags are already subject-framed, which is why
    // `terminalVerdicts` reads the same pair for elimination.
    worst: capOf(
      ctx,
      viewOf(
        ctx,
        (s) => s.worstAlive,
        (s) => (s.team === ctx.asTeam ? s.weightMin : s.weightMax)
      ),
      limit
    ),
    best: capOf(
      ctx,
      viewOf(
        ctx,
        (s) => s.bestAlive,
        (s) => (s.team === ctx.asTeam ? s.weightMax : s.weightMin)
      ),
      limit
    ),
  };
}

const NO_CAP: { worst: TerminalCap; best: TerminalCap } = { worst: 'none', best: 'none' };

