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
  Assumption,
  CellIndex,
  CohortId,
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
  /**
   * The basis each side was proved under, for the UI and the report.
   *
   * THREE LEGS, NOT TWO. A basis is `(epoch, posture, cohort)`: the epoch says
   * which constraint set, the posture says which channel, and the cohort says
   * which OBJECTIVE. Differencing two brackets proved under different
   * objectives is not a price — it is a subtraction between answers to two
   * different questions — so the cohort has to be visible here and has to
   * count toward `degraded`.
   */
  readonly basis: {
    readonly staged: {
      readonly posture: Posture;
      readonly epoch: number;
      readonly cohort: CohortId | null;
    };
    readonly speculative: {
      readonly posture: Posture | null;
      readonly epoch: number | null;
      readonly cohort: CohortId | null;
    };
  };
}

/**
 * The objective a record's numbers were proved under, read off the record's
 * own basis rather than off the report's global state.
 *
 * The cohort rides every emitted record as a framing `Assumption`, which is
 * the ONE place it is guaranteed to be correct for THAT record: the kernel
 * stamps the candidate's cohort and not the run's, precisely so a record can
 * never claim an objective its numbers were not proved under. Null for a
 * hand-built record that carries no cohort assumption, which is treated as
 * unknown — and unknown degrades, like every other missing leg of the basis.
 */
export function cohortOfRecord(rec: {
  readonly assumptions: ReadonlyArray<Assumption>;
}): CohortId | null {
  for (const a of rec.assumptions) if (a.kind === 'cohort') return a.id;
  return null;
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
  /** The unconstrained side, when the caller has it live (mid-decision). */
  readonly unconstrained?: {
    readonly speculative: boolean;
    readonly key: string;
    readonly incumbentLo: number | null;
    readonly incumbentHi: number | null;
    readonly posture: Posture | null;
    readonly epoch: number | null;
    /** The objective the bracket was proved under. Optional so a pre-cohort
     * caller still compiles; absent reads as unknown, and unknown degrades. */
    readonly cohort?: CohortId | null;
  } | null;
}

/**
 * The proved price of each considered pin, from the kernel's speculative
 * contexts (report.speculative: {key, lo, hi, cursor} — the seam B3 built for
 * exactly this consumer).
 *
 *   costLo/costHi  the price as an INTERVAL, because both sides of the
 *                  subtraction are intervals. The unconstrained decision is
 *                  proved to lie in [u.lo, u.hi] and the conforming one in
 *                  [c.lo, c.hi], so the cost `u − c` is proved to lie in
 *                  [u.lo − c.hi, u.hi − c.lo]: `costLo` is the LEAST the pin
 *                  can be costing and `costHi` the MOST. Both clamped at zero
 *                  — a pin that helps is priced free, never negative.
 *
 *                  This is not the `min`/`max`-across-the-two-deltas the
 *                  build shipped with (V4 B7), which could report the
 *                  ceiling's delta as the floor's ANSWER and had no claim to
 *                  bracketing anything; and it is not a same-channel
 *                  subtraction either, which reads two overlapping brackets as
 *                  [0, 0] and prices a pin free on the strength of neither
 *                  side being settled. Each end here is derived from the pair
 *                  of ends that actually bounds it, so `costLo ≤ trueCost ≤
 *                  costHi` holds whenever both brackets are sound — which is
 *                  the only property an operator can act on. The width is the
 *                  honest measure of how little the decision knows.
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
  // THE UNCONSTRAINED SIDE IS THE COMMITTED CONTEXT'S BEST-KNOWN BRACKET, not
  // the staged record. The contract says `costLo = floor(best unconstrained) −
  // floor(best conforming)`, and "best unconstrained" is what the decision
  // KNOWS, which the sticky stager may deliberately not have put on the wire:
  // a rival that ties the incumbent's floor never dethrones it, so the staged
  // record can be several points of ceiling behind the incumbent and every pin
  // then prices free against it. Both sides of the subtraction are context
  // incumbents now — same machinery, same provenance, same recorded basis.
  const active =
    input.unconstrained ??
    (report.contexts ?? []).find(
      (c) => !c.speculative && c.key === report.activeContextKey && c.incumbentLo !== null
    ) ??
    null;
  const stagedCohort = cohortOfRecord(staged);
  const base =
    active === null || active.incumbentLo === null || active.incumbentHi === null
      ? {
          lo: staged.lo,
          hi: staged.hi,
          posture: staged.posture,
          epoch: staged.epoch,
          cohort: stagedCohort,
        }
      : {
          lo: active.incumbentLo,
          hi: active.incumbentHi,
          posture: active.posture ?? staged.posture,
          epoch: active.epoch ?? staged.epoch,
          cohort: active.cohort ?? stagedCohort,
        };
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
      matches.find((s) => s.epoch === base.epoch) ??
      matches.reduce((best, s) => (s.cursor > best.cursor ? s : best));
    // AN UNBOUNDED BRACKET IS NOT A FREE PIN (V1-BUG-6). With `spec.hi = +∞`
    // the ceiling delta is −∞, the clamp turns it into 0, and a pin whose real
    // cost is unknown is published as costing nothing. Unknown is unknown: the
    // advice is not surfaced.
    if (
      !Number.isFinite(spec.lo) ||
      !Number.isFinite(spec.hi) ||
      !Number.isFinite(base.lo) ||
      !Number.isFinite(base.hi)
    ) {
      continue;
    }
    // The interval difference, each end from the pair that bounds it.
    const costLo = Math.max(0, base.lo - spec.hi);
    const costHi = Math.max(0, base.hi - spec.lo);
    if (Math.max(costLo, costHi) < threshold) continue;
    const specBasis = {
      posture: spec.posture ?? null,
      epoch: spec.epoch ?? null,
      cohort: spec.cohort ?? null,
    };
    // THE THIRD LEG (Stage 1 correction (c), now due). Testing posture and
    // epoch alone was complete while one decision had exactly one objective,
    // and it stops being complete the moment a decision's brackets can be
    // proved under different ones. Two brackets under different objectives
    // differenced into a pin price with `degraded` reading false is the exact
    // cross-basis comparison the whole bounds layer exists to forbid — and it
    // would be a silent arithmetic error, not a visible one, because both
    // numbers are perfectly sound about their own question.
    //
    // THE NULL RULE IS DELIBERATELY NOT THE POSTURE ONE. `posture` is a
    // required field on the record and only the speculative side can be
    // missing it, so "speculative is null" means "one side knows and the other
    // does not". The cohort is read from an ASSUMPTION and from an optional
    // context field, so BOTH sides can be silent — a hand-built record, a
    // fixture, a caller's own `unconstrained` bracket. Silence on both sides
    // carries no disagreement and is not, on its own, a reason to withdraw a
    // price; disagreement (including one side naming an objective the other
    // does not) is. In production the both-silent case cannot arise on a real
    // report — the kernel stamps every record — and where the speculative side
    // has no basis at all the posture and epoch tests above already fire.
    const degraded =
      specBasis.posture === null ||
      specBasis.epoch === null ||
      specBasis.posture !== base.posture ||
      specBasis.epoch !== base.epoch ||
      specBasis.cohort !== base.cohort;
    const refuted = spec.hi < base.lo;
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
        staged: { posture: base.posture, epoch: base.epoch, cohort: base.cohort },
        speculative: specBasis,
      },
    });
  }
  return out;
}
