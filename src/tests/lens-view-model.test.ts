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
import {
  applyCursorEvent,
  dominanceClause,
  initialCursor,
  makeLiveDecisionSource,
  makeReplayDecisionSource,
  renderFrame,
  rowsFor,
} from '../lens/view';
import type { FrameStore, LensFrame, Moveset, TurnEvent } from '../lens/types';
import { FIXTURE_GAME, anchorEvent } from './lens-fixtures';
/** The three fields that are ALLOWED to differ, and nothing else. */
import { comparableFrame as comparable } from './board-fixtures';

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

/**
 * THE MAP IS DRAWN FROM WHAT THE SEARCH ALREADY DECIDED (08 §3.4).
 *
 * A recorded decision, rendered: every retained row's `unless` cell comes off
 * that row's own `DominanceCondition`, which the reservoir filled at the
 * barrier from `better()`'s refusal branch. Nothing here prices anything, so
 * the falsifier is not cost — it is a clause that disagrees with the condition
 * stored beside it, or a row drawn without one.
 */
describe('every moveset row carries its condition into the transcript', () => {
  it('draws one non-empty `unless` per row, and it is the row own condition', async () => {
    const { store, events } = await recorded();
    let drawn = 0;
    // Rows are drawn for the cluster of the FOCUSED unit at the candidate the
    // cursor stands on, so the sweep walks every seq and every member: an
    // unfocused board draws no rows at all, by design.
    for (const event of events) {
      const at = { gameId: FIXTURE_GAME, turn: TURN, seq: event.seq };
      const frame = makeReplayDecisionSource({ store, at }).frame();
      for (const cluster of frame.partition) {
        for (const unit of cluster.members) {
          const cursor = applyCursorEvent(initialCursor(), frame, { t: 'focus', unit });
          const rows = rowsFor(frame, cursor.unit, cursor.candidate);
          const calls = renderFrame(frame, cursor).filter((c) => c.op === 'panel.movesets.row');
          expect(calls).toHaveLength(rows.length);
          calls.forEach((c, i) => {
            // The clause is a READ of the condition stored on that row, in
            // that row's own order — never a summary of the table.
            // args: rank, key, lo, width, cell, delta, unless, …
            expect(c.args[6]).toBe(dominanceClause((rows[i] as Moveset).dominance));
            expect(c.args[6]).not.toBe('');
            // The row's identity travels with it, so a click can name it (T6).
            expect(c.args[1]).toBe((rows[i] as Moveset).key);
          });
          drawn += calls.length;
        }
      }
    }
    // Not vacuous: a real decision really drew rows.
    expect(drawn).toBeGreaterThan(0);
  }, 120_000);

  it('names the evaluator residue rather than printing the sentinel at the operator', () => {
    expect(dominanceClause({ kind: 'contingent', onUnits: ['#-1', 'B-q1'], atStake: 2.44 })).toBe(
      'the evaluator residue, B-q1 resolve against us · 2.4 at stake'
    );
    // Every branch says something, and the leader says it leads.
    expect(dominanceClause({ kind: 'leader' })).toBe('leads on the proved floor');
    expect(dominanceClause(null)).toBe('unsealed — the barrier has not run');
  });
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
