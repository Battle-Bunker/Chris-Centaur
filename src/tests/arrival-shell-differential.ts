/**
 * THE ARRIVAL DRIFT DIFFERENTIAL — the price of admission for reading the
 * vendored engine's dilation shells directly.
 *
 * `src/lobster/evaluate/shells.ts` reproduces `CloudTimeline.arrival()`'s
 * stamping loop so the evaluator can skip the eager `minCost` Dijkstra that
 * nothing reads. That is a SECOND ENCODING of `earliest`, which is exactly what
 * the one-pipeline rule forbids everywhere else, and its failure mode is silent:
 * if upstream changes how a shell is derived — sub-step seeding, a saturation
 * short-circuit that skips a shell, a different NEVER sentinel — the copy drifts,
 * and it drifts only in a soft positional signal that no assertion anywhere else
 * would notice going wrong.
 *
 * So this file is not optional and it is not a unit test of shells.ts. It is a
 * DRIFT GATE, and it is wired into `partial-engine-vendor-sync.test.ts` so that
 * it runs whenever the vendored copies are checked — same run, same failure, one
 * decision to make. `arrival-shell-drift.test.ts` runs it in the ordinary suite
 * as well, so a lobster-side change that breaks it fails immediately rather than
 * waiting for somebody to think about the engine.
 *
 * If this goes red: DO NOT patch shells.ts to match by inspection. Read the
 * upstream diff to `cloud.ts`, decide whether `earliest` still means what the
 * reach feature assumes, and only then change the copy.
 *
 * (A helper, deliberately not a `.test.ts`: jest's testMatch would run it twice.)
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { makeSubstrate, clearGeometryCache } from '../lobster/substrate';
import { earliestShells, recordOfView } from '../lobster/evaluate';
import { UNIT_KIND_NAMES } from '../partial-engine/index';
import type { FrozenRecord } from '../partial-engine/index';

const TURN = 40;
/** Every kind the grammar registers — no list of our own to fall behind. */
const KINDS = UNIT_KIND_NAMES;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeSnake(id: string, body: Coord[], extra: Partial<Snake>): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

/**
 * A random board carrying every kind, some units stale (so a held record's own
 * `heldAtTurn` seed is exercised) and some hazards and food (so the terrain the
 * dilation walks is not trivial).
 */
export function randomBoard(size: number, seed: number): { board: Board; stale: Map<string, number> } {
  const rnd = lcg(seed);
  const taken = new Set<number>();
  const free = (): Coord => {
    for (;;) {
      const x = Math.floor(rnd() * size);
      const y = Math.floor(rnd() * size);
      const k = y * size + x;
      if (!taken.has(k)) {
        taken.add(k);
        return { x, y };
      }
    }
  };
  const snakes: Snake[] = [];
  const stale = new Map<string, number>();
  // One of every kind on each team, so no kind can quietly stop being covered.
  for (let team = 0; team < 2; team++) {
    for (let k = 0; k < KINDS.length; k++) {
      const kind = KINDS[k] as string;
      const id = `${team === 0 ? 'a' : 'b'}${k}`;
      const teamID = team === 0 ? 'red' : 'blue';
      const at = free();
      if (kind === 'snake') {
        const body: Coord[] = [at];
        let cx = at.x;
        let cy = at.y;
        for (let s = 0; s < 2; s++) {
          const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (let d = 0; d < 4; d++) {
            const dd = dirs[(Math.floor(rnd() * 4) + d) % 4] as number[];
            const nx = cx + (dd[0] as number);
            const ny = cy + (dd[1] as number);
            const key = ny * size + nx;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size || taken.has(key)) continue;
            taken.add(key);
            body.push({ x: nx, y: ny });
            cx = nx;
            cy = ny;
            break;
          }
        }
        snakes.push(
          makeSnake(id, body, {
            unitType: 'snake',
            teamID,
            health: 20 + Math.floor(rnd() * 80),
          } as Partial<Snake>)
        );
      } else {
        snakes.push(
          makeSnake(id, [at], {
            unitType: kind,
            teamID,
            length: 1 + Math.floor(rnd() * 4),
            isKing: kind === 'king',
            health: 20 + Math.floor(rnd() * 80),
            orientation: rnd() < 0.5 ? { dx: 0, dy: -1 } : { dx: 1, dy: 0 },
          } as Partial<Snake>)
        );
      }
      // Roughly a third of the roster was last observed some turns ago.
      if (rnd() < 0.34) stale.set(id, TURN - (1 + Math.floor(rnd() * 3)));
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 3; i++) food.push(free());
  const hazards: Coord[] = [];
  for (let i = 0; i < 4; i++) hazards.push(free());
  return { board: { width: size, height: size, food, hazards, snakes } as Board, stale };
}

export interface DriftReport {
  boards: number;
  records: number;
  kinds: Set<string>;
  held: number;
  live: number;
  mismatches: string[];
}

/**
 * Stamp every unit of every board both ways and compare cell for cell.
 *
 * BOTH SHAPES OF RECORD are covered, because they take different paths through
 * the evaluator: a HELD unit keeps the timeline hanging off the resolution's own
 * field and carries its own `heldAtTurn` seed, while a LIVE unit's record is
 * built from its view and dilated on demand.
 */
export function runArrivalShellDifferential(
  seeds: ReadonlyArray<number>,
  horizonTurns = 6
): DriftReport {
  const report: DriftReport = {
    boards: 0,
    records: 0,
    kinds: new Set<string>(),
    held: 0,
    live: 0,
    mismatches: [],
  };

  for (const seed of seeds) {
    const size = seed % 2 === 0 ? 11 : 9;
    const { board, stale } = randomBoard(size, seed);
    const wireIds = (board.snakes ?? []).map((s) => s.id);
    // Half the roster modelled, half held: both record shapes on one board.
    const modeled = wireIds.filter((_, i) => i % 2 === 0);
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled,
      observedTurns: stale,
    });
    try {
      const grid = sub.grid;
      const horizon = TURN + horizonTurns;
      const source = sub.engine.sourceOf(sub.state);

      const check = (
        label: string,
        record: FrozenRecord,
        timeline: ReturnType<typeof source.timelineFor>
      ): void => {
        report.records++;
        report.kinds.add(UNIT_KIND_NAMES[record.kind] as string);
        const mine = earliestShells(timeline, record.heldAtTurn, horizon, grid, null);
        const engine = timeline.arrival(horizon).earliest;
        if (mine.length !== engine.length) {
          report.mismatches.push(`${label}: length ${mine.length} vs ${engine.length}`);
          return;
        }
        for (let c = 0; c < mine.length; c++) {
          if (mine[c] !== engine[c]) {
            report.mismatches.push(
              `${label}: cell ${c} shells=${mine[c] as number} arrival=${engine[c] as number}`
            );
            return;
          }
        }
      };

      // HELD units: the claim field's own timelines and their own seeds.
      for (const slot of sub.claimField().slots) {
        report.held++;
        check(`seed ${seed} held ${slot.record.unitId}`, slot.record, slot.timeline);
      }

      // LIVE units: the record `holdMany` would have built, dilated on demand.
      for (const u of sub.roster()) {
        const view = sub.viewOf(u.unitId);
        if (view === null || !view.alive) continue;
        report.live++;
        const record = recordOfView(view, TURN);
        check(`seed ${seed} live ${u.unitId}`, record, source.timelineFor(record));
      }
      report.boards++;
    } finally {
      sub.release();
      clearGeometryCache();
    }
  }
  return report;
}

/**
 * The gate itself, as a registrable block so both the ordinary suite and the
 * vendor drift gate can run the SAME assertions rather than two copies that can
 * disagree about what "identical" means.
 */
export function describeArrivalShellDifferential(where: string): void {
  describe(`the shell-only arrival reproduces CloudTimeline.arrival (${where})`, () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const report = runArrivalShellDifferential(seeds);

    test('every unit of every board agrees cell for cell', () => {
      expect(report.mismatches).toEqual([]);
    });

    test('the differential actually covered something', () => {
      // A silently-empty differential is the same as no differential.
      expect(report.boards).toBe(seeds.length);
      expect(report.records).toBeGreaterThan(seeds.length * 10);
      expect(report.held).toBeGreaterThan(0);
      expect(report.live).toBeGreaterThan(0);
    });

    test('every kind the grammar registers was stamped', () => {
      expect([...report.kinds].sort()).toEqual([...UNIT_KIND_NAMES].sort());
    });
  });
}
