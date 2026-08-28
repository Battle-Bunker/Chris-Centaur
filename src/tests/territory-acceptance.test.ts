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
  TERRITORY_SLIDER_PROFILE,
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

  test('and neither can, on ANY board, by construction rather than by sample', () => {
    // Both features are normalised, so their ranges are bounded independently of
    // the board: reach by the open cells, room by THE WHOLE BOARD's trail
    // population. Without that, room's range would grow with the roster and a
    // weight that clears the cliff on a three-snake board would breach it on a
    // five.
    //
    // PREMISE CORRECTED, TWICE, AND THE SECOND CORRECTION IS THE FIX.
    //
    // (1) integ/round-a's rf-falsifier found the claim false as written: room
    //     was normalised by `trailScaleOf` = the LARGEST SINGLE TEAM's trail
    //     count, while the subtraction is ours minus EVERY other team's. Our
    //     own admitted trails are bounded by the divisor, but each of the other
    //     K−1 teams contributes up to a full divisor's worth, so the true range
    //     was room ∈ [−(K−1), +1] and the span was K, not 2. Measured: 160,826
    //     readings, observed range [−2.000, +1.000], 6.06% below −1, every one
    //     of them on a three-team board. arch/s2 recorded that as a red-in-
    //     waiting ("AT TWO TEAMS, which is the real premise") and deliberately
    //     did NOT renormalise, because that was ledger item O-P3 with its own
    //     measurement arm.
    //
    // (2) fix/o-p3 LANDED (merged here on arch/s3): `trailScaleOf` now sums the
    //     whole board's trail population instead of taking the per-team max, so
    //     the numerator's positive part is bounded by our share of the divisor
    //     and its negative part by the rest. room ∈ [−1, +1] for every K, the
    //     span is 2 board-independently, and the sentence in this test's title
    //     is true as written for the first time.
    //
    // So the `× 2` below is now a certificate rather than a hard-coded guess,
    // and the three-team test underneath it is what keeps it honest against
    // real readings.
    expect((TERRITORY_PROFILE.weights.reach as number) * 2).toBeLessThan(ceiling);
    expect((TERRITORY_PROFILE.weights.room as number) * 2).toBeLessThan(ceiling);
  });

  /**
   * THE THREE-TEAM CASE, which this corpus did not have.
   *
   * Both acceptance fixtures (`snakes11`, `mid11`) are TWO-team boards, so the
   * range defect could not appear in this suite however many samples were added
   * to it — the old and new divisors agree at K = 2. That absence is the reason
   * the by-construction claim above went unchallenged, so the fix arrives with
   * the board shape that can falsify it.
   *
   * `mid11` re-teamed three ways, each team fielding trail units. Verified to
   * FAIL against the pre-fix divisor: red and blue read −1.5000 there, against
   * −0.7500 worst case now.
   */
  test('room stays inside [-1, 1] on a THREE-team board, for every seat', () => {
    const board = JSON.parse(JSON.stringify(MID11.board)) as Board;
    const greens = new Set(['b3', 'b5', 'r5']);
    const blues = new Set(['b0', 'b1', 'b2', 'b4']);
    for (const s of board.snakes ?? []) {
      const id = s.id;
      (s as { teamID: string }).teamID = greens.has(id)
        ? 'green'
        : blues.has(id)
          ? 'blue'
          : 'red';
    }
    const teams = [...new Set((board.snakes ?? []).map((s) => s.teamID as string))];
    expect(teams).toHaveLength(3);

    for (const team of teams) {
      const ourIds = (board.snakes ?? [])
        .filter((s) => s.teamID === team)
        .map((s) => s.id);
      const sub = makeSubstrate({ board, turn: MID11.turn, asTeam: team, modeled: ourIds });
      try {
        const asTeam = sub.teamNumber(team);
        const units = sub.roster().filter((u) => sub.modeled().has(u.unitId));
        for (let k = 0; k < 6; k++) {
          const plan = new Map<UnitId, Candidate>();
          for (const u of units) {
            const acts = sub.actionsOf(u.unitId);
            const a = acts[k % acts.length] as { to: number };
            plan.set(u.unitId, {
              unitId: u.unitId,
              from: u.cells[0] as number,
              to: a.to,
              path: sub.pathFor(u.unitId, a.to) ?? [],
            });
          }
          const room = defaultEvaluator.evaluatePlan(sub, plan, asTeam).parts['room']?.lo ?? 0;
          expect([team, k, room >= -1 && room <= 1]).toEqual([team, k, true]);
        }
      } finally {
        sub.release();
      }
    }
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
      // RE-DERIVED ON arch/s3, WHICH IS WHAT THIS ENTRY ASKED FOR. It used to
      // return `teams`: room was normalised by `trailScaleOf` = the LARGEST
      // SINGLE TEAM's trail count while the subtraction is ours minus EVERY
      // other team's, so the floor was -(K-1) and the span was K (measured:
      // 6.06% of corpus readings below -1, minimum exactly -2.000). fix/o-p3
      // landed in this branch's merge and `trailScaleOf` now sums the WHOLE
      // board's trail population, so our share bounds the positive part and
      // the rest bounds the negative one: room ∈ [-1, +1] at every K and the
      // span is 2, board-independently. The `teams` parameter stays in this
      // function's signature because `command` below still needs it.
      case 'room':
        return 2;
      // The slider repair's gradient (idea/i2, merged here). Each unit's term
      // is clipped into [0, 1] and the sum is divided by ONE team's worth of
      // pieces (`pieceScaleOf` is a per-team max, not a board sum), so `ours`
      // contributes at most 1 and `theirs` at most K-1: command ∈ [-(K-1), +1]
      // and the span is K. This is the shape room USED to have, and it is
      // certified rather than renormalised because at w=2 it clears the
      // ceiling on its own at every K the rules field can produce
      // (`territory-slider.test.ts` checks it at four teams, one more than the
      // field). Only `TERRITORY_SLIDER_PROFILE` weights it; on every other
      // registered profile the weight is 0 and this span multiplies to nothing.
      case 'command':
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

  test('THE CERTIFIED SUM NOW CLEARS THE CLIFF AT THREE TEAMS TOO — O-P3 LANDED', () => {
    // The realized numbers above are a sample. THIS is the by-construction
    // statement, and it is the one an escalation semantics would have to rest
    // on — a guarantee that holds on the boards we happened to measure is not
    // a guarantee.
    //
    // Still a LOWER BOUND on the true certified sum: `healthEconomy` and
    // `kingMargin` are in the ordering channel, contribute measurably (39% of
    // the realized budget at scale), and have no a-priori bound at all.
    const certifiable = (profile: typeof TERRITORY_PROFILE, teams: number) =>
      ['reach', 'room', 'command'].reduce(
        (sum, key) =>
          sum + ((profile.weights[key] as number) ?? 0) * (certifiedSpan(key, teams) as number),
        0
      );

    // WHAT arch/s2 ASSERTED HERE, AND WHY IT CHANGED. That stage recorded
    // `certifiable(2) === 8` and `certifiable(3) === 11 > 10` — room's span was
    // K, so reach + room breached the ceiling at three teams before either
    // uncertified feature was counted — and said in as many words: "when O-P3
    // lands, this test goes red and is the place to re-derive from." O-P3 is in
    // this branch's merge. Room's certified span is now 2 at every K, so:
    //
    //   territory:  1x2 + 3x2 + 0xK = 8, at K = 2 AND at K = 3.
    //
    // The two-team number is UNCHANGED (the old and new divisors agree at
    // K = 2, which is why the acceptance corpus could never see the defect),
    // and the three-team number falls 11 -> 8. The certified guarantee holds at
    // three teams for the first time, with 2.0 of headroom for the two
    // uncertified terms rather than -1.0. That is the whole point of the
    // renormalisation and it is asserted, not narrated.
    expect(certifiable(TERRITORY_PROFILE, 2)).toBe(8);
    expect(certifiable(TERRITORY_PROFILE, 3)).toBe(8);
    expect(certifiable(TERRITORY_PROFILE, 3)).toBeLessThan(ceiling);

    // THE SLIDER PROFILE PAYS FOR ITS OWN GRADIENT, and it is the one registered
    // row whose certificate is still K-dependent: `command` is normalised by
    // ONE team's worth of pieces, which is the shape room USED to have.
    // 1x2 + 3x2 + 2xK = 8 + 2K.
    //
    //   K = 2: 12 — over the ceiling of 10, on the certified core alone.
    //   K = 3: 14 — further over.
    //
    // RECORDED RATHER THAN PAPERED OVER, and it is exactly the state territory
    // itself was in at three teams before O-P3 landed: the CERTIFIED sum
    // breaches while the EMPIRICAL one does not. What carries this row today is
    // the realized measurement — the summed-budget test above walks every
    // registered cohort, this one included, and fails loudly at 75% of the
    // ceiling — plus the fact that `command` is identically zero on a board
    // with no piece on it, so the breach can only be approached on exactly the
    // boards the detector admits this profile for.
    //
    // Two consequences worth writing down here rather than in a report:
    //   * nothing on this branch lets a richer rung overturn a cheaper one's
    //     verdict, and this arithmetic is the reason that stays true — an
    //     escalation semantics would have to normalise `command` by the whole
    //     board's piece population the way `room` now is, FIRST;
    //   * `territory-slider.test.ts` asserts the same certificate from the
    //     other side (`w x teams < ceiling` at four teams) using the SLIDER
    //     profile's weight alone, without reach and room in the sum. Both are
    //     true; this one is the sum, and the sum is what the cliff is about.
    // The renormalisation is NOT made here: it is a behaviour change with its
    // own measurement arm.
    expect(certifiable(TERRITORY_SLIDER_PROFILE, 2)).toBe(12);
    expect(certifiable(TERRITORY_SLIDER_PROFILE, 2)).toBeGreaterThan(ceiling);
    expect(certifiable(TERRITORY_SLIDER_PROFILE, 3)).toBe(14);
    expect(certifiable(TERRITORY_SLIDER_PROFILE, 3)).toBeGreaterThan(ceiling);
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
