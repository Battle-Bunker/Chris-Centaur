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
 *     empty AND no CONDITIONING assumption is present. Framing assumptions
 *     (`posture`, `cohort`) name which question was asked and leave
 *     nothing further to learn about the world, so they gate comparability and
 *     not discharge — see `assumptionClassOf`. `makeScoreBounds` additionally
 *     refuses to mint a bound that claims discharge and is not a point, because
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
    case "cohort":
      // THE ID ONLY, NEVER THE FEATURE LIST. The id is the objective's stable
      // name; `features` is the registry's current account of what that
      // objective computes, and it rides on the assumption so a reader of an
      // emitted record does not have to hold the registry to interpret it.
      // Keying on both would make a registry correction re-base every bound
      // that named the cohort — a comparability break with no semantic content
      // — and would let two rows claiming the same objective refuse each other
      // over a sort order. One cohort, one basis.
      return `cohort:${a.id}`;
  }
}

/**
 * TWO KINDS OF ASSUMPTION, AND ONLY ONE OF THEM DEFEATS DISCHARGE.
 *
 * `basisKeyOf` was doing double duty: deciding COMPARABILITY and, through
 * `assumptions.length === 0`, deciding DISCHARGE. Those are different
 * questions, and conflating them had a consequence in production.
 *
 *  - CONDITIONING assumptions narrow the GAME. `reference-action` fixes a unit
 *    we do not command; `operator-pin` restricts our own options; `narrowing`
 *    declares a min-side restriction the search took. Under any of these,
 *    something is genuinely unknown or genuinely forbidden, so the bound is a
 *    statement about a restricted game and there IS more to learn. They defeat
 *    discharge.
 *  - FRAMING assumptions name the QUESTION. `posture` says which channel
 *    weighting the score was computed under; `cohort` says which feature set
 *    was invoked. Choosing a different objective leaves nothing further to
 *    learn about the WORLD — a fully sighted, fully resolved position is fully
 *    resolved under either framing. They gate comparability (two framings are
 *    not the same statement and must never be mixed) and must NOT defeat
 *    discharge. This is why a cohort could be introduced at all: under the old
 *    predicate a second framing assumption would have made `exact` doubly
 *    unreachable, and the whole cohort design would have been paid for in
 *    permanently un-discharged bounds.
 *
 * THE DEFECT THIS FIXES. `kernel.ts`'s `searchContext` appends
 * `{kind: "posture", ...}` to every context's assumptions, unconditionally, and
 * the bank stamps that basis on every bound it mints. With discharge testing
 * `assumptions.length === 0`, no bound the kernel produced could EVER report
 * `exact` — not even in a fully sighted, fully resolved, un-narrowed position.
 * The contract's own note anticipated this for pins ("a PINNED decision can
 * never report exact"); the posture quietly made it universal.
 *
 * Classification is one explicit total function, here, so nothing downstream
 * has to string-match a kind name.
 */
export type AssumptionClass = "conditioning" | "framing";

export function assumptionClassOf(a: Assumption): AssumptionClass {
  switch (a.kind) {
    case "reference-action":
    case "operator-pin":
    case "narrowing":
      return "conditioning";
    case "posture":
    case "cohort":
      return "framing";
  }
}

export const isConditioning = (a: Assumption): boolean =>
  assumptionClassOf(a) === "conditioning";

export const isFraming = (a: Assumption): boolean => assumptionClassOf(a) === "framing";

/** The conditioning subset — the only assumptions discharge is measured over. */
export function conditioningAssumptions(
  assumptions: ReadonlyArray<Assumption>,
): ReadonlyArray<Assumption> {
  return assumptions.filter(isConditioning);
}

/**
 * The BASIS of a bound: the canonical key of its assumption set. Two bounds
 * are comparable exactly when their basis keys are equal.
 */
export type BasisKey = string;

export function basisKeyOf(assumptions: ReadonlyArray<Assumption>): BasisKey {
  return assumptions.map(assumptionKey).sort().join("|");
}

/** Deduplicated, canonically ordered — so the basis key is stable. */
export function normalizeAssumptions(
  assumptions: ReadonlyArray<Assumption>,
): ReadonlyArray<Assumption> {
  const seen = new Map<string, Assumption>();
  for (const a of assumptions) {
    const k = assumptionKey(a);
    if (!seen.has(k)) seen.set(k, a);
  }
  return [...seen.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((e) => e[1]);
}

export function unionAssumptions(
  ...groups: ReadonlyArray<ReadonlyArray<Assumption>>
): ReadonlyArray<Assumption> {
  const all: Assumption[] = [];
  for (const g of groups) all.push(...g);
  return normalizeAssumptions(all);
}

// --------------------------------------------------------------- the ledger

export function ledgerKey(e: LedgerEntry): string {
  return `${e.unitId}:${e.cell}:${e.subStep}:${e.polarity}`;
}

export function normalizeLedger(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<LedgerEntry> {
  // Ledger normalisation is ~9% of a decision's self time (measured), and it
  // runs on every branch of every price. A single entry is already
  // deduplicated and already ordered, and that is the common case; above it,
  // sorting the KEYS costs one array rather than an array of pairs plus a map.
  // The order is unchanged — it is part of a bound's identity.
  if (entries.length <= 1) return entries;
  const seen = new Map<string, LedgerEntry>();
  for (const e of entries) {
    const k = ledgerKey(e);
    if (!seen.has(k)) seen.set(k, e);
  }
  if (seen.size === 1) return [...seen.values()];
  const keys = [...seen.keys()].sort();
  const out: LedgerEntry[] = new Array<LedgerEntry>(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = seen.get(keys[i] as string) as LedgerEntry;
  return out;
}

export function unionLedgers(
  ...groups: ReadonlyArray<ReadonlyArray<LedgerEntry>>
): ReadonlyArray<LedgerEntry> {
  const all: LedgerEntry[] = [];
  for (const g of groups) all.push(...g);
  return normalizeLedger(all);
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
  // DISCHARGE IS MEASURED OVER CONDITIONING ASSUMPTIONS ONLY. A framing
  // assumption names the question, not a gap in the answer — see
  // `assumptionClassOf`. Comparability still runs over ALL of them
  // (`basisKeyOf` is unchanged), so nothing here launders a mixed comparison.
  const exact = ledger.length === 0 && !assumptions.some(isConditioning);
  if (exact && hi - worst > BOUND_EPSILON) {
    throw new BoundsInversionError(
      worst,
      hi,
      `${input.note ?? "discharge"}: an empty ledger and no conditioning assumption must mean a ` +
        "point bound — a gap with nothing to blame it on is an unrecorded narrowing",
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

/** The discharge theorem, as a predicate. Conditioning assumptions only — a
 * framing assumption is not something left to learn. Same predicate
 * `makeScoreBounds` derives `exact` from, so the two cannot drift. */
export function isDischarged(b: ScoreBounds): boolean {
  return b.ledger.length === 0 && !b.assumptions.some(isConditioning);
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
