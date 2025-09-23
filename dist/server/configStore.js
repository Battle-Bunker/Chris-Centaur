"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigStore = void 0;
const pg_1 = require("pg");
/**
 * Configuration store using PostgreSQL database
 * Stores configuration values as key-value pairs in a simple table
 */
class ConfigStore {
    constructor() {
        // Use the existing database connection
        this.pool = new pg_1.Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
        });
        // Initialize the config table if it doesn't exist
        this.initTable();
    }
    /**
     * Initialize the configuration table if it doesn't exist
     */
    async initTable() {
        try {
            await this.pool.query(`
        CREATE TABLE IF NOT EXISTS config_store (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
        }
        catch (error) {
            console.error('Error creating config table:', error);
        }
    }
    /**
     * Get all configuration values
     */
    async getAll() {
        try {
            const result = await this.pool.query('SELECT key, value FROM config_store');
            const config = {};
            for (const row of result.rows) {
                try {
                    config[row.key] = JSON.parse(row.value);
                }
                catch {
                    config[row.key] = row.value;
                }
            }
            return config;
        }
        catch (error) {
            console.error('Error reading config from database:', error);
            return {};
        }
    }
    /**
     * Set a configuration value
     */
    async set(key, value) {
        try {
            const jsonValue = JSON.stringify(value);
            await this.pool.query(`INSERT INTO config_store (key, value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`, [key, jsonValue]);
            console.log(`Config updated: ${key} = ${value}`);
        }
        catch (error) {
            console.error('Error saving config to database:', error);
            throw error;
        }
    }
    /**
     * Set multiple configuration values at once
     */
    async setMultiple(updates) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const [key, value] of Object.entries(updates)) {
                const jsonValue = JSON.stringify(value);
                await client.query(`INSERT INTO config_store (key, value, updated_at) 
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) 
           DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`, [key, jsonValue]);
            }
            await client.query('COMMIT');
            console.log(`Config updated with ${Object.keys(updates).length} values`);
        }
        catch (error) {
            await client.query('ROLLBACK');
            console.error('Error saving config to database:', error);
            throw error;
        }
        finally {
            client.release();
        }
    }
    /**
     * Get a specific configuration value
     */
    async get(key) {
        try {
            const result = await this.pool.query('SELECT value FROM config_store WHERE key = $1', [key]);
            if (result.rows.length === 0) {
                return undefined;
            }
            try {
                return JSON.parse(result.rows[0].value);
            }
            catch {
                return result.rows[0].value;
            }
        }
        catch (error) {
            console.error('Error getting config from database:', error);
            return undefined;
        }
    }
    /**
     * Clear all configuration values
     */
    async clear() {
        try {
            await this.pool.query('DELETE FROM config_store');
            console.log('Config cleared');
        }
        catch (error) {
            console.error('Error clearing config:', error);
            throw error;
        }
    }
}
exports.ConfigStore = ConfigStore;
