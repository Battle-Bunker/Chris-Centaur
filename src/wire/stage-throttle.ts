/**
 * Minimum-write-interval throttle for re-staging.
 *
 * WHY THIS IS MANDATORY, NOT COSMETIC. `privateMoves` is append-only: a
 * revision is a NEW document, never an update, and the resolving transaction
 * re-reads EVERY document written for the turn — there is no cleanup and no
 * limit. So the cost of a re-stage is not one write, it is one document that
 * the turn's resolution transaction must read, for every unit, for the rest of
 * the turn. There is no server-side rate limiting and no trigger on the
 * collection: throttling is entirely this client's job.
 *
 * WHERE THE DEFAULT COMES FROM. Reads charged to one team's resolution
 * transaction over a turn are
 *
 *     docs = units x ceil(turnMs / minWriteIntervalMs)
 *
 * The production regime is `maxTurnTime = 10` seconds (turn 0 is 60 s) and a
 * team runs up to 26 units. At the anytime kernel's ~100 ms emit cadence that
 * is 100 revisions x 26 = 2600 documents in a single transaction on an
 * ordinary turn, and 15600 on turn 0. At 4 Hz it is ~1000 and ~6200. At
 * 1000 ms it is 260 and 1560 — the second of which is the ~1900-read figure
 * that was already identified as the danger case, so 1 s puts even the worst
 * turn at or under the number everything else was sized against.
 *
 * 1000 ms also matches the publish-until-confirmed backstop (STAGING_RETRY_MS
 * in the active game manager). Those two loops share a wire: making the
 * throttle finer than the confirm backstop lets a throttled revision and a
 * confirm retry interleave into a tight write loop, and making it coarser
 * would delay a genuinely lost write past the backstop that exists to catch
 * it. One second is the repo's existing unit for "this write should have
 * landed by now", and re-using it keeps the two loops in phase.
 *
 * WHAT THE DELAY COSTS. Nothing that can be lost. The kernel's ratchet
 * guarantees a later emission is never a worse promise than an earlier one
 * within an epoch, so a suppressed revision is only ever superseded by one at
 * least as good; and the FINAL flush is exempt from the throttle entirely, so
 * the best plan found always reaches the wire. The worst case is that the
 * staged set trails the incumbent by up to one interval mid-turn.
 *
 * THE FINAL FLUSH RULE. `final: true` is always admitted and always resets the
 * clock. A throttle that could swallow the last write before the deadline
 * would convert a rate limit into a correctness bug — the whole point of
 * re-staging is that the last write before `endTime` is the one that plays.
 */

/** See the module note: 1 s, in phase with the confirm backstop. */
export const DEFAULT_MIN_WRITE_INTERVAL_MS = 1000;

export interface StageThrottleConfig {
  /** Minimum ms between two admitted non-final writes for the same key. */
  readonly minWriteIntervalMs?: number;
}

export type ThrottleReason =
  | 'first' // nothing written for this key yet
  | 'interval' // the minimum interval has elapsed
  | 'final' // a final flush, exempt by rule
  | 'throttled'; // refused

export interface ThrottleDecision {
  readonly admit: boolean;
  readonly reason: ThrottleReason;
  /** ms until the next non-final write would be admitted. 0 when admitted. */
  readonly retryAfterMs: number;
}

/**
 * A min-interval gate keyed by an arbitrary string (the team submitter keys on
 * `gameId:turn`, so each turn starts with a clean allowance and a fast first
 * revision).
 *
 * Deliberately clock-injected and side-effect free apart from its own table:
 * the caller decides what to do with a refusal (defer, coalesce, drop), and
 * tests drive it with a fake clock instead of timers.
 */
export class StageThrottle {
  private readonly minWriteIntervalMs: number;
  private readonly lastAdmittedAt = new Map<string, number>();

  constructor(config: StageThrottleConfig = {}) {
    this.minWriteIntervalMs = config.minWriteIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS;
  }

  get intervalMs(): number {
    return this.minWriteIntervalMs;
  }

  /**
   * Would a write for `key` be admitted at `nowMs`? Pure — call `record` to
   * actually consume the allowance, or use `admit` to do both.
   */
  check(key: string, nowMs: number, final = false): ThrottleDecision {
    if (final) return { admit: true, reason: 'final', retryAfterMs: 0 };
    const last = this.lastAdmittedAt.get(key);
    if (last === undefined) return { admit: true, reason: 'first', retryAfterMs: 0 };
    const elapsed = nowMs - last;
    if (elapsed >= this.minWriteIntervalMs) {
      return { admit: true, reason: 'interval', retryAfterMs: 0 };
    }
    return {
      admit: false,
      reason: 'throttled',
      // A clock that jumped backwards must never produce a negative wait.
      retryAfterMs: Math.max(0, this.minWriteIntervalMs - elapsed),
    };
  }

  /** Consume the allowance for `key` as of `nowMs`. */
  record(key: string, nowMs: number): void {
    this.lastAdmittedAt.set(key, nowMs);
  }

  /** `check` plus `record` on admission — the ordinary call. */
  admit(key: string, nowMs: number, final = false): ThrottleDecision {
    const decision = this.check(key, nowMs, final);
    if (decision.admit) this.record(key, nowMs);
    return decision;
  }

  /** Forget a key's allowance (turn over, game gone). */
  forget(key: string): void {
    this.lastAdmittedAt.delete(key);
  }

  /** Forget every key whose name starts with `prefix` — e.g. one game's turns. */
  forgetPrefix(prefix: string): void {
    for (const key of Array.from(this.lastAdmittedAt.keys())) {
      if (key.startsWith(prefix)) this.lastAdmittedAt.delete(key);
    }
  }

  /** Keys currently holding an allowance. Test/diagnostic use. */
  get size(): number {
    return this.lastAdmittedAt.size;
  }
}
