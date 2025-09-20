import { Storage } from '@google-cloud/storage';

// Replit object storage configuration
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const objectStorageClient = new Storage({
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

/**
 * Simple key-value store for configuration using Replit's object storage
 * Stores config values as JSON in object storage
 */
export class ConfigStore {
  private bucketName: string;
  private configFile = 'battlesnake-config.json';

  constructor() {
    // Extract bucket name from PRIVATE_OBJECT_DIR if available
    const privateDir = process.env.PRIVATE_OBJECT_DIR || '/default-bucket';
    this.bucketName = privateDir.split('/')[1] || 'default-bucket';
  }

  /**
   * Get all configuration values
   */
  async getAll(): Promise<Record<string, any>> {
    try {
      const bucket = objectStorageClient.bucket(this.bucketName);
      const file = bucket.file(this.configFile);
      
      const [exists] = await file.exists();
      if (!exists) {
        console.log('Config file does not exist in object storage, returning empty config');
        return {};
      }

      const [contents] = await file.download();
      return JSON.parse(contents.toString());
    } catch (error) {
      console.error('Error reading config from object storage:', error);
      return {};
    }
  }

  /**
   * Set a configuration value
   */
  async set(key: string, value: any): Promise<void> {
    try {
      const bucket = objectStorageClient.bucket(this.bucketName);
      const file = bucket.file(this.configFile);
      
      // Get existing config
      const config = await this.getAll();
      
      // Update config
      config[key] = value;
      
      // Save back to object storage
      await file.save(JSON.stringify(config, null, 2), {
        metadata: {
          contentType: 'application/json',
        },
      });
      
      console.log(`Config updated: ${key} = ${value}`);
    } catch (error) {
      console.error('Error saving config to object storage:', error);
      throw error;
    }
  }

  /**
   * Set multiple configuration values at once
   */
  async setMultiple(updates: Record<string, any>): Promise<void> {
    try {
      const bucket = objectStorageClient.bucket(this.bucketName);
      const file = bucket.file(this.configFile);
      
      // Get existing config
      const config = await this.getAll();
      
      // Update config
      Object.assign(config, updates);
      
      // Save back to object storage
      await file.save(JSON.stringify(config, null, 2), {
        metadata: {
          contentType: 'application/json',
        },
      });
      
      console.log(`Config updated with ${Object.keys(updates).length} values`);
    } catch (error) {
      console.error('Error saving config to object storage:', error);
      throw error;
    }
  }

  /**
   * Get a specific configuration value
   */
  async get(key: string): Promise<any> {
    const config = await this.getAll();
    return config[key];
  }

  /**
   * Clear all configuration values
   */
  async clear(): Promise<void> {
    try {
      const bucket = objectStorageClient.bucket(this.bucketName);
      const file = bucket.file(this.configFile);
      
      await file.save(JSON.stringify({}, null, 2), {
        metadata: {
          contentType: 'application/json',
        },
      });
      
      console.log('Config cleared');
    } catch (error) {
      console.error('Error clearing config:', error);
      throw error;
    }
  }
}