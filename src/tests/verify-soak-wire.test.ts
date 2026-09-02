/**
 * V3 SOAK — WIRE BEHAVIOUR UNDER REVISION STORMS, at 8 / 12 / 26 units.
 *
 * Every claim the W3a report makes about the team submitter, driven against a
 * fake Firestore that records what the server would actually hold:
 *
 *   - chunk cap of 10 documents, one document per player per batch
 *   - a committed unit is excluded, an unchanged unit is omitted
 *   - the partition is STABLE across revisions of a turn
 *   - an interrupted revision leaves a union of WHOLE groups from two ADJACENT
 *     revisions (proved by killing the submitter mid-sequence)
 *   - a team of <= 10 has no torn window at all; a team of > 10 does
 *   - the throttle charges WRITES, not attempts
 *   - the final flush is exempt from the throttle
 *   - a backstop republish is exempt from the throttle
 */

import type { CentaurMove } from '../types/battlesnake';
import {
  MAX_BATCH_DOCS,
  TeamBatchSubmitter,
  planTeamBatches,
  type TeamBatchDoc,
  type TeamStagedUnit,
  type TeamSubmitterPort,
} from '../wire/team-submitter';
import { StageThrottle } from '../wire/stage-throttle';

const TEAM_SIZES = [8, 12, 26] as const;

const roster = (n: number, base: number): TeamStagedUnit[] =>
  Array.from({ length: n }, (_, i) => ({
    snakeId: `u${String(i).padStart(2, '0')}`,
    move: base + i,
    source: 'bot' as const,
  }));

// ------------------------------------------------------------- fake firestore

interface FakeOptions {
  now(): number;
  dieAfterChunks?: number;
  ackWrites?: boolean;
}

class Fake implements TeamSubmitterPort {
  readonly writes: Array<{ turn: number; docs: TeamBatchDoc[] }> = [];
  readonly latest = new Map<string, number>();
  private readonly acked = new Map<string, number>();
  readonly committed = new Set<string>();
  private commits = 0;

  constructor(private readonly opts: FakeOptions) {}

  now(): number {
    return this.opts.now();
  }

  encode(_g: string, _t: number, unit: TeamStagedUnit): number | null {
    return typeof unit.move === 'number' ? unit.move : null;
  }

  async commitChunk(_g: string, turn: number, docs: ReadonlyArray<TeamBatchDoc>): Promise<void> {
    if (this.opts.dieAfterChunks !== undefined && this.commits >= this.opts.dieAfterChunks) {
      throw new Error('submitter died');
    }
    this.commits++;
    this.writes.push({ turn, docs: docs.map((d) => ({ ...d })) });
    for (const d of docs) {
      this.latest.set(`${turn}:${d.playerID}`, d.move);
      if (this.opts.ackWrites !== false) this.acked.set(`${turn}:${d.playerID}`, d.move);
    }
  }

  isCommitted(_g: string, snakeId: string, turn: number): boolean {
    return this.committed.has(`${turn}:${snakeId}`);
  }

  confirmed(_g: string, snakeId: string, turn: number): CentaurMove | null {
    const v = this.acked.get(`${turn}:${snakeId}`);
    return v === undefined ? null : v;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    return globalThis.setTimeout(fn, ms);
  }

  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as NodeJS.Timeout);
  }

  serverHolds(turn: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const [k, v] of this.latest) {
      if (k.startsWith(`${turn}:`)) out.set(k.slice(String(turn).length + 1), v);
    }
    return out;
  }
}

// ----------------------------------------------------------------- chunking

describe.each(TEAM_SIZES)('team of %i: chunking contract', (n) => {
  const units = roster(n, 100);
  const committedId = `u${String(Math.min(3, n - 1)).padStart(2, '0')}`;
  const unchangedId = `u${String(Math.min(5, n - 1)).padStart(2, '0')}`;
  const plan = planTeamBatches({
    units,
    isCommitted: (id) => id === committedId,
    encode: (u) => u.move as number,
    lastWritten: new Map([[unchangedId, 100 + Number(unchangedId.slice(1))]]),
  });

  test('no batch exceeds ten documents', () => {
    for (const chunk of plan.chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_BATCH_DOCS);
  });

  test('one document per player per batch', () => {
    for (const chunk of plan.chunks) {
      expect(new Set(chunk.map((d) => d.playerID)).size).toBe(chunk.length);
    }
  });

  test('a committed unit is excluded, never written', () => {
    expect(plan.excluded).toContainEqual({ snakeId: committedId, reason: 'committed' });
    for (const chunk of plan.chunks) {
      for (const d of chunk) expect(d.playerID).not.toBe(committedId);
    }
  });

  test('an unchanged unit is omitted', () => {
    expect(plan.unchanged).toEqual([unchangedId]);
    for (const chunk of plan.chunks) {
      for (const d of chunk) expect(d.playerID).not.toBe(unchangedId);
    }
  });

  test('the partition is stable across revisions of the turn', () => {
    const next = planTeamBatches({
      units: units.map((u) => ({ ...u, move: (u.move as number) + 1000 })),
      isCommitted: (id) => id === committedId,
      encode: (u) => u.move as number,
    });
    expect(next.groups).toEqual(plan.groups);
    expect(plan.groups.flat()).toEqual([...plan.groups.flat()].sort());
  });
});

// ------------------------------------------------------------------ torn set

describe.each(TEAM_SIZES)('team of %i: an interrupted revision', (n) => {
  test('leaves a union of WHOLE groups from two ADJACENT revisions', async () => {
    const clock = { t: 1_000_000 };
    const revA = roster(n, 100);
    const revB = roster(n, 500);
    const groups = planTeamBatches({
      units: revA,
      isCommitted: () => false,
      encode: (u) => u.move as number,
    }).groups;

    // Let revision A land whole, then kill the submitter one chunk into B.
    const fake = new Fake({ now: () => clock.t, dieAfterChunks: groups.length + 1 });
    const sub = new TeamBatchSubmitter(fake, {
      throttle: new StageThrottle({ minWriteIntervalMs: 1 }),
      log: () => undefined,
    });
    await sub.submitTeamSet('g', 1, revA);
    clock.t += 10;
    await sub.submitTeamSet('g', 1, revB).catch(() => undefined);
    sub.abandon('g');

    const held = fake.serverHolds(1);
    const a = new Map(revA.map((u) => [u.snakeId, u.move as number]));
    const b = new Map(revB.map((u) => [u.snakeId, u.move as number]));
    const sources = groups.map((group) => {
      const inGroup = new Set(
        group.map((id) => (held.get(id) === b.get(id) ? 'B' : held.get(id) === a.get(id) ? 'A' : '?'))
      );
      // Every unit of a group came from the SAME revision — the group is whole.
      expect(inGroup.size).toBe(1);
      return [...inGroup][0] as string;
    });
    // ...and only two adjacent revisions are represented.
    expect(new Set(sources).size).toBeLessThanOrEqual(2);
    for (const s of sources) expect(['A', 'B']).toContain(s);
    if (n <= MAX_BATCH_DOCS) {
      // No residual window: one atomic batch per revision.
      expect(new Set(sources).size).toBe(1);
    } else {
      // The window is real, and this is what it looks like.
      expect(new Set(sources).size).toBe(2);
    }
  });
});

// ------------------------------------------------------------------ throttle

describe.each(TEAM_SIZES)('team of %i: throttle policy', (n) => {
  test('charges writes, not attempts; the final flush is exempt', async () => {
    const clock = { t: 5_000_000 };
    const fake = new Fake({ now: () => clock.t });
    const sub = new TeamBatchSubmitter(fake, {
      throttle: new StageThrottle({ minWriteIntervalMs: 1000 }),
      log: () => undefined,
    });

    const first = await sub.submitTeamSet('t', 7, roster(n, 200));
    expect(first.docs).toBe(n);

    // A read-back confirmation re-entering the pipeline plans nothing, so it
    // must not consume the allowance: once the interval elapses, the next REAL
    // revision is admitted even though a no-op ran in between.
    clock.t += 1000;
    const noop = await sub.submitTeamSet('t', 7, []);
    expect(noop.docs).toBe(0);
    const real = await sub.submitTeamSet('t', 7, roster(n, 300));
    expect(real.deferred).toBe(false);
    expect(real.docs).toBe(n);

    // Inside the interval a real revision IS held back...
    const held = await sub.submitTeamSet('t', 7, roster(n, 400));
    expect(held.deferred).toBe(true);
    expect(held.docs).toBe(0);

    // ...but the final flush is never held back.
    const flush = await sub.submitTeamSet('t', 7, roster(n, 500), { final: true });
    expect(flush.deferred).toBe(false);
    expect(flush.docs).toBe(n);
    sub.abandon('t');
  });

  test('a backstop republish is exempt from the throttle', async () => {
    // The clock never advances, so the interval can never elapse: anything
    // that reaches the wire after the first write got there by exemption.
    const clock = { t: 9_000_000 };
    const fake = new Fake({ now: () => clock.t, ackWrites: false });
    const sub = new TeamBatchSubmitter(fake, {
      throttle: new StageThrottle({ minWriteIntervalMs: 100_000 }),
      confirmBackstopMs: 20,
      log: () => undefined,
    });
    const first = await sub.submitTeamSet('b', 3, roster(n, 700));
    expect(first.docs).toBe(n);
    const before = fake.writes.length;
    const throttled = await sub.submitTeamSet('b', 3, roster(n, 800));
    expect(throttled.deferred).toBe(true);
    await new Promise((res) => globalThis.setTimeout(res, 120));
    expect(fake.writes.length).toBeGreaterThan(before);
    sub.abandon('b');
  });
});
