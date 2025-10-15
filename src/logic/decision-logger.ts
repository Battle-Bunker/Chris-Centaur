import { Pool } from 'pg';
import { Direction } from '../types/battlesnake';

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
      // My snake metrics
      myLength: number;
      myTerritory: number;
      myControlledFood: number;
      
      // Team metrics
      teamLength: number;
      teamTerritory: number;
      teamControlledFood: number;
      
      // Distance/proximity metrics
      foodDistance: number;
      foodProximity: number;
      foodEaten: number;
      
      // Enemy metrics
      enemyTerritory?: number;
      enemyLength?: number;
      
      // Life/death metrics
      kills?: number;
      deaths?: number;
      
      // Legacy fields for backward compatibility
      fertileTerritory?: number;
      foodDistanceInverse?: number;
      myFoodCount?: number;
      teamFoodCount?: number;
      teamFertileScore?: number;
      
      // Weights and weighted scores
      weights: any;  // Use any for flexibility with old/new formats
      weighted: any;  // Use any for flexibility with old/new formats
    };
  }[];
  gameState: any;
}

interface QueuedEntry extends DecisionLogEntry {
  retries: number;
}

export class DecisionLogger {
  private static instance: DecisionLogger;
  private pool: Pool;
  private isInitialized = false;
  
  // Promise chain for sequential async processing (prevents race conditions)
  private processingChain: Promise<void> = Promise.resolve();
  
  // Queue configuration
  private readonly MAX_QUEUE_SIZE = 10000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private queue: QueuedEntry[] = [];
  private droppedCount = 0;

  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    
    // Initialize schema on startup
    this.initialize().catch(error => {
      console.error('[DecisionLogger] Failed to initialize on startup:', error);
    });
  }

  public static getInstance(): DecisionLogger {
    if (!DecisionLogger.instance) {
      DecisionLogger.instance = new DecisionLogger();
    }
    return DecisionLogger.instance;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Create table
      await this.pool.query(`
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
          game_state JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      
      // Create indexes (separate statements for pg compatibility)
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_decision_logs_game_id ON decision_logs(game_id);');
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_decision_logs_snake_id ON decision_logs(snake_id);');
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_decision_logs_turn ON decision_logs(turn);');
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_decision_logs_timestamp ON decision_logs(timestamp);');
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_decision_logs_game_snake_turn ON decision_logs(game_id, snake_id, turn);');
      
      this.isInitialized = true;
      console.log('[DecisionLogger] Database schema initialized');
    } catch (error) {
      console.error('[DecisionLogger] Failed to initialize schema:', error);
      throw error;
    }
  }

  // Non-blocking log decision with queue management
  public logDecision(entry: DecisionLogEntry): void {
    // Check queue size limit
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Drop oldest entries (FIFO) and warn
      const dropped = this.queue.shift();
      this.droppedCount++;
      
      if (this.droppedCount % 100 === 0) {
        console.warn(`[DecisionLogger] Queue full! Dropped ${this.droppedCount} total entries. Last dropped: game=${dropped?.gameId}, turn=${dropped?.turn}`);
      }
    }
    
    // Add to queue with retry counter
    const queuedEntry: QueuedEntry = { ...entry, retries: 0 };
    this.queue.push(queuedEntry);
    
    // Chain the processing (ensures sequential order and prevents race conditions)
    this.processingChain = this.processingChain
      .then(() => this.processNextEntry())
      .catch(error => {
        console.error('[DecisionLogger] Processing chain error:', error);
      });
  }

  private async processNextEntry(): Promise<void> {
    const entry = this.queue.shift();
    if (!entry) return;
    
    try {
      await this.insertEntry(entry);
    } catch (error) {
      await this.handleInsertError(entry, error);
    }
  }

  private async insertEntry(entry: QueuedEntry): Promise<void> {
    await this.initialize(); // Ensure schema exists
    
    const query = `
      INSERT INTO decision_logs (
        game_id, snake_id, snake_name, turn,
        position_x, position_y, health,
        safe_moves, chosen_move, move_evaluations, game_state
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      JSON.stringify(entry.moveEvaluations),
      JSON.stringify(entry.gameState)
    ];
    
    await this.pool.query(query, values);
    console.log(`[DecisionLogger] Logged turn ${entry.turn} for game ${entry.gameId}`);
  }

  private async handleInsertError(entry: QueuedEntry, error: any): Promise<void> {
    entry.retries++;
    
    if (entry.retries <= this.MAX_RETRIES) {
      // Exponential backoff with jitter
      const delay = this.RETRY_DELAY_MS * Math.pow(2, entry.retries - 1) * (0.5 + Math.random() * 0.5);
      
      console.warn(`[DecisionLogger] Insert failed, retry ${entry.retries}/${this.MAX_RETRIES} after ${Math.round(delay)}ms:`, error.message);
      
      // Re-queue for retry with delay
      await new Promise(resolve => setTimeout(resolve, delay));
      this.queue.unshift(entry); // Put back at front to maintain order
    } else {
      // Max retries exceeded, drop the entry
      console.error(`[DecisionLogger] Failed to log after ${this.MAX_RETRIES} retries. Dropping entry for game ${entry.gameId}, turn ${entry.turn}:`, error);
      this.droppedCount++;
    }
  }

  // Query logs with filters (ensures schema exists first)
  public async queryLogs(filters: {
    gameId?: string;
    snakeId?: string;
    startTurn?: number;
    endTurn?: number;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    try {
      await this.initialize(); // Ensure schema exists
      
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
      
      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('[DecisionLogger] Failed to query logs:', error);
      return [];
    }
  }

  // Get distinct games (ensures schema exists first)
  public async getGames(): Promise<{ game_id: string; snake_id: string; snake_name: string; min_turn: number; max_turn: number; count: number; timestamp: string; turns: number }[]> {
    try {
      await this.initialize(); // Ensure schema exists
      
      const query = `
        SELECT 
          game_id, 
          snake_id, 
          snake_name,
          MIN(turn) as min_turn,
          MAX(turn) as max_turn,
          COUNT(*) as count,
          MAX(turn) - MIN(turn) + 1 as turns,
          MAX(timestamp) as timestamp
        FROM decision_logs
        GROUP BY game_id, snake_id, snake_name
        ORDER BY MAX(timestamp) DESC
        LIMIT 100
      `;
      
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('[DecisionLogger] Failed to get games:', error);
      return [];
    }
  }

  // Clear old logs (ensures schema exists first)
  public async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      await this.initialize(); // Ensure schema exists
      
      const query = `
        DELETE FROM decision_logs 
        WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'
      `;
      
      await this.pool.query(query);
      console.log(`[DecisionLogger] Cleared logs older than ${daysToKeep} days`);
    } catch (error) {
      console.error('[DecisionLogger] Failed to clear old logs:', error);
    }
  }

  // Graceful shutdown - wait for pending logs to complete
  public async shutdown(): Promise<void> {
    console.log('[DecisionLogger] Shutting down, flushing queue...');
    
    // Wait for the processing chain to complete
    await this.processingChain;
    
    // Process any remaining items
    while (this.queue.length > 0) {
      await this.processNextEntry();
    }
    
    if (this.droppedCount > 0) {
      console.warn(`[DecisionLogger] Shutdown complete. Total dropped entries: ${this.droppedCount}`);
    }
    
    await this.pool.end();
  }
  
  // Get queue stats for monitoring
  public getQueueStats(): { queueSize: number; droppedCount: number; maxQueueSize: number } {
    return {
      queueSize: this.queue.length,
      droppedCount: this.droppedCount,
      maxQueueSize: this.MAX_QUEUE_SIZE
    };
  }
}