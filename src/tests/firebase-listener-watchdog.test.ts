import { listenerLooksDead } from '../firebase/firebase-interface';

// The watchdog rebuilds the whole Firebase client when it decides a game-doc
// listener has silently died. Getting this wrong is expensive in both
// directions: too eager and it tears down the per-turn read-back listeners
// mid-turn (staged moves then never confirm — the "solid arrow never catches
// up to the ghost" bug); too lax and the bot plays blind while the server
// applies default moves.

const GRACE_MS = 8_000;
const T0 = 1_700_000_000_000;

const dead = (over: Partial<Parameters<typeof listenerLooksDead>[0]>) =>
  listenerLooksDead({
    now: T0,
    lastSnapshotMs: T0,
    turnEndTimeMs: T0,
    graceMs: GRACE_MS,
    ...over,
  });

describe('listenerLooksDead', () => {
  it('is quiet while snapshots are still arriving', () => {
    expect(dead({ now: T0 + 1_000, lastSnapshotMs: T0, turnEndTimeMs: 0 })).toBe(false);
  });

  it('tolerates a long first turn — 60s of silence before the deadline is normal', () => {
    // Turn 0 runs for firstTurnTime (60s by default). The game doc is
    // deliberately untouched for its whole duration; the old fixed 8s window
    // condemned it every few seconds and took the read-back listeners with it.
    const turnEnd = T0 + 60_000;
    for (const elapsed of [9_000, 20_000, 45_000, 59_000]) {
      expect(dead({ now: T0 + elapsed, lastSnapshotMs: T0, turnEndTimeMs: turnEnd })).toBe(false);
    }
  });

  it('also tolerates an ordinary turn outlasting the grace window', () => {
    const turnEnd = T0 + 10_000;
    expect(dead({ now: T0 + 9_000, lastSnapshotMs: T0, turnEndTimeMs: turnEnd })).toBe(false);
  });

  it('fires once the next turn is overdue past the grace window', () => {
    const turnEnd = T0 + 60_000;
    expect(dead({ now: turnEnd + GRACE_MS + 1, lastSnapshotMs: T0, turnEndTimeMs: turnEnd })).toBe(
      true
    );
  });

  it('holds off exactly at the grace boundary', () => {
    const turnEnd = T0 + 60_000;
    expect(dead({ now: turnEnd + GRACE_MS, lastSnapshotMs: T0, turnEndTimeMs: turnEnd })).toBe(
      false
    );
  });

  it('stays quiet past a deadline while snapshots keep arriving', () => {
    // A resolved turn whose successor is already flowing: recent snapshots
    // outrank a stale deadline.
    const turnEnd = T0;
    expect(
      dead({ now: T0 + 30_000, lastSnapshotMs: T0 + 29_000, turnEndTimeMs: turnEnd })
    ).toBe(false);
  });

  it('falls back to plain silence when no deadline is known', () => {
    expect(dead({ now: T0 + GRACE_MS + 1, lastSnapshotMs: T0, turnEndTimeMs: 0 })).toBe(true);
    expect(dead({ now: T0 + GRACE_MS, lastSnapshotMs: T0, turnEndTimeMs: 0 })).toBe(false);
  });
});
