/**
 * THE POLARITY, WHICH IS THE ONE THING A LEDGER CAN GET SILENTLY WRONG.
 *
 * A `Divergence` says which endpoint of the bracket is riding on an unknown:
 *
 *   assumedPresent === false → the timeline read the cell EMPTY. The unknown
 *     has only to have moved there for this to bite, and it is `worst` that is
 *     exposed. The contract calls that `if_present`.
 *   assumedPresent === true → the timeline PLACED the unknown there on the
 *     neck argument, so it is `best` that is exposed. `if_absent`.
 *
 * Swap the two and every aggregate is identical — the counts, the sizes, the
 * discharge test — and the one place it shows is where a human reads the
 * ledger to decide what to refine. So it is pinned here, entry by entry,
 * against the settlement the entries came from.
 */

import { makeGenerator, makeSubstrate, makeTestBoard, at, type BoardSpec } from "./testkit";
import { ledgerOf, residueOf, EVALUATOR_RESIDUE_UNIT, evaluatorResidueEntry } from "./ledger";
import type { Candidate, JointPlan, UnitId } from "../contracts";

const OURS = 0;
const THEIRS = 1;

/** Close enough that anything either side does touches the other. */
const CONTACT: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: "snake", occupancy: [3 * 7 + 2, 3 * 7 + 1], energy: 60 },
    { id: 2, team: THEIRS, type: "snake", occupancy: [3 * 7 + 4, 3 * 7 + 5], energy: 60 },
    { id: 3, team: THEIRS, type: "rook", occupancy: [1 * 7 + 3], energy: 60 },
  ],
};

function firstLedgeredPlan(): {
  sub: ReturnType<typeof makeSubstrate>;
  plan: JointPlan;
} {
  const board = makeTestBoard(CONTACT);
  const sub = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const options = gen.candidatesFor(sub, 1 as UnitId).candidates;
  for (const candidate of options) {
    const plan: JointPlan = new Map([[1 as UnitId, candidate as Candidate]]);
    if (sub.resolveBoundedFor(plan, OURS).resolution.ledger.length > 0) return { sub, plan };
  }
  throw new Error("no plan produced a divergence on the contact board");
}

describe("the polarity is the divergence's, entry for entry", () => {
  test("assumedPresent false is if_present, true is if_absent", () => {
    const { sub, plan } = firstLedgeredPlan();
    try {
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      const translated = ledgerOf(sub, settlement);
      expect(translated.length).toBeGreaterThan(0);
      for (const raw of settlement.ledger) {
        const wanted = raw.assumedPresent ? "if_absent" : "if_present";
        const heldId = sub.unitIdOf(raw.heldId);
        expect(heldId).toBeDefined();
        expect(
          translated.some(
            (e) =>
              e.unitId === heldId &&
              e.cell === raw.cell &&
              e.subStep === raw.subStep &&
              e.polarity === wanted,
          ),
        ).toBe(true);
      }
    } finally {
      sub.release();
    }
  });

  test("every entry names the UNKNOWN unit, never the live one", () => {
    const { sub, plan } = firstLedgeredPlan();
    try {
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      const unknowns = new Set(
        settlement.ledger.map((d) => sub.unitIdOf(d.heldId)).filter((id) => id !== undefined),
      );
      for (const entry of ledgerOf(sub, settlement)) {
        expect(unknowns.has(entry.unitId)).toBe(true);
      }
    } finally {
      sub.release();
    }
  });

  test("the note carries the kind, and says when a narrowing licensed it", () => {
    const { sub, plan } = firstLedgeredPlan();
    try {
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      for (const entry of ledgerOf(sub, settlement)) {
        expect(entry.note.length).toBeGreaterThan(0);
        // Every kind the engine can report is a word a human can read back.
        expect(entry.note).toMatch(
          /contest|edge|bodyBlock|sever|durable|food|potion|exhaustion|promotion/,
        );
      }
    } finally {
      sub.release();
    }
  });
});

describe("the ledger is canonical, because it is part of a bound's identity", () => {
  test("deduplicated, and the same settlement twice is the same ledger", () => {
    const { sub, plan } = firstLedgeredPlan();
    try {
      const first = ledgerOf(sub, sub.resolveBoundedFor(plan, OURS).resolution);
      const second = ledgerOf(sub, sub.resolveBoundedFor(plan, OURS).resolution);
      expect(second).toEqual(first);
      const keys = first.map((e) => `${e.unitId}:${e.cell}:${e.subStep}:${e.polarity}:${e.note}`);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      sub.release();
    }
  });

  test("an empty settlement ledger translates to an empty one, with no ceremony", () => {
    // Two units that cannot touch: nothing unknown can matter.
    const board = makeTestBoard({
      width: 11,
      height: 11,
      units: [
        { id: 1, team: OURS, type: "knight", occupancy: [at({ width: 11, height: 11, units: [] }, 1, 1)], energy: 60 },
        { id: 2, team: THEIRS, type: "knight", occupancy: [at({ width: 11, height: 11, units: [] }, 9, 9)], energy: 60 },
      ],
    });
    const sub = makeSubstrate(board, OURS);
    try {
      const gen = makeGenerator();
      const candidate = gen.candidatesFor(sub, 1 as UnitId).candidates[0] as Candidate;
      const plan: JointPlan = new Map([[1 as UnitId, candidate]]);
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      expect(settlement.ledger).toHaveLength(0);
      expect(ledgerOf(sub, settlement)).toEqual([]);
    } finally {
      sub.release();
    }
  });
});

describe("the residue is a work list", () => {
  test("it ranks the units the ledger blames most, and nothing else", () => {
    const { sub, plan } = firstLedgeredPlan();
    try {
      const ledger = ledgerOf(sub, sub.resolveBoundedFor(plan, OURS).resolution);
      const residue = residueOf(ledger);
      expect(new Set(residue).size).toBe(residue.length);
      for (const unitId of residue) expect(ledger.some((e) => e.unitId === unitId)).toBe(true);
      // Ordered by how much of the ledger names each unit.
      const weight = (id: UnitId): number => ledger.filter((e) => e.unitId === id).length;
      for (let i = 1; i < residue.length; i++) {
        expect(weight(residue[i - 1] as UnitId)).toBeGreaterThanOrEqual(weight(residue[i] as UnitId));
      }
    } finally {
      sub.release();
    }
  });

  test("the evaluator's own residue is named, so a discharge is never laundered", () => {
    const entry = evaluatorResidueEntry("a gap nothing held explains");
    expect(entry.unitId).toBe(EVALUATOR_RESIDUE_UNIT);
    expect(residueOf([entry])).toEqual([EVALUATOR_RESIDUE_UNIT]);
  });
});
