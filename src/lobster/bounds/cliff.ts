/**
 * THE CLIFF READING — how much of the enemy's cooperation our death needs.
 *
 * `docs/design/BEHAVIOUR-AUDIT-3.md` W3, and `docs/design/CLIFF-DEPTH.md` for
 * the measurement. On a team's LAST unit every candidate an enemy can contest
 * floors at DEAD (5.12% of that unit's turns, against 0.03% at two units), so
 * the floor is uniformly the lattice bottom and ORDERS NOTHING. The bot then
 * falls through to `est`, which ranks the fatal cell first, and plays the seed
 * plan into a contest it loses.
 *
 * The floor is not wrong and is not touched. `evaluate/bound.ts`'s header is
 * binding — "a feature representing a catastrophe scores 'might die' in `lo`
 * EXACTLY as it scores 'dies'", and "a large finite death penalty inverts the
 * cliff the moment some other term outgrows it". So there is no graded death
 * penalty here, no weakened bound and no `lo` that moves. What there is, is a
 * COUNT, taken off leaves the bank has already priced and paid for:
 *
 *     killers = the enumerated enemy joint replies whose branch floors at DEAD
 *     replies = the enumerated enemy joint replies, all of them
 *
 * Fewer killers is less enemy cooperation needed to keep us alive — a death
 * that needs one specific reply out of eight is a different proposition from
 * one that eight replies out of eight deliver — and that is the whole content
 * of the secondary order in `search/core.ts`. This module only MEASURES; the
 * ordering rule that reads the measurement lives with the rest of the
 * acceptance ladder, because that is where a rule is allowed to be.
 *
 * ── WHAT IT COSTS ──────────────────────────────────────────────────────────
 *
 * One comparison and two increments per leaf the bank produced anyway. No
 * evaluator call, no resolution, no `now()` read — so under the runner's node
 * clock a build that tallies and a build that does not are byte-identical in
 * every counter, which is what makes `CLIFF_DEPTH = 0` a real null arm rather
 * than an approximate one.
 *
 * ── WHY THE RUNG IS PART OF THE READING ────────────────────────────────────
 *
 * B1 enumerates one enemy at a time and its leaf count is a SUM over enemies;
 * B3 enumerates the cross-product and its leaf count is a PRODUCT. Three
 * killing replies out of eight and three out of ninety-six are not two
 * readings of one quantity, so the reading carries the rung it was taken at
 * and the order declines across rungs rather than inventing an exchange rate —
 * the same discipline `better()`'s two horizon guards already apply.
 *
 * A sweep the clock cut short is a PREFIX of an enemy's replies, so its count
 * is an under-count of the killers exactly as it is an over-estimate of the
 * min. Those leaves are not tallied at all: `cut` marks the reading and the
 * order declines on it. Under-counting killers would make the most dangerous
 * candidate look like the safest, which is the one error direction this must
 * not have.
 */

/** What one priced plan's already-enumerated replies say about its death. */
export interface CliffReading {
  /**
   * The list shape the count was taken over: 1 for B1's per-enemy sum, 3 for
   * B3's cross-product, 0 for "nothing was enumerated, or the clock cut it".
   * Two readings at different rungs are not comparable.
   */
  readonly rung: 0 | 1 | 3;
  /** Distinct enemy joint replies enumerated and priced. */
  readonly replies: number;
  /** Those of them whose branch floors at DEAD. */
  readonly killers: number;
}

/** Nothing enumerated: the order has nothing to read and declines. */
export const NO_CLIFF: CliffReading = { rung: 0, replies: 0, killers: 0 };

/** The mutable half, one per `price()` call. */
export interface CliffTally {
  rung: 0 | 1 | 3;
  replies: number;
  killers: number;
  /** A sweep was cut short, or two rungs both spoke: the reading is void. */
  cut: boolean;
}

export const newCliffTally = (): CliffTally => ({ rung: 0, replies: 0, killers: 0, cut: false });

/**
 * Fold one group's leaves in. `swept` is the group's own completeness — the
 * same boolean that decides whether it may raise a floor, and for the same
 * reason: a prefix of an enemy's replies is not a statement about the enemy.
 */
export function tallyGroup(
  t: CliffTally,
  rung: 1 | 3,
  leaves: ReadonlyArray<{ readonly bounds: { readonly worst: number } }>,
  swept: boolean,
): void {
  if (!swept) {
    t.cut = true;
    return;
  }
  if (t.rung !== 0 && t.rung !== rung) {
    // Two list shapes in one reading. Nothing sound to add them into.
    t.cut = true;
    return;
  }
  t.rung = rung;
  for (const leaf of leaves) {
    t.replies++;
    if (leaf.bounds.worst === Number.NEGATIVE_INFINITY) t.killers++;
  }
}

export const readCliff = (t: CliffTally): CliffReading =>
  t.cut || t.rung === 0 || t.replies === 0
    ? NO_CLIFF
    : { rung: t.rung, replies: t.replies, killers: t.killers };
