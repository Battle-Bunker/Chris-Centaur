/**
 * The unified UNIT threat map: one mechanism (per-kind reach generators +
 * the shared stationary-contest rule) subsumes the legacy bespoke snake
 * head-to-head adjacency scan AND the chess-piece threat map. These tests
 * pin the unification itself:
 *
 *  - snake-sourced and piece-sourced threats coexisting on one square, each
 *    feeding its own derived info shape (H2HRiskInfo / PieceThreatInfo);
 *  - the derived H2HRiskInfo matching the legacy semantics on a mixed board
 *    (win-outright enemies filtered, ties risky, allies always risky,
 *    adjacent pieces NEVER counted with snake-style adjacency);
 *  - the UNIFIED tier-timing rule (no per-kind fork): BOTH kinds adjudicate
 *    with tiers projected to the arrival turn (T+1), with a missing expiry
 *    schedule assumed to still cover the arrival turn. On real documents
 *    this is provably identical to a raw current-level read, because the
 *    engine expires effects only AFTER collisions, so every visible effect
 *    has expiryTurn >= T+1.
 */

import { computeUnitThreatMap } from '../logic/piece-threats';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { BoardGraph } from '../logic/board-graph';
import { GameState, Snake, Coord } from '../types/battlesnake';

const TURN = 10;
const W = 11;
const idx = (x: number, y: number): number => y * W + x;

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  };
}

/** A chess piece: 1-cell body, `length` = WEIGHT. */
function makePiece(
  id: string,
  square: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake {
  return makeSnake(id, [square], { length: weight, unitType, ...extra });
}

function makeGameState(snakes: Snake[], youId: string): GameState {
  return {
    game: {
      id: 'unit-threat-test',
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn: TURN,
    board: { width: 11, height: 11, snakes, food: [], hazards: [] },
    you: snakes.find((s) => s.id === youId)!,
  };
}

// Us mid-board: head (5,5), body to the left, so 'left' is neck-blocked and
// the live candidates are up / down / right.
const midUs = (): Snake => makeSnake('us', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);

const analyzer = new MoveAnalyzer();

describe('unified unit threat map', () => {
  test('snake-sourced and piece-sourced threats coexist on one square, tagged by kind', () => {
    const us = midUs();
    // Equal-length enemy snake head at (5,7): its 4-neighborhood includes our
    // 'up' candidate (5,6); a tie is a threat.
    const enemySnake = makeSnake('e', [{ x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }]);
    // Heavier enemy queen at (8,6): its leftward ray runs through (5,6).
    const queen = makePiece('q', { x: 8, y: 6 }, 'queen', 10);
    const gs = makeGameState([us, enemySnake, queen], 'us');

    // Map level: BOTH kinds tagged on the one cell.
    const map = computeUnitThreatMap(us, gs.board, TURN)!;
    const entries = map.entriesByCell[idx(5, 6)]!;
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ sourceUnitId: 'e', isAlly: false, sourceKind: 'snake' });
    expect(entries).toContainEqual({ sourceUnitId: 'q', isAlly: false, sourceKind: 'piece' });

    // Derived level: each kind feeds ONLY its own info shape.
    const analysis = analyzer.analyzeMoves(us, gs, new BoardGraph(gs));
    const h2h = analysis.h2hRiskByMove.get('up')!;
    expect(h2h.hasEnemyRisk).toBe(true);
    expect(h2h.enemyRiskCount).toBe(1);
    const piece = analysis.pieceThreatByMove.get('up')!;
    expect(piece.hasEnemyThreat).toBe(true);
    expect(piece.enemyThreatCount).toBe(1);
    expect(analysis.risky).toContain('up');
    // Off both reaches: no threat of either kind.
    expect(analysis.h2hRiskByMove.get('down')!.hasEnemyRisk).toBe(false);
    expect(analysis.pieceThreatByMove.get('down')!.hasEnemyThreat).toBe(false);
  });

  test('derived H2HRiskInfo keeps the legacy semantics: shorter enemy filtered, tie risky, ally always risky', () => {
    const us = midUs(); // length 3
    const shorter = makeSnake('e2', [{ x: 5, y: 7 }, { x: 5, y: 8 }]); // length 2
    const gsShorter = makeGameState([us, shorter], 'us');
    const shortAnalysis = analyzer.analyzeMoves(us, gsShorter, new BoardGraph(gsShorter));
    // We win outright: not risky, count 0 (the map filters the whole unit).
    expect(shortAnalysis.h2hRiskByMove.get('up')!).toEqual({
      hasEnemyRisk: false, hasAllyRisk: false, enemyRiskCount: 0, allyRiskCount: 0,
    });

    const equal = makeSnake('e3', [{ x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }]); // length 3
    const gsEqual = makeGameState([us, equal], 'us');
    const equalAnalysis = analyzer.analyzeMoves(us, gsEqual, new BoardGraph(gsEqual));
    expect(equalAnalysis.h2hRiskByMove.get('up')!.hasEnemyRisk).toBe(true);
    expect(equalAnalysis.h2hRiskByMove.get('up')!.enemyRiskCount).toBe(1);

    // The SAME shorter snake as an ALLY: always risky (we never want the trade).
    const gsAlly = makeGameState([us, makeSnake('a', [{ x: 5, y: 7 }, { x: 5, y: 8 }])], 'us');
    const allyAnalysis = analyzer.analyzeMoves(us, gsAlly, new BoardGraph(gsAlly), new Set(['us', 'a']));
    const allyH2h = allyAnalysis.h2hRiskByMove.get('up')!;
    expect(allyH2h.hasAllyRisk).toBe(true);
    expect(allyH2h.allyRiskCount).toBe(1);
    expect(allyH2h.hasEnemyRisk).toBe(false);
  });

  test('an orthogonally-adjacent bishop contributes to NEITHER shape (no snake-style adjacency for pieces)', () => {
    const us = midUs();
    // Heavier enemy bishop at (6,6): orthogonally adjacent to our 'up' (5,6)
    // and 'right' (6,5) candidates, but a bishop moves diagonally — it cannot
    // take either square. Legacy excluded pieces from the h2h scan for
    // exactly this reason; the unified map must not re-book them.
    const bishop = makePiece('b', { x: 6, y: 6 }, 'bishop', 10);
    const gs = makeGameState([us, bishop], 'us');
    const analysis = analyzer.analyzeMoves(us, gs, new BoardGraph(gs));

    for (const move of ['up', 'down', 'right'] as const) {
      expect(analysis.h2hRiskByMove.get(move)!.hasEnemyRisk).toBe(false);
      expect(analysis.h2hRiskByMove.get(move)!.enemyRiskCount).toBe(0);
      expect(analysis.pieceThreatByMove.get(move)!.hasEnemyThreat).toBe(false);
    }
  });

  test('UNIFIED tier timing: both kinds project to the arrival turn, identical outcomes in identical effect states', () => {
    // A SHORTER enemy snake and a LIGHTER enemy rook, each losing the plain
    // weight contest (our length/weight 3 vs their 2) but carrying level 1.
    // The map must adjudicate BOTH through the one arrival-turn rule.
    const shorterSnakeAt = (effects: Partial<Snake>): Snake =>
      makeSnake('e', [{ x: 5, y: 7 }, { x: 5, y: 8 }], effects);
    const lighterRookAt = (effects: Partial<Snake>): Snake =>
      makePiece('r', { x: 5, y: 9 }, 'rook', 2, effects);
    const verdicts = (enemy: Snake): { h2h: boolean; piece: boolean } => {
      const gs = makeGameState([midUs(), enemy], 'us');
      const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));
      return {
        h2h: analysis.h2hRiskByMove.get('up')!.hasEnemyRisk,
        piece: analysis.pieceThreatByMove.get('up')!.hasEnemyThreat,
      };
    };

    // expiry = T+1: the MINIMUM any real turn-T document can carry (the
    // engine expires effects after collisions, dropping expiryTurn <= T), so
    // the level still governs the next resolution — both kinds threaten.
    // This is also the case where a doc with activeEffects data behaves
    // identically under a raw current-level read and the projected read.
    const liveEffects = { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: TURN + 1 };
    expect(verdicts(shorterSnakeAt(liveEffects)).h2h).toBe(true);
    expect(verdicts(lighterRookAt(liveEffects)).piece).toBe(true);

    // Missing-schedule fallback: a visible nonzero level with no derivable
    // expiry (pre-activeEffects documents) is assumed to still govern the
    // next resolution — both kinds STILL threaten. Assuming the enemy's buff
    // has lapsed would be the anti-conservative direction.
    const noSchedule = { invulnerabilityLevel: 1 };
    expect(verdicts(shorterSnakeAt(noSchedule)).h2h).toBe(true);
    expect(verdicts(lighterRookAt(noSchedule)).piece).toBe(true);

    // expiry <= T (impossible in a real turn-T document): the projection
    // zeroes the tier at arrival for BOTH kinds — no fork where the snake
    // path would count a lapsed level the piece path ignores.
    const lapsedEffects = { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: TURN };
    expect(verdicts(shorterSnakeAt(lapsedEffects)).h2h).toBe(false);
    expect(verdicts(lighterRookAt(lapsedEffects)).piece).toBe(false);
  });

  test('two threatening enemy snakes on one candidate square both count', () => {
    const us = midUs();
    const e1 = makeSnake('e1', [{ x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }]);
    const e2 = makeSnake('e2', [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }]);
    const gs = makeGameState([us, e1, e2], 'us');
    const analysis = analyzer.analyzeMoves(us, gs, new BoardGraph(gs));
    const h2h = analysis.h2hRiskByMove.get('up')!;
    expect(h2h.hasEnemyRisk).toBe(true);
    expect(h2h.enemyRiskCount).toBe(2);
  });
});
