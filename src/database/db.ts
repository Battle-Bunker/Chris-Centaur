import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Shared database access. A single pg Pool backs one Drizzle client for the
 * whole process, replacing the previous per-class `new Pool(...)` instances.
 * Import { db } for queries and { pool } for lifecycle (shutdown) needs.
 *
 * Lifecycle: pool.end() is owned by the graceful-shutdown sequence the
 * ActivityController orchestrates (registered in src/index.ts, AFTER the
 * CommandLogger/DecisionLogger flushes) — not by any individual logger. The
 * pool is never closed on idle: the liveness heartbeat keeps using it in
 * every state, and idle clients drain naturally via idleTimeoutMillis.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // Idle pooled clients don't hold a ref on the event loop while waiting out
  // idleTimeoutMillis, so a drained process isn't kept alive by a socket the
  // reaper would discard anyway. (Not load-bearing for autoscale — the HTTP
  // listener refs the loop regardless — just correct handle hygiene.)
  allowExitOnIdle: true,
});

export const db = drizzle(pool, { schema });

export { schema };
