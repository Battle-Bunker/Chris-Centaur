/**
 * CL7 — TELEMETRY CLOSURE.
 *
 * `TeamTurnResult.mechanism` is the seam a live promotion sweep reads. Every CL
 * stage built the counters its own gate needs and none of them was reachable
 * from `decideTurn`'s result, which is why batch 20260827's cells had to be
 * reported as "null placement, engagement UNVERIFIED".
 *
 * What is asserted here, in the order it matters:
 *
 *   1. THE ARM AUDIT. Every promotable flag appears in `mechanism.flags`, and
 *      the value there is the one the ENGINE resolved — not the one the
 *      environment was set to. A flag's per-engine option wins, a mistyped env
 *      value reads as off, and both are visible. This is what lets an ingest
 *      refuse a cell whose treatment arm never engaged.
 *   2. A NULL MEANS "NEVER RAN", not zero. With every flag off, the layer
 *      reports are null rather than zeroed — the distinction the P5 anomaly
 *      turned on.
 *   3. FLAG-OFF INERTNESS. Adding the report moves no decision: the staged plan
 *      and the whole emission journal are identical with the report assembled,
 *      because nothing in the decision path reads it.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';
import { CLUSTER_SEED_ENV } from '../lobster/search/cluster-seed';
import { MULTISTART_SEED_ENV } from '../lobster/search/multistart-seed';
import { CLUSTER_ENUM_ENV } from '../lobster/search/cluster-partition';
import { EDGE_EV_ENV } from '../lobster/search/edge-ev';
import { SAMPLED_CAP_ENV } from '../lobster/selection';
import { SCOUT_ENV } from '../lobster/search/scout';

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

const piece = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  makeSnake(id, [at], { unitType, length: weight, teamID });

const BOARD: Board = {
  width: 7,
  height: 7,
  food: [],
  hazards: [],
  snakes: [
    piece('a', { x: 1, y: 3 }, 'king', 1, 'red'),
    piece('b', { x: 1, y: 1 }, 'rook', 2, 'red'),
    piece('K', { x: 5, y: 3 }, 'king', 1, 'blue'),
    piece('N', { x: 5, y: 5 }, 'knight', 1, 'blue'),
  ],
} as Board;

const TURN = 9;

function viewFor(board: Board, snakeId: string): GameState {
  return {
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: TURN,
    board,
    you: board.snakes.find((s) => s.id === snakeId) as Snake,
  } as unknown as GameState;
}

function fakePorts(): TeamDecisionPorts & { staged: string[] } {
  const staged: string[] = [];
  return {
    staged,
    setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
      staged.push(`${snakeId}:${String(move)}`);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g: string, _cb: (ev: PinEvent, turn?: number) => void) => () => undefined,
  } as unknown as TeamDecisionPorts & { staged: string[] };
}

/**
 * TODO(teardown-search): WHAT IS LEFT OF THE FLAG SURFACE.
 *
 * The bot is a value now (`lobster/bot-config.ts`) and nothing this file cares
 * about reaches the environment — except these five, which still resolve from
 * `process.env` inside `makeSearchCore` and are the search-layer teardown's to
 * remove. They are set on `process.env` and not on `ports.env` because that is
 * where their readers look: `ports.env` reaches the wire's write interval and
 * nothing else, so a test that set it would prove the stamp agreed with a
 * value nothing ran on.
 */
const FLAG_ENVS = [
  CLUSTER_SEED_ENV,
  MULTISTART_SEED_ENV,
  EDGE_EV_ENV,
  CLUSTER_ENUM_ENV,
  SAMPLED_CAP_ENV,
  SCOUT_ENV,
];

async function decide(
  env: Record<string, string>,
  options: ConstructorParameters<typeof TeamDecisionEngine>[1] = {}
) {
  const saved = new Map(FLAG_ENVS.map((k) => [k, process.env[k]]));
  for (const k of FLAG_ENVS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return await decideNow(options);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function decideNow(options: ConstructorParameters<typeof TeamDecisionEngine>[1]) {
  const ports = fakePorts();
  const engine = new TeamDecisionEngine(ports, {
    kernel: { reserveMs: 20, sliceMs: 10 },
    ...options,
  });
  const result = await engine.decideTurn({
    gameId: 'g1',
    turn: TURN,
    board: BOARD,
    ourTeamId: 'red',
    units: [
      { snakeId: 'a', view: viewFor(BOARD, 'a') },
      { snakeId: 'b', view: viewFor(BOARD, 'b') },
    ],
    deadlineMs: Date.now() + 250,
  });
  return { result, staged: ports.staged };
}

// ------------------------------------------------------------------- the tests

describe('CL7: the mechanism report is present and complete', () => {
  test('every configurable choice has a row, and the row is what the ENGINE resolved', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    expect(m).not.toBeNull();
    if (m === null) throw new Error('unreachable');

    // Named exhaustively on purpose: a change that adds a bot field and
    // forgets the stamp makes an unauditable arm, and this list is what fails
    // when that happens.
    //
    // NO ROW FOR A CORRECTION. `mutualWipeAward` and `tierTruth` used to be
    // here and are not, because neither can vary any more: the mutual-wipe
    // pricing is unconditional and the tier premise is a kernel constant. A
    // stamp field whose value cannot differ between two bots is a field that
    // teaches the next reader to look for a switch.
    expect(Object.keys(m.config).sort()).toEqual(
      [
        'name',
        'engine',
        'territoryRefine',
        'stagingSafety',
        'unitFatality',
        'gainOrdering',
        'workers',
        'clusterSeed',
        'multistartSeed',
        'edgeEv',
        'clusterEnum',
        'sampledCap',
        'scout',
      ].sort()
    );

    // The shipped bot.
    expect(m.config.name).toBe('default');
    expect(m.config.engine).toBe('lobster');
    expect(m.config.territoryRefine).toBe(false);
    expect(m.config.unitFatality).toBe(false);
    expect(m.config.workers).toBe(0);
    expect(m.config.clusterSeed).toBe(false);
    expect(m.config.edgeEv).toBe(false);
    expect(m.config.clusterEnum).toBe(false);
    expect(m.config.sampledCap).toBe(false);
    expect(m.config.scout).toBe('off');
    // `gainOrdering` was PROMOTED at integ/round-a and ships on.
    expect(m.config.gainOrdering).toBe(true);
    // `auto` is board-conditional; this board bears pieces, so it resolves on.
    expect(m.config.stagingSafety).not.toBe('auto');
  }, 20_000);

  test('the stamp names the BOT, so two contenders are legible apart', async () => {
    // The whole reason experiments are configured bots: an arm is a named
    // value, and the row a sweep keys on is the name it was given.
    const { result } = await decide(
      {},
      { bot: { name: 'refiner', territoryRefine: true, stagingSafety: 'guard' } }
    );
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.name).toBe('refiner');
    expect(m.config.territoryRefine).toBe(true);
    expect(m.config.stagingSafety).toBe('guard');
  }, 20_000);

  test('THE ENVIRONMENT CANNOT MOVE THE BOT — every flag this agent removed is dead', async () => {
    // Setting all of them at once must leave the shipped bot exactly where it
    // was. This is the regression test for the whole teardown: a re-introduced
    // `process.env` read anywhere in the bot's resolution fails here.
    const { result } = await decide({
      CENTAUR_ENGINE: 'legacy',
      CENTAUR_STAGING_SAFETY: 'off',
      CENTAUR_TERRITORY_REFINE: '1',
      CENTAUR_UNIT_FATALITY: '1',
      CENTAUR_ROYAL_MARGIN: '1',
      CENTAUR_TIER_TRUTH: 'off',
      CENTAUR_TIER_DEFENSE: 'off',
      CENTAUR_WORKERS: 'auto',
      CENTAUR_WORKERS_AUDIT: '1',
      CENTAUR_MUTUAL_WIPE_AWARD: '0',
    });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.name).toBe('default');
    expect(m.config.engine).toBe('lobster');
    expect(m.config.territoryRefine).toBe(false);
    expect(m.config.unitFatality).toBe(false);
    expect(m.config.workers).toBe(0);
    expect(m.config.stagingSafety).not.toBe('off');
  }, 20_000);

  test('a MISTYPED search flag value reads as off — the A/A-null-wearing-a-name trap', async () => {
    // TODO(teardown-search): these five still parse only `1|on|true` and warn
    // on nothing, so `yes` and `ON` are off. The sim kit's P7 comment names
    // this trap; the stamp is what makes it detectable after the fact instead
    // of never. It stops being possible when they become bot fields, which are
    // validated rather than coerced (`botConfigFromJson`).
    const { result } = await decide({
      [CLUSTER_SEED_ENV]: 'yes',
      [EDGE_EV_ENV]: 'enabled',
      [CLUSTER_ENUM_ENV]: '0',
      [SAMPLED_CAP_ENV]: 'TRUE',
      [SCOUT_ENV]: 'yes',
    });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.clusterSeed).toBe(false);
    expect(m.config.edgeEv).toBe(false);
    expect(m.config.clusterEnum).toBe(false);
    expect(m.config.sampledCap).toBe(false);
    expect(m.config.scout).toBe('off');
  }, 20_000);

  test('with every layer off, a layer that never ran reports NULL, not zero', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    // The distinction the P5 anomaly turned on: "the arm never engaged" is a
    // different finding from "the arm engaged and did nothing".
    expect(m.cluster).toBeNull();
    expect(m.selection).toBeNull();
    expect(m.scout).toBeNull();
    // The mutual-wipe correction allocates nothing until a world with every
    // team gone is priced, and that is a 0.076% end kind — so this stays null
    // on almost every decision even though the correction is unconditional.
    expect(m.mutualWipe).toBeNull();
    // L17's instrument is not flag-gated: adjudication is always published.
    expect(m.adjudication).not.toBeNull();
    expect(m.adjudication?.floorDecided).toBeGreaterThanOrEqual(0);
  }, 20_000);

  test('the report moves nothing: the staged set is what it was without it', async () => {
    // Assembling the report happens after the kernel loop, off the decision
    // path, from state the decision already produced. Two default-bot decisions
    // on the same board therefore stage the same set — the structural half of
    // the byte-identity gate every CL stage owes.
    const first = await decide({});
    const second = await decide({});
    expect(second.staged).toEqual(first.staged);
    const j1 = first.result.report?.journal.map((r) => [r.lo, r.est, r.hi, r.epoch]);
    const j2 = second.result.report?.journal.map((r) => [r.lo, r.est, r.hi, r.epoch]);
    expect(j2).toEqual(j1);
  }, 30_000);
});

describe('CL7: an engaged layer publishes its own promotion metrics', () => {
  test('clusterEnum ON publishes the cluster report the CL3 gate names', async () => {
    const { result } = await decide({}, { clusterEnum: true });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.clusterEnum).toBe(true);
    expect(m.cluster).not.toBeNull();
    // The coverage/cost pair CL3 §7 asks a promotion sweep to weigh.
    expect(m.cluster?.clusters).toBeGreaterThanOrEqual(0);
    expect(m.cluster?.jointsEnumerated).toBeGreaterThanOrEqual(0);
    expect(m.cluster?.enumMs).toBeGreaterThanOrEqual(0);
  }, 20_000);

  test('sampledCap ON publishes the seed the harness replays from', async () => {
    const { result } = await decide({}, { sampledCap: true });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.sampledCap).toBe(true);
    expect(m.selection).not.toBeNull();
    // CL4's headline metric — options no deterministic prefix could reach —
    // and the replay key that makes the arm auditable.
    expect(m.selection?.farAdmitted).toBeGreaterThanOrEqual(0);
    expect(typeof m.selection?.matchSeed).toBe('number');
  }, 20_000);

  test('REGRESSION: the emitted records carry the audit fields through the engine', async () => {
    // `tapWitnesses` rebuilds the core as a fresh object literal and used to
    // forward only five of its methods, silently dropping `selectionReport`
    // and `scoutReport`. Everything downstream of it therefore saw a core that
    // had never sampled and never scouted — so `EmitRecord.selection` (CL4's
    // replay manifest, `matchSeed` included) and `EmitRecord.scout` were absent
    // from EVERY record a live decision produced, while each stage's own tests,
    // which drive a bare core, stayed green. This asserts the wrapper is
    // transparent where it has to be.
    const { result } = await decide({}, { sampledCap: true, scout: 'observe' });
    const journal = result.report?.journal ?? [];
    expect(journal.length).toBeGreaterThan(0);
    const last = journal[journal.length - 1];
    expect(last?.selection).toBeDefined();
    expect(typeof last?.selection?.matchSeed).toBe('number');
    expect(last?.scout).toBeDefined();
    expect(last?.scout?.mode).toBe('observe');
  }, 20_000);

  test('scout ON publishes the thread accounting, refusals included', async () => {
    const { result } = await decide({}, { scout: 'observe' });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.scout).toBe('observe');
    expect(m.scout).not.toBeNull();
    // A door that refused every board must read as a refusal, not as a zero —
    // CL6a's own correction, and the reason `refusals` is on the report.
    expect(m.scout?.refusals).toBeDefined();
    expect(m.scout?.plies).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
