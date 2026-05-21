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
    projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
    breakdown?: {
      myLength: number;
      myTerritory: number;
      myControlledFood: number;
      myControlledFertile: number;

      teamLength: number;
      teamTerritory: number;
      teamControlledFood: number;

      foodDistance: number;
      foodProximity: number;
      foodEaten: number;

      enemyTerritory?: number;
      enemyLength?: number;

      kills?: number;
      deaths?: number;

      waypointGoto?: number;
      waypointNear?: number;


      fertileTerritory?: number;
      foodDistanceInverse?: number;
      myFoodCount?: number;
      teamFoodCount?: number;
      teamFertileScore?: number;

      weights: any;
      weighted: any;
    };
  }[];
  gameState: any;
  territoryCells?: { [snakeId: string]: { x: number; y: number }[] };
}

// Compact pre-serialized row. Holds only primitives + already-stringified
// JSON blobs so the original gameState / territoryCells object graphs can be
// GC'd immediately after logDecision() returns. This is the key memory win:
// even a backed-up queue only holds compact strings, not live nested objects.
interface SerializedRow {
  gameId: string;
  snakeId: string;
  snakeName: string;
  turn: number;
  positionX: number;
  positionY: number;
  health: number;
  safeMoves: Direction[];
  chosenMove: Direction;
  moveEvaluationsJson: string;
  gameStateJson: string;
  retries: number;
}

const BATCH_SIZE = 100;
const COLUMNS_PER_ROW = 11;

export class DecisionLogger {
  private static instance: DecisionLogger;
  private pool: Pool;
  private isInitialized = false;

  private readonly MAX_QUEUE_SIZE = 50000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private queue: SerializedRow[] = [];
  private droppedCount = 0;

  // Worker loop coordination
  private workerRunning = true;
  private workerPromise: Promise<void>;
  private wakeup: (() => void) | null = null;

  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.initialize().catch(error => {
      console.error('[DecisionLogger] Failed to initialize on startup:', error);
    });

    this.workerPromise = this.runWorkerLoop();
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

  // Synchronous, non-blocking enqueue. Pre-serializes everything so the live
  // gameState / territoryCells object graphs become GC-eligible immediately.
  public logDecision(entry: DecisionLogEntry): void {
    let moveEvaluationsJson: string;
    let gameStateJson: string;
    try {
      const moveEvalWithTerritory = {
        evaluations: entry.moveEvaluations,
        territoryCells: entry.territoryCells || {},
      };
      moveEvaluationsJson = JSON.stringify(moveEvalWithTerritory);
      gameStateJson = JSON.stringify(entry.gameState);
    } catch (e) {
      console.error('[DecisionLogger] Failed to serialize entry, dropping:', e);
      return;
    }

    const row: SerializedRow = {
      gameId: entry.gameId,
      snakeId: entry.snakeId,
      snakeName: entry.snakeName,
      turn: entry.turn,
      positionX: entry.position.x,
      positionY: entry.position.y,
      health: entry.health,
      safeMoves: entry.safeMoves,
      chosenMove: entry.chosenMove,
      moveEvaluationsJson,
      gameStateJson,
      retries: 0,
    };

    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      const dropped = this.queue.shift();
      this.droppedCount++;
      if (this.droppedCount % 100 === 0) {
        console.warn(`[DecisionLogger] Queue full! Dropped ${this.droppedCount} total entries. Last dropped: game=${dropped?.gameId}, turn=${dropped?.turn}`);
      }
    }

    this.queue.push(row);
    this.signalWakeup();
  }

  private signalWakeup(): void {
    if (this.wakeup) {
      const w = this.wakeup;
      this.wakeup = null;
      w();
    }
  }

  private waitForWork(): Promise<void> {
    return new Promise<void>(resolve => {
      this.wakeup = resolve;
    });
  }

  private async runWorkerLoop(): Promise<void> {
    // Ensure schema is up before we start draining.
    try {
      await this.initialize();
    } catch {
      // initialize() will retry on first insert attempt
    }

    while (this.workerRunning || this.queue.length > 0) {
      if (this.queue.length === 0) {
        if (!this.workerRunning) break;
        await this.waitForWork();
        continue;
      }

      const batch = this.queue.splice(0, BATCH_SIZE);
      try {
        await this.insertBatch(batch);
      } catch (error) {
        // Batched insert failed — fall back to per-row retry with backoff so
        // one poison row can't block the whole queue.
        console.warn(`[DecisionLogger] Batch insert failed (${batch.length} rows), falling back to per-row retry:`, (error as Error).message);
        for (const row of batch) {
          await this.insertSingleWithRetry(row);
        }
      }
    }
  }

  private async insertBatch(rows: SerializedRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.initialize();

    const values: any[] = [];
    const valuePlaceholders: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const base = i * COLUMNS_PER_ROW;
      valuePlaceholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`,
      );
      values.push(
        r.gameId, r.snakeId, r.snakeName, r.turn,
        r.positionX, r.positionY, r.health,
        r.safeMoves, r.chosenMove,
        r.moveEvaluationsJson, r.gameStateJson,
      );
    }

    const query = `
      INSERT INTO decision_logs (
        game_id, snake_id, snake_name, turn,
        position_x, position_y, health,
        safe_moves, chosen_move, move_evaluations, game_state
      ) VALUES ${valuePlaceholders.join(',')}
    `;

    await this.pool.query(query, values);
  }

  private async insertSingleWithRetry(row: SerializedRow): Promise<void> {
    while (true) {
      try {
        await this.insertBatch([row]);
        return;
      } catch (error) {
        row.retries++;
        if (row.retries > this.MAX_RETRIES) {
          console.error(`[DecisionLogger] Failed to log after ${this.MAX_RETRIES} retries. Dropping entry for game ${row.gameId}, turn ${row.turn}:`, error);
          this.droppedCount++;
          return;
        }
        const delay = this.RETRY_DELAY_MS * Math.pow(2, row.retries - 1) * (0.5 + Math.random() * 0.5);
        console.warn(`[DecisionLogger] Insert failed, retry ${row.retries}/${this.MAX_RETRIES} after ${Math.round(delay)}ms:`, (error as Error).message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

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

      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error) {
      console.error('[DecisionLogger] Failed to query logs:', error);
      return [];
    }
  }

  public async getGames(): Promise<{ game_id: string; snake_id: string; snake_name: string; min_turn: number; max_turn: number; count: number; timestamp: string; turns: number }[]> {
    try {
      await this.initialize();

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

  public async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      await this.initialize();
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

  public async shutdown(): Promise<void> {
    console.log(`[DecisionLogger] Shutting down, flushing ${this.queue.length} queued entries...`);

    this.workerRunning = false;
    this.signalWakeup();

    await this.workerPromise;

    if (this.droppedCount > 0) {
      console.warn(`[DecisionLogger] Shutdown complete. Total dropped entries: ${this.droppedCount}`);
    } else {
      console.log('[DecisionLogger] Shutdown complete. All entries flushed.');
    }

    await this.pool.end();
  }

  public getQueueStats(): { queueSize: number; droppedCount: number; maxQueueSize: number } {
    return {
      queueSize: this.queue.length,
      droppedCount: this.droppedCount,
      maxQueueSize: this.MAX_QUEUE_SIZE,
    };
  }
}
