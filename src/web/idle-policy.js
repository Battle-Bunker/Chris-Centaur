/**
 * Idle / keepalive policy constants — the SINGLE source of truth, shared
 * verbatim between the browser pages (via <script src>, as window.IdlePolicy)
 * and the server (src/shared/idle-policy.ts re-exports these with types by
 * require-ing this file). Same UMD pattern as activity-periods.js: keep this
 * file dependency-free.
 */
(function (global) {
  'use strict';

  const IdlePolicy = {
    // Per-user idle-disconnect policy. IDLE_TIMEOUT_MS is the DEFAULT only —
    // both sides read the runtime-configurable idleTimeoutMinutes (the
    // /config page): the server refreshes it every sweep tick, and
    // idle-watcher.js overwrites this value once at page load.
    IDLE_TIMEOUT_MS: 30 * 60 * 1000,
    IDLE_CLOSE_CODE: 4001,
    IDLE_CLOSE_REASON: 'idle-timeout',

    // ACTIVITY HEARTBEAT: how often the client reports "a real human touched
    // this page" — sent only when genuine local input (key/click/touch/wheel/
    // mouse) happened since the last beat, so the server can treat each beat
    // as a verifiable human action.
    ACTIVITY_HEARTBEAT_INTERVAL_MS: 2 * 60 * 1000,

    // Client-side cadence for checking whether the user crossed the idle
    // threshold (idle-watcher.js).
    IDLE_CHECK_INTERVAL_MS: 30 * 1000,

    // Server-side cadence for the idle sweep that closes user-idle sockets
    // (websocket-server.ts).
    SERVER_IDLE_SWEEP_INTERVAL_MS: 60 * 1000,

    // SOCKET KEEPALIVE cadence. Both the server (protocol ping + app-level
    // keepalive frame) and the client (unconditional app-level keepalive)
    // fire on this cadence to keep an idle-but-open socket warm so the proxy
    // in front of the app (~5-minute idle window) never drops it. Says
    // nothing about humans — see ACTIVITY_HEARTBEAT_INTERVAL_MS for that.
    SOCKET_KEEPALIVE_INTERVAL_MS: 25 * 1000,

    // ── Instance-idleness policy (server ActivityController) ────────────────
    // The instance is awake iff
    //   (now − lastHumanActionAt < IDLE_GRACE_MS)
    //   OR (a game is verifiably progressing AND
    //       now − lastHumanActionAt < GAME_HUMAN_ATTENTION_CAP_MS).
    // A connected-but-untouched tab counts as NOTHING — only verifiable human
    // actions (user-intent WS messages, input-gated activity heartbeats,
    // dashboard page loads, mutating API calls) reset the clock.

    // Grace window after the last verifiable human action before the instance
    // may go idle (Firebase suspend). Also absorbs transient windows during
    // page navigations.
    IDLE_GRACE_MS: 60 * 1000,

    // ABSOLUTE cap on how long a running game may hold the instance awake
    // past the last verifiable human action. A game nobody has touched a page
    // for in 10 minutes suspends mid-game, deliberately.
    GAME_HUMAN_ATTENTION_CAP_MS: 10 * 60 * 1000,

    // How recently a game's latest turn must have arrived for it to count as
    // "verifiably progressing" (unless its turn deadline is still in the
    // future). ~2 turn windows of the longest normal turn (60s first turn),
    // on the same per-game lastActivityAt clock the stale-game cleanup evicts
    // on at 10 minutes — one staleness clock, two thresholds. A registered-
    // but-stuck game counts as INACTIVE.
    GAME_PROGRESS_WINDOW_MS: 3 * 60 * 1000,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IdlePolicy;
  } else {
    global.IdlePolicy = IdlePolicy;
  }
})(typeof window !== 'undefined' ? window : this);
