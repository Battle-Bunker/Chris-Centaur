/**
 * The VOC refinement orchestrator: corrected lever order, two currencies with
 * no exchange rate, sticky staging, and the tie-vacuity join directions.
 */

import { channelPolicyFor } from "../lobster/postures"
import {
  DEFAULT_SWITCH_MARGIN,
  StickyStager,
  VocOrchestrator,
  asRefiner,
  bestJoin,
  candidateKey,
  compareConfidence,
  demandOf,
  pickLeader,
  planKey,
  rootSlack,
  stagingRowOf,
  worstJoin,
  type CandidateView,
  type HeldUnitView,
  type Lever,
  type LeverView,
  type NodeVerdict,
  type StagingCandidate,
} from "../lobster/voc"
import { bounds, cand, ledgerEntry, plan, score } from "./lobster-harness"

const SIGHTED = channelPolicyFor("SIGHTED")

/** These suites script a FINITE cliff (the orchestration workspace's value);
 * the production default is the system DEAD (−∞), pinned in the postures
 * suite. Passed explicitly wherever a scripted −1000 must read as the cliff. */
const CLIFF = -1000
const FOGGED = channelPolicyFor("FOGGED-DISCRIMINATING")
const VACUOUS = channelPolicyFor("FOGGED-VACUOUS")

const row = (over: Partial<StagingCandidate> & { key: string }): StagingCandidate => ({
  lo: 0,
  est: 0,
  hi: 0,
  horizon: 1,
  vacuity: "alive",
  ...over,
})

const verdict = (over: Partial<NodeVerdict> = {}): NodeVerdict => ({
  lo: 0,
  hi: 0,
  loCite: new Set<number>(),
  hiCite: new Set<number>(),
  loVacuous: false,
  ...over,
})

// ---------------------------------------------------------------------------

describe("plan identity", () => {
  it("is order-independent and path-sensitive", () => {
    const a = new Map([
      [1, cand(1, 5)],
      [2, cand(2, 9)],
    ])
    const b = new Map([
      [2, cand(2, 9)],
      [1, cand(1, 5)],
    ])
    expect(planKey(a)).toBe(planKey(b))
    const viaRay = new Map([
      [1, cand(1, 5, [3, 4, 5])],
      [2, cand(2, 9)],
    ])
    // Prefixes matter — capture-stops and exhaustion halt mid-ray, so two
    // plans agreeing on destinations but not on route are different plans.
    expect(planKey(viaRay)).not.toBe(planKey(a))
    expect(candidateKey(cand(1, 5, [3, 4, 5]))).toBe("1>5:3.4.5")
  })
})

describe("two currencies with no exchange rate", () => {
  it("orders deeper-and-tighter, and refuses to order deeper-but-looser", () => {
    expect(compareConfidence({ horizon: 2, slack: 0 }, { horizon: 1, slack: 5 })).toBe("better")
    expect(compareConfidence({ horizon: 1, slack: 5 }, { horizon: 2, slack: 0 })).toBe("worse")
    expect(compareConfidence({ horizon: 1, slack: 3 }, { horizon: 1, slack: 3 })).toBe("equal")
    // The whole point: a deepen may honestly reopen a decided decision. There
    // is no rate at which horizon converts into slack, in either direction.
    expect(compareConfidence({ horizon: 2, slack: 5 }, { horizon: 1, slack: 0 })).toBe(
      "incomparable",
    )
    expect(compareConfidence({ horizon: 1, slack: 0 }, { horizon: 2, slack: 5 })).toBe(
      "incomparable",
    )
  })
})

describe("tie-vacuity join directions", () => {
  const vacuousDead = verdict({ lo: -1000, hi: 40, loVacuous: true, loCite: new Set([7]) })
  const materialDead = verdict({ lo: -1000, hi: -1000, loVacuous: false })

  it("ANDs at MIN nodes: the adversary picks the binding child", () => {
    const j = worstJoin(vacuousDead, materialDead)
    expect(j.lo).toBe(-1000)
    // One tied child is genuinely fatal, so the node's floor is NOT refinable.
    expect(j.loVacuous).toBe(false)
  })

  it("ORs at MAX nodes: any refinable tied child keeps the demand alive", () => {
    const j = bestJoin(vacuousDead, materialDead)
    expect(j.lo).toBe(-1000)
    expect(j.loVacuous).toBe(true)
    // The INVERSION, spelled out: AND at a MAX node reports false here, which
    // is exactly how a cloud-contingent DEAD got laundered into a material one
    // whenever a genuinely-fatal sibling tied it — disabling the sticky-staging
    // protections at the all-dark moments they exist for.
    const inverted = vacuousDead.loVacuous && materialDead.loVacuous
    expect(inverted).toBe(false)
    expect(j.loVacuous).not.toBe(inverted)
  })

  it("takes the strictly-binding child's vacuity and citations, not a join, when untied", () => {
    const low = verdict({ lo: -1000, hi: 10, loVacuous: true, loCite: new Set([7]) })
    const high = verdict({ lo: 30, hi: 60, loVacuous: false, loCite: new Set([9]) })
    const min = worstJoin(low, high)
    expect(min.lo).toBe(-1000)
    expect(min.loVacuous).toBe(true)
    expect([...min.loCite]).toEqual([7])
    const max = bestJoin(low, high)
    expect(max.lo).toBe(30)
    expect(max.loVacuous).toBe(false)
    expect([...max.loCite]).toEqual([9])
  })

  it("keeps each bound its own game at both node kinds", () => {
    const a = verdict({ lo: 10, hi: 90 })
    const b = verdict({ lo: 20, hi: 50 })
    expect(worstJoin(a, b)).toMatchObject({ lo: 10, hi: 50 })
    expect(bestJoin(a, b)).toMatchObject({ lo: 20, hi: 90 })
  })
})

describe("leader selection", () => {
  it("never lets a vacuous floor WIN while a living candidate exists", () => {
    const rows = [
      row({ key: "vac", lo: -1000, hi: 900, vacuity: "cloud-contingent-dead" }),
      row({ key: "live", lo: 5, hi: 20 }),
    ]
    expect(rows[pickLeader(rows, SIGHTED)].key).toBe("live")
  })

  it("falls back to optimism when everything is dead, and never picks the vetoed first", () => {
    const rows = [
      row({ key: "mat", lo: -1000, hi: -1000, vacuity: "material-dead" }),
      row({ key: "vac", lo: -1000, hi: 40, vacuity: "cloud-contingent-dead" }),
    ]
    expect(rows[pickLeader(rows, SIGHTED)].key).toBe("vac")
  })

  it("under FOGGED-VACUOUS orders by est over the set lo admitted", () => {
    const rows = [
      row({ key: "a", lo: -1000, est: 3, hi: 10, vacuity: "cloud-contingent-dead" }),
      row({ key: "b", lo: -1000, est: 40, hi: 8, vacuity: "cloud-contingent-dead" }),
      // Certain material death: lo's veto removes it however good its est is.
      row({ key: "dead", lo: -1000, est: 999, hi: -1000, vacuity: "material-dead" }),
    ]
    expect(rows[pickLeader(rows, VACUOUS)].key).toBe("b")
  })

  it("never orders on est across a horizon (06 F-4)", () => {
    const ccd = "cloud-contingent-dead" as const
    // FOGGED-VACUOUS: est is the PRIMARY key, which is exactly the posture
    // where the missing guard mattered most — the one channel depth cannot
    // back up soundly is the one channel that adjudicates there.
    const vacuous = [
      row({ key: "shallow", lo: CLIFF, est: 40, hi: 8, horizon: 1, vacuity: ccd }),
      row({ key: "deep", lo: CLIFF, est: 3, hi: 10, horizon: 2, vacuity: ccd }),
    ]
    expect(vacuous[pickLeader(vacuous, VACUOUS)].key).toBe("deep")
    // SIGHTED: est is the tie-break under a floor tie, and the horizon sits
    // immediately above it, so the tie falls to the better-informed reading
    // rather than to a comparison no fold declares a discount for.
    const sighted = [
      row({ key: "shallow", lo: 10, est: 40, hi: 30, horizon: 1 }),
      row({ key: "deep", lo: 10, est: 3, hi: 30, horizon: 2 }),
    ]
    expect(sighted[pickLeader(sighted, SIGHTED)].key).toBe("deep")
    // And within ONE horizon est still orders, which is the whole of its job.
    const level = [
      row({ key: "low", lo: 10, est: 3, hi: 30, horizon: 2 }),
      row({ key: "high", lo: 10, est: 40, hi: 30, horizon: 2 }),
    ]
    expect(level[pickLeader(level, SIGHTED)].key).toBe("high")
  })

  it("computes root slack as a RIVAL quantity, not a bound gap", () => {
    const rows = [row({ key: "L", lo: 10, hi: 90 }), row({ key: "R", lo: 0, hi: 25 })]
    expect(rootSlack(rows, 0)).toBe(15) // 25 − 10, not 90 − 10
    expect(rootSlack([rows[0]], 0)).toBe(0)
  })
})

describe("sticky staging (F1/F2 and the dead-dethroned-by-the-living rule)", () => {
  it("stages the leader on the first round", () => {
    const s = new StickyStager()
    const d = s.stage([row({ key: "a", lo: 1 }), row({ key: "b", lo: 9 })], SIGHTED)
    expect(d.staged.key).toBe("b")
    expect(d.reason).toBe("initial")
  })

  it("refuses a sub-margin lo improvement and accepts a super-margin one", () => {
    const s = new StickyStager()
    s.stage([row({ key: "a", lo: 10 })], SIGHTED)
    const small = s.stage([row({ key: "a", lo: 10 }), row({ key: "b", lo: 10 + DEFAULT_SWITCH_MARGIN })], SIGHTED)
    expect(small.staged.key).toBe("a")
    expect(small.switched).toBe(false)
    const big = s.stage([row({ key: "a", lo: 10 }), row({ key: "b", lo: 10 + DEFAULT_SWITCH_MARGIN + 1 })], SIGHTED)
    expect(big.staged.key).toBe("b")
    expect(big.reason).toBe("improved")
  })

  it("takes a strictly better PROVED floor however shallow it was proved (06 F-5)", () => {
    // A floor is a floor whatever proved it — `compareFloors` reads `worst` and
    // nothing else — so this arm's inherited `leader.horizon >= incumbent.horizon`
    // was refusing a proof in favour of a worse one that happened to be
    // better-informed. The guard's stated motivation is an est-channel
    // phenomenon and it stays on the est arm, where it is required.
    const s = new StickyStager()
    s.stage([row({ key: "a", lo: 10, horizon: 2 })], SIGHTED)
    const d = s.stage(
      [row({ key: "a", lo: 10, horizon: 2 }), row({ key: "b", lo: 900, horizon: 1 })],
      SIGHTED,
    )
    expect(d.staged.key).toBe("b")
    expect(d.reason).toBe("improved")
  })

  it("never lets est cross a horizon on the gradient arm (06 F-4, F-5)", () => {
    const ccd = "cloud-contingent-dead" as const
    const s = new StickyStager(1, CLIFF)
    s.stage([row({ key: "a", lo: CLIFF, est: 10, hi: 40, horizon: 2, vacuity: ccd })], VACUOUS)
    // A SHALLOWER reading with a hugely better est is not a better est: it is
    // an answer to another question, and no margin adjudicates between the two.
    const shallow = s.stage(
      [
        row({ key: "a", lo: CLIFF, est: 10, hi: 40, horizon: 2, vacuity: ccd }),
        row({ key: "b", lo: CLIFF, est: 900, hi: 40, horizon: 1, vacuity: ccd }),
      ],
      VACUOUS,
    )
    expect(shallow.staged.key).toBe("a")
    // A DEEPER one takes the stage on being deeper, margin or no margin —
    // deliberately, because the margin is a noise threshold WITHIN a horizon
    // and there is no noise question across one.
    const deep = s.stage(
      [
        row({ key: "a", lo: CLIFF, est: 10, hi: 40, horizon: 2, vacuity: ccd }),
        row({ key: "c", lo: CLIFF, est: 9, hi: 40, horizon: 3, vacuity: ccd }),
      ],
      VACUOUS,
    )
    expect(deep.staged.key).toBe("c")
  })

  it("keeps a cloud-contingent-DEAD incumbent staged while the demand is serviced", () => {
    const s = new StickyStager()
    s.stage([row({ key: "a", lo: -1000, hi: 50, vacuity: "cloud-contingent-dead" })], SIGHTED)
    const d = s.stage(
      [
        row({ key: "a", lo: -1000, hi: 50, vacuity: "cloud-contingent-dead" }),
        row({ key: "b", lo: 40, hi: 45 }),
      ],
      FOGGED,
    )
    // Switching away from a vacuous incumbent to a shallower-informed rival is
    // preferring ignorance: undefined is not zero.
    expect(d.staged.key).toBe("a")
    expect(d.reason).toBe("sticky")
  })

  it("dethrones a materially dead incumbent only for a LIVING leader", () => {
    const s = new StickyStager()
    s.stage([row({ key: "a", lo: -1000, hi: -1000, vacuity: "material-dead" })], SIGHTED)
    // All dead: hi-order churn must not flip the staged key for nothing.
    const churn = s.stage(
      [
        row({ key: "a", lo: -1000, hi: -1000, vacuity: "material-dead" }),
        row({ key: "b", lo: -1000, hi: -900, vacuity: "material-dead" }),
      ],
      SIGHTED,
    )
    expect(churn.staged.key).toBe("a")
    const living = s.stage(
      [
        row({ key: "a", lo: -1000, hi: -1000, vacuity: "material-dead" }),
        row({ key: "b", lo: 3, hi: 8 }),
      ],
      SIGHTED,
    )
    expect(living.staged.key).toBe("b")
    expect(living.reason).toBe("collapse")
  })

  it("under FOGGED-VACUOUS lets the gradient dethrone a vacuous incumbent by the same margin", () => {
    const s = new StickyStager()
    const inc = row({ key: "a", lo: -1000, est: 10, hi: 5, vacuity: "cloud-contingent-dead" })
    s.stage([inc], VACUOUS)
    const near = s.stage(
      [inc, row({ key: "b", lo: -1000, est: 10 + DEFAULT_SWITCH_MARGIN, hi: 4, vacuity: "cloud-contingent-dead" })],
      VACUOUS,
    )
    expect(near.staged.key).toBe("a")
    const far = s.stage(
      [inc, row({ key: "b", lo: -1000, est: 10 + DEFAULT_SWITCH_MARGIN + 1, hi: 4, vacuity: "cloud-contingent-dead" })],
      VACUOUS,
    )
    expect(far.staged.key).toBe("b")
    expect(far.reason).toBe("gradient")
  })

  it("derives its rows from a scored plan, cliff included", () => {
    const p = plan([1, 4])
    const r = stagingRowOf(score(p, -1000, 60, { ledger: [ledgerEntry(9)] }), 12, 2, CLIFF)
    expect(r).toMatchObject({ key: planKey(p), lo: -1000, est: 12, hi: 60, horizon: 2 })
    expect(r.vacuity).toBe("cloud-contingent-dead")
  })
})

// ---------------------------------------------------------------------------

const unit = (over: Partial<HeldUnitView> & { unitId: number }): HeldUnitView => ({
  rung: "free",
  staleness: 0,
  cloudSize: 10,
  meet: 1,
  refinable: true,
  ...over,
})

const view = (over: Partial<LeverView> = {}): LeverView => {
  const candidates: CandidateView[] = over.candidates?.slice() ?? [
    {
      key: "L",
      plan: plan([1, 4]),
      lo: 10,
      est: 10,
      hi: 90,
      horizon: 1,
      vacuity: "alive",
      loCite: new Set([2, 3]),
      hiCite: new Set<number>(),
      refuted: false,
    },
    {
      key: "R",
      plan: plan([1, 5]),
      lo: 4,
      est: 6,
      hi: 80,
      horizon: 1,
      vacuity: "alive",
      loCite: new Set([3]),
      hiCite: new Set([2]),
      refuted: false,
    },
  ]
  return {
    candidates,
    leaderIdx: 0,
    slack: 70,
    horizon: 1,
    depthMax: 2,
    units: [unit({ unitId: 2 }), unit({ unitId: 3 })],
    interiorCells: 81,
    epsilon: 1.5,
    round: 0,
    ...over,
    ...(over.candidates ? { candidates: over.candidates } : {}),
  }
}

describe("the corrected lever order", () => {
  it("spends the first lever on catch-up: shared leverage, and it unlocks the rest", () => {
    const voc = new VocOrchestrator()
    const l = voc.next(view({ units: [unit({ unitId: 2, staleness: 3 }), unit({ unitId: 3 })] }), FOGGED)
    expect(l).toEqual({ kind: "catchup", unit: 2 })
  })

  it("takes the DEPTH PREVIEW as soon as the ply needs no more narrows", () => {
    const voc = new VocOrchestrator()
    // Nothing gated is still FREE, so the deadline veto has nothing to force:
    // the leader gets its depth preview before any multiplicative spend. This
    // is the §3.4 correction; the pre-correction order polished h=1 on
    // candidates that die at h=2 (one seed: 1000 regret until ~2600 work).
    const l = voc.next(
      view({ units: [unit({ unitId: 2, rung: "narrowed" }), unit({ unitId: 3, rung: "narrowed" })] }),
      FOGGED,
    )
    expect(l).toEqual({ kind: "deepen", planKey: "L", reason: "preview" })
  })

  it("runs the whole ladder in the corrected order on one board", () => {
    // A tiny state machine: apply each lever to the view and ask for the next.
    const voc = new VocOrchestrator()
    const state = {
      units: [
        unit({ unitId: 2, staleness: 2, meet: 1 }),
        unit({ unitId: 3, staleness: 0, meet: 2 }),
      ] as HeldUnitView[],
      horizons: { L: 1, R: 1 } as Record<string, number>,
    }
    const build = (): LeverView =>
      view({
        candidates: [
          { ...view().candidates[0], horizon: state.horizons.L },
          { ...view().candidates[1], horizon: state.horizons.R },
        ],
        horizon: Math.min(state.horizons.L, state.horizons.R),
        units: state.units,
      })
    const seen: string[] = []
    for (let i = 0; i < 8; i++) {
      const l = voc.next(build(), FOGGED)
      seen.push(l.kind)
      if (l.kind === "stop") break
      if (l.kind === "catchup") {
        state.units = state.units.map((u) => (u.unitId === l.unit ? { ...u, staleness: 0 } : u))
      } else if (l.kind === "narrow") {
        state.units = state.units.map((u) =>
          u.unitId === l.unit ? { ...u, rung: "narrowed" as const } : u,
        )
      } else if (l.kind === "advance") {
        state.units = state.units.map((u) =>
          u.unitId === l.unit ? { ...u, rung: "advanced" as const } : u,
        )
      } else if (l.kind === "deepen") {
        state.horizons[l.planKey] = Math.min(2, state.horizons[l.planKey] + 1)
      }
    }
    const first = (k: string): number => seen.indexOf(k)
    const last = (k: string): number => seen.lastIndexOf(k)
    // catch-up → narrow (deadline-veto-driven) → deepen → advance.
    expect(first("catchup")).toBe(0)
    expect(first("narrow")).toBeGreaterThan(first("catchup"))
    expect(first("deepen")).toBeGreaterThan(last("narrow"))
    // The one ordering the real-engine re-run corrected: no multiplicative
    // spend before the horizon is known.
    expect(first("advance")).toBeGreaterThan(first("deepen"))
  })

  it("lets the deadline veto force exactly the narrow the new ply needs", () => {
    const voc = new VocOrchestrator()
    // A FREE gated unit whose meeting time falls inside the branch about to be
    // deepened: narrow it first, or the new leaves arrive vacuous.
    const l = voc.next(
      view({
        candidates: [
          { ...view().candidates[0], horizon: 2 },
          { ...view().candidates[1], horizon: 1 },
        ],
        horizon: 1,
        // Stable at this horizon: the attribution branch has nothing to add,
        // so the ration takes over and the veto is what speaks.
        slack: 0,
        units: [unit({ unitId: 2, meet: 1 }), unit({ unitId: 3, meet: 2 })],
      }),
      FOGGED,
    )
    // The leader is already at depthMax, so the ration moves to the rival —
    // and the veto fires before the ply is bought, on the EARLIEST-meeting
    // free unit, not the most-cited one.
    expect(l).toEqual({ kind: "narrow", unit: 2 })
  })

  it("leaves a unit past the gate alone: holding it is free and exact", () => {
    const voc = new VocOrchestrator()
    const l = voc.next(
      view({
        candidates: [{ ...view().candidates[0], horizon: 1, loCite: new Set<number>() }],
        leaderIdx: 0,
        units: [unit({ unitId: 9, meet: Number.POSITIVE_INFINITY })],
      }),
      FOGGED,
    )
    expect(l).toEqual({ kind: "deepen", planKey: "L", reason: "preview" })
  })

  it("advances only after the horizon is known, and prices the recurrence in", () => {
    const voc = new VocOrchestrator()
    const advanced = view({
      candidates: [
        { ...view().candidates[0], horizon: 2 },
        { ...view().candidates[1], horizon: 2, refuted: true },
      ],
      horizon: 2,
      units: [unit({ unitId: 2, rung: "narrowed" }), unit({ unitId: 3, rung: "narrowed" })],
    })
    const l = voc.next(advanced, FOGGED)
    expect(l.kind).toBe("advance")
  })

  it("never buys depth with a Δslack comparison — the ration is stability, not value", () => {
    const voc = new VocOrchestrator()
    // Huge slack and no refinement lever left. A pure Δslack/cost policy would
    // sit at h=1 polishing bounds (deepening under clouds forecasts negative
    // Δslack — the horizon-starvation failure); the ration deepens anyway.
    const l = voc.next(view({ slack: 10_000, units: [] }), FOGGED)
    expect(l.kind).toBe("deepen")
  })

  it("under FOGGED-VACUOUS strikes out the slack-buying levers", () => {
    const voc = new VocOrchestrator()
    const seen: Lever[] = []
    let v = view({
      candidates: [
        { ...view().candidates[0], horizon: 2, lo: -1000, vacuity: "cloud-contingent-dead" },
        { ...view().candidates[1], horizon: 2, lo: -1000, vacuity: "cloud-contingent-dead" },
      ],
      horizon: 2,
    })
    for (let i = 0; i < 6; i++) seen.push(voc.next(v, VACUOUS))
    expect(seen.every((l) => l.kind !== "narrow" && l.kind !== "advance")).toBe(true)
    // A catch-up is the one lever that can still make the demand serviceable
    // and end the posture, so it stays available.
    v = view({ units: [unit({ unitId: 2, staleness: 2 })], horizon: 1 })
    expect(voc.next(v, VACUOUS)).toEqual({ kind: "catchup", unit: 2 })
  })

  it("stops when there is nothing left to buy", () => {
    const voc = new VocOrchestrator()
    const done = view({
      candidates: [{ ...view().candidates[0], horizon: 2, hi: 10 }],
      horizon: 2,
      slack: 0,
      units: [],
    })
    expect(voc.next(done, FOGGED)).toEqual({ kind: "stop" })
  })
})

describe("the demand a vacuous floor makes", () => {
  it("is serviceable when a cited unit is refinable, and not when none is", () => {
    const s = score(plan([1, 4]), -1000, 40, { ledger: [ledgerEntry(7)] })
    expect(demandOf(s, [unit({ unitId: 7, refinable: true })], CLIFF).serviceable).toBe(true)
    expect(demandOf(s, [unit({ unitId: 7, refinable: false })], CLIFF).serviceable).toBe(false)
    expect(demandOf(s, [unit({ unitId: 9, refinable: true })], CLIFF).serviceable).toBe(false)
  })

  it("is not a demand at all when the death is material", () => {
    const s = score(plan([1, 4]), -1000, -1000, { ledger: [ledgerEntry(7)] })
    expect(demandOf(s, [unit({ unitId: 7 })], CLIFF)).toMatchObject({
      cause: "material-dead",
      demand: false,
      serviceable: false,
    })
  })
})

describe("the refiner seam", () => {
  it("narrows only a core that actually exposes the lever surface", () => {
    expect(asRefiner(null)).toBeNull()
    expect(asRefiner({ improve: () => null, conform: () => null })).toBeNull()
    const full = { refinementView: () => null, refine: () => null }
    expect(asRefiner(full)).toBe(full)
  })
})

describe("bounds helper sanity (the discharge theorem in the stubs)", () => {
  it("marks a bound exact exactly when the ledger and assumptions are empty", () => {
    expect(bounds(1, 1).exact).toBe(true)
    expect(bounds(1, 1, { ledger: [ledgerEntry(1)] }).exact).toBe(false)
    expect(bounds(1, 1, { assumptions: [{ kind: "posture", posture: "SIGHTED" }] }).exact).toBe(
      false,
    )
  })
})
