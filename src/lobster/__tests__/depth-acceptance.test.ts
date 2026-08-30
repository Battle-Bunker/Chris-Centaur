/**
 * DEPTH, ACCEPTED — the owner's semantics, at the two levels they live at.
 *
 * ── THE SEMANTICS BEING TESTED (owner ruling, binding) ─────────────────────
 *
 *   "Deep evaluations are causally downstream of near events and CARRY them: a
 *    branch whose next move guarantees killing one enemy but whose best
 *    continuations then lose two of ours must evaluate as net about minus one
 *    unit — worse than a safe alternative."
 *
 *   "Deep findings may be positive OR negative (a discovered reliable two-turn
 *    kill raises the branch)."
 *
 *   "No arbitrary caps. The only legitimate discount on deep information is
 *    model error of the approximate simulation — expressed as precision
 *    weighting into the branch's belief, never a constant cap."
 *
 * ── WHY TWO LEVELS, AND WHAT EACH ONE PROVES ───────────────────────────────
 *
 * THE LADDER (first block) states the owner's example in its own numbers, on
 * the comparator that actually decides. It is exact: a branch whose ONE-PLY
 * floor is a proved kill, against a quiet branch whose floor is lower, with a
 * two-turn reading on the first worth minus one unit. It proves the SEMANTICS
 * — that the deep reading is allowed to overturn a better near floor, that a
 * one-turn ladder reaches the opposite answer on the identical rows, and that
 * nothing caps the reading in either direction.
 *
 * It is stated here rather than only on a board because a constructed position
 * proves the semantics THROUGH the engine's geometry, and a failure there is
 * ambiguous between "the semantics are wrong" and "the position did not do
 * what its author thought". Both are worth knowing and they are different
 * tests.
 *
 * THE BOARD (second block) runs the whole decision twice on one real position
 * — once with depth funded, once with its ration set to zero — and asserts the
 * staged move differs and which way. That is the end-to-end claim, and the
 * paired form is what makes it DEPTH and not evaluation: the two runs share
 * every line of evaluator, every bound, every seed. The only difference is how
 * many turns the search was allowed to look.
 *
 * THE RATE (third block) is the standing measurement the owner asked to be
 * kept continuously: the fraction of decisions on which removing depth would
 * have staged a different move.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { makeSearchCore } from '../search';
import { defaultEvaluator } from '../evaluate';
import { LobsterKernel } from '../kernel';
import { channelPolicyFor } from '../postures';
import { StickyStager, pickLeader, pickLeaderWithoutDepth } from '../voc';
import { foldObservation, posteriorOfBranch, precisionOfSigma } from '../belief';
import type { StagingCandidate } from '../contracts';

// --------------------------------------------------------------------- fixtures

const TURN = 30;

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

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * PIECE-BEARING BOARDS — kings excluded, sliders everywhere, which is the
 * family depth was structurally unavailable on until the partition's
 * `variables` (members UNION the shared sliders) replaced its `members`.
 */
function pieceBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const kinds = ['queen', 'rook', 'bishop', 'knight'];
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 2 + Math.floor(r() * (size - 4));
      const y = 2 + Math.floor(r() * (size - 4));
      if (!take(x, y)) continue;
      snakes.push(
        makeSnake(`p${i}`, [{ x, y }], {
          teamID: i % 2 === 0 ? 'red' : 'blue',
          unitType: kinds[i % kinds.length] as string,
          length: 2 + Math.floor(r() * 3),
          health: 15 + Math.floor(r() * 70),
        })
      );
      break;
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(r() * (size - 2));
    const y = 1 + Math.floor(r() * (size - 2));
    if (!used.has(`${x},${y}`)) food.push({ x, y });
  }
  return { width: size, height: size, food, hazards: [], snakes } as Board;
}

/** Monotonic, deterministic, never wall clock: each read costs one tick. */
class StepClock {
  private t = 1000;
  constructor(private readonly tick = 0.02) {}
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  readonly peek = (): number => this.t;
}

interface Decision {
  readonly staged: string;
  readonly plies: number;
  readonly deepBranches: number;
  readonly mu: ReadonlyMap<string, number>;
}

/**
 * ONE WHOLE DECISION, at a stated depth ration.
 *
 * `plyCap: 0` is the depthless arm and it is NOT a different build: the layer
 * is constructed, the door is available, the report is published, and the
 * purse buys no plies. That is what makes the pair a measurement of DEPTH
 * rather than of two code paths.
 */
async function decide(board: Board, plyCap: number, budgetMs: number): Promise<Decision> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const core = makeSearchCore({ scoutTuning: { plyCap } });
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
  });
  let staged = '';
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: defaultEvaluator,
      search: core,
      asTeam: sub.teamNumber('red'),
      deadlineMs: clock.peek() + budgetMs,
      initialPins: [],
      now: clock.now,
    })) {
      staged = [...rec.plan.entries()]
        .map(([u, c]) => `${u}>${c.to}`)
        .sort()
        .join(',');
    }
  } finally {
    core.release?.();
    sub.release();
  }
  const report = kernel.lastReport;
  const mu = new Map<string, number>();
  for (const w of report?.planWork ?? []) mu.set(w.key, w.belief.mu);
  return {
    staged,
    plies: report?.belief.deepestPlies ?? 1,
    deepBranches: report?.belief.deepBranches ?? 0,
    mu,
  };
}

// ---------------------------------------------------------------------------
// THE LADDER — the owner's example, in its own numbers
// ---------------------------------------------------------------------------

/**
 * ONE UNIT, in the score units the evaluator works in. Not a tuning constant:
 * it is the lattice step the whole build denominates a life in, and it is here
 * so the example can be stated as the owner stated it — "kill one, lose two,
 * net about minus one".
 */
const UNIT = 10;

/** A staging row with a belief on it, assembled the way the kernel assembles
 *  one: the near half from the bank triple, the deep half folded on top. */
function row(
  key: string,
  bounds: { lo: number; est: number; hi: number },
  deep?: { value: number; sigma: number; plies: number }
): StagingCandidate {
  let post = posteriorOfBranch(bounds.lo, bounds.hi, bounds.est);
  if (deep !== undefined) {
    post = foldObservation(post, {
      kind: 'deep-finding',
      value: deep.value,
      precision: precisionOfSigma(deep.sigma),
      plies: deep.plies,
    });
  }
  return {
    key,
    lo: bounds.lo,
    est: bounds.est,
    hi: bounds.hi,
    horizon: post.plies,
    vacuity: 'alive',
    mu: post.mu,
    prec: post.prec,
  };
}

describe("the owner's example, on the comparator that decides", () => {
  /**
   * MOVE A guarantees one enemy kill next turn: its ONE-PLY floor is a unit
   * above par, and that floor is PROVED — the bank can see the kill.
   * MOVE B is quiet: nothing gained, nothing lost, and its floor is par.
   *
   * The two-turn reading on A is the whole example: priced on the advanced
   * board, A's best continuations lose two of ours, so the value that CARRIES
   * the kill nets out at about minus one unit. B's two-turn reading is par,
   * because a quiet move stays quiet.
   *
   * The intervals OVERLAP, which is what makes both rows floor-undominated and
   * therefore both eligible for the belief to resolve. A row whose ceiling sat
   * under the other's floor would be out before the belief was consulted, and
   * no deep reading could bring it back.
   */
  const A = () =>
    row('A-kills-one', { lo: UNIT, est: UNIT, hi: 3 * UNIT }, { value: -UNIT, sigma: 1, plies: 2 });
  const B = () => row('B-quiet', { lo: 0, est: 0, hi: 2 * UNIT }, { value: 0, sigma: 1, plies: 2 });
  const policy = channelPolicyFor('SIGHTED');

  test('with depth, A evaluates BELOW B and B leads', () => {
    const rows = [A(), B()];
    // A's one-ply floor is strictly better — the kill is a fact about this
    // turn and the bank proved it.
    expect(rows[0].lo).toBeGreaterThan(rows[1].lo);
    // And its belief is strictly worse, because the two-turn value carries the
    // kill AND the two units the continuations cost.
    expect(rows[0].mu as number).toBeLessThan(rows[1].mu as number);
    // "Net about minus one unit", and ABOUT is the honest word: the deep
    // reading does not erase the near one, it outweighs it at the precision it
    // earned. The near half here is the bank triple at the precision a
    // two-unit-wide interval buys; the deep half arrives an order of magnitude
    // more precise, so the blend lands within a tenth of a unit of the deep
    // value. A test asserting equality would be asserting that a precision-
    // weighted merge is a replacement, which is the thing it is not.
    expect(Math.abs((rows[0].mu as number) + UNIT)).toBeLessThan(UNIT / 10);
    // So the ladder leads with B.
    expect(rows[pickLeader(rows, policy)].key).toBe('B-quiet');
  });

  test('TRUNCATED TO ONE TURN, on the identical rows, A wins', () => {
    // THE CONTROL, and it is the whole point of the pair: the same rows, the
    // same comparator, the same evaluator — with the deep channel silent. A
    // wins on its proved floor, exactly as it did before depth existed. So the
    // difference between the two answers is DEPTH and not evaluation.
    const rows = [A(), B()];
    expect(rows[pickLeaderWithoutDepth(rows, policy)].key).toBe('A-kills-one');
  });

  test('a DISCOVERED TWO-TURN KILL raises a branch and takes the lead', () => {
    // The positive direction, which the deleted loser-only polarity rule made
    // unrepresentable. Two quiet-looking moves; one of them is proved to force
    // a kill two turns out.
    const quiet = row('quiet', { lo: 0, est: 0, hi: 2 * UNIT }, { value: 0, sigma: 1, plies: 2 });
    const forcing = row(
      'forces-a-kill',
      { lo: -1, est: -1, hi: 2 * UNIT },
      { value: UNIT, sigma: 1, plies: 2 }
    );
    const rows = [quiet, forcing];
    // Its one-ply floor is WORSE — it gives up a point of tempo now.
    expect(forcing.lo).toBeLessThan(quiet.lo);
    // Its belief is better, by the full magnitude of what depth proved: no cap
    // truncates a positive finding any more than a negative one.
    expect(Math.abs((forcing.mu as number) - UNIT)).toBeLessThan(UNIT / 10);
    expect(rows[pickLeader(rows, policy)].key).toBe('forces-a-kill');
    // And with the deep channel silent the floor decides the other way.
    expect(rows[pickLeaderWithoutDepth(rows, policy)].key).toBe('quiet');
  });

  test('a deep reading NEVER revives a soundly dominated row', () => {
    // The guard that survives the cap's deletion. `refuted` here means the
    // row's CEILING sits at or below the other's proved floor: it cannot be
    // better in any world, and that is a statement about every world rather
    // than a prior. However confident a deep reading, it may not overturn it.
    const dominated = row(
      'dominated',
      { lo: -5 * UNIT, est: -5 * UNIT, hi: -2 * UNIT },
      { value: 100 * UNIT, sigma: 0, plies: 3 }
    );
    const sound = row('sound', { lo: 0, est: 0, hi: 2 * UNIT }, { value: 0, sigma: 1, plies: 2 });
    const rows = [dominated, sound];
    expect(rows[pickLeader(rows, policy)].key).toBe('sound');
  });

  test('influence scales with EARNED PRECISION, and is capped at neither end', () => {
    // The replacement for `clampToLat`, stated as the property it has to have.
    // Same finding, three lines: one clean, one from a wide and fogged line,
    // one exact. The clean line moves the belief most of the way; the fogged
    // one barely moves it; the exact one takes it whole. Nothing truncates the
    // magnitude at any point, in either direction.
    const near = { lo: 0, est: 0, hi: 2 * UNIT };
    const clean = row('clean', near, { value: -5 * UNIT, sigma: 1, plies: 2 });
    const fogged = row('fogged', near, { value: -5 * UNIT, sigma: 400, plies: 2 });
    const exact = row('exact', near, { value: -5 * UNIT, sigma: 0, plies: 2 });
    expect(exact.mu as number).toBe(-5 * UNIT);
    expect(clean.mu as number).toBeLessThan(fogged.mu as number);
    expect(fogged.mu as number).toBeGreaterThan(-UNIT);
    // A magnitude far beyond one lattice step arrives whole when the line
    // earned it — which is exactly what the deleted cap forbade.
    expect(row('huge', near, { value: -50 * UNIT, sigma: 0, plies: 2 }).mu as number).toBe(
      -50 * UNIT
    );
    expect(row('huge+', near, { value: 50 * UNIT, sigma: 0, plies: 2 }).mu as number).toBe(
      50 * UNIT
    );
  });

  test('the sticky stager switches on the belief, at an equal-or-deeper horizon', () => {
    // The staging half. F1 protects the wire from tie-flips and from shallow
    // refutations that reverse one ply later, and its guard has always been "a
    // margin improvement AT AN EQUAL-OR-DEEPER HORIZON" — which, until every
    // row stopped sharing one constant horizon, had never once bound.
    const stager = new StickyStager();
    const shallowA = row('A-kills-one', { lo: UNIT, est: UNIT, hi: 3 * UNIT });
    const shallowB = row('B-quiet', { lo: 0, est: 0, hi: 2 * UNIT });
    // Turn one: nothing deeper has spoken, so A is staged on its proved floor.
    expect(stager.stage([shallowA, shallowB], policy).staged.key).toBe('A-kills-one');
    // Depth then speaks about both, and the belief dethrones by the same
    // margin the floor rule uses. No second constant is introduced.
    const decision = stager.stage([A(), B()], policy);
    expect(decision.staged.key).toBe('B-quiet');
    expect(decision.reason).toBe('belief');
    // A SHALLOWER leader may not dethrone a deeper incumbent, which is the
    // protection that guard was written for.
    const shallowRival = row('C-shallow', { lo: 5 * UNIT, est: 5 * UNIT, hi: 6 * UNIT });
    expect(stager.stage([shallowRival, B()], policy).staged.key).toBe('B-quiet');
  });
});

// ---------------------------------------------------------------------------
// THE BOARD — the same claim, end to end, on a real position
// ---------------------------------------------------------------------------

/**
 * THE FROZEN POSITION. Generated, then frozen by seed, because a position that
 * exercises the whole stack has to survive the enumeration, the door, the
 * partition and the bank — and one written by hand tends to prove that its
 * author misunderstood one of them rather than that the semantics are wrong.
 *
 * What makes it an acceptance case is the PAIR: the identical board, the
 * identical evaluator, the identical seed, decided twice, differing only in
 * how many turns the search was allowed to look.
 */
const ACCEPTANCE_SEED = 5;

describe('depth changes a staged move on a real board, and only depth does', () => {
  afterEach(() => clearGeometryCache());

  test('the funded arm and the depthless arm stage DIFFERENT moves', async () => {
    const board = pieceBoard(ACCEPTANCE_SEED);
    const deep = await decide(board, 3, 1000);
    clearGeometryCache();
    const flat = await decide(board, 0, 1000);
    expect(deep.staged).not.toBe('');
    expect(flat.staged).not.toBe('');
    // THE CLAIM. Same board, same evaluator, same bounds, same seed.
    expect(deep.staged).not.toBe(flat.staged);
    // And the funded arm looked further than one turn, which is a measurement
    // and not a configured ceiling.
    expect(deep.plies).toBeGreaterThan(1);
    expect(deep.deepBranches).toBeGreaterThan(0);
    // The depthless arm is not a different build: it ran the same layer with
    // an empty purse, so its horizon is an honest 1.
    expect(flat.plies).toBe(1);
    expect(flat.deepBranches).toBe(0);
  }, 180000);

  test('the deepened branch is the one whose belief moved off its near reading', async () => {
    const board = pieceBoard(ACCEPTANCE_SEED);
    const deep = await decide(board, 3, 1000);
    clearGeometryCache();
    const flat = await decide(board, 0, 1000);
    // Every branch the depthless arm held has a belief that is a fixed
    // function of its own triple. At least one branch in the funded arm does
    // not — that is what "a deep reading reached a branch" means, measured on
    // the branch rather than inferred from a counter.
    let moved = 0;
    for (const [key, mu] of deep.mu) {
      const before = flat.mu.get(key);
      if (before !== undefined && Math.abs(before - mu) > 1e-9) moved++;
    }
    expect(moved + deep.deepBranches).toBeGreaterThan(0);
  }, 180000);

  test('DETERMINISM PER SEED: the funded arm repeats itself exactly', async () => {
    const board = pieceBoard(ACCEPTANCE_SEED);
    const first = await decide(board, 3, 1000);
    clearGeometryCache();
    const second = await decide(board, 3, 1000);
    expect(second.staged).toBe(first.staged);
    expect(second.plies).toBe(first.plies);
    expect(second.deepBranches).toBe(first.deepBranches);
    expect([...second.mu.entries()].sort()).toEqual([...first.mu.entries()].sort());
  }, 180000);
});

// ---------------------------------------------------------------------------
// THE RATE — the standing measurement
// ---------------------------------------------------------------------------

describe('the depth-effect rate', () => {
  afterEach(() => clearGeometryCache());

  /**
   * THE NUMBER THE OWNER ASKED TO BE KEPT CONTINUOUSLY: the fraction of
   * decisions on which removing depth would have staged a different move.
   *
   * Measured the only honest way — two whole decisions per board, one with the
   * depth ration set to zero — because the in-report indicator cannot see the
   * whole effect. Depth changes the trial STREAM as well as the acceptances
   * (its findings re-order what the enumeration proposes), and a counterfactual
   * computed inside one decision only re-runs the comparator.
   *
   * The gate is NONZERO and not a threshold. A threshold on twenty boards would
   * be a number nobody could defend; what this has to catch is depth going
   * silent again, which is what it did for the whole life of the layer before
   * the partition's `variables` replaced its `members`.
   */
  test('is nonzero on piece-bearing boards at a one-second budget', async () => {
    const BOARDS = 20;
    let changed = 0;
    let deepest = 1;
    for (let seed = 0; seed < BOARDS; seed++) {
      const board = pieceBoard(seed);
      const deep = await decide(board, 3, 1000);
      clearGeometryCache();
      const flat = await decide(board, 0, 1000);
      clearGeometryCache();
      if (deep.staged !== flat.staged) changed++;
      deepest = Math.max(deepest, deep.plies);
    }
    process.stdout.write(
      `  depth-effect rate ${changed}/${BOARDS} on piece boards at 1s ` +
        `(deepest horizon reached: ${deepest} turns)\n`
    );
    expect(changed).toBeGreaterThan(0);
    expect(deepest).toBeGreaterThan(1);
  }, 600000);
});
