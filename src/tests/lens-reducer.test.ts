/**
 * REDUCER PURITY.
 *
 * Live and replay are the SAME pure fold `applyEvent(store, e)` over the same
 * `TurnEvent` type (Law C). There is no replay-specific state, no
 * replay-specific shape, and no `if (live)` anywhere below it. The only
 * differences are who hands the events over, whether `at.isHead` is true, and
 * a `provenance` badge — which is content, not a branch.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is a reducer that reads the wall
 * clock. That is the single thing that would make replay silently disagree
 * with live: it folds correctly today, in front of the operator, and wrongly
 * tomorrow, in front of whoever is auditing the turn. So the last block reads
 * the reducer module's own SOURCE and refuses `Date.now`, `Math.random` and
 * `this` outright — a structural assertion, because a behavioural one cannot
 * distinguish "pure" from "impure but not exercised yet".
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { applyEvent, emptyStore, frameAt } from '../lens/store';
import type { FrameStore, TurnEvent } from '../lens/types';
import { anchorEvent, operatorActor, turnEvent } from './lens-fixtures';
import { digestOf } from '../lobster/team-decision-engine';
import { DEFAULT_KERNEL_OPTIONS } from '../lobster/kernel';
import { BoundEvaluator, DEFAULT_PROFILE, defaultEvaluator } from '../lobster/evaluate';

const REDUCER_SOURCE = join(__dirname, '..', 'lens', 'store', 'index.ts');

const ANCHOR = anchorEvent();

const STREAM: ReadonlyArray<TurnEvent> = [
  turnEvent({ kind: 'decision.begin', seq: 1, payload: { decisionId: 'd1' } }),
  turnEvent({
    kind: 'partition',
    seq: 2,
    payload: { generation: 0, epoch: 0, posture: 'SIGHTED', clusters: [], changes: [] },
    atWorkMs: 3,
  }),
  turnEvent({
    kind: 'pin',
    seq: 3,
    actor: operatorActor('ada'),
    unit: 'A-A',
    payload: { unit: 'A-A', to: 20, tentative: false },
  }),
  turnEvent({
    kind: 'movesets',
    seq: 4,
    payload: { cluster: 0, generation: 0, emissionSeq: 5, complementKey: 'comp:live', rows: [] },
    atWorkMs: 18,
  }),
  turnEvent({
    kind: 'emission',
    seq: 5,
    answers: `${ANCHOR.gameId}:1:3`,
    payload: { planKey: 'plan:1', lo: 1, est: 2, hi: 3, slack: 2, horizon: 1, epoch: 1 },
    atWorkMs: 21,
  }),
  turnEvent({ kind: 'decision.end', seq: 6, payload: { decisionId: 'd1', abandoned: false } }),
];

function fold(events: ReadonlyArray<TurnEvent>): FrameStore {
  return events.reduce<FrameStore>((store, e) => applyEvent(store, e), emptyStore(ANCHOR));
}

describe('applyEvent never mutates its input', () => {
  it('leaves a deeply frozen store untouched, for every kind', () => {
    for (const event of STREAM) {
      const before = emptyStore(ANCHOR);
      Object.freeze(before);
      Object.freeze(before.events);
      const after = applyEvent(before, event);
      expect(after).not.toBe(before);
      expect(before.events).toHaveLength(0);
    }
  });

  it('does not mutate the EVENT it is handed either', () => {
    const event = { ...STREAM[2] } as TurnEvent;
    Object.freeze(event);
    const snapshot = JSON.stringify(event);
    applyEvent(emptyStore(ANCHOR), event);
    expect(JSON.stringify(event)).toBe(snapshot);
  });

  it('refuses the ANCHOR\'s own seq, which `upTo` folds alongside the events', () => {
    // `upTo` folds `[anchor, ...events]`. The dedupe compared the incoming seq
    // against `store.events` alone, so a re-delivered anchor was appended and
    // the fold then counted it twice: `frame.events` read [0, 0].
    const store = applyEvent(emptyStore(ANCHOR), ANCHOR);
    expect(store.events).toHaveLength(0);
    expect(frameAt(store, 9).events.map((e) => e.seq)).toEqual([0]);
    // And it survives a stream around it: the anchor arriving late is refused
    // where an event at a fresh seq is not.
    const folded = applyEvent(fold(STREAM), ANCHOR);
    expect(folded.events.map((e) => e.seq)).toEqual(STREAM.map((e) => e.seq));
    expect(frameAt(folded, 6).events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('appends rather than replaces: every folded event survives to the store', () => {
    const store = fold(STREAM);
    expect(store.events.map((e) => e.seq)).toEqual(STREAM.map((e) => e.seq));
    expect(store.anchor).toBe(ANCHOR);
    expect(store.turn).toBe(ANCHOR.turn);
  });
});

describe('frameAt is a pure function of (anchor, events ≤ seq)', () => {
  it('is stable under repetition — folding twice gives identical frames', () => {
    const a = frameAt(fold(STREAM), 5);
    const b = frameAt(fold(STREAM), 5);
    expect(b).toEqual(a);
  });

  it('is stable under shuffling, once the array is sorted by seq', () => {
    const shuffled = [4, 1, 5, 0, 3, 2].map((i) => STREAM[i] as TurnEvent);
    const bySeq = [...shuffled].sort((x, y) => x.seq - y.seq);
    expect(frameAt(fold(bySeq), 6)).toEqual(frameAt(fold(STREAM), 6));
  });

  it('ignores everything after `seq` — a later event cannot reach back', () => {
    const upToFour = frameAt(fold(STREAM.filter((e) => e.seq <= 4)), 4);
    expect(frameAt(fold(STREAM), 4)).toEqual(upToFour);
  });

  it('carries the whole state, never a delta against a predecessor', () => {
    // The falsifier for 03 §5.1: a frame that folds correctly live, where the
    // consumer saw the predecessor, and wrongly in replay.
    const direct = frameAt(fold(STREAM), 6);
    const fromScratch = frameAt(
      STREAM.reduce<FrameStore>((s, e) => applyEvent(s, e), emptyStore(ANCHOR)),
      6
    );
    expect(fromScratch).toEqual(direct);
    expect(direct.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  /**
   * 10 §4 O2. 02 §2.3 calls `evalVersion` mandatory on every frame — *"a number
   * without its `evalVersion` … is a cross-fiber comparison waiting to
   * happen"* — and every shipped frame carried an empty one, because
   * `provenanceOf` reads it out of the kernel-options digest and the decision
   * layer put none there. The digest is the production one, so this asserts
   * the field arrives at the fold rather than that the fold can read a fixture.
   */
  it('carries the evaluator version the decision layer put in the digest', () => {
    const digest = digestOf(DEFAULT_KERNEL_OPTIONS, defaultEvaluator);
    expect(typeof digest.evalVersion).toBe('string');
    expect(digest.evalVersion).toMatch(/^eval:[0-9a-f]{8}$/);
    // Structural, not object identity: a second evaluator on the same profile
    // is the same version, which is the whole point of the field.
    expect(
      digestOf(DEFAULT_KERNEL_OPTIONS, new BoundEvaluator(DEFAULT_PROFILE)).evalVersion
    ).toBe(digest.evalVersion);

    const frame = frameAt(
      fold([
        turnEvent({
          kind: 'decision.begin',
          seq: 1,
          payload: { decisionId: 'd1', input: { botId: 'b', behaviourId: 'h', kernelOptions: digest } },
        }),
      ]),
      1
    );
    expect(frame.provenance.evalVersion).toBe(digest.evalVersion);
  });

  it('answers at the anchor with an honest empty frame, not a throw', () => {
    const frame = frameAt(emptyStore(ANCHOR), 0);
    expect(frame.at.seq).toBe(0);
    expect(frame.partition).toEqual([]);
    expect(frame.provenance).toBeDefined();
  });
});

/** Comments say what the code must not do; the assertion is about the CODE. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

describe('the reducer module reads no clock and holds no state (structural)', () => {
  const source = codeOf(REDUCER_SOURCE);

  it('contains no Date.now and no new Date', () => {
    expect(source).not.toMatch(/Date\s*\.\s*now/);
    expect(source).not.toMatch(/new\s+Date\b/);
  });

  it('contains no Math.random', () => {
    expect(source).not.toMatch(/Math\s*\.\s*random/);
  });

  it('contains no `this` — the fold is a function, not an object', () => {
    expect(source).not.toMatch(/\bthis\b/);
  });

  it('contains no performance.now and no process.hrtime', () => {
    expect(source).not.toMatch(/performance\s*\.\s*now/);
    expect(source).not.toMatch(/hrtime/);
  });

  it('never branches on the source: no `live`/`replay` literal comparison', () => {
    expect(source).not.toMatch(/===\s*'(live|replay)'/);
    expect(source).not.toMatch(/isLive/);
  });
});
