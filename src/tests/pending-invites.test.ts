import { inviteChangeAction, inviteStatus } from '../firebase/firebase-interface';
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
});
