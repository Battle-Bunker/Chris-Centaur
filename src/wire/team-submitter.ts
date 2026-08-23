/**
 * Team-scoped staged-move submission: one turn's joint set, written as
 * Firestore `writeBatch` chunks instead of one loose `addDoc` per unit.
 *
 * WHAT THIS FIXES. The legacy path writes one `privateMoves` document per
 * unit, each its own round trip. The server reduces those documents PER
 * PLAYER, independently — nothing correlates two units' writes — so a process
 * that dies between two writes leaves a MIXED set on the server: half the
 * team's new plan, half its old. A joint plan is only a joint plan if it lands
 * jointly. A `writeBatch` is atomic across documents, and every
 * `serverTimestamp()` sentinel inside one batch resolves to the SAME commit
 * timestamp, so the server's per-player reduce reads a consistent set.
 *
 * THE CAP. Each `privateMoves` create costs two rules `get()` calls and a
 * batched write's rules budget is 20 gets, so a batch may carry at most TEN
 * documents. Teams run up to 26 units. Chunking is therefore not optional, and
 * a chunked revision is not atomic — see the residual window below.
 *
 * ONE DOC PER PLAYER PER BATCH. Never two revisions for the same unit in one
 * batch. Same-batch writes share a commit timestamp exactly, and the server
 * breaks such ties by document id — random, for `addDoc`. Keeping one document
 * per player per batch makes that tie unreachable rather than merely unlikely.
 *
 * EXCLUSIONS. A unit the human has committed is dropped from the plan
 * entirely: Firestore rules DENY further `privateMoves` creates for a
 * committed player, so including one would fail the whole batch and take the
 * rest of the team's coherent set down with it. The commit is the operator's,
 * and it is binding — this layer reports the exclusion, it never works around
 * it.
 *
 * CHUNK COHERENCE, AND THE RESIDUAL TORN-SET WINDOW. Chunks are cut from a
 * STABLE partition: the turn's roster is sorted by unit id and sliced into
 * fixed groups of ten, and a unit keeps its group for the whole turn. So
 * revision N's chunk k wholly supersedes revision N-1's chunk k, and a
 * revision interrupted after chunk k leaves the server holding
 *
 *     chunks 0..k     from revision N
 *     chunks k+1..    from revision N-1
 *
 * — a union of WHOLE chunks from two ADJACENT revisions, never an arbitrary
 * mixture of units. Each group is internally coherent, and the ratchet makes
 * revision N-1 a plan the team was already willing to play.
 *
 * That is a real narrowing of the failure mode, not its elimination. For a
 * team of more than ten units the window between two chunk commits remains: a
 * process death, a lost connection, or an early turn resolution inside it
 * resolves a cross-revision set. Three things bound it, and none of them close
 * it:
 *
 *   1. Chunks are committed back to back on one promise chain with no
 *      intervening awaits, so the window is a network round trip (single-digit
 *      to low-tens of ms), not a decision interval.
 *   2. Units whose move is unchanged since the last confirmed revision are
 *      omitted, so a steady-state revision usually writes far fewer than the
 *      full roster and often fits in ONE chunk — no window at all.
 *   3. The confirm/retry backstop re-plans whatever the read-back has not
 *      confirmed, so an interrupted revision is completed on the next tick
 *      provided the process is still alive.
 *
 * A team of <= 10 units has NO residual window: its every revision is a single
 * atomic batch. This is the honest statement of the guarantee — teams up to
 * ten are joint-atomic, larger teams are joint-atomic per chunk-group with a
 * one-round-trip cross-revision window.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not resolve intent. Manual > waypoint
 * > bot precedence and the fatal-move consent gate run entirely in the active
 * game manager, before a unit's move ever reaches here; this layer receives
 * already-bound staged records and puts them on the wire. It is transport.
 */

import type { CentaurMove } from '../types/battlesnake';
import type { IntendedMoveSource } from '../server/active-game-manager';
import { DEFAULT_MIN_WRITE_INTERVAL_MS, StageThrottle } from './stage-throttle';

/** Documents per `writeBatch`. Two rules `get()`s per create, 20 per batch. */
export const MAX_BATCH_DOCS = 10;

/** Confirm backstop, in ms — the legacy `STAGING_RETRY_MS`, kept in phase. */
export const DEFAULT_CONFIRM_BACKSTOP_MS = 1000;

/** One unit's staged move, as the manager bound it. */
export interface TeamStagedUnit {
  readonly snakeId: string;
  readonly move: CentaurMove;
  readonly source: IntendedMoveSource;
}

/** One `privateMoves` document, minus the fields the transport supplies
 * (gameID, moveNumber, timestamp). `source` is carried for logging only — it
 * is never written; unknown fields on staged docs are ignored server-side and
 * must never be load-bearing. */
export interface TeamBatchDoc {
  readonly playerID: string;
  readonly move: number;
  readonly source: IntendedMoveSource;
}

export type ExclusionReason = 'committed' | 'unencodable';

export interface TeamBatchPlan {
  /** Chunks in commit order; each is one atomic `writeBatch`. */
  readonly chunks: ReadonlyArray<ReadonlyArray<TeamBatchDoc>>;
  readonly excluded: ReadonlyArray<{ snakeId: string; reason: ExclusionReason }>;
  /** Units already holding the wanted move on the wire — nothing to write. */
  readonly unchanged: ReadonlyArray<string>;
  /** The stable groups the chunks were cut from, in the same order. Exposed so
   * the coherence property is inspectable (and testable) rather than implied. */
  readonly groups: ReadonlyArray<ReadonlyArray<string>>;
}

export interface TeamBatchPlanInput {
  readonly units: ReadonlyArray<TeamStagedUnit>;
  /** True once the human's commit for this unit is recorded server-side. */
  readonly isCommitted: (snakeId: string) => boolean;
  /** Wire encoding, or null when the unit cannot be encoded for this turn. */
  readonly encode: (unit: TeamStagedUnit) => number | null;
  /** Wire index last successfully written this turn, per unit. */
  readonly lastWritten?: ReadonlyMap<string, number>;
  readonly maxPerChunk?: number;
}

/**
 * Cut one revision into commit-ordered chunks.
 *
 * Pure: no clock, no I/O, no state. The whole chunking/exclusion contract is
 * decided here so it can be tested without a Firestore anywhere near it.
 */
export function planTeamBatches(input: TeamBatchPlanInput): TeamBatchPlan {
  const maxPerChunk = Math.max(1, input.maxPerChunk ?? MAX_BATCH_DOCS);
  const lastWritten = input.lastWritten ?? new Map<string, number>();
  const excluded: Array<{ snakeId: string; reason: ExclusionReason }> = [];
  const unchanged: string[] = [];

  // One entry per unit that survives exclusion, keyed for the stable partition
  // below. Sorting by unit id — not by arrival order, not by how the team
  // engine happened to enumerate — is what makes a unit's group the same on
  // every revision of the turn.
  const encoded = new Map<string, TeamBatchDoc>();
  for (const unit of input.units) {
    if (input.isCommitted(unit.snakeId)) {
      excluded.push({ snakeId: unit.snakeId, reason: 'committed' });
      continue;
    }
    const move = input.encode(unit);
    if (move === null || !Number.isInteger(move)) {
      excluded.push({ snakeId: unit.snakeId, reason: 'unencodable' });
      continue;
    }
    encoded.set(unit.snakeId, { playerID: unit.snakeId, move, source: unit.source });
  }

  const roster = Array.from(encoded.keys()).sort();
  const groups: string[][] = [];
  for (let i = 0; i < roster.length; i += maxPerChunk) {
    groups.push(roster.slice(i, i + maxPerChunk));
  }

  const chunks: TeamBatchDoc[][] = [];
  for (const group of groups) {
    const docs: TeamBatchDoc[] = [];
    for (const snakeId of group) {
      const doc = encoded.get(snakeId)!;
      // Omitting an unchanged unit is not a gap: its previous document is
      // still the latest one the server holds for it, and it carries the same
      // move this revision would have written. The resolved set is identical
      // either way, and the transaction reads one document fewer.
      if (lastWritten.get(snakeId) === doc.move) {
        unchanged.push(snakeId);
        continue;
      }
      docs.push(doc);
    }
    if (docs.length > 0) chunks.push(docs);
  }

  return { chunks, excluded, unchanged, groups };
}

/**
 * The `privateMoves` document, in exactly the shape the server's security
 * rules validate. There is one definition of it and both staging paths — the
 * per-unit `addDoc` and the team `writeBatch` — build through here.
 *
 * The rule (`isValidPrivateMove`, TacticToes firestore.rules) requires ALL of
 * `gameID`, `moveNumber`, `playerID`, `move`, `timestamp`, with `move` and
 * `moveNumber` non-negative integers and `timestamp` either a timestamp or the
 * server-timestamp sentinel. A missing or wrong-typed field is a DENIED write,
 * not a rejected move — the turn simply resolves without us. Extra fields are
 * accepted and ignored server-side, which is precisely why none are added:
 * a field the server ignores can never be load-bearing, so putting one there
 * would be a lie waiting to be believed.
 *
 * `timestamp` is passed in rather than produced here so this stays free of the
 * Firestore SDK (and so tests can pin the shape without one).
 */
export function privateMoveDoc(
  gameID: string,
  turn: number,
  doc: { playerID: string; move: number },
  timestamp: unknown
): { gameID: string; moveNumber: number; playerID: string; move: number; timestamp: unknown } {
  return {
    gameID,
    moveNumber: turn,
    playerID: doc.playerID,
    move: doc.move,
    timestamp,
  };
}

export type TimerHandle = unknown;

/**
 * Everything the submitter needs from the outside world. Every member is
 * injected so the submitter can be driven by fakes: no Firestore, no timers,
 * no emulator.
 */
export interface TeamSubmitterPort {
  /** Wire encoding for one unit on this turn (direction -> full-board index
   * for a snake; a piece's destination goes on verbatim). Null when the unit
   * has no head on the turn doc. */
  encode(gameId: string, turn: number, unit: TeamStagedUnit): number | null;
  /** Commit ONE chunk as a single Firestore `writeBatch`. Must reject on
   * failure — a resolved promise is taken as "these documents exist". */
  commitChunk(
    gameId: string,
    turn: number,
    docs: ReadonlyArray<TeamBatchDoc>
  ): Promise<void>;
  /** True once this unit's commit is recorded (its writes are now DENIED). */
  isCommitted(gameId: string, snakeId: string, turn: number): boolean;
  /** The move the read-back confirms for this unit, or null. */
  confirmed(gameId: string, snakeId: string, turn: number): CentaurMove | null;
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface TeamSubmitterOptions {
  readonly minWriteIntervalMs?: number;
  readonly confirmBackstopMs?: number;
  readonly maxPerChunk?: number;
  /** Injected so a test can share one throttle across submitters. */
  readonly throttle?: StageThrottle;
  readonly log?: (message: string) => void;
}

export interface TeamSubmitResult {
  /** The throttle refused this revision; a flush is scheduled instead. */
  readonly deferred: boolean;
  readonly retryAfterMs: number;
  readonly chunks: number;
  readonly docs: number;
  readonly excluded: ReadonlyArray<{ snakeId: string; reason: ExclusionReason }>;
  readonly unchanged: ReadonlyArray<string>;
  /** Index of the chunk whose commit rejected, or null when all landed. */
  readonly failedChunkIndex: number | null;
}

interface TurnState {
  turn: number;
  /** The joint set the team engine wants on the wire right now. */
  desired: Map<string, TeamStagedUnit>;
  /** Wire index last CONFIRMED-or-committed per unit for this turn. */
  written: Map<string, number>;
  /** Set while a flush is running; a submit during one queues a re-flush. */
  flushing: boolean;
  pending: boolean;
  pendingFinal: boolean;
  deferTimer: TimerHandle | null;
  backstopTimer: TimerHandle | null;
}

const EMPTY_RESULT: TeamSubmitResult = {
  deferred: false,
  retryAfterMs: 0,
  chunks: 0,
  docs: 0,
  excluded: [],
  unchanged: [],
  failedChunkIndex: null,
};

/**
 * The team path's `ensureStagedPublished`.
 *
 * Same shape as the legacy per-unit pipeline — publish, wait for the read-back
 * to confirm, republish on a backstop — lifted from one unit to the team's
 * joint set, with a min-write-interval throttle in front of it and a final
 * flush that bypasses the throttle.
 */
export class TeamBatchSubmitter {
  private readonly throttle: StageThrottle;
  private readonly confirmBackstopMs: number;
  private readonly maxPerChunk: number;
  private readonly log: (message: string) => void;
  private readonly games = new Map<string, TurnState>();

  constructor(
    private readonly port: TeamSubmitterPort,
    options: TeamSubmitterOptions = {}
  ) {
    this.throttle =
      options.throttle ??
      new StageThrottle({
        minWriteIntervalMs: options.minWriteIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS,
      });
    this.confirmBackstopMs = options.confirmBackstopMs ?? DEFAULT_CONFIRM_BACKSTOP_MS;
    this.maxPerChunk = options.maxPerChunk ?? MAX_BATCH_DOCS;
    this.log = options.log ?? ((message) => console.log(message));
  }

  /**
   * Publish one revision of a team's joint staged set.
   *
   * `units` is the WHOLE set the team wants staged for `turn` — not a delta.
   * Passing `final` bypasses the throttle: the last write before the deadline
   * is the one that plays, so it must never be swallowed by a rate limit.
   */
  async submitTeamSet(
    gameId: string,
    turn: number,
    units: ReadonlyArray<TeamStagedUnit>,
    opts: { final?: boolean } = {}
  ): Promise<TeamSubmitResult> {
    const state = this.stateFor(gameId, turn);
    // A revision for a turn the board has already left is dead on arrival: its
    // read-back listener is gone and the server has moved on.
    if (state === null) return EMPTY_RESULT;

    for (const unit of units) state.desired.set(unit.snakeId, unit);

    const final = opts.final === true;
    const decision = this.throttle.check(this.keyFor(gameId, turn), this.port.now(), final);
    if (!decision.admit) {
      this.scheduleDeferredFlush(gameId, state, decision.retryAfterMs);
      return { ...EMPTY_RESULT, deferred: true, retryAfterMs: decision.retryAfterMs };
    }
    return this.flushAndCharge(gameId, state, final);
  }

  /**
   * The deadline flush: publish whatever the team wants staged right now,
   * exempt from the throttle. Safe to call with nothing new to say — an
   * all-confirmed set plans zero chunks and writes nothing.
   */
  async finalFlush(gameId: string, turn: number): Promise<TeamSubmitResult> {
    return this.submitTeamSet(gameId, turn, [], { final: true });
  }

  /** The joint set currently wanted for a game's live turn. */
  desiredSet(gameId: string): ReadonlyArray<TeamStagedUnit> {
    const state = this.games.get(gameId);
    return state ? Array.from(state.desired.values()) : [];
  }

  /** Drop a game's state and timers (game over, unwatched, disconnected). */
  abandon(gameId: string): void {
    const state = this.games.get(gameId);
    if (!state) return;
    this.clearTimers(state);
    this.games.delete(gameId);
    this.throttle.forgetPrefix(`${gameId}:`);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private stateFor(gameId: string, turn: number): TurnState | null {
    const existing = this.games.get(gameId);
    if (existing && existing.turn === turn) return existing;
    if (existing && existing.turn > turn) return null;
    if (existing) {
      // A new turn: everything about the old one is void, including its
      // throttle allowance — the first revision of a turn must go out fast.
      this.clearTimers(existing);
      this.throttle.forget(`${gameId}:${existing.turn}`);
    }
    const fresh: TurnState = {
      turn,
      desired: new Map(),
      written: new Map(),
      flushing: false,
      pending: false,
      pendingFinal: false,
      deferTimer: null,
      backstopTimer: null,
    };
    this.games.set(gameId, fresh);
    return fresh;
  }

  private clearTimers(state: TurnState): void {
    if (state.deferTimer !== null) {
      this.port.clearTimeout(state.deferTimer);
      state.deferTimer = null;
    }
    if (state.backstopTimer !== null) {
      this.port.clearTimeout(state.backstopTimer);
      state.backstopTimer = null;
    }
  }

  private keyFor(gameId: string, turn: number): string {
    return `${gameId}:${turn}`;
  }

  /**
   * Flush, then charge the throttle only if the flush actually WROTE.
   *
   * The rate limit exists to bound documents in the resolution transaction, so
   * it must count documents. Charging for an attempt instead would let a burst
   * of read-back confirmations — each of which re-enters the pipeline and each
   * of which usually plans nothing — spend the allowance and hold back a real
   * revision for up to a full interval.
   */
  private async flushAndCharge(
    gameId: string,
    state: TurnState,
    final: boolean
  ): Promise<TeamSubmitResult> {
    const result = await this.flush(gameId, state, final);
    if (result.docs > 0 || result.failedChunkIndex !== null) {
      this.throttle.record(this.keyFor(gameId, state.turn), this.port.now());
    }
    return result;
  }

  private scheduleDeferredFlush(gameId: string, state: TurnState, delayMs: number): void {
    if (state.deferTimer !== null) return; // one pending flush per game is enough
    state.deferTimer = this.port.setTimeout(() => {
      state.deferTimer = null;
      const live = this.games.get(gameId);
      if (live !== state) return;
      void this.flushAndCharge(gameId, state, false);
    }, delayMs);
  }

  private async flush(
    gameId: string,
    state: TurnState,
    final: boolean
  ): Promise<TeamSubmitResult> {
    if (state.flushing) {
      // A revision landing mid-flush is not dropped: the in-flight flush
      // re-runs against the updated desired set when it finishes.
      state.pending = true;
      state.pendingFinal = state.pendingFinal || final;
      return EMPTY_RESULT;
    }
    state.flushing = true;
    try {
      return await this.flushOnce(gameId, state, final);
    } finally {
      state.flushing = false;
      if (state.pending) {
        state.pending = false;
        const wasFinal = state.pendingFinal;
        state.pendingFinal = false;
        if (this.games.get(gameId) === state) {
          void this.flush(gameId, state, wasFinal);
        }
      }
    }
  }

  private async flushOnce(
    gameId: string,
    state: TurnState,
    final: boolean
  ): Promise<TeamSubmitResult> {
    const turn = state.turn;
    // The read-back is the authority on what the wire holds. Folding it in
    // before planning is what makes an unconfirmed write get re-planned and a
    // confirmed one stay omitted — the confirm/retry semantics of the legacy
    // per-unit pipeline, applied to the whole set at once.
    for (const snakeId of state.desired.keys()) {
      const confirmed = this.port.confirmed(gameId, snakeId, turn);
      const written = state.written.get(snakeId);
      if (confirmed === null) {
        // Nothing acked yet: an optimistic entry from a previous flush must
        // not suppress a rewrite.
        if (written !== undefined) state.written.delete(snakeId);
        continue;
      }
      const encodedConfirmed = this.port.encode(gameId, turn, {
        snakeId,
        move: confirmed,
        source: 'bot',
      });
      if (encodedConfirmed === null) state.written.delete(snakeId);
      else state.written.set(snakeId, encodedConfirmed);
    }

    const plan = planTeamBatches({
      units: Array.from(state.desired.values()),
      isCommitted: (snakeId) => this.port.isCommitted(gameId, snakeId, turn),
      encode: (unit) => this.port.encode(gameId, turn, unit),
      lastWritten: state.written,
      maxPerChunk: this.maxPerChunk,
    });

    let docs = 0;
    let failedChunkIndex: number | null = null;
    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      try {
        // Back to back with no awaits in between beyond the commit itself:
        // the cross-revision window for a >10-unit team is exactly this gap.
        await this.port.commitChunk(gameId, turn, chunk);
      } catch (err) {
        failedChunkIndex = i;
        this.log(
          `[team-submitter] Batch ${i + 1}/${plan.chunks.length} for ${gameId} turn ${turn} ` +
            `failed (${chunk.length} docs) — the backstop will re-plan it: ${String(err)}`
        );
        break;
      }
      docs += chunk.length;
      for (const doc of chunk) state.written.set(doc.playerID, doc.move);
    }

    if (plan.excluded.length > 0) {
      const committed = plan.excluded.filter((e) => e.reason === 'committed');
      if (committed.length > 0) {
        this.log(
          `[team-submitter] ${gameId} turn ${turn}: excluding committed ` +
            `${committed.map((e) => e.snakeId).join(', ')} — their staged writes are denied`
        );
      }
      const bad = plan.excluded.filter((e) => e.reason === 'unencodable');
      if (bad.length > 0) {
        this.log(
          `[team-submitter] ${gameId} turn ${turn}: cannot encode ` +
            `${bad.map((e) => e.snakeId).join(', ')} — not staged this revision`
        );
      }
    }

    if (docs > 0 || failedChunkIndex !== null) {
      this.log(
        `[team-submitter] Staged ${docs} move(s) for ${gameId} turn ${turn} in ` +
          `${plan.chunks.length} batch(es)${final ? ' (final flush)' : ''}`
      );
    }

    this.armBackstop(gameId, state);

    return {
      deferred: false,
      retryAfterMs: 0,
      chunks: plan.chunks.length,
      docs,
      excluded: plan.excluded,
      unchanged: plan.unchanged,
      failedChunkIndex,
    };
  }

  /**
   * Publish-until-confirmed, at team scope: if the read-back has not confirmed
   * every wanted move by the next tick, treat the difference as lost and
   * re-plan it. Exactly the legacy backstop's job and interval, with the whole
   * set as its unit instead of one snake.
   */
  private armBackstop(gameId: string, state: TurnState): void {
    if (state.backstopTimer !== null) {
      this.port.clearTimeout(state.backstopTimer);
      state.backstopTimer = null;
    }
    state.backstopTimer = this.port.setTimeout(() => {
      state.backstopTimer = null;
      const live = this.games.get(gameId);
      if (live !== state) return;
      const turn = state.turn;
      const unconfirmed: string[] = [];
      for (const [snakeId, unit] of state.desired) {
        if (this.port.isCommitted(gameId, snakeId, turn)) continue;
        const confirmed = this.port.confirmed(gameId, snakeId, turn);
        if (confirmed === null || confirmed !== unit.move) unconfirmed.push(snakeId);
      }
      if (unconfirmed.length === 0) return;
      this.log(
        `[team-submitter] ${gameId} turn ${turn}: still unconfirmed ` +
          `${unconfirmed.join(', ')} — republishing`
      );
      for (const snakeId of unconfirmed) state.written.delete(snakeId);
      // A backstop republish is a repair, not a revision: it must not be held
      // by the throttle that the lost write already paid for.
      void this.flush(gameId, state, true);
    }, this.confirmBackstopMs);
  }
}
