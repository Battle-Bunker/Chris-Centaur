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
}

export interface Board {
  height: number;
  width: number;
  food: Coord[];
  hazards: Coord[];
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
}

// A board-only view of a game with NO `you`. The centaur server controls many
// snakes against ONE shared board, so a single shared state cannot carry a
// meaningful "our snake". Storing the shared board as a BoardSnapshot makes it a
// compile error to read a per-snake perspective (invulnerability/severability)
// off it — callers must obtain a real GameState for a specific snake by ID.
export type BoardSnapshot = Omit<GameState, 'you'>;

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface TeamInfo {
  color: string;
  snakes: Snake[];
  totalLength: number;
}

export interface SimulationConfig {
  maxDistance: number;
  numRandomMoves: number;
  maxSimulations: number;
  maxEvaluationTimeMs: number;
  tailSafetyRule?: 'official' | 'custom'; // 'official': tail stays when eating, 'custom': grows next turn
}