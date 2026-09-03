/**
 * LIVE AND REPLAY, over ONE reducer.
 *
 * `LiveDecisionSource` maps arriving events into `applyEvent`;
 * `ReplayDecisionSource` reads `turn_events` and calls THE SAME `applyEvent`
 * with the same objects. There is no replay-specific state, no
 * replay-specific shape, and no renderer below either of them that can tell
 * which it has — that is Law C, and this file is where it is either true or a
 * slogan.
 *
 * THE THREE FIELDS THAT MAY DIFFER, and no others: `at.mode`, `at.isHead` and
 * `provenance.kind`. All three are CONTENT the operator is entitled to,
 * rendered as a badge, never as a branch. Everything else on the frame comes
 * out of `frameAt`, which cannot know which source called it.
 *
 * WHY THE SOURCES LIVE IN THE STORE AND NOT THE VIEW. A source is a cursor
 * over an event array, not a view of one: the fold is pure and the array is
 * shared, so a per-connection source costs a number and not a copy (04 §3
 * O10). The view layer wraps these; it does not re-implement them, because a
 * second implementation of "read the events and fold" is the fork this whole
 * design exists to delete.
 */

import { applyEvent, frameAt } from './index';
import type {
  ConditionalHandle,
  ConditionalRequest,
  Cursor,
  DecisionSource,
  DecisionSourceKind,
  FrameStore,
  KernelLensPort,
  LensFrame,
  LensRefusal,
  MovesetBreakdown,
  MovesetKey,
  Provenanced,
  SourceDelta,
  TurnEvent,
} from '../types';

export interface SourceInput {
  readonly store: FrameStore;
  readonly at: Cursor;
  /**
   * The RUNNING kernel's query port, when there is one. Absent means the
   * decision is over (or has not started), and every conditional and breakdown
   * ask comes back as a TYPED REFUSAL rather than as silence — 04 §4.5's rule,
   * and the reason `source: 'empty'` renders as *searching* and not *nothing*.
   */
  readonly port?: KernelLensPort;
}

export interface LiveSourceInput extends SourceInput {
  readonly isHead: boolean;
}

function refuse(reason: LensRefusal['refusal'], detail: string): LensRefusal {
  return { ok: false, refusal: reason, detail };
}

const NO_PORT =
  'no running kernel is attached to this source, so nothing can be searched for the ask; ' +
  'the recorded frames answer, the reserve does not';

/**
 * The shared body of both sources. It takes the two content differences as
 * data — the source kind, and how to stamp `at` — so that neither
 * implementation can grow a behaviour the other lacks: there is exactly one
 * place below where a frame is built, and it is this one.
 */
function makeSource(
  kind: DecisionSourceKind,
  input: SourceInput,
  stamp: (frame: LensFrame) => LensFrame
): DecisionSource & { ingest(event: TurnEvent): void } {
  let store = input.store;
  let at = input.at;
  const listeners = new Set<(d: SourceDelta) => void>();

  function announce(delta: SourceDelta): void {
    for (const fn of listeners) fn(delta);
  }

  return {
    kind,
    get at(): Cursor {
      return at;
    },
    seek(to: Cursor): void {
      at = to;
      announce({ kind: 'cursor', at: to });
    },
    frame(): LensFrame {
      return stamp(frameAt(store, at.seq));
    },
    timeline(): ReadonlyArray<TurnEvent> {
      return frameAt(store, at.seq).events;
    },
    async breakdown(moveset: MovesetKey): Promise<Provenanced<MovesetBreakdown> | LensRefusal> {
      if (!input.port) return refuse('off-head', NO_PORT);
      const answer = await input.port.explainMoveset(moveset);
      if ('ok' in answer) return answer;
      return {
        value: answer,
        basis: answer.basis,
        provenance: { kind: 'observed', at },
      };
    },
    async conditional(req: ConditionalRequest): Promise<ConditionalHandle | LensRefusal> {
      if (!input.port) return refuse('off-head', NO_PORT);
      const answer = input.port.rankConditional(req.cluster, [req.lock]);
      if (!answer.ok) return answer;
      if (answer.clusterAfter.generation !== req.clusterGeneration) {
        return refuse(
          'generation-superseded',
          `cluster ${req.cluster} is at generation ${answer.clusterAfter.generation}, ` +
            `the ask named ${req.clusterGeneration} — rows from two generations are never in one list`
        );
      }
      return {
        requestId: answer.contextKey,
        ranking: answer.rows,
        cursor: answer.cursor,
        final: answer.final,
        cancel(): void {
          /* The reserve is declared, not taken: a cancelled ask frees nothing
             that was not already free, so there is nothing to unwind. */
        },
      };
    },
    subscribe(fn: (d: SourceDelta) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** Live only in practice, and harmless on a replay: fold one more event
     *  and tell every cursor watching. The reducer refuses a duplicate `seq`,
     *  so a re-delivered event costs a scan and changes nothing. */
    ingest(event: TurnEvent): void {
      const next = applyEvent(store, event);
      if (next === store) return;
      store = next;
      announce({ kind: 'event', event });
    },
  };
}

/** Live: the events arrive; `isHead` says whether determinations are legal. */
export function makeLiveSource(input: LiveSourceInput): DecisionSource & {
  ingest(event: TurnEvent): void;
} {
  return makeSource('live', input, (frame) => ({
    ...frame,
    at: {
      ...frame.at,
      mode: input.isHead ? 'live-head' : 'live-scrub',
      isHead: input.isHead,
    },
  }));
}

/** Replay: the events were read from `turn_events`. Closed at the head, so no
 *  determination is offered — and the same frame otherwise, field for field. */
export function makeReplaySource(input: SourceInput): DecisionSource & {
  ingest(event: TurnEvent): void;
} {
  return makeSource('replay', input, (frame) => ({
    ...frame,
    at: { ...frame.at, mode: 'replay', isHead: false },
  }));
}
