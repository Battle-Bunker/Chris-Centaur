/**
 * THE FLAG-ON PROBE — what the amendment actually does, per detector class.
 *
 * `admission-noop.test.ts` gates the OFF side: with the policy off, arch/s3
 * changes nothing. This gates the ON side, and it gates it the only way that
 * survives the arch/s3 merge.
 *
 * ── WHY THIS IS NOT "BYTE-IDENTICAL TO arch/s2 FLAG-ON" ────────────────────
 *
 * That comparison is unavailable and would be misleading if it were run.
 * arch/s3 merges the integrated evaluator (`66904d2`: gainOrdering, the
 * evaluation memo, fix/o-p3's room renormalisation, staging safety, the
 * re-vendored partial engine), so arch/s2's flag-on decisions differ from
 * arch/s3's on every board, for reasons that have nothing to do with
 * admission. A cross-branch byte comparison would measure the merge and report
 * it as the amendment.
 *
 * The comparison that IS available is stronger, because it names the profile
 * rather than a branch: for each detector class, run the flag-on decision
 * against a kernel with NO policy at all, driven directly by the evaluator the
 * class is supposed to select. If the two are byte-identical then the policy is
 * doing exactly one thing — choosing an objective — and nothing else.
 *
 *   own-slider board   flag-on  ==  a directly-constructed
 *                                   TERRITORY_SLIDER_PROFILE engine
 *   enemy-slider board flag-on  ==  a directly-constructed
 *                                   TERRITORY_PROFILE (shipped) engine
 *   no-slider board    flag-on  ==  the same shipped engine
 *
 * The arch/s2 predicate is not lost, either: the board-level detector facts are
 * still emitted, so what arch/s2 WOULD have decided is recomputable from the
 * stamp, and §4 below asserts the delta directly rather than describing it.
 *
 * SCOPE OF THE IDENTITY CLAIM. One decision, and the ladder is frozen for a
 * decision, so within these runs the detector fires for the whole turn by
 * construction. Across a whole game the equality holds turn by turn for as long
 * as the classification does not move; the dwell means a classification that
 * moves takes two measurements to act, and `admission-kernel.test.ts` owns that
 * behaviour. Nothing here claims a game-long identity that has not been run.
 *
 * `yieldIntervalMs: 0` and a virtual clock throughout, for the reason the two
 * no-op gates document at length.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import type { EmitRecord, JointPlan } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import {
  BASE_COHORT_ID,
  BASE_PROFILE,
  BoundEvaluator,
  SLIDER_COHORT_ID,
  TERRITORY_COHORT_ID,
  TERRITORY_SLIDER_PROFILE,
  defaultEvaluator,
} from '../lobster/evaluate';
import {
  DEFAULT_ADMISSION_POLICY,
  classifyAdmission,
  measureAdmission,
} from '../lobster/admission';
import type { LadderRow } from '../lobster/admission';
import { OWN_TRAIL_ADMISSION_THRESHOLD } from '../lobster/evaluate/calibration';
import { makeSearchCore } from '../lobster/search';
import { LobsterKernel } from '../lobster/kernel';

jest.setTimeout(120_000);

// ------------------------------------------------------------------ fixtures

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
  teamID: string
): Snake => makeSnake(id, [at], { unitType, length: weight, teamID });

const trail = (id: string, head: Coord, teamID: string): Snake =>
  makeSnake(id, [head, { x: head.x - 1, y: head.y }, { x: head.x - 2, y: head.y }], {
    teamID,
  });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra }) as Board;

/** Four trail units a side, so nothing here is decided by the thin-roster row. */
const SNAKES = [
  trail('a1', { x: 4, y: 1 }, 'red'),
  trail('a2', { x: 4, y: 3 }, 'red'),
  trail('a3', { x: 4, y: 5 }, 'red'),
  trail('a4', { x: 4, y: 7 }, 'red'),
  trail('b1', { x: 10, y: 2 }, 'blue'),
  trail('b2', { x: 10, y: 4 }, 'blue'),
  trail('b3', { x: 10, y: 6 }, 'blue'),
  trail('b4', { x: 10, y: 8 }, 'blue'),
];

interface Cell {
  readonly label: string;
  readonly board: Board;
  /** The rung the amendment is supposed to select for the `red` seat. */
  readonly expect: string;
}

/**
 * The corpus is built as MATCHED PAIRS wherever it can be: the own and enemy
 * rook cells differ from each other in exactly one `teamID`, so a difference
 * between their verdicts cannot be a difference of position. That is the same
 * design principle E1's asymmetric cell family rests on, at unit-test scale.
 */
const CELLS: Cell[] = [
  {
    label: 'no-slider',
    board: boardOf(SNAKES, { food: [{ x: 5, y: 5 }, { x: 6, y: 2 }] }),
    expect: TERRITORY_COHORT_ID,
  },
  {
    label: 'enemy-rook',
    board: boardOf([...SNAKES, piece('rook', { x: 9, y: 9 }, 'rook', 2, 'blue')], {
      food: [{ x: 5, y: 5 }, { x: 6, y: 2 }],
    }),
    expect: TERRITORY_COHORT_ID,
  },
  {
    label: 'own-rook',
    board: boardOf([...SNAKES, piece('rook', { x: 9, y: 9 }, 'rook', 2, 'red')], {
      food: [{ x: 5, y: 5 }, { x: 6, y: 2 }],
    }),
    expect: SLIDER_COHORT_ID,
  },
  {
    label: 'own-queen-enemy-pawn',
    board: boardOf(
      [
        ...SNAKES,
        piece('q', { x: 2, y: 9 }, 'queen', 4, 'red'),
        piece('p', { x: 9, y: 1 }, 'pawn', 1, 'blue'),
      ],
      { food: [{ x: 5, y: 5 }] }
    ),
    expect: SLIDER_COHORT_ID,
  },
  {
    label: 'own-bishop-both-sides',
    board: boardOf(
      [
        ...SNAKES,
        piece('bs', { x: 2, y: 9 }, 'bishop', 3, 'red'),
        piece('be', { x: 9, y: 1 }, 'bishop', 3, 'blue'),
      ],
      { food: [{ x: 5, y: 5 }] }
    ),
    expect: SLIDER_COHORT_ID,
  },
];

const BUDGETS = [40, 120];

/** Monotonic, deterministic, never wall clock: each read costs one tick. */
class StepClock {
  private t: number;
  constructor(
    private readonly tick = 0.02,
    start = 1_000
  ) {
    this.t = start;
  }
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  readonly peek = (): number => this.t;
}

const EVALUATORS = new Map<string, BoundEvaluator>([
  [BASE_COHORT_ID, new BoundEvaluator(BASE_PROFILE)],
  [TERRITORY_COHORT_ID, defaultEvaluator as BoundEvaluator],
  [SLIDER_COHORT_ID, new BoundEvaluator(TERRITORY_SLIDER_PROFILE)],
]);

const planOf = (p: JointPlan): string =>
  [...p.entries()]
    .map(([u, c]) => `${u}>${c.to}`)
    .sort()
    .join(',');

/** Everything a decision decided, and the admission stamp SEPARATELY so the
 * identity claim can be stated about the decision rather than about the label. */
const recordOf = (rec: EmitRecord): unknown => ({
  plan: planOf(rec.plan),
  est: rec.est,
  lo: rec.lo,
  hi: rec.hi,
  horizon: rec.horizon,
  slack: rec.slack,
  posture: rec.posture,
  epoch: rec.epoch,
  crossfade: rec.crossfade,
  assumptions: rec.assumptions.map((a) => JSON.stringify(a)),
});

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

function jsonSafe(x: unknown): unknown {
  if (typeof x === 'number' && !Number.isFinite(x)) return `#${String(x)}`;
  if (Array.isArray(x)) return x.map(jsonSafe);
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) out[k] = jsonSafe(v);
    return out;
  }
  return x;
}

interface Arm {
  /** With the policy on, or driven directly at a named cohort. */
  readonly policy: boolean;
  readonly cohort?: string;
  readonly evaluate?: BoundEvaluator;
}

async function replay(
  board: Board,
  budgetMs: number,
  arm: Arm
): Promise<Record<string, unknown>> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board, turn: 30, asTeam: 'red' });
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
    ...(arm.policy ? { admission: DEFAULT_ADMISSION_POLICY } : {}),
  });
  const emissions: unknown[] = [];
  let stamp: unknown = null;
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: arm.evaluate ?? (defaultEvaluator as BoundEvaluator),
      search: makeSearchCore(),
      asTeam: sub.teamNumber('red'),
      deadlineMs: clock.peek() + budgetMs,
      initialPins: [],
      now: clock.now,
      ...(arm.policy ? { evaluators: EVALUATORS } : {}),
      ...(arm.cohort === undefined ? {} : { cohort: arm.cohort }),
    })) {
      emissions.push(recordOf(rec));
      stamp = rec.admission ?? null;
    }
  } finally {
    sub.release();
    clearGeometryCache();
  }
  const r = kernel.lastReport;
  if (r === null) throw new Error('no report');
  return {
    emissions,
    stamp,
    report: {
      slices: r.slices,
      idleSlices: r.idleSlices,
      improveCalls: r.improveCalls,
      refineCalls: r.refineCalls,
      conformCalls: r.conformCalls,
      evaluateCalls: r.evaluateCalls,
      emits: r.emits,
      probes: r.probes,
      refusals: r.refusals,
      boundViolations: r.boundViolations,
      epochs: r.epochs,
      cache: r.cache,
      postureFlips: r.postureFlips,
      basisHistory: r.basisHistory,
      crossfade: r.crossfade,
      committedUnits: r.committedUnits,
      contexts: r.contexts.map((c) => ({ ...c, stepCostMs: round(c.stepCostMs) })),
      speculative: r.speculative,
      activeContextKey: r.activeContextKey,
      stagedNothing: r.stagedNothing,
      leverOrderBinding: r.leverOrderBinding,
    },
  };
}

/**
 * `at` is a LOG LABEL and the only thing the flag-on path can move that is not
 * a decision.
 *
 * `AdmissionFlip.at` and `PostureFlip.at` are stamped from the same virtual
 * clock the search reads, and `admission.ts` says in its own doctrine that the
 * governor never reads its `at` back. Running the policy costs exactly ONE
 * extra read of that clock at decision entry, so every subsequent label lands
 * one tick (0.02 ms of virtual time) later than it does in a run with no
 * policy. Nothing downstream of a label consumes it.
 *
 * So the identity is stated about the DECISION and the offset is asserted
 * separately and exactly, rather than being rounded away — see "the ONLY
 * residue is the log label" below, which measures it instead of excusing it.
 */
function stripAtLabels(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stripAtLabels);
  if (x !== null && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'at') continue;
      out[k] = stripAtLabels(v);
    }
    return out;
  }
  return x;
}

const decisionOf = (run: Record<string, unknown>): unknown =>
  stripAtLabels(jsonSafe({ emissions: run.emissions, report: run.report }));

/** Every `at` label in a run, in order — the residue `decisionOf` sets aside. */
function atLabels(x: unknown, out: number[] = []): number[] {
  if (Array.isArray(x)) {
    for (const v of x) atLabels(v, out);
    return out;
  }
  if (x !== null && typeof x === 'object') {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'at' && typeof v === 'number') out.push(v);
      else atLabels(v, out);
    }
    return out;
  }
  return out;
}

// ===========================================================================

describe('flag ON: the policy chooses an objective and does nothing else', () => {
  test('EVERY CELL IS THE CLASS IT CLAIMS TO BE, and the ladder says so', () => {
    // Non-vacuity first: an identity between two runs proves nothing about the
    // amendment if the detector never fired. This asserts the corpus really
    // does contain all three classes, and that nothing in it is decided by the
    // thin-roster row instead of by the slider row.
    for (const cell of CELLS) {
      const sub = makeSubstrate({ board: cell.board, turn: 30, asTeam: 'red' });
      try {
        const c = measureAdmission(sub, sub.teamNumber('red'));
        expect([cell.label, c.ownTrailCount >= OWN_TRAIL_ADMISSION_THRESHOLD]).toEqual([
          cell.label,
          true,
        ]);
        const ladder = classifyAdmission(c);
        expect([cell.label, ladder[ladder.length - 1]]).toEqual([cell.label, cell.expect]);
      } finally {
        sub.release();
        clearGeometryCache();
      }
    }
    // All three classes present, and the two rook cells are a matched pair.
    expect(new Set(CELLS.map((c) => c.expect)).size).toBe(2);
    expect(CELLS.some((c) => c.label === 'no-slider')).toBe(true);
    expect(CELLS.some((c) => c.label === 'enemy-rook')).toBe(true);
  });

  test('an OWN-slider board decides EXACTLY as a directly-built repair engine does', async () => {
    // The identity the brief asks for. Not "similar" and not "also good": the
    // same plans, the same brackets, the same slice counts, the same refusals,
    // the same cache statistics — everything `recordOf` and the report block
    // capture — against a kernel that has no admission policy at all and was
    // simply handed `TERRITORY_SLIDER_PROFILE`.
    for (const cell of CELLS.filter((c) => c.expect === SLIDER_COHORT_ID)) {
      for (const budgetMs of BUDGETS) {
        const on = await replay(cell.board, budgetMs, { policy: true });
        const direct = await replay(cell.board, budgetMs, {
          policy: false,
          cohort: SLIDER_COHORT_ID,
          evaluate: new BoundEvaluator(TERRITORY_SLIDER_PROFILE),
        });
        expect([cell.label, budgetMs, decisionOf(on)]).toEqual([
          cell.label,
          budgetMs,
          decisionOf(direct),
        ]);
        // ...and the stamp names the profile, which the control does not carry
        // at all (no policy ran, so there is no stamp — see `EmitRecord`).
        expect([cell.label, (on.stamp as { activeCohort: string } | null)?.activeCohort]).toEqual(
          [cell.label, SLIDER_COHORT_ID]
        );
        expect([cell.label, direct.stamp]).toEqual([cell.label, null]);
      }
    }
  });

  test('an ENEMY-slider board decides EXACTLY as the shipped engine does', async () => {
    // The half of the amendment that changes the most boards. Under arch/s2's
    // board-level key this cell demoted to `base`; here it is indistinguishable
    // from a decision that never heard of the policy.
    for (const cell of CELLS.filter((c) => c.expect === TERRITORY_COHORT_ID)) {
      for (const budgetMs of BUDGETS) {
        const on = await replay(cell.board, budgetMs, { policy: true });
        const direct = await replay(cell.board, budgetMs, { policy: false });
        expect([cell.label, budgetMs, decisionOf(on)]).toEqual([
          cell.label,
          budgetMs,
          decisionOf(direct),
        ]);
        expect([cell.label, (on.stamp as { activeCohort: string } | null)?.activeCohort]).toEqual(
          [cell.label, TERRITORY_COHORT_ID]
        );
      }
    }
  });

  test('THE REPAIR REALLY IS A DIFFERENT DECISION — the control that makes the rest mean something', async () => {
    // Two identities are only evidence if the two things being identified are
    // distinguishable in the first place. On the own-slider cells the repair
    // and the shipped objective must DIFFER somewhere, or every assertion above
    // would pass with the policy wired to nothing.
    let differing = 0;
    for (const cell of CELLS.filter((c) => c.expect === SLIDER_COHORT_ID)) {
      for (const budgetMs of BUDGETS) {
        const repair = await replay(cell.board, budgetMs, {
          policy: false,
          cohort: SLIDER_COHORT_ID,
          evaluate: new BoundEvaluator(TERRITORY_SLIDER_PROFILE),
        });
        const shipped = await replay(cell.board, budgetMs, { policy: false });
        const a = JSON.stringify(decisionOf(repair));
        const b = JSON.stringify(decisionOf(shipped));
        if (a !== b) differing++;
      }
    }
    expect(differing).toBeGreaterThan(0);
  });

  test('THE ONLY RESIDUE IS THE LOG LABEL, and it is exactly one virtual tick', async () => {
    // What `decisionOf` sets aside, measured rather than waved at. Running the
    // policy reads the virtual clock once more at decision entry — to stamp a
    // flip label the governor's own doctrine says it never reads back — so
    // every `at` in the flag-on run sits exactly one 0.02 ms tick later than
    // its counterpart. If a future change makes the policy cost TWO reads, or
    // move something that is not a label, this goes red and names it.
    const TICK = 0.02;
    let compared = 0;
    for (const cell of CELLS) {
      const on = await replay(cell.board, 120, { policy: true });
      const direct =
        cell.expect === SLIDER_COHORT_ID
          ? await replay(cell.board, 120, {
              policy: false,
              cohort: SLIDER_COHORT_ID,
              evaluate: new BoundEvaluator(TERRITORY_SLIDER_PROFILE),
            })
          : await replay(cell.board, 120, { policy: false });
      const a = atLabels(jsonSafe({ emissions: on.emissions, report: on.report }));
      const b = atLabels(jsonSafe({ emissions: direct.emissions, report: direct.report }));
      expect([cell.label, a.length]).toEqual([cell.label, b.length]);
      for (let i = 0; i < a.length; i++) {
        expect([cell.label, i, round((a[i] as number) - (b[i] as number))]).toEqual([
          cell.label,
          i,
          TICK,
        ]);
        compared++;
      }
    }
    // Non-vacuity: a corpus with no labels in it would pass the loop above
    // without comparing anything.
    expect(compared).toBeGreaterThan(0);
  });

  test('the flag-on run is DETERMINISTIC — two replays are byte-identical', async () => {
    // The control every cross-run comparison above rests on. Without it an
    // equality could be luck and an inequality could be noise.
    for (const cell of CELLS) {
      const a = await replay(cell.board, 120, { policy: true });
      const b = await replay(cell.board, 120, { policy: true });
      expect([cell.label, JSON.stringify(jsonSafe(a))]).toEqual([
        cell.label,
        JSON.stringify(jsonSafe(b)),
      ]);
    }
  });
});

// ===========================================================================

describe('what the amendment changed, computed rather than described', () => {
  /**
   * arch/s2's predicate, reconstructed from the detector facts arch/s3 still
   * emits. This is why the board-level bits are kept on the wire: the delta
   * between two policies is a fact a refit corpus must be able to recompute,
   * and a corpus carrying only the keyed bit cannot.
   */
  const ARCH_S2_LADDERS: ReadonlyArray<LadderRow> = [
    {
      id: 's2-slider-or-pre-arm',
      when: (c) => c.sliderPossible || c.promotionImminent,
      ladder: [BASE_COHORT_ID],
      evidence: 'arch/s2, board-level scope, superseded by E1 — reconstructed here only',
    },
    {
      id: 's2-thin-trail-roster',
      when: (c) => c.ownTrailCount < OWN_TRAIL_ADMISSION_THRESHOLD,
      ladder: [BASE_COHORT_ID],
      evidence: 'arch/s2, unchanged on arch/s3 — reconstructed here only',
    },
    {
      id: 's2-default-admit-territory',
      when: () => true,
      ladder: [BASE_COHORT_ID, TERRITORY_COHORT_ID],
      evidence: 'arch/s2, unchanged on arch/s3 — reconstructed here only',
    },
  ];

  test('the two predicates differ on EXACTLY the slider classes, and agree elsewhere', () => {
    const rows: string[] = [];
    for (const cell of CELLS) {
      const sub = makeSubstrate({ board: cell.board, turn: 30, asTeam: 'red' });
      try {
        const c = measureAdmission(sub, sub.teamNumber('red'));
        const s2 = classifyAdmission(c, ARCH_S2_LADDERS);
        const s3 = classifyAdmission(c);
        rows.push(
          `${cell.label.padEnd(22)} own=${String(c.ownSliderPossible).padEnd(5)} ` +
            `any=${String(c.sliderPossible).padEnd(5)} s2=${s2.join('+').padEnd(16)} ` +
            `s3=${s3.join('+')}`
        );
        if (!c.sliderPossible) {
          // No slider anywhere: the two predicates cannot disagree.
          expect([cell.label, s2]).toEqual([cell.label, s3]);
        } else if (c.ownSliderPossible) {
          // We own one: arch/s2 demoted, arch/s3 repairs.
          expect([cell.label, s2]).toEqual([cell.label, [BASE_COHORT_ID]]);
          expect([cell.label, s3]).toEqual([cell.label, [BASE_COHORT_ID, SLIDER_COHORT_ID]]);
        } else {
          // Only the enemy owns one: arch/s2 demoted, arch/s3 keeps territory.
          // This is the class E1 measures at +0.57 [+0.23, +0.88] for territory
          // over material — a board arch/s2 would have demoted while it was
          // winning by as much as it wins on a slider-free board.
          expect([cell.label, s2]).toEqual([cell.label, [BASE_COHORT_ID]]);
          expect([cell.label, s3]).toEqual([cell.label, [BASE_COHORT_ID, TERRITORY_COHORT_ID]]);
        }
      } finally {
        sub.release();
        clearGeometryCache();
      }
    }
    console.log(`\narch/s2 predicate vs arch/s3 predicate\n${rows.join('\n')}\n`);
  });
});
