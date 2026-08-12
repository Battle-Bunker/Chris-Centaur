/**
 * Pure helpers for the per-game board timeline.
 *
 * One game has ONE board timeline. Modern games store it natively in
 * turn_states (one canonical you-less state per turn); games logged before
 * that table existed only have per-snake decision rows with embedded
 * game_states. A single game can be BOTH — a deploy mid-game leaves early
 * turns in the old format and later turns in the new — so the merge is
 * strictly PER TURN, never per game: every turn takes the native row when one
 * exists and falls back to a decision-derived board otherwise.
 *
 * Kept free of database imports so the merge semantics are unit-testable.
 */

export interface TimelineRow {
  // BOARD-domain turn number (game_state.turn), not the decision-log turn
  // column (which is board turn + 1).
  turn: number;
  // Canonical you-less state {game, turn, board, lastMoves?, winners?}.
  game_state: any;
  // Shared per-turn Voronoi data; null when never captured for this turn.
  territory: any | null;
  cell_ownership: any | null;
  // True when the row came from turn_states rather than being synthesized
  // from an old-format decision row.
  native: boolean;
}

// A native turn_states row as read from the database.
export interface NativeTurnRow {
  turn: number;
  game_state: any;
  territory?: any | null;
  cell_ownership?: any | null;
}

// A decision-derived candidate: an old-format decision row's embedded
// game_state (with `you`) plus the shared Voronoi grids its move_evaluations
// blob carried.
export interface SynthesizedTurnRow {
  game_state: any;
  territory?: any | null;
  cell_ownership?: any | null;
}

export function mergeTimelineRows(
  native: NativeTurnRow[],
  synthesized: SynthesizedTurnRow[],
): TimelineRow[] {
  const byTurn = new Map<number, TimelineRow>();

  for (const r of synthesized) {
    // Only rows with a real board can serve as a board source; a slim
    // {turn, you} game_state cannot.
    if (!r?.game_state?.board) continue;
    const t = r.game_state.turn;
    if (typeof t !== 'number') continue;
    // Strip `you`: it is whichever snake's row happened to be picked, and a
    // timeline consumer treating it as "the" snake would anchor overlays at
    // the wrong head. Timeline states are you-less by contract.
    const youless = { ...r.game_state };
    delete youless.you;
    byTurn.set(t, {
      turn: t,
      game_state: youless,
      territory: r.territory ?? null,
      cell_ownership: r.cell_ownership ?? null,
      native: false,
    });
  }

  // Native rows win per turn.
  for (const r of native) {
    if (!r?.game_state) continue;
    byTurn.set(r.turn, {
      turn: r.turn,
      game_state: r.game_state,
      territory: r.territory ?? null,
      cell_ownership: r.cell_ownership ?? null,
      native: true,
    });
  }

  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

// The slim per-snake identity stored on modern decision rows in place of the
// full game_state. Everything the listing and the replay's evaluation panel
// read off a decision row's `you` survives (head anchor, name/letter/color/
// length/team identity); the board and the snake bodies do not — those live
// on the turn timeline.
export function slimSnakeForLog(you: any): any {
  if (!you) return null;
  const slim: any = {
    id: you.id,
    name: you.name,
    health: you.health,
    length: you.length,
    head: you.head ? { x: you.head.x, y: you.head.y } : undefined,
    squad: you.squad,
    customizations: { color: you.customizations?.color ?? '' },
  };
  if (you.letter) slim.letter = you.letter;
  if (you.emoji) slim.emoji = you.emoji;
  if (you.teamID) slim.teamID = you.teamID;
  return slim;
}

// Modern decision rows keep a game_state of exactly {turn, you}: the fields
// every existing consumer keys on (turn) or reads per-snake data from (you),
// with the shared board deduplicated into turn_states. Old clients and old
// query paths keep working because the keys they touch are still present.
export function slimGameStateForLog(gameState: any): any {
  return {
    turn: gameState?.turn ?? 0,
    you: slimSnakeForLog(gameState?.you),
  };
}
