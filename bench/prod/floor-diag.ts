/**
 * Diagnosis for the unsound floor: which unit's fate is wrong, and where.
 *
 * Prints, for one plan on one board: the engine's own subject-frame fold, each
 * unit's fate and standing, the entanglement ledger, and the same numbers with
 * the offending held unit MODELLED instead of claimed. The difference between
 * the two is the bug's whole surface.
 */

import type { Board, Coord, Snake } from '../../src/types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { materialEvaluator, standingOf } from '../../src/lobster/evaluate';
import { planOf, truthOf } from './truth';

const cell = (x: number, y: number): Coord => ({ x, y });

function snake(id: string, team: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  const head = body[0] as Coord;
  const mid = body[1] ?? head;
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: { ...head },
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#fff', head: 'default', tail: 'default' },
    teamID: team,
    orientation: { dx: head.x - mid.x, dy: -(head.y - mid.y) },
    ...extra,
  } as Snake;
}

/**
 * The smallest board that shows it: our snake steps onto an enemy snake's
 * turn-start BODY cell. Under the rules that is fatal for us unless the enemy
 * body has vacated, and occupancy never clears mid-turn.
 */
const BOARD: Board = {
  width: 7,
  height: 7,
  food: [],
  hazards: [],
  snakes: [
    snake('r1', 'red', [cell(2, 0), cell(2, 1), cell(3, 1)]),
    snake('b1', 'blue', [cell(2, 2), cell(2, 3), cell(1, 3)]),
  ],
} as Board;

function report(board: Board, turn: number, team: string, modelled: string[], label: string): void {
  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: modelled });
  try {
    const asTeam = sub.teamNumber(team);
    const b1 = sub.unitOfWireId('b1');
    if (b1 === undefined) throw new Error('no b1');
    // b1 steps DOWN onto (2,1) — an enemy body cell.
    const to = sub.actionsOf(b1.unitId).find((c) => {
      const api = sub.marshalled.toCell(c.to);
      return api.x === 2 && api.y === 1;
    });
    if (to === undefined) throw new Error('step onto (2,1) is not in the grammar');
    const orders = new Map<string, number>([['b1', to.to]]);
    const plan = planOf(sub, orders);
    const out = sub.resolveBoundedFull(plan, asTeam);
    const ev = materialEvaluator.evaluatePlan(sub, plan, asTeam);
    const st = standingOf(sub, out.resolution, asTeam, out.touched);
    console.log(`\n## ${label}  (modelled: ${modelled.join(', ') || 'none'})`);
    console.log(`   engine fold      worst=${out.bounds.worst} best=${out.bounds.best}`);
    console.log(`   evaluator bound  lo=${ev.bound.lo} est=${ev.bound.est} hi=${ev.bound.hi} exact=${ev.exact} ledger=${ev.ledgerSize}`);
    console.log(`   ledger           ${JSON.stringify(out.resolution.ledger)}`);
    console.log(`   fates            ${JSON.stringify(out.resolution.fates)}`);
    for (const s of st) {
      console.log(
        `   standing u${s.unitId} team=${s.team} held=${s.held} w=[${s.weightMin},${s.weightMax}] ` +
          `worstAlive=${s.worstAlive} bestAlive=${s.bestAlive}`
      );
    }
    sub.releaseResolution(out.resolution);
    const truth = truthOf(board, turn, team, orders, materialEvaluator, 4000);
    console.log(`   EXHAUSTIVE TRUTH [${truth.lo}, ${truth.hi}] over ${truth.worlds} worlds`);
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

console.log('# FLOOR DIAGNOSIS — our mover steps onto a HELD enemy snake\'s body cell');
console.log('# board: red snake (2,0)(2,1)(3,1)   blue snake (2,2)(2,3)(1,3)   blue stages (2,2)->(2,1)');
report(BOARD, 3, 'blue', ['b1'], 'red HELD (the production shape: nothing of theirs modelled)');
report(BOARD, 3, 'blue', ['b1', 'r1'], 'red MODELLED (reference-fixed is not this, but it isolates the reading)');
