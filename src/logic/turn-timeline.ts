/**
 * The roster projection: who was on the board, stored beside the board.
 *
 * WHAT WAS HERE AND IS NOT. `mergeTimelineRows` merged native `turn_states`
 * rows, per turn, with boards SYNTHESISED from the embedded `game_state` of an
 * old-format per-snake decision row, so a game whose deploy landed mid-play
 * came out contiguous. Both halves of that are gone. `turn_boards` stores one
 * canonical board per (game, BOARD turn) and there is no second format to fall
 * back to — no backwards compatibility, so no merge, and nothing kept from it.
 * `slimGameStateForLog` / `slimSnakeForLog` went with the per-snake decision
 * row they slimmed.
 *
 * What replaces the merge is smaller than the merge: one projection, stored
 * once per turn, of the identity fields a listing groups on. It exists so the
 * history listing never has to detoast a settlement to learn who played —
 * which is the only reason the old code read `game_state->'you'` at all.
 *
 * Kept free of database imports so the projection stays unit-testable.
 */

import type { BoardSnapshot, Snake } from '../types/battlesnake';
import type { RosterEntry } from '../lens/store/persistence';

/**
 * The per-unit identity strip of one settled board.
 *
 * `length` is a WEIGHT for a chess piece (stack size) and a body-cell count
 * for a snake — the same number the wire carries under the same name, so a
 * reader of the listing is reading exactly what the game said.
 */
export function rosterOf(settlement: BoardSnapshot): ReadonlyArray<RosterEntry> {
  const snakes: ReadonlyArray<Snake> = settlement?.board?.snakes ?? [];
  return snakes.map(snake => ({
    unit: snake.id,
    name: snake.name ?? null,
    letter: snake.letter ?? null,
    color: snake.customizations?.color ?? null,
    teamId: snake.teamID ?? null,
    teamName: snake.teamName ?? null,
    squad: snake.squad ?? null,
    length: snake.length ?? null,
  }));
}
