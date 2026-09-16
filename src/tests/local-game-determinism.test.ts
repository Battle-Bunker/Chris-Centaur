/**
 * THE PROOF THAT THE DETERMINISTIC MODE IS DETERMINISTIC.
 *
 * The local runner is the project's merge bar, and until this mode existed it
 * could not be used to measure anything: budgeted in milliseconds, the same
 * build at the same seed played `mixed` for 1501 unit-turns on one run and
 * 1329 on the next, and the worst single decision swung by 2x. Every counter
 * `basic-intelligence.test.ts` reads is downstream of how much search the box
 * happened to afford, so an A/B on a weight change was measuring the machine.
 *
 * `--nodes` replaces the wall-clock deadline with a work clock (see
 * `DecisionClock` in local-game.ts). What has to be true for that to be worth
 * anything is asserted here, and it is asserted the strict way — the whole
 * JSON summary compared as a STRING, not field by field, so a counter added
 * later is covered without anybody remembering to add it.
 */

import {
  DEFAULT_NODE_BUDGET,
  MIXED_SCENARIO,
  POTION_SCENARIO,
  SNAKE_SCENARIO,
  runGame,
  summaryOf,
  resolveOpponent,
  type Opponent,
} from './local-game';
import { OPPONENT_BOTS, RANDOM_LEGAL } from './opponents';
import { BUILTIN_BOTS } from '../config/bot-binding';
import { clearGeometryCache } from '../lobster/substrate';

jest.setTimeout(180_000);

afterEach(() => clearGeometryCache());

const TURNS = 8;
const SEED = 7;
// Small enough to keep the suite honest about its runtime, large enough that
// the search is doing real work rather than returning the generator's seed —
// at this budget `seedKept` is well under 100%, which is the whole failure
// mode of "just make the budget tiny, then it is reproducible".
const NODES = 300;

async function play(spec: typeof MIXED_SCENARIO, scenario: string, turns: number = TURNS) {
  const result = await runGame(
    { ...spec, maxTurns: turns, seed: SEED, nodeBudget: NODES },
    { scores: false }
  );
  clearGeometryCache();
  return {
    json: JSON.stringify(
      summaryOf(
        result.metrics,
        { label: 'test', scenario, seed: SEED, turnsRequested: turns },
        { kind: 'nodes', nodes: NODES }
      )
    ),
    log: result.log.join('\n'),
  };
}

/** Same as `play`, plus a named opponent for every team but the decider's. */
async function playAgainst(
  spec: typeof MIXED_SCENARIO,
  scenario: string,
  opponent: Opponent,
  turns: number = TURNS,
  /** The seat the default plays. 0 is the run taken before the swap existed. */
  deciderIndex = 0
) {
  const result = await runGame(
    { ...spec, maxTurns: turns, seed: SEED, nodeBudget: NODES },
    { scores: false, opponent, deciderIndex }
  );
  clearGeometryCache();
  return {
    json: JSON.stringify(
      summaryOf(
        result.metrics,
        {
          label: 'test',
          scenario,
          seed: SEED,
          turnsRequested: turns,
          opponent: opponent.name,
          side: deciderIndex,
        },
        { kind: 'nodes', nodes: NODES }
      )
    ),
    log: result.log.join('\n'),
  };
}

/** The summary's counter block, typed the one way these assertions read it. */
const counters = (json: string): Record<string, number> =>
  (JSON.parse(json) as { counters: Record<string, number> }).counters;

describe('the deterministic mode', () => {
  test('two runs of the same board produce a byte-identical JSON summary', async () => {
    const first = await play(MIXED_SCENARIO, 'mixed');
    const second = await play(MIXED_SCENARIO, 'mixed');
    expect(second.json).toBe(first.json);
    // And the traces too: a summary can agree while the game underneath it
    // differs, and it is the game a human reads.
    expect(second.log).toBe(first.log);
    // Not a vacuous pass: the run has to have played and eaten something.
    const summary = JSON.parse(first.json) as {
      counters: { unitTurns: number; meals: number; seedKept: number };
      work: { nodes: number; worstDecisionNodes: number };
      wall?: unknown;
    };
    expect(summary.counters.unitTurns).toBeGreaterThan(40);
    expect(summary.counters.meals).toBeGreaterThan(0);
    // The budget is a budget: no decision spent more than it was given.
    expect(summary.work.worstDecisionNodes).toBeLessThanOrEqual(NODES);
    expect(summary.work.nodes).toBeGreaterThan(NODES);
    // The search is not merely re-staging the generator's first offer, which
    // is what a too-small budget degenerates into.
    expect(summary.counters.seedKept).toBeLessThan(summary.counters.unitTurns);
  });

  test('and of a snake-only board too', async () => {
    const first = await play(SNAKE_SCENARIO, 'snakes');
    const second = await play(SNAKE_SCENARIO, 'snakes');
    expect(second.json).toBe(first.json);
    expect(second.log).toBe(first.log);
  });

  /**
   * The potion board is the one where `settleTurn` earns its keep: with
   * `resolveTurn` under the runner every potion on it was scenery and every
   * tier window was frozen at its observed value for the whole game, so this
   * asserts the rules are actually running — and that they run identically
   * twice, which the effect schedule and the seeded respawn both have to obey.
   */
  test('the potion board collects potions, moves tiers, and does it identically twice', async () => {
    // Long enough that a collection lands with a living ally, so the ally's
    // tier-up is observable as well as the collector's tier-down; the engine
    // now rewrites facing every turn, which moved the first pickup later.
    const first = await play(POTION_SCENARIO, 'potions', 16);
    const second = await play(POTION_SCENARIO, 'potions', 16);
    expect(second.json).toBe(first.json);
    expect(second.log).toBe(first.log);
    const summary = JSON.parse(first.json) as {
      counters: { potionPickups: number; potionTierUps: number; potionTierDowns: number };
    };
    expect(summary.counters.potionPickups).toBeGreaterThan(0);
    // The pickup rule is inverted — the collector pays a tier and its allies
    // are paid one — so a board that collects anything must show both.
    expect(summary.counters.potionTierUps).toBeGreaterThan(0);
    expect(summary.counters.potionTierDowns).toBeGreaterThan(0);
  });

  test('and a potion-free board reports no potion activity at all', async () => {
    const { json } = await play(MIXED_SCENARIO, 'mixed');
    const summary = JSON.parse(json) as { counters: Record<string, number> };
    expect(summary.counters.potionPickups).toBe(0);
    expect(summary.counters.potionTierUps).toBe(0);
    expect(summary.counters.potionTierDowns).toBe(0);
    expect(summary.counters.deathsWhileDebuffed).toBe(0);
    expect(summary.counters.deathsWhileBuffed).toBe(0);
  });

  test('the summary carries no wall-clock reading — that is what makes it comparable', async () => {
    const { json } = await play(MIXED_SCENARIO, 'mixed');
    expect(JSON.parse(json).wall).toBeUndefined();
    expect(json).not.toContain('Ms');
  });

  /**
   * STRATEGY DIVERSITY, DETERMINISTICALLY. `--opponent` breaks the mirror —
   * every team but team 0 plays a different profile — and it has to keep the
   * SAME determinism guarantee the mirror mode does, or an A/B run against it
   * would be measuring the machine again exactly like the ms mode did.
   */
  describe('the opponent profile', () => {
    test('plays deterministically too: two runs are byte-identical', async () => {
      const opponent = resolveOpponent('material-only');
      const first = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      const second = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      expect(second.json).toBe(first.json);
      expect(second.log).toBe(first.log);
    });

    test('and of a snake-only board too', async () => {
      const opponent = resolveOpponent('material-only');
      const first = await playAgainst(SNAKE_SCENARIO, 'snakes', opponent);
      const second = await playAgainst(SNAKE_SCENARIO, 'snakes', opponent);
      expect(second.json).toBe(first.json);
      expect(second.log).toBe(first.log);
    });

    test('names itself in the JSON summary — a mirror run carries no such field', async () => {
      const opponent = resolveOpponent('material-only');
      const { json } = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      const summary = JSON.parse(json) as { opponent?: string };
      expect(summary.opponent).toBe('material-only');

      const mirror = await play(MIXED_SCENARIO, 'mixed');
      expect(JSON.parse(mirror.json).opponent).toBeUndefined();
      expect(mirror.json).not.toContain('"opponent"');
    });

    test('actually changes what the non-decider teams play — not a no-op flag', async () => {
      const mirror = await play(MIXED_SCENARIO, 'mixed');
      const against = await playAgainst(MIXED_SCENARIO, 'mixed', resolveOpponent('material-only'));
      // Not a claim about which is BETTER — see docs/ORCHESTRATOR-LOOP.md on
      // over-optimising against a mirror — only that the profile was really
      // read: a decision made against a materially different evaluator is
      // extremely unlikely to reproduce the mirror's play byte for byte.
      expect(against.json).not.toBe(mirror.json);
    });

    test('is selected and validated through the bot-binding catalog, not a second lookup', () => {
      expect(resolveOpponent('lobster-territory').name).toBe('lobster-territory');
      expect(resolveOpponent('lobster-territory-a').name).toBe('lobster-territory-a');
      expect(resolveOpponent('material-only').name).toBe('material-only');
    });

    /**
     * THE BENCH (`./opponents.ts`) resolves through the same seam and is
     * therefore subject to the same check. `parseBotSpec` ends in
     * `checkWeights`, so a bench table that forgot a feature key or named one
     * the fold has no feature for fails HERE rather than folding silently at
     * some feature author's default weight for a whole round-robin.
     */
    test('every bench profile resolves, and therefore passes checkWeights', () => {
      for (const name of Object.keys(OPPONENT_BOTS)) {
        expect(resolveOpponent(name).name).toBe(name);
      }
      // Not vacuous: the bench has to actually contain the four tables
      // docs/design/OPPONENTS.md is written about.
      expect(Object.keys(OPPONENT_BOTS).sort()).toEqual([
        'aggressive',
        'cautious',
        'glutton',
        'territorial',
      ]);
    });

    /**
     * The bench is played AGAINST; it is not bindable. `BUILTIN_BOTS` is the
     * catalog a stored `bot.*` row may name, i.e. the set a live production
     * game can be made to play, and none of these belongs in it.
     */
    test('but no bench profile is bindable in production', () => {
      for (const name of Object.keys(OPPONENT_BOTS)) {
        expect(BUILTIN_BOTS[name]).toBeUndefined();
      }
      expect(BUILTIN_BOTS[RANDOM_LEGAL]).toBeUndefined();
    });

    test('refuses a name outside that catalog, naming what does exist', () => {
      // No `greedy-food` profile exists — the flag says so by way of the
      // catalog it lists, rather than silently falling back to the default or
      // inventing one. (`cautious` used to be the second example here and is
      // now a bench member, which is why it is not.)
      expect(() => resolveOpponent('greedy-food')).toThrow(/material-only/);
      expect(() => resolveOpponent('lobster-terrritory')).toThrow(/aggressive/);
    });

    /**
     * THE FLOOR OF COMPETENCE. `random-legal` is not a weight table and makes
     * no evaluator call, so the two things worth asserting are that it is
     * still reproducible — a draw from an unseeded generator would make every
     * counter in a matchup a fact about the machine — and that its draws do
     * not come out of the game's own stream, which drives food respawn.
     */
    test('the random-legal policy plays deterministically too', async () => {
      const opponent = resolveOpponent(RANDOM_LEGAL);
      expect(opponent.policy).toBe(RANDOM_LEGAL);
      const first = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      const second = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      expect(second.json).toBe(first.json);
      expect(second.log).toBe(first.log);
      // It really is a different player: uniform draws do not reproduce the
      // search's play, and the opponent's units never keep a generator seed
      // they never asked for.
      const mirror = await play(MIXED_SCENARIO, 'mixed');
      expect(first.json).not.toBe(mirror.json);
      expect(counters(first.json).theirsSeedKept).toBe(0);
      expect(counters(first.json).oursSeedKept).toBeGreaterThan(0);
    });
  });

  /**
   * THE COLOUR SWAP. Every matchup number in `docs/design/OPPONENTS.md` is
   * taken from both seats, because these boards are not symmetric — different
   * rosters, asymmetric food, and a turn loop that decides teams in
   * alphabetical order. What has to hold for the swap to mean anything is
   * that seat 0 is untouched by its existence and that seat 1 is a genuinely
   * different game.
   */
  describe('the colour swap', () => {
    test('seat 0 is the run that was always taken — the flag adds no field', async () => {
      const { json } = await play(MIXED_SCENARIO, 'mixed');
      // The TOP-LEVEL field, asked of the parsed object rather than of the
      // text: the endgame instrument's `outcome` block carries a `side` of its
      // own, so a substring search would fire on that and prove nothing about
      // the summary's own shape.
      const summary = JSON.parse(json) as Record<string, unknown>;
      expect(summary.side).toBeUndefined();
      // `decider` was the bench's own name for this field before the two
      // merged. It is an ALIAS at the call sites and nowhere in the JSON:
      // one seat index, one spelling on the wire.
      expect(summary.decider).toBeUndefined();
      expect(json).not.toContain('"decider"');
    });

    test('seat 1 names itself and plays a different game', async () => {
      const opponent = resolveOpponent('material-only');
      const seat0 = await playAgainst(MIXED_SCENARIO, 'mixed', opponent);
      const seat1 = await playAgainst(MIXED_SCENARIO, 'mixed', opponent, TURNS, 1);
      expect(JSON.parse(seat0.json).side).toBeUndefined();
      expect(JSON.parse(seat1.json).side).toBe(1);
      expect(seat1.log).not.toBe(seat0.log);
      // And "ours" followed the default to its new seat: on `mixed` red has
      // three units and blue has three, so the two seats' own unit-turn counts
      // are both nonzero and the split is not degenerate.
      expect(counters(seat1.json).oursUnitTurns).toBeGreaterThan(0);
      expect(counters(seat1.json).theirsUnitTurns).toBeGreaterThan(0);
    });

    test('a seat outside the roster is refused, not clamped to 0', async () => {
      await expect(
        runGame({ ...MIXED_SCENARIO, maxTurns: 2, seed: SEED, nodeBudget: NODES }, {
          scores: false,
          side: 3,
        })
      ).rejects.toThrow(/outside this scenario's roster/);
      // …and through the alias too, because that is the name the round-robin
      // passes and a check that only guards one spelling guards nothing.
      await expect(
        runGame({ ...MIXED_SCENARIO, maxTurns: 2, seed: SEED, nodeBudget: NODES }, {
          scores: false,
          deciderIndex: 3,
        })
      ).rejects.toThrow(/outside this scenario's roster/);
    });

    /**
     * `deciderIndex` IS AN ALIAS AND NOTHING ELSE. `side` is the canonical
     * option (the endgame instrument's), `deciderIndex` is the name the
     * opponent bench and `scripts/round-robin.sh` were written against, and
     * the whole content of "alias" is that the two produce the SAME GAME.
     * Two names that drift apart would be worse than either name alone.
     */
    test('deciderIndex is an alias for side — same game, and disagreement is refused', async () => {
      const opponent = resolveOpponent('material-only');
      const viaSide = await runGame(
        { ...MIXED_SCENARIO, maxTurns: TURNS, seed: SEED, nodeBudget: NODES },
        { scores: false, opponent, side: 1 }
      );
      clearGeometryCache();
      const viaAlias = await runGame(
        { ...MIXED_SCENARIO, maxTurns: TURNS, seed: SEED, nodeBudget: NODES },
        { scores: false, opponent, deciderIndex: 1 }
      );
      clearGeometryCache();
      expect(viaAlias.log.join('\n')).toBe(viaSide.log.join('\n'));
      expect(viaAlias.metrics.oursUnitTurns).toBe(viaSide.metrics.oursUnitTurns);
      expect(viaAlias.metrics.outcome).toEqual(viaSide.metrics.outcome);

      await expect(
        runGame({ ...MIXED_SCENARIO, maxTurns: 2, seed: SEED, nodeBudget: NODES }, {
          scores: false,
          side: 0,
          deciderIndex: 1,
        })
      ).rejects.toThrow(/alias for `side`/);
    });
  });

  /**
   * THE SIDE SPLIT is a PARTITION of the board-wide counters, not a second
   * measurement of them. If it ever stops adding up, every ours/theirs number
   * in `docs/design/OPPONENTS.md` is wrong by an unknown amount.
   */
  test('the ours/theirs counters partition the board-wide ones', async () => {
    const { json } = await playAgainst(
      MIXED_SCENARIO,
      'mixed',
      resolveOpponent('territorial')
    );
    const c = counters(json);
    expect(c.oursUnitTurns + c.theirsUnitTurns).toBe(c.unitTurns);
    expect(c.oursSeedKept + c.theirsSeedKept).toBe(c.seedKept);
    expect(c.oursMeals + c.theirsMeals).toBe(c.meals);
    expect(c.oursDeaths + c.theirsDeaths).toBe(c.starvationDeaths + c.otherDeaths);
    expect(c.oursSurvivors + c.theirsSurvivors).toBe(c.survivors);
    expect(c.teamsOurs).toBe(1);
    expect(c.teamsTheirs).toBe(2);
    // The outcome proxy is a real reading and not a zero left in the struct.
    expect(c.oursWeight).toBeGreaterThan(0);
    expect(c.theirsWeight).toBeGreaterThan(0);
  });

  test('the ms mode still reports its wall clock, and is still the default', async () => {
    const result = await runGame(
      { ...MIXED_SCENARIO, maxTurns: 3, seed: SEED, budgetMs: 30 },
      { scores: false }
    );
    const summary = summaryOf(
      result.metrics,
      { label: 'test', scenario: 'mixed', seed: SEED, turnsRequested: 3 },
      { kind: 'ms', ms: 30 }
    );
    expect(summary.mode).toBe('ms');
    expect(summary.wall?.worstDecisionMs).toBeGreaterThanOrEqual(0);
  });

  test('the default budget is the calibrated one, not an accident', () => {
    expect(DEFAULT_NODE_BUDGET).toBe(550);
  });
});
