/**
 * LANE 4 — LEGACY SOAK CONTROL (CENTAUR_ENGINE=legacy).
 *
 * The same 200-turn shape driven through the per-snake DecisionEngine fan-out
 * the legacy full pass runs, for a memory and latency baseline the lobster
 * curves can be read against — plus the one property the lobster kernel does
 * not have: the legacy decision YIELDS TO THE EVENT LOOP between chunks
 * (`DecisionWorkerPool.submit` wraps every inline chunk in `setImmediate`,
 * "so staging writes, Firestore listeners and the web UI stay responsive"),
 * which is measured here directly.
 */

import type { Coord, Direction, GameState, Snake } from '../../../src/types/battlesnake';
import { DecisionEngine } from '../../../src/logic/decision-engine';
import { DEFAULT_CONFIG } from '../../../src/config/game-config';
import { HEURISTIC_KEYS } from '../../../src/config/heuristics';
import { rng } from '../scenario';
import { argOf, writeCsv } from '../main';
import { fit, quantile } from '../stats';

interface Row {
  turn: number;
  latencyMs: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  arrayBuffers: number;
  retainedHeap: number;
  decisions: number;
  updates: number;
}

const MB = (b: number): string => `${(b / 1048576).toFixed(1)}MB`;

function snake(id: string, cells: Coord[], team: string): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 90,
    body: cells,
    head: cells[0],
    length: cells.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    teamID: team,
  } as unknown as Snake;
}

function makeSnakeBoard(size: number, ours: number, theirs: number): { width: number; height: number; food: Coord[]; hazards: Coord[]; snakes: Snake[] } {
  const snakes: Snake[] = [];
  const put = (n: number, prefix: string, team: string, y0: number): void => {
    for (let i = 0; i < n; i++) {
      const x = (i * 2) % (size - 1);
      const y = y0 + Math.floor((i * 2) / (size - 1)) * 3;
      snakes.push(
        snake(
          `${prefix}${i}`,
          [
            { x, y },
            { x, y: y + 1 },
            { x, y: y + 2 },
          ],
          team
        )
      );
    }
  };
  put(ours, 'r', 'red', 0);
  put(theirs, 'b', 'blue', Math.floor(size / 2) + 1);
  return { width: size, height: size, food: [], hazards: [], snakes };
}

const STEP: Record<Direction, readonly [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

export async function main(): Promise<void> {
  process.env.CENTAUR_ENGINE = 'legacy';
  // The legacy path is chatty (per-decision telemetry); keep the bench output
  // to the numbers. Restored before the summary is printed.
  const realLog = console.log;
  console.log = (): void => undefined;
  const turns = argOf('turns', 200);
  const size = argOf('size', 12);
  const ours = argOf('ours', 8);
  const budget = argOf('budget', 300);
  const weights = {} as Record<string, number>;
  for (const k of HEURISTIC_KEYS) weights[k] = (DEFAULT_CONFIG as unknown as Record<string, number>)[k];
  const engine = new DecisionEngine({
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
    nearbyDistance: DEFAULT_CONFIG.nearbyDistance,
    weights: weights as never,
  });

  let board = makeSnakeBoard(size, ours, argOf('theirs', 8));
  const ourIds = board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);
  const teamIds = new Set(ourIds);
  const r = rng(20260823);
  const rows: Row[] = [];
  let yieldProbe = 'not run';

  for (let t = 0; t < turns; t++) {
    const t0 = Date.now();
    let updates = 0;
    const chosen = new Map<string, Direction>();

    // The yield probe, once, mid-run: arm a macrotask before the fan-out and
    // see whether it can fire while the decision is in flight.
    let probeFiredAt = -1;
    if (t === Math.floor(turns / 2)) setTimeout(() => (probeFiredAt = Date.now() - t0), 0);

    await Promise.all(
      ourIds.map(async (id) => {
        const you = board.snakes.find((s) => s.id === id);
        if (you === undefined) return;
        const view = {
          game: { id: 'legacy', ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 10_000, source: 't' },
          turn: t,
          board,
          you,
        } as unknown as GameState;
        const decision = await engine.decideIteratively(view, teamIds, {
          deadlineMs: t0 + budget,
          updateIntervalMs: 100,
          onUpdate: () => {
            updates++;
          },
        });
        chosen.set(id, decision.move);
      })
    );
    const latencyMs = Date.now() - t0;
    if (t === Math.floor(turns / 2)) {
      yieldProbe =
        probeFiredAt >= 0 && probeFiredAt < latencyMs
          ? `setTimeout(0) fired at ${probeFiredAt}ms DURING a ${latencyMs}ms fan-out — the legacy loop yields`
          : `setTimeout(0) did NOT fire during the ${latencyMs}ms fan-out`;
    }

    let retained = -1;
    if (typeof globalThis.gc === 'function' && t % 5 === 0) {
      globalThis.gc();
      globalThis.gc();
      retained = process.memoryUsage().heapUsed;
    }
    const mem = process.memoryUsage();
    rows.push({
      turn: t,
      latencyMs,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      arrayBuffers: mem.arrayBuffers,
      retainedHeap: retained,
      decisions: ourIds.length,
      updates,
    });

    // Advance: apply each chosen direction, hold on a conflict.
    const taken = new Set<string>();
    const key = (c: Coord): string => `${c.x},${c.y}`;
    const next: Snake[] = [];
    for (const s of board.snakes) {
      const dir = chosen.get(s.id) ?? (['up', 'down', 'left', 'right'] as Direction[])[Math.floor(r() * 4)];
      const [dx, dy] = STEP[dir as Direction];
      const head = s.body[0] as Coord;
      const want = { x: head.x + dx, y: head.y + dy };
      const legal =
        want.x >= 0 && want.y >= 0 && want.x < board.width && want.y < board.height && !taken.has(key(want));
      const cells = legal ? [want, ...s.body.slice(0, s.body.length - 1)] : s.body;
      for (const c of cells) taken.add(key(c));
      next.push({ ...s, body: cells, head: cells[0], health: 60 + ((s.health + t) % 40) } as Snake);
    }
    board = { ...board, snakes: next };
  }

  console.log = realLog;
  const file = writeCsv('legacy', rows);
  const warm = rows.slice(20);
  const heap = warm.map((x) => x.heapUsed);
  const ret = warm.map((x) => x.retainedHeap).filter((v) => v >= 0);
  const lat = warm.map((x) => x.latencyMs);
  const rf = fit(ret);
  console.log(
    `LEGACY CONTROL (CENTAUR_ENGINE=legacy), ${turns} turns x ${ours} snakes\n` +
      `heapUsed  p50=${MB(quantile(heap, 0.5))} max=${MB(Math.max(...heap))}\n` +
      `retained  first=${MB(ret[0] ?? 0)} last=${MB(ret[ret.length - 1] ?? 0)} slope=${(
        rf.slopePer100 /
        5 /
        1048576
      ).toFixed(3)}MB/100turns signal=${rf.signal.toFixed(2)}σ\n` +
      `rss       p50=${MB(quantile(warm.map((x) => x.rss), 0.5))} max=${MB(
        Math.max(...warm.map((x) => x.rss))
      )}\n` +
      `latency   p50=${quantile(lat, 0.5).toFixed(1)}ms p95=${quantile(lat, 0.95).toFixed(1)}ms ` +
      `max=${Math.max(...lat)}ms slope=${fit(lat).slopePer100.toFixed(2)}ms/100turns signal=${fit(
        lat
      ).signal.toFixed(2)}σ\n` +
      `updates   total=${rows.reduce((a, x) => a + x.updates, 0)}\n` +
      `yield     ${yieldProbe}\n` +
      `csv: ${file}`
  );
}
