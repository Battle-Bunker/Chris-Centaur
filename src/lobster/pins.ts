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
  Witness,
} from './contracts';
import type { EngineSubstrate } from './substrate';
import type { KernelReport } from './kernel';

// ------------------------------------------------------------------- ledger

interface LedgerEntry {
  readonly to: CellIndex;
  readonly tentative: boolean;
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

  /** A new turn voids every pin and every commit (turn change is silent —
   * the wire's stream emits no unpin flurry, and neither does this). */
  beginTurn(turn: number): void {
    if (this.turn === turn) return;
    this.turn = turn;
    this.entries.clear();
    this.committed.clear();
  }

  /**
   * Fold one wire event in. `snakeIdOf` is the transport registry's reverse
   * lookup; an event whose unit the registry cannot name is dropped (it is
   * not ours). Returns the snake id the event applied to, or null.
   */
  apply(ev: PinEvent, snakeIdOf: (unitId: number) => string | null): string | null {
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
 *   costLo/costHi  the unconstrained-vs-conforming brackets: how much floor
 *                  and ceiling the operator's considered constraint gives up
 *                  against the staged (unconstrained) incumbent. Clamped at
 *                  zero — a pin that HELPS is priced free, not negative.
 *   witness        the punishing line, when the speculative bracket is
 *                  already refuted by the incumbent's proved floor and the
 *                  decision holds a concrete reply to show for it.
 *   alternative    the bot's preferred candidate for the pinned unit — what
 *                  it would do if the operator let it.
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
    const marker = `${pin.unitId}@${pin.to}?`;
    const spec = report.speculative.find((s) => s.key.includes(marker));
    if (spec === undefined) continue;
    const costs = [Math.max(0, staged.lo - spec.lo), Math.max(0, staged.hi - spec.hi)];
    const costLo = Math.min(costs[0] as number, costs[1] as number);
    const costHi = Math.max(costs[0] as number, costs[1] as number);
    if (costHi < threshold) continue;
    const refuted = spec.hi < staged.lo;
    out.push({
      pin,
      costLo,
      costHi,
      witness: refuted ? (input.witnesses[input.witnesses.length - 1] ?? null) : null,
      alternative: (staged.plan as JointPlan).get(pin.unitId) ?? null,
      confidence: Math.min(1, spec.cursor / ADVICE_CONFIDENCE_SLICES),
      snakeId: input.snakeIdOf?.(pin.unitId) ?? null,
    });
  }
  return out;
}
