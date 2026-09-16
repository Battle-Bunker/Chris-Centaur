/**
 * THE GOTO PROBE — why a human `goto` is overruled, in numbers.
 *
 * A tool, not a test: nothing here asserts. It runs the SHIPPED decision path
 * (`decideTeam`, the same assembly `team-decision-engine.ts` builds) over a
 * board, then re-does — outside the fold, exactly as
 * `ActiveGameManager.getWaypointBiasedMove` does inside it — the arithmetic a
 * goto command actually gets:
 *
 *     adjusted(candidate) = foldScore(candidate)
 *                         + weight × authority × progressStat(candidate)
 *
 * and prints, per turn, per unit: the fold's own top candidate, the candidate
 * the goto favours (highest progress stat), the gap between their FOLD scores,
 * the stat SPREAD between them, the weight, and the authority the command
 * would need for the operator's candidate to actually win.
 *
 * The spread column is the point. The stat's RANGE is [0, 1], but what orders
 * two candidates is the DIFFERENCE in their stats, and for a target `d` steps
 * away that difference is at most 2/(d−1): every candidate is nearly as close
 * to a distant target as every other. So the bias that actually discriminates
 * is `weight × 2/(d−1)`, not `weight`.
 *
 *   npx ts-node --transpile-only src/tests/goto-authority-probe.ts
 *   npx ts-node --transpile-only src/tests/goto-authority-probe.ts --authority=10
 *
 * The numbers this prints are the ones quoted in
 * `docs/design/ux/16-COMMANDS.md` §1.
 */

import { buildBoard, decideTeam, stepGame, DEFAULT_NODE_BUDGET, GameSpec } from './local-game';
import { waypointProgressByDestination } from '../logic/waypoint-pathing';
import { RouteBoard } from '../logic/route';
import { DEFAULT_WEIGHTS as LOBSTER_WEIGHTS } from '../lobster/evaluate/calibration';
import { DEFAULT_CONFIG } from '../config/game-config';
import { mulberry32 } from '../lobster/bounds/testkit';
import type { Board, Coord, GameState } from '../types/battlesnake';

const arg = (name: string, def: number): number => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : def;
};

/** An ordinary opening: our units are told to walk to the far corner. */
const OPEN: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    { id: 'A', units: [{ kind: 'snake', x: 1, y: 5, size: 5 }, { kind: 'knight', x: 4, y: 9, size: 3 }] },
    { id: 'B', units: [{ kind: 'snake', x: 9, y: 5, size: 5 }, { kind: 'knight', x: 6, y: 1, size: 3 }] },
  ],
  // Food deliberately BEHIND our units, so the fold's own gradient pulls the
  // opposite way from the operator's order. This is the shape of the
  // complaint: the human wants the far corner, the bot wants the meal.
  food: [{ x: 0, y: 4 }, { x: 1, y: 2 }, { x: 0, y: 8 }],
  foodTarget: 3,
  nodeBudget: DEFAULT_NODE_BUDGET,
  seed: 7,
};

/** THE MEAL, ONE STEP THE OTHER WAY: the position operators complain about. */
const MEAL: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    { id: 'A', units: [{ kind: 'snake', x: 5, y: 5, size: 4 }, { kind: 'knight', x: 5, y: 9, size: 3 }] },
    { id: 'B', units: [{ kind: 'snake', x: 9, y: 9, size: 4 }, { kind: 'knight', x: 9, y: 1, size: 3 }] },
  ],
  food: [{ x: 4, y: 5 }, { x: 4, y: 9 }],
  foodTarget: 2,
  nodeBudget: DEFAULT_NODE_BUDGET,
  seed: 3,
};

function stateFor(board: Board, turn: number, unitId: string): GameState | null {
  const you = board.snakes.find(s => s.id === unitId);
  if (!you) return null;
  return {
    game: {
      id: 'probe',
      ruleset: { name: 'standard', version: '1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'probe',
    },
    turn,
    board,
    you,
  };
}

const HEAD =
  'turn unit      kind    weight  botTop        est   gotoPick      est     gap  stat  sprd    bias  wins  needs';

interface Tally { rows: number; overruled: number; maxGap: number; minSpread: number }

async function probe(
  label: string,
  spec: GameSpec,
  target: Coord,
  turns: number,
  authority: number
): Promise<void> {
  let board = buildBoard(spec);
  const rng = mulberry32(spec.seed ?? 1);
  const tally = new Map<string, Tally>();
  console.log(`\n-- ${label} -- goto ${target.x},${target.y}, authority x${authority}`);
  console.log(HEAD);

  for (let turn = 1; turn <= turns; turn++) {
    const decision = await decideTeam(board, turn, 'A', { kind: 'nodes', nodes: DEFAULT_NODE_BUDGET });
    for (const trace of decision.traces) {
      const gs = stateFor(board, turn, trace.wireId);
      if (!gs) continue;
      const offered = trace.top.filter(c => !c.pruned && Number.isFinite(c.est));
      if (offered.length === 0) continue;
      const progress = waypointProgressByDestination(
        gs,
        trace.wireId,
        { kind: 'goto', target },
        offered.map(c => ({ cell: c.to })),
        { board: new RouteBoard(gs) }
      );
      // The two weights the two code paths actually use: a snake is re-biased
      // on the FOLD's scale (getWaypointBiasedMove), a piece on the legacy
      // heuristic scale (computePieceCandidates), where its base is 0.
      const weight = trace.kind === 'snake' ? LOBSTER_WEIGHTS.food : DEFAULT_CONFIG.gotoProgress;
      let botTop = 0;
      let gotoPick = 0;
      for (let i = 1; i < offered.length; i++) {
        if (offered[i].est > offered[botTop].est) botTop = i;
        if (
          progress[i].stat > progress[gotoPick].stat ||
          (progress[i].stat === progress[gotoPick].stat && offered[i].est > offered[gotoPick].est)
        ) gotoPick = i;
      }
      const adjusted = offered.map((c, i) => c.est + weight * authority * progress[i].stat);
      let biased = 0;
      for (let i = 1; i < adjusted.length; i++) if (adjusted[i] > adjusted[biased]) biased = i;

      const gap = offered[botTop].est - offered[gotoPick].est;
      const stat = progress[gotoPick].stat;
      // THE SPREAD, which is what actually orders two candidates.
      const spread = stat - progress[botTop].stat;
      // The authority at which the operator's candidate overtakes the fold's
      // own leader. Infinity means the spread is zero or negative: no
      // authority can help, because the bias does not separate the two at all.
      const needs = spread > 0 ? gap / (weight * spread) : Infinity;

      const t = tally.get(trace.kind) ?? { rows: 0, overruled: 0, maxGap: 0, minSpread: 1 };
      t.rows += 1;
      if (biased !== gotoPick && gap > 0) t.overruled += 1;
      t.maxGap = Math.max(t.maxGap, gap);
      if (gap > 0) t.minSpread = Math.min(t.minSpread, spread);
      tally.set(trace.kind, t);

      const cell = (c: Coord) => `${c.x},${c.y}`;
      console.log(
        [
          String(turn).padStart(4),
          trace.wireId.padEnd(9),
          trace.kind.padEnd(7),
          String(weight).padStart(6),
          cell(offered[botTop].to).padStart(9),
          offered[botTop].est.toFixed(2).padStart(9),
          cell(offered[gotoPick].to).padStart(9),
          offered[gotoPick].est.toFixed(2).padStart(9),
          gap.toFixed(2).padStart(7),
          stat.toFixed(2).padStart(5),
          spread.toFixed(2).padStart(5),
          (weight * authority * spread).toFixed(2).padStart(7),
          (biased === gotoPick ? 'yes' : 'NO').padStart(5),
          (Number.isFinite(needs) ? `x${Math.max(1, Math.ceil(needs))}` : '-').padStart(6),
        ].join(' ')
      );
    }
    const outcome = stepGame(board, turn, decision.staged, rng, spec.foodTarget ?? 0);
    board = outcome.board;
    if (outcome.outcome) break;
  }

  for (const [kind, t] of tally) {
    console.log(
      `  ${kind}: goto overruled on ${t.overruled}/${t.rows} turns at x${authority}; ` +
      `widest fold gap ${t.maxGap.toFixed(2)}; narrowest useful stat spread ${t.minSpread.toFixed(2)}.`
    );
  }
}

async function main(): Promise<void> {
  const authority = arg('authority', 1);
  await probe('open board', OPEN, { x: 9, y: 9 }, arg('turns', 12), authority);
  await probe('meal one step the other way', MEAL, { x: 9, y: 5 }, arg('mealTurns', 4), authority);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
