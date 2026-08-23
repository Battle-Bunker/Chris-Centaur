/**
 * The posture governor: condition-keyed, never budget-keyed; est never
 * adjudicates; every flip is a named assumption.
 */

import type { Posture } from "../lobster/contracts"
import {
  DEFAULT_DEAD_BELOW,
  PostureGovernor,
  channelPolicyFor,
  classifyPosture,
  detectVacuity,
  postureAssumption,
  vetoed,
  type PostureConditions,
} from "../lobster/postures"
import { bounds, ledgerEntry } from "./lobster-harness"

const conditions = (over: Partial<PostureConditions> = {}): PostureConditions => ({
  holdsPresent: true,
  floorSeparates: true,
  claimsSaturated: false,
  residueDischargeable: true,
  allCandidatesCloudContingentDead: false,
  ...over,
})

describe("cause-tagged vacuity detection", () => {
  it("reads a floor above the cliff as alive", () => {
    const v = detectVacuity(bounds(10, 40, { ledger: [ledgerEntry(3)] }))
    expect(v.cause).toBe("alive")
    expect(v.demand).toBe(false)
  })

  it("reads DEAD-with-a-living-ceiling and an if_present citation as a DEMAND", () => {
    const v = detectVacuity(bounds(-1000, 40, { ledger: [ledgerEntry(3), ledgerEntry(7)] }))
    expect(v.cause).toBe("cloud-contingent-dead")
    expect(v.demand).toBe(true)
    expect([...v.citedUnits].sort()).toEqual([3, 7])
  })

  it("reads DEAD-in-the-optimistic-world-too as material — a verdict, not a demand", () => {
    const v = detectVacuity(bounds(-1000, -1000, { ledger: [ledgerEntry(3)] }))
    expect(v.cause).toBe("material-dead")
    expect(v.demand).toBe(false)
  })

  it("reads DEAD with nothing in the if_present ledger as material: no cloud is to blame", () => {
    const v = detectVacuity(bounds(-1000, 5, { ledger: [ledgerEntry(3, "if_absent")] }))
    expect(v.cause).toBe("material-dead")
  })

  it("takes the cliff from the caller, not from a constant of its own", () => {
    expect(detectVacuity(bounds(-40, 10), -30).cause).toBe("material-dead")
    expect(detectVacuity(bounds(-40, 10), -50).cause).toBe("alive")
    expect(DEFAULT_DEAD_BELOW).toBe(-1000)
  })
})

describe("posture classification", () => {
  it("SIGHTED when no hold is present", () => {
    expect(classifyPosture(conditions({ holdsPresent: false }))).toBe("SIGHTED")
    // …and even when everything else looks like fog: discharge dominates.
    expect(
      classifyPosture(
        conditions({
          holdsPresent: false,
          claimsSaturated: true,
          residueDischargeable: false,
          allCandidatesCloudContingentDead: true,
        }),
      ),
    ).toBe("SIGHTED")
  })

  it("FOGGED-DISCRIMINATING when holds are present and the floor still separates", () => {
    expect(classifyPosture(conditions())).toBe("FOGGED-DISCRIMINATING")
  })

  it("FOGGED-VACUOUS when every candidate's floor is cloud-contingent DEAD", () => {
    expect(classifyPosture(conditions({ allCandidatesCloudContingentDead: true }))).toBe(
      "FOGGED-VACUOUS",
    )
  })

  it("FOGGED-VACUOUS when the claims are saturated and the residue is undischargeable", () => {
    expect(
      classifyPosture(conditions({ claimsSaturated: true, residueDischargeable: false })),
    ).toBe("FOGGED-VACUOUS")
    // Saturated but still refinable is not vacuous: refinement can buy something.
    expect(
      classifyPosture(conditions({ claimsSaturated: true, residueDischargeable: true })),
    ).toBe("FOGGED-DISCRIMINATING")
  })

  it("keeps a flat-but-refinable floor in DISCRIMINATING and a flat-and-spent one in VACUOUS", () => {
    expect(
      classifyPosture(conditions({ floorSeparates: false, residueDischargeable: true })),
    ).toBe("FOGGED-DISCRIMINATING")
    expect(
      classifyPosture(conditions({ floorSeparates: false, residueDischargeable: false })),
    ).toBe("FOGGED-VACUOUS")
  })
})

describe("the governor is condition-keyed and never budget-keyed", () => {
  it("admits exactly five measured conditions, none of them a clock", () => {
    // Structural: the ONLY way a millisecond could reach the classifier is
    // through this type. Adding a budget field here is the design error the
    // test exists to catch.
    expect(Object.keys(conditions()).sort()).toEqual([
      "allCandidatesCloudContingentDead",
      "claimsSaturated",
      "floorSeparates",
      "holdsPresent",
      "residueDischargeable",
    ])
  })

  it("classifies identically for every condition combination whatever the stamp", () => {
    const flags = ["holdsPresent", "floorSeparates", "claimsSaturated", "residueDischargeable", "allCandidatesCloudContingentDead"] as const
    for (let mask = 0; mask < 32; mask++) {
      const c = conditions(
        Object.fromEntries(flags.map((f, i) => [f, (mask & (1 << i)) !== 0])) as Partial<PostureConditions>,
      )
      const a = new PostureGovernor("SIGHTED")
      const b = new PostureGovernor("SIGHTED")
      a.observe(c, 0)
      b.observe(c, 9_999_999)
      expect(a.current).toBe(b.current)
      expect(a.current).toBe(classifyPosture(c))
    }
  })

  it("logs every flip as a posture Assumption and stays quiet when nothing moved", () => {
    const g = new PostureGovernor("SIGHTED")
    expect(g.observe(conditions({ holdsPresent: false }), 1)).toBeNull()
    const flip = g.observe(conditions(), 2)
    expect(flip).not.toBeNull()
    expect(flip?.from).toBe("SIGHTED")
    expect(flip?.to).toBe("FOGGED-DISCRIMINATING")
    expect(flip?.assumption).toEqual({ kind: "posture", posture: "FOGGED-DISCRIMINATING" })
    expect(g.observe(conditions(), 3)).toBeNull()
    const back = g.observe(conditions({ allCandidatesCloudContingentDead: true }), 4)
    expect(back?.to).toBe("FOGGED-VACUOUS")
    expect(g.flips.map((f) => f.to)).toEqual(["FOGGED-DISCRIMINATING", "FOGGED-VACUOUS"])
    expect(postureAssumption("SIGHTED")).toEqual({ kind: "posture", posture: "SIGHTED" })
  })
})

describe("channel policy", () => {
  it("lets the floor lead everywhere except FOGGED-VACUOUS", () => {
    for (const p of ["SIGHTED", "FOGGED-DISCRIMINATING"] as Posture[]) {
      const pol = channelPolicyFor(p)
      expect(pol.orderBy).toBe("lo")
      expect(pol.loRole).toBe("adjudicate")
      expect(pol.tieBreak).toBe("est")
      expect(pol.vacuousMayWin).toBe(false)
      expect(pol.spend).toBe("slack")
    }
  })

  it("turns lo into a veto and hands ordering to est under FOGGED-VACUOUS", () => {
    const pol = channelPolicyFor("FOGGED-VACUOUS")
    expect(pol.orderBy).toBe("est")
    expect(pol.loRole).toBe("veto")
    expect(pol.vacuousMayWin).toBe(true)
    // Slack-buying is worthless by construction here; the budget goes to depth
    // on our own plan and to the gradient channel.
    expect(pol.spend).toBe("depth-and-gradient")
  })

  it("keeps lo's veto in force in every posture — est orders, it never adjudicates", () => {
    expect(vetoed("material-dead")).toBe(true)
    expect(vetoed("cloud-contingent-dead")).toBe(false)
    expect(vetoed("alive")).toBe(false)
  })
})
