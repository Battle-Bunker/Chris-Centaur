/**
 * THE PATH-RISK FOLD, against the settlement it is a fold OF.
 *
 * `pathrisk` claims to be a reading and not a layer: everything it reports is
 * supposed to be visible in the one-mover settlement it ran, and nothing in it
 * is supposed to be a second opinion about the rules. So every assertion here
 * is of the form "the verdict agrees with the settlement", checked against the
 * settlement directly:
 *
 *   survival 'no'   ⟺ the settlement killed the mover
 *   survival 'maybe' ⟹ the settlement's ledger blames somebody for it
 *   halt 'yes'      ⟺ the traversal stopped short of the staged ray
 *   landing         ⊇ where the settlement left it
 *   energySpent.hi  = the whole traversal's charge, at the engine's own
 *                     `COST_PER_CELL` plus the terrain's own dose
 *
 * The one thing that is NOT checked here is whether the trits are the trits
 * the old risk engine produced. They are not, they cannot be, and no
 * differential can be written for them — the old grading has no successor to
 * be differenced against. That is why the behavioural gates
 * (`basic-intelligence.test.ts`, the 30-turn runner) are the ones that decide
 * whether this reading is any good.
 */

import { COST_PER_CELL } from '../../engine-vendor/engine/turnEngine';
import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import { assessPath } from '../pathrisk';
import type { UnitId } from '../contracts';

const TURN = 12;

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

afterEach(() => clearGeometryCache());

/** Assess every legal ray of every unit, and check the fold against the settlement. */
function checkEveryRay(sub: EngineSubstrate): number {
  let checked = 0;
  for (const unit of sub.roster()) {
    for (const candidate of sub.actionsOf(unit.unitId)) {
      if (candidate.path.length === 0) continue;
      const verdict = assessPath(sub, unit, candidate.path);
      const settlement = sub.settleMover(unit.unitId, candidate.path);
      const traversed = settlement.traversed[unit.wireId] ?? [];
      const death = settlement.deaths[unit.wireId];
      checked++;

      // One verdict per cell the mover actually entered, in path order.
      expect(verdict.perCell).toHaveLength(traversed.length);

      // A certain death is the settlement's death, and nothing else is.
      const certainlyDead = verdict.survival === 'no';
      expect(certainlyDead).toBe(death !== undefined && !exhaustionCouldLift(settlement, unit.wireId));

      // A `maybe` is never free: something in the ledger has to be carrying it.
      for (let i = 0; i < verdict.perCell.length; i++) {
        const cell = verdict.perCell[i];
        if (cell === undefined) continue;
        if (cell.survival === 'maybe') {
          expect(cell.causes.some((c) => c.contingent)).toBe(true);
        }
        if (cell.halt === 'yes') {
          // A certain halt is the last cell it entered — the timeline stopped.
          expect(i).toBe(traversed.length - 1);
        }
      }

      // A truncated traversal is a CERTAIN halt: the optimistic timeline is the
      // furthest the mover ever gets, so nothing lifts a stop it recorded.
      if (traversed.length < candidate.path.length && traversed.length > 0) {
        expect(verdict.perCell[traversed.length - 1]?.halt).toBe('yes');
        expect(verdict.completesPath).toBe('no');
      }

      // Where the settlement left it is a place it could come to rest.
      const finalCell = settlement.finalCell[unit.wireId];
      if (finalCell !== undefined && traversed.length > 0) {
        expect(verdict.landing.cells).toContain(finalCell);
      }

      // The energy ceiling is the whole traversal at the rule's own price.
      let charge = 0;
      for (const cell of traversed) charge += COST_PER_CELL + (sub.hazardAt(cell) ? sub.hazardDamage : 0);
      expect(verdict.energySpent.hi).toBe(charge);
      expect(verdict.energySpent.lo).toBeLessThanOrEqual(verdict.energySpent.hi);
      expect(verdict.savedByTruncation).toBe(verdict.energySpent.hi - verdict.energySpent.lo);
    }
  }
  return checked;
}

/** Could a halt one cell earlier have saved the mover from its own exhaustion? */
function exhaustionCouldLift(
  settlement: ReturnType<EngineSubstrate['settleMover']>,
  wireId: string
): boolean {
  const death = settlement.deaths[wireId];
  if (death === undefined) return false;
  if (death.cause !== 'exhaustion' && death.cause !== 'hazard') return false;
  return settlement.ledger.some((e) => e.unitId === wireId);
}

describe('the fold agrees with the settlement it folds', () => {
  test('a crowded mixed board, every legal ray of every unit', () => {
    const board = boardOf(
      [
        makeSnake('S', [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }], { teamID: 'red' }),
        piece('R', { x: 5, y: 5 }, 'rook', 3, { teamID: 'red' }),
        piece('K', { x: 6, y: 2 }, 'knight', 1, { teamID: 'blue' }),
        makeSnake('T', [{ x: 1, y: 7 }, { x: 1, y: 6 }], { teamID: 'blue' }),
      ],
      { food: [{ x: 4, y: 4 }] }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    expect(checkEveryRay(sub)).toBeGreaterThan(20);
    sub.release();
  });

  test('a hazard board: the dose is in the interval, at the engine’s own price', () => {
    const board = boardOf(
      [
        piece('R', { x: 2, y: 4 }, 'rook', 2, { teamID: 'red' }),
        piece('K', { x: 7, y: 7 }, 'knight', 1, { teamID: 'blue' }),
      ],
      { hazards: [{ x: 4, y: 4 }], hazardDamage: 15 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const rook = sub.unitOfWireId('R') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const across = sub
      .actionsOf(rook.unitId)
      .find((c) => c.path.includes(m.toIndex({ x: 4, y: 4 })) && c.path.length >= 2);
    expect(across).toBeDefined();
    const verdict = assessPath(sub, rook, across?.path ?? []);
    // Two cells entered, one of them a hazard: two moves plus one dose.
    expect(verdict.energySpent.hi).toBe(
      (across?.path.length ?? 0) * COST_PER_CELL + 15
    );
    sub.release();
  });
});

describe('a ray crossing an unknown is optimistic, and says where it could stop', () => {
  /**
   * THE ONE-MOVER READING HOLDS EVERYTHING ELSE — teammates included. So a
   * ray drawn through another unit is settled as if that unit were not there
   * (it might have moved), the mover reaches the far end, and every cell at
   * which a world could have stopped it is a ledger entry and a `maybe` halt.
   * That is a WEAKER claim than "it stops here", and deliberately: the old
   * risk layer read our own units as empty ground and said nothing at all
   * about them, which is the blindness `staging-safety.ts` exists to cover.
   */
  test('the mover crosses, and the crossing is contingent rather than silent', () => {
    const board = boardOf([
      piece('R', { x: 1, y: 4 }, 'rook', 5, { teamID: 'red' }),
      piece('B', { x: 4, y: 4 }, 'rook', 1, { teamID: 'red' }),
      piece('E', { x: 8, y: 8 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const rook = sub.unitOfWireId('R') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const blocker = m.toIndex({ x: 4, y: 4 });
    const far = sub.actionsOf(rook.unitId).find((c) => c.to === m.toIndex({ x: 7, y: 4 }));
    expect(far).toBeDefined();
    const verdict = assessPath(sub, rook, far?.path ?? []);
    const index = (far?.path ?? []).indexOf(blocker);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(verdict.perCell).toHaveLength((far?.path ?? []).length);
    expect(verdict.perCell[index]?.halt).not.toBe('no');
    expect(verdict.landing.cells).toContain(blocker);
    expect(verdict.landing.certain).toBeNull();
    sub.release();
  });

  /** A wall is the stop nothing can lift: terrain, and the mover's own choice. */
  test('a trail unit staged into the perimeter dies there, certainly', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 0, y: 4 }, { x: 1, y: 4 }], {
        teamID: 'red',
        orientation: { dx: -1, dy: 0 },
      }),
      piece('E', { x: 8, y: 8 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const s = sub.unitOfWireId('S') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const intoWall = sub
      .actionsOf(s.unitId)
      .find((c) => c.path.some((cell) => sub.isWall(cell)));
    expect(intoWall).toBeDefined();
    const verdict = assessPath(sub, s, intoWall?.path ?? []);
    expect(verdict.survival).toBe('no');
    expect(verdict.deathCells.length).toBeGreaterThan(0);
    sub.release();
  });
});

describe('a one-mover settlement holds everything else', () => {
  test('the assessment reads the same claims the substrate hoisted', () => {
    const board = boardOf([
      piece('A', { x: 3, y: 3 }, 'knight', 1, { teamID: 'red' }),
      piece('B', { x: 4, y: 5 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const a = sub.unitOfWireId('A') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const ray = sub.actionsOf(a.unitId).find((c) => c.path.length > 0);
    const settlement = sub.settleMover(a.unitId, ray?.path ?? []);
    // Everything but the mover is a claim — including our own other units,
    // which is what makes this a one-mover reading rather than a plan.
    expect(settlement.claims.map((c) => c.id)).toEqual(['B']);
    sub.release();
  });

  test('the verdict is deterministic: the same ray twice is the same answer', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 4, y: 4 }, { x: 4, y: 5 }], { teamID: 'red' }),
      piece('E', { x: 6, y: 4 }, 'queen', 2, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const s = sub.unitOfWireId('S') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    for (const candidate of sub.actionsOf(s.unitId)) {
      if (candidate.path.length === 0) continue;
      const first = assessPath(sub, s, candidate.path);
      const second = assessPath(sub, s, candidate.path);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
    sub.release();
  });
});

describe('the fold names the unknown unit it is quoting', () => {
  test('every contingent cause carries the held unit it came from', () => {
    const board = boardOf([
      makeSnake('S', [{ x: 4, y: 4 }, { x: 4, y: 5 }], { teamID: 'red' }),
      piece('E', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const s = sub.unitOfWireId('S') as NonNullable<ReturnType<EngineSubstrate['unitOfWireId']>>;
    const enemy = sub.unitOfWireId('E')?.unitId as UnitId;
    let sawContingent = false;
    for (const candidate of sub.actionsOf(s.unitId)) {
      if (candidate.path.length === 0) continue;
      for (const cell of assessPath(sub, s, candidate.path).perCell) {
        for (const cause of cell.causes) {
          if (!cause.contingent) continue;
          sawContingent = true;
          expect(cause.heldId).toBe(enemy);
        }
      }
    }
    expect(sawContingent).toBe(true);
    sub.release();
  });
});
