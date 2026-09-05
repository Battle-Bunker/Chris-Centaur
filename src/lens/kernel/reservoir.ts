/**
 * THE RETENTION — the search's own discarded work, kept.
 *
 * `better()` (`search/core.ts`) already computes the ranking and drops the
 * loser on the floor. The reservoir writes at that one call site: `O(k)`
 * comparisons per priced trial, ZERO evaluations, and — this is the part that
 * has to be true for the node clock to keep working — ZERO clock reads. A row
 * is stamped with the slice's own start reading, which the kernel has already
 * taken, rather than with a fresh `now()`: under `--nodes` a clock read IS
 * work, and a lens that read the clock would change the decision it is
 * watching.
 *
 * ONE RESERVOIR PER `(clusterId, complementKey)`, `k = LENS_TOPK`, ordered on
 * the same key `better()` uses — `(lo, est, hi, tie)`, each descending — so
 * the reservoir's order and the search's order are the same order BY
 * CONSTRUCTION and cannot drift. That is the whole falsifier: a displayed rank
 * that disagrees with the search's is a lie about the bot to the person
 * deciding whether to overrule it.
 *
 * TWO CAPS AT TWO LAYERS (04 §2.3): `LENS_TOPK` per fiber, `LENS_ROW_CAP` per
 * decision. They compose rather than compete.
 */

import {
  LENS_ROW_CAP,
  LENS_TOPK,
  type ClusterId,
  type DominanceCondition,
  type Moveset,
  type VerdictReason,
  type Witness,
} from '../types';

/** WHY `better()` refused this trial — the branch, read backwards, plus the
 *  certificate when the branch was the witness veto. Null until [CHANGE 1]. */
export interface Refusal {
  readonly because: VerdictReason;
  readonly witness?: Witness;
}

/** What the hot path knows about a trial before anything is materialised. */
export interface TrialOrder {
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  readonly tie: number;
}

/** `better()`'s own key: strict improvement on (floor, est, ceiling, salt). */
export function byBetter(a: TrialOrder, b: TrialOrder): number {
  if (a.lo !== b.lo) return b.lo - a.lo;
  if (a.est !== b.est) return b.est - a.est;
  if (a.hi !== b.hi) return b.hi - a.hi;
  return b.tie - a.tie;
}

/**
 * Why the leader beat this row, read off `better()`'s own ladder backwards.
 * Filled at the BARRIER and never before: a dominance condition asserted
 * mid-search would be a claim about a comparison the search had not finished.
 */
function dominanceOf(row: Moveset, leader: Moveset, refusal: Refusal | null): DominanceCondition {
  const because = refusal?.because ?? null;
  switch (because) {
    case 'witness': {
      // The banked reply that holds this plan below the leader's proved floor.
      // It is a certificate: it survives restarts and pin-context switches by
      // contract, so the row carries it rather than a summary of it.
      //
      // WITH NO CERTIFICATE IN HAND, THE ROW SAYS `dominated` INSTEAD. That is
      // not a downgrade, it is the truth: `refutedAt` is the arithmetic that
      // this plan's ceiling sits below the leader's proved floor, which is
      // exactly what `dominated` claims. A witness with no replies in it would
      // be a certificate nobody holds.
      const witness = refusal?.witness;
      if (witness === undefined) return { kind: 'dominated', by: leader.lo - row.hi };
      return { kind: 'refuted-by-witness', witness };
    }
    case 'basis':
      return { kind: 'incomparable-basis', theirs: row.assumptions };
    case 'est':
      return { kind: 'advisory-only', estMargin: leader.est - row.est };
    case 'cliff':
      // W3. `lo` is DEAD on both rows, so a margin on it is `Infinity - Infinity`
      // and a margin on `hi` is not what decided: the leader won because fewer
      // of the enemy's enumerated replies kill it. The row says which rung
      // spoke and does not fabricate a number the comparison never produced.
      return { kind: 'on-the-cliff' };
    case 'tie':
      return { kind: 'indifferent' };
    case 'floor':
    case 'hi':
    default:
      // The floor branch splits on whether anything this row does not know
      // could still carry it: a row whose CEILING is above the leader's floor
      // leads if the claims it cites resolve our way, and one whose ceiling is
      // not cannot win under any resolution of what we do not know.
      return row.hi > leader.lo
        ? { kind: 'contingent', onUnits: row.citedUnits, atStake: row.hi - leader.lo }
        : { kind: 'dominated', by: leader.lo - row.hi };
  }
}

interface Group {
  readonly cluster: ClusterId;
  readonly complementKey: string;
  rows: Moveset[];
  /** The refusal branch `better()` took for each retained row, by key. */
  readonly because: Map<string, Refusal>;
}

export interface MovesetReservoir {
  /**
   * Would this trial be retained? `O(k)` numeric comparisons and no
   * allocation — the hot path asks this BEFORE it materialises a row, so a
   * trial that loses costs four number comparisons and nothing else.
   */
  admits(cluster: ClusterId, complementKey: string, order: TrialOrder): boolean;
  /** `O(k)` comparisons, zero evaluations. Called at the `better()` call site. */
  offer(row: Moveset, refusal?: Refusal | null): void;
  /** The retained rows for one cluster, ranked. Never mixes complements. */
  rows(cluster: ClusterId, complementKey?: string): ReadonlyArray<Moveset>;
  all(): ReadonlyArray<Moveset>;
  /** Which complements this reservoir holds rows for, in insertion order. */
  complements(cluster: ClusterId): ReadonlyArray<string>;
  /**
   * Fills `dominance` on every retained row, and marks every row whose
   *  complement is no longer the incumbent's `stale`. Null before this;
   *  non-null after.
   *
   * The live complement is PER CLUSTER, because the complement of a cluster
   * is everything outside THAT cluster: one string is the whole board's
   * answer and a map is one answer per fiber. A caller with one cluster in
   * hand passes the string.
   */
  seal(live: string | ReadonlyMap<ClusterId, string>): void;
  /**
   * Mark the staged plan's own restriction, and clear the mark from whatever
   * held it before. A no-op when the barrier is the first place this
   * restriction has been seen and it is not retained — the reservoir keeps
   * what the SEARCH priced, and a row nobody priced has no bracket to show.
   */
  stageRow(cluster: ClusterId, complementKey: string, key: string): void;
  readonly size: number;
}

export function makeReservoir(rowCap: number = LENS_ROW_CAP, topK: number = LENS_TOPK): MovesetReservoir {
  const groups = new Map<string, Group>();
  const keyOf = (cluster: ClusterId, complementKey: string): string => `${cluster}#${complementKey}`;

  const ranked = (group: Group): Moveset[] => {
    // The staged plan's restriction is ALWAYS rank 1 for its own complement.
    // It is what the bot will actually do, and a table whose first row is not
    // the staged plan answers a question nobody asked.
    const staged = group.rows.filter((r) => r.staged);
    const rest = group.rows.filter((r) => !r.staged).sort(byBetter);
    return [...staged.sort(byBetter), ...rest];
  };

  const trim = (): void => {
    for (const group of groups.values()) {
      if (group.rows.length <= topK) continue;
      group.rows = ranked(group).slice(0, topK);
    }
    let total = 0;
    for (const group of groups.values()) total += group.rows.length;
    while (total > rowCap) {
      // Evict the globally worst tail row, never a staged one: the cap is a
      // memory bound and the staged row is the one the operator is standing on.
      let worst: { group: Group; row: Moveset } | null = null;
      for (const group of groups.values()) {
        const tail = [...ranked(group)].reverse().find((r) => !r.staged);
        if (tail === undefined) continue;
        if (worst === null || byBetter(tail, worst.row) > 0) worst = { group, row: tail };
      }
      if (worst === null) break;
      worst.group.rows = worst.group.rows.filter((r) => r !== worst?.row);
      total--;
    }
  };

  return {
    admits(cluster, complementKey, order) {
      const group = groups.get(keyOf(cluster, complementKey));
      if (group === undefined || group.rows.length < topK) return true;
      const tail = ranked(group)[topK - 1] as Moveset;
      return byBetter(order, tail) < 0;
    },
    offer(row, refusal = null) {
      const id = keyOf(row.cluster, row.complementKey);
      let group = groups.get(id);
      if (group === undefined) {
        group = { cluster: row.cluster, complementKey: row.complementKey, rows: [], because: new Map() };
        groups.set(id, group);
      }
      if (refusal !== null) group.because.set(row.key, refusal);
      const seen = group.rows.findIndex((r) => r.key === row.key);
      if (seen >= 0) {
        const previous = group.rows[seen] as Moveset;
        group.rows[seen] = { ...row, seenIn: previous.seenIn + 1, staged: row.staged || previous.staged };
      } else {
        group.rows.push(row);
      }
      trim();
    },
    rows(cluster, complementKey) {
      const out: Moveset[] = [];
      for (const group of groups.values()) {
        if (group.cluster !== cluster) continue;
        if (complementKey !== undefined && group.complementKey !== complementKey) continue;
        out.push(...ranked(group).map((r, i) => ({ ...r, rank: i + 1 })));
      }
      return out;
    },
    all() {
      const out: Moveset[] = [];
      for (const group of groups.values()) {
        out.push(...ranked(group).map((r, i) => ({ ...r, rank: i + 1 })));
      }
      return out;
    },
    complements(cluster) {
      const out: string[] = [];
      for (const group of groups.values()) {
        if (group.cluster === cluster) out.push(group.complementKey);
      }
      return out;
    },
    stageRow(cluster, complementKey, key) {
      const group = groups.get(keyOf(cluster, complementKey));
      if (group === undefined) return;
      group.rows = group.rows.map((r) => ({ ...r, staged: r.key === key }));
    },
    seal(live) {
      const liveOf = (group: Group): boolean =>
        typeof live === 'string'
          ? group.complementKey === live
          : live.get(group.cluster) === group.complementKey;
      for (const group of groups.values()) {
        const rows = ranked(group);
        const leader = rows[0];
        if (leader === undefined) continue;
        // A ROW WHOSE COMPLEMENT MOVED ON IS STALE, NOT WRONG. It was a real
        // bracket of a real plan; what changed is the QUESTION it answers, so
        // the numbers stay exactly as they were proved and the row says which
        // complement proved them (Law E).
        const complement = liveOf(group) ? 'live' : 'stale';
        group.rows = rows.map((row, i) => ({
          ...row,
          complement,
          rank: i + 1,
          dominance:
            i === 0
              ? ({ kind: 'leader' } as DominanceCondition)
              : dominanceOf(row, leader, group.because.get(row.key) ?? null),
        }));
      }
    },
    get size() {
      let total = 0;
      for (const group of groups.values()) total += group.rows.length;
      return total;
    },
  };
}

/**
 * `max over retained rivals of (rᵢ.hi − leader.lo)` — the quantity
 * `EmitRecord.slack` was always documented as carrying, computable for the
 * first time because the reservoir is the rival set `rootSlack` never had
 * (04 §5.2 #12). NOT the leader's own bound gap, which is what the field
 * degraded to for want of a rival.
 */
export function slackFrom(rows: ReadonlyArray<Moveset>): number {
  if (rows.length <= 1) return 0;
  const leader = rows[0] as Moveset;
  let slack = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < rows.length; i++) slack = Math.max(slack, (rows[i] as Moveset).hi - leader.lo);
  return slack;
}
