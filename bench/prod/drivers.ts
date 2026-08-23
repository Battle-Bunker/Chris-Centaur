/**
 * The two decision paths under test, driven exactly as the production full
 * pass drives them.
 *
 * LEGACY (`legacyDriver`) reproduces `firebase-interface.ts`'s legacy branch
 * literally: one INDEPENDENT anytime decision per controlled alive SNAKE,
 * all launched concurrently, each `DecisionEngine.decideIteratively` over its
 * own `withYou` view with the shared deadline, forwarding a recommendation
 * only when the move actually changes. PIECES GET NO BOT — that is the
 * production truth under the legacy flag (`views` holds snake units only),
 * and reproducing it faithfully is the point: a piece stages nothing and the
 * resolver holds it.
 *
 * The one deviation from `VoronoiStrategy`: the config comes from
 * DEFAULT_CONFIG rather than the Firestore-backed ConfigStore, and the
 * decision logger is not attached. Both are exactly what the strategy falls
 * back to with an empty store, and neither touches move selection.
 *
 * LOBSTER (`lobsterDriver`) is `TeamDecisionEngine.decideTurn` over the same
 * canonical board with the same wall-clock deadline, through fake ports that
 * record `setBotRecommendation` calls — the same per-unit door the manager
 * gives it. Pieces included, one joint decision per team.
 */

import type { Board, CentaurMove, Direction, GameState, Snake } from '../../src/types/battlesnake';
import { DecisionEngine } from '../../src/logic/decision-engine';
import type { MoveDecision } from '../../src/logic/decision-engine';
import { DEFAULT_CONFIG } from '../../src/config/game-config';
import { HEURISTIC_KEYS, type HeuristicWeights } from '../../src/config/heuristics';
import { TeamDetector } from '../../src/logic/team-detector';
import { isPieceUnit } from '../../src/logic/piece-threats';
import { TeamDecisionEngine, type TeamDecisionOptions, type TeamDecisionPorts } from '../../src/lobster/team-decision-engine';
import type { PinEvent, UnitId } from '../../src/lobster/contracts';
import type { KernelReport } from '../../src/lobster/kernel';

export interface DecisionOutcome {
  /** The staged set as the wire would carry it. */
  readonly moves: Map<string, CentaurMove>;
  /** How many distinct recommendations reached the manager surface. */
  readonly emissions: number;
  /** Wall-clock ms the decision actually took. */
  readonly wallMs: number;
  /** Wall-clock ms past the deadline (0 when on time). */
  readonly overrunMs: number;
  /** Milliseconds from decision start to the FIRST staged move. */
  readonly firstStageMs: number | null;
  readonly report: KernelReport | null;
  /** Anytime trace: (t since start, unit, move) for every forwarded call. */
  readonly trace: ReadonlyArray<{ atMs: number; unit: string; move: CentaurMove }>;
  /** The decision threw. Production logs and moves on; so does this harness. */
  readonly error: string | null;
}

export interface Driver {
  readonly name: 'legacy' | 'lobster';
  decide(board: Board, turn: number, teamID: string, deadlineMs: number): Promise<DecisionOutcome>;
  release(): void;
}

function weightsOf(): HeuristicWeights {
  const w = {} as HeuristicWeights;
  for (const key of HEURISTIC_KEYS) w[key] = DEFAULT_CONFIG[key];
  return w;
}

function viewFor(board: Board, snake: Snake, turn: number): GameState {
  return {
    game: {
      id: 'bench',
      ruleset: { name: 'tactictoes', version: 'bench', settings: {} },
      map: 'standard',
      timeout: 10_000,
      source: 'bench',
    },
    turn,
    board,
    you: { ...snake, head: { ...snake.head }, body: snake.body.map((c) => ({ ...c })) },
  } as GameState;
}

// ------------------------------------------------------------------- legacy

export function legacyDriver(): Driver {
  const engine = new DecisionEngine({
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
    nearbyDistance: DEFAULT_CONFIG.nearbyDistance,
    weights: weightsOf(),
  });
  const detector = new TeamDetector();
  return {
    name: 'legacy',
    release: () => undefined,
    async decide(board, turn, teamID, deadlineMs): Promise<DecisionOutcome> {
      const started = Date.now();
      const alive = (board.snakes ?? []).filter(
        (s) => TeamDetector.getTeamKey(s) === teamID && s.health > 0 && s.body.length > 0
      );
      // Production truth under the legacy flag: SNAKE units only.
      const ourSnakes = alive.filter((s) => !isPieceUnit(s));
      const teams = detector.detectTeams(board.snakes ?? []);
      const ourTeam = teams.find((t) => t.snakes.some((s) => TeamDetector.getTeamKey(s) === teamID));
      const teamSnakeIds = new Set<string>(
        ourTeam ? ourTeam.snakes.map((s) => s.id) : alive.map((s) => s.id)
      );

      const moves = new Map<string, CentaurMove>();
      const trace: Array<{ atMs: number; unit: string; move: CentaurMove }> = [];
      let emissions = 0;
      let firstStageMs: number | null = null;

      await Promise.all(
        ourSnakes.map(async (snake) => {
          const view = viewFor(board, snake, turn);
          let last: Direction | null = null;
          const forward = (move: Direction): void => {
            if (move === last) return;
            last = move;
            emissions++;
            const at = Date.now() - started;
            if (firstStageMs === null) firstStageMs = at;
            trace.push({ atMs: at, unit: snake.id, move });
            moves.set(snake.id, move);
          };
          try {
            const decision = await engine.decideIteratively(view, teamSnakeIds, {
              waypoint: null,
              deadlineMs,
              onUpdate: (partial: MoveDecision) => forward(partial.move),
            });
            forward(decision.move);
          } catch {
            // Production's own fallback: log and stage 'up'.
            forward('up');
          }
        })
      );

      const wallMs = Date.now() - started;
      return {
        moves,
        emissions,
        wallMs,
        overrunMs: Math.max(0, Date.now() - deadlineMs),
        firstStageMs,
        report: null,
        trace,
        error: null,
      };
    },
  };
}

// ------------------------------------------------------------------ lobster

export interface LobsterDriverOptions extends TeamDecisionOptions {
  /** Pin events to fire, keyed on the emission index that triggers them. */
  readonly pinsAt?: ReadonlyMap<number, PinEvent>;
}

export function lobsterDriver(options: LobsterDriverOptions = {}): Driver {
  const trace: Array<{ atMs: number; unit: string; move: CentaurMove }> = [];
  let started = 0;
  let firstStageMs: number | null = null;
  let emissions = 0;
  const moves = new Map<string, CentaurMove>();
  let registry: string[] = [];
  let sink: ((ev: PinEvent) => void) | null = null;

  const ports: TeamDecisionPorts = {
    setBotRecommendation: (_gameId, snakeId, move) => {
      emissions++;
      const at = Date.now() - started;
      if (firstStageMs === null) firstStageMs = at;
      trace.push({ atMs: at, unit: snakeId, move });
      moves.set(snakeId, move);
      const ev = options.pinsAt?.get(emissions);
      if (ev !== undefined && sink !== null) sink(ev);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: (_gameId, s) => {
      sink = s;
      return () => {
        sink = null;
      };
    },
    pinSnakeIdOf: (_gameId, unitId: UnitId) => registry[unitId] ?? null,
    log: () => undefined,
  };
  const engine = new TeamDecisionEngine(ports, options);

  return {
    name: 'lobster',
    release: () => engine.release('bench'),
    async decide(board, turn, teamID, deadlineMs): Promise<DecisionOutcome> {
      started = Date.now();
      firstStageMs = null;
      emissions = 0;
      moves.clear();
      trace.length = 0;
      const alive = (board.snakes ?? []).filter(
        (s) => TeamDetector.getTeamKey(s) === teamID && s.health > 0 && s.body.length > 0
      );
      registry = alive.map((s) => s.id);
      if (alive.length === 0) {
        return {
          moves: new Map(),
          emissions: 0,
          wallMs: 0,
          overrunMs: 0,
          firstStageMs: null,
          report: null,
          trace: [],
          error: null,
        };
      }
      // Production contains a thrown team decision with a `.catch` that logs
      // and moves on (firebase-interface.ts's lobster branch), so the harness
      // does the same — and counts it, because a decision that throws stages
      // nothing for the units the fast pass did not already cover.
      let error: string | null = null;
      let report: KernelReport | null = null;
      try {
        const result = await engine.decideTurn({
          gameId: 'bench',
          turn,
          board,
          ourTeamId: teamID,
          units: alive.map((s) => ({ snakeId: s.id, view: viewFor(board, s, turn) })),
          deadlineMs,
        });
        report = result.report;
      } catch (err) {
        const e = err as { name?: string; message?: string; code?: string };
        error = `${e.name ?? 'Error'}: ${e.message ?? String(err)}${e.code ? ` [${e.code}]` : ''}`;
      }
      const wallMs = Date.now() - started;
      return {
        moves: new Map(moves),
        emissions,
        wallMs,
        overrunMs: Math.max(0, Date.now() - deadlineMs),
        firstStageMs,
        report,
        trace: trace.slice(),
        error,
      };
    },
  };
}
