/**
 * PLACEHOLDER — the U track's surface, declared at L1 and built at L5.
 *
 * Nothing here is implemented. It exists so the boundary tests of
 * `05-BUILD-ORDER.md` §(b) COMPILE against a real module path and FAIL AT
 * RUNTIME for want of an implementation.
 *
 * NO FUNCTION HERE MAY BRANCH ON `at.mode`. `lens-view-model.test.ts` asserts
 * that structurally — no `mode ===` outside the badge component — because the
 * two paths drifting is what the shipped code has already done.
 *
 * Signatures may move here — this file is NOT frozen. `../types.ts` is.
 */

import type {
  ConditionalHandle,
  ConditionalRequest,
  Cursor,
  CursorEvent,
  DecisionSource,
  DivergenceReport,
  DrawTranscript,
  FrameStore,
  LensCursor,
  LensCursorState,
  LensFrame,
  LensRefusal,
  LockPlan,
  MovesetBreakdown,
  MovesetKey,
  NarrowNote,
  Provenanced,
  RowTrail,
  TurnEvent,
  WidenNotice,
} from '../types';

const NOT_IMPLEMENTED = 'not implemented: L2/L4/L5';

// ------------------------------------------------------------- the cursor

export function initialCursor(): LensCursor {
  throw new Error(NOT_IMPLEMENTED);
}

export function cursorState(_cursor: LensCursor): LensCursorState {
  throw new Error(NOT_IMPLEMENTED);
}

/** The transition table of 02 §1.3 (T1–T17, minus the deleted T5), driven
 *  FROM THE FRAME: Law D's cascade re-defaults everything below the deepest
 *  explicit level, and a focused unit is never left with an empty panel. */
export function applyCursorEvent(
  _cursor: LensCursor,
  _frame: LensFrame,
  _event: CursorEvent
): LensCursor {
  throw new Error(NOT_IMPLEMENTED);
}

/** `P* = {u} ∪ {v ∈ members : K(v) ≠ staged(v)}` — exact, client-side, from
 *  the frame alone. No kernel query, and no `≤` (04 §2.4). */
export function planLock(_frame: LensFrame, _cursor: LensCursor): LockPlan {
  throw new Error(NOT_IMPLEMENTED);
}

/** Compare `expected` against the next emission's incumbent for `C ∖ P*`.
 *  One comparison per emission, and the reason Law B is falsifiable. */
export function checkDivergence(_plan: LockPlan, _next: LensFrame): DivergenceReport | null {
  throw new Error(NOT_IMPLEMENTED);
}

// ---------------------------------------------------------- the reactive case

/** Additive uncertainty is staged; subtractive certainty is applied. */
export function reactiveNotice(
  _prev: LensFrame,
  _next: LensFrame
): WidenNotice | NarrowNote | null {
  throw new Error(NOT_IMPLEMENTED);
}

/** §1.5 re-resolution by identity. Nothing under the cursor ever re-orders. */
export function resolveCursor(
  _cursor: LensCursor,
  _prev: LensFrame,
  _next: LensFrame
): LensCursor {
  throw new Error(NOT_IMPLEMENTED);
}

export function rowTrails(
  _prev: LensFrame,
  _next: LensFrame,
  _cursor: LensCursor
): ReadonlyArray<RowTrail> {
  throw new Error(NOT_IMPLEMENTED);
}

// ------------------------------------------------------------- the sources

export interface LiveSourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
  readonly isHead: boolean;
}

export interface ReplaySourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
}

export function makeLiveDecisionSource(_input: LiveSourceInput): DecisionSource {
  throw new Error(NOT_IMPLEMENTED);
}

export function makeReplayDecisionSource(_input: ReplaySourceInput): DecisionSource {
  throw new Error(NOT_IMPLEMENTED);
}

export function requestConditional(
  _source: DecisionSource,
  _req: ConditionalRequest
): Promise<ConditionalHandle | LensRefusal> {
  throw new Error(NOT_IMPLEMENTED);
}

export function requestBreakdown(
  _source: DecisionSource,
  _moveset: MovesetKey
): Promise<Provenanced<MovesetBreakdown> | LensRefusal> {
  throw new Error(NOT_IMPLEMENTED);
}

// ------------------------------------------------------------- the renderer

/** The board and rail, as a transcript of draw calls. Live and replay must
 *  produce IDENTICAL transcripts from frames that differ only in `at.mode`,
 *  `at.isHead` and `provenance.kind`. */
export function renderFrame(_frame: LensFrame): DrawTranscript {
  throw new Error(NOT_IMPLEMENTED);
}

/** The timeline lane, from the frame's own events. Scrubbing is a local fold. */
export function renderTimeline(_events: ReadonlyArray<TurnEvent>): DrawTranscript {
  throw new Error(NOT_IMPLEMENTED);
}
