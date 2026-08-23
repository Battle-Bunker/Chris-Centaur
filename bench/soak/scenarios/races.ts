/**
 * LANE 3 — TURN-BOUNDARY AND EARLY-RESOLUTION RACES.
 *
 *   A. The turn resolves EARLY (T1 fact 5: the instant every alive player is in
 *      movedPlayerIDs) while the kernel is mid-decision. Clean abandonment?
 *      No writes for the dead turn? No state bleed into the next decision?
 *      Is initialStepCostMs carried?
 *   B. The endTime gap (T1 fact 7): writes landing after endTime are accepted
 *      then silently discarded. How many does the kernel+throttle produce, and
 *      does the measured deadline guard keep it near zero?
 */

import { TurnDeadlineGuard } from '../../../src/wire/deadline';
import type { PinEvent, UnitId } from '../../../src/lobster/contracts';
import { viewFor } from '../scenario';
import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';

interface Row {
  probe: string;
  observed: string;
  verdict: string;
}
const rows: Row[] = [];
const note = (probe: string, observed: string, verdict: string): void => {
  rows.push({ probe, observed, verdict });
};

// ------------------------------------------------------------ A. early resolve

async function earlyResolution(): Promise<void> {
  const budget = argOf('budget', 1200);
  const game = new SoakGame({
    gameId: 'early',
    size: 12,
    ours: 8,
    theirs: 8,
    budgetMs: budget,
    seed: 31337,
    kernelMinWriteIntervalMs: 20,
    minWriteIntervalMs: 30,
    retainEvery: 1e9,
  });
  const g = game as unknown as {
    pinSink: ((e: PinEvent) => void) | null;
    fake: { resolvedAtMs: number; endTimeMs: number; writes: Array<{ turn: number; commitAt: number; docs: unknown[] }> };
    engine: { games: Map<string, { stepCostMs: number | undefined; live: unknown }> };
  };

  // Turn 0 runs normally, so the engine has a measured step cost to carry.
  await game.step(0);
  const carried = g.engine.games.get('early')?.stepCostMs;

  // Turn 1: start it, and — from INSIDE its first emission, the only place a
  // callback can run mid-decision — resolve the turn early and open turn 2.
  const t0 = Date.now();
  const ports = (game.engine as unknown as { ports: { setBotRecommendation: (...a: unknown[]) => void } })
    .ports;
  const original = ports.setBotRecommendation;
  let resolvedAt = -1;
  let secondStarted = false;
  let overlapLive: unknown = null;
  let pinSeenByTurn2 = false;
  let turn2Promise: Promise<unknown> | null = null;

  ports.setBotRecommendation = (...args: unknown[]) => {
    original(...args);
    if (!secondStarted) {
      secondStarted = true;
      // The server resolved turn 1 the instant the last opponent committed.
      resolvedAt = Date.now();
      g.fake.endTimeMs = resolvedAt; // everything from here is wasted
      // ...and the next turn's decision starts while turn 1 is still running.
      turn2Promise = (async () => {
        const before = g.engine.games.get('early')?.stepCostMs;
        const r = await (game.engine as unknown as {
          decideTurn(input: unknown): Promise<{ report: { epochs: number } | null }>;
        }).decideTurn({
          gameId: 'early',
          turn: 2,
          board: game.board,
          ourTeamId: 'red',
          units: game.ourIds.map((id) => ({ snakeId: id, view: viewFor(game.board, id, 2) })),
          deadlineMs: Date.now() + budget,
        });
        pinSeenByTurn2 = (r.report?.epochs ?? 1) > 1;
        return before;
      })();
      // Immediately after turn 2 is in flight, watch whether turn 1's finally
      // clobbers turn 2's live handle.
      setTimeout(() => {
        overlapLive = g.engine.games.get('early')?.live ?? null;
        g.pinSink?.({ kind: 'pin', pin: { unitId: 0 as UnitId, to: 30, tentative: false } });
      }, 0);
    }
  };

  const m1 = await game.step(1);
  const turn1End = Date.now();
  await turn2Promise;
  ports.setBotRecommendation = original;

  const turn1Writes = g.fake.writes.filter((w) => w.turn === 1);
  const afterResolve = turn1Writes.filter((w) => w.commitAt >= resolvedAt);
  note(
    'A1 writes for a turn already resolved server-side',
    `turn-1 writes=${turn1Writes.length}, of which AFTER the early resolution=${afterResolve.length} ` +
      `(${afterResolve.reduce((a, w) => a + w.docs.length, 0)} docs)`,
    afterResolve.length === 0 ? 'clean' : 'WASTED WRITES — nothing tells the decision the turn is over'
  );
  note(
    'A2 decision keeps running past the early resolution',
    `resolved at +${resolvedAt - t0}ms, decision returned at +${turn1End - t0}ms (budget ${budget}ms)`,
    turn1End - resolvedAt > 50 ? 'kept searching for a dead turn' : 'stopped promptly'
  );
  note(
    'A3 initialStepCostMs carried across turns',
    `after turn 0 stepCostMs=${carried?.toFixed(3)}, after turn 1 =${g.engine.games
      .get('early')
      ?.stepCostMs?.toFixed(3)} (turn-1 report finalStepCostMs=${m1.finalStepCostMs.toFixed(3)})`,
    (carried ?? 0) > 0 ? 'carried' : 'NOT carried'
  );
  note(
    'A4 overlapping decisions: game.live after turn 1 finished',
    `live=${overlapLive === null ? 'null' : 'set'}; turn-2 saw the pin as an epoch=${pinSeenByTurn2}`,
    overlapLive === null
      ? 'STATE BLEED — the finished turn nulled the LIVE turn’s handle; its pins are dropped'
      : 'clean'
  );
  game.dispose();
}

// ------------------------------------------------------------- B. endTime gap

async function endTimeGap(): Promise<void> {
  const turns = argOf('turns', 12);
  const endTimeBudget = argOf('budget', 1200);
  for (const [label, useGuard] of [
    ['guard ON (measured deadline)', true],
    ['guard OFF (deadline = endTime)', false],
  ] as ReadonlyArray<readonly [string, boolean]>) {
    const guard = new TurnDeadlineGuard();
    const game = new SoakGame({
      gameId: `gap-${useGuard ? 'on' : 'off'}`,
      size: 12,
      ours: 12,
      theirs: 12,
      budgetMs: endTimeBudget,
      seed: 606,
      kernelMinWriteIntervalMs: 20,
      minWriteIntervalMs: 50,
      commitLatencyMs: argOf('commitMs', 15),
      ackDelayMs: argOf('ackMs', 30),
      retainEvery: 1e9,
    });
    // Drive with the REAL deadline guard: endTime is the server's, the
    // decision deadline is the guard's output (or endTime itself for control).
    const g = game as unknown as { fake: { endTimeMs: number; wastedDocs: number } };
    let wasted = 0;
    let docs = 0;
    for (let t = 0; t < turns; t++) {
      const startTime = Date.now();
      const endTime = startTime + endTimeBudget;
      guard.observeTurn({ startTimeMs: startTime, endTimeMs: endTime, arrivalMs: startTime + 12 });
      const deadline = useGuard
        ? guard.effectiveDeadlineMs(endTime, Date.now())
        : endTime;
      const budgetNow = Math.max(1, deadline - Date.now());
      (game.opts as { budgetMs: number; endTimeOffsetMs: number }).budgetMs = budgetNow;
      (game.opts as { budgetMs: number; endTimeOffsetMs: number }).endTimeOffsetMs =
        endTime - (Date.now() + budgetNow);
      const m = await game.step(t);
      wasted += m.wastedDocs;
      docs += m.docs;
      if (process.env.RACE_DEBUG) {
        console.log(
          `  [${label}] t=${t} budget=${budgetNow} lat=${m.latencyMs} emits=${m.emits} writes=${m.writes} ` +
            `docs=${m.docs} duringDecision=${m.writesDuringDecision}/${m.docsDuringDecision} wasted=${m.wastedDocs} forwarded=${m.forwarded}`
        );
      }
    }
    note(
      `B ${label}`,
      `docs=${docs} wasted(after endTime)=${wasted} (${((100 * wasted) / Math.max(1, docs)).toFixed(1)}%)`,
      wasted === 0 ? 'none wasted' : 'writes landed in the gap'
    );
    game.dispose();
  }
}

export async function main(): Promise<void> {
  await earlyResolution();
  await endTimeGap();
  writeCsv('races', rows);
  for (const r of rows) console.log(`${r.probe.padEnd(56)} ${r.observed}\n${''.padEnd(56)} -> ${r.verdict}`);
}
