/**
 * CL7 — TELEMETRY CLOSURE.
 *
 * `TeamTurnResult.mechanism` is the seam a live promotion sweep reads. Every CL
 * stage built the counters its own gate needs and none of them was reachable
 * from `decideTurn`'s result, which is why batch 20260827's P5 cell had to
 * report `CENTAUR_WASM` as "null placement, engagement UNVERIFIED".
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
import { UNIT_FATALITY_ENV } from '../lobster/candidates';
import { EDGE_EV_ENV } from '../lobster/search/edge-ev';
import { SAMPLED_CAP_ENV } from '../lobster/selection';
import { TERRITORY_REFINE_ENV } from '../lobster/evaluate';
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
 * THE FLAGS ARE SET ON `process.env`, NOT ON `ports.env`, AND THAT IS THE
 * POINT.
 *
 * `ports.env` reaches the wire's write interval, the worker count and the WASM
 * default. It does NOT reach the six search-side flags or the two candidate
 * knobs: `clusterSeedEnabled()`, `clusterEnumEnabled()`,
 * `territoryRefineEnabled()`, `sampledCapEnabled()`, `scoutMode()` and
 * `flaggedKnobs()` all read `process.env` directly. The stamp reads the same
 * source its consumers read, so a test that set `ports.env` would prove the
 * stamp agreed with a value nothing ran on.
 */
const FLAG_ENVS = [
  CLUSTER_SEED_ENV,
  MULTISTART_SEED_ENV,
  UNIT_FATALITY_ENV,
  EDGE_EV_ENV,
  CLUSTER_ENUM_ENV,
  SAMPLED_CAP_ENV,
  TERRITORY_REFINE_ENV,
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
  test('every promotable flag has a row, and the row is what the ENGINE resolved', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    expect(m).not.toBeNull();
    if (m === null) throw new Error('unreachable');

    // The twelve promotable flags plus the two already-promoted ones the
    // exploration slice needs. Named exhaustively on purpose: a stage that
    // adds a flag and forgets the stamp makes an unauditable arm, and this
    // list is what fails when that happens.
    expect(Object.keys(m.flags).sort()).toEqual(
      [
        'clusterEnum',
        'clusterSeed',
        'edgeEv',
        'multistartSeed',
        'gainOrdering',
        'sampledCap',
        'scout',
        'stagingSafety',
        'territoryRefine',
        'tierTruth',
        'unitFatality',
        'wasm',
        'workers',
      ].sort()
    );

    // Shipped defaults, on an empty environment.
    expect(m.flags.clusterSeed).toBe(false);
    expect(m.flags.unitFatality).toBe(false);
    expect(m.flags.edgeEv).toBe(false);
    expect(m.flags.clusterEnum).toBe(false);
    expect(m.flags.sampledCap).toBe(false);
    expect(m.flags.territoryRefine).toBe(false);
    expect(m.flags.scout).toBe('off');
    expect(m.flags.wasm).toBe('off');
    // `gainOrdering` was PROMOTED at integ/round-a and ships on.
    expect(m.flags.gainOrdering).toBe(true);
    // `auto` is board-conditional; this board bears pieces, so it resolves on.
    expect(m.flags.stagingSafety).not.toBe('auto');
  }, 20_000);

  test('a per-engine option wins over the environment, and the stamp says so', async () => {
    // The env says ON for both CL1 flags; the engine option says OFF for one.
    // A batch manifest's env capture would report both as treatment. The stamp
    // reports what actually ran, which is the quantity the verdict needs.
    const env = { [CLUSTER_SEED_ENV]: 'on', [UNIT_FATALITY_ENV]: 'on' };
    const { result } = await decide(env, { clusterSeed: false });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.flags.clusterSeed).toBe(false);
    expect(m.flags.unitFatality).toBe(true);
  }, 20_000);

  test('a MISTYPED flag value reads as off — the A/A-null-wearing-a-name trap', async () => {
    // Every CL flag parses only `1|on|true` and warns on nothing. `yes` and
    // `ON` are off. The sim kit's P7 comment names this trap; the stamp is
    // what makes it detectable after the fact instead of never.
    const { result } = await decide({
      [CLUSTER_SEED_ENV]: 'yes',
      [UNIT_FATALITY_ENV]: 'ON',
      [EDGE_EV_ENV]: 'enabled',
      [CLUSTER_ENUM_ENV]: '0',
      [SAMPLED_CAP_ENV]: 'TRUE',
      [TERRITORY_REFINE_ENV]: 'y',
      [SCOUT_ENV]: 'yes',
    });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.flags.clusterSeed).toBe(false);
    expect(m.flags.unitFatality).toBe(false);
    expect(m.flags.edgeEv).toBe(false);
    expect(m.flags.clusterEnum).toBe(false);
    expect(m.flags.sampledCap).toBe(false);
    expect(m.flags.territoryRefine).toBe(false);
    expect(m.flags.scout).toBe('off');
  }, 20_000);

  test('with every flag off, a layer that never ran reports NULL, not zero', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    // The distinction the P5 anomaly turned on: "the arm never engaged" is a
    // different finding from "the arm engaged and did nothing".
    expect(m.cluster).toBeNull();
    expect(m.selection).toBeNull();
    expect(m.scout).toBeNull();
    // L17's instrument is not flag-gated: adjudication is always published.
    expect(m.adjudication).not.toBeNull();
    expect(m.adjudication?.floorDecided).toBeGreaterThanOrEqual(0);
  }, 20_000);

  test('the WASM arm is legible as ENGAGED or REFUSED, not merely as a flag', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    // Off arm: a workspace exists (the territory evaluator ran), the mode is
    // off, no arena was taken, and neither counter moved. This is the shape
    // that makes an ON arm's `runs: 0` readable as a refusal.
    expect(m.wasm).not.toBeNull();
    expect(m.wasm?.mode).toBe('off');
    expect(m.wasm?.arena).toBe(false);
    expect(m.wasm?.runs).toBe(0);
    expect(m.wasm?.refused).toBe(0);
  }, 20_000);

  test('the report moves nothing: the staged set is what it was without it', async () => {
    // Assembling the report happens after the kernel loop, off the decision
    // path, from state the decision already produced. Two flag-off decisions
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
    expect(m.flags.clusterEnum).toBe(true);
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
    expect(m.flags.sampledCap).toBe(true);
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
    expect(m.flags.scout).toBe('observe');
    expect(m.scout).not.toBeNull();
    // A door that refused every board must read as a refusal, not as a zero —
    // CL6a's own correction, and the reason `refusals` is on the report.
    expect(m.scout?.refusals).toBeDefined();
    expect(m.scout?.plies).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
