/**
 * Server-side view of the shared idle / keepalive policy.
 *
 * The constants LIVE in src/web/idle-policy.js — a dependency-free UMD file
 * (same pattern as activity-periods.js) that the browser pages load as
 * window.IdlePolicy. This module re-exports the very same runtime object with
 * TypeScript names, so server and client can never drift: there is exactly
 * one definition. The parity test (src/tests/idle-policy-parity.test.ts) pins
 * the object identity.
 *
 * The require path is written against the BUILT layout: from dist/shared/
 * `../../src/web/...` resolves to <root>/src/web (the same trick index.ts
 * uses to serve static files), and from src/shared/ (ts-node, ts-jest) it
 * resolves identically.
 */

interface IdlePolicyConstants {
  IDLE_TIMEOUT_MS: number;
  IDLE_CLOSE_CODE: number;
  IDLE_CLOSE_REASON: string;
  ACTIVITY_HEARTBEAT_INTERVAL_MS: number;
  IDLE_CHECK_INTERVAL_MS: number;
  SERVER_IDLE_SWEEP_INTERVAL_MS: number;
  SOCKET_KEEPALIVE_INTERVAL_MS: number;
  IDLE_GRACE_MS: number;
  GAME_HUMAN_ATTENTION_CAP_MS: number;
  GAME_PROGRESS_WINDOW_MS: number;
}

const policy = require('../../src/web/idle-policy.js') as IdlePolicyConstants;

/** The single shared policy object itself (identical to window.IdlePolicy). */
export const IDLE_POLICY: IdlePolicyConstants = policy;

// Named re-exports so server call sites keep their existing imports. See
// src/web/idle-policy.js for what each constant means.
export const IDLE_CLOSE_CODE: number = policy.IDLE_CLOSE_CODE;
export const IDLE_CLOSE_REASON: string = policy.IDLE_CLOSE_REASON;
export const ACTIVITY_HEARTBEAT_INTERVAL_MS: number = policy.ACTIVITY_HEARTBEAT_INTERVAL_MS;
export const SERVER_IDLE_SWEEP_INTERVAL_MS: number = policy.SERVER_IDLE_SWEEP_INTERVAL_MS;
export const SOCKET_KEEPALIVE_INTERVAL_MS: number = policy.SOCKET_KEEPALIVE_INTERVAL_MS;
export const IDLE_GRACE_MS: number = policy.IDLE_GRACE_MS;
export const GAME_HUMAN_ATTENTION_CAP_MS: number = policy.GAME_HUMAN_ATTENTION_CAP_MS;
export const GAME_PROGRESS_WINDOW_MS: number = policy.GAME_PROGRESS_WINDOW_MS;
