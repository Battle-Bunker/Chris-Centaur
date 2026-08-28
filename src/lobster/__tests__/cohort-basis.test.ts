/**
 * S1a — COHORT AS A BASIS, at the bound algebra.
 *
 * A cohort names WHICH OBJECTIVE a number maximises. It is the second framing
 * assumption, structurally identical to `posture`, and everything this file
 * asserts falls out of that one sentence being true rather than approximately
 * true:
 *
 *   COMPARABILITY  two bounds under different cohorts refuse comparison, with
 *                  the same typed refusal a pin already produces. This is not
 *                  a policy the kernel implements — it is what `assumptionKey`
 *                  gaining one case buys, everywhere at once, for free.
 *   DISCHARGE      a cohort does NOT defeat `exact`. Choosing a different
 *                  question leaves nothing further to learn about the world.
 *                  Without S0b's split this would have made `exact` doubly
 *                  unreachable and the whole design would have been paid for
 *                  in permanently un-discharged bounds.
 *   IDENTITY       the key is the ID and not the feature list, so correcting a
 *                  registry row's `features` does not re-base every historical
 *                  bound that named the cohort.
 *
 * The comparability tests are the `score.test.ts` "basis identity is a TYPED
 * REFUSAL" block, cloned onto the new variant — deliberately the same shape, so
 * a reader can see that a cohort is not a special case of anything.
 */

import type { Assumption, LedgerEntry, ScoreBounds } from '../contracts';
import {
  assumptionClassOf,
  assumptionKey,
  basisKeyOf,
  compareFloors,
  conditioningAssumptions,
  dominates,
  isConditioning,
  isDischarged,
  isFraming,
  makeScoreBounds,
  onBasis,
  pointBounds,
  tighten,
} from '../bounds';
import {
  ALL_FEATURE_KEYS,
  BASE_PROFILE,
  CLIFF_MATERIAL_WEIGHT,
  COHORTS,
  DEFAULT_COHORT_ID,
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  TERRITORY_PROFILE,
  MATERIAL_ONLY_PROFILE,
  assertProfileCoherent,
  cohortAssumptionOf,
  cohortRowIn,
  invokedFeaturesOf,
  requireCohortRowIn,
  type CohortRow,
} from '../evaluate/calibration';

const entry = (unitId: number, note = 'x'): LedgerEntry => ({
  unitId,
  cell: 10 + unitId,
  subStep: 1,
  polarity: 'if_present',
  note,
});

const b = (
  worst: number,
  best: number,
  ledger: LedgerEntry[] = [],
  assumptions: Assumption[] = []
): ScoreBounds => makeScoreBounds({ worst, best, ledger, assumptions });

const COHORT_A: Assumption = { kind: 'cohort', id: 'alpha', features: ['material'] };
const COHORT_B: Assumption = { kind: 'cohort', id: 'beta', features: ['material', 'reach'] };
const POSTURE: Assumption = { kind: 'posture', posture: 'SIGHTED' };
const PIN: Assumption = { kind: 'operator-pin', unitId: 1, to: 40 };

// ---------------------------------------------------------------- the key

describe('the cohort key', () => {
  test('is `cohort:${id}`, and distinguishes two cohorts', () => {
    expect(assumptionKey(COHORT_A)).toBe('cohort:alpha');
    expect(assumptionKey(COHORT_B)).toBe('cohort:beta');
    expect(basisKeyOf([COHORT_A])).not.toBe(basisKeyOf([COHORT_B]));
  });

  test('is the ID ALONE — a registry correction does not re-base history', () => {
    // The same objective, described twice, once before someone noticed a
    // feature had been left off the list. These are one basis, because they
    // are one question. Keying on `features` would have made every bound
    // proved before the correction incomparable with every bound proved after
    // it, for no semantic reason whatsoever.
    const stale: Assumption = { kind: 'cohort', id: 'alpha', features: ['material'] };
    const fixed: Assumption = { kind: 'cohort', id: 'alpha', features: ['material', 'room'] };
    expect(assumptionKey(stale)).toBe(assumptionKey(fixed));
    expect(basisKeyOf([stale])).toBe(basisKeyOf([fixed]));
    // A gap needs something in the ledger to blame it on, framing or no
    // framing: S0b widened `exact`, it did not weaken the honesty guard.
    const before = onBasis(b(1, 2, [entry(1)]), [stale]);
    const after = onBasis(b(9, 10, [entry(1)]), [fixed]);
    expect(dominates(before, after)).toEqual({ comparable: true, dominated: true });
  });

  test('a cohort and a posture with the same spelling are different assumptions', () => {
    const c: Assumption = { kind: 'cohort', id: 'SIGHTED', features: [] };
    expect(basisKeyOf([c])).not.toBe(basisKeyOf([POSTURE]));
  });
});

// ------------------------------------------------------ comparability refusal

describe('basis identity across cohorts is a TYPED REFUSAL, not a false', () => {
  test('dominance across two cohorts refuses', () => {
    // The score.test.ts:90 clone. Two bounds differing ONLY in cohort.
    const alpha = onBasis(b(1, 2, [entry(1)]), [COHORT_A]);
    const beta = onBasis(b(9, 10, [entry(1)]), [COHORT_B]);
    const verdict = dominates(alpha, beta);
    expect(verdict.comparable).toBe(false);
    if (!verdict.comparable) expect(verdict.refusal).toBe('basis_mismatch');
    // The numbers WOULD have said "dominated". A cohort flip that lowers the
    // floor is EXPECTED — a different feature set is a different quantity —
    // and this is the answer an untyped comparison would have laundered into
    // a proof that the objective got worse.
    expect(alpha.best <= beta.worst).toBe(true);
  });

  test('dominance within one cohort answers', () => {
    const low = onBasis(b(1, 2, [entry(1)]), [COHORT_A]);
    const high = onBasis(b(9, 10, [entry(1)]), [COHORT_A]);
    expect(dominates(low, high)).toEqual({ comparable: true, dominated: true });
    expect(dominates(high, low)).toEqual({ comparable: true, dominated: false });
  });

  test('floor comparison refuses across cohorts', () => {
    const alpha = onBasis(b(1, 2, [entry(1)]), [COHORT_A]);
    const beta = onBasis(b(1, 2, [entry(1)]), [COHORT_B]);
    expect(compareFloors(alpha, beta).comparable).toBe(false);
  });

  test('tighten refuses across cohorts', () => {
    const out = tighten(
      onBasis(b(1, 9, [entry(1)]), [COHORT_A]),
      onBasis(b(3, 5, [entry(1)]), [COHORT_B])
    );
    expect(out.ok).toBe(false);
  });

  test('a shared posture does not rescue a cohort mismatch', () => {
    // Both framings must agree, not one of them: the basis is the SET.
    const alpha = onBasis(b(1, 2, [entry(1)]), [POSTURE, COHORT_A]);
    const beta = onBasis(b(9, 10, [entry(1)]), [POSTURE, COHORT_B]);
    expect(dominates(alpha, beta).comparable).toBe(false);
    const same = onBasis(b(9, 10, [entry(1)]), [POSTURE, COHORT_A]);
    expect(dominates(alpha, same).comparable).toBe(true);
  });
});

// ------------------------------------------------------------ classification

describe('a cohort is a FRAMING assumption', () => {
  test('classified once, in the one exhaustive switch', () => {
    expect(assumptionClassOf(COHORT_A)).toBe('framing');
    expect(isFraming(COHORT_A)).toBe(true);
    expect(isConditioning(COHORT_A)).toBe(false);
  });

  test('the conditioning subset drops it, and keeps the pin', () => {
    expect(conditioningAssumptions([COHORT_A, POSTURE, PIN])).toEqual([PIN]);
  });

  test('DISCHARGE SURVIVES both framings at once', () => {
    // Extends S0b's test with the second framing assumption. A fully sighted,
    // fully resolved, un-narrowed position is fully resolved under either
    // objective — the cohort says which question was asked, not that the
    // answer is incomplete. Under the pre-S0b predicate this point would have
    // been inexact for TWO reasons instead of one.
    const framed = onBasis(pointBounds(42), [POSTURE, COHORT_A]);
    expect(framed.exact).toBe(true);
    expect(isDischarged(framed)).toBe(true);
    expect(framed.assumptions).toHaveLength(2);
  });

  test('a conditioning assumption still defeats it, cohort present or not', () => {
    expect(onBasis(pointBounds(42), [POSTURE, COHORT_A, PIN]).exact).toBe(false);
    expect(onBasis(pointBounds(42), [PIN]).exact).toBe(false);
  });

  test('a cohort does not license a gap: a non-point is still inexact', () => {
    const gapped = onBasis(b(1, 5, [entry(3)]), [COHORT_A]);
    expect(gapped.exact).toBe(false);
  });
});

// ---------------------------------------------------------------- the table

describe('the cohort registry is a data table', () => {
  test('the table is a catalogue in ascending cost, and the default is territory', () => {
    // Stage 1 shipped ONE row and asserted that as its no-op condition. Stage 2
    // adds `base` beside it, and the no-op condition moves with it: registering
    // a row admits nothing, so what keeps a flag-off decision on the shipped
    // objective is that the POLICY is off (`admission: null`), not that the
    // table is short. Both halves are asserted — here and in
    // `admission-noop.test.ts`.
    //
    // arch/s3 adds a THIRD row, `territory-slider` (the i2 repair the ledger
    // raced as `lobster-slider`). Same rule, third time: registering it admits
    // nothing, `DEFAULT_COHORT_ID` is untouched, and only the admission policy
    // — which ships off — can select it. Ascending cost: base skips the
    // partition, territory pays for it, the repair pays for it plus `command`.
    expect(COHORTS.map((c) => c.id)).toEqual(['base', 'territory', 'territory-slider']);
    expect(DEFAULT_COHORT_ID).toBe('territory');
    expect(requireCohortRowIn(COHORTS, DEFAULT_COHORT_ID).profile).toBe(DEFAULT_PROFILE);
    expect(requireCohortRowIn(COHORTS, 'base').profile).toBe(BASE_PROFILE);
  });

  test('every registered profile is coherent, and base weights ONLY what it invokes', () => {
    // The synthesis sketch gave `base` `DEFAULT_WEIGHTS`, which throws here:
    // reach at 1 and room at 3 are weighted keys the base cohort never
    // computes. The row carries its own vector instead, and the three weights
    // it does carry are DEFAULT_WEIGHTS' own numbers — base is the territory
    // objective minus two features, not a third calibration nobody raced.
    for (const row of COHORTS) expect(() => assertProfileCoherent(row.profile)).not.toThrow();
    expect(Object.keys(BASE_PROFILE.weights).sort()).toEqual([
      'healthEconomy',
      'kingMargin',
      'material',
    ]);
    for (const key of Object.keys(BASE_PROFILE.weights)) {
      expect([key, BASE_PROFILE.weights[key]]).toEqual([key, DEFAULT_WEIGHTS[key]]);
      expect(BASE_PROFILE.invoked.has(key)).toBe(true);
    }
    // NOT zeroed: kingMargin carries the same legacy `horizonTurns <= 0` guard
    // the territory features do, so a zero here would silently delete the one
    // specialist fact this cohort exists to keep.
    expect(BASE_PROFILE.reachHorizonTurns).toBe(TERRITORY_PROFILE.reachHorizonTurns);
    // And the compute gate really is narrower than territory's.
    expect([...BASE_PROFILE.invoked].sort()).toEqual(['healthEconomy', 'kingMargin', 'material']);
    expect(BASE_PROFILE.invoked.has('reach')).toBe(false);
    expect(BASE_PROFILE.invoked.has('room')).toBe(false);
  });

  test('an unregistered id is refused, and the message names the table', () => {
    expect(cohortRowIn(COHORTS, 'no-such-cohort')).toBeUndefined();
    expect(() => requireCohortRowIn(COHORTS, 'no-such-cohort')).toThrow(/unknown cohort/);
    expect(() => requireCohortRowIn(COHORTS, 'no-such-cohort')).toThrow(/territory/);
    expect(() => requireCohortRowIn([], 'anything')).toThrow(/\(none\)/);
  });

  test('the registry is a PARAMETER: a caller may hold its own', () => {
    // The seam Stage 2's per-game policy needs, and the reason nothing here is
    // module-scope mutable state.
    const own: ReadonlyArray<CohortRow> = [
      { id: 'material', profile: MATERIAL_ONLY_PROFILE },
    ];
    expect(requireCohortRowIn(own, 'material').profile).toBe(MATERIAL_ONLY_PROFILE);
    expect(cohortRowIn(own, DEFAULT_COHORT_ID)).toBeUndefined();
    // ...and holding one did not teach the shipped table a new name.
    expect(COHORTS.map((c) => c.id)).toEqual(['base', 'territory', 'territory-slider']);
  });

  test('the stamp carries the INVOKED set, sorted', () => {
    const stamp = cohortAssumptionOf(requireCohortRowIn(COHORTS, DEFAULT_COHORT_ID));
    expect(stamp.kind).toBe('cohort');
    if (stamp.kind !== 'cohort') throw new Error('unreachable');
    expect(stamp.id).toBe(DEFAULT_COHORT_ID);
    expect(stamp.features).toEqual([...ALL_FEATURE_KEYS].sort());
    // Not the weighted set: those are the same list for THIS profile, and the
    // distinction is the whole of S0a. A cohort whose invoked set is smaller
    // than its weight table would be refused at construction.
    expect([...invokedFeaturesOf(DEFAULT_PROFILE)]).toEqual([...ALL_FEATURE_KEYS].sort());
  });

  test('every row is a coherent profile that keeps material at the cliff weight', () => {
    // Anti-spaghetti rule 6: `material` at weight 10 is in EVERY cohort, so
    // the veto set (certain material death) is cohort-invariant and a richer
    // objective can never trade away a unit an poorer one refused to lose.
    for (const row of COHORTS) {
      expect(() => assertProfileCoherent(row.profile)).not.toThrow();
      expect(row.profile.invoked.has('material')).toBe(true);
      expect(row.profile.weights.material).toBe(CLIFF_MATERIAL_WEIGHT);
    }
  });

  test('ids are unique — a re-used id is two objectives with one basis', () => {
    expect(new Set(COHORTS.map((c) => c.id)).size).toBe(COHORTS.length);
  });
});
