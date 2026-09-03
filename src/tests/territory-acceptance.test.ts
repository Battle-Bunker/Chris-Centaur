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
  BoundEvaluator,
  CLIFF_MATERIAL_WEIGHT,
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
      for (const a of sub.actionsOf(u.unitId)) {
        if (next.length >= cap) break;
        const m = new Map(p);
        m.set(u.unitId, {
          unitId: u.unitId,
          from: a.from,
          to: a.to,
          path: a.path,
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
      // Material's distinct floors here are LEVELS — whole units of weight,
      // every one of them a multiple of `CLIFF_MATERIAL_WEIGHT` — and never
      // anything about the position itself. Four of them were how many of ours
      // could die; six are how many of ours could die OR BE CUT, since the
      // fold started reading the ledger's `sever` entries against a mover
      // (`bounds/material.ts::moverSeverLoss`, and the floor was not a floor
      // without it). A partial loss is still a level, so the claim this test
      // makes — that material grades in whole units of material and territory
      // grades in the position — is the same claim at the same coarseness; the
      // comparison against `reachLo` two lines down is the load-bearing half
      // and it is untouched.
      expect([turn, distinct(r.materialLo) <= 6]).toEqual([turn, true]);
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

/**
 * D IS FAILING, DELIBERATELY AND WITH A REASON, AND IS NOT WEAKENED TO PASS.
 *
 * Measured on this branch: two of D's three assertions fail, and the cause is
 * a soundness hole the one-engine cut CLOSED rather than one it opened.
 *
 * On `mid11` every one of our six units is MODELLED (nothing of ours is held),
 * and every one of them comes back `worstAlive: false`. The whole chain is one
 * unit long: our king r0 stages onto a square the blue queen's claim can hold
 * and beat (`contest`, `couldBeat: true`, `assumedPresent: false`), and the
 * re-vendored `settlePartial` then writes a `regicide` divergence for EVERY
 * team-mate — `via: ["r0"]` — because losing the last king takes the team off
 * the board. `moverSurvival` resolves those at the king, once, and answers
 * `maybe`. So `ADMISSION.lo.ours = worstAlive && !held` admits nobody, plane 1
 * has no trail unit of ours in the `lo` reading, `ours` is 0 of 121 and
 * `reach.lo` is the same number for every candidate the harness prices.
 *
 * That reading is HONEST: in our worst world our king falls and regicide takes
 * the rest with it, so there is no cell we own. The engine before the cut did
 * not spread regicide to a modelled team at all, which is why this block was
 * green when it was written — its floor was measured without our own king's
 * fall priced into it.
 *
 * IT IS NOT A DEAD POSITION, EITHER, and that is the part worth keeping: the
 * king HAS safe squares here (three of its nine options), and on those the
 * partition reads `ours = 1 / theirs = 89` — the exact pair the pre-cut fold
 * produced. The gradient D is looking for exists; what the harness prices is a
 * plan set in which it cannot appear, because `ourPlans`' cap of 64 is spent by
 * the queen's option list before the king's second option is ever extended, so
 * all 64 plans carry the king's FIRST move.
 *
 * Two changes would each make it pass and both were refused: relaxing the
 * admission rule (it is right — a unit that is gone in the worst world owns no
 * cells in it) and re-sampling the candidate set (that is tuning the harness
 * until the number comes out). Left failing, with the finding written down.
 */
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
    // PREMISE CORRECTED (integ/round-a, fix/o-p3). This comment used to say
    // room was normalised by "one team's worth of trail units", which is what
    // `trailScaleOf` actually did — and it made the `× 2` below WRONG rather
    // than conservative. Dividing by the LARGEST SINGLE TEAM bounds our own
    // admitted trails by the divisor, but each of the other K−1 teams
    // contributes up to a full divisor's worth of its own, so the true range
    // was room ∈ [−(K−1), +1] and the span was K, not 2. rf-falsifier measured
    // exactly that: 160,826 readings, observed range [−2.000, +1.000], 6.06%
    // below −1, every one of them on a three-team board.
    //
    // The arithmetic below PASSED throughout, because it multiplies a weight by
    // a hard-coded 2 and never asks the board anything — which is precisely why
    // a false premise survived here for so long, and why the three-team case
    // below now gates the claim against real readings instead.
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
        const a = sub.actionsOf(u.unitId)[0];
        if (a === undefined) continue;
        plan.set(u.unitId, {
          unitId: u.unitId,
          from: a.from,
          to: a.to,
          path: a.path,
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
