/**
 * WHY THE FLOOR LIES — the discriminating experiment.
 *
 * The rule at issue is the vendored engine's c5 (`turnEngine.ts:445-478`):
 * a mover that arrives on a LIVING trail unit's body cell (occupancy index >= 1)
 * is condemned when `m.tier <= maxOwnerTier`. It is decided by TIER, and by
 * nothing else — weight does not enter it. At tier parity, which is every
 * board in this bench, entering an enemy snake's body is unconditionally
 * fatal for the entrant.
 *
 * So: our snake steps onto a HELD enemy snake's body cell. The exhaustive
 * truth (and the vendored resolver) say it can die. Does the bank's floor?
 *
 * The sweep varies exactly one thing — our snake's WEIGHT relative to the
 * enemy's — because if the claim layer were deciding this interaction by
 * weight it would get the light cases right and the heavy cases wrong, which
 * is a different bug from getting all of them wrong.
 *
 *   node .bench-dist/bench/prod/floor-diag.js
 */

import type { Board, Coord, Snake } from '../../src/types/battlesnake';
import { apiCoordToIndex } from '../../src/firebase/translate';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator, standingOf } from '../../src/lobster/evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG, B0_ONLY } from '../../src/lobster/bounds/bank';
import { planOf, truthOf } from './truth';
import { fmt } from './stats';

const SIZE = 7;
const FULL = SIZE + 2;
const at = (x: number, y: number): number => apiCoordToIndex({ x, y }, FULL, FULL);
const cell = (x: number, y: number): Coord => ({ x, y });

const budget = {
  shouldStop: (): boolean => false,
  remainingMs: (): number => 1e9,
  elapsedMs: (): number => 0,
  now: (): number => Date.now(),
};

function unit(id: string, team: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
 * Blue's snake stands at (2,2) and will step DOWN onto (2,1), which is red
 * snake's neck. `blueWeight` sets how long blue's snake is; red's is always 3.
 */
function boardWith(blueWeight: number): Board {
  const trail: Coord[] = [cell(2, 2), cell(2, 3), cell(1, 3), cell(0, 3), cell(0, 4)];
  return {
    width: SIZE,
    height: SIZE,
    food: [cell(5, 4)],
    hazards: [],
    snakes: [
      unit('r0', 'red', [cell(4, 2)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: -1 } }),
      unit('r1', 'red', [cell(2, 0), cell(2, 1), cell(3, 1)]),
      unit('b0', 'blue', [cell(0, 6)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: 1 } }),
      unit('b1', 'blue', trail.slice(0, blueWeight)),
    ],
  } as Board;
}

function run(blueWeight: number): void {
  const board = boardWith(blueWeight);
  const orders = new Map<string, number>([
    ['b0', at(0, 6)],
    ['b1', at(2, 1)],
  ]);
  const truth = truthOf(board, 3, 'blue', orders, materialEvaluator, 4000);
  const sub = makeSubstrate({ board, turn: 3, asTeam: 'blue', modeled: ['b0', 'b1'] });
  try {
    const asTeam = sub.teamNumber('blue');
    const plan = planOf(sub, orders);
    const res = sub.resolveBoundedFull(plan, asTeam);
    const st = standingOf(sub, res.resolution, asTeam, res.touched);
    const mover = sub.unitOfWireId('b1');
    const moverStanding = st.find((s) => s.unitId === mover?.unitId);
    const price = (cfg: ConstructorParameters<typeof BoundBank>[0]['config']): string => {
      const bank = new BoundBank({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        asTeam,
        budget,
        basis: [],
        config: cfg,
      });
      try {
        const p = bank.price(plan);
        return `[${p.bounds.worst}, ${p.bounds.best}]`;
      } catch (err) {
        return `THREW ${(err as { message?: string }).message}`;
      } finally {
        bank.release();
      }
    };
    console.log(
      `blue snake weight ${blueWeight} (red's is 3)\n` +
        `    engine fold        [${res.bounds.worst}, ${res.bounds.best}]\n` +
        `    B0-only bracket    ${price(B0_ONLY)}\n` +
        `    shipped bracket    ${price(DEFAULT_BANK_CONFIG)}\n` +
        `    EXHAUSTIVE TRUTH   [${fmt(truth.lo, 0)}, ${fmt(truth.hi, 0)}] over ${truth.worlds} worlds\n` +
        `    mover fate         worstAlive=${moverStanding?.worstAlive} bestAlive=${moverStanding?.bestAlive}\n` +
        `    ledger entries     ${res.resolution.ledger.length}  fates=${JSON.stringify(res.resolution.fates)}\n` +
        `    VERDICT            ${
          (res.bounds.worst as number) * 10 > truth.lo + 1e-6 || floorOf(price(B0_ONLY)) > truth.lo + 1e-6
            ? 'FLOOR ABOVE TRUTH'
            : 'floor sound'
        }`
    );
    sub.releaseResolution(res.resolution);
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

function floorOf(bracket: string): number {
  const m = /^\[(-?[\d.]+|-?Infinity),/.exec(bracket);
  return m === null ? Number.NEGATIVE_INFINITY : Number(m[1]);
}

console.log("# FLOOR DIAGNOSIS — our snake steps onto a HELD enemy snake's body cell");
console.log('# vendored rule: turnEngine.ts c5 condemns the mover when m.tier <= maxOwnerTier');
console.log('# every unit here is tier 0, so the step is fatal for the mover in every world');
console.log('');
for (const w of [2, 3, 4, 5]) run(w);
