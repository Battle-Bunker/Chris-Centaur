/**
 * The anytime kernel: clock discipline, the five emit gates, constraint
 * epochs, and the pin-context cache.
 *
 * Every test drives an injected fake clock, so a "5 ms contention spike" is a
 * number in a script rather than a race with the machine. Nothing here can be
 * flaky under load, which matters more than usual: the bug this suite exists
 * to prevent was itself a load artefact.
 */

import type { Bound, EmitRecord, JointPlan, KernelInput, Pin } from "../lobster/contracts"
import type { LensEvent } from "../lens/types"
import { channelPolicyFor } from "../lobster/postures"

/** THE REPORT NO LONGER CARRIES THE SEQUENCES (04 §5.2 #11): a posture flip
 *  and a basis change are moments on a timeline, so they are `LensEvent`s and
 *  the assertions that used to read `postureFlips` / `basisHistory` read the
 *  frames instead. The sink is attached only by the tests that look at it —
 *  every other test in this file runs with `KernelInput.lens` undefined, which
 *  is also the state gate 7(ii) measures. */
const framesOf = (into: LensEvent[]) => (e: LensEvent): void => {
  into.push(e)
}
import {
  DEFAULT_KERNEL_OPTIONS,
  LobsterKernel,
  PinContextCache,
  canonicalPins,
  deadlineFromWallClock,
  pinContextKey,
  type KernelOptions,
  type KernelReport,
} from "../lobster/kernel"
import { planKey, type CandidateView, type HeldUnitView, type LeverView } from "../lobster/voc"
import {
  FakeClock,
  ScriptedRefinerCore,
  ScriptedSearchCore,
  StubEvaluator,
  StubGenerator,
  StubSubstrate,
  cand,
  collect,
  ledgerEntry,
  plan,
  witness,
  type ScriptStep,
} from "./lobster-harness"

const P1 = plan([1, 4], [2, 8])
const P2 = plan([1, 5], [2, 8])
const P3 = plan([1, 6], [2, 9])
const P4 = plan([1, 6], [2, 8])

const step = (over: Partial<ScriptStep> & { worst: number; best: number }): ScriptStep => ({
  plan: P1,
  costMs: 0.05,
  ...over,
})

const RUNG0: Bound = { lo: -990, est: 1, hi: 990 }

/** The scripted FINITE cliff these suites use where vacuity must trigger; the
 * production default is the system DEAD (−∞), pinned in the postures suite. */
const CLIFF = -1000

interface Rig {
  readonly clock: FakeClock
  readonly sub: StubSubstrate
  readonly gen: StubGenerator
  readonly evaluator: StubEvaluator
  readonly core: ScriptedSearchCore
  readonly kernel: LobsterKernel
  input(over?: Partial<KernelInput>): KernelInput
}

function rig(
  script: ReadonlyArray<ScriptStep>,
  opts: Partial<KernelOptions> = {},
  extras: {
    readonly budgetMs?: number
    readonly evaluator?: StubEvaluator
    readonly core?: (clock: FakeClock) => ScriptedSearchCore
    readonly influence?: ReadonlyMap<number, ReadonlySet<number>>
    readonly baseline?: JointPlan
    readonly conformCostMs?: number
  } = {},
): Rig {
  const clock = new FakeClock()
  const sub = new StubSubstrate(extras.influence)
  const gen = new StubGenerator()
  const evaluator = extras.evaluator ?? new StubEvaluator(() => RUNG0)
  const core =
    extras.core?.(clock) ??
    new ScriptedSearchCore(clock, script, {
      baseline: extras.baseline ?? P1,
      conformCostMs: extras.conformCostMs ?? 0.05,
    })
  const kernel = new LobsterKernel({ minWriteIntervalMs: 0, ...opts })
  const budgetMs = extras.budgetMs ?? 10
  return {
    clock,
    sub,
    gen,
    evaluator,
    core,
    kernel,
    input: (over = {}) => ({
      sub,
      gen,
      evaluate: evaluator,
      search: core,
      asTeam: 0,
      deadlineMs: clock.value + budgetMs,
      initialPins: [],
      now: clock.now,
      initialStepCostMs: 0.05,
      ...over,
    }),
  }
}

const reportOf = (k: LobsterKernel): KernelReport => {
  const r = k.lastReport
  if (r === null) throw new Error("no report")
  return r
}

// ===========================================================================

describe("rung 0 — a legal joint plan reaches the wire before anything is searched", () => {
  it("stages a conforming plan at budget zero, and never resolves a board", async () => {
    const r = rig([step({ worst: 10, best: 50 })], {}, { budgetMs: 0 })
    const out = await collect(r.kernel.decide(r.input()))
    expect(out).toHaveLength(1)
    expect(out[0].plan.size).toBeGreaterThan(0)
    expect(reportOf(r.kernel).stagedNothing).toBe(false)
    expect(r.core.callOrder).toEqual(["conform"])
    // A kernel that resolves a board has stopped being a kernel.
    expect(r.sub.resolveCalls).toBe(0)
  })

  it("honours the initial pins in the very first record", async () => {
    const pins: Pin[] = [{ unitId: 2, to: 77, tentative: false }]
    const r = rig([step({ worst: 10, best: 50 })], {}, { budgetMs: 0 })
    const out = await collect(r.kernel.decide(r.input({ initialPins: pins })))
    expect(out[0].plan.get(2)?.to).toBe(77)
    expect(out[0].assumptions).toContainEqual({ kind: "operator-pin", unitId: 2, to: 77 })
  })
})

// ===========================================================================

describe("the five emit gates", () => {
  it("1. RATCHET — refuses a weaker promise, counts it, and never clamps it", async () => {
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 10, best: 60 }), // the search broke the lattice
      step({ plan: P2, worst: 41, best: 45 }),
    ])
    const out = await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    expect(rep.boundViolations).toBeGreaterThan(0)
    expect(rep.refusals["ratchet-floor"]).toBeGreaterThan(0)
    // Nothing on the wire ever carries the weaker floor — refused, not clamped.
    expect(out.every((rec) => rec.lo !== 10)).toBe(true)
    const withinBasis = out.filter((rec) => rec.epoch === 0).map((rec) => rec.lo)
    expect(withinBasis).toEqual([...withinBasis].sort((a, b) => a - b))
  })

  it("1b. RATCHET — a plan change needs a strictly better proven floor", async () => {
    // The stager works off the CURRENT rows; the ratchet works off what is
    // actually on the wire. Here the search retracts P2 to 40→10 (refused, so
    // the wire keeps 40) and then offers P3 at 20 — clear of the stager's
    // margin over the retracted row, but well under the promise standing on
    // the wire. The gate is the second line of defence, and it holds.
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 10, best: 60 }),
      step({ plan: P3, worst: 20, best: 25 }),
    ])
    await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    // Either gate may catch it — the floor ratchet fires first whenever the
    // wire's promise is still the higher one, and the switch rule is the
    // defence behind it. What matters is that the weaker plan never lands.
    expect(rep.refusals["ratchet-floor"] + rep.refusals["switch-floor"]).toBeGreaterThan(0)
    expect(rep.journal.every((rec) => planKey(rec.plan) !== planKey(P3))).toBe(true)
    expect(rep.journal[rep.journal.length - 1].lo).toBe(40)
  })

  it("1c. RATCHET — `dominance` additionally demands the old ceiling be reached", async () => {
    const script = [step({ plan: P2, worst: 40, best: 90 }), step({ plan: P3, worst: 50, best: 60 })]
    const loose = rig(script, { switchRule: "floor" })
    await collect(loose.kernel.decide(loose.input()))
    expect(reportOf(loose.kernel).journal.some((r) => planKey(r.plan) === planKey(P3))).toBe(true)

    const strict = rig(script, { switchRule: "dominance" })
    await collect(strict.kernel.decide(strict.input()))
    expect(reportOf(strict.kernel).refusals["switch-dominance"]).toBeGreaterThan(0)
  })

  it("2. WORTH — a re-emission that removes nothing costs nothing to skip", async () => {
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 40, best: 59 }), // 1 of 20 removed: under 15%
      step({ plan: P2, worst: 40, best: 45 }), // 15 of 20 removed: worth a write
    ])
    await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    expect(rep.refusals.worth).toBeGreaterThan(0)
    expect(rep.journal.some((rec) => rec.hi === 45)).toBe(true)
    expect(rep.journal.some((rec) => rec.hi === 59)).toBe(false)
  })

  it("3. RATE — one decision does not monopolise a wire with no server-side throttle", async () => {
    const script = [
      step({ plan: P2, worst: 10, best: 90 }),
      step({ plan: P2, worst: 10, best: 50 }),
      step({ plan: P2, worst: 10, best: 20 }),
    ]
    const fast = rig(script, { minWriteIntervalMs: 0 })
    await collect(fast.kernel.decide(fast.input()))
    const slow = rig(script, { minWriteIntervalMs: 5 })
    await collect(slow.kernel.decide(slow.input()))
    expect(reportOf(slow.kernel).refusals.rate).toBeGreaterThan(0)
    expect(reportOf(slow.kernel).emits).toBeLessThan(reportOf(fast.kernel).emits)
  })

  it("4. CROSSFADE — independent footprints skip the certificate; overlapping ones are counted", async () => {
    const disjoint = new Map<number, ReadonlySet<number>>([
      [1, new Set([1, 2, 3])],
      [2, new Set([50, 51])],
    ])
    const r = rig(
      [step({ plan: P2, worst: 40, best: 60 }), step({ plan: P4, worst: 55, best: 58 })],
      { crossfade: "teammate" },
      { influence: disjoint },
    )
    await collect(r.kernel.decide(r.input()))
    expect(reportOf(r.kernel).crossfade.independent).toBeGreaterThan(0)

    const overlapping = new Map<number, ReadonlySet<number>>([
      [1, new Set([1, 2, 3])],
      [2, new Set([3, 4])],
    ])
    const blocked = rig(
      [step({ plan: P2, worst: 40, best: 60 }), step({ plan: P4, worst: 55, best: 58 })],
      {
        crossfade: "teammate",
        // A teammate floor that says the change hurts the unit that got no say.
        teammateFloor: (p: JointPlan) => (planKey(p) === planKey(P4) ? -100 : 0),
      },
      { influence: overlapping },
    )
    await collect(blocked.kernel.decide(blocked.input()))
    expect(reportOf(blocked.kernel).crossfade.blocked).toBeGreaterThan(0)
    expect(reportOf(blocked.kernel).refusals.crossfade).toBeGreaterThan(0)
  })

  it("5. SINK — a throw leaves the previous record standing and the news unspent", async () => {
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 40, best: 42 }),
    ])
    const it = r.kernel.decide(r.input()) as AsyncGenerator<EmitRecord>
    const first = await it.next() // rung 0
    expect(first.done).toBe(false)
    // The wire throws on the next record.
    const after = await it.throw(new Error("wire down"))
    void after
    for (;;) {
      const n = await it.next()
      if (n.done === true) break
    }
    const rep = reportOf(r.kernel)
    expect(rep.refusals.sink).toBe(1)
    // The refused record never entered the journal, and the ratchet did not
    // move — so the same news was still available to the next pass.
    expect(rep.journal).toHaveLength(rep.emits)
    expect(rep.journal.some((rec) => rec.lo === 40)).toBe(true)
  })
})

// ===========================================================================

describe("clock discipline and the latch bug class", () => {
  /**
   * THE LATCH REGRESSION TEST.
   *
   * The arena kernel kept its cost estimators at module scope and bailed
   * before re-measuring, so ONE contention spike latched it into an immediate
   * early return for the rest of the process (95.6% optimal uncontended →
   * 41.0% in the round robin). Here: a 5 ms spike inside a 10 ms budget, then
   * four more decisions on the same kernel instance. Every one of them must
   * run at full budget.
   */
  it("runs at full budget on every decision after a contention spike", async () => {
    const script: ScriptStep[] = [
      step({ plan: P2, worst: 10, best: 90, costMs: 5 }), // the spike
      step({ plan: P2, worst: 20, best: 60 }),
      step({ plan: P2, worst: 30, best: 40 }),
    ]
    const r = rig(script, { sliceMs: 0.5, reserveMs: 1 }, { budgetMs: 10 })
    const slices: number[] = []

    await collect(r.kernel.decide(r.input()))
    slices.push(reportOf(r.kernel).slices)
    const spikeReport = reportOf(r.kernel)

    for (let d = 0; d < 4; d++) {
      await collect(r.kernel.decide(r.input()))
      slices.push(reportOf(r.kernel).slices)
    }

    // The decision that absorbed the spike still did real work…
    expect(slices[0]).toBeGreaterThan(20)
    // …and every later decision ran at full budget, identically.
    expect(new Set(slices.slice(1)).size).toBe(1)
    expect(slices[1]).toBeGreaterThan(100)
    expect(slices[1]).toBeGreaterThan(slices[0])
    // The estimator is not a decaying MAXIMUM: it came back down inside the
    // very decision that saw the spike.
    expect(spikeReport.finalStepCostMs).toBeLessThan(0.5)
    // Nothing overran.
    for (const rep of [spikeReport]) expect(rep.overshootMs).toBe(0)
  })

  it("floors the affordability guard at 0.2 × budget — the fix, isolated", async () => {
    const script: ScriptStep[] = [
      step({ plan: P2, worst: 10, best: 90, costMs: 5 }),
      step({ plan: P2, worst: 20, best: 60 }),
    ]
    // With the floor: a 5 ms spike inside 10 ms leaves 4 ms, and the guard may
    // demand at most 2 ms, so work resumes.
    const floored = rig(script, { guardBudgetFraction: 0.2 }, { budgetMs: 10 })
    await collect(floored.kernel.decide(floored.input()))
    expect(reportOf(floored.kernel).slices).toBeGreaterThan(20)

    // Without it (the arena's shape): estimate 2.5 ms × 1.6 = 4 ms > the 3.95
    // ms left, so the decision bails and never re-measures.
    const unfloored = rig(script, { guardBudgetFraction: 1 }, { budgetMs: 10 })
    await collect(unfloored.kernel.decide(unfloored.input()))
    expect(reportOf(unfloored.kernel).slices).toBe(1)
  })

  it("keeps the estimator on the decision context, not on the module", async () => {
    const script = [step({ plan: P2, worst: 10, best: 90, costMs: 5 })]
    const a = rig(script, {}, { budgetMs: 10 })
    await collect(a.kernel.decide(a.input()))
    const spiked = reportOf(a.kernel).contexts[0].stepCostMs

    // A SECOND kernel, same process, same module: it must know nothing about
    // the first one's spike.
    const b = rig([step({ plan: P2, worst: 10, best: 90 })], {}, { budgetMs: 10 })
    await collect(b.kernel.decide(b.input()))
    expect(spiked).toBeGreaterThan(0.5)
    expect(reportOf(b.kernel).contexts[0].stepCostMs).toBeLessThan(0.5)
  })

  it("believes no slice costs more than a quarter of the budget", async () => {
    const r = rig([step({ plan: P2, worst: 10, best: 90, costMs: 500 })], {}, { budgetMs: 10 })
    await collect(r.kernel.decide(r.input()))
    expect(reportOf(r.kernel).contexts[0].stepCostMs).toBeLessThanOrEqual(2.5)
  })

  it("converts a wall-clock deadline onto the kernel's own clock, once", () => {
    const clock = new FakeClock(500)
    const wall = () => 1_700_000_000_000
    expect(deadlineFromWallClock(1_700_000_000_250, clock.now, wall)).toBe(750)
  })
})

// ===========================================================================

describe("constraint epochs", () => {
  const pinAfter = (kernel: LobsterKernel, pin: Pin, afterIndex = 0) => {
    let fired = false
    return (_rec: EmitRecord, i: number) => {
      if (fired || i < afterIndex) return
      fired = true
      kernel.onPinEvent({ kind: "pin", pin })
    }
  }

  it("re-stages a conforming plan IMMEDIATELY, before any further refinement", async () => {
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 45, best: 50 }),
    ])
    const out = await collect(
      r.kernel.decide(r.input()),
      pinAfter(r.kernel, { unitId: 2, to: 77, tentative: false }),
    )
    const rep = reportOf(r.kernel)
    expect(rep.epochs).toBe(2)
    expect(rep.conformance).toHaveLength(1)
    const sample = rep.conformance[0]
    expect(sample.epoch).toBe(1)
    // The whole guarantee, in one assertion: not one refinement slice ran
    // between the operator's event and the conforming re-stage.
    expect(sample.slicesBefore).toBe(0)
    expect(sample.conformCalls).toBe(1)
    expect(sample.latencyMs).toBeCloseTo(0.05, 6)

    const firstOfEpoch1 = out.find((rec) => rec.epoch === 1)
    expect(firstOfEpoch1).toBeDefined()
    expect(firstOfEpoch1?.plan.get(2)?.to).toBe(77)
    expect(firstOfEpoch1?.assumptions).toContainEqual({
      kind: "operator-pin",
      unitId: 2,
      to: 77,
    })
    // Every record after the event conforms to the pin.
    for (const rec of out.filter((x) => x.epoch >= 1)) expect(rec.plan.get(2)?.to).toBe(77)
  })

  it("makes a cross-epoch ratchet comparison structurally impossible", async () => {
    // Epoch 0 proves a floor of 400. The pin then forces a plan worth far
    // less. A per-turn ratchet would refuse it forever and the wire would keep
    // contradicting the operator; a per-epoch one stages it at once.
    const r = rig([
      step({ plan: P2, worst: 400, best: 500 }),
      step({ plan: P2, worst: 401, best: 402 }),
    ])
    const frames: LensEvent[] = []
    const out = await collect(
      r.kernel.decide(r.input({ lens: framesOf(frames) })),
      // Let epoch 0 prove its floor first, then constrain it.
      pinAfter(r.kernel, { unitId: 2, to: 77, tentative: false }, 1),
    )
    const epoch0 = out.filter((rec) => rec.epoch === 0)
    const epoch1 = out.filter((rec) => rec.epoch === 1)
    expect(epoch0.some((rec) => rec.lo === 400)).toBe(true)
    expect(epoch1).not.toHaveLength(0)
    // The first record of epoch 1 sits BELOW epoch 0's proven floor and is
    // staged anyway: no floor crossed the epoch boundary.
    expect(epoch1[0].lo).toBeLessThan(400)
    // Within epoch 1 the ratchet is in force again, on its own floor.
    const los = epoch1.map((rec) => rec.lo)
    expect(los).toEqual([...los].sort((a, b) => a - b))
    // Each basis carries its own floor; none is ever read by another. The
    // partition frames are the epoch sequence, with the pin that caused each.
    const epochs = frames.filter((e) => e.kind === "partition").map((e) => e.epoch)
    expect(new Set(epochs).size).toBeGreaterThan(1)
  })

  it("does not start an epoch for a tentative pin, and never puts one on the wire", async () => {
    const r = rig(
      [step({ plan: P2, worst: 40, best: 60 }), step({ plan: P2, worst: 45, best: 50 })],
      { speculativePeriod: 2 },
    )
    const out = await collect(
      r.kernel.decide(r.input()),
      pinAfter(r.kernel, { unitId: 2, to: 99, tentative: true }),
    )
    const rep = reportOf(r.kernel)
    expect(rep.epochs).toBe(1)
    expect(rep.conformance).toHaveLength(0)
    // Searched, at lower priority, in its own context…
    expect(rep.speculative.length).toBeGreaterThan(0)
    expect(rep.speculative[0].key.startsWith("spec:")).toBe(true)
    const spec = rep.contexts.filter((c) => c.speculative)
    const committed = rep.contexts.filter((c) => !c.speculative)
    expect(spec[0].cursor).toBeGreaterThan(0)
    // …at strictly lower priority than the committed context.
    expect(committed[0].cursor).toBeGreaterThan(spec[0].cursor)
    // …and never on the wire.
    for (const rec of out) expect(rec.plan.get(2)?.to).not.toBe(99)
  })

  it("treats a human commit as permanent and refuses to unpin it", async () => {
    const r = rig([
      step({ plan: P2, worst: 40, best: 60 }),
      step({ plan: P2, worst: 45, best: 50 }),
    ])
    let phase = 0
    const out = await collect(r.kernel.decide(r.input()), () => {
      if (phase === 0) {
        phase = 1
        r.kernel.onPinEvent({ kind: "commit", unitId: 1 })
      } else if (phase === 1) {
        phase = 2
        // Humans always win: the bot never auto-unpins one.
        r.kernel.onPinEvent({ kind: "unpin", unitId: 1 })
      }
    })
    const rep = reportOf(r.kernel)
    expect(rep.epochs).toBe(2) // the commit made one epoch; the unpin made none
    const committedTo = out.filter((rec) => rec.epoch === 1)[0]?.plan.get(1)?.to
    expect(committedTo).toBeDefined()
    for (const rec of out.filter((x) => x.epoch >= 1)) {
      expect(rec.plan.get(1)?.to).toBe(committedTo)
      expect(rec.assumptions).toContainEqual({ kind: "operator-pin", unitId: 1, to: committedTo })
    }
  })

  it("canonicalises a pin context: committed only, sorted, order-independent", () => {
    const a: Pin[] = [
      { unitId: 5, to: 2, tentative: false },
      { unitId: 1, to: 9, tentative: false },
      { unitId: 3, to: 4, tentative: true },
    ]
    expect(canonicalPins(a).map((p) => p.unitId)).toEqual([1, 5])
    expect(pinContextKey(canonicalPins(a))).toBe(pinContextKey(canonicalPins([...a].reverse())))
    expect(pinContextKey(canonicalPins(a))).toBe("pin:[1@9,5@2]")
  })
})

// ===========================================================================

describe("the pin-context cache (tier 3: context-exclusive)", () => {
  it("resumes an exact hit: the incumbent, its witnesses and its cursor come back", async () => {
    const w = [witness("punishing line", [[9, 3]])]
    const r = rig([
      step({ plan: P2, worst: 10, best: 90, witnesses: w }),
      step({ plan: P2, worst: 20, best: 70, witnesses: w }),
      step({ plan: P2, worst: 30, best: 60, witnesses: w }),
      step({ plan: P2, worst: 31, best: 59, witnesses: w }),
    ])
    let phase = 0
    await collect(r.kernel.decide(r.input()), () => {
      if (phase === 0 && r.core.cursor >= 3) {
        phase = 1
        r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
      } else if (phase === 1) {
        phase = 2
        r.kernel.onPinEvent({ kind: "unpin", unitId: 2 })
      }
    })
    const rep = reportOf(r.kernel)
    expect(rep.epochs).toBe(3)
    expect(rep.cache.resumes).toBeGreaterThan(0)
    // The conform of epoch 2 was handed the epoch-0 incumbent back.
    const resumeConform = r.core.conformLog[2]
    expect(resumeConform.incumbentLo).toBe(30)
    expect(resumeConform.incumbentKey).toBe(planKey(P2))
    expect(resumeConform.witnesses).toBe(1)
    // And the cursor did not restart: the resumed context kept its progress.
    const base = rep.contexts.find((c) => c.key === "pin:[]")
    expect(base?.cursor).toBeGreaterThanOrEqual(3)
  })

  it("keys by canonical PinSet, evicts LRU, and clears per turn", () => {
    const cache = new PinContextCache(2)
    const a = cache.obtain("pin:[1@2]", [], false, 0, 0.1)
    expect(a.resumed).toBe(false)
    a.entry.incumbent = { plan: P1, bounds: { worst: 1, best: 2, ledger: [], assumptions: [], exact: true }, witnesses: [] }
    expect(cache.obtain("pin:[1@2]", [], false, 0, 0.1).resumed).toBe(true)
    cache.obtain("pin:[1@3]", [], false, 0, 0.1)
    cache.obtain("pin:[1@4]", [], false, 0, 0.1)
    expect(cache.size).toBe(2)
    expect(cache.stats.evictions).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it("invalidates on catch-up: a premise replaced is not a premise refined", () => {
    const cache = new PinContextCache(8)
    const stale = cache.obtain("pin:[]", [], false, 0, 0.1).entry
    stale.citedUnits.add(7)
    stale.incumbent = { plan: P1, bounds: { worst: 1, best: 2, ledger: [], assumptions: [], exact: true }, witnesses: [] }
    stale.cursor = 4
    const other = cache.obtain("pin:[1@2]", [], false, 0, 0.1).entry
    other.citedUnits.add(7)
    const untouched = cache.obtain("pin:[1@3]", [], false, 0, 0.1).entry
    untouched.citedUnits.add(9)

    expect(cache.invalidateCitingUnit(7, "pin:[]")).toBe(2)
    // The active context cannot be dropped mid-flight, so it is reset in place.
    expect(stale.incumbent).toBeNull()
    expect(stale.cursor).toBe(0)
    expect(cache.peek("pin:[1@2]")).toBeNull()
    expect(cache.peek("pin:[1@3]")).toBe(untouched)
  })

  it("invalidates through the kernel when the orchestrator spends a catch-up", async () => {
    const clock = new FakeClock()
    const cited = [ledgerEntry(7)]
    const script = [
      step({ plan: P2, worst: 10, best: 90, ledger: cited }),
      step({ plan: P2, worst: 20, best: 70, ledger: cited }),
      step({ plan: P2, worst: 30, best: 60, ledger: cited }),
    ]
    const units: HeldUnitView[] = [
      { unitId: 7, rung: "free", staleness: 3, cloudSize: 10, meet: 1, refinable: true },
    ]
    const candidates: CandidateView[] = [
      {
        key: planKey(P2),
        plan: P2,
        lo: 10,
        est: 10,
        hi: 90,
        horizon: 1,
        vacuity: "alive",
        loCite: new Set([7]),
        hiCite: new Set<number>(),
        refuted: false,
      },
    ]
    const viewOf = (): LeverView => ({
      candidates,
      leaderIdx: 0,
      slack: 70,
      horizon: 1,
      depthMax: 2,
      units,
      interiorCells: 81,
      epsilon: 1.5,
      round: 0,
    })
    const r = rig(
      script,
      {},
      {
        core: (c) => new ScriptedRefinerCore(c, script, viewOf, { baseline: P1, conformCostMs: 0.05 }),
      },
    )
    // The rig built its own clock; use the one the core was given.
    void clock
    await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    // The lever surface bound the order — `refine` ran rather than `improve` —
    // and the lever the VOC picked was a catch-up, which is the only lever
    // that invalidates a citing context. (`levers` and `leverOrderBinding`
    // left the report with 04 §5.2 #11: both were structurally constant in
    // production, where no core exposes a refinement view at all.)
    expect(rep.refineCalls).toBeGreaterThan(0)
    expect(rep.improveCalls).toBe(0)
    expect(rep.cache.invalidations).toBeGreaterThan(0)
  })
})

// ===========================================================================

describe("postures on the wire", () => {
  it("flips on measured conditions, logs the flip, and stamps it on every record", async () => {
    const cloudDead = [ledgerEntry(9)]
    const r = rig(
      [
        step({ plan: P1, worst: -1000, best: 40, ledger: cloudDead }),
        step({ plan: P1, worst: -1000, best: 30, ledger: cloudDead }),
      ],
      { deadBelow: CLIFF },
      { baseline: P1 },
    )
    const frames: LensEvent[] = []
    await collect(r.kernel.decide(r.input({ lens: framesOf(frames) })))
    const rep = reportOf(r.kernel)
    const flips = frames.filter((e) => e.kind === "posture")
    expect(flips.map((f) => (f as { to: string }).to)).toContain("FOGGED-VACUOUS")
    const late = rep.journal[rep.journal.length - 1]
    expect(late.posture).toBe("FOGGED-VACUOUS")
    expect(late.assumptions).toContainEqual({ kind: "posture", posture: "FOGGED-VACUOUS" })
    // A posture flip opens a new basis: the ratchet never compares across
    // channels (the leading channel changed underneath it).
    expect(flips.map((f) => (f as { from: string }).from)).toContain("SIGHTED")
  })

  it("keeps est off every adjudication it does not own", async () => {
    const script = [
      step({ plan: P2, worst: 10, best: 90 }),
      step({ plan: P3, worst: 40, best: 60 }),
      step({ plan: P3, worst: 50, best: 55 }),
    ]
    const strip = (rec: EmitRecord) => ({
      key: planKey(rec.plan),
      lo: rec.lo,
      hi: rec.hi,
      epoch: rec.epoch,
      posture: rec.posture,
      slack: rec.slack,
      horizon: rec.horizon,
    })
    const quiet = rig(script, {}, { evaluator: new StubEvaluator(() => RUNG0) })
    const loud = rig(
      script,
      {},
      { evaluator: new StubEvaluator(() => ({ lo: -990, est: 1e9, hi: 990 })) },
    )
    const a = (await collect(quiet.kernel.decide(quiet.input()))).map(strip)
    const b = (await collect(loud.kernel.decide(loud.input()))).map(strip)
    // Floors are distinct throughout, so est has no tie to break — and with no
    // tie to break it changes nothing at all.
    expect(b).toEqual(a)
  })
})

// ===========================================================================

describe("journal integrity", () => {
  it("makes every prefix a complete staged set, monotone within its basis", async () => {
    const r = rig([
      step({ plan: P2, worst: 10, best: 90 }),
      step({ plan: P2, worst: 10, best: 40 }),
      step({ plan: P3, worst: 30, best: 35 }),
      step({ plan: P3, worst: 31, best: 32 }),
    ])
    const out = await collect(
      r.kernel.decide(r.input()),
      (() => {
        let fired = false
        return () => {
          if (fired) return
          fired = true
          r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
        }
      })(),
    )
    const byBasis = new Map<string, EmitRecord[]>()
    for (const rec of out) {
      expect(rec.plan.size).toBeGreaterThan(0) // never a partial staged set
      const k = `${rec.epoch}/${rec.posture}`
      const list = byBasis.get(k) ?? []
      list.push(rec)
      byBasis.set(k, list)
    }
    for (const list of byBasis.values()) {
      const channel = (rec: EmitRecord): number =>
        rec.posture === "FOGGED-VACUOUS" ? Math.min(Math.max(rec.est, rec.lo), rec.hi) : rec.lo
      for (let i = 1; i < list.length; i++) {
        // The floor never falls, and the leading channel never falls, inside a
        // basis. Across bases nothing is compared at all.
        expect(list[i].lo).toBeGreaterThanOrEqual(list[i - 1].lo)
        expect(channel(list[i])).toBeGreaterThanOrEqual(channel(list[i - 1]))
        expect(list[i].hi - channel(list[i])).toBeLessThanOrEqual(
          list[i - 1].hi - channel(list[i - 1]),
        )
      }
    }
    expect(reportOf(r.kernel).stagedNothing).toBe(false)
  })

  it("is deterministic: the same script and clock produce the same journal", async () => {
    const script = [
      step({ plan: P2, worst: 10, best: 90 }),
      step({ plan: P3, worst: 40, best: 60 }),
      step({ plan: P3, worst: 50, best: 51 }),
    ]
    const run = async (): Promise<string> => {
      const r = rig(script)
      const out = await collect(r.kernel.decide(r.input()))
      return JSON.stringify(out.map((rec) => [planKey(rec.plan), rec.lo, rec.hi, rec.epoch]))
    }
    expect(await run()).toBe(await run())
  })

  it("never touches the parts of the substrate it has no business touching", async () => {
    const r = rig([step({ plan: P2, worst: 10, best: 90 })])
    await collect(r.kernel.decide(r.input()))
    expect(r.sub.resolveCalls).toBe(0)
    expect(r.sub.entangledCalls).toBe(0)
    expect(() => r.gen.candidatesFor(r.sub, 1)).toThrow()
  })

  it("names the pin set on every record it emits", async () => {
    const pins: Pin[] = [{ unitId: 1, to: 3, tentative: false }]
    const r = rig([step({ plan: new Map([[1, cand(1, 3)]]), worst: 10, best: 20 })])
    const out = await collect(r.kernel.decide(r.input({ initialPins: pins })))
    for (const rec of out) {
      expect(rec.assumptions).toContainEqual({ kind: "operator-pin", unitId: 1, to: 3 })
      expect(rec.assumptions.filter((a) => a.kind === "posture")).toHaveLength(1)
    }
  })
})

// ===========================================================================

describe("FOGGED-VACUOUS on the wire", () => {
  const cloudDead = [ledgerEntry(9)]

  it("keeps improving the staged set on the gradient when the floor cannot move", async () => {
    // Every candidate sits on the cliff for cloud-contingent reasons, so a
    // floor ratchet would freeze the wire at whatever was staged when the
    // posture flipped. The leading channel ratchets instead — and lo keeps its
    // own basis-scoped floor underneath, so the promise never weakens.
    const ests = new Map<string, number>([
      [planKey(P1), -900],
      [planKey(P2), -500],
      [planKey(P3), -100],
    ])
    const r = rig(
      [
        step({ plan: P1, worst: -1000, best: 40, ledger: cloudDead }),
        step({ plan: P2, worst: -1000, best: 35, ledger: cloudDead }),
        step({ plan: P3, worst: -1000, best: 30, ledger: cloudDead }),
      ],
      { switchMargin: 1, deadBelow: CLIFF },
      {
        baseline: P1,
        evaluator: new StubEvaluator((p: JointPlan) => ({
          lo: -1000,
          est: ests.get(planKey(p)) ?? -1000,
          hi: 40,
        })),
      },
    )
    const frames: LensEvent[] = []
    const out = await collect(r.kernel.decide(r.input({ lens: framesOf(frames) })))
    const flips = frames.filter(
      (e) => e.kind === "posture",
    ) as ReadonlyArray<Extract<LensEvent, { kind: "posture" }>>
    expect(flips.map((f) => f.to)).toContain("FOGGED-VACUOUS")
    const vacuous = out.filter((rec) => rec.posture === "FOGGED-VACUOUS")
    expect(vacuous.length).toBeGreaterThan(1)
    // The staged plan moved along the gradient…
    expect(planKey(vacuous[vacuous.length - 1].plan)).toBe(planKey(P3))
    // …monotonically in est, and never at the cost of the floor.
    const channel = vacuous.map((rec) => rec.est)
    expect(channel).toEqual([...channel].sort((a, b) => a - b))
    for (const rec of vacuous) expect(rec.lo).toBe(-1000)
    // The basis that led with est is on the timeline as having done so — and
    // the flip that opened it left a basis that led with lo, which is the pair
    // the ratchet must never compare across.
    expect(flips.some((f) => f.channel === "est")).toBe(true)
    expect(flips.some((f) => channelPolicyFor(f.from).orderBy === "lo")).toBe(true)
  })
})

describe("the ratchet's basis carries the horizon coordinate (06 F-8)", () => {
  const cloudDead = [ledgerEntry(9)]

  it("ends the est basis where the horizon changes, instead of reading a retraction", async () => {
    // Under FOGGED-VACUOUS the ratcheted value IS the clamped est, and est is a
    // summary AT a horizon. Here the deeper reading's est is LOWER than the
    // shallow one the basis is standing on — which is not a retraction, it is
    // an answer to a different question — so the basis ends and the deeper
    // reading takes the wire. Without the coordinate the gate reads it as a
    // broken refinement lattice and refuses it forever.
    const ests = new Map<string, number>([
      [planKey(P1), -900],
      [planKey(P2), -500],
      [planKey(P3), -700],
    ])
    const r = rig(
      [
        step({ plan: P1, worst: -1000, best: 40, ledger: cloudDead, horizon: 1 }),
        step({ plan: P2, worst: -1000, best: 35, ledger: cloudDead, horizon: 1 }),
        step({ plan: P3, worst: -1000, best: 30, ledger: cloudDead, horizon: 2 }),
      ],
      { switchMargin: 1, deadBelow: CLIFF },
      {
        baseline: P1,
        evaluator: new StubEvaluator((p: JointPlan) => ({
          lo: -1000,
          est: ests.get(planKey(p)) ?? -1000,
          hi: 40,
        })),
      }
    )
    const out = await collect(r.kernel.decide(r.input()))
    const vacuous = out.filter((rec) => rec.posture === "FOGGED-VACUOUS")
    expect(vacuous.length).toBeGreaterThan(1)
    const last = vacuous[vacuous.length - 1]
    expect(planKey(last.plan)).toBe(planKey(P3))
    expect(last.horizon).toBe(2)
    // It landed because the basis ended, not because the ratchet was waived:
    // nothing was refused as a retraction on the way.
    expect(reportOf(r.kernel).refusals["ratchet-floor"]).toBe(0)
    // And the floor never weakened — `lo` keeps its own basis-scoped floor
    // underneath whatever the leading channel does.
    for (const rec of vacuous) expect(rec.lo).toBe(-1000)
  })
})

// ===========================================================================

describe("humans always win", () => {
  it("refuses a plan that contradicts a committed pin, however good the search says it is", async () => {
    class RoguePlanner extends ScriptedSearchCore {
      improve(ctx: Parameters<ScriptedSearchCore["improve"]>[0]) {
        const s = super.improve(ctx)
        // Strip the operator's constraint back out — the failure mode this
        // gate exists for.
        const stripped = new Map(s.plan)
        stripped.set(2, cand(2, 8))
        return { ...s, plan: stripped }
      }
    }
    const clock = new FakeClock()
    const script = [step({ plan: P2, worst: 900, best: 901 })]
    const core = new RoguePlanner(clock, script, { baseline: P1, conformCostMs: 0.05 })
    const r = rig(script, {}, { core: () => core })
    const out = await collect(
      r.kernel.decide({ ...r.input(), initialPins: [{ unitId: 2, to: 77, tentative: false }] }),
    )
    expect(reportOf(r.kernel).refusals.nonconforming).toBeGreaterThan(0)
    for (const rec of out) expect(rec.plan.get(2)?.to).toBe(77)
  })
})

// ===========================================================================
// V4 / V1 / V3 REGRESSIONS
// ===========================================================================

describe("the operator's queue: arrival, survival, and the two frozen gates", () => {
  it("R7b: an event queued before the first next() is not thrown away", async () => {
    // `decide()` is an async iterable whose body does not run until the
    // consumer's first `next()`. Clearing the queue in the body discarded
    // every event that landed in that window — which is precisely the window
    // the team engine opens when it installs the live handle before the loop.
    const r = rig([step({ worst: 10, best: 50 })], {}, { budgetMs: 5 })
    const it = r.kernel.decide(r.input())
    r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
    const out = await collect(it)
    const rep = reportOf(r.kernel)
    expect(rep.epochs).toBe(2)
    expect(rep.conformance.length).toBeGreaterThanOrEqual(1)
    expect(out[out.length - 1].plan.get(2)?.to).toBe(77)
  })

  it("R2: conformance latency is measured from ARRIVAL, not from the dequeue", async () => {
    const r = rig([step({ worst: 10, best: 50, costMs: 3 })], {}, { budgetMs: 40 })
    const it = r.kernel.decide(r.input())
    // The event arrives before the run exists: it is measured from the
    // decision's own start, which is the earliest honest reading there is.
    r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
    // The rung-0 conform charges 0.05 ms and the first slice charges 3 ms, so
    // a latency measured from the DEQUEUE would be ~0.
    await collect(it)
    const sample = reportOf(r.kernel).conformance[0]
    expect(sample).toBeDefined()
    expect(sample?.latencyMs).toBeGreaterThan(0)
  })

  it("R7a: a commit for a unit with no staged move and no pin still freezes it", async () => {
    // The kernel's committedUnits set and the wire ledger's committed set are
    // the two humans-always-win gates, and they have to agree. A commit whose
    // destination this kernel cannot name used to be dropped whole: the ledger
    // froze the unit, the kernel did not, and a later pin could move it.
    const r = rig([step({ worst: 10, best: 50 })], {}, { budgetMs: 5 })
    const it = r.kernel.decide(r.input())
    r.kernel.onPinEvent({ kind: "commit", unitId: 99 }) // no staged move, no pin
    await collect(it)
    expect(reportOf(r.kernel).committedUnits).toContain(99)
  })

  it("a commit freezes the unit against every later pin", async () => {
    const r = rig([step({ worst: 10, best: 50 })], {}, { budgetMs: 20 })
    const it = r.kernel.decide(r.input())
    r.kernel.onPinEvent({ kind: "commit", unitId: 99 })
    r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 99, to: 3, tentative: false } })
    const out = await collect(it)
    for (const rec of out) {
      expect(rec.assumptions).not.toContainEqual({ kind: "operator-pin", unitId: 99, to: 3 })
    }
  })

  it("V1-BUG-3: no write lands after an event queued during the same slice", async () => {
    // Events are drained at the top of the NEXT iteration, but the iteration
    // that queued them used to run its emit gates first — one wire write, one
    // slice late, contradicting the operator.
    const clock = new FakeClock()
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0, yieldIntervalMs: 0 })
    const sub = new StubSubstrate()
    const gen = new StubGenerator()
    const evaluator = new StubEvaluator(() => RUNG0)
    let armed = false
    const core = new (class extends ScriptedSearchCore {
      improve(ctx: Parameters<ScriptedSearchCore["improve"]>[0]) {
        const out = super.improve(ctx)
        if (!armed) {
          armed = true
          // The operator pins DURING the slice.
          kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
        }
        return out
      }
    })(clock, [step({ plan: P2, worst: 900, best: 901, costMs: 0.5 })], { baseline: P1 })
    const out = await collect(
      kernel.decide({
        sub,
        gen,
        evaluate: evaluator,
        search: core,
        asTeam: 0,
        deadlineMs: clock.value + 10,
        initialPins: [],
        now: clock.now,
        initialStepCostMs: 0.05,
      }),
    )
    // Rung 0 is before the event; everything after it honours the pin.
    const afterRung0 = out.slice(1)
    expect(afterRung0.length).toBeGreaterThan(0)
    for (const rec of afterRung0) expect(rec.plan.get(2)?.to).toBe(77)
  })
})

describe("the horizon field has one meaning (06 F-2, F-3)", () => {
  it("stamps the PLAN's horizon, not the slice's view", async () => {
    // The old `absorb` read `run.lastView?.horizon` — the view's leader's depth
    // — and wrote it onto every plan the slice happened to absorb, while
    // `deepen` names ONE plan. Here the view claims horizon 7 and the returned
    // reading claims nothing, so the honest answer is 1 and the leak is 7.
    const viewOf = (): LeverView => ({
      candidates: [],
      leaderIdx: -1,
      slack: 0,
      horizon: 7,
      depthMax: 1,
      units: [],
      interiorCells: 0,
      epsilon: 0,
      round: 0,
    })
    const script = [step({ plan: P2, worst: 10, best: 20 })]
    const r = rig(
      script,
      {},
      { core: (c) => new ScriptedRefinerCore(c, script, viewOf, { baseline: P1 }) }
    )
    const out = await collect(r.kernel.decide(r.input()))
    expect(reportOf(r.kernel).leverOrderBinding).toBe(true)
    expect(out.every((rec) => rec.horizon === 1)).toBe(true)
  })

  it("reports the STAGED row's horizon, not the table's shallowest", async () => {
    // `stageAndGate` used to pass `min over rows` while the forced path passed
    // the staged row's own, so one field meant two things on two paths into it.
    // The table here is shallowest at 1 and the row that reaches the wire was
    // proved at 3; the emission is about the plan on the wire.
    const r = rig([
      step({ plan: P2, worst: 1, best: 9, horizon: 1 }),
      step({ plan: P3, worst: 5, best: 6, horizon: 3 }),
    ])
    const out = await collect(r.kernel.decide(r.input()))
    const last = out[out.length - 1]
    expect(planKey(last.plan)).toBe(planKey(P3))
    expect(last.horizon).toBe(3)
    // The shallow rival is still in the table — this is not "the table went
    // deep", it is "the staged row did".
    expect(out.some((rec) => rec.horizon === 1)).toBe(true)
  })
})

describe("root slack is a rival quantity (06 F-9)", () => {
  it("reports max_R(R.hi − L.lo) from `run.plans`, with no lever surface at all", async () => {
    // THE RIVAL SET WAS NEVER MISSING. `rows()` builds its table from
    // `run.plans` whether or not a refiner exists, so the rivals are in hand on
    // every decision; the old guard asked `run.lastView !== null`, which has
    // never been true in production, and the field silently degraded to the
    // leader's own bound gap — a different quantity wearing the same name.
    const wide = new StubEvaluator(() => ({ lo: -2, est: 0, hi: 0 }))
    const r = rig(
      [
        step({ plan: P2, worst: 1, best: 9 }), // the loose rival nobody refuted
        step({ plan: P3, worst: 5, best: 6 }), // the leader, on a tight bracket
      ],
      {},
      { evaluator: wide }
    )
    const out = await collect(r.kernel.decide(r.input()))
    // No refiner: the lever order was advisory, and slack is real regardless.
    expect(reportOf(r.kernel).leverOrderBinding).toBe(false)
    const last = out[out.length - 1]
    expect(planKey(last.plan)).toBe(planKey(P3))
    // P2's ceiling is 9 and the leader's floor is 5: four points of the
    // decision are still open. The leader's own gap is 1, and reporting that
    // would say the decision is nearly settled when it is not.
    expect(last.slack).toBe(4)
    expect(last.hi - last.lo).toBe(1)
  })
})

describe("the record says what the gate used", () => {
  it("R6: est on the record is the gate's est, clamped into its own bracket", async () => {
    const r = rig([step({ worst: 10, best: 50 })], {}, {
      evaluator: new StubEvaluator(() => ({ lo: -990, est: 5000, hi: 990 })),
    })
    const out = await collect(r.kernel.decide(r.input()))
    for (const rec of out) {
      expect(rec.est).toBeGreaterThanOrEqual(rec.lo)
      expect(rec.est).toBeLessThanOrEqual(rec.hi)
    }
  })
})

describe("crossfade prices the torn interleaving, not two coherent plans", () => {
  const A = 1
  const B = 2
  // A and B influence a shared cell, so the gate is engaged.
  const influence = new Map<number, ReadonlySet<number>>([
    [A, new Set([9, 12])],
    [B, new Set([9, 12])],
  ])

  it("B4: a coordinated pair torn across two chunks is priced and blocked", async () => {
    // Pair repair moves A into the cell B is vacating. Both units are in the
    // delta, so the old certificate — which EXCLUDED every changed unit from
    // both sums — could not see the collision between new-A and old-B at all.
    const seen: Array<{ plan: JointPlan; excluding: number }> = []
    const r = rig(
      [step({ plan: P3, worst: 20, best: 60 }), step({ plan: P3, worst: 20, best: 60 })],
      {
        minWriteIntervalMs: 0,
        crossfade: "teammate",
        // Each unit is its own chunk: the wire can hold new-A with old-B.
        crossfadeGroups: () => [[A], [B]],
        teammateFloor: (p, excluding) => {
          seen.push({ plan: p, excluding: excluding.size })
          const a = p.get(A)?.to
          const b = p.get(B)?.to
          // The torn state: A on 6 while B still holds 8 — a collision the
          // two coherent plans never contain.
          return a === 6 && b === 8 ? -100 : 0
        },
      },
      { influence, budgetMs: 20 },
    )
    const out = await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    // The gate priced whole mixed plans (nothing excluded), and refused.
    expect(seen.some((s) => s.excluding === 0)).toBe(true)
    expect(rep.crossfade.blocked).toBeGreaterThan(0)
    for (const rec of out) expect(planKey(rec.plan)).not.toBe(planKey(P3))
  })

  it("with no chunk partition a pass is uncertified, never certified", async () => {
    const r = rig(
      [step({ plan: P4, worst: 20, best: 60 })],
      {
        minWriteIntervalMs: 0,
        crossfade: "teammate",
        teammateFloor: () => 0,
      },
      { influence, budgetMs: 20 },
    )
    await collect(r.kernel.decide(r.input()))
    const rep = reportOf(r.kernel)
    expect(rep.crossfade.certified).toBe(0)
    expect(rep.crossfade.uncertified).toBeGreaterThan(0)
  })

  it("V3-R5: a forced re-stage is never starved, and says it went uncertified", async () => {
    const r = rig(
      [step({ plan: P4, worst: 20, best: 60 })],
      {
        minWriteIntervalMs: 0,
        crossfade: "teammate",
        // Any plan honouring the pin prices worse than what the wire holds:
        // an adversarial certificate that refuses the operator's re-stage.
        teammateFloor: (p) => (p.get(2)?.to === 77 ? -1 : 0),
      },
      { influence, budgetMs: 20 },
    )
    const it = r.kernel.decide(r.input())
    r.kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
    const out = await collect(it)
    const rep = reportOf(r.kernel)
    // The operator's re-stage reached the wire anyway…
    expect(rep.epochs).toBe(2)
    expect(out.some((rec) => rec.epoch === 1 && rec.plan.get(2)?.to === 77)).toBe(true)
    // …and the record says the certificate would have refused it.
    expect(rep.crossfade.forcedUncertified).toBeGreaterThan(0)
    expect(out.some((rec) => rec.crossfade === "forced-uncertified")).toBe(true)
    expect(rep.stagedNothing).toBe(false)
  })
})

describe("the decision hands the process back (V3-R2)", () => {
  it("yielding is the DEFAULT, not an opt-in", () => {
    // A decision that holds the loop makes the whole mid-decision constraint
    // machinery unreachable from a Firestore listener, collapses every staged
    // revision into one post-decision burst, and starves the other games in
    // the process. Off is a harness setting, never a production one.
    expect(DEFAULT_KERNEL_OPTIONS.yieldIntervalMs).toBeGreaterThan(0)
  })

  it("a macrotask armed before the decision fires DURING it", async () => {
    let firedDuring = false
    let decisionDone = false
    const r = rig([step({ worst: 10, best: 50, costMs: 0 })], {}, {})
    // A real decision on the wall clock, driven by a real deadline.
    const started = Date.now()
    const input: KernelInput = {
      ...r.input(),
      now: () => Date.now(),
      deadlineMs: started + 60,
    }
    setTimeout(() => {
      firedDuring = !decisionDone
    }, 10)
    await collect(r.kernel.decide(input))
    decisionDone = true
    expect(firedDuring).toBe(true)
    expect(reportOf(r.kernel).yields).toBeGreaterThan(0)
  })

  it("an event delivered by a macrotask opens an epoch mid-decision", async () => {
    const r = rig([step({ worst: 10, best: 50, costMs: 0 })], {}, {})
    const started = Date.now()
    const kernel = r.kernel
    setTimeout(() => {
      kernel.onPinEvent({ kind: "pin", pin: { unitId: 2, to: 77, tentative: false } })
    }, 15)
    const out = await collect(
      kernel.decide({ ...r.input(), now: () => Date.now(), deadlineMs: started + 80 }),
    )
    expect(reportOf(kernel).epochs).toBe(2)
    expect(out[out.length - 1].plan.get(2)?.to).toBe(77)
  })
})

describe("an early-resolved turn is abandoned (V3-R4)", () => {
  it("stops at the next slice boundary and writes nothing more", async () => {
    let over = false
    const r = rig([step({ plan: P2, worst: 900, best: 901 })], { minWriteIntervalMs: 0 }, {
      budgetMs: 100,
    })
    const it = r.kernel.decide({ ...r.input(), abandoned: () => over })
    const seen: EmitRecord[] = []
    for await (const rec of it) {
      seen.push(rec)
      over = true // the turn resolved under us, right after rung 0
    }
    const rep = reportOf(r.kernel)
    expect(rep.abandoned).toBe(true)
    // Rung 0 only: nothing after the abandonment, and no final flush.
    expect(seen).toHaveLength(1)
    expect(rep.stagedNothing).toBe(false)
    expect(rep.elapsedMs).toBeLessThan(rep.budgetMs)
  })
})

describe("speculative contexts search the pin they are named for (V1-BUG-4)", () => {
  it("the tentative pin is BINDING inside its own context, and never leaks out", async () => {
    const seen: Array<ReadonlyArray<Pin>> = []
    const clock = new FakeClock()
    const sub = new StubSubstrate()
    const gen = new StubGenerator()
    const core = new (class extends ScriptedSearchCore {
      improve(ctx: Parameters<ScriptedSearchCore["improve"]>[0]) {
        seen.push(ctx.pins.map((p) => ({ ...p })))
        return super.improve(ctx)
      }
    })(clock, [step({ worst: 10, best: 50 })], { baseline: P1 })
    const kernel = new LobsterKernel({
      minWriteIntervalMs: 0,
      speculativePeriod: 2,
      yieldIntervalMs: 0,
    })
    const out = await collect(
      kernel.decide({
        sub,
        gen,
        evaluate: new StubEvaluator(() => RUNG0),
        search: core,
        asTeam: 0,
        deadlineMs: clock.value + 5,
        initialPins: [{ unitId: 2, to: 77, tentative: true }],
        now: clock.now,
        initialStepCostMs: 0.05,
      }),
    )
    // Some context searched the hovered pin as a real constraint…
    const speculativeCalls = seen.filter((pins) => pins.some((p) => p.unitId === 2 && p.to === 77))
    expect(speculativeCalls.length).toBeGreaterThan(0)
    for (const pins of speculativeCalls) {
      for (const p of pins) if (p.unitId === 2) expect(p.tentative).toBe(false)
    }
    // …and the report still names it as the tentative context it is.
    const spec = reportOf(kernel).speculative
    expect(spec.length).toBeGreaterThan(0)
    expect(spec.some((s) => s.key.includes("2@77?"))).toBe(true)
    // A tentative pin never becomes an operator-pin on a staged record.
    for (const rec of out) {
      expect(rec.assumptions).not.toContainEqual({ kind: "operator-pin", unitId: 2, to: 77 })
    }
  })
})

describe("a refused pin is a narrowing and NOT an operator-pin claim (V1-BUG-2)", () => {
  it("the record carries the refusal, never the claim it refutes", async () => {
    const sub = new StubSubstrate()
    sub.setReachable(2, [8]) // 77 is not reachable
    const clock = new FakeClock()
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0, yieldIntervalMs: 0 })
    const core = new ScriptedSearchCore(clock, [step({ worst: 10, best: 50 })], { baseline: P1 })
    const out = await collect(
      kernel.decide({
        sub,
        gen: new StubGenerator(),
        evaluate: new StubEvaluator(() => RUNG0),
        search: core,
        asTeam: 0,
        deadlineMs: clock.value + 5,
        initialPins: [{ unitId: 2, to: 77, tentative: false }],
        now: clock.now,
        initialStepCostMs: 0.05,
      }),
    )
    expect(reportOf(kernel).refusals["pin-unreachable"]).toBe(1)
    for (const rec of out) {
      expect(rec.assumptions).not.toContainEqual({ kind: "operator-pin", unitId: 2, to: 77 })
      expect(
        rec.assumptions.some(
          (a) => a.kind === "narrowing" && a.unitId === 2 && a.note.includes("unreachable@77"),
        ),
      ).toBe(true)
    }
    // The search never saw the refused pin as a constraint either.
    for (const snapshot of core.improveLog) {
      expect(snapshot.pins.some((p) => p.unitId === 2 && p.to === 77)).toBe(false)
    }
  })
})

describe("nothing commandable is free (V1-OBS-3)", () => {
  it("the budget is not spent re-pricing a fully pinned incumbent", async () => {
    const sub = new StubSubstrate()
    sub.setRoster([1, 2])
    const clock = new FakeClock()
    const core = new ScriptedSearchCore(clock, [step({ worst: 10, best: 50, costMs: 0 })], {
      baseline: P1,
    })
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0, yieldIntervalMs: 0 })
    await collect(
      kernel.decide({
        sub,
        gen: new StubGenerator(),
        evaluate: new StubEvaluator(() => RUNG0),
        search: core,
        asTeam: 0,
        deadlineMs: clock.value + 20,
        initialPins: [
          { unitId: 1, to: 4, tentative: false },
          { unitId: 2, to: 8, tentative: false },
        ],
        now: clock.now,
        initialStepCostMs: 0.05,
      }),
    )
    const rep = reportOf(kernel)
    expect(rep.improveCalls).toBe(0)
    expect(rep.idleSlices).toBeGreaterThan(0)
    expect(rep.stagedNothing).toBe(false)
  })
})

describe("a slice is long enough to contain the work it starts (V2-BUG-4)", () => {
  it("grows with the measured slice cost, and never past the operator's bound", async () => {
    // At production team sizes one bank `price()` is most of a 25 ms slice, so
    // the loop priced a seed and stopped before it swept a second unit: 370
    // slices over ten seconds produced the identical bracket to 18 over one.
    // The slice is sized to what a slice has been measured to cost — bounded
    // by the longest an operator's pin may wait to be drained, because events
    // are taken between slices and never inside one.
    const lengths: number[] = []
    const clock = new FakeClock()
    // Each slice charges 8 ms, well above the 1 ms floor.
    const core = new ScriptedSearchCore(clock, [step({ worst: 10, best: 50, costMs: 8 })], {
      baseline: P1,
    })
    const kernel = new LobsterKernel({
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
      sliceMs: 1,
      sliceCostFactor: 5,
      maxSliceFraction: 0.1,
      initialStepCostMs: 8,
    })
    const sub = new StubSubstrate()
    let last = clock.value
    const budget = new StubEvaluator(() => RUNG0)
    const wrapped: typeof core = Object.create(core) as typeof core
    wrapped.improve = (ctx) => {
      lengths.push(ctx.budget.remainingMs())
      last = clock.value
      return core.improve(ctx)
    }
    await collect(
      kernel.decide({
        sub,
        gen: new StubGenerator(),
        evaluate: budget,
        search: wrapped,
        asTeam: 0,
        deadlineMs: clock.value + 1000,
        initialPins: [],
        now: clock.now,
        initialStepCostMs: 8,
      }),
    )
    expect(last).toBeGreaterThan(0)
    expect(lengths.length).toBeGreaterThan(0)
    // 5 x 8 ms of measured cost, and the 100 ms operator bound on a 1 s turn.
    for (const remaining of lengths) {
      expect(remaining).toBeGreaterThanOrEqual(8)
      expect(remaining).toBeLessThanOrEqual(100)
    }
    expect(Math.max(...lengths)).toBeGreaterThan(1)
  })
})
