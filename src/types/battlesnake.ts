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
  // setup (GameSetup.pawnPromotionWeight). The Simulator reads this to mirror
  // the engine's post-eat/growth promotion step. Absent means the engine
  // default — readers use `board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT`
  // (piece-moves.ts).
  pawnPromotionWeight?: number;
  // Per-unit-type max health from the setup (GameSetup.maxHealthPerUnit),
  // keyed by unit type regardless of whether that type is currently fielded —
  // a pawns-only setup can still configure the queen's max for the moment a
  // pawn promotes. A promoted pawn's health is clamped DOWN (never raised) to
  // this map's 'queen' entry; absent map or absent key means the engine
  // default of 100. Distinct from `Snake.maxHealth`, which is already
  // resolved against a unit's CURRENT type.
  maxHealthPerUnit?: Partial<Record<string, number>>;
  snakes: Snake[];
  fertileTiles?: Coord[];
  invulnerabilityPotions?: Coord[];
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
  // Authoritative map of unitId -> the board cell a chess piece died on
  // during the transition into this turn, read from the wire turn's `moves`
  // map (which records a dead piece's actual death square — mid-path for a
  // slider stopped in flight). Pieces only: a dead snake's cell derives from
  // `lastMoves`. Present only on turns where a piece died.
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