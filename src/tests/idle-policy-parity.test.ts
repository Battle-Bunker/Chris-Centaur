/**
 * Single-source guarantee for the idle/keepalive policy: the server module
 * (src/shared/idle-policy.ts) must re-export the very same runtime object the
 * browser pages load (src/web/idle-policy.js as window.IdlePolicy). Identity,
 * not equality — one definition, zero drift.
 */

import {
  ACTIVITY_BEAT_MIN_GAP_MS,
  ACTIVITY_HEARTBEAT_INTERVAL_MS,
  GAME_HUMAN_ATTENTION_CAP_MS,
  GAME_PROGRESS_WINDOW_MS,
  IDLE_CLOSE_CODE,
  IDLE_CLOSE_REASON,
  IDLE_GRACE_MS,
  IDLE_POLICY,
  SERVER_IDLE_SWEEP_INTERVAL_MS,
  SOCKET_KEEPALIVE_INTERVAL_MS,
} from '../shared/idle-policy';

// The client artifact, required exactly the way the server module does.
const clientPolicy = require('../web/idle-policy.js');

describe('idle-policy single-sourcing', () => {
  test('server and client constants are the IDENTICAL object', () => {
    expect(IDLE_POLICY).toBe(clientPolicy);
  });

  test('every server-exported name mirrors the shared object', () => {
    expect(IDLE_CLOSE_CODE).toBe(clientPolicy.IDLE_CLOSE_CODE);
    expect(IDLE_CLOSE_REASON).toBe(clientPolicy.IDLE_CLOSE_REASON);
    expect(ACTIVITY_HEARTBEAT_INTERVAL_MS).toBe(clientPolicy.ACTIVITY_HEARTBEAT_INTERVAL_MS);
    expect(ACTIVITY_BEAT_MIN_GAP_MS).toBe(clientPolicy.ACTIVITY_BEAT_MIN_GAP_MS);
    expect(SERVER_IDLE_SWEEP_INTERVAL_MS).toBe(clientPolicy.SERVER_IDLE_SWEEP_INTERVAL_MS);
    expect(SOCKET_KEEPALIVE_INTERVAL_MS).toBe(clientPolicy.SOCKET_KEEPALIVE_INTERVAL_MS);
    expect(IDLE_GRACE_MS).toBe(clientPolicy.IDLE_GRACE_MS);
    expect(GAME_HUMAN_ATTENTION_CAP_MS).toBe(clientPolicy.GAME_HUMAN_ATTENTION_CAP_MS);
    expect(GAME_PROGRESS_WINDOW_MS).toBe(clientPolicy.GAME_PROGRESS_WINDOW_MS);
  });

  test('policy values are sane and typed', () => {
    expect(typeof IDLE_CLOSE_CODE).toBe('number');
    expect(typeof IDLE_CLOSE_REASON).toBe('string');
    // The grace window is the historical 60s suspend grace; the game cap is
    // the absolute 10-minute human-attention bound; a game's progress window
    // sits between them.
    expect(IDLE_GRACE_MS).toBe(60 * 1000);
    expect(GAME_HUMAN_ATTENTION_CAP_MS).toBe(10 * 60 * 1000);
    expect(GAME_PROGRESS_WINDOW_MS).toBeGreaterThan(IDLE_GRACE_MS);
    expect(GAME_PROGRESS_WINDOW_MS).toBeLessThan(GAME_HUMAN_ATTENTION_CAP_MS);
    // The event-driven beat gap must sit strictly inside the idle grace, or
    // an actively-present human could still let the grace expire between
    // beats (the suspend/resume oscillation this floor exists to prevent).
    expect(ACTIVITY_BEAT_MIN_GAP_MS).toBeGreaterThan(0);
    expect(ACTIVITY_BEAT_MIN_GAP_MS).toBeLessThan(IDLE_GRACE_MS);
    expect(ACTIVITY_BEAT_MIN_GAP_MS).toBeLessThan(ACTIVITY_HEARTBEAT_INTERVAL_MS);
  });
});
