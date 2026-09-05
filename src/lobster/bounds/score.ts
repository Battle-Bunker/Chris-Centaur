/**
 * ScoreBounds construction and the laws that make a bound bank safe to mix.
 *
 * Five laws live here. Three of them are enforced by the TYPE the operation
 * returns — a caller cannot read the answer without first narrowing away the
 * refusal — and the other two by construction:
 *
 *  1. EACH BOUND IS ITS OWN GAME. `backupMax`/`backupMin` compute `worst` and
 *     `best` independently over the children. There is no code path that takes
 *     one child's pair wholesale, because no function here accepts a child and
 *     returns it: they accept an array and build a new pair.
 *  2. BASIS IDENTITY. `dominates` and `compare` return a union whose failure
 *     arm is `comparable: false`. Comparing bounds with different assumption
 *     sets is a typed refusal, not a `false` — an aggressive narrowing must be
 *     impossible to mistake for a proof.
 *  3. DISCHARGE. `exact` is computed, never passed in: exact ⟺ the ledger is
 *     empty AND the assumptions are empty. `makeScoreBounds` additionally
 *     refuses to mint a bound that claims both and is not a point, because
 *     that combination is the shape of the one bug class that matters.
 *  4. EVERY MIN-SIDE RESTRICTION IS DECLARED. `withNarrowing` is the only way
 *     to record one, and it forces `exact` to false and widens the basis.
 *     Max-side caps (how many of OUR candidates we tried) need no declaration:
 *     they only lower an achievable floor.
 *  5. worst ≤ best, ALWAYS. An inversion is the fatal bug class the soundness
 *     harness hunts, so it throws a distinguishable error rather than
 *     clamping — a clamped floor is a silent lie, and this file exists to make
 *     silent lies impossible.
 */

import type { Assumption, LedgerEntry, ScoreBounds } from "../contracts";

/** The lattice bottom. A dead subject's value in the `worst` coordinate. */
export const DEAD = Number.NEGATIVE_INFINITY;

/** Slack allowed for float drift before an inversion is called a bug. */
export const BOUND_EPSILON = 1e-9;

/**
 * A bound was asked to exist with `worst > best`. Never caught to continue
 * with a clamped value — the floor a caller would then publish is not one it
 * can defend. B3's kernel may catch it to refuse an emission and count it.
 */
export class BoundsInversionError extends Error {
  readonly code = "bounds_inversion" as const;
  constructor(
    readonly worst: number,
    readonly best: number,
    readonly note: string,
  ) {
    super(`inverted ScoreBounds [${worst}, ${best}]: ${note}`);
    this.name = "BoundsInversionError";
  }
}

// ---------------------------------------------------------------- the basis

/** A canonical, order-free identity for one assumption. */
export function assumptionKey(a: Assumption): string {
  switch (a.kind) {
    case "reference-action":
      return `ref:${a.unitId}:${a.to}`;
    case "operator-pin":
      return `pin:${a.unitId}:${a.to}`;
    case "narrowing":
      return `narrow:${a.unitId}:${a.note}`;
    case "posture":
      return `posture:${a.posture}`;
  }
}

/**
 * The BASIS of a bound: the canonical key of its assumption set. Two bounds
 * are comparable exactly when their basis keys are equal.
 */
export type BasisKey = string;

export function basisKeyOf(assumptions: ReadonlyArray<Assumption>): BasisKey {
  return assumptions.map(assumptionKey).sort().join("|");
}

/**
 * NORMALISATION IS IDEMPOTENT, AND THAT IS WORTH CACHING.
 *
 * `makeScoreBounds` normalises its assumptions and its ledger on every call,
 * and it is called 157 240 times on `mixed 20 1 --nodes` — with the SAME
 * `basis` array object every time (the bank's basis is fixed for the whole
 * decision) and with a ledger `ledgerOf` has already normalised. Both are
 * therefore functions of an array object that has been seen before.
 *
 * The caches below are `WeakMap`s from the input array to its normalised
 * form, and every output is registered as its own normal form so
 * re-normalising a normalised array is a lookup. Nothing about the RESULT
 * changes — same dedup, same order, same contents — so a bound's identity is
 * untouched; only the recomputation goes away. Sound because both arrays are
 * `ReadonlyArray` values that nothing in this layer mutates after handing
 * them over.
 */
const assumptionNorms = new WeakMap<object, ReadonlyArray<Assumption>>();
const ledgerNorms = new WeakMap<object, ReadonlyArray<LedgerEntry>>();

/** Deduplicated, canonically ordered — so the basis key is stable. */
export function normalizeAssumptions(
  assumptions: ReadonlyArray<Assumption>,
): ReadonlyArray<Assumption> {
  const cached = assumptionNorms.get(assumptions as object);
  if (cached !== undefined) return cached;
  const seen = new Map<string, Assumption>();
  for (const a of assumptions) {
    const k = assumptionKey(a);
    if (!seen.has(k)) seen.set(k, a);
  }
  const out = [...seen.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map((e) => e[1]);
  assumptionNorms.set(assumptions as object, out);
  assumptionNorms.set(out as object, out);
  return out;
}

const NO_ASSUMPTIONS: ReadonlyArray<Assumption> = [];

/**
 * THE BASIS UNION'S COMMON SHAPE, WITHOUT THE COPY — the same argument
 * `unionLedgers` makes below, applied to the other half of a bound's identity.
 *
 * Every branch of one price carries THE SAME basis array object (the bank's
 * `input.basis`, passed through `makeScoreBounds` unchanged), so a backup over
 * n children concatenated n copies of one array and re-normalised the result
 * on every node of the ladder. Handing the one distinct group to
 * `normalizeAssumptions` is the same answer — dedup and order are idempotent,
 * and a union with the empty set is the set — and it hits the normal-form
 * memo instead of rebuilding. Two or more distinct groups take the old path.
 */
function unionOfAssumptionGroups(
  groups: ReadonlyArray<ReadonlyArray<Assumption>>,
): ReadonlyArray<Assumption> {
  let only: ReadonlyArray<Assumption> | null = null;
  let distinct = 0;
  for (const g of groups) {
    if (g.length === 0) continue;
    if (only === g) continue;
    if (only !== null) {
      distinct = 2;
      break;
    }
    only = g;
    distinct = 1;
  }
  if (distinct === 0) return NO_ASSUMPTIONS;
  if (distinct === 1) return normalizeAssumptions(only as ReadonlyArray<Assumption>);
  const all: Assumption[] = [];
  for (const g of groups) all.push(...g);
  return normalizeAssumptions(all);
}

export function unionAssumptions(
  ...groups: ReadonlyArray<ReadonlyArray<Assumption>>
): ReadonlyArray<Assumption> {
  return unionOfAssumptionGroups(groups);
}

/** The union of every child's basis — `unionAssumptions` without the map and
 *  the spread, on a path that runs once per backup node. */
function unionChildAssumptions(children: ReadonlyArray<ScoreBounds>): ReadonlyArray<Assumption> {
  let only: ReadonlyArray<Assumption> | null = null;
  let distinct = 0;
  for (const c of children) {
    const g = c.assumptions;
    if (g.length === 0) continue;
    if (only === g) continue;
    if (only !== null) {
      distinct = 2;
      break;
    }
    only = g;
    distinct = 1;
  }
  if (distinct === 0) return NO_ASSUMPTIONS;
  if (distinct === 1) return normalizeAssumptions(only as ReadonlyArray<Assumption>);
  const all: Assumption[] = [];
  for (const c of children) all.push(...c.assumptions);
  return normalizeAssumptions(all);
}

// --------------------------------------------------------------- the ledger

/**
 * ONE KEY PER ENTRY OBJECT. A ledger entry is an immutable value the
 * translation (`ledger.ts`) builds once per settlement and then hands to every
 * bound taken off that settlement, so the same object is keyed again on every
 * normalisation it takes part in — measured at roughly a million key builds on
 * `mixed 20 1 --nodes`. A `WeakMap` from the entry, so it dies with it.
 */
const entryKeys = new WeakMap<object, string>();

export function ledgerKey(e: LedgerEntry): string {
  // The translation mints its entries with the key already on them (see
  // `LedgerEntry.canonicalKey`): the backup's ledger merge asks for a key once
  // per entry per union, and this was measured at 2.8% of the kernel's own
  // decision time as pure ephemeron traffic. Same string either way.
  const own = e.canonicalKey;
  if (own !== undefined) return own;
  const hit = entryKeys.get(e as object);
  if (hit !== undefined) return hit;
  const made = `${e.unitId}:${e.cell}:${e.subStep}:${e.polarity}`;
  entryKeys.set(e as object, made);
  return made;
}

export function normalizeLedger(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<LedgerEntry> {
  // Ledger normalisation is ~9% of a decision's self time (measured), and it
  // runs on every branch of every price. A single entry is already
  // deduplicated and already ordered, and that is the common case; above it,
  // sorting the KEYS costs one array rather than an array of pairs plus a map.
  // The order is unchanged — it is part of a bound's identity.
  if (entries.length <= 1) return entries;
  const cached = ledgerNorms.get(entries as object);
  if (cached !== undefined) return cached;
  const seen = new Map<string, LedgerEntry>();
  for (const e of entries) {
    const k = ledgerKey(e);
    if (!seen.has(k)) seen.set(k, e);
  }
  const out: LedgerEntry[] =
    seen.size === 1 ? [...seen.values()] : new Array<LedgerEntry>(seen.size);
  if (seen.size !== 1) {
    const keys = [...seen.keys()].sort();
    for (let i = 0; i < keys.length; i++) out[i] = seen.get(keys[i] as string) as LedgerEntry;
  }
  ledgerNorms.set(entries as object, out);
  ledgerNorms.set(out as object, out);
  return out;
}

const NO_LEDGER: ReadonlyArray<LedgerEntry> = [];

export function unionLedgers(
  ...groups: ReadonlyArray<ReadonlyArray<LedgerEntry>>
): ReadonlyArray<LedgerEntry> {
  // THE BACKUP'S COMMON SHAPE, WITHOUT THE COPY. A max/min backup unions the
  // ledger of the child that justified the floor with the ledger of the child
  // that justified the ceiling, and those are USUALLY the same child or one of
  // them is empty. Concatenating and re-normalising then rebuilds, key by key,
  // an array that already exists in its normal form — and `normalizeLedger`
  // memoises normal forms, so handing it the one distinct group is both the
  // same answer (dedup and order are idempotent; a union with the empty set is
  // the set) and a lookup. Two or more distinct groups take the old path.
  let only: ReadonlyArray<LedgerEntry> | null = null;
  let distinct = 0;
  for (const g of groups) {
    if (g.length === 0) continue;
    if (only === g) continue;
    if (only !== null) {
      distinct = 2;
      break;
    }
    only = g;
    distinct = 1;
  }
  if (distinct === 0) return NO_LEDGER;
  if (distinct === 1) return normalizeLedger(only as ReadonlyArray<LedgerEntry>);
  // TWO NORMAL FORMS UNION BY MERGING, NOT BY SORTING.
  //
  // A normalised ledger is deduplicated and ascending in `ledgerKey`, and the
  // groups a backup unions are exactly that — they came off child bounds, and
  // `makeScoreBounds` normalises everything it stores. Concatenating them and
  // re-normalising then paid for a `Map` of every entry and a sort of every
  // key to rebuild an order both inputs already had: 26 718 rebuilds over
  // 443 986 entries on `mixed 20 1 --nodes`.
  //
  // The merge below is the same answer entry for entry. Ascending order is
  // what the sort produced; and on a duplicate key it keeps the entry from
  // the EARLIER group, which is what `Map.set`-if-absent over the
  // concatenation kept. Groups that are not in normal form (a caller handing
  // over a raw array) take the old path unchanged.
  let merged: ReadonlyArray<LedgerEntry> | null = null;
  for (const g of groups) {
    if (g.length === 0) continue;
    if (!isNormalForm(g)) {
      merged = null;
      break;
    }
    merged = merged === null ? g : mergeNormalForms(merged, g);
  }
  if (merged !== null) return merged;
  const all: LedgerEntry[] = [];
  for (const g of groups) all.push(...g);
  return normalizeLedger(all);
}

/** Whether this array IS its own normal form — trivially so below two
 *  entries, and otherwise because `normalizeLedger` minted it. */
function isNormalForm(g: ReadonlyArray<LedgerEntry>): boolean {
  return g.length <= 1 || ledgerNorms.get(g as object) === g;
}

/** Two ascending, deduplicated ledgers into one — earlier group wins a tie. */
function mergeNormalForms(
  a: ReadonlyArray<LedgerEntry>,
  b: ReadonlyArray<LedgerEntry>,
): ReadonlyArray<LedgerEntry> {
  const out: LedgerEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ea = a[i] as LedgerEntry;
    const eb = b[j] as LedgerEntry;
    const ka = ledgerKey(ea);
    const kb = ledgerKey(eb);
    if (ka === kb) {
      out.push(ea);
      i++;
      j++;
    } else if (ka < kb) {
      out.push(ea);
      i++;
    } else {
      out.push(eb);
      j++;
    }
  }
  while (i < a.length) out.push(a[i++] as LedgerEntry);
  while (j < b.length) out.push(b[j++] as LedgerEntry);
  ledgerNorms.set(out as object, out);
  return out;
}

// --------------------------------------------------------------- the bounds

export interface BoundsInput {
  readonly worst: number;
  readonly best: number;
  readonly ledger?: ReadonlyArray<LedgerEntry>;
  readonly assumptions?: ReadonlyArray<Assumption>;
  /** Free text for the inversion error only; never load-bearing. */
  readonly note?: string;
}

/**
 * THE constructor. `exact` is derived, never supplied (law 3), and an
 * inverted or dishonestly-exact pair throws (law 5).
 */
export function makeScoreBounds(input: BoundsInput): ScoreBounds {
  const ledger = normalizeLedger(input.ledger ?? []);
  const assumptions = normalizeAssumptions(input.assumptions ?? []);
  const { worst, best } = input;
  if (best < worst - BOUND_EPSILON) {
    throw new BoundsInversionError(worst, best, input.note ?? "no provenance recorded");
  }
  // Float drift inside epsilon collapses to a point rather than inverting.
  const hi = best < worst ? worst : best;
  const exact = ledger.length === 0 && assumptions.length === 0;
  if (exact && hi - worst > BOUND_EPSILON) {
    throw new BoundsInversionError(
      worst,
      hi,
      `${input.note ?? "discharge"}: empty ledger and empty assumptions must mean a point bound — ` +
        "a gap with nothing to blame it on is an unrecorded narrowing",
    );
  }
  return { worst, best: hi, ledger, assumptions, exact };
}

/** A value nothing can move: the discharged case. */
export function pointBounds(value: number): ScoreBounds {
  return makeScoreBounds({ worst: value, best: value });
}

/**
 * Knowing nothing at all, honestly. It carries a narrowing rather than an
 * empty basis, because an empty basis with a gap would break the discharge
 * theorem in the one direction that matters: "nothing to blame" must mean
 * "nothing left to learn".
 */
export const UNKNOWN_BOUNDS: ScoreBounds = makeScoreBounds({
  worst: DEAD,
  best: Number.POSITIVE_INFINITY,
  assumptions: [{ kind: "narrowing", unitId: -1, note: "no analysis performed" }],
  note: "UNKNOWN_BOUNDS",
});

/** The discharge theorem, as a predicate. */
export function isDischarged(b: ScoreBounds): boolean {
  return b.ledger.length === 0 && b.assumptions.length === 0;
}

export function widthOf(b: ScoreBounds): number {
  return b.best - b.worst;
}

// ------------------------------------------------------------------- backup

/**
 * WHICH child justifies an endpoint. Ledger citation is per ENDPOINT, not per
 * node: an entry only belongs on the result if it explains a gap the result
 * still has. Among children that tie on the endpoint, the one with the
 * shortest ledger is the tighter justification and is equally sound.
 *
 * Assumptions do NOT get this treatment. A ledger entry says "the truth is
 * inside this interval, and here is what widened it"; an assumption says "the
 * interval itself is conditional". A conditional child contaminates a min or
 * a max whether or not it set an endpoint, so the basis is a union over ALL
 * children — which is also what keeps `withNarrowing` from being bypassable.
 */
function justifier(
  children: ReadonlyArray<ScoreBounds>,
  pick: (b: ScoreBounds) => number,
  value: number,
): ScoreBounds {
  let best: ScoreBounds | null = null;
  for (const c of children) {
    if (pick(c) !== value) continue;
    if (best === null || c.ledger.length < best.ledger.length) best = c;
  }
  return best ?? (children[0] as ScoreBounds);
}

/**
 * MAX-node backup: {max worst, max best}. The child with the best floor and
 * the child with the best ceiling need not be the same child, and this
 * function is structurally incapable of assuming they are.
 */
export function backupMax(children: ReadonlyArray<ScoreBounds>, note = "backupMax"): ScoreBounds {
  if (children.length === 0) throw new Error("backupMax over no children");
  let worst = DEAD;
  let best = DEAD;
  for (const c of children) {
    if (c.worst > worst) worst = c.worst;
    if (c.best > best) best = c.best;
  }
  return makeScoreBounds({
    worst,
    best,
    ledger: unionLedgers(
      justifier(children, (b) => b.worst, worst).ledger,
      justifier(children, (b) => b.best, best).ledger,
    ),
    assumptions: unionChildAssumptions(children),
    note,
  });
}

/** MIN-node backup: {min worst, min best} — the dual, same discipline. */
export function backupMin(children: ReadonlyArray<ScoreBounds>, note = "backupMin"): ScoreBounds {
  if (children.length === 0) throw new Error("backupMin over no children");
  let worst = Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const c of children) {
    if (c.worst < worst) worst = c.worst;
    if (c.best < best) best = c.best;
  }
  return makeScoreBounds({
    worst,
    best,
    ledger: unionLedgers(
      justifier(children, (b) => b.worst, worst).ledger,
      justifier(children, (b) => b.best, best).ledger,
    ),
    assumptions: unionChildAssumptions(children),
    note,
  });
}

/**
 * Two INDEPENDENT sound statements about the SAME quantity, joined into the
 * tightest one: floor rises to the better floor, ceiling falls to the better
 * ceiling. This is the bank's `max over members` / `min over branches`.
 *
 * Same basis required — joining a conditional floor with an unconditional one
 * and reporting the result as unconditional is exactly the laundering basis
 * identity exists to stop. The caller that genuinely wants the union must
 * widen both sides first (`withNarrowing`).
 */
export type TightenResult =
  | { readonly ok: true; readonly bounds: ScoreBounds }
  | {
      readonly ok: false;
      readonly refusal: "basis_mismatch";
      readonly left: BasisKey;
      readonly right: BasisKey;
    };

export function tighten(a: ScoreBounds, b: ScoreBounds): TightenResult {
  const left = basisKeyOf(a.assumptions);
  const right = basisKeyOf(b.assumptions);
  if (left !== right) return { ok: false, refusal: "basis_mismatch", left, right };
  const worst = Math.max(a.worst, b.worst);
  const best = Math.min(a.best, b.best);
  return {
    ok: true,
    bounds: makeScoreBounds({
      worst,
      best,
      // Per-endpoint citation again: a member that lost both endpoints
      // explains nothing about the surviving gap, and citing it anyway would
      // suppress a discharge the tighter member had already proved.
      ledger: unionLedgers(
        justifier([a, b], (x) => x.worst, worst).ledger,
        justifier([a, b], (x) => x.best, best).ledger,
      ),
      assumptions: a.assumptions,
      note: "tighten",
    }),
  };
}

// ---------------------------------------------------------------- comparison

export type BasisRefusal = {
  readonly comparable: false;
  readonly refusal: "basis_mismatch";
  readonly left: BasisKey;
  readonly right: BasisKey;
};

export type DominanceVerdict = { readonly comparable: true; readonly dominated: boolean } | BasisRefusal;

/**
 * Is `candidate` safe to DISCARD in favour of `by`? Only when
 * `hi(candidate) ≤ lo(by)` under the same basis. Sound given true ∈ [lo, hi]
 * and contraction-only refinement; the cross-branch rectangular relaxation is
 * never optimistic, it only costs precision.
 */
export function dominates(candidate: ScoreBounds, by: ScoreBounds): DominanceVerdict {
  const left = basisKeyOf(candidate.assumptions);
  const right = basisKeyOf(by.assumptions);
  if (left !== right) return { comparable: false, refusal: "basis_mismatch", left, right };
  return { comparable: true, dominated: candidate.best <= by.worst };
}

export type FloorComparison =
  | { readonly comparable: true; readonly order: -1 | 0 | 1 }
  | BasisRefusal;

/** Order two bounds by their PROVED FLOOR, and only by that. */
export function compareFloors(a: ScoreBounds, b: ScoreBounds): FloorComparison {
  const left = basisKeyOf(a.assumptions);
  const right = basisKeyOf(b.assumptions);
  if (left !== right) return { comparable: false, refusal: "basis_mismatch", left, right };
  return { comparable: true, order: a.worst > b.worst ? 1 : a.worst < b.worst ? -1 : 0 };
}

// -------------------------------------------------------- declared narrowing

/**
 * Declare a MIN-SIDE restriction: the search looked at only some of what the
 * adversary could do and still let it move the FLOOR. The true worst may live
 * in the discarded options, so the bound becomes conditional on a named
 * assumption and stops being exact.
 *
 * A restriction on OUR OWN options never comes through here. Restricting the
 * max side only lowers an achievable floor, which is still a floor.
 */
export function withNarrowing(b: ScoreBounds, narrowing: Assumption): ScoreBounds {
  return makeScoreBounds({
    worst: b.worst,
    best: b.best,
    ledger: b.ledger,
    assumptions: unionAssumptions(b.assumptions, [narrowing]),
    note: "withNarrowing",
  });
}

/** Put a whole assumption set onto a bound — pins, postures, reference actions. */
export function onBasis(b: ScoreBounds, assumptions: ReadonlyArray<Assumption>): ScoreBounds {
  if (assumptions.length === 0) return b;
  return makeScoreBounds({
    worst: b.worst,
    best: b.best,
    ledger: b.ledger,
    assumptions: unionAssumptions(b.assumptions, assumptions),
    note: "onBasis",
  });
}
