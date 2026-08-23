/**
 * TURN-BOUNDARY REALITY CHECK.
 *
 * Every mid-decision behaviour the build relies on — an operator pin arriving
 * while the kernel searches, the per-turn final-flush timer, the read-back
 * listener, an EARLY turn resolution, the next game's turn — reaches this
 * process as a MACROTASK: a Firestore listener callback or a timer.
 *
 * `LobsterKernel.decide` is an `async *` generator containing no `await`. The
 * consumer's `for await` resolves each yield on the MICROtask queue, so from
 * the first slice to the final flush the event loop never reaches its timer or
 * I/O phase. This scenario measures that directly:
 *
 *   1. timers/IO armed before the decision — when do they actually fire?
 *   2. a pin delivered the way the wire delivers one (a listener callback) —
 *      does the kernel ever see it as a mid-decision epoch?
 *   3. the same pin delivered SYNCHRONOUSLY from inside an emission (the way
 *      the repo's own smoke test delivers it) — the control.
 *   4. three concurrent games — do their decisions interleave or serialize?
 */

import type { PinEvent, UnitId } from '../../../src/lobster/contracts';
import type { KernelReport } from '../../../src/lobster/kernel';
import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';

interface Row {
  probe: string;
  observed: string;
  note: string;
}

const rows: Row[] = [];

export async function main(): Promise<void> {
  const budget = argOf('budget', 1200);

  // ---- 1 + 2: timers and a listener-shaped pin during one decision --------
  {
    const game = new SoakGame({
      gameId: 'el1',
      size: 12,
      ours: 8,
      theirs: 8,
      budgetMs: budget,
      seed: 99,
      retainEvery: 1e9,
    });
    const marks: Record<string, number> = {};
    const t0 = Date.now();
    setTimeout(() => {
      marks.timeout0 = Date.now() - t0;
    }, 0);
    setTimeout(() => {
      marks.timeout50 = Date.now() - t0;
    }, 50);
    setImmediate(() => {
      marks.immediate = Date.now() - t0;
    });
    void Promise.resolve().then(() => {
      marks.microtask = Date.now() - t0;
    });
    // The pin, delivered as a listener callback would deliver it.
    setTimeout(() => {
      marks.pinFired = Date.now() - t0;
      (game as unknown as { pinSink: ((e: PinEvent) => void) | null }).pinSink?.({
        kind: 'pin',
        pin: { unitId: 0 as UnitId, to: 30, tentative: false },
      });
    }, Math.floor(budget / 3));

    const m = await game.step(0);
    const done = Date.now() - t0;
    // One macrotask turn AFTER the decision: everything queued now fires.
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setTimeout(res, 5));
    rows.push({
      probe: 'setTimeout(0) fired at',
      observed: `${marks.timeout0 ?? 'never'}ms`,
      note: `decision ran ${m.latencyMs}ms and returned at ${done}ms — the timer was armed at 0ms`,
    });
    rows.push({
      probe: 'setTimeout(50) fired at',
      observed: `${marks.timeout50 ?? 'never'}ms`,
      note: 'armed 50ms before a multi-hundred-ms decision',
    });
    rows.push({ probe: 'setImmediate fired at', observed: `${marks.immediate ?? 'never'}ms`, note: '' });
    rows.push({ probe: 'microtask fired at', observed: `${marks.microtask ?? 'never'}ms`, note: 'microtasks DO run' });
    rows.push({
      probe: `pin (listener-shaped, armed t+${Math.floor(budget / 3)}ms) delivered at`,
      observed: `${marks.pinFired ?? 'never'}ms`,
      note: `kernel epochs=${m.epochs} (1 = the pin was NEVER seen mid-decision), conformance samples=${
        m.conformanceSlicesBefore >= 0 ? 1 : 0
      }`,
    });
    game.dispose();
  }

  // ---- 3: the control — a pin fired synchronously from inside an emission --
  {
    const game = new SoakGame({
      gameId: 'el2',
      size: 12,
      ours: 8,
      theirs: 8,
      budgetMs: budget,
      seed: 99,
      retainEvery: 1e9,
    });
    const g = game as unknown as {
      pinSink: ((e: PinEvent) => void) | null;
      desired: Map<string, { move: number }>;
    };
    let fired = false;
    const engine = game.engine as unknown as { ports: { setBotRecommendation: unknown } };
    const original = (engine.ports as { setBotRecommendation: (...a: unknown[]) => void })
      .setBotRecommendation;
    (engine.ports as { setBotRecommendation: (...a: unknown[]) => void }).setBotRecommendation = (
      ...args: unknown[]
    ) => {
      original(...args);
      if (!fired) {
        fired = true;
        const move = args[2];
        if (typeof move === 'number') {
          g.pinSink?.({ kind: 'pin', pin: { unitId: 0 as UnitId, to: move, tentative: false } });
        }
      }
    };
    const m = await game.step(0);
    rows.push({
      probe: 'pin fired SYNCHRONOUSLY from an emission',
      observed: `epochs=${m.epochs}`,
      note: `conformance slicesBefore=${m.conformanceSlicesBefore}, latency=${m.conformanceLatencyMs.toFixed(2)}ms`,
    });
    game.dispose();
  }

  // ---- 4: three concurrent games ------------------------------------------
  {
    const games = [0, 1, 2].map(
      (i) =>
        new SoakGame({
          gameId: `par${i}`,
          size: 12,
          ours: 8,
          theirs: 8,
          budgetMs: budget,
          seed: 500 + i,
          retainEvery: 1e9,
        })
    );
    const t0 = Date.now();
    const spans: Array<{ id: string; start: number; end: number }> = [];
    const overshoots: number[] = [];
    await Promise.all(
      games.map(async (g) => {
        const start = Date.now() - t0;
        const m = await g.step(0);
        spans.push({ id: g.opts.gameId, start, end: Date.now() - t0 });
        overshoots.push(Math.round(Date.now() - t0 - start - budget));
        return m;
      })
    );
    const wall = Date.now() - t0;
    const sumBudgets = games.length * budget;
    for (const g of games) g.dispose();
    rows.push({
      probe: '3 concurrent decisions (budget each ' + budget + 'ms)',
      observed: `wall=${wall}ms; spans=${spans
        .sort((a, b) => a.start - b.start)
        .map((s) => `${s.id}:${s.start}-${s.end}`)
        .join(' ')}`,
      note:
        `per-game deadline overshoot=${overshoots.join('/')}ms; ` +
        (wall >= sumBudgets * 0.8
          ? 'SERIALIZED: each decision holds the loop for its whole budget'
          : 'interleaved at EMISSION granularity (the kernel yields nothing finer)'),
    });
  }

  writeCsv('eventloop', rows);
  for (const r of rows) console.log(`${r.probe.padEnd(52)} ${r.observed.padEnd(48)} ${r.note}`);
}
