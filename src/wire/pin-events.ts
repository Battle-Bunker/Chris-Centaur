/**
 * Pin events, derived from staging that already happens.
 *
 * A pin is an operator constraint: "this unit goes THERE, whatever the search
 * would rather do". The centaur has had pins for as long as it has had a UI —
 * they are just not called that. A manual selection is a pin. A waypoint step
 * is a pin. A human Submit All is a permanent pin for the turn, enforced by
 * Firestore rules rather than by politeness. What has been missing is a typed
 * stream a team decision engine can subscribe to.
 *
 * This module builds that stream and NOTHING else. It observes:
 *
 *   - local staging decisions as the active game manager binds them
 *     (`observeStaged`) — the manual/waypoint rungs of the precedence ladder;
 *   - the Firestore read-back's confirmation of a staged move
 *     (`observeConfirmed`) — the same `privateMoves` listener the turn watch
 *     already runs;
 *   - the `moveStatuses` listener's commit observations (`observeCommit`) —
 *     the same listener that drives finalization today;
 *   - the UI's hover / selection-consideration (`tentativePin`), which has no
 *     wire representation at all and exists only to let the search speculate.
 *
 * It emits `PinEvent`s and it changes no staging behaviour whatsoever. Nothing
 * here can stage, unstage, re-order, or veto a move. Precedence stays where it
 * lives: manual > waypoint > bot, decided in `computeIntendedMove`.
 *
 * TWO RULES THIS MODULE ENFORCES, because they are contract-level:
 *
 *   1. THE BOT NEVER AUTO-UNPINS. A pin is dropped only when the observed
 *      source stops being human (the operator cleared the intent and the unit
 *      fell back to the bot's own choice), or when the turn ends. A tentative
 *      pin can be cleared because it was never binding. A committed unit is
 *      frozen for the turn — no event can move it.
 *   2. TENTATIVE IS NOT BINDING. `currentPins()` reports committed pins only,
 *      sorted by unit id, exactly as the canonical pin context requires.
 *      Tentative pins ride the event stream (the search may speculate on them)
 *      and never enter the context.
 */

import type { CentaurMove } from '../types/battlesnake';
import type { IntendedMoveSource } from '../server/active-game-manager';
import type { CellIndex, Pin, PinEvent, PinSet, UnitId } from '../lobster/contracts';

/**
 * The wire → engine vocabulary. Both halves are injected: unit identity is a
 * string on this side and a number in the engine, and a snake's staged move is
 * a Direction that only the turn's board can turn into a destination cell.
 */
export interface PinTranslation {
  /** Stable engine id for a wire unit, or null when it is not modelled. */
  unitIdOf(snakeId: string): UnitId | null;
  /** Destination cell for a staged move, or null when it cannot be resolved
   * (no head on the turn doc, board moved under the event). */
  cellOf(snakeId: string, move: CentaurMove): CellIndex | null;
}

/**
 * A pin-event consumer. The second argument is the TURN the event constrains —
 * this stream's current turn at emission time.
 *
 * It is not decoration. A turn resolves the instant every alive player
 * commits, so the operator's first pins on turn N+1 can land while turn N's
 * decision is still running, and a consumer that cannot tell the two apart
 * either applies them to the wrong board or wipes them at the next turn
 * boundary with no counter and no log (V4 B5). Sinks that do not care may
 * ignore it.
 */
export type PinEventSink = (event: PinEvent, turn: number | undefined) => void;

/** The staging sources that constitute an operator constraint. A bot or
 * fallback move is the search's own output and is never a pin. */
const PINNING_SOURCES: ReadonlySet<IntendedMoveSource> = new Set<IntendedMoveSource>([
  'manual',
  'waypoint',
]);

export function isPinningSource(source: IntendedMoveSource): boolean {
  return PINNING_SOURCES.has(source);
}

interface Entry {
  readonly unitId: UnitId;
  readonly to: CellIndex;
  readonly tentative: boolean;
}

/**
 * One turn's pin state for one game, plus the event stream over it.
 *
 * Per game, per turn: pins are turn-scoped by construction (a manual selection
 * is single-turn, a commit is binding for the turn only), so `beginTurn`
 * discards everything rather than carrying stale constraints forward.
 */
export class PinEventStream {
  private readonly sinks = new Set<PinEventSink>();
  private readonly entries = new Map<string, Entry>();
  private readonly committed = new Set<string>();
  private turn: number | null = null;

  constructor(private readonly translate: PinTranslation) {}

  /** Subscribe; the returned function unsubscribes. */
  subscribe(sink: PinEventSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  /** The turn this stream is reporting on, or null before the first. */
  get currentTurn(): number | null {
    return this.turn;
  }

  /**
   * A new turn: every pin and every commit from the old one is void. Emits
   * nothing — an epoch change is not a sequence of unpins, and a consumer that
   * treated it as one would see the bot appear to unpin the operator's work.
   */
  beginTurn(turn: number): void {
    if (this.turn === turn) return;
    this.turn = turn;
    this.entries.clear();
    this.committed.clear();
  }

  /**
   * A staged move the manager just bound. `source` is the rung of the
   * precedence ladder it came from: manual/waypoint pin, bot/fallback do not.
   *
   * A unit that WAS pinned and now stages a bot move has had its constraint
   * released by the operator (intent reverted to heuristic), so this is the
   * one place an `unpin` is emitted for a non-tentative pin — released by the
   * human, observed here, never decided here.
   */
  observeStaged(snakeId: string, turn: number, move: CentaurMove, source: IntendedMoveSource): void {
    if (!this.acceptsFor(snakeId, turn)) return;
    if (!isPinningSource(source)) {
      this.releaseIfPinned(snakeId);
      return;
    }
    this.setPin(snakeId, move, false);
  }

  /**
   * The read-back confirmed what Firestore actually holds for this unit. Only
   * ever STRENGTHENS a standing pin to the confirmed cell — it never creates
   * one, because the read-back cannot see which rung produced the move and a
   * bot-staged move must not become a constraint by being acked.
   */
  observeConfirmed(snakeId: string, turn: number, move: CentaurMove): void {
    if (!this.acceptsFor(snakeId, turn)) return;
    const standing = this.entries.get(snakeId);
    if (!standing || standing.tentative) return;
    this.setPin(snakeId, move, false);
  }

  /**
   * The `moveStatuses` listener observed this unit's commit. A commit is
   * PERMANENT for the turn: Firestore rules reject every further staged write
   * for the unit, so no later event can move it.
   */
  observeCommit(snakeId: string, turn: number): void {
    if (this.turn !== null && turn !== this.turn) return;
    if (this.committed.has(snakeId)) return;
    const unitId = this.translate.unitIdOf(snakeId);
    if (unitId === null) return;
    this.committed.add(snakeId);
    this.emit({ kind: 'commit', unitId });
  }

  /**
   * The UI is CONSIDERING this move — a hover, a candidate under the cursor,
   * a drag not yet released. Emitted as a tentative pin so the search can
   * speculate on it; never binding, never in the pin context.
   */
  tentativePin(snakeId: string, move: CentaurMove): void {
    if (this.committed.has(snakeId)) return;
    const standing = this.entries.get(snakeId);
    // A real pin outranks a hover: considering a move for a unit the operator
    // has already committed to must not weaken the constraint.
    if (standing && !standing.tentative) return;
    this.setPin(snakeId, move, true);
  }

  /** The UI stopped considering. Clears a TENTATIVE entry only. */
  clearTentative(snakeId: string): void {
    const standing = this.entries.get(snakeId);
    if (!standing || !standing.tentative) return;
    this.entries.delete(snakeId);
    this.emit({ kind: 'unpin', unitId: standing.unitId });
  }

  /**
   * The canonical pin context: committed (non-tentative) pins only, sorted by
   * unit id. This is what a decision's assumption basis is keyed on, so its
   * ordering must be canonical rather than insertion-ordered.
   */
  currentPins(): PinSet {
    const pins: Pin[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tentative) continue;
      pins.push({ unitId: entry.unitId, to: entry.to, tentative: false });
    }
    pins.sort((a, b) => a.unitId - b.unitId);
    return pins;
  }

  /** Every standing entry including tentative ones, sorted by unit id. */
  allPins(): PinSet {
    const pins: Pin[] = Array.from(this.entries.values()).map((e) => ({
      unitId: e.unitId,
      to: e.to,
      tentative: e.tentative,
    }));
    pins.sort((a, b) => a.unitId - b.unitId || Number(a.tentative) - Number(b.tentative));
    return pins;
  }

  /** Units whose commit has been observed this turn. */
  committedUnits(): ReadonlyArray<string> {
    return Array.from(this.committed).sort();
  }

  // ── internals ───────────────────────────────────────────────────────────

  private acceptsFor(snakeId: string, turn: number): boolean {
    if (this.turn !== null && turn !== this.turn) return false;
    // Committed is frozen: the wire refuses further writes, so reporting a
    // change would describe a constraint the game cannot honour.
    return !this.committed.has(snakeId);
  }

  private setPin(snakeId: string, move: CentaurMove, tentative: boolean): void {
    const unitId = this.translate.unitIdOf(snakeId);
    if (unitId === null) return;
    const to = this.translate.cellOf(snakeId, move);
    if (to === null) return;
    const standing = this.entries.get(snakeId);
    if (standing && standing.to === to && standing.tentative === tentative) return;
    this.entries.set(snakeId, { unitId, to, tentative });
    this.emit({ kind: 'pin', pin: { unitId, to, tentative } });
  }

  private releaseIfPinned(snakeId: string): void {
    const standing = this.entries.get(snakeId);
    if (!standing) return;
    this.entries.delete(snakeId);
    this.emit({ kind: 'unpin', unitId: standing.unitId });
  }

  private emit(event: PinEvent): void {
    const turn = this.turn ?? undefined;
    for (const sink of Array.from(this.sinks)) {
      try {
        sink(event, turn);
      } catch (err) {
        // A subscriber must never be able to break staging observation.
        console.error('[pin-events] sink threw:', err);
      }
    }
  }
}

/**
 * One `PinEventStream` per game, created on demand.
 *
 * The transport watches several games at once and each has its own roster,
 * board and turn cursor, so pins are per game by construction. The hub exists
 * so the transport's listeners can forward observations with a `gameId` and
 * nothing else — it owns the lifecycle, and a game it has never heard of costs
 * one map lookup.
 */
export class PinEventHub {
  private readonly streams = new Map<string, PinEventStream>();

  /** `makeTranslation` is called once per game, the first time it is seen. */
  constructor(private readonly makeTranslation: (gameId: string) => PinTranslation) {}

  /** The stream for a game, minting it on first use. */
  streamFor(gameId: string): PinEventStream {
    let stream = this.streams.get(gameId);
    if (!stream) {
      stream = new PinEventStream(this.makeTranslation(gameId));
      this.streams.set(gameId, stream);
    }
    return stream;
  }

  /** The stream for a game if it exists — never mints one. */
  peek(gameId: string): PinEventStream | null {
    return this.streams.get(gameId) ?? null;
  }

  beginTurn(gameId: string, turn: number): void {
    this.streamFor(gameId).beginTurn(turn);
  }

  observeStaged(
    gameId: string,
    snakeId: string,
    turn: number,
    move: CentaurMove,
    source: IntendedMoveSource
  ): void {
    this.streamFor(gameId).observeStaged(snakeId, turn, move, source);
  }

  observeConfirmed(gameId: string, snakeId: string, turn: number, move: CentaurMove): void {
    this.streamFor(gameId).observeConfirmed(snakeId, turn, move);
  }

  observeCommit(gameId: string, snakeId: string, turn: number): void {
    this.streamFor(gameId).observeCommit(snakeId, turn);
  }

  tentativePin(gameId: string, snakeId: string, move: CentaurMove): void {
    this.streamFor(gameId).tentativePin(snakeId, move);
  }

  clearTentative(gameId: string, snakeId: string): void {
    this.peek(gameId)?.clearTentative(snakeId);
  }

  subscribe(gameId: string, sink: PinEventSink): () => void {
    return this.streamFor(gameId).subscribe(sink);
  }

  /** Game over / unwatched: drop the stream and its subscribers. */
  release(gameId: string): void {
    this.streams.delete(gameId);
  }

  get size(): number {
    return this.streams.size;
  }
}

/**
 * Stable numeric ids for wire unit ids, assigned in first-seen order.
 *
 * The engine speaks in `UnitId` numbers and the wire in opaque strings; the
 * mapping only has to be STABLE within a decision, not meaningful. A game's
 * roster is fixed at setup, so first-seen order is stable for the game's life
 * as long as one registry serves it.
 */
export class UnitIdRegistry {
  private readonly ids = new Map<string, UnitId>();
  private next = 0;

  /** The id for this unit, minting one on first sight. */
  idOf(snakeId: string): UnitId {
    const existing = this.ids.get(snakeId);
    if (existing !== undefined) return existing;
    const id = this.next++;
    this.ids.set(snakeId, id);
    return id;
  }

  /** The id for this unit if it already has one, else null. Use when minting
   * on demand would be wrong (an event for a unit we do not control). */
  lookup(snakeId: string): UnitId | null {
    return this.ids.get(snakeId) ?? null;
  }

  /** Pre-register a roster so ids follow the roster's order, not event order. */
  register(snakeIds: ReadonlyArray<string>): void {
    for (const snakeId of snakeIds) this.idOf(snakeId);
  }

  /** Reverse lookup — the wire id for an engine id, or null. */
  snakeIdOf(unitId: UnitId): string | null {
    for (const [snakeId, id] of this.ids) if (id === unitId) return snakeId;
    return null;
  }

  get size(): number {
    return this.ids.size;
  }
}
