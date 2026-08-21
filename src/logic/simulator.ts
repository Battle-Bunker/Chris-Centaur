import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { isKingUnit, isPieceUnit, tiesStationaryContest, winsStationaryContest } from './piece-threats';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from './piece-moves';
import { TeamDetector } from './team-detector';

// MoveSet type definition (previously from move-enumerator)
export type MoveSet = Map<string, Direction>;

/**
 * The engine's exact health rule for a unit ENTERING `dest` this turn, shared
 * by the Simulator, MoveAnalyzer's health-aware hazard fatality and the
 * staged-move fatality probe so the three can never drift:
 *  - health loss is MOVEMENT-based (no universal per-turn decay): a snake
 *    that moves pays 1 — unless it eats, which restores health to the unit's
 *    configured type max (snake.maxHealth, engine default 100);
 *  - a hazard square deals board.hazardDamage (default 100) on ENTRY, applied
 *    AFTER the eat/step update, so food on a hazard cell restores to max
 *    first and the damage lands on the restored value.
 * Death is health <= 0 — hazards are damage-based, never instant death.
 * Call with the PRE-move snake and a board whose food has not yet been
 * spliced for this move.
 */
export function healthAfterEntering(snake: Snake, board: Board, dest: Coord): number {
  const eats = (board.food ?? []).some(f => f.x === dest.x && f.y === dest.y);
  let health = eats ? (snake.maxHealth ?? 100) : snake.health - 1;
  if ((board.hazards ?? []).some(h => h.x === dest.x && h.y === dest.y)) {
    health -= board.hazardDamage ?? 100;
  }
  return health;
}

/**
 * The invulnerability tier a unit carries into the resolution of THIS turn's
 * moves (the arrival turn, currentTurn + 1). A level governs that resolution
 * only while the arrival turn is still within its server-provided expiry;
 * absent an expiry the level is assumed to apply to the CURRENT turn only, so
 * it does not govern the arrival — the own-capability-conservative fallback
 * BoardGraph's severability uses, applied symmetrically to every unit so the
 * simulator, the passability layer and the path projection below agree on
 * what a move can do.
 */
export function tierAtArrival(unit: Snake, currentTurn: number): number {
  const expiry = unit.invulnerabilityExpiryTurn ?? currentTurn;
  return currentTurn + 1 <= expiry ? (unit.invulnerabilityLevel ?? 0) : 0;
}

/**
 * How a projected traversal ends. `path` is the squares this PROJECTION has
 * the mover enter, truncated at the death or capture-stop it resolved — so a
 * caller must never assume the staged destination was reached. It is close to
 * the engine's Turn.paths but deliberately NOT claimed to equal it: the engine
 * adjudicates an in-flight edge swap before either unit is charged for its
 * destination, so a swap LOSER never crosses the edge and its real path ends
 * one square EARLIER than the square appended here. Nothing reads `path`
 * today; treat it as a debugging trace of the projection, not as the wire
 * record.
 */
export interface ProjectedPath {
  /** Squares actually entered, truncated at a death or a capture-stop. */
  path: Coord[];
  /**
   * Health points the traversal costs. When `fatal`, it is at least the
   * mover's current health, so the projected health lands at zero or below.
   */
  cost: number;
  /** The mover does not survive the traversal (projected health 0). */
  fatal: boolean;
  /** The mover severed a body / killed a piece and stopped there. */
  captureStopped: boolean;
  /** The mover reached the staged destination alive AND it holds food. */
  eats: boolean;
  /** Who this traversal destroys, and what that costs us (see CasualtyContext). */
  casualties: CasualtyContext;
}

/**
 * One unit this traversal destroys or shortens. The engine's contests carry NO
 * friendly exemption — `contestSquare` in chessTurnSim.ts compares tier then
 * weight and never teams — so our own move kills an ally exactly the way it
 * kills an enemy, which is the whole reason this record exists.
 */
export interface ProjectedCasualty {
  /** The victim's unit id. */
  id: string;
  /** The victim's team identity (TeamDetector's one team-identity rule). */
  teamKey: string;
  /** The victim is on OUR team. */
  ally: boolean;
  /**
   * WEIGHT destroyed — the currency team score is denominated in (piece score
   * = stack weight, snake score = body length, so team score is total weight).
   * A killed unit loses all of it; a severed snake loses the segments cut off.
   */
  weight: number;
  /** The victim dies outright, rather than surviving shortened. */
  killed: boolean;
  /** The victim is a king (regicide's trigger). */
  king: boolean;
}

/**
 * What a candidate move DOES to the units on the board, folded into the four
 * per-move stats the scoring layer reads. All plain numbers, so the context
 * survives the structured clone into decision worker threads.
 */
export interface CasualtyContext {
  /** Total weight of OUR OWN units this move destroys (kills + severed segments). */
  allyCasualty: number;
  /**
   * 1 when this move ends OUR team: our last living king dies in it — killed
   * by our own unit, or because the mover IS that king and the traversal is
   * fatal. The engine then removes every remaining unit we own that turn
   * (applyRegicide), so our score goes from its total weight to zero.
   */
  regicide: number;
  /** Number of ENEMY units this move kills outright. */
  kills: number;
  /** 1 when this move ends an ENEMY team by taking its last living king. */
  enemyRegicide: number;
}

const NO_CASUALTIES: CasualtyContext = {
  allyCasualty: 0,
  regicide: 0,
  kills: 0,
  enemyRegicide: 0,
};

/** A fresh zeroed casualty context (never hand out the frozen module copy). */
export function emptyCasualtyContext(): CasualtyContext {
  return { ...NO_CASUALTIES };
}

/**
 * Projected outcome of moving `state.you` along `path` — the ordered list of
 * squares it would ENTER this move, excluding the origin — the single
 * projection shared by the health-loss heuristic (BoardEvaluator, via
 * DecisionEngine's per-move context) and chess-piece candidate scoring
 * (ActiveGameManager.computePieceCandidates): one snake step is a one-cell
 * path, a piece's whole ray/jump is its full traversed path, and a
 * stay/rotate action passes an empty path.
 *
 * A slider genuinely ARRIVES on every square of its ray (the engine advances
 * it one square per sub-step and contests wherever it lands), so every square
 * is adjudicated here in the engine's own within-square order — walls, then
 * the hazard dose, then the occupancy contest:
 *
 *  - WALL / off-board: death on that square.
 *  - HAZARD: board.hazardDamage on ENTRY, mid-flight squares included. Only
 *    hazard damage is charged DURING flight (the engine settles movement cost
 *    in the food phase afterwards), so a mover dies mid-path exactly when the
 *    hazard doses so far exhaust its health — and the traversal stops there
 *    rather than accruing further doses.
 *  - A SNAKE BODY SEGMENT is an absolute wall, with NO friendly exemption:
 *    the engine compares tiers and weights and never teams, so an ally's body
 *    kills exactly like an enemy's. Equal-or-lower tier than the owner ⇒
 *    death on that square; strictly higher ⇒ the mover severs the body and
 *    CAPTURE-STOPS there (a piece's move ends early — it never reaches the
 *    staged destination). A MULTI-CELL snake's index-0 (pre-move head) square
 *    is a sever too, not a kill: by the time the mover arrives that square
 *    holds post-move index 1, so the cut leaves the owner alive as a single
 *    segment, minus length - 1. Only a LENGTH-1 owner — which leaves nothing
 *    behind — dies there outright.
 *  - A STATIONARY PIECE's square is the same tier-then-weight contest
 *    (`winsStationaryContest`, the one shared encoding): winning kills the
 *    piece and capture-stops the mover, LOSING is death, and TYING is mutual
 *    destruction — the mover dies AND takes the piece with it, which is a
 *    trade the casualty ledger records rather than a bare suicide.
 *  - The mover's OWN body is a wall with no tier exemption (a snake cannot
 *    sever itself).
 *
 * Every outcome in which somebody ELSE dies or is cut short is recorded as a
 * casualty, on the same no-friendly-exemption terms: the contest that wins us
 * a square is the contest that kills whoever stood there, ally or enemy. The
 * folded `casualties` context carries the weight we destroy on our own side,
 * the enemies we kill, and — the catastrophic case — whether the king that
 * dies is the LAST king of a team, which the engine's regicide rule turns
 * into that whole team's elimination.
 *
 * Movement costs 1 per square ACTUALLY entered — UNLESS the mover reaches the
 * staged destination alive and it holds food, which SETS health to the type
 * max and so cancels the whole bill: the movement cost the engine never
 * charged AND the mid-flight hazard doses it already deducted (the food phase
 * assigns the max rather than adding to the running health — mirrors
 * healthAfterEntering). A death or a capture-stop credits NO meal: the engine
 * removes a dead mover before the food phase, and a truncated slider never
 * gets to the far end — so a mover that hazard doses kill mid-flight is fatal
 * even when its staged destination holds food it will never reach.
 *
 * SIMULTANEITY — what this projection deliberately cannot see. The engine
 * resolves every snake's whole move in sub-step 1, so a slider contests each
 * snake's POST-move body. From the pre-move board the client can see exactly
 * one square of that shift: the tail always vacates (the engine pops it before
 * any collision, eating or not — a stacked tail's duplicate at the
 * second-to-last index still blocks, so skipping only the last index is
 * exact). Every other current segment — index 0 included, because the pre-move
 * head becomes a body segment once the snake steps forward — is treated as
 * still occupied, and the square a snake's head moves INTO is not modelled at
 * all (that is the unit threat map's job). Both choices are conservative in
 * the same direction: we may call a traversal fatal that the real
 * simultaneous resolution would have let through, and we never bank on a body
 * clearing out of our way.
 *
 * Other units' PIECES are modelled as FROZEN on the squares they occupy now:
 * the projection never gives them a move, so a piece that is in flight during
 * the same turn is invisible to it. Two consequences follow. An in-flight EDGE
 * SWAP — the enemy piece stepping onto our origin as we step onto its square —
 * is never seen as a swap, and neither is the meal a unit takes on a square we
 * are contesting. Both are verdict-equivalent for us: the engine adjudicates a
 * swapped edge with the SAME tier-then-weight rule as a shared square
 * (`contestSquare`, called from the edge-swap pass), so who lives and who dies
 * is what this projection already computes — only the square a loser dies on
 * differs (its own start square rather than the contested one), which is the
 * `path` caveat above and nothing scoring reads.
 *
 * Call with a board whose food/hazards have not yet been spliced for this
 * move.
 */
export function projectPath(state: GameState, path: Coord[]): ProjectedPath {
  const board = state.board;
  const mover = state.you;
  const health = mover.health;
  if (path.length === 0) {
    return {
      path: [],
      cost: 0,
      fatal: false,
      captureStopped: false,
      eats: false,
      casualties: emptyCasualtyContext(),
    };
  }

  const hazardDamage = board.hazardDamage ?? 100;
  const hazards = board.hazards ?? [];
  const moverTier = tierAtArrival(mover, state.turn);
  const moverIsPiece = isPieceUnit(mover);

  const entered: Coord[] = [];
  const victims: ProjectedCasualty[] = [];
  let hazardAccrued = 0;
  let died = false;
  let captureStopped = false;

  for (const sq of path) {
    // The killing/stopping square is always part of the traversal: the engine
    // records a dead mover's path as ending ON the square it died on.
    entered.push(sq);

    // 1. Walls / off the board.
    if (sq.x < 0 || sq.x >= board.width || sq.y < 0 || sq.y >= board.height) {
      died = true;
      break;
    }

    // 2. Hazard dose on entry — the only cost charged DURING flight.
    if (hazards.some(h => h.x === sq.x && h.y === sq.y)) {
      hazardAccrued += hazardDamage;
      if (health - hazardAccrued <= 0) {
        died = true;
        break;
      }
    }

    // 3. Occupancy: bodies and stationary pieces.
    const outcome = resolveTraversedSquare(board, mover, moverTier, state.turn, sq);
    if (outcome.verdict === 'death') {
      // A death can still be a TRADE: a tied stationary contest kills the unit
      // we tied with as well as us, so its victim is recorded exactly like a
      // won contest's. Without this the mutual-destruction case folds to zero
      // casualties and scores as pure suicide.
      if (outcome.victim) victims.push(outcome.victim);
      died = true;
      break;
    }
    if (outcome.verdict === 'sever') {
      // Winning the square is what destroys whoever held it — record the
      // victim before deciding whether we stop on their square.
      if (outcome.victim) victims.push(outcome.victim);
      // Only a PIECE capture-stops; a snake severs through and keeps its
      // (single-square) move.
      if (moverIsPiece) {
        captureStopped = true;
        break;
      }
    }
  }

  const reachedDestination = !died && !captureStopped;
  const dest = entered[entered.length - 1];
  const eats =
    reachedDestination && (board.food ?? []).some(f => f.x === dest.x && f.y === dest.y);
  // Reaching food alive wipes the WHOLE bill, not just the movement term: the
  // engine's food phase SETS health to the unit's type max
  // (TeamSnekProcessor.processFoodAndHealth), which restores the mid-flight
  // hazard doses the sub-step sim already deducted along with the movement
  // cost it never charged. Verified: 100 health through two 20-damage hazards
  // onto food lands at 100, not 60.
  let cost = eats ? 0 : entered.length + hazardAccrued;
  // Fatality is one condition: the projected health lands at or below zero,
  // whether from a wall/body/contest death mid-path or from the cost simply
  // outrunning the mover's health. Either way the projection reports a cost
  // that ZEROES the health, which is what makes the health-loss heuristic
  // sensitive to it.
  const fatal = died || cost >= health;
  if (fatal) cost = Math.max(cost, health);

  return {
    path: entered,
    cost,
    fatal,
    captureStopped,
    eats,
    casualties: foldCasualties(board, mover, victims, fatal),
  };
}

/**
 * The per-victim records folded into the four per-move stats, plus the one
 * question no single victim can answer on its own: does anybody's team END
 * here? The engine's applyRegicide (TeamSnekProcessor) eliminates a team
 * CONFIGURED with kings the moment its LAST king dies, deleting every unit it
 * still owns that turn.
 *
 * The client can decide that from the live board alone, with no roster: a king
 * only ever enters play from the game setup (pawns promote to queens, never to
 * kings), and a team configured with kings cannot still be playing with none
 * alive — the rule would already have eliminated it. So "this team is subject
 * to regicide" is exactly "this team has a living king", and "this is its
 * last" is exactly "we are killing every living king it has". A team with no
 * living king is a team without kings, and no regicide term can ever fire for
 * it.
 *
 * The mover itself counts: if OUR last king is the unit making this move and
 * the traversal is fatal, the team dies just as surely as if an ally had
 * taken it — the same catastrophe, one move earlier in the causal chain.
 */
function foldCasualties(
  board: Board,
  mover: Snake,
  victims: ProjectedCasualty[],
  moverDies: boolean
): CasualtyContext {
  const moverIsDoomedKing = moverDies && isKingUnit(mover);
  if (victims.length === 0 && !moverIsDoomedKing) return emptyCasualtyContext();

  const ourKey = TeamDetector.getTeamKey(mover);
  const out = emptyCasualtyContext();

  // Kings we take off each team, keyed by that team.
  const kingsTakenByTeam = new Map<string, number>();
  const takeKing = (teamKey: string): void => {
    kingsTakenByTeam.set(teamKey, (kingsTakenByTeam.get(teamKey) ?? 0) + 1);
  };

  for (const victim of victims) {
    if (victim.ally) out.allyCasualty += victim.weight;
    else if (victim.killed) out.kills += 1;
    if (victim.king && victim.killed) takeKing(victim.teamKey);
  }
  if (moverIsDoomedKing) takeKing(ourKey);

  if (kingsTakenByTeam.size > 0) {
    // Living kings per affected team, counted once over the board.
    const livingKingsByTeam = new Map<string, number>();
    for (const unit of board.snakes) {
      if (unit.health <= 0 || !isKingUnit(unit)) continue;
      const key = TeamDetector.getTeamKey(unit);
      if (!kingsTakenByTeam.has(key)) continue;
      livingKingsByTeam.set(key, (livingKingsByTeam.get(key) ?? 0) + 1);
    }
    for (const [teamKey, taken] of kingsTakenByTeam) {
      const living = livingKingsByTeam.get(teamKey) ?? 0;
      // Conservative when the board cannot see the king we are killing (a
      // victim absent from board.snakes cannot happen today, but `living` is
      // the only guard): taking at least as many kings as are alive ends them.
      if (living === 0 || taken < living) continue;
      if (teamKey === ourKey) out.regicide = 1;
      else out.enemyRegicide = 1;
    }
  }

  return out;
}

/**
 * The occupancy verdict for one traversed square, in the engine's order:
 * 'continue' (nothing there, or the segment has already vacated), 'sever'
 * (the mover strictly out-tiers the owner — a piece capture-stops here) or
 * 'death'. Bodies are compared with NO team check, exactly like the engine.
 *
 * A verdict names its VICTIM whenever winning-or-tying the square destroys
 * whoever held it — the two are the same event:
 *  - 'sever': a piece contest we WIN removes that piece and all its weight,
 *    and a body segment we out-tier is cut there, so the owner survives minus
 *    everything behind the cut.
 *  - 'death' WITH a victim: a stationary-piece contest we TIE. The engine's
 *    `contestSquare` kills every unit at the top tier when the heaviest weight
 *    there is not unique, so a tie is mutual destruction — we die AND so does
 *    the piece. Losing outright is 'death' with no victim (the bare DEATH
 *    constant), which is the whole reason the two are distinguished here.
 * That is the one place an ally casualty can be learned, and it is learned
 * from the contest itself rather than a second, forkable copy of the rule.
 */
interface SquareOutcome {
  verdict: 'continue' | 'sever' | 'death';
  /**
   * Whoever we destroyed or cut, and by how much. Present on 'sever', and on
   * the MUTUAL-DESTRUCTION flavour of 'death' (a tied contest), never on a
   * plain loss.
   */
  victim?: ProjectedCasualty;
}

const CONTINUE: SquareOutcome = { verdict: 'continue' };
const DEATH: SquareOutcome = { verdict: 'death' };

function resolveTraversedSquare(
  board: Board,
  mover: Snake,
  moverTier: number,
  currentTurn: number,
  sq: Coord
): SquareOutcome {
  const ourKey = TeamDetector.getTeamKey(mover);
  const casualty = (owner: Snake, weight: number, killed: boolean): ProjectedCasualty => {
    const teamKey = TeamDetector.getTeamKey(owner);
    return { id: owner.id, teamKey, ally: teamKey === ourKey, weight, killed, king: isKingUnit(owner) };
  };

  for (const owner of board.snakes) {
    if (owner.health <= 0) continue;
    const isSelf = owner.id === mover.id;

    if (isPieceUnit(owner)) {
      // A piece is a 1-cell stack; its own square is the mover's origin.
      if (isSelf) continue;
      const seat = owner.body[0] ?? owner.head;
      if (!seat || seat.x !== sq.x || seat.y !== sq.y) continue;
      // A piece is its whole weight in one square: winning the contest kills
      // it outright and the board loses every point of that weight.
      const ownerTier = tierAtArrival(owner, currentTurn);
      if (winsStationaryContest(moverTier, mover.length, ownerTier, owner.length)) {
        return { verdict: 'sever', victim: casualty(owner, owner.length, true) };
      }
      // A TIE is not a loss: the engine's contestSquare kills everyone at the
      // top tier when no unique heaviest is there, so equal tier and equal
      // weight is MUTUAL destruction. We still die (the verdict is fatal), but
      // the piece dies with us — a trade, not a suicide, and the casualty is
      // what makes the difference visible to scoring (a tied capture of an
      // enemy's last king still ends their team).
      if (tiesStationaryContest(moverTier, mover.length, ownerTier, owner.length)) {
        return { verdict: 'death', victim: casualty(owner, owner.length, true) };
      }
      return DEATH;
    }

    for (let i = 0; i < owner.body.length; i++) {
      // The tail always vacates before collisions are resolved (see the
      // SIMULTANEITY note above).
      if (i === owner.body.length - 1 && owner.body.length > 1) continue;
      const seg = owner.body[i];
      if (seg.x !== sq.x || seg.y !== sq.y) continue;
      // Our own body is a wall with no tier exemption — nothing severs itself.
      if (isSelf) return DEATH;
      if (moverTier <= tierAtArrival(owner, currentTurn)) return DEATH;
      // Severed at segment i: everything from i backwards is cut away, and the
      // owner survives shortened.
      //
      // i = 0 is the owner's PRE-move head, and that is where the projection's
      // frozen-snake view and the engine part company. The engine resolves
      // every snake's whole move in sub-step 1, so by the time a slider arrives
      // this square is no longer a head at all: it is post-move index 1, the
      // segment the snake swept in behind itself. `owner.body.indexOf(square,
      // 1)` finds it there and `splice(1)` cuts everything from it back — the
      // owner walks away ALIVE as a single segment, whatever its length was.
      // So a multi-cell snake's head square is a sever that costs it
      // length - 1, not a kill.
      //
      // A LENGTH-1 owner is the exception: its only segment pops before its
      // head lands, so it leaves nothing behind and its square really is a
      // head-class contest, which a strictly higher tier wins outright — a
      // kill for its whole weight of 1. (The engine now applies the same
      // tier-then-weight rule to length-1 snakes in edge swaps, so this
      // stationary model stays verdict-accurate.)
      if (i === 0 && owner.body.length > 1) {
        return { verdict: 'sever', victim: casualty(owner, owner.body.length - 1, false) };
      }
      const lost = owner.body.length - i;
      return { verdict: 'sever', victim: casualty(owner, lost, i === 0) };
    }
  }
  return CONTINUE;
}

/**
 * The projected health COST of `path` — `projectPath(...).cost`, kept as the
 * name every scoring caller reads.
 *
 * This is a projection for SCORING, not a health-after-move computation: it
 * never restores toward maxHealth (the mover's identity never enters the
 * formula beyond its health/weight/tier — eating always cancels the movement
 * term, whatever the type max is), so `cost` alone (not `health - cost`) is
 * what a caller compares against the mover's current health to test fatality
 * — and a fatal traversal reports a cost that zeroes that health exactly.
 */
export function projectedHealthCost(state: GameState, path: Coord[]): number {
  return projectPath(state, path).cost;
}

export interface SimulatedBoardState {
  board: Board;
  deadSnakeIds: Set<string>;
}

export class Simulator {
  /**
   * Simulate the next board state given a set of moves for all snakes
   */
  public simulateNextBoardState(
    gameState: GameState,
    moveSet: MoveSet,
    teamSnakeIds?: Set<string>
  ): SimulatedBoardState {
    // Deep copy the board
    const newBoard = this.deepCopyBoard(gameState.board);
    const deadSnakeIds = new Set<string>();

    // Invulnerability projected to the turn the simulated moves resolve on —
    // the ONE arrival-tier projection (tierAtArrival above), shared with the
    // path projection and matching BoardGraph's convention, so the simulator
    // and the passability layer agree on what a move can do.
    const invulnAtArrival = new Map<string, number>();
    for (const snake of newBoard.snakes) {
      invulnAtArrival.set(snake.id, tierAtArrival(snake, gameState.turn));
    }
    const invulnOf = (id: string): number => invulnAtArrival.get(id) ?? 0;

    // Track new head positions for collision detection
    const newHeadPositions = new Map<string, Coord>();
    const headCollisions = new Map<string, string[]>(); // position -> snake ids
    
    // Step 1: Move all snake heads
    for (const snake of newBoard.snakes) {
      if (!this.isAlive(snake)) {
        deadSnakeIds.add(snake.id);
        continue;
      }
      
      const move = moveSet.get(snake.id);
      // No move provided = FROZEN in place. This is also the documented v1
      // chess approximation: pieces (ours and enemies) enter the board as
      // 1-cell "snakes" whose `length` is their weight, are never given a
      // move by the enumerator, and therefore stand still in lookahead. A
      // stationary 1-cell body contributes no wall segments (index 0 is the
      // head), so a piece's square is only contested via the stationary-
      // square rule in step 3 — weight-correct because length = weight.
      if (!move) continue;
      
      const newHead = this.getNewHead(snake.head, move);
      newHeadPositions.set(snake.id, newHead);
      
      // Track potential head-to-head collisions
      const posKey = `${newHead.x},${newHead.y}`;
      if (!headCollisions.has(posKey)) {
        headCollisions.set(posKey, []);
      }
      headCollisions.get(posKey)!.push(snake.id);
    }
    
    // Step 2: Resolve head-to-head collisions
    for (const [, snakeIds] of headCollisions.entries()) {
      if (snakeIds.length > 1) {
        // Multiple snakes moved to same position
        const collidingSnakes = snakeIds.map(id => 
          newBoard.snakes.find(s => s.id === id)!
        );
        
        // Invulnerability decides head-to-head first: a more-invulnerable snake
        // "acts as the bigger snake" and wins regardless of length. Length is only
        // the tiebreaker among snakes sharing the top invulnerability level.
        const maxInvulnerability = Math.max(...collidingSnakes.map(s => invulnOf(s.id)));
        const topInvulnerable = collidingSnakes.filter(s => invulnOf(s.id) === maxInvulnerability);
        
        // Among the most-invulnerable snakes, the longest survives
        const maxLength = Math.max(...topInvulnerable.map(s => s.length));
        const survivors = topInvulnerable.filter(s => s.length === maxLength);
        
        // Determine who dies in this collision group under standard resolution.
        const groupDead = new Set<string>();
        if (survivors.length > 1) {
          // No unique survivor (tie among equal-invulnerability, equal-length
          // snakes) — all colliding snakes die.
          for (const snake of collidingSnakes) {
            groupDead.add(snake.id);
          }
        } else {
          // Single survivor; every other colliding snake dies.
          const survivorId = survivors[0].id;
          for (const snake of collidingSnakes) {
            if (snake.id !== survivorId) {
              groupDead.add(snake.id);
            }
          }
        }
        
        // Team-awareness: never let our snake benefit from a teammate's
        // head-to-head death. If our snake would survive this collision while a
        // teammate dies in it, flip the outcome — our snake dies and teammates
        // are spared — so the evaluated move gains no territory/space from
        // eliminating an ally. Enemy collision resolution is left unchanged.
        if (teamSnakeIds) {
          const ourId = gameState.you.id;
          const ourSurvives = snakeIds.includes(ourId) && !groupDead.has(ourId);
          const allyDies = snakeIds.some(
            id => id !== ourId && teamSnakeIds.has(id) && groupDead.has(id)
          );
          if (ourSurvives && allyDies) {
            groupDead.add(ourId);
            for (const id of snakeIds) {
              if (id !== ourId && teamSnakeIds.has(id)) {
                groupDead.delete(id);
              }
            }
          }
        }
        
        for (const id of groupDead) {
          deadSnakeIds.add(id);
        }
      }
    }
    
    // Step 3: Check for wall and body collisions
    for (const [snakeId, newHead] of newHeadPositions.entries()) {
      if (deadSnakeIds.has(snakeId)) continue;
      
      // Check wall collision
      if (newHead.x < 0 || newHead.x >= newBoard.width ||
          newHead.y < 0 || newHead.y >= newBoard.height) {
        deadSnakeIds.add(snakeId);
        continue;
      }
      
      // The moving snake's invulnerability level at the arrival turn
      const movingInvulnerability = invulnOf(snakeId);
      const mover = newBoard.snakes.find(s => s.id === snakeId)!;

      // Check body collision (including other snakes)
      for (const snake of newBoard.snakes) {
        if (!this.isAlive(snake) || deadSnakeIds.has(snake.id)) continue;

        // Stationary chess piece: entering its (single) square is a CONTEST
        // the engine adjudicates tier-first, weight-second — everyone below
        // the top tier at the square dies with weight never consulted; within
        // the top tier the unique heaviest survives and ties kill all
        // (`length` is a piece's WEIGHT). A won contest KILLS the piece: the
        // mover occupies the square with no growth and no health restore —
        // a piece is not food (the normal movement rule in step 4 applies).
        if (snake.id !== snakeId && isPieceUnit(snake)) {
          const sq = snake.body[0];
          if (sq && sq.x === newHead.x && sq.y === newHead.y) {
            const moverWins = winsStationaryContest(
              movingInvulnerability, mover.length, invulnOf(snake.id), snake.length);
            const pieceWins = winsStationaryContest(
              invulnOf(snake.id), snake.length, movingInvulnerability, mover.length);
            if (!moverWins) deadSnakeIds.add(snakeId);
            if (!pieceWins) deadSnakeIds.add(snake.id);
          }
          continue; // a 1-cell piece has no other segments to collide with
        }

        // If moving into a foreign snake's body and we have higher invulnerability,
        // skip collision — the mover severs through it (applied in step 5)
        if (snake.id !== snakeId &&
            movingInvulnerability > invulnOf(snake.id)) {
          continue;
        }
        
        // Check collision with each body segment
        for (let i = 0; i < snake.body.length; i++) {
          const segment = snake.body[i];

          // The engine pops every snake's tail BEFORE resolving collisions,
          // eating or not, so the final segment always vacates. A snake that
          // ate last turn carries a stacked (duplicated) tail: the duplicate
          // at the second-to-last index still blocks the cell, so skipping
          // the last index is exact for stacked tails too. Own tail and
          // foreign tails behave identically.
          if (i === snake.body.length - 1 && snake.body.length > 1) continue;

          if (segment.x === newHead.x && segment.y === newHead.y) {
            deadSnakeIds.add(snakeId);
            break;
          }
        }
      }
    }
    
    // Step 4: Update snake positions for surviving snakes
    for (const snake of newBoard.snakes) {
      if (deadSnakeIds.has(snake.id)) continue;
      
      const newHead = newHeadPositions.get(snake.id);
      if (!newHead) continue;
      
      // Check if snake is eating
      const foodIndex = newBoard.food.findIndex(f =>
        f.x === newHead.x && f.y === newHead.y
      );
      const isEating = foodIndex !== -1;

      // Health via the ONE shared movement/eat/hazard rule, computed BEFORE
      // the eaten food is spliced off the board (the rule reads dest food).
      // Movement-based decay only: units absent from the moveSet — frozen
      // snakes and stationary chess pieces — never reach this block (the
      // `if (!newHead) continue` above) and lose NO health; there is no
      // universal per-turn tick. Frozen units SITTING on hazard squares are
      // deliberately unmodeled: they don't move in lookahead, and hazard
      // damage triggers on ENTERING a hazard square.
      const newHealth = healthAfterEntering(snake, newBoard, newHead);

      // Update body the way the engine does: pop the tail first (it vacates
      // whether or not the snake eats), then grow by duplicating the NEW tail
      // — which is how "ate last turn" stays visible as a stacked tail.
      const newBody = [newHead, ...snake.body];
      newBody.pop();
      if (isEating) {
        const tail = newBody[newBody.length - 1];
        newBody.push({ x: tail.x, y: tail.y });
        // Remove the eaten food
        newBoard.food.splice(foodIndex, 1);
      }

      // Update snake
      snake.head = newHead;
      snake.body = newBody;
      snake.length = newBody.length;
      snake.health = newHealth;

      // Pawn promotion, mirroring the engine (chess/pieceMoves.ts): applied
      // AFTER the eat/growth update above, so a pawn that eats into the
      // threshold this turn promotes the same turn. Promotion RESETS weight
      // to 1 (truncating the body to the single head square) rather than
      // preserving the grown stack, keeps id/letter/orientation, and clamps
      // (never raises) current health down to the queen's configured max —
      // so a pawn that was mid-heal off a big meal does not carry that
      // health into its new type max.
      if (snake.unitType === 'pawn') {
        const promotionWeight = newBoard.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT;
        if (snake.length >= promotionWeight) {
          snake.unitType = 'queen';
          snake.body = [snake.head];
          snake.length = 1;
          const queenMaxHealth = newBoard.maxHealthPerUnit?.['queen'];
          if (queenMaxHealth !== undefined) {
            snake.health = Math.min(snake.health, queenMaxHealth);
          }
        }
      }

      // Death only at health <= 0, for starvation and hazard damage alike
      // (hazards are damage-based, no longer instant death). Starvation is
      // decided HERE, before any food spawn could help: the engine spawns
      // food AFTER movement, so this-turn survival is fully decidable from
      // the pre-move board and the simulator must NEVER invent food — a move
      // that doesn't land on existing food and takes health to 0 is certain
      // death (pinned by the conservative-starvation tests). Read from
      // `snake.health`, not the pre-promotion `newHealth` local, so a
      // promotion clamp that drives health to zero is honoured too.
      if (snake.health <= 0) {
        deadSnakeIds.add(snake.id);
      }
    }
    
    // Step 5: Severing. A snake that moved onto a strictly-less-invulnerable
    // snake's body doesn't just survive there (step 3 skipped that collision) —
    // it CUTS the body: the contacted segment and everything behind it are
    // removed, and the owner survives shortened. Mirrors the server's tiered
    // collision pass (SnekProcessor.checkSnakeCollisionsTiered), which severs
    // against post-move bodies with higher levels acting first.
    const severingMovers = newBoard.snakes
      .filter(s => !deadSnakeIds.has(s.id) && newHeadPositions.has(s.id))
      .sort((a, b) => invulnOf(b.id) - invulnOf(a.id));
    for (const mover of severingMovers) {
      const moverLevel = invulnOf(mover.id);
      for (const target of newBoard.snakes) {
        if (target.id === mover.id || deadSnakeIds.has(target.id)) continue;
        if (invulnOf(target.id) >= moverLevel) continue;
        // Index 0 is the target's head — head contacts resolve as head-to-head
        // in step 2, never as a sever.
        const segIdx = target.body.findIndex(
          (seg, i) => i >= 1 && seg.x === mover.head.x && seg.y === mover.head.y
        );
        if (segIdx === -1) continue;
        target.body = target.body.slice(0, segIdx);
        target.length = target.body.length;
      }
    }

    // Step 6: Remove dead snakes from the board
    newBoard.snakes = newBoard.snakes.filter(s => !deadSnakeIds.has(s.id));
    
    return {
      board: newBoard,
      deadSnakeIds
    };
  }

  private getNewHead(head: Coord, move: Direction): Coord {
    switch (move) {
      case 'up':
        return { x: head.x, y: head.y + 1 };
      case 'down':
        return { x: head.x, y: head.y - 1 };
      case 'left':
        return { x: head.x - 1, y: head.y };
      case 'right':
        return { x: head.x + 1, y: head.y };
      default:
        return head;
    }
  }

  private isAlive(snake: Snake): boolean {
    return snake.health > 0 && snake.body.length > 0;
  }

  private deepCopyBoard(board: Board): Board {
    return {
      height: board.height,
      width: board.width,
      food: (board.food ?? []).map(f => ({ x: f.x, y: f.y })),
      hazards: (board.hazards ?? []).map(h => ({ x: h.x, y: h.y })),
      // Must survive the copy: the hazard branch of healthAfterEntering reads
      // this configured damage on boards simulated FROM this copy.
      hazardDamage: board.hazardDamage,
      // Must survive the copy: the promotion step above reads these on
      // boards simulated FROM this copy (chained multi-turn lookahead).
      pawnPromotionWeight: board.pawnPromotionWeight,
      maxHealthPerUnit: board.maxHealthPerUnit,
      fertileTiles: board.fertileTiles ? board.fertileTiles.map(f => ({ x: f.x, y: f.y })) : undefined,
      snakes: (board.snakes ?? []).map(snake => ({
        id: snake.id,
        name: snake.name,
        latency: snake.latency,
        health: snake.health,
        // Must survive the copy: the eat branch above restores health to this
        // configured per-type max on boards simulated FROM this copy.
        maxHealth: snake.maxHealth,
        body: (snake.body ?? []).map(b => ({ x: b.x, y: b.y })),
        head: { x: snake.head.x, y: snake.head.y },
        length: snake.length,
        shout: snake.shout,
        squad: snake.squad,
        customizations: { ...(snake.customizations ?? {}) },
        // Must survive the copy: the stationary-piece contest in step 3, the
        // BoardGraph piece layers (piece squares as walls, the starvation
        // guard) and the piece threat map all key off the unit's type — and
        // pawn threat geometry reads its orientation.
        unitType: snake.unitType,
        orientation: { dx: snake.orientation.dx, dy: snake.orientation.dy },
        invulnerabilityLevel: snake.invulnerabilityLevel,
        // Must survive the copy: evaluators build a BoardGraph over the
        // simulated board, and BoardGraph reads severability lookahead from
        // this expiry (absent = "level applies this turn only").
        invulnerabilityExpiryTurn: snake.invulnerabilityExpiryTurn
      }))
    };
  }
}