// Shared idle-disconnect policy for the centaur play WebSocket connections.
// Client mirror lives at src/web/idle-policy.js — keep the constants in sync.

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_CLOSE_CODE = 4001;
export const IDLE_CLOSE_REASON = 'idle-timeout';
export const ACTIVITY_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
export const SERVER_IDLE_SWEEP_INTERVAL_MS = 60 * 1000;
