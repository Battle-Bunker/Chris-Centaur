/**
 * AN ENGINE DEFECT, PINNED WHERE IT LIVES — `settlePartial` calls a contact
 * survivable that its own resolver can make fatal.
 *
 * THIS IS NOT OUR CODE TO FIX. `src/engine-vendor/` is a byte-for-byte copy of
 * the game engine and is never edited here, so the finding was written down as
 * an executable case against the vendored copy and reported for the engine
 * branch — and the engine branch took it: `entangle`'s trail branch now adds a
 * `contest` with `couldBeat: true` at the same cell and sub-step whenever the
 * pile can form. The bot-side refusal that stood in for it while the gap was
 * open is gone; the fold reads the engine's own entry
 * (`moverSurvivalVia` in `src/lobster/bounds/material.ts`).
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 *
 * `Divergence.couldBeat` is documented in `settlePartial.ts` as:
 *
 *     Whether `unitId` could FAIL to survive this contact — at any strength the
 *     claim's interval permits, including the tie that kills everyone in it.
 *     False means the contact is real but this unit wins it in every world.
 *
 * The second half of the body rule — "this unit's own trail is what the claim
 * could be arriving on, and a cut is a weight loss rather than a death" —
 * writes `couldBeat: false` unconditionally:
 *
 *     if (track.leavesTrail) {
 *       track.body[k].forEach((segment) => {
 *         if (!ghost.head(segment, k)) return
 *         add({ ...base, cell: segment, subStep: k, kind: "sever",
 *               assumedPresent: ghost.certain(segment), couldBeat: false })
 *       })
 *     }
 *
 * The reasoning holds for ONE arrival: a head that lands on a body segment
 * either dies on it (equal or lower tier) or severs it and capture-stops
 * (strictly higher tier), and the segment's owner lives either way. It does not
 * hold for TWO. A death removes nothing from the board, and the resolver's tie
 * rule takes everyone at a cell with no unique survivor — so a claim that dies
 * on our segment leaves a corpse that a second claim's arrival piles onto, and
 * the pile kills the segment's owner with them.
 *
 * The engine already carries exactly this analysis under the `durable` kind —
 * "a death never removes anything from the board, so a claim that could have
 * died earlier is a pile this arrival joins" — and applies it to the track's
 * HEAD cell only. The body-cell branch has no equivalent.
 *
 * THE TWO RULES THAT COMPOSE, both in `turnEngine.ts` and both quoted here so
 * the report needs nothing but this file:
 *
 *   c5, living body cells — the arrival of equal-or-lower tier dies on the
 *   segment, and the batch it pushes is
 *       { op: "durable", cell, unitIDs: [m.id, ...owners.map((o) => o.id)] }
 *   so the OWNER of the body is entered into that cell's pile by a collision
 *   it survived.
 *
 *   c4, arrivals — "every cell somebody reached is contested by all the
 *   head-class units standing there plus everything the cell's pile holds",
 *   `survivor = strictMaximum(participants)`, and every participant that is
 *   not that unique maximum is condemned. The owner is a participant.
 *
 * The minimal upstream repair is in `entangle`'s trail branch: the arrival
 * this entry stands for can put `track` into a pile it may not win, so
 * `couldBeat` is not a constant there. `ghost.tierMin <= track.tier` is the
 * condition under which the claim could die on the segment and make the cell
 * durable at all.
 *
 * ── THE MINIMAL BOARD (7x7, red to move, only `rs` staged) ─────────────────
 *
 *     red   snake  (2,5)-(3,5)-(4,5)   staged one step west
 *     red   queen  (3,4)               held
 *     blue  snake  (3,1)-(4,1)-(5,1)   held
 *     blue  rook   (2,1)               held
 *
 * In engine cells the snake is 21/22/23 and stages 21 → 20, so its body still
 * stands on 21 and 22; the queen is at 31 and the rook at 57, and both can be
 * on 21. Every ledger entry naming `rs` is a `sever` with `couldBeat: false`.
 * Sixteen of the four hundred enumerated worlds kill it anyway, all of them
 * through the same clash: the queen dies on 21 at sub-step 1, the rook slides
 * up column 3 and arrives on 21 at sub-step 4, and the resolver records
 *
 *     {"index":21,"subStep":4,"kind":"contest",
 *      "playerIDs":["br","rq","rs"],"victimIDs":["br","rs"],
 *      "reason":"Deadlock: no unique survivor"}
 *
 * WHAT IS STILL PINNED HERE. The worlds are the point: sixteen of four hundred
 * kill `rs` in the deadlock, so the fold may never prove survival on this
 * board. The engine's `contest` entry is what proves it may not, and this file
 * holds BOTH ends of that — the entry, and the worlds it stands for — so a
 * regression at either end is a failure rather than a silence. `deadly` coming
 * back empty would mean the resolver itself changed, and the board would then
 * need re-measuring before anything here is believed again.
 */

import type { Board, Snake } from '../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { worldsOf } from '../lobster/evaluate';
import { moverSurvival } from '../lobster/bounds/material';
import type { LawCase } from '../lobster/evaluate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import { makeSnake, piece } from './board-fixtures';

const TURN = 40;

const BOARD = {
  width: 7,
  height: 7,
  food: [],
  hazards: [],
  snakes: [
    makeSnake('rs', [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ], { teamID: 'red', health: 80 }),
    piece('rq', { x: 3, y: 4 }, 'queen', 3, { teamID: 'red', health: 60 }),
    makeSnake('bs', [
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
    ], { teamID: 'blue', health: 80 }),
    piece('br', { x: 2, y: 1 }, 'rook', 3, { teamID: 'blue', health: 60 }),
  ],
} as unknown as Board;

/** The staged destination, in engine cells: one step west of the snake's head. */
const WEST = 20;
/** The body cell the pile forms on. */
const PILE = 21;

const CASE: LawCase = {
  name: 'a snake staged west, its own body still on the cell two claims can reach',
  board: BOARD,
  turn: TURN,
  asTeam: 'red',
  stages: ['rs'],
  orders: new Map([['rs', WEST]]),
};

afterEach(() => clearGeometryCache());

describe('settlePartial: a sever entry claims a survival the resolver does not deliver', () => {
  test('the board is the one described, in the engine’s own cells', () => {
    const sub = makeSubstrate({ board: BOARD, turn: TURN, asTeam: 'red', modeled: ['rs'] });
    try {
      const cells = sub.roster().map((u) => `${u.wireId}@${u.cells.join('/')}`);
      expect(cells).toEqual(['rs@21/22/23', 'rq@31', 'bs@58/59/60', 'br@57']);
    } finally {
      sub.release();
    }
  });

  test('the sever is ledgered with the contest it can become: a couldBeat entry at the pile cell', () => {
    const sub = makeSubstrate({ board: BOARD, turn: TURN, asTeam: 'red', modeled: ['rs'] });
    try {
      const rs = sub.unitOfWireId('rs')?.unitId as UnitId;
      const action = sub.actionsOf(rs).find((a) => a.to === WEST) as Candidate;
      const plan: JointPlan = new Map<UnitId, Candidate>([[rs, action]]);
      sub.withResolution(plan, sub.teamNumber('red'), ({ resolution }) => {
        const mine = resolution.ledger.filter((d) => d.unitId === 'rs');
        expect(mine.length).toBeGreaterThan(0);
        // The engine used to ledger this cell as severs only, every one
        // claiming the held unit could not beat the mover, while 16/400 worlds
        // ended with the mover dead in the pile the sever formed. It now adds
        // a contest entry with couldBeat at the same cell and sub-step, which
        // is what lets the floor refuse to prove survival there.
        expect(new Set(mine.map((d) => d.kind))).toEqual(new Set(['sever', 'contest']));
        expect(mine.some((d) => d.cell === PILE && d.kind === 'contest' && d.couldBeat)).toBe(true);
        expect([...new Set(mine.filter((d) => d.cell === PILE).map((d) => d.heldId))].sort()).toEqual(
          ['br', 'rq']
        );
        // The mover ends the timeline alive and whole.
        expect(resolution.board['rs']?.occupancy).toEqual([WEST, PILE, 22]);
        expect(resolution.deaths['rs']).toBeUndefined();
        return null;
      });
    } finally {
      sub.release();
    }
  });

  test('and yet worlds the same engine resolves kill it, by a deadlock on that cell', () => {
    const sub = makeSubstrate({ board: BOARD, turn: TURN, asTeam: 'red', modeled: ['rs'] });
    try {
      const asTeam = sub.teamNumber('red');
      const deadly: string[] = [];
      let worlds = 0;
      for (const world of worldsOf(sub, CASE, 400)) {
        worlds++;
        const clash = sub.withResolution(world.plan, asTeam, ({ resolution }) => {
          if (resolution.deaths['rs'] === undefined) return null;
          const death = resolution.deaths['rs'] as { cell: number; cause: string };
          return `${death.cause}@${death.cell}`;
        });
        if (clash !== null) deadly.push(clash);
      }
      expect(worlds).toBe(400);
      // THE DEFECT. Every one of these is a world in which the mover does not
      // win a contact the ledger said it wins in every world.
      expect(deadly.length).toBeGreaterThan(0);
      expect([...new Set(deadly)]).toEqual([`contest@${PILE}`]);
    } finally {
      sub.release();
    }
  });

  test('so the FOLD refuses the proof the entry offers, and prices the mover as maybe', () => {
    // The bot-side consequence, pinned next to the defect it answers. This is
    // the assertion that flips when someone deletes the workaround without
    // the engine having been fixed.
    const sub = makeSubstrate({ board: BOARD, turn: TURN, asTeam: 'red', modeled: ['rs'] });
    try {
      const rs = sub.unitOfWireId('rs')?.unitId as UnitId;
      const action = sub.actionsOf(rs).find((a) => a.to === WEST) as Candidate;
      const plan: JointPlan = new Map<UnitId, Candidate>([[rs, action]]);
      const survival = sub.withResolution(plan, sub.teamNumber('red'), ({ resolution }) =>
        moverSurvival(resolution, 'rs')
      );
      expect(survival).toBe('maybe');
    } finally {
      sub.release();
    }
  });

  test('and a lone claim over the same segment still proves survival', () => {
    // The other half of the refusal, which is what keeps it from being a
    // blanket. Drop the second claim that can reach cell 21 and the engine's
    // own reasoning covers the position exactly: one arrival either dies on
    // the segment or cuts it, and the owner lives in every world. A fold that
    // answered `maybe` here would be paying for a pile that cannot form.
    const lone = {
      ...BOARD,
      snakes: (BOARD.snakes as Snake[]).filter((s) => s.id !== 'br'),
    } as unknown as Board;
    const sub = makeSubstrate({ board: lone, turn: TURN, asTeam: 'red', modeled: ['rs'] });
    try {
      const rs = sub.unitOfWireId('rs')?.unitId as UnitId;
      const action = sub.actionsOf(rs).find((a) => a.to === WEST) as Candidate;
      const plan: JointPlan = new Map<UnitId, Candidate>([[rs, action]]);
      const seen = sub.withResolution(plan, sub.teamNumber('red'), ({ resolution }) => ({
        survival: moverSurvival(resolution, 'rs'),
        severs: resolution.ledger.filter((d) => d.unitId === 'rs' && d.cell === PILE).length,
      }));
      // Anti-vacuity: the sever entries this proof rests on are still there.
      expect(seen.severs).toBeGreaterThan(0);
      expect(seen.survival).toBe('yes');
    } finally {
      sub.release();
    }
  });
});
