import { Storage, File } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Simplified object storage service for logging
export class ObjectStorageService {
  constructor() {}

  // Gets the logs bucket name
  getLogsBucket(): string {
    return process.env.LOGS_BUCKET || "battlesnake-logs";
  }

  // Saves a JSON log entry to object storage
  async saveLogEntry(logData: any): Promise<string> {
    const timestamp = new Date().toISOString();
    const gameId = logData.gameId || "unknown";
    const turn = logData.turn || 0;
    const snakeId = logData.snakeId || "unknown";
    
    // Create a structured path for the log
    const logId = randomUUID();
    const objectName = `logs/${gameId}/${snakeId}/turn-${turn.toString().padStart(4, '0')}-${logId}.json`;
    
    const bucket = objectStorageClient.bucket(this.getLogsBucket());
    const file = bucket.file(objectName);
    
    // Add metadata to the log
    const enrichedLog = {
      ...logData,
      timestamp,
      logId,
      objectPath: `/${this.getLogsBucket()}/${objectName}`
    };
    
    // Save the log as JSON
    await file.save(JSON.stringify(enrichedLog, null, 2), {
      contentType: "application/json",
      metadata: {
        gameId,
        snakeId,
        turn: turn.toString(),
        timestamp,
      },
    });
    
    return objectName;
  }

  // Query logs with filters
  async queryLogs(filters: {
    gameId?: string;
    snakeId?: string;
    startTurn?: number;
    endTurn?: number;
    limit?: number;
  }): Promise<any[]> {
    const bucket = objectStorageClient.bucket(this.getLogsBucket());
    
    // Build prefix based on filters
    let prefix = "logs/";
    if (filters.gameId) {
      prefix += `${filters.gameId}/`;
      if (filters.snakeId) {
        prefix += `${filters.snakeId}/`;
      }
    }
    
    const [files] = await bucket.getFiles({
      prefix,
      maxResults: filters.limit || 1000,
    });
    
    const logs = [];
    for (const file of files) {
      // Filter by turn if specified
      if (filters.startTurn !== undefined || filters.endTurn !== undefined) {
        const match = file.name.match(/turn-(\d+)/);
        if (match) {
          const turn = parseInt(match[1], 10);
          if (filters.startTurn !== undefined && turn < filters.startTurn) continue;
          if (filters.endTurn !== undefined && turn > filters.endTurn) continue;
        }
      }
      
      // Download and parse the log
      const [content] = await file.download();
      try {
        const log = JSON.parse(content.toString());
        logs.push(log);
      } catch (error) {
        console.error(`Failed to parse log ${file.name}:`, error);
      }
    }
    
    // Sort by turn
    logs.sort((a, b) => (a.turn || 0) - (b.turn || 0));
    
    return logs;
  }

  // Get a specific log file
  async getLog(objectPath: string): Promise<any | null> {
    try {
      const parts = objectPath.split('/');
      const bucketName = parts[1];
      const objectName = parts.slice(2).join('/');
      
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      
      const [exists] = await file.exists();
      if (!exists) {
        return null;
      }
      
      const [content] = await file.download();
      return JSON.parse(content.toString());
    } catch (error) {
      console.error(`Failed to get log ${objectPath}:`, error);
      return null;
    }
  }

  // List available games
  async listGames(): Promise<string[]> {
    const bucket = objectStorageClient.bucket(this.getLogsBucket());
    const [files] = await bucket.getFiles({
      prefix: "logs/",
      delimiter: "/",
    });
    
    const games = new Set<string>();
    for (const file of files) {
      const parts = file.name.split('/');
      if (parts.length > 1) {
        games.add(parts[1]);
      }
    }
    
    return Array.from(games).sort();
  }
}