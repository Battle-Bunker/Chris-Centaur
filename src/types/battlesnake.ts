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
}

export interface Board {
  height: number;
  width: number;
  food: Coord[];
  hazards: Coord[];
  snakes: Snake[];
  fertileTiles?: Coord[];
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
}

export interface MoveResponse {
  move: string;
  shout?: string;
}

export interface SnakeInfoResponse {
  apiversion: string;
  author?: string;
  color?: string;
  head?: string;
  tail?: string;
  version?: string;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface TeamInfo {
  color: string;
  snakes: Snake[];
  totalLength: number;
}

export interface VoronoiResult {
  territories: Map<string, number>;
  teamTerritories: Map<string, number>;
  fertileScores?: Map<string, number>;
  teamFertileScores?: Map<string, number>;
  foodControlled?: Map<string, number>;
  teamFoodControlled?: Map<string, number>;
  foodDistances?: Map<string, number>;
  teamFoodDistances?: Map<string, number>;
}

export interface SimulationConfig {
  maxDistance: number;
  numRandomMoves: number;
  maxSimulations: number;
  maxEvaluationTimeMs: number;
  tailSafetyRule?: 'official' | 'custom'; // 'official': tail stays when eating, 'custom': grows next turn
}