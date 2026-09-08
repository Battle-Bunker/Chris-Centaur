/**
 * THE INSPECTION RESERVE — who pays for a live inspection (04 §3.3 Q5).
 *
 * Three answers were available: charge the decision (inspection steals from
 * the search the operator is inspecting), charge `reserveMs` (inspection eats
 * the final flush), or charge a dedicated reserve carved BEFORE
 * `searchDeadline`. The third is the only one whose cost is visible before the
 * turn starts, and it is the one the synthesis took: the search is
 * unconditionally shorter by a fixed, declared amount and inspection is
 * unconditionally affordable.
 *
 * No exchange rate between compute and attention is ever computed here or
 * anywhere else. A rate would let the scheduler spend the human.
 */

import { LENS_INSPECTION_MS } from '../types';

/**
 * `LENS_INSPECTION_MS` off the search deadline, and NOTHING ELSE off it — that
 * "nothing else" is gate 7(i), asserted against the recorded pre-lens deadline
 * arithmetic.
 *
 * Carved only where there is something to carve from: a decision with barely
 * more budget than the reserve keeps its search rather than handing the whole
 * turn to an inspector who may not be there.
 */
export function carveReserve(
  searchDeadlineMs: number,
  nowMs: number
): { readonly searchDeadlineMs: number; readonly reserveMs: number } {
  const available = searchDeadlineMs - nowMs;
  if (!(available > LENS_INSPECTION_MS * 2)) return { searchDeadlineMs, reserveMs: 0 };
  return { searchDeadlineMs: searchDeadlineMs - LENS_INSPECTION_MS, reserveMs: LENS_INSPECTION_MS };
}
