/**
 * THE ONE THING THE MEMO KEY CANNOT EXPRESS.
 *
 * Everything a worker could get wrong shows up INSIDE the evaluation-memo key
 * and makes its answer inert rather than wrong — a different evaluator, basis,
 * frame, view or plan all produce a key the main thread never looks up (see
 * `protocol.ts`). Exactly one divergence survives that argument: two
 * `EngineSubstrate`s built from the same `BoardSpec` that do not resolve and
 * score identically. The key says nothing about the board, so nothing catches
 * it except a direct comparison.
 *
 * So this file does the direct comparison, twice over:
 *
 *  1. THE SAME PROCESS, TWO SUBSTRATES. Cheap, and it is the property the
 *     whole scheme rests on: `makeSubstrate` from identical options must be a
 *     function.
 *  2. A REAL WORKER THREAD. The same board pushed over the wire, the same
 *     plans priced there, and every key the two sides share carrying bit-equal
 *     (lo, est, hi). Plus the coverage number: how much of the main thread's
 *     own evaluation set a worker's parcel actually supplies, which is the
 *     ceiling on what speculation can ever save.
 *
 * The rest of the file is the degradation contract — a pool that cannot serve
 * this decision must leave the search running, not break it.
 */

import type { Board, Coord, Snake } from "../../types/battlesnake"
import type { Bound, BudgetHandle, CandidateSet, UnitId } from "../contracts"
import { BoundBank, DEFAULT_BANK_CONFIG } from "../bounds"
import { GrammarCandidateGenerator, DEFAULT_KNOBS } from "../candidates"
import { BoundEvaluator, defaultEvaluator, materialEvaluator } from "../evaluate"
import { clearGeometryCache, makeSubstrate, type EngineSubstrate } from "../substrate"
import { WorkerEvaluationPool, InlinePool } from "./pool"
import { evaluatorSpecOf, makeEvaluationPool } from "./factory"
import { encodeCandidate } from "./protocol"

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

const BOARD = (): Board =>
  ({
    width: 11,
    height: 11,
    food: [{ x: 5, y: 5 }],
    hazards: [{ x: 3, y: 9 }],
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

const TURN = 40
const MODELED = ["r1", "r2", "n1", "k1"]
const GAME = "fidelity"

const unbounded = (): BudgetHandle => ({
  now: () => Date.now(),
  elapsedMs: () => 0,
  remainingMs: () => Number.POSITIVE_INFINITY,
  shouldStop: () => false,
})

interface Side {
  sub: EngineSubstrate
  bank: BoundBank
  roster: UnitId[]
  sets: Map<UnitId, CandidateSet>
  release(): void
}

function side(gameId: string): Side {
  const sub = makeSubstrate({
    gameId,
    board: BOARD(),
    turn: TURN,
    asTeam: "red",
    modeled: MODELED,
  })
  const gen = new GrammarCandidateGenerator(DEFAULT_KNOBS)
  const asTeam = sub.teamNumber("red")
  const roster = [...sub.commandable(asTeam)].sort((a, b) => a - b)
  const sets = new Map<UnitId, CandidateSet>()
  for (const unitId of roster) sets.set(unitId, gen.candidatesFor(sub, unitId))
  const bank = new BoundBank({
    sub,
    gen,
    evaluate: defaultEvaluator,
    asTeam,
    budget: unbounded(),
    basis: [],
    config: DEFAULT_BANK_CONFIG,
  })
  bank.recordEvaluations()
  return {
    sub,
    bank,
    roster,
    sets,
    release: () => {
      bank.release()
      sub.release()
    },
  }
}

/** The first `n` plans of the seed's own sweep frontier, as index vectors. */
function frontierCodes(s: Side, n: number): { codes: Int32Array; count: number } {
  const width = s.roster.length
  const base = new Int32Array(width)
  for (let i = 0; i < width; i++) {
    const set = s.sets.get(s.roster[i] as UnitId) as CandidateSet
    base[i] = encodeCandidate(set, set.candidates[0] as CandidateSet["candidates"][number])
  }
  const plans: Int32Array[] = []
  outer: for (let slot = 0; slot < width; slot++) {
    const set = s.sets.get(s.roster[slot] as UnitId) as CandidateSet
    for (let c = 1; c < Math.min(set.candidates.length, 6); c++) {
      const plan = Int32Array.from(base)
      plan[slot] = c
      plans.push(plan)
      if (plans.length >= n) break outer
    }
  }
  const codes = new Int32Array(plans.length * width)
  plans.forEach((p, i) => codes.set(p, i * width))
  return { codes, count: plans.length }
}

function priceLocally(s: Side, codes: Int32Array, count: number): Map<string, Bound> {
  const width = s.roster.length
  for (let j = 0; j < count; j++) {
    const plan = new Map<UnitId, CandidateSet["candidates"][number]>()
    for (let i = 0; i < width; i++) {
      const set = s.sets.get(s.roster[i] as UnitId) as CandidateSet
      plan.set(s.roster[i] as UnitId, set.candidates[codes[j * width + i] as number] as never)
    }
    s.bank.price(plan)
  }
  return new Map(s.bank.takeRecordedEvaluations())
}

describe("a worker's board is this thread's board", () => {
  jest.setTimeout(300_000)
  afterEach(() => clearGeometryCache())

  it("two substrates built from the same options score every branch identically", () => {
    const a = side("fid-a")
    const b = side("fid-b")
    try {
      const { codes, count } = frontierCodes(a, 12)
      expect(count).toBeGreaterThan(6)
      const left = priceLocally(a, Int32Array.from(codes), count)
      const right = priceLocally(b, Int32Array.from(codes), count)
      expect(left.size).toBeGreaterThan(count)
      expect([...right.keys()].sort()).toEqual([...left.keys()].sort())
      for (const [key, bound] of left) {
        expect(right.get(key)).toEqual(bound)
      }
    } finally {
      a.release()
      b.release()
    }
  })

  it("a REAL worker's evaluations are bit-equal to this thread's, for every shared key", async () => {
    const main = side(GAME)
    const pool = new WorkerEvaluationPool({ size: 1, log: () => {} })
    try {
      const { codes, count } = frontierCodes(main, 16)
      const truth = priceLocally(main, Int32Array.from(codes), count)
      expect(truth.size).toBeGreaterThan(count)

      const epoch = pool.pushBoard({
        gameId: GAME,
        turn: TURN,
        board: BOARD(),
        asTeamId: "red",
        modeled: MODELED,
        observedTurns: [],
      })
      const sessionId = pool.nextSessionId()
      pool.openSession({
        sessionId,
        boardEpoch: epoch,
        asTeam: main.sub.teamNumber("red"),
        knobs: DEFAULT_KNOBS,
        evaluator: evaluatorSpecOf(defaultEvaluator),
        basis: [],
        bankConfig: DEFAULT_BANK_CONFIG,
        roster: main.roster,
        catalogueDigest: (
          await import("./protocol")
        ).catalogueDigest(main.roster, main.sets),
      })
      expect(pool.dispatch({
        kind: "plan-batch",
        sessionId,
        boardEpoch: epoch,
        seq: 0,
        budgetMs: 20_000,
        count,
        codes: Int32Array.from(codes),
      })).toBe(true)

      // The worker boots its transpiler, builds its own substrate and prices;
      // poll rather than guess, and fail loudly if it never answers.
      let entries: ReadonlyArray<readonly [string, Bound]> = []
      for (let waited = 0; waited < 240 && entries.length === 0; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        entries = pool.drain(sessionId)
      }
      expect(entries.length).toBeGreaterThan(0)
      expect(pool.stats.degraded).toBeNull()
      expect(pool.stats.parcelsRefused).toBe(0)

      const fromWorker = new Map(entries)
      let shared = 0
      for (const [key, bound] of fromWorker) {
        const mine = truth.get(key)
        if (mine === undefined) continue
        shared++
        expect({ key, ...bound }).toEqual({ key, ...mine })
      }
      // COVERAGE, not just agreement. A worker that agreed about nothing would
      // pass the loop above and save nothing at all, so the number is asserted:
      // pricing the same plans must reproduce most of the same branch set.
      expect(shared / truth.size).toBeGreaterThan(0.5)
    } finally {
      await pool.shutdown()
      main.release()
    }
  })
})

describe("degradation", () => {
  it("refuses an evaluator a worker could not rebuild, by name", () => {
    expect(evaluatorSpecOf(defaultEvaluator)).toEqual({
      kind: "profile",
      profile: defaultEvaluator.profile,
    })
    expect(evaluatorSpecOf(materialEvaluator).kind).toBe("profile")

    const foreign = { scorePlan: () => ({ lo: 0, est: 0, hi: 0 }), evaluatePlan: () => ({}) }
    expect(evaluatorSpecOf(foreign as never).kind).toBe("unsupported")

    // The dangerous one: same profile, DIFFERENT features. Its
    // `evaluationIdentity` is the shipped evaluator's, so its entries would
    // share a namespace and disagree about the value — the single shape of
    // divergence the memo key cannot catch.
    const custom = new BoundEvaluator(defaultEvaluator.profile, [])
    expect(custom.evaluationIdentity).toBe(defaultEvaluator.evaluationIdentity)
    expect(evaluatorSpecOf(custom).kind).toBe("unsupported")
  })

  it("builds no pool for off, and the inline pool for 0", () => {
    const off = makeEvaluationPool({ setting: "off", log: () => {} })
    const zero = makeEvaluationPool({ setting: 0, log: () => {} })
    expect(off).toBeInstanceOf(InlinePool)
    expect(zero).toBeInstanceOf(InlinePool)
    expect(off.size).toBe(0)
    expect(off.live).toBe(false)
    expect(
      off.dispatch({
        kind: "plan-batch",
        sessionId: off.nextSessionId(),
        boardEpoch: off.pushBoard({
          gameId: "off",
          turn: TURN,
          board: BOARD(),
          asTeamId: "red",
          modeled: MODELED,
          observedTurns: [],
        }),
        seq: 0,
        budgetMs: 1,
        count: 1,
        codes: new Int32Array([0]),
      }),
    ).toBe(false)
    expect(off.drain(1)).toEqual([])
  })

  it("a degraded pool stops dispatching and says so, and nothing throws", async () => {
    const said: string[] = []
    const pool = new WorkerEvaluationPool({ size: 1, log: (m) => said.push(m) })
    try {
      const epoch = pool.pushBoard({
        gameId: "degrade",
        turn: TURN,
        board: BOARD(),
        asTeamId: "red",
        modeled: MODELED,
        observedTurns: [],
      })
      const sessionId = pool.nextSessionId()
      pool.openSession({
        sessionId,
        boardEpoch: epoch,
        asTeam: 0,
        knobs: DEFAULT_KNOBS,
        evaluator: evaluatorSpecOf(defaultEvaluator),
        basis: [],
        bankConfig: DEFAULT_BANK_CONFIG,
        roster: [0, 1],
        // A digest no worker can match: every parcel comes back refused.
        catalogueDigest: "not-the-catalogue",
      })
      pool.dispatch({
        kind: "plan-batch",
        sessionId,
        boardEpoch: epoch,
        seq: 0,
        budgetMs: 5_000,
        count: 1,
        codes: new Int32Array([0, 0]),
      })
      for (let waited = 0; waited < 240 && pool.stats.degraded === null; waited++) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      expect(pool.stats.degraded).toMatch(/catalogue mismatch/)
      expect(pool.live).toBe(false)
      expect(pool.freeSlots).toBe(0)
      expect(pool.drain(sessionId)).toEqual([])
      expect(said.some((m) => m.includes("degraded to inline execution"))).toBe(true)
    } finally {
      await pool.shutdown()
    }
  }, 120_000)
})
