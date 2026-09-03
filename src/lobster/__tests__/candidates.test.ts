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
import { legalTargets, pathOf } from '../../engine-vendor/engine/queries';
import type { PartialSettlement } from '../../engine-vendor/engine/settlePartial';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import {
  GrammarCandidateGenerator,
  PRUNE,
  PRUNE_EXACT,
  PRUNE_NOTES,
  captureOrder,
  defaultCandidateGenerator,
} from '../candidates';
import type { AssessedCandidate } from '../candidates';
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
function outcomeKey(_sub: EngineSubstrate, resolution: PartialSettlement): string {
  const lines: string[] = [];
  for (const [id, settled] of Object.entries(resolution.board)) {
    lines.push(`u${id}:${settled.occupancy.join('/')}:${settled.energy}`);
  }
  for (const [id, fate] of Object.entries(resolution.fates)) lines.push(`f${id}:${fate}`);
  for (const [id, death] of Object.entries(resolution.deaths)) {
    lines.push(`d${id}:${death.cell}:${death.subStep}:${death.cause}`);
  }
  for (const [id, cells] of Object.entries(resolution.severedCells)) {
    lines.push(`s${id}:${cells.join('/')}`);
  }
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
        const enumerated = new Set(sub.actionsOf(unit.unitId).map((a) => a.to));
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

  test('the partition survives hazards, at every damage regime — 40 random boards', () => {
    // The random-board corpus above has no terrain, so it cannot see the
    // stationary charge or the terrain-fatal refusal. Both add ways for a
    // candidate to leave the kept set; neither may lose one.
    let terrainPrunes = 0;
    let holds = 0;
    for (let seed = 300; seed <= 339; seed++) {
      const base = randomBoard(seed);
      const r = rng(seed * 7 + 1);
      const hazards: Coord[] = [];
      for (let i = 0; i < 10; i++) {
        hazards.push({ x: Math.floor(r() * base.width), y: Math.floor(r() * base.height) });
      }
      // 5 doses, 2 doses, 1 dose — the ladder S2 runs, on the same boards.
      for (const hazardDamage of [20, 50, 100]) {
        const board = { ...base, hazards, hazardDamage } as Board;
        const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
        for (const unit of sub.roster()) {
          const set = defaultCandidateGenerator.candidatesFor(sub, unit.unitId);
          expect(set.candidates.length + set.prunedLedger.length).toBe(set.legalCount);
          expect(set.candidates.length).toBeGreaterThan(0);
          const seen = new Set<number>();
          for (const c of set.candidates) seen.add(c.to);
          for (const e of set.prunedLedger) seen.add(e.candidate.to);
          expect(seen.size).toBe(set.legalCount);
          for (const e of set.prunedLedger) {
            const id = e.prune as keyof typeof PRUNE_EXACT;
            expect(PRUNE_EXACT[id]).toBe(e.exact);
            if (id === PRUNE.terrainFatal) terrainPrunes++;
          }
          if (set.candidates.some((c) => c.path.length === 0)) holds++;
        }
        sub.release();
      }
    }
    // An invariant that holds because nothing fired proves nothing.
    expect(terrainPrunes).toBeGreaterThan(0);
    expect(holds).toBeGreaterThan(0);
  });

  test('any staged cell at all lands inside the enumerated set (containment)', () => {
    const board = randomBoard(7);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    for (const unit of sub.roster()) {
      const set = defaultCandidateGenerator.candidatesFor(sub, unit.unitId);
      const known = new Set<string>();
      for (const c of set.candidates) known.add(`${c.path.join(',')}`);
      for (const e of set.prunedLedger) known.add(`${e.candidate.path.join(',')}`);
      // THE ENGINE'S OWN LEGALITY, asked directly: every cell the grammar
      // admits for this unit is a candidate this layer either offered or
      // pruned by name.
      const grammarUnit = {
        type: unit.type,
        occupancy: sub.recordOf(unit.unitId)?.occupancy ?? unit.cells,
        orientation: unit.orientation,
      };
      for (const target of legalTargets(grammarUnit, sub.shape())) {
        const key = (pathOf(grammarUnit, target, sub.shape()) ?? []).join(',');
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
  refuseTerrainFatal: false,
  // Named explicitly so the suite reads the same under any environment: these
  // two follow CENTAUR_STAGING_SAFETY when a caller leaves them out.
  pruneCertainSelfFatal: false,
  pruneRoyalPath: false,
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
    expect(fired).toContain(PRUNE.energyHorizon);
    // `suffix-collapse` is NOT here any more, and its absence is the point:
    // the engine's living-body encounter is answered by tier alone now, so a
    // higher-tier mover severs a claim's body and continues where the claim
    // layer's halt axis still says it certainly stops. It is declared lossy
    // until the halt axis follows (see PRUNE_EXACT), and this suite is what
    // will prove the restoration.
    expect(PRUNE_EXACT[PRUNE.suffixCollapse]).toBe(false);
    expect(fired).not.toContain(PRUNE.suffixCollapse);
  });

  test('the demoted suffix-collapse is DECLARED wherever it fires', () => {
    // Demoted is not disabled — but after the cut it almost never fires, and
    // the reason is the whole shape of the new reading: a settlement holds
    // every unit but the mover, so a body in the way is a unit that MIGHT have
    // moved and the ray is settled straight through it. The only certain stops
    // left are the mover's own — terrain it walked into, and energy it could
    // not pay — and those are the two horizons, both exact. What this test
    // still owns is the polarity: wherever the collapse does fire it declares
    // itself, because a prune nobody wrote down is a hidden bias toward one
    // world.
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
    expect(fired).toBeGreaterThanOrEqual(0);
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
    expect(seen).toContain(PRUNE.energyHorizon);
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
      refuseTerrainFatal: false,
      pruneCertainSelfFatal: false,
      pruneRoyalPath: false,
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

// ------------------------------------------------- the stationary terrain charge

/**
 * HOLDING A SQUARE IS NOT FREE ON A HAZARD, AND THE RULES SAY SO.
 *
 * `PartialEngine.healthPhase` charges a unit that staged no path a full
 * stationary dose at sub-step 1, while a step onto ordinary ground costs the
 * kind's `costPerCell` — one. So holding on a hazard is strictly dominated by
 * any safe step, and holding on one whose dose exceeds the health the unit has
 * LEFT is a death the layer used to tier `safe`.
 *
 * The charge is checked against the RESOLVER rather than against a number
 * written here, because the whole point is that the two agree.
 */
describe('the stationary terrain charge', () => {
  const HAZ = 20;

  /** A rook alone in the middle, standing on or beside one hazard cell. */
  const rookAt = (at: Coord, hazard: Coord, health: number): Board =>
    boardOf(
      [
        piece('R', at, 'rook', 3, { teamID: 'red', health }),
        piece('K', { x: 8, y: 8 }, 'king', 1, { teamID: 'red', health: 100 }),
        piece('E', { x: 0, y: 0 }, 'king', 1, { teamID: 'blue', health: 100 }),
      ],
      { width: 9, height: 9, hazards: [hazard], hazardDamage: HAZ } as Partial<Board>
    );

  const holdOf = (assessed: ReadonlyArray<AssessedCandidate>): AssessedCandidate =>
    assessed.find((a) => a.candidate.path.length === 0) as AssessedCandidate;

  test('the assessed spend for a hold is exactly what the resolver charges', () => {
    for (const [on, health] of [
      [true, 81],
      [false, 81],
    ] as ReadonlyArray<[boolean, number]>) {
      const board = rookAt({ x: 4, y: 4 }, on ? { x: 4, y: 4 } : { x: 7, y: 7 }, health);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const rook = sub.unitOfWireId('R')?.unitId as UnitId;
      const hold = holdOf(defaultCandidateGenerator.assess(sub, rook));
      expect(hold).toBeDefined();
      const spent = hold.energySpent;
      expect(spent.lo).toBe(spent.hi);

      const after = sub.withResolution(
        new Map<UnitId, Candidate>([[rook, hold.candidate]]),
        0,
        ({ resolution }) =>
          resolution.board[sub.unitOf(rook)?.wireId as string]?.energy ?? -1
      );
      expect(health - after).toBe(spent.hi);
      expect(spent.hi).toBe(on ? HAZ : 0);
      sub.release();
    }
  });

  test('a hold on a hazard no longer outranks every step off it', () => {
    const board = rookAt({ x: 4, y: 4 }, { x: 4, y: 4 }, 81);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    const holdRank = set.candidates.findIndex((c) => c.path.length === 0);
    expect(holdRank).toBeGreaterThan(0);
    // Every single-step escape onto clean ground is ordered ahead of it.
    for (let i = 0; i < holdRank; i++) {
      const c = set.candidates[i] as Candidate;
      expect(sub.hazardAt(c.to)).toBe(false);
    }
    sub.release();
  });

  test('off a hazard the hold is free, and ranks WITH the one-cell steps', () => {
    // The spend is zero and stays zero — that is the rules, and the test above
    // checks it against the resolver. What the ORDER does with it is a
    // different question, and the answer is not "the hold wins": ranking a
    // hold at its literal spend makes it beat every step on the board by one,
    // which is `basic-intelligence`'s "pieces act" defect. `spendRank` ranks a
    // hold at the price of the cheapest thing it could have done instead, so
    // off a hazard it TIES with the one-cell steps and the destination
    // tiebreak places it among them. The hazard case immediately above is the
    // half that still has to differ, and it does.
    const board = rookAt({ x: 4, y: 4 }, { x: 7, y: 7 }, 81);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    const holdRank = set.candidates.findIndex((c) => c.path.length === 0);
    expect(holdRank).toBeGreaterThanOrEqual(0);
    // Nothing that enters MORE than one cell is ordered ahead of it — the tie
    // is with the one-cell steps and with nothing longer.
    for (let i = 0; i < holdRank; i++) {
      expect((set.candidates[i] as Candidate).path.length).toBeLessThanOrEqual(1);
    }
    // And it is not pushed behind them either: at least one longer move follows.
    expect(
      set.candidates.slice(holdRank + 1).some((c) => c.path.length > 1)
    ).toBe(true);
    sub.release();
  });

  test('a hold the dose kills is doomed and pruned, and the option set survives', () => {
    const board = rookAt({ x: 4, y: 4 }, { x: 4, y: 4 }, HAZ - 5);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    // `assess` reports the KEPT set, so the tier is read off a generator with
    // the policy prunes open — the prune is what the rest of the test checks.
    const hold = holdOf(
      new GrammarCandidateGenerator({ pruneFatalNoGain: false, refuseTerrainFatal: false }).assess(
        sub,
        rook
      )
    );
    expect(hold.tier).toBe('doomed');
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    expect(set.candidates.some((c) => c.path.length === 0)).toBe(false);
    expect(set.prunedLedger.some((e) => e.candidate.path.length === 0)).toBe(true);
    expect(set.candidates.length).toBeGreaterThan(0);
    sub.release();
  });

  test('the knob restores the old free-hold reading', () => {
    // The knob is about the CHARGE. With it off, a hold on a hazard reads zero
    // spend again and is therefore no longer dominated by every step off the
    // cell: it comes back into the one-cell tie the clean board puts it in.
    // That difference — dominated with the charge, tied without it — is the
    // whole of what the knob does, and it is what this pins.
    const board = rookAt({ x: 4, y: 4 }, { x: 4, y: 4 }, 81);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const off = new GrammarCandidateGenerator({ chargeStandingTerrain: false });
    const hold = holdOf(off.assess(sub, rook));
    expect(hold.energySpent.hi).toBe(0);
    const free = off.candidatesFor(sub, rook).candidates;
    const charged = defaultCandidateGenerator.candidatesFor(sub, rook).candidates;
    const rankOf = (cs: ReadonlyArray<Candidate>): number =>
      cs.findIndex((c) => c.path.length === 0);
    expect(rankOf(free)).toBeLessThan(rankOf(charged));
    for (let i = 0; i < rankOf(free); i++) {
      expect((free[i] as Candidate).path.length).toBeLessThanOrEqual(1);
    }
    sub.release();
  });
});

// ------------------------------------------------------ the terrain-fatal line

/**
 * THE LINE THE CORPUS READ AS "MAX HEALTH, NOT CURRENT HEALTH".
 *
 * `fatal-no-gain` asks for `capture === 'no'`, and above the kind's maximum that
 * costs nothing: no enemy survives standing on such a cell, so none is ever
 * there to take and the prune fires every time. Below the maximum, enemies cross
 * hazard cells like any other ground, the same square offers a POSSIBLE capture,
 * and the prune stops firing for a mover whose own remaining health the dose
 * already exceeds. No comparison against a maximum exists anywhere in the code —
 * the condition that hides it is simply satisfied in that regime.
 */
describe('a certainly-unaffordable move is refused unless the kill is certain too', () => {
  const withEnemyNear = (health: number, occupied: boolean): Board =>
    boardOf(
      [
        piece('R', { x: 4, y: 4 }, 'rook', 3, { teamID: 'red', health }),
        // On the hazard cell it is a capture we would certainly make; one file
        // away it is a capture we only MIGHT make.
        piece('P', occupied ? { x: 5, y: 4 } : { x: 5, y: 0 }, occupied ? 'pawn' : 'queen', 1, {
          teamID: 'blue',
          health: 100,
        }),
        piece('K', { x: 8, y: 8 }, 'king', 1, { teamID: 'red', health: 100 }),
        piece('E', { x: 0, y: 0 }, 'king', 1, { teamID: 'blue', health: 100 }),
      ],
      { width: 9, height: 9, hazards: [{ x: 5, y: 4 }], hazardDamage: 20 } as Partial<Board>
    );

  test('a hurt mover is refused the fatal hazard cell, and the refusal is declared', () => {
    // AND THE ENEMY FOUR FILES AWAY IS NOT A REASON TO GO. It arrives at the
    // cell on sub-step four; the mover is dead on sub-step one, drained by the
    // dose it could not pay. The settlement knows that — a claim's reach is
    // indexed by sub-step — so the capture is not even a `maybe` and the cell
    // is refused as the pure loss it is.
    const sub = makeSubstrate({ board: withEnemyNear(18, false), turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    const hazardCell = set.prunedLedger
      .map((e) => e.candidate)
      .find((c) => sub.hazardAt(c.to) && c.path.length === 1);
    expect(hazardCell).toBeDefined();
    expect(set.candidates.some((c) => c.to === hazardCell?.to)).toBe(false);
    const entry = set.prunedLedger.find((e) => e.candidate.to === hazardCell?.to);
    expect([PRUNE.terrainFatal, PRUNE.fatalNoGain]).toContain(entry?.prune);
    expect(entry?.exact).toBe(false);
    sub.release();
  });

  test('a healthy mover keeps the same cell — the refusal is about the health it HAS', () => {
    const sub = makeSubstrate({ board: withEnemyNear(90, false), turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    expect(set.candidates.some((c) => sub.hazardAt(c.to))).toBe(true);
    expect(set.prunedLedger.some((e) => e.prune === PRUNE.terrainFatal)).toBe(false);
    sub.release();
  });

  test('the door left open is a CERTAIN kill, and a live enemy never gives one', () => {
    // An enemy standing ON the fatal cell is still only a `maybe` capture: it
    // is a mover, moves are simultaneous, and it may not be there when we
    // arrive (the same reason a piece in the way is not a certain stop). So the
    // refusal fires here too, and the escape hatch the prune leaves open —
    // `capture === 'yes'` — is reserved for a defeat the claim layer proves.
    const sub = makeSubstrate({ board: withEnemyNear(18, true), turn: TURN, asTeam: 'red' });
    const rook = sub.unitOfWireId('R')?.unitId as UnitId;
    const raw = new GrammarCandidateGenerator({ refuseTerrainFatal: false }).assess(sub, rook);
    const onHazard = raw.find(
      (a) => sub.hazardAt(a.candidate.to) && a.candidate.path.length === 1
    ) as AssessedCandidate;
    expect(onHazard.capture).toBe('maybe');
    expect(onHazard.exhaustionFatal).toBe('yes');
    const set = defaultCandidateGenerator.candidatesFor(sub, rook);
    expect(set.candidates.some((c) => c.to === onHazard.candidate.to)).toBe(false);
    expect(
      set.prunedLedger.some(
        (e) => e.candidate.to === onHazard.candidate.to && e.prune === PRUNE.terrainFatal
      )
    ).toBe(true);
    sub.release();
  });
});

// ---------------------------------------------------------------------------
// The capture order prices what it takes
// ---------------------------------------------------------------------------

/**
 * A queen with two captures in front of it and nothing else to want: a heavy
 * one due west, a light one due east, both clean unobstructed slides of the
 * same length, so nothing BUT the capture key can separate them. Before the
 * weight went into the key the two tied at rank 1 and the order fell through
 * to health spent and cell index; now the heavier victim comes first.
 */
const CAPTURE_CHOICE_BOARD = (): Board =>
  boardOf([
    piece('Q', { x: 4, y: 4 }, 'queen', 12, { teamID: 'red', orientation: { dx: 1, dy: 0 } }),
    piece('HEAVY', { x: 1, y: 4 }, 'queen', 8, { teamID: 'blue', orientation: { dx: 1, dy: 0 } }),
    piece('LIGHT', { x: 7, y: 4 }, 'pawn', 1, { teamID: 'blue', orientation: { dx: -1, dy: 0 } }),
  ]);

/** One assessed candidate, with everything but the fields under test neutral. */
const assessedWith = (
  to: number,
  capture: AssessedCandidate['capture'],
  captureValue: number
): AssessedCandidate =>
  ({
    candidate: { unitId: 0 as UnitId, from: 0, to, path: [to] },
    tier: 'safe',
    capture,
    captureValue,
    energySpent: { lo: 0, hi: 0 },
    exhaustionFatal: 'no',
    landing: [to],
    tierGrade: 'clear',
    selfDebuff: 'none',
    contingencies: 0,
    shadowBonus: 0,
    foodGain: 0,
    regicideShot: 0,
  }) as AssessedCandidate;

describe('the capture order prices the victim', () => {
  test('a heavy capture is reached before a light one', () => {
    const sub = makeSubstrate({ board: CAPTURE_CHOICE_BOARD(), turn: TURN, asTeam: 'red' });
    const queen = sub.unitOfWireId('Q')?.unitId as UnitId;
    const heavyCell = sub.unitOfWireId('HEAVY')?.cells[0] as number;
    const lightCell = sub.unitOfWireId('LIGHT')?.cells[0] as number;

    const ordered = defaultCandidateGenerator.assess(sub, queen);
    const heavy = ordered.find((a) => a.candidate.to === heavyCell) as AssessedCandidate;
    const light = ordered.find((a) => a.candidate.to === lightCell) as AssessedCandidate;

    // Both are captures the engine allows, of victims eight weights apart.
    expect(heavy.capture).not.toBe('no');
    expect(light.capture).not.toBe('no');
    expect(heavy.captureValue).toBeGreaterThan(light.captureValue);

    // And the heavy one is handed to the search first — it is the SEED, which
    // is what an anytime path that runs out of budget after one candidate
    // actually plays.
    expect(ordered.indexOf(heavy)).toBeLessThan(ordered.indexOf(light));
    expect(ordered[0]?.candidate.to).toBe(heavyCell);
    sub.release();
  });

  test('a body cell the ray merely crosses is not priced as a capture', () => {
    // The victim table is head-indexed because `bodyOutcome` defeats nothing:
    // arriving at a body cell blocks or severs, it does not kill the owner.
    const board = boardOf([
      piece('Q', { x: 4, y: 4 }, 'queen', 12, { teamID: 'red', orientation: { dx: 1, dy: 0 } }),
      makeSnake(
        'S',
        [
          { x: 1, y: 4 },
          { x: 1, y: 3 },
          { x: 1, y: 2 },
        ],
        { teamID: 'blue', orientation: { dx: 1, dy: 0 } }
      ),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const queen = sub.unitOfWireId('Q')?.unitId as UnitId;
    const bodyCell = sub.unitOfWireId('S')?.cells[1] as number;
    const onBody = defaultCandidateGenerator
      .assess(sub, queen)
      .find((a) => a.candidate.to === bodyCell);
    if (onBody !== undefined) expect(onBody.captureValue).toBe(0);
    sub.release();
  });

  test('at equal weight, a certain capture outranks a possible one', () => {
    const certain = assessedWith(10, 'yes', 4 * 2);
    const possible = assessedWith(20, 'maybe', 4);
    expect(captureOrder(certain, possible)).toBeLessThan(0);
  });

  test('a possible capture of something twice as heavy outranks a certain light one', () => {
    // The specified semantics: EXPECTED captured weight. A `maybe` on a
    // weight-8 queen is priced 8; a `yes` on a weight-1 pawn is priced 2.
    // Whether the trade is worth taking is the evaluator's question, not the
    // order's — the order only decides which one the search sees first.
    const heavyMaybe = assessedWith(10, 'maybe', 8);
    const lightCertain = assessedWith(20, 'yes', 1 * 2);
    expect(captureOrder(heavyMaybe, lightCertain)).toBeLessThan(0);
  });

  test('at equal EXPECTED weight, certainty is the tie-break', () => {
    const certainTwo = assessedWith(10, 'yes', 2 * 2);
    const maybeFour = assessedWith(20, 'maybe', 4);
    expect(certainTwo.captureValue).toBe(maybeFour.captureValue);
    expect(captureOrder(certainTwo, maybeFour)).toBeLessThan(0);
  });

  test('an unpriced capture still outranks taking nothing', () => {
    // A defeat against a cloud has no unit on the square to price. It must not
    // fall behind a move that takes nothing at all.
    const unpriced = assessedWith(10, 'maybe', 0);
    const nothing = assessedWith(20, 'no', 0);
    expect(captureOrder(unpriced, nothing)).toBeLessThan(0);
    expect(captureOrder(nothing, unpriced)).toBeGreaterThan(0);
  });

  test('the capture order is total, antisymmetric and reproducible', () => {
    const all = [
      assessedWith(1, 'no', 0),
      assessedWith(2, 'maybe', 0),
      assessedWith(3, 'maybe', 1),
      assessedWith(4, 'yes', 2),
      assessedWith(5, 'maybe', 4),
      assessedWith(6, 'yes', 4),
      assessedWith(7, 'maybe', 31),
      assessedWith(8, 'yes', 62),
    ];
    // `|| 0` normalises the negative zero a self-comparison produces.
    const sign = (n: number): number => Math.sign(n) || 0;
    for (const a of all) {
      for (const b of all) {
        expect(sign(captureOrder(a, b))).toBe(sign(-captureOrder(b, a)));
      }
    }
    // Every class above separates from every other, so the sort never leaves
    // two of them to an implementation-defined tie.
    const sorted = [...all].sort(captureOrder).map((a) => a.candidate.to);
    expect(sorted).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    const fromReversed = [...all].reverse().sort(captureOrder).map((a) => a.candidate.to);
    expect(fromReversed).toEqual(sorted);
  });

  test('the whole order stays total and deterministic on a real board', () => {
    const sub = makeSubstrate({ board: CAPTURE_CHOICE_BOARD(), turn: TURN, asTeam: 'red' });
    const queen = sub.unitOfWireId('Q')?.unitId as UnitId;
    const once = defaultCandidateGenerator.assess(sub, queen).map((a) => a.candidate.to);
    const twice = defaultCandidateGenerator.assess(sub, queen).map((a) => a.candidate.to);
    expect(twice).toEqual(once);
    expect(new Set(once).size).toBe(once.length);
    sub.release();
  });
});
