/**
 * PIN-CONTEXT CACHE EVICTION + ARENA BYTE COST.
 *
 * The tier-3 store is an LRU of `pinCacheCapacity` (default 8) contexts keyed
 * by canonical pin set, dropped at turn end. Nothing in the natural soak ever
 * fills it — one committed pin set is one context — so this drives an
 * OSCILLATING operator: a different pin on every emission, more distinct pin
 * sets than the cache can hold, all inside one turn.
 *
 * The second half measures what an arena slab actually costs, so the slab
 * watermarks the profile lane reports can be read in megabytes.
 */

import type { PinEvent, UnitId } from '../../../src/lobster/contracts';
import { makeSubstrate, clearGeometryCache } from '../../../src/lobster/substrate';
import { SoakGame } from '../driver';
import { makeTeamBoard } from '../scenario';
import { argOf, writeCsv } from '../main';

interface Row {
  turn: number;
  distinctPinSets: number;
  contexts: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheInvalidations: number;
  epochs: number;
  emits: number;
  restages: number;
  conformanceLatencyMs: number;
}

function arenaBytes(size: number, ours: number, theirs: number): string {
  clearGeometryCache();
  const board = makeTeamBoard({ size, ours, theirs, seed: 1 });
  const sub = makeSubstrate({ board, turn: 0, asTeam: 'red' });
  const e = sub.engine as unknown as {
    unitStride: number;
    boardStride: number;
    capacity: number;
  };
  const perSlab = e.unitStride * 2 + e.boardStride * 4;
  sub.release();
  clearGeometryCache();
  return (
    `${size}x${size}, ${ours}v${theirs}: unitStride=${e.unitStride} i16 + boardStride=${e.boardStride} u32 ` +
    `= ${perSlab} B/slab; 4096 slabs=${((perSlab * 4096) / 1048576).toFixed(1)}MB, ` +
    `16384 slabs=${((perSlab * 16384) / 1048576).toFixed(1)}MB`
  );
}

export async function main(): Promise<void> {
  console.log('ARENA SLAB COST');
  console.log('  ' + arenaBytes(12, 8, 8));
  console.log('  ' + arenaBytes(12, 12, 12));
  console.log('  ' + arenaBytes(14, 26, 26));
  console.log('');

  const turns = argOf('turns', 4);
  const units = argOf('ours', 12);
  const game = new SoakGame({
    gameId: 'pincache',
    size: 12,
    ours: units,
    theirs: units,
    budgetMs: argOf('budget', 3000),
    seed: 4711,
    kernelMinWriteIntervalMs: 20,
    minWriteIntervalMs: 40,
    retainEvery: 1e9,
  });

  // An OSCILLATING operator: every emission draws a new pin, so the decision
  // walks through more distinct pin sets than the LRU can hold.
  const distinct = new Set<string>();
  let seq = 0;
  const oscillate = (g: SoakGame): void => {
    for (let i = 0; i < argOf('pins', 14); i++) {
      const unit = (seq % units) as UnitId;
      const to = 20 + ((seq * 7) % 90);
      seq++;
      distinct.add(`${unit}:${to}`);
      const ev: PinEvent = { kind: 'pin', pin: { unitId: unit, to, tentative: false } };
      g.firePin(ev);
      // Alternate binding and TENTATIVE pins: tentative ones create the
      // SPECULATIVE contexts the cache is shared with.
      g.firePin({ kind: 'pin', pin: { unitId: ((unit + 1) % units) as UnitId, to: to + 1, tentative: true } });
    }
  };
  game.onFirstEmission = (g) => oscillate(g);

  const rows: Row[] = [];
  for (let t = 0; t < turns; t++) {
    distinct.clear();
    const m = await game.step(t);
    const rep = game.reports[game.reports.length - 1];
    rows.push({
      turn: t,
      distinctPinSets: distinct.size,
      contexts: rep?.contexts.length ?? 0,
      cacheHits: rep?.cache.hits ?? 0,
      cacheMisses: rep?.cache.misses ?? 0,
      cacheEvictions: rep?.cache.evictions ?? 0,
      cacheInvalidations: rep?.cache.invalidations ?? 0,
      epochs: m.epochs,
      emits: m.emits,
      restages: rep?.conformance.length ?? 0,
      conformanceLatencyMs: Number(
        (rep?.conformance.reduce((a, c) => a + c.latencyMs, 0) ?? 0).toFixed(2)
      ),
    });
  }
  game.dispose();
  writeCsv('pincache', rows);
  console.log('PIN-CONTEXT CACHE (capacity 8, per turn)');
  console.log('turn distinctPins contexts hits misses evictions invalidations epochs emits restages confLatencyMs');
  for (const r of rows) {
    console.log(
      `${String(r.turn).padStart(4)} ${String(r.distinctPinSets).padStart(12)} ${String(
        r.contexts
      ).padStart(8)} ${String(r.cacheHits).padStart(5)} ${String(r.cacheMisses).padStart(6)} ${String(
        r.cacheEvictions
      ).padStart(9)} ${String(r.cacheInvalidations).padStart(13)} ${String(r.epochs).padStart(
        6
      )} ${String(r.emits).padStart(5)} ${String(r.restages).padStart(8)} ${String(
        r.conformanceLatencyMs
      ).padStart(13)}`
    );
  }
}
