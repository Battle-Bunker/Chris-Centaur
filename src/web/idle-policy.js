// Client mirror of src/shared/idle-policy.ts. Keep these constants in sync.
window.IdlePolicy = {
  IDLE_TIMEOUT_MS: 30 * 60 * 1000,
  IDLE_CLOSE_CODE: 4001,
  IDLE_CLOSE_REASON: 'idle-timeout',
  ACTIVITY_HEARTBEAT_INTERVAL_MS: 2 * 60 * 1000,
  IDLE_CHECK_INTERVAL_MS: 30 * 1000,
};
