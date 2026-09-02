/**
 * The turn oracle: what a candidate move ACTUALLY does, answered by running
 * the real game.
 *
 * This module owns no rules. It marshals the bot's board into the vendored
 * TacticToes engine (`src/engine-vendor/`, a byte-for-byte copy of the code
 * the server plays the game with), calls `settleTurn`, and reads the outcome
 * off the settled result: who is in `deaths`, what is left in `board`, which
 * teams are in `eliminatedTeamIDs`, and what `tiers`, `effects` and `potions`
 * the next turn starts from. Every arithmetic question about the rules —
 * contests, severs, edge exchanges, exhaustion, regicide, food, effect expiry,
 * the ally-buff cancel, potion collection — is answered by the engine, not
 * here.
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

import { DEFAULT_PAWN_PROMOTION_WEIGHT } from './piece-moves';
import { NO_SPAWN } from '../engine-vendor/engine/spawn';
import { resolveMaxTurns } from '../engine-vendor/engine/adjudicate';
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
import {
  DEFAULT_POTION_WINDOW_TURNS,
  Settlement,
  settleTurn,
} from '../engine-vendor/engine/settleTurn';
import { ActiveEffect, ClashKind, UnitType } from '@shared/types/Game';

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
  /**
   * Invulnerability potion cells on the board, as engine indices.
   *
   * Not part of `config`, which is `resolveTurn`'s own `ResolveTurnInput` and
   * knows nothing about potions. This field has two readers: `settleTurn`,
   * which COLLECTS from it and returns what is left, and the possibility-cloud
   * layer, whose `CloudPremise.potions` prices how far an UNMODELLED unit's
   * tier interval can move while it is frozen — the one question settlement
   * cannot answer, because a held unit's moves are not known. An empty array
   * is what a potion-free game carries.
   */
  potions: number[];
  /**
   * The turn the STAGED moves resolve into — `currentTurn + 1`, the turn every
   * contest on this board is adjudicated at. `settleTurn` reads it for effect
   * expiry and for the potion window's arithmetic, and it is the same figure
   * each unit's input tier is read at, so the two cannot drift.
   */
  arrivalTurn: number;
  /**
   * The invulnerability effect schedule that still governs `arrivalTurn`, as
   * settlement takes it — the board's own `activeEffects`, filtered to exactly
   * the effects counted into each unit's input tier.
   *
   * EMPTY when the board carries no schedule (hand-built fixtures, documents
   * predating the field). Nothing is invented to fill the gap: a settlement
   * with no schedule expires nothing, which is exactly what a board with no
   * schedule could ever have told us.
   */
  effects: ActiveEffect[];
  /**
   * GameSetup.invulnerabilityPotionEnabled; off makes potions inert scenery.
   *
   * A board that states nothing is read off its own contents: potion cells are
   * only ever on a board because the setting put them there, so cells present
   * and no flag means live. Boards predating the flag, and every hand-built
   * fixture, are exactly that case, and reading them as "off" would quietly
   * make settlement decline to collect a potion the rules would collect.
   */
  potionsEnabled: boolean;
  /** GameSetup.invulnerabilityPotionWindowTurns, or the engine's default. */
  potionWindowTurns: number;
  /** Meals a pawn needs to promote; settlement promotes at this weight. */
  pawnPromotionWeight: number;
  /** The turn the game is adjudicated at, or null for unlimited. */
  maxTurns: number | null;
  /**
   * Per unit, PARALLEL TO `units`: the first absolute turn at which the unit's
   * tier no longer governs a contest, or null when the wire carries no effect
   * schedule for it.
   *
   * EXCLUSIVE, and the offset is the whole point. The server expires effects
   * AFTER the collision phase, so an effect whose `expiryTurn` is E still
   * decides every contest resolved during turn E (TeamSnekProcessor.ts:558-575;
   * potions.test.ts:233-261). `Snake.invulnerabilityExpiryTurn` carries that
   * inclusive E. The engine's `UnitSpec.tierExpiresAtTurn` is read as "at this
   * turn the tier has already reverted" (`cloud.ts:783`: expired when
   * `heldAtTurn + n >= tierExpiresAtTurn`), so the two conventions differ by
   * one and the conversion belongs here, once, next to the citation.
   */
  tierExpiry: (number | null)[];
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
/**
 * THE EXACT TIER A UNIT CARRIES INTO THE ARRIVAL TURN, read off the schedule.
 *
 * `tierAtArrival` (simulator.ts) reads the two fields the WIRE collapses the
 * schedule into: an aggregate `invulnerabilityLevel` and a single
 * `invulnerabilityExpiryTurn`, which `translate.ts::aggregateExpiryTurn` sets
 * to the EARLIEST expiry among the unit's effects. That collapse is lossy the
 * moment a unit carries two effects with different expiries: a unit holding a
 * +1 buff to turn 20 and a -1 debuff to turn 12 has aggregate level 0 and
 * earliest expiry 12, so at turn 15 the collapsed reading says "level 0, and
 * it lapsed anyway" — tier 0 — when the buff is still live and the unit is
 * genuinely at tier 1. Tier is the FIRST key `strictMaximum` orders a contest
 * on, so reading it a level low is the sharpest possible error to make.
 *
 * The schedule is the non-lossy source and settlement's own convention is the
 * one applied here: an effect due at turn E still decides every contest
 * resolved during turn E (settleTurn expires at the END of the turn), so an
 * effect governs the arrival turn exactly when `expiryTurn >= arrivalTurn` —
 * the same predicate `MarshalledBoard.effects` is filtered on below, which is
 * what keeps the tier handed to settlement and the schedule handed to
 * settlement talking about the same set of effects.
 *
 * THE RESIDUAL is the part of the wire's aggregate level that the schedule
 * does not account for, and it exists so that this reading is bit-for-bit the
 * old one on every board carrying at most one effect per unit — including the
 * boards where the two disagree. A fixture that states a level and lists no
 * effect for it keeps the level, on the wire's own expiry rule; a board with
 * no schedule at all (`activeEffects` absent: hand-built fixtures, documents
 * predating the field) never reaches here and keeps `tierAtArrival` verbatim.
 */
function tierFromSchedule(
  snake: Snake,
  currentTurn: number,
  governing: ReadonlyMap<string, number>,
  listed: ReadonlyMap<string, number>
): number {
  const fromSchedule = governing.get(snake.id) ?? 0;
  const residual = (snake.invulnerabilityLevel ?? 0) - (listed.get(snake.id) ?? 0);
  if (residual === 0) return fromSchedule;
  // The wire's own gate, applied to the wire's own leftover: `tierAtArrival`
  // keeps a level while `currentTurn + 1 <= invulnerabilityExpiryTurn`, and a
  // unit with no expiry at all keeps nothing.
  const expiry = snake.invulnerabilityExpiryTurn ?? currentTurn;
  return currentTurn + 1 <= expiry ? fromSchedule + residual : fromSchedule;
}

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

  // The staged moves resolve INTO the next turn: that is the turn a contest is
  // adjudicated at, the turn a level is tested against, and the turn settlement
  // expires effects at. Keeping the three on one figure is the whole reason it
  // is named here rather than recomputed at each use.
  const arrivalTurn = currentTurn + 1;

  // The effect schedule, tallied per unit ONCE: what still governs the arrival
  // turn, and what the schedule says in total. Absent (not merely empty) means
  // the board carries no schedule and every tier falls back to the wire's
  // collapsed reading.
  const schedule = board.activeEffects;
  const governing = new Map<string, number>();
  const listed = new Map<string, number>();
  for (const effect of schedule ?? []) {
    listed.set(effect.playerID, (listed.get(effect.playerID) ?? 0) + effect.level);
    if (effect.expiryTurn >= arrivalTurn) {
      governing.set(effect.playerID, (governing.get(effect.playerID) ?? 0) + effect.level);
    }
  }

  const tierExpiry: (number | null)[] = [];
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
    // See `MarshalledBoard.tierExpiry`: inclusive on the wire, exclusive in the
    // engine. A unit carrying no level has nothing to expire and is recorded as
    // "no schedule" rather than as an expiry in the past, so a cloud never
    // pretends to know a horizon the wire did not give it.
    const expiry = snake.invulnerabilityExpiryTurn;
    tierExpiry.push(expiry === undefined || !Number.isFinite(expiry) ? null : expiry + 1);
    return {
      id: snake.id,
      type,
      teamID,
      isKing: isKingUnit(snake),
      // EXACT at the arrival turn, from the schedule where there is one. The
      // wire's collapsed (aggregate level, earliest expiry) pair cannot express
      // a unit holding two effects that lapse on different turns; the schedule
      // can, and settlement is handed both halves of the same reading.
      tier:
        schedule === undefined
          ? tierAtArrival(snake, currentTurn)
          : tierFromSchedule(snake, currentTurn, governing, listed),
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

  const potions = (board.invulnerabilityPotions ?? []).map(toIndex);

  const alive = new Set(living.map((s) => s.id));
  const effects = (schedule ?? [])
    // Effects that lapsed before the arrival turn are already out of every
    // unit's tier (`tierFromSchedule` counts exactly the ones that govern it),
    // so handing them to settlement would subtract a level nothing put in.
    .filter((e) => e.expiryTurn >= arrivalTurn && alive.has(e.playerID))
    .map((e) => ({ ...e }));

  return {
    fullWidth,
    fullHeight,
    units,
    config,
    potions,
    arrivalTurn,
    effects,
    potionsEnabled: board.invulnerabilityPotionsEnabled ?? potions.length > 0,
    potionWindowTurns: board.invulnerabilityPotionWindowTurns ?? DEFAULT_POTION_WINDOW_TURNS,
    pawnPromotionWeight: board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT,
    maxTurns: resolveMaxTurns(board.maxTurns),
    tierExpiry,
    startWeight,
    startHealth,
    teamOf,
    toIndex,
    toCell,
  };
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
 * ── THE PARTIAL-TIME-ADVANCE CONTRACT ──────────────────────────────────────
 *
 * The bot never simulates the whole board. It advances the units it is
 * modelling — ours, plus whichever enemies a caller has an intent for — and
 * leaves every other unit exactly as it found it. Those units are FROZEN, and
 * frozen means ONE TURN BEHIND IN TIME, not "chose to stand still":
 *
 *   A frozen unit is a COLLISION INCUMBENT AND NOTHING ELSE. It blocks. It
 *   contests, at its frozen tier and weight. A simulated mover can kill it,
 *   sever it, or lose to it, and every one of those outcomes is real and is
 *   kept. But it pays no hazard dose and no movement cost, eats nothing (food
 *   under it survives for whoever arrives later), never exhausts, never dies
 *   of the passage of time, and never triggers regicide except through a
 *   genuine interaction with something we did simulate.
 *
 * This is deliberate, and it is what the bot has always done: before the
 * engine was vendored, frozen units were simply left out of the hand-written
 * collision pass, so they had no side effects to speak of. Giving them a
 * default move instead would be worse than useless — it would bias every
 * evaluation toward one arbitrary world out of four.
 *
 * The vendored engine, correctly, knows nothing about any of this: an
 * empty-path unit is a unit that HELD, and holding is a real action with real
 * consequences. It doses a stationary unit standing on a hazard (kind-blind:
 * snakes and pieces alike), lets it eat and grow at its cell, kills it if the
 * dose exhausts it, and cascades regicide from that death. All correct for a
 * unit that actually held; all wrong for a unit that simply has not moved yet.
 *
 * So the bot reconciles, on its own side of the boundary — src/engine-vendor/
 * stays byte-identical to upstream, and the sync spec enforces that:
 *
 *  1. BEFORE resolving, a frozen unit is given a health the turn cannot spend
 *     (`FROZEN_HEALTH`). Health is not an input to ANY adjudication the engine
 *     performs — contests read tier and frozen weight, never health — so this
 *     cannot change a single collision outcome. What it does change is the
 *     health phase, which is exactly the half we are neutralising: the unit
 *     can no longer exhaust, so it cannot die of time, so it cannot cascade a
 *     regicide it had no part in.
 *  2. AFTER resolving, a frozen SURVIVOR gets its real health back, and any
 *     meal it took at its own cell is undone — the growth popped off and the
 *     food returned to the board. Eating happens in the end-of-turn phase,
 *     after every collision, so undoing it afterwards is exact.
 *
 * A frozen unit that DIED is left alone: with exhaustion off the table, the
 * only way it can be in the death registry is a mover's interaction, and those
 * deaths are the whole point of running the engine.
 *
 * KEEP THIS LAYER SMALL AND LEGIBLE. Fuller partial-board simulation is
 * planned for a future stack migration, at which point this reconciliation
 * should be deleted rather than extended.
 */

/**
 * The health a frozen unit is lent for the duration of one resolution. Big
 * enough that no single turn's charges can spend it — a frozen unit takes at
 * most one hazard dose, since it enters nothing — and restored immediately
 * afterwards. Never observed by a caller.
 */
const FROZEN_HEALTH = Number.MAX_SAFE_INTEGER;

/** What one unit is doing this turn, for the units we are actually modelling. */
export type StagedAction = { path: number[] } | { stagedMove: number };

/**
 * Settle a turn in which only `staged` units take one. Everyone else is
 * frozen under the contract above.
 *
 * This is the ONLY way the bot enters the vendored rules, so the contract
 * cannot be bypassed by adding a call site.
 *
 * SETTLEMENT, NOT RESOLUTION. `resolveTurn` answers "where is everything and
 * what died" and stops; `settleTurn` is that plus the end-of-turn effect
 * bookkeeping — expiry, the ally-buff cancel, potion collection — and it hands
 * back `tiers`, `effects` and `potions` as the NEXT turn starts from them.
 * Those three are the whole point: a caller that computed them itself would be
 * writing a second encoding of the rules, and a caller that carried them
 * forward unchanged would freeze every tier window at its observed value and
 * make "arm, collect, spend" three turns that all look the same.
 *
 * SPAWNING IS DELIBERATELY ABSENT — the module leaves it to its caller and the
 * bot declines it. Food and potions really do spawn, so a multi-turn line
 * assumes a barer board than the real one: conservative for a gain term,
 * optimistic for a denial term, and honest either way.
 */
export function resolvePartialTurn(
  marshalled: MarshalledBoard,
  staged: Map<string, StagedAction>
): Settlement {
  const frozen = marshalled.units.filter((u) => !staged.has(u.id));
  const units: ResolveUnit[] = marshalled.units.map((unit) => {
    const action = staged.get(unit.id);
    if (action) return { ...unit, ...action };
    return { ...unit, path: [], health: FROZEN_HEALTH };
  });

  // The potion half of the frozen contract, and it is the food repair's twin.
  // A frozen unit has not moved, so it cannot have arrived on anything; a
  // potion under its head would be collected by settlement on its behalf and
  // buy its whole team a window it never earned. Withheld from the input and
  // handed straight back, so the cell is still there for whoever arrives.
  // (A real board never presents one: collection empties the cell the turn a
  // unit arrives on it. Fixtures do.)
  const withheld: number[] = [];
  const frozenHeads = new Set(frozen.map((u) => u.occupancy[0] as number));
  const offered: number[] = [];
  for (const cell of marshalled.potions) {
    if (frozenHeads.has(cell)) withheld.push(cell);
    else offered.push(cell);
  }

  const result = settleTurn({
    ...marshalled.config,
    units,
    turn: marshalled.arrivalTurn,
    teamOf: Object.fromEntries(marshalled.teamOf),
    effects: marshalled.effects,
    potions: offered,
    potionsEnabled: marshalled.potionsEnabled,
    potionWindowTurns: marshalled.potionWindowTurns,
    pawnPromotionWeight: marshalled.pawnPromotionWeight,
    maxTurns: marshalled.maxTurns,
  }, NO_SPAWN);
  result.potions.push(...withheld);

  // Give back what the turn should never have taken. `result` is freshly
  // built by every settleTurn call and nobody else holds a reference to it,
  // so repairing it in place is the cheapest honest thing to do.
  const inputFood = new Set(marshalled.config.food);
  for (const unit of frozen) {
    const settled = result.board[unit.id];
    if (!settled) continue; // died to a real interaction — that death stands
    settled.health = marshalled.startHealth.get(unit.id) as number;

    // A meal it should never have reached: the food phase grew it by one cell
    // and took the food off the board. Both are undone, so the meal is still
    // there for whoever actually arrives.
    const cell = settled.occupancy[0];
    if (inputFood.has(cell) && !result.food.includes(cell)) {
      settled.occupancy.pop();
      result.food.push(cell);
    }
  }
  return result;
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
  const outcomes = intents.map((intent) => {
    const staged = new Map<string, StagedAction>([[ourID, { path }]]);
    intent.forEach((cell, id) => staged.set(id, { stagedMove: cell }));
    return readOutcome(marshalled, ourID, path, resolvePartialTurn(marshalled, staged));
  });
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
  const result = resolvePartialTurn(marshalled, new Map([[unit.id, { path }]]));
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
export type { ResolveUnit, ResolveTurnInput, TurnResolution, Settlement };
export { resolveTurn, settleTurn, DEFAULT_POTION_WINDOW_TURNS };
export type { Snake };
