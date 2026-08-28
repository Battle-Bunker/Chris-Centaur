/**
 * THE TWO GATES THIS SUBSYSTEM EXISTS TO PASS.
 *
 *   POOL 0 IS BIT-IDENTICAL TO `off`.   The plumbing is present and inert.
 *   POOL 1, 2 AND 3 ARE BIT-IDENTICAL TO POOL 0.  Real worker threads, really
 *   pricing speculative plans, really folding their answers in — and the
 *   staged plan, every emitted bound and every kernel counter come out the
 *   same.
 *
 * ── WHY THE CLOCK IS A WORK COUNTER ───────────────────────────────────────
 *
 * "Identical with 0, 1, 2 and 3 workers" is only a meaningful sentence if the
 * two runs did the SAME AMOUNT OF SEARCH, and the anytime kernel's budget is a
 * wall clock: give a faster arm the same milliseconds and it does more work and
 * legitimately reaches a different (better) plan. That is the point of the
 * whole exercise, and it is also what would make a wall-clock comparison
 * assert nothing.
 *
 * So the kernel is driven from a clock that advances one unit per main-thread
 * `BoundBank.price` — a BUDGET IN WORK UNITS. Every arm then performs exactly
 * the same number of prices, the same sweeps, the same acceptances, and the
 * only thing that varies between them is how many of those prices found their
 * evaluation already in the memo. Wall time still passes normally underneath,
 * so the workers are really racing the main thread and really landing results
 * at unpredictable slice boundaries — which is exactly the schedule
 * nondeterminism the gate has to survive.
 *
 * A run that imported nothing would pass this gate vacuously, so every pooled
 * arm asserts that its workers actually returned parcels and that the bank
 * actually read entries it did not compute.
 */

import { transientDelay } from "../../server/activity-controller"
import type { Board, Coord, GameState, Snake } from "../../types/battlesnake"
import type { CentaurMove } from "../../types/battlesnake"
import type { EmitRecord, PinEvent, UnitId } from "../contracts"
import { BoundBank } from "../bounds"
import { clearGeometryCache } from "../substrate"
import { TeamDecisionEngine, type TeamDecisionPorts } from "../team-decision-engine"

// -------------------------------------------------------------- the board

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: "0",
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: "",
    squad: "",
    customizations: { color: "#ffffff", head: "default", tail: "default" },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake
}

const piece = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  makeSnake(id, [at], { unitType, length: weight, teamID } as Partial<Snake>)

/**
 * Four of ours against three held enemies on an 11×11, close enough that the
 * entanglement gate admits somebody and B1 has replies to enumerate. Small
 * enough that a few hundred prices is a second of wall clock, big enough that
 * the sweep frontier has plans for a worker to speculate on.
 */
const BOARD = (): Board =>
  ({
    width: 11,
    height: 11,
    food: [{ x: 5, y: 5 }],
    hazards: [],
    snakes: [
      piece("r1", { x: 2, y: 2 }, "rook", 2, "red"),
      piece("r2", { x: 2, y: 8 }, "rook", 2, "red"),
      piece("n1", { x: 4, y: 5 }, "knight", 1, "red"),
      piece("k1", { x: 1, y: 5 }, "king", 1, "red"),
      piece("E1", { x: 8, y: 4 }, "rook", 2, "blue"),
      piece("E2", { x: 8, y: 6 }, "knight", 1, "blue"),
      piece("K2", { x: 9, y: 5 }, "king", 1, "blue"),
    ],
  }) as Board

const OURS = ["r1", "r2", "n1", "k1"]

// ------------------------------------------------------------- the harness

/** One decision's observable output — everything the gate compares. */
interface Arm {
  readonly forwarded: ReadonlyArray<string>
  readonly journal: ReadonlyArray<string>
  readonly emitted: number
  readonly slices: number
  readonly improveCalls: number
  readonly conformCalls: number
  readonly prices: number
  readonly finalPlan: string
  readonly imported: number
  readonly parcelsReturned: number
}

const recordOf = (rec: EmitRecord): string =>
  `${rec.epoch}/${rec.posture}/${rec.lo}/${rec.est}/${rec.hi}/${rec.horizon}/${rec.slack}/` +
  [...rec.plan]
    .map(([unitId, c]: [UnitId, { to: number; path: ReadonlyArray<number> }]) => `${unitId}>${c.to}#${c.path.join(".")}`)
    .sort()
    .join(",")

/** The work clock: one unit per main-thread price. See the file header. */
let work = 0
const realPrice = BoundBank.prototype.price
beforeAll(() => {
  BoundBank.prototype.price = function patched(this: BoundBank, plan: Parameters<typeof realPrice>[0]) {
    work++
    return realPrice.call(this, plan)
  }
})
afterAll(() => {
  BoundBank.prototype.price = realPrice
})

const BUDGET_UNITS = 400

async function runArm(
  engine: TeamDecisionEngine,
  forwarded: string[],
  turn: number,
  before: number,
): Promise<Arm> {
  forwarded.length = 0
  const at = work
  const result = await engine.decideTurn({
    gameId: "gate",
    turn,
    board: BOARD(),
    ourTeamId: "red",
    units: OURS.map((snakeId) => ({ snakeId, view: {} as GameState })),
    // The wall clock the ports hand out is FIXED, so this is exactly
    // `workClock + BUDGET_UNITS` with no real time in it at all.
    deadlineMs: 1_000_000 + BUDGET_UNITS,
  })
  const stats = engine.workerStats
  return {
    forwarded: [...forwarded],
    journal: (result.report?.journal ?? []).map(recordOf),
    emitted: result.emitted,
    slices: result.report?.slices ?? -1,
    improveCalls: result.report?.improveCalls ?? -1,
    conformCalls: result.report?.conformCalls ?? -1,
    prices: work - at,
    finalPlan: [...(result.report?.journal ?? [])].map(recordOf).slice(-1)[0] ?? "(none)",
    imported: before,
    parcelsReturned: stats?.parcelsReturned ?? 0,
  }
}

function portsFor(forwarded: string[]): TeamDecisionPorts {
  return {
    setBotRecommendation: (_gameId: string, snakeId: string, move: CentaurMove) => {
      forwarded.push(`${snakeId}=${String(move)}`)
    },
    enableTeamStaging: () => {},
    onPinEvent: (_gameId: string, _sink: (event: PinEvent, turn?: number) => void) => () => {},
    pinSnakeIdOf: () => null,
    // A FIXED wall clock: the only clock with any real time in it is the one
    // the workers race against, and that one is not the kernel's.
    now: () => 1_000_000,
    // THE WORK CLOCK.
    monotonic: () => work,
    log: () => {},
  }
}

/**
 * Warm the pool, and be patient about it.
 *
 * A worker boots its own transpiler and loads the whole lobster tree — a couple
 * of seconds on an idle box, and this suite runs three of them alongside jest's
 * own workers on a four-core machine. A decision that finished before its
 * workers were awake is a decision that proves nothing, and the gate below
 * asserts non-vacuity, so an impatient warm-up is a FLAKY GATE rather than a
 * fast one. Throwaway turns until parcels come back, then stop.
 */
async function warm(engine: TeamDecisionEngine, forwarded: string[]): Promise<boolean> {
  for (let round = 0; round < 6; round++) {
    // ONE decision per round, then WAIT. A decision is what pushes the board,
    // opens the session and dispatches; after that the workers need wall time,
    // not more work from this thread. Spinning full decisions while they boot
    // is main-thread CPU spent starving the rest of the suite — this file
    // already spawns six worker threads on a four-core box.
    await runArm(engine, forwarded, round + 1, 0)
    for (let poll = 0; poll < 20; poll++) {
      if ((engine.workerStats?.entriesReturned ?? 0) > 0) return true
      await transientDelay(150)
    }
  }
  return false
}

// ----------------------------------------------------------------- the gates

describe("worker parallelism is invisible to the answer", () => {
  jest.setTimeout(300_000)

  afterEach(() => {
    clearGeometryCache()
  })

  it("pool 0 is bit-identical to workers=off, and neither spawns a thread", async () => {
    const arms: Arm[] = []
    for (const workers of ["off", 0] as const) {
      const forwarded: string[] = []
      const engine = new TeamDecisionEngine(portsFor(forwarded), {
        workers,
        kernel: { sliceMs: 20, reserveMs: 0, minWriteIntervalMs: 0 },
      })
      try {
        arms.push(await runArm(engine, forwarded, 40, 0))
        // Neither arm may have created a worker: `off` builds no pool at all,
        // and 0 builds the inline one.
        expect(engine.workerStats?.size ?? 0).toBe(0)
      } finally {
        await engine.shutdown()
      }
      clearGeometryCache()
    }
    const [off, zero] = arms as [Arm, Arm]
    expect(zero).toEqual(off)
    // Not a vacuous decision: it staged something and it did real work.
    expect(off.forwarded.length).toBeGreaterThan(0)
    expect(off.prices).toBeGreaterThan(20)
  })

  it("pools 1, 2 and 3 stage the identical plan and emit the identical bounds", async () => {
    const reference: Arm[] = []
    const forwarded0: string[] = []
    const base = new TeamDecisionEngine(portsFor(forwarded0), {
      workers: 0,
      kernel: { sliceMs: 20, reserveMs: 0, minWriteIntervalMs: 0 },
    })
    try {
      reference.push(await runArm(base, forwarded0, 40, 0))
    } finally {
      await base.shutdown()
    }
    clearGeometryCache()
    const zero = reference[0] as Arm

    for (const size of [1, 2, 3]) {
      const forwarded: string[] = []
      const engine = new TeamDecisionEngine(portsFor(forwarded), {
        workers: size,
        kernel: { sliceMs: 20, reserveMs: 0, minWriteIntervalMs: 0 },
        // Audit mode: every imported evaluation is recomputed on first read
        // and a disagreement THROWS. It is the only check for the one
        // divergence the memo key cannot express — two substrates that are not
        // the same board — so the gate runs with it on.
        search: { bank: { auditImports: true } },
      })
      try {
        // A gate that cannot get its workers awake has not measured anything,
        // and saying so is better than passing quietly or failing obscurely.
        expect(await warm(engine, forwarded)).toBe(true)
        clearGeometryCache()
        const arm = await runArm(engine, forwarded, 40, 0)
        const stats = engine.workerStats
        expect(stats?.size).toBe(size)
        expect(stats?.degraded ?? null).toBeNull()
        // NOT VACUOUS: the workers really answered.
        expect(stats?.parcelsReturned ?? 0).toBeGreaterThan(0)
        expect(stats?.entriesReturned ?? 0).toBeGreaterThan(0)

        expect(arm.forwarded).toEqual(zero.forwarded)
        expect(arm.journal).toEqual(zero.journal)
        expect(arm.finalPlan).toBe(zero.finalPlan)
        expect(arm.emitted).toBe(zero.emitted)
        expect(arm.prices).toBe(zero.prices)
        expect(arm.slices).toBe(zero.slices)
        expect(arm.improveCalls).toBe(zero.improveCalls)
        expect(arm.conformCalls).toBe(zero.conformCalls)
      } finally {
        await engine.shutdown()
      }
      clearGeometryCache()
    }
  })

  /**
   * CL4 — THE WORKER-JITTER CHAOS ARM, on the seeded lottery.
   *
   * Contract rule 20's clause about workers: *"the dispatch sequence is decided
   * on the coordinator BEFORE any worker runs and is a pure function of (seed,
   * board, epoch, slice) — never of worker timing; every priced bound is
   * completion-order-independent; results fold at slice barriers in canonical
   * arm-key order, never arrival order; worker jitter may change only which
   * results make a deadline, never any bound's value nor the ordering among
   * arrived results."*
   *
   * The chaos is REAL rather than simulated: three worker threads racing the
   * main thread on a four-core box, landing parcels at slice boundaries nobody
   * controls, while the coordinator's own branch choices come out of a seeded
   * lottery. If the sampler had drawn anything from arrival order — a per-call
   * counter instead of a per-node one, a temperature read inside a fold, a
   * frontier re-derived rather than peeked — this is where it would show, and
   * it would show as a different staged plan rather than as a warning.
   *
   * The clock is still the work counter (see the file header), so all four arms
   * do exactly the same amount of search and the only thing varying is when the
   * answers arrive.
   */
  it("the seeded lottery survives real worker jitter: pools 0-3 stage one plan", async () => {
    const OPTIONS = {
      sampledCap: true,
      matchSeed: 0x51_4c_54,
      kernel: { sliceMs: 20, reserveMs: 0, minWriteIntervalMs: 0 },
    } as const
    const forwarded0: string[] = []
    const base = new TeamDecisionEngine(portsFor(forwarded0), { ...OPTIONS, workers: 0 })
    let zero: Arm
    try {
      zero = await runArm(base, forwarded0, 40, 0)
    } finally {
      await base.shutdown()
    }
    clearGeometryCache()
    // NOT VACUOUS: the lottery has to have actually drawn something, or this
    // gate is the pool gate again under a different name.
    expect(zero.forwarded.length).toBeGreaterThan(0)

    for (const size of [1, 2, 3]) {
      const forwarded: string[] = []
      const engine = new TeamDecisionEngine(portsFor(forwarded), {
        ...OPTIONS,
        workers: size,
        search: { bank: { auditImports: true } },
      })
      try {
        expect(await warm(engine, forwarded)).toBe(true)
        clearGeometryCache()
        const arm = await runArm(engine, forwarded, 40, 0)
        expect(engine.workerStats?.parcelsReturned ?? 0).toBeGreaterThan(0)
        expect(engine.workerStats?.entriesReturned ?? 0).toBeGreaterThan(0)
        expect(arm.forwarded).toEqual(zero.forwarded)
        expect(arm.journal).toEqual(zero.journal)
        expect(arm.finalPlan).toBe(zero.finalPlan)
        expect(arm.prices).toBe(zero.prices)
        expect(arm.slices).toBe(zero.slices)
      } finally {
        await engine.shutdown()
      }
      clearGeometryCache()
    }
  })
})
