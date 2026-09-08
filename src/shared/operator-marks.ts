/**
 * THE PER-OPERATOR MARK — a shape, index-aligned with the colour palette.
 *
 * `docs/design/ux/11-MOTION-AND-MARKS.md` §5 is the design; this file is
 * normative. `05-EVALUATION.md` P-4 asked for two things and handed both back:
 * a contrast-checked, CVD-safe operator PALETTE, and a per-operator MARK so
 * that "which operator staged this" is not carried by hue alone
 * (`02-IA-AND-CONTROLS.md` §2.5 records that deferral, and A-1 found three of
 * the six remaining contrast failures in the operator badges).
 *
 * THIS FILE IS ONLY THE SECOND HALF, and deliberately so. `player-palette.ts`
 * beside it is board-owned: twelve hexes ordered by a farthest-point walk,
 * cleared against every colour the board already draws, read by the server
 * that assigns from it and by the canvas, the badges, the arrows and the
 * history replay. Re-ordering it to Okabe-Ito repaints every historical
 * screenshot and is a decision taken with the board, not beside it. A SHAPE
 * takes nothing away from anyone, so it can be added on its own.
 *
 * WHY INDEX-ALIGNED WITH THE PALETTE. The mark and the hue are then two
 * readings of ONE number — the operator's arrival index — so either alone
 * identifies them, neither is authoritative over the other, and they cannot
 * disagree. It also means the wrap point is the same: past twelve operators
 * two people share a hue AND a mark, rather than the surface quietly claiming
 * to tell apart more operators than it can.
 *
 * THE ORDER IS CHOSEN THE WAY THE PALETTE'S IS — prefix dispersion. A game has
 * two or three operators far more often than ten, so the first four marks are
 * the four most different silhouettes in the set: a filled square, a filled
 * star, a hollow down-triangle and a filled diamond. Fill, edge count and axis
 * all differ between each adjacent pair, and none of the first four is
 * another's outline or another's rotation. The half-fills (`◐` `◧` `◒`) are
 * the weakest silhouettes and sit at 9-11, which a game only reaches with ten
 * operators in it.
 *
 * EVERY MARK IS UNSPENT. `02-IA-AND-CONTROLS.md` §2.5 audits what the rail's
 * glyph vocabulary already means, and this alphabet was chosen against that
 * list: `▸` cursor, `◇` foil, `⚠` refused, `◦` unplanned, `🔒` fixed, `⦿`
 * lock, `↺` undo, `⛨` hold, `◎` goto, `◉` near, `✕` clear, `⚑` banner, and
 * `●` `▲` `○` on the timeline lane. No mark below is any of those, and none is
 * one of them hollowed or rotated. `◇` foil against `◆` mark is the one near
 * pair in the whole set, and the two never appear in the same place: the foil
 * is a card heading in the rail, the mark is an attribution.
 *
 * EVERY MARK IS A SILHOUETTE, not a glyph with interior detail, because the
 * smallest place it is drawn is the board's head-plate chip at 7-9 px. At that
 * size `■` and `★` and `▽` and `◆` are four different blobs, which is all this
 * channel is asked to be.
 */
import { PLAYER_PALETTE } from './player-palette';

export const OPERATOR_MARKS: readonly string[] = [
  '■', // 0  filled square        · azure blue
  '★', // 1  filled star          · coral rose
  '▽', // 2  hollow triangle down · emerald green
  '◆', // 3  filled diamond       · violet
  '□', // 4  hollow square        · cyan teal
  '☆', // 5  hollow star          · magenta
  '▼', // 6  filled triangle down · rust brown
  '◈', // 7  diamond in diamond   · turquoise
  '▣', // 8  square in square     · periwinkle
  '◐', // 9  half circle, left    · deep petrol
  '◧', // 10 half square, left    · crimson wine
  '◒', // 11 half circle, lower   · deep teal-green
];

/**
 * The mark for the Nth operator to arrive in a game (0-based). Wraps at the
 * same point `colorForArrivalIndex` does, and for the same reason — the two
 * are one number read twice.
 */
export function markForArrivalIndex(arrivalIndex: number): string {
  const n = OPERATOR_MARKS.length;
  const i = Number.isFinite(arrivalIndex) ? Math.max(0, Math.floor(arrivalIndex)) : 0;
  return OPERATOR_MARKS[i % n];
}

/**
 * The arrival index behind a colour, or null for a colour that is not one of
 * the palette's — a bot's grey, the unattributed-arrow green, or a hue from
 * before the palette was ordered. `null` is a real answer here and callers are
 * expected to draw their existing unattributed mark for it, never a mark that
 * would claim an operator the colour does not name.
 */
export function arrivalIndexForColor(color: string | null | undefined): number | null {
  const hex = String(color ?? '').trim().toLowerCase();
  if (hex === '') return null;
  const i = PLAYER_PALETTE.findIndex((c) => c.toLowerCase() === hex);
  return i === -1 ? null : i;
}

/**
 * THE ONE CROSSING between the two halves of P-4, and the reason the mark
 * needs no new field on the wire: every surface that draws an operator already
 * has their COLOUR — `TurnEvent.actor.color`, `selections[id].color`,
 * `owners[id].color`, `connectedUsers[].color` — so the colour is the key that
 * resolves to the mark, and the two stay two readings of one arrival index
 * without anybody sending the index itself.
 */
export function markForColor(color: string | null | undefined): string | null {
  const i = arrivalIndexForColor(color);
  return i === null ? null : OPERATOR_MARKS[i];
}
