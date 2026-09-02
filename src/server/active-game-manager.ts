import { GameState, BoardSnapshot, Direction, Coord, CentaurMove } from '../types/battlesnake';
// Type-only: the wire layer's staged-unit shape, so the team path speaks one
// vocabulary end to end. Erased at compile time, so there is no module cycle
// with src/wire/team-submitter.ts (which imports IntendedMoveSource from here,
// also type-only).
import type { TeamStagedUnit } from '../wire/team-submitter';
import { BoardGraph } from '../logic/board-graph';
import {
  CasualtyContext,
  emptyCasualtyContext,
  evaluateCandidatePath,
  healthAfterEntering,
  marshalBoard,
} from '../logic/turn-oracle';
import { planPieceAction, legalPieceDestinations, PieceAction, Orientation } from '../logic/piece-moves';
import { apiCoordToIndex, toApiCoord } from '../firebase/translate';
import { pickBestMove } from '../logic/decision-engine';
import { DEFAULT_CONFIG } from '../config/game-config';
import {
  WaypointContext,
  WaypointCandidateProgress,
  WaypointProbe,
  RouteStep,
  waypointRoute,
  waypointProgressByDestination,
} from '../logic/waypoint-pathing';
import { CellOwnership } from '../logic/multi-source-bfs';
import type { BotIdentity } from '../config/bot-identity';
import { DecisionLogger } from '../logic/decision-logger';
import { CommandLogger, OperatorRef } from '../logic/command-logger';
import { ActivityController, ManagedTimerHandle, transientTimeout } from './activity-controller';
import { GAME_PROGRESS_WINDOW_MS } from '../shared/idle-policy';
import { colorForArrivalIndex } from '../shared/player-palette';

export interface MoveEvaluation {
  // The candidate id: a Direction for snakes (byte-identical to the historic
  // rows), a FULL-BOARD destination index for chess pieces — the same
  // CentaurMove value staging puts on the wire.
  move: CentaurMove;
  score: number;
  numStates: number;
  breakdown: any;
  projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
  // The candidate's destination cell (api coords). Always present on piece
  // rows (the enumerator computes it); present on snake rows when the engine's
  // projection pass ran. Optional so legacy rows stay valid.
  dest?: Coord;
  // Piece candidate kind (the PieceAction discriminant): lets the client label
  // candidates and route pawn arrow keys to the side-square rotations. Absent
  // on snake rows.
  kind?: 'stay' | 'move' | 'rotate';
}

// One legal chess-piece candidate with the waypoint bias applied: the staged
// destination it would put on the wire, the action that destination plans, and
// the score ordering it against the piece's other candidates.
interface PieceCandidateScore {
  move: number;
  action: PieceAction;
  destCoord: Coord;
  // Which waypoint produced `stat`, or null when none is active.
  kind: 'goto' | 'near' | null;
  weight: number;
  stat: number;
  // Moves still to run from this candidate to the target (null = unreachable).
  dist: number | null;
  // Health this candidate's path costs, read off a turn the real engine
  // resolved (turn-oracle.ts — the SAME oracle the snake health-loss
  // heuristic uses), folded additively into `score` at DEFAULT_CONFIG.healthLoss.
  healthCost: number;
  // The projection resolved this candidate as DEATH (projected health 0): the
  // ray enters a square the piece cannot survive — a snake body segment at or
  // above its tier (ally bodies included; the engine never teams), a piece
  // contest it loses or ties, a wall, or hazard doses that exhaust it.
  // Charged as DEFAULT_CONFIG.deaths in `score`, exactly like a snake's
  // `deaths` stat, AND vetoed outright in bestPieceCandidate — except when the
  // same traversal ends an enemy team (see `casualties.enemyRegicide`), which
  // is a winning trade rather than a suicide.
  fatal: boolean;
  // What this candidate DOES to the units it passes through, from the same
  // projection (contests have no friendly exemption, so our own ray kills our
  // own units): ally weight destroyed, enemies killed, and the two regicide
  // flags. `regicide` is vetoed in bestPieceCandidate exactly like `fatal`.
  casualties: CasualtyContext;
  score: number;
}

export interface TurnData {
  gameState: GameState;
  moveEvaluations: MoveEvaluation[];
  territoryCells: { [snakeId: string]: { x: number; y: number }[] };
  safeMoves: Direction[];
  // A Direction for a snake; a FULL-BOARD destination index for a chess piece
  // (own square = stay), the same CentaurMove split staging uses. Pieces had
  // no bot route at all until the piece recommendation channel existed — see
  // `updatePieceTurn` and `setBotRecommendation`.
  botRecommendation: CentaurMove | null;
  timestamp: number;
  // Per-cell Voronoi owner/distance for the current board (cell inspector).
  // Absent on the quick pass and interim recommendations.
  cellOwnership?: CellOwnership;
  // WHICH BOT PRODUCED THIS RECOMMENDATION — the same pair stamped on the
  // decision row (src/config/bot-identity.ts). The UI otherwise shows a move
  // with no way to say which configuration or which build made it, which is
  // exactly the question an operator watching two Centaur teams play different
  // bots is asking. Absent on the quick pass and the legacy fan-out, neither
  // of which resolves a binding.
  bot?: BotIdentity;
}

// The Voronoi partition of the WHOLE board for one turn: which unit owns each
// cell and how far its head is from it. This is a property of the BOARD, not
// of any one unit — every unit on it, snake or chess piece, is a source of the
// same BFS and every unit's territory is in the same grid.
//
// It only happens to be COMPUTED inside a snake's engine decision (pieces get
// no engine pass at all), so it arrives on that snake's TurnData; the manager
// lifts it straight onto the game the moment it lands. Selection-driven views
// — the territory overlay, the cell inspector — read it from here, per game
// per turn, so they behave identically whichever unit the user has selected.
export interface BoardTerritory {
  turn: number;
  territoryCells: { [snakeId: string]: { x: number; y: number }[] };
  cellOwnership: CellOwnership | null;
}

// The write-through publisher for staged moves. Firestore is the single
// source of truth for what is staged: EVERY staging action (bot
// recommendation, manual selection, queue step, waypoint step, revert to
// heuristic, suicide) funnels through stageMove, which invokes this submitter
// so the staged move is immediately represented in Firebase. The game server
// resolves each turn with the last staged move it received before the turn
// deadline — nothing on this side commits automatically.
// A Direction is a snake's move; a number is a chess piece's destination as a
// FULL-BOARD square index (own square = stay), written to the wire verbatim.
export type MoveSubmitter = (
  gameId: string,
  snakeId: string,
  turn: number,
  move: CentaurMove,
  source: IntendedMoveSource
) => Promise<void>;

// The TEAM-scoped write-through publisher, an OPT-IN alternative to the
// per-unit MoveSubmitter above. Where MoveSubmitter is one call per unit —
// one loose document each, a mixed set on the server if the process dies
// between two of them — this is handed the team's whole staged set for one
// turn and puts it on the wire as atomic writeBatch chunks (see
// src/wire/team-submitter.ts, which owns the chunking, exclusion, throttling
// and confirm/retry).
//
// It is never the default. A game uses this path only after an explicit
// `enableTeamStaging(gameId, true)`, which the team decision engine calls for
// the games it drives; every other game keeps the per-unit path unchanged,
// down to the retry timer.
export type TeamMoveSubmitter = (
  gameId: string,
  turn: number,
  moves: ReadonlyArray<TeamStagedUnit>
) => Promise<void>;

// What a pin observer is told. `staged` is the manager binding a move (the
// move's `source` is the rung of the precedence ladder it came from, which is
// what makes it a pin or not); `considering` and `cleared` are the UI's
// hover / selection-consideration, which has no wire representation at all.
//
// Observation only: nothing an observer does can change what is staged, and
// the manager does not care whether anyone is listening.
export type PinIntentKind = 'staged' | 'considering' | 'cleared';
export interface PinIntentEvent {
  readonly gameId: string;
  readonly snakeId: string;
  readonly turn: number;
  readonly move: CentaurMove | null;
  readonly source: IntendedMoveSource | null;
  readonly kind: PinIntentKind;
}
export type PinIntentObserver = (event: PinIntentEvent) => void;

// The optional HUMAN-triggered "done" signal (Submit All): marks one snake as
// finished for the turn in Firebase (moveStatuses.movedPlayerIDs), letting the
// game server resolve the turn early once EVERY alive player has committed.
// Never invoked automatically — only from an explicit user action. The staged
// move itself is unaffected: whatever is staged at resolution time is what
// plays, and a commit is irreversible for the turn.
export type MoveCommitter = (
  gameId: string,
  snakeId: string,
  turn: number
) => Promise<void>;

export type IntendedMoveSource = 'manual' | 'waypoint' | 'bot' | 'fallback';

// ── Fatal-move consent brand ────────────────────────────────────────────────
// A branded value proving a HUMAN explicitly consented to staging a
// certain-death move. There are exactly TWO mint points, both server-side and
// both inside this module (the symbol and mint function are deliberately NOT
// exported, so no other code path can forge consent):
//   1. confirmFatalMove — the dialog-accept message handler's entry point,
//      which re-validates fatality server-side before minting.
//   2. The kill-all / armed-suicide path, which is deliberate death by design.
// The brand rides on the manual intent, flows through computeIntendedMove into
// stageMove (the single staged-move writer), which refuses to stage an
// unconsented human certain-death move and falls back to the bot's move.
declare const fatalConsentBrand: unique symbol;
export type FatalMoveConsent = { readonly [fatalConsentBrand]: true };
function mintFatalMoveConsent(): FatalMoveConsent {
  return Object.freeze({}) as FatalMoveConsent;
}

export interface IntendedMove {
  // Snakes always resolve to a Direction; the type is CentaurMove so every
  // consumer must narrow before running direction-only logic. (Pieces never
  // pass through computeIntendedMove — they stage via stagePieceMove.)
  direction: CentaurMove;
  source: IntendedMoveSource;
  // Present only when a manual intent carries fatal-move consent.
  consent?: FatalMoveConsent;
}

// A controlled snake's resolved next move, bound as one atomic value to the
// (snakeId, turn) it was computed for. Written only by `stageMove`, replaced as
// a whole (its fields are readonly — never mutate one in place), and accepted at
// commit only through `stagedMoveForTurn`, which honours it solely when both the
// snake and turn align. `null` means there is no staged move for the snake.
export interface StagedMove {
  readonly snakeId: string;
  readonly turn: number;
  // Direction for snakes; full-board destination index for chess pieces.
  readonly move: CentaurMove;
  readonly source: IntendedMoveSource;
  // True when this move carried explicit fatal-move consent (the user confirmed
  // the certain-death dialog, or used kill-all). Recorded onto the decision log
  // at commit so replays can distinguish a deliberate death from a bot mistake.
  readonly fatalConsented: boolean;
  // Chess pieces only: the PieceAction the staged destination planned to
  // (stay / move-with-path / rotate-with-orientation), captured at bind time — the
  // only moment origin + orientation are guaranteed to match the staged turn. Lets
  // the broadcast distinguish a pawn rotation from a one-square move. Absent
  // for snakes.
  readonly action?: PieceAction | null;
}

// A controlled snake's intention: ONE discriminated union, so two sources can
// never be populated at once (mutual exclusion is structural, not enforced by
// clearing logic). Set only through `setIntent`, which re-stages the move.
//  - heuristic: no user direction — the bot's recommendation drives the move
//  - manual:    the user picked a specific next move (single-turn; reset each turn)
//  - goto:      a QUEUE of click-targets (green). targets[0] is active and is the
//               only one handed to the decision engine, where it biases the
//               heuristic matrix through a bounded progress stat — it never
//               overrides the move. Arriving shifts the queue; an emptied queue
//               reverts to heuristic. (This replaced the cell-by-cell premove
//               queue: a chain of goto targets expresses the same multi-step
//               plan, but every step is still arbitrated by the full matrix
//               instead of walked blindly.)
//  - near:      a single click-target (blue) biasing the matrix toward staying
//               close WITHOUT ever arriving. Never auto-clears.
//
// The TARGETS are the only durable state. Routes and stats are always
// recomputed from the live board — see ControlledSnake.gotoRoute.
export type SnakeIntent =
  | { kind: 'heuristic' }
  // manual.move is CentaurMove: a Direction for snakes, a FULL-BOARD
  // destination index for chess pieces (setUserSelection enforces the split).
  | { kind: 'manual'; move: CentaurMove; fatalConsent?: FatalMoveConsent }
  | { kind: 'goto'; targets: Coord[] }
  | { kind: 'near'; target: Coord };

// The active next-move source, exposed to clients as `activeIntentModes`. Mirrors
// the union's discriminant so the client contract is unchanged.
export type IntentMode = SnakeIntent['kind'];

// Staged-move projection broadcast to clients (and snapshotted per turn by the
// command logger): the three-layer requested → confirmed → final pipeline plus
// the render colour/source and the fatal warning flag. Moves are CentaurMove:
// a Direction string for snakes, a full-board destination index for pieces.
export interface StagedMoveView {
  move: CentaurMove | null;
  requestedMove: CentaurMove;
  committed: boolean;
  color: string;
  source: string;
  fatal: boolean;
  // Pawn rotation: the NEW orientation (wire convention, dy grows downward) when
  // the requested move is a side-square rotation; null/absent otherwise. The
  // client renders a rotation symbol on the pawn's cell instead of a
  // destination arrow. Flows to live broadcasts AND the persisted per-turn
  // command snapshot through this one projection.
  rotation?: { dx: number; dy: number } | null;
}

// A unit's drawn goto route: one cell per TURN of its predicted trajectory,
// the count of leading cells belonging to this turn's committed leg, and — only
// for a plan that contains a turn spent TURNING — the new orientation at each
// such cell, index-aligned with `cells` (null on ordinary steps). `rotations`
// is omitted entirely when the plan has none, so every unit that cannot rotate
// puts exactly the bytes on the wire it always did, and a replayed snapshot
// from before rotations existed reads as "no rotations".
export interface RouteView {
  cells: Coord[];
  firstLeg: number;
  rotations?: ({ dx: number; dy: number } | null)[];
}

// Everything a client (live or replay) needs to render the command state of a
// game's snakes, in exactly the shape the live WebSocket broadcast uses. The
// command logger persists one of these per (game, turn) when the turn
// resolves, so the history viewer replays command state through the same
// render paths as live play.
export interface CommandTurnState {
  stagedMoves: { [snakeId: string]: StagedMoveView };
  waypoints: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } };
  routes: { [snakeId: string]: RouteView };
  activeIntentModes: { [snakeId: string]: IntentMode };
  owners: { [snakeId: string]: { userId: string; name: string; color: string } | null };
  // The operator whose command produced each snake's ACTIVE intent (null for
  // heuristic / bot-driven snakes). Unlike `owners` this tracks the command,
  // not the persistent snake ownership.
  operators: { [snakeId: string]: OperatorRef | null };
}

export interface SnakeInfo {
  id: string;
  name: string;
  letter: string;
}

export interface ControlledSnake {
  id: string;
  name: string;
  letter: string;
  // The unit's current kind: 'snake' or a chess-piece type. Kept fresh on every
  // board intake (pawn promotion changes pawn → queen mid-game). Pieces skip
  // every direction-only path: fatal gate, reversal tripwire, suicide moves,
  // waypoint re-bias, goto routes.
  unitType: string;
  latestTurnData: TurnData | null;
  // The bot's own choice for this unit — the THIRD rung of the precedence
  // ladder, below manual and waypoint and above the hard fallback. A Direction
  // for a snake, a full-board destination index for a piece. `null` means the
  // bot has nothing to say: a snake then falls back to 'up', and a piece stages
  // nothing at all (the server defaults it to stay), which is exactly what
  // every piece did before there was a piece bot route.
  botRecommendation: CentaurMove | null;
  selectedBy: string | null;
  // Persistent ownership: the last player to select this snake. Unlike
  // `selectedBy` (the single active selection, cleared on deselect/switch),
  // ownership persists after the player selects a different snake, drives the
  // on-board player-name tag, Tab cycling, and the takeover confirmation.
  // Survives disconnects (like name enrolments) so a reconnecting player keeps
  // their snakes.
  ownedBy: string | null;
  suicideArmed: boolean;
  // Who armed the pending suicide (kill-all before turn data existed), so the
  // deferred staging attributes to the right operator.
  suicideArmedBy: OperatorRef | null;
  // The snake's intention — the single source of truth for the goto/near
  // targets, the manual selection, and the active mode. Set only through
  // `setIntent`. The client-facing projections (waypoints, routes,
  // activeIntentModes) are derived from this.
  intent: SnakeIntent;
  // The operator whose command produced the CURRENT intent. Null while the
  // intent is heuristic (bot-driven). Preserved across server-side intent
  // transitions that continue the same command (goto arrival shifts), so
  // command attribution survives deselects and disconnects for as long as the
  // command is in force. Feeds the command log and the staged-arrow colour.
  intentBy: OperatorRef | null;
  // DERIVED display cache for the green goto path — deliberately NOT part of
  // the intent, because it is never durable state. Recomputed by
  // `refreshGotoRoute` on every stage: while a move is staged it is
  // [stagedDestination, ...shortestPath(stagedDestination → targets[0])]; once
  // the staged move is consumed it re-anchors as the plain shortest path from
  // the projected head. Empty whenever goto isn't active.
  gotoRoute: Coord[];
  // How many leading cells of `gotoRoute` belong to the FIRST leg (head →
  // targets[0]), including the staged step. Everything after this index is a
  // prediction that assumes each earlier target is reached, so the client draws
  // it faded. 0 when there is no route.
  gotoRouteFirstLeg: number;
  // Index-aligned with `gotoRoute`: the orientation the unit faces after a step
  // that was spent TURNING rather than moving (null on an ordinary step). Only
  // ever non-null for units whose plan can include a rotation — a pawn — and
  // the client draws the ↻/↺ badge on those cells.
  gotoRouteRotations: (Orientation | null)[];
  // The snake's REQUESTED move — the last move the active intent resolved to,
  // bound to its (snakeId, turn). Written only by `stageMove`, which starts
  // the publish-until-confirmed pipeline (`ensureStagedPublished`) so the
  // request lands in Firebase, the authoritative staged-move store. Shown to
  // clients as the ghost arrow whenever it differs from `confirmedStaged`.
  staged: StagedMove | null;
  // The staged move Firebase has CONFIRMED for this snake (from the
  // interface's privateMoves read-back listener): the latest server-acked
  // write for the turn. This is what the game server will actually play if
  // the turn ends now — clients render it as the solid arrow. The pipeline
  // re-publishes until this matches the requested move.
  confirmedStaged: { turn: number; move: CentaurMove } | null;
  // The FINAL move Firebase selected for the turn, known at turn finalization
  // (deadline passed, or every alive player committed) — before the next
  // board arrives. Drives the client's double (committed) arrow.
  finalMove: { turn: number; move: CentaurMove } | null;
  // In-flight marker for the publish pipeline: the (turn, move) last handed
  // to the submitter, so an unconfirmed request isn't re-published on every
  // event, only when the backstop retry decides it was lost.
  lastSubmittedTurn: number | null;
  lastSubmittedMove: CentaurMove | null;
  // Backstop retry for the publish pipeline (single-shot, re-armed while the
  // confirmed staged move differs from the requested one).
  stagingRetryTimer: NodeJS.Timeout | null;
  // Dedupe for the manual Submit All commit: the turn this snake was last
  // marked done for, so repeated clicks don't spam moveStatuses writes.
  // Commitment is BINDING (Firestore rules freeze a committed snake's staged
  // move), so this also gates staging: no re-stage for a committed turn.
  lastCommittedTurn: number | null;
  // Submit All arrived while the requested move was still unconfirmed: the
  // commit is deferred and fires automatically the moment Firebase confirms
  // the requested move, so the frozen move is always the one the user asked
  // for. Cancelled if the user re-stages a different move first.
  pendingCommitTurn: number | null;
  // Dedupe for the fatal-move confirmation prompt: the (turn, move) we last
  // asked the user to confirm, so repeated re-stages within the same turn
  // don't spam the dialog.
  fatalPromptTurn: number | null;
  fatalPromptMove: Direction | null;
}

export interface ConnectedUser {
  userId: string;
  // The player's enrolled name — mandatory, unique per game, chosen on the
  // login screen before entering an active game. Keys the stable colour.
  name: string;
  color: string;
  selectedSnakeId: string | null;
}

// A per-game name enrolment: who owns the name and its stable colour.
// Enrolments live for the whole game (never released on disconnect) so the
// name→colour mapping — and uniqueness — is stable for the game's lifetime.
interface PlayerEnrolment {
  userId: string;
  name: string;
  color: string;
  // 0-based ARRIVAL ORDER: the position of this enrolment in the game's
  // enrolment sequence, which is the server's authoritative "when did this
  // player join" signal (see colorForArrival). Recorded explicitly rather
  // than re-derived, so it cannot drift if the map is ever pruned.
  arrivalIndex: number;
}

export type EnrolResult =
  | { user: ConnectedUser }
  | { error: 'name-taken' | 'invalid-name' };

export interface ActiveGame {
  gameId: string;
  // The engine-server session this game belongs to (set by the Firebase
  // interface after registration). Used to build links to the game on the
  // engine server; null until known.
  sessionId: string | null;
  boardState: BoardSnapshot | null;
  boardStateTurn: number;
  snakes: Map<string, SnakeInfo>;
  controlledSnakes: Map<string, ControlledSnake>;
  connectedUsers: Map<string, ConnectedUser>;
  gameTimeout: number;
  startedAt: number;
  lastActivityAt: number;
  // Name enrolments keyed by the lowercased name. An enrolment is created the
  // first time a name subscribes and lives for the whole game — uniqueness and
  // the name-keyed colour are therefore stable across disconnect/reconnect.
  playerNames: Map<string, PlayerEnrolment>;
  turnExpiryTime: number | null;
  currentTurn: number;
  // The centaur identity we play as in this game (setup team whose id ==
  // configured centaur id). Set by the Firebase interface at registration;
  // null when unknown (e.g. legacy games).
  ourTeam: { id: string; name: string; color: string } | null;
  // The board-wide Voronoi partition for the most recent turn that produced
  // one (see BoardTerritory). Null until the first full decision pass lands.
  boardTerritory: BoardTerritory | null;
}

// Fallback network-latency allowance when a turn arrives WITHOUT the server's
// own expiry timestamp (see recordTurnArrival — every live caller passes it).
const ESTIMATED_TURN_DELIVERY_LATENCY_MS = 50;

export type TurnUpdateCallback = (gameId: string, snakeId: string, turnData: TurnData) => void;
// Board/end payloads are the canonical you-less state: no client reads `.you`
// off a broadcast board (verified across src/web), and server consumers derive
// per-snake data by id from board.snakes.
export type BoardUpdateCallback = (gameId: string, gameState: BoardSnapshot) => void;
export type MoveCommittedCallback = (gameId: string, snakeId: string, move: CentaurMove, source: string) => void;
export type GameListChangeCallback = (event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string) => void;
export type GameEndCallback = (gameId: string, snakeId: string, finalGameState: BoardSnapshot, gameOver: boolean) => void;
// Fired (coalesced once per event-loop tick) whenever any controlled snake's
// staged move / intent changed, so the WS layer can push the staged-arrow +
// intent projections without each mutation site broadcasting explicitly.
export type StagedChangeCallback = (gameId: string) => void;
// Fired when a human-sourced staged move was blocked by the fatal-move consent
// gate — the client should show the confirmation dialog for (snakeId, move).
export type FatalConfirmationCallback = (gameId: string, snakeId: string, move: Direction, turn: number) => void;

export class ActiveGameManager {
  private static instance: ActiveGameManager;
  private games: Map<string, ActiveGame> = new Map();
  private turnUpdateCallbacks: TurnUpdateCallback[] = [];
  private boardUpdateCallbacks: BoardUpdateCallback[] = [];
  private moveCommittedCallbacks: MoveCommittedCallback[] = [];
  private gameListChangeCallbacks: GameListChangeCallback[] = [];
  private gameEndCallbacks: GameEndCallback[] = [];
  private stagedChangeCallbacks: StagedChangeCallback[] = [];
  private fatalConfirmationCallbacks: FatalConfirmationCallback[] = [];
  // Games whose staged move changed since the last flush. Coalesced into one
  // notification per event-loop tick so a burst of stageMove calls within a
  // single operation broadcasts at most once.
  private stagedDirtyGames: Set<string> = new Set();
  private stagedFlushScheduled: boolean = false;
  private staleGameCleanupInterval: ManagedTimerHandle | null = null;
  // Write-through publisher for staged moves (see MoveSubmitter). Firestore is
  // the single source of truth for staged moves; until a submitter is wired,
  // staging actions log an error instead of silently staying local.
  private moveSubmitter: MoveSubmitter | null = null;
  // Publisher for the human-triggered Submit All "done" signal. Optional and
  // never invoked automatically.
  private moveCommitter: MoveCommitter | null = null;
  // OPT-IN team-scoped publisher (see TeamMoveSubmitter). Null, and the set
  // below empty, means every game takes the per-unit path exactly as before.
  private teamMoveSubmitter: TeamMoveSubmitter | null = null;
  private teamStagedGames: Set<string> = new Set();
  // Games whose team set changed this tick, and the turn it changed for.
  // Coalesced like notifyStagedChange: a joint set is bound one unit at a
  // time, and publishing after each unit would defeat the batching.
  private teamStageDirty: Map<string, number> = new Map();
  private teamStageFlushScheduled: boolean = false;
  // Observers of pin-shaped intent (see PinIntentObserver). Purely a report.
  private pinIntentObservers: PinIntentObserver[] = [];

  private constructor() {
    // The manager is the controller's game-progress source: a game counts
    // toward keeping the instance awake only while verifiably progressing
    // (see hasProgressingGame). Register/end/cleanup transitions poke the
    // controller so the awake rule is re-evaluated immediately.
    ActivityController.getInstance().registerSource(
      'running-games',
      () => this.hasProgressingGame()
    );
  }

  /**
   * True while any registered game is VERIFIABLY progressing: its turn
   * deadline is still in the future, or its latest turn/activity arrived
   * within GAME_PROGRESS_WINDOW_MS. This reuses the same per-game
   * lastActivityAt clock the stale-game cleanup evicts on (one staleness
   * clock, two thresholds), so a registered-but-stuck game — no turn advance,
   * deadline long past — counts as INACTIVE for the awake rule long before
   * the cleanup removes it from memory.
   */
  hasProgressingGame(now: number = Date.now()): boolean {
    for (const game of this.games.values()) {
      if (game.turnExpiryTime !== null && game.turnExpiryTime > now) return true;
      if (now - game.lastActivityAt < GAME_PROGRESS_WINDOW_MS) return true;
    }
    return false;
  }

  setMoveSubmitter(submitter: MoveSubmitter | null): void {
    this.moveSubmitter = submitter;
  }

  setMoveCommitter(committer: MoveCommitter | null): void {
    this.moveCommitter = committer;
  }

  // ── Team staging (opt-in) ────────────────────────────────────────────────

  setTeamMoveSubmitter(submitter: TeamMoveSubmitter | null): void {
    this.teamMoveSubmitter = submitter;
  }

  /**
   * Route a game's staged writes through the team submitter instead of the
   * per-unit one. Off for every game until something explicitly turns it on;
   * turning it off returns the game to the per-unit path immediately.
   *
   * This is the ONLY switch between the two transports. Everything upstream of
   * it — intent precedence, the fatal-move consent gate, the atomic StagedMove
   * record, the commit freeze — is identical on both paths, because both are
   * fed by the same `stageMove`.
   */
  enableTeamStaging(gameId: string, enabled: boolean = true): void {
    if (enabled) this.teamStagedGames.add(gameId);
    else {
      this.teamStagedGames.delete(gameId);
      this.teamStageDirty.delete(gameId);
    }
  }

  isTeamStagingEnabled(gameId: string): boolean {
    return this.teamStagedGames.has(gameId);
  }

  /**
   * The team's staged set for one turn: every controlled unit holding a bound
   * staged record for `turn`, minus the units already committed (their
   * privateMoves writes are refused server-side, so including one would fail
   * the batch carrying it).
   *
   * A read-only projection of records `stageMove` already bound. It resolves
   * nothing and decides nothing.
   */
  stagedTeamSet(gameId: string, turn: number): TeamStagedUnit[] {
    const game = this.games.get(gameId);
    if (!game) return [];
    const set: TeamStagedUnit[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      const staged = controlled.staged;
      if (!staged || staged.turn !== turn) continue;
      if (controlled.lastCommittedTurn === turn) continue;
      set.push({ snakeId, move: staged.move, source: staged.source });
    }
    return set;
  }

  /** The move Firebase's read-back confirms for this unit on `turn`, or null. */
  confirmedStagedMove(gameId: string, snakeId: string, turn: number): CentaurMove | null {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    const confirmed = controlled?.confirmedStaged;
    return confirmed && confirmed.turn === turn ? confirmed.move : null;
  }

  /** Whether this unit's commit for `turn` has been made — its staged writes
   * are refused from that instant, so the team path must exclude it. */
  hasCommittedTurn(gameId: string, snakeId: string, turn: number): boolean {
    return this.games.get(gameId)?.controlledSnakes.get(snakeId)?.lastCommittedTurn === turn;
  }

  // ── Pin observation ─────────────────────────────────────────────────────

  /**
   * Observe pin-shaped intent: every staged bind (with the precedence rung it
   * came from) plus the UI's tentative consideration. Report-only — an
   * observer cannot stage, unstage or veto anything, and a throwing observer
   * is contained here.
   */
  onPinIntent(observer: PinIntentObserver): void {
    this.pinIntentObservers.push(observer);
  }

  /**
   * The UI is CONSIDERING this move for this unit — a hover, a candidate under
   * the cursor, a drag not yet released. Emits a tentative-pin observation and
   * touches nothing else: no intent, no staged record, no write. A tentative
   * pin is a hint the search may speculate on, never a constraint.
   */
  notePinConsideration(gameId: string, snakeId: string, move: CentaurMove): void {
    const game = this.games.get(gameId);
    if (!game || !game.controlledSnakes.has(snakeId)) return;
    this.notifyPinIntent({
      gameId,
      snakeId,
      turn: game.boardStateTurn,
      move,
      source: null,
      kind: 'considering',
    });
  }

  /** The UI stopped considering a move for this unit. */
  clearPinConsideration(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    if (!game || !game.controlledSnakes.has(snakeId)) return;
    this.notifyPinIntent({
      gameId,
      snakeId,
      turn: game.boardStateTurn,
      move: null,
      source: null,
      kind: 'cleared',
    });
  }

  private notifyPinIntent(event: PinIntentEvent): void {
    for (const observer of this.pinIntentObservers) {
      try {
        observer(event);
      } catch (e) {
        console.error('Error in pin intent observer:', e);
      }
    }
  }

  // Mark a game's team set as changed for `turn`, coalesced to one publish per
  // event-loop tick. A joint set is bound one unit at a time (each unit's
  // stageMove is its own call), so publishing per unit would produce exactly
  // the per-unit write pattern the team path exists to replace.
  private requestTeamPublish(gameId: string, turn: number): void {
    const pending = this.teamStageDirty.get(gameId);
    // Only ever move forward: a late stage for an older turn must not drag the
    // publish back to a turn the board has left.
    if (pending === undefined || turn > pending) this.teamStageDirty.set(gameId, turn);
    if (this.teamStageFlushScheduled) return;
    this.teamStageFlushScheduled = true;
    setImmediate(() => {
      this.teamStageFlushScheduled = false;
      const dirty = Array.from(this.teamStageDirty.entries());
      this.teamStageDirty.clear();
      for (const [id, dirtyTurn] of dirty) {
        if (!this.teamStagedGames.has(id)) continue;
        const moves = this.stagedTeamSet(id, dirtyTurn);
        if (moves.length === 0) continue;
        if (!this.teamMoveSubmitter) {
          console.error(`[ActiveGameManager] Team staging enabled for ${id} with no team submitter wired — turn ${dirtyTurn} NOT published`);
          continue;
        }
        this.teamMoveSubmitter(id, dirtyTurn, moves).catch((err) => {
          console.error(`[ActiveGameManager] Failed to publish team staged set for ${id} turn ${dirtyTurn}:`, err);
        });
      }
    }).unref();
  }

  static getInstance(): ActiveGameManager {
    if (!ActiveGameManager.instance) {
      ActiveGameManager.instance = new ActiveGameManager();
    }
    return ActiveGameManager.instance;
  }

  onTurnUpdate(callback: TurnUpdateCallback): void {
    this.turnUpdateCallbacks.push(callback);
  }

  onBoardUpdate(callback: BoardUpdateCallback): void {
    this.boardUpdateCallbacks.push(callback);
  }

  onMoveCommitted(callback: MoveCommittedCallback): void {
    this.moveCommittedCallbacks.push(callback);
  }

  onGameListChange(callback: GameListChangeCallback): void {
    this.gameListChangeCallbacks.push(callback);
  }

  onGameEnd(callback: GameEndCallback): void {
    this.gameEndCallbacks.push(callback);
  }

  onStagedChange(callback: StagedChangeCallback): void {
    this.stagedChangeCallbacks.push(callback);
  }

  onFatalConfirmationNeeded(callback: FatalConfirmationCallback): void {
    this.fatalConfirmationCallbacks.push(callback);
  }

  private notifyFatalConfirmationNeeded(gameId: string, snakeId: string, move: Direction, turn: number): void {
    for (const cb of this.fatalConfirmationCallbacks) {
      try {
        cb(gameId, snakeId, move, turn);
      } catch (e) {
        console.error('Error in fatal confirmation callback:', e);
      }
    }
  }

  // Mark a game's staged move as changed. Coalesces a burst of stageMove calls
  // (e.g. setIntent → stageMove, or per-snake re-staging) into a single
  // notification per event-loop tick. Uses setImmediate().unref() so a pending
  // flush never keeps the process alive on its own.
  private notifyStagedChange(gameId: string): void {
    this.stagedDirtyGames.add(gameId);
    if (this.stagedFlushScheduled) return;
    this.stagedFlushScheduled = true;
    setImmediate(() => {
      this.stagedFlushScheduled = false;
      const dirty = Array.from(this.stagedDirtyGames);
      this.stagedDirtyGames.clear();
      for (const id of dirty) {
        for (const cb of this.stagedChangeCallbacks) {
          try {
            cb(id);
          } catch (e) {
            console.error('Error in staged change callback:', e);
          }
        }
      }
    }).unref();
  }

  private notifyGameEnd(gameId: string, snakeId: string, finalGameState: BoardSnapshot, gameOver: boolean): void {
    for (const cb of this.gameEndCallbacks) {
      try {
        cb(gameId, snakeId, finalGameState, gameOver);
      } catch (e) {
        console.error('Error in game end callback:', e);
      }
    }
  }

  private notifyGameListChange(event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string): void {
    for (const cb of this.gameListChangeCallbacks) {
      try {
        cb(event, gameId, snakeId);
      } catch (e) {
        console.error('Error in game list change callback:', e);
      }
    }
  }

  private notifyTurnUpdate(gameId: string, snakeId: string, turnData: TurnData): void {
    for (const cb of this.turnUpdateCallbacks) {
      try {
        cb(gameId, snakeId, turnData);
      } catch (e) {
        console.error('Error in turn update callback:', e);
      }
    }
  }

  private notifyBoardUpdate(gameId: string, gameState: BoardSnapshot): void {
    for (const cb of this.boardUpdateCallbacks) {
      try {
        cb(gameId, gameState);
      } catch (e) {
        console.error('Error in board update callback:', e);
      }
    }
  }

  private notifyMoveCommitted(gameId: string, snakeId: string, move: CentaurMove, source: string): void {
    for (const cb of this.moveCommittedCallbacks) {
      try {
        cb(gameId, snakeId, move, source);
      } catch (e) {
        console.error('Error in move committed callback:', e);
      }
    }
  }

  recordTurnArrival(gameId: string, arrivalTime: number, gameTimeout: number, serverExpiryTime: number | null = null): void {
    const game = this.games.get(gameId);
    if (!game) return;

    if (serverExpiryTime) {
      game.turnExpiryTime = serverExpiryTime;
    } else {
      // Near-dead fallback: every live caller passes the server's own expiry
      // time. The constant replaces the deleted engine.battlesnake.com ping
      // measurement (its perpetual 30s HEAD probe was the last legacy of the
      // HTTP Battlesnake era); 50ms was that measurement's starting estimate.
      game.turnExpiryTime = arrivalTime + gameTimeout - ESTIMATED_TURN_DELIVERY_LATENCY_MS;
    }
  }

  // Register a controlled snake against the CANONICAL board state. One game
  // holds one shared board; the snake's own identity (name/letter) is looked
  // up on it by id — there is no per-snake board copy anywhere anymore.
  // `identity` covers a snake NOT on the board (registering mid-game after it
  // died, e.g. a server restart): the transport resolves it from the game
  // setup, which knows every snake dead or alive.
  registerGame(
    canonical: BoardSnapshot,
    controlledSnakeId: string,
    ourTeam?: { id: string; name: string; color: string } | null,
    identity?: { name: string; letter: string },
  ): void {
    const gameId = canonical.game.id;
    const snakeId = controlledSnakeId;

    let game = this.games.get(gameId);
    if (!game) {
      const now = Date.now();
      game = {
        gameId,
        sessionId: null,
        boardState: canonical,
        boardStateTurn: canonical.turn || 0,
        snakes: new Map(),
        controlledSnakes: new Map(),
        connectedUsers: new Map(),
        gameTimeout: canonical.game.timeout || 500,
        startedAt: now,
        lastActivityAt: now,
        playerNames: new Map(),
        turnExpiryTime: null,
        currentTurn: canonical.turn || 0,
        ourTeam: ourTeam ?? null,
        boardTerritory: null,
      };
      this.games.set(gameId, game);
    }
    if (ourTeam && !game.ourTeam) game.ourTeam = ourTeam;

    for (const snake of canonical.board.snakes) {
      if (!game.snakes.has(snake.id)) {
        game.snakes.set(snake.id, {
          id: snake.id,
          name: snake.name,
          letter: snake.letter || '',
        });
      }
    }

    const ourSnake = canonical.board.snakes.find(s => s.id === snakeId);
    if (!game.controlledSnakes.has(snakeId)) {
      const name = ourSnake?.name || identity?.name || snakeId;
      console.log(`[ActiveGameManager] Registering controlled snake: ${gameId}:${snakeId} (${name})`);
      game.controlledSnakes.set(snakeId, {
        id: snakeId,
        name,
        letter: ourSnake?.letter || identity?.letter || '',
        unitType: ourSnake?.unitType ?? 'snake',
        latestTurnData: null,
        botRecommendation: null,
        selectedBy: null,
        ownedBy: null,
        suicideArmed: false,
        suicideArmedBy: null,
        intent: { kind: 'heuristic' },
        intentBy: null,
        gotoRoute: [],
        gotoRouteFirstLeg: 0,
        gotoRouteRotations: [],
        staged: null,
        confirmedStaged: null,
        finalMove: null,
        lastSubmittedTurn: null,
        lastSubmittedMove: null,
        stagingRetryTimer: null,
        lastCommittedTurn: null,
        pendingCommitTurn: null,
        fatalPromptTurn: null,
        fatalPromptMove: null,
      });
      this.notifyGameListChange('added', gameId, snakeId);
    }
    // A (re)registered game is fresh progress — re-evaluate the awake rule.
    ActivityController.getInstance().poke();
  }

  // End the whole game in ONE call against the canonical final state. The
  // per-snake fan-out (a `snake-ended` event per controlled snake, `gameOver`
  // true only on the last) happens internally, preserving the client contract
  // the old per-snake endGame produced — but the final state is accepted, and
  // the board-update broadcast fired, exactly once instead of once per snake.
  // `finalState` is optional for the doc-deleted cleanup path, which has no
  // final state: snakes are then removed without emitting snake-ended, as
  // before.
  endGame(gameId: string, finalState?: BoardSnapshot | null): void {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[ActiveGameManager] endGame called for unknown game: ${gameId}`);
      return;
    }
    if (game.controlledSnakes.size === 0) {
      // Duplicate end signal for a game we've already drained. Don't re-fire
      // events that would bounce the UI; just drop the empty shell.
      console.log(`[ActiveGameManager] endGame for already-drained game ${gameId}, removing`);
      this.games.delete(gameId);
      this.enableTeamStaging(gameId, false);
      this.logIfFullyIdle();
      ActivityController.getInstance().poke();
      return;
    }

    // The end signal carries the actual final game state, which can be ahead
    // of the last turn we processed (other snakes kept playing after ours
    // died). Push it through the normal board-update pipeline so the centaur
    // paints the real final position instead of freezing on whatever turn our
    // snakes last acted in. A stale /end must not rewind the rendered turn.
    let acceptedFinalState = false;
    const incomingTurn = finalState?.turn ?? -1;
    if (finalState && incomingTurn >= game.boardStateTurn) {
      game.boardState = finalState;
      game.boardStateTurn = incomingTurn;
      game.currentTurn = Math.max(game.currentTurn, incomingTurn);
      game.lastActivityAt = Date.now();
      this.notifyBoardUpdate(gameId, finalState);
      acceptedFinalState = true;
    } else if (finalState) {
      console.log(`[ActiveGameManager] endGame final-state for ${gameId} rejected as stale (incomingTurn=${incomingTurn} < boardStateTurn=${game.boardStateTurn})`);
    }

    const snakeIds = [...game.controlledSnakes.keys()];
    for (const snakeId of snakeIds) {
      game.controlledSnakes.delete(snakeId);
      this.notifyGameListChange('removed', gameId, snakeId);
      const gameOver = game.controlledSnakes.size === 0;
      // Only emit snake-ended when the final state is fresh enough to apply.
      if (finalState && acceptedFinalState) {
        this.notifyGameEnd(gameId, snakeId, finalState, gameOver);
      }
    }
    console.log(
      `[ActiveGameManager] endGame ${gameId} processed — acceptedFinalState=${acceptedFinalState}, snakesEnded=${snakeIds.length}`,
    );

    console.log(`[ActiveGameManager] All controlled snakes ended for game ${gameId}, removing game`);
    this.games.delete(gameId);
    this.enableTeamStaging(gameId, false);
    this.logIfFullyIdle();
    // Game gone — the awake rule may flip (no game branch left to hold it).
    ActivityController.getInstance().poke();
  }

  isSnakeSelected(gameId: string, snakeId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    return controlled?.selectedBy !== null && controlled?.selectedBy !== undefined;
  }

  selectSnake(gameId: string, snakeId: string, userId: string, force: boolean = false): { success: boolean; contestedBy?: string; revokedUserId?: string } {
    const game = this.games.get(gameId);
    if (!game) return { success: false };

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return { success: false };

    const user = game.connectedUsers.get(userId);
    if (!user) return { success: false };

    if (user.selectedSnakeId && user.selectedSnakeId !== snakeId) {
      this.deselectSnake(gameId, userId);
    }

    // The contested check is on OWNERSHIP, not just the active selection: a
    // snake owned by another player requires the takeover confirmation even
    // when that player has since selected a different snake.
    if (controlled.ownedBy && controlled.ownedBy !== userId) {
      if (!force) {
        return { success: false, contestedBy: controlled.ownedBy };
      }
      const previousUserId = controlled.ownedBy;
      const previousUser = game.connectedUsers.get(previousUserId);
      const hadSelection = controlled.selectedBy === previousUserId;
      if (previousUser && hadSelection) {
        previousUser.selectedSnakeId = null;
      }
      controlled.selectedBy = userId;
      controlled.ownedBy = userId;
      user.selectedSnakeId = snakeId;
      return { success: true, revokedUserId: hadSelection ? previousUserId : undefined };
    }

    controlled.selectedBy = userId;
    // Selecting implicitly adds the snake to the player's owned set.
    controlled.ownedBy = userId;
    user.selectedSnakeId = snakeId;
    return { success: true };
  }

  suicideAllSnakes(gameId: string, byUserId?: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const operator = this.operatorFor(game, byUserId);
    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      // No suicide move exists for a chess piece: staying (or moving) never
      // walks it into a wall the way a snake's forced step does. Kill-all just
      // stages an explicit stay so the piece's turn is deterministic.
      if (this.isPieceUnit(controlled)) {
        const stay = this.pieceOwnSquareIndex(gameId, snakeId);
        if (stay !== null) {
          affected.push(snakeId);
          console.log(`[ActiveGameManager] SUICIDE: piece ${gameId}:${snakeId} has no suicide move — staging stay (${stay})`);
          this.logCommandEvent(gameId, snakeId, 'suicide', operator, { move: stay });
          this.bindStagedPieceMove(gameId, snakeId, stay, 'manual', { kind: 'stay' });
        }
        continue;
      }
      affected.push(snakeId);

      const gameState = controlled.latestTurnData?.gameState;
      if (gameState) {
        const move = computeSuicideMove(gameState);
        console.log(`[ActiveGameManager] SUICIDE: staging ${move} for ${gameId}:${snakeId}`);
        this.logCommandEvent(gameId, snakeId, 'suicide', operator, { move });
        // Kill-all is the second fatal-consent mint point: stage the suicide
        // move WITH consent so it flows through the single staged-move writer
        // (and its gate). The write-through submitter publishes it to Firebase
        // where it becomes the snake's staged move for the turn.
        this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: mintFatalMoveConsent() }, operator);
      } else {
        // No turn data yet — arm, and the next turn's staging pass fires it.
        this.logCommandEvent(gameId, snakeId, 'suicide', operator, { armed: true });
        controlled.suicideArmed = true;
        controlled.suicideArmedBy = operator;
      }
    }
    if (affected.length > 0) {
      console.log(`[ActiveGameManager] SUICIDE staged/armed for game ${gameId}: ${affected.join(', ')}`);
    }
    return { affected };
  }

  // Submit All: the human-triggered "we're done this turn" signal. Commitment
  // is BINDING — Firestore rules freeze a committed snake's staged move for
  // the turn — so a snake is only committed once the move Firebase has
  // CONFIRMED is the requested one; committing earlier could freeze a stale
  // move mid-flight. Snakes whose request is still unconfirmed get a pending
  // commit that fires automatically the moment their confirmation lands
  // (setConfirmedStagedMove), keeping Submit All one click without ever
  // freezing the wrong move. Never called automatically.
  commitAllStaged(gameId: string, byUserId?: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const operator = this.operatorFor(game, byUserId);
    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      // An uncommanded piece stages nothing at all (the server defaults it to
      // stay), but Submit All must still be able to commit it: publish its own
      // square as an explicit stay first, then let the confirmed-gated
      // deferred-commit machinery below commit once Firebase acks that write.
      if (
        this.isPieceUnit(controlled) &&
        (!controlled.staged || controlled.staged.turn !== game.boardStateTurn)
      ) {
        const stay = this.pieceOwnSquareIndex(gameId, snakeId);
        if (stay !== null) {
          console.log(`[ActiveGameManager] COMMIT-ALL: staging stay (${stay}) for uncommanded piece ${gameId}:${snakeId} turn ${game.boardStateTurn}`);
          this.bindStagedPieceMove(gameId, snakeId, stay, 'fallback', { kind: 'stay' });
        }
      }
      const staged = controlled.staged;
      // Only commit snakes staged for the current turn — a stale record means
      // this snake's decision for the new turn hasn't landed yet, and
      // committing it would mark "done" on a move that no longer applies.
      if (!staged || staged.turn !== game.boardStateTurn) continue;
      if (controlled.lastCommittedTurn === staged.turn) continue;
      affected.push(snakeId);
      this.logCommandEvent(gameId, snakeId, 'commit', operator, {
        move: staged.move,
        source: staged.source,
      });

      const confirmed =
        controlled.confirmedStaged?.turn === staged.turn &&
        controlled.confirmedStaged.move === staged.move;
      if (confirmed) {
        this.commitSnakeNow(gameId, snakeId, controlled, staged.turn);
      } else if (controlled.pendingCommitTurn !== staged.turn) {
        controlled.pendingCommitTurn = staged.turn;
        console.log(`[ActiveGameManager] COMMIT deferred for ${gameId}:${snakeId} turn ${staged.turn} — waiting for Firebase to confirm ${staged.move}`);
      }
    }
    if (affected.length > 0) {
      console.log(`[ActiveGameManager] COMMIT-ALL for game ${gameId} turn ${game.boardStateTurn}: ${affected.join(', ')}`);
    }
    return { affected };
  }

  private commitSnakeNow(
    gameId: string,
    snakeId: string,
    controlled: ControlledSnake,
    turn: number
  ): void {
    if (controlled.lastCommittedTurn === turn) return;
    controlled.lastCommittedTurn = turn;
    controlled.pendingCommitTurn = null;

    if (this.moveCommitter) {
      this.moveCommitter(gameId, snakeId, turn).catch((err) => {
        console.error(`[ActiveGameManager] Failed to publish commit for ${gameId}:${snakeId} turn ${turn}:`, err);
        // Allow a retry on the next Submit All for this turn.
        if (controlled.lastCommittedTurn === turn) {
          controlled.lastCommittedTurn = null;
        }
      });
    } else {
      console.error(`[ActiveGameManager] No move committer wired — commit for ${gameId}:${snakeId} NOT published`);
    }
  }

  // Per-snake ownership snapshot broadcast to every client: the owning
  // player's id, name and colour (or null). Name/colour come from the live
  // connected user when present, else from the game-lifetime name enrolment
  // (ownership survives disconnects the same way enrolments do).
  getOwnersForGame(gameId: string): { [snakeId: string]: { userId: string; name: string; color: string } | null } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const out: { [snakeId: string]: { userId: string; name: string; color: string } | null } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (!cs.ownedBy) {
        out[snakeId] = null;
        continue;
      }
      const user = game.connectedUsers.get(cs.ownedBy);
      let name = user?.name;
      let color = user?.color;
      if (!name) {
        for (const enrolment of game.playerNames.values()) {
          if (enrolment.userId === cs.ownedBy) {
            name = enrolment.name;
            color = enrolment.color;
            break;
          }
        }
      }
      out[snakeId] = { userId: cs.ownedBy, name: name || 'Player', color: color || '#888888' };
    }
    return out;
  }

  deselectSnake(gameId: string, userId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const user = game.connectedUsers.get(userId);
    if (!user || !user.selectedSnakeId) return;

    const snakeId = user.selectedSnakeId;
    const controlled = game.controlledSnakes.get(snakeId);
    if (controlled && controlled.selectedBy === userId) {
      controlled.selectedBy = null;
      console.log(`[ActiveGameManager] Snake deselected ${gameId}:${snakeId} (turn ${game.currentTurn}), staged move=${controlled.staged?.move || 'none'} (${controlled.staged?.source || '-'}) — Firebase keeps the last staged move`);
    }
    user.selectedSnakeId = null;
  }

  /**
   * Enrol an operator into an active game under a mandatory, per-game-unique
   * player name. This is the single, race-safe uniqueness check: the enrolment
   * map is consulted and written synchronously here, so two tabs racing the
   * same name can never both win — the second gets `name-taken`.
   *
   * Reconnects are recognised by userId: the same userId re-subscribing with
   * its enrolled name reclaims the enrolment (and its stable colour) exactly.
   * Enrolments are never released for the lifetime of the game.
   */
  addConnectedUser(gameId: string, userId: string, name: string): EnrolResult | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const trimmed = (name || '').trim().substring(0, 20);
    // Defense in depth against markup injection: names are letters, digits,
    // spaces and a few safe punctuation marks only (output encoding on the
    // client remains mandatory regardless).
    if (!trimmed || !/^[\p{L}\p{N} _.\-']+$/u.test(trimmed)) {
      return { error: 'invalid-name' };
    }
    const key = trimmed.toLowerCase();

    const existing = game.playerNames.get(key);
    if (existing && existing.userId !== userId) {
      return { error: 'name-taken' };
    }

    // If this userId was previously enrolled under a DIFFERENT name (e.g. it
    // re-subscribed after picking a new name), keep the old enrolment parked —
    // enrolments are game-lifetime — but the connected user reflects the name
    // used now.
    const enrolment: PlayerEnrolment = existing || this.enrol(game, userId, trimmed);
    game.playerNames.set(key, enrolment);

    const prior = game.connectedUsers.get(userId);
    if (prior && prior.name === enrolment.name) return { user: prior };

    const user: ConnectedUser = {
      userId,
      name: enrolment.name,
      color: enrolment.color,
      selectedSnakeId: prior?.selectedSnakeId ?? null,
    };
    game.connectedUsers.set(userId, user);
    return { user };
  }

  /**
   * Names currently enrolled in a game (for the login screen's pre-check).
   * Pass the asking user's id to exclude their OWN enrolments — the server
   * allows the same userId to reclaim its name on reconnect, so the client
   * must not treat its own cookie-prefilled name as taken.
   */
  getEnrolledNames(gameId: string, excludeUserId?: string): string[] {
    const game = this.games.get(gameId);
    if (!game) return [];
    return Array.from(game.playerNames.values())
      .filter((e) => !excludeUserId || e.userId !== excludeUserId)
      .map((e) => e.name);
  }

  // Build a brand-new enrolment, stamping it with the next ARRIVAL INDEX and
  // the palette colour that index owns.
  //
  // Arrival order is the enrolment sequence itself: `game.playerNames` is a
  // Map written in first-subscribe order and never pruned (enrolments outlive
  // disconnects, see removeConnectedUser), so its size at creation time IS
  // "how many players arrived before this one". That makes the first player
  // to join a game always PLAYER_PALETTE[0], the second always [1], and so on
  // — the same order gives the same colours in every game, and a reconnect
  // (or a turn passing, or the socket dropping) re-reads the stored enrolment
  // rather than re-deriving anything.
  //
  // The colour is no longer a function of the NAME. A name hash could seat
  // two players on the palette's two closest entries as easily as its two
  // furthest; walking the ordered list from 0 guarantees the small games that
  // actually happen use the deliberately-furthest-apart prefix.
  private enrol(game: ActiveGame, userId: string, name: string): PlayerEnrolment {
    const arrivalIndex = game.playerNames.size;
    return { userId, name, color: colorForArrivalIndex(arrivalIndex), arrivalIndex };
  }

  removeConnectedUser(gameId: string, userId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const user = game.connectedUsers.get(userId);
    if (!user) return;

    if (user.selectedSnakeId) {
      const controlled = game.controlledSnakes.get(user.selectedSnakeId);
      if (controlled && controlled.selectedBy === userId) {
        controlled.selectedBy = null;
      }
    }

    game.connectedUsers.delete(userId);
    // The name enrolment (and its colour) is deliberately NOT released — it is
    // stable for the whole game, so a reconnect under the same name/userId
    // reclaims the identical colour.
  }

  getGame(gameId: string): ActiveGame | undefined {
    return this.games.get(gameId);
  }

  // Record which engine-server session a game belongs to (called by the
  // Firebase interface, which is the only component that knows it).
  setGameSession(gameId: string, sessionId: string): void {
    const game = this.games.get(gameId);
    if (game && game.sessionId !== sessionId) {
      game.sessionId = sessionId;
      this.notifyGameListChange('updated', gameId, '');
    }
  }

  getActiveGames(): Array<{
    gameId: string;
    sessionId: string | null;
    controlledSnakes: Array<{ id: string; name: string; letter: string }>;
    turn: number;
    gameState: BoardSnapshot | null;
    startedAt: number;
    ourTeam: { id: string; name: string; color: string } | null;
  }> {
    const result: Array<any> = [];
    for (const game of this.games.values()) {
      const snakes: Array<{ id: string; name: string; letter: string }> = [];
      for (const cs of game.controlledSnakes.values()) {
        snakes.push({ id: cs.id, name: cs.name, letter: cs.letter });
      }
      result.push({
        gameId: game.gameId,
        sessionId: game.sessionId,
        controlledSnakes: snakes,
        turn: game.currentTurn,
        gameState: game.boardState,
        startedAt: game.startedAt,
        ourTeam: game.ourTeam,
      });
    }
    return result;
  }

  getGameState(gameId: string): {
    boardState: BoardSnapshot | null;
    controlledSnakes: Array<{
      id: string; name: string; letter: string;
      selectedBy: string | null;
      turnData: TurnData | null;
      botRecommendation: CentaurMove | null;
    }>;
    connectedUsers: Array<ConnectedUser>;
    selections: { [snakeId: string]: { userId: string; color: string } | null };
    owners: { [snakeId: string]: { userId: string; name: string; color: string } | null };
    waypoints: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } };
    gameTimeout: number;
    turnExpiryTime: number | null;
    boardTerritory: BoardTerritory | null;
  } | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const controlledSnakes: Array<{
      id: string; name: string; letter: string;
      selectedBy: string | null;
      turnData: TurnData | null;
      botRecommendation: CentaurMove | null;
    }> = [];
    const selections: { [snakeId: string]: { userId: string; color: string } | null } = {};

    for (const cs of game.controlledSnakes.values()) {
      controlledSnakes.push({
        id: cs.id,
        name: cs.name,
        letter: cs.letter,
        selectedBy: cs.selectedBy,
        turnData: cs.latestTurnData,
        botRecommendation: cs.botRecommendation,
      });
      if (cs.selectedBy) {
        const user = game.connectedUsers.get(cs.selectedBy);
        selections[cs.id] = {
          userId: cs.selectedBy,
          color: user?.color || '#888888',
        };
      } else {
        selections[cs.id] = null;
      }
    }

    return {
      boardState: game.boardState,
      controlledSnakes,
      connectedUsers: Array.from(game.connectedUsers.values()),
      selections,
      owners: this.getOwnersForGame(gameId),
      waypoints: this.getWaypointsForGame(gameId),
      gameTimeout: game.gameTimeout,
      turnExpiryTime: game.turnExpiryTime,
      boardTerritory: game.boardTerritory,
    };
  }

  // The active waypoint target handed to the decision engine on each decision:
  // the head of the goto queue, or the near target. Null when none is set.
  getActiveWaypointTarget(gameId: string, snakeId: string): WaypointContext | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return null;
    if (controlled.intent.kind === 'goto' && controlled.intent.targets.length > 0) {
      return { kind: 'goto', target: controlled.intent.targets[0] };
    }
    if (controlled.intent.kind === 'near') {
      return { kind: 'near', target: controlled.intent.target };
    }
    return null;
  }

  // Client projection: every waypoint cell per snake. Green carries the whole
  // goto queue in order (cells[0] is the active target); blue has one cell.
  getWaypointsForGame(gameId: string): { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'goto' && cs.intent.targets.length > 0) {
        result[snakeId] = { type: 'green', cells: cs.intent.targets };
      } else if (cs.intent.kind === 'near') {
        result[snakeId] = { type: 'blue', cells: [cs.intent.target] };
      }
    }
    return result;
  }

  // Set, append or clear a snake's waypoint. Only the user currently selecting
  // the snake may change it. Pass `waypoint=null` to clear. `append=true` with
  // a green waypoint while a goto queue is active TOGGLES the cell's queue
  // membership (append if absent, remove if already queued); otherwise the
  // waypoint replaces whatever intent was active. Returns true on success.
  setWaypoint(
    gameId: string,
    snakeId: string,
    waypoint: { type: 'green' | 'blue'; x: number; y: number } | null,
    userId: string,
    append: boolean = false
  ): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;
    const operator = this.operatorFor(game, userId);

    if (waypoint === null) {
      // Clearing only applies while in a waypoint mode; otherwise leave the
      // current intent (manual/heuristic) untouched and just re-stage.
      if (controlled.intent.kind === 'goto' || controlled.intent.kind === 'near') {
        this.logCommandEvent(gameId, snakeId, 'waypoint-clear', operator, {
          cleared: controlled.intent.kind,
        });
        this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
      } else {
        this.stageMove(gameId, snakeId);
      }
      return true;
    }

    const board = game.boardState?.board;
    const w = board?.width ?? 0;
    const h = board?.height ?? 0;
    const x = Math.floor(Number(waypoint.x));
    const y = Math.floor(Number(waypoint.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (w > 0 && (x < 0 || x >= w)) return false;
    if (h > 0 && (y < 0 || y >= h)) return false;
    if (waypoint.type !== 'green' && waypoint.type !== 'blue') return false;

    if (waypoint.type === 'blue') {
      this.logCommandEvent(gameId, snakeId, 'near-set', operator, { target: { x, y } });
      this.setIntent(gameId, snakeId, { kind: 'near', target: { x, y } }, operator);
      return true;
    }

    if (append && controlled.intent.kind === 'goto') {
      // Toggle queue membership: appending an already-queued cell removes it.
      const targets = controlled.intent.targets;
      const existing = targets.findIndex(t => t.x === x && t.y === y);
      if (existing >= 0) {
        targets.splice(existing, 1);
        this.logCommandEvent(gameId, snakeId, 'goto-remove', operator, {
          target: { x, y },
          targets: targets.slice(),
        });
        if (targets.length === 0) {
          this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
        } else {
          // The queue continues under the toggling operator's command.
          controlled.intentBy = operator;
          this.stageMove(gameId, snakeId);
        }
      } else {
        targets.push({ x, y });
        this.logCommandEvent(gameId, snakeId, 'goto-append', operator, {
          target: { x, y },
          targets: targets.slice(),
        });
        controlled.intentBy = operator;
        this.stageMove(gameId, snakeId);
      }
      return true;
    }

    // Replace (or start) the goto queue with this single target. setIntent →
    // stageMove refreshes the derived route immediately, so the green path
    // renders the instant the user clicks, not only after the next decision.
    this.logCommandEvent(gameId, snakeId, 'goto-set', operator, {
      target: { x, y },
      targets: [{ x, y }],
    });
    this.setIntent(gameId, snakeId, { kind: 'goto', targets: [{ x, y }] }, operator);
    return true;
  }

  // Revert a unit to NULL HUMAN INPUT: cancel every command a human has given
  // it — the staged manual move (a piece's staged rotation is one), the goto
  // queue, the near target — in a single step. This needs no per-command
  // clearing because ALL of it is the unit's `intent`, one discriminated
  // union: replacing that union with `heuristic` structurally drops whatever
  // it held. Only the user currently selecting the unit may clear it.
  //
  // Deliberately says nothing about what the unit does next. setIntent
  // re-stages through the ordinary path, and that path already knows what no
  // input means for each kind of unit — the bot's recommendation where there
  // is one (a Direction for a snake, a destination for a piece), and holding
  // for a piece the bot has nothing to say about. Naming those outcomes here
  // would fork the fallback into a second definition.
  clearHumanInput(gameId: string, snakeId: string, userId: string): boolean {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return false;
    if (controlled.selectedBy !== userId) return false;
    const cleared = controlled.intent.kind;
    const operator = this.operatorFor(game, userId);
    this.logCommandEvent(gameId, snakeId, 'input-clear', operator, { cleared });
    this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
    console.log(`[ActiveGameManager] Human input cleared for ${gameId}:${snakeId} (was ${cleared})`);
    return true;
  }

  private viewFor(snapshot: BoardSnapshot, snakeId: string): GameState | null {
    const you = snapshot.board.snakes.find(s => s.id === snakeId);
    if (!you) return null;
    return { ...snapshot, you };
  }

  // Wipe the derived route cache. One place, because every early-out and the
  // catch-all below must leave the three projections consistent.
  private static clearGotoRoute(controlled: ControlledSnake): void {
    controlled.gotoRoute = [];
    controlled.gotoRouteFirstLeg = 0;
    controlled.gotoRouteRotations = [];
  }

  // Recompute the DERIVED green goto display route for a unit: its full
  // predicted trajectory through EVERY queued target, chained
  // head → targets[0] → targets[1] → … so the board shows how it gets between
  // waypoints, not just to the first one. One route entry per TURN of that
  // unit, since `waypointRoute` walks its own search space — a knight's route
  // is its L-hops, a rook's is its ray landings, and a pawn's interleaves the
  // quarter turns it spends facing the right way, drawn by the same polyline.
  //
  // The first leg encodes the two-path duality the goto feature needs:
  //  - While a move is STAGED for this turn it starts
  //    [stagedDestination, ...shortestPath(stagedDestination → targets[0])] —
  //    the path the snake will actually walk, conditioned on the move the
  //    heuristic matrix chose (which may differ from the pure shortest-path
  //    first step when survival heuristics outvoted it).
  //  - With nothing staged for this turn it starts at the projected head —
  //    the "immediately optimal" path for the next decision.
  //
  // Uses the SAME `waypointRoute` the evaluator's stat and the staging re-bias
  // use, so the number scored, the path drawn, and the move committed cannot
  // disagree. Exception-safe and side-effect-free beyond writing the cache.
  private refreshGotoRoute(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    if (controlled.intent.kind !== 'goto' || controlled.intent.targets.length === 0) {
      ActiveGameManager.clearGotoRoute(controlled);
      return;
    }
    try {
      const targets = controlled.intent.targets;
      const boardState = game.boardState;
      const gs = boardState ? this.viewFor(boardState, snakeId) : null;
      const anchor = this.getProjectedHead(gameId, snakeId);
      if (!gs || !anchor) {
        ActiveGameManager.clearGotoRoute(controlled);
        return;
      }
      const board = gs.board;
      // One graph for every leg: waypointRoute would otherwise rebuild the whole
      // typed-array board per call, and this runs on every stage.
      const graph = new BoardGraph(gs);
      // The move staged for THIS turn, if any — a record bound to an earlier
      // turn says nothing about where the unit is heading now.
      const staged = controlled.staged?.turn === game.boardStateTurn ? controlled.staged : null;
      // Where that move leaves the unit, or null when it leaves it standing: a
      // snake's Direction steps one cell, a piece's numeric destination IS the
      // square it lands on (its stay/rotate candidates plan no displacement, so
      // the route starts at the anchor instead).
      const stagedDest: Coord | null =
        !staged ? null
          : typeof staged.move === 'string'
            ? ActiveGameManager.destinationOf(anchor, staged.move)
            : staged.action?.kind === 'move'
              ? toApiCoord(staged.move, board.width + 2, board.height + 2)
              : null;
      // A staged QUARTER TURN spends the turn without moving, so it is the
      // route's first step on the unit's own square and every leg after it is
      // planned from the orientation it leaves behind.
      const stagedRotation: Orientation | null =
        staged?.action?.kind === 'rotate' ? staged.action.orientation : null;

      // Where the path starts, which way the unit faces there, and how many
      // turns from now that cell is occupied — the BFS clock every subsequent
      // leg continues from.
      const route: RouteStep[] = [];
      let from: Coord;
      let turnCursor: number;
      let facing: Orientation | undefined;
      if (stagedDest) {
        const inBounds = stagedDest.x >= 0 && stagedDest.x < board.width && stagedDest.y >= 0 && stagedDest.y < board.height;
        if (!inBounds) {
          ActiveGameManager.clearGotoRoute(controlled);
          return;
        }
        // The staged cell is reached one move in the future, so the rest of the
        // route is pathed with the clock already advanced by one.
        route.push({ cell: stagedDest });
        from = stagedDest;
        turnCursor = 1;
      } else if (stagedRotation) {
        route.push({ cell: anchor, rotation: stagedRotation });
        from = anchor;
        turnCursor = 1;
        facing = stagedRotation;
      } else {
        from = anchor;
        turnCursor = 0;
      }

      // Walk the WHOLE queue, one leg per target, so the board shows the
      // snake's full predicted trajectory rather than just the first hop.
      // Each leg's BFS starts at the turn the previous target is reached, which
      // matters because passability is turn-aware: bodies recede as the clock
      // advances, so a later leg legitimately sees more open board than the
      // same leg measured from turn 0 would. (Optimistic clearance has no
      // look-ahead ceiling — `optimisticDisappear` holds the true geometric
      // vacate turn — so the accumulated turns stay meaningful arbitrarily far
      // out.)
      //
      // Legs beyond the first are a PREDICTION in a way the first leg is not:
      // the first is conditioned on the move actually staged this turn, while
      // the rest assume the snake reaches each target and that other snakes'
      // bodies only recede from where they are now. That is exactly what makes
      // it useful for planning around a snake's default trajectory — but it is
      // not a commitment, and only targets[0] ever reaches the decision engine.
      // Every leg after the first must path against the snake as it WILL BE,
      // not as it is. The board graph models our body receding as the tail
      // advances, but it has no idea the head is about to walk the earlier
      // legs — so without this a later leg routes straight back through the
      // cells the snake just filled, most visibly doubling back into the neck
      // it would have created by arriving at the previous target.
      //
      // Occupancy is derived from the route itself. `route[i]` is where the
      // head stands at turn i+1, so the body still covers that cell until the
      // tail clears it at turn i+bodyLength. Arriving there any earlier is a
      // self-collision. Body length is taken as it is now: growth from food
      // eaten along the way is unknowable, and under-estimating length only
      // makes the prediction slightly optimistic rather than wrong-shaped.
      const bodyLength = Math.max(1, gs.you.body?.length ?? gs.you.length ?? 1);
      const occupancyByCell = new Map<number, number[]>();
      const noteOccupied = (steps: RouteStep[], firstRouteIndex: number) => {
        steps.forEach((step, n) => {
          const idx = graph.cellIndexOf(step.cell);
          const at = occupancyByCell.get(idx);
          if (at) at.push(firstRouteIndex + n);
          else occupancyByCell.set(idx, [firstRouteIndex + n]);
        });
      };
      const occupied = (cellIdx: number, arrivalTurn: number): boolean => {
        const at = occupancyByCell.get(cellIdx);
        if (!at) return false;
        for (const i of at) {
          if (arrivalTurn >= i + 1 && arrivalTurn <= i + bodyLength) return true;
        }
        return false;
      };
      noteOccupied(route, 0);

      let firstLeg = 0;
      for (const target of targets) {
        const legStartIndex = route.length;
        const leg = waypointRoute(gs, snakeId, from, target, {
          graph,
          startTurn: turnCursor,
          occupied,
          orientation: facing,
        });
        // Unreachable leg: stop at the last target we can actually get to
        // rather than drawing a path that skips a gap. With nothing reachable
        // at all this leaves just the staged step (or an empty route), so the
        // user still sees which way the snake is about to go.
        if (leg === null) break;
        route.push(...leg);
        noteOccupied(leg, legStartIndex);
        turnCursor += leg.length;
        from = target;
        // The next leg starts facing whatever the last planned turn left the
        // unit facing — otherwise a chained leg would re-plan from the
        // orientation the unit has NOW and under-count its rotations.
        for (let i = leg.length - 1; i >= 0; i--) {
          if (leg[i].rotation) { facing = leg[i].rotation; break; }
        }
        // The first completed leg is the only part conditioned on the move
        // actually staged this turn; the client fades everything after it.
        if (firstLeg === 0) firstLeg = route.length;
      }
      controlled.gotoRoute = route.map(step => step.cell);
      controlled.gotoRouteFirstLeg = firstLeg > 0 ? firstLeg : route.length;
      controlled.gotoRouteRotations = route.map(step => step.rotation ?? null);
    } catch (e) {
      // A display cache must never break staging/commit paths.
      console.error(`[ActiveGameManager] refreshGotoRoute failed for ${gameId}:${snakeId}:`, e);
      ActiveGameManager.clearGotoRoute(controlled);
    }
  }

  // Resolve the goto/near intent to a move by re-running the SAME selection the
  // decision engine uses, over this turn's per-move evaluations with the
  // waypoint progress contribution re-derived from the CURRENT target:
  //   adjusted(move) = engineScore(move)
  //                  - recordedWaypointContribution(move)   // bias applied at decision time
  //                  + weight × progressStat(move)          // bias for the target as it is NOW
  // then pickBestMove (the shared trapped-veto + argmax exported from the
  // decision engine). This makes a target set or moved MID-TURN take effect
  // immediately, and guarantees the staged move is always "the best output of
  // the heuristic matrix with the waypoint weight integrated" — never a hard
  // path override.
  //
  // Returns null when this turn's evaluations aren't available (turn 0, the
  // fast staging pass, error paths), letting computeIntendedMove fall through
  // to the bot recommendation labelled truthfully as 'bot'.
  private getWaypointBiasedMove(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return null;
    // Pieces have no move evaluations to re-bias; their goto intent is a
    // destination command handled by stagePieceMove, never a matrix vote.
    if (this.isPieceUnit(controlled)) return null;
    const wp = this.getActiveWaypointTarget(gameId, snakeId);
    if (!wp) return null;

    const turnData = controlled.latestTurnData;
    if (!turnData || turnData.gameState.turn !== game.boardStateTurn) return null;
    const evaluations = turnData.moveEvaluations;
    if (!evaluations || evaluations.length === 0) return null;

    try {
      // Evaluations were computed from this turn's board; measure progress from
      // the same anchor (that state's head) so the re-bias is apples-to-apples
      // with the engine's own computation.
      const gs = turnData.gameState;
      const head = gs.you.head;
      // Snake evaluations only carry Directions; the narrowing keeps the
      // widened MoveEvaluation.move (CentaurMove) out of the direction math.
      const rows = evaluations.filter(
        (e): e is MoveEvaluation & { move: Direction } => typeof e.move === 'string'
      );
      const progress = waypointProgressByDestination(
        gs,
        snakeId,
        wp,
        rows.map(e => ({ cell: ActiveGameManager.destinationOf(head, e.move) })),
        { graph: new BoardGraph(gs) }
      );

      return pickBestMove(rows.map((evaluation, i) => {
        const breakdown: any = evaluation.breakdown || {};
        const weighted = breakdown.weighted || {};
        const weights = breakdown.weights || {};
        const weight = wp.kind === 'goto'
          ? (weights.gotoProgress ?? DEFAULT_CONFIG.gotoProgress)
          : (weights.nearProgress ?? DEFAULT_CONFIG.nearProgress);
        const recorded = (weighted.gotoProgressScore ?? 0) + (weighted.nearProgressScore ?? 0);
        return {
          move: evaluation.move,
          score: evaluation.score - recorded + weight * progress[i].stat,
          trapped: breakdown.trapped ?? 0,
          // The regicide veto travels with the row: a waypoint must never
          // re-bias us onto a move that ends our own team.
          regicide: breakdown.regicide ?? 0,
        };
      }));
    } catch (e) {
      // Never let waypoint math break staging; fall back to the bot move.
      console.error(`[ActiveGameManager] getWaypointBiasedMove failed for ${gameId}:${snakeId}:`, e);
      return null;
    }
  }

  // The anchor cell for all "next turn" rendering: Q-mode adjacency,
  // candidate-arrow cells, queue-extension click targets. Nothing commits
  // mid-turn anymore (the game server resolves the turn from the last staged
  // move at its deadline), so the anchor is simply the snake's live head.
  getProjectedHead(gameId: string, snakeId: string): Coord | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    return snake?.head || snake?.body?.[0] || null;
  }

  private static destinationOf(head: Coord, move: Direction): Coord {
    switch (move) {
      case 'up':    return { x: head.x,     y: head.y + 1 };
      case 'down':  return { x: head.x,     y: head.y - 1 };
      case 'left':  return { x: head.x - 1, y: head.y     };
      case 'right': return { x: head.x + 1, y: head.y     };
    }
  }

  // Non-mutating safety probe. Reports whether `move` would put THIS snake's
  // head on an impassable cell next turn — off-board, wall/hazard, our own
  // body, a non-severable enemy body, or a stationary chess-piece square
  // whose contest we would lose or tie (tier first, weight second; a WINNABLE
  // piece square is a legal kill, not fatal) — evaluated from the committing
  // snake's OWN perspective via passabilityIdxFor(snakeId), so an invulnerable
  // snake attacking a weaker enemy is correctly NOT fatal. Uses optimistic turn-1
  // semantics, the same the goto-route and space BFS use, so a step onto a tail
  // that vacates this turn is not flagged.
  //
  // This NEVER changes the committed move. The staged move is sacrosanct and
  // commits verbatim; this exists solely so the UI can warn a human that the
  // move they staged is certain death.
  private isMoveFatal(gameId: string, snakeId: string, move: Direction): boolean {
    const game = this.games.get(gameId);
    // After /end the stored boardState can be a final payload with no `board`
    // (scores/winners only), so a UI staged-move hint has nothing to evaluate.
    if (!game?.boardState?.board?.snakes) return false;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return false;
    try {
      const dest = ActiveGameManager.destinationOf(head, move);

      // Own-tail refinement: if the staged move steps onto our OWN tail and
      // that cell has no food, then by definition we are NOT eating this turn,
      // so no speculative "could eat" may keep the tail in place. The tail
      // vacates unless the snake just ate (head already on food) — or, under
      // grow-next-turn, the body is too short for the tail to move. The tail
      // cell must be uniquely the tail (not stacked under an interior segment
      // from a just-completed growth) for this shortcut to apply.
      const body = snake?.body || [];
      const tail = body[body.length - 1];
      const isOwnTail = !!tail && dest.x === tail.x && dest.y === tail.y && body.length > 2;
      const tailStacked = isOwnTail &&
        body.slice(1, -1).some(seg => seg.x === tail.x && seg.y === tail.y);
      const food = game.boardState.board.food || [];
      const destHasFood = food.some(f => f.x === dest.x && f.y === dest.y);
      if (isOwnTail && !tailStacked && !destHasFood) {
        const justAte = food.some(f => f.x === head.x && f.y === head.y);
        return justAte;
      }

      const graph = new BoardGraph(game.boardState);
      if (!graph.isInBounds(dest)) return true;

      // Hazards are damage-based (board.hazardDamage on entry, default 100;
      // death only at health <= 0), so a hazard step is only CERTAIN death
      // when the simulator's exact entry rule says the health won't survive
      // it — same health-aware classification MoveAnalyzer applies, and the
      // same charge-then-eat order, so food on the cell is not a way out of a
      // step whose own cost kills. A survivable hazard step still checks
      // hazard-blind wall/body fatality.
      const boardHazards = game.boardState.board.hazards ?? [];
      if (snake && boardHazards.some(h => h.x === dest.x && h.y === dest.y)) {
        if (healthAfterEntering(game.boardState.board, game.boardState.turn, snake, dest) <= 0) return true;
        return !graph.passabilityIdxFor(snakeId, { clearance: 'optimistic', ignoreHazards: true })
          .passableIdx(graph.cellIndexOf(dest), 1);
      }

      return !graph.passabilityIdxFor(snakeId, { clearance: 'optimistic' })
        .passableIdx(graph.cellIndexOf(dest), 1);
    } catch (e) {
      // A UI hint must never throw on the broadcast path — treat as not-fatal.
      console.error(`[ActiveGameManager] isMoveFatal failed for ${gameId}:${snakeId}:`, e);
      return false;
    }
  }

  // Public: is this snake's currently staged move certain death? Drives the
  // red "fatal staged move" marker in the centaur UI. Pure read — no mutation,
  // no effect on what is staged.
  isStagedMoveFatal(gameId: string, snakeId: string): boolean {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const move = controlled?.staged?.move;
    // Numeric moves are piece destinations — the fatal-move probe is a snake
    // concept (heads walking into walls/bodies) and never applies to pieces.
    if (move === undefined || typeof move !== 'string') return false;
    return this.isMoveFatal(gameId, snakeId, move);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Derives "what move this snake intends this turn" from the active intent
  // method. This is NOT read at commit time — stageMove runs it once per input
  // change and binds the result into `staged`, which is the single record the
  // safety-timer commit and the staged-arrow broadcast read.
  //
  // Priority follows the snake's intention (a single discriminated union, so
  // only one of manual/goto/near can be populated at once):
  //   1. manual user selection (this turn)
  //   2. the waypoint-biased move — the heuristic matrix re-scored with the
  //      CURRENT target's progress contribution (getWaypointBiasedMove)
  //   3. bot recommendation
  //   4. hard fallback ('up')
  //
  // Note what step 2 is NOT: a click-target never dictates the move. It is a
  // weighted vote in the same matrix every other heuristic feeds, so survival
  // terms retain the power to outvote it. The rendered green path follows this
  // choice (refreshGotoRoute), so the visual and the committed move agree.
  // ────────────────────────────────────────────────────────────────────────
  computeIntendedMove(gameId: string, snakeId: string): IntendedMove {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const intent = controlled?.intent;

    if (intent?.kind === 'manual') {
      return { direction: intent.move, source: 'manual', consent: intent.fatalConsent };
    }

    if (intent?.kind === 'goto' || intent?.kind === 'near') {
      const biasedDir = this.getWaypointBiasedMove(gameId, snakeId);
      if (biasedDir) {
        return { direction: biasedDir, source: 'waypoint' };
      }
    }

    // Anything that reaches here is the bot's recommendation — manual and the
    // waypoint re-bias were both unavailable this turn. Report it truthfully
    // as 'bot' even when a waypoint is nominally set, so the staged arrow
    // renders grey and the user can never mistake a bot decision for their
    // own staged move. The fallback is logged at the stageMove choke point
    // where the active intent mode is known.
    //
    // This is the DIRECTION ladder: it is reached only from `stageMove` after
    // pieces have branched to `stagePieceMove`, whose own ladder ends in the
    // numeric bot rung (`computePieceStagedMove`). So a numeric recommendation
    // here belongs to a unit that took the wrong path and is refused rather
    // than staged as a direction.
    const recommended = controlled?.botRecommendation;
    if (typeof recommended === 'string' && recommended) {
      return { direction: recommended, source: 'bot' };
    }

    return { direction: 'up', source: 'fallback' };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Single write point for a snake's intention. Replacing the union as a whole
  // is the mutual exclusion: the new intent structurally supersedes whatever
  // queue/waypoint/manual state the old one held — no field-by-field clearing.
  // Always re-stages the move so `staged` and the broadcast arrow track it.
  // `by` is the operator whose command produced this intent (callers pass the
  // existing intentBy for server-side continuations like goto arrival shifts);
  // it is forced to null for heuristic — the bot has no commanding operator.
  private setIntent(gameId: string, snakeId: string, intent: SnakeIntent, by: OperatorRef | null): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    const previous = controlled.intent;
    if (previous.kind === 'manual' && intent.kind !== 'manual') {
      // A still-staged manual selection is being dropped before it committed
      // (e.g. the user set a queue/waypoint).
      // Log it so a manual move never silently disappears mid-turn.
      console.log(`[ActiveGameManager] Manual selection ${previous.move} for ${gameId}:${snakeId} cleared (intent → ${intent.kind})`);
    }
    controlled.intent = intent;
    controlled.intentBy = intent.kind === 'heuristic' ? null : by;
    this.stageMove(gameId, snakeId);
  }

  // Resolve a userId to the operator identity commands are attributed to:
  // the live connected user, else the game-lifetime name enrolment (so a
  // command from a momentarily-disconnected but enrolled player still
  // attributes correctly).
  private operatorFor(game: ActiveGame, userId: string | null | undefined): OperatorRef | null {
    if (!userId) return null;
    const user = game.connectedUsers.get(userId);
    if (user) return { userId, name: user.name, color: user.color };
    for (const enrolment of game.playerNames.values()) {
      if (enrolment.userId === userId) {
        return { userId, name: enrolment.name, color: enrolment.color };
      }
    }
    // Unresolvable operator (e.g. enrolment records already torn down). The
    // fallback identity must stay visually distinct from the bot's — never
    // BOT_COLOR grey — so a real user's command can't render as a bot arrow;
    // green is the established human-fallback arrow colour.
    return { userId, name: 'Operator', color: '#4CAF50' };
  }

  // Append one row to the command-event log. Never throws into the game path
  // (the CommandLogger enqueue is synchronous and exception-free).
  private logCommandEvent(
    gameId: string,
    snakeId: string | null,
    eventType: string,
    operator: OperatorRef | null,
    payload: unknown
  ): void {
    const game = this.games.get(gameId);
    CommandLogger.getInstance().logEvent({
      gameId,
      snakeId,
      // -1 marks "turn unknown" when the game is already gone at log time
      // (e.g. a command racing teardown). Never default to 0: that would
      // misattribute the event to the real first turn in the audit log.
      turn: game?.boardStateTurn ?? -1,
      eventType,
      operator,
      payload,
    });
  }

  // The sole writer of `staged`: resolves the active intent to one Direction via
  // computeIntendedMove and binds it to the current (snakeId, turn) as one atomic
  // record. Call on every input change (turn start, intent-mode switch, queue or
  // waypoint set, manual selection, bot completion while heuristic). The deadline
  // commit and the staged-arrow broadcast only ever read `staged`.
  private stageMove(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    // Chess pieces stage destinations, not directions — a wholly separate
    // resolution path that skips every direction-only gate below.
    if (this.isPieceUnit(controlled)) {
      this.stagePieceMove(gameId, snakeId);
      return;
    }
    const previous = controlled.staged;
    const intended = this.computeIntendedMove(gameId, snakeId);
    const turn = game!.boardStateTurn;

    // Commitment is binding: Firestore rules reject staged writes for a
    // committed snake, so once this turn is committed the staged record is
    // frozen — intent changes still land but only apply from the next turn.
    if (controlled.lastCommittedTurn === turn) {
      console.log(`[ActiveGameManager] Staging frozen for ${gameId}:${snakeId} turn ${turn} (committed) — ${intended.source} ${intended.direction} not staged`);
      return;
    }

    // ── Fatal-move consent gate ─────────────────────────────────────────
    // A HUMAN-AUTHORED certain-death move may only be staged when it carries a
    // minted FatalMoveConsent. Without consent we stage the bot's move instead
    // and ask the client to show a confirmation dialog. Bot-sourced moves are
    // exempt: when the bot itself picks a fatal move there is no better
    // alternative to offer.
    //
    // 'waypoint' is deliberately EXCLUDED from the gate: a goto/near
    // direction is BOT-chosen — the heuristic matrix with the waypoint
    // weight integrated — so the bot's own death-aversion already
    // arbitrates it. Prompting would ask the human to confirm a move the bot
    // picked, and the fallback would swap one bot-chosen move for another. The
    // source-agnostic red marker (isStagedMoveFatal) still flags it in the UI.
    let direction = intended.direction;
    let source = intended.source;
    const humanSourced = source === 'manual';
    if (
      humanSourced &&
      !intended.consent &&
      typeof direction === 'string' &&
      this.isMoveFatal(gameId, snakeId, direction)
    ) {
      // This is the SNAKE path (pieces branched out above), so the bot's
      // recommendation for this unit is a Direction. The narrowing is explicit
      // rather than assumed: botRecommendation is a CentaurMove now that
      // pieces have a bot route, and a numeric destination is not a legal
      // substitute for a snake's direction — it would be a wire-shape error,
      // so it is refused in favour of the hard fallback.
      const recommended = controlled.botRecommendation;
      const fallback = typeof recommended === 'string' ? recommended : null;
      console.warn(`[ActiveGameManager] FATAL-MOVE GATE for ${gameId}:${snakeId} turn ${turn}: unconsented ${source} move ${direction} is certain death — staging ${fallback ? `bot move ${fallback}` : `fallback 'up'`} instead, awaiting confirmation`);
      if (controlled.fatalPromptTurn !== turn || controlled.fatalPromptMove !== direction) {
        controlled.fatalPromptTurn = turn;
        controlled.fatalPromptMove = direction;
        this.notifyFatalConfirmationNeeded(gameId, snakeId, direction, turn);
      }
      if (fallback) {
        direction = fallback;
        source = 'bot';
      } else {
        direction = 'up';
        source = 'fallback';
      }
    }

    // A new request supersedes a not-yet-fired deferred commit: the user is
    // no longer "done" with the move they submitted.
    if (controlled.pendingCommitTurn === turn && previous?.move !== direction) {
      console.log(`[ActiveGameManager] Deferred commit for ${gameId}:${snakeId} turn ${turn} cancelled — new staging ${direction} supersedes it`);
      controlled.pendingCommitTurn = null;
    }

    controlled.staged = {
      snakeId,
      turn,
      move: direction,
      source,
      // Consent only counts when the consented move is the one actually staged
      // (the gate above may have replaced it with the bot fallback).
      fatalConsented: !!intended.consent && direction === intended.direction,
    };
    this.logReversalTripwire(gameId, controlled, direction, source);
    this.logStagedMoveAnomalies(gameId, controlled, previous, intended);
    // Report the bind to pin observers. AFTER the record is final, so what an
    // observer sees is the move that will actually be written — the fatal gate
    // above can replace a human's direction with the bot's, and a pin derived
    // from the pre-gate value would name a move the game never plays.
    this.notifyPinIntent({ gameId, snakeId, turn, move: direction, source, kind: 'staged' });

    // Refresh the derived green path AFTER `controlled.staged` is final: the
    // fatal-move gate above can replace the staged direction, and the drawn
    // path must follow the move that will actually commit, not the one the
    // target wanted.
    this.refreshGotoRoute(gameId, snakeId);

    // Publish-until-confirmed: hand the requested move to the pipeline, which
    // writes it to Firebase and re-publishes until the read-back confirmation
    // matches. Firebase is the single source of truth for staged moves.
    this.ensureStagedPublished(gameId, snakeId);

    // Reactive sync: every stage (the single point all intent changes funnel
    // through) marks the game dirty so the staged arrow + intent projections
    // are pushed to clients, coalesced to once per event-loop tick.
    this.notifyStagedChange(gameId);
  }

  // ── Chess pieces ─────────────────────────────────────────────────────────
  // A piece's staged move is the FULL-BOARD index of its destination square
  // (the TacticToes wire format), not a Direction. Commanding is goto-based:
  // the head of the goto queue IS the destination. Legality mirrors the
  // server's pieceMoves.ts via src/logic/piece-moves.ts, so the centaur never
  // stages a move the server would reject; an illegal target stages the
  // piece's own square, which the server treats as stay.

  private isPieceUnit(controlled: ControlledSnake): boolean {
    return (controlled.unitType ?? 'snake') !== 'snake';
  }

  /** A piece's own square as a full-board index (= the wire's "stay"), or null. */
  private pieceOwnSquareIndex(gameId: string, snakeId: string): number | null {
    const board = this.games.get(gameId)?.boardState?.board;
    const you = board?.snakes?.find(s => s.id === snakeId);
    const head = you?.head || you?.body?.[0];
    if (!board || !head) return null;
    return apiCoordToIndex(head, board.width + 2, board.height + 2);
  }

  // Every square holding food or ANY unit at the start of the turn, as
  // full-board indices — the target set a pawn's diagonal-forward step is
  // legal into (attack or eat; no friendly exemption, matching the engine).
  private pawnTargetSquares(board: NonNullable<BoardSnapshot['board']>): Set<number> {
    const fullW = board.width + 2;
    const fullH = board.height + 2;
    const targets = new Set<number>();
    for (const f of board.food || []) targets.add(apiCoordToIndex(f, fullW, fullH));
    for (const s of board.snakes || []) {
      for (const seg of s.body || []) targets.add(apiCoordToIndex(seg, fullW, fullH));
    }
    return targets;
  }

  // The SINGLE resolver for a piece's commanded destination this turn —
  // goto (the queue head, pathfound) and manual (numeric destination from the
  // candidate UI) both funnel through here.
  //
  //  - manual is an explicit human destination, decided by exactly one
  //    planPieceAction call: a legal single move (ray/jump/step, pawn
  //    orientation and diagonal-only-onto-target rules included; a pawn's side
  //    square is the rotate encoding) stages that square's index, anything
  //    else stages the piece's own square (= stay; the wire accepts any int and
  //    the server treats an illegal/own-square move as stay);
  //  - goto is a DESTINATION, not necessarily one move away: the candidate
  //    carrying the highest waypoint-biased weight wins (computePieceCandidates),
  //    which is the first hop of a shortest path to the target — the target
  //    itself whenever it is one move away. With no positive signal (an
  //    unreachable target) the piece stays.
  //
  // The piece fallback is ALWAYS its own square, never a direction. The planned
  // PieceAction rides along so staging can record the stay/move/rotate
  // distinction instead of discarding it.
  // Returns null when the piece has no command (or no board yet) — the caller
  // then stages nothing at all and the server defaults to stay.
  private computePieceStagedMove(
    gameId: string,
    snakeId: string
  ): { move: number; source: IntendedMoveSource; action: PieceAction | null } | null {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return null;
    const board = game.boardState?.board;
    const you = board?.snakes?.find(s => s.id === snakeId);
    const head = you?.head || you?.body?.[0];
    if (!board || !you || !head) return null;

    const fullW = board.width + 2;
    const fullH = board.height + 2;
    const originIdx = apiCoordToIndex(head, fullW, fullH);
    const intent = controlled.intent;

    if (intent.kind === 'goto' && intent.targets.length > 0) {
      const best = this.bestPieceCandidate(gameId, snakeId);
      return {
        move: best?.move ?? originIdx,
        source: 'waypoint',
        action: best?.action ?? { kind: 'stay' },
      };
    }
    const pawnTargets =
      controlled.unitType === 'pawn' ? this.pawnTargetSquares(board) : undefined;

    if (intent.kind !== 'manual' || typeof intent.move !== 'number') {
      // THE BOT RUNG, third and last — reached only when no operator command
      // applies, exactly as it is for snakes. It is the whole of the piece bot
      // route: before it existed, `botRecommendation` was hard-coded null for
      // every piece and an uncommanded piece stages nothing at all, which is
      // still what happens when the bot has nothing to say.
      //
      // The recommendation is validated through the SAME planPieceAction the
      // manual rung uses, so a destination the server would reject stages the
      // piece's own square (= stay) instead of a write the engine discards.
      const recommended = controlled.botRecommendation;
      if (typeof recommended !== 'number') return null;
      const botAction = planPieceAction(
        controlled.unitType,
        originIdx,
        recommended,
        fullW,
        fullH,
        you.orientation,
        pawnTargets
      );
      if (!botAction) {
        console.warn(
          `[ActiveGameManager] Bot recommended illegal destination ${recommended} for ` +
            `${controlled.unitType} ${gameId}:${snakeId} — staging stay (${originIdx}) instead`
        );
      }
      return {
        move: botAction ? recommended : originIdx,
        source: 'bot',
        action: botAction ?? { kind: 'stay' },
      };
    }

    const action = planPieceAction(
      controlled.unitType,
      originIdx,
      intent.move,
      fullW,
      fullH,
      you.orientation,
      pawnTargets
    );
    return {
      move: action ? intent.move : originIdx,
      source: 'manual',
      action: action ?? { kind: 'stay' },
    };
  }

  // The winning candidate for a piece's active waypoint: the highest score,
  // ties broken by the shorter remaining distance (so an arrival always beats
  // a detour of equal stat) and then by enumeration order. Null when no
  // candidate carries a positive score — an unreachable target pulls nowhere
  // and the piece stays put.
  private bestPieceCandidate(gameId: string, snakeId: string): PieceCandidateScore | null {
    // Candidate-level FATAL veto, the piece counterpart of pickBestMove's
    // fatal-pocket veto for snakes: a candidate whose projected traversal
    // kills the piece (projected health 0) is never chosen while a survivable
    // candidate exists — the hard guarantee on top of the strongly-negative
    // deaths weight already inside `score`, which a large enough waypoint
    // bonus could otherwise outbid on a low-health piece. If EVERY candidate
    // is fatal we score among all of them (least-bad death). Enumeration is
    // untouched: fatal candidates still reach the UI, so a human commander can
    // still stage a sacrifice.
    //
    // REGICIDE outranks it, exactly as it does in pickBestMove for snakes: a
    // candidate that takes our team's LAST king ends the whole team that turn,
    // which is strictly worse than losing this one piece — so it is filtered
    // FIRST and only ignored if literally every candidate commits it. (Staying
    // put is always enumerated and never kills anyone, so in practice there is
    // always something left.)
    //
    // The ONE exemption from the fatal veto is a candidate that ENDS AN ENEMY
    // TEAM: a traversal that takes their last king wins us the engine's
    // regicide (every unit that team owns is removed that turn) even when the
    // contest is a TIE that kills our unit too. Trading one piece for a whole
    // enemy side is a winning move, not a suicide, so it stays in the pool and
    // is ranked by `score` — where enemyRegicide (+2000) beats the deaths
    // (-500) and health-loss (-500 at full health) charges it carries. Our own
    // regicide filter runs FIRST and is not exempted, so this can never trade
    // our last king for theirs.
    const all = this.computePieceCandidates(gameId, snakeId);
    const survivingTeam = all.filter(c => c.casualties.regicide === 0);
    const alive = survivingTeam.length > 0 ? survivingTeam : all;
    const survivable = alive.filter(c => !c.fatal || c.casualties.enemyRegicide === 1);
    const pool = survivable.length > 0 ? survivable : alive;
    let best: PieceCandidateScore | null = null;
    for (const candidate of pool) {
      if (candidate.score <= 0) continue;
      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && (candidate.dist ?? Infinity) < (best.dist ?? Infinity))
      ) {
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Every legal candidate for a controlled piece this turn, scored as its base
   * weight PLUS the active waypoint's contribution MINUS the projected health
   * cost of getting there:
   *
   *   score(dest) = base + weight × progressStat(dest)
   *                        + healthLossWeight × cost(dest)
   *                        + deathsWeight × fatal(dest)
   *                        + allyCasualtyWeight × allyWeightDestroyed(dest)
   *                        + regicideWeight × endsOurTeam(dest)
   *                        + killsWeight × enemiesKilled(dest)
   *                        + enemyRegicideWeight × endsTheirTeam(dest)
   *
   * ADDITIVE, exactly as getWaypointBiasedMove is for snakes (which subtracts
   * the contribution already inside the engine score before adding the one for
   * the target as it is NOW). The bot has no piece evaluator yet, so every
   * candidate's base weight is 0 and the waypoint stat is the only POSITIVE
   * signal ordering them: the hop that ends nearest the target along a
   * shortest path scores the full weight, and nothing else competes for the
   * lead. Health cost only ever pulls a candidate DOWN — the same shared
   * oracle the snake health-loss heuristic uses (turn-oracle.ts, resolving
   * the candidate's own path through the vendored engine), so a
   * cheaper hop wins a tie and a hazard-crossing ray is decisively outweighed
   * by a same-progress detour around it, with no piece-specific hazard rule.
   * A ray the projection resolves as DEATH — it crosses a snake body segment
   * (ally or enemy: the engine never teams) at or above the piece's tier, or
   * loses a piece contest, or exhausts its health — reports a cost that zeroes
   * the piece's health AND sets `fatal`, which charges DEFAULT_CONFIG.deaths
   * on top, the same way a snake's death enters its score. bestPieceCandidate
   * then vetoes it outright — unless the same traversal ends an enemy team,
   * because a TIED contest kills the unit we tied with too: a mutual
   * destruction still records its victim (kills / allyCasualty / regicide),
   * so a fatal-but-winning king trade carries the enemyRegicide reward and is
   * scored rather than discarded.
   *
   * The stat comes from the shared waypoint pathfinder walking the graph's
   * per-unit adjacency, so a knight is ordered by knight moves and a rook by
   * rays — there is nothing type-aware in this layer, and the piece's own
   * shortest path is what the goto route draws.
   */
  private computePieceCandidates(gameId: string, snakeId: string): PieceCandidateScore[] {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const snapshot = game?.boardState;
    if (!controlled || !snapshot?.board || !this.isPieceUnit(controlled)) return [];
    const gs = this.viewFor(snapshot, snakeId);
    const head = gs?.you?.head || gs?.you?.body?.[0];
    if (!gs || !head) return [];

    const board = gs.board;
    const fullW = board.width + 2;
    const fullH = board.height + 2;
    const unitType = controlled.unitType ?? 'snake';
    const pawnTargets = unitType === 'pawn' ? this.pawnTargetSquares(board) : undefined;
    const legal = legalPieceDestinations(
      unitType,
      apiCoordToIndex(head, fullW, fullH),
      fullW,
      fullH,
      gs.you.orientation,
      pawnTargets
    );
    const dests = legal.map(c => toApiCoord(c.dest, fullW, fullH));
    // Progress is measured in the STATE the candidate leaves the piece in: a
    // move displaces it (facing unchanged), a stay spends the turn standing,
    // and a rotation spends it turning — same square, new orientation. That
    // last one is why a rotation can score: the search plans from the way the
    // piece WOULD face, so turning toward the target measures closer than
    // standing still, and staging picks it as the first action of the plan.
    const probes: WaypointProbe[] = legal.map((c, i) =>
      c.action.kind === 'move' ? { cell: dests[i] }
        : c.action.kind === 'rotate' ? { cell: head, orientation: c.action.orientation }
          : { cell: head }
    );

    const waypoint = this.getActiveWaypointTarget(gameId, snakeId);
    const weight = !waypoint ? 0
      : waypoint.kind === 'goto' ? DEFAULT_CONFIG.gotoProgress
      : DEFAULT_CONFIG.nearProgress;
    let progress: WaypointCandidateProgress[] | null = null;
    if (waypoint) {
      try {
        progress = waypointProgressByDestination(gs, snakeId, waypoint, probes, {
          graph: new BoardGraph(gs),
        });
      } catch (e) {
        // Waypoint math must never break staging or the candidate broadcast:
        // without it every candidate keeps its base weight and the piece stays.
        console.error(`[ActiveGameManager] piece waypoint progress failed for ${gameId}:${snakeId}:`, e);
      }
    }

    // One marshalling of the board into engine terms, reused by every
    // candidate below. `action.path` is already full-board indices, which is
    // what the engine wants, so a move's ray goes straight in.
    const marshalled = marshalBoard(board, gs.turn);

    return legal.map(({ dest, action }, i) => {
      const stat = progress?.[i].stat ?? 0;
      // THE REAL TURN, RESOLVED. This candidate's path goes into the vendored
      // engine and the outcome is read off the result: `fatal` is our unit
      // appearing in the death registry, `healthCost` is the health the engine
      // left us short, and `casualties` is whoever it killed in a clash we
      // took part in plus whatever it reports in `eliminatedTeamIDs`. Nothing
      // here re-derives a rule — a truncated ray, an exhaustion halt that food
      // rescues, a capture-stop, an edge exchange with an enemy that stepped
      // into us: all of it is whatever the engine actually did.
      //
      // A stay/rotate enters nothing and so cannot hurt anybody; the engine
      // agrees, but skipping the call keeps the common case free.
      const outcome = action.kind === 'move'
        ? evaluateCandidatePath(marshalled, snakeId, action.path)
        : null;
      const healthCost = outcome?.cost ?? 0;
      const fatal = outcome?.fatal ?? false;
      const casualties = outcome?.casualties ?? emptyCasualtyContext();
      return {
        move: dest,
        action,
        destCoord: dests[i],
        kind: waypoint?.kind ?? null,
        weight,
        stat,
        dist: progress?.[i].dist ?? null,
        healthCost,
        fatal,
        casualties,
        score: weight * stat
          + DEFAULT_CONFIG.healthLoss * healthCost
          + DEFAULT_CONFIG.deaths * (fatal ? 1 : 0)
          + DEFAULT_CONFIG.kills * casualties.kills
          + DEFAULT_CONFIG.allyCasualty * casualties.allyCasualty
          + DEFAULT_CONFIG.regicide * casualties.regicide
          + DEFAULT_CONFIG.enemyRegicide * casualties.enemyRegicide,
      };
    });
  }

  // The piece analog of stageMove's tail: bind one atomic staged record and
  // hand it to the publish-until-confirmed pipeline. Skips the direction-only
  // machinery deliberately — no fatal gate (staying is always available and a
  // destination click is an explicit human command), no reversal tripwire, no
  // green route (the waypoint overlay already marks the destination).
  private bindStagedPieceMove(
    gameId: string,
    snakeId: string,
    move: number,
    source: IntendedMoveSource,
    action: PieceAction | null = null
  ): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    const turn = game.boardStateTurn;

    if (controlled.lastCommittedTurn === turn) {
      console.log(`[ActiveGameManager] Staging frozen for piece ${gameId}:${snakeId} turn ${turn} (committed) — ${source} ${move} not staged`);
      return;
    }

    const previous = controlled.staged;
    if (controlled.pendingCommitTurn === turn && previous?.move !== move) {
      console.log(`[ActiveGameManager] Deferred commit for ${gameId}:${snakeId} turn ${turn} cancelled — new piece staging ${move} supersedes it`);
      controlled.pendingCommitTurn = null;
    }

    controlled.staged = { snakeId, turn, move, source, fatalConsented: false, action };
    this.notifyPinIntent({ gameId, snakeId, turn, move, source, kind: 'staged' });
    // Same ordering as stageMove: the drawn route follows the move that will
    // actually commit, so it is refreshed only once `staged` is final.
    this.refreshGotoRoute(gameId, snakeId);
    this.ensureStagedPublished(gameId, snakeId);
    this.notifyStagedChange(gameId);
  }

  // The piece counterpart of stageMove: resolve the intent to a destination.
  // heuristic/near (no operator command) stages NOTHING — the server defaults
  // an unstaged piece to stay — with one exception: when a command already
  // staged something for THIS turn and the intent has since been cleared, an
  // explicit stay is staged to supersede it (there is no "unstage" on the
  // wire; the server would otherwise keep the last write).
  private stagePieceMove(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    const turn = game.boardStateTurn;

    const planned = this.computePieceStagedMove(gameId, snakeId);
    if (planned) {
      this.bindStagedPieceMove(gameId, snakeId, planned.move, planned.source, planned.action);
      return;
    }
    if (controlled.staged?.turn === turn) {
      const stay = this.pieceOwnSquareIndex(gameId, snakeId);
      if (stay !== null && controlled.staged.move !== stay) {
        this.bindStagedPieceMove(gameId, snakeId, stay, 'fallback', { kind: 'stay' });
        return;
      }
    }
    // Nothing bound (so bindStagedPieceMove did not refresh): the drawn route
    // must still track the intent this call resolved.
    this.refreshGotoRoute(gameId, snakeId);
  }

  // The piece candidate rows for the UI, from the SAME scored candidates
  // staging picks from — so the shading, the arrows and the move that commits
  // all read one computation. The bot has no piece evaluator yet, so a piece
  // with no waypoint scores only its health cost (the goto/near contribution
  // is the only POSITIVE signal); an active waypoint adds its contribution on
  // top. Both fill the weights/weighted tables the breakdown component
  // renders, keyed exactly like the registry (healthLoss/healthLossScore) so
  // a stay/rotate candidate (cost 0) still reports it, just at zero.
  // A real piece evaluator adds its base weight in computePieceCandidates —
  // the row shape (move id + dest + kind) is already the full UI contract.
  private computePieceMoveEvaluations(gameId: string, snakeId: string): MoveEvaluation[] {
    return this.computePieceCandidates(gameId, snakeId).map(candidate => {
      const progressScore = candidate.weight * candidate.stat;
      const healthLossScore = DEFAULT_CONFIG.healthLoss * candidate.healthCost;
      const deaths = candidate.fatal ? 1 : 0;
      const { allyCasualty, regicide, kills, enemyRegicide } = candidate.casualties;
      return {
        move: candidate.move,
        score: candidate.score,
        numStates: 0,
        breakdown: {
          healthLoss: candidate.healthCost,
          deaths,
          // The casualty terms report on EVERY candidate, zero included, so a
          // ray that kills nothing is visibly a ray that kills nothing.
          kills,
          allyCasualty,
          regicide,
          enemyRegicide,
          weights: {
            healthLoss: DEFAULT_CONFIG.healthLoss,
            deaths: DEFAULT_CONFIG.deaths,
            kills: DEFAULT_CONFIG.kills,
            allyCasualty: DEFAULT_CONFIG.allyCasualty,
            regicide: DEFAULT_CONFIG.regicide,
            enemyRegicide: DEFAULT_CONFIG.enemyRegicide,
            ...(candidate.kind ? { [`${candidate.kind}Progress`]: candidate.weight } : {}),
          },
          weighted: {
            healthLossScore,
            deathsScore: deaths === 1 ? DEFAULT_CONFIG.deaths : 0,
            killsScore: DEFAULT_CONFIG.kills * kills,
            allyCasualtyScore: DEFAULT_CONFIG.allyCasualty * allyCasualty,
            regicideScore: DEFAULT_CONFIG.regicide * regicide,
            enemyRegicideScore: DEFAULT_CONFIG.enemyRegicide * enemyRegicide,
            ...(candidate.kind ? { [`${candidate.kind}ProgressScore`]: progressScore } : {}),
          },
          ...(candidate.kind ? { [`${candidate.kind}Progress`]: candidate.stat } : {}),
        },
        dest: candidate.destCoord,
        kind: candidate.action.kind,
      };
    });
  }

  // Turn intake for a controlled chess piece — the piece counterpart of
  // setBotRecommendation's turn bookkeeping. Refreshes the unit type (pawn
  // promotion) and re-stages the piece's goto command for the new turn.
  // In the canonical pipeline the transport calls updateBoard FIRST (which
  // advances the shared board and runs the goto-arrival shift), then this per
  // piece; the board-advance branch below is defensive only, kept so the game
  // stays live if a transport ever feeds pieces without feeding the board.
  //
  // `botRecommendation` is the piece's own bot route: a FULL-BOARD destination
  // index the decision engine wants this piece on, or null for "the bot has
  // nothing to say". It used to be hard-coded null here, which is why pieces
  // were operator-command-only — an uncommanded piece staged nothing and the
  // server defaulted it to stay. Omitting the argument reproduces exactly that,
  // so the snake-only transport is unchanged; passing one adds the third rung
  // of the precedence ladder BELOW manual and waypoint, never above them.
  updatePieceTurn(
    gameId: string,
    snakeId: string,
    gameState: GameState,
    botRecommendation: number | null = null
  ): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    const incomingTurn = gameState.turn;
    if (incomingTurn < game.boardStateTurn) {
      console.log(
        `[ActiveGameManager] Dropping stale piece turn intake for ${gameId}:${snakeId} ` +
        `(turn ${incomingTurn}, board is at turn ${game.boardStateTurn})`
      );
      return;
    }
    game.lastActivityAt = Date.now();
    game.gameTimeout = gameState.game.timeout || game.gameTimeout;
    game.currentTurn = Math.max(game.currentTurn, incomingTurn);

    let boardUpdated = false;
    if (incomingTurn > game.boardStateTurn) {
      // Defensive only: updateBoard should have advanced the board already.
      console.warn(
        `[ActiveGameManager] updatePieceTurn advanced the board for ${gameId} ` +
        `(turn ${game.boardStateTurn} -> ${incomingTurn}) — updateBoard should have run first`,
      );
      game.boardState = gameState;
      game.boardStateTurn = incomingTurn;
      for (const snake of gameState.board.snakes) {
        if (!game.snakes.has(snake.id)) {
          game.snakes.set(snake.id, {
            id: snake.id,
            name: snake.name,
            letter: snake.letter || '',
          });
        }
      }
      boardUpdated = true;
    }

    // Promotion changes the unit type mid-game (pawn → queen).
    controlled.unitType = gameState.you.unitType ?? controlled.unitType;
    // The bot's destination for this piece, if the caller has one. Set BEFORE
    // the re-stage below so the piece ladder's bot rung can see it, and cleared
    // by an explicit null so a stale recommendation from the previous turn can
    // never survive into this one.
    controlled.botRecommendation = botRecommendation;
    // Candidate turn data: every legal destination scored by the waypoint
    // bias, through the same TurnData/broadcast contract snakes use.
    controlled.latestTurnData = {
      gameState,
      moveEvaluations: this.computePieceMoveEvaluations(gameId, snakeId),
      territoryCells: {},
      safeMoves: [],
      botRecommendation,
      timestamp: Date.now(),
    };

    // Re-stage for the new turn: goto commands persist across turns (the
    // queue shifts on arrival in updateBoard); heuristic stages nothing.
    // Manual is single-turn, exactly as for snakes (setBotRecommendation):
    // a manual destination staged for a PRIOR turn is stale and reverts to
    // the heuristic (= uncommanded: nothing staged, server defaults to stay);
    // a manual selection made for THIS turn stays authoritative.
    const prevStagedTurn = controlled.staged?.turn ?? null;
    controlled.staged = null;
    if (controlled.intent.kind === 'manual' && prevStagedTurn !== game.boardStateTurn) {
      this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
    } else {
      this.stageMove(gameId, snakeId);
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, gameState);
    }
    // The piece counterpart of setBotRecommendation's broadcast: without this
    // no snake-turn-update frame ever reaches the client for a piece, and the
    // candidate cells only appear via game-subscribed / snake-selected.
    this.notifyTurnUpdate(gameId, snakeId, controlled.latestTurnData);
  }

  private static readonly STAGING_RETRY_MS = 1000;

  // The publish-until-confirmed pipeline. Invoked on every stage (the request
  // changed), on every Firebase confirmation update (to detect mismatches),
  // and from its own backstop timer. Terminates when the confirmed staged
  // move matches the requested one, or when the board has moved past the
  // requested turn (the snake's next stage re-enters the pipeline).
  private ensureStagedPublished(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    const requested = controlled.staged;
    if (!requested) return;

    const clearRetry = () => {
      if (controlled.stagingRetryTimer) {
        clearTimeout(controlled.stagingRetryTimer);
        controlled.stagingRetryTimer = null;
      }
    };

    // The board moved past this request — stop; it can never be confirmed
    // (the read-back listener for its turn is gone) and no longer matters.
    if (game.boardStateTurn > requested.turn) {
      clearRetry();
      return;
    }

    // The turn already finalized — Firebase picked its move; late publishes
    // can't change anything.
    if (controlled.finalMove?.turn === requested.turn) {
      clearRetry();
      return;
    }

    // Committed this turn — the rules now reject staged writes for this
    // snake, so publishing (or retrying) is pointless.
    if (controlled.lastCommittedTurn === requested.turn) {
      clearRetry();
      return;
    }

    // Firebase confirms the requested move — the pipeline is done.
    if (
      controlled.confirmedStaged?.turn === requested.turn &&
      controlled.confirmedStaged.move === requested.move
    ) {
      clearRetry();
      return;
    }

    // TEAM STAGING, opt-in per game. The team submitter owns publishing,
    // throttling, confirm and retry for the whole set at once, so this unit's
    // own submit and its own backstop timer would be redundant writes against
    // the same documents. Every guard above still applies unchanged — a
    // committed, finalized, confirmed or superseded request stops here on both
    // paths. Nothing below this line runs for a team-staged game, and nothing
    // above it behaves differently.
    if (this.teamStagedGames.has(gameId)) {
      clearRetry();
      this.requestTeamPublish(gameId, requested.turn);
      return;
    }

    const alreadySubmitted =
      controlled.lastSubmittedTurn === requested.turn &&
      controlled.lastSubmittedMove === requested.move;
    if (!alreadySubmitted) {
      controlled.lastSubmittedTurn = requested.turn;
      controlled.lastSubmittedMove = requested.move;
      if (this.moveSubmitter) {
        this.moveSubmitter(gameId, snakeId, requested.turn, requested.move, requested.source).catch((err) => {
          console.error(`[ActiveGameManager] Failed to publish staged move for ${gameId}:${snakeId} turn ${requested.turn}:`, err);
          // Clear the in-flight marker so the backstop republishes.
          if (
            controlled.lastSubmittedTurn === requested.turn &&
            controlled.lastSubmittedMove === requested.move
          ) {
            controlled.lastSubmittedTurn = null;
            controlled.lastSubmittedMove = null;
          }
        });
      } else {
        console.error(`[ActiveGameManager] No move submitter wired — staged move for ${gameId}:${snakeId} turn ${requested.turn} NOT published`);
      }
    }

    // Backstop: if Firebase hasn't confirmed the requested move by the next
    // tick, treat the write as lost and republish.
    clearRetry();
    const timer = transientTimeout(() => {
      const cs = this.games.get(gameId)?.controlledSnakes.get(snakeId);
      if (!cs || cs.stagingRetryTimer !== timer) return;
      cs.stagingRetryTimer = null;
      const req = cs.staged;
      if (!req) return;
      if (cs.confirmedStaged?.turn === req.turn && cs.confirmedStaged.move === req.move) return;
      console.warn(`[ActiveGameManager] Staged move for ${gameId}:${snakeId} turn ${req.turn} (${req.move}) still unconfirmed — republishing`);
      cs.lastSubmittedTurn = null;
      cs.lastSubmittedMove = null;
      this.ensureStagedPublished(gameId, snakeId);
    }, ActiveGameManager.STAGING_RETRY_MS);
    controlled.stagingRetryTimer = timer;
  }

  // Whether this snake has a requested move for `turn` that Firebase has not
  // yet confirmed. Used by the interface's default-move inference: a commit
  // observed while a request is still unconfirmed must WAIT (the in-flight
  // write would beat the engine default), whereas a commit with no request
  // at all resolves to the deterministic default immediately.
  hasUnconfirmedRequest(gameId: string, snakeId: string, turn: number): boolean {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    const requested = controlled?.staged;
    if (!controlled || !requested || requested.turn !== turn) return false;
    return !(
      controlled.confirmedStaged?.turn === turn &&
      controlled.confirmedStaged.move === requested.move
    );
  }

  // Fed by the Firebase read-back listener: the latest server-acked staged
  // move for (snakeId, turn). Broadcast to clients as the solid arrow, and
  // used by the pipeline to decide whether the request needs republishing.
  setConfirmedStagedMove(gameId: string, snakeId: string, turn: number, move: CentaurMove): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    if (controlled.confirmedStaged?.turn === turn && controlled.confirmedStaged.move === move) return;
    controlled.confirmedStaged = { turn, move };
    this.ensureStagedPublished(gameId, snakeId);

    // A deferred Submit All fires the moment the requested move is the
    // confirmed one — the freeze then provably locks the user's move.
    if (
      controlled.pendingCommitTurn === turn &&
      controlled.staged?.turn === turn &&
      controlled.staged.move === move
    ) {
      console.log(`[ActiveGameManager] Deferred commit firing for ${gameId}:${snakeId} turn ${turn} (${move} confirmed)`);
      this.commitSnakeNow(gameId, snakeId, controlled, turn);
    }

    this.notifyStagedChange(gameId);
  }

  // Fed by the Firebase interface when — and ONLY when — this snake's commit
  // is actually recorded in Firebase (the snake appears in
  // moveStatuses.movedPlayerIDs) and its confirmed staged move is known from
  // the read-back. Never inferred from timers or the turn expiry: the double
  // arrow is a report of observed Firebase state, nothing else. Turns that
  // resolve by timeout without a commit simply never show it.
  finalizeTurnMove(gameId: string, snakeId: string, turn: number, move: CentaurMove): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    if (controlled.finalMove?.turn === turn) return;
    if (controlled.stagingRetryTimer) {
      clearTimeout(controlled.stagingRetryTimer);
      controlled.stagingRetryTimer = null;
    }
    controlled.finalMove = { turn, move };
    this.notifyMoveCommitted(gameId, snakeId, move, 'firebase-final');
    this.notifyStagedChange(gameId);
  }

  // Permanent tripwire: a staged move whose destination is the snake's own
  // neck (the just-vacated cell) is a guaranteed 180° self-collision. This
  // should now be impossible for human-sourced moves (consent gate + neck
  // guards), so any hit is a bug worth a full state dump — or a deliberate
  // kill-all. Log-only; never alters the staged move.
  private logReversalTripwire(gameId: string, controlled: ControlledSnake, move: CentaurMove, source: IntendedMoveSource): void {
    // Reversal is a snake concept; numeric (piece) moves have no neck to hit.
    if (typeof move !== 'string') return;
    const game = this.games.get(gameId);
    const snake = game?.boardState?.board?.snakes?.find(s => s.id === controlled.id);
    const head = snake?.head || snake?.body?.[0];
    const neck = snake?.body?.[1];
    if (!head || !neck || (neck.x === head.x && neck.y === head.y)) return;
    const dest = ActiveGameManager.destinationOf(head, move);
    if (dest.x !== neck.x || dest.y !== neck.y) return;
    console.warn(`[ActiveGameManager] REVERSAL TRIPWIRE for ${gameId}:${controlled.id}: staged ${source} move ${move} steps onto own neck. State: ${JSON.stringify({
      turn: game?.boardStateTurn,
      move,
      source,
      head,
      neck,
      projectedHead: this.getProjectedHead(gameId, controlled.id),
      intent: controlled.intent,
      staged: controlled.staged,
      suicideArmed: controlled.suicideArmed,
    })}`);
  }

  // Surfaces the two previously-silent failure modes whenever a move is staged:
  // a human intent that silently fell back to the bot's move, and a manual
  // selection that changed direction or origin within the same turn.
  private logStagedMoveAnomalies(gameId: string, controlled: ControlledSnake, previous: StagedMove | null, intended: IntendedMove): void {
    const resolvedToBot = intended.source === 'bot' || intended.source === 'fallback';
    if (controlled.intent.kind !== 'heuristic' && resolvedToBot) {
      console.log(`[ActiveGameManager] Intent fallback for ${gameId}:${controlled.id}: intent=${controlled.intent.kind} could not be honoured this turn → committing ${intended.source} move ${intended.direction}`);
    }
    if (previous?.source === 'manual' && (intended.source !== 'manual' || intended.direction !== previous.move)) {
      console.log(`[ActiveGameManager] Staged move changed for ${gameId}:${controlled.id} within turn ${previous.turn}: was manual ${previous.move} → now ${intended.source} ${intended.direction}`);
    }
  }

  // Staged moves drive the arrow render on every client. Three layers per
  // snake, all pure reads of this manager's mirrors of Firebase state:
  //  - `requestedMove`: the last move the user/bot requested (ghost arrow
  //    whenever it differs from the confirmed move — optimistic state).
  //  - `move`: the CONFIRMED staged move from the Firebase read-back (solid
  //    arrow — what the game server will play if the turn ends now). Null
  //    until the first confirmation for the turn lands.
  //  - `committed`: true once Firebase finalized the turn's move (deadline
  //    passed or all players committed) — the double arrow; `move` then
  //    carries the final selection.
  // Color/source are derived from the requested record's source: heuristic =
  // grey/'bot' (bot-seeded), any human method (manual/queue/waypoint) = the
  // commanding operator's color (which survives deselects), falling back to
  // the selecting user's.
  //
  // Every controlled snake gets an entry, gated only on having a `staged`
  // record. The client only draws arrows for snakes present on the board, so
  // eliminated snakes are naturally skipped there.
  //
  // Shared by the live WebSocket broadcast and the per-turn command-state
  // snapshot, so live play and the history replay render from the same data.
  getStagedMovesForGame(gameId: string): { [snakeId: string]: StagedMoveView } {
    const game = this.games.get(gameId);
    if (!game) return {};

    const BOT_COLOR = '#888888';
    const staged: { [snakeId: string]: StagedMoveView } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (!cs.staged) continue;
      const requested = cs.staged;
      const userColor =
        cs.intentBy?.color ||
        (cs.selectedBy ? game.connectedUsers.get(cs.selectedBy)?.color : undefined) ||
        '#4CAF50';
      // Colour/source reflect the TRUE origin of the requested move, NOT the
      // nominal activeIntentMode. A waypoint/queue that fell back to the bot's
      // move this turn has source 'bot'/'fallback' and renders grey — so a
      // user-coloured arrow always guarantees the user's own requested move.
      const isBot = requested.source === 'bot' || requested.source === 'fallback';
      const color = isBot ? BOT_COLOR : userColor;
      // `fatal` flags a certain-death requested move so the client can warn
      // the human; it NEVER changes what is staged.
      const fatal = this.isStagedMoveFatal(gameId, snakeId);
      const confirmed = cs.confirmedStaged?.turn === requested.turn ? cs.confirmedStaged.move : null;
      const final = cs.finalMove?.turn === requested.turn ? cs.finalMove.move : null;
      staged[snakeId] = {
        move: final ?? confirmed,
        requestedMove: requested.move,
        committed: final !== null,
        color,
        source: requested.source,
        fatal,
        // Recorded at bind time (never recomputed here — this projection also
        // runs after the board advanced, where origin/orientation may no longer
        // match the staged turn).
        rotation: requested.action?.kind === 'rotate' ? requested.action.orientation : null,
      };
    }
    return staged;
  }

  // The command-state snapshot for a game, in exactly the live broadcast
  // shape (see CommandTurnState). Persisted per turn by applyResolvedMoves.
  getCommandStateForGame(gameId: string): CommandTurnState | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const stagedMoves = this.getStagedMovesForGame(gameId);
    const operators: { [snakeId: string]: OperatorRef | null } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      // A snake dead since an earlier turn keeps its last staged record; it is
      // not part of THIS turn's command state, so drop the stale entry.
      if (cs.staged && cs.staged.turn !== game.boardStateTurn) {
        delete stagedMoves[snakeId];
      }
      operators[snakeId] = cs.intentBy;
    }

    return {
      stagedMoves,
      waypoints: this.getWaypointsForGame(gameId),
      routes: this.getRoutesForGame(gameId),
      activeIntentModes: this.getActiveIntentModesForGame(gameId),
      owners: this.getOwnersForGame(gameId),
      operators,
    };
  }

  getActiveIntentModesForGame(gameId: string): { [snakeId: string]: IntentMode } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: IntentMode } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      result[snakeId] = cs.intent.kind;
    }
    return result;
  }

  // Client projection: the predicted trajectory per snake. `firstLeg` is how
  // many leading cells are the committed-this-turn leg (head → targets[0]);
  // the client renders the remainder faded because it is a prediction.
  getRoutesForGame(gameId: string): { [snakeId: string]: RouteView } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: RouteView } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'goto' && cs.gotoRoute.length > 0) {
        const view: RouteView = { cells: cs.gotoRoute, firstLeg: cs.gotoRouteFirstLeg };
        // Only a plan that actually turns carries the array — see RouteView.
        if (cs.gotoRouteRotations.some(r => r !== null)) view.rotations = cs.gotoRouteRotations;
        result[snakeId] = view;
      }
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Move-source priority for a controlled snake. The intent union holds exactly
  // one source at a time; computeIntendedMove resolves it to a single direction
  // and stageMove binds that into `staged`:
  //   1. Manual user selection         — setUserSelection (sets a single-turn
  //                                      {kind:'manual'} intent, structurally
  //                                      superseding any goto/near target; this
  //                                      is the "manual override drops the plan"
  //                                      contract)
  //   2. Waypoint-biased move          — getWaypointBiasedMove: the heuristic
  //                                      matrix re-scored with the CURRENT
  //                                      goto/near target's progress weight,
  //                                      applied identically to selected AND
  //                                      unselected snakes.
  //   3. Bot recommendation            — the heuristic default
  //   4. Hard fallback                 — literal 'up' if nothing else available
  //
  // Every staging action write-through publishes to Firebase (see stageMove);
  // the game server resolves each turn with the last staged move it received
  // before the turn deadline. There is no commit step on this side.
  //
  // Ownership of the goto queue: server-only mutations are done in
  // `setWaypoint` (in response to client `set-waypoint`), `setUserSelection`
  // (clear on 'manual' override), and the arrival check in `updateBoard`
  // (shift on arrival). Clients never advance the queue themselves; they
  // render the broadcast snapshot.
  // ────────────────────────────────────────────────────────────────────────
  // Promote a decision's board-wide Voronoi grids to the game, newest turn
  // wins. Interim recommendations and the quick staging pass carry EMPTY
  // grids; those are not a partition and must never blank out a real one, so
  // each half is written only when this decision actually carries it — a
  // same-turn decision that computed only one of the two keeps the other.
  private recordBoardTerritory(game: ActiveGame, turnData: TurnData): void {
    const cells = turnData.territoryCells;
    const hasCells = !!cells && Object.keys(cells).length > 0;
    if (!hasCells && !turnData.cellOwnership) return;
    const turn = turnData.gameState.turn;
    const prev = game.boardTerritory;
    if (prev && prev.turn > turn) return;
    const sameTurn = prev && prev.turn === turn ? prev : null;
    game.boardTerritory = {
      turn,
      territoryCells: hasCells ? cells : (sameTurn?.territoryCells ?? {}),
      cellOwnership: turnData.cellOwnership ?? sameTurn?.cellOwnership ?? null,
    };
  }

  // The board-wide Voronoi partition for this game's most recent computed
  // turn, or null. Unit-agnostic by construction — the caller passes no unit.
  getBoardTerritory(gameId: string): BoardTerritory | null {
    return this.games.get(gameId)?.boardTerritory ?? null;
  }

  /**
   * The bot's move for one unit, with the turn data behind it.
   *
   * `move` is a CentaurMove: a Direction for a snake, a FULL-BOARD destination
   * index for a chess piece. The union is the whole of the pieces bot route on
   * this entry point — every Direction-only caller is unchanged, and the shape
   * check below refuses a mismatched pairing the way `setUserSelection` does,
   * as defence in depth rather than as a silent coercion.
   *
   * What this method does NOT change is precedence: it writes
   * `botRecommendation` and re-stages, and staging resolves manual > waypoint >
   * bot exactly as before. A bot recommendation can never displace a human's.
   */
  setBotRecommendation(gameId: string, snakeId: string, move: CentaurMove, turnData: TurnData): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    if (this.isPieceUnit(controlled)) {
      if (typeof move !== 'number') {
        console.log(`[ActiveGameManager] Ignoring bot direction ${move} for piece ${gameId}:${snakeId} — pieces are recommended by destination`);
        return;
      }
    } else if (typeof move !== 'string') {
      console.log(`[ActiveGameManager] Ignoring numeric bot move ${move} for snake ${gameId}:${snakeId} — snakes are recommended by direction`);
      return;
    }

    const incomingTurn = turnData.gameState.turn;
    // Early-resolution race guard: a turn can resolve before its deadline
    // (every snake committed), so a decision computed for the PREVIOUS board
    // can land here after the game has advanced. Staging it would bind a
    // stale move to the new turn — drop it instead; the new turn's own fast
    // and full passes supply its moves.
    if (incomingTurn < game.boardStateTurn) {
      console.log(
        `[ActiveGameManager] Dropping stale bot recommendation for ${gameId}:${snakeId} ` +
        `(computed for turn ${incomingTurn}, board is at turn ${game.boardStateTurn})`
      );
      return;
    }
    game.lastActivityAt = Date.now();
    game.gameTimeout = turnData.gameState.game.timeout || game.gameTimeout;
    game.currentTurn = Math.max(game.currentTurn, incomingTurn);

    let boardUpdated = false;
    if (incomingTurn > game.boardStateTurn) {
      // Defensive only: the canonical pipeline advances the board via
      // updateBoard BEFORE any per-snake turn data lands, so this path firing
      // means a transport fed decisions without feeding the board first. Keep
      // the old advance behavior so the game stays live, but flag it.
      console.warn(
        `[ActiveGameManager] setBotRecommendation advanced the board for ${gameId} ` +
        `(turn ${game.boardStateTurn} -> ${incomingTurn}) — updateBoard should have run first`,
      );
      game.boardState = turnData.gameState;
      game.boardStateTurn = incomingTurn;

      for (const snake of turnData.gameState.board.snakes) {
        if (!game.snakes.has(snake.id)) {
          game.snakes.set(snake.id, {
            id: snake.id,
            name: snake.name,
            letter: snake.letter || '',
          });
        }
      }

      boardUpdated = true;
    } else if (incomingTurn === game.boardStateTurn) {
      const existingSnakeCount = game.boardState?.board.snakes.length || 0;
      const incomingSnakeCount = turnData.gameState.board.snakes.length;
      if (existingSnakeCount !== incomingSnakeCount) {
        console.log(`[ActiveGameManager] Consistency check: board snake count mismatch on turn ${incomingTurn}: existing=${existingSnakeCount} incoming=${incomingSnakeCount} (snake=${snakeId})`);
      }
    }

    // A piece's turn data is its scored candidate list, not a snake decision's
    // move matrix — the UI reads the same TurnData shape for both, so a
    // recommendation arriving for a piece rebuilds the candidate rows here the
    // way updatePieceTurn does rather than publishing whatever the caller had.
    controlled.latestTurnData = this.isPieceUnit(controlled)
      ? {
          ...turnData,
          moveEvaluations: this.computePieceMoveEvaluations(gameId, snakeId),
          safeMoves: [],
          botRecommendation: move,
        }
      : turnData;
    controlled.botRecommendation = move;
    // Lift the board-wide Voronoi grids off this snake's decision onto the
    // GAME, where every unit's views can read them.
    this.recordBoardTerritory(game, turnData);
    // The green goto route is NOT refreshed here: it is derived from the move
    // that will actually commit, so it is recomputed inside stageMove once
    // `staged` is final (the re-stage below). Recomputing it now — before
    // `staged` is cleared and re-derived — would anchor the drawn path on the
    // previous turn's staged move.

    // Re-stage ONLY this snake on its OWN turn-data update, never the others
    // when the board advances: each controlled snake gets its own
    // setBotRecommendation call per turn, and re-staging it there keeps every
    // snake's staged record bound to its own decision. computeIntendedMove
    // keeps manual > queue > waypoint > bot precedence, so a same-turn manual
    // selection stays authoritative.
    //
    // Manual is single-turn: the staged record carries the turn the manual
    // selection was made for. If that turn is behind the current board turn the
    // selection is stale (it was for a prior turn) and reverts to the heuristic;
    // a manual selection made for THIS turn (staged turn == board turn, e.g. the
    // bot-compute-window race) stays authoritative and is re-derived below.
    const prevStagedTurn = controlled.staged?.turn ?? null;
    controlled.staged = null;
    if (controlled.intent.kind === 'manual' && prevStagedTurn !== game.boardStateTurn) {
      this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
    } else {
      this.stageMove(gameId, snakeId);
    }

    // Armed suicide: the kill was requested before this snake had turn data.
    // Stage the suicide move now (with consent, the second fatal-consent mint
    // point); the write-through publishes it to Firebase where it becomes the
    // staged move the server resolves at the deadline.
    if (controlled.suicideArmed) {
      const suicideMove = computeSuicideMove(turnData.gameState);
      console.log(`[ActiveGameManager] SUICIDE: staging ${suicideMove} for ${gameId}:${snakeId} (turn ${incomingTurn})`);
      controlled.suicideArmed = false;
      const armedBy = controlled.suicideArmedBy;
      controlled.suicideArmedBy = null;
      this.setIntent(gameId, snakeId, { kind: 'manual', move: suicideMove, fatalConsent: mintFatalMoveConsent() }, armedBy);
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, turnData.gameState);
    }
    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  // Stage a user's manual selection as the snake's next move. This is the
  // "manual override drops the plan" contract: it replaces the intent with a
  // single-turn manual intent (structurally superseding any queue/waypoint) and
  // re-stages the move via setIntent, which write-through publishes it to
  // Firebase. The game server finalizes the turn from the last staged move at
  // its deadline.
  setUserSelection(gameId: string, snakeId: string, move: CentaurMove): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    // The move's shape must match the unit's kind: snakes stage Directions,
    // pieces stage numeric FULL-BOARD destination indices (the generalized
    // candidate UI sends the candidate's own id). Mismatches are refused as
    // defense in depth — the client never offers them.
    if (this.isPieceUnit(controlled)) {
      if (typeof move !== 'number') {
        console.log(`[ActiveGameManager] Ignoring manual direction ${move} for piece ${gameId}:${snakeId} — pieces are commanded by destination`);
        return;
      }
      const board = game.boardState?.board;
      const fullSquares = board ? (board.width + 2) * (board.height + 2) : 0;
      if (!Number.isInteger(move) || move < 0 || move >= fullSquares) {
        console.log(`[ActiveGameManager] Ignoring out-of-bounds manual destination ${move} for piece ${gameId}:${snakeId}`);
        return;
      }
    } else if (typeof move !== 'string') {
      console.log(`[ActiveGameManager] Ignoring numeric manual move ${move} for snake ${gameId}:${snakeId} — snakes stage directions`);
      return;
    }

    // Only the selecting user can reach this path (validated by the WS layer),
    // so the command attributes to them.
    const operator = this.operatorFor(game, controlled.selectedBy);
    this.logCommandEvent(gameId, snakeId, 'manual-move', operator, { move });
    this.setIntent(gameId, snakeId, { kind: 'manual', move }, operator);
    console.log(`[ActiveGameManager] User staged move for ${gameId}:${snakeId}: ${move} (intent: ${controlled.intent.kind}, turn ${game.currentTurn})`);
  }

  // The dialog-accept entry point — the FIRST fatal-consent mint point. Called
  // by the WS layer when the controlling user confirmed the fatal-move dialog.
  // The client message carries only the claim; fatality is RE-validated here,
  // server-side, before consent is minted, and the consented manual intent is
  // set through the normal single-writer path (setIntent → stageMove), whose
  // write-through publishes the consented move to Firebase. A confirmation
  // arriving after the turn resolved server-side simply stages for the current
  // turn (the stale one is ignored by the game server). Returns whether the
  // move was staged.
  confirmFatalMove(gameId: string, snakeId: string, move: Direction, userId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;
    // The fatal-move dialog never fires for pieces (no direction staging).
    if (this.isPieceUnit(controlled)) return false;
    const stillFatal = this.isMoveFatal(gameId, snakeId, move);
    const consent = stillFatal ? mintFatalMoveConsent() : undefined;
    console.log(`[ActiveGameManager] User CONFIRMED ${stillFatal ? 'fatal' : 'no-longer-fatal'} move ${move} for ${gameId}:${snakeId} — staging with${consent ? '' : 'out'} consent`);
    const operator = this.operatorFor(game, userId);
    this.logCommandEvent(gameId, snakeId, 'fatal-move-confirmed', operator, { move, stillFatal });
    this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: consent }, operator);
    return true;
  }

  // Feed the CANONICAL board state for a turn — called exactly once per turn
  // (idempotent for re-delivery of the same turn). Replaces the HTTP-era
  // per-snake updateGameState fan-out: per-snake bookkeeping (name refresh,
  // consistency check, goto arrival) iterates the controlled snakes against
  // the one shared board.
  //
  // Ordering contract (preserved from the per-snake era): the goto-arrival
  // checks run BEFORE boardState/boardStateTurn advance, so an arrival-driven
  // re-stage still binds to the OLD turn (the fast/full decision passes then
  // re-stage for the new turn). The board-update broadcast fires once, after
  // the advance.
  updateBoard(gameId: string, canonical: BoardSnapshot): void {
    const game = this.games.get(gameId);
    if (!game) return;

    game.gameTimeout = canonical.game.timeout || game.gameTimeout;
    game.lastActivityAt = Date.now();

    for (const snake of canonical.board.snakes) {
      if (!game.snakes.has(snake.id)) {
        game.snakes.set(snake.id, {
          id: snake.id,
          name: snake.name,
          letter: snake.letter || '',
        });
      }
    }

    for (const [snakeId, controlled] of game.controlledSnakes) {
      const ourSnake = canonical.board.snakes.find(s => s.id === snakeId);
      if (ourSnake) {
        controlled.name = ourSnake.name || controlled.name;
        controlled.letter = ourSnake.letter || controlled.letter;
        // Keep the unit kind fresh: pawn promotion changes pawn → queen mid-game.
        controlled.unitType = ourSnake.unitType ?? controlled.unitType;
      }
      // A dead unit's command dies with it — checked BEFORE arrival, since a
      // unit that is gone can neither arrive nor be commanded further.
      if (this.clearCommandOnDeath(gameId, snakeId, controlled, ourSnake)) continue;
      this.checkGotoArrival(gameId, snakeId, controlled, ourSnake);
    }

    const incomingTurn = canonical.turn ?? 0;
    if (incomingTurn > game.boardStateTurn) {
      game.boardState = canonical;
      game.boardStateTurn = incomingTurn;
      game.currentTurn = Math.max(game.currentTurn, incomingTurn);
      this.notifyBoardUpdate(gameId, canonical);
    }
  }

  // THE death hook of the command lifecycle. A unit that is gone from the
  // canonical board — captured, starved, eliminated — no longer holds a plan,
  // so its intent reverts to heuristic and its derived route is wiped. Returns
  // true when the unit is dead, so the caller skips every live-unit step.
  //
  // This is what keeps the display honest: every client-facing projection
  // (waypoints, routes, activeIntentModes) is DERIVED from the intent, so
  // clearing it here clears the queue's numbered target badges and the green
  // route in one move rather than each renderer needing its own liveness test.
  //
  // Deliberately NOT routed through `setIntent`: that re-stages a move, and a
  // dead unit must never publish one. The state is written directly and the
  // change is announced so every viewer's overlay drops with it.
  private clearCommandOnDeath(
    gameId: string,
    snakeId: string,
    controlled: ControlledSnake,
    ourSnake: { health?: number } | undefined,
  ): boolean {
    if (ourSnake && (ourSnake.health ?? 1) > 0) return false;
    const had = controlled.intent.kind !== 'heuristic' || controlled.gotoRoute.length > 0;
    if (!had) return true;
    console.log(`[ActiveGameManager] ${gameId}:${snakeId} is gone — clearing its ${controlled.intent.kind} command and route`);
    this.logCommandEvent(gameId, snakeId, 'command-cleared-on-death', null, {
      cleared: controlled.intent.kind,
    });
    controlled.intent = { kind: 'heuristic' };
    controlled.intentBy = null;
    ActiveGameManager.clearGotoRoute(controlled);
    this.notifyStagedChange(gameId);
    return true;
  }

  // Arrival SHIFTS the goto queue: reaching targets[0] promotes the next
  // target, and only an emptied queue reverts to the heuristic. Check both
  // the current head and body[1] so a snake that already advanced past the
  // target by the time this fires still registers the arrival.
  // (Near is single-target and deliberately never auto-clears — "stay close"
  // has no arrival condition.)
  private checkGotoArrival(
    gameId: string,
    snakeId: string,
    controlled: ControlledSnake,
    ourSnake: { head?: Coord; body?: Coord[] } | undefined,
  ): void {
    if (controlled.intent.kind === 'goto' && controlled.intent.targets.length > 0) {
      const wp = controlled.intent.targets[0];
      const head = ourSnake?.head;
      const body = ourSnake?.body || [];
      const headHit = !!head && head.x === wp.x && head.y === wp.y;
      // body[0] === head; body[1] is where the head was last turn. If the
      // snake stepped onto the target last turn and is now stepping off,
      // body[1] catches that case. Pieces are 1-cell units with no trailing
      // body, so ONLY the head comparison applies to them (their body[1], if
      // it ever existed, would just be a stack copy of the same square).
      const justSteppedThrough =
        !this.isPieceUnit(controlled) &&
        body.length > 1 && body[1].x === wp.x && body[1].y === wp.y;
      if (headHit || justSteppedThrough) {
        const remaining = controlled.intent.targets.slice(1);
        console.log(`[ActiveGameManager] Goto target reached for ${gameId}:${snakeId} (head=${head?.x},${head?.y} target=${wp.x},${wp.y} reason=${headHit ? 'head' : 'body[1]'}) — ${remaining.length} target(s) remaining`);
        // System event (no operator): the queue shifting on arrival is a
        // consequence of the standing goto command, not a new command.
        this.logCommandEvent(gameId, snakeId, 'goto-target-reached', null, {
          target: { x: wp.x, y: wp.y },
          targets: remaining,
        });
        this.setIntent(
          gameId,
          snakeId,
          remaining.length > 0 ? { kind: 'goto', targets: remaining } : { kind: 'heuristic' },
          // The remaining queue continues the SAME command — attribution is
          // preserved so replays keep crediting the commanding operator.
          remaining.length > 0 ? controlled.intentBy : null
        );
      }
    }
  }

  // Called by the transport when a turn has RESOLVED server-side (the next
  // turn's board arrived), with the moves the game server actually applied for
  // our controlled snakes on `resolvedTurn`. Must run BEFORE the new turn's
  // board state is fed in, so the bookkeeping measures from the old head.
  //
  // This replaces the old HTTP commit step for bookkeeping only — nothing is
  // submitted here. The server already resolved the turn from the last staged
  // move it received; we record what happened (decision log) and notify the UI.
  // The goto queue is NOT advanced here: arrival is detected from the board
  // itself in `updateBoard`, which is authoritative about where the snake
  // actually ended up.
  //
  // SNAKES ONLY: the transport never includes chess pieces in `moves` (their
  // applied move is positional; deriveLastMoves skips them), so death markers
  // and decision-log rows stay snake-only by construction.
  applyResolvedMoves(gameId: string, resolvedTurn: number, moves: { [snakeId: string]: Direction }): void {
    const game = this.games.get(gameId);
    if (!game) return;

    // Snapshot every snake's command state AS IT STOOD WHEN THIS TURN ENDED.
    // We run before the new board is fed in, so goto queues are un-shifted,
    // staged records still bind to resolvedTurn, and operator attribution is
    // exactly what was in force at the deadline. The history viewer replays
    // this snapshot through the same render paths the live client uses.
    if (game.boardStateTurn === resolvedTurn) {
      const state = this.getCommandStateForGame(gameId);
      if (state) {
        CommandLogger.getInstance().logTurnState(gameId, resolvedTurn, state);
      }
    }

    for (const [snakeId, move] of Object.entries(moves)) {
      const controlled = game.controlledSnakes.get(snakeId);
      if (!controlled) continue;

      // Persist the move the server applied onto this turn's decision row.
      // The move resolved board turn `resolvedTurn`, whose decision was logged
      // with decision_logs.turn = resolvedTurn + 1 (the logger records the turn
      // the move executes INTO), so that +1 is the update key. The consent flag
      // counts only when the staged record is bound to this exact turn and the
      // applied move matches it (otherwise it's a bot/fallback move).
      const staged = controlled.staged;
      const fatalConsented = !!staged && staged.snakeId === snakeId &&
        staged.turn === resolvedTurn && staged.move === move && staged.fatalConsented;
      DecisionLogger.getInstance().recordSubmittedMove(gameId, snakeId, resolvedTurn + 1, move, fatalConsented);

      // No move-committed notification here: the UI's double arrow is driven
      // by finalizeTurnMove, which fires when Firebase finalizes the turn —
      // earlier than this board-delta bookkeeping.
    }
  }

  // Emit a single, greppable "fully idle" line once the manager holds zero
  // active games and zero connected users. This is the signal the operator
  // watches for in deployment logs before expecting the instance to scale to
  // zero (the unref'd timers no longer keep the event loop alive at that point).
  private logIfFullyIdle(): void {
    if (this.games.size > 0) return;
    let totalUsers = 0;
    for (const game of this.games.values()) {
      totalUsers += game.connectedUsers.size;
    }
    if (totalUsers > 0) return;
    console.log('[ActiveGameManager] Manager is now fully idle (no active games, no connected users) — instance can scale to zero');
  }

  shutdown(): void {
    if (this.staleGameCleanupInterval) {
      this.staleGameCleanupInterval.clear();
      this.staleGameCleanupInterval = null;
    }
  }

  // Scope 'while-active': eviction only matters for games that stopped
  // progressing while the instance is up — and every idle-entry path already
  // leaves such games unable to keep the instance awake (hasProgressingGame
  // ignores them long before eviction). Games still in memory at idle entry
  // (mid-game suspend at the human-attention cap) just wait; the first sweep
  // after a wake evicts them.
  startStaleGameCleanup(intervalMs: number = 300000, maxIdleMs: number = 600000): void {
    if (this.staleGameCleanupInterval) return;
    this.staleGameCleanupInterval = ActivityController.getInstance().managedInterval('stale-game-cleanup', () => {
      const now = Date.now();
      let removedAny = false;
      for (const [gameId, game] of this.games) {
        const idleTime = now - game.lastActivityAt;
        if (idleTime > maxIdleMs) {
          console.log(`[ActiveGameManager] Cleaning up stale game: ${gameId} (idle: ${Math.round(idleTime / 1000)}s)`);
          for (const [snakeId] of game.controlledSnakes) {
            this.notifyGameListChange('removed', gameId, snakeId);
          }
          this.games.delete(gameId);
          this.enableTeamStaging(gameId, false);
          this.logIfFullyIdle();
          removedAny = true;
        }
      }
      if (removedAny) ActivityController.getInstance().poke();
    }, intervalMs, { scope: 'while-active' });
    console.log(`[ActiveGameManager] Stale-game cleanup interval started (every ${Math.round(intervalMs / 1000)}s, maxIdle ${Math.round(maxIdleMs / 1000)}s, unref'd)`);
  }
}

function computeSuicideMove(gameState: GameState): Direction {
  const you = gameState.you;
  const head = you.body[0];
  const neck = you.body[1];
  if (neck && (neck.x !== head.x || neck.y !== head.y)) {
    if (neck.x < head.x) return "left";
    if (neck.x > head.x) return "right";
    if (neck.y < head.y) return "down";
    return "up";
  }
  const w = gameState.board.width;
  const h = gameState.board.height;
  const distLeft = head.x;
  const distRight = w - 1 - head.x;
  const distDown = head.y;
  const distUp = h - 1 - head.y;
  const min = Math.min(distLeft, distRight, distDown, distUp);
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distDown) return "down";
  return "up";
}
