/** Board hunt (exploration): which small boards have pins with a POSITIVE
 * exhaustively-computable cost, and a MIX of costs? Kept in the bench so the
 * calibration board choice is reproducible rather than asserted. */
import type { Board as ApiBoard } from '../../src/types/battlesnake';
import { boardOf, clearGeometryCache, makeSnake, piece, round } from './harness';
import { bestUnder, groundTruth } from './truth';

afterEach(() => clearGeometryCache());

interface Cand {
  name: string;
  board: ApiBoard;
}

function candidates(): Cand[] {
  const out: Cand[] = [];
  for (const oy of [2, 3, 4]) {
    for (const ey of [2, 3]) {
      for (const py of [4, 5]) {
        out.push({
          name: `rook(2,${oy})+knight(5,6) vs knight(4,${ey})+pawn(2,${py})`,
          board: boardOf(
            [
              piece('a', { x: 2, y: oy }, 'rook', 2, { teamID: 'red' }),
              piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
              piece('e1', { x: 4, y: ey }, 'knight', 1, { teamID: 'blue' }),
              piece('e2', { x: 2, y: py }, 'pawn', 1, { teamID: 'blue' }),
            ],
            7
          ),
        });
      }
    }
  }
  for (const ex of [4, 5]) {
    out.push({
      name: `snake(3,3)+rook(1,5) vs knight(${ex},3)+pawn(3,1)`,
      board: boardOf(
        [
          makeSnake(
            's',
            [
              { x: 3, y: 3 },
              { x: 2, y: 3 },
            ],
            { teamID: 'red', orientation: { dx: 1, dy: 0 } }
          ),
          piece('b', { x: 1, y: 5 }, 'rook', 2, { teamID: 'red' }),
          piece('e1', { x: ex, y: 3 }, 'knight', 1, { teamID: 'blue' }),
          piece('e2', { x: 3, y: 1 }, 'pawn', 1, { teamID: 'blue' }),
        ],
        7
      ),
    });
  }
  return out;
}

test('scan for pins with positive true cost', () => {
  /* eslint-disable no-console */
  for (const c of candidates()) {
    let table;
    try {
      table = groundTruth({
        board: c.board,
        turn: 9,
        ourTeam: 'red',
        maxPlans: 6000,
        maxReplies: 400,
      });
    } catch (err) {
      console.log(`${c.name}: ${String(err)}`);
      continue;
    }
    clearGeometryCache();
    const base = bestUnder(table).value;
    const lines: string[] = [];
    for (const unitId of table.ourIds) {
      const dests = [...new Set((table.optionsOf.get(unitId) ?? []).map((x) => x.to))];
      const costs = dests.map((to) => base - bestUnder(table, { unitId, to }).value);
      const hist = new Map<number, number>();
      for (const v of costs) hist.set(v, (hist.get(v) ?? 0) + 1);
      lines.push(
        `u${unitId}[${[...hist.entries()].sort((x, y) => x[0] - y[0]).map(([v, n]) => `${round(v, 1)}x${n}`).join(' ')}]`
      );
    }
    console.log(
      `${c.name}: plans=${table.plans.length} replies=${table.replySpace} base=${round(base, 1)} ${lines.join(' ')}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 1800000);
