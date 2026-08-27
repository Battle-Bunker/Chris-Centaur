/**
 * S1b/S1c — THE COHORT AS A RATCHET BASIS, and the flip that re-bases on it.
 *
 * Stage 1 ships one registered cohort, so nothing in production flips. This
 * suite exists because the cost of getting a re-basing wrong is a silently
 * mixed comparison — an arithmetic answer to a question nobody asked — and
 * that is not a thing to discover later, while also introducing a second
 * objective. The machinery is built now and proved now; Stage 2 supplies the
 * governor that calls it.
 *
 * THE ONE CLAIM EVERY TEST HERE SERVES. A cohort change is not a refinement.
 * A posture flip carries a VALID number under a new channel; a cohort flip
 * carries an INVALID one, because a different feature set is a different
 * quantity. So:
 *
 *   - the ratchet must not slander the search for the floor falling
 *     (`ratchet-floor` refusals and `boundViolations` both zero across a flip
 *     that halves the floor — and the SAME script without the flip must be
 *     slandered, or the test proves nothing);
 *   - no comparison may span the flip (`rows()` filters; the record's basis
 *     names one cohort and one only);
 *   - the wire must not go empty across it (the incumbent is re-measured
 *     before any budget is consulted);
 *   - and the operator must not notice (Gate 3½ is policy-blind).
 *
 * WHERE THE FLIP IS FIRED FROM. `KernelInput.abandoned` is asked once per loop
 * iteration, at the top, before the slice's `SearchContext` is built — which
 * makes it the one slice boundary a test can hang an action on today without
 * reaching inside the kernel. Stage 2's admission governor will sit a few
 * lines lower, beside `governPosture`, which is the other boundary in the same
 * iteration: after the slice absorbed its score, before the emit gates read
 * it. Both are boundaries; neither is mid-price, which is the only thing
 * `flipCohort`'s contract forbids.
 */

import type {
  Bound,
  CohortId,
  EmitRecord,
  KernelInput,
  Pin,
  StagingCandidate,
} from "../lobster/contracts"
import {
  DEFAULT_KERNEL_OPTIONS,
  LobsterKernel,
  type KernelOptions,
  type KernelReport,
} from "../lobster/kernel"
import {
  COHORTS,
  DEFAULT_COHORT_ID,
  MATERIAL_ONLY_PROFILE,
  type CohortRow,
} from "../lobster/evaluate/calibration"
import { planKey, type CandidateView, type HeldUnitView, type LeverView } from "../lobster/voc"
import {
  FakeClock,
  ScriptedRefinerCore,
  ScriptedSearchCore,
  StubEvaluator,
  StubGenerator,
  StubSubstrate,
  collect,
  plan,
  type ScriptStep,
} from "./lobster-harness"

const P1 = plan([1, 4], [2, 8])

/** The shipped objective, and a second one for the flip to land on.
 *
 * `material` is not a new profile: `MATERIAL_ONLY_PROFILE` has shipped since
 * before Stage 0 and is what S0a's invoked gate was calibrated against. It is
 * registered HERE, in a test's own registry, and deliberately not in `COHORTS`
 * — Stage 1's production table has exactly one row, which is what makes the
 * whole stage a no-op. The registry is a kernel option precisely so this
 * distinction can exist. */
const TERRITORY: CohortId = DEFAULT_COHORT_ID
const MATERIAL: CohortId = "material"
const TWO_COHORTS: ReadonlyArray<CohortRow> = [
  ...COHORTS,
  { id: MATERIAL, profile: MATERIAL_ONLY_PROFILE },
]

const step = (over: Partial<ScriptStep> & { worst: number; best: number }): ScriptStep => ({
  plan: P1,
  costMs: 0.05,
  ...over,
})

const RUNG0: Bound = { lo: -990, est: 1, hi: 990 }

const reportOf = (k: LobsterKernel): KernelReport => {
  const r = k.lastReport
  if (r === null) throw new Error("no report")
  return r
}

/** Every cohort assumption on one record. There must be exactly one. */
const cohortsOn = (rec: EmitRecord): string[] =>
  rec.assumptions.filter((a) => a.kind === "cohort").map((a) => (a.kind === "cohort" ? a.id : ""))

interface Harness {
  readonly kernel: LobsterKernel
  readonly evaluator: StubEvaluator
  readonly clock: FakeClock
  readonly records: EmitRecord[]
  /** Slice boundaries seen, i.e. `abandoned` calls. */
  readonly boundaries: () => number
  run(): Promise<EmitRecord[]>
}

/**
 * A scripted decision that flips cohort at slice boundary `flipAt`.
 *
 * `bounds` is a function of the CURRENT cohort, because that is what a cohort
 * is: the same board, a different number. Nothing else about the decision
 * changes across the flip.
 */
function harness(opts: {
  script: ReadonlyArray<ScriptStep>
  flipAt?: number
  to?: CohortId
  bounds?: (cohort: CohortId | null) => Bound
  kernel?: Partial<KernelOptions>
  initialPins?: ReadonlyArray<Pin>
  budgetMs?: number
  view?: (active: () => CohortId | null) => LeverView
  /** Run at the flip's slice boundary, immediately BEFORE `flipCohort`. */
  preFlip?: (k: LobsterKernel) => void
  /** Run immediately AFTER `flipCohort` returns — so everything observed to
   * have changed between the two was changed BY the flip and by nothing else. */
  onFlip?: (k: LobsterKernel) => void
}): Harness {
  const clock = new FakeClock()
  const sub = new StubSubstrate()
  const gen = new StubGenerator()
  const kernel = new LobsterKernel({
    minWriteIntervalMs: 0,
    cohorts: TWO_COHORTS,
    ...opts.kernel,
  })
  const boundsOf = opts.bounds ?? (() => RUNG0)
  const evaluator = new StubEvaluator(() => boundsOf(kernel.activeCohort()))
  const core =
    opts.view === undefined
      ? new ScriptedSearchCore(clock, opts.script, { baseline: P1, conformCostMs: 0.05 })
      : new ScriptedRefinerCore(
          clock,
          opts.script,
          () => (opts.view as (a: () => CohortId | null) => LeverView)(() => kernel.activeCohort()),
          { baseline: P1, conformCostMs: 0.05 },
        )
  const records: EmitRecord[] = []
  let boundaries = 0
  const input: KernelInput = {
    sub,
    gen,
    evaluate: evaluator,
    search: core,
    asTeam: 0,
    deadlineMs: clock.value + (opts.budgetMs ?? 10),
    initialPins: opts.initialPins ?? [],
    now: clock.now,
    initialStepCostMs: 0.05,
    abandoned: () => {
      boundaries++
      if (opts.flipAt !== undefined && boundaries === opts.flipAt) {
        opts.preFlip?.(kernel)
        kernel.flipCohort(opts.to ?? MATERIAL)
        opts.onFlip?.(kernel)
      }
      return false
    },
  }
  return {
    kernel,
    evaluator,
    clock,
    records,
    boundaries: () => boundaries,
    run: async () => {
      const out = await collect(kernel.decide(input))
      records.push(...out)
      return out
    },
  }
}

// ===========================================================================
// 1. The stamp

describe("every number names the objective it was proved under", () => {
  it("stamps the default cohort on every record, exactly once", async () => {
    const h = harness({ script: [step({ worst: 10, best: 50 }), step({ worst: 20, best: 40 })] })
    const out = await h.run()
    expect(out.length).toBeGreaterThan(0)
    for (const rec of out) {
      expect(cohortsOn(rec)).toEqual([TERRITORY])
    }
    // The stamp is the registry's account of the objective, not a bare name:
    // a reader of the corpus does not need the table to interpret the record.
    const stamp = out[0].assumptions.find((a) => a.kind === "cohort")
    expect(stamp?.kind).toBe("cohort")
    if (stamp?.kind === "cohort") {
      expect([...stamp.features].sort()).toEqual([...stamp.features])
      expect(stamp.features).toContain("material")
    }
  })

  it("opens under a caller-named cohort, and refuses one the registry lacks", async () => {
    // The seam Stage 2's governor will set per decision. Today it is a
    // constant, supplied once, and every number the decision produces carries
    // it.
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0, cohorts: TWO_COHORTS })
    const clock = new FakeClock()
    const base: KernelInput = {
      sub: new StubSubstrate(),
      gen: new StubGenerator(),
      evaluate: new StubEvaluator(() => RUNG0),
      search: new ScriptedSearchCore(clock, [step({ worst: 5, best: 9 })], { baseline: P1 }),
      asTeam: 0,
      deadlineMs: clock.value + 5,
      initialPins: [],
      now: clock.now,
      initialStepCostMs: 0.05,
    }
    const out = await collect(kernel.decide({ ...base, cohort: MATERIAL }))
    for (const rec of out) expect(cohortsOn(rec)).toEqual([MATERIAL])

    // An unregistered id is refused where it is named, not discovered later as
    // a bound stamped with an objective nobody can look up.
    await expect(async () => {
      for await (const _ of kernel.decide({ ...base, cohort: "no-such-cohort" })) void _
    }).rejects.toThrow(/unknown cohort/)
  })

  it("refuses an unregistered flip and no-ops a flip to the active cohort", async () => {
    let sameCohortFlip: boolean | null = null
    let unknownThrew = false
    const h = harness({
      script: [step({ worst: 10, best: 50 }), step({ worst: 20, best: 40 })],
      flipAt: 1,
      to: TERRITORY, // already active
      onFlip: (k) => {
        sameCohortFlip = k.flipCohort(TERRITORY)
        try {
          k.flipCohort("not-in-the-table")
        } catch {
          unknownThrew = true
        }
      },
    })
    await h.run()
    expect(sameCohortFlip).toBe(false)
    expect(unknownThrew).toBe(true)
    // ...and the refused flip changed nothing.
    expect(h.kernel.activeCohort()).toBeNull() // decision over
    for (const rec of h.records) expect(cohortsOn(rec)).toEqual([TERRITORY])
  })

  it("has no live cohort outside a decision", () => {
    const k = new LobsterKernel()
    expect(k.activeCohort()).toBeNull()
    expect(k.flipCohort(MATERIAL)).toBe(false)
  })
})

// ===========================================================================
// 2. The ratchet does not slander a cohort flip

describe("ratchet non-slander: a falling floor across a flip is not a violation", () => {
  /** ONE plan, rising, then a cliff — so the fall is unambiguously a fall in
   * the same quantity about the same plan, and not a plan change wearing a
   * ratchet's clothes. Without a re-basing the cliff is a broken lattice and
   * the kernel is right to say so. */
  const FALLING: ReadonlyArray<ScriptStep> = [
    step({ plan: P1, worst: 10, best: 90 }),
    step({ plan: P1, worst: 30, best: 70 }),
    step({ plan: P1, worst: 50, best: 60 }),
    step({ plan: P1, worst: -40, best: 55 }),
    step({ plan: P1, worst: -35, best: 50 }),
    step({ plan: P1, worst: -30, best: 45 }),
  ]

  it("WITHOUT a flip the same fall IS slandered — the control", async () => {
    // If this ever stops failing the ratchet, the test below proves nothing:
    // it would be asserting the absence of a refusal that never happened.
    const h = harness({ script: FALLING, budgetMs: 30 })
    await h.run()
    const rep = reportOf(h.kernel)
    expect(rep.refusals["ratchet-floor"]).toBeGreaterThan(0)
    expect(rep.boundViolations).toBeGreaterThan(0)
  })

  it("WITH the flip at the same point, zero refusals and zero violations", async () => {
    const h = harness({
      script: FALLING,
      budgetMs: 30,
      // Fire once the floor has ratcheted up and before the cliff lands.
      flipAt: 4,
    })
    const out = await h.run()
    const rep = reportOf(h.kernel)
    expect(rep.refusals["ratchet-floor"]).toBe(0)
    expect(rep.boundViolations).toBe(0)
    // Non-vacuity: the floor really did fall across the flip. A test that
    // passed because nothing ever went down would be measuring nothing.
    const before = out.filter((r) => cohortsOn(r)[0] === TERRITORY)
    const after = out.filter((r) => cohortsOn(r)[0] === MATERIAL)
    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    expect(Math.min(...after.map((r) => r.lo))).toBeLessThan(
      Math.max(...before.map((r) => r.lo)),
    )
  })

  it("the ratchet still bites WITHIN the new cohort", async () => {
    // The floor is not abolished by a flip, it is re-founded: the new basis
    // establishes its own from its own first emission, and a fall inside the
    // new objective is still a broken lattice.
    const h = harness({
      script: [
        step({ plan: P1, worst: 10, best: 90 }),
        step({ plan: P1, worst: 30, best: 70 }),
        step({ plan: P1, worst: 60, best: 65 }),
        step({ plan: P1, worst: 20, best: 64 }),
        step({ plan: P1, worst: 15, best: 63 }),
      ],
      budgetMs: 30,
      flipAt: 2,
    })
    await h.run()
    const rep = reportOf(h.kernel)
    expect(rep.refusals["ratchet-floor"]).toBeGreaterThan(0)
  })

  it("pushes a snapshot of the old basis and opens a new one, floor NOT carried", async () => {
    let atFlip: ReturnType<LobsterKernel["basisSnapshot"]> = null
    const h = harness({
      script: [
        step({ worst: 10, best: 90 }),
        step({ worst: 30, best: 70 }),
        step({ worst: 50, best: 60 }),
        step({ worst: 55, best: 58 }),
      ],
      budgetMs: 30,
      flipAt: 3,
      onFlip: (k) => {
        atFlip = k.basisSnapshot()
      },
    })
    await h.run()
    const snap = atFlip as unknown as { cohort: string; floorLo: number; emits: number } | null
    expect(snap).not.toBeNull()
    // The NEW basis, read the instant the flip returned: it names the new
    // objective and it has no floor yet. A carried floor would be a promise
    // proved about a different question.
    expect(snap?.cohort).toBe(MATERIAL)
    expect(snap?.floorLo).toBe(Number.NEGATIVE_INFINITY)
    expect(snap?.emits).toBe(0)
    // ...and the old basis is in the history, with its own objective on it.
    const rep = reportOf(h.kernel)
    expect(rep.basisHistory.some((b) => b.cohort === TERRITORY)).toBe(true)
    expect(rep.basisHistory.some((b) => b.cohort === MATERIAL)).toBe(true)
  })
})

// ===========================================================================
// 3. No mixing

describe("no mixing: one decision's comparisons never span two objectives", () => {
  it("a record's basis names exactly one cohort, and it changes only at the flip", async () => {
    const h = harness({
      script: [
        step({ worst: 10, best: 90 }),
        step({ worst: 20, best: 80 }),
        step({ worst: 30, best: 70 }),
        step({ worst: 40, best: 60 }),
      ],
      budgetMs: 30,
      flipAt: 3,
    })
    const out = await h.run()
    const seq = out.map((r) => cohortsOn(r))
    for (const ids of seq) expect(ids).toHaveLength(1)
    // Monotone: territory..., then material..., and never back and forth.
    const flat = seq.map((ids) => ids[0])
    const firstMaterial = flat.indexOf(MATERIAL)
    expect(firstMaterial).toBeGreaterThan(0)
    expect(flat.slice(0, firstMaterial).every((c) => c === TERRITORY)).toBe(true)
    expect(flat.slice(firstMaterial).every((c) => c === MATERIAL)).toBe(true)
  })

  it("rows() refuses a lever view stamped with another cohort", async () => {
    // The direct test of the filter. The view offers a RIVAL the kernel has
    // never scored itself — the one row `candidateFor` would materialise
    // straight onto the wire — and stamps it with an objective that is not the
    // active one. It must never be staged: a rival proved under another
    // question is not a rival, it is a different answer.
    const units: HeldUnitView[] = [
      { unitId: 7, rung: "free", staleness: 1, cloudSize: 4, meet: 1, refinable: true },
    ]
    const foreign: CandidateView = {
      key: "FOREIGN",
      plan: plan([1, 9], [2, 9]),
      lo: 9_000,
      est: 9_000,
      hi: 9_000,
      horizon: 1,
      vacuity: "alive",
      cohort: MATERIAL,
      loCite: new Set<number>(),
      hiCite: new Set<number>(),
      refuted: false,
    }
    const h = harness({
      script: [step({ worst: 10, best: 50 }), step({ worst: 20, best: 40 })],
      budgetMs: 20,
      view: () => ({
        candidates: [foreign],
        leaderIdx: 0,
        slack: 0,
        horizon: 1,
        depthMax: 2,
        units,
        interiorCells: 81,
        epsilon: 1.5,
        round: 0,
      }),
    })
    const out = await h.run()
    // 9,000 is an order of magnitude above anything the script produces, so an
    // unfiltered row would win every gate it met.
    expect(out.some((r) => planKey(r.plan) === "FOREIGN")).toBe(false)
    for (const rec of out) {
      expect(cohortsOn(rec)).toEqual([TERRITORY])
      expect(rec.lo).toBeLessThan(9_000)
    }
  })

  it("an unstamped staging row is a COMPILE error, not a silent max", () => {
    // The type is the enforcement; this test exists so the enforcement is
    // visible and so removing the field fails the suite rather than quietly
    // widening what can be compared.
    // @ts-expect-error a StagingCandidate without a cohort does not typecheck
    const unstamped: StagingCandidate = { key: "x", lo: 0, est: 0, hi: 0, horizon: 1, vacuity: "alive" }
    const stamped: StagingCandidate = { ...unstamped, cohort: TERRITORY }
    expect(stamped.cohort).toBe(TERRITORY)
  })
})

// ===========================================================================
// 4. Completeness and the operator

describe("a flip never costs the wire its plan, and never reaches the operator", () => {
  it("keeps staging across the flip — the wire is never empty", async () => {
    const h = harness({
      script: [
        step({ worst: 10, best: 90 }),
        step({ worst: 20, best: 80 }),
        step({ worst: 30, best: 70 }),
        step({ worst: 40, best: 60 }),
        step({ worst: 45, best: 55 }),
      ],
      budgetMs: 40,
      flipAt: 3,
    })
    const out = await h.run()
    const rep = reportOf(h.kernel)
    expect(rep.stagedNothing).toBe(false)
    // Records on both sides of the flip: the decision did not go quiet when
    // its objective changed.
    const flat = out.map((r) => cohortsOn(r)[0])
    expect(flat).toContain(TERRITORY)
    expect(flat).toContain(MATERIAL)
    // Every record carries a real plan, before and after.
    for (const rec of out) expect(rec.plan.size).toBeGreaterThan(0)
  })

  it("re-measures the incumbent UNCONDITIONALLY at the flip", async () => {
    // The same-evaluator rule, made unconditional: `governPosture` may carry a
    // valid number under a new channel, `governCohort` may not carry anything.
    // Everything the evaluator is asked between the two readings was asked BY
    // the flip, because nothing else runs between them.
    let seenBefore = 0
    let askedByTheFlip: string[] = []
    let helper: StubEvaluator | null = null
    const h = harness({
      script: [
        step({ plan: P1, worst: 10, best: 90 }),
        step({ plan: P1, worst: 20, best: 80 }),
        step({ plan: P1, worst: 30, best: 70 }),
        step({ plan: P1, worst: 40, best: 60 }),
      ],
      budgetMs: 30,
      flipAt: 3,
      preFlip: () => {
        seenBefore = (helper as StubEvaluator).seen.length
      },
      onFlip: () => {
        askedByTheFlip = (helper as StubEvaluator).seen.slice(seenBefore)
      },
    })
    helper = h.evaluator
    await h.run()
    // The plan the wire is holding was re-priced under the new objective
    // before the flip returned — before any budget was consulted, and before
    // anything was allowed to replace it.
    expect(askedByTheFlip).toContain(planKey(P1))
  })

  it("Gate 3½ is policy-blind: a committed pin survives the flip", async () => {
    const pins: Pin[] = [{ unitId: 2, to: 77, tentative: false }]
    const h = harness({
      script: [
        step({ worst: 10, best: 90 }),
        step({ worst: 20, best: 80 }),
        step({ worst: 30, best: 70 }),
        step({ worst: 40, best: 60 }),
      ],
      budgetMs: 30,
      flipAt: 3,
      initialPins: pins,
    })
    const out = await h.run()
    const rep = reportOf(h.kernel)
    // Humans always win, in every objective. Not one record — before, at, or
    // after the flip — contradicts the pin, and the conformance gate never had
    // to refuse one either.
    for (const rec of out) {
      expect(rec.plan.get(2)?.to).toBe(77)
      expect(rec.assumptions).toContainEqual({ kind: "operator-pin", unitId: 2, to: 77 })
    }
    expect(rep.refusals.nonconforming).toBe(0)
    expect(out.map((r) => cohortsOn(r)[0])).toContain(MATERIAL)
  })
})

// ===========================================================================
// 5. The no-op property, from inside

describe("with the policy off the cohort is a constant", () => {
  it("the default kernel takes the shipped registry AND no policy", () => {
    // What makes a default-configured decision a constant-cohort decision is
    // the second line, not the first. Stage 1 had one registered row and
    // leaned on that; Stage 2 registers two and leans on `admission: null` —
    // registering a row admits nothing, and nothing but the policy chooses.
    expect(DEFAULT_KERNEL_OPTIONS.cohorts).toBe(COHORTS)
    expect(DEFAULT_KERNEL_OPTIONS.admission).toBeNull()
  })

  it("a production-shaped decision proves everything under one objective", async () => {
    const clock = new FakeClock()
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0 })
    const out = await collect(
      kernel.decide({
        sub: new StubSubstrate(),
        gen: new StubGenerator(),
        evaluate: new StubEvaluator(() => RUNG0),
        search: new ScriptedSearchCore(
          clock,
          [step({ worst: 10, best: 90 }), step({ worst: 30, best: 70 })],
          { baseline: P1 },
        ),
        asTeam: 0,
        deadlineMs: clock.value + 10,
        initialPins: [],
        now: clock.now,
        initialStepCostMs: 0.05,
      }),
    )
    const rep = reportOf(kernel)
    expect(new Set(out.flatMap(cohortsOn))).toEqual(new Set([TERRITORY]))
    expect(new Set(rep.basisHistory.map((b) => b.cohort))).toEqual(new Set([TERRITORY]))
    for (const c of rep.contexts) {
      if (c.cohort !== null) expect(c.cohort).toBe(TERRITORY)
    }
  })
})
