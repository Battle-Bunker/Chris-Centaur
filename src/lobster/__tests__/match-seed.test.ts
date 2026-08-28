/**
 * THE PRIVATE PER-MATCH SEED — the half of the owner's lottery ruling CL4 owed.
 *
 * CL4's own report flagged the hole: `matchSeed` defaulted to zero, so the
 * sampling stream was `f(board, decision index)` — replayable, and DERIVABLE by
 * an opponent holding this source. Two properties have to hold together, and
 * they pull in opposite directions, which is why they are asserted together:
 *
 *   (a) THE PRODUCTION PATH IS UNPREDICTABLE. An engine that takes a sampled
 *       decision without a pinned seed mints a nonzero, crypto-random word per
 *       GAME, stable inside the match and independent across matches and across
 *       processes.
 *   (b) A PINNED SEED STILL REPRODUCES BYTE FOR BYTE. Every gate and probe in
 *       this tree runs on a pinned seed, and a mint that could override one
 *       would make every arm of every measurement incomparable.
 *
 * No live games, no clock, no network: (a) is asserted on the minting POLICY
 * through the engine's own resolver, and (b) on the real search core over a
 * generated board with a counting budget.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { TeamDecisionEngine } from '../team-decision-engine';
import type { TeamDecisionPorts } from '../team-decision-engine';
import { mintMatchSeed } from '../match-seed';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import { BoundBank, candidateKey } from '../bounds';
import { countingBudget } from '../bounds/testkit';
import type { JointPlan, SearchContext } from '../contracts';

// --------------------------------------------------------------------- ports

const silentPorts = (): TeamDecisionPorts => ({
  setBotRecommendation: () => undefined,
  enableTeamStaging: () => undefined,
  onPinEvent: () => () => undefined,
  pinSnakeIdOf: () => null,
  log: () => undefined,
  env: {},
});

// ------------------------------------------------------------------ (a) mint

describe('the mint itself', () => {
  test('never returns zero — the sentinel that means "the board is the stream"', () => {
    // Zero is not merely improbable here, it is REFUSED: a zero seed silently
    // reinstates the predictable regime, which is the exact defect being fixed.
    const alwaysZero = mintMatchSeed(
      (() => {
        let n = 0;
        return () => (n++ < 3 ? 0 : 0x1234_5678);
      })()
    );
    expect(alwaysZero).toBe(0x1234_5678);
    expect(() => mintMatchSeed(() => 0)).toThrow(/zero/);
  });

  test('the real source gives 32 distinct unpredictable bits', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 256; i++) {
      const s = mintMatchSeed();
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(0xffff_ffff);
      expect(Number.isInteger(s)).toBe(true);
      seeds.add(s);
    }
    // 256 draws from 2^32 collide with probability ~3e-6. A collision here is
    // a broken source, not bad luck.
    expect(seeds.size).toBe(256);
  });
});

describe('the production path gets a nonzero, unpredictable, per-GAME seed', () => {
  test('the lottery ON with no pinned seed mints one word per game', () => {
    const engine = new TeamDecisionEngine(silentPorts(), { sampledCap: true });
    const a1 = engine.matchSeedFor('game-a');
    const a2 = engine.matchSeedFor('game-a');
    const b = engine.matchSeedFor('game-b');

    expect(a1).not.toBe(0);
    expect(b).not.toBe(0);
    // STABLE INSIDE A MATCH: every decision of one game shares one stream, or
    // the recorded seed does not replay the match it was recorded on.
    expect(a2).toBe(a1);
    // INDEPENDENT ACROSS MATCHES: a shared seed lets an opponent who has seen
    // one match's stream predict the next.
    expect(b).not.toBe(a1);
  });

  test('two engines on the same game id do not share a stream', () => {
    // The seed is a property of the MATCH THIS PROCESS IS PLAYING, not of the
    // game id, which is public. Two processes handed the same id must not
    // derive the same lottery.
    const seeds = new Set<number>();
    for (let i = 0; i < 32; i++) {
      seeds.add(new TeamDecisionEngine(silentPorts(), { sampledCap: true }).matchSeedFor('g'));
    }
    expect(seeds.size).toBe(32);
  });

  test('the seed is logged operator-side at the moment of minting', () => {
    // The log line plus `EmitRecord.selection.matchSeed` IS the replay
    // manifest. A seed nobody wrote down is a match nobody can re-run.
    const lines: string[] = [];
    const ports = { ...silentPorts(), log: (m: string) => lines.push(m) };
    const engine = new TeamDecisionEngine(ports, { sampledCap: true });
    const seed = engine.matchSeedFor('game-x');
    engine.matchSeedFor('game-x');
    const hits = lines.filter((l) => l.includes(seed.toString(16)));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('game-x');
  });

  test('the lottery OFF mints nothing at all', () => {
    // Nothing reads the seed when no sampler is constructed, and putting an
    // unpredictable number into a tuning nothing reads is how a flag-off path
    // stops being byte-identical for no reason.
    const engine = new TeamDecisionEngine(silentPorts(), {});
    expect(engine.matchSeedFor('g')).toBe(0);
    expect(engine.matchSeedFor('g')).toBe(0);
  });

  test('the environment flag alone is enough to turn the mint on', () => {
    const ports = { ...silentPorts(), env: { CENTAUR_SAMPLED_CAP: '1' } };
    expect(new TeamDecisionEngine(ports, {}).matchSeedFor('g')).not.toBe(0);
  });
});

// --------------------------------------------------------------- (b) pinning

describe('a pinned seed still reproduces byte for byte', () => {
  test('a named matchSeed is never overridden by a mint, on any game', () => {
    const engine = new TeamDecisionEngine(silentPorts(), {
      sampledCap: true,
      matchSeed: 0xc0ffee,
      // Even with a mint available, the pin wins: a probe arm that silently
      // drew its own seed would make every measurement in this tree unpaired.
      mintMatchSeed: () => 0xdead,
    });
    expect(engine.matchSeedFor('one')).toBe(0xc0ffee);
    expect(engine.matchSeedFor('two')).toBe(0xc0ffee);
  });

  test('the mint seam is honoured when there is no pin', () => {
    const engine = new TeamDecisionEngine(silentPorts(), {
      sampledCap: true,
      mintMatchSeed: () => 0x51_4c_54,
    });
    expect(engine.matchSeedFor('one')).toBe(0x51_4c_54);
  });

  test('the same pinned seed gives the identical price sequence, twice', () => {
    const board = confronted(7);
    const first = priceSequence(board, 0x51_4c_54);
    const second = priceSequence(board, 0x51_4c_54);
    expect(second).toEqual(first);
    // And it is not vacuous: a different seed is a different run.
    const other = priceSequence(board, 0x51_4c_55);
    expect(other).not.toEqual(first);
  });
});

// ------------------------------------------------------------- the harness

let traced: JointPlan[] | null = null;
const realPrice = BoundBank.prototype.price;
beforeAll(() => {
  BoundBank.prototype.price = function patched(
    this: BoundBank,
    plan: Parameters<typeof realPrice>[0]
  ) {
    traced?.push(plan as JointPlan);
    return realPrice.call(this, plan);
  };
});
afterAll(() => {
  BoundBank.prototype.price = realPrice;
});
afterEach(() => clearGeometryCache());

/** Every plan the bank was asked to price, as keys. The decision, byte for
 * byte: two runs that priced the same plans in the same order are the same
 * run. */
function priceSequence(board: Board, matchSeed: number): string[] {
  const sub = makeSubstrate({ board, turn: 30, asTeam: 'red' });
  try {
    const core = makeSearchCore({
      sampledCap: true,
      // The cap BINDS at 2 against a trail unit's four options, which is the
      // only regime in which the lottery does anything at all (CL4's own law:
      // exact-where-complete, sampled-where-truncated). At the shipped cap of
      // 8 no snake board truncates, the sampler is inert, and a
      // "different seed, different run" assertion would be vacuously false.
      candidateCap: 2,
      clusterSeed: false,
      clusterEnum: false,
      rungZeroRepair: false,
      samplingTuning: { matchSeed },
    });
    const ctx: SearchContext = {
      sub,
      gen: new GrammarCandidateGenerator({}),
      evaluate: defaultEvaluator,
      asTeam: sub.teamNumber('red'),
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: countingBudget(48),
    };
    const calls: JointPlan[] = [];
    traced = calls;
    core.improve(ctx);
    traced = null;
    return calls.map((p) =>
      [...p.entries()].map(([u, c]) => `${u}:${candidateKey(c)}`).sort().join('|')
    );
  } finally {
    sub.release();
  }
}

// --------------------------------------------------------------- the board

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

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * CONFRONTED — CL1's ship-criterion generator, byte for byte, so this stage's
 * numbers sit beside CL1's, CL3's and CL4's. Generated from a fixed seed;
 * never captured from a live game.
 */
function confronted(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const anchors: Array<[number, number, string]> = [];
  const rx = 2 + Math.floor(r() * 3);
  const ry = 2 + Math.floor(r() * 6);
  anchors.push([rx, ry, 'red'], [rx + 2, ry, 'red'], [rx + 1, ry + 1, 'red']);
  const bx = 6 + Math.floor(r() * 2);
  const by = 2 + Math.floor(r() * 6);
  anchors.push([bx, by, 'blue'], [bx + 2, by, 'blue'], [bx + 1, by + 1, 'blue']);
  for (let i = 0; i < anchors.length; i++) {
    const [hx, hy, team] = anchors[i] as [number, number, string];
    const body: Coord[] = [];
    if (!take(hx, hy)) continue;
    body.push({ x: hx, y: hy });
    const len = 3 + Math.floor(r() * 3);
    let d = Math.floor(r() * 4);
    for (let j = 1; j < len; j++) {
      if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
      const prev = body[body.length - 1] as Coord;
      let stepped = false;
      for (let k = 0; k < 4 && !stepped; k++) {
        const dd = DIRS[(d + k) % 4] as readonly [number, number];
        if (take(prev.x + dd[0], prev.y + dd[1])) {
          body.push({ x: prev.x + dd[0], y: prev.y + dd[1] });
          d = (d + k) % 4;
          stepped = true;
        }
      }
      if (!stepped) break;
    }
    if (body.length < 2) continue;
    snakes.push(makeSnake(`u${i}`, body, { teamID: team, health: 40 + Math.floor(r() * 50) }));
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}
