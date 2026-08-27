/**
 * THE LIVE-UNIT RECORD CACHE.
 *
 * `ShellTable.recordForView` hands back a previously built `FrozenRecord` when
 * every field still matches, so the table's identity tier hits and
 * `frozenRecordKey` — eleven interpolated fields and a joined occupancy array —
 * is never built. The failure mode of getting this wrong is a unit dilated from
 * a STALE position, which would be a wrong evaluation at cache latency, so
 * every field the engine's own key covers is exercised here one at a time.
 */

import { FROZEN_RECORD_KEY_FIELDS, frozenRecordKey, makeGrid } from '../../partial-engine/index';
import type { UnitView } from '../../partial-engine/index';
import { ShellTable, recordOfView } from './shells';

const grid = makeGrid(8, 8);

const view = (over: Partial<UnitView> = {}): UnitView =>
  ({
    unitId: 3,
    kind: 0,
    team: 1,
    cells: [10, 11, 12],
    health: 80,
    tier: 0,
    tierExpiresAtTurn: null,
    weight: 3,
    orientation: 1,
    alive: true,
    ...over,
  }) as unknown as UnitView;

describe('recordForView', () => {
  test('the same view value gets the SAME record object back', () => {
    const t = new ShellTable(grid);
    const first = t.recordForView(view(), 40);
    expect(t.recordForView(view(), 40)).toBe(first);
    // ...and it is the record `recordOfView` would have built.
    expect(frozenRecordKey(first)).toBe(frozenRecordKey(recordOfView(view(), 40)));
  });

  test('a different TURN is a different record', () => {
    const t = new ShellTable(grid);
    const first = t.recordForView(view(), 40);
    const second = t.recordForView(view(), 41);
    expect(second).not.toBe(first);
    expect(second.heldAtTurn).toBe(41);
  });

  test.each([
    ['kind', { kind: 2 }],
    ['team', { team: 2 }],
    ['health', { health: 79 }],
    ['tier', { tier: 1 }],
    ['tierExpiresAtTurn', { tierExpiresAtTurn: 44 }],
    ['weight', { weight: 4 }],
    ['orientation', { orientation: 2 }],
    ['occupancy (a cell moved)', { cells: [10, 11, 13] }],
    ['occupancy (a cell added)', { cells: [10, 11, 12, 13] }],
    ['occupancy (a cell dropped)', { cells: [10, 11] }],
  ])('a change of %s is a different record', (_label, over) => {
    const t = new ShellTable(grid);
    const first = t.recordForView(view(), 40);
    const second = t.recordForView(view(over as Partial<UnitView>), 40);
    expect(second).not.toBe(first);
    expect(frozenRecordKey(second)).not.toBe(frozenRecordKey(first));
  });

  test('two different units do not share a cached record', () => {
    const t = new ShellTable(grid);
    const a = t.recordForView(view({ unitId: 3 }), 40);
    const b = t.recordForView(view({ unitId: 4 }), 40);
    expect(b).not.toBe(a);
    expect(t.recordForView(view({ unitId: 3 }), 40)).toBe(a);
  });

  test('every field the engine keys on is one this cache compares', () => {
    // The engine declares the key fields as a mapped type over `FrozenRecord`,
    // so a field added upstream shows up here. `narrowedTo` is the one the
    // cache handles by refusing rather than comparing: `recordOfView` always
    // writes null and `sameAsView` rejects anything else.
    const covered = new Set([
      'unitId',
      'kind',
      'team',
      'occupancy',
      'heldAtTurn',
      'health',
      'tier',
      'tierExpiresAtTurn',
      'weight',
      'orientation',
      'narrowedTo',
    ]);
    expect(new Set(Object.keys(FROZEN_RECORD_KEY_FIELDS))).toEqual(covered);
  });
});
