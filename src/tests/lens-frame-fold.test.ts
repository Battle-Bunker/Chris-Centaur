/**
 * THE FOLD EQUALS LIVE STATE — Law C at the unit level.
 *
 * A real decision runs with the `lens` sink attached. The live source holds a
 * `LensFrame` at every emission; the same emitted `TurnEvent` array is folded
 * INDEPENDENTLY to the same `seq`; the two are deep-equal, every seq, every
 * field. That is the same property G-L1 later asserts end to end across the
 * wire, the writer, Postgres and the reader — the four places a shape can
 * drift — and this file is where it is cheap to find out.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is a frame carrying a DELTA rather
 * than the whole thing (03 §5.1). A delta folds correctly live, where the
 * consumer saw the predecessor, and wrongly in replay, where it did not. The
 * `partition` frame therefore carries the entire partition and the `movesets`
 * frame the entire reservoir, with diffs travelling alongside for animation
 * only — and the two independent paths below are how that is checked rather
 * than asserted.
 */

import { recordLensRun } from '../lens/kernel';
import { applyEvent, emptyStore, frameAt, ingestLensEvents, makeSeqWriter } from '../lens/store';
import { makeLiveDecisionSource } from '../lens/view';
import type { FrameStore, LensFrame, TurnEvent } from '../lens/types';
import { FIXTURE_GAME, anchorEvent } from './lens-fixtures';

const TURN = 1;

/**
 * THE ANCHOR IS ONE OF THE TURN'S OWN EVENTS, written by the turn's own
 * writer — which is what production does (`view/index.ts::storeOf` picks the
 * stream's `board.arrived`, `store/index.ts::storeFromRows` rebuilds it at the
 * stored anchor's seq) and therefore what this harness has to do too. Writing
 * it here spends seq 0 on it and starts the recorded stream at 1. Handing
 * `emptyStore` a SYNTHETIC anchor beside a stream that also began at 0 put two
 * distinct events on one `seq`, which the writer's own uniqueness contract
 * forbids and which `upTo`'s sort cannot order.
 */
async function recordedTurn(): Promise<{
  anchor: TurnEvent;
  events: ReadonlyArray<TurnEvent>;
}> {
  const writer = makeSeqWriter(FIXTURE_GAME, TURN);
  // `write` stamps its own `id` and `seq` over whatever the draft carried.
  const anchor = writer.write(anchorEvent(undefined, TURN));
  const lensEvents = await recordLensRun({
    scenario: 'mixed',
    seed: 1,
    nodes: 550,
    turns: 1,
  });
  return { anchor, events: ingestLensEvents(writer, lensEvents) };
}

/** The LIVE path: feed one event at a time, read the frame each time. */
function liveFrames(
  anchor: TurnEvent,
  events: ReadonlyArray<TurnEvent>
): ReadonlyArray<LensFrame> {
  let store: FrameStore = emptyStore(anchor);
  const out: LensFrame[] = [];
  for (const event of events) {
    store = applyEvent(store, event);
    const source = makeLiveDecisionSource({
      store,
      at: { gameId: FIXTURE_GAME, turn: TURN, seq: event.seq },
      isHead: true,
    });
    out.push(source.frame());
  }
  return out;
}

/** Everything but the cursor coordinate, which is the one thing the two paths
 *  are entitled to disagree about. */
function withoutAt(frame: LensFrame): unknown {
  const copy: Record<string, unknown> = { ...frame };
  delete copy.at;
  return copy;
}

/** The REPLAY path: fold the whole array once, then ask for each seq. */
function foldedFrames(
  anchor: TurnEvent,
  events: ReadonlyArray<TurnEvent>
): ReadonlyArray<LensFrame> {
  const store = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(anchor));
  return events.map((e) => frameAt(store, e.seq));
}

describe('every live frame equals the independent fold at the same seq', () => {
  it('agrees field for field, at every seq of a real decision', async () => {
    const { anchor, events } = await recordedTurn();
    expect(events.length).toBeGreaterThan(0);
    const live = liveFrames(anchor, events);
    const folded = foldedFrames(anchor, events);
    expect(folded).toHaveLength(live.length);
    for (let i = 0; i < live.length; i++) {
      const { at: liveAt, ...liveRest } = live[i] as LensFrame;
      const { at: foldAt, ...foldRest } = folded[i] as LensFrame;
      expect(foldRest).toEqual(liveRest);
      expect(foldAt.seq).toBe(liveAt.seq);
      expect(foldAt.turn).toBe(liveAt.turn);
    }
  }, 120_000);

  it('carries the WHOLE partition on a partition frame, not a diff', async () => {
    const { anchor, events } = await recordedTurn();
    const store = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(anchor));
    const partitions = events.filter((e) => e.kind === 'partition');
    expect(partitions.length).toBeGreaterThan(0);
    for (const e of partitions) {
      // Folding from t0 to exactly this seq must give the same partition as
      // folding the whole turn and asking for this seq — which is only true
      // if the frame is whole.
      const upTo = events
        .filter((x) => x.seq <= e.seq)
        .reduce<FrameStore>((s, x) => applyEvent(s, x), emptyStore(anchor));
      expect(frameAt(upTo, e.seq).partition).toEqual(frameAt(store, e.seq).partition);
      expect(frameAt(store, e.seq).partition.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('carries the WHOLE reservoir on a movesets frame, not a diff', async () => {
    const { anchor, events } = await recordedTurn();
    const store = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(anchor));
    const movesetFrames = events.filter((e) => e.kind === 'movesets');
    expect(movesetFrames.length).toBeGreaterThan(0);
    for (const e of movesetFrames) {
      const upTo = events
        .filter((x) => x.seq <= e.seq)
        .reduce<FrameStore>((s, x) => applyEvent(s, x), emptyStore(anchor));
      expect(frameAt(upTo, e.seq).movesets).toEqual(frameAt(store, e.seq).movesets);
    }
  }, 120_000);
});

describe('the fold survives a consumer that never saw the predecessor', () => {
  it('reconstructs the last frame from the event array alone', async () => {
    const { anchor, events } = await recordedTurn();
    const last = events[events.length - 1] as TurnEvent;
    const cold = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(anchor));
    const live = liveFrames(anchor, events)[events.length - 1] as LensFrame;
    expect(withoutAt(frameAt(cold, last.seq))).toEqual(withoutAt(live));
  }, 120_000);

  it("never crosses a turn boundary: the fold's t0 is board.arrived", async () => {
    const { anchor, events } = await recordedTurn();
    const store = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(anchor));
    expect(store.anchor.kind).toBe('board.arrived');
    expect(store.events.every((e) => e.turn === TURN)).toBe(true);
  }, 120_000);
});
