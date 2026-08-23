/**
 * LANE 2 — TORN-SET AND CROSSFADE, LIVE SHAPE.
 *
 * Teams of 8 / 12 / 26 driven through revision storms against the fake
 * Firestore, checking every wire guarantee the W3a report claims, plus the
 * crossfade interplay the integrator flagged as open.
 */

import { planTeamBatches, TeamBatchSubmitter, type TeamStagedUnit } from '../../../src/wire/team-submitter';
import { StageThrottle } from '../../../src/wire/stage-throttle';
import { FakeFirestore, makeTeamBoard, rng, sleep } from '../scenario';
import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';

interface Check {
  team: number;
  check: string;
  observed: string;
  pass: boolean;
}

const checks: Check[] = [];
const note = (team: number, check: string, observed: string, pass: boolean): void => {
  checks.push({ team, check, observed, pass });
};

// --------------------------------------------------------- pure chunking

function chunkingChecks(n: number): void {
  const units: TeamStagedUnit[] = [];
  for (let i = 0; i < n; i++) units.push({ snakeId: `u${String(i).padStart(2, '0')}`, move: 100 + i, source: 'bot' });
  const committed = new Set([`u${String(Math.min(3, n - 1)).padStart(2, '0')}`]);
  const lastWritten = new Map<string, number>([[`u${String(Math.min(5, n - 1)).padStart(2, '0')}`, 105]]);

  const plan = planTeamBatches({
    units,
    isCommitted: (id) => committed.has(id),
    encode: (u) => (typeof u.move === 'number' ? u.move : null),
    lastWritten,
  });

  note(n, 'chunk size <= 10', `max=${Math.max(...plan.chunks.map((c) => c.length), 0)}`,
    plan.chunks.every((c) => c.length <= 10));
  note(n, 'one doc per player per batch',
    `dupes=${plan.chunks.filter((c) => new Set(c.map((d) => d.playerID)).size !== c.length).length}`,
    plan.chunks.every((c) => new Set(c.map((d) => d.playerID)).size === c.length));
  note(n, 'committed unit excluded', `${plan.excluded.map((e) => `${e.snakeId}:${e.reason}`).join(' ')}`,
    plan.excluded.some((e) => committed.has(e.snakeId) && e.reason === 'committed') &&
      plan.chunks.every((c) => c.every((d) => !committed.has(d.playerID))));
  note(n, 'unchanged unit omitted', `unchanged=[${plan.unchanged.join(',')}]`,
    plan.unchanged.length === 1 && plan.chunks.every((c) => c.every((d) => !lastWritten.has(d.playerID))));
  note(n, 'groups sorted + fixed width', `groups=${plan.groups.map((g) => g.length).join('/')}`,
    plan.groups.every((g, i) => g.length === (i === plan.groups.length - 1 ? g.length : 10)) &&
      plan.groups.flat().join(',') === [...plan.groups.flat()].sort().join(','));

  // Stable partition across revisions: change every move, keep the roster.
  const plan2 = planTeamBatches({
    units: units.map((u) => ({ ...u, move: (u.move as number) + 1000 })),
    isCommitted: (id) => committed.has(id),
    encode: (u) => (typeof u.move === 'number' ? u.move : null),
  });
  note(n, 'partition stable across revisions',
    `${plan.groups.map((g) => g.join('|')).join(' / ')} vs ${plan2.groups.map((g) => g.join('|')).join(' / ')}`,
    JSON.stringify(plan.groups) === JSON.stringify(plan2.groups));
}

// ------------------------------------------------- torn set, killed live

async function tornSet(n: number): Promise<void> {
  const now = { t: 1_000_000 };
  const clock = (): number => now.t;
  const units = (base: number): TeamStagedUnit[] =>
    Array.from({ length: n }, (_, i) => ({
      snakeId: `u${String(i).padStart(2, '0')}`,
      move: base + i,
      source: 'bot' as const,
    }));

  const board = makeTeamBoard({ size: 12, ours: 2, theirs: 2 });
  const revA = units(100);
  const groups = planTeamBatches({
    units: revA,
    isCommitted: () => false,
    encode: (u) => u.move as number,
  }).groups;
  const chunksPerRevision = groups.length;

  // Kill the submitter mid-sequence: revision A lands whole, revision B is
  // interrupted after its FIRST chunk.
  const fake = new FakeFirestore(() => board, {
    now: clock,
    dieAfterChunks: chunksPerRevision + 1,
  });
  const sub = new TeamBatchSubmitter(fake, {
    throttle: new StageThrottle({ minWriteIntervalMs: 1 }),
    log: () => undefined,
  });
  await sub.submitTeamSet('g', 1, revA);
  now.t += 10;
  const revB = units(500);
  await sub.submitTeamSet('g', 1, revB).catch(() => undefined);

  const server = fake.resolvedSet('g', 1);
  const fromA = new Map(revA.map((u) => [u.snakeId, u.move as number]));
  const fromB = new Map(revB.map((u) => [u.snakeId, u.move as number]));
  const groupSource = groups.map((g) => {
    const srcs = new Set(g.map((id) => {
      const held = server.get(id);
      if (held === fromB.get(id)) return 'B';
      if (held === fromA.get(id)) return 'A';
      return '?';
    }));
    return srcs.size === 1 ? [...srcs][0] : `MIXED(${[...srcs].join('')})`;
  });
  note(n, 'interrupted revision = union of WHOLE groups',
    `groups=${groupSource.join(',')} (chunks/rev=${chunksPerRevision})`,
    groupSource.every((s) => s === 'A' || s === 'B'));
  note(n, n <= 10 ? 'team <=10: revision is ATOMIC (single source)' : 'team >10: torn window is REAL (two sources)',
    `sources=${[...new Set(groupSource)].join('')}`,
    n <= 10 ? new Set(groupSource).size === 1 : new Set(groupSource).size === 2);
  note(n, 'interrupted revision = ADJACENT revisions only',
    `distinct sources=${[...new Set(groupSource)].join('')}`,
    new Set(groupSource).size <= 2);
  sub.abandon('g');
}

// ---------------------------------------------------------------- throttle

async function throttleChecks(n: number): Promise<void> {
  const now = { t: 5_000_000 };
  const board = makeTeamBoard({ size: 12, ours: 2, theirs: 2 });
  const fake = new FakeFirestore(() => board, { now: () => now.t });
  const throttle = new StageThrottle({ minWriteIntervalMs: 1000 });
  const sub = new TeamBatchSubmitter(fake, { throttle, log: () => undefined });
  const units = (base: number): TeamStagedUnit[] =>
    Array.from({ length: n }, (_, i) => ({
      snakeId: `u${String(i).padStart(2, '0')}`,
      move: base + i,
      source: 'bot' as const,
    }));

  const r1 = await sub.submitTeamSet('t', 7, units(200));
  const before = fake.writes.length;
  // A read-back confirmation re-entering the pipeline: plans nothing.
  const r2 = await sub.submitTeamSet('t', 7, []);
  const r3 = await sub.submitTeamSet('t', 7, units(300)); // real revision, throttled
  note(n, 'throttle charges WRITES not attempts',
    `r1.docs=${r1.docs} r2(no-op).deferred=${r2.deferred} r2.docs=${r2.docs} r3.deferred=${r3.deferred}`,
    r1.docs > 0 && r2.docs === 0 && r3.deferred);
  note(n, 'throttled revision writes nothing', `writes since r1=${fake.writes.length - before}`,
    fake.writes.length - before === 0);

  const r4 = await sub.submitTeamSet('t', 7, units(400), { final: true });
  note(n, 'final flush EXEMPT from throttle', `final.docs=${r4.docs} deferred=${r4.deferred}`,
    !r4.deferred && r4.docs > 0);

  sub.abandon('t');

  // Backstop republish: a write whose read-back never arrives. The clock is
  // FROZEN, so the throttle interval can never elapse — anything that goes out
  // went out because the backstop is exempt.
  const lost = new FakeFirestore(() => board, { now: () => now.t, ackWrites: false });
  const sub2 = new TeamBatchSubmitter(lost, {
    throttle: new StageThrottle({ minWriteIntervalMs: 1000 }),
    confirmBackstopMs: 120,
    log: () => undefined,
  });
  const first = await sub2.submitTeamSet('b', 3, units(700));
  const beforeBackstop = lost.writes.length;
  const blocked = await sub2.submitTeamSet('b', 3, units(800));
  await sleep(400);
  note(n, 'backstop republish EXEMPT from throttle',
    `first.docs=${first.docs} throttled.deferred=${blocked.deferred} writes after backstop=${
      lost.writes.length - beforeBackstop
    }`,
    first.docs > 0 && blocked.deferred && lost.writes.length - beforeBackstop > 0);
  sub2.abandon('b');
}

// ------------------------------------------------------------- crossfade

interface XfRow {
  units: number;
  turns: number;
  emits: number;
  blocked: number;
  certified: number;
  uncertified: number;
  independent: number;
  refusedCrossfade: number;
  epochs: number;
  conformanceSamples: number;
  stagedNothing: number;
  maxChunk: number;
  docs: number;
  writes: number;
}

async function crossfadeStorm(n: number, turns: number): Promise<XfRow> {
  const game = new SoakGame({
    gameId: `xf${n}`,
    size: n >= 26 ? 14 : 12,
    ours: n,
    theirs: Math.min(n, 26),
    budgetMs: n >= 26 ? argOf('budget26', 5000) : argOf('budget', 2000),
    seed: 4242 + n,
    // A revision STORM: the kernel offers a write every 20 ms and the wire
    // admits one every 60 ms. Deliberately far below production policy —
    // the point is to exercise the mechanism, not to model the deployment.
    kernelMinWriteIntervalMs: 20,
    minWriteIntervalMs: 60,
    pinRate: 1,
    retainEvery: 1000,
  });
  for (let t = 0; t < turns; t++) await game.step(t);
  game.dispose();
  const sum = (f: (m: (typeof game.metrics)[number]) => number): number =>
    game.metrics.reduce((a, m) => a + f(m), 0);
  return {
    units: n,
    turns,
    emits: sum((m) => m.emits),
    blocked: sum((m) => m.xfBlocked),
    certified: sum((m) => m.xfCertified),
    uncertified: sum((m) => m.xfUncertified),
    independent: sum((m) => m.xfIndependent),
    refusedCrossfade: sum((m) => m.refCrossfade),
    epochs: sum((m) => m.epochs),
    conformanceSamples: game.metrics.filter((m) => m.conformanceSlicesBefore >= 0).length,
    stagedNothing: sum((m) => m.stagedNothing),
    maxChunk: Math.max(...game.metrics.map((m) => m.chunksMax)),
    docs: sum((m) => m.docs),
    writes: sum((m) => m.writes),
  };
}

export async function main(): Promise<void> {
  rng(1);
  for (const n of [8, 12, 26]) {
    chunkingChecks(n);
    await tornSet(n);
    await throttleChecks(n);
  }
  const xf: XfRow[] = [];
  const turns = argOf('turns', 6);
  for (const n of [8, 12, 26]) xf.push(await crossfadeStorm(n, turns));

  writeCsv('wire-checks', checks);
  writeCsv('wire-crossfade', xf);

  const width = Math.max(...checks.map((c) => c.check.length));
  console.log('TEAM  RESULT  CHECK'.padEnd(20) + 'OBSERVED');
  for (const c of checks) {
    console.log(
      `${String(c.team).padStart(4)}  ${c.pass ? 'PASS' : 'FAIL'}    ${c.check.padEnd(width)}  ${c.observed}`
    );
  }
  console.log(`\nfailures: ${checks.filter((c) => !c.pass).length}/${checks.length}`);
  console.log('\nCROSSFADE (crossfade:"teammate", live teammateFloor)');
  console.log(
    'units turns emits blocked certified uncertified independent refusedXf epochs confSamples stagedNothing maxChunk docs writes'
  );
  for (const x of xf) {
    console.log(
      `${String(x.units).padStart(5)} ${String(x.turns).padStart(5)} ${String(x.emits).padStart(5)} ` +
        `${String(x.blocked).padStart(7)} ${String(x.certified).padStart(9)} ${String(x.uncertified).padStart(11)} ` +
        `${String(x.independent).padStart(11)} ${String(x.refusedCrossfade).padStart(9)} ${String(x.epochs).padStart(6)} ` +
        `${String(x.conformanceSamples).padStart(11)} ${String(x.stagedNothing).padStart(13)} ` +
        `${String(x.maxChunk).padStart(8)} ${String(x.docs).padStart(4)} ${String(x.writes).padStart(6)}`
    );
  }
}
