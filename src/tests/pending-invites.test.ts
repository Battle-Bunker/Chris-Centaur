import {
  gameDocSnapshotAction,
  inviteChangeAction,
  inviteStatus,
  needsReack,
} from '../firebase/firebase-interface';
import { PendingGameRegistry } from '../logic/pending-game-registry';

// The invite feed now carries lobby invites too: status 'pending' means the
// game exists only as a setup doc (track it, ack it, no turn pipeline),
// 'started' means the normal watch flow. Getting the transitions wrong either
// leaks setup listeners, drops a game the centaur should be playing, or opens
// a game-doc listener on a lobby with no game doc.

describe('inviteStatus', () => {
  it('reads an explicit pending status', () => {
    expect(inviteStatus({ status: 'pending' })).toBe('pending');
  });

  it('reads an explicit started status', () => {
    expect(inviteStatus({ status: 'started' })).toBe('started');
  });

  it('treats a missing status as started (pre-protocol invites)', () => {
    expect(inviteStatus({})).toBe('started');
  });

  it('reads an explicit finished status (forward-compat with game-end stamping)', () => {
    expect(inviteStatus({ status: 'finished' })).toBe('finished');
  });
});

describe('needsReack', () => {
  it('acks when the status doc does not exist yet', () => {
    expect(needsReack(undefined)).toBe(true);
  });

  it('re-acks when the lobby requested a health recheck (ready flipped false)', () => {
    expect(needsReack({ ready: false })).toBe(true);
  });

  it('stays quiet while the ack is standing', () => {
    expect(needsReack({ ready: true })).toBe(false);
  });

  it('re-acks on a malformed ready value', () => {
    expect(needsReack({ ready: 'yes' })).toBe(true);
  });
});

describe('inviteChangeAction', () => {
  it('tracks a new pending invite', () => {
    expect(inviteChangeAction('added', 'pending', false)).toBe('trackPending');
  });

  it('watches a new started invite', () => {
    expect(inviteChangeAction('added', 'started', false)).toBe('watch');
  });

  it('promotes a pending game when its invite flips to started', () => {
    expect(inviteChangeAction('modified', 'started', true)).toBe('promote');
  });

  it('drops a pending game when its invite is deleted (team removed)', () => {
    expect(inviteChangeAction('removed', 'pending', true)).toBe('dropPending');
  });

  it('ignores invite-doc churn while already tracking the pending lobby', () => {
    expect(inviteChangeAction('modified', 'pending', true)).toBe('none');
  });

  it('defensively tracks a pending invite first seen via a modification', () => {
    expect(inviteChangeAction('modified', 'pending', false)).toBe('trackPending');
  });

  it('watches a started modification that was never tracked as pending', () => {
    expect(inviteChangeAction('modified', 'started', false)).toBe('watch');
  });

  it('ignores removal of an invite it never tracked', () => {
    expect(inviteChangeAction('removed', 'started', false)).toBe('none');
  });

  // 'removed' must NEVER tear down a started game: the invite feed is a
  // limit(20) window, so an invite that merely scrolls out of the window
  // surfaces as 'removed' with nothing actually deleted. The game-doc
  // listener is the sole authority for a started game's existence.
  it('ignores removal of a started invite even while the game is live', () => {
    expect(inviteChangeAction('removed', 'started', false)).toBe('none');
  });

  it('never watches a finished invite (replay of a stamped, ended game)', () => {
    expect(inviteChangeAction('added', 'finished', false)).toBe('none');
    expect(inviteChangeAction('modified', 'finished', false)).toBe('none');
  });

  it('drops the pending tracking when a tracked lobby finishes', () => {
    expect(inviteChangeAction('modified', 'finished', true)).toBe('dropPending');
  });
});

describe('gameDocSnapshotAction', () => {
  const snap = (over: Partial<Parameters<typeof gameDocSnapshotAction>[0]>) =>
    gameDocSnapshotAction({
      exists: true,
      fromCache: false,
      hasTurns: true,
      registered: false,
      ...over,
    });

  it('processes a live doc with turns', () => {
    expect(snap({})).toBe('process');
    expect(snap({ registered: true })).toBe('process');
  });

  it('ignores a live doc with no turns yet', () => {
    expect(snap({ hasTurns: false })).toBe('ignore');
  });

  it('ends and unwatches a registered game whose doc was deleted (server-confirmed)', () => {
    expect(snap({ exists: false, hasTurns: false, registered: true })).toBe('endAndUnwatch');
  });

  it('silently unwatches a stale invite replay pointing at a deleted doc', () => {
    expect(snap({ exists: false, hasTurns: false, registered: false })).toBe('unwatch');
  });

  // A cache-first delivery can transiently claim the doc is missing; only a
  // server-backed snapshot may end a game.
  it('never acts on cache-only non-existence', () => {
    expect(snap({ exists: false, fromCache: true, hasTurns: false, registered: true })).toBe('ignore');
    expect(snap({ exists: false, fromCache: true, hasTurns: false, registered: false })).toBe('ignore');
  });
});

describe('PendingGameRegistry', () => {
  const registry = PendingGameRegistry.getInstance();
  const info = (gameID: string) => ({
    sessionID: 'sesh',
    gameID,
    boardWidth: 13,
    boardHeight: 13,
    snakesPerTeam: 3,
    maxTurnTime: 10,
    teams: [{ id: 'c1', name: 'Centaur One', color: '#ff0000', ours: true }],
  });

  afterEach(() => {
    for (const pg of registry.list()) registry.remove(pg.gameID);
  });

  it('lists an upserted pending game and notifies', () => {
    let notified = 0;
    registry.onChange(() => notified++);
    registry.upsert(info('g1'));
    expect(registry.has('g1')).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(notified).toBe(1);
  });

  it('updates in place on re-upsert (live setup edits)', () => {
    registry.upsert(info('g1'));
    registry.upsert({ ...info('g1'), boardWidth: 21 });
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].boardWidth).toBe(21);
  });

  it('removes on pending → started promotion or invite deletion', () => {
    registry.upsert(info('g1'));
    registry.remove('g1');
    expect(registry.has('g1')).toBe(false);
    expect(registry.list()).toHaveLength(0);
  });

  it('remove of an unknown game is a silent no-op', () => {
    let notified = 0;
    registry.onChange(() => notified++);
    registry.remove('nope');
    expect(notified).toBe(0);
  });

  // Every setup-doc snapshot re-upserts the same settings, and each notify
  // fans out as a full lobby broadcast + re-render on every client — a no-op
  // upsert must stay silent.
  it('does not notify on an unchanged re-upsert', () => {
    registry.upsert(info('g1'));
    let notified = 0;
    registry.onChange(() => notified++);
    registry.upsert(info('g1'));
    expect(notified).toBe(0);
    registry.upsert({ ...info('g1'), maxTurnTime: 30 });
    expect(notified).toBe(1);
  });
});
