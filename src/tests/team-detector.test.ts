/**
 * Team identity precedence: the explicit teamID (authoritative on the
 * Firebase transport) wins, then the Battlesnake-era squad → color → id
 * heuristics for legacy logged games. The Firebase translate layer mirrors
 * teamID into squad, so the teamID preference is provably a no-op for every
 * Firebase-era game — pinned here.
 */

import { TeamDetector } from '../logic/team-detector';
import { Snake } from '../types/battlesnake';

function snake(id: string, opts: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body: [{ x: 0, y: 0 }],
    head: { x: 0, y: 0 },
    length: 1,
    shout: '',
    squad: '',
    customizations: { color: '', head: 'default', tail: 'default' },
    ...opts,
  } as Snake;
}

describe('TeamDetector.getTeamKey precedence', () => {
  test('teamID > squad > color > id', () => {
    expect(TeamDetector.getTeamKey(snake('s1', { teamID: 'T', squad: 'S', customizations: { color: '#abc', head: '', tail: '' } }))).toBe('T');
    expect(TeamDetector.getTeamKey(snake('s1', { squad: 'S', customizations: { color: '#abc', head: '', tail: '' } }))).toBe('S');
    expect(TeamDetector.getTeamKey(snake('s1', { customizations: { color: '#abc', head: '', tail: '' } }))).toBe('#abc');
    expect(TeamDetector.getTeamKey(snake('s1'))).toBe('s1');
  });

  test('firebase-era equivalence: squad mirrors teamID, so the preference changes nothing', () => {
    // translate.buildSnake sets squad = gamePlayer.teamID, so both fields
    // always agree for Firebase-era snakes.
    const s = snake('centA#2', { teamID: 'centA', squad: 'centA' });
    expect(TeamDetector.getTeamKey(s)).toBe('centA');
  });

  test('detectTeams grouping on a legacy (no-teamID) roster is unchanged', () => {
    const detector = new TeamDetector();
    const snakes = [
      snake('a1', { squad: 'red' }),
      snake('a2', { squad: 'red' }),
      snake('b1', { customizations: { color: '#00f', head: '', tail: '' } }),
      snake('b2', { customizations: { color: '#00f', head: '', tail: '' } }),
      snake('lone'),
    ];
    const teams = detector.detectTeams(snakes);
    const byKey = new Map(teams.map((t) => [t.color, t.snakes.map((s) => s.id)]));
    expect(byKey.get('red')).toEqual(['a1', 'a2']);
    expect(byKey.get('#00f')).toEqual(['b1', 'b2']);
    expect(byKey.get('lone')).toEqual(['lone']);
  });

  test('mixed roster: our teamID team groups apart from an enemy squad-only team', () => {
    const detector = new TeamDetector();
    const snakes = [
      snake('centA', { teamID: 'centA', squad: 'centA' }),
      snake('centA#2', { teamID: 'centA', squad: 'centA' }),
      snake('enemy1', { squad: 'centB' }),
      snake('enemy2', { squad: 'centB' }),
    ];
    const ours = detector.getTeammates(snakes[0], snakes);
    expect(ours.map((s) => s.id)).toEqual(['centA#2']);
    expect(detector.getEnemySnakes(snakes[0], snakes).map((s) => s.id)).toEqual(['enemy1', 'enemy2']);
  });
});
