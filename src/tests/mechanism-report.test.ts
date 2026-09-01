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
import { DEFAULT_SCOUT_TUNING } from '../lobster/search/scout';

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
 * The bot is a value now (`lobster/bot-config.ts`) and NOTHING this file cares
 * about reaches the environment any more. The five search-layer variables that
 * used to be listed here are gone with the search-layer teardown: two of them
 * guarded machinery that always runs, and three became bot fields.
 *
 * The list stays as an EMPTY list and `decide` keeps setting whatever it is
 * handed, because the tests below are exactly the assertions that setting a
 * variable changes nothing — and that assertion needs a way to set one.
 */
const FLAG_ENVS: ReadonlyArray<string> = [];

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
        'edgeEv',
        'potionOrdering',
        'multistartSeed',
        'sampledCap',
        'depthPlyCap',
        'clusterEnum',
        // THE TWO ENUMERATION RATIONS. `clusterEnum` says whether the pass ran
        // at all; these two say what it was allowed to SPEND, which is the
        // question batch 2 could not ask of any configuration. They are stamped
        // beside the `cluster.cells` / `cluster.worstClusterCells` rows that
        // measure what the spend bought, because a cost row read without the
        // ration it ran under is a number nobody can attribute.
        'maxClusterCells',
        'maxClustersSolved',
      ].sort()
    );

    // The bot this branch ships — `potion-intel`, not `default`. The stamp's
    // job is to name what actually ran, and on `feature/potion-intel` what runs
    // by default is the potion-intelligent bot (owner ruling 41); the parent
    // branch's bot is a named config and is stamped as one.
    expect(m.config.name).toBe('potion-intel');
    expect(m.config.engine).toBe('lobster');
    expect(m.config.territoryRefine).toBe(false);
    expect(m.config.unitFatality).toBe(false);
    expect(m.config.workers).toBe(0);
    expect(m.config.edgeEv).toBe(false);
    // TRUE ON THIS BRANCH. `candidates.potionOrdering` sorts a pickup as a gain
    // in the candidate order, and the branch default takes it: the parent's own
    // measurement is +55% pickups and +42% window severs for no evaluator cost.
    // The stamp's job is to name what ran, and what runs here is that.
    expect(m.config.potionOrdering).toBe(true);
    expect(m.config.multistartSeed).toBe(false);
    expect(m.config.sampledCap).toBe(false);
    // DEPTH IS NOT AN ARM. What the stamp carries is its RATION, and the
    // shipped bot takes the default ply ceiling whole.
    expect(m.config.depthPlyCap).toBe(DEFAULT_SCOUT_TUNING.plyCap);
    // THE ENUMERATION IS ON IN THE SHIPPED BOT, and the stamp says so. An arm
    // that turns it off carries depth off with it, so the row a reader needs is
    // this one and not a depth row.
    expect(m.config.clusterEnum).toBe(true);
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
    // The claim is that the ENVIRONMENT moved nothing, so what is asserted is
    // the branch's own default rather than a literal that would have to change
    // twice for the same reason.
    expect(m.config.name).toBe('potion-intel');
    expect(m.config.engine).toBe('lobster');
    expect(m.config.territoryRefine).toBe(false);
    expect(m.config.unitFatality).toBe(false);
    expect(m.config.workers).toBe(0);
    expect(m.config.stagingSafety).not.toBe('off');
  }, 20_000);

  test('THE SEARCH FLAGS ARE DEAD TOO — setting them by their old names does nothing', async () => {
    // THE A/A-NULL-WEARING-A-NAME TRAP, closed rather than detected. These five
    // parsed only `1|on|true` and warned on nothing, so a mistyped `yes` was a
    // control arm wearing a treatment's name and the stamp was the only way to
    // find out afterwards. They no longer exist: two guarded machinery that
    // always runs, three are bot fields, and a bot field is VALIDATED rather
    // than coerced (`botConfigFromJson` throws on an unknown key and on a
    // non-boolean). Setting every one of them, correctly spelled, leaves the
    // shipped bot exactly where it was.
    const { result } = await decide({
      CENTAUR_CLUSTER_SEED: 'on',
      CENTAUR_MULTISTART_SEED: 'on',
      CENTAUR_EDGE_EV: 'on',
      CENTAUR_CLUSTER_ENUM: 'on',
      CENTAUR_SAMPLED_CAP: 'on',
      CENTAUR_SCOUT: 'advise',
    });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.edgeEv).toBe(false);
    // TRUE ON THIS BRANCH. `candidates.potionOrdering` sorts a pickup as a gain
    // in the candidate order, and the branch default takes it: the parent's own
    // measurement is +55% pickups and +42% window severs for no evaluator cost.
    // The stamp's job is to name what ran, and what runs here is that.
    expect(m.config.potionOrdering).toBe(true);
    expect(m.config.multistartSeed).toBe(false);
    expect(m.config.sampledCap).toBe(false);
    expect(m.config.depthPlyCap).toBe(DEFAULT_SCOUT_TUNING.plyCap);
    // THE ENUMERATION IS ON IN THE SHIPPED BOT, and the stamp says so. An arm
    // that turns it off carries depth off with it, so the row a reader needs is
    // this one and not a depth row.
    expect(m.config.clusterEnum).toBe(true);
  }, 20_000);

  test('with every layer off, a layer that never ran reports NULL, not zero', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    // The distinction the P5 anomaly turned on: "the arm never engaged" is a
    // different finding from "the arm engaged and did nothing".
    expect(m.selection).toBeNull();
    // MACHINERY, NOT AN ARM: the cluster enumeration and the depth layer
    // always run on a board that admits them, so their reports are present.
    // That is the whole difference between machinery and a candidate strategy,
    // and it is asserted rather than assumed.
    expect(m.cluster).not.toBeNull();
    expect(m.scout).not.toBeNull();
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
  test('the enumeration publishes its coverage/cost pair unconditionally', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.cluster).not.toBeNull();
    // The coverage/cost pair CL3 §7 asks a promotion sweep to weigh.
    expect(m.cluster?.clusters).toBeGreaterThanOrEqual(0);
    expect(m.cluster?.jointsEnumerated).toBeGreaterThanOrEqual(0);
    expect(m.cluster?.enumMs).toBeGreaterThanOrEqual(0);
  }, 20_000);

  test('sampledCap ON publishes the seed the harness replays from', async () => {
    const { result } = await decide({}, { bot: { sampledCap: true } });
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
    const { result } = await decide({}, { bot: { sampledCap: true } });
    const journal = result.report?.journal ?? [];
    expect(journal.length).toBeGreaterThan(0);
    const last = journal[journal.length - 1];
    expect(last?.selection).toBeDefined();
    expect(typeof last?.selection?.matchSeed).toBe('number');
    expect(last?.scout).toBeDefined();
    expect(last?.scout?.gatedBy).toBeDefined();
  }, 20_000);

  test('the depth layer publishes its accounting, and an honest horizon', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.scout).not.toBeNull();
    // A door that refused every board must read as a refusal, not as a zero —
    // CL6a's own correction, and the reason `refusals` is on the report.
    expect(m.scout?.refusals).toBeDefined();
    expect(m.scout?.plies).toBeGreaterThanOrEqual(0);
    // MEASURED TURNS OF PLAY, never a configured ceiling and never the `?? 1`
    // a missing view used to fall back to.
    expect(m.scout?.deepestPlies).toBeGreaterThanOrEqual(0);
    // And the belief row says whether any of it was load-bearing.
    expect(typeof m.belief?.depthChangedStaging).toBe('boolean');
    expect(m.belief?.deciding).toBe(true);
  }, 20_000);

  /**
   * THE LOOP ROW — the column whose absence let a batch conclude the depth
   * layer was dead.
   *
   * `cluster`, `scout` and the acute focus all hang off one call
   * (`search/core.ts::clusterOf`) which only `improve` makes, so a reader who
   * sees three nulls and no loop counters cannot tell "the board admitted no
   * partition" from "the loop never ran a full slice". Both are real states
   * and they call for opposite responses. The counters were on `KernelReport`
   * the whole time; what was missing is that the MECHANISM report — the object
   * a sweep manifest folds — did not carry them.
   *
   * Permanent, and asserted for PRESENCE and CONSISTENCY rather than for a
   * value: how many slices a decision buys is a property of the box.
   */
  test('the refinement loop publishes its counters, and they agree with the kernel', async () => {
    const { result } = await decide({});
    const m = result.mechanism;
    const report = result.report;
    if (m === null || report === null) throw new Error('no report');
    expect(m.loop).not.toBeNull();
    expect(m.loop?.slices).toBe(report.slices);
    expect(m.loop?.improveCalls).toBe(report.improveCalls);
    expect(m.loop?.refineCalls).toBe(report.refineCalls);
    expect(m.loop?.conformCalls).toBe(report.conformCalls);
    expect(m.loop?.idleSlices).toBe(report.idleSlices);
    expect(m.loop?.leverOrderBinding).toBe(report.leverOrderBinding);
    // Every slice went somewhere: the two rungs partition them.
    expect((m.loop?.improveCalls ?? 0) + (m.loop?.refineCalls ?? 0)).toBeLessThanOrEqual(
      m.loop?.slices ?? 0
    );
    // The shipped search core exposes no refiner surface, so the lever order is
    // advisory and `refineCalls` is zero BY CONSTRUCTION — which is only
    // legible because the two fields are published together.
    expect(m.loop?.leverOrderBinding).toBe(false);
    expect(m.loop?.refineCalls).toBe(0);
  }, 20_000);

  test('a bot that rations depth to zero buys no plies, and says so', async () => {
    const { result } = await decide({}, { bot: { name: 'shallow', depth: { plyCap: 0 } } });
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.name).toBe('shallow');
    expect(m.config.depthPlyCap).toBe(0);
    // Not a dark path: the layer ran, the report exists, the purse bought
    // nothing.
    expect(m.scout).not.toBeNull();
    expect(m.scout?.deepened).toBe(0);
    expect(m.scout?.observations).toBe(0);
    expect(m.belief?.deepestPlies).toBe(1);
  }, 20_000);
});
