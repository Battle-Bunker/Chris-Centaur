/**
 * THE TWO FILES SCHEDULED FOR DELETION, MEASURED AGAINST THE ENGINE THAT IS
 * MEANT TO REPLACE THEM.
 *
 * `src/partial-engine/grammar.ts` and `src/partial-engine/contest.ts` are
 * restatements of rules the vendored engine already owns: what a staged
 * destination means for a unit of some kind (`moveGrammar.ts` `planUnitAction`
 * / `defaultAction` / `legalOrientations`), and who survives a cell contest
 * (`turnEngine.ts` `strictMaximum`). The plan is to rebase them onto the
 * vendored engine and delete the rule logic. The whole-turn differential is
 * evidence they agree TODAY on the boards it happens to draw; it is not
 * evidence that they agree EVERYWHERE, and a deletion is a claim about
 * everywhere.
 *
 * So this is the unit-level differential the deletion is gated on:
 *
 *   · every kind, every interior origin, every orientation, every destination
 *     on the board — 111,132 staged intents per pawn-target set, three sets —
 *     compared as a TRIPLE (legal or not, which action, which path or facing),
 *     because two grammars that agree on legality and disagree on the path are
 *     the worse failure;
 *   · the kind property table (trail, edge traversal, stay, promotion target
 *     and threshold) against the vendored predicates that answer the same
 *     questions;
 *   · and the contest, on random participant sets, through `runTurnEngine`
 *     itself rather than a copy of its comparator — `strictMaximum` is module-
 *     private, so the honest way to ask it who won is to stage a co-arrival
 *     and read the clash record the engine writes.
 *
 * Anything that only holds for the boards the whole-turn differential draws
 * shows up here as a coordinate, with the exact intent that produced it.
 *
 * `npx jest src/tests/partial-engine-grammar-parity.test.ts`
 */

import {
  DEFAULT_PAWN_PROMOTION_WEIGHT,
  defaultAction,
  isPieceType,
  leavesTrail,
  legalOrientations,
  planUnitAction,
  traversesEdges,
} from '../engine-vendor/engine/moveGrammar';
import type { Orientation, UnitAction as VendorAction } from '../engine-vendor/engine/moveGrammar';
import { REASON as VENDOR_REASON, runTurnEngine } from '../engine-vendor/engine/turnEngine';
import type { EngineUnit } from '../engine-vendor/engine/turnEngine';
import {
  DEFAULT_ENGINE_CONFIG,
  REASON,
  UNIT_KIND_NAMES,
  UnitKind,
  bbSet,
  kindProfiles,
  makeGrid,
  makeTerrain,
  newBoard,
  planAction,
  profileOf,
  scalarOf,
  uniqueStrictMax,
  vectorOf,
} from '../partial-engine/index';
import type { UnitAction } from '../partial-engine/index';
// NOT re-exported by the engine's index (a seam worth knowing about): the
// move-only default is reachable through `enumerateActions`, which appends it,
// but the function itself is only on the module.
import { defaultPath } from '../partial-engine/grammar';
import { WIRE_KIND_NAMES, WIRE_ORIENTATIONS } from '../partial-engine/wire-adapter';
import { W, mulberry32 } from './partial-engine-boards';
import { perimeter } from './partial-engine-oracle';

const GRID = makeGrid(W, W);
const TERRAIN = makeTerrain(GRID, [], []);
const KINDS = [0, 1, 2, 3, 4, 5, 6];
const INTERIOR: number[] = [];
for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) INTERIOR.push(y * W + x);

/** One action in the ONE string both grammars are compared as. */
function printVendor(a: VendorAction | null): string {
  if (a === null) return 'illegal';
  if (a.kind === 'stay') return 'stay';
  if (a.kind === 'move') return `move ${a.path.join(',')}`;
  return `rotate ${a.orientation.dx},${a.orientation.dy}`;
}

function printPartial(a: UnitAction | null): string {
  if (a === null) return 'illegal';
  if (a.kind === 'stay') return 'stay';
  if (a.kind === 'move') return `move ${a.path.join(',')}`;
  const v = vectorOf(a.orientation);
  return `rotate ${v.dx},${v.dy}`;
}

describe('grammar.ts planAction vs moveGrammar.ts planUnitAction', () => {
  test('every kind, origin, orientation and destination — the same triple', () => {
    let compared = 0;
    let legal = 0;
    let moves = 0;
    let rotations = 0;
    let stays = 0;
    const disagreements: string[] = [];

    for (const seed of [1, 2, 3]) {
      // The pawn-target set: cells holding food or another unit at the start of
      // the turn. Both sides get the SAME set, in their own representation —
      // if the two ever build it differently that is grammar.ts's own
      // `pawnTargetsInto` versus resolveTurn, which the whole-turn differential
      // already covers.
      const rnd = mulberry32(seed * 977 + 5);
      const targetCells = INTERIOR.filter(() => rnd() < 0.15);
      const targetSet = new Set(targetCells);
      const targetBoard = newBoard(GRID);
      for (const c of targetCells) bbSet(targetBoard, c);

      for (const kind of KINDS) {
        const type = WIRE_KIND_NAMES[kind];
        if (type === undefined) throw new Error(`no wire type for kind ${kind}`);
        for (const origin of INTERIOR) {
          for (let o = 0; o < 4; o++) {
            const facing = WIRE_ORIENTATIONS[o] as Orientation;
            for (let dest = 0; dest < GRID.cells; dest++) {
              const theirs = planUnitAction(type, origin, dest, W, W, facing, targetSet);
              const ours = planAction(TERRAIN, kind, origin, dest, o, targetBoard);
              compared++;
              const a = printVendor(theirs);
              const b = printPartial(ours);
              if (a !== b && disagreements.length < 10) {
                disagreements.push(
                  `${UNIT_KIND_NAMES[kind]} at ${origin} facing ${o} -> ${dest}: ` +
                    `vendor "${a}", engine "${b}"`
                );
              }
              if (theirs !== null) {
                legal++;
                if (theirs.kind === 'move') moves++;
                else if (theirs.kind === 'rotate') rotations++;
                else stays++;
              }
            }
          }
        }
      }
    }

    console.log(
      `  [grammar] ${compared} intents compared, ${legal} legal ` +
        `(${moves} moves, ${rotations} rotations, ${stays} stays)`
    );
    expect(disagreements).toEqual([]);
    // Anti-vacuity: every branch of the grammar must have been reached, or
    // "they agree" is a statement about the illegal cases only.
    expect(compared).toBeGreaterThan(330_000);
    expect(moves).toBeGreaterThan(10_000);
    expect(rotations).toBeGreaterThan(500);
    expect(stays).toBeGreaterThan(500);
  }, 300_000);

  test('the default action — what a unit does when nothing legal was staged', () => {
    let compared = 0;
    let momentum = 0;
    const disagreements: string[] = [];
    for (const kind of KINDS) {
      const type = WIRE_KIND_NAMES[kind];
      if (type === undefined) throw new Error(`no wire type for kind ${kind}`);
      for (const origin of INTERIOR) {
        for (let o = 0; o < 4; o++) {
          const facing = WIRE_ORIENTATIONS[o] as Orientation;
          const theirs = defaultAction(type, origin, W, W, facing);
          // The engine's move-only view: a length, and the cells written out.
          const scratch: number[] = [];
          const n = defaultPath(TERRAIN, kind, origin, o, scratch);
          const ours: UnitAction =
            n > 0 ? { kind: 'move', path: scratch.slice(0, n) } : { kind: 'stay' };
          compared++;
          if (theirs.kind === 'move') momentum++;
          const a = printVendor(theirs);
          const b = printPartial(ours);
          if (a !== b && disagreements.length < 10) {
            disagreements.push(
              `${UNIT_KIND_NAMES[kind]} at ${origin} facing ${o}: vendor "${a}", engine "${b}"`
            );
          }
        }
      }
    }
    console.log(`  [default] ${compared} compared, ${momentum} momentum steps`);
    expect(disagreements).toEqual([]);
    expect(momentum).toBeGreaterThan(100);
  });

  test('the legal orientation set, per kind', () => {
    // moveGrammar's `legalOrientations` is the set of directions a unit's
    // FACING can take. The engine keeps the same fact as the profile's step and
    // ray offsets — except for an oriented kind, whose facing is one of the
    // four orthogonal indices and whose steps are orientation-relative.
    for (const kind of KINDS) {
      const type = WIRE_KIND_NAMES[kind];
      if (type === undefined) throw new Error(`no wire type for kind ${kind}`);
      const profile = profileOf(kind);
      const theirs = legalOrientations(type)
        .map((v) => `${v.dx},${v.dy}`)
        .sort();
      const ours = (
        profile.oriented
          ? [0, 1, 2, 3].map((o) => vectorOf(o))
          : [...profile.steps, ...profile.rays].map(([dx, dy]) => ({ dx, dy }))
      )
        .map((v) => `${v.dx},${v.dy}`)
        .sort();
      expect([type, ours]).toEqual([type, theirs]);
    }
  });

  test('the kind property table, against the vendored predicates', () => {
    for (const profile of kindProfiles()) {
      const type = WIRE_KIND_NAMES[profile.kind];
      if (type === undefined) throw new Error(`no wire type for kind ${profile.kind}`);
      expect([type, profile.leavesTrail]).toEqual([type, leavesTrail(type)]);
      expect([type, profile.traversesEdges]).toEqual([type, traversesEdges(type)]);
      // A piece holds; a trail unit has momentum and must step. `isPieceType`
      // is the vendored side of exactly that.
      expect([type, profile.stayLegal]).toEqual([type, isPieceType(type)]);
      expect([type, profile.mayEnterWall]).toEqual([type, !isPieceType(type)]);
    }
  });

  test('the promotion threshold is one number, not two', () => {
    expect(DEFAULT_ENGINE_CONFIG.pawnPromotionWeight).toBe(DEFAULT_PAWN_PROMOTION_WEIGHT);
    expect(profileOf(UnitKind.Pawn).promotesTo).toBe(UnitKind.Queen);
    // And no other shipped kind promotes — the vendored module has no
    // promotion at all (it is the caller's, per VENDOR.md), so a second
    // promoting kind here would be a rule this repo invented.
    for (const profile of kindProfiles()) {
      if (profile.kind === UnitKind.Pawn) continue;
      expect([profile.name, profile.promotesTo]).toEqual([profile.name, null]);
    }
  });
});

describe('contest.ts uniqueStrictMax vs turnEngine.ts strictMaximum', () => {
  const CENTRE = 4 * W + 4;
  const RING = [
    3 * W + 3,
    3 * W + 4,
    3 * W + 5,
    4 * W + 3,
    4 * W + 5,
    5 * W + 3,
    5 * W + 4,
    5 * W + 5,
  ];

  test('random participant sets: the same survivor, or the same tie', () => {
    let compared = 0;
    let ties = 0;
    let tierWins = 0;
    let weightWins = 0;
    const disagreements: string[] = [];

    for (let seed = 1; seed <= 3000; seed++) {
      const rnd = mulberry32(seed * 15485863 + 11);
      const n = 2 + ((rnd() * 4) | 0);
      const cells = [...RING].sort(() => rnd() - 0.5).slice(0, n);
      const participants = cells.map((cell, i) => ({
        id: `u${i}`,
        cell,
        tier: ((rnd() * 4) | 0) - 1,
        weight: 1 + ((rnd() * 4) | 0),
      }));
      // Staged as a co-arrival: every participant walks into the centre in one
      // sub-step, which is the cell contest and nothing else.
      const units: EngineUnit[] = participants.map((p) => ({
        id: p.id,
        leavesTrail: false,
        traversesEdges: true,
        occupancy: new Array<number>(p.weight).fill(p.cell),
        tier: p.tier,
        health: 100,
        path: [CENTRE],
      }));
      const result = runTurnEngine(units, [], perimeter(W, W), 0);
      const contest = result.clashes.find((c) => c.index === CENTRE && c.kind === 'contest');
      expect([`seed ${seed}`, contest === undefined]).toEqual([`seed ${seed}`, false]);
      if (contest === undefined) continue;

      const mine = uniqueStrictMax(participants, (p) => scalarOf(p.tier, p.weight));
      compared++;
      const theirs = contest.survivorID ?? null;
      const ours = mine === null ? null : mine.id;
      if (theirs !== ours && disagreements.length < 10) {
        disagreements.push(
          `seed ${seed}: vendor survivor ${theirs}, engine ${ours} — ` +
            participants.map((p) => `${p.id}(t${p.tier},w${p.weight})`).join(' ')
        );
      }
      // The victims follow from the survivor, and a consumer reads THEM: a
      // contest kills everybody who is not the unique strict maximum.
      const expectedVictims = participants
        .filter((p) => p.id !== ours)
        .map((p) => p.id)
        .sort();
      const gotVictims = [...contest.victimIDs].sort();
      if (expectedVictims.join(',') !== gotVictims.join(',') && disagreements.length < 10) {
        disagreements.push(
          `seed ${seed}: victims vendor [${gotVictims.join(',')}], engine [${expectedVictims.join(',')}]`
        );
      }
      if (ours === null) ties++;
      else if (contest.reason === REASON.tier) tierWins++;
      else if (contest.reason === REASON.weight) weightWins++;
    }

    console.log(
      `  [contest] ${compared} contests, ${ties} ties, ${tierWins} decided on tier, ` +
        `${weightWins} on weight`
    );
    expect(disagreements).toEqual([]);
    // Anti-vacuity: both orderings of the lexicographic comparator, and the
    // tie, must have been exercised.
    expect(compared).toBeGreaterThan(2500);
    expect(ties).toBeGreaterThan(100);
    expect(tierWins).toBeGreaterThan(100);
    expect(weightWins).toBeGreaterThan(100);
  }, 300_000);

  test('the display vocabulary is the same vocabulary', () => {
    // REASON is display text, not load-bearing — but the engine copies the
    // vendored strings verbatim so a renderer written against the server's
    // turn payload needs no translation table, and a drift here is a silent
    // one. Every key the engine has must match; `regicide` is the vendored
    // module's alone (it is a game-level rule, not a resolution's).
    for (const key of Object.keys(REASON) as Array<keyof typeof REASON>) {
      expect([key, REASON[key]]).toEqual([key, VENDOR_REASON[key]]);
    }
    expect(Object.keys(VENDOR_REASON)).toContain('regicide');
    expect(Object.keys(REASON)).not.toContain('regicide');
  });
});
