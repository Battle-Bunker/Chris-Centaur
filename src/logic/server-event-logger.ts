import { sql, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../database/db';
import { serverEvents, serverLiveness } from '../database/schema';

export type ServerEventType = 'boot' | 'shutdown' | 'woke' | 'went-idle' | 'suspended';

/** Classification of how the previous process lifetime ended, computed at boot
 *  from the previous lifetime's last heartbeat vs its last activity state. */
export type PrevEndClass = 'graceful' | 'silent-kill' | 'crash' | 'unknown';

// How long after the last inbound Battlesnake request (/start, /move) the
// server is still considered "active by game traffic". Bot-only games send no
// WebSocket traffic, so without this window they'd never show as active.
const GAME_ACTIVE_WINDOW_MS = 60 * 1000;
// How long after the last real user-intent message (state-mutating actions
// like select-snake / select-move, or the activity heartbeat that only fires
// when the user genuinely interacted) the server counts as "active by user".
// Merely opening a page / holding a WebSocket open does NOT count — a passive
// open tab is exactly the "up but idle" waste band the timeline audits.
// 3 minutes comfortably covers the 2-minute activity-heartbeat cadence so an
// actively-interacting user doesn't flap between active and idle.
const USER_ACTIVE_WINDOW_MS = 3 * 60 * 1000;
// Cadence for the decay check that notices the game-traffic window expiring.
// Unref'd so it never keeps the process alive on its own.
const DECAY_CHECK_INTERVAL_MS = 15 * 1000;
// Liveness heartbeat cadence: upserts a single "last alive" row so the next
// boot can bound when this process actually died (autoscale kills send no
// catchable signal). Unref'd, fire-and-forget, produces no inbound requests.
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// If a heartbeat tick fires this much later than scheduled within the same
// process, the process was suspended/frozen (not killed) — record it.
const SUSPEND_DRIFT_THRESHOLD_MS = 2 * HEARTBEAT_INTERVAL_MS;

/**
 * Records server lifecycle/activity events (boot, shutdown, woke, went-idle)
 * into the server_events table for the /activity autoscale audit page.
 *
 * Activity model: the server is "active" while a real user-intent message
 * (state-mutating action) arrived within USER_ACTIVE_WINDOW_MS OR a
 * Battlesnake game request arrived within GAME_ACTIVE_WINDOW_MS. Open
 * WebSocket connections alone do NOT count — passively open pages are "up
 * but idle". Transitions emit exactly one woke / went-idle event each.
 *
 * All writes are fire-and-forget (non-blocking): a failed insert is logged and
 * dropped — event logging must never slow down /move or block shutdown.
 */
export class ServerEventLogger {
  private static instance: ServerEventLogger;

  private wsConnections = 0;
  private lastUserIntentAt = 0;
  private lastGameRequestAt = 0;
  private lastGameRequestGameId: string | null = null;
  private active = false;
  private decayInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeatTickAt = 0;
  private bootedAt: Date | null = null;
  private exitRecorded = false;
  // Settles once boot forensics has finished READING the previous lifetime's
  // liveness row. Every heartbeat upsert waits on this so the new process can
  // never overwrite the single server_liveness row before the previous
  // lifetime's death bound has been read and recorded.
  private forensicsRead: Promise<unknown> = Promise.resolve();
  // Chain of pending writes so shutdown() can flush what's in flight.
  private pendingWrites: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  private constructor() {}

  public static getInstance(): ServerEventLogger {
    if (!ServerEventLogger.instance) {
      ServerEventLogger.instance = new ServerEventLogger();
    }
    return ServerEventLogger.instance;
  }

  /** Insert a boot event (with forensics about how the previous lifetime
   *  ended) and start the game-traffic decay checker plus the liveness
   *  heartbeat. */
  public recordBoot(detail?: Record<string, unknown>): void {
    this.bootedAt = new Date();
    // Boot forensics first, then the boot event carrying the classification —
    // both are chained onto pendingWrites so ordering is preserved and
    // failures are logged-and-dropped like every other write.
    const forensics = this.classifyPreviousEnd().catch((err: unknown) => {
      console.error('[ServerEventLogger] Boot forensics failed:', (err as Error)?.message || err);
      return null;
    });
    // Heartbeat upserts are gated on this read completing (see upsertHeartbeat)
    // so the previous row can't be clobbered before it has been read.
    this.forensicsRead = forensics;
    const p = forensics.then(prev => {
      this.write('boot', { ...(detail ?? {}), ...(prev ?? {}) });
    });
    this.pendingWrites = this.pendingWrites.then(() => p.then(() => undefined));

    if (!this.decayInterval) {
      this.decayInterval = setInterval(() => this.checkDecay(), DECAY_CHECK_INTERVAL_MS);
      if (typeof this.decayInterval.unref === 'function') this.decayInterval.unref();
    }
    if (!this.heartbeatInterval) {
      this.lastHeartbeatTickAt = Date.now();
      this.heartbeatInterval = setInterval(() => this.heartbeatTick(), HEARTBEAT_INTERVAL_MS);
      if (typeof this.heartbeatInterval.unref === 'function') this.heartbeatInterval.unref();
      // Write the first heartbeat immediately so even a very short lifetime
      // leaves a liveness bound.
      this.upsertHeartbeat();
    }
  }

  /**
   * Compare the previous lifetime's last heartbeat against its last recorded
   * event to classify how it ended:
   * - 'graceful'    — a shutdown event was written (client already handles it)
   * - 'silent-kill' — died while idle → autoscale scaled to zero
   * - 'crash'       — died with recent activity (was active at last heartbeat)
   * - 'unknown'     — no heartbeat data (pre-feature boots)
   */
  private async classifyPreviousEnd(): Promise<Record<string, unknown> | null> {
    const [prev] = await db.select().from(serverLiveness).where(eq(serverLiveness.id, 1)).limit(1);
    if (!prev) return { prevEndClass: 'unknown' satisfies PrevEndClass };
    const prevLastAliveAt = prev.lastAliveAt.getTime();
    // Last event written by (or before) the previous lifetime's death.
    const [lastEvent] = await db
      .select({ eventType: serverEvents.eventType, timestamp: serverEvents.timestamp })
      .from(serverEvents)
      .where(inArray(serverEvents.eventType, ['shutdown', 'woke', 'went-idle', 'boot']))
      .orderBy(desc(serverEvents.timestamp), desc(serverEvents.id))
      .limit(1);
    let prevEndClass: PrevEndClass;
    if (lastEvent?.eventType === 'shutdown') {
      prevEndClass = 'graceful';
    } else if (lastEvent?.eventType === 'went-idle' || lastEvent?.eventType === 'boot' || !lastEvent) {
      // Idle (or never woke) at death → the platform scaled us to zero.
      prevEndClass = 'silent-kill';
    } else {
      // Last known state was active — dying mid-activity is a crash.
      prevEndClass = 'crash';
    }
    return {
      prevEndClass,
      prevPid: prev.pid,
      prevLastAliveAt,
      prevBootedAt: prev.bootedAt.getTime(),
    };
  }

  /** Upsert the single liveness row (update-in-place, not an event append).
   *  Always waits for boot forensics to finish reading the previous row first
   *  — otherwise this upsert could erase the prior lifetime's death bound. */
  private upsertHeartbeat(): void {
    const now = new Date();
    const lastActivity = Math.max(this.lastUserIntentAt, this.lastGameRequestAt);
    const p = this.forensicsRead
      .then(() => db
        .insert(serverLiveness)
      .values({
        id: 1,
        pid: process.pid,
        bootedAt: this.bootedAt ?? now,
        lastAliveAt: now,
        lastActivityAt: lastActivity > 0 ? new Date(lastActivity) : null,
      })
      .onConflictDoUpdate({
        target: serverLiveness.id,
        set: {
          pid: process.pid,
          bootedAt: this.bootedAt ?? now,
          lastAliveAt: now,
          lastActivityAt: lastActivity > 0 ? new Date(lastActivity) : null,
        },
      }))
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error('[ServerEventLogger] Heartbeat upsert failed:', (err as Error)?.message || err);
      });
    // Deliberately NOT chained onto pendingWrites: the heartbeat must never
    // delay the shutdown flush, and a lost tick is harmless.
    void p;
  }

  private heartbeatTick(): void {
    if (this.shuttingDown) return;
    const now = Date.now();
    const sinceLast = now - this.lastHeartbeatTickAt;
    // Suspend/freeze detection: the tick fired far later than scheduled
    // within the same process — the runtime was paused, not killed.
    if (sinceLast > SUSPEND_DRIFT_THRESHOLD_MS) {
      this.write('suspended', {
        gapMs: sinceLast,
        expectedIntervalMs: HEARTBEAT_INTERVAL_MS,
        resumedAt: now,
      });
    }
    this.lastHeartbeatTickAt = now;
    this.upsertHeartbeat();
  }

  /**
   * Write a shutdown event and wait briefly for all pending writes to land.
   * Bounded by `timeoutMs` so an unreachable database can never block exit.
   */
  public async recordShutdownAndFlush(
    signal: string,
    timeoutMs = 2000,
    extraDetail?: Record<string, unknown>,
  ): Promise<void> {
    if (this.exitRecorded) return; // only the first exit cause wins
    this.exitRecorded = true;
    this.shuttingDown = true;
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.write('shutdown', { signal, connections: this.wsConnections, ...(extraDetail ?? {}) });
    await Promise.race([
      this.pendingWrites,
      new Promise<void>(resolve => {
        const t = setTimeout(resolve, timeoutMs);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]);
  }

  /** Called by the WebSocket server whenever the live connection count
   *  changes. Connection count alone does NOT make the server "active" —
   *  it is tracked only for event detail; activity requires user intent
   *  or game traffic. */
  public setConnectionCount(count: number): void {
    this.wsConnections = Math.max(0, count);
    this.evaluate('websocket');
  }

  /** Called when a real user-intent (state-mutating) WebSocket message
   *  arrives. This — not mere connections — is what marks the server active. */
  public recordUserIntent(): void {
    this.lastUserIntentAt = Date.now();
    this.evaluate('user-intent');
  }

  /** Called on inbound Battlesnake requests (/start, /move) so bot-only games
   *  count as activity even with zero WebSocket viewers. */
  public recordGameActivity(gameId: string | null): void {
    this.lastGameRequestAt = Date.now();
    this.lastGameRequestGameId = gameId;
    this.evaluate('game-request');
  }

  private isActiveNow(): boolean {
    const now = Date.now();
    return (
      now - this.lastUserIntentAt < USER_ACTIVE_WINDOW_MS ||
      now - this.lastGameRequestAt < GAME_ACTIVE_WINDOW_MS
    );
  }

  private checkDecay(): void {
    // Only transition can be active → idle here (nothing raises activity).
    this.evaluate('decay');
  }

  private evaluate(trigger: string): void {
    if (this.shuttingDown) return;
    const nowActive = this.isActiveNow();
    if (nowActive === this.active) return;
    this.active = nowActive;
    if (nowActive) {
      this.write('woke', {
        trigger,
        connections: this.wsConnections,
        gameId: trigger === 'game-request' ? this.lastGameRequestGameId : undefined,
      });
    } else {
      this.write('went-idle', { trigger, connections: this.wsConnections });
    }
  }

  private write(eventType: ServerEventType, detail: Record<string, unknown> | null): void {
    const cleanDetail =
      detail == null
        ? null
        : Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
    const p = db
      .insert(serverEvents)
      .values({
        eventType,
        detail: cleanDetail == null ? null : sql`${JSON.stringify(cleanDetail)}::jsonb`,
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error(`[ServerEventLogger] Failed to write ${eventType} event:`, (err as Error)?.message || err);
      });
    this.pendingWrites = this.pendingWrites.then(() => p);
  }
}
