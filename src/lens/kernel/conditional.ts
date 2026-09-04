/**
 * THE CONDITIONAL RANKING — inspection and action as ONE object (Law B).
 *
 * > "When selecting a specific unit's candidate move, the cluster's best
 * >  movesets conditional on that move get surfaced — the same ranking that
 * >  would immediately select the actual next staged moveset if that candidate
 * >  were locked by the operator."
 *
 * The second half of that sentence is the whole specification. Inspection and
 * action must not be two code paths, because two code paths disagree, and this
 * one would disagree in front of the operator at the moment they commit.
 *
 * SO THE HEAD IS `conform(ctx ⊕ pin, wirePlan)` — what a lock would ACTUALLY
 * stage — and never `improve`'s best-so-far. `improve`'s best is BETTER, which
 * is exactly why using it would be a lie of the worst kind: the operator reads
 * a number to decide whether to lock, locks, and gets a different picture. The
 * boundary test runs both on every unit and every candidate of a fixture board
 * and asserts the head is the first and, where they differ, is not the second.
 *
 * THE PIN IS BINDING INSIDE A KEY THAT NAMES IT TENTATIVE. That is not a
 * contradiction, it is V1-BUG-4's fix: a speculative context exists to answer
 * "what would this pin cost?", and handing the search a tentative flag made
 * every speculative slice re-search the UNCONSTRAINED problem under a name
 * claiming otherwise — 0 of 289 speculative slices honoured the pin they were
 * named for. The key keeps the `?`; the pin set inside it binds.
 */

import type { Assumption, JointPlan, Pin, SearchContext, SearchCore, UnitId } from '../../lobster/contracts';
import { canonicalPins, parsePinContextKey, pinContextKey } from '../../lobster/kernel';
import { basisOf } from '../../lobster/search/basis';
import { basisKeyOf } from '../../lobster/bounds';
import type {
  ClusterId,
  ClusterView,
  Lock,
  Moveset,
  MovesetMove,
  Posture,
  RankConditionalResult,
  UnitKey,
} from '../types';
import { partitionOf, type FixedUnit } from './partition';
import { unitKeyOf } from './keys';

export interface RankConditionalInput {
  /** The decision's own context — `rankConditional` is a pure function of
   *  `(substrate, basis, locks, cursor)` and never searches on the caller's
   *  thread. It schedules, and returns what is known. */
  readonly ctx: SearchContext;
  readonly search: SearchCore;
  readonly cluster: ClusterId;
  readonly generation: number;
  readonly locks: ReadonlyArray<Lock>;
  /** What is LEFT of `LENS_INSPECTION_MS`. Zero ⇒ a typed refusal, never
   *  silence and never a served row. */
  readonly reserveMs: number;
  /** The plan the WIRE holds. The head is `conform(ctx ⊕ pin, THIS)`, because
   *  that is what a lock splices into. Absent ⇒ derived from the context, which
   *  is what rung 0 does. */
  readonly wirePlan?: JointPlan;
  /** Rows already retained for this cluster, for the first paint. */
  readonly retained?: ReadonlyArray<Moveset>;
  /** Slices this context has spent. The answer's identity: two calls at the
   *  same cursor return byte-identical rows. */
  readonly cursor?: number;
}

/**
 * [CHANGE 2] — the speculative key's committed twin.
 *
 * Today `pickContext` writes into `spec:[…]` and `retarget` obtains
 * `pinContextKey(run.pins)` in `pin:[…]`. Those are different keys BY
 * CONSTRUCTION — the namespace is the first character — so the operator's
 * hover is searched for four slices, the operator commits it, and the kernel
 * starts from an entry with `incumbent: null`. This is the bridge: same pins,
 * committed namespace, `?` markers dropped because a committed pin is not a
 * question.
 *
 * What the PROMOTION carries is the other half, and it lives in the kernel:
 * `incumbent`, `witnesses`, `cursor`, `citedUnits`, `stepCostMs` — and NOT
 * `bounds`/`boundsBasis`, because a floor proved in the old epoch may not gate
 * the new one.
 */
export function promotedContextKey(speculativeKey: string): string {
  const parsed = parsePinContextKey(speculativeKey);
  const body = parsed.tokens.map((t) => (t.endsWith('?') ? t.slice(0, -1) : t)).join(',');
  return `pin:[${body}]`;
}

/** The pins a lock installs: BINDING, whatever the key calls them. */
function pinsFor(ctx: SearchContext, locks: ReadonlyArray<Lock>): Pin[] {
  const committed = canonicalPins(ctx.pins);
  const locked: Pin[] = [];
  for (const lock of locks) {
    const unitId = ctx.sub.unitIdOf(lock.unit);
    if (unitId === undefined) continue;
    locked.push({ unitId, to: lock.to, tentative: false });
  }
  return canonicalPins([...committed.filter((p) => !locked.some((l) => l.unitId === p.unitId)), ...locked]);
}

/** The handle: `pinContextKey([...committed, lock], true)`. The `?` is the
 *  advice layer's grip on this context, and the promotion's input. */
export function speculativeKeyFor(ctx: SearchContext, locks: ReadonlyArray<Lock>): string {
  const committed = canonicalPins(ctx.pins);
  const tentative: Pin[] = [];
  for (const lock of locks) {
    const unitId = ctx.sub.unitIdOf(lock.unit);
    if (unitId === undefined) continue;
    tentative.push({ unitId, to: lock.to, tentative: true });
  }
  return pinContextKey(
    [...committed.filter((p) => !tentative.some((t) => t.unitId === p.unitId)), ...tentative],
    true
  );
}

function postureOf(assumptions: ReadonlyArray<Assumption>): Posture {
  for (const a of assumptions) if (a.kind === 'posture') return a.posture;
  return 'SIGHTED';
}

function movesOf(plan: JointPlan, ctx: SearchContext, members: ReadonlySet<UnitId>): MovesetMove[] {
  return [...plan.entries()]
    .filter(([unitId]) => members.has(unitId))
    .sort((a, b) => a[0] - b[0])
    .map(([unitId, c]) => ({ unit: unitKeyOf(ctx.sub, unitId), to: c.to, path: [...c.path] }));
}

/** Is this destination one the unit's grammar actually offers? A lock on a
 *  cell nothing can reach is not a cheap answer, it is no answer: the search
 *  would drop the pin and we would show a plan that ignores the operator. */
function offered(ctx: SearchContext, unitId: UnitId, to: number): boolean {
  const set = ctx.gen.candidatesFor(ctx.sub, unitId);
  for (const c of set.candidates) if (c.to === to) return true;
  for (const e of set.prunedLedger) if (e.candidate.to === to) return true;
  return false;
}

/**
 * A pure function of `(substrate, basis, locks, cursor)`.
 *
 * Two phases, one call. Phase 1 filters the rows already retained — 0 ms, and
 * marked provisional. Phase 2 conforms under the lock, which is exact and is
 * the same object a commit promotes. When the reserve is spent the answer is a
 * TYPED REFUSAL and never a served row: an inspection that cannot be afforded
 * must say so, because "we did not look" and "there is nothing here" are
 * indistinguishable to a reader and only one of them is true.
 */
export function rankConditional(req: RankConditionalInput): RankConditionalResult {
  const { ctx, search, locks } = req;
  if (!(req.reserveMs > 0)) {
    return {
      ok: false,
      refusal: 'reserve-spent',
      detail: `the inspection reserve is spent: ${req.reserveMs}ms left`,
    };
  }
  const assumptions = ctx.assumptions;
  const basis = basisKeyOf(basisOf(ctx));
  const posture = postureOf(assumptions);
  const references: FixedUnit[] = assumptions
    .filter((a) => a.kind === 'reference-action')
    .map((a) => ({
      unit: unitKeyOf(ctx.sub, (a as { unitId: UnitId }).unitId),
      to: (a as { to: number }).to,
      by: null,
    }));
  const committedPins: FixedUnit[] = canonicalPins(ctx.pins).map((p) => ({
    unit: unitKeyOf(ctx.sub, p.unitId),
    to: p.to,
    by: null,
  }));
  const base = partitionOf({
    sub: ctx.sub,
    asTeam: ctx.asTeam,
    epoch: 0,
    posture,
    basis,
    pins: committedPins,
    committed: [],
    references,
    unreachablePins: [],
  });
  // The cluster id is an ANCHOR — a unit id — so a caller naming a member
  // rather than the anchor is naming the same cluster and is answered.
  const view =
    base.find((c) => c.id === req.cluster) ??
    base.find((c) => c.members.includes(unitKeyOf(ctx.sub, req.cluster)));
  if (view === undefined) {
    return { ok: false, refusal: 'unknown-cluster', detail: `no cluster ${req.cluster} at ${basis}` };
  }
  if (req.generation !== view.generation) {
    return {
      ok: false,
      refusal: 'generation-superseded',
      detail: `cluster ${view.id} is at generation ${view.generation}, asked at ${req.generation}`,
    };
  }

  const locked: FixedUnit[] = locks.map((l) => ({ unit: l.unit, to: l.to, by: null }));
  const after = partitionOf({
    sub: ctx.sub,
    asTeam: ctx.asTeam,
    epoch: 0,
    posture,
    basis,
    pins: [...committedPins, ...locked],
    committed: [],
    references,
    unreachablePins: [],
    previous: base,
  });
  const held = new Set(view.members);
  // LOCKING NARROWS (04 §3, Q2): the locked unit leaves `members` for the
  // `boundedBy` strip, and by T1 that can only narrow or split, never widen.
  const clusterAfter: ClusterView =
    after.find((c) => c.members.some((m) => held.has(m))) ??
    ({ ...view, members: [], generation: view.generation + 1, lineage: [view.id] } as ClusterView);

  const contextKey = speculativeKeyFor(ctx, locks);
  const cursor = req.cursor ?? 0;
  const memberIds = new Set<UnitId>();
  for (const m of view.members) {
    const id = ctx.sub.unitIdOf(m);
    if (id !== undefined) memberIds.add(id);
  }

  const reachable = locks.every((lock) => {
    const unitId = ctx.sub.unitIdOf(lock.unit);
    return unitId !== undefined && offered(ctx, unitId, lock.to);
  });

  const filtered = (req.retained ?? []).filter((row) =>
    row.moves.every((m) => {
      const lock = locks.find((l) => l.unit === m.unit);
      return lock === undefined || lock.to === m.to;
    })
  );

  if (!reachable) {
    // A cell this unit's grammar cannot reach. The honest answer is the first
    // paint or nothing — never a conform that quietly drops the pin and shows
    // the operator a plan that ignores them.
    return {
      ok: true,
      cluster: view.id,
      locks,
      clusterAfter,
      rows: filtered,
      source: filtered.length === 0 ? 'empty' : 'retained-filter',
      cursor,
      provisional: true,
      degraded: false,
      contextKey,
      final: false,
    };
  }

  // PHASE 2 — the head, exactly as a lock would stage it.
  const pinned: SearchContext = { ...ctx, pins: pinsFor(ctx, locks) };
  const wirePlan = req.wirePlan ?? search.conform(ctx, new Map());
  const staged = search.conform(pinned, wirePlan);
  const head: Moveset = {
    cluster: view.id,
    clusterKey: clusterAfter.key,
    generation: view.generation,
    key: movesOf(staged, ctx, memberIds)
      .map((m) => `${ctx.sub.unitIdOf(m.unit) ?? -1}>${m.to}:${m.path.join('.')}`)
      .sort()
      .join('|'),
    rank: 1,
    // THE ROW SHOWS THE WHOLE CLUSTER, the locked member included: the move
    // under the operator's finger is the one they are asking about, and a row
    // that hid it would answer a question they did not ask.
    moves: movesOf(staged, ctx, memberIds),
    basis,
    complementKey: [...staged.entries()]
      .filter(([unitId]) => !memberIds.has(unitId))
      .sort((a, b) => a[0] - b[0])
      .map(([unitId, c]) => `${unitId}>${c.to}:${c.path.join('.')}`)
      .join('|'),
    complement: 'live',
    witness: [...staged.entries()]
      .map(([unitId, c]) => `${unitId}>${c.to}:${c.path.join('.')}`)
      .sort()
      .join('|'),
    lo: 0,
    est: 0,
    hi: 0,
    channel: 'lo',
    exact: false,
    ledgerSize: 0,
    citedUnits: [],
    assumptions,
    vacuity: 'alive',
    seenIn: 1,
    rung: 'conform',
    at: 0,
    tie: 0,
    staged: true,
    dominance: { kind: 'leader' },
    depth: HORIZON_1,
  };
  // The retained rows follow the head, minus the one that IS the head: two
  // rows for one assignment is two answers to one question.
  const rest = filtered.filter((row) => row.key !== head.key).map((row, i) => ({ ...row, rank: i + 2 }));
  return {
    ok: true,
    cluster: view.id,
    locks,
    clusterAfter,
    rows: [head, ...rest],
    source: 'speculative-context',
    cursor,
    provisional: false,
    degraded: false,
    contextKey,
    final: false,
  };
}

/**
 * The head's own depth column. `deepest === h1`, the line is empty and every
 * delta is zero, which is the truth about a search whose horizon is 1 — F-2's
 * finding, carried as DATA so depth fills fields rather than adding them.
 *
 * The BRACKET is deliberately absent from the head (`lo = est = hi = 0` with
 * `exact: false`): `conform` returns a plan, not a price, and inventing a
 * number for it would be the one thing this whole surface exists to prevent.
 * The row's content is its ASSIGNMENT — what a lock would stage — and the
 * bracket arrives with the next emission that prices it.
 */
const HORIZON_1: Moveset['depth'] = {
  h1: {
    horizon: 1,
    lo: 0,
    est: 0,
    hi: 0,
    exact: false,
    ledgerSize: 0,
    basis: '',
    citedUnits: [] as ReadonlyArray<UnitKey>,
    atMs: 0,
    quanta: 0,
  },
  deepest: {
    horizon: 1,
    lo: 0,
    est: 0,
    hi: 0,
    exact: false,
    ledgerSize: 0,
    basis: '',
    citedUnits: [] as ReadonlyArray<UnitKey>,
    atMs: 0,
    quanta: 0,
  },
  derived: true,
  line: [],
  lineTruncated: false,
  rankAtH1: 1,
  confidence: 'equal',
  terminal: 'none',
  delta: {
    lo: 0,
    hi: 0,
    width: 0,
    rank: 0,
    attribution: { width: 0, terminal: 0, residual: 0 },
    voided: false,
  },
  // `conform` returns a plan, not a price, so no rung has spoken about this
  // row yet — the ceiling ply included.
  ply: null,
};
