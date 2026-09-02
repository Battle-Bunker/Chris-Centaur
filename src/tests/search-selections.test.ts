/**
 * `BotConfig.search` — the two selections a bot makes inside the search, and
 * the rows a sweep reads them off.
 *
 * ── WHY THESE TWO GATES ────────────────────────────────────────────────────
 *
 * `search.clusterEnum: false` is a BUDGET arm: the cluster-factored exact
 * enumeration is ~20% of a piece board's whole decision budget and no
 * configuration could price what that 20% buys, because `depth.plyCap = 0`
 * stops the deep threads and leaves the enumeration pass running. The arm is
 * only worth having if it can be shown to (a) engage and (b) be legible on the
 * report as an arm rather than as a board the layer never reached — which is
 * the null-versus-zero distinction the mechanism report exists to keep.
 *
 * The multi-start rows are the other half of the same discipline. That layer's
 * stated benefit is OPENING DIVERSITY and its first live reading measured
 * end-state share instead, so the claim was never tested. These two rows are
 * the claim, per decision: how spread the selected opening is against the
 * stage-0 baseline it was sampled from, and how much the pooled starts
 * actually disagreed.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import {
  TeamDecisionEngine,
  type TeamDecisionPorts,
  type TeamTurnResult,
} from '../lobster/team-decision-engine';
import { botConfigFromJson } from '../lobster/bot-config';

const WALL = 1_000_000;
const BUDGET_MS = 250;
const TURN = 14;

class StepClock {
  private t = 1_000;
  readonly now = (): number => {
    const v = this.t;
    this.t += 0.02;
    return v;
  };
}

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

/**
 * A board with enough of OUR units to make a partition worth building and a
 * multi-start worth sampling: four trail units plus a piece, so the
 * enumeration has components to find and the sampler has slots to vary.
 */
const BOARD: Board = {
  width: 11,
  height: 11,
  food: [{ x: 5, y: 5 }],
  hazards: [],
  snakes: [
    makeSnake('a', [
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ], { teamID: 'red' }),
    makeSnake('b', [
      { x: 4, y: 2 },
      { x: 4, y: 1 },
    ], { teamID: 'red' }),
    makeSnake('c', [
      { x: 2, y: 6 },
      { x: 1, y: 6 },
    ], { teamID: 'red' }),
    piece('p', { x: 6, y: 2 }, 'rook', 2, 'red'),
    makeSnake('x', [
      { x: 8, y: 8 },
      { x: 8, y: 7 },
    ], { teamID: 'blue' }),
    piece('K', { x: 9, y: 3 }, 'king', 1, 'blue'),
  ],
} as Board;

const OUR_UNITS = ['a', 'b', 'c', 'p'];

const viewFor = (snakeId: string): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: TURN,
    board: BOARD,
    you: BOARD.snakes.find((s) => s.id === snakeId) as Snake,
  }) as unknown as GameState;

function fakePorts(): TeamDecisionPorts & { staged: string[] } {
  const clock = new StepClock();
  const staged: string[] = [];
  return {
    staged,
    setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
      staged.push(`${snakeId}:${String(move)}`);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_g: string, _s: (ev: PinEvent, turn?: number) => void) => () => undefined,
    pinSnakeIdOf: () => null,
    now: () => WALL,
    monotonic: clock.now,
    log: () => undefined,
  } as unknown as TeamDecisionPorts & { staged: string[] };
}

async function decide(
  bot: Record<string, unknown>,
  tag: string
): Promise<{ result: TeamTurnResult; staged: ReadonlyArray<string> }> {
  const ports = fakePorts();
  const engine = new TeamDecisionEngine(ports, {
    kernel: { reserveMs: 20, sliceMs: 10 },
    bot: botConfigFromJson(bot),
    matchSeed: 0xc0ffee,
  });
  const result = await engine.decideTurn({
    gameId: tag,
    turn: TURN,
    board: BOARD,
    ourTeamId: 'red',
    units: OUR_UNITS.map((snakeId) => ({ snakeId, view: viewFor(snakeId) })),
    deadlineMs: WALL + BUDGET_MS,
  });
  return { result, staged: [...ports.staged] };
}

// ------------------------------------------------------ search.clusterEnum

describe('search.clusterEnum: a bot can decline the enumeration pass', () => {
  test('the shipped bot enumerates, and says so on the report', async () => {
    const { result } = await decide({ name: 'default' }, 'enum-on');
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.clusterEnum).toBe(true);
    // The default bot on this board reaches the layer and pays for it.
    expect(m.cluster).not.toBeNull();
    expect(m.cluster?.jointsEnumerated ?? 0).toBeGreaterThan(0);
  }, 60_000);

  test('the disabled bot reports ZERO cluster joints, not null', async () => {
    const { result, staged } = await decide(
      { name: 'no-enum', search: { clusterEnum: false } },
      'enum-off'
    );
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.clusterEnum).toBe(false);
    // ZERO AND NOT NULL, and the distinction is the gate. Null means "the
    // layer never ran" — a board that admitted no partition — and an ingest
    // folding this arm into that reading would report a configured budget
    // refusal as a board the layer could not reach.
    expect(m.cluster).not.toBeNull();
    expect(m.cluster?.jointsEnumerated).toBe(0);
    expect(m.cluster?.jointsBeforeShrink).toBe(0);
    expect(m.cluster?.proposals).toBe(0);
    expect(m.cluster?.clusters).toBe(0);
    expect(m.cluster?.enumMs).toBe(0);
    // THE DEPENDENCY, VISIBLE ON THE SAME REPORT. The scout's threads are
    // rooted at the enumeration's proposals and it has no other seed, so this
    // arm carries depth off with it — and says which, in words, rather than
    // presenting a depthless decision as depth having found nothing.
    expect(m.scout?.gatedBy ?? null).toMatch(/clusterEnum/);
    expect(m.scout?.threads ?? 0).toBe(0);
    // And it still decides: a refusal to spend is not a refusal to play.
    expect(staged.length).toBeGreaterThan(0);
  }, 60_000);

  test('the field is validated on the way in, and unset is the shipped bot', () => {
    expect(botConfigFromJson({}).search).toEqual({});
    expect(botConfigFromJson({ search: { clusterEnum: false } }).search.clusterEnum).toBe(false);
    expect(() => botConfigFromJson({ search: { plyCap: 0 } })).toThrow(/search\.plyCap/);
  });
});

// ----------------------------------------------- the multistart instrument

describe('multistart publishes its own claim: opening separation and diversity', () => {
  test('no rows at all unless the layer is selected', async () => {
    const { result } = await decide({ name: 'default' }, 'ms-off');
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.multistartSeed).toBe(false);
    // Null, not zeroed rows: the layer never ran, and an opening separation of
    // zero would be a measurement of something.
    expect(m.multistart).toBeNull();
  }, 60_000);

  test('selected, every decision carries both rows', async () => {
    const { result } = await decide({ name: 'multistart', multistartSeed: true }, 'ms-on');
    const m = result.mechanism;
    if (m === null) throw new Error('no mechanism report');
    expect(m.config.multistartSeed).toBe(true);
    const ms = m.multistart;
    expect(ms).not.toBeNull();
    if (ms === null) throw new Error('unreachable');

    // OWN-TEAM SEPARATION, in cells, for the plan the sampler selected and for
    // the stage-0 baseline it was sampled from. The PAIR is the reading: one
    // number says how spread this opening is, and only the difference says
    // whether the sampler spread it.
    expect(Number.isFinite(ms.openingSeparation)).toBe(true);
    expect(Number.isFinite(ms.stage0Separation)).toBe(true);
    expect(ms.openingSeparation).toBeGreaterThan(0);
    expect(ms.stage0Separation).toBeGreaterThan(0);
    // Four of our units on an 11×11 board: a mean pairwise Manhattan distance
    // cannot exceed the board's own diameter, so a row outside this range is a
    // unit-conversion bug rather than a diverse opening.
    expect(ms.openingSeparation).toBeLessThanOrEqual(BOARD.width + BOARD.height);

    // STAGED-ASSIGNMENT DIVERSITY ACROSS THE STARTS — the chance two distinct
    // pooled starts assign the same unit a different option, in [0, 1].
    expect(ms.startDiversity).toBeGreaterThanOrEqual(0);
    expect(ms.startDiversity).toBeLessThanOrEqual(1);
    // THE ROWS ARE THE DECISION'S OPENING, not its last slice. The seed runs
    // on every slice, but only the rung-0 call — from a null incumbent, every
    // unit still free — actually samples; a later slice has nothing left to
    // vary and would publish `variables: 0`, `pooled: 0`, `startDiversity: 0`
    // whatever the sampler had found. So these two assertions are the gate on
    // WHICH call the report describes, not merely on the layer having run.
    expect(ms.variables).toBeGreaterThan(0);
    expect(ms.pooled).toBeGreaterThan(1);
    expect(ms.samples).toBeGreaterThan(0);
    // With more than one distinct start in the pool the diversity is a real
    // reading rather than the degenerate zero of a pool of one.
    expect(ms.startDiversity).toBeGreaterThan(0);
  }, 60_000);
});
