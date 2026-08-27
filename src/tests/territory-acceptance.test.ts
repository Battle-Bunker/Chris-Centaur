/**
 * THE ACCEPTANCE POSITIONS — what the territory features must get right, on
 * boards taken from real matches rather than from a fixture author's intuition.
 *
 * A–C are snakes11 seed 116, both swaps, from the legacy deep-dive: the two
 * matches whose whole story is positional. The legacy path won both while
 * material stayed FLAT for ten and seventeen turns respectively, and the thing
 * that moved was territory. B is the one a Voronoi COUNT misses entirely — a
 * snake at exactly its own body length of room, nine turns before it dies.
 *
 * D is the slider guard: a mixed board, where the all-kinds fold this replaced
 * read 0.4 cells of 121 and pinned the floor at −1.
 *
 * E is the staleness guard: the same boards with every enemy two turns stale,
 * which is the shape a construction change would quietly make vacuous.
 *
 * And the CLIFF INEQUALITY is asserted here rather than in a comment, over the
 * ranges these boards actually produce, because that is the one thing that
 * turns "territory is a tie-breaker" from a convention into a checked
 * invariant.
 */

import type { Board } from '../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { EngineSubstrate } from '../lobster/substrate';
import {
  ALL_FEATURES,
  BoundEvaluator,
  CLIFF_MATERIAL_WEIGHT,
  COHORTS,
  DEFAULT_WEIGHTS,
  TERRITORY_PROFILE,
  defaultEvaluator,
  makeContext,
  materialEvaluator,
} from '../lobster/evaluate';
import type { Partition, Standing } from '../lobster/evaluate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import fixture from './fixtures/territory-acceptance.json';

interface Sample {
  seed: number;
  swap: number;
  team: string;
  turn: number;
  board: Board;
}

const SNAKES11 = fixture.snakes11 as unknown as Sample[];
const MID11 = fixture.mid11 as unknown as Sample;

const boardAt = (swap: number, turn: number): Sample => {
  const hit = SNAKES11.find((b) => b.swap === swap && b.turn === turn);
  if (hit === undefined) throw new Error(`no fixture board for swap ${swap} turn ${turn}`);
  return hit;
};

/** Every joint plan over our own units, capped — the candidate set a decision
 * would order. Deterministic: roster order, then the engine's enumeration. */
function ourPlans(sub: EngineSubstrate, asTeam: number, cap: number): JointPlan[] {
  let plans: Array<Map<UnitId, Candidate>> = [new Map()];
  for (const u of sub.roster()) {
    if (u.team !== asTeam) continue;
    const next: Array<Map<UnitId, Candidate>> = [];
    for (const p of plans) {
      for (const a of sub.enumerate(u.unitId)) {
        if (next.length >= cap) break;
        const m = new Map(p);
        m.set(u.unitId, {
          unitId: u.unitId,
          from: -1,
          to: a.dest,
          path: a.action.kind === 'move' ? [...a.action.path] : [],
        });
        next.push(m);
      }
      if (next.length >= cap) break;
    }
    plans = next;
  }
  return plans;
}

interface Reading {
  reachLo: number[];
  reachHi: number[];
  roomLo: number[];
  /** Floors under three profiles, so "did the feature move the choice" is answerable. */
  materialLo: number[];
  reachOnlyLo: number[];
  fullLo: number[];
  /** The lo-reading partition at plan 0. */
  first: Partition<Standing>;
  plans: number;
}

/** The reach/king profile WITHOUT room, so room's marginal effect is visible. */
const reachOnly = new BoundEvaluator({
  name: 'reach-only',
  weights: { ...DEFAULT_WEIGHTS, room: 0 },
  // Room is measured and not scored here, so it stays INVOKED: the compute gate
  // and the weight are independent knobs (see `CriterionProfile.invoked`).
  invoked: ALL_FEATURES,
  reachHorizonTurns: TERRITORY_PROFILE.reachHorizonTurns,
});

function read(sample: Sample, staleness = 0): Reading {
  const { board, turn, team } = sample;
  const ourIds = (board.snakes ?? [])
    .filter((s) => (s.teamID ?? s.id) === team && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const observedTurns =
    staleness > 0
      ? new Map(
          (board.snakes ?? [])
            .filter((s) => !ourIds.includes(s.id))
            .map((s) => [s.id, turn - staleness] as [string, number])
        )
      : undefined;
  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds, observedTurns });
  try {
    const asTeam = sub.teamNumber(team);
    const plans = ourPlans(sub, asTeam, 64);
    const out: Reading = {
      reachLo: [],
      reachHi: [],
      roomLo: [],
      materialLo: [],
      reachOnlyLo: [],
      fullLo: [],
      first: null as unknown as Partition<Standing>,
      plans: plans.length,
    };
    plans.forEach((plan, i) => {
      const ev = defaultEvaluator.evaluatePlan(sub, plan, asTeam);
      out.reachLo.push(ev.parts['reach']?.lo ?? 0);
      out.reachHi.push(ev.parts['reach']?.hi ?? 0);
      out.roomLo.push(ev.parts['room']?.lo ?? 0);
      out.fullLo.push(ev.bound.lo);
      out.materialLo.push(materialEvaluator.evaluatePlan(sub, plan, asTeam).bound.lo);
      out.reachOnlyLo.push(reachOnly.evaluatePlan(sub, plan, asTeam).bound.lo);
      if (i === 0) {
        sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
          out.first = makeContext(sub, resolution, bounds, asTeam, 4).partition('lo');
          return null;
        });
      }
    });
    return out;
  } finally {
    sub.release();
  }
}

const span = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
const argmax = (xs: number[]): number => {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if ((xs[i] as number) > (xs[best] as number) + 1e-9) best = i;
  return best;
};
const separation = (xs: number[]): number => {
  let sep = 0;
  let pairs = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      pairs++;
      if (Math.abs((xs[i] as number) - (xs[j] as number)) > 1e-9) sep++;
    }
  }
  return pairs === 0 ? 0 : sep / pairs;
};
/** The per-unit room of one of OUR units, by wire id, at plan 0. */
const roomOf = (sub: EngineSubstrate, p: Partition<Standing>, wireId: string) =>
  p.trails.find((t) => t.mine && sub.unitOf(t.subject.unitId)?.wireId === wireId);
/** Same, without a substrate handy: match on the ordered list of ours. */
const oursIn = (p: Partition<Standing>) => p.trails.filter((t) => t.mine);

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------------------

describe('A — food control decided by the partition (seed 116 swap 0, turn 2)', () => {
  const sample = boardAt(0, 2);
  const r = read(sample);

  test('the territory floor is a gradient here, not a constant', () => {
    // T1 read this position as blue 59 cells / 3 food against red 48 / 0, and
    // the whole match turned on it. A floor that cannot tell the candidates
    // apart cannot express that.
    expect(r.plans).toBe(64);
    expect(span(r.reachLo)).toBeGreaterThan(0.3);
    expect(separation(r.reachLo)).toBeGreaterThan(0.9);
  });

  test('per-unit room reads the two roomy snakes, at the counts the lens measured', () => {
    const ours = oursIn(r.first);
    expect(ours.map((t) => `${t.owned}/${t.subject.weightMax}`)).toEqual(['25/3', '15/3']);
    // Both comfortably above their own body length: nothing is boxed here.
    for (const t of ours) expect(Math.sqrt(t.owned / t.subject.weightMax)).toBeGreaterThan(2);
  });
});

describe('B — confinement invisible to material (seed 116 swap 1, turn 7)', () => {
  // Material is 11 v 11 and stays 11 v 11 for eight more turns. b0 dies at
  // turn 16. This is the position a partition COUNT misses and a per-unit room
  // term does not.
  const sample = boardAt(1, 7);
  const r = read(sample);

  test('b0 sits at exactly its own body length of room; b1 does not', () => {
    const sub = makeSubstrate({
      board: sample.board,
      turn: sample.turn,
      asTeam: sample.team,
      modeled: (sample.board.snakes ?? []).filter((s) => s.teamID === sample.team).map((s) => s.id),
    });
    try {
      const b0 = roomOf(sub, r.first, 'b0');
      const b1 = roomOf(sub, r.first, 'b1');
      expect(b0).toBeDefined();
      expect(b1).toBeDefined();
      expect([b0?.owned, b0?.subject.weightMax]).toEqual([3, 3]);
      expect([b1?.owned, b1?.subject.weightMax]).toEqual([12, 4]);
      // b0 is AT the threshold — one cell fewer and its term starts falling —
      // while b1 is a factor of sqrt(3) clear of it.
      expect(Math.sqrt((b0 as { owned: number }).owned / 3)).toBeCloseTo(1, 10);
      expect(Math.sqrt((b1 as { owned: number }).owned / 4)).toBeCloseTo(Math.sqrt(3), 10);
    } finally {
      sub.release();
    }
  });

  test('the two features are not redundant: each moves the choice the other does not', () => {
    const mat = argmax(r.materialLo);
    const withReach = argmax(r.reachOnlyLo);
    const withBoth = argmax(r.fullLo);
    expect(withReach).not.toBe(mat);
    expect(withBoth).not.toBe(withReach);
  });
});

describe('C — the slow squeeze (seed 116 swap 0, turns 6–22)', () => {
  const arc = [6, 14, 18, 22].map((turn) => ({ turn, r: read(boardAt(0, turn)) }));

  test('material cannot order these candidates and the territory floor can', () => {
    // T1's reading of this arc: material 9 v 13, CONSTANT from turn 6 to turn
    // 22, while the Voronoi slid from 68/52 to 29/89 — the whole game decided
    // inside a signal material-only cannot see. Across candidates the same
    // thing shows up as resolution: material's floor takes a handful of values
    // (survive, or lose one of a few units), territory takes dozens.
    const distinct = (xs: number[]): number => new Set(xs.map((x) => x.toFixed(9))).size;
    for (const { turn, r } of arc) {
      // Material's only distinct floors here are cliff levels — how many of
      // ours die — never anything about the position itself.
      expect([turn, distinct(r.materialLo) <= 4]).toEqual([turn, true]);
      expect([turn, distinct(r.reachLo) >= 2 * distinct(r.materialLo)]).toEqual([turn, true]);
      expect([turn, span(r.reachLo) > 0.3]).toEqual([turn, true]);
    }
  });

  test('the floor argmax moves at every turn of the arc, and material cannot move it', () => {
    for (const { turn, r } of arc) {
      expect([turn, argmax(r.reachOnlyLo) !== argmax(r.materialLo)]).toEqual([turn, true]);
    }
  });

  test("r2's room follows the squeeze and the recovery, cell for cell", () => {
    // 10 → 5 → 10 → 16 across turns 6, 14, 18, 22, against a body of 3.
    const owned = arc.map(({ r }) => {
      const last = oursIn(r.first).slice(-1)[0];
      return last === undefined ? -1 : last.owned;
    });
    expect(owned).toEqual([10, 5, 10, 16]);
  });
});

describe('D — the slider guard (mid11 seed 101)', () => {
  const r = read(MID11);

  test('the floor is a gradient, not the pinned −1 the all-kinds fold produced', () => {
    // Under the fold this replaced, this position read ours = 0.4 of 121 with
    // reach.lo pinned in [−1.0000, −0.8595]: 0.14 of range and no ordering.
    expect(Math.min(...r.reachLo)).toBeGreaterThan(-1);
    expect(span(r.reachLo)).toBeGreaterThan(0.2);
    expect(separation(r.reachLo)).toBeGreaterThan(0.5);
  });

  test('the ceiling is not pinned at "we own everything" either', () => {
    expect(Math.max(...r.reachHi)).toBeLessThan(1);
    expect(span(r.reachHi)).toBeGreaterThan(0.2);
  });

  test('the LEVEL stays low, and that is the honest reading rather than a bug', () => {
    // A held enemy is a turn behind us on the clock and its one-move cloud is
    // a whole slider line, so a SOUND floor on a slider board concedes most of
    // the board. What the two-plane rule buys is not a higher level — it is an
    // ordering. Pinned so that a future change claiming to "fix the level" has
    // to say what it did to soundness.
    expect(r.first.ours / r.first.open).toBeLessThan(0.2);
    expect(r.first.trails.some((t) => t.mine && t.owned > 20)).toBe(true);
  });
});

describe('E — the two-turn-stale guard', () => {
  const stale = [2, 6, 10, 14].map((turn) => ({ turn, r: read(boardAt(0, turn), 2) }));

  test('the floor still orders candidates under stale clouds', () => {
    for (const { turn, r } of stale) {
      expect([turn, separation(r.reachLo) > 0.5]).toEqual([turn, true]);
    }
  });

  test('staleness erodes the floor without collapsing it', () => {
    for (const { turn, r } of stale) {
      expect([turn, span(r.reachLo) > 0]).toEqual([turn, true]);
      expect([turn, span(r.roomLo) > 0]).toEqual([turn, true]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the cliff inequality, over the acceptance boards', () => {
  const samples = [
    ...SNAKES11.map((s) => ({ label: `swap${s.swap} t${s.turn}`, r: read(s) })),
    { label: 'mid11', r: read(MID11) },
    ...[2, 6, 10, 14].map((turn) => ({ label: `stale t${turn}`, r: read(boardAt(0, turn), 2) })),
  ];

  /**
   * `w_feature × observed range < 10 × lightest unit weight`.
   *
   * The cliff itself is preserved at ANY weight, by construction: a contingent
   * unit of ours is dropped from `lo` by the same predicate material uses, so a
   * unit that might die contributes no territory to the floor exactly as it
   * contributes no material. What this protects is the TRADE — an ordering term
   * must never outrank a contingent death, and losing the lightest possible
   * unit costs 10.
   */
  const LIGHTEST_UNIT_WEIGHT = 1;
  const ceiling = CLIFF_MATERIAL_WEIGHT * LIGHTEST_UNIT_WEIGHT;

  test('reach cannot outrank the lightest death anywhere in the set', () => {
    for (const { label, r } of samples) {
      const cost = (TERRITORY_PROFILE.weights.reach as number) * span(r.reachLo);
      expect([label, cost < ceiling]).toEqual([label, true]);
    }
  });

  test('room cannot outrank the lightest death anywhere in the set', () => {
    for (const { label, r } of samples) {
      const cost = (TERRITORY_PROFILE.weights.room as number) * span(r.roomLo);
      expect([label, cost < ceiling]).toEqual([label, true]);
    }
  });

  test('and neither can, by construction — AT TWO TEAMS, which is the real premise', () => {
    // THIS TEST USED TO CLAIM "on ANY board". IT WAS WRONG, AND THE CORRECTION
    // MATTERS. `reach` really is bounded independently of the board: it is
    // normalised by the open cells, so it lives in [-1, 1] and its span is 2
    // whatever is playing. `room` is normalised by `trailScaleOf` — the
    // LARGEST SINGLE TEAM's trail count — and the subtraction is ours minus
    // EVERYONE else's. On a K-team board the worst case is therefore
    // -(K - 1) rather than -1, so room lives in [-(K-1), 1] and its span is K.
    // Measured on the corpus: 6.06% of readings are below -1, minimum exactly
    // -2.000, which is the three-team case arriving exactly where the algebra
    // says it should.
    //
    // The normalisation is NOT changed here. That is a behaviour change with
    // its own measurement arm (ledger item O-P3); what belongs in a test is
    // the truth about the range it currently has.
    const reachSpan = 2;
    const roomSpanAt = (teams: number) => teams;
    expect((TERRITORY_PROFILE.weights.reach as number) * reachSpan).toBeLessThan(ceiling);
    expect((TERRITORY_PROFILE.weights.room as number) * roomSpanAt(2)).toBeLessThan(ceiling);
    // At three teams the same weight does NOT clear it, on room alone.
    expect((TERRITORY_PROFILE.weights.room as number) * roomSpanAt(3)).toBeGreaterThan(
      ceiling * 0.8
    );
  });

  test('the two together still cannot buy a death', () => {
    for (const { label, r } of samples) {
      const cost =
        (TERRITORY_PROFILE.weights.reach as number) * span(r.reachLo) +
        (TERRITORY_PROFILE.weights.room as number) * span(r.roomLo);
      expect([label, cost < ceiling]).toEqual([label, true]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('a documented boundary: a teammate leaving the board frees its neighbours', () => {
  /**
   * Per-unit room is measured against every OTHER admitted trail unit,
   * teammates included — so when one of ours stops being admitted, a teammate
   * that was sharing ground with it gains room. That is a true fact about the
   * partition and not a bug: the dead unit really is not competing for those
   * cells any more, and its body really does clear.
   *
   * It is pinned because it is the one direction in which a loss can IMPROVE a
   * territory term, and the thing that keeps it harmless is the cliff
   * inequality above: the survivor can gain at most one unit's worth of room,
   * priced at `w_room / trailScale`, against a death priced at `10 × weight`.
   */
  const sample = boardAt(1, 7);
  const board = sample.board;
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === sample.team)
    .map((s) => s.id);

  function roomsWith(present: string[]): Map<string, number> {
    const trimmed: Board = {
      ...board,
      snakes: (board.snakes ?? []).filter(
        (s) => s.teamID !== sample.team || present.includes(s.id)
      ),
    };
    const mine = ourIds.filter((id) => present.includes(id));
    const sub = makeSubstrate({
      board: trimmed,
      turn: sample.turn,
      asTeam: sample.team,
      modeled: mine,
    });
    try {
      const asTeam = sub.teamNumber(sample.team);
      const plan = new Map<UnitId, Candidate>();
      for (const u of sub.roster()) {
        if (u.team !== asTeam) continue;
        const a = sub.enumerate(u.unitId)[0];
        if (a === undefined) continue;
        plan.set(u.unitId, {
          unitId: u.unitId,
          from: -1,
          to: a.dest,
          path: a.action.kind === 'move' ? [...a.action.path] : [],
        });
      }
      const out = new Map<string, number>();
      sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
        const p = makeContext(sub, resolution, bounds, asTeam, 4).partition('lo');
        for (const t of p.trails) {
          if (!t.mine) continue;
          out.set(sub.unitOf(t.subject.unitId)?.wireId ?? '?', t.owned);
        }
        return null;
      });
      return out;
    } finally {
      sub.release();
    }
  }

  test('a survivor’s own region can only grow when a teammate is removed', () => {
    const all = roomsWith(ourIds);
    const fewer = roomsWith(ourIds.filter((id) => id !== 'b0'));
    expect(all.size).toBeGreaterThan(fewer.size);
    for (const [wireId, owned] of fewer) {
      expect([wireId, owned >= (all.get(wireId) ?? 0)]).toEqual([wireId, true]);
    }
    // And at least one of them really did gain, or this test proves nothing.
    expect([...fewer].some(([w, o]) => o > (all.get(w) ?? 0))).toBe(true);
  });

  test('and the loss still costs more than the room it frees', () => {
    // One whole unit of room, at the shipped weight, against the material a
    // weight-1 unit takes with it. The inequality is what makes the boundary
    // above harmless rather than exploitable.
    const roomGain = (TERRITORY_PROFILE.weights.room as number) * 1;
    const deathCost = CLIFF_MATERIAL_WEIGHT * 1;
    expect(roomGain).toBeLessThan(deathCost);
  });
});

// ---------------------------------------------------------------------------

/**
 * THE CLIFF INEQUALITY, SUMMED OVER EVERY ORDERING FEATURE, PER COHORT.
 *
 * The block above asserts it four ways for `reach` and `room`. `healthEconomy`
 * and `kingMargin` appear in none of them — and measured at scale they
 * contribute 39% of the ordering budget actually in use, which means the
 * shipped tests covered 61% of the quantity the invariant is about.
 *
 * The quantity that governs whether a richer objective can OVERTURN a cheaper
 * one's verdict is the sum over EVERY ordering feature in that cohort, against
 * the material a lightest-unit death costs. Anti-spaghetti rule 8 already
 * words it that way; nothing checked it. It is checked here, looped over the
 * registry, so a cohort nobody has raced yet cannot be added without the
 * inequality being asserted for it.
 *
 * ── THE GROWTH HAZARD, STATED RATHER THAN ASSUMED ──────────────────────────
 *
 * `reach` and `room` are NORMALISED, so their ranges are bounded independently
 * of the board and the by-construction assertion above is real. `healthEconomy`
 * is not: it is a bare sum over units of `health / maxHealth`, ours minus
 * theirs, and its spread therefore grows with the roster at roughly 0.4 per
 * commandable unit. This is exactly the failure mode `roomFeature`'s own
 * docstring warns about and `room` was fixed for — "a weight that sits safely
 * under the cliff on a three-snake board sits over it on a five-snake one" —
 * and `healthEconomy` never got the same treatment.
 *
 * So what follows is a SAMPLE at the roster sizes the acceptance boards carry,
 * and it says so. It is not a by-construction bound and must not be read as
 * one. The board sizes and margins are printed by
 * `the summed budget, per cohort, with the roster size it was measured at`
 * so a reader can see how much headroom there actually is.
 */
describe('the cliff inequality, summed per cohort, over the acceptance boards', () => {
  const LIGHTEST_UNIT_WEIGHT = 1;
  const ceiling = CLIFF_MATERIAL_WEIGHT * LIGHTEST_UNIT_WEIGHT;

  const boards: Array<{ label: string; sample: Sample; staleness: number }> = [
    ...SNAKES11.map((s) => ({ label: `swap${s.swap} t${s.turn}`, sample: s, staleness: 0 })),
    { label: 'mid11', sample: MID11, staleness: 0 },
    ...[2, 6, 10, 14].map((turn) => ({
      label: `stale t${turn}`,
      sample: boardAt(0, turn),
      staleness: 2,
    })),
  ];

  /**
   * One cohort's summed ordering budget on one board, plus the roster size it
   * was measured at — because for an unnormalised feature the second number is
   * what makes the first one mean anything.
   */
  function orderingBudget(
    row: { id: string; profile: typeof TERRITORY_PROFILE },
    sample: Sample,
    staleness: number
  ): { sum: number; perFeature: Record<string, number>; ourUnits: number } {
    const { board, turn, team } = sample;
    const ourIds = (board.snakes ?? [])
      .filter((s) => (s.teamID ?? s.id) === team && s.health > 0 && s.body.length > 0)
      .map((s) => s.id);
    const observedTurns =
      staleness > 0
        ? new Map(
            (board.snakes ?? [])
              .filter((s) => !ourIds.includes(s.id))
              .map((s) => [s.id, turn - staleness] as [string, number])
          )
        : undefined;
    const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds, observedTurns });
    try {
      const asTeam = sub.teamNumber(team);
      const evaluator = new BoundEvaluator(row.profile);
      const plans = ourPlans(sub, asTeam, 64);
      const byFeature = new Map<string, number[]>();
      for (const plan of plans) {
        const ev = evaluator.evaluatePlan(sub, plan, asTeam);
        for (const [key, part] of Object.entries(ev.parts)) {
          // `material` is the DENOMINATION, not an ordering term: the cliff
          // lives inside it and it is what the inequality is measured against.
          if (key === 'material') continue;
          const xs = byFeature.get(key) ?? [];
          xs.push(part.lo);
          byFeature.set(key, xs);
        }
      }
      const perFeature: Record<string, number> = {};
      let sum = 0;
      for (const [key, xs] of byFeature) {
        const w = row.profile.weights[key] ?? 0;
        const cost = w * span(xs);
        perFeature[key] = cost;
        sum += cost;
      }
      return { sum, perFeature, ourUnits: ourIds.length };
    } finally {
      sub.release();
    }
  }

  test('EVERY registered cohort is measured, not just the shipped default', () => {
    // The loop is the point: adding a row to the registry adds it here.
    expect(COHORTS.length).toBeGreaterThan(1);
    for (const row of COHORTS) expect(row.profile.invoked.size).toBeGreaterThan(0);
  });

  for (const row of COHORTS) {
    test(`${row.id}: the WHOLE ordering channel cannot buy a lightest-unit death`, () => {
      for (const b of boards) {
        const { sum, perFeature } = orderingBudget(row, b.sample, b.staleness);
        expect([row.id, b.label, sum < ceiling]).toEqual([row.id, b.label, true]);
        // Non-vacuity: a cohort whose ordering channel measured zero
        // everywhere would pass this without the inequality meaning anything.
        expect([row.id, b.label, Object.keys(perFeature).length > 0]).toEqual([
          row.id,
          b.label,
          true,
        ]);
      }
    });

    test(`${row.id}: healthEconomy and kingMargin are in the sum, not silently omitted`, () => {
      // The gap E3 found, closed. Both are invoked by both shipped cohorts, so
      // both must appear in the decomposition on a real board.
      const { perFeature } = orderingBudget(row, MID11, 0);
      for (const key of row.profile.invoked) {
        if (key === 'material') continue;
        expect([row.id, key, key in perFeature]).toEqual([row.id, key, true]);
      }
    });
  }

  test('the summed budget, per cohort, with the roster size it was measured at', () => {
    // THE SAMPLE, PRINTED. `healthEconomy` is unnormalised — its spread grows
    // ~0.4 per commandable unit — so a margin measured at these roster sizes is
    // a fact about these roster sizes and nothing more. The numbers are emitted
    // rather than merely asserted so that the headroom is legible to whoever
    // next changes a weight, adds a cohort, or plays a bigger roster.
    const lines: string[] = [];
    let worst = { label: '', cohort: '', sum: 0, units: 0 };
    for (const row of COHORTS) {
      for (const b of boards) {
        const { sum, perFeature, ourUnits } = orderingBudget(row, b.sample, b.staleness);
        if (sum > worst.sum) worst = { label: b.label, cohort: row.id, sum, units: ourUnits };
        lines.push(
          `${row.id.padEnd(10)} ${b.label.padEnd(14)} units=${ourUnits} ` +
            `sum=${sum.toFixed(3)} ` +
            Object.entries(perFeature)
              .sort(([a], [c]) => a.localeCompare(c))
              .map(([k, v]) => `${k}=${v.toFixed(3)}`)
              .join(' ')
        );
      }
    }
    console.log(
      `\nsummed ordering budget vs cliff ceiling ${ceiling}\n${lines.join('\n')}\n` +
        `worst: ${worst.cohort} on ${worst.label} at ${worst.units} own units = ` +
        `${worst.sum.toFixed(3)} (${((worst.sum / ceiling) * 100).toFixed(1)}% of ceiling)\n`
    );
    expect(worst.sum).toBeLessThan(ceiling);
    // A LOUD guard rather than a silent pass. If the worst measured margin ever
    // gets within a quarter of the ceiling, the sample is no longer comfortable
    // and the unnormalised feature is the thing to look at first: the honest
    // responses are to normalise `healthEconomy` (a calibration change with its
    // own gate) or to state in the table that escalation is overturn-capable on
    // large rosters. Neither is a thing to discover from a red test in a hurry.
    expect(worst.sum).toBeLessThan(ceiling * 0.75);
  });

  // -- the CERTIFIED half: what the ranges are by construction, not by sample --

  /**
   * A feature's by-construction span, or null when nothing certifies one.
   *
   * `teams` is K, the number of teams on the board, because one of these
   * certificates depends on it and the dependence is the finding.
   */
  const certifiedSpan = (key: string, teams: number): number | null => {
    switch (key) {
      // Normalised by the open cells; ours minus theirs lands in [-1, 1]
      // whatever is playing. Genuinely board-independent.
      case 'reach':
        return 2;
      // Normalised by `trailScaleOf` — the LARGEST SINGLE TEAM's trail count —
      // while the subtraction is ours minus EVERY other team's. So the floor
      // is -(K-1), not -1, and the span is K. Measured: 6.06% of corpus
      // readings below -1, minimum exactly -2.000.
      case 'room':
        return teams;
      // NO CERTIFICATE EXISTS. A bare sum over units of health/maxHealth, ours
      // minus theirs, with no roster normalisation: the spread grows with the
      // unit count at roughly 0.4 per commandable unit. This is the failure
      // mode `roomFeature`'s own docstring warns about, and `healthEconomy`
      // never got the same treatment.
      case 'healthEconomy':
        return null;
      // Also uncertified: king weight minus the heaviest same-tier reacher is
      // denominated in weights, and nothing bounds it a priori.
      case 'kingMargin':
        return null;
      default:
        return null;
    }
  };

  test('THE CERTIFIED SUM CLEARS THE CLIFF AT TWO TEAMS AND NOT AT THREE', () => {
    // The realized numbers above are a sample. THIS is the by-construction
    // statement, and it is the one an escalation semantics would have to rest
    // on — a guarantee that holds on the boards we happened to measure is not
    // a guarantee.
    //
    // Only `reach` and `room` are certifiable today, so this is a LOWER BOUND
    // on the true certified sum: `healthEconomy` and `kingMargin` are in the
    // ordering channel, contribute measurably (39% of the realized budget at
    // scale), and have no a-priori bound at all.
    const certifiable = (teams: number) =>
      ['reach', 'room'].reduce(
        (sum, key) =>
          sum + (TERRITORY_PROFILE.weights[key] as number) * (certifiedSpan(key, teams) as number),
        0
      );

    // Two teams: 1x2 + 3x2 = 8, inside a ceiling of 10 — with 2.0 of headroom
    // for the two features that carry no certificate. E3 measured
    // healthEconomy's own realized contribution as high as 2.56 on a
    // seven-unit roster, so even the TWO-team certificate is not comfortable
    // once the uncertified terms are honestly added.
    expect(certifiable(2)).toBe(8);
    expect(certifiable(2)).toBeLessThan(ceiling);

    // Three teams: 1x2 + 3x3 = 11. Over the ceiling on reach and room ALONE,
    // before either uncertified feature is counted. The certified guarantee
    // does not hold at three teams and this test records that rather than
    // hiding it: the empirical guarantee still does (realized spans max 5.09
    // here, 5.75 at scale), which is why nothing is broken today and why the
    // fix is a measured change and not a hotfix.
    //
    // THE FIX IS NOT MADE HERE. Normalising `healthEconomy`, or dividing room
    // by the whole opposing field rather than the largest single team, are
    // behaviour changes with their own measurement arms (ledger item O-P3).
    // When one lands, this test goes red and is the place to re-derive from.
    expect(certifiable(3)).toBe(11);
    expect(certifiable(3)).toBeGreaterThan(ceiling);
  });

  test('the acceptance corpus is TWO-team, so its realized margin is the 2-team story', () => {
    // Stated because the two paragraphs above only mean something together
    // with this one: the boards these numbers were measured on do not contain
    // the case the certificate fails at.
    for (const b of boards) {
      const teams = new Set(
        (b.sample.board.snakes ?? [])
          .filter((snake) => snake.health > 0 && snake.body.length > 0)
          .map((snake) => snake.teamID ?? snake.id)
      );
      expect([b.label, teams.size]).toEqual([b.label, 2]);
    }
  });

  test('the acceptance boards are SMALL, and the bound is a sample because of it', () => {
    // The measurement's own scope, asserted so nobody quotes the margin above
    // as a property of the evaluator. If this test starts failing because the
    // corpus grew, that is the signal to re-derive the healthEconomy bound
    // rather than to raise the number here.
    for (const b of boards) {
      const ourUnits = (b.sample.board.snakes ?? []).filter(
        (s) => (s.teamID ?? s.id) === b.sample.team && s.health > 0 && s.body.length > 0
      ).length;
      expect([b.label, ourUnits <= 8]).toEqual([b.label, true]);
    }
  });
});
