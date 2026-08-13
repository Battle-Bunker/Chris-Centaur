// Shared idle-disconnect policy for the centaur play WebSocket connections.
// Client mirror lives at src/web/idle-policy.js — keep the constants in sync.

// NOTE: the idle timeout itself is runtime-configurable via the config store
// (`idleTimeoutMinutes` in game-config / the /config page). Server and client
// both read it from config; the DEFAULT_CONFIG value (30 min) is the fallback.
export const IDLE_CLOSE_CODE = 4001;
export const IDLE_CLOSE_REASON = 'idle-timeout';
export const ACTIVITY_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
export const SERVER_IDLE_SWEEP_INTERVAL_MS = 60 * 1000;

// Connection keepalive interval. Both the server (protocol ping + app-level
// keepalive) and the client (unconditional app-level keepalive) fire on this
// cadence to keep an idle-but-open socket warm so the proxy in front of the app
// never drops it (~5-minute idle window). Comfortably under that window.
export const WS_KEEPALIVE_INTERVAL_MS = 25 * 1000;

// ── Instance-idleness policy (ActivityController) ───────────────────────────
// The instance is awake iff
//   (now − lastHumanActionAt < IDLE_GRACE_MS)
//   OR (a game is verifiably progressing AND
//       now − lastHumanActionAt < GAME_HUMAN_ATTENTION_CAP_MS).
// A connected-but-untouched tab counts as NOTHING — only verifiable human
// actions (user-intent WS messages, input-gated activity heartbeats, dashboard
// page loads, mutating API calls) reset the clock.

// Grace window after the last verifiable human action before the instance is
// allowed to go idle (Firebase suspend). Also absorbs transient windows during
// page navigations. Same 60s the old index.ts Firebase-suspend timer used.
export const IDLE_GRACE_MS = 60 * 1000;

// ABSOLUTE cap on how long a running game may hold the instance awake past
// the last verifiable human action. A game nobody has touched a page for in
// 10 minutes suspends mid-game, deliberately.
export const GAME_HUMAN_ATTENTION_CAP_MS = 10 * 60 * 1000;

// How recently a game's latest turn must have arrived for the game to count
// as "verifiably progressing" (unless its turn deadline is still in the
// future). ~2 turn windows of the longest normal turn (60s first turn), and
// the same per-game lastActivityAt clock the stale-game cleanup evicts on at
// 10 minutes — one staleness clock, two thresholds. A registered-but-stuck
// game (no turn advance, deadline long past) counts as INACTIVE.
export const GAME_PROGRESS_WINDOW_MS = 3 * 60 * 1000;
