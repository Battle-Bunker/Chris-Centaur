import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { isKingUnit, isPieceUnit, tiesStationaryContest, winsStationaryContest } from './piece-threats';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from './piece-moves';
import { TeamDetector } from './team-detector';

// MoveSet type definition (previously from move-enumerator)
export type MoveSet = Map<string, Direction>;

/**
 * The engine's exact health rule for a unit ENTERING `dest` this turn, shared
 * by the Simulator, MoveAnalyzer's health-aware hazard fatality and the
 * staged-move fatality probe so the three can never drift.
 *
 * The engine charges health PER SUB-STEP, strictly after that sub-step's
 * collisions, and settles food only at END OF TURN. So the order is CHARGE,
 * THEN EAT:
 *  - health loss is MOVEMENT-based (no universal per-turn decay): entering a
 *    cell costs 1, and a hazard cell costs a further board.hazardDamage
 *    (default 100). Both are charged in the sub-step the cell is entered.
 *  - health reaching <= 0 is EXHAUSTION, and exhaustion is PROVISIONAL death:
 *    it stops MOVEMENT and nothing else. The unit halts on the cell it
 *    reached and stays a live collision incumbent there.
 *  - the food phase then runs at END OF TURN, at the unit's FINAL cell, and
 *    ASSIGNS the configured type max (snake.maxHealth, engine default 100) —
 *    wiping the movement cost and every hazard dose. Food is the only heal.
 *  - a unit still at or below zero after that phase dies; one that halted ON
 *    food recovers and lives.
 *
 * For a one-cell step — every snake move, and this function's only caller
 * shape — the halt cell IS the destination, so the whole rule collapses to:
 * charge, and then let food at the destination restore to max whether or not
 * the charge took the unit to zero. A snake at health 1 stepping onto food
 * survives at full health; food on a hazard cell rescues just the same, and
 * the dose is wiped along with the step. What food cannot do is rescue a unit
 * from a cell it never reached (see projectPath, where a ray can halt short).
 *
 * Death is health <= 0. Call with the PRE-move snake and a board whose food
 * has not yet been spliced for this move.
 */
export function healthAfterEntering(snake: Snake, board: Board, dest: Coord): number {
  let health = snake.health - 1;
  if ((board.hazards ?? []).some(h => h.x === dest.x && h.y === dest.y)) {
    health -= board.hazardDamage ?? 100;
  }
  const eats = (board.food ?? []).some(f => f.x === dest.x && f.y === dest.y);
  return eats ? (snake.maxHealth ?? 100) : health;
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
 * the mover enter, truncated at the death, the starvation halt or the
 * capture-stop it resolved — so a caller must never assume the staged
 * destination was reached. It is close to the engine's Turn.paths but
 * deliberately NOT claimed to equal it: the engine settles an in-flight edge
 * exchange before either unit completes its crossing, so an exchange LOSER
 * never enters the square and its real path ends one square EARLIER than the
 * square appended here. Nothing reads `path` today; treat it as a debugging
 * trace of the projection, not as the wire record.
 */
export interface ProjectedPath {
  /**
   * Squares actually entered, truncated at a death, an exhaustion halt or a
   * capture-stop.
   */
  path: Coord[];
  /**
   * Health points the traversal costs: 1 per square entered plus a full hazard
   * dose per hazard square entered — or 0 when the mover ENDS THE TURN alive
   * on food, which restores it to its type max and so cancels the whole bill.
   * A LOSS measure, never a health delta: a recovery from zero reports 0 just
   * as an untroubled meal does. When `fatal`, it is at least the mover's
   * current health, so the projected health lands at zero or below.
   */
  cost: number;
  /**
   * The mover does not survive the traversal — killed outright on a square, or
   * EXHAUSTED (the running bill outran its health) on a square with no food to
   * recover on. Exhaustion alone is not fatal: see `eats`.
   */
  fatal: boolean;
  /** The mover severed a body / killed a piece and stopped there. */
  captureStopped: boolean;
  /**
   * The mover ends the turn alive on food, and so restores to its type max.
   * The square it ends on is whatever stopped it — the staged destination, a
   * capture-stop, or an exhaustion halt it thereby RECOVERS from.
   */
  eats: boolean;
  /** Who this traversal destroys, and what that costs us (see CasualtyContext). */
  casualties: CasualtyContext;
}

/**
 * One unit this traversal destroys or shortens. The engine's contests carry NO
 * friendly exemption — every adjudication compares tier then frozen weight and
 * never teams — so our own move kills an ally exactly the way it kills an
 * enemy, which is the whole reason this record exists.
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
 * is adjudicated here in the engine's own within-square order — COLLISIONS
 * FIRST, THEN THE HEALTH CHARGE:
 *
 *  - WALL / off-board: death on that square.
 *  - The occupancy contest (below). It is settled BEFORE any health is
 *    charged, which is why a mover that wins a square and then starves on it
 *    still takes its victim with it.
 *  - THE CHARGE: 1 for the square entered, plus board.hazardDamage (default
 *    100) if it is a hazard square, mid-flight squares included. Health hitting
 *    <= 0 is EXHAUSTION, which stops MOVEMENT and nothing else: the mover
 *    HALTS on that square, and whether it DIES there is settled at end of turn
 *    by the food phase. Halting ON food is a full recovery — it eats, restores
 *    to its type max, and lives, having simply stopped short of the staged
 *    destination. Halting anywhere else is death on the halt square. Either
 *    way the rest of the ray is never walked, so no further movement cost and
 *    no further hazard dose accrues, and food BEYOND the halt square is out of
 *    reach: there is no mid-ray rescue by a meal the mover never gets to.
 *    A capture-stop is charged for the square it stopped on, since it entered
 *    it.
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
 * The bill is the sum of those per-square charges — UNLESS the mover ends the
 * turn ALIVE on food, which SETS health to the type max and so cancels the
 * whole bill, hazard doses included (the food phase assigns the max rather
 * than adding to the running health — mirrors healthAfterEntering). The food
 * phase runs at the mover's FINAL square, whatever stopped it there: the
 * staged destination, a capture-stop, or an exhaustion halt all eat alike.
 * What is never credited is food on a square the mover did not end on — so a
 * ray that runs out of health, or out of board, short of the meal is not
 * saved by it.
 *
 * FROZEN STATE — what the engine guarantees, and what the projection may
 * therefore assume. All collision adjudication reads the tier and weight each
 * unit held at the START of the turn, and nothing is ever REMOVED from the
 * board mid-turn: dead units, starved units and severed segments all stay put
 * as collision objects until the whole collision phase is over. Modelling
 * other units as frozen on the squares they occupy now is therefore MORE
 * accurate than it used to be, not less — and the reverse inference, "that
 * square frees up once its occupant dies", is simply wrong. A square where
 * somebody dies is blocked for the rest of the turn, which is exactly what a
 * capture-stop already encodes here.
 *
 * SIMULTANEITY — what this projection still cannot see. A slider contests each
 * snake's POST-move body, and snakes move in sub-step 1. From the pre-move
 * board the client can see exactly one square of that shift: the tail always
 * vacates (the engine pops it before any collision, eating or not — a stacked
 * tail's duplicate at the second-to-last index still blocks, so skipping only
 * the last index is exact). Every other current segment — index 0 included,
 * whose two possible fates (the owner's neck if it stepped away, an edge
 * exchange if it stepped into us) are weighed in resolveTraversedSquare's
 * i = 0 policy note — is treated as still occupied, and the square a snake's
 * head moves INTO is not modelled at all (that is the unit threat map's job).
 * Both choices are conservative in the same direction: we may call a traversal
 * fatal that the real simultaneous resolution would have let through, and we
 * never bank on a body clearing out of our way.
 *
 * Other units' PIECES are modelled as frozen too: the projection never gives
 * them a move, so a unit that is in flight during the same turn is invisible
 * to it. The consequence that matters is the EDGE EXCHANGE — the other unit
 * stepping onto our origin as we step onto its square. The engine settles that
 * head-to-head, uniformly for every unit kind and length, on the same
 * tier-then-weight rule a shared square uses, so WHO LIVES is what this
 * projection already computes for a stationary occupant. Two things differ and
 * neither is read by scoring: the square a loser dies on (its own start square
 * — "squashed against its own neck" — rather than the contested one), which is
 * the `path` caveat above; and, when the occupant is a multi-cell SNAKE, the
 * projection deliberately models the other meeting instead (see
 * resolveTraversedSquare's i = 0 policy note).
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
  // The running bill, charged square by square exactly as the engine charges
  // it — so the square where it outruns `health` is the square the mover
  // halts and dies on, not a total compared against the health afterwards.
  let accrued = 0;
  // Killed outright by the board or by a contest — settled, and not something
  // the food phase can undo.
  let died = false;
  // Ran out of health and HALTED. Provisional only: the food phase at the end
  // of the turn decides whether it is also a death.
  let exhausted = false;
  let captureStopped = false;

  for (const sq of path) {
    // The killing/stopping square is always part of the traversal: the engine
    // records a dead mover's path as ending ON the square it died on.
    entered.push(sq);

    // 1. Walls / off the board. A collision, so it is settled before any
    //    charge — and a unit that dies here is never billed for the square.
    if (sq.x < 0 || sq.x >= board.width || sq.y < 0 || sq.y >= board.height) {
      died = true;
      break;
    }

    // 2. Occupancy: bodies and stationary pieces. Also a collision, and also
    //    settled before the charge — which is what lets a mover that wins the
    //    square and then exhausts on it still take its victim with it.
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
      if (moverIsPiece) captureStopped = true;
    }

    // 3. The health charge for the square just entered, strictly after this
    //    square's collisions: 1 for the step, plus a full dose for a hazard.
    accrued += 1;
    if (hazards.some(h => h.x === sq.x && h.y === sq.y)) accrued += hazardDamage;
    if (health - accrued <= 0) {
      // EXHAUSTED HERE. Movement stops and nothing else — this square is the
      // mover's final one, so the rest of the ray is never walked and nothing
      // beyond it is charged. Whether it also DIES is settled below, by what
      // this square holds.
      exhausted = true;
      break;
    }

    if (captureStopped) break;
  }

  // The square the mover ENDS the turn on, whatever stopped it there: the
  // staged destination, a capture-stop, or an exhaustion halt. The engine's
  // food phase runs at that square for every survivor, so this is the one
  // question worth asking about food.
  const dest = entered[entered.length - 1];
  const feeds = !died && (board.food ?? []).some(f => f.x === dest.x && f.y === dest.y);
  // EXHAUSTION IS PROVISIONAL DEATH, and this is where it is settled: a mover
  // that ran out of health on a square holding food eats at end of turn,
  // restores to its type max, and lives — halted short of the staged
  // destination, but alive. Exhausted anywhere else, it dies on the halt
  // square. A wall or a lost contest is an outright death that no meal undoes.
  const fatal = died || (exhausted && !feeds);
  const eats = !fatal && feeds;
  // Ending the turn on food wipes the WHOLE bill, not just the movement term:
  // the engine's food phase SETS health to the unit's type max
  // (TeamSnekProcessor.processFood), which restores the hazard doses charged
  // in flight along with the movement cost. Verified: 100 health through two
  // 20-damage hazards onto food lands at 100, not 60.
  //
  // `cost` stays a LOSS measure, not a health delta: every meal reports 0,
  // whether the mover strolled in on full health or recovered from zero. Two
  // traversals that end at the same type max must not score differently.
  let cost = eats ? 0 : accrued;
  // A fatal traversal reports a cost that ZEROES the health, which is what
  // makes the health-loss heuristic sensitive to it.
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
 *    cell contest leaves AT MOST ONE unique strict maximum standing (tier
 *    first, then frozen weight) and any tie leaves nobody, so equal tier and
 *    equal weight is mutual destruction — we die AND so does the piece. Losing
 *    outright is 'death' with no victim (the bare DEATH constant), which is
 *    the whole reason the two are distinguished here.
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
      // A TIE is not a loss: the engine's cell contest leaves at most one
      // unique strict maximum standing, so equal tier and equal weight is
      // MUTUAL destruction. We still die (the verdict is fatal), but
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
      // ── i = 0: THE OWNER'S START-OF-TURN HEAD CELL, and a POLICY CHOICE ──
      //
      // Enemy snakes always move, so by the time we arrive their start-of-turn
      // head cell is one of exactly two things, and the projection cannot know
      // which — it never gives other units a move:
      //
      //  (a) CHASE — the owner stepped away or aside. The cell is now its
      //      post-move index 1, the NECK it swept in behind itself: a living
      //      body cell. Equal-or-lower tier dies on it; a strictly higher tier
      //      severs it there and capture-stops, and the owner walks away alive
      //      as a single segment, whatever its length was. You cannot chase a
      //      head.
      //  (b) EXCHANGE — the owner stepped into OUR origin, so the two heads
      //      crossed the same edge. That is an edge contest, uniform across
      //      every unit kind and every length: frozen tier, then frozen
      //      weight, settled before either head reaches the far side. There is
      //      no swept-in-neck exemption — trails make no difference to it.
      //
      // POLICY: we model (a), the CHASE, always. It is the worse of the two
      // meetings for us wherever they differ, and never the better one —
      // verified combination by combination in the projection tests rather
      // than asserted here. The one place the choice is not purely
      // conservative is the CASUALTY LEDGER, not the fatality verdict: when we
      // strictly out-tier the owner, (a) costs it length - 1 and leaves it
      // alive while (b) would destroy it outright, so we under-credit a kill
      // on an enemy (conservative) and under-charge our own damage to an ALLY
      // by one weight, king included (optimistic — the known corner).
      //
      // A LENGTH-1 owner is the exception to the shape, not to the policy: its
      // only segment pops before its head lands, so under (a) the cell is
      // simply EMPTY, and under (b) it is a head-class contest a strictly
      // higher tier wins outright. We model it as the contest — a kill for its
      // whole weight of 1 — which keeps the frozen-occupancy assumption the
      // rest of this function rests on.
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
   * Simulate the next board state given a set of moves for all snakes.
   *
   * FROZEN STATE. The engine removes nothing from the board mid-turn: a unit
   * that dies HALTS where it stood and stays there as a collision object until
   * the collision phase ends, and only then leaves. So dying this turn never
   * opens a square for anybody else this turn, and the resolution is
   * order-independent. That is why every occupancy question below is asked of
   * the board AS IT STOOD AT TURN START (`preDead`), never of the running
   * `deadSnakeIds` set — which records who is leaving at the END of the turn,
   * not who has stopped blocking.
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
      // square rule in step 4 — weight-correct because length = weight.
      if (!move) continue;
      
      newHeadPositions.set(snake.id, this.getNewHead(snake.head, move));
    }

    // Everything already off the board when the turn began — the ONLY units
    // that do not block this turn. Anything that dies from here on is still a
    // collision object for the whole turn (see the frozen-state note above),
    // so the occupancy passes read THIS set and never `deadSnakeIds`.
    const preDead = new Set(deadSnakeIds);

    // Step 2: in-flight EDGE EXCHANGES. Two units whose HEADS exchange through
    // one edge in one sub-step contest that edge on frozen tier then frozen
    // weight, exactly the way they would contest a shared cell: the unique
    // maximum completes the crossing, and a tie leaves nobody standing.
    //
    // THE RULE IS UNIFORM. Having a trail makes no difference, and length makes
    // no difference: the contest is head-to-head and is settled before either
    // head reaches the far side, so the swept-in neck never gets a say. (The
    // only exemption in the engine is a JUMP, which crosses no edge — and a
    // knight's L-offset can never land on an adjacent cell anyway, so no unit
    // can exchange heads with one.) Snake-only games run the same unified
    // engine as every other game, so this is not a chess-variant rule.
    //
    // It goes FIRST, before the co-arrival pass, for the engine's own reason:
    // an exchange decides who actually completed a crossing, so it has to be
    // settled before anything asks who arrived where. An exchange loser never
    // reaches its destination and takes no part in the contest there.
    //
    // The loser is SQUASHED AGAINST ITS OWN NECK: it dies on the cell its head
    // held at the start of the turn, never on the one it was reaching for. Its
    // head reverts, but the TAIL POP STANDS — tails depart deterministically,
    // never contingent on a contest ahead of the head — so its corpse is its
    // start-of-turn body minus the shed tail. A length-1 loser therefore owns
    // no cells at all, though its death cell is still a collision object for
    // the rest of the turn. Both fall out of the occupancy rules in step 4
    // without special casing: the tail-skip already drops the shed cell, and
    // `edgeLosers` keeps a one-cell loser's death cell blocking.
    //
    // The winner is the SURVIVOR of the cell it lands on, not a fresh arrival
    // at it: it is never re-adjudicated against the pile it just made there,
    // which is what `edgeSettled` records for step 4. A THIRD unit arriving at
    // that cell does contest it, against the winner, in the ordinary way.
    const edgeLosers = new Set<string>();
    const edgeSettled = new Map<string, Set<string>>();
    const settle = (oneId: string, otherId: string): void => {
      for (const [self, other] of [[oneId, otherId], [otherId, oneId]]) {
        let seen = edgeSettled.get(self);
        if (!seen) edgeSettled.set(self, (seen = new Set()));
        seen.add(other);
      }
    };
    const edgeContenders = [...newHeadPositions.keys()]
      .map(id => newBoard.snakes.find(s => s.id === id)!)
      .filter(s => s && !deadSnakeIds.has(s.id));
    for (let i = 0; i < edgeContenders.length; i++) {
      for (let j = i + 1; j < edgeContenders.length; j++) {
        const a = edgeContenders[i];
        const b = edgeContenders[j];
        const aTo = newHeadPositions.get(a.id)!;
        const bTo = newHeadPositions.get(b.id)!;
        const exchanged =
          aTo.x === b.head.x && aTo.y === b.head.y &&
          bTo.x === a.head.x && bTo.y === a.head.y;
        if (!exchanged) continue;
        settle(a.id, b.id);
        if (!winsStationaryContest(invulnOf(a.id), a.length, invulnOf(b.id), b.length)) {
          deadSnakeIds.add(a.id);
          edgeLosers.add(a.id);
        }
        if (!winsStationaryContest(invulnOf(b.id), b.length, invulnOf(a.id), a.length)) {
          deadSnakeIds.add(b.id);
          edgeLosers.add(b.id);
        }
      }
    }

    // Step 3: Resolve head-to-head collisions — the co-arrival contest, over
    // the movers that actually completed a crossing (an edge loser never
    // reached its destination, so it is not standing there to be contested).
    for (const [id, newHead] of newHeadPositions.entries()) {
      if (edgeLosers.has(id)) continue;
      const posKey = `${newHead.x},${newHead.y}`;
      if (!headCollisions.has(posKey)) headCollisions.set(posKey, []);
      headCollisions.get(posKey)!.push(id);
    }
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

    // Step 4: Check for wall and body collisions. Every occupancy question
    // here is asked of the turn-start board: a unit condemned earlier this
    // turn is still standing on its cells for the rest of it (frozen state),
    // so a death never clears the way for somebody else's step.
    for (const [snakeId, newHead] of newHeadPositions.entries()) {
      // A mover already condemned has its own outcome settled; nothing below
      // can kill it twice.
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

      // Check body collision (including other snakes). `preDead`, not
      // `deadSnakeIds`: a unit that dies THIS turn keeps blocking until the
      // turn is over, so only units already gone at turn start are skipped.
      for (const snake of newBoard.snakes) {
        if (!this.isAlive(snake) || preDead.has(snake.id)) continue;
        // This pair's meeting was already settled at the edge (step 2b), on
        // the edge's own terms. Neither may be re-adjudicated against the
        // other here: the winner would otherwise die on the corpse it just
        // made, which is precisely the swept-in-neck doctrine the uniform
        // edge rule replaced.
        if (edgeSettled.get(snakeId)?.has(snake.id)) continue;
        // A ONE-CELL unit that MOVES leaves nothing behind: a length-1 snake
        // pops its only segment as it steps, and a piece's stack teleports
        // whole. Its old cell is genuinely empty on arrival — the same
        // exactness the tail rule below rests on, applied to the degenerate
        // body. (A one-cell unit that does NOT move still holds its cell and
        // is contested there; and one SQUASHED at the edge does not vacate
        // either — it died on that cell, which is a collision object for the
        // rest of the turn even though the corpse owns nothing.)
        if (
          snake.id !== snakeId &&
          snake.body.length === 1 &&
          newHeadPositions.has(snake.id) &&
          !edgeLosers.has(snake.id)
        ) {
          continue;
        }

        // Stationary chess piece: entering its (single) square is a CONTEST
        // the engine adjudicates tier-first, weight-second — everyone below
        // the top tier at the square dies with weight never consulted; within
        // the top tier the unique heaviest survives and ties kill all
        // (`length` is a piece's WEIGHT). A won contest KILLS the piece: the
        // mover occupies the square with no growth and no health restore —
        // a piece is not food (the normal movement rule in step 5 applies).
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
    
    // Step 5: Update snake positions for surviving snakes
    for (const snake of newBoard.snakes) {
      if (deadSnakeIds.has(snake.id)) continue;
      
      const newHead = newHeadPositions.get(snake.id);
      if (!newHead) continue;
      
      // Health via the ONE shared movement/eat/hazard rule, computed BEFORE
      // the eaten food is spliced off the board (the rule reads dest food).
      // Movement-based decay only: units absent from the moveSet — frozen
      // snakes and stationary chess pieces — never reach this block (the
      // `if (!newHead) continue` above) and lose NO health; there is no
      // universal per-turn tick. Frozen units SITTING on hazard squares are
      // deliberately unmodeled: they don't move in lookahead, and hazard
      // damage triggers on ENTERING a hazard square.
      const newHealth = healthAfterEntering(snake, newBoard, newHead);

      // Eating is the END-OF-TURN food phase, at the unit's FINAL cell. A
      // snake's move is one cell, so its final cell is always the one it just
      // entered — and because exhaustion only halts movement, a snake the step
      // took to zero still eats here and recovers. `healthAfterEntering`
      // already reports the restored health; this is the growth and the
      // splice.
      const foodIndex = newBoard.food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
      const isEating = foodIndex !== -1;

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

      // Pawn promotion, mirroring the engine (engine/moveGrammar.ts): applied
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
    
    // Step 6: Severing. A snake that moved onto a strictly-less-invulnerable
    // snake's body doesn't just survive there (step 4 skipped that collision) —
    // it CUTS the body: the contacted segment and everything behind it are
    // removed, and the owner survives shortened. Mirrors the server's tiered
    // collision phase (engine/turnEngine.ts), which severs
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

    // Step 7: Remove dead snakes from the board
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