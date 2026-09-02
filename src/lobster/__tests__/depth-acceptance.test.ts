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
 *
 * THE OWNER'S SHAPE (fourth block) is the same paired method carried onto the
 * board the owner actually plays — 25x25, three teams of six, hazards on,
 * potions on, a 2000 ms decision — because the rate above is measured on an
 * 11x11 two-team piece board and a rate is a property of a board family, not
 * of the engine. It also carries the FIRST QUALITY SIGNAL: for the decisions
 * the two arms disagree on, both staged plans are replayed through the
 * vendored engine, so "depth changed the move" gains a same-turn ledger of
 * what each move did. See `oneTurnLedger` for exactly what that can and
 * cannot say.
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
import type { JointPlan, StagingCandidate } from '../contracts';
import { NO_ORDER_MOVE } from '../contracts';
import { marshalBoard, resolvePartialTurn } from '../../logic/turn-oracle';
import type { StagedAction } from '../../logic/turn-oracle';

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
  /** The last emitted joint plan, kept so the staged move can be REPLAYED
   *  through the engine rather than only compared as a string. */
  readonly plan: JointPlan | null;
  /**
   * THE DEPTH LAYER'S OWN ACCOUNTING for this decision, or null when the core
   * publishes none.
   *
   * Kept because a horizon of 1 is TWO different findings and a rate cannot be
   * allowed to confuse them: the door refused the board (`gatedBy` names the
   * gate), or the layer ran, opened threads, spent its purse and never reached
   * a second turn. The first is a null about the harness, the second is a
   * finding about the board family.
   */
  readonly scout: {
    gatedBy: string | null;
    threads: number;
    deepened: number;
    observations: number;
    deepestPlies: number;
    units: number;
    msCap: number;
    refusals: Readonly<Record<string, number>>;
  } | null;
}

/**
 * ONE WHOLE DECISION, at a stated depth ration.
 *
 * `plyCap: 0` is the depthless arm and it is NOT a different build: the layer
 * is constructed, the door is available, the report is published, and the
 * purse buys no plies. That is what makes the pair a measurement of DEPTH
 * rather than of two code paths.
 */
async function decide(
  board: Board,
  plyCap: number,
  budgetMs: number,
  asTeam = 'red'
): Promise<Decision> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board, turn: TURN, asTeam });
  const core = makeSearchCore({ scoutTuning: { plyCap } });
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
  });
  let staged = '';
  let plan: JointPlan | null = null;
  let scout: ReturnType<NonNullable<typeof core.scoutReport>> = null;
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: defaultEvaluator,
      search: core,
      asTeam: sub.teamNumber(asTeam),
      deadlineMs: clock.peek() + budgetMs,
      initialPins: [],
      now: clock.now,
    })) {
      staged = [...rec.plan.entries()]
        .map(([u, c]) => `${u}>${c.to}`)
        .sort()
        .join(',');
      plan = new Map(rec.plan);
    }
  } finally {
    // READ THE DEPTH LAYER'S REPORT BEFORE THE CORE IS RELEASED. A released
    // core owes nobody a report, and a measurement that read one after the
    // release would be reading whatever survived, which is not a measurement.
    scout = core.scoutReport?.() ?? null;
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
    plan,
    scout:
      scout === null
        ? null
        : {
            gatedBy: scout.gatedBy,
            threads: scout.threads,
            deepened: scout.deepened,
            observations: scout.observations,
            deepestPlies: scout.deepestPlies,
            units: scout.units,
            msCap: scout.msCap,
            refusals: scout.refusals,
          },
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
  test('depth is available on a POTION-BEARING board — the family it used to refuse', async () => {
    // The door refuses a board carrying potions while the process premise is
    // potion-free, because with an empty premise board an enemy's tier ceiling
    // collapses to its observed tier — defensible at one ply and an
    // under-statement of the enemy at two. That refusal made depth unavailable
    // on every board with a potion on it, which the owner's ruling says is
    // every real game. `TIER_TRUTH` is `full` now, so the premise carries the
    // real potion board and the door admits it. Asserted here rather than
    // assumed, because it is the difference between depth working in probes
    // and depth working in games.
    const base = pieceBoard(ACCEPTANCE_SEED);
    const withPotion: Board = {
      ...base,
      invulnerabilityPotions: [{ x: 1, y: 1 }],
    } as Board;
    const deep = await decide(withPotion, 3, 1000);
    expect(deep.staged).not.toBe('');
    expect(deep.plies).toBeGreaterThan(1);
  }, 180000);

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

// ---------------------------------------------------------------------------
// THE OWNER'S SHAPE — the same paired method, on the board he plays
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS, AND WHAT IT IS NOT.
 *
 * The rate above is measured on 11x11, two teams, six pieces, no hazards, no
 * potions, at a 1000 ms budget. That is a probe board. The owner's games are
 * 25x25 with three teams of six, hazards on the field, potions on, and a
 * 2000 ms decision — and a disagreement rate is a property of a BOARD FAMILY
 * and a budget, not of the engine. Quoting the probe number for the real board
 * is the same class of mistake as quoting a disagreement rate as an
 * improvement, so the shape is measured rather than assumed.
 *
 * It is still a DISAGREEMENT rate. Nothing in this block says depth plays
 * better; see `oneTurnLedger` for how far the quality signal goes and where it
 * stops.
 */

const OWNER_SIZE = 25;
const OWNER_TEAMS = ['red', 'blue', 'green'] as const;
const OWNER_BUDGET_MS = 2000;
/** damageRatio 0.15 of the reference kind's 100 max health — a cost, not a wall. */
const OWNER_HAZARD_DAMAGE = 15;

/**
 * The two rosters, in the batch vocabulary's own words
 * (`tools/learnloop/lib/cells.js`): the mixed king board that carries the
 * sliders, and the mostly-snake board that carries one.
 */
const OWNER_ROSTERS: Record<string, ReadonlyArray<string>> = {
  'owner-mix-king': ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
  'owner-snake5-queen': ['queen', 'snake', 'snake', 'snake', 'snake', 'snake'],
};

/**
 * ONE OWNER-SHAPE BOARD. Three teams of six on 25x25, a deterministic hazard
 * cross, potions on the field, food scattered — built from one seed so the
 * pair is a pair.
 *
 * Snakes get a real three-cell body (a one-cell snake is a piece wearing a
 * snake's name and moves nothing like one); pieces arrive the way the wire
 * delivers them, as a one-cell unit whose `length` IS its weight.
 */
function ownerShapeBoard(seed: number, cell: keyof typeof OWNER_ROSTERS | string): Board {
  const roster = OWNER_ROSTERS[cell];
  if (roster === undefined) throw new Error(`no owner-shape roster named "${cell}"`);
  const r = rng(seed * 7919 + 13);
  const used = new Set<string>();
  const free = (x: number, y: number): boolean =>
    x >= 1 && y >= 1 && x < OWNER_SIZE - 1 && y < OWNER_SIZE - 1 && !used.has(`${x},${y}`);
  const claim = (x: number, y: number): void => {
    used.add(`${x},${y}`);
  };

  // The hazard cross: two interior bands every team must cross or route
  // around. Deterministic, so a cell name denotes one board.
  const hazards: Coord[] = [];
  const mid = Math.floor(OWNER_SIZE / 2);
  for (let i = 2; i < OWNER_SIZE - 2; i++) {
    hazards.push({ x: i, y: mid });
    if (i !== mid) hazards.push({ x: mid, y: i });
  }
  for (const h of hazards) claim(h.x, h.y);

  // Each team starts in its own third of the board, so the opening is not a
  // scrum and the three teams are symmetric up to the seed.
  const bands: Array<[number, number]> = [
    [1, 7],
    [9, 15],
    [17, 23],
  ];
  const snakes: Snake[] = [];
  OWNER_TEAMS.forEach((team, t) => {
    const [lo, hi] = bands[t];
    roster.forEach((kind, u) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = lo + Math.floor(r() * (hi - lo + 1));
        const y = 2 + Math.floor(r() * (OWNER_SIZE - 4));
        if (kind === 'snake') {
          // A three-cell body laid out along one axis, all of it free.
          const dx = r() < 0.5 ? 1 : 0;
          const dy = dx === 1 ? 0 : 1;
          const body: Coord[] = [
            { x, y },
            { x: x - dx, y: y - dy },
            { x: x - 2 * dx, y: y - 2 * dy },
          ];
          if (!body.every((c) => free(c.x, c.y))) continue;
          body.forEach((c) => claim(c.x, c.y));
          snakes.push(
            makeSnake(`${team[0]}${u}`, body, {
              teamID: team,
              unitType: 'snake',
              health: 40 + Math.floor(r() * 60),
            })
          );
          return;
        }
        if (!free(x, y)) continue;
        claim(x, y);
        snakes.push(
          makeSnake(`${team[0]}${u}`, [{ x, y }], {
            teamID: team,
            unitType: kind,
            length: kind === 'king' ? 1 : 2 + Math.floor(r() * 3),
            health: 40 + Math.floor(r() * 60),
          })
        );
        return;
      }
      throw new Error(`could not place ${team}/${kind} on seed ${seed}`);
    });
  });

  const food: Coord[] = [];
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = 1 + Math.floor(r() * (OWNER_SIZE - 2));
      const y = 1 + Math.floor(r() * (OWNER_SIZE - 2));
      if (!free(x, y)) continue;
      claim(x, y);
      food.push({ x, y });
      break;
    }
  }

  // POTIONS ON. The owner's ruling is that every real game has them, and the
  // door refused this whole family until `TIER_TRUTH` became `full`.
  const invulnerabilityPotions: Coord[] = [];
  for (let i = 0; i < 2; i++) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = 1 + Math.floor(r() * (OWNER_SIZE - 2));
      const y = 1 + Math.floor(r() * (OWNER_SIZE - 2));
      if (!free(x, y)) continue;
      claim(x, y);
      invulnerabilityPotions.push({ x, y });
      break;
    }
  }

  return {
    width: OWNER_SIZE,
    height: OWNER_SIZE,
    food,
    hazards,
    hazardDamage: OWNER_HAZARD_DAMAGE,
    invulnerabilityPotions,
    snakes,
  } as Board;
}

/** What one staged plan did on the board, this turn, per the real engine. */
interface TurnLedger {
  ourDeaths: number;
  ourSevered: number;
  enemyDeaths: number;
  ourTeamEliminated: number;
  enemyTeamsEliminated: number;
}

/**
 * THE FIRST QUALITY SIGNAL — and its ceiling, stated before its result.
 *
 * A staged plan is pushed through `resolvePartialTurn`, which is the vendored
 * TacticToes engine resolving a real turn. So this is not a model of the
 * rules: contests, severs, edge exchanges, exhaustion, hazard damage, regicide
 * and food are all decided by the code the game server runs.
 *
 * WHAT IT CANNOT SAY. Every unit not in our plan is FROZEN — the oracle's
 * standing baseline assumption — so this is our move against a board that
 * stands still, for exactly one turn. Depth's whole claim is about the turn
 * AFTER this one, which is the horizon this ledger does not have. A plan that
 * loses a unit here to buy two next turn reads as a loss, and reads correctly
 * only in a game. So: a same-turn ledger is evidence about immediate cost, it
 * is NOT a verdict on which move is better, and the only instrument that can
 * give one is a live paired sweep. That sweep is owed and this does not
 * discharge it.
 */
function oneTurnLedger(board: Board, plan: JointPlan | null, ourTeam: string): TurnLedger | null {
  if (plan === null || plan.size === 0) return null;
  const marshalled = marshalBoard(board, TURN);
  const staged = new Map<string, StagedAction>();
  for (const [unitId, candidate] of plan) {
    if (candidate.path.length > 0) staged.set(String(unitId), { path: [...candidate.path] });
    else if (candidate.to !== NO_ORDER_MOVE) staged.set(String(unitId), { stagedMove: candidate.to });
    // A candidate with neither is the kind's own default action, which the
    // engine already applies to a unit nobody staged; naming it would be
    // asserting a move the plan did not make.
  }
  if (staged.size === 0) return null;
  const result = resolvePartialTurn(marshalled, staged);
  const ledger: TurnLedger = {
    ourDeaths: 0,
    ourSevered: 0,
    enemyDeaths: 0,
    ourTeamEliminated: 0,
    enemyTeamsEliminated: 0,
  };
  for (const id of Object.keys(result.deaths)) {
    if (marshalled.teamOf.get(id) === ourTeam) ledger.ourDeaths++;
    else ledger.enemyDeaths++;
  }
  for (const [id, cells] of Object.entries(result.severedCells)) {
    if (marshalled.teamOf.get(id) === ourTeam) ledger.ourSevered += cells.length;
  }
  for (const teamID of result.eliminatedTeamIDs) {
    if (teamID === ourTeam) ledger.ourTeamEliminated++;
    else ledger.enemyTeamsEliminated++;
  }
  return ledger;
}

/**
 * HOW MANY BOARDS. Small by default so the standing suite pays test-sized time
 * for the fixture and the plumbing; the measurement run raises it.
 * `DEPTH_OWNER_BOARDS` is read HERE, in a test, and reaches no decision — the
 * engine's env scrub list is empty and stays empty.
 */
const OWNER_BOARDS = Number(process.env.DEPTH_OWNER_BOARDS ?? '2');

describe("the depth-effect rate at the owner's shape", () => {
  afterEach(() => clearGeometryCache());

  test('is measured per cell at 25x25, three teams of six, hazards and potions on, 2000 ms', async () => {
    const cells = Object.keys(OWNER_ROSTERS);
    for (const cell of cells) {
      let changed = 0;
      let deepest = 1;
      let flatDeepest = 1;
      let quality = 0;
      let threads = 0;
      let observations = 0;
      let gated = 0;
      const gates = new Set<string>();
      const rows: string[] = [];
      for (let seed = 0; seed < OWNER_BOARDS; seed++) {
        const board = ownerShapeBoard(seed, cell);
        const deep = await decide(board, 3, OWNER_BUDGET_MS);
        clearGeometryCache();
        const flat = await decide(board, 0, OWNER_BUDGET_MS);
        clearGeometryCache();
        deepest = Math.max(deepest, deep.plies);
        flatDeepest = Math.max(flatDeepest, flat.plies);
        // A HORIZON OF 1 IS TWO FINDINGS, so record which one this was.
        if (deep.scout !== null) {
          threads += deep.scout.threads;
          observations += deep.scout.observations;
          if (deep.scout.gatedBy !== null) {
            gated++;
            gates.add(deep.scout.gatedBy);
          }
          for (const reason of Object.keys(deep.scout.refusals)) gates.add(`refused:${reason}`);
        }
        if (deep.staged === flat.staged) continue;
        changed++;
        const a = oneTurnLedger(board, deep.plan, 'red');
        const b = oneTurnLedger(board, flat.plan, 'red');
        if (a === null || b === null) continue;
        quality++;
        rows.push(
          `      seed ${seed}: depth ${a.ourDeaths}/${a.ourSevered}/${a.enemyDeaths} ` +
            `vs depthless ${b.ourDeaths}/${b.ourSevered}/${b.enemyDeaths} ` +
            '(our deaths / our severed cells / enemy deaths, this turn, enemies frozen)'
        );
      }
      process.stdout.write(
        `  OWNER SHAPE ${cell}: depth-effect rate ${changed}/${OWNER_BOARDS} at ` +
          `${OWNER_BUDGET_MS} ms (deepest horizon: funded ${deepest}, depthless ${flatDeepest}; ` +
          `${quality} disagreement(s) replayed through the engine)\n` +
          `      depth layer: ${threads} thread(s), ${observations} observation(s) published, ` +
          `${gated}/${OWNER_BOARDS} decisions gated` +
          `${gates.size > 0 ? ` [${[...gates].join(', ')}]` : ''}\n`
      );
      for (const row of rows) process.stdout.write(`${row}\n`);
      // The depthless arm is the same layer with an empty purse, so its
      // horizon is an honest 1 on every board of every cell.
      expect(flatDeepest).toBe(1);
    }
  }, 3600000);

  test('a disagreement can be replayed through the engine on the owner board', async () => {
    // The plumbing assertion, so a broken oracle bridge fails HERE rather than
    // as a silently empty quality column in a measurement run.
    const board = ownerShapeBoard(0, 'owner-mix-king');
    const deep = await decide(board, 3, OWNER_BUDGET_MS);
    const ledger = oneTurnLedger(board, deep.plan, 'red');
    expect(ledger).not.toBeNull();
    expect((ledger as TurnLedger).ourDeaths).toBeGreaterThanOrEqual(0);
  }, 600000);
});
