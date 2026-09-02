import type { ActiveEffect } from '@shared/types/Game';

export interface Coord {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  name: string;
  latency: string;
  health: number;
  body: Coord[];
  head: Coord;
  length: number;
  shout: string;
  squad: string;
  customizations: {
    color: string;
    head: string;
    tail: string;
  };
  // Head glyph: the snake's letter within its team ("A".."Z").
  letter?: string;
  // Read-side fallback only: historical decision_logs game_state rows stored an
  // emoji head glyph. Nothing writes this anymore.
  emoji?: string;
  invulnerabilityLevel?: number;
  // Last absolute game turn on which invulnerabilityLevel still applies. Supplied
  // by the game server; when absent the level is assumed to apply this turn only.
  invulnerabilityExpiryTurn?: number;
  teamID?: string;
  // The team's human display NAME (the controlling centaur's name, snapshotted
  // into the game setup). `teamID` is an opaque document id and is not fit to
  // show a reader; this is. Absent on historical logs predating the field —
  // readers fall back to the name prefix of `name` ("Chris A" -> "Chris").
  teamName?: string;
  // Chess-piece support: the unit's current type ("pawn" | "knight" | "bishop" |
  // "rook" | "queen" | "king"), absent or "snake" for ordinary snakes. Pieces
  // arrive as 1-cell units whose `length` is their WEIGHT (stack size), not
  // their body cell count.
  unitType?: string;
  // The unit's max health from the game setup's per-type config
  // (maxHealthPerUnit); eating restores health to this. Absent means the
  // engine default of 100 — readers use `snake.maxHealth ?? 100`.
  maxHealth?: number;
  // Unit orientation (EVERY unit in EVERY game — Turn.orientation), VERBATIM
  // from the TacticToes wire (full-board convention: dy grows DOWNWARD).
  // Toward the board centre at spawn, the moved direction after each turn (knight:
  // exact L-offset; snake: head-minus-neck; pawns turn only via rotation);
  // holds keep it. Note api y is flipped, so the faced api cell is
  // {x + dx, y - dy}; canvas rows share the wire's sign (no flip when
  // drawing).
  orientation: { dx: number; dy: number };
}

export interface Board {
  height: number;
  width: number;
  food: Coord[];
  hazards: Coord[];
  // Damage a unit takes on ENTERING a hazard square, from the game setup
  // (GameSetup.hazardDamage). Death only at health <= 0 — hazards are
  // damage-based, not instant death. Absent means the engine default of 100 —
  // readers use `board.hazardDamage ?? 100`.
  hazardDamage?: number;
  // Weight threshold at which a pawn promotes to a queen, from the game
  // setup (GameSetup.pawnPromotionWeight). Lookahead reads this to mirror
  // the engine's post-eat/growth promotion step. Absent means the engine
  // default — readers use `board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT`
  // (logic/staging-legality.ts).
  pawnPromotionWeight?: number;
  // The turn count the game is adjudicated at (GameSetup.maxTurns): absent
  // means the engine's default limit, null means unlimited.
  maxTurns?: number | null;
  // Per-unit-type max health from the setup (GameSetup.maxHealthPerUnit),
  // keyed by unit type regardless of whether that type is currently fielded —
  // a pawns-only setup can still configure the queen's max for the moment a
  // pawn promotes. A promoted pawn's health is clamped DOWN (never raised) to
  // this map's 'queen' entry; absent map or absent key means the engine
  // default of 100. Distinct from `Snake.maxHealth`, which is already
  // resolved against a unit's CURRENT type.
  maxHealthPerUnit?: Partial<Record<string, number>>;
  snakes: Snake[];
  // Collisions the game server resolved while producing THIS board, in api
  // coords. ONE RECORD PER CELL PER EVENT: a unit that died contributes one
  // record on the cell it died on, not one per body cell. The only event that
  // spans two cells is an edge-contest tie, which emits one record on each
  // unit's own cell. Present only on turns where something collided.
  clashes?: Clash[];
  // Cells cut from each SURVIVING snake this turn by a sever, in api coords —
  // non-fatal damage, keyed by unit id. Present only on turns where a sever
  // actually truncated somebody.
  severedCells?: Record<string, Coord[]>;
  fertileTiles?: Coord[];
  invulnerabilityPotions?: Coord[];
  // The invulnerability effect schedule as this board opened — the SAME shape
  // the game server keeps and `settleTurn` takes and returns. It rides on the
  // board because it is the authoritative account of every unit's tier: a
  // simulated board's schedule is `Settlement.effects`, written by the forward
  // step, and an observed board's is the wire's `Turn.activeEffects`. Absent
  // on hand-built fixtures and on documents predating the field, in which case
  // readers reconstruct what they can from the per-snake level and expiry.
  activeEffects?: ActiveEffect[];
  // Are potions live at all (GameSetup.invulnerabilityPotionEnabled)? With
  // this off a potion cell is inert scenery: nothing spawns and nothing
  // collects. Absent means off.
  invulnerabilityPotionsEnabled?: boolean;
  // How many turns a collected potion's debuff and its allies' buffs last
  // (GameSetup.invulnerabilityPotionWindowTurns). Absent means the engine's
  // own DEFAULT_POTION_WINDOW_TURNS. It rides on the board so nothing on this
  // side has to hardcode the window the engine used to hardcode.
  invulnerabilityPotionWindowTurns?: number;
}

/**
 * What produced a clash record (and, in a death registry, what killed the
 * unit). Rendering branches on THIS and on the explicit id lists — never on
 * the `reason` string, which is display text the server rewords at will.
 */
export type ClashKind =
  | 'contest'
  | 'edge'
  | 'bodyBlock'
  | 'sever'
  // Exhausted by hazard damage / by movement cost. Both HALT the unit where
  // it stood; both are only PROVISIONALLY fatal, settled at end of turn after
  // the food phase — a unit that halted on food recovers. A record of either
  // kind with an empty victimIDs is that recovered case, and draws no death.
  | 'hazard'
  | 'exhaustion'
  | 'wall'
  | 'self'
  | 'regicide';

/**
 * One adjudicated collision event at one cell, in the renderer's coordinate
 * space. Purely descriptive: it names WHERE, WHEN (which within-turn sub-step),
 * WHAT KIND of event it was, WHO took part and WHICH of them died, and says
 * nothing about who controls what — a neutral spectator reads it exactly as a
 * player does.
 *
 * Who died is stated OUTRIGHT by `victimIDs`. It is never inferred from the
 * resulting board: under the engine's frozen-state rule a dead unit stays on
 * the board as a collision object for the rest of the turn, so board occupancy
 * mid-turn says nothing about survival, and a unit that died in an EARLIER
 * event can legitimately appear as a participant in a later one.
 */
export interface Clash {
  cell: Coord;
  // The within-turn sub-step this event happened on. Always present: a
  // whole-move unit records 1, a slider records the step of its ray it was on.
  subStep: number;
  kind: ClashKind;
  // Every unit involved, survivors included.
  playerIDs: string[];
  // The subset of playerIDs that died HERE. An EMPTY list is meaningful: the
  // event hurt nobody fatally — a sever, or an exhaustion the unit recovered
  // from by halting on food.
  victimIDs: string[];
  // The unique unit left standing at this cell, when there is one.
  survivorID?: string;
  // Display text only.
  reason: string;
}

export interface Game {
  id: string;
  ruleset: {
    name: string;
    version: string;
    settings: any;
  };
  map: string;
  timeout: number;
  source: string;
}

export interface GameState {
  game: Game;
  turn: number;
  board: Board;
  you: Snake;
  // Authoritative map of snakeId -> the move the server actually made on that
  // snake's behalf LAST turn (the transition into this turn), including for
  // snakes that died at the end of last turn (they're already gone from
  // `board.snakes`). Lets us render a dead snake's true final cell instead of
  // guessing. Optional for backward compatibility with engines/logs that
  // predate it.
  lastMoves?: Record<string, Direction>;
  // Authoritative map of unitId -> the board cell it died on during the
  // transition into this turn, read from the wire turn's `deaths` registry.
  // EVERY unit removed that turn is in it — snakes and pieces, killed and
  // fatally exhausted alike — so this, not `lastMoves`, is the death channel.
  // (A snake that loses an edge contest dies on its OWN start cell without
  // moving at all, which no direction-derived cell can express.) Present only
  // on turns where somebody died.
  deathCells?: Record<string, Coord>;
}

// A board-only view of a game with NO `you`. The centaur server controls many
// snakes against ONE shared board, so a single shared state cannot carry a
// meaningful "our snake". Storing the shared board as a BoardSnapshot makes it a
// compile error to read a per-snake perspective (invulnerability/severability)
// off it — callers must obtain a real GameState for a specific snake by ID.
export type BoardSnapshot = Omit<GameState, 'you'>;

export type Direction = 'up' | 'down' | 'left' | 'right';

// A staged move on the centaur side: snakes stage a Direction; chess pieces
// stage the FULL-BOARD index of their destination square (the same integer the
// TacticToes wire carries in privateMoves.move — a piece's own square means
// stay). Direction-only logic must narrow with `typeof move === 'string'`.
export type CentaurMove = Direction | number;

export interface TeamInfo {
  color: string;
  snakes: Snake[];
  totalLength: number;
}

export interface SimulationConfig {
  maxDistance: number;
  maxEvaluationTimeMs: number;
}