/**
 * Per-decision compute telemetry for the anytime engine: one record per snake
 * decision capturing how much of the simulation space was planned vs actually
 * evaluated, how long it took, and whether the turn deadline cut it off.
 * Records append as JSONL to DECISION_TELEMETRY_FILE when set (fire-and-
 * forget), else print as single greppable console lines. Used to find compute
 * hotspots — turns where crowded boards blow up the 3^k state count.
 */

import * as fs from 'fs';

export interface DecisionTelemetryRecord {
  ts: number;              // wall-clock ms at record time
  gameId: string;
  snakeId: string;
  boardTurn: number;       // turn of the board the decision was made ON
  mode: 'iterative' | 'trivial';  // trivial = 0/1 candidate moves, sync path
  candidateMoves: number;
  nearbySnakes: number;    // k — snakes within focal distance
  moveSetsPerMove: number; // 3^k combinations per candidate move
  plannedStates: number;   // candidateMoves × moveSetsPerMove
  statesEvaluated: number;
  chunksTotal: number;
  chunksCompleted: number;
  durationMs: number;
  deadlineHit: boolean;    // finalized by deadline with chunks outstanding
  updatesEmitted: number;  // interim onUpdate ticks that fired
  poolSize: number;
  poolInline: boolean;     // true when chunks ran inline on the main thread
}

export function recordDecisionTelemetry(record: DecisionTelemetryRecord): void {
  const line = JSON.stringify(record);
  const file = process.env.DECISION_TELEMETRY_FILE;
  if (file) {
    fs.appendFile(file, line + '\n', (err) => {
      if (err) console.error('[decision-telemetry] append failed:', err.message);
    });
  } else {
    console.log(`[decision-telemetry] ${line}`);
  }
}
