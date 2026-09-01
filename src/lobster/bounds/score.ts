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
 * THE SAME SLACK, PROPORTIONAL — and why an absolute one was not enough.
 *
 * `BOUND_EPSILON` alone is an absolute quantity, and the bank's floors and
 * ceilings are not: they are sums over resolutions whose magnitude tracks the
 * material on the board. On a queen board a bracket sits at 150–250 lat and is
 * reached by chains ten times longer than any other board's, so a floor and a
 * ceiling that agree to eleven significant figures still differ by 2e-2
 * ABSOLUTE — twenty million epsilons — and the constructor refused them.
 *
 * Measured, not supposed. Batch `20260831-batch2` threw three decision errors
 * across 2,472 games, all three the same refusal and all three on
 * `snake5-queen`:
 *
 *     [149.7698, 149.7502]  1.3e-4 relative
 *     [ 60.0150,  60.0000]  2.5e-4 relative
 *     [251.3184, 251.2998]  7.4e-5 relative
 *
 * The B0 floor and the B3 ceiling are two accumulation paths over the SAME
 * quantity — a max over independent lower bounds and a min over independent
 * upper bounds, summed in different orders over different resolution sets — so
 * their rounding diverges by construction. A disagreement three to four orders
 * of magnitude below the quantity being compared is that divergence and
 * nothing else; there is no configuration of a sound bank in which it is
 * evidence of an unsound member.
 *
 * WHY 1e-3, AND WHY THAT IS STILL A NARROW GATE. It must sit above the worst
 * observed rounding (2.5e-4) with headroom, and below anything a real bug
 * could produce. The smallest quantity the bank can genuinely be wrong about
 * is one unit's material weight, and the lightest unit on these boards is 1 lat
 * against brackets of 60–250 — 0.4% to 1.7%, four to seventeen times this
 * tolerance. So the two populations are separated by better than half an order
 * of magnitude, and the gate closes on the bug class without closing on the
 * arithmetic.
 *
 * AND THE REPAIR IS NEVER A LIE. A sub-tolerance inversion is not clamped to
 * one endpoint — that would assert a floor the evidence does not support.
 * Both endpoints move to their midpoint, so the floor only ever FALLS and the
 * ceiling only ever RISES: the published bracket is strictly weaker than
 * either input, which is the one direction that cannot turn a rounding error
 * into a claim. Above the tolerance it still throws, loudly, as law 5 says.
 */
export const BOUND_RELATIVE_EPSILON = 1e-3;

/**
 * The slack this pair of endpoints is allowed, absolute floor included.
 *
 * Scaled by the larger magnitude rather than by the gap, so the tolerance is a
 * property of WHERE ON THE NUMBER LINE the comparison happens and not of how
 * badly it failed. At zero the relative term vanishes and `BOUND_EPSILON` is
 * what binds, which is the behaviour every existing caller was written
 * against.
 */
export function boundSlack(worst: number, best: number): number {
  const scale = Math.max(Math.abs(worst), Math.abs(best));
  if (!Number.isFinite(scale)) return BOUND_EPSILON;
  return BOUND_EPSILON + scale * BOUND_RELATIVE_EPSILON;
}

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

/**
 * ── THE CANONICAL-ARRAY REGISTER, AND WHY IT IS SOUND ──────────────────────
 *
 * `normalizeLedger` and `normalizeAssumptions` are idempotent by construction,
 * and they are called on their own OUTPUT constantly: `makeScoreBounds`
 * re-normalises the ledger `ledgerOf` just normalised, `withNarrowing` and
 * `onBasis` re-normalise a ledger that came out of `makeScoreBounds`, and a
 * `tighten` chain re-normalises the same basis on every rung. Measured on a
 * one-second decision, `normalizeLedger` was 15.9% of self time on ledgers
 * averaging 19.9 entries — most of it re-deriving an answer this module had
 * already derived.
 *
 * So each function REGISTERS the array it returns, and returns an already
 * registered array untouched. The register is a `WeakSet`, so it holds nothing
 * alive and costs one pointer hash on the fast path.
 *
 * This is sound exactly because both `ReadonlyArray<LedgerEntry>` and
 * `ReadonlyArray<Assumption>` are readonly BY CONTRACT — a bound's ledger and
 * basis are part of its identity and `contracts.ts` types them as such. A
 * registered array that someone mutated would serve a stale canonical form,
 * which is why nothing outside this module may put an array into the register:
 * `register` is private to the file and only ever sees arrays this file built
 * or arrays a caller handed us and we then proved canonical.
 */
const CANONICAL = new WeakSet<object>();

function register<T>(a: ReadonlyArray<T>): ReadonlyArray<T> {
  CANONICAL.add(a as unknown as object);
  return a;
}

/** Basis keys, per canonical assumption array. `dominates`, `compare` and
 * `tighten` each ask for two of these per call, on arrays that are the SAME
 * object branch after branch (the basis does not vary within a price). */
const BASIS_KEYS = new WeakMap<object, BasisKey>();

export function basisKeyOf(assumptions: ReadonlyArray<Assumption>): BasisKey {
  const n = assumptions.length;
  if (n === 0) return "";
  const hit = BASIS_KEYS.get(assumptions as unknown as object);
  if (hit !== undefined) return hit;
  const keys = new Array<string>(n);
  for (let i = 0; i < n; i++) keys[i] = assumptionKey(assumptions[i] as Assumption);
  keys.sort();
  const key = keys.join("|");
  BASIS_KEYS.set(assumptions as unknown as object, key);
  return key;
}

/** Deduplicated, canonically ordered — so the basis key is stable. */
export function normalizeAssumptions(
  assumptions: ReadonlyArray<Assumption>,
): ReadonlyArray<Assumption> {
  const n = assumptions.length;
  if (n === 0) return assumptions;
  if (CANONICAL.has(assumptions as unknown as object)) return assumptions;
  const seen = new Map<string, Assumption>();
  for (const a of assumptions) {
    const k = assumptionKey(a);
    if (!seen.has(k)) seen.set(k, a);
  }
  const keys = [...seen.keys()].sort();
  const out = new Array<Assumption>(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = seen.get(keys[i] as string) as Assumption;
  return register(out);
}

export function unionAssumptions(
  ...groups: ReadonlyArray<ReadonlyArray<Assumption>>
): ReadonlyArray<Assumption> {
  // The basis is identical on every branch of every price (measured: 0.89 µs a
  // branch to re-derive it, 0.004 µs to recognise it), so the union of N copies
  // of one canonical array is that array.
  const only = soleGroup(groups);
  if (only !== null) return only;
  const all: Assumption[] = [];
  for (const g of groups) for (const a of g) all.push(a);
  return normalizeAssumptions(all);
}

/**
 * The one canonical array a union is over, or null when there is real work.
 *
 * Empty groups contribute nothing to a union, and a union over one already
 * canonical group is that group. Both cases are the overwhelming majority here
 * — `justifier` picks the SAME child for both endpoints whenever one child has
 * the tightest ledger on each, and a bound with no assumptions is the default.
 */
function soleGroup<T>(groups: ReadonlyArray<ReadonlyArray<T>>): ReadonlyArray<T> | null {
  let found: ReadonlyArray<T> | null = null;
  for (const g of groups) {
    if (g.length === 0) continue;
    if (found === null) found = g;
    else if (found !== g) return null;
  }
  if (found === null) return EMPTY as ReadonlyArray<T>;
  return CANONICAL.has(found as unknown as object) ? found : null;
}

/** The canonical empty array — registered, so it short-circuits everywhere.
 * Frozen because it is now SHARED by every bound that has nothing to declare. */
const EMPTY: ReadonlyArray<never> = register<never>(Object.freeze([]));

// --------------------------------------------------------------- the ledger

export function ledgerKey(e: LedgerEntry): string {
  return `${e.unitId}:${e.cell}:${e.subStep}:${e.polarity}`;
}

/**
 * Scratch for the normalisation below. Safe to share across calls because
 * `normalizeLedger` takes no callback and calls nothing that can re-enter it —
 * `ledgerKey` is a pure template on four primitives. Kept at module scope so
 * the sort comparator can be a hoisted function rather than a closure
 * allocated per call.
 */
let keyScratch: string[] = [];
const orderScratch: number[] = [];

/** Sort by the STRING key, ties broken by input index.
 *
 * The tie-break is what preserves "keep the FIRST occurrence of a duplicate
 * key", which the `Map`-based version got from insertion order. It is written
 * out rather than left to `Array.prototype.sort`'s stability guarantee because
 * the dedup below is the only thing standing between a repeated entanglement
 * and a doubled ledger, and a guarantee you have to look up is a guarantee
 * somebody eventually gets wrong. */
function byKeyThenIndex(a: number, b: number): number {
  const ka = keyScratch[a] as string;
  const kb = keyScratch[b] as string;
  return ka < kb ? -1 : ka > kb ? 1 : a - b;
}

export function normalizeLedger(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<LedgerEntry> {
  // Ledger normalisation was ~9% of a decision's self time when it was written
  // and 15.9% after the evaluator shrank, and it runs on every branch of every
  // price. A single entry is already deduplicated and already ordered, and an
  // array this module already canonicalised is too — see the register above,
  // which is where nearly all of the calls now stop. The order is unchanged:
  // it is part of a bound's identity, and it is the STRING order (a numeric
  // one reorders 300 of 300 sampled ledgers).
  const n = entries.length;
  if (n <= 1) return entries;
  if (CANONICAL.has(entries as unknown as object)) return entries;

  if (keyScratch.length < n) keyScratch = new Array<string>(n);
  const keys = keyScratch;
  for (let i = 0; i < n; i++) keys[i] = ledgerKey(entries[i] as LedgerEntry);

  orderScratch.length = n;
  for (let i = 0; i < n; i++) orderScratch[i] = i;
  orderScratch.sort(byKeyThenIndex);

  // One pass: the first index of each run of equal keys, in key order.
  let distinct = 1;
  for (let i = 1; i < n; i++) {
    if (keys[orderScratch[i - 1] as number] !== keys[orderScratch[i] as number]) distinct++;
  }
  const out: LedgerEntry[] = new Array<LedgerEntry>(distinct);
  out[0] = entries[orderScratch[0] as number] as LedgerEntry;
  let w = 1;
  for (let i = 1; i < n; i++) {
    if (keys[orderScratch[i - 1] as number] === keys[orderScratch[i] as number]) continue;
    out[w++] = entries[orderScratch[i] as number] as LedgerEntry;
  }
  return register(out);
}

export function unionLedgers(
  ...groups: ReadonlyArray<ReadonlyArray<LedgerEntry>>
): ReadonlyArray<LedgerEntry> {
  // `justifier` picks the same child for both endpoints whenever one child has
  // the tightest ledger on each, which is most of the time — and a union of one
  // canonical ledger with itself, or with nothing, is that ledger.
  const only = soleGroup(groups);
  if (only !== null) return only;
  const all: LedgerEntry[] = [];
  for (const g of groups) for (const e of g) all.push(e);
  return normalizeLedger(all);
}

// --------------------------------------------------------------- the bounds

export interface BoundsInput {
  readonly worst: number;
  readonly best: number;
  readonly ledger?: ReadonlyArray<LedgerEntry>;
  readonly assumptions?: ReadonlyArray<Assumption>;
  /**
   * Free text for the inversion error only; never load-bearing.
   *
   * A THUNK is accepted, and the hot callers pass one: the bank's per-branch
   * provenance note interpolates a `planKey` — the longest string in the
   * system — on every branch of every price, to build a string that is read
   * only when a bound inverts, which is the bug that must never happen. The
   * thunk is called exactly where the text is used and nowhere else.
   */
  readonly note?: string | (() => string);
}

/** Resolve a note only where one is actually being printed. */
function noteText(note: string | (() => string) | undefined, fallback: string): string {
  if (note === undefined) return fallback;
  return typeof note === "string" ? note : note();
}

/**
 * THE constructor. `exact` is derived, never supplied (law 3), and an
 * inverted or dishonestly-exact pair throws (law 5).
 */
export function makeScoreBounds(input: BoundsInput): ScoreBounds {
  const ledger = normalizeLedger(input.ledger ?? []);
  const assumptions = normalizeAssumptions(input.assumptions ?? []);
  let { worst } = input;
  const { best } = input;
  if (best < worst - boundSlack(worst, best)) {
    throw new BoundsInversionError(worst, best, noteText(input.note, "no provenance recorded"));
  }
  // Float drift inside the slack collapses to the MIDPOINT rather than
  // inverting: the floor falls, the ceiling rises, and the pair that comes out
  // is weaker than either input rather than picking a winner. See
  // `BOUND_RELATIVE_EPSILON` for the measurement that set the slack.
  let hi = best;
  if (best < worst) {
    const mid = worst + (best - worst) / 2;
    worst = mid;
    hi = mid;
  }
  const exact = ledger.length === 0 && assumptions.length === 0;
  // The DISCHARGE check keeps the absolute epsilon, deliberately. The slack
  // above prices a disagreement between two independent accumulations of one
  // quantity; this one asks whether a bound that claims to have nothing left
  // to learn is a POINT, and a point is a point at every magnitude. Scaling it
  // would let a bound at 1e3 carry a 1-lat gap with nothing to blame it on,
  // which is the laundered narrowing law 3 exists to refuse.
  if (exact && hi - worst > BOUND_EPSILON) {
    throw new BoundsInversionError(
      worst,
      hi,
      `${noteText(input.note, "discharge")}: empty ledger and empty assumptions must mean a point bound — ` +
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
    assumptions: unionAssumptions(...children.map((c) => c.assumptions)),
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
    assumptions: unionAssumptions(...children.map((c) => c.assumptions)),
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
