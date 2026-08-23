/**
 * The team batch submitter: chunking, exclusion, and the confirm/retry loop.
 *
 * No Firestore and no emulator. The whole port is a fake, which is the point —
 * the chunking and exclusion contract is arithmetic over a set of units and
 * must be provable without a network. Where a rule exists only because
 * Firestore's security rules say so (the ten-document cap, the denial of a
 * committed player's writes) the test pins the CONSEQUENCE the client must
 * honour, since the rules themselves live in the other repo.
 */

import type { CentaurMove } from '../types/battlesnake';
import {
  MAX_BATCH_DOCS,
  TeamBatchSubmitter,
  TeamStagedUnit,
  TeamSubmitterPort,
  TimerHandle,
  planTeamBatches,
  privateMoveDoc,
} from '../wire/team-submitter';

const unit = (snakeId: string, move: CentaurMove = 'up'): TeamStagedUnit => ({
  snakeId,
  move,
  source: 'bot',
});

/** Snake ids that sort in an order DIFFERENT from their creation order, so a
 * test that accidentally depends on insertion order fails. */
function roster(n: number): TeamStagedUnit[] {
  const units: TeamStagedUnit[] = [];
  for (let i = 0; i < n; i++) units.push(unit(`u${String(n - i).padStart(2, '0')}`));
  return units;
}

// ── the wire document ──────────────────────────────────────────────────────

/**
 * The security rules cannot be executed from this repo, so what is pinned here
 * is the CLIENT's side of the same contract: the exact field set
 * `isValidPrivateMove` demands. The rule reads
 *
 *   move.keys().hasAll(['gameID','moveNumber','playerID','move','timestamp'])
 *     && move.gameID is string
 *     && move.moveNumber is int && move.moveNumber >= 0
 *     && move.playerID is string
 *     && move.move is int && move.move >= 0
 *     && (move.timestamp is timestamp || move.timestamp == request.time)
 *
 * A write that misses one of those is DENIED, not corrected — and a denied
 * write is silent from here, so the turn simply resolves without us.
 */
describe('the privateMoves document the rules will accept', () => {
  const SENTINEL = { __serverTimestamp: true };

  test('carries exactly the five fields the rule names, and no others', () => {
    const built = privateMoveDoc('game-1', 7, { playerID: 'A', move: 42 }, SENTINEL);
    expect(Object.keys(built).sort()).toEqual([
      'gameID',
      'move',
      'moveNumber',
      'playerID',
      'timestamp',
    ]);
    expect(built).toEqual({
      gameID: 'game-1',
      moveNumber: 7,
      playerID: 'A',
      move: 42,
      timestamp: SENTINEL,
    });
  });

  test('the staging source is NOT on the wire', () => {
    // Unknown fields are accepted and IGNORED server-side. A field the server
    // ignores must never be written as if it meant something.
    const built = privateMoveDoc('game-1', 0, { playerID: 'A', move: 1 }, SENTINEL) as Record<
      string,
      unknown
    >;
    expect(built.source).toBeUndefined();
    expect('source' in built).toBe(false);
  });

  test('the types the rule checks are the types that go out', () => {
    const built = privateMoveDoc('game-1', 0, { playerID: 'A', move: 0 }, SENTINEL);
    expect(typeof built.gameID).toBe('string');
    expect(typeof built.playerID).toBe('string');
    expect(Number.isInteger(built.moveNumber)).toBe(true);
    expect(built.moveNumber).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(built.move)).toBe(true);
    expect(built.move).toBeGreaterThanOrEqual(0);
  });

  test('every document a planned batch produces satisfies the rule’s shape', () => {
    const plan = planTeamBatches({
      units: roster(26),
      isCommitted: () => false,
      encode: (u) => Number(u.snakeId.replace(/\D/g, '')),
    });
    for (const chunk of plan.chunks) {
      for (const entry of chunk) {
        const built = privateMoveDoc('game-1', 3, entry, SENTINEL);
        expect(Object.keys(built).sort()).toEqual([
          'gameID',
          'move',
          'moveNumber',
          'playerID',
          'timestamp',
        ]);
        expect(Number.isInteger(built.move) && built.move >= 0).toBe(true);
      }
    }
  });
});

// ── the pure planner ───────────────────────────────────────────────────────

describe('chunking respects the ten-document cap', () => {
  const encode = (u: TeamStagedUnit) => Number(u.snakeId.replace(/\D/g, ''));

  test('the cap is ten, and it is the default', () => {
    expect(MAX_BATCH_DOCS).toBe(10);
    const plan = planTeamBatches({ units: roster(26), isCommitted: () => false, encode });
    expect(plan.chunks.map((c) => c.length)).toEqual([10, 10, 6]);
    for (const chunk of plan.chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_BATCH_DOCS);
  });

  test('a team of ten or fewer is ONE atomic batch — no residual window at all', () => {
    for (const n of [1, 2, 9, 10]) {
      const plan = planTeamBatches({ units: roster(n), isCommitted: () => false, encode });
      expect(plan.chunks.length).toBe(1);
      expect(plan.chunks[0].length).toBe(n);
    }
  });

  test('no unit appears twice — one document per player per batch, and per revision', () => {
    const plan = planTeamBatches({ units: roster(26), isCommitted: () => false, encode });
    const seen = new Set<string>();
    for (const chunk of plan.chunks) {
      const inChunk = new Set<string>();
      for (const doc of chunk) {
        expect(inChunk.has(doc.playerID)).toBe(false);
        expect(seen.has(doc.playerID)).toBe(false);
        inChunk.add(doc.playerID);
        seen.add(doc.playerID);
      }
    }
    expect(seen.size).toBe(26);
  });

  test('a duplicate unit in the input collapses to its last entry', () => {
    const plan = planTeamBatches({
      units: [unit('a', 'up'), unit('a', 'down')],
      isCommitted: () => false,
      encode: (u) => (u.move === 'up' ? 1 : 2),
    });
    expect(plan.chunks).toEqual([[{ playerID: 'a', move: 2, source: 'bot' }]]);
  });
});

describe('chunk groups are stable across revisions of a turn', () => {
  const encode = (u: TeamStagedUnit) => Number(u.snakeId.replace(/\D/g, ''));

  test('the same roster always cuts the same groups, whatever order it arrives in', () => {
    const forward = roster(26);
    const shuffled = [...forward].reverse();
    const a = planTeamBatches({ units: forward, isCommitted: () => false, encode });
    const b = planTeamBatches({ units: shuffled, isCommitted: () => false, encode });
    expect(a.groups).toEqual(b.groups);
    expect(a.groups.flat()).toEqual([...a.groups.flat()].sort());
  });

  test('a unit keeps its group when its own move changes', () => {
    const base = planTeamBatches({ units: roster(26), isCommitted: () => false, encode });
    const changed = planTeamBatches({
      units: roster(26),
      isCommitted: () => false,
      encode: (u) => encode(u) + 100,
    });
    expect(changed.groups).toEqual(base.groups);
  });

  test('so a revision interrupted mid-way leaves WHOLE groups from two adjacent revisions', () => {
    const units = roster(26);
    const revA = planTeamBatches({ units, isCommitted: () => false, encode: (u) => encode(u) });
    const revB = planTeamBatches({ units, isCommitted: () => false, encode: (u) => encode(u) + 100 });
    // Revision B is interrupted after its first chunk. What the server holds:
    const wire = new Map<string, number>();
    for (const doc of revA.chunks.flat()) wire.set(doc.playerID, doc.move);
    for (const doc of revB.chunks[0]) wire.set(doc.playerID, doc.move);
    // Every unit's move comes from exactly one revision, and every GROUP is
    // internally from one revision — the coherence claim.
    revB.groups.forEach((group, i) => {
      const fromB = group.map((id) => wire.get(id)! >= 100);
      expect(new Set(fromB).size).toBe(1);
      expect(fromB[0]).toBe(i === 0);
    });
  });
});

describe('exclusions', () => {
  const encode = (u: TeamStagedUnit) => Number(u.snakeId.replace(/\D/g, ''));

  test('a human-committed unit is dropped, with a reason', () => {
    const committed = new Set(['u03', 'u17']);
    const plan = planTeamBatches({
      units: roster(26),
      isCommitted: (id) => committed.has(id),
      encode,
    });
    const written = plan.chunks.flat().map((d) => d.playerID);
    expect(written).not.toContain('u03');
    expect(written).not.toContain('u17');
    expect(plan.excluded).toEqual([
      { snakeId: 'u17', reason: 'committed' },
      { snakeId: 'u03', reason: 'committed' },
    ]);
    expect(written.length).toBe(24);
  });

  test('excluding a committed unit re-cuts the groups but never splits a batch over ten', () => {
    const plan = planTeamBatches({
      units: roster(26),
      isCommitted: (id) => id === 'u01',
      encode,
    });
    expect(plan.chunks.map((c) => c.length)).toEqual([10, 10, 5]);
  });

  test('a unit the wire cannot encode is dropped rather than poisoning the batch', () => {
    const plan = planTeamBatches({
      units: [unit('a'), unit('b'), unit('c')],
      isCommitted: () => false,
      encode: (u) => (u.snakeId === 'b' ? null : 1),
    });
    expect(plan.chunks.flat().map((d) => d.playerID)).toEqual(['a', 'c']);
    expect(plan.excluded).toEqual([{ snakeId: 'b', reason: 'unencodable' }]);
  });

  test('a non-integer encoding is refused too', () => {
    const plan = planTeamBatches({
      units: [unit('a')],
      isCommitted: () => false,
      encode: () => 3.5,
    });
    expect(plan.chunks).toEqual([]);
    expect(plan.excluded).toEqual([{ snakeId: 'a', reason: 'unencodable' }]);
  });

  test('an all-committed team plans nothing at all', () => {
    const plan = planTeamBatches({ units: roster(4), isCommitted: () => true, encode });
    expect(plan.chunks).toEqual([]);
    expect(plan.groups).toEqual([]);
  });
});

describe('unchanged units are omitted', () => {
  const encode = (u: TeamStagedUnit) => Number(u.snakeId.replace(/\D/g, ''));

  test('a unit already holding the wanted move writes nothing', () => {
    const lastWritten = new Map<string, number>([['u01', 1], ['u02', 2]]);
    const plan = planTeamBatches({ units: roster(3), isCommitted: () => false, encode, lastWritten });
    expect(plan.chunks.flat().map((d) => d.playerID)).toEqual(['u03']);
    expect(plan.unchanged).toEqual(['u01', 'u02']);
  });

  test('a steady-state revision of a big team collapses to one batch — no window', () => {
    const lastWritten = new Map(roster(26).map((u) => [u.snakeId, encode(u)]));
    lastWritten.delete('u14'); // one unit changed its mind
    const plan = planTeamBatches({ units: roster(26), isCommitted: () => false, encode, lastWritten });
    expect(plan.chunks.length).toBe(1);
    expect(plan.chunks[0].map((d) => d.playerID)).toEqual(['u14']);
  });

  test('an empty group is dropped, not committed as an empty batch', () => {
    const lastWritten = new Map(roster(26).map((u) => [u.snakeId, encode(u)]));
    for (const id of ['u21', 'u22']) lastWritten.delete(id);
    const plan = planTeamBatches({ units: roster(26), isCommitted: () => false, encode, lastWritten });
    for (const chunk of plan.chunks) expect(chunk.length).toBeGreaterThan(0);
    expect(plan.chunks.flat().map((d) => d.playerID)).toEqual(['u21', 'u22']);
  });
});

// ── the submitter ──────────────────────────────────────────────────────────

interface Commit {
  turn: number;
  docs: Array<{ playerID: string; move: number }>;
}

class FakePort implements TeamSubmitterPort {
  commits: Commit[] = [];
  committed = new Set<string>();
  confirmedMoves = new Map<string, CentaurMove>();
  failNextChunks = 0;
  clock = 0;
  timers: Array<{ id: number; at: number; fn: () => void }> = [];
  private nextTimerId = 1;
  logs: string[] = [];

  encode(_gameId: string, _turn: number, u: TeamStagedUnit): number | null {
    if (typeof u.move === 'number') return u.move;
    const table: Record<string, number> = { up: 1, down: 2, left: 3, right: 4 };
    return table[u.move] ?? null;
  }

  async commitChunk(
    _gameId: string,
    turn: number,
    docs: ReadonlyArray<{ playerID: string; move: number }>
  ): Promise<void> {
    if (this.failNextChunks > 0) {
      this.failNextChunks -= 1;
      throw new Error('batch rejected');
    }
    this.commits.push({ turn, docs: docs.map((d) => ({ playerID: d.playerID, move: d.move })) });
    // A landed batch is what the read-back would report a moment later.
    for (const d of docs) {
      const move = Object.entries({ up: 1, down: 2, left: 3, right: 4 }).find(
        ([, v]) => v === d.move
      )?.[0];
      this.confirmedMoves.set(d.playerID, (move as CentaurMove) ?? d.move);
    }
  }

  isCommitted(_gameId: string, snakeId: string): boolean {
    return this.committed.has(snakeId);
  }

  confirmed(_gameId: string, snakeId: string): CentaurMove | null {
    return this.confirmedMoves.get(snakeId) ?? null;
  }

  now(): number {
    return this.clock;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextTimerId++;
    this.timers.push({ id, at: this.clock + ms, fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  /** Advance the fake clock, firing anything due. */
  async advance(ms: number): Promise<void> {
    const target = this.clock + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.clock = due.at;
      due.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.clock = target;
  }

  log = (message: string): void => {
    this.logs.push(message);
  };
}

function makeSubmitter(port: FakePort, opts: Record<string, unknown> = {}) {
  return new TeamBatchSubmitter(port, {
    minWriteIntervalMs: 1000,
    confirmBackstopMs: 1000,
    log: port.log,
    ...opts,
  });
}

describe('the submitter puts a joint set on the wire in batches', () => {
  test('26 units go out as 10 + 10 + 6, in group order', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    const result = await sub.submitTeamSet('g', 5, roster(26));
    expect(result.chunks).toBe(3);
    expect(result.docs).toBe(26);
    expect(port.commits.map((c) => c.docs.length)).toEqual([10, 10, 6]);
    expect(port.commits.every((c) => c.turn === 5)).toBe(true);
  });

  test('a committed unit is excluded and reported', async () => {
    const port = new FakePort();
    port.committed.add('u02');
    const sub = makeSubmitter(port);
    const result = await sub.submitTeamSet('g', 5, roster(4));
    expect(result.excluded).toEqual([{ snakeId: 'u02', reason: 'committed' }]);
    expect(port.commits[0].docs.map((d) => d.playerID)).toEqual(['u01', 'u03', 'u04']);
    expect(port.logs.some((l) => l.includes('excluding committed u02'))).toBe(true);
  });

  test('a second revision inside the interval is deferred, then flushed', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    expect(port.commits.length).toBe(1);

    port.clock = 300;
    const deferred = await sub.submitTeamSet('g', 5, [unit('a', 'down')]);
    expect(deferred.deferred).toBe(true);
    expect(deferred.retryAfterMs).toBe(700);
    expect(port.commits.length).toBe(1);

    await port.advance(700);
    expect(port.commits.length).toBe(2);
    expect(port.commits[1].docs).toEqual([{ playerID: 'a', move: 2 }]);
  });

  test('a FINAL flush is never deferred', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.clock = 1;
    const result = await sub.submitTeamSet('g', 5, [unit('a', 'left')], { final: true });
    expect(result.deferred).toBe(false);
    expect(port.commits.length).toBe(2);
    expect(port.commits[1].docs).toEqual([{ playerID: 'a', move: 3 }]);
  });

  test('a final flush with nothing new to say writes nothing', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.clock = 5000;
    const result = await sub.finalFlush('g', 5);
    expect(result.docs).toBe(0);
    expect(port.commits.length).toBe(1);
  });

  test('a revision for a turn the board has already left is refused', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 6, [unit('a', 'up')]);
    port.clock = 5000;
    const stale = await sub.submitTeamSet('g', 5, [unit('a', 'down')]);
    expect(stale.docs).toBe(0);
    expect(port.commits.length).toBe(1);
  });

  test('a new turn resets the throttle allowance so its first revision is instant', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.clock = 10;
    const next = await sub.submitTeamSet('g', 6, [unit('a', 'down')]);
    expect(next.deferred).toBe(false);
    expect(port.commits.length).toBe(2);
  });
});

describe('the confirm/retry backstop', () => {
  test('a lost write is republished on the backstop tick', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up'), unit('b', 'down')]);
    expect(port.commits.length).toBe(1);
    // The read-back never acked 'b' — the batch is reported landed but the
    // document is not there.
    port.confirmedMoves.delete('b');

    await port.advance(1000);
    expect(port.commits.length).toBe(2);
    expect(port.commits[1].docs).toEqual([{ playerID: 'b', move: 2 }]);
    expect(port.logs.some((l) => l.includes('still unconfirmed b'))).toBe(true);
  });

  test('a fully confirmed set arms no republish', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    await port.advance(5000);
    expect(port.commits.length).toBe(1);
  });

  test('a committed unit is never republished, however unconfirmed it looks', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.confirmedMoves.delete('a');
    port.committed.add('a');
    await port.advance(5000);
    expect(port.commits.length).toBe(1);
  });

  test('a rejected batch stops the revision and the backstop re-plans it', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    port.failNextChunks = 1;
    const result = await sub.submitTeamSet('g', 5, roster(26));
    expect(result.failedChunkIndex).toBe(0);
    // The failure stopped the sequence: chunks 1 and 2 were not attempted.
    expect(port.commits.length).toBe(0);
    expect(port.logs.some((l) => l.includes('failed'))).toBe(true);

    await port.advance(1000);
    expect(port.commits.map((c) => c.docs.length)).toEqual([10, 10, 6]);
  });

  test('the backstop republish is exempt from the throttle — a repair is not a revision', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port, { minWriteIntervalMs: 60_000 });
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.confirmedMoves.delete('a');
    await port.advance(1000);
    expect(port.commits.length).toBe(2);
  });
});

describe('housekeeping', () => {
  test('abandon clears timers and state', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.confirmedMoves.delete('a');
    sub.abandon('g');
    await port.advance(5000);
    expect(port.commits.length).toBe(1);
    expect(port.timers.length).toBe(0);
    expect(sub.desiredSet('g')).toEqual([]);
  });

  test('the desired set is the whole joint set, merged across revisions', async () => {
    const port = new FakePort();
    const sub = makeSubmitter(port);
    await sub.submitTeamSet('g', 5, [unit('a', 'up')]);
    port.clock = 2000;
    await sub.submitTeamSet('g', 5, [unit('b', 'down')]);
    expect(sub.desiredSet('g').map((u) => u.snakeId).sort()).toEqual(['a', 'b']);
  });
});
