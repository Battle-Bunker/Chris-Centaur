/**
 * DIRECTED REPRO for the retained-heap growth the 200-turn soak exposed.
 *
 * Hypothesis: `CloudSource.timelines` is a STRONG `Map<FrozenRecord,
 * CloudTimeline>` (src/partial-engine/cloud.ts) living on a `PartialEngine`
 * that the module-scope geometry cache in src/lobster/substrate.ts keeps alive
 * for the whole game. `FrozenRecord`s are rebuilt every turn, so every turn
 * inserts entries that nothing ever removes.
 *
 * This scenario isolates it from the wire, the kernel and the harness's own
 * bookkeeping: build a substrate, ask for ONE claim-view read per turn, release
 * it, and watch both the retained heap and the map's own size.
 */

import { makeSubstrate, clearGeometryCache } from '../../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../../src/lobster/candidates';
import type { UnitId } from '../../../src/lobster/contracts';
import { advanceBoard, makeTeamBoard, rng } from '../scenario';
import { argOf, flagOf, writeCsv } from '../main';
import { fit } from '../stats';

interface Row {
  turn: number;
  retainedHeap: number;
  arrayBuffers: number;
  sources: number;
  timelines: number;
  arena: number;
  ms: number;
}

const gcHeap = (): number => {
  const g = globalThis.gc as (() => void) | undefined;
  if (g !== undefined) {
    g();
    g();
  }
  return process.memoryUsage().heapUsed;
};

export async function main(): Promise<void> {
  const turns = argOf('turns', 200);
  const churn = flagOf('churnFood');
  clearGeometryCache();
  const r = rng(11);
  let board = makeTeamBoard({ size: argOf('size', 12), ours: argOf('ours', 8), theirs: argOf('theirs', 8), seed: 3 });
  const rows: Row[] = [];

  for (let t = 0; t < turns; t++) {
    if (churn) {
      const taken = new Set(board.snakes.map((s) => `${s.body[0]?.x},${s.body[0]?.y}`));
      const f = { x: t % board.width, y: (t * 7) % board.height };
      board = { ...board, food: taken.has(`${f.x},${f.y}`) ? [] : [f] } as typeof board;
    }
    const t0 = Date.now();
    if (flagOf('noEngine')) {
      rows.push({ turn: t, retainedHeap: t % 5 === 0 ? gcHeap() : -1, arrayBuffers: process.memoryUsage().arrayBuffers, sources: 0, timelines: 0, arena: 0, ms: 0 });
      board = advanceBoard(board, new Map(), t, r);
      continue;
    }
    if (flagOf('clearEach')) clearGeometryCache();
    const sub = makeSubstrate({ board, turn: t, asTeam: 'red' });
    let sources = 0;
    let timelines = 0;
    let arena = 0;
    try {
      // One claim-view read: this is what builds the turn's FrozenRecords and
      // asks the CloudSource for their timelines.
      const gen = new GrammarCandidateGenerator();
      const ours = sub.roster().find((u) => u.wireId.startsWith('r'))?.unitId as UnitId;
      gen.candidatesFor(sub, ours);
      const eng = sub.engine as unknown as { sources: Map<string, { timelines: Map<unknown, unknown> }>; capacity: number };
      arena = eng.capacity;
      sources = eng.sources.size;
      for (const s of eng.sources.values()) timelines += s.timelines.size;
    } finally {
      sub.release();
    }
    const ms = Date.now() - t0;
    rows.push({
      turn: t,
      retainedHeap: t % 5 === 0 ? gcHeap() : -1,
      arrayBuffers: process.memoryUsage().arrayBuffers,
      sources,
      timelines,
      arena,
      ms,
    });
    board = advanceBoard(board, new Map(), t, r);
  }

  const file = writeCsv(churn ? 'leak-churn' : 'leak', rows);
  const ret = rows.filter((x) => x.retainedHeap >= 0);
  const f = fit(ret.map((x) => x.retainedHeap));
  const perTurn = (f.slopePer100 / 100 / 5) / 1024;
  console.log(
    `turns=${turns} churnFood=${churn}\n` +
      `timelines  first=${rows[0]?.timelines} last=${rows[rows.length - 1]?.timelines} ` +
      `delta/turn=${(((rows[rows.length - 1]?.timelines ?? 0) - (rows[0]?.timelines ?? 0)) / (turns - 1)).toFixed(2)}\n` +
      `sources    first=${rows[0]?.sources} last=${rows[rows.length - 1]?.sources}\n` +
      `retained   first=${((ret[0]?.retainedHeap ?? 0) / 1048576).toFixed(2)}MB last=${(
        (ret[ret.length - 1]?.retainedHeap ?? 0) / 1048576
      ).toFixed(2)}MB slope=${perTurn.toFixed(1)}KB/turn signal=${f.signal.toFixed(1)}σ\n` +
      `arena      first=${rows[0]?.arena} last=${rows[rows.length - 1]?.arena}\n` +
      `per-turn   ms first10=${(rows.slice(0, 10).reduce((a, x) => a + x.ms, 0) / 10).toFixed(2)} ` +
      `last10=${(rows.slice(-10).reduce((a, x) => a + x.ms, 0) / 10).toFixed(2)}\n` +
      `csv: ${file}`
  );
}
