/**
 * THE LENS, IN A BROWSER — a local game, the shipped page, no Firebase.
 *
 * `src/index.ts` serves `play-game.html` against games that only ever arrive
 * over the TacticToes Firebase transport, so before this file there was no way
 * to LOOK at the decision lens: every gate that exercised it compared frames
 * and transcripts in a jest process. This is the smallest dev entry that puts
 * the real page in front of a real decision:
 *
 *   · the SHIPPED express static mount and `/game/:id` route,
 *   · the SHIPPED `GameWebSocketServer` (so `subscribe-game`, `board-update`,
 *     `lens-frames`, the mid-turn anchor replay and the four inbound lens
 *     envelopes are all the production ones),
 *   · the SHIPPED decision path — `makeSubstrate` / `rigFor` /
 *     `LobsterKernel.decide` under the node clock, with the lens sink and the
 *     inspection port attached, exactly as `src/lens/kernel/record.ts` runs it,
 *   · the SHIPPED `seq` writer and codecs, so what the socket carries and what
 *     the replay routes serve are the same bytes.
 *
 * What it stands in for is Postgres and Firestore. The turn log lives in a
 * list and the four read routes the replay path calls (`/api/logs/games`,
 * `/api/games/:id/turns`, `/api/logs`, `/api/logs/commands`) are served from
 * it — INCLUDING the anchor's settlement being dropped on the way to storage,
 * which is what `ActiveGameManager.logStoredEvent` does and is therefore a
 * property the walkthrough must see rather than one it may paper over.
 *
 * Usage:
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts \
 *     --port=5055 --warmup=2 --seed=1 --nodes=550
 *
 * THE WIRE CAN BE MADE SLOW, because in this process it is free and a latency
 * surface designed against a free wire is a surface nobody has read:
 *
 *   --latency=120            both directions, client ↔ centaur, one way
 *   --latency-down=200       centaur → client only (the board goes old)
 *   --latency-up=200         client → centaur only (the press lands late)
 *   --jitter=40              uniform ± on each direction, order preserved
 *   --loss=0.1               drop a tenth of the superseded broadcasts
 *   --loss-any               ...and of every other type, `lens-frames` too
 *   --latency-game=300       centaur ↔ game server: the turn arrives late
 *   --turn-timeout=500       give the harness a real turn deadline
 *
 * Every one of them also reads from the environment (`LENS_LATENCY`,
 * `LENS_JITTER`, `LENS_LATENCY_GAME`, …). All default to zero, and at zero
 * nothing is installed at all.
 *
 * Then: `/game/lens-walk` is the LIVE game (POST `/dev/step` plays one more
 * turn into the connected sockets) and `/game/lens-walk-replay` is the same
 * recorded log read back through the replay path.
 */

import express from 'express';
import path from 'path';
import { createServer } from 'http';

import { ActiveGameManager } from '../server/active-game-manager';
import playRouter from '../routes/play';
import { DEFAULT_CONFIG } from '../config/game-config';
import { GameWebSocketServer } from '../server/websocket-server';
import { encodeEventRow, lensStringify, reviveLens } from '../lens/store';
import { unitKeyOf } from '../lens/kernel';
import type {
  LensDecisionPort,
  LensEvent,
  TurnEvent,
  TurnEventRow,
  UnitKey,
} from '../lens/types';
import type { Board, BoardSnapshot, Coord, Direction, Game, GameState } from '../types/battlesnake';
import type { JointPlan, KernelInput, PinEvent, UnitId } from '../lobster/contracts';
import { NO_ORDER_MOVE } from '../lobster/contracts';
// The row builder production publishes with, and the one translation from a
// staged cell to the Direction a snake puts on the wire. Both are imported
// rather than restated: a harness that built its own would be the one place
// the page's candidate list came from somewhere else.
import { buildDecisionRows } from '../lobster/telemetry';
import { moveIndexToDirection } from '../firebase/translate';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import { rigFor } from '../lobster/candidates';
// The SHIPPED digest, not a second opinion about one: it is what puts
// `evalVersion` on the frame, and a harness that built its own would be the
// one place the rail's provenance line came from somewhere else.
import { digestOf } from '../lobster/team-decision-engine';
import { defaultEvaluator } from '../lobster/evaluate';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import {
  DecisionClock,
  MIXED_SCENARIO,
  SNAKE_SCENARIO,
  SPARSE_SCENARIO,
  buildBoard,
  meteredEvaluator,
  stepGame,
  type GameSpec,
} from './local-game';

const SCENARIOS: Readonly<Record<string, GameSpec>> = {
  snake: SNAKE_SCENARIO,
  snakes: SNAKE_SCENARIO,
  mixed: MIXED_SCENARIO,
  sparse: SPARSE_SCENARIO,
};

interface Args {
  readonly port: number;
  readonly scenario: string;
  readonly seed: number;
  readonly nodes: number;
  readonly warmup: number;
  readonly gameId: string;
  /** The injected wire. All zero — the default — is the wire this harness has
   *  always had, and the walkthrough's own re-run is against exactly that. */
  readonly downMs: number;
  readonly upMs: number;
  readonly jitterMs: number;
  readonly lossRate: number;
  readonly lossAny: boolean;
  readonly gameLagMs: number;
  /** A real turn clock, in ms. `0` — the default — is the harness as it has
   *  always been: no `turnExpiryTime` on any envelope, so no countdown, and
   *  the widen banner's deadline-scaled timer stays on its 6 s cap. Setting
   *  it gives the page a deadline to draw and the latency surface a
   *  last-safe-press mark to put on it. */
  readonly turnTimeoutMs: number;
}

function args(): Args {
  const read = (name: string, fallback: string): string => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (hit !== undefined) return hit.slice(name.length + 3);
    const env = process.env[`LENS_${name.toUpperCase().replace(/-/g, '_')}`];
    return env === undefined ? fallback : env;
  };
  // `--latency=N` is both directions; `--latency-down` / `--latency-up` split
  // them, because the two are not symmetric to an operator: a slow DOWN hop
  // makes the board old, and a slow UP hop makes the press late.
  const both = read('latency', '0');
  return {
    port: parseInt(read('port', '5055'), 10),
    scenario: read('scenario', 'mixed'),
    seed: parseInt(read('seed', '1'), 10),
    nodes: parseInt(read('nodes', '550'), 10),
    warmup: parseInt(read('warmup', '2'), 10),
    gameId: read('game', 'lens-walk'),
    downMs: parseInt(read('latency-down', both), 10) || 0,
    upMs: parseInt(read('latency-up', both), 10) || 0,
    jitterMs: parseInt(read('jitter', '0'), 10) || 0,
    lossRate: parseFloat(read('loss', '0')) || 0,
    lossAny: read('loss-any', '') !== '',
    gameLagMs: parseInt(read('latency-game', '0'), 10) || 0,
    turnTimeoutMs: parseInt(read('turn-timeout', '0'), 10) || 0,
  };
}

/** An unref'd sleep, for the injected game-server hop. */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/** The runner's own food placement stream. Not the search's salt. */
function rngOf(seed: number): () => number {
  let t = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** `jsonb` and the socket in one line — the shipped codec, so anything an
 *  encoding cannot carry dies here rather than in a browser. */
function stored<T>(row: T): T {
  return reviveLens(JSON.parse(lensStringify(row)) as T);
}

/**
 * ONE EVENT, AS STORAGE HOLDS IT — including the anchor's settlement being
 * DROPPED, which is what `ActiveGameManager.logStoredEvent` does: `turn_boards`
 * holds the board under its own key and a board stored twice is two boards
 * waiting to disagree. The replay path must be walked against that, not
 * against a convenient copy that kept the board.
 */
function storedRow(event: TurnEvent): TurnEventRow {
  if (event.kind !== 'board.arrived') return stored(encodeEventRow(event));
  const payload = { ...(event.payload as Record<string, unknown>) };
  delete payload.settlement;
  return stored(encodeEventRow({ ...event, payload }));
}

/** The wire direction a staged destination is, for the snake units the
 *  transport reports resolved moves for. Null for anything that is not one
 *  orthogonal step (a piece, a rotation, an illegal stage). */
function directionOf(board: Board, head: Coord, to: number): Direction | null {
  const w = board.width + 2;
  const dx = (to % w) - 1 - head.x;
  const dy = Math.floor(to / w) - 1 - head.y;
  if (dx === 0 && dy === 1) return 'up';
  if (dx === 0 && dy === -1) return 'down';
  if (dx === -1 && dy === 0) return 'left';
  if (dx === 1 && dy === 0) return 'right';
  return null;
}

interface RecordedTurn {
  readonly turn: number;
  readonly settlement: BoardSnapshot;
}

async function main(): Promise<void> {
  const opts = args();
  const spec = SCENARIOS[opts.scenario];
  if (spec === undefined) throw new Error(`unknown scenario ${opts.scenario}`);

  const meta: Game = {
    id: opts.gameId,
    ruleset: { name: 'standard', version: 'v1', settings: {} },
    map: 'standard',
    timeout: 500,
    source: 'lens-walkthrough',
  };
  const teamId = (spec.teams[0] as { id: string }).id;
  const foodTarget = spec.foodTarget ?? spec.food.length;
  const rng = rngOf(opts.seed);

  let board: Board = buildBoard({ ...spec, seed: opts.seed });
  let turn = 1;
  const log: RecordedTurn[] = [];

  const manager = ActiveGameManager.getInstance();
  // ── THE WRITE SIDE OF THE STAND-IN ──────────────────────────────────────
  //
  // `stageMove` publishes every staged move through the `MoveSubmitter` and
  // then waits for the wire to ACK it; production's ack is the Firestore
  // read-back calling `setConfirmedStagedMove`. With no submitter wired the
  // manager logged `NOT published`, the backstop fired every retry interval
  // for the whole run, and each retry wrote a `stage.retry` event — so the
  // rail repainted forever over a move nobody was ever going to confirm.
  //
  // This file stands in for Firestore, so it stands in for the ack too: the
  // write succeeds and reads back as itself. The staging lane gets its
  // `stage.requested` → `stage.confirmed` pair, which is the pair the walk is
  // supposed to photograph, and the retry backstop stays for the case it was
  // written for.
  manager.setMoveSubmitter(async (gameId, snakeId, at, move) => {
    manager.setConfirmedStagedMove(gameId, snakeId, at, move);
  });
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../web')));
  // `root` rather than an absolute path: a worktree lives under `.claude/`,
  // and `send`'s default `dotfiles: 'ignore'` 404s any absolute path with a
  // dot-segment in it. The root is resolved once and only the leaf is checked.
  app.get('/game/:id', (_req, res) => {
    res.sendFile('play-game.html', { root: path.join(__dirname, '../web') });
  });

  // ── The read side, off the list instead of off Postgres ─────────────────
  // Deliberately answered for ANY game id: `/game/<anything>-replay` is the
  // same recorded log read back through the replay path, which is what makes
  // a live/replay diff of one turn possible in one process.
  // The listing is served under BOTH ids — the live game's and the `-replay`
  // alias — because the page matches this list against the id in its own URL,
  // and the alias is what makes a live-vs-replay diff of one turn possible in
  // one process.
  app.get('/api/logs/games', (_req, res) => {
    const ours = (board.snakes ?? []).filter((s) => s.teamID === teamId);
    const group = (gameId: string): unknown => ({
        game_id: gameId,
        team_key: teamId,
        team_label: teamId,
        team_color: null,
        timestamp: new Date().toISOString(),
        turns: log.length,
        default_snake_id: ours[0]?.id ?? '',
        snakes: ours.map((s) => ({
          snake_id: s.id,
          snake_name: s.name,
          color: null,
          length: s.length,
          turns: log.length,
        })),
        started_at: null,
        ended_at: null,
        final_turn: log.length === 0 ? null : (log[log.length - 1] as RecordedTurn).turn,
        board_width: board.width,
        board_height: board.height,
        ruleset_name: 'standard',
        winner_snake_id: null,
        winner_name: null,
        end_reason: null,
    });
    res.json([group(opts.gameId), group(`${opts.gameId}-replay`)]);
  });

  app.get('/api/games/:gameId/turns', (_req, res) => {
    res.json({
      turns: log.map((t) => ({ turn: t.turn, game_state: t.settlement, native: true })),
      finalTurn: log.length === 0 ? null : (log[log.length - 1] as RecordedTurn).turn,
      hasNative: log.length > 0,
    });
  });

  app.get('/api/logs', (req, res) => {
    const start = req.query.startTurn == null ? -Infinity : Number(req.query.startTurn);
    const end = req.query.endTurn == null ? Infinity : Number(req.query.endTurn);
    // Read at request time, not frozen at the end of the turn: storage keeps
    // accumulating (an operator's lock lands after the board moved on), and a
    // replay that stopped at the turn's last DECISION event would be a
    // different prefix from the one the live client ended on — which is a
    // difference in the harness, not in the product, and would show up as one.
    const events = log
      .filter((t) => t.turn >= start && t.turn <= end)
      .flatMap((t) => (captured.get(t.turn) ?? []).map((e) => storedRow(e).payload));
    // `lensStringify`, exactly as `turn_events.payload` is written: `hi: +∞` is
    // the lattice top before anything is proved above the incumbent, and plain
    // `JSON.stringify` flattens it to `null`. Postgres holds the NAMED form and
    // hands it back, so a stub that re-encoded with the wrong serialiser would
    // have the replay path reading `—` where production reads `∞`.
    res.type('application/json').send(lensStringify({ events }));
  });

  app.get('/api/logs/commands', (_req, res) => res.json([]));
  // THE REAL PLAY ROUTES. `/api/play/game/:id` 404ing is what tips the page
  // into `enterFinishedMode` — a live game read as a finished one — so the
  // walkthrough must mount the router rather than stub around it.
  app.use(playRouter);
  app.get('/api/config', (_req, res) => res.json(DEFAULT_CONFIG));
  app.get('/api/firebase-status', (_req, res) =>
    res.json({ state: 'not_configured', error: 'local walkthrough', since: Date.now() })
  );

  const httpServer = createServer(app);
  const ws = new GameWebSocketServer(httpServer);
  // ── THE INJECTED WIRE ───────────────────────────────────────────────────
  // Both hops are free in this process, so a latency surface built here would
  // be a surface nobody had ever seen say anything. This makes them cost
  // something on demand: `--latency=120 --jitter=40` is a plausible bad
  // connection, `--latency-game=300` is a game server falling behind, and
  // `--loss=0.1` drops a tenth of the superseded broadcasts (add `--loss-any`
  // to drop `lens-frames` too, which is unrecoverable by design and is
  // therefore worth being able to see rather than worth leaving on).
  //
  // ZERO IS THE DEFAULT AND ZERO IS THE SHIPPED WIRE: with no flags the
  // shaping is never installed, so `10-WALKTHROUGH.md`'s re-run compares
  // against the same transport it always did.
  const shaped =
    opts.downMs > 0 || opts.upMs > 0 || opts.jitterMs > 0 || opts.lossRate > 0;
  if (shaped) {
    ws.shapeTransport({
      downMs: opts.downMs,
      upMs: opts.upMs,
      jitterMs: opts.jitterMs,
      lossRate: opts.lossRate,
      lossAny: opts.lossAny,
    });
  }
  // The one outbound path, wired exactly as `src/index.ts` wires it — and
  // tapped on the way past, because the manager is also the only place the
  // turn's written events can be read back without a database.
  const captured = new Map<number, TurnEvent[]>();
  manager.onLensEvents((gameId, at, events, head) => {
    const held = captured.get(at) ?? [];
    held.push(...events);
    captured.set(at, held);
    ws.broadcastLensFrames(gameId, at, events, head);
  });

  /**
   * ONE TURN, watched — through `ActiveGameManager.lensDecision`, which is the
   * seam production binds (`firebase-interface.ts`'s `lensSink` port). The
   * manager is the ONE `seq` writer: it opens the turn with its own
   * `board.arrived` anchor, stamps every kernel frame, writes `decision.begin`
   * / `decision.end` (which is where the rail's provenance line comes from),
   * and broadcasts the batches. A second writer here would be a second order.
   *
   * The synthetic operator is scripted on EMISSION COUNT, not on the clock: it
   * hovers the cluster on every emission (a conditional list — a read of rows
   * the decision already priced), drills the leader once so the turn's log
   * holds a breakdown, pins its first unit onto whatever the bot has staged
   * for it at emission 2, and releases the pin at emission 4 so the cluster
   * WIDENS while a browser is looking at it.
   */
  async function playTurn(): Promise<void> {
    // THE SECOND HOP. The turn exists at the game server now; the centaur
    // learns about it `--latency-game` milliseconds later, and reports the
    // difference to every operator as `gameLagMs`. The whole decision moves
    // with it, which is the point — a late turn is a late decision, not just
    // a late number.
    const producedAt = Date.now();
    ws.noteTurnOrigin(opts.gameId, producedAt);
    await delay(opts.gameLagMs);
    const settlement: BoardSnapshot = { game: meta, turn, board };
    const ourIds = (board.snakes ?? [])
      .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
      .map((s) => s.id);

    if (turn === 1) {
      for (const id of ourIds) {
        manager.registerGame(settlement, id, { id: teamId, name: teamId, color: '#e53935' });
      }
    }
    // THE TURN CLOCK, when one was asked for. `recordTurnArrival` is the seam
    // production's Firebase interface calls with the game server's own expiry;
    // this passes the local timeout instead, which is the same computation
    // (`arrival + timeout − delivery estimate`) with a locally-sourced arrival.
    // It is set BEFORE `updateBoard`, because that is what broadcasts the turn
    // and the deadline has to be on the envelope that carries it.
    if (opts.turnTimeoutMs > 0) {
      manager.recordTurnArrival(opts.gameId, Date.now(), opts.turnTimeoutMs);
    }
    manager.updateBoard(opts.gameId, settlement);

    const sub = makeSubstrate({
      gameId: opts.gameId,
      board,
      turn,
      asTeam: teamId,
      modeled: ourIds,
    });

    const staged = new Map<string, number>();
    let events: ReadonlyArray<TurnEvent> = [];
    try {
      const asTeam = sub.teamNumber(teamId);
      const clock = new DecisionClock(true);
      const { gen, search } = rigFor(sub, { seed: opts.seed });
      const options = {
        ...DEFAULT_KERNEL_OPTIONS,
        crossfade: 'teammate' as const,
        reserveMs: 0,
        sliceMs: opts.nodes / 6,
        maxSliceFraction: 0,
        pinCacheCapacity: 32,
        minWriteIntervalMs: 0,
        yieldIntervalMs: 0,
      };
      const kernel = new LobsterKernel(options);
      // ONE evaluator object for the decision and for its provenance: the
      // identity `digestOf` hashes must be the identity the bank keyed on.
      const evaluate = meteredEvaluator(defaultEvaluator, clock);

      const lens = manager.lensDecision(opts.gameId, turn, {
        input: {
          asTeam,
          seed: opts.seed,
          assumptions: [],
          initialPins: [],
          modelled: ourIds as ReadonlyArray<UnitKey>,
          botId: 'lobster-local',
          behaviourId: `walkthrough/${opts.scenario}`,
          nodeBudget: opts.nodes,
          liveBudgetMs: 0,
          kernelOptions: digestOf(
            options as unknown as Parameters<typeof digestOf>[0],
            evaluate
          ),
        },
        engine: 'lobster',
        profile: 'default',
        unitKeyOf: (unitId: number): UnitKey | null => unitKeyOf(sub, unitId),
      });

      const t0 = clock.now();
      const stopAt = t0 + opts.nodes;
      const kin: KernelInput = {
        sub,
        gen,
        evaluate,
        search,
        asTeam,
        deadlineMs: t0 + opts.nodes * 4,
        initialPins: [],
        assumptions: [],
        now: clock.now,
        abandoned: () => clock.work() >= stopAt,
        ...(lens === null ? {} : { lens: (event: LensEvent) => lens.frame(event) }),
      };

      const port = kernel.lensPort();
      const commandable = sub.commandable(asTeam);
      const subject = commandable[0];
      let emitted = 0;
      let drilled = false;
      let plan: JointPlan | null = null;

      for await (const rec of kernel.decide(kin)) {
        plan = rec.plan;
        emitted++;
        const cluster = port.partition().find((c) => c.members.length > 0);
        if (cluster !== undefined && !drilled) {
          const leader = port.movesets(cluster.id)[0];
          if (leader !== undefined) {
            await port.explainMoveset(leader.key);
            drilled = true;
          }
        }
        if (cluster !== undefined) {
          const anchorUnit = cluster.members[0] as string;
          const lock = lockFor(anchorUnit, rec.plan, sub.unitIdOf(anchorUnit));
          if (lock !== null) port.rankConditional(cluster.id, [lock]);
        }
        // THE OPERATOR ACTS, THROUGH THE PRODUCTION ORDER: the command is
        // written to the turn's log first and the kernel is told with the id
        // it was written under, which is what `routeToKernel` does off the
        // wire's pin stream. Calling `onPinEvent` directly — as this harness
        // did — is the one thing that would keep the lane's operator ticks
        // verbless and colourless in a walk whose whole job is to look at them.
        // THE ATTENTION CHANNEL, WITH A PRODUCER (10 §4 O4). A look is a
        // TENTATIVE pin — a hint the search may speculate on, never a
        // constraint — and it travels the same two lines as a binding one, so
        // the lane has a hollow tick to hide behind its expand toggle and the
        // toggle stops being a control over nothing. It precedes the binding
        // pin because that is the order an operator produces them in, and the
        // ledger's precedence rule (a hover never weakens a binding pin) is
        // the thing that makes the order safe.
        if (subject !== undefined && emitted === 1) {
          const to = rec.plan.get(subject)?.to;
          if (to !== undefined) {
            operatorAct(kernel, lens, clock, t0, {
              kind: 'pin',
              pin: { unitId: subject, to, tentative: true },
            });
          }
        }
        if (subject !== undefined && emitted === 2) {
          const to = rec.plan.get(subject)?.to;
          if (to !== undefined) {
            operatorAct(kernel, lens, clock, t0, {
              kind: 'pin',
              pin: { unitId: subject, to, tentative: false },
            });
          }
        }
        if (subject !== undefined && emitted === 4) {
          operatorAct(kernel, lens, clock, t0, { kind: 'unpin', unitId: subject });
        }
      }

      lens?.end({ abandoned: true, stagedNothing: plan === null, counters: { nodes: clock.nodes } });

      if (plan !== null) {
        for (const [unitId, cand] of plan) {
          const unit = sub.unitOf(unitId);
          if (unit !== undefined) staged.set(unit.wireId, cand.to);
        }
      }

      // ── THE UNIT'S OWN CANDIDATE ENUMERATION, PUBLISHED ────────────────
      //
      // Until this block the harness broadcast a board and a decision and
      // NOTHING per unit, so `setupMoveStateForSnake` never ran with
      // `moveEvaluations`, `moveState.moves` was `{}` for the whole run, and
      // no press of `Space` could stage anything on any candidate in any
      // state the walk reached (05 §0). The staging path — the single most
      // important gesture on the surface — had never been exercised in a
      // browser, which is how a candidate click that never armed `Space` for
      // a snake shipped behind a comment saying it was fixed (H-2).
      //
      // THE PRODUCTION ORDER, NOT A CONVENIENT ONE. `emitTelemetry` in
      // `lobster/team-decision-engine.ts` builds the rows with
      // `buildDecisionRows` and hands each one to
      // `ActiveGameManager.setBotRecommendation`, which is what emits
      // `snake-turn-update` — the message the page reads. This is those two
      // calls, with the same row builder, the same `TurnData` fields and the
      // same snakes-only rule (a PIECE's rows are rebuilt by the manager from
      // its own candidate enumeration, so publishing lobster rows for one
      // would trade a richer live panel for a poorer one).
      //
      // It runs BEFORE the turn resolves, because that is where it sits in
      // production: the decision publishes what it considered, and only then
      // does the deadline take the staged move.
      if (plan !== null) {
        const views = new Map<string, GameState>(
          (board.snakes ?? [])
            .filter((s) => ourIds.includes(s.id))
            .map((s) => [s.id, { game: meta, turn, board, you: s } as GameState])
        );
        const rows = buildDecisionRows({
          gameId: opts.gameId,
          sub,
          asTeam,
          gen,
          evaluate,
          finalPlan: plan,
          views,
          // The engine's own `moveOf`, which is private to it: a snake stages
          // a Direction, a piece the full-board destination index, and a
          // destination the wire has no word for keys no row at all.
          moveOf: (unit, candidate) => {
            if (unit.type !== 'snake') {
              return candidate.to === NO_ORDER_MOVE
                ? (unit.cells[0] as number)
                : candidate.to;
            }
            if (candidate.to === NO_ORDER_MOVE) return null;
            return moveIndexToDirection(unit.cells[0] as number, candidate.to, sub.grid.width);
          },
        });
        for (const row of rows) {
          const unit = sub.unitOfWireId(row.snakeId);
          const view = views.get(row.snakeId);
          if (unit === undefined || unit.type !== 'snake' || view === undefined) continue;
          const to = staged.get(row.snakeId);
          const move =
            to === undefined
              ? null
              : moveIndexToDirection(unit.cells[0] as number, to, sub.grid.width);
          if (move === null) continue;
          manager.setBotRecommendation(opts.gameId, row.snakeId, move, {
            gameState: view,
            moveEvaluations: row.moveEvaluations,
            territoryCells: {},
            botRecommendation: move,
            timestamp: Date.now(),
            bot: { botId: 'lobster-local', behaviourId: `walkthrough/${opts.scenario}` },
          });
        }
      }
      events = captured.get(turn) ?? [];
    } finally {
      sub.release();
      clearGeometryCache();
    }

    // THE TURN RESOLVES through the manager's own writer, so `turn.resolved`
    // and the staging lane are the shipped rows rather than invented ones.
    const directions: { [snakeId: string]: Direction } = {};
    for (const snake of board.snakes ?? []) {
      const to = staged.get(snake.id);
      if (to === undefined || snake.unitType !== undefined && snake.unitType !== 'snake') continue;
      const dir = directionOf(board, snake.head, to);
      if (dir !== null) directions[snake.id] = dir;
    }
    manager.applyResolvedMoves(opts.gameId, turn, directions);

    const outcome = stepGame(board, turn, staged, rng, foodTarget);
    log.push({ turn, settlement });
    console.log(
      `[walkthrough] turn ${turn} — ${events.length} events, ` +
        `${staged.size} staged, ${outcome.deaths.length} deaths`
    );
    board = outcome.board;
    turn++;
  }

  let stepping: Promise<void> = Promise.resolve();
  app.post('/dev/step', (_req, res) => {
    stepping = stepping.then(playTurn).catch((err) => {
      console.error('[walkthrough] step failed:', err);
    });
    void stepping.then(() => res.json({ ok: true, turn: turn - 1, turns: log.length }));
  });
  // The turn's events AS BROADCAST (settlement intact) — the live side of the
  // live-vs-replay diff, readable without a browser.
  app.get('/dev/events', (req, res) => {
    const at = Number(req.query.turn ?? turn - 1);
    res.type('application/json').send(lensStringify(captured.get(at) ?? []));
  });
  app.get('/dev/state', (_req, res) =>
    res.json({ turns: log.map((t) => t.turn), next: turn, gameId: opts.gameId })
  );

  await new Promise<void>((resolve) => httpServer.listen(opts.port, '127.0.0.1', resolve));
  console.log(`[walkthrough] listening on http://127.0.0.1:${opts.port}`);
  console.log(
    shaped || opts.gameLagMs > 0 || opts.turnTimeoutMs > 0
      ? `[walkthrough] wire: down ${opts.downMs}ms · up ${opts.upMs}ms · ` +
          `jitter ±${opts.jitterMs}ms · loss ${(opts.lossRate * 100).toFixed(0)}%` +
          `${opts.lossAny ? ' (any type)' : ''} · game hop ${opts.gameLagMs}ms` +
          `${opts.turnTimeoutMs > 0 ? ` · turn clock ${opts.turnTimeoutMs}ms` : ''}`
      : '[walkthrough] wire: unshaped — both hops are free'
  );

  for (let i = 0; i < opts.warmup; i++) await playTurn();
  console.log(
    `[walkthrough] ready — /game/${opts.gameId} is live, ` +
      `/game/${opts.gameId}-replay replays the same log`
  );
}

/**
 * One operator gesture, in the causal order production uses: the command is
 * written to the turn's log, and the kernel is told about it WITH the id it
 * was written under — so the record that conforms to it names the question it
 * answers, and the lane's tick carries the verb, the unit and the operator.
 * `src/lens/kernel/record.ts::command` is the same three lines; this is the
 * live half of them.
 */
function operatorAct(
  kernel: LobsterKernel,
  lens: LensDecisionPort | null,
  clock: DecisionClock,
  t0: number,
  event: PinEvent
): void {
  const id = lens?.command(event, clock.now() - t0) ?? null;
  kernel.onPinEvent(event, id);
}

function lockFor(
  unit: string,
  plan: JointPlan,
  unitId: UnitId | undefined
): { unit: string; to: number } | null {
  if (unitId === undefined) return null;
  const to = plan.get(unitId)?.to;
  return to === undefined ? null : { unit, to };
}

void main().catch((err) => {
  console.error('[walkthrough] failed:', err);
  process.exit(1);
});
