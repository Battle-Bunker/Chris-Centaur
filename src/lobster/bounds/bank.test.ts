/**
 * The bank's behaviour, rung by rung — what each member is FOR, not just that
 * the whole thing brackets.
 *
 * Each test names the claim it pins, because a bank that brackets by always
 * answering [-∞, +∞] would pass the soundness harness and be worthless.
 */

import type { JointPlan, Substrate, UnitId } from '../contracts';
import { B0_ONLY, BoundBank, DEFAULT_BANK_CONFIG, isDischarged, ledgerOf, witnessOf } from './index';
import {
  allPlans,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  trueWorstCase,
  unboundedBudget,
  type BoardSpec,
} from './testkit';

const OURS = 0;
const THEIRS = 1;

/**
 * A duel with the two units in contact: our rook can be met, so the ledger is
 * non-empty and every rung has something to do.
 */
const CONTACT: BoardSpec = {
  width: 7,
  height: 7,
  units: [
    { id: 1, team: OURS, type: 'rook', occupancy: [2 * 7 + 2, 2 * 7 + 2], health: 60 },
    { id: 2, team: THEIRS, type: 'king', occupancy: [2 * 7 + 4], health: 60 },
    { id: 3, team: THEIRS, type: 'king', occupancy: [4 * 7 + 4], health: 60 },
  ],
};

/** Opposite corners of a big board: nothing can reach anything. */
const DISTANT: BoardSpec = {
  width: 11,
  height: 11,
  units: [
    { id: 1, team: OURS, type: 'king', occupancy: [1 * 11 + 1], health: 60 },
    { id: 2, team: THEIRS, type: 'king', occupancy: [9 * 11 + 9], health: 60 },
  ],
};

function bankFor(
  spec: BoardSpec,
  config: Partial<typeof DEFAULT_BANK_CONFIG> = DEFAULT_BANK_CONFIG,
  sub?: Substrate,
  shared?: ReturnType<typeof makeTestBoard>,
): {
  bank: BoundBank;
  sub: ReturnType<typeof makeSubstrate>;
  board: ReturnType<typeof makeTestBoard>;
  gen: ReturnType<typeof makeGenerator>;
  close(): void;
} {
  const board = shared ?? makeTestBoard(spec);
  const own = makeSubstrate(board, OURS);
  const gen = makeGenerator();
  const bank = new BoundBank({
    sub: sub ?? own,
    gen,
    evaluate: makeEvaluator(),
    asTeam: OURS,
    budget: unboundedBudget(),
    basis: [],
    config,
  });
  return {
    bank,
    sub: own,
    board,
    gen,
    close: () => {
      bank.release();
      own.release();
    },
  };
}

describe('B0 — hold everything', () => {
  test('one resolution, and it is the floor of last resort', () => {
    const ctx = bankFor(CONTACT, B0_ONLY);
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      expect(out.resolutions).toBe(1);
      expect(out.members.map((m) => m.rung)).toEqual(['B0']);
      expect(out.floorFrom).toBe('B0');
    } finally {
      ctx.close();
    }
  });

  test('an empty ledger IS the discharge: exact, and equal to the truth', () => {
    const ctx = bankFor(DISTANT, B0_ONLY);
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      expect(out.bounds.ledger).toEqual([]);
      expect(out.bounds.exact).toBe(true);
      expect(isDischarged(out.bounds)).toBe(true);
      expect(out.bounds.worst).toBe(out.bounds.best);
      expect(out.bounds.worst).toBe(trueWorstCase(ctx.board, OURS, plan).value);
    } finally {
      ctx.close();
    }
  });

  test('a contact produces a ledger entry in one polarity or the other', () => {
    const ctx = bankFor(CONTACT, B0_ONLY);
    try {
      let sawLedger = false;
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 16)) {
        const out = ctx.bank.price(plan);
        if (out.bounds.ledger.length > 0) {
          sawLedger = true;
          for (const entry of out.bounds.ledger) {
            expect(['if_present', 'if_absent']).toContain(entry.polarity);
            // The entry names a HELD unit, which is the whole point: it is a
            // refinement work list, not a log line.
            expect([2, 3, -1]).toContain(entry.unitId);
          }
          expect(out.bounds.exact).toBe(false);
        }
      }
      expect(sawLedger).toBe(true);
    } finally {
      ctx.close();
    }
  });
});

describe('B1 — additive per-enemy enumeration', () => {
  test('modelling an enemy raises the floor and never lowers it', () => {
    // Measured across boards rather than asserted on one: the claim is that
    // enumeration BUYS something, and a position where the cloud bound is
    // already tight is a real position, not a failure.
    let raised = 0;
    let checked = 0;
    let boardsRaised = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const spec = seededBoard(seed, 6, 1);
      const withB1 = bankFor(spec, { b1: true, b2: false, b3: false });
      const b0 = bankFor(spec, B0_ONLY, undefined, withB1.board);
      let raisedHere = 0;
      try {
        for (const plan of allPlans(withB1.sub, withB1.gen, OURS, 12)) {
          const loose = b0.bank.price(plan);
          const tight = withB1.bank.price(plan);
          checked++;
          // The direction is the whole contract: a tighter member may only
          // raise the floor and lower the ceiling.
          expect(tight.bounds.worst).toBeGreaterThanOrEqual(loose.bounds.worst);
          expect(tight.bounds.best).toBeLessThanOrEqual(loose.bounds.best);
          if (tight.bounds.worst > loose.bounds.worst) raisedHere++;
        }
      } finally {
        withB1.close();
        b0.close();
      }
      raised += raisedHere;
      if (raisedHere > 0) boardsRaised++;
    }

    console.log(`  [B1] floor raised on ${raised}/${checked} staged sets, ${boardsRaised}/10 boards`);
    expect(checked).toBeGreaterThan(40);
    expect(boardsRaised).toBeGreaterThan(0);
  }, 120_000);

  test('it costs a SUM of resolutions, not a product', () => {
    const ctx = bankFor(CONTACT, { b1: true, b2: false, b3: false, gateOnEntanglement: false });
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      const enumerated = out.members.filter((m) => m.rung === 'B1');
      expect(enumerated.length).toBeGreaterThan(1);
      const sum = enumerated.reduce((n, m) => n + m.branches, 1);
      const product = enumerated.reduce((n, m) => n * m.branches, 1);
      expect(out.resolutions).toBeLessThanOrEqual(sum);
      expect(sum).toBeLessThan(product);
    } finally {
      ctx.close();
    }
  });
});

describe('B3 — the full product', () => {
  test('it is the only rung that reports exact, and it agrees with the truth', () => {
    const ctx = bankFor(CONTACT, {
      ...DEFAULT_BANK_CONFIG,
      productCap: 4096,
      // Gating decides WHO; B3 needs the whole uncontrolled set live before it
      // can claim a discharge, so this test asks for everything.
      gateOnEntanglement: false,
    });
    try {
      let exactCount = 0;
      let fromB3 = 0;
      let checked = 0;
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 12)) {
        const out = ctx.bank.price(plan);
        checked++;
        if (out.bounds.exact) {
          exactCount++;
          if (out.floorFrom === 'B3') fromB3++;
          // Discharged means a POINT, and the point is the truth.
          expect(out.bounds.worst).toBe(out.bounds.best);
          expect(out.bounds.worst).toBe(trueWorstCase(ctx.board, OURS, plan).value);
        }
      }

      console.log(`  [B3] discharged on ${exactCount}/${checked} staged sets (${fromB3} via B3)`);
      expect(exactCount).toBeGreaterThan(0);
      expect(fromB3).toBeGreaterThan(0);
    } finally {
      ctx.close();
    }
  });

  test('a product over the declared cap declines rather than truncating', () => {
    const ctx = bankFor(CONTACT, { ...DEFAULT_BANK_CONFIG, productCap: 2 });
    try {
      const plan = allPlans(ctx.sub, ctx.gen, OURS, 1)[0] as JointPlan;
      const out = ctx.bank.price(plan);
      expect(out.members.some((m) => m.rung === 'B3')).toBe(false);
      // And the cheaper rungs carried on, so the answer is still a bracket.
      expect(out.bounds.worst).toBeLessThanOrEqual(out.bounds.best);
    } finally {
      ctx.close();
    }
  });
});

describe('B2 — witnesses are upper-bound certificates', () => {
  test('a witness lowers the ceiling and never moves the floor', () => {
    let lowered = 0;
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const spec = seededBoard(seed, 6, 1);
      const ctx = bankFor(spec, { b1: false, b2: true, b3: false });
      const plain = bankFor(spec, B0_ONLY, undefined, ctx.board);
      try {
        // A real opponent joint, taken from the enemy's own option list. Every
        // one of them is a sound upper-bound certificate on the security
        // value, because the security value is a MIN over replies.
        const enemyId = spec.units.filter((u) => u.team === THEIRS)[0]!.id;
        const enemyOptions = ctx.gen.candidatesFor(
          (ctx.sub as unknown as { withModelled(ids: UnitId[]): Substrate }).withModelled([enemyId]),
          enemyId,
        ).candidates;
        ctx.bank.adoptWitnesses(enemyOptions.map((c) => witnessOf([c], 'enumerated reply')));
        for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 8)) {
          const withWitness = ctx.bank.price(plan);
          const without = plain.bank.price(plan);
          checked++;
          expect(withWitness.bounds.best).toBeLessThanOrEqual(without.bounds.best);
          // A witness is a certificate, not a cover: it may never move a floor.
          expect(withWitness.bounds.worst).toBe(without.bounds.worst);
          expect(
            withWitness.members.filter((m) => m.rung === 'B2').every((m) => m.floor === null),
          ).toBe(true);
          // And the ceiling it produced really is above the truth.
          expect(withWitness.bounds.best).toBeGreaterThanOrEqual(
            trueWorstCase(ctx.board, OURS, plan).value - 1e-9,
          );
          if (withWitness.bounds.best < without.bounds.best) lowered++;
        }
      } finally {
        ctx.close();
        plain.close();
      }
    }

    console.log(`  [B2] ceiling lowered on ${lowered}/${checked} staged sets`);
    expect(checked).toBeGreaterThan(20);
    expect(lowered).toBeGreaterThan(0);
  }, 120_000);

  test('the minimiser of an enumerated group is BANKED as a witness', () => {
    // This is the double oracle's column generation: the reply that punished
    // one plan is remembered and re-priced against the next one.
    const ctx = bankFor(CONTACT, { ...DEFAULT_BANK_CONFIG, gateOnEntanglement: false });
    try {
      expect(ctx.bank.witnesses.length).toBe(0);
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 4)) ctx.bank.price(plan);
      expect(ctx.bank.witnesses.length).toBeGreaterThan(0);
      for (const witness of ctx.bank.witnesses) expect(witness.replies.size).toBeGreaterThan(0);
    } finally {
      ctx.close();
    }
  });

  test('witnesses de-duplicate, so a restart inherits a set rather than a list', () => {
    const ctx = bankFor(CONTACT, { ...DEFAULT_BANK_CONFIG, gateOnEntanglement: false });
    try {
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 8)) ctx.bank.price(plan);
      const keys = ctx.bank.witnesses.map((w) =>
        [...w.replies.values()].map((c) => `${c.unitId}>${c.to}`).sort().join('|'),
      );
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      ctx.close();
    }
  });
});

describe('entanglement gating decides WHO', () => {
  test('a unit that cannot reach a staged path is not enumerated', () => {
    // Two enemies; only the near one can meet our rook this turn.
    const ctx = bankFor(CONTACT, DEFAULT_BANK_CONFIG);
    const ungated = bankFor(CONTACT, { ...DEFAULT_BANK_CONFIG, gateOnEntanglement: false });
    try {
      let gatedFewer = 0;
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 8)) {
        const gated = ctx.bank.price(plan);
        const all = ungated.bank.price(plan);
        if (gated.resolutions < all.resolutions) gatedFewer++;
        // Gating is a WHO cap: it needs no declaration, so the gated answer
        // must stay unconditional.
        expect(gated.bounds.assumptions).toEqual([]);
      }

      console.log(`  [gate] cheaper on ${gatedFewer} staged sets`);
    } finally {
      ctx.close();
      ungated.close();
    }
  });
});

describe('degrading when the substrate cannot model', () => {
  test('the bank falls back to B0 and stays sound', () => {
    // A substrate with only the pinned surface: no withModelled, so B1/B2/B3
    // are not expressible. The floor must get LOOSER, never wrong.
    const board = makeTestBoard(CONTACT);
    const rich = makeSubstrate(board, OURS);
    const poor: Substrate = {
      state: rich.state,
      resolveBoundedFor: (plan, team) => rich.resolveBoundedFor(plan, team),
      entangled: (cells) => rich.entangled(cells),
      influenceOf: (unitId) => rich.influenceOf(unitId),
      release: () => undefined,
    };
    // The evaluator still needs the bounds channel the stub substrate exposes.
    const evaluate = {
      scorePlan: (_sub: Substrate, plan: JointPlan, team: number) => {
        const { worst, best } = rich.boundedFor(plan, team);
        return { lo: worst, est: (worst + best) / 2, hi: best };
      },
    };
    const gen = makeGenerator();
    const bank = new BoundBank({
      sub: poor,
      gen,
      evaluate,
      asTeam: OURS,
      budget: unboundedBudget(),
      basis: [],
      config: DEFAULT_BANK_CONFIG,
    });
    try {
      expect(bank.modelling).toBe(false);
      for (const plan of allPlans(rich, gen, OURS, 8)) {
        const out = bank.price(plan);
        expect(out.members.map((m) => m.rung)).toEqual(['B0']);
        expect(out.bounds.worst).toBeLessThanOrEqual(trueWorstCase(board, OURS, plan).value);
      }
    } finally {
      bank.release();
      rich.release();
    }
  });
});

describe('the ledger translation', () => {
  test('polarity follows the optimistic timeline s assumption, not the channel', () => {
    const board = makeTestBoard(CONTACT);
    const sub = makeSubstrate(board, OURS);
    try {
      const gen = makeGenerator();
      const plan = allPlans(sub, gen, OURS, 24).find((p) => {
        const resolution = sub.resolveBoundedFor(p, OURS);
        return resolution.ledger.length > 0;
      });
      expect(plan).toBeDefined();
      const resolution = sub.resolveBoundedFor(plan as JointPlan, OURS);
      const translated = ledgerOf(resolution);
      expect(translated.length).toBeGreaterThan(0);
      for (const raw of resolution.ledger) {
        const wanted = raw.assumedPresent ? 'if_absent' : 'if_present';
        expect(
          translated.some((e) => e.cell === raw.cell && e.subStep === raw.subStep && e.polarity === wanted),
        ).toBe(true);
      }
      // Deduplicated and canonically ordered — it is part of a bound's identity.
      const keys = translated.map((e) => `${e.unitId}:${e.cell}:${e.subStep}:${e.polarity}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort()).toEqual(keys);
    } finally {
      sub.release();
    }
  });
});

describe('the est channel never adjudicates', () => {
  test('est is clamped inside the bracket it is reported with', () => {
    const ctx = bankFor(CONTACT, DEFAULT_BANK_CONFIG);
    try {
      for (const plan of allPlans(ctx.sub, ctx.gen, OURS, 12)) {
        const out = ctx.bank.price(plan);
        expect(out.est).toBeGreaterThanOrEqual(out.bounds.worst);
        expect(out.est).toBeLessThanOrEqual(out.bounds.best);
      }
    } finally {
      ctx.close();
    }
  });
});
