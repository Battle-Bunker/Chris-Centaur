/**
 * THE STAGING-SAFETY LAYER, machine-checked.
 *
 * Five claims, and the first one is the only one that could make the layer
 * unsound:
 *
 *   SOUND      every action `certainlySelfFatal` refuses really does kill its
 *              own mover — checked by RESOLVING it through the real resolver,
 *              never by re-reading the rule that motivated it.
 *   COMPLETE   candidates and the ledger still partition the legal action set,
 *              and no board and no unit comes back with an empty option set.
 *   PINNED     an operator pin whose destination the layer refused is still
 *              reachable through the ledger, so the guard can never override a
 *              human.
 *   ORDERED    a certainly-fatal move is no longer the ordered-FIRST option —
 *              which is the whole failure, since rung 0 stages `candidates[0]`.
 *   OFF        with the flag off, every set is byte-identical to the one the
 *              shipped build produces.
 *
 * Plus the rung-0 self-harm repair (`SearchCore.conform` with an empty
 * incumbent) and the royal-margin correction.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import {
  GrammarCandidateGenerator,
  PRUNE,
  PRUNE_EXACT,
  PRUNE_NOTES,
  knobsForSafety,
} from '../candidates';
import {
  allyBodyCollision,
  boardBearsPiece,
  certainlySelfFatal,
  killsOwnKing,
  resolveStagingSafety,
  royalMarginFrom,
  stagingSafetyFrom,
} from '../staging-safety';
import type { Candidate, CandidateSet, JointPlan, SearchContext, UnitId } from '../contracts';
import {
  makeEvaluator,
  makeGenerator,
  makeSubstrate as makeTestSubstrate,
  makeTestBoard,
  unboundedBudget,
  type BoardSpec,
} from '../bounds/testkit';
import { makeSearchCore } from '../search';
import { makeSnake, piece, boardOf } from '../../tests/board-fixtures';

// --------------------------------------------------------------------- fixtures

const TURN = 30;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Random boards biased toward the thing under test: mostly trail units, mostly
 * long enough to have a neck, and often against the perimeter.
 */
function crowdedBoard(seed: number): Board {
  const r = rng(seed);
  const size = 9;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const count = 3 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const team = i % 2 === 0 ? 'red' : 'blue';
    // Hug the edges half the time: a wall step has to be reachable to be tested.
    const edge = r() < 0.5;
    let x = edge ? (r() < 0.5 ? 0 : size - 1) : 1 + Math.floor(r() * (size - 2));
    let y = edge ? Math.floor(r() * size) : 1 + Math.floor(r() * (size - 2));
    if (!take(x, y)) continue;
    if (r() < 0.75) {
      const body: Coord[] = [{ x, y }];
      const len = 3 + Math.floor(r() * 3);
      const dirs = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ];
      let d = Math.floor(r() * 4);
      for (let j = 1; j < len; j++) {
        // Occasionally turn, so bodies fold and cells[2..] can sit adjacent to
        // the head — the general case of the own-body rule, not just the neck.
        if (r() < 0.35) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
        const nx = (body[body.length - 1] as Coord).x + (dirs[d] as number[])[0]!;
        const ny = (body[body.length - 1] as Coord).y + (dirs[d] as number[])[1]!;
        if (!take(nx, ny)) break;
        body.push({ x: nx, y: ny });
      }
      snakes.push(
        makeSnake(`u${i}`, body, {
          teamID: team,
          health: 20 + Math.floor(r() * 60),
          orientation: { dx: 1, dy: 0 },
        })
      );
    } else {
      const kinds = ['queen', 'rook', 'bishop', 'knight', 'king', 'pawn'];
      snakes.push(
        piece(`u${i}`, { x, y }, kinds[Math.floor(r() * kinds.length)] as string, 1 + Math.floor(r() * 3), {
          teamID: team,
          health: 30 + Math.floor(r() * 60),
          orientation: { dx: 0, dy: -1 },
        })
      );
    }
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}

const GUARDED = (): GrammarCandidateGenerator =>
  new GrammarCandidateGenerator({ pruneCertainSelfFatal: true, pruneRoyalPath: true });
const SHIPPED = (): GrammarCandidateGenerator =>
  new GrammarCandidateGenerator({ pruneCertainSelfFatal: false, pruneRoyalPath: false });

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------------- the flag

describe('the flag', () => {
  test('a named level names BOTH polarities, so it beats the environment', () => {
    // The whole point of the per-engine override: a seat asked to stay at the
    // shipped build stays there even when the process flag says otherwise.
    expect(knobsForSafety('off')).toEqual({ pruneCertainSelfFatal: false, pruneRoyalPath: false });
    expect(knobsForSafety('guard')).toEqual({ pruneCertainSelfFatal: true, pruneRoyalPath: true });
    expect(knobsForSafety('full')).toEqual({ pruneCertainSelfFatal: true, pruneRoyalPath: true });
  });

  test('parses its four values and keeps the shipped default on anything else', () => {
    // INTEGRATION NOTE (integ/round-a): the default was 'off' on the branch and
    // is 'auto' here — the ledger's ship condition (piece boards only) wired as
    // the default policy. See the `auto` block below.
    expect(stagingSafetyFrom({})).toBe('auto');
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: '' })).toBe('auto');
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: 'off' })).toBe('off');
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: 'auto' })).toBe('auto');
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: 'guard' })).toBe('guard');
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: 'full' })).toBe('full');
    const said: string[] = [];
    expect(stagingSafetyFrom({ CENTAUR_STAGING_SAFETY: 'yes please' }, (m) => said.push(m))).toBe(
      'auto'
    );
    expect(said).toHaveLength(1);
    expect(royalMarginFrom({})).toBe(false);
    expect(royalMarginFrom({ CENTAUR_ROYAL_MARGIN: '1' })).toBe(true);
  });
});

/**
 * `auto` — the default policy, one answer per board class.
 *
 * The ledger shipped this layer for PIECE boards and explicitly not for
 * snake-only ones, where its own no-regression gate failed
 * (r01-snakes6 −0.500 [−0.708, −0.333] against a null of −0.083). That verdict
 * was RE-MEASURED under the basic-intelligence build and did not reproduce, so
 * the snake-only answer is now `guard` rather than `off` — see the flag block
 * in `../staging-safety.ts` and the matrix in docs/BASIC-INTELLIGENCE.md.
 * A blunt on/off flag still cannot carry two answers, so `auto` still resolves
 * per board; what changed is what the snake-only branch resolves TO.
 */
describe('the auto policy answers per board class', () => {
  const snakeOnly = boardOf([
    makeSnake('r1', [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ], { teamID: 'red' }),
    makeSnake('b1', [
      { x: 6, y: 6 },
      { x: 6, y: 7 },
      { x: 6, y: 8 },
    ], { teamID: 'blue' }),
  ]);
  const withPiece = boardOf([
    makeSnake('r1', [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ], { teamID: 'red' }),
    piece('bq', { x: 6, y: 6 }, 'queen', 3, { teamID: 'blue' }),
  ]);

  const bears = (board: Board): boolean => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      return boardBearsPiece(sub);
    } finally {
      sub.release();
    }
  };

  test('reads piece presence off the roster, both polarities', () => {
    expect(bears(snakeOnly)).toBe(false);
    expect(bears(withPiece)).toBe(true);
  });

  test('auto is FULL where the guard was measured to help', () => {
    expect(resolveStagingSafety('auto', true)).toBe('full');
  });

  test('auto is GUARD on a snake-only board — the re-measured answer', () => {
    // `guard`, not `full`: it is the level that removes only what a RULE calls
    // fatal. `full` adds the rung-0 repair, which re-picks on the resolution's
    // PROJECTED casualties, and it measured worse on the sparse board.
    expect(resolveStagingSafety('auto', false)).toBe('guard');
  });

  test('every other level is unconditional — an arm can still ask for either', () => {
    for (const hasPiece of [true, false]) {
      expect(resolveStagingSafety('off', hasPiece)).toBe('off');
      expect(resolveStagingSafety('guard', hasPiece)).toBe('guard');
      expect(resolveStagingSafety('full', hasPiece)).toBe('full');
    }
  });

  test('a caller with no board gets the SNAKE-ONLY answer, never the piece one', () => {
    // knobsForSafety has no board. It must not claim the piece cell's `full`;
    // it gets `guard`, which is what a snake-only board now resolves to, and
    // `guard` and `full` imply the same two candidate knobs anyway — the
    // difference between them is the search core's rung-0 repair.
    expect(knobsForSafety('auto')).toEqual({
      pruneCertainSelfFatal: true,
      pruneRoyalPath: true,
    });
    expect(knobsForSafety('full')).toEqual({
      pruneCertainSelfFatal: true,
      pruneRoyalPath: true,
    });
  });

  /**
   * THE FACT THAT RETIRED THE OLD SNAKE-ONLY VERDICT.
   *
   * That verdict's mechanism was "a per-unit refusal breaks the parallel motion
   * that was accidentally collision-free". Since the certain-self-fatal TIER
   * correction became unconditional (docs/BASIC-INTELLIGENCE.md fix 6) the
   * refusal cannot do that: a certainly-fatal move is already `doomed` and
   * already sorts LAST, so removing it cannot change which option is first —
   * and rung 0 stages `candidates[0]`. Every unit's staged move is therefore
   * the same move with the guard on as with it off.
   */
  test('on a snake-only board the guard changes no unit s ordered-FIRST option', () => {
    const guarded = GUARDED();
    const shipped = SHIPPED();
    let units = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const board = crowdedBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      try {
        if (boardBearsPiece(sub)) continue; // the piece cell is `full`, not this claim
        for (const unit of sub.roster()) {
          const before = shipped.candidatesFor(sub, unit.unitId).candidates;
          const after = guarded.candidatesFor(sub, unit.unitId).candidates;
          if (before.length === 0 || after.length === 0) continue;
          units++;
          expect([seed, unit.unitId, (after[0] as Candidate).to]).toEqual([
            seed,
            unit.unitId,
            (before[0] as Candidate).to,
          ]);
        }
      } finally {
        sub.release();
        clearGeometryCache();
      }
    }
    // The claim is worth nothing if the loop found no snake-only boards.
    expect(units).toBeGreaterThan(50);
  });
});

// ------------------------------------------------------------------- soundness

describe('a refused action really is fatal — through the real resolver', () => {
  test('every certainly-self-fatal candidate kills its own mover, over 120 boards', () => {
    const seen = new Set<string>();
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const board = crowdedBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = GUARDED();
      for (const unit of sub.roster()) {
        const set = gen.candidatesFor(sub, unit.unitId);
        for (const entry of set.prunedLedger) {
          if (entry.prune !== PRUNE.certainSelfFatal) continue;
          const why = certainlySelfFatal(sub, unit, entry.candidate);
          expect(why).not.toBeNull();
          seen.add(why as string);
          // THE CHECK THAT MATTERS. Stage this one unit and nothing else; every
          // other unit is a claim, so no other unit's choice can be what killed
          // it. If the mover comes out alive, the predicate lied.
          const dead = sub.withResolution(
            new Map<UnitId, Candidate>([[unit.unitId, entry.candidate]]),
            sub.teamNumber(unit.teamId),
            ({ resolution }) => resolution.deaths[unit.wireId] !== undefined
          );
          expect([unit.wireId, why, dead]).toEqual([unit.wireId, why, true]);
          checked++;
        }
      }
      sub.release();
    }
    // A guarantee that never fires proves nothing. Both arms must be exercised.
    expect(checked).toBeGreaterThan(50);
    expect(seen).toContain('wall');
    expect(seen).toContain('own-body');
  });

  test('the tail is NOT in the certain set — a length-2 reversal stays offered', () => {
    // cells[len-1] vacates, which is exactly why the corpus finds every
    // length->=3 reversal fatal and every length-2 one harmless.
    const board = boardOf(
      [
        makeSnake(
          'S2',
          [
            { x: 4, y: 4 },
            { x: 3, y: 4 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        makeSnake(
          'S3',
          [
            { x: 4, y: 7 },
            { x: 3, y: 7 },
            { x: 2, y: 7 },
          ],
          { teamID: 'blue', orientation: { dx: 1, dy: 0 } }
        ),
      ],
      { width: 11, height: 11 }
    );
    for (const [wireId, team, expected] of [
      ['S2', 'red', false],
      ['S3', 'blue', true],
    ] as const) {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: team });
      const unit = sub.unitOfWireId(wireId)!;
      const neck = unit.cells[1] as number;
      const set = GUARDED().candidatesFor(sub, unit.unitId);
      const refused = set.prunedLedger.some(
        (e) => e.prune === PRUNE.certainSelfFatal && e.candidate.to === neck
      );
      expect([wireId, refused]).toEqual([wireId, expected]);
      sub.release();
    }
  });

  test("a team-mate's body is refused, and dies when the team-mate holds its shape", () => {
    // Two of ours nose to tail. The mover's only forward step is the ally's
    // mid-body, which cannot vacate whatever the ally does.
    const board = boardOf(
      [
        makeSnake(
          'A',
          [
            { x: 4, y: 4 },
            { x: 4, y: 3 },
            { x: 4, y: 2 },
          ],
          { teamID: 'red', orientation: { dx: 0, dy: 1 } }
        ),
        makeSnake(
          'B',
          [
            { x: 5, y: 3 },
            { x: 6, y: 3 },
            { x: 7, y: 3 },
          ],
          { teamID: 'red', orientation: { dx: -1, dy: 0 } }
        ),
        piece('E', { x: 10, y: 10 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const mover = sub.unitOfWireId('B')!;
    const ally = sub.unitOfWireId('A')!;
    const set = GUARDED().candidatesFor(sub, mover.unitId);
    const refused = set.prunedLedger.filter((e) => e.prune === PRUNE.allyBody);
    expect(refused.length).toBeGreaterThan(0);
    let escapes = 0;
    let checked = 0;
    for (const entry of refused) {
      expect(allyBodyCollision(sub, mover, entry.candidate)).toBe(true);
      // Resolve it against EVERY legal move of the ally. The cell is occupied
      // in each of them, so the mover dies in each of them — which is the
      // quantifier the refusal rests on, checked rather than asserted.
      for (const allyMove of sub.actionsOf(ally.unitId)) {
        const [moverDead, allyDead] = sub.withResolution(
          new Map<UnitId, Candidate>([
            [mover.unitId, entry.candidate],
            [ally.unitId, allyMove],
          ]),
          sub.teamNumber('red'),
          ({ resolution }) => [
            resolution.deaths[mover.wireId] !== undefined,
            resolution.deaths[ally.wireId] !== undefined,
          ]
        );
        // The ONE world the refusal does not own, and it is the one the prune
        // note names: a team-mate that dies leaves a pile settled on weight, not
        // a body settled on tier, and a heavy enough mover wins a pile. Skipped
        // here rather than papered over — and it is why `ally-body` is a policy
        // prune and not part of `certainlySelfFatal`.
        if (allyDead) {
          escapes++;
          continue;
        }
        expect([entry.candidate.to, allyMove.to, moverDead]).toEqual([
          entry.candidate.to,
          allyMove.to,
          true,
        ]);
        checked++;
      }
    }
    // Both branches must actually occur, or the exception above is untested.
    expect(checked).toBeGreaterThan(0);
    expect(escapes).toBeGreaterThan(0);
    sub.release();
  });

  test('a path THROUGH our own king at a winning strength ends the team', () => {
    // The measured shape: not "destination is the king's cell" — the king's own
    // cell had already been thinned out of the queen's option set — but a slide
    // whose RAY crosses it, which the resolver truncates onto the king.
    const board = boardOf(
      [
        piece('K', { x: 4, y: 4 }, 'king', 1, { teamID: 'red' }),
        piece('Q', { x: 4, y: 8 }, 'queen', 4, { teamID: 'red' }),
        piece('E', { x: 0, y: 0 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const queen = sub.unitOfWireId('Q')!;
    const king = sub.unitOfWireId('K')!;
    const set = GUARDED().candidatesFor(sub, queen.unitId);
    const beyond = set.prunedLedger.filter((e) => e.prune === PRUNE.royalPath);
    expect(beyond.length).toBeGreaterThan(0);
    for (const entry of beyond) {
      expect(entry.candidate.path).toContain(king.cells[0] as number);
      expect(killsOwnKing(sub, queen, entry.candidate)).toBe(true);
      // Resolve it with the king explicitly HOLDING — the king has to be a
      // mover in the plan, not a claim, or its death is merely contingent.
      const gone = sub.withResolution(
        new Map<UnitId, Candidate>([
          [queen.unitId, entry.candidate],
          [
            king.unitId,
            { unitId: king.unitId, from: king.cells[0], to: king.cells[0], path: [] },
          ],
        ]),
        sub.teamNumber('red'),
        ({ resolution }) => resolution.deaths[king.wireId] !== undefined
      );
      expect(gone).toBe(true);
    }
    // And the queen keeps every square SHORT of the king.
    const short = set.candidates.some(
      (c) => c.path.length > 0 && !c.path.includes(king.cells[0] as number)
    );
    expect(short).toBe(true);
    sub.release();
  });

  test('a mover the king outweighs is not refused — the rule is the comparator, not the cell', () => {
    const board = boardOf(
      [
        piece('K', { x: 4, y: 4 }, 'king', 5, { teamID: 'red' }),
        piece('P', { x: 4, y: 8 }, 'rook', 1, { teamID: 'red' }),
        piece('E', { x: 0, y: 0 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('P')!;
    const set = GUARDED().candidatesFor(sub, rook.unitId);
    expect(set.prunedLedger.some((e) => e.prune === PRUNE.royalPath)).toBe(false);
    sub.release();
  });
});

// ----------------------------------------------------------------- invariants

describe('the invariants the candidate layer promises still hold', () => {
  test('completeness, non-emptiness and a declared ledger, with the guard on', () => {
    let boards = 0;
    let refusals = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const board = crowdedBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = GUARDED();
      boards++;
      for (const unit of sub.roster()) {
        const set = gen.candidatesFor(sub, unit.unitId);
        expect(set.candidates.length + set.prunedLedger.length).toBe(set.legalCount);
        const seen = new Map<number, number>();
        for (const c of set.candidates) seen.set(c.to, (seen.get(c.to) ?? 0) + 1);
        for (const e of set.prunedLedger) seen.set(e.candidate.to, (seen.get(e.candidate.to) ?? 0) + 1);
        for (const [, n] of seen) expect(n).toBe(1);
        // THE EMPTINESS GUARANTEE — the one a hard filter breaks.
        expect(set.candidates.length).toBeGreaterThan(0);
        for (const e of set.prunedLedger) {
          const id = e.prune as keyof typeof PRUNE_EXACT;
          expect(PRUNE_EXACT[id]).toBe(e.exact);
          expect(typeof PRUNE_NOTES[id]).toBe('string');
          if (
            e.prune === PRUNE.certainSelfFatal ||
            e.prune === PRUNE.allyBody ||
            e.prune === PRUNE.royalPath
          )
            refusals++;
        }
      }
      sub.release();
    }
    expect(boards).toBe(120);
    expect(refusals).toBeGreaterThan(50);
  });

  test('a sealed-in unit gets its options back rather than nothing', () => {
    // Every one of this snake's four steps is fatal: three are its own folded
    // body, the fourth is the wall. The layer must still offer all four.
    const board = boardOf(
      [
        makeSnake(
          'S',
          [
            { x: 0, y: 5 },
            { x: 1, y: 5 },
            { x: 1, y: 4 },
            { x: 0, y: 4 },
            { x: 0, y: 6 },
            { x: 1, y: 6 },
          ],
          { teamID: 'red', orientation: { dx: -1, dy: 0 } }
        ),
        piece('E', { x: 8, y: 8 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('S')!;
    const set = GUARDED().candidatesFor(sub, unit.unitId);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(set.candidates.length + set.prunedLedger.length).toBe(set.legalCount);
    sub.release();
  });

  test('an operator pin onto a refused cell is still reachable through the ledger', () => {
    // `matchPin` reads the ledger after the candidates, so the guard is
    // structurally incapable of overriding a human. Pinned here rather than
    // argued: the destination must be findable.
    const board = boardOf(
      [
        makeSnake(
          'S',
          [
            { x: 4, y: 4 },
            { x: 3, y: 4 },
            { x: 2, y: 4 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        piece('E', { x: 8, y: 8 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const unit = sub.unitOfWireId('S')!;
    const neck = unit.cells[1] as number;
    const set = GUARDED().candidatesFor(sub, unit.unitId);
    expect(set.candidates.some((c) => c.to === neck)).toBe(false);
    const offered = [...set.candidates, ...set.prunedLedger.map((e) => e.candidate)];
    expect(offered.some((c) => c.to === neck)).toBe(true);
    sub.release();
  });
});

// ------------------------------------------------------------------- ordering

describe('the ordering, which is what rung 0 actually reads', () => {
  /**
   * THE ORDERING IS UNCONDITIONAL NOW. It used to be gated on the same knob as
   * the prune, so with the flag off a wall move — assessed `safe`, because the
   * risk layer reads the claim field and the perimeter is terrain — sorted
   * among the safe options and won the last tie-break, which is ascending
   * destination index. That made it the SEED on every snake-only board where
   * `up` was into the wall, and the seed is what gets played. Two recorded
   * games ended with a snake walking off the board because of it
   * (docs/BASIC-INTELLIGENCE.md).
   *
   * So both generators are checked, and both must be clean: the flag now
   * governs whether a certainly-fatal move is REMOVED from the option set, not
   * whether the ordering knows it is fatal.
   */
  test('a certainly-fatal move is never the ordered-first option, at either level', () => {
    let firsts = 0;
    let fatalFirsts = 0;
    let shippedFatalFirsts = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const board = crowdedBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const guarded = GUARDED();
      const shipped = SHIPPED();
      for (const unit of sub.roster()) {
        const a = guarded.candidatesFor(sub, unit.unitId);
        const b = shipped.candidatesFor(sub, unit.unitId);
        const safeExists = b.candidates.some(
          (c) => certainlySelfFatal(sub, unit, c) === null && !allyBodyCollision(sub, unit, c)
        );
        if (!safeExists) continue;
        firsts++;
        const bad = (c: Candidate): boolean =>
          certainlySelfFatal(sub, unit, c) !== null || allyBodyCollision(sub, unit, c);
        if (bad(a.candidates[0] as Candidate)) fatalFirsts++;
        if (bad(b.candidates[0] as Candidate)) shippedFatalFirsts++;
      }
      sub.release();
    }
    expect(firsts).toBeGreaterThan(100);
    expect(fatalFirsts).toBe(0);
    expect(shippedFatalFirsts).toBe(0);
  });

  /**
   * THE CONSERVATISM CLAUSE, as a property rather than as a fixture.
   *
   * "A maybe-fatal path is ordered behind a safe one of equal gain" is what the
   * comparator promises, and it promises something stronger than that: both
   * `orderKey` and `gainOrderKey` compare `tier` FIRST — safe, then atRisk,
   * then doomed — so a risky option sorts behind EVERY safe one whatever the
   * gains are, and the gain terms only ever order within a safety class. That
   * is exactly the direction the owner asked to err in, and it is the property
   * a fixture board cannot pin because it holds for one board.
   *
   * So: over a hundred and twenty crowded boards, every unit's assessed
   * sequence is checked to be non-decreasing in safety class, at both flag
   * levels, and the corpus is checked to actually CONTAIN the transitions —
   * otherwise the assertion is true because everything is safe.
   */
  test('a riskier option never sorts ahead of a safer one — 120 boards, both levels', () => {
    const rank: Record<string, number> = { safe: 0, atRisk: 1, doomed: 2 };
    let sequences = 0;
    let mixed = 0;
    let sawDoomed = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const board = crowdedBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      for (const gen of [GUARDED(), SHIPPED()]) {
        for (const unit of sub.roster()) {
          const assessed = gen.assess(sub, unit.unitId);
          if (assessed.length === 0) continue;
          sequences++;
          const classes = assessed.map((a) => rank[a.tier] as number);
          for (let i = 1; i < classes.length; i++) {
            // Named, so a failure says which board and which unit rather than
            // just "false is not true".
            expect([seed, unit.wireId, i, classes]).toEqual([
              seed,
              unit.wireId,
              i,
              [...classes].sort((x, y) => x - y),
            ]);
          }
          if (new Set(classes).size > 1) mixed++;
          if (classes.includes(2)) sawDoomed++;
        }
      }
      sub.release();
    }
    // The corpus is not vacuous: it really does hold units with a mix of
    // safety classes, and it really does hold doomed options.
    expect(sequences).toBeGreaterThan(200);
    expect(mixed).toBeGreaterThan(5);
    expect(sawDoomed).toBeGreaterThan(5);
  });

  /**
   * `off` still means OFF, and the environment is still what a bare generator
   * reads.
   *
   * This used to compare `bare` against an explicitly-off build under the
   * suite's own environment, on the premise that the no-board default WAS
   * `off`. It is `guard` now — `auto` resolves to the snake-only answer where
   * there is no board to ask — so the premise moved and the claim did not: what
   * the flag promises is that SETTING it off recovers the pre-layer build byte
   * for byte. So the flag is set, and both polarities are checked.
   */
  test('with the flag off the option sets are byte-identical to the shipped build', () => {
    const key = (set: CandidateSet): string =>
      `${set.legalCount}|${set.candidates.map((c) => `${c.to}:${c.path.join('.')}`).join(',')}` +
      `|${set.prunedLedger.map((e) => `${e.candidate.to}:${e.prune}:${e.exact}`).join(',')}`;
    const before = process.env.CENTAUR_STAGING_SAFETY;
    const off = new GrammarCandidateGenerator({
      pruneCertainSelfFatal: false,
      pruneRoyalPath: false,
    });
    const on = new GrammarCandidateGenerator({
      pruneCertainSelfFatal: true,
      pruneRoyalPath: true,
    });
    try {
      for (const [flag, named] of [
        ['off', off],
        ['guard', on],
        ['full', on],
      ] as const) {
        process.env.CENTAUR_STAGING_SAFETY = flag;
        for (let seed = 1; seed <= 60; seed++) {
          const board = crowdedBoard(seed);
          const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
          // `bare` names no knob, so it picks up the environment.
          const bare = new GrammarCandidateGenerator({});
          for (const unit of sub.roster()) {
            expect([flag, key(bare.candidatesFor(sub, unit.unitId))]).toEqual([
              flag,
              key(named.candidatesFor(sub, unit.unitId)),
            ]);
          }
          sub.release();
        }
      }
    } finally {
      if (before === undefined) delete process.env.CENTAUR_STAGING_SAFETY;
      else process.env.CENTAUR_STAGING_SAFETY = before;
    }
  });
});

// ------------------------------------------------------------- rung-0 repair

const OURS = 0;
const THEIRS = 1;

/** Two of ours, one heavy enough to kill the other by stepping on it. */
const FRATRICIDE: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'rook', occupancy: [3 * 7 + 1, 3 * 7 + 1, 3 * 7 + 1], energy: 60 },
    { id: 2, team: OURS, type: 'rook', occupancy: [3 * 7 + 4], energy: 60 },
    { id: 3, team: THEIRS, type: 'knight', occupancy: [0], energy: 60 },
  ],
};

/**
 * A generator that puts a NAMED destination first for a named unit and is
 * otherwise the testkit's own. This is the shape rung 0 actually meets: the
 * ordering hands it a plan and rung 0 stages it unexamined.
 */
function generatorForcing(first: ReadonlyMap<UnitId, number>, inner = makeGenerator()) {
  return {
    candidatesFor(sub: never, id: UnitId, purpose?: 'ours' | 'adversary'): CandidateSet {
      const set = inner.candidatesFor(sub, id, purpose);
      const to = first.get(id);
      if (to === undefined) return set;
      const hit = set.candidates.find((c) => c.to === to);
      if (hit === undefined) return set;
      return { ...set, candidates: [hit, ...set.candidates.filter((c) => c !== hit)] };
    },
  } as unknown as SearchContext['gen'];
}

function conformWith(
  spec: BoardSpec,
  gen: SearchContext['gen'],
  onEvaluate?: () => void
): { plan: JointPlan; ourDead: ReadonlyArray<UnitId>; close(): void } {
  const board = makeTestBoard(spec);
  const sub = makeTestSubstrate(board, OURS);
  const inner = makeEvaluator();
  const evaluate = {
    scorePlan: (...args: Parameters<typeof inner.scorePlan>) => {
      onEvaluate?.();
      return inner.scorePlan(...args);
    },
    evaluatePlan: inner.evaluatePlan?.bind(inner),
  } as unknown as SearchContext['evaluate'];
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate,
    asTeam: OURS,
    pins: [],
    assumptions: [],
    incumbent: null,
    witnesses: [],
    budget: unboundedBudget(),
  };
  const core = makeSearchCore();
  const plan = core.conform(ctx, new Map());
  const ours = new Set(spec.units.filter((u) => u.team === OURS).map((u) => u.id as UnitId));
  const ourDead = sub.withResolution(plan, OURS, ({ resolution }) =>
    Object.keys(resolution.deaths)
      .map((wireId) => sub.unitIdOf(wireId))
      .filter((id): id is UnitId => id !== undefined && ours.has(id))
  );
  return {
    plan,
    ourDead,
    close: () => {
      core.release?.();
      sub.release();
    },
  };
}

describe('rung 0 reads the verdict it already paid for', () => {
  const victimCell = 3 * 7 + 4;
  // Unit 1 walks onto unit 2's square; unit 2 is forced to hold there, so the
  // collision is real rather than two units passing.
  const forced = new Map<UnitId, number>([
    [1, victimCell],
    [2, victimCell],
  ]);

  test('with the flag off the seed goes out as staged, casualty and all', () => {
    process.env.CENTAUR_STAGING_SAFETY = 'off';
    const h = conformWith(FRATRICIDE, generatorForcing(forced));
    expect(h.plan.get(1)?.to).toBe(victimCell);
    // The negative control the repair is measured against: the first staged set
    // of the turn kills one of our own units, and rung 0 emits it anyway.
    expect(h.ourDead.length).toBeGreaterThan(0);
    h.close();
  });

  test('with the flag full the self-harm is repaired before the first emission', () => {
    process.env.CENTAUR_STAGING_SAFETY = 'full';
    const h = conformWith(FRATRICIDE, generatorForcing(forced));
    // Either the killer moved or the victim did — what the repair owes is the
    // OUTCOME, not a particular edit.
    expect(h.ourDead).toEqual([]);
    // Still a complete plan over exactly the units we command.
    expect([...h.plan.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    h.close();
  });

  test('the seed reserves what it has spent: two of ours never start on one cell', () => {
    // Both units' ordered-first option names the same square. The candidate
    // layer is per unit and cannot see that; the seed can.
    const shared = 3 * 7 + 3;
    const both = new Map<UnitId, number>([
      [1, shared],
      [2, shared],
    ]);
    process.env.CENTAUR_STAGING_SAFETY = 'off';
    const off = conformWith(FRATRICIDE, generatorForcing(both));
    expect(off.plan.get(1)?.to).toBe(shared);
    expect(off.plan.get(2)?.to).toBe(shared);
    off.close();

    process.env.CENTAUR_STAGING_SAFETY = 'guard';
    const on = conformWith(FRATRICIDE, generatorForcing(both));
    expect(on.plan.get(1)?.to === shared && on.plan.get(2)?.to === shared).toBe(false);
    // Still complete, still legal, and no casualty of ours.
    expect([...on.plan.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(on.ourDead).toEqual([]);
    on.close();
  });

  test('a clean seed costs the SAME number of evaluations with the repair on', () => {
    // The O(1)-price guarantee rung 0 is built on: no casualties, no work.
    const clean: BoardSpec = {
      width: 9,
      height: 9,
      units: [
        { id: 1, team: OURS, type: 'rook', occupancy: [1], energy: 60 },
        { id: 2, team: OURS, type: 'rook', occupancy: [9 * 8 + 7], energy: 60 },
        { id: 3, team: THEIRS, type: 'knight', occupancy: [9 * 4 + 4], energy: 60 },
      ],
    };
    const counts: number[] = [];
    for (const flag of ['off', 'full']) {
      process.env.CENTAUR_STAGING_SAFETY = flag;
      let n = 0;
      const h = conformWith(clean, makeGenerator(), () => n++);
      h.close();
      counts.push(n);
    }
    expect(counts[0]).toBe(counts[1]);
  });

  afterEach(() => {
    delete process.env.CENTAUR_STAGING_SAFETY;
  });
});

// -------------------------------------------------------------- royal margin

describe('the royal margin counts every reacher, not only the enemy ones', () => {
  test('a team-mate that can stand on the king next turn moves the margin', () => {
    const board = boardOf(
      [
        piece('K', { x: 4, y: 4 }, 'king', 1, { teamID: 'red' }),
        piece('Q', { x: 4, y: 6 }, 'queen', 4, { teamID: 'red' }),
        piece('E', { x: 10, y: 10 }, 'knight', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const read = (on: boolean): number => {
      if (on) process.env.CENTAUR_ROYAL_MARGIN = '1';
      else delete process.env.CENTAUR_ROYAL_MARGIN;
      const { makeContext, kingMarginFeature } = require('../evaluate') as typeof import('../evaluate');
      const sub: EngineSubstrate = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const plan = new Map<UnitId, Candidate>();
      for (const u of sub.roster()) {
        if (u.teamId !== 'red') continue;
        plan.set(u.unitId, { unitId: u.unitId, from: u.cells[0], to: u.cells[0], path: [] });
      }
      const out = sub.withResolution(plan, sub.teamNumber('red'), ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, sub.teamNumber('red'), 4);
        return kingMarginFeature.evaluate(ctx).lo;
      });
      sub.release();
      clearGeometryCache();
      return out;
    };
    const off = read(false);
    const on = read(true);
    // The enemy knight is far away, so with only enemies counted the margin is
    // the king's whole weight; with the queen counted it is negative — the king
    // can be taken next turn, by us.
    expect(off).toBeGreaterThan(0);
    expect(on).toBeLessThan(off);
    expect(on).toBeLessThanOrEqual(0);
  });

  afterEach(() => {
    delete process.env.CENTAUR_ROYAL_MARGIN;
  });
});
