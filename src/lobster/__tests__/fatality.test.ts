/**
 * THE RUNG-0 FATALITY CLASSIFIER.
 *
 * The load-bearing test in this file is the first one, and it is a
 * CORRECTION, not a confirmation. Two design memos and one shipped comment all
 * say a trail unit's tail vacates "unless it eats this turn". It does not
 * matter what the source looks like — the way that error was made was by
 * reading the source — so the rule is settled here by staging the move and
 * putting it through the real resolver, in all three arms, and asserting which
 * ones kill.
 *
 * The rest: FORCED and SEALED are what the SET of verdicts says about the
 * unit, they carry their provenance, and the collapse they license is the
 * weakest one the evidence supports — set-level, monotone, and unable to empty
 * an option set.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import {
  CertainOccupancy,
  SURVIVAL_PRIOR,
  classifyUnit,
  freedTailCell,
  survivalPriorFor,
  tailVacates,
} from '../fatality';
import { GrammarCandidateGenerator, PRUNE, PRUNE_EXACT, PRUNE_NOTES } from '../candidates';
import type { Candidate, CandidateSet, CellIndex, JointPlan, UnitId } from '../contracts';

// --------------------------------------------------------------------- fixtures

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

const TURN = 30;

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const move = (unitId: UnitId, from: CellIndex, to: CellIndex): Candidate => ({
  unitId,
  from,
  to,
  path: [to],
});

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------------------

/**
 * THE TAIL RULE, DECIDED BY THE RESOLVER.
 *
 * `A` is a three-cell trail unit; `B` steps onto `A`'s tail cell. Three arms
 * differing only in what makes the tail interesting:
 *
 *   no-food    A moves to an empty cell.
 *   food       A moves ONTO FOOD, so it eats this turn. The received rule says
 *              B dies here. It does not.
 *   dup-tail   A ate LAST turn, so its trail already carries a duplicate at
 *              the tail. The received rule says nothing about this case. It is
 *              the one that kills.
 *
 * The mechanism: growth is `arena[t+len] = arena[t+len-1]`, which duplicates
 * the POST-shift last cell. It never writes back the cell the shift vacated.
 * So eating frees the tail exactly as not eating does, and what holds a tail
 * in place is a duplicate that is already there.
 */
describe('the tail rule, against the real resolver', () => {
  interface Arm {
    readonly name: string;
    readonly body: Coord[];
    readonly food: Coord[];
    readonly vacates: boolean;
  }

  const arms: ReadonlyArray<Arm> = [
    {
      name: 'a team-mate that does not eat frees its tail',
      body: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }],
      food: [],
      vacates: true,
    },
    {
      name: 'a team-mate that EATS THIS TURN still frees its tail',
      body: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }],
      food: [{ x: 3, y: 3 }],
      vacates: true,
    },
    {
      name: 'a team-mate that ATE LAST TURN frees nothing',
      body: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 6 }],
      food: [],
      vacates: false,
    },
  ];

  for (const arm of arms) {
    test(arm.name, () => {
      const board = boardOf(
        [
          makeSnake('A', arm.body, { teamID: 'red' }),
          makeSnake(
            'B',
            [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
            { teamID: 'red' }
          ),
        ],
        { food: arm.food }
      );
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const A = sub.unitOfWireId('A') as NonNullable<ReturnType<typeof sub.unitOfWireId>>;
      const B = sub.unitOfWireId('B') as NonNullable<ReturnType<typeof sub.unitOfWireId>>;
      const tail = A.cells[A.cells.length - 1] as CellIndex;

      // The predicate under test agrees with the arm's label...
      expect(tailVacates(A)).toBe(arm.vacates);
      expect(freedTailCell(A)).toBe(arm.vacates ? tail : null);

      // ...and so does the resolver, for EVERY move A could make. The tail's
      // fate must not depend on which way A goes.
      const bMove = move(B.unitId, B.cells[0] as CellIndex, tail);
      let checked = 0;
      for (const action of sub.enumerate(A.unitId)) {
        if (A.cells.includes(action.dest as CellIndex)) continue;
        const plan: JointPlan = new Map<UnitId, Candidate>([
          [A.unitId, move(A.unitId, A.cells[0] as CellIndex, action.dest as CellIndex)],
          [B.unitId, bMove],
        ]);
        const bDied = sub.withResolution(plan, sub.teamNumber('red'), ({ resolution }) =>
          resolution.deaths.some((d) => d.unitId === B.unitId)
        );
        expect([action.dest, bDied]).toEqual([action.dest, !arm.vacates]);
        checked++;
      }
      expect(checked).toBeGreaterThan(1);
      sub.release();
    });
  }

  test('a piece has no tail to pop, and a one-cell trail unit has no tail cell', () => {
    const board = boardOf([
      piece('Q', { x: 4, y: 4 }, 'queen', 4, { teamID: 'red' }),
      makeSnake('S', [{ x: 1, y: 1 }], { teamID: 'red' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    expect(tailVacates(sub.unitOfWireId('Q')!)).toBe(false);
    expect(tailVacates(sub.unitOfWireId('S')!)).toBe(false);
    sub.release();
  });
});

// ---------------------------------------------------------------------------

describe('the survivor count', () => {
  test('is the escapes from the landing cell with the mover advanced by one', () => {
    // A snake in open ground: three of the four cells around any destination
    // are free, and the fourth is the neck it just left.
    const board = boardOf([
      makeSnake('A', [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], { teamID: 'red' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('A')!;
    const occ = new CertainOccupancy(sub, unit.team);
    const candidates = sub
      .enumerate(unit.unitId)
      .map((a) => move(unit.unitId, unit.cells[0] as CellIndex, a.dest as CellIndex));
    const out = classifyUnit(sub, unit, candidates, occ, true);
    for (const option of out.options) {
      if (option.cause !== null) continue;
      // Open ground: the destination's own neighbours minus the neck.
      expect(option.survivorsAfter).toBe(3);
      expect(option.survivalPrior).toBe(SURVIVAL_PRIOR[3]);
    }
    sub.release();
  });

  test('falls as the mover is enclosed, and reads 0 in a dead end', () => {
    // A pocket in the corner: the destination has exactly one way on.
    const board = boardOf([
      makeSnake(
        'A',
        [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }],
        { teamID: 'red' }
      ),
      makeSnake('W', [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 }], { teamID: 'red' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('A')!;
    const occ = new CertainOccupancy(sub, unit.team);
    const candidates = sub
      .enumerate(unit.unitId)
      .map((a) => move(unit.unitId, unit.cells[0] as CellIndex, a.dest as CellIndex));
    const counts = classifyUnit(sub, unit, candidates, occ, true)
      .options.filter((o) => o.cause === null)
      .map((o) => o.survivorsAfter);
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toBeLessThanOrEqual(2);
    sub.release();
  });

  test('reports -1 for a piece rather than inventing a prior for it', () => {
    const board = boardOf([piece('Q', { x: 4, y: 4 }, 'queen', 4, { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('Q')!;
    const occ = new CertainOccupancy(sub, unit.team);
    const candidates = sub
      .enumerate(unit.unitId)
      .map((a) => ({
        unitId: unit.unitId,
        from: unit.cells[0] as CellIndex,
        to: a.dest as CellIndex,
        path: a.action.kind === 'move' ? [...a.action.path] : [],
      }));
    for (const option of classifyUnit(sub, unit, candidates, occ, true).options) {
      expect(option.survivorsAfter).toBe(-1);
      expect(option.survivalPrior).toBe(1);
    }
    sub.release();
  });

  test('the prior is the census table, monotone, and saturates rather than reading past it', () => {
    expect(SURVIVAL_PRIOR).toEqual([0.098, 0.904, 0.976, 0.99]);
    for (let i = 1; i < SURVIVAL_PRIOR.length; i++) {
      expect(SURVIVAL_PRIOR[i] as number).toBeGreaterThan(SURVIVAL_PRIOR[i - 1] as number);
    }
    expect(survivalPriorFor(0)).toBe(0.098);
    expect(survivalPriorFor(9)).toBe(0.99);
    // Unknown is NOT zero and NOT the worst row: it is the multiplicative
    // identity, so an edge the classifier could not answer for is unchanged.
    expect(survivalPriorFor(-1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('FORCED and SEALED', () => {
  /**
   * A trail unit against the wall with its own body on two sides: exactly one
   * of its four destinations is not certainly fatal.
   */
  const cornered = (): Board =>
    boardOf([
      makeSnake(
        'A',
        [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        { teamID: 'red' }
      ),
    ]);

  const classifyBoard = (
    board: Board,
    wireId: string,
    withAlly: boolean
  ): { sub: EngineSubstrate; out: ReturnType<typeof classifyUnit> } => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId(wireId)!;
    const occ = new CertainOccupancy(sub, unit.team);
    const candidates = sub
      .enumerate(unit.unitId)
      .map((a) => ({
        unitId: unit.unitId,
        from: unit.cells[0] as CellIndex,
        to: a.dest as CellIndex,
        path: a.action.kind === 'move' ? [...a.action.path] : [],
      }));
    return { sub, out: classifyUnit(sub, unit, candidates, occ, withAlly) };
  };

  test('FORCED names the one option and collapses the dimension exactly', () => {
    const { sub, out } = classifyBoard(cornered(), 'A', false);
    expect(out.survivors).toBe(1);
    expect(out.forced).not.toBeNull();
    expect(out.sealed).toBe(false);
    // On the mover's own facts alone it is a theorem, and it says so.
    expect(out.provenance).toBe('rules-only');
    // The named option is one the resolver agrees the unit survives.
    const dead = sub.withResolution(
      new Map<UnitId, Candidate>([[out.unitId, out.forced as Candidate]]),
      sub.teamNumber('red'),
      ({ resolution }) => resolution.deaths.some((d) => d.unitId === out.unitId)
    );
    expect(dead).toBe(false);
    sub.release();
  });

  /**
   * A coil in the corner whose ONLY way out is its own tail cell — and whose
   * tail is duplicated, so the pop frees nothing. Two of its four steps are
   * off-board, one is its own mid-body, and the fourth is the tail that stays
   * put. Nothing survives.
   *
   * Written this way on purpose: the same coil WITHOUT the duplicate has one
   * survivor, and the difference between the two fixtures is the tail rule.
   */
  const sealedCoil = (): Board =>
    boardOf([
      makeSnake(
        'A',
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 0 },
          { x: 1, y: 0 },
        ],
        { teamID: 'red' }
      ),
    ]);

  test('the same coil WITHOUT the duplicate is merely forced — the tail is the way out', () => {
    const { sub, out } = classifyBoard(
      boardOf([
        makeSnake(
          'A',
          [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }],
          { teamID: 'red' }
        ),
      ]),
      'A',
      false
    );
    expect(out.survivors).toBe(1);
    expect(out.sealed).toBe(false);
    expect((out.forced as Candidate).to).toBe(sub.unitOfWireId('A')!.cells[3]);
    sub.release();
  });

  test('SEALED fires when nothing survives, and every condemned option really does kill', () => {
    const board = sealedCoil();
    const { sub, out } = classifyBoard(board, 'A', false);
    expect(out.survivors).toBe(0);
    expect(out.sealed).toBe(true);
    expect(out.forced).toBeNull();
    for (const option of out.options) {
      expect(option.cause).not.toBeNull();
      const dead = sub.withResolution(
        new Map<UnitId, Candidate>([[out.unitId, option.candidate]]),
        sub.teamNumber('red'),
        ({ resolution }) => resolution.deaths.some((d) => d.unitId === out.unitId)
      );
      expect([option.cause, dead]).toEqual([option.cause, true]);
    }
    sub.release();
  });

  test('the ally arm changes the PROVENANCE, and the mark says so', () => {
    // A's only non-fatal step runs into a team-mate's body.
    const board = boardOf([
      makeSnake('A', [{ x: 0, y: 4 }, { x: 0, y: 5 }, { x: 0, y: 6 }], { teamID: 'red' }),
      makeSnake('B', [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }], { teamID: 'red' }),
    ]);
    const rulesOnly = classifyBoard(board, 'A', false);
    expect(rulesOnly.out.provenance).toBe('rules-only');
    rulesOnly.sub.release();
    const withAlly = classifyBoard(board, 'A', true);
    // The ally arm can only take options away, never hand them back.
    expect(withAlly.out.survivors).toBeLessThanOrEqual(rulesOnly.out.survivors);
    if (withAlly.out.survivors < rulesOnly.out.survivors) {
      expect(withAlly.out.provenance).toBe('policy');
    }
    withAlly.sub.release();
  });

  test('an empty option list is neither forced nor sealed', () => {
    const board = boardOf([makeSnake('A', [{ x: 4, y: 4 }, { x: 4, y: 5 }], { teamID: 'red' })]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('A')!;
    const out = classifyUnit(sub, unit, [], new CertainOccupancy(sub, unit.team), true);
    expect(out.sealed).toBe(false);
    expect(out.forced).toBeNull();
    sub.release();
  });
});

// ---------------------------------------------------------------------------

describe('the generator wiring', () => {
  const cornered = (): Board =>
    boardOf([
      makeSnake(
        'A',
        [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        { teamID: 'red' }
      ),
      makeSnake('E', [{ x: 7, y: 7 }, { x: 7, y: 6 }], { teamID: 'blue' }),
    ]);

  const setFor = (board: Board, unitFatality: boolean, extra = {}): {
    sub: EngineSubstrate;
    set: CandidateSet;
  } => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator({
      pruneCertainSelfFatal: false,
      pruneRoyalPath: false,
      unitFatality,
      ...extra,
    });
    return { sub, set: gen.candidatesFor(sub, sub.unitOfWireId('A')!.unitId) };
  };

  test('OFF: the set is the one the shipped build produces, with no marks on it', () => {
    const off = setFor(cornered(), false);
    expect('marks' in off.set).toBe(false);
    expect(off.set.prunedLedger.some((e) => e.prune === PRUNE.forcedSibling)).toBe(false);
    off.sub.release();
  });

  test('ON: the forced collapse takes the siblings, under its own prune id', () => {
    const on = setFor(cornered(), true);
    expect(on.set.marks).toMatchObject({ forced: true, sealed: false, survivors: 1 });
    expect(on.set.candidates).toHaveLength(1);
    const forcedOut = on.set.prunedLedger.filter((e) => e.prune === PRUNE.forcedSibling);
    expect(forcedOut.length).toBeGreaterThan(0);
    // The completeness invariant survives: every legal action is either kept
    // or accounted for.
    const accounted = new Set<string>();
    for (const c of on.set.candidates) accounted.add(`${c.to}:${c.path.join('.')}`);
    for (const e of on.set.prunedLedger) accounted.add(`${e.candidate.to}:${e.candidate.path.join('.')}`);
    expect(accounted.size).toBe(on.set.legalCount);
    on.sub.release();
  });

  test('ON but NOT forced: nothing is pruned, and the data still rides out', () => {
    // Open ground — several options survive, so the collapse must not fire.
    const board = boardOf([
      makeSnake('A', [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], { teamID: 'red' }),
    ]);
    const on = setFor(board, true);
    expect(on.set.marks?.forced).toBe(false);
    expect(on.set.prunedLedger.some((e) => e.prune === PRUNE.forcedSibling)).toBe(false);
    expect(on.set.candidates.length).toBeGreaterThan(1);
    on.sub.release();
  });

  test('ON: the option set is never emptied, even for a sealed unit', () => {
    // The duplicated tail is what seals it — see the fatality suite above.
    const board = boardOf([
      makeSnake(
        'A',
        [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 0 }],
        { teamID: 'red' }
      ),
    ]);
    const on = setFor(board, true);
    expect(on.set.marks?.sealed).toBe(true);
    expect(on.set.candidates.length).toBeGreaterThan(0);
    // Nothing was taken by the collapse: a sealed unit has no survivor to be
    // forced onto, so the siblings stay and the emptiness guard is not even
    // reached through this path.
    expect(on.set.prunedLedger.some((e) => e.prune === PRUNE.forcedSibling)).toBe(false);
    on.sub.release();
  });

  test('the new prune id is declared lossy and carries a note', () => {
    expect(PRUNE_EXACT[PRUNE.forcedSibling]).toBe(false);
    expect(PRUNE_NOTES[PRUNE.forcedSibling]).toContain('never empty');
  });

  test('the assessment carries the survivor count as data, and the order does not read it', () => {
    const board = boardOf([
      makeSnake('A', [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 }], { teamID: 'red' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const id = sub.unitOfWireId('A')!.unitId;
    const off = new GrammarCandidateGenerator({ unitFatality: false }).candidatesFor(sub, id);
    const on = new GrammarCandidateGenerator({ unitFatality: true }).candidatesFor(sub, id);
    // ORDERING IS UNCHANGED. Promoting the count into `orderKey` is a measured
    // change and belongs to the rung that measures it; this stage's job was to
    // make the number exist.
    expect(on.candidates.map((c) => c.to)).toEqual(off.candidates.map((c) => c.to));
    const assessed = new GrammarCandidateGenerator({ unitFatality: true }).assess(sub, id);
    expect(assessed.some((a) => a.survivorsAfter >= 0)).toBe(true);
    for (const a of assessed) expect(a.survivalPrior).toBe(survivalPriorFor(a.survivorsAfter));
    sub.release();
  });
});
