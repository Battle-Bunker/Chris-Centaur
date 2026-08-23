/**
 * Minimal repro driver for decision failures the h2h harness captured.
 *
 *   node .bench-dist/bench/prod/repro.js <failures.json> [index]
 *
 * Replays one captured board through the same door the team engine uses, and
 * — when the failure is a bank bracket inversion — prices the rung-0 plan
 * directly so the offending member report is visible rather than inferred.
 *
 * It also runs the same board with every snake's DUPLICATED TAIL CELL removed,
 * because a grown snake's occupancy legitimately repeats its tail and that is
 * the one structural difference between these boards and the hand-built
 * fixtures the lane suites use.
 */

import * as fs from 'fs';
import type { Board, Snake } from '../../src/types/battlesnake';
import { TeamDetector } from '../../src/logic/team-detector';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import { BoundBank, DEFAULT_BANK_CONFIG } from '../../src/lobster/bounds/bank';
import type { BankConfig } from '../../src/lobster/bounds/bank';
import type { JointPlan } from '../../src/lobster/contracts';
import { lobsterDriver } from './drivers';
import { truthOf } from './truth';

interface Failure {
  side: string;
  turn: number;
  error: string;
  board: Board;
}

/** Drop repeated occupancy cells (a grown snake repeats its tail). */
function dedupeTails(board: Board): Board {
  return {
    ...board,
    snakes: (board.snakes ?? []).map((s) => {
      if (s.unitType !== undefined && s.unitType !== 'snake') return s;
      const seen = new Set<string>();
      const body = s.body.filter((c) => {
        const k = `${c.x},${c.y}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { ...s, body, length: body.length } as Snake;
    }),
  };
}

/** Price the rung-0 plan under one bank configuration, and name the truth. */
function priceRungZero(board: Board, turn: number, teamID: string, cfg: Partial<BankConfig> = {}): string {
  const ourIds = (board.snakes ?? [])
    .filter((s) => TeamDetector.getTeamKey(s) === teamID)
    .map((s) => s.id);
  const sub = makeSubstrate({ board, turn, asTeam: teamID, modeled: ourIds });
  try {
    const asTeam = sub.teamNumber(teamID);
    const gen = new GrammarCandidateGenerator();
    const core = makeSearchCore();
    const budget = {
      shouldStop: () => false,
      remainingMs: () => 1e9,
      elapsedMs: () => 0,
      now: () => Date.now(),
    };
    const ctx = {
      sub,
      gen,
      evaluate: materialEvaluator,
      asTeam,
      pins: [],
      incumbent: null,
      witnesses: [],
      assumptions: [],
      budget,
    } as unknown as Parameters<typeof core.conform>[0];
    let plan: JointPlan;
    try {
      plan = core.conform(ctx, new Map());
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return `conform threw: ${e.message} [${e.code}]`;
    }
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: materialEvaluator,
      asTeam,
      budget,
      basis: [],
      config: { ...DEFAULT_BANK_CONFIG, ...cfg },
    });
    // The exhaustive truth of the SAME plan, from the R1 machinery.
    const orders = new Map<string, number>();
    for (const [unitId, cand] of plan) {
      const u = sub.unitOf(unitId);
      if (u !== undefined) orders.set(u.wireId, cand.to);
    }
    const truth = truthOf(board, turn, teamID, orders, materialEvaluator);
    const truthNote = `truth=[${truth.lo}, ${truth.hi}] over ${truth.worlds} worlds${truth.truncated ? ' (TRUNCATED)' : ''}`;
    try {
      const priced = bank.price(plan);
      const sound =
        priced.bounds.worst <= truth.lo + 1e-6 && priced.bounds.best >= truth.hi - 1e-6
          ? 'SOUND'
          : 'UNSOUND';
      return `priced [${priced.bounds.worst}, ${priced.bounds.best}] ${sound} vs ${truthNote} members=${JSON.stringify(
        priced.members
      )}`;
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return `price threw: ${e.message} [${e.code}] ; ${truthNote}`;
    } finally {
      bank.release();
    }
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

async function main(): Promise<void> {
  const file = process.argv[2] as string;
  const only = process.argv[3] === undefined ? null : Number(process.argv[3]);
  const failures = JSON.parse(fs.readFileSync(file, 'utf8')) as Failure[];
  const seen = new Set<string>();
  for (let i = 0; i < failures.length; i++) {
    if (only !== null && i !== only) continue;
    const f = failures[i] as Failure;
    if (only === null && seen.has(f.error)) continue;
    seen.add(f.error);
    const teams = [
      ...new Set((f.board.snakes ?? []).map((s) => TeamDetector.getTeamKey(s))),
    ].sort();
    console.log(`\n=== failure #${i}  ${f.side} turn ${f.turn}`);
    console.log(`    ${f.error}`);
    console.log(`    teams on board: ${teams.join(', ')}`);
    for (const s of f.board.snakes ?? []) {
      const cells = s.body.map((c) => `${c.x},${c.y}`).join(' ');
      const dupes = new Set(s.body.map((c) => `${c.x},${c.y}`)).size !== s.body.length;
      console.log(
        `      ${s.id} team=${s.teamID} type=${s.unitType ?? 'snake'} len=${s.length} hp=${s.health} ` +
          `cells=[${cells}]${dupes ? '  <-- REPEATED CELL' : ''}`
      );
    }
    for (const team of teams) {
      console.log(`    [${team}] full bank : ${priceRungZero(f.board, f.turn, team)}`);
      console.log(`    [${team}] B0 only   : ${priceRungZero(f.board, f.turn, team, { b1: false, b2: false, b3: false })}`);
      console.log(`    [${team}] B0+B1     : ${priceRungZero(f.board, f.turn, team, { b2: false, b3: false })}`);
      console.log(`    [${team}] B0 nogate : ${priceRungZero(f.board, f.turn, team, { b1: false, b2: false, b3: false, gateOnEntanglement: false })}`);
      const fixed = dedupeTails(f.board);
      console.log(`    [${team}] tails deduped, full bank: ${priceRungZero(fixed, f.turn, team)}`);
    }
    // And the full door, three times, to show it is not a timing artefact.
    for (let k = 0; k < 3; k++) {
      const drv = lobsterDriver();
      const out = await drv.decide(f.board, f.turn, teamOf(f), Date.now() + 400);
      drv.release();
      clearGeometryCache();
      console.log(
        `    decideTurn run ${k}: error=${out.error ?? 'none'} emissions=${out.emissions} moves=${out.moves.size}`
      );
    }
  }
}

function teamOf(f: Failure): string {
  // The failing side's team is the one whose decision threw; the harness does
  // not record it separately, so recover it from the board's team list by
  // trying each and reporting the one that reproduces.
  const teams = [...new Set((f.board.snakes ?? []).map((s) => TeamDetector.getTeamKey(s)))].sort();
  for (const t of teams) {
    if (priceRungZero(f.board, f.turn, t).includes('threw')) return t;
  }
  return teams[0] as string;
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
