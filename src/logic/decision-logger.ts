import { Pool } from 'pg';
import { MoveEvaluation } from './evaluator';
import { Direction } from '../types/battlesnake';

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface DecisionLogEntry {
  gameId: string;
  snakeId: string;
  snakeName: string;
  turn: number;
  position: { x: number; y: number };
  health: number;
  safeMoves: Direction[];
  chosenMove: Direction;
  moveEvaluations: {
    move: Direction;
    score: number;
    numStates: number;
    breakdown?: {
      foodDistance: number;
      foodDistanceInverse: number;
      myTerritory: number;
      myFoodCount: number;
      teamTerritory: number;
      teamFoodCount: number;
      teamFertileScore: number;
      myLength: number;
      teamLength: number;
      weights: {
        foodDistance: number;
        fertileTerritory: number;
        teamLength: number;
      };
      weighted: {
        foodDistanceScore: number;
        fertileScore: number;
        teamLengthScore: number;
      };
    };
  }[];
}

export class DecisionLogger {
  private static instance: DecisionLogger;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): DecisionLogger {
    if (!DecisionLogger.instance) {
      DecisionLogger.instance = new DecisionLogger();
    }
    return DecisionLogger.instance;
  }

  // Initialize the database schema
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      const schemaSQL = `
        CREATE TABLE IF NOT EXISTS decision_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          game_id VARCHAR(255) NOT NULL,
          snake_id VARCHAR(255) NOT NULL,
          snake_name VARCHAR(255),
          turn INTEGER NOT NULL,
          position_x INTEGER NOT NULL,
          position_y INTEGER NOT NULL,
          health INTEGER NOT NULL,
          safe_moves TEXT[],
          chosen_move VARCHAR(10) NOT NULL,
          move_evaluations JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_decision_logs_game_id ON decision_logs(game_id);
        CREATE INDEX IF NOT EXISTS idx_decision_logs_snake_id ON decision_logs(snake_id);
        CREATE INDEX IF NOT EXISTS idx_decision_logs_turn ON decision_logs(turn);
        CREATE INDEX IF NOT EXISTS idx_decision_logs_timestamp ON decision_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_decision_logs_game_snake_turn ON decision_logs(game_id, snake_id, turn);
      `;
      
      await pool.query(schemaSQL);
      this.isInitialized = true;
      console.log('[DecisionLogger] Database schema initialized');
    } catch (error) {
      console.error('[DecisionLogger] Failed to initialize schema:', error);
    }
  }

  // Log a decision
  public async logDecision(entry: DecisionLogEntry): Promise<void> {
    try {
      await this.initialize();
      
      const query = `
        INSERT INTO decision_logs (
          game_id, snake_id, snake_name, turn,
          position_x, position_y, health,
          safe_moves, chosen_move, move_evaluations
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      
      const values = [
        entry.gameId,
        entry.snakeId,
        entry.snakeName,
        entry.turn,
        entry.position.x,
        entry.position.y,
        entry.health,
        entry.safeMoves,
        entry.chosenMove,
        JSON.stringify(entry.moveEvaluations)
      ];
      
      await pool.query(query, values);
    } catch (error) {
      console.error('[DecisionLogger] Failed to log decision:', error);
    }
  }

  // Query logs with filters
  public async queryLogs(filters: {
    gameId?: string;
    snakeId?: string;
    startTurn?: number;
    endTurn?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    try {
      await this.initialize();
      
      let query = 'SELECT * FROM decision_logs WHERE 1=1';
      const values: any[] = [];
      let paramCount = 0;
      
      if (filters.gameId) {
        query += ` AND game_id = $${++paramCount}`;
        values.push(filters.gameId);
      }
      
      if (filters.snakeId) {
        query += ` AND snake_id = $${++paramCount}`;
        values.push(filters.snakeId);
      }
      
      if (filters.startTurn !== undefined) {
        query += ` AND turn >= $${++paramCount}`;
        values.push(filters.startTurn);
      }
      
      if (filters.endTurn !== undefined) {
        query += ` AND turn <= $${++paramCount}`;
        values.push(filters.endTurn);
      }
      
      query += ' ORDER BY game_id, snake_id, turn';
      
      if (filters.limit) {
        query += ` LIMIT $${++paramCount}`;
        values.push(filters.limit);
      }
      
      if (filters.offset) {
        query += ` OFFSET $${++paramCount}`;
        values.push(filters.offset);
      }
      
      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('[DecisionLogger] Failed to query logs:', error);
      return [];
    }
  }

  // Get distinct games
  public async getGames(): Promise<{ game_id: string; snake_id: string; snake_name: string; min_turn: number; max_turn: number; count: number }[]> {
    try {
      await this.initialize();
      
      const query = `
        SELECT 
          game_id, 
          snake_id, 
          snake_name,
          MIN(turn) as min_turn,
          MAX(turn) as max_turn,
          COUNT(*) as count
        FROM decision_logs
        GROUP BY game_id, snake_id, snake_name
        ORDER BY MAX(timestamp) DESC
        LIMIT 100
      `;
      
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('[DecisionLogger] Failed to get games:', error);
      return [];
    }
  }

  // Clear old logs (optional cleanup)
  public async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      await this.initialize();
      
      const query = `
        DELETE FROM decision_logs 
        WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'
      `;
      
      await pool.query(query);
      console.log(`[DecisionLogger] Cleared logs older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[DecisionLogger] Failed to clear old logs:', error);
    }
  }
}