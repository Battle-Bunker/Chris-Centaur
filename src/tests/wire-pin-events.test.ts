/**
 * Pin events derived from staging.
 *
 * Two contract-level rules carry most of the weight here, and both are about
 * what the stream must REFUSE to do: the bot never auto-unpins, and a
 * tentative pin is never binding. The rest is translation and de-duplication.
 */

import type { PinEvent } from '../lobster/contracts';
import type { CentaurMove } from '../types/battlesnake';
import { PinEventStream, PinTranslation, UnitIdRegistry, isPinningSource } from '../wire/pin-events';

/** Units are 'a'..'z'; a direction maps to a distinct cell per unit so a pin's
 * `to` identifies both the unit and the move it came from. */
function translation(unknown: ReadonlyArray<string> = []): PinTranslation {
  const registry = new UnitIdRegistry();
  registry.register(['a', 'b', 'c']);
  const dirs: Record<string, number> = { up: 1, down: 2, left: 3, right: 4 };
  return {
    unitIdOf: (snakeId) => (unknown.includes(snakeId) ? null : registry.idOf(snakeId)),
    cellOf: (snakeId, move: CentaurMove) => {
      if (typeof move === 'number') return move;
      const d = dirs[move];
      if (d === undefined) return null;
      return registry.idOf(snakeId) * 100 + d;
    },
  };
}

function collect(stream: PinEventStream): PinEvent[] {
  const seen: PinEvent[] = [];
  stream.subscribe((e) => seen.push(e));
  return seen;
}

describe('manual and waypoint staging are pins; bot and fallback are not', () => {
  test('the pinning sources are exactly manual and waypoint', () => {
    expect(isPinningSource('manual')).toBe(true);
    expect(isPinningSource('waypoint')).toBe(true);
    expect(isPinningSource('bot')).toBe(false);
    expect(isPinningSource('fallback')).toBe(false);
  });

  test('a manual selection emits a binding pin', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    expect(events).toEqual([{ kind: 'pin', pin: { unitId: 0, to: 1, tentative: false } }]);
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
  });

  test('a waypoint step is a pin too — a commanded unit is constrained', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('b', 7, 'right', 'waypoint');
    expect(events).toEqual([{ kind: 'pin', pin: { unitId: 1, to: 104, tentative: false } }]);
  });

  test('a bot-sourced stage emits nothing at all', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'bot');
    s.observeStaged('a', 7, 'down', 'fallback');
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([]);
  });

  test('re-staging the same move emits nothing — the stream is deduplicated', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    s.observeStaged('a', 7, 'up', 'manual');
    s.observeStaged('a', 7, 'up', 'waypoint');
    expect(events.length).toBe(1);
  });

  test('a unit the translation does not model is silently skipped', () => {
    const s = new PinEventStream(translation(['ghost']));
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('ghost', 7, 'up', 'manual');
    expect(events).toEqual([]);
  });

  test('a move the translation cannot place emits nothing', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'sideways' as CentaurMove, 'manual');
    expect(events).toEqual([]);
  });
});

describe('the bot never auto-unpins', () => {
  test('an unpin is emitted only when the OPERATOR released the intent', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    events.length = 0;
    // The operator cleared the intent, so the next stage is the bot's own move.
    s.observeStaged('a', 7, 'left', 'bot');
    expect(events).toEqual([{ kind: 'unpin', unitId: 0 }]);
    expect(s.currentPins()).toEqual([]);
  });

  test('an unpin is not repeated once the unit is unpinned', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    s.observeStaged('a', 7, 'left', 'bot');
    events.length = 0;
    s.observeStaged('a', 7, 'right', 'bot');
    expect(events).toEqual([]);
  });

  test('a turn change discards pins WITHOUT emitting a flurry of unpins', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    s.observeStaged('b', 7, 'down', 'manual');
    const events = collect(s);
    s.beginTurn(8);
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([]);
  });

  test('an event for a stale turn is ignored', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(8);
    const events = collect(s);
    s.observeStaged('a', 7, 'up', 'manual');
    expect(events).toEqual([]);
  });
});

describe('a commit is permanent for the turn', () => {
  test('the commit event fires once', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeCommit('a', 7);
    s.observeCommit('a', 7);
    expect(events).toEqual([{ kind: 'commit', unitId: 0 }]);
  });

  test('nothing can move a committed unit — not staging, not the read-back, not a hover', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    const events = collect(s);
    s.observeCommit('a', 7);
    events.length = 0;

    s.observeStaged('a', 7, 'down', 'manual');
    s.observeStaged('a', 7, 'left', 'bot');
    s.observeConfirmed('a', 7, 'right');
    s.tentativePin('a', 'down');
    expect(events).toEqual([]);
    // The pin the operator committed to is still standing, unchanged.
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
  });

  test('a new turn releases the freeze', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeCommit('a', 7);
    expect(s.committedUnits()).toEqual(['a']);
    s.beginTurn(8);
    expect(s.committedUnits()).toEqual([]);
    const events = collect(s);
    s.observeStaged('a', 8, 'up', 'manual');
    expect(events.length).toBe(1);
  });
});

describe('the read-back strengthens a pin, it never creates one', () => {
  test('a confirmation for a pinned unit moves the pin to what the wire holds', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    const events = collect(s);
    s.observeConfirmed('a', 7, 'down');
    expect(events).toEqual([{ kind: 'pin', pin: { unitId: 0, to: 2, tentative: false } }]);
  });

  test('a confirmation for an UNPINNED unit creates nothing — a bot move acked is still a bot move', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.observeConfirmed('a', 7, 'up');
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([]);
  });

  test('a confirmation does not promote a tentative pin to a binding one', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.tentativePin('a', 'up');
    const events = collect(s);
    s.observeConfirmed('a', 7, 'up');
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([]);
  });
});

describe('tentative pins ride the stream but never the context', () => {
  test('a hover emits a tentative pin and stays out of currentPins', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.tentativePin('a', 'up');
    expect(events).toEqual([{ kind: 'pin', pin: { unitId: 0, to: 1, tentative: true } }]);
    expect(s.currentPins()).toEqual([]);
    expect(s.allPins()).toEqual([{ unitId: 0, to: 1, tentative: true }]);
  });

  test('clearing a hover unpins it', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.tentativePin('a', 'up');
    s.clearTentative('a');
    expect(events[1]).toEqual({ kind: 'unpin', unitId: 0 });
    expect(s.allPins()).toEqual([]);
  });

  test('clearTentative can NEVER clear a binding pin', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    const events = collect(s);
    s.clearTentative('a');
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
  });

  test('a hover over a unit that already has a binding pin is ignored', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    const events = collect(s);
    s.tentativePin('a', 'down');
    expect(events).toEqual([]);
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
  });

  test('a real stage supersedes a hover on the same unit', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.tentativePin('a', 'up');
    s.observeStaged('a', 7, 'up', 'manual');
    expect(events).toEqual([
      { kind: 'pin', pin: { unitId: 0, to: 1, tentative: true } },
      { kind: 'pin', pin: { unitId: 0, to: 1, tentative: false } },
    ]);
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
  });

  test('moving the hover re-emits at the new cell', () => {
    const s = new PinEventStream(translation());
    const events = collect(s);
    s.beginTurn(7);
    s.tentativePin('a', 'up');
    s.tentativePin('a', 'down');
    expect(events.length).toBe(2);
    expect(events[1]).toEqual({ kind: 'pin', pin: { unitId: 0, to: 2, tentative: true } });
  });
});

describe('the canonical pin context', () => {
  test('is sorted by unit id regardless of the order events arrived in', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('c', 7, 'up', 'manual');
    s.observeStaged('a', 7, 'down', 'manual');
    s.observeStaged('b', 7, 'left', 'waypoint');
    expect(s.currentPins().map((p) => p.unitId)).toEqual([0, 1, 2]);
  });

  test('holds committed pins only', () => {
    const s = new PinEventStream(translation());
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    s.tentativePin('b', 'down');
    expect(s.currentPins()).toEqual([{ unitId: 0, to: 1, tentative: false }]);
    expect(s.allPins().length).toBe(2);
  });
});

describe('subscription plumbing', () => {
  test('unsubscribing stops delivery', () => {
    const s = new PinEventStream(translation());
    const seen: PinEvent[] = [];
    const off = s.subscribe((e) => seen.push(e));
    s.beginTurn(7);
    s.observeStaged('a', 7, 'up', 'manual');
    off();
    s.observeStaged('b', 7, 'up', 'manual');
    expect(seen.length).toBe(1);
  });

  test('a throwing sink cannot break observation for the others', () => {
    const s = new PinEventStream(translation());
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const seen: PinEvent[] = [];
    s.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    s.subscribe((e) => seen.push(e));
    s.beginTurn(7);
    expect(() => s.observeStaged('a', 7, 'up', 'manual')).not.toThrow();
    expect(seen.length).toBe(1);
    errSpy.mockRestore();
  });
});

describe('the unit id registry', () => {
  test('ids are stable and assigned in roster order', () => {
    const r = new UnitIdRegistry();
    r.register(['z', 'a', 'm']);
    expect(r.idOf('z')).toBe(0);
    expect(r.idOf('a')).toBe(1);
    expect(r.idOf('m')).toBe(2);
    expect(r.idOf('z')).toBe(0);
    expect(r.size).toBe(3);
  });

  test('lookup refuses to mint', () => {
    const r = new UnitIdRegistry();
    expect(r.lookup('nobody')).toBeNull();
    expect(r.size).toBe(0);
  });

  test('the mapping reverses', () => {
    const r = new UnitIdRegistry();
    r.register(['x', 'y']);
    expect(r.snakeIdOf(1)).toBe('y');
    expect(r.snakeIdOf(9)).toBeNull();
  });
});
