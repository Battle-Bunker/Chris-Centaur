/**
 * THE POTION-AWARE SLATE, END TO END — a bot that reads potions, selected by
 * configuration, staging a different move from the one that does not.
 *
 * ── WHAT THIS GATE IS FOR ──────────────────────────────────────────────────
 *
 * The four potion evaluator entries were merged and named by no slate, so no
 * `BotConfig` could seat a bot that reasons about potions: every potions-on
 * game the program had played was played by a potion-unaware bot, and the
 * potion arms in the roster were unrunnable rather than merely unrun. Adding
 * the slate is worth nothing if selecting it cannot be shown to change a
 * decision, so what is asserted here is exactly that — two engines, one board,
 * one seed, two different staged moves — plus the two things that must NOT
 * change with it: the default bot, and the sound bounds.
 */

import type { Board, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import type { PinEvent } from '../lobster/contracts';
import {
  TeamDecisionEngine,
  type TeamDecisionPorts,
  type TeamTurnResult,
} from '../lobster/team-decision-engine';
import {
  LEGACY_SLATE,
  POTION_AWARE_SLATE,
  REGISTRY,
  SLATE_LEGACY,
  SLATE_POTION_AWARE,
  slateFor,
} from '../lobster/registry';
import { botConfigFromJson } from '../lobster/bot-config';
import { defaultEvaluator } from '../lobster/evaluate';
import { evaluatorForSlate } from '../lobster/evaluate/potion-lineup';

const WALL = 1_000_000;
const BUDGET_MS = 250;
const TURN = 12;

/** A step clock: elapsed time is a pure function of how many times the code
 * under test looked at it, so the two arms below get the same decision length
 * whatever the machine is doing. */
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
 * THE BOARD — an 11×11 with one uncollected potion at (6, 7), one knight step
 * from a knight that cannot afford to stand still.
 *
 *   OURS (red)  · `c`, a KNIGHT at (5, 5). Its own square is covered along row
 *                 5 by the enemy rook, so standing still — which is the
 *                 shipped evaluator's preferred piece move, because
 *                 `healthEconomy` is a linear travel tax and the territory
 *                 terms are flat over a piece's own position — is not the free
 *                 option it usually is. That is what puts the knight's EIGHT
 *                 DESTINATIONS into one floor-tie class, and the floor-tie
 *                 class is the only thing an advisory term may reorder.
 *               · `q`, a QUEEN at (8, 1) — the ARMED ALLY. It is what makes the
 *                 pickup worth anything at all: the collector goes to −1 and
 *                 can cut nothing, so `potionSeek` prices exactly the enemy
 *                 body weight the LIVING TEAMMATES could sever at +1, and a
 *                 window with nobody to cut with is worth zero.
 *
 *   THEIRS      · `e`, a four-cell blue trail unit along row 9 — the BODY.
 *                 A sever at occupancy index `i` removes `length − i` weight
 *                 from its owner, so a body is what the gain is denominated in
 *                 and a board with none makes every potion term zero by rule.
 *               · `R`, a blue rook at (10, 5), covering the knight's square.
 *               · `E`, a blue king at (10, 0), out of the way.
 *
 * THE POTION AT (6, 7) is one knight move from (5, 5). Travel is what the term
 * is sensitive to and it needs no distance coefficient to be: a collector `t`
 * turns away collects on turn `T + t`, and `attackWindow` prices a cut landed
 * `k` turns out at `weight − i − k`, because a trail unit's body slides one
 * index along every turn. The movement rule does the discounting, so the same
 * potion is worth more from one square than from another, and the eight
 * destinations of a floor-tied knight are eight different prices for it.
 */
const BOARD: Board = {
  width: 11,
  height: 11,
  food: [],
  hazards: [],
  invulnerabilityPotions: [{ x: 6, y: 7 }],
  snakes: [
    piece('c', { x: 5, y: 5 }, 'knight', 1, 'red'),
    piece('q', { x: 8, y: 1 }, 'queen', 3, 'red'),
    piece('R', { x: 10, y: 5 }, 'rook', 3, 'blue'),
    makeSnake(
      'e',
      [
        { x: 9, y: 9 },
        { x: 8, y: 9 },
        { x: 7, y: 9 },
        { x: 6, y: 9 },
      ],
      { teamID: 'blue' }
    ),
    piece('E', { x: 10, y: 0 }, 'king', 1, 'blue'),
  ],
} as Board;

/**
 * WHAT THE TWO BOTS STAGE, in the engine's own full-board cell indices (the
 * grid is 13 × 13 — the 11 × 11 wire board plus its perimeter wall — so
 * `cell = (y + 1) * 13 + (x + 1)` against a wire `y` counted from the top).
 *
 *   `c:69` — the DEFAULT bot: engine (4, 5), wire (3, 6). A knight move away
 *            from the potion, chosen among the eight by the shipped `est`.
 *   `c:59` — the POTION-AWARE bot: engine (7, 4), wire (6, 7) — THE POTION
 *            CELL ITSELF. The lineup prices the pickup that opens the queen's
 *            window three turns earlier than any other destination does.
 *
 * The queen agrees (`q:140`, engine (10, 10), wire (9, 1)) in both bots, which
 * is the shape the gate wants: ONE unit's move moves, so the difference is
 * attributable rather than diffuse.
 */
const DEFAULT_STAGED = ['c:69', 'q:140'];
const POTION_AWARE_STAGED = ['c:59', 'q:140'];

const OUR_UNITS = ['c', 'q'];

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

/** One decision by one configured bot, on the board above. Both clocks are
 * faked and the match seed is pinned, so the only difference between two calls
 * is the bot. */
async function decide(
  bot: Record<string, unknown>
): Promise<{ result: TeamTurnResult; staged: ReadonlyArray<string> }> {
  const ports = fakePorts();
  const engine = new TeamDecisionEngine(ports, {
    kernel: { reserveMs: 20, sliceMs: 10 },
    bot: botConfigFromJson(bot),
    matchSeed: 0x1abe1,
  });
  const result = await engine.decideTurn({
    gameId: `potion-${String(bot.name ?? 'x')}`,
    turn: TURN,
    board: BOARD,
    ourTeamId: 'red',
    units: OUR_UNITS.map((snakeId) => ({ snakeId, view: viewFor(snakeId) })),
    deadlineMs: WALL + BUDGET_MS,
  });
  return { result, staged: [...ports.staged] };
}

// ---------------------------------------------------------------- the slate

describe('the potion-aware slate is a second member of the evaluator collection', () => {
  test('it resolves, and it is the shipped lineup plus the four potion terms', () => {
    const resolved = REGISTRY.resolve(slateFor(SLATE_POTION_AWARE));
    expect(resolved.slateId).toBe(SLATE_POTION_AWARE);
    // Four sockets are the legacy entries, unchanged: the question this slate
    // asks is about the evaluator frame, so a result from it attributes to the
    // potion terms rather than to a second simultaneous change.
    expect(resolved.moveSelectors.map((e) => e.id)).toEqual(LEGACY_SLATE.moveSelectors);
    expect(resolved.evaluatorSelector.id).toBe(LEGACY_SLATE.evaluatorSelector);
    expect(resolved.aggregator.id).toBe(LEGACY_SLATE.aggregator);
    expect(resolved.scheduler.id).toBe(LEGACY_SLATE.scheduler);
    // The evaluator list LEADS with the production profile — the one entry
    // that still proves every bound — and the advisory four follow it.
    expect(resolved.evaluators.map((e) => e.id)).toEqual([
      'eval/legacy-territory@1',
      'eval/attack-window@2',
      'eval/potion-seek@3',
      'eval/potion-control@2',
      'eval/dodge-discount@2',
    ]);
    expect(resolved.evaluators[0]?.soundness).toBe('sound-writing');
    for (const e of resolved.evaluators.slice(1)) expect(e.soundness).toBe('advisory');
  });

  test('the legacy slate is untouched, and the default evaluator is the SAME OBJECT', () => {
    // Not an equal one. The bound bank's evaluation memo keys on
    // `evaluationIdentity` and `evaluatorSpecOf` decides worker eligibility by
    // identity, so a fresh-but-equal evaluator would be a change with no
    // behaviour attached and one more thing for the byte-identity gates to be
    // surprised by.
    const legacy = REGISTRY.resolve(slateFor(SLATE_LEGACY));
    expect(evaluatorForSlate(legacy.evaluators.map((e) => e.id))).toBe(defaultEvaluator);
    const aware = REGISTRY.resolve(slateFor(SLATE_POTION_AWARE));
    const potionEval = evaluatorForSlate(aware.evaluators.map((e) => e.id));
    expect(potionEval).not.toBe(defaultEvaluator);
    // THE FRAME IS THE SAME FRAME. An advisory lineup adds no feature to the
    // fold and changes no weight in it, so the bounds a potion-aware bot proves
    // are the bounds the default bot proves.
    expect(potionEval.profile).toBe(defaultEvaluator.profile);
    expect(potionEval.features).toBe(defaultEvaluator.features);
    expect(potionEval.advisory.map((t) => t.key)).toEqual([
      'eval/attack-window@2',
      'eval/potion-seek@3',
      'eval/potion-control@2',
      'eval/dodge-discount@2',
    ]);
  });

  test('a slate is selected by configuration and in no other way', () => {
    expect(botConfigFromJson({ slate: SLATE_POTION_AWARE }).slate).toBe(SLATE_POTION_AWARE);
    // Unnamed is the shipped bot, which is what the byte-identity gates assert.
    expect(botConfigFromJson({}).slate).toBe(SLATE_LEGACY);
    expect(() => slateFor('greedy-voi' as typeof SLATE_LEGACY)).toThrow(/unknown slate/);
  });
});

// ----------------------------------------------------------- the live gate

describe('the potion-aware bot decides differently on a potion board', () => {
  test('two bots, one board, one seed: the staged move differs', async () => {
    const plain = await decide({ name: 'default' });
    const aware = await decide({ name: 'potion-aware', slate: SLATE_POTION_AWARE });

    // Both decided. A staging failure on either side would make the
    // comparison below vacuously true.
    expect(plain.staged.length).toBeGreaterThan(0);
    expect(aware.staged.length).toBeGreaterThan(0);
    expect(plain.result.mechanism?.slate.slate).toBe(SLATE_LEGACY);
    expect(aware.result.mechanism?.slate.slate).toBe(SLATE_POTION_AWARE);
    // The stamp names the entries that actually resolved, which is what a
    // measurement attaches to under the identity law.
    expect(aware.result.mechanism?.slate.evaluators).toEqual(POTION_AWARE_SLATE.evaluators);

    // THE GATE. Same board, same seed, same clock, different lineup, different
    // decision. Pinned to the exact staged sets rather than merely asserted
    // unequal: "these two differ" passes just as well when the potion-aware bot
    // has gone wrong in some new way, and what is being gated is that it goes
    // TO THE POTION.
    expect(plain.staged).toEqual(DEFAULT_STAGED);
    expect(aware.staged).toEqual(POTION_AWARE_STAGED);
    expect(aware.staged).not.toEqual(plain.staged);
    // And the difference is ONE unit's move — the collector's — which is what
    // makes it attributable to the term that priced the collector.
    expect(aware.staged[1]).toBe(plain.staged[1]);
  }, 60_000);

  test('the lineup reaches the comparator, and only through the est slot', async () => {
    // ENGAGEMENT, SEPARATELY FROM EFFECT. `better()` reads `est` only after the
    // depth channel and the floor comparison have both declined to decide, so a
    // null from this slate could mean the terms said nothing OR that they were
    // never reached. The adjudication counters tell those apart: the shipped
    // bot's `est` slot never fires on this board (every residual comparison is
    // an exact est tie broken by the salted key), and the potion-aware bot's
    // does. That is the lineup speaking, in the one slot it is allowed to.
    const plain = await decide({ name: 'default' });
    const aware = await decide({ name: 'potion-aware', slate: SLATE_POTION_AWARE });
    const p = plain.result.mechanism?.adjudication;
    const a = aware.result.mechanism?.adjudication;
    expect(p).not.toBeUndefined();
    expect(a).not.toBeUndefined();
    if (p === undefined || p === null || a === undefined || a === null) {
      throw new Error('unreachable');
    }
    expect(p.estDecided).toBe(0);
    expect(a.estDecided).toBeGreaterThan(0);
    // THE FLOOR IS THE SAME FLOOR. An advisory term is clamped inside the
    // interval the sound features proved, so it cannot add a floor-decided
    // comparison, remove one, or turn a refusal into an acceptance.
    expect(a.floorDecided).toBe(p.floorDecided);
    expect(a.vetoed).toBe(p.vetoed);
    expect(a.refused).toBe(p.refused);
  }, 60_000);

  test('a potion-aware bot on a potion-FREE board stages what the default does', async () => {
    // The gates are the claim: with no potion standing and no live window,
    // every term returns zero having read one bitboard, so the lineup is
    // arithmetically inert. A slate that moved a decision on a board with
    // nothing for it to read would be reading something else.
    const noPotions = { ...BOARD, invulnerabilityPotions: [] } as Board;
    const run = async (bot: Record<string, unknown>): Promise<ReadonlyArray<string>> => {
      const ports = fakePorts();
      const engine = new TeamDecisionEngine(ports, {
        kernel: { reserveMs: 20, sliceMs: 10 },
        bot: botConfigFromJson(bot),
        matchSeed: 0x1abe1,
      });
      await engine.decideTurn({
        gameId: `nopotion-${String(bot.name ?? 'x')}`,
        turn: TURN,
        board: noPotions,
        ourTeamId: 'red',
        units: OUR_UNITS.map((snakeId) => ({
          snakeId,
          view: {
            game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
            turn: TURN,
            board: noPotions,
            you: noPotions.snakes.find((s) => s.id === snakeId) as Snake,
          } as unknown as GameState,
        })),
        deadlineMs: WALL + BUDGET_MS,
      });
      return [...ports.staged];
    };
    expect(await run({ name: 'potion-aware', slate: SLATE_POTION_AWARE })).toEqual(
      await run({ name: 'default' })
    );
  }, 60_000);
});
