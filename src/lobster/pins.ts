/**
 * The operator constraint layer, engine side.
 *
 * The WIRE half of pins already exists (src/wire/pin-events.ts derives typed
 * PinEvents from staging the manager already observes; the kernel owns the
 * constraint epochs and the pin-context cache). What lives HERE is the part
 * neither of them can own:
 *
 *  - THE LEDGER: per-game pin state kept in the wire's own unit vocabulary
 *    (snake ids), translated into a substrate's unit numbering at each
 *    decision. Pin events arrive numbered by the transport's per-game
 *    UnitIdRegistry; a substrate numbers units per BOARD — the two must never
 *    be conflated, and this file is the one translation point.
 *  - PIN ADVICE: the proved price of a considered (tentative) pin, computed
 *    from the kernel report's speculative contexts — searched one slice in
 *    four, never emitted — and surfaced ONLY above a threshold, through a
 *    callback the UI can subscribe to. Advice is informational: nothing here
 *    can unpin, veto, or restage anything (non-negotiable 3 — the bot never
 *    auto-unpins; humans always win).
 */

import type {
  CellIndex,
  JointPlan,
  Pin,
  PinAdvice,
  PinEvent,
  Posture,
  Witness,
} from './contracts';
import type { EngineSubstrate } from './substrate';
import type { KernelReport } from './kernel';
import { parsePinContextKey, pinContextToken } from './kernel';

// ------------------------------------------------------------------- ledger

interface LedgerEntry {
  readonly to: CellIndex;
  readonly tentative: boolean;
}

/** The transport-registry unit number an event is about. */
function unitOf(ev: PinEvent): number {
  return ev.kind === 'pin' ? ev.pin.unitId : ev.unitId;
}

/**
 * One game's pins, keyed by WIRE unit id (snake id). Fed from PinEvents whose
 * unit numbers come from the transport's registry; the caller supplies the
 * registry's reverse lookup at apply time and a substrate's forward lookup at
 * read time, so neither numbering ever leaks into the other.
 */
export class TeamPinLedger {
  private entries = new Map<string, LedgerEntry>();
  private committed = new Set<string>();
  private turn: number | null = null;
  /** Events that arrived for a turn this ledger has not begun yet — the
   * turn-boundary gap. The wire unit is resolved AT ARRIVAL (the transport
   * registry is turn-independent, the decision's substrate is not), so a
   * replayed event needs no second lookup. See `apply`. */
  private readonly ahead: Array<{
    readonly turn: number;
    readonly ev: PinEvent;
    readonly snakeId: string | null;
  }> = [];
  private droppedLate = 0;
  private deliveredFromBuffer = 0;

  /**
   * A new turn voids every pin and every commit from the old one (turn change
   * is silent — the wire's stream emits no unpin flurry, and neither does
   * this) and then DELIVERS whatever already arrived for this turn.
   *
   * THE TURN-BOUNDARY GAP (V4 B5). A turn can resolve the instant every alive
   * player commits, so turn N+1's snapshot — and the operator's first pins on
   * it — can land well before turn N's decision has finished. Those events
   * arrive at a ledger still reporting on turn N. Wiping the table blind at
   * the top of the next decision threw them away with no counter and no log,
   * and the operator's constraint simply vanished. They are buffered with
   * their turn instead, and handed to the decision they belong to.
   */
  beginTurn(turn: number): void {
    if (this.turn === turn) return;
    this.turn = turn;
    this.entries.clear();
    this.committed.clear();
    const buffered = this.ahead.splice(0, this.ahead.length);
    for (const held of buffered) {
      if (held.turn < turn) {
        // The turn it constrained is over. Counted, never silent.
        this.droppedLate++;
        continue;
      }
      if (held.turn > turn) {
        this.ahead.push(held); // still ahead of us
        continue;
      }
      this.deliveredFromBuffer++;
      this.fold(held.ev, () => held.snakeId);
    }
  }

  /** The buffered events for `turn`, in arrival order — what a decision just
   * starting inherited from the turn-boundary gap. Consumed by `beginTurn`;
   * exposed for the decision that wants to route them onward. */
  bufferedFor(turn: number): ReadonlyArray<PinEvent> {
    return this.ahead.filter((h) => h.turn === turn).map((h) => h.ev);
  }

  /** Events for a turn already past, dropped rather than mis-applied. Visible
   * so a decision can report the loss instead of swallowing it. */
  get droppedEvents(): number {
    return this.droppedLate;
  }

  /** Events that arrived in the turn-boundary gap and were delivered to the
   * decision they belonged to. */
  get bufferedDeliveries(): number {
    return this.deliveredFromBuffer;
  }

  /** Events waiting for a turn this ledger has not begun. */
  get pendingAhead(): number {
    return this.ahead.length;
  }

  /**
   * Fold one wire event in. `snakeIdOf` is the transport registry's reverse
   * lookup; an event whose unit the registry cannot name is dropped (it is
   * not ours). Returns the snake id the event applied to, or null.
   *
   * `turn` is the turn the WIRE emitted the event for. An event for a turn
   * this ledger has not begun is buffered until `beginTurn` reaches it; an
   * event for a turn already past is counted on `droppedEvents`. Omitting
   * `turn` means "whatever turn this ledger is on", the pre-turn-aware
   * behaviour, and is used by callers that have no turn to offer.
   */
  apply(
    ev: PinEvent,
    snakeIdOf: (unitId: number) => string | null,
    turn?: number
  ): string | null {
    if (turn !== undefined && this.turn !== null && turn !== this.turn) {
      if (turn > this.turn) {
        this.ahead.push({ turn, ev, snakeId: snakeIdOf(unitOf(ev)) });
        return null;
      }
      this.droppedLate++;
      return null;
    }
    return this.fold(ev, snakeIdOf);
  }

  /** Whether an event for `turn` belongs to the decision this ledger is on. */
  acceptsTurn(turn: number | undefined): boolean {
    return turn === undefined || this.turn === null || turn === this.turn;
  }

  private fold(ev: PinEvent, snakeIdOf: (unitId: number) => string | null): string | null {
    switch (ev.kind) {
      case 'pin': {
        const snakeId = snakeIdOf(ev.pin.unitId);
        if (snakeId === null) return null;
        if (this.committed.has(snakeId)) return null;
        // A binding pin outranks a tentative one; a tentative event never
        // weakens a binding entry (the wire stream enforces this too — this
        // is defence in depth at the second numbering boundary).
        const standing = this.entries.get(snakeId);
        if (ev.pin.tentative && standing !== undefined && !standing.tentative) return null;
        this.entries.set(snakeId, { to: ev.pin.to, tentative: ev.pin.tentative });
        return snakeId;
      }
      case 'unpin': {
        const snakeId = snakeIdOf(ev.unitId);
        if (snakeId === null) return null;
        if (this.committed.has(snakeId)) return null;
        this.entries.delete(snakeId);
        return snakeId;
      }
      case 'commit': {
        const snakeId = snakeIdOf(ev.unitId);
        if (snakeId === null) return null;
        this.committed.add(snakeId);
        const standing = this.entries.get(snakeId);
        if (standing?.tentative) this.entries.delete(snakeId);
        return snakeId;
      }
    }
  }

  /** The current pins in a SUBSTRATE's unit numbering, committed-first shape
   * the kernel expects (tentative entries ride with their flag set). Units
   * the substrate does not carry are silently absent. */
  pinsFor(sub: EngineSubstrate): Pin[] {
    const pins: Pin[] = [];
    for (const [snakeId, entry] of this.entries) {
      const unit = sub.unitOfWireId(snakeId);
      if (unit === undefined) continue;
      pins.push({ unitId: unit.unitId, to: entry.to, tentative: entry.tentative });
    }
    pins.sort((a, b) => a.unitId - b.unitId);
    return pins;
  }

  /** Translate one live event into a substrate's numbering, or null. */
  translate(
    ev: PinEvent,
    snakeIdOf: (unitId: number) => string | null,
    sub: EngineSubstrate
  ): PinEvent | null {
    const remap = (unitId: number): number | null => {
      const snakeId = snakeIdOf(unitId);
      if (snakeId === null) return null;
      return sub.unitOfWireId(snakeId)?.unitId ?? null;
    };
    switch (ev.kind) {
      case 'pin': {
        const unitId = remap(ev.pin.unitId);
        return unitId === null ? null : { kind: 'pin', pin: { ...ev.pin, unitId } };
      }
      case 'unpin': {
        const unitId = remap(ev.unitId);
        return unitId === null ? null : { kind: 'unpin', unitId };
      }
      case 'commit': {
        const unitId = remap(ev.unitId);
        return unitId === null ? null : { kind: 'commit', unitId };
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

// ------------------------------------------------------------------- advice

/** PinAdvice with the confidence channel and the wire identity attached. */
export interface TeamPinAdvice extends PinAdvice {
  /** How settled the speculative search was: slices spent, saturating at 1. */
  readonly confidence: number;
  /** The wire unit the advice is about, when the caller supplied a mapping. */
  readonly snakeId: string | null;
  /**
   * True when the two brackets differenced here were NOT proved on the same
   * basis — a different posture, a different constraint epoch, or a
   * speculative context that did not record one. The numbers are then an
   * indication, not a price: non-negotiable 5 forbids comparing scores across
   * assumption sets, and the honest thing an advisory surface can do is say
   * which of its numbers broke the rule rather than pretend it did not.
   */
  readonly degraded: boolean;
  /** The basis each side was proved under, for the UI and the report. */
  readonly basis: {
    readonly staged: { readonly posture: Posture; readonly epoch: number };
    readonly speculative: { readonly posture: Posture | null; readonly epoch: number | null };
  };
}

/** Slices of speculative search at which confidence saturates. */
export const ADVICE_CONFIDENCE_SLICES = 8;

/** Advice below this proved cost is noise and is not surfaced. */
export const DEFAULT_ADVICE_THRESHOLD = 1;

export interface AdviceInput {
  readonly report: KernelReport;
  /** Tentative pins in the REPORT's (substrate) unit numbering. */
  readonly tentative: ReadonlyArray<Pin>;
  /** Witnesses the decision accumulated (the search's own set, tapped). */
  readonly witnesses: ReadonlyArray<Witness>;
  readonly threshold?: number;
  readonly snakeIdOf?: (unitId: number) => string | null;
}

/**
 * The proved price of each considered pin, from the kernel's speculative
 * contexts (report.speculative: {key, lo, hi, cursor} — the seam B3 built for
 * exactly this consumer).
 *
 *   costLo/costHi  the unconstrained-vs-conforming brackets, CHANNEL BY
 *                  CHANNEL: `costLo` is the floor the operator's considered
 *                  constraint gives up (staged.lo − speculative.lo) and
 *                  `costHi` is the ceiling it gives up (staged.hi −
 *                  speculative.hi). Each is clamped at zero — a pin that HELPS
 *                  is priced free, not negative — and neither is ever mixed
 *                  with the other: a `min`/`max` across the two channels can
 *                  report the ceiling's delta as the floor's, which is exactly
 *                  what the contract's `costLo` doc forbids (V4 B7).
 *   witness        the punishing line, when the speculative bracket is
 *                  already refuted by the incumbent's proved floor and the
 *                  decision holds a concrete reply to show for it.
 *   alternative    the bot's preferred candidate for the pinned unit — what
 *                  it would do if the operator let it.
 *   degraded       the two brackets were not proved on the same basis. See
 *                  `TeamPinAdvice.degraded`.
 *
 * MATCHING (V4 B3). A speculative context is identified by its key's exact
 * TOKEN for this pin, never by substring: `"1@5?"` is a substring of
 * `"31@5?"`, and a substring match reads unit 31's context as unit 1's and
 * surfaces a fabricated price to the operator.
 *
 * NEVER auto-applied, never an unpin: the return value is the whole effect.
 */
export function adviseFromReport(input: AdviceInput): TeamPinAdvice[] {
  const { report } = input;
  const threshold = input.threshold ?? DEFAULT_ADVICE_THRESHOLD;
  const staged = report.journal[report.journal.length - 1];
  if (staged === undefined) return [];
  const out: TeamPinAdvice[] = [];
  for (const pin of input.tentative) {
    if (!pin.tentative) continue;
    const token = pinContextToken(pin);
    const matches = report.speculative.filter((s) => {
      const parsed = parsePinContextKey(s.key);
      return parsed.speculative && parsed.tokens.includes(token);
    });
    if (matches.length === 0) continue;
    // A speculative key names the COMMITTED pins it was searched under too, so
    // one hover can leave a trail of contexts across epochs — `spec:[4@77?]`
    // from epoch 0 and `spec:[0@30,4@77?]` from epoch 1 both mention the same
    // pin. Take the one proved in the record's own epoch; failing that, the
    // most-searched one, marked degraded (V1-BUG-7).
    const spec =
      matches.find((s) => s.epoch === staged.epoch) ??
      matches.reduce((best, s) => (s.cursor > best.cursor ? s : best));
    // AN UNBOUNDED BRACKET IS NOT A FREE PIN (V1-BUG-6). With `spec.hi = +∞`
    // the ceiling delta is −∞, the clamp turns it into 0, and a pin whose real
    // cost is unknown is published as costing nothing. Unknown is unknown: the
    // advice is not surfaced.
    if (
      !Number.isFinite(spec.lo) ||
      !Number.isFinite(spec.hi) ||
      !Number.isFinite(staged.lo) ||
      !Number.isFinite(staged.hi)
    ) {
      continue;
    }
    // Channel by channel. lo against lo, hi against hi, no crossing.
    const costLo = Math.max(0, staged.lo - spec.lo);
    const costHi = Math.max(0, staged.hi - spec.hi);
    if (Math.max(costLo, costHi) < threshold) continue;
    const specBasis = { posture: spec.posture ?? null, epoch: spec.epoch ?? null };
    const degraded =
      specBasis.posture === null ||
      specBasis.epoch === null ||
      specBasis.posture !== staged.posture ||
      specBasis.epoch !== staged.epoch;
    const refuted = spec.hi < staged.lo;
    out.push({
      pin,
      costLo,
      costHi,
      witness: refuted ? (input.witnesses[input.witnesses.length - 1] ?? null) : null,
      alternative: (staged.plan as JointPlan).get(pin.unitId) ?? null,
      confidence: Math.min(1, spec.cursor / ADVICE_CONFIDENCE_SLICES),
      snakeId: input.snakeIdOf?.(pin.unitId) ?? null,
      degraded,
      basis: {
        staged: { posture: staged.posture, epoch: staged.epoch },
        speculative: specBasis,
      },
    });
  }
  return out;
}
