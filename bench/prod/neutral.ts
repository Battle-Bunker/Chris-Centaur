/**
 * The third team on a 3-team board: a scripted, deterministic player.
 *
 * It must be neither engine under test, and it must behave IDENTICALLY in
 * both arms of a pair — otherwise the third team becomes an uncontrolled
 * variable rather than a shared disturbance. It is a pure function of (board,
 * turn, seed), so the same position always draws the same reply whichever
 * engine produced that position.
 *
 * Its move list comes from the vendored grammar (`planUnitAction`), so it
 * never plays an illegal move and no rule is re-implemented here. Its policy
 * is deliberately simple and stated in full: step toward the nearest enemy
 * king (else the nearest enemy unit), never onto a cell one of its own units
 * currently occupies, ties broken by a stable hash.
 */

import type { Board, CentaurMove, Coord, Snake } from '../../src/types/battlesnake';
import { marshalBoard } from '../../src/logic/turn-oracle';
import { planUnitAction } from '../../src/engine-vendor/engine/moveGrammar';
import type { UnitType } from '../../src/engine-vendor/shared/types/Game';
import { TeamDetector } from '../../src/logic/team-detector';
import { hash32 } from './rng';

export function neutralMoves(
  board: Board,
  turn: number,
  teamID: string,
  seed: number
): Map<string, CentaurMove> {
  const marshalled = marshalBoard(board, turn);
  const pawnTargets = new Set<number>(marshalled.config.food);
  for (const u of marshalled.units) for (const c of u.occupancy) pawnTargets.add(c);

  const ownCells = new Set<number>();
  const anyCells = new Set<number>();
  for (const u of marshalled.units) {
    for (const c of u.occupancy) anyCells.add(c);
    if (u.teamID !== teamID) continue;
    for (const c of u.occupancy) ownCells.add(c);
  }
  const enemies = marshalled.units.filter((u) => u.teamID !== teamID);
  const kings = enemies.filter((u) => u.isKing === true);
  const targets = (kings.length > 0 ? kings : enemies).map((u) => u.occupancy[0] as number);

  const W = marshalled.fullWidth;
  const H = marshalled.fullHeight;
  const dist = (a: number, b: number): number =>
    Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));

  const out = new Map<string, CentaurMove>();
  const byId = new Map((board.snakes ?? []).map((s) => [s.id, s]));

  for (const unit of marshalled.units) {
    if (unit.teamID !== teamID) continue;
    const origin = unit.occupancy[0] as number;
    const legal: number[] = [];
    for (let cell = 0; cell < W * H; cell++) {
      if (cell === origin) continue;
      const action = planUnitAction(
        unit.type as UnitType,
        origin,
        cell,
        W,
        H,
        unit.orientation,
        pawnTargets
      );
      if (action === null) continue;
      if (action.kind !== 'move') continue; // rotations are not progress
      legal.push(cell);
    }
    // Prefer an EMPTY square; then merely not-our-own; then anything legal. A
    // neutral that marches into occupied squares is a suicide machine and
    // stops being a disturbance the two engines both have to cope with.
    const empty = legal.filter((c) => !anyCells.has(c));
    const notOurs = legal.filter((c) => !ownCells.has(c));
    const options = empty.length > 0 ? empty : notOurs.length > 0 ? notOurs : legal;
    if (options.length === 0) continue; // nothing to say: the default holds
    let best = options[0] as number;
    let bestKey = Number.POSITIVE_INFINITY;
    for (const cell of options) {
      let d = Number.POSITIVE_INFINITY;
      for (const t of targets) d = Math.min(d, dist(cell, t));
      const tie = hash32(`${seed}:${turn}:${unit.id}:${cell}`) / 4294967296;
      const key = d + tie * 0.5;
      if (key < bestKey) {
        bestKey = key;
        best = cell;
      }
    }
    // The neutral speaks the wire's dialect too: pieces stage cells, snakes
    // stage a Direction (the manager surface has no other word for them).
    const snake = byId.get(unit.id) as Snake;
    if (unit.type === 'snake') {
      const from: Coord = marshalled.toCell(origin);
      const to: Coord = marshalled.toCell(best);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dir =
        dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'up' : dy === -1 ? 'down' : null;
      if (dir !== null) out.set(snake.id, dir);
    } else {
      out.set(snake.id, best);
    }
  }
  return out;
}

export function teamsOn(board: Board): string[] {
  return [
    ...new Set((board.snakes ?? []).filter((s) => s.health > 0).map((s) => TeamDetector.getTeamKey(s))),
  ].sort();
}
