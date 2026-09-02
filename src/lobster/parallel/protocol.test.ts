/**
 * THE PROTOCOL, on its own: the plan codec, the catalogue digest, the key
 * blob, and the flag.
 *
 * These are the parts whose failure mode is silent. A codec that decodes to
 * the wrong candidate produces an inert entry rather than a wrong one (that is
 * the whole argument in `protocol.ts`), which means nothing downstream will
 * ever complain — so the codec is tested here, directly, against a real
 * candidate catalogue on a real board.
 */

import type { Board, Coord, Snake } from "../../types/battlesnake"
import type { CandidateSet, UnitId } from "../contracts"
import { clearGeometryCache, makeSubstrate } from "../substrate"
import { GrammarCandidateGenerator } from "../candidates"
import {
  catalogueDigest,
  decodeCandidate,
  decodeKeys,
  encodeCandidate,
  UNENCODABLE,
} from "./protocol"
import { autoPoolSize, parseWorkerSetting, resolveWorkerCount } from "./config"
import { DEFAULT_BOT_CONFIG, botConfigFromJson, resolveBotConfig } from "../bot-config"

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
    width: 9,
    height: 9,
    food: [],
    hazards: [],
    snakes: [
      piece("r", { x: 1, y: 4 }, "rook", 2, "red"),
      piece("k", { x: 1, y: 1 }, "king", 1, "red"),
      piece("K", { x: 7, y: 4 }, "king", 1, "blue"),
      piece("N", { x: 7, y: 6 }, "knight", 1, "blue"),
    ],
  }) as Board

function catalogue(): {
  roster: UnitId[]
  sets: Map<UnitId, CandidateSet>
  release: () => void
} {
  const sub = makeSubstrate({ board: BOARD(), turn: 9, asTeam: "red" })
  const gen = new GrammarCandidateGenerator()
  const roster = [...sub.commandable(sub.teamNumber("red"))].sort((a, b) => a - b)
  const sets = new Map<UnitId, CandidateSet>()
  for (const unitId of roster) sets.set(unitId, gen.candidatesFor(sub, unitId))
  return { roster, sets, release: () => sub.release() }
}

describe("the plan codec", () => {
  afterEach(() => clearGeometryCache())

  it("round-trips every offered candidate of every unit", () => {
    const { roster, sets, release } = catalogue()
    try {
      let checked = 0
      for (const unitId of roster) {
        const set = sets.get(unitId) as CandidateSet
        expect(set.candidates.length).toBeGreaterThan(0)
        set.candidates.forEach((candidate, i) => {
          expect(encodeCandidate(set, candidate)).toBe(i)
          expect(decodeCandidate(set, i)).toBe(candidate)
          checked++
        })
      }
      expect(checked).toBeGreaterThan(4)
    } finally {
      release()
    }
  })

  it("round-trips a PRUNED candidate, which is where the negative codes live", () => {
    const { roster, sets, release } = catalogue()
    try {
      const withPrunes = roster
        .map((id) => sets.get(id) as CandidateSet)
        .filter((set) => set.prunedLedger.length > 0)
      // A board with no prunes anywhere would make this vacuous, so say so
      // rather than passing quietly.
      expect(withPrunes.length).toBeGreaterThan(0)
      for (const set of withPrunes) {
        for (let j = 0; j < set.prunedLedger.length; j++) {
          const candidate = (set.prunedLedger[j] as { candidate: CandidateSet["candidates"][number] })
            .candidate
          const code = encodeCandidate(set, candidate)
          // A pruned candidate whose (to, path) also appears in `candidates`
          // legitimately encodes as the offered one — same move, same key.
          const back = decodeCandidate(set, code)
          expect(back).not.toBeNull()
          expect(back?.to).toBe(candidate.to)
          expect(back?.path).toEqual(candidate.path)
        }
      }
    } finally {
      release()
    }
  })

  it("refuses a candidate the catalogue does not carry rather than guessing", () => {
    const { roster, sets, release } = catalogue()
    try {
      const set = sets.get(roster[0] as UnitId) as CandidateSet
      const invented = { unitId: roster[0] as UnitId, from: 0, to: 99999, path: [99999] }
      expect(encodeCandidate(set, invented)).toBe(UNENCODABLE)
      expect(decodeCandidate(set, UNENCODABLE)).toBeNull()
      expect(decodeCandidate(set, set.candidates.length + 50)).toBeNull()
    } finally {
      release()
    }
  })

  it("digests two identical catalogues the same and two different ones apart", () => {
    const a = catalogue()
    const b = catalogue()
    try {
      expect(catalogueDigest(a.roster, a.sets)).toBe(catalogueDigest(b.roster, b.sets))
      // One candidate dropped from one unit — the exact shape of a generator
      // that disagrees — must not digest the same.
      const unitId = a.roster[0] as UnitId
      const set = a.sets.get(unitId) as CandidateSet
      const shortened = new Map(a.sets)
      shortened.set(unitId, { ...set, candidates: set.candidates.slice(1) })
      expect(catalogueDigest(a.roster, shortened)).not.toBe(catalogueDigest(a.roster, a.sets))
    } finally {
      a.release()
      b.release()
    }
  })
})

describe("the key blob", () => {
  it("cuts back into the keys it was built from, whatever they contain", () => {
    // Deliberately including the characters a separator-joined blob would
    // break on — the reason the wire carries lengths instead.
    const keys = ["a|b#c.d", "", "id:BoundEvaluator({name:\u0000odd|profile})", "x"]
    const lengths = Int32Array.from(keys.map((k) => k.length))
    expect([...decodeKeys(keys.join(""), lengths)]).toEqual(keys)
  })
})

describe("CENTAUR_WORKERS", () => {
  it("defaults to OFF, and auto is one worker per spare core capped at three", () => {
    // Off, and deliberately: see config.ts for the measurement that decided it.
    expect(parseWorkerSetting(undefined)).toBe("off")
    expect(parseWorkerSetting("")).toBe("off")
    expect(parseWorkerSetting("auto")).toBe("auto")
    expect(parseWorkerSetting("on")).toBe("auto")
    expect(autoPoolSize(1)).toBe(0)
    expect(autoPoolSize(2)).toBe(1)
    expect(autoPoolSize(4)).toBe(3)
    expect(autoPoolSize(64)).toBe(3)
    expect(resolveWorkerCount("auto", 4)).toBe(3)
  })

  it("reads off, and reads a count", () => {
    expect(parseWorkerSetting("off")).toBe("off")
    expect(parseWorkerSetting("OFF")).toBe("off")
    expect(parseWorkerSetting("0")).toBe(0)
    expect(parseWorkerSetting("2")).toBe(2)
    expect(resolveWorkerCount("off", 8)).toBe(0)
    expect(resolveWorkerCount(2, 8)).toBe(2)
  })

  it("refuses junk loudly and falls back to the safe side rather than to silence", () => {
    const said: string[] = []
    expect(parseWorkerSetting("banana", (m) => said.push(m))).toBe("off")
    expect(parseWorkerSetting("-1", (m) => said.push(m))).toBe("off")
    expect(parseWorkerSetting("2.5", (m) => said.push(m))).toBe("off")
    expect(parseWorkerSetting("99", (m) => said.push(m))).toBe("off")
    expect(said).toHaveLength(4)
  })

  it("ships off, in the bot and not in the environment", () => {
    // The benchmark-winning setting IS the default, which is the whole
    // disposition a perf variant gets: no switch, and a branch plus a bench
    // for anyone who wants to reopen it.
    expect(DEFAULT_BOT_CONFIG.workers).toBe("off")
    expect(DEFAULT_BOT_CONFIG.workersAudit).toBe(false)
    expect(resolveBotConfig({}).workers).toBe("off")
    expect(resolveBotConfig({ workers: "auto" }).workers).toBe("auto")
    expect(resolveBotConfig({ workers: 3 }).workers).toBe(3)
    expect(botConfigFromJson({ workers: 2, workersAudit: true })).toMatchObject({
      workers: 2,
      workersAudit: true,
    })
    // Junk in a contender file falls back to the safe side and says so.
    const said: string[] = []
    expect(resolveBotConfig({ workers: "banana" as never }, (m) => said.push(m)).workers).toBe(
      "off",
    )
    expect(said).toHaveLength(1)
  })

  it("THE ENVIRONMENT IS NOT CONSULTED — both worker flags are gone", () => {
    const saved = [process.env.CENTAUR_WORKERS, process.env.CENTAUR_WORKERS_AUDIT]
    try {
      process.env.CENTAUR_WORKERS = "auto"
      process.env.CENTAUR_WORKERS_AUDIT = "1"
      expect(resolveBotConfig({}).workers).toBe("off")
      expect(resolveBotConfig({}).workersAudit).toBe(false)
    } finally {
      if (saved[0] === undefined) delete process.env.CENTAUR_WORKERS
      else process.env.CENTAUR_WORKERS = saved[0]
      if (saved[1] === undefined) delete process.env.CENTAUR_WORKERS_AUDIT
      else process.env.CENTAUR_WORKERS_AUDIT = saved[1]
    }
  })
})
