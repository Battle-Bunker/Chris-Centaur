/**
 * THE POTION-INTELLIGENT BOT — the two new terms, and the acuteness detector
 * that buys them the depth to matter.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS ASSERTED THIS WAY ─────────────────────
 *
 * The five scenario families this branch was given — corridor entrapment, the
 * turn-limit razor, the regicide window, sever-defence triage,
 * mutual-annihilation brinkmanship — are NOT five expected outputs of five code
 * paths. `search/acute.ts` has four readings and no table of shapes, so what
 * these tests check is that four readings FIND five situations, on five boards
 * with five geometries, each written out cell by cell.
 *
 * The boards are this file's own. The owner's collector-and-long-snake example
 * is deliberately absent: an example used as a test is a pattern, and the whole
 * claim here is that there are no patterns.
 *
 * Every board also carries its own NEGATIVE — the same geometry with the one
 * feature that made it acute removed — because a detector that fires on
 * everything is not a detector and a threshold nothing fails is not a
 * threshold.
 */

import { UnitKind } from '../../partial-engine/index';
import type { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import { DEFAULT_ACUTE_TUNING, detectAcute } from '../search/acute';
import type { AcuteTuning } from '../search/acute';
import { UNREACHABLE, reachFromEarliest } from '../evaluate/attack-window';
import type { RayBoard, RayUnit } from '../evaluate/ray-crossing';
import { potionPickup, potionPickupNet, pickupsInPlan } from '../evaluate/potion-pickup';
import {
  anyEnemyCollector,
  anyEnemyWindow,
  potionDefense,
  potionDefenseNet,
} from '../evaluate/potion-defense';
import { DEFAULT_BOT_CONFIG, PARENT_BOT_CONFIG, botConfigFromJson, resolveBotConfig } from '../bot-config';
import { SLATE_POTION_INTEL, slateFor } from '../registry';
import { advisoryLineupFor } from '../evaluate/potion-lineup';
import { TeamDecisionEngine } from '../team-decision-engine';
import type { TeamDecisionPorts } from '../team-decision-engine';
import type { CentaurMove, GameState } from '../../types/battlesnake';

const WALL = 1_000_000;

/**
 * A MONOTONIC CLOCK THAT COSTS A TICK PER READ. The decision's budget must not
 * be a function of how loaded this box was, or the focus split — which is what
 * the tests below assert — becomes a wall-clock measurement rather than a
 * scheduler one.
 */
function stepClock(): () => number {
  let t = 0;
  return () => (t += 1);
}

/** The staging ports a decision needs, with both clocks faked. */
function fakePorts(): TeamDecisionPorts & { staged: string[] } {
  const clock = stepClock();
  const staged: string[] = [];
  return {
    staged,
    setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
      staged.push(`${snakeId}:${String(move)}`);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: () => () => undefined,
    pinSnakeIdOf: () => null,
    now: () => WALL,
    monotonic: clock,
    log: () => undefined,
  } as unknown as TeamDecisionPorts & { staged: string[] };
}

const viewFor = (board: Board, snakeId: string): GameState =>
  ({
    game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
    turn: TURN,
    board,
    you: board.snakes.find((s) => s.id === snakeId) as Snake,
  }) as unknown as GameState;

// ---------------------------------------------------------------------------
// Wire fixtures — a board as the marshaller reads it
// ---------------------------------------------------------------------------

const SIZE = 17;
const TURN = 40;

function snake(
  id: string,
  team: string,
  body: Coord[],
  extra: Partial<Snake> = {}
): Snake {
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
    teamID: team,
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  team: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => snake(id, team, [at], { unitType, length: weight, ...extra });

/** A run of `n` cells starting at (x, y) and going down the file. */
const file = (x: number, y: number, n: number): Coord[] =>
  Array.from({ length: n }, (_, i) => ({ x, y: y + i }));

/** A run of `n` cells starting at (x, y) and going along the rank. */
const rank = (x: number, y: number, n: number): Coord[] =>
  Array.from({ length: n }, (_, i) => ({ x: x + i, y }));

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({
    width: SIZE,
    height: SIZE,
    food: [],
    hazards: [],
    snakes,
    ...extra,
  }) as Board;

const subOf = (board: Board): EngineSubstrate =>
  makeSubstrate({ board, turn: TURN, asTeam: 'red' }) as EngineSubstrate;

afterEach(() => clearGeometryCache());

/** The detector with one knob moved, everything else default. */
const tuned = (over: Partial<AcuteTuning> = {}): AcuteTuning => ({
  ...DEFAULT_ACUTE_TUNING,
  ...over,
});

const kinds = (sub: EngineSubstrate, t: AcuteTuning = tuned()): ReadonlyArray<string> =>
  detectAcute(sub, sub.teamNumber('red'), t).situations.map((s) => s.kind);

// ===========================================================================
// The five families
// ===========================================================================

describe('family 1 — corridor entrapment: two of ours can close a low-exit region', () => {
  /**
   * A hazard pocket on the left edge. The enemy snake's head sits at (1, 6)
   * with hazard at (1,5) and (1,7) and its own body behind it at (2,6): one way
   * out, and two of ours within a turn of the mouth.
   */
  const trapped = (): Board =>
    boardOf(
      [
        snake('red-a', 'red', file(4, 5, 9)),
        snake('red-b', 'red', file(6, 5, 9)),
        snake('blue-a', 'blue', [
          { x: 1, y: 6 },
          { x: 2, y: 6 },
          { x: 2, y: 7 },
          { x: 2, y: 8 },
          { x: 2, y: 9 },
          { x: 2, y: 10 },
          { x: 2, y: 11 },
          { x: 2, y: 12 },
          { x: 2, y: 13 },
          { x: 2, y: 14 },
        ]),
      ],
      { hazards: [{ x: 1, y: 5 }, { x: 1, y: 7 }, { x: 0, y: 6 }] }
    );

  it('fires on the enclosure reading, naming only the units that can close', () => {
    const sub = subOf(trapped());
    const focus = detectAcute(sub, sub.teamNumber('red'), tuned());
    expect(focus.fired).toBe(true);
    expect(kinds(sub)).toContain('enclosure');
    // The whole point of narrowing: a focusable set, not the roster.
    expect(focus.units.size).toBeGreaterThan(0);
    expect(focus.units.size).toBeLessThanOrEqual(DEFAULT_ACUTE_TUNING.maxInvolved);
  });

  it('the SAME geometry with the pocket opened is not an enclosure', () => {
    const open = trapped();
    open.hazards = [];
    const sub = subOf(open);
    expect(kinds(sub)).not.toContain('enclosure');
  });
});

describe('family 2 — the turn-limit razor: a small margin and few turns left', () => {
  /**
   * Two teams of nearly equal weight with the limit three turns out. Nothing on
   * this board is geometrically dramatic; what makes it acute is the CLOCK, and
   * the clock is not in the position — so the reading fires only when the limit
   * is configured, which is the honest behaviour for a rule the board does not
   * carry.
   */
  const razorBoard = (): Board =>
    boardOf([
      snake('red-a', 'red', rank(2, 3, 9)),
      snake('red-b', 'red', rank(2, 14, 9)),
      snake('blue-a', 'blue', rank(13, 3, 9).reverse()),
      snake('blue-b', 'blue', rank(13, 14, 9).reverse()),
    ]);

  it('fires when the limit is three turns out, and is silent when it is not stated', () => {
    const sub = subOf(razorBoard());
    expect(kinds(sub, tuned({ turnLimit: TURN + 3 }))).toContain('razor');
    // The default is 0 — "not stated" — and a detector that guessed a limit
    // would fire the razor on every board in the corpus.
    expect(kinds(sub, tuned({ turnLimit: 0 }))).not.toContain('razor');
  });

  it('is silent when the limit is far away, on the identical position', () => {
    const sub = subOf(razorBoard());
    expect(kinds(sub, tuned({ turnLimit: TURN + 60 }))).not.toContain('razor');
  });
});

describe('family 3 — the regicide window: a king inside two attackers\' reach', () => {
  /**
   * A blue king at (6, 6) with a red knight and a red rook a few cells off. The
   * magnitude is not the king's own weight — it is the whole blue team, because
   * losing the king is losing the team, and that is the one asymmetry that makes
   * a three-cell piece worth more attention than a ten-cell snake.
   */
  const regicide = (): Board =>
    boardOf([
      piece('red-n', 'red', { x: 5, y: 4 }, 'knight', 3),
      piece('red-r', 'red', { x: 9, y: 6 }, 'rook', 5),
      piece('blue-k', 'blue', { x: 6, y: 6 }, 'king', 3),
      snake('blue-a', 'blue', file(13, 4, 10)),
    ]);

  it('fires, and the king raises the magnitude above its own weight', () => {
    const sub = subOf(regicide());
    const focus = detectAcute(sub, sub.teamNumber('red'), tuned());
    expect(focus.fired).toBe(true);
    const king = focus.situations.find((s) => s.kind === 'contest');
    expect(king).toBeDefined();
    // Blue's whole weight is 3 + 6 = 9; the king alone is 3. A reading that
    // priced the king at its own weight would rank this below a snake trade.
    expect(Math.max(...focus.situations.map((s) => s.magnitude))).toBeGreaterThan(3);
  });

  it('the same two attackers against a NON-king of the same weight read lower', () => {
    const withKing = regicide();
    const without = regicide();
    // Same cell, same weight, no crown.
    without.snakes = without.snakes.map((s) =>
      s.id === 'blue-k' ? piece('blue-k', 'blue', { x: 6, y: 6 }, 'knight', 3) : s
    );
    const a = detectAcute(subOf(withKing), 0, tuned());
    clearGeometryCache();
    const b = detectAcute(subOf(without), 0, tuned());
    const peak = (f: typeof a): number =>
      Math.max(0, ...f.situations.map((s) => s.magnitude));
    expect(peak(a)).toBeGreaterThan(peak(b));
  });
});

describe('family 4 — sever-defence triage: their window, our two exposed snakes', () => {
  /**
   * Blue has drunk. Its bishop carries tier +1 expiring in two turns, and two
   * red snakes sit on its diagonals. The reading that finds this is `expiry` —
   * a modifier with a clock — and it finds it from the tier and the expiry
   * alone, with no knowledge that a potion exists.
   */
  const triage = (): Board =>
    boardOf([
      piece('blue-b', 'blue', { x: 6, y: 6 }, 'bishop', 4, {
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: TURN + 2,
      }),
      snake('red-a', 'red', file(4, 4, 10)),
      snake('red-b', 'red', rank(8, 9, 8)),
    ]);

  it('fires on the expiry reading while their tier is live', () => {
    const sub = subOf(triage());
    const focus = detectAcute(sub, sub.teamNumber('red'), tuned());
    expect(focus.fired).toBe(true);
    expect(focus.situations.some((s) => s.kind === 'expiry')).toBe(true);
    const e = focus.situations.find((s) => s.kind === 'expiry');
    expect(e?.note).toContain('their window');
  });

  it('is silent on the identical board once the tier has expired', () => {
    const stale = triage();
    stale.snakes = stale.snakes.map((s) =>
      s.id === 'blue-b'
        ? { ...s, invulnerabilityExpiryTurn: TURN - 5 }
        : s
    );
    const sub = subOf(stale);
    const focus = detectAcute(sub, sub.teamNumber('red'), tuned());
    expect(focus.situations.some((s) => s.note.includes('window'))).toBe(false);
  });
});

describe('family 5 — the death race: which side of the wipe we end on', () => {
  /**
   * ── THE RULE THIS FAMILY IS ABOUT, STATED CORRECTLY ──────────────────────
   *
   * The previous-turn-weights adjudication applies ONLY when every remaining
   * team dies in the SAME turn (`TeamSnekProcessor`, `endKind:
   * all-eliminated`). Deaths on CONSECUTIVE turns are not that case at all: the
   * game ends the moment one team is left standing, and the survivor takes
   * everything. An earlier statement of this family had it the other way round
   * and is rules-impossible.
   *
   * So a death race has two lines and they are worth entirely different
   * amounts:
   *
   *   (a) FORCE THE SAME-TURN WIPE while ahead on the previous turn's weights —
   *       a knife edge, decided by an adjudication rule rather than by
   *       survival, and worth taking only when we are the one ahead;
   *   (b) MAKE THEIR LAST UNITS DIE FIRST, by at least one turn — worth
   *       everything, because the survivor takes it all.
   *
   * Both weights are on the table in (a) and only theirs is in (b), which is
   * why the detector reads them differently, and it reads them from the engine's
   * own contest ordering rather than from a rule about endings: a contest with
   * no strict maximum is given to NOBODY (tier first, then weight — an exact tie
   * on both is a mutual kill), so `stake` returns the SUM there and the loser's
   * weight alone everywhere else. That is the whole of the difference, and it is
   * one line of arithmetic rather than a fifth reading.
   */
  /** Red's head at (6, 7) looking up the file; blue's at (6, 9) looking down.
   *  Two cells apart, bodies running away from each other. */
  const even = (aLen: number, bLen: number): Board =>
    boardOf([
      snake('red-a', 'red', file(6, 7 - aLen + 1, aLen).reverse()),
      snake('blue-a', 'blue', file(6, 9, bLen)),
    ]);

  it('the same-turn wipe (a) reads heavier than the race we already win (b)', () => {
    // (a) EXACT TIE: neither is the strict maximum, so both die on the one turn
    //     and the ending is adjudicated on the previous turn's weights.
    // A LOW THRESHOLD ON PURPOSE: `situations` holds what FIRED, and the point
    // here is the arithmetic of the stake rather than whether either line
    // cleared a trigger, so both are admitted and compared.
    const wipe = detectAcute(subOf(even(6, 6)), 0, tuned({ threshold: 0.01 }));
    clearGeometryCache();
    // (b) ONE CELL AHEAD: we are the strict maximum, they die and we do not,
    //     the game ends with one team standing and the survivor takes it all.
    //     Only THEIR weight is on the table, so the stake is smaller — which is
    //     the correct reading, because in (b) there is nothing to get wrong.
    const race = detectAcute(subOf(even(6, 5)), 0, tuned({ threshold: 0.01 }));
    const peak = (f: typeof wipe): number =>
      Math.max(0, ...f.situations.filter((s) => s.kind === 'contest').map((s) => s.magnitude));
    expect(peak(wipe)).toBeGreaterThan(peak(race));
    // And the arithmetic is the engine's, not a fitted constant: the tie's
    // stake is BOTH bodies, the race's is theirs alone.
    expect(peak(wipe)).toBe(12);
    expect(peak(race)).toBe(5);
  });

  it('being BEHIND on the tie is the same stake — the detector reads danger, not luck', () => {
    // Symmetry is the point. Which side of (a) we are on is decided by the
    // previous turn's weights and by the depth that finds the line; the
    // detector's job is only to say that the line is worth finding, so a board
    // where we are one cell light reads exactly as acute as one where we are one
    // cell heavy. A trigger that fired only when we were winning would be a
    // trigger that stops looking exactly when the game is about to be lost.
    const ahead = detectAcute(subOf(even(6, 5)), 0, tuned({ threshold: 0.01 }));
    clearGeometryCache();
    const behind = detectAcute(subOf(even(5, 6)), 0, tuned({ threshold: 0.01 }));
    const peak = (f: typeof ahead): number =>
      Math.max(0, ...f.situations.filter((s) => s.kind === 'contest').map((s) => s.acuteness));
    expect(peak(behind)).toBe(peak(ahead));
  });
});

// ===========================================================================
// The trigger, the cap and the reserve
// ===========================================================================

describe('the trigger is a threshold and the focus is a budget', () => {
  const quiet = (): Board =>
    boardOf([
      snake('red-a', 'red', file(2, 1, 3)),
      snake('blue-a', 'blue', file(14, 12, 3)),
    ]);

  it('a quiet board does not fire, and still reports its peak reading', () => {
    const sub = subOf(quiet());
    const focus = detectAcute(sub, sub.teamNumber('red'), tuned());
    expect(focus.fired).toBe(false);
    expect(focus.units.size).toBe(0);
    // The peak is reported either way: a sweep must be able to see how far a
    // threshold is from firing without racing a second arm for it.
    expect(focus.acuteness).toBeGreaterThanOrEqual(0);
  });

  it('the threshold is a knob: a live board silenced by raising it, fired by lowering', () => {
    // Two ten-cell snakes two cells apart — a real trade, at the default.
    const live = boardOf([
      snake('red-a', 'red', file(6, 1, 6).reverse()),
      snake('blue-a', 'blue', file(6, 8, 6)),
    ]);
    const sub = subOf(live);
    expect(detectAcute(sub, sub.teamNumber('red'), tuned()).fired).toBe(true);
    expect(detectAcute(sub, sub.teamNumber('red'), tuned({ threshold: 500 })).fired).toBe(false);
  });

  it('the focus never exceeds maxInvolved, however many situations fire', () => {
    const crowd = boardOf([
      snake('red-a', 'red', file(3, 8, 6)),
      snake('red-b', 'red', file(5, 8, 6)),
      snake('red-c', 'red', file(7, 8, 6)),
      snake('red-d', 'red', file(9, 8, 6)),
      snake('blue-a', 'blue', file(4, 1, 6)),
      snake('blue-b', 'blue', file(8, 1, 6)),
    ]);
    const sub = subOf(crowd);
    for (const cap of [1, 2, 3]) {
      const focus = detectAcute(sub, sub.teamNumber('red'), tuned({ threshold: 0.01, maxInvolved: cap }));
      expect(focus.units.size).toBeLessThanOrEqual(cap);
    }
  });

  it('acuteness is magnitude per turn of grace — the same stake further out is less acute', () => {
    const near = detectAcute(subOf(boardOf([
      snake('red-a', 'red', file(6, 3, 5)),
      snake('blue-a', 'blue', file(6, 9, 5)),
    ])), 0, tuned({ threshold: 0.01 }));
    clearGeometryCache();
    const far = detectAcute(subOf(boardOf([
      snake('red-a', 'red', file(2, 1, 5)),
      snake('blue-a', 'blue', file(14, 9, 5)),
    ])), 0, tuned({ threshold: 0.01, horizonMax: 14 }));
    const peak = (f: typeof near): number => Math.max(0, ...f.situations.map((s) => s.acuteness));
    expect(peak(near)).toBeGreaterThan(peak(far));
  });
});

// ===========================================================================
// The two terms
// ===========================================================================

const W = 16;
const at = (x: number, y: number): number => y * W + x;
const CELLS = W * W;
const T = 20;

const rayUnit = (over: Partial<RayUnit> & Pick<RayUnit, 'unitId' | 'team'>): RayUnit => ({
  kind: UnitKind.Snake,
  occupancy: [at(1, 1)],
  weight: 1,
  tier: 0,
  health: 100,
  ...over,
});

const rayBoard = (units: RayUnit[], turn = T): RayBoard => ({
  width: W,
  height: W,
  units,
  turn,
});

function reachOf(spec: Record<string, Record<number, number>>) {
  const grids = new Map<string, Int32Array>();
  for (const [unitId, cells] of Object.entries(spec)) {
    const g = new Int32Array(CELLS).fill(UNREACHABLE);
    for (const [cell, turn] of Object.entries(cells)) g[Number(cell)] = turn;
    grids.set(unitId, g);
  }
  return reachFromEarliest(grids);
}

describe('eval/potion-pickup@1 — the pickup THIS PLAN makes', () => {
  const POTION = at(4, 4);
  const enemyBody = Array.from({ length: 8 }, (_, i) => at(9, 3 + i));

  const collector = (head: number): RayUnit =>
    rayUnit({ unitId: 'ours-c', team: 0, occupancy: [head, at(3, 4), at(2, 4)], weight: 3 });
  const ally = (): RayUnit =>
    rayUnit({ unitId: 'ours-q', team: 0, kind: UnitKind.Queen, occupancy: [at(4, 8)], weight: 3 });
  const enemy = (): RayUnit =>
    rayUnit({ unitId: 'theirs', team: 1, occupancy: enemyBody, weight: enemyBody.length });

  it('is exactly zero when no head of ours is standing on a potion', () => {
    const board = rayBoard([collector(at(5, 4)), ally(), enemy()]);
    expect(pickupsInPlan(board, 0, [POTION])).toHaveLength(0);
    const v = potionPickup(board, 0, [POTION], { turn: T, reach: reachOf({}) });
    expect(v.pickups).toHaveLength(0);
    expect(potionPickupNet(v, 1)).toBe(0);
  });

  it('is non-zero on the plan that takes it — the same board, one head moved', () => {
    const reach = reachOf({ 'ours-q': { [enemyBody[3] as number]: T + 1 } });
    const off = potionPickup(rayBoard([collector(at(5, 4)), ally(), enemy()]), 0, [POTION], {
      turn: T,
      reach,
    });
    const on = potionPickup(rayBoard([collector(POTION), ally(), enemy()]), 0, [POTION], {
      turn: T,
      reach,
    });
    expect(off.pickups).toHaveLength(0);
    expect(on.pickups).toHaveLength(1);
    // THE WHOLE CLAIM: the two readings differ, so the comparator between these
    // two plans cannot tie on this term. That is the property the board-level
    // reading does not have and the reason this entry exists.
    expect(potionPickupNet(on, 1)).not.toBe(potionPickupNet(off, 1));
    expect(on.best?.gain.est).toBeGreaterThan(0);
    expect(on.best?.collectorId).toBe('ours-c');
  });

  it('the window begins on the RESOLVED turn — the collection has already happened', () => {
    const v = potionPickup(rayBoard([collector(POTION), ally(), enemy()]), 0, [POTION], {
      turn: T,
      reach: reachOf({ 'ours-q': { [enemyBody[3] as number]: T + 1 } }),
    });
    expect(v.best?.windowFrom).toBe(T);
    expect(v.best?.windowTo).toBe(T + 2);
  });

  it('excludes the collector from the gain: at −1 it cannot cut anything', () => {
    // The only unit with a line to the body IS the collector. A term that let
    // the collector into its own window would report a gain here.
    const lone = rayUnit({
      unitId: 'ours-c',
      team: 0,
      kind: UnitKind.Queen,
      occupancy: [POTION],
      weight: 3,
    });
    const v = potionPickup(rayBoard([lone, enemy()]), 0, [POTION], {
      turn: T,
      reach: reachOf({ 'ours-c': { [enemyBody[3] as number]: T + 1 } }),
    });
    expect(v.pickups).toHaveLength(1);
    expect(v.best?.gain.est).toBe(0);
  });

  it('the SHIELD makes a pickup worth making when no ally has a cut', () => {
    /*
     * THE MEASUREMENT THIS TEST IS THE FIX FOR. Over 23 games the term's own
     * bot collected FEWER potions than the bot with no potion reading at all —
     * 2.48 a game against 2.87 — because on a snake board the ally body channel
     * is structurally zero (a snake has four moves and has to reach an enemy
     * body with one of them inside three turns) while the collector's exposure
     * is not. A gain that cannot fire and a cost that can is a term that argues
     * against drinking.
     *
     * The board here is that case exactly: nobody can cut anything, and a
     * heavier enemy is one step from our ally's head. At tier zero our ally
     * loses that contest and its whole weight; at +1 it wins it and takes
     * theirs. That is what the buff is for on a snake board, and the term now
     * reads it.
     */
    const ally = rayUnit({ unitId: 'ours-a', team: 0, occupancy: [at(3, 9), at(3, 10)], weight: 2 });
    const heavy = rayUnit({ unitId: 'theirs-h', team: 1, occupancy: [at(3, 12), at(3, 13), at(3, 14)], weight: 3 });
    const board = rayBoard([collector(POTION), ally, heavy]);
    // No reach onto any body: the ally body channel is empty by construction.
    const reach = reachOf({ 'theirs-h': { [at(3, 9)]: T + 1 } });
    const v = potionPickup(board, 0, [POTION], { turn: T, reach });
    expect(v.best?.gain.est).toBe(0);
    expect(v.best?.shield.saved).toBe(2);
    expect(v.best?.shield.taken).toBe(3);
    expect(v.best?.shield.allyId).toBe('ours-a');
    // AND THE SIGN IS THE POINT: with the shield the pickup is worth making.
    expect(potionPickupNet(v, 1)).toBeGreaterThan(0);
  });

  it('does not count a contest our own weight already wins', () => {
    // A LIGHTER enemy beside a heavier ally is a contest we win with no potion
    // at all. Counting it would make every potion on the board look like a
    // reason to drink — `potion-seek`'s own rule about head attacks, applied to
    // the half of it that is true.
    const ally = rayUnit({ unitId: 'ours-a', team: 0, occupancy: [at(3, 9), at(3, 10), at(3, 11)], weight: 3 });
    const light = rayUnit({ unitId: 'theirs-l', team: 1, occupancy: [at(3, 13), at(3, 14)], weight: 2 });
    const v = potionPickup(rayBoard([collector(POTION), ally, light]), 0, [POTION], {
      turn: T,
      reach: reachOf({ 'theirs-l': { [at(3, 9)]: T + 1 } }),
    });
    expect(v.best?.shield.saved).toBe(0);
    expect(v.best?.shield.taken).toBe(0);
  });

  it('does not count a contest against an enemy already carrying a tier', () => {
    // At +1 against +1 the tiers are equal again and weight decides, exactly as
    // it did before anybody drank — so the buff flips nothing here.
    const ally = rayUnit({ unitId: 'ours-a', team: 0, occupancy: [at(3, 9), at(3, 10)], weight: 2 });
    const buffed = rayUnit({
      unitId: 'theirs-b',
      team: 1,
      occupancy: [at(3, 12), at(3, 13), at(3, 14)],
      weight: 3,
      tier: 1,
      tierExpiresAtTurn: T + 3,
    });
    const v = potionPickup(rayBoard([collector(POTION), ally, buffed]), 0, [POTION], {
      turn: T,
      reach: reachOf({ 'theirs-b': { [at(3, 9)]: T + 1 } }),
    });
    expect(v.best?.shield.taken).toBe(0);
  });

  it('charges the collector when an enemy can stand where it stands, and not otherwise', () => {
    const base = rayBoard([collector(POTION), ally(), enemy()]);
    const safe = potionPickup(base, 0, [POTION], {
      turn: T,
      reach: reachOf({ 'ours-q': { [enemyBody[3] as number]: T + 1 } }),
    });
    const hunted = potionPickup(base, 0, [POTION], {
      turn: T,
      reach: reachOf({
        'ours-q': { [enemyBody[3] as number]: T + 1 },
        theirs: { [POTION]: T + 1 },
      }),
    });
    expect(safe.best?.contested).toBe(false);
    expect(hunted.best?.contested).toBe(true);
    expect(potionPickupNet(hunted, 1)).toBeLessThan(potionPickupNet(safe, 1));
  });
});

describe('eval/potion-defense@1 — their window, and the answer to it', () => {
  const ourBody = Array.from({ length: 9 }, (_, i) => at(6, 3 + i));
  const ourSnake = (): RayUnit =>
    rayUnit({ unitId: 'ours-s', team: 0, occupancy: ourBody, weight: ourBody.length });
  const ourHunter = (at0: number): RayUnit =>
    rayUnit({ unitId: 'ours-h', team: 0, occupancy: [at0], weight: 3 });

  const buffedRook = (): RayUnit =>
    rayUnit({
      unitId: 'theirs-r',
      team: 1,
      kind: UnitKind.Rook,
      occupancy: [at(12, 6)],
      weight: 4,
      tier: 1,
      tierExpiresAtTurn: T + 2,
    });
  const theirCollector = (): RayUnit =>
    rayUnit({
      unitId: 'theirs-c',
      team: 1,
      occupancy: [at(12, 12), at(12, 13)],
      weight: 2,
      tier: -1,
      tierExpiresAtTurn: T + 2,
    });

  it('reads zero on a board with no enemy tier standing, having built nothing', () => {
    const flat = rayBoard([ourSnake(), rayUnit({ unitId: 'theirs-r', team: 1, occupancy: [at(12, 6)] })]);
    expect(anyEnemyWindow(flat, 0, T)).toBe(false);
    expect(anyEnemyCollector(flat, 0, T)).toBe(false);
    const v = potionDefense(flat, 0, { turn: T, reach: reachOf({}) });
    expect(v.threat).toBe(0);
    expect(v.best).toBeNull();
    expect(potionDefenseNet(v, 1)).toBe(0);
  });

  it('prices their buffed unit\'s cut against OUR body, and nobody else\'s', () => {
    const board = rayBoard([ourSnake(), buffedRook()]);
    const v = potionDefense(board, 0, {
      turn: T,
      reach: reachOf({ 'theirs-r': { [ourBody[2] as number]: T + 1 } }),
    });
    expect(v.underWindow).toBe(true);
    expect(v.threat).toBeGreaterThan(0);
    expect(potionDefenseNet(v, 1)).toBeLessThan(0);
    // A third team's body is not our loss. Same reach, victim on team 2.
    const thirdParty = rayBoard([
      ourHunter(at(1, 1)),
      buffedRook(),
      rayUnit({ unitId: 'other', team: 2, occupancy: ourBody, weight: ourBody.length }),
    ]);
    const w = potionDefense(thirdParty, 0, {
      turn: T,
      reach: reachOf({ 'theirs-r': { [ourBody[2] as number]: T + 1 } }),
    });
    expect(w.threat).toBe(0);
  });

  it('the counter-attack on their collector cancels the window it bought', () => {
    const board = rayBoard([ourSnake(), ourHunter(at(11, 12)), buffedRook(), theirCollector()]);
    const reach = {
      'theirs-r': { [ourBody[2] as number]: T + 2 },
      'ours-h': { [at(12, 12)]: T + 1 },
    };
    const v = potionDefense(board, 0, { turn: T, reach: reachOf(reach) });
    expect(v.best).not.toBeNull();
    expect(v.best?.collectorId).toBe('theirs-c');
    expect(v.best?.byUnitId).toBe('ours-h');
    // The rook's cut lands at T+2, the collector dies at T+1, and the buff is
    // rescheduled to end on the turn the vulnerable unit collides — so the cut
    // is cancelled and the whole threat comes back.
    expect(v.best?.cancels).toBeCloseTo(v.threat, 6);
    expect(potionDefenseNet(v, 1)).toBeGreaterThan(0);
  });

  it('does NOT cancel a cut that lands before we can reach the collector', () => {
    const board = rayBoard([ourSnake(), ourHunter(at(11, 12)), buffedRook(), theirCollector()]);
    const v = potionDefense(board, 0, {
      turn: T,
      reach: reachOf({
        'theirs-r': { [ourBody[2] as number]: T + 1 },
        'ours-h': { [at(12, 12)]: T + 2 },
      }),
    });
    expect(v.best?.cancels).toBe(0);
  });

  it('an unreachable collector is reported and buys nothing', () => {
    const board = rayBoard([ourSnake(), ourHunter(at(1, 1)), theirCollector()]);
    const v = potionDefense(board, 0, { turn: T, reach: reachOf({}) });
    expect(v.targets).toHaveLength(1);
    expect(v.targets[0]?.byUnitId).toBeNull();
    expect(v.best).toBeNull();
  });
});

// ===========================================================================
// The bot this branch ships
// ===========================================================================

describe('the branch default is the potion-intelligent bot', () => {
  it('selects the potion-intel slate and switches focus narrowing on', () => {
    expect(DEFAULT_BOT_CONFIG.slate).toBe(SLATE_POTION_INTEL);
    // An EMPTY acute object is the whole default tuning — narrowing on. `null`
    // is the even spread. The two must not be confusable.
    expect(DEFAULT_BOT_CONFIG.depth.acute).toEqual({});
    expect(resolveBotConfig({})).toEqual(DEFAULT_BOT_CONFIG);
  });

  it('seats seven evaluator entries, of which six are advisory', () => {
    const slate = slateFor(SLATE_POTION_INTEL);
    expect(slate.evaluators).toHaveLength(7);
    const lineup = advisoryLineupFor([...slate.evaluators]);
    expect(lineup).toHaveLength(6);
    expect(lineup.map((t) => t.key)).toContain('eval/potion-pickup@1');
    expect(lineup.map((t) => t.key)).toContain('eval/potion-defense@1');
  });

  it('the parent branch\'s bot is still exactly reachable as a config', () => {
    const parent = resolveBotConfig(PARENT_BOT_CONFIG);
    expect(parent.slate).toBe('legacy');
    expect(parent.depth.acute).toBeNull();
    expect(advisoryLineupFor([...slateFor('legacy').evaluators])).toHaveLength(0);
  });

  it('potionWeights is a partial and rescales without minting an entry id', () => {
    const slate = slateFor(SLATE_POTION_INTEL);
    const loud = advisoryLineupFor([...slate.evaluators], { potionPickup: 9 });
    const pickup = loud.find((t) => t.key === 'eval/potion-pickup@1');
    expect(pickup?.weight).toBe(9);
    // Everything unnamed keeps its declared scale.
    expect(loud.find((t) => t.key === 'eval/potion-control@2')?.weight).toBe(1);
  });

  it('refuses a malformed acute block and a non-numeric weight, loudly', () => {
    expect(() => botConfigFromJson({ depth: { acute: 3 } })).toThrow(/depth.acute/);
    expect(() => botConfigFromJson({ potionWeights: { potionPickup: 'loud' } })).toThrow(
      /potionWeights/
    );
    // …and accepts the two shapes that mean something.
    expect(botConfigFromJson({ depth: { acute: null } }).depth.acute).toBeNull();
    expect(botConfigFromJson({ depth: { acute: { threshold: 2 } } }).depth.acute).toEqual({
      threshold: 2,
    });
  });
});

// ===========================================================================
// The reserve, in a real decision
// ===========================================================================

describe('narrowing spends the budget it frees, and never all of it', () => {
  /**
   * A LIVE DECISION, because the claim is about a SCHEDULER and a scheduler's
   * behaviour is not a property of any function it calls. The first build of
   * this layer raised `focusDepthMax` on the focused threads and stopped there,
   * and that reads perfectly in a unit test and does nothing in a game:
   * `deepenNext` deepens the shallowest live thread, so a raised ceiling is
   * only reached after every other thread has been carried to its own, and the
   * purse is empty long before that. Measured on the first cycle of real games:
   * the focus fired on 32% of decisions and took 13.5% of the plies.
   *
   * So what is asserted here is the SPLIT, on both sides:
   *   · the focus is served — `focusPlies > 0` when the reading fires;
   *   · the reserve is served — `outsidePlies > 0` on the same decision, which
   *     is the whole of the answer to a feint;
   *   · and the same board under `depth.acute: null` reports no focus at all,
   *     so a bot that does not narrow is distinguishable from one that narrows
   *     and finds the board quiet.
   */
  const contested = (): Board =>
    boardOf(
      [
        // A 25-wide board with the fight in one corner. `red-a` and `red-b` are
        // four cells from two blue snakes of the same weight — a same-turn wipe
        // two turns out, and the acute line. `red-c` and `red-d` are twenty
        // cells away from anything and cannot be in any situation the horizon
        // admits, so they are exactly what the reserve exists to keep looking
        // at: the test is only about a split if a split is possible.
        snake('red-a', 'red', file(2, 2, 8)),
        snake('red-b', 'red', file(4, 2, 8)),
        snake('blue-a', 'blue', file(8, 2, 8)),
        snake('blue-b', 'blue', file(10, 2, 8)),
        snake('red-c', 'red', file(21, 14, 8)),
        snake('red-d', 'red', file(23, 14, 8)),
      ],
      { width: 25, height: 25, invulnerabilityPotions: [{ x: 6, y: 3 }] }
    );

  const focusOf = async (
    acute: Record<string, unknown> | null
  ): Promise<{
    readonly fired: boolean;
    readonly units: number;
    readonly focusPlies: number;
    readonly outsidePlies: number;
  } | null> => {
    const board = contested();
    const ports = fakePorts();
    const engine = new TeamDecisionEngine(ports, {
      kernel: { reserveMs: 20, sliceMs: 10 },
      bot: botConfigFromJson({ name: 'focus-probe', depth: { acute } }),
      matchSeed: 0x9a1e,
    });
    const result = await engine.decideTurn({
      gameId: 'focus-probe',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: ['red-a', 'red-b', 'red-c', 'red-d'].map((snakeId) => ({
        snakeId,
        view: viewFor(board, snakeId),
      })),
      deadlineMs: WALL + 400,
    });
    return result.mechanism?.scout?.focus ?? null;
  };

  it('serves the focus AND the reserve on the same decision', async () => {
    const focus = await focusOf({});
    expect(focus).not.toBeNull();
    if (focus === null) throw new Error('unreachable');
    expect(focus.fired).toBe(true);
    // A STRICT SUBSET, or there is nothing to reserve. A focus that named every
    // unit we command would make the assertion below vacuous — and the honest
    // behaviour in that case IS to spend everything on it, so the board has to
    // be one where the reading can leave something out.
    expect(focus.units).toBeGreaterThan(0);
    expect(focus.units).toBeLessThan(4);
    expect(focus.focusPlies).toBeGreaterThan(0);
    // THE FEINT DEFENCE, measured. A focus that took every ply would be a bot
    // an opponent could lead by the nose with anything that reads acute.
    expect(focus.outsidePlies).toBeGreaterThan(0);
  }, 60_000);

  it('reports NO focus at all under the even spread — null is not zero', async () => {
    expect(await focusOf(null)).toBeNull();
  }, 60_000);
});
