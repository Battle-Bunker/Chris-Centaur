/**
 * The turn oracle: what a candidate move ACTUALLY does, answered by running
 * the real game.
 *
 * This module owns no rules. It marshals the bot's board into the vendored
 * TacticToes engine (`src/engine-vendor/`, a byte-for-byte copy of the code
 * the server plays the game with), calls `resolveTurn`, and reads the outcome
 * off the settled result: who is in `deaths`, what is left in `board`, which
 * teams are in `eliminatedTeamIDs`. Every arithmetic question about the rules —
 * contests, severs, edge exchanges, exhaustion, regicide, food — is answered
 * by the engine, not here.
 *
 * That is the whole design. The bot used to hand-mirror the rules in a
 * projection of its own, and the mirror drifted every time the rules moved.
 * What remains ours is the one thing the engine cannot know: WHAT THE ENEMY
 * WILL DO. That assumption is stated explicitly below and nowhere else.
 *
 * ── Coordinates ────────────────────────────────────────────────────────────
 * The bot thinks in api coords (perimeter stripped, y up); the engine thinks
 * in full-board indices (perimeter included, y down). Everything crossing this
 * boundary goes through translate.ts's `apiCoordToIndex` / `toApiCoord`, the
 * same pair the Firestore layer uses, so there is one mapping in the codebase.
 *
 * ── The enemy-intent assumption, and how hypotheses aggregate ──────────────
 * We resolve the same candidate several times, once per assumed enemy intent:
 *
 *  - the BASELINE, in which every other unit HOLDS. They stand where we can
 *    see them standing, which is the one thing about them we know (see
 *    `resolveWith` for what that assumption costs and why we pay it).
 *  - one HEAD-ON hypothesis per enemy standing ADJACENT to our first step: it
 *    stages that cell (a co-arrival contest), or — if it is already standing
 *    there — our origin, which is the edge exchange. Legality is checked with
 *    the engine's own movement grammar, so we never invent a move a unit could
 *    not make. Range is deliberately one step: see `enemyIntents` for why
 *    longer-range danger belongs to the threat map instead.
 *
 * Aggregation is one rule: EACH FIELD TAKES ITS EXTREME OVER THE HYPOTHESES.
 * For the costs — fatality, health, ally losses, our own regicide — the
 * extreme is the worst case, so a move is fatal if ANY reachable enemy intent
 * kills us. For the gains — kills, enemy regicide — it is the best case, so a
 * kill we can obtain in some reachable world is credited. We deliberately
 * refuse to let one guess make a move look both safe and profitable: safety is
 * judged against the enemy's best play, profit against their worst. Both
 * numbers come from a fully-resolved real turn either way.
 */

import { Board, Coord, Snake } from '../types/battlesnake';
import { apiCoordToIndex, toApiCoord } from '../firebase/translate';
import { TeamDetector } from './team-detector';
import { isKingUnit, isPieceUnit } from './piece-threats';
import { tierAtArrival } from './simulator';
import { planUnitAction } from '../engine-vendor/engine/moveGrammar';
import {
  ResolveTurnInput,
  ResolveUnit,
  TurnResolution,
  resolveTurn,
} from '../engine-vendor/engine/resolveTurn';
import { ClashKind, UnitType } from '@shared/types/Game';

/**
 * What a candidate move DOES to the units on the board, folded into the four
 * per-move stats the scoring layer reads. All plain numbers, so the context
 * survives the structured clone into decision worker threads.
 */
export interface CasualtyContext {
  /** Total weight of OUR OWN units this move destroys (kills + severed segments). */
  allyCasualty: number;
  /**
   * 1 when this move ends OUR team — our team is in the engine's
   * `eliminatedTeamIDs`, whether our last king was taken by our own unit or
   * the mover IS that king and it died.
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

/** Everything the scoring layer wants to know about one candidate move. */
export interface CandidateOutcome {
  /** Our unit is in the engine's death registry. */
  fatal: boolean;
  /** What killed it, straight from the registry. Absent when we survived. */
  deathCause?: ClashKind;
  /** Where it died / where it ended up, in api coords. */
  finalCell: Coord | null;
  /** Squares our unit actually entered, in order. */
  traversed: Coord[];
  /**
   * Health lost over the turn: our health before, minus the health the engine
   * left us with. A meal restores us, so a fed traversal reports 0 rather than
   * a gain — a LOSS measure, matching what the health-loss heuristic weights.
   * A fatal traversal reports our whole health, zeroing it.
   */
  cost: number;
  /** We ended short of the staged destination (capture-stop or exhaustion halt). */
  halted: boolean;
  /** We ran out of health on the way — fatal or recovered on food. */
  exhausted: boolean;
  /** We ended the turn on food and grew. */
  ate: boolean;
  /** Cells another unit cut off our own body this turn. */
  severedFromUs: number;
  casualties: CasualtyContext;
}

function emptyOutcome(): CandidateOutcome {
  return {
    fatal: false,
    finalCell: null,
    traversed: [],
    cost: 0,
    halted: false,
    exhausted: false,
    ate: false,
    severedFromUs: 0,
    casualties: emptyCasualtyContext(),
  };
}

/** A board marshalled into engine terms once, reusable across every candidate. */
export interface MarshalledBoard {
  /** Full-board dimensions (the api board plus its 1-cell perimeter). */
  fullWidth: number;
  fullHeight: number;
  /** Engine units for every living unit, in board order, ready to be pathed. */
  units: ResolveUnit[];
  /** Static input the engine needs, minus the units. */
  config: Omit<ResolveTurnInput, 'units'>;
  /** Weight (occupancy length) each unit started the turn with. */
  startWeight: Map<string, number>;
  /** Health each unit started the turn with. */
  startHealth: Map<string, number>;
  /** Team identity per unit, the one TeamDetector rule. */
  teamOf: Map<string, string>;
  toIndex(cell: Coord): number;
  toCell(index: number): Coord;
}

/**
 * The bot's board as engine input. A piece arrives here collapsed to a 1-cell
 * body whose `length` is its WEIGHT (see translate.ts); the engine wants the
 * real weight-stack, so it is expanded back out. Snakes map straight across.
 *
 * `regicideTeamIDs` is read off the board rather than a roster: a king only
 * ever enters play from the game setup (pawns promote to queens, never to
 * kings) and a team configured with kings cannot still be playing with none
 * alive — the rule would already have eliminated it. So "this team plays under
 * regicide" is exactly "this team has a living king".
 */
export function marshalBoard(board: Board, currentTurn: number): MarshalledBoard {
  const fullWidth = board.width + 2;
  const fullHeight = board.height + 2;
  const toIndex = (cell: Coord): number => apiCoordToIndex(cell, fullWidth, fullHeight);
  const toCell = (index: number): Coord => toApiCoord(index, fullWidth, fullHeight);

  const walls: number[] = [];
  for (let y = 0; y < fullHeight; y++) {
    for (let x = 0; x < fullWidth; x++) {
      if (x === 0 || x === fullWidth - 1 || y === 0 || y === fullHeight - 1) {
        walls.push(y * fullWidth + x);
      }
    }
  }

  const living = (board.snakes ?? []).filter((s) => s.health > 0 && s.body.length > 0);
  const startWeight = new Map<string, number>();
  const startHealth = new Map<string, number>();
  const teamOf = new Map<string, string>();
  const regicideTeamIDs = new Set<string>();

  const units: ResolveUnit[] = living.map((snake) => {
    const teamID = TeamDetector.getTeamKey(snake);
    const type = (snake.unitType ?? 'snake') as UnitType;
    // A piece is its weight in one cell; a snake is its body.
    const occupancy = isPieceUnit(snake)
      ? new Array(Math.max(1, snake.length)).fill(toIndex(snake.body[0] ?? snake.head))
      : snake.body.map(toIndex);
    teamOf.set(snake.id, teamID);
    startWeight.set(snake.id, occupancy.length);
    startHealth.set(snake.id, snake.health);
    if (isKingUnit(snake)) regicideTeamIDs.add(teamID);
    return {
      id: snake.id,
      type,
      teamID,
      isKing: isKingUnit(snake),
      tier: tierAtArrival(snake, currentTurn),
      health: snake.health,
      occupancy,
      orientation: { ...snake.orientation },
    };
  });

  // Per-KIND max health, which is what the engine's food phase restores to.
  // The board's own map is the configured source; a unit's resolved
  // `snake.maxHealth` (translate.ts sets it from that same config) fills in
  // for boards that carry the per-unit figure but not the map — hand-built
  // fixtures, mostly, but the two must never disagree about what a meal is
  // worth.
  const maxHealth: NonNullable<ResolveTurnInput['maxHealth']> = {
    ...(board.maxHealthPerUnit as ResolveTurnInput['maxHealth']),
  };
  for (const snake of living) {
    if (snake.maxHealth === undefined) continue;
    const type = (snake.unitType ?? 'snake') as UnitType;
    if (maxHealth[type] === undefined) maxHealth[type] = snake.maxHealth;
  }

  const config: Omit<ResolveTurnInput, 'units'> = {
    boardWidth: fullWidth,
    boardHeight: fullHeight,
    walls,
    hazards: (board.hazards ?? []).map(toIndex),
    hazardDamage: board.hazardDamage ?? 100,
    food: (board.food ?? []).map(toIndex),
    regicideTeamIDs: Array.from(regicideTeamIDs),
    maxHealth,
  };

  return { fullWidth, fullHeight, units, config, startWeight, startHealth, teamOf, toIndex, toCell };
}

/** One assumed enemy intent: the staged cell for each unit that is not ours. */
type EnemyIntent = Map<string, number>;

/**
 * The enemy intents worth resolving for a mover stepping onto `firstCell`:
 * the baseline, plus one HEAD-ON hypothesis per enemy standing right next to
 * the square we are stepping into.
 *
 * Deliberately narrow. The hypotheses exist to cover the one class of outcome
 * a static baseline structurally CANNOT see — the collision that only happens
 * because the other unit came at us as we came at it: an edge exchange when it
 * is already standing on our first cell, or a co-arrival when it is one step
 * away from it. Longer-range danger (a queen four squares down the rank) is
 * not an edge collision, and modelling it here would turn every square near a
 * slider into a hard fatality. That is what the piece threat map is for, and
 * it prices such squares as a weighted deterrent, which is the honest shape
 * for "they might, if they choose to".
 *
 * Adjacency is the 8 neighbours plus the cell itself, so the set is at most
 * nine units and in practice one or two. Legality is then decided by the
 * ENGINE'S OWN movement grammar, so a bishop is never assumed to make an
 * orthogonal step and a knight never a neighbourly one.
 */
function enemyIntents(
  marshalled: MarshalledBoard,
  ourID: string,
  origin: number,
  firstCell: number | null
): EnemyIntent[] {
  const intents: EnemyIntent[] = [new Map()];
  if (firstCell === null) return intents;

  const { fullWidth } = marshalled;
  const adjacent = (cell: number): boolean => {
    const dx = Math.abs((cell % fullWidth) - (firstCell % fullWidth));
    const dy = Math.abs(Math.floor(cell / fullWidth) - Math.floor(firstCell / fullWidth));
    return Math.max(dx, dy) <= 1;
  };

  for (const unit of marshalled.units) {
    if (unit.id === ourID) continue;
    if (!adjacent(unit.occupancy[0])) continue;
    // Standing ON our first cell, the head-on move is into OUR origin: that is
    // the edge exchange. Otherwise it is the step onto the cell we both want.
    const target = unit.occupancy[0] === firstCell ? origin : firstCell;
    if (unit.occupancy[0] === target) continue;
    const action = planUnitAction(
      unit.type,
      unit.occupancy[0],
      target,
      marshalled.fullWidth,
      marshalled.fullHeight,
      unit.orientation,
      new Set(marshalled.config.food.concat(marshalled.units.flatMap((u) => u.occupancy)))
    );
    // Only a move that actually lands on the contested cell tells us anything
    // the baseline did not: a rotation or an illegal destination would fall
    // back to the kind's default and re-run the baseline for nothing.
    if (!action || action.kind !== 'move') continue;
    if (action.path[action.path.length - 1] !== target) continue;
    intents.push(new Map([[unit.id, target]]));
  }
  return intents;
}

/**
 * Resolve one turn: our unit walking `path`, everyone else per `intent`.
 *
 * A unit with no assumed intent is given an EMPTY PATH, which the engine
 * resolves as a unit that holds. Every other unit on the board stands exactly
 * where we can see it standing, which is the one thing about them we actually
 * know. That is the bot's long-standing frozen-enemy model, and the engine's
 * frozen-state rule makes it a sound reading of a static board.
 *
 * One consequence is worth stating, because it is the price of the assumption
 * and it is paid in the cautious direction: a held snake does not pop a tail,
 * so an enemy's TAIL CELL reads as occupied here. The old hand-written
 * projection let a ray through a tail, on the grounds that the pop is
 * unconditional — true of a snake that moves, and a snake always does. We give
 * that up rather than invent a direction for every enemy on the board: a
 * guessed heading changes which of its segments we meet, and therefore how
 * much of it we cut, which is a fiction with numbers attached. Erring toward
 * "that cell is occupied" costs us reach; erring the other way costs units.
 */
function resolveWith(
  marshalled: MarshalledBoard,
  ourID: string,
  path: number[],
  intent: EnemyIntent
): TurnResolution {
  const units: ResolveUnit[] = marshalled.units.map((unit) => {
    if (unit.id === ourID) return { ...unit, path };
    const staged = intent.get(unit.id);
    return staged === undefined ? { ...unit, path: [] } : { ...unit, stagedMove: staged };
  });
  return resolveTurn({ ...marshalled.config, units });
}

/**
 * Read one resolved turn from our unit's point of view. Everything here is a
 * lookup into the result — no rule is re-derived.
 *
 * A death is OURS TO CLAIM when our unit took part in the clash that caused
 * it: the engine names every participant and every victim per event, so
 * "attributable" is `victimIDs` of a record whose `playerIDs` include us. That
 * keeps us from crediting a kill for an enemy that starved on the far side of
 * the board, without asking us to reason about why anybody died.
 */
function readOutcome(
  marshalled: MarshalledBoard,
  ourID: string,
  intendedPath: number[],
  result: TurnResolution
): CandidateOutcome {
  const ourTeam = marshalled.teamOf.get(ourID) as string;
  const ourStartHealth = marshalled.startHealth.get(ourID) ?? 0;
  const ourStartWeight = marshalled.startWeight.get(ourID) ?? 0;
  const death = result.deaths[ourID];
  const survivor = result.board[ourID];

  const casualties = emptyCasualtyContext();
  const attributableKings = new Set<string>();

  for (const clash of result.clashes) {
    if (!clash.playerIDs.includes(ourID)) continue;
    for (const victimID of clash.victimIDs) {
      if (victimID === ourID) continue;
      const victimTeam = marshalled.teamOf.get(victimID);
      if (victimTeam === undefined) continue;
      if (victimTeam === ourTeam) casualties.allyCasualty += marshalled.startWeight.get(victimID) ?? 0;
      else casualties.kills += 1;
      const victim = marshalled.units.find((u) => u.id === victimID);
      if (victim?.isKing) attributableKings.add(victimTeam);
    }
    // A sever we landed costs its owner the cells the engine actually cut. It
    // is not a death, so it never shows up in victimIDs — only here.
    if (clash.kind === 'sever' && clash.survivorID === ourID) {
      for (const ownerID of clash.playerIDs) {
        if (ownerID === ourID) continue;
        if (marshalled.teamOf.get(ownerID) !== ourTeam) continue;
        casualties.allyCasualty += result.severedCells[ownerID]?.length ?? 0;
      }
    }
  }

  for (const teamID of result.eliminatedTeamIDs) {
    // Our own team ending is our problem however it happened.
    if (teamID === ourTeam) casualties.regicide = 1;
    // An enemy team ending is only OUR doing when we took the king that did it.
    else if (attributableKings.has(teamID)) casualties.enemyRegicide = 1;
  }

  const finalIndex = result.finalCell[ourID];
  const intendedEnd = intendedPath.length > 0 ? intendedPath[intendedPath.length - 1] : null;

  return {
    fatal: death !== undefined,
    ...(death ? { deathCause: death.cause as ClashKind } : {}),
    finalCell: finalIndex === undefined ? null : marshalled.toCell(finalIndex),
    traversed: (result.traversed[ourID] ?? []).map(marshalled.toCell),
    cost: death
      ? ourStartHealth
      : Math.max(0, ourStartHealth - (survivor?.health ?? ourStartHealth)),
    halted: intendedEnd !== null && finalIndex !== intendedEnd,
    exhausted: result.exhaustions.some((e) => e.unitID === ourID),
    ate: (survivor?.occupancy.length ?? ourStartWeight) > ourStartWeight,
    severedFromUs: result.severedCells[ourID]?.length ?? 0,
    casualties,
  };
}

/** Each field's extreme over the hypotheses — see the module doc. */
function aggregate(outcomes: CandidateOutcome[]): CandidateOutcome {
  const [first, ...rest] = outcomes;
  const out: CandidateOutcome = { ...first, casualties: { ...first.casualties } };
  for (const other of rest) {
    // Costs: the worst case. We never bank on the enemy's cooperation.
    if (other.fatal && !out.fatal) {
      out.fatal = true;
      out.deathCause = other.deathCause;
      out.finalCell = other.finalCell;
    }
    out.cost = Math.max(out.cost, other.cost);
    out.halted = out.halted || other.halted;
    out.exhausted = out.exhausted || other.exhausted;
    out.severedFromUs = Math.max(out.severedFromUs, other.severedFromUs);
    out.casualties.allyCasualty = Math.max(out.casualties.allyCasualty, other.casualties.allyCasualty);
    out.casualties.regicide = Math.max(out.casualties.regicide, other.casualties.regicide);
    // Gains: the best case. A kill obtainable in some reachable world is real,
    // and the fatality term already prices what it might cost to go for it.
    out.casualties.kills = Math.max(out.casualties.kills, other.casualties.kills);
    out.casualties.enemyRegicide = Math.max(
      out.casualties.enemyRegicide,
      other.casualties.enemyRegicide
    );
    // `ate` describes the run we are reporting: only claim the meal if it
    // survives the worst case too.
    out.ate = out.ate && other.ate;
  }
  if (out.fatal) out.cost = Math.max(out.cost, outcomes[0].cost);
  return out;
}

/**
 * The one entry point: what does this path do?
 *
 * `path` is FULL-BOARD indices, one cell per sub-step — a snake's single step,
 * a slider's whole ray, or empty for a stay/rotate (which the engine resolves
 * as a unit that holds, and which therefore cannot hurt anybody).
 */
export function evaluateCandidatePath(
  marshalled: MarshalledBoard,
  ourID: string,
  path: number[]
): CandidateOutcome {
  const ourUnit = marshalled.units.find((u) => u.id === ourID);
  if (!ourUnit) return emptyOutcome();

  const origin = ourUnit.occupancy[0];
  const intents = enemyIntents(marshalled, ourID, origin, path.length > 0 ? path[0] : null);
  const outcomes = intents.map((intent) =>
    readOutcome(marshalled, ourID, path, resolveWith(marshalled, ourID, path, intent))
  );
  return aggregate(outcomes);
}

/**
 * The same question for a board the caller has not marshalled yet — the
 * convenience shape for a one-off (a test, or a single probe). Hot callers
 * marshal once and reuse it across every candidate.
 */
export function evaluatePathOnBoard(
  board: Board,
  currentTurn: number,
  ourID: string,
  apiPath: Coord[]
): CandidateOutcome {
  const marshalled = marshalBoard(board, currentTurn);
  return evaluateCandidatePath(marshalled, ourID, apiPath.map(marshalled.toIndex));
}

/**
 * The health a unit has left after ENTERING `cell`, asked of the engine with
 * nothing else on the board.
 *
 * The solo board is the point: with no other unit present nothing can contest
 * anything, so the only things that can touch the answer are the movement
 * cost, the hazard dose, exhaustion and the end-of-turn meal — which is
 * exactly the question callers want when they are layering health-awareness on
 * top of a separate wall/body passability check (MoveAnalyzer's hazard-step
 * classification, the staged-move fatality probe). Asking the engine keeps
 * even this small a rule out of the bot.
 *
 * <= 0 means the step kills. Note that a step onto FOOD comes back at the
 * unit's type max however low it started, because exhaustion only halts and
 * the food phase runs at the halt cell.
 */
export function healthAfterEntering(board: Board, currentTurn: number, unit: Snake, cell: Coord): number {
  const solo: Board = { ...board, snakes: [unit] };
  const marshalled = marshalBoard(solo, currentTurn);
  const path = [marshalled.toIndex(cell)];
  const result = resolveTurn({
    ...marshalled.config,
    units: marshalled.units.map((u) => ({ ...u, path })),
  });
  // Dead means the engine took it to zero or below; report the shortfall the
  // registry implies rather than inventing a number.
  return result.board[unit.id]?.health ?? 0;
}

/** The projected health cost of a path — the name every scoring caller reads. */
export function projectedHealthCost(
  board: Board,
  currentTurn: number,
  ourID: string,
  apiPath: Coord[]
): number {
  return evaluatePathOnBoard(board, currentTurn, ourID, apiPath).cost;
}

/** Re-exported so callers need not reach into the vendored tree themselves. */
export type { ResolveUnit, ResolveTurnInput, TurnResolution };
export { resolveTurn };
export type { Snake };
