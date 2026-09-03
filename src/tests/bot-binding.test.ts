/**
 * WHO PLAYED THIS TURN, AND WHO DECIDED THAT.
 *
 * Two defects are pinned here, and they are the same defect read from either
 * end.
 *
 * IDENTITY. A decision row said `engine: 'lobster'` and `profile:
 * 'lobster-territory'` and stopped. Both names survive a weight change, a
 * candidate-knob flip and a rebuild, so a comparison of two arms could not
 * establish that both arms played the bot their manifest named — which is what
 * invalidated the potion measurements rather than merely weakening them. So:
 * `botId` addresses the configuration and moves when any behaviour-relevant
 * knob moves; `behaviourId` addresses the build.
 *
 * BINDING. Production had no binding site at all: the live process resolved
 * its own module default, so one process played one bot for every game and
 * every seat, selecting a validated member meant editing that default and
 * redeploying, and an operator's dial excursion persisted nowhere. So: a
 * per-(game, centaur) lookup at the decision seam, sourced from the existing
 * `config_store` table, validated through `checkWeights`, refusing loudly and
 * falling through to the default.
 *
 * Everything below runs on fake ports: no Firebase, no Postgres.
 */

import { canonicalOf, botIdOf, type BotSpec } from '../config/bot-identity';
import { behaviourIdFrom, BUILD_COMMIT_ENV_VARS } from '../config/build-identity';
import {
  BOT_CATALOG_KEY,
  BOT_CENTAUR_KEY_PREFIX,
  BOT_DEFAULT_KEY,
  BOT_GAME_KEY_PREFIX,
  BUILTIN_BOTS,
  BotRegistry,
  DEFAULT_BOT_NAME,
  defaultBotSpecFrom,
  parseBotSpec,
} from '../config/bot-binding';
import { DEFAULT_PROFILE, MATERIAL_ONLY_PROFILE } from '../lobster/evaluate';
import { clearGeometryCache } from '../lobster/substrate';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';
import type { LensDecision } from '../lens/types';
import type { TurnData } from '../server/active-game-manager';
import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';

// ------------------------------------------------------------------ identity

const spec = (over: Partial<BotSpec> = {}): BotSpec => ({
  name: 'a',
  engine: 'lobster',
  profile: DEFAULT_PROFILE,
  ...over,
});

describe('botId addresses the CONFIGURATION', () => {
  test('the same config derives the same id — no coordination required', () => {
    // Two independently built objects, as two processes reading one manifest
    // would have. The id is a function of content, so they agree.
    expect(botIdOf(spec())).toBe(botIdOf(spec()));
    expect(botIdOf(spec())).toMatch(/^lobster:lobster-territory@[0-9a-f]{12}$/);
  });

  test('any behaviour-relevant knob change changes it', () => {
    const base = botIdOf(spec());
    // A candidate knob.
    expect(botIdOf(spec({ candidates: { gainOrdering: false } }))).not.toBe(base);
    // The staging-safety level.
    expect(botIdOf(spec({ stagingSafety: 'full' }))).not.toBe(base);
    // A single weight, moved by a tenth. This is the change every earlier
    // measurement was blind to: same engine name, same profile name.
    const nudged = {
      ...DEFAULT_PROFILE,
      weights: { ...DEFAULT_PROFILE.weights, material: DEFAULT_PROFILE.weights.material + 0.1 },
    };
    expect(botIdOf(spec({ profile: nudged }))).not.toBe(base);
    // And the reach horizon, which is not a weight at all.
    expect(botIdOf(spec({ profile: { ...DEFAULT_PROFILE, reachHorizonTurns: 9 } }))).not.toBe(base);
  });

  test('the operator label is NOT part of it — a rename is not a new bot', () => {
    expect(botIdOf(spec({ name: 'arm-a' }))).toBe(botIdOf(spec({ name: 'arm-b' })));
  });

  test('two bots that differ only in profile NAME are still two bots', () => {
    const renamed = { ...DEFAULT_PROFILE, name: 'lobster-territory' };
    expect(botIdOf(spec({ profile: renamed }))).toBe(botIdOf(spec()));
    const relabelled = { ...DEFAULT_PROFILE, name: 'something-else' };
    expect(botIdOf(spec({ profile: relabelled }))).not.toBe(botIdOf(spec()));
  });

  test('canonicalisation is order-free and drops absent members', () => {
    expect(canonicalOf({ a: 1, b: 2 })).toBe(canonicalOf({ b: 2, a: 1 }));
    expect(canonicalOf({ a: 1 })).toBe(canonicalOf({ a: 1, c: undefined }));
    // ...but not present-and-different ones.
    expect(canonicalOf({ a: 1 })).not.toBe(canonicalOf({ a: 1, c: null }));
  });
});

describe('behaviourId addresses the BUILD', () => {
  const sources = (env: NodeJS.ProcessEnv, version: string | null, dist: string | null) => ({
    env,
    packageVersion: () => version,
    distDigest: () => dist,
  });

  test('a published commit wins, and every variable a host injects is read', () => {
    for (const name of BUILD_COMMIT_ENV_VARS) {
      expect(behaviourIdFrom(sources({ [name]: 'ABCDEF0123456789' }, '1.0.0', 'dd'))).toBe(
        'git:abcdef012345'
      );
    }
  });

  test('with no commit, the compiled output is hashed instead', () => {
    expect(behaviourIdFrom(sources({}, '1.0.0', 'deadbeefcafe'))).toBe(
      'pkg:1.0.0+dist:deadbeefcafe'
    );
  });

  test('running from source says so rather than claiming an identity', () => {
    expect(behaviourIdFrom(sources({}, '1.0.0', null))).toBe('pkg:1.0.0+dist:none');
    expect(behaviourIdFrom(sources({}, null, null))).toBe('unknown');
  });

  test('an empty variable is not a commit', () => {
    expect(behaviourIdFrom(sources({ GIT_COMMIT: '' }, '1.0.0', null))).toBe('pkg:1.0.0+dist:none');
  });
});

// ------------------------------------------------------------------- parsing

describe('a stored binding is refused loudly rather than half-applied', () => {
  test('a weight table the fold has no feature for is refused, naming the key', () => {
    const parsed = parseBotSpec(
      {
        name: 'typo',
        profile: {
          name: 'typo',
          weights: { ...DEFAULT_PROFILE.weights, materal: 10 },
          reachHorizonTurns: 4,
        },
      },
      BUILTIN_BOTS
    );
    expect('error' in parsed).toBe(true);
    expect('error' in parsed && parsed.error).toContain('materal');
  });

  test('a weight table that OMITS a folded feature is refused too', () => {
    const weights = { ...DEFAULT_PROFILE.weights };
    delete (weights as Record<string, number>).material;
    const parsed = parseBotSpec(
      { name: 'partial', profile: { name: 'partial', weights, reachHorizonTurns: 4 } },
      BUILTIN_BOTS
    );
    // Not zero — it would have folded at the feature author's own default,
    // silently, which is the whole reason checkWeights exists.
    expect('error' in parsed && parsed.error).toContain('material');
  });

  test('malformed values are named, not coerced', () => {
    const cases: Array<[unknown, string]> = [
      ['no-such-bot', 'no bot named'],
      [{ name: 'x' }, 'must name a "bot" or carry a "profile"'],
      [{ bot: 'material-only', candidates: { gainOrdering: 'yes' } }, 'must be a boolean'],
      [{ bot: 'material-only', candidates: { notAKnob: true } }, 'not a candidate knob'],
      [{ bot: 'material-only', stagingSafety: 'sometimes' }, 'stagingSafety must be one of'],
      [{ bot: 'material-only', engine: 'crab' }, 'engine must be one of'],
      [
        { name: 'x', profile: { name: 'x', weights: { material: 'lots' }, reachHorizonTurns: 4 } },
        'must be a finite number',
      ],
      [
        { name: 'x', profile: { name: 'x', weights: {}, reachHorizonTurns: -1 } },
        'reachHorizonTurns must be a non-negative integer',
      ],
    ];
    for (const [raw, expected] of cases) {
      const parsed = parseBotSpec(raw, BUILTIN_BOTS);
      expect('error' in parsed).toBe(true);
      expect('error' in parsed && parsed.error).toContain(expected);
    }
  });

  test('a catalog member plus a dial excursion is a valid binding', () => {
    const parsed = parseBotSpec(
      { bot: 'lobster-territory', candidates: { gainOrdering: false, keepQuiet: 4 } },
      BUILTIN_BOTS
    );
    expect('spec' in parsed).toBe(true);
    if (!('spec' in parsed)) return;
    expect(parsed.spec.profile).toBe(DEFAULT_PROFILE);
    expect(parsed.spec.candidates).toEqual({ gainOrdering: false, keepQuiet: 4 });
    // And it is a DIFFERENT bot from the one it was derived from.
    expect(botIdOf(parsed.spec)).not.toBe(botIdOf(BUILTIN_BOTS['lobster-territory']));
  });
});

// ------------------------------------------------------------------ registry

const registryOn = (
  entries: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
  logs: string[] = []
) =>
  new BotRegistry({
    read: async () => entries,
    env,
    log: (m) => logs.push(m),
    behaviourId: () => 'test-build',
    stagingSafety: () => 'auto',
    ttlMs: Number.POSITIVE_INFINITY,
  });

describe('the binding source: most specific wins, default is the floor', () => {
  test('an empty store plays exactly what shipped', async () => {
    const registry = registryOn({});
    await registry.refresh();
    const binding = registry.resolveFor('g1', 'centaur-1');
    expect(binding.source).toBe('env-default');
    expect(binding.key).toBeNull();
    expect(binding.spec.profile).toBe(BUILTIN_BOTS[DEFAULT_BOT_NAME].profile);
  });

  test('game beats centaur beats store default beats env', async () => {
    const registry = registryOn({
      [BOT_DEFAULT_KEY]: 'material-only',
      [`${BOT_CENTAUR_KEY_PREFIX}c1`]: 'lobster-territory-a',
      [`${BOT_GAME_KEY_PREFIX}g1`]: 'lobster-territory',
    });
    await registry.refresh();
    expect(registry.resolveFor('g1', 'c1').source).toBe('game');
    expect(registry.resolveFor('g1', 'c1').spec.name).toBe('lobster-territory');
    expect(registry.resolveFor('g2', 'c1').source).toBe('centaur');
    expect(registry.resolveFor('g2', 'c1').key).toBe(`${BOT_CENTAUR_KEY_PREFIX}c1`);
    expect(registry.resolveFor('g2', 'c2').source).toBe('store-default');
    expect(registry.resolveFor('g2', 'c2').spec.name).toBe('material-only');
  });

  test('TWO CENTAUR TEAMS, TWO BOTS — the thing one process could not do', async () => {
    const registry = registryOn({
      [`${BOT_CENTAUR_KEY_PREFIX}red`]: 'lobster-territory',
      [`${BOT_CENTAUR_KEY_PREFIX}blue`]: 'material-only',
    });
    await registry.refresh();
    const red = registry.resolveFor('g1', 'red');
    const blue = registry.resolveFor('g1', 'blue');
    expect(red.identity.botId).not.toBe(blue.identity.botId);
  });

  test('an invalid binding is refused, recorded, and falls through', async () => {
    const logs: string[] = [];
    const registry = registryOn(
      {
        [`${BOT_GAME_KEY_PREFIX}g1`]: {
          name: 'broken',
          profile: { name: 'broken', weights: { nonsense: 1 }, reachHorizonTurns: 4 },
        },
      },
      {},
      logs
    );
    await registry.refresh();
    const binding = registry.resolveFor('g1', 'c1');
    // Not partially applied and not silently applied: the default plays.
    expect(binding.source).toBe('env-default');
    expect(logs.some((m) => m.includes('REFUSED') && m.includes('bot.game.g1'))).toBe(true);
    // And an operator can see WHY without shelling into the server.
    expect(registry.warnings().some((w) => w.startsWith('bot.game.g1:'))).toBe(true);
  });

  test('a store-defined catalog member is bindable by name', async () => {
    const registry = registryOn({
      [BOT_CATALOG_KEY]: {
        'quiet-arm': { bot: 'lobster-territory', candidates: { gainOrdering: false } },
      },
      [`${BOT_GAME_KEY_PREFIX}g1`]: 'quiet-arm',
    });
    await registry.refresh();
    const binding = registry.resolveFor('g1', 'c1');
    expect(binding.spec.name).toBe('quiet-arm');
    expect(binding.spec.candidates).toEqual({ gainOrdering: false });
    expect(Object.keys(registry.catalog())).toContain('quiet-arm');
  });

  test('a resolved binding is COMPLETE: the inherited safety level is filled in', async () => {
    // Two deployments running one stored binding under different flags are two
    // bots, and the id has to say so.
    const auto = registryOn({ [BOT_DEFAULT_KEY]: 'material-only' });
    await auto.refresh();
    const full = new BotRegistry({
      read: async () => ({ [BOT_DEFAULT_KEY]: 'material-only' }),
      env: {},
      log: () => undefined,
      behaviourId: () => 'test-build',
      stagingSafety: () => 'full',
      ttlMs: Number.POSITIVE_INFINITY,
    });
    await full.refresh();
    expect(auto.resolveFor('g', 'c').spec.stagingSafety).toBe('auto');
    expect(auto.resolveFor('g', 'c').identity.botId).not.toBe(
      full.resolveFor('g', 'c').identity.botId
    );
  });

  test('an unreadable store keeps the bindings it had', async () => {
    const logs: string[] = [];
    let entries: Record<string, unknown> = { [BOT_DEFAULT_KEY]: 'material-only' };
    let fail = false;
    const registry = new BotRegistry({
      read: async () => {
        if (fail) throw new Error('connection refused');
        return entries;
      },
      env: {},
      log: (m) => logs.push(m),
      behaviourId: () => 'test-build',
      stagingSafety: () => 'auto',
      ttlMs: Number.POSITIVE_INFINITY,
    });
    await registry.refresh();
    fail = true;
    entries = {};
    await registry.refresh();
    // A transport blip must not silently re-bind every live game mid-experiment.
    expect(registry.resolveFor('g', 'c').spec.name).toBe('material-only');
    expect(logs.some((m) => m.includes('keeping the previous set'))).toBe(true);
  });

  test('only bindingFor records what a game played; resolveFor observes nothing', async () => {
    const registry = registryOn({});
    await registry.refresh();
    expect(registry.observedFor('g1')).toBeNull();
    registry.resolveFor('g1', 'c1');
    expect(registry.observedFor('g1')).toBeNull();
    registry.bindingFor('g1', 'c1');
    expect(registry.observedFor('g1')?.source).toBe('env-default');
    registry.release('g1');
    expect(registry.observedFor('g1')).toBeNull();
  });

  test('CENTAUR_BOT names a built-in; a typo keeps the default and says so', () => {
    const logs: string[] = [];
    expect(defaultBotSpecFrom({ CENTAUR_BOT: 'material-only' }).name).toBe('material-only');
    expect(defaultBotSpecFrom({ CENTAUR_BOT: 'materal-only' }, (m) => logs.push(m)).name).toBe(
      DEFAULT_BOT_NAME
    );
    expect(logs[0]).toContain('no such built-in bot');
  });
});

// -------------------------------------------------------------- the seam

function makeSnake(id: string, body: Coord[], teamID: string): Snake {
  return {
    id,
    name: `Snake ${id}`,
    latency: '0',
    health: 90,
    body,
    head: body[0] as Coord,
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#cc2222', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    teamID,
  } as Snake;
}

const TURN = 5;

const board = (): Board =>
  ({
    width: 7,
    height: 7,
    food: [{ x: 3, y: 3 }],
    hazards: [],
    snakes: [
      makeSnake('s1', [{ x: 1, y: 1 }, { x: 1, y: 0 }], 'red'),
      makeSnake('e1', [{ x: 5, y: 5 }, { x: 5, y: 6 }], 'blue'),
    ],
  }) as Board;

const viewFor = (b: Board, id: string): GameState => ({
  game: { id: 'g1', ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 500, source: 't' },
  turn: TURN,
  board: b,
  you: b.snakes.find((s) => s.id === id) as Snake,
});

interface Staged {
  readonly move: CentaurMove;
  readonly turnData: TurnData;
}

/**
 * THE STAMP IS OBSERVED ON THE LENS, which is where it now lives.
 *
 * It used to be read off `logDecision` — one telemetry row per unit per turn,
 * carrying a `decision` block with the bot's two addresses on it. That port is
 * gone with the row path it fed: nothing consumed it in production, and the
 * account it was an account of moved to the `movesets` projection and
 * `unit_outcomes`. What replaces it as the stamp's carrier is `lensSink`,
 * which is asked ONCE per decision with the basis the decision actually built
 * — so this test now watches the shipped path rather than a port with no
 * other reader.
 */
function fakePorts(binding?: TeamDecisionPorts['botBinding']): TeamDecisionPorts & {
  staged: Staged[];
  declared: LensDecision[];
} {
  const staged: Staged[] = [];
  const declared: LensDecision[] = [];
  return {
    staged,
    declared,
    setBotRecommendation: (_g, _s, move, turnData) => {
      staged.push({ move, turnData });
    },
    enableTeamStaging: () => undefined,
    onPinEvent: () => () => undefined,
    pinSnakeIdOf: () => null,
    lensSink: (_gameId, _turn, decision) => {
      declared.push(decision);
      return { frame: () => undefined, end: () => undefined };
    },
    botBinding: binding,
    log: () => undefined,
  };
}

/**
 * A DELIBERATELY SMALL BUDGET. These three cases ask who the decision says it
 * is, not how well it played, so they need a settled decision and nothing
 * more. Jest runs suites in parallel and the timed games in
 * `basic-intelligence.test.ts` are measuring wall clock beside this one — a
 * suite that burns a full second of search to assert a string makes THAT
 * suite flaky.
 */
const decide = (engine: TeamDecisionEngine, b: Board) =>
  engine.decideTurn({
    gameId: 'g1',
    turn: TURN,
    board: b,
    ourTeamId: 'red',
    units: [{ snakeId: 's1', view: viewFor(b, 's1') }],
    deadlineMs: Date.now() + 90,
  });

describe('the decision seam stamps the bot it actually played', () => {
  afterAll(() => clearGeometryCache());

  test('a bound bot reaches the lens, the UI frame, and agrees with the binding', async () => {
    const registry = registryOn({ [`${BOT_GAME_KEY_PREFIX}g1`]: 'material-only' });
    await registry.refresh();
    const bound = registry.resolveFor('g1', 'red');
    const ports = fakePorts((gameId, centaurId) => registry.bindingFor(gameId, centaurId));
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 10, sliceMs: 5 } });
    await decide(engine, board());

    expect(ports.declared.length).toBeGreaterThan(0);
    for (const declared of ports.declared) {
      // The decision says WHICH configuration it is, and it is the one the
      // store bound — not the process default the engine used to reach for on
      // its own.
      expect(declared.input.botId).toBe(bound.identity.botId);
      expect(declared.input.botId).toBe(botIdOf(bound.spec));
      expect(declared.input.behaviourId).toBe('test-build');
      // The old two names are still there; they are simply no longer the only
      // thing a reader has.
      expect(declared.engine).toBe('lobster');
      expect(declared.profile).toBe(MATERIAL_ONLY_PROFILE.name);
    }
    // And the live UI is told the same thing, on every frame it is told a move.
    expect(ports.staged.length).toBeGreaterThan(0);
    for (const s of ports.staged) {
      expect(s.turnData.bot?.botId).toBe(bound.identity.botId);
      expect(s.turnData.bot?.behaviourId).toBe('test-build');
    }
    // The registry now knows what this game actually played.
    expect(registry.observedFor('g1')?.identity.botId).toBe(bound.identity.botId);
  }, 30_000);

  test('with no binding source the engine still stamps — the process default', async () => {
    const ports = fakePorts();
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 10, sliceMs: 5 } });
    await decide(engine, board());
    expect(ports.declared.length).toBeGreaterThan(0);
    for (const declared of ports.declared) {
      // Unwired is not unstamped: the floor is a real bot with a real address.
      expect(declared.input.botId).toMatch(/^lobster:lobster-territory@[0-9a-f]{12}$/);
      expect(declared.input.behaviourId.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('a binding source that throws costs the default, not the turn', async () => {
    const ports = fakePorts(() => {
      throw new Error('store on fire');
    });
    const engine = new TeamDecisionEngine(ports, { kernel: { reserveMs: 10, sliceMs: 5 } });
    const result = await decide(engine, board());
    expect(result.report).not.toBeNull();
    expect(ports.declared.length).toBeGreaterThan(0);
    expect(ports.declared[0]?.input.botId).toContain('lobster-territory');
  }, 30_000);
});
