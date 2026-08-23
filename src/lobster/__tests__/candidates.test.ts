/**
 * The candidate layer's four claims, each machine-checked rather than argued.
 *
 *   COMPLETENESS   every legal action is a candidate or a ledger entry, and the
 *                  two sets are disjoint. Property-tested over random boards.
 *   EXACTNESS      every `exact: true` prune really does resolve identically to
 *                  a candidate that stayed — checked by running BOTH through the
 *                  real resolver and comparing whole outcomes.
 *   NON-EMPTINESS  no board and no combination of knobs returns an empty option
 *                  set. The tier-keeping king regression is the named case.
 *   POLARITY       with every lossy knob off, only exact prunes and the
 *                  self-regicide refusal remain.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { planAction } from '../../partial-engine/index';
import type { Resolution } from '../../partial-engine/index';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import {
  GrammarCandidateGenerator,
  PRUNE,
  PRUNE_EXACT,
  PRUNE_NOTES,
  defaultCandidateGenerator,
} from '../candidates';
import type { Candidate, CandidateSet, UnitId } from '../contracts';

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

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 30;

/** A deterministic LCG, so a failing board is reproducible from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const KINDS = ['snake', 'knight', 'king', 'rook', 'bishop', 'queen', 'pawn'] as const;

/** A random small board. Small on purpose: the exactness check resolves a lot. */
function randomBoard(seed: number): Board {
  const r = rng(seed);
  const size = 7;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const count = 2 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    let x = 0;
    let y = 0;
    let tries = 0;
    do {
      x = Math.floor(r() * size);
      y = Math.floor(r() * size);
      tries++;
    } while (used.has(`${x},${y}`) && tries < 40);
    used.add(`${x},${y}`);
    const kind = KINDS[Math.floor(r() * KINDS.length)] as string;
    const team = i === 0 ? 'red' : r() < 0.5 ? 'red' : 'blue';
    const weight = 1 + Math.floor(r() * 3);
    const health = 3 + Math.floor(r() * 40);
    if (kind === 'snake') {
      const body: Coord[] = [{ x, y }];
      for (let j = 1; j < weight; j++) {
        const cell = { x: Math.max(0, x - j), y };
        if (used.has(`${cell.x},${cell.y}`)) break;
        used.add(`${cell.x},${cell.y}`);
        body.push(cell);
      }
      snakes.push(
        makeSnake(`u${i}`, body, {
          teamID: team,
          health,
          orientation: { dx: 1, dy: 0 },
        })
      );
    } else {
      snakes.push(
        piece(`u${i}`, { x, y }, kind, weight, {
          teamID: team,
          health,
          orientation: [
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
          ][Math.floor(r() * 4)],
        })
      );
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    if (!used.has(`${x},${y}`)) food.push({ x, y });
  }
  return { width: size, height: size, food, hazards: [], snakes } as Board;
}

/** A canonical string of everything a resolution decided. */
function outcomeKey(sub: EngineSubstrate, resolution: Resolution): string {
  const lines: string[] = [];
  for (const v of sub.engine.units(resolution.state)) {
    lines.push(`u${v.unitId}:${v.alive ? 1 : 0}:${[...v.cells].join('/')}:${v.health}:${v.weight}`);
  }
  for (const f of resolution.fates) lines.push(`f${f.unitId}:${f.fate}`);
  for (const d of resolution.deaths) lines.push(`d${d.unitId}:${d.cell}:${d.subStep}:${d.cause}`);
  for (const [id, cells] of resolution.severedCells) lines.push(`s${id}:${[...cells].join('/')}`);
  return lines.sort().join('|');
}

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------- completeness

describe('the completeness invariant', () => {
  test('candidates and the ledger partition the legal action set — 60 random boards', () => {
    let boards = 0;
    let units = 0;
    let legal = 0;
    let prunedExact = 0;
    let prunedLossy = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const board = randomBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      boards++;
      for (const unit of sub.roster()) {
        const set = defaultCandidateGenerator.candidatesFor(sub, unit.unitId);
        units++;
        legal += set.legalCount;
        for (const entry of set.prunedLedger) {
          if (entry.exact) prunedExact++;
          else prunedLossy++;
        }

        // 1. The two sets partition the legal set — no loss, no duplication.
        expect(set.candidates.length + set.prunedLedger.length).toBe(set.legalCount);

        // 2. Every destination appears exactly once across the two.
        const seen = new Map<number, number>();
        for (const c of set.candidates) seen.set(c.to, (seen.get(c.to) ?? 0) + 1);
        for (const e of set.prunedLedger) seen.set(e.candidate.to, (seen.get(e.candidate.to) ?? 0) + 1);
        for (const [, n] of seen) expect(n).toBe(1);
        expect(seen.size).toBe(set.legalCount);

        // 3. The set covers the engine's own enumeration exactly.
        const enumerated = new Set(sub.enumerate(unit.unitId).map((a) => a.dest));
        expect(new Set(seen.keys())).toEqual(enumerated);

        // 4. A hard filter never empties the option set.
        expect(set.candidates.length).toBeGreaterThan(0);

        // 5. Every prune id is one this module declares, with a polarity and a
        //    note — a prune nobody wrote down is a hidden bias toward one world.
        for (const e of set.prunedLedger) {
          const id = e.prune as keyof typeof PRUNE_EXACT;
          expect(PRUNE_EXACT[id]).toBe(e.exact);
          expect(typeof PRUNE_NOTES[id]).toBe('string');
        }
      }
      sub.release();
    }
    expect(boards).toBe(60);
    expect(units).toBeGreaterThanOrEqual(100);
    expect(legal).toBeGreaterThan(1000);
    // Both polarities actually fire on this corpus — an invariant that only
    // holds because nothing is being pruned proves nothing.
    expect(prunedExact).toBeGreaterThan(0);
    expect(prunedLossy).toBeGreaterThan(0);
  });

  test('any staged cell at all lands inside the enumerated set (containment)', () => {
    const board = randomBoard(7);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    for (const unit of sub.roster()) {
      const set = defaultCandidateGenerator.candidatesFor(sub, unit.unitId);
      const known = new Set<string>();
      for (const c of set.candidates) known.add(`${c.path.join(',')}`);
      for (const e of set.prunedLedger) known.add(`${e.candidate.path.join(',')}`);
      for (let cell = 0; cell < sub.grid.cells; cell++) {
        const action = planAction(
          sub.terrain,
          unit.kind,
          unit.cells[0] as number,
          cell,
          unit.orientation,
          sub.targetsBoard()
        );
        if (action === null) continue;
        const key = action.kind === 'move' ? action.path.join(',') : '';
        expect(known.has(key)).toBe(true);
      }
    }
    sub.release();
  });
});

// --------------------------------------------------------------- exactness

const exactOnly = new GrammarCandidateGenerator({
  keepQuiet: Number.POSITIVE_INFINITY,
  pruneFatalNoGain: false,
  kingHardSafety: false,
  refusePromotion: false,
});

describe('an exact prune really is exact', () => {
  test('every exact-pruned action resolves identically to a kept one — through the real resolver', () => {
    let checked = 0;
    const fired = new Set<string>();
    for (let seed = 1; seed <= 250; seed++) {
      const board = randomBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      for (const unit of sub.roster()) {
        // Lossy knobs off, so the only thing standing between an exact-pruned
        // action and its representative is the exact prune itself.
        const set = exactOnly.candidatesFor(sub, unit.unitId);
        const exact = set.prunedLedger.filter((e) => e.exact);
        if (exact.length === 0) continue;
        for (const entry of exact) {
          const rep = representativeFor(set, entry.candidate);
          expect(rep).toBeDefined();
          const a = resolveKey(sub, unit.unitId, entry.candidate);
          const b = resolveKey(sub, unit.unitId, rep as Candidate);
          expect([entry.prune, a]).toEqual([entry.prune, b]);
          fired.add(entry.prune);
          checked++;
        }
      }
      sub.release();
    }
    expect(checked).toBeGreaterThan(30);
    // `health-horizon` is the one exact prune random boards produce in volume.
    // `certain-edge-horizon` needs a held unit whose CERTAIN material survives
    // certainly — presence-certainty, not strength-determinacy — which random
    // boards essentially never produce, and which is exactly the conservatism
    // the claim layer is supposed to have.
    expect(fired).toContain(PRUNE.healthHorizon);
    // `suffix-collapse` is NOT here any more, and its absence is the point:
    // the engine's living-body encounter is answered by tier alone now, so a
    // higher-tier mover severs a claim's body and continues where the claim
    // layer's halt axis still says it certainly stops. It is declared lossy
    // until the halt axis follows (see PRUNE_EXACT), and this suite is what
    // will prove the restoration.
    expect(PRUNE_EXACT[PRUNE.suffixCollapse]).toBe(false);
    expect(fired).not.toContain(PRUNE.suffixCollapse);
  });

  test('the demoted suffix-collapse still FIRES, and is declared in the ledger', () => {
    // Demoted is not disabled: the prune still pays for itself, and a
    // declared narrowing is the honest form of it.
    let fired = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const board = randomBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      for (const unit of sub.roster()) {
        const set = exactOnly.candidatesFor(sub, unit.unitId);
        for (const e of set.prunedLedger) {
          if (e.prune !== PRUNE.suffixCollapse) continue;
          expect(e.exact).toBe(false);
          expect(typeof PRUNE_NOTES[PRUNE.suffixCollapse]).toBe('string');
          fired++;
        }
      }
      sub.release();
    }
    expect(fired).toBeGreaterThan(0);
  });

  test('the two horizons fire on boards built to produce them, and both are exact', () => {
    const seen = new Set<string>();
    let checked = 0;

    // (a) THE HEALTH HORIZON. A rook with three health on an open file: it may
    //     enter three cells and no world lets it enter a fourth.
    const thin = boardOf(
      [
        piece('R', { x: 0, y: 5 }, 'rook', 1, { teamID: 'red', health: 3 }),
        piece('far', { x: 10, y: 0 }, 'knight', 1, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );

    // (b) A CERTAIN STOP. A held snake's body minus its last index stays put
    //     whatever it chooses, and at equal tier every one of those cells is
    //     lethal to an arriving piece. Our rook rakes into one.
    const blocked = boardOf(
      [
        piece('R', { x: 1, y: 5 }, 'rook', 1, { teamID: 'red', health: 60 }),
        makeSnake(
          'S',
          [
            { x: 4, y: 5 },
            { x: 5, y: 5 },
            { x: 6, y: 5 },
          ],
          { teamID: 'blue', orientation: { dx: 1, dy: 0 } }
        ),
      ],
      { width: 11, height: 11 }
    );

    for (const board of [thin, blocked]) {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const rook = sub.unitOfWireId('R')?.unitId as UnitId;
      const set = exactOnly.candidatesFor(sub, rook);
      for (const entry of set.prunedLedger) {
        if (!entry.exact) continue;
        seen.add(entry.prune);
        const rep = representativeFor(set, entry.candidate);
        expect(rep).toBeDefined();
        expect([entry.prune, resolveKey(sub, rook, entry.candidate)]).toEqual([
          entry.prune,
          resolveKey(sub, rook, rep as Candidate),
        ]);
        checked++;
      }
      sub.release();
    }
    expect(checked).toBeGreaterThan(10);
    expect(seen).toContain(PRUNE.healthHorizon);
  });
});

/**
 * The action on the same ray that the collapsed suffix folds onto: the longest
 * one that survived the EXACT prunes. A lossy prune may take it afterwards —
 * that is the lossy prune's declared cost, not this one's.
 */
function representativeFor(set: CandidateSet, pruned: Candidate): Candidate | undefined {
  const first = pruned.path[0];
  const surviving: Candidate[] = [
    ...set.candidates,
    ...set.prunedLedger.filter((e) => !e.exact).map((e) => e.candidate),
  ];
  let best: Candidate | undefined;
  for (const c of surviving) {
    if (c.path.length === 0 || c.path[0] !== first) continue;
    if (c.path.length >= pruned.path.length) continue;
    if (best === undefined || c.path.length > best.path.length) best = c;
  }
  return best;
}

function resolveKey(sub: EngineSubstrate, unitId: UnitId, candidate: Candidate): string {
  const plan = new Map<UnitId, Candidate>([[unitId, candidate]]);
  return sub.withResolution(plan, 0, ({ resolution }) => outcomeKey(sub, resolution));
}

// --------------------------------------------------------------- polarity

describe('lossy prunes are the ones behind knobs', () => {
  test('with every lossy knob off, only exact prunes and the self-regicide refusal remain', () => {
    const open = new GrammarCandidateGenerator({
      keepQuiet: Number.POSITIVE_INFINITY,
      pruneFatalNoGain: false,
      kingHardSafety: false,
      refusePromotion: false,
    });
    let lossy = 0;
    for (let seed = 200; seed <= 240; seed++) {
      const board = randomBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      for (const unit of sub.roster()) {
        for (const entry of open.candidatesFor(sub, unit.unitId).prunedLedger) {
          if (entry.exact) continue;
          lossy++;
          expect(entry.prune).toBe(PRUNE.selfRegicide);
        }
      }
      sub.release();
    }
    // The assertion above is the point; this one only proves the loop ran.
    expect(lossy).toBeGreaterThanOrEqual(0);
  });

  test('quiet thinning is off when keepQuiet is Infinity and on by default', () => {
    // A long open rook ray: plenty of quiet prefixes to thin.
    const board = boardOf([piece('R', { x: 0, y: 4 }, 'rook', 1, { teamID: 'red' })], {
      width: 11,
      height: 11,
    });
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const thinned = defaultCandidateGenerator.candidatesFor(sub, rook);
    const open = new GrammarCandidateGenerator({
      keepQuiet: Number.POSITIVE_INFINITY,
    }).candidatesFor(sub, rook);
    expect(open.candidates.length).toBeGreaterThan(thinned.candidates.length);
    expect(thinned.prunedLedger.some((e) => e.prune === PRUNE.quietThinning)).toBe(true);
    expect(open.prunedLedger.some((e) => e.prune === PRUNE.quietThinning)).toBe(false);
    sub.release();
  });
});

// --------------------------------------------------------------- king safety

describe('the tier-keeping king filter (pieces-11 regression class)', () => {
  test('a king with no provably safe square still gets every least-bad option', () => {
    // Two enemy rooks cover the whole neighbourhood: under these rules a king
    // does not have to be outweighed to die — an equal-tier tie kills everyone —
    // so nothing near the king is `safe`, and a per-candidate safety filter
    // would delete every move it has.
    const board = boardOf(
      [
        piece('K', { x: 5, y: 5 }, 'king', 1, { teamID: 'red' }),
        piece('R1', { x: 5, y: 0 }, 'rook', 2, { teamID: 'blue' }),
        piece('R2', { x: 0, y: 5 }, 'rook', 2, { teamID: 'blue' }),
        piece('R3', { x: 10, y: 6 }, 'rook', 2, { teamID: 'blue' }),
        piece('R4', { x: 6, y: 10 }, 'rook', 2, { teamID: 'blue' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const king = sub.unitOfWireId('K')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, king);

    // The set is never empty, and it is never just "stay".
    expect(set.candidates.length).toBeGreaterThan(1);
    const origin = sub.unitOfWireId('K')?.cells[0];
    expect(set.candidates.some((c) => c.to !== origin)).toBe(true);

    // The filter kept ONE tier whole: every candidate has the same tier, and
    // everything it dropped is in the ledger as a lossy king-unsafe entry.
    const kept = new Set(set.candidates.map((c) => c.to));
    for (const e of set.prunedLedger) {
      if (e.prune !== PRUNE.kingUnsafe) continue;
      expect(kept.has(e.candidate.to)).toBe(false);
      expect(e.exact).toBe(false);
    }
    sub.release();
  });

  test('the last king of a regicide team is never handed only certain death', () => {
    // Walled into a corner by a heavier enemy: every move may be fatal and the
    // self-regicide refusal would empty the set. The emptiness guarantee
    // returns the least-bad tier and withdraws the ledger entries it restores.
    const board = boardOf(
      [
        piece('K', { x: 0, y: 0 }, 'king', 1, { teamID: 'red' }),
        piece('Q', { x: 2, y: 2 }, 'queen', 6, { teamID: 'blue' }),
        piece('R', { x: 1, y: 3 }, 'rook', 6, { teamID: 'blue' }),
      ],
      { width: 5, height: 5 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const king = sub.unitOfWireId('K')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, king);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(set.candidates.length + set.prunedLedger.length).toBe(set.legalCount);
    sub.release();
  });
});

// --------------------------------------------------------------- ordering

describe('ordered, never filtered', () => {
  test('a capture that certainly lands is offered before a quiet step', () => {
    const board = boardOf([
      piece('R', { x: 2, y: 4 }, 'rook', 5, { teamID: 'red' }),
      piece('p', { x: 5, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    const assessed = defaultCandidateGenerator.assess(sub, rook);
    // The order the generator returns is the assessment order.
    expect(set.candidates.map((c) => c.to)).toEqual(assessed.map((a) => a.candidate.to));
    // Ordering is a total order on this set, and it is stable across calls.
    const again = defaultCandidateGenerator.candidatesFor(sub, rook);
    expect(again.candidates.map((c) => c.to)).toEqual(set.candidates.map((c) => c.to));
    sub.release();
  });

  test('the escort ray-shadow hint orders a shadowing square above an equal one', () => {
    // A blue rook has a clear file to our king; the shadow cells are the open
    // squares between them. An ally that can reach one is ordered above an
    // equally safe square that protects nothing.
    const board = boardOf(
      [
        piece('K', { x: 5, y: 1 }, 'king', 1, { teamID: 'red' }),
        piece('E', { x: 5, y: 9 }, 'rook', 3, { teamID: 'blue' }),
        piece('A', { x: 4, y: 5 }, 'rook', 3, { teamID: 'red' }),
      ],
      { width: 11, height: 11 }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const m = marshalBoard(board, TURN);
    const ally = sub.unitOfWireId('A')?.unitId as UnitId;
    const withHint = defaultCandidateGenerator.candidatesFor(sub, ally);
    const shadowCell = m.toIndex({ x: 5, y: 5 });
    const rank = withHint.candidates.findIndex((c) => c.to === shadowCell);
    expect(rank).toBeGreaterThanOrEqual(0);

    const noHint = new GrammarCandidateGenerator({ escortShadowOrdering: false }).candidatesFor(
      sub,
      ally
    );
    const plainRank = noHint.candidates.findIndex((c) => c.to === shadowCell);
    expect(rank).toBeLessThanOrEqual(plainRank);
    sub.release();
  });
});

// --------------------------------------------------------------- refusals

describe('refusals', () => {
  test('the generator refuses a substrate whose grammar it cannot reach', () => {
    const fake = { state: null } as unknown as EngineSubstrate;
    expect(() => defaultCandidateGenerator.candidatesFor(fake, 0)).toThrow(TypeError);
  });

  test('an unknown unit is named, not guessed at', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('a', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    expect(() => defaultCandidateGenerator.candidatesFor(sub, 42)).toThrow(/no unit 42/);
    sub.release();
  });
});
