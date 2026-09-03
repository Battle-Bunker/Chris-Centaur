/**
 * PLACEHOLDER — the D track's surface, declared at L1 and built at L4.
 *
 * Nothing here is implemented. It exists so the boundary tests of
 * `05-BUILD-ORDER.md` §(b) COMPILE against a real module path and FAIL AT
 * RUNTIME for want of an implementation.
 *
 * THE REDUCER LIVES HERE, and it is the one module in the system that must be
 * a pure function of `(anchor, events≤seq)`: no `Date.now()`, no
 * `Math.random()`, no `this`. `lens-reducer.test.ts` asserts that structurally
 * against this file's own source, because a reducer that reads the wall clock
 * is the single thing that would make replay silently disagree with live.
 *
 * Signatures may move here — this file is NOT frozen. `../types.ts` is.
 */

import type {
  DecisionInput,
  FrameStore,
  GameId,
  LensEvent,
  LensFrame,
  MovesetProjectionRow,
  RetentionFold,
  Turn,
  TurnEvent,
  TurnEventRow,
  UnitOutcomeRow,
} from '../types';

const NOT_IMPLEMENTED = 'not implemented: L2/L4/L5';

/** The fold's t0: a turn's `board.arrived` event and nothing before it. */
export function emptyStore(_anchor: TurnEvent): FrameStore {
  throw new Error(NOT_IMPLEMENTED);
}

/** PURE. Never mutates its input store. */
export function applyEvent(_store: FrameStore, _event: TurnEvent): FrameStore {
  throw new Error(NOT_IMPLEMENTED);
}

/** PURE. A function of `(anchor, events ≤ seq)` and of nothing else. */
export function frameAt(_store: FrameStore, _seq: number): LensFrame {
  throw new Error(NOT_IMPLEMENTED);
}

// ---------------------------------------------------------------- the log

/** ONE writer per `(gameId, turn)` assigns `seq`: gapless, monotone, and the
 *  only sort key the UI ever uses (04 §3 O6). */
export interface SeqWriter {
  readonly gameId: GameId;
  readonly turn: Turn;
  /** Stamps `seq` and `id`, and returns the event as it will be stored. */
  write(draft: Omit<TurnEvent, 'id' | 'seq'>): TurnEvent;
  readonly written: ReadonlyArray<TurnEvent>;
}

export function makeSeqWriter(_gameId: GameId, _turn: Turn): SeqWriter {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The kernel's `LensEvent`s, translated into `TurnEvent`s and stamped with
 * `seq` by the one writer. THIS IS THE ONE TRANSLATION POINT (04 §2.2):
 * `LensEvent` carries `UnitId`, `TurnEvent` carries `UnitKey`, and a stored
 * record carrying a substrate number is a stored record that cannot be read
 * one turn later.
 */
export function ingestLensEvents(
  _writer: SeqWriter,
  _events: ReadonlyArray<LensEvent>
): ReadonlyArray<TurnEvent> {
  throw new Error(NOT_IMPLEMENTED);
}

/** `payload` holds the `TurnEvent` VERBATIM, so live and replay fold
 *  identical bytes; the columns beside it exist because they are indexed. */
export function encodeEventRow(_event: TurnEvent): TurnEventRow {
  throw new Error(NOT_IMPLEMENTED);
}

export function decodeEventRow(_row: TurnEventRow): TurnEvent {
  throw new Error(NOT_IMPLEMENTED);
}

export function encodeDecisionInput(_input: DecisionInput): unknown {
  throw new Error(NOT_IMPLEMENTED);
}

export function decodeDecisionInput(_raw: unknown): DecisionInput {
  throw new Error(NOT_IMPLEMENTED);
}

// ---------------------------------------------------------- the projection

/** The `movesets` table AS A FOLD of the `movesets` frames. Its licence to
 *  exist is exactly that this equals `rebuildMovesets` (04 §2.7). */
export function projectMovesets(
  _decisionId: string,
  _events: ReadonlyArray<TurnEvent>
): ReadonlyArray<MovesetProjectionRow> {
  throw new Error(NOT_IMPLEMENTED);
}

/** The rebuild command: regenerate the table from `turn_events` after a
 *  `DELETE`. Byte-identical to `projectMovesets`, or the table goes the way of
 *  `command_turn_states`. */
export function rebuildMovesets(
  _decisionId: string,
  _rows: ReadonlyArray<TurnEventRow>
): ReadonlyArray<MovesetProjectionRow> {
  throw new Error(NOT_IMPLEMENTED);
}

export function reconstructUnitOutcomes(
  _gameId: GameId,
  _turn: Turn,
  _events: ReadonlyArray<TurnEvent>
): ReadonlyArray<UnitOutcomeRow> {
  throw new Error(NOT_IMPLEMENTED);
}

/** The 30-day fold. A folded turn is still inspectable. */
export function foldForRetention(
  _gameId: GameId,
  _turn: Turn,
  _events: ReadonlyArray<TurnEvent>,
  _rows: ReadonlyArray<MovesetProjectionRow>
): RetentionFold {
  throw new Error(NOT_IMPLEMENTED);
}
