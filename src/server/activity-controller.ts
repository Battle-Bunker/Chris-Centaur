/**
 * Centralized keepalive control for the autoscale deployment.
 *
 * ONE definition of instance-level idleness lives here. The instance is awake
 * iff
 *
 *   (now − lastHumanActionAt < IDLE_GRACE_MS)
 *   OR (a game is verifiably progressing
 *       AND now − lastHumanActionAt < GAME_HUMAN_ATTENTION_CAP_MS)
 *
 * A connected-but-untouched browser tab counts as NOTHING: the only activity
 * signals are verifiable human actions — user-intent WS messages
 * (USER_INTENT_TYPES, which already exclude pings and socket keepalives),
 * input-gated activity heartbeats, dashboard page loads, and mutating API
 * calls — all funnelled into `recordHumanAction()`, plus game-progress
 * sources registered via `registerSource` (ActiveGameManager's
 * "verifiably progressing game" predicate), which can only ever extend
 * wakefulness up to the 10-minute human-attention cap. The 10 minutes are an
 * ABSOLUTE cap: no game holds the instance awake longer than that past the
 * last verifiable human action; a stuck game (no turn advance, deadline long
 * past) counts as inactive immediately.
 *
 * Boot seeds the clock: with no human interaction ever, the instance suspends
 * IDLE_GRACE_MS after boot (today's accepted manual-wake model), and a live
 * game re-discovered at boot gets at most the same 10-minute courtesy window
 * a mid-session game gets after its last human action.
 *
 * State machine: ACTIVE ⇄ IDLE. Any verifiable human action while IDLE wakes
 * the instance immediately (wake subscribers resume Firebase exactly like the
 * old presence-driven resume). Transitions notify subscribers in registration
 * order (event-logger, Firebase suspend/resume, worker-pool teardown), so
 * teardown/rebuild is deterministic and owned in one place. Transitions whose
 * trigger is pure time passing (grace expiring, the cap expiring, a game
 * going stale) are noticed by an internal evaluation sweep (in-memory,
 * unref'd, EVAL_SWEEP_INTERVAL_MS).
 *
 * The controller also owns every long-lived timer in the process:
 *  - `managedInterval` / `managedTimeout` register in the controller's timer
 *    registry: always unref'd, cleared at shutdown, and — for scope
 *    'while-active' — paused while the controller is IDLE and resumed on
 *    wake. Scope 'always' keeps running while idle (e.g. the liveness
 *    heartbeat, whose whole purpose is bounding when the platform kills the
 *    instance — it must NOT stop on idle).
 *  - `transientTimeout` / `transientInterval` / `transientDelay` are plain
 *    auto-unref wrappers for short-lived timers (retry backoffs, per-decision
 *    tickers). No registry — but they are the ONLY sanctioned way to create a
 *    timer outside this module (enforced by lint).
 *
 * Finally, `shutdown()` orchestrates graceful shutdown: it stops every
 * managed timer, then runs the steps registered via `onShutdown` strictly in
 * registration order, awaiting each. Steps are registered by the composition
 * root (src/index.ts) in the documented order: shutdown-event flush → WS
 * close → Firebase stop → game-manager timers → logger flushes → pg pool end
 * → worker pool → HTTP close/exit.
 */

import { GAME_HUMAN_ATTENTION_CAP_MS, IDLE_GRACE_MS } from '../shared/idle-policy';

export type ActivityState = 'active' | 'idle';
export type ManagedTimerScope = 'always' | 'while-active';

// Cadence of the internal evaluation sweep that notices pure-time transitions
// (grace expiry, attention-cap expiry, game staleness). In-memory and unref'd
// — it generates no traffic and never keeps the event loop alive.
export const EVAL_SWEEP_INTERVAL_MS = 5 * 1000;

/** Handle for a managed timer: `clear()` stops it and removes it from the
 *  registry (idempotent). */
export interface ManagedTimerHandle {
  readonly name: string;
  clear(): void;
}

/** Plain auto-unref'd setTimeout. For short-lived one-shots (retry backoffs,
 *  deadlines) that would otherwise be bare timers scattered across modules. */
export function transientTimeout(fn: () => void, ms: number): NodeJS.Timeout {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return t;
}

/** Plain auto-unref'd setInterval. For short-lived recurring timers whose
 *  lifecycle is owned by their call site (e.g. per-decision update tickers). */
export function transientInterval(fn: () => void, ms: number): NodeJS.Timeout {
  const t = setInterval(fn, ms);
  t.unref?.();
  return t;
}

/** Auto-unref'd promise sleep built on transientTimeout — for `await` retry
 *  backoffs. Never keeps the event loop alive on its own. */
export function transientDelay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    transientTimeout(resolve, ms);
  });
}

type TimerFn = () => void | Promise<unknown>;

interface ManagedEntry {
  name: string;
  kind: 'interval' | 'timeout';
  fn: TimerFn;
  ms: number;
  scope: ManagedTimerScope;
  handle: NodeJS.Timeout | null; // null while paused (or fired, for timeouts)
  // For paused 'while-active' timeouts: how much of the delay was left when
  // the controller went idle, so resume re-arms with the remaining time.
  remainingMs: number | null;
  // For armed timeouts: the absolute deadline, so pause() can compute the
  // remainder without touching the timer internals.
  fireAt: number | null;
  cleared: boolean;
}

interface Subscriber {
  name: string;
  fn: () => void | Promise<unknown>;
}

interface ShutdownStep {
  name: string;
  fn: (reason: string) => void | Promise<unknown>;
}

export class ActivityController {
  private static instance: ActivityController | null = null;

  static getInstance(): ActivityController {
    if (!ActivityController.instance) {
      ActivityController.instance = new ActivityController();
    }
    return ActivityController.instance;
  }

  private state: ActivityState = 'active';
  // 0 = no verifiable human action this lifetime. The awake clock anchors on
  // max(bootedAt, lastHumanActionAt) — see the class doc for why boot seeds it.
  private lastHumanActionAt = 0;
  private readonly bootedAt = Date.now();
  private readonly sources = new Map<string, () => boolean>();
  private readonly idleSubscribers: Subscriber[] = [];
  private readonly wakeSubscribers: Subscriber[] = [];
  private readonly shutdownSteps: ShutdownStep[] = [];
  private readonly managed = new Set<ManagedEntry>();
  private readonly evalSweep: NodeJS.Timeout;
  private shutdownPromise: Promise<void> | null = null;

  constructor() {
    this.evalSweep = setInterval(() => this.evaluate(), EVAL_SWEEP_INTERVAL_MS);
    this.evalSweep.unref?.();
  }

  getState(): ActivityState {
    return this.state;
  }

  /** ms timestamp of the last verifiable human action (0 = none this
   *  lifetime). Exposed for diagnostics/logging only. */
  getLastHumanActionAt(): number {
    return this.lastHumanActionAt;
  }

  /**
   * Register (or replace) a game-progress source: a predicate that is true
   * while a game is VERIFIABLY progressing (latest turn arrived recently, or
   * turn deadline still in the future). Sources extend wakefulness only
   * within GAME_HUMAN_ATTENTION_CAP_MS of the last human action — they can
   * never hold the instance awake on their own. Sources must also poke() on
   * their transitions (game register/end/cleanup).
   */
  registerSource(name: string, isProgressing: () => boolean): void {
    this.sources.set(name, isProgressing);
  }

  /**
   * A verifiable human action happened (user-intent WS message, input-gated
   * activity heartbeat, dashboard page load, mutating API call). Resets the
   * awake clock — including the 10-minute game cap — and wakes the instance
   * immediately if it was idle.
   */
  recordHumanAction(): void {
    this.lastHumanActionAt = Date.now();
    this.evaluate();
  }

  /** Re-evaluate the awake rule right now. Called by sources on their own
   *  transitions (game register/end/stale-cleanup); pure-time transitions are
   *  caught by the internal evaluation sweep. */
  poke(): void {
    this.evaluate();
  }

  /** The single awake rule — see the class doc. */
  isAwake(now = Date.now()): boolean {
    const sinceHuman = now - Math.max(this.bootedAt, this.lastHumanActionAt);
    if (sinceHuman < IDLE_GRACE_MS) return true;
    return sinceHuman < GAME_HUMAN_ATTENTION_CAP_MS && this.anyGameProgressing();
  }

  /** Subscribe to idle entry. Subscribers run in registration order; an async
   *  subscriber is fired-and-forgotten (errors logged), matching the old
   *  `void ttFirebase.suspend()` behavior. */
  onIdle(name: string, fn: () => void | Promise<unknown>): void {
    this.idleSubscribers.push({ name, fn });
  }

  /** Subscribe to wake (IDLE → ACTIVE). Runs in registration order. */
  onWake(name: string, fn: () => void | Promise<unknown>): void {
    this.wakeSubscribers.push({ name, fn });
  }

  /** Register a graceful-shutdown step. shutdown() runs steps strictly in
   *  registration order, awaiting each; a failing step is logged and the
   *  sequence continues (shutdown must never wedge). */
  onShutdown(name: string, fn: (reason: string) => void | Promise<unknown>): void {
    this.shutdownSteps.push({ name, fn });
  }

  /**
   * Register a recurring managed timer. Always unref'd; cleared by
   * shutdown(); scope 'while-active' pauses it while IDLE (cleared on idle
   * entry, restarted with a full period on wake). A timer created while
   * already IDLE starts paused.
   */
  managedInterval(
    name: string,
    fn: TimerFn,
    ms: number,
    opts: { scope: ManagedTimerScope }
  ): ManagedTimerHandle {
    return this.createManaged(name, 'interval', fn, ms, opts.scope);
  }

  /**
   * Register a one-shot managed timer. Always unref'd; cleared by shutdown();
   * scope 'while-active' pauses it while IDLE, preserving the remaining delay
   * so wake re-arms it with the time it had left.
   */
  managedTimeout(
    name: string,
    fn: TimerFn,
    ms: number,
    opts: { scope: ManagedTimerScope }
  ): ManagedTimerHandle {
    return this.createManaged(name, 'timeout', fn, ms, opts.scope);
  }

  /**
   * Orchestrated graceful shutdown. Idempotent — the first call wins and
   * every later call returns the same promise. Stops the evaluation sweep and
   * every managed timer first (no background tick may interleave with
   * teardown), then runs the registered shutdown steps sequentially in
   * registration order, awaiting each and logging (not propagating) failures.
   */
  shutdown(reason = 'shutdown'): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.runShutdown(reason);
    }
    return this.shutdownPromise;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private evaluate(): void {
    if (this.shutdownPromise) return;
    const awake = this.isAwake();
    if (awake && this.state === 'idle') {
      this.enterActive();
    } else if (!awake && this.state === 'active') {
      this.enterIdle();
    }
  }

  private anyGameProgressing(): boolean {
    for (const isProgressing of this.sources.values()) {
      try {
        if (isProgressing()) return true;
      } catch (err) {
        // A throwing source must never wedge the state machine; treat it as
        // progressing (the safe direction — never tear down on a broken
        // signal; the human-attention cap still bounds it).
        console.error('[ActivityController] Game-progress source threw:', err);
        return true;
      }
    }
    return false;
  }

  private enterIdle(): void {
    this.state = 'idle';
    // Pause 'while-active' timers FIRST so no tick can interleave with the
    // subscribers' teardown.
    for (const entry of this.managed) {
      if (entry.scope === 'while-active') this.pauseManaged(entry);
    }
    this.emit(this.idleSubscribers, 'idle');
  }

  private enterActive(): void {
    this.state = 'active';
    // Resume timers first, then subscribers — mirror of enterIdle.
    for (const entry of this.managed) {
      if (entry.scope === 'while-active') this.resumeManaged(entry);
    }
    this.emit(this.wakeSubscribers, 'wake');
  }

  private emit(subscribers: Subscriber[], event: 'idle' | 'wake'): void {
    for (const sub of subscribers) {
      try {
        const result = sub.fn();
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          void (result as Promise<unknown>).catch((err) => {
            console.error(`[ActivityController] ${event} subscriber '${sub.name}' failed:`, err);
          });
        }
      } catch (err) {
        console.error(`[ActivityController] ${event} subscriber '${sub.name}' failed:`, err);
      }
    }
  }

  private createManaged(
    name: string,
    kind: 'interval' | 'timeout',
    fn: TimerFn,
    ms: number,
    scope: ManagedTimerScope
  ): ManagedTimerHandle {
    const entry: ManagedEntry = {
      name,
      kind,
      fn,
      ms,
      scope,
      handle: null,
      remainingMs: null,
      fireAt: null,
      cleared: false,
    };
    this.managed.add(entry);
    if (scope === 'while-active' && this.state === 'idle') {
      // Starts paused; wake arms it (timeouts with their full delay).
      entry.remainingMs = kind === 'timeout' ? ms : null;
    } else {
      this.armManaged(entry, ms);
    }
    return {
      name,
      clear: () => {
        if (entry.cleared) return;
        entry.cleared = true;
        this.stopManagedHandle(entry);
        this.managed.delete(entry);
      },
    };
  }

  private armManaged(entry: ManagedEntry, ms: number): void {
    if (entry.kind === 'interval') {
      entry.handle = setInterval(entry.fn, ms);
    } else {
      entry.remainingMs = null;
      entry.fireAt = Date.now() + ms;
      entry.handle = setTimeout(() => {
        // One-shot fired: drop the registry entry, then run.
        entry.handle = null;
        entry.cleared = true;
        this.managed.delete(entry);
        entry.fn();
      }, ms);
    }
    entry.handle.unref?.();
  }

  private pauseManaged(entry: ManagedEntry): void {
    if (!entry.handle) return;
    if (entry.kind === 'timeout') {
      entry.remainingMs = Math.max(0, (entry.fireAt ?? Date.now()) - Date.now());
    }
    this.stopManagedHandle(entry);
  }

  private resumeManaged(entry: ManagedEntry): void {
    if (entry.handle || entry.cleared) return;
    if (entry.kind === 'interval') {
      this.armManaged(entry, entry.ms);
    } else if (entry.remainingMs !== null) {
      this.armManaged(entry, entry.remainingMs);
    }
  }

  private stopManagedHandle(entry: ManagedEntry): void {
    if (!entry.handle) return;
    if (entry.kind === 'interval') clearInterval(entry.handle);
    else clearTimeout(entry.handle);
    entry.handle = null;
  }

  private async runShutdown(reason: string): Promise<void> {
    clearInterval(this.evalSweep);
    for (const entry of this.managed) {
      entry.cleared = true;
      this.stopManagedHandle(entry);
    }
    this.managed.clear();
    for (const step of this.shutdownSteps) {
      try {
        await step.fn(reason);
      } catch (err) {
        console.error(`[ActivityController] Shutdown step '${step.name}' failed:`, err);
      }
    }
  }
}
