/**
 * THE SIDE ASYMMETRY, PINNED — `docs/design/SIDE-ASYMMETRY.md`.
 *
 * The finding this guards: the measurement corpus is biased, and the bias is
 * in the ROSTER, not in the runner and not in the engine. Mirror self-play —
 * the identical profile on every team, so no bot difference is possible — has
 * slot 1 winning `mixed` 8/8 at a mean lead of +28.75 and slot 0 winning 0/8
 * at -35.13; swap the two teams' unit lists and the result swaps with them
 * (red 8/8 at +32.25, blue 0/8 at -36.63). The win follows the UNITS.
 *
 * Three things have to stay true for that reading to keep holding, and none
 * of them is checked anywhere else:
 *
 *  1. The five baseline specs never change. Every A/B record in
 *     `docs/design/ab/` is a paired diff against their side-0 play, and a spec
 *     edit would silently invalidate all of them. Pinned by hash, so ANY edit
 *     trips it — including one that looks harmless.
 *  2. The hand-symmetric controls are actually symmetric. They are the boards
 *     on which a side difference would be a fact about the BUILD rather than
 *     about the roster, and a control that has quietly stopped being fair is
 *     worse than no control at all.
 *  3. `--side` does not touch a mirror game. With no `--opponent` every team
 *     plays the same profile, so the slot picks which team the outcome is
 *     READ for and nothing else — which is what makes every mirror counter in
 *     `WEIGHT-SWEEP.md` and the audits side-independent rather than side-0.
 */

import { createHash } from 'crypto';
import {
  BASELINE_SCENARIOS,
  DEFAULT_NODE_BUDGET,
  MIRROR_SCENARIOS,
  SCENARIOS,
  buildBoard,
  runGame,
  summaryOf,
  type GameSpec,
} from './local-game';
import { clearGeometryCache } from '../lobster/substrate';

jest.setTimeout(180_000);

afterEach(() => clearGeometryCache());

const hashOf = (spec: GameSpec): string =>
  createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);

/**
 * THE FIVE OLD BOARDS, BYTE FOR BYTE.
 *
 * Not a fairness assertion — these boards are NOT fair, and that is the
 * finding. It is a promise that they will not be repaired in place: the whole
 * A/B corpus is pinned to their side-0 play, and the fix for their unfairness
 * is the `mirror-*` controls beside them plus the both-colours rule, never an
 * edit here. A failure means someone changed a baseline spec; the right
 * response is to revert it and add a new scenario instead.
 */
const BASELINE_HASHES: Readonly<Record<string, string>> = {
  snakes: '62c06aafed88c297',
  mixed: 'db038d0ca663b1e4',
  sparse: '91fc7512c624e43c',
  potions: 'a334ef33f4654b80',
  'sparse-lean': 'e17138918328be54',
};

describe('the baseline scenarios are frozen', () => {
  it('the five names `all` expands to are exactly the recorded ones', () => {
    expect([...BASELINE_SCENARIOS]).toEqual([
      'snakes',
      'mixed',
      'sparse',
      'potions',
      'sparse-lean',
    ]);
  });

  it.each(BASELINE_SCENARIOS.map((n) => [n]))('%s is unchanged', (name: string) => {
    const spec = SCENARIOS[name];
    expect(spec).toBeDefined();
    expect(hashOf(spec as GameSpec)).toBe(BASELINE_HASHES[name]);
  });
});

// ---------------------------------------------------------------------------
// The controls really are symmetric
// ---------------------------------------------------------------------------

/**
 * The reflection every control is built around: `x -> width-1-x`.
 *
 * It, and not a 180-degree rotation, because `makeUnit` lays a snake's body
 * along ABSOLUTE `-y` and faces a unit at the centre with a `|ax| >= |ay|`
 * projection. Reflecting in x leaves the body direction alone and negates
 * `ax` only, so the orientation tie falls the same way on both sides; a
 * rotation would flip every tail and is not a symmetry of this construction.
 */
const mirrorX = (width: number, c: { x: number; y: number }): string =>
  `${width - 1 - c.x},${c.y}`;
const cellKey = (c: { x: number; y: number }): string => `${c.x},${c.y}`;

describe('the hand-symmetric controls are symmetric', () => {
  it.each(MIRROR_SCENARIOS.map((n) => [n]))('%s', (name: string) => {
    const spec = SCENARIOS[name] as GameSpec;
    expect(spec).toBeDefined();
    const w = spec.width;

    // Slots 0 and 1 are each other's reflection, unit kind by unit kind.
    const a = spec.teams[0];
    const b = spec.teams[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const roster = (t: typeof a, map: (c: { x: number; y: number }) => string): string[] =>
      (t?.units ?? []).map((u) => `${u.kind}@${map(u)}`).sort();
    expect(roster(a, (c) => mirrorX(w, c))).toEqual(roster(b, cellKey));

    // TWO TEAMS AND NO MORE, which is a measurement and not a preference. The
    // first cut of these boards kept the baseline classes' third team on the
    // centre file, where the reflection maps it onto itself — and slot 1 still
    // won `mirror-mixed` 8/8 at a mean lead of +39.4, because a team whose own
    // tied options are mirror images of each other has to break that tie by
    // cell index, commits to one half of the board on turn 1, and harasses
    // that half for sixty turns. Dropping it read 3/0/5 at -2.25. A
    // self-mirrored third party is not a neutral party.
    expect(spec.teams).toHaveLength(2);

    // Items too: an unmirrored meal is exactly what makes `snakes` and
    // `sparse` unfair despite mirror-image rosters.
    const cells = (xs: ReadonlyArray<{ x: number; y: number }> | undefined): string[] =>
      (xs ?? []).map(cellKey).sort();
    const mirrored = (xs: ReadonlyArray<{ x: number; y: number }> | undefined): string[] =>
      (xs ?? []).map((c) => mirrorX(w, c)).sort();
    expect(mirrored(spec.food)).toEqual(cells(spec.food));
    expect(mirrored(spec.potions)).toEqual(cells(spec.potions));
  });

  it('buildBoard mirrors the orientations and the bodies too', () => {
    const spec = SCENARIOS['mirror-mixed'] as GameSpec;
    const board = buildBoard(spec);
    const w = spec.width;
    const of = (team: string): string[] =>
      (board.snakes ?? [])
        .filter((s) => s.teamID === team)
        .map(
          (s) =>
            `${s.unitType}|${s.body.map(cellKey).join(';')}|${s.orientation?.dx},${s.orientation?.dy}`
        )
        .sort();
    const reflected = (team: string): string[] =>
      (board.snakes ?? [])
        .filter((s) => s.teamID === team)
        .map(
          (s) =>
            `${s.unitType}|${s.body.map((c) => mirrorX(w, c)).join(';')}|` +
            `${-(s.orientation?.dx ?? 0)},${s.orientation?.dy}`
        )
        .sort();
    expect(reflected('red')).toEqual(of('blue'));
  });
});

// ---------------------------------------------------------------------------
// `--side` is a readout, not a lever
// ---------------------------------------------------------------------------

/**
 * WHY THIS MATTERS FOR THE OLD RECORDS. Almost every counter in
 * `WEIGHT-SWEEP.md` and both behaviour audits comes from MIRROR runs, whose
 * board-wide counters are sums over every team. If the slot could move them,
 * those numbers would be side-0 readings and the sweep's direction would be in
 * question. It cannot: with no `--opponent` every team plays the same profile,
 * so the game is identical and the slot is a readout.
 *
 * The one thing the slot DOES move is `docs/design/OPPONENTS.md`'s side split
 * (`oursMeals`, `theirsDeaths`, ...), and it moves it in the only way it may —
 * the two halves SWAP. That is not an exception to the rule above, it is the
 * rule stated per team: "ours" means `spec.teams[side]`, so reading the same
 * game from the other slot must exchange the halves and leave every total
 * alone. Both halves are asserted here, because a split that failed to swap
 * and a total that failed to hold are two different bugs.
 */
describe('a mirror run is invariant under --side', () => {
  /** The side split's own fields — the ones that are SUPPOSED to move. */
  const isSplit = (k: string): boolean =>
    k.startsWith('ours') || k.startsWith('theirs') || k.startsWith('teams');

  it('`mirror-sparse` holds every total and swaps the side split', async () => {
    const spec = { ...(SCENARIOS['mirror-sparse'] as GameSpec), maxTurns: 10, seed: 3 };
    const play = async (side: number): Promise<Record<string, unknown>> => {
      const r = await runGame({ ...spec, nodeBudget: DEFAULT_NODE_BUDGET }, { scores: false, side });
      return summaryOf(
        r.metrics,
        { label: 'x', scenario: 'mirror-sparse', seed: 3, turnsRequested: 10, side },
        { kind: 'nodes', nodes: DEFAULT_NODE_BUDGET }
      ) as unknown as Record<string, unknown>;
    };
    const zero = await play(0);
    clearGeometryCache();
    const one = await play(1);

    // 1. Everything but the split, compared as a STRING so a counter added
    //    later is covered without anybody remembering to add it here.
    const withoutSplit = (s: Record<string, unknown>): string => {
      const counters = Object.fromEntries(
        Object.entries(s.counters as Record<string, number>).filter(([k]) => !isSplit(k))
      );
      const rest: Record<string, unknown> = { ...s, counters };
      delete rest.outcome;
      delete rest.side;
      return JSON.stringify(rest);
    };
    expect(withoutSplit(one)).toBe(withoutSplit(zero));

    // 2. The split itself, exchanged half for half.
    const c0 = zero.counters as Record<string, number>;
    const c1 = one.counters as Record<string, number>;
    const ours = Object.keys(c0).filter((k) => k.startsWith('ours'));
    expect(ours.length).toBeGreaterThan(0);
    for (const k of ours) {
      const theirs = `theirs${k.slice('ours'.length)}`;
      expect(c1[k]).toBe(c0[theirs]);
      expect(c1[theirs]).toBe(c0[k]);
    }
    // And the halves still add up to the total they are halves of.
    expect((c0.oursUnitTurns as number) + (c0.theirsUnitTurns as number)).toBe(c0.unitTurns);
  });
});
