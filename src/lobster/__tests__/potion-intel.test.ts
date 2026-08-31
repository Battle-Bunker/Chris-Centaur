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

describe('family 5 — mutual-annihilation brinkmanship: nobody wins the tie', () => {
  /**
   * Two equal snakes head to head with nothing else on the board. The engine
   * gives a contest with no strict maximum to nobody, so BOTH weights are on
   * the table — which is why `stake` returns their sum in exactly this case and
   * why this board reads more acute than the same board with one cell of
   * difference between them.
   */
  /** Red's head at (6, 7) looking up the file; blue's at (6, 9) looking down.
   *  Two cells apart, bodies running away from each other. */
  const even = (aLen: number, bLen: number): Board =>
    boardOf([
      snake('red-a', 'red', file(6, 7 - aLen + 1, aLen).reverse()),
      snake('blue-a', 'blue', file(6, 9, bLen)),
    ]);

  it('an exact weight tie is more acute than a one-cell edge, same geometry', () => {
    const tie = detectAcute(subOf(even(6, 6)), 0, tuned());
    clearGeometryCache();
    const edge = detectAcute(subOf(even(6, 5)), 0, tuned());
    const peak = (f: typeof tie): number =>
      Math.max(0, ...f.situations.filter((s) => s.kind === 'contest').map((s) => s.magnitude));
    expect(peak(tie)).toBeGreaterThan(peak(edge));
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
