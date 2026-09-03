/**
 * LIVE AND REPLAY RENDER IDENTICALLY.
 *
 * Two sources, one reducer, one view-model. A `LensFrame` built from
 * `LiveDecisionSource` and one built from `ReplayDecisionSource` at the same
 * `(turn, seq)` of the same recorded session are deep-equal EXCEPT `at.mode`,
 * `at.isHead` and `provenance.kind` — the three fields that are content the
 * operator is entitled to, rendered as a badge and never as a branch (Law C).
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is the two paths drifting, which the
 * shipped code has ALREADY DONE: `play-game.html`'s live and replay evaluation
 * panels differ in their empty states, and nothing noticed. So the last block
 * is structural — no renderer function may branch on mode, asserted as "no
 * `mode ===` outside the badge component" — because a behavioural test can only
 * catch the branches a fixture happens to walk.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { recordLensRun } from '../lens/kernel';
import { applyEvent, emptyStore, ingestLensEvents, makeSeqWriter } from '../lens/store';
import { makeLiveDecisionSource, makeReplayDecisionSource, renderFrame } from '../lens/view';
import type { FrameStore, LensFrame, TurnEvent } from '../lens/types';
import { FIXTURE_GAME, anchorEvent } from './lens-fixtures';

const TURN = 1;
const ANCHOR = anchorEvent();
const VIEW_SOURCE = join(__dirname, '..', 'lens', 'view', 'index.ts');

async function recorded(): Promise<{ store: FrameStore; events: ReadonlyArray<TurnEvent> }> {
  const writer = makeSeqWriter(FIXTURE_GAME, TURN);
  const events = ingestLensEvents(
    writer,
    await recordLensRun({ scenario: 'mixed', seed: 1, nodes: 550, turns: 1 })
  );
  const store = events.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(ANCHOR));
  return { store, events };
}

function pair(store: FrameStore, seq: number): { live: LensFrame; replay: LensFrame } {
  const at = { gameId: FIXTURE_GAME, turn: TURN, seq };
  return {
    live: makeLiveDecisionSource({ store, at, isHead: false }).frame(),
    replay: makeReplayDecisionSource({ store, at }).frame(),
  };
}

/** The three fields that are ALLOWED to differ, and nothing else. */
function comparable(frame: LensFrame): unknown {
  const at: Record<string, unknown> = { ...frame.at };
  delete at.mode;
  delete at.isHead;
  const provenance: Record<string, unknown> = { ...frame.provenance };
  delete provenance.kind;
  return { ...frame, at, provenance };
}

describe('the two sources produce the same frame', () => {
  it('is deep-equal at every seq except mode, isHead and provenance.kind', async () => {
    const { store, events } = await recorded();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const { live, replay } = pair(store, event.seq);
      expect(comparable(replay)).toEqual(comparable(live));
    }
  }, 120_000);

  it('differs in exactly those three fields, and they carry real content', async () => {
    const { store, events } = await recorded();
    const seq = (events[events.length - 1] as TurnEvent).seq;
    const at = { gameId: FIXTURE_GAME, turn: TURN, seq };
    const head = makeLiveDecisionSource({ store, at, isHead: true }).frame();
    const replay = makeReplayDecisionSource({ store, at }).frame();
    expect(head.at.mode).toBe('live-head');
    expect(head.at.isHead).toBe(true);
    expect(replay.at.mode).toBe('replay');
    expect(replay.at.isHead).toBe(false);
    expect(['observed', 'rerun']).toContain(replay.provenance.kind);
  }, 120_000);

  it('scrubbing back within the live turn is `live-scrub`, not `replay`', async () => {
    const { store, events } = await recorded();
    const earlier = (events[Math.floor(events.length / 2)] as TurnEvent).seq;
    const source = makeLiveDecisionSource({
      store,
      at: { gameId: FIXTURE_GAME, turn: TURN, seq: (events[events.length - 1] as TurnEvent).seq },
      isHead: true,
    });
    source.seek({ gameId: FIXTURE_GAME, turn: TURN, seq: earlier });
    const frame = source.frame();
    expect(frame.at.mode).toBe('live-scrub');
    expect(frame.at.isHead).toBe(false);
    expect(comparable(frame)).toEqual(comparable(pair(store, earlier).replay));
  }, 120_000);

  it('shows one honest empty state, not two different ones', async () => {
    const store = emptyStore(ANCHOR);
    const at = { gameId: FIXTURE_GAME, turn: TURN, seq: 0 };
    const live = makeLiveDecisionSource({ store, at, isHead: true }).frame();
    const replay = makeReplayDecisionSource({ store, at }).frame();
    expect(comparable(replay)).toEqual(comparable(live));
    expect(live.partition).toEqual([]);
    expect(live.movesets).toEqual({});
  });
});

describe('the renderer produces identical draw-call transcripts', () => {
  it('draws the same calls from the live and the replay frame', async () => {
    const { store, events } = await recorded();
    for (const event of events) {
      const { live, replay } = pair(store, event.seq);
      expect(renderFrame(replay)).toEqual(renderFrame(live));
    }
  }, 120_000);

  it('draws the SAME calls even at the head, where determinations are legal', async () => {
    const { store, events } = await recorded();
    const seq = (events[events.length - 1] as TurnEvent).seq;
    const at = { gameId: FIXTURE_GAME, turn: TURN, seq };
    const head = renderFrame(makeLiveDecisionSource({ store, at, isHead: true }).frame());
    const replay = renderFrame(makeReplayDecisionSource({ store, at }).frame());
    // The affordances differ in their LABELS, which are arguments, not calls:
    // the shape of the drawing is one shape.
    expect(replay.map((c) => c.op)).toEqual(head.map((c) => c.op));
  }, 120_000);
});

describe('no renderer branches on mode (structural)', () => {
  const source = readFileSync(VIEW_SOURCE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  it('contains no `mode ===` comparison anywhere in the view module', () => {
    expect(source).not.toMatch(/mode\s*===/);
    expect(source).not.toMatch(/===\s*'(live-head|live-scrub|replay)'/);
  });

  it('contains no isHead branch outside a badge', () => {
    const branching = source.match(/if\s*\([^)]*isHead[^)]*\)/g) ?? [];
    expect(branching).toEqual([]);
  });

  it('contains no historic-path vocabulary at all', () => {
    // The ~900-line live/replay fork this module replaces: if any of these
    // names come back, so has the fork.
    for (const dead of ['renderHistoric', 'historicMoveState', 'showHistoricNoDataPanel']) {
      expect(source).not.toContain(dead);
    }
  });
});
