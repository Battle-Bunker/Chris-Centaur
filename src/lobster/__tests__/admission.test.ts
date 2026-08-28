/**
 * THE ADMISSION GOVERNOR — condition-keyed, never budget-keyed; frozen for the
 * turn; pessimistic under fog.
 *
 * The three rules `admission.ts` exists to make structural, each with the test
 * that would catch it being broken, plus the predicate table's own arithmetic.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AdmissionConditions } from '../contracts';
import {
  AdmissionGovernor,
  DEFAULT_ADMISSION_DWELL,
  activeRungOf,
  admissionAssumption,
  classifyAdmission,
  isSliderKind,
  promotionImminentFor,
  sameLadder,
  sliderPossibleIn,
} from '../admission';
import type { LadderRow } from '../admission';
import {
  ADMISSION_LADDERS,
  BASE_COHORT_ID,
  COHORTS,
  OWN_TRAIL_ADMISSION_THRESHOLD,
  SLIDER_COHORT_ID,
  TERRITORY_COHORT_ID,
} from '../evaluate/calibration';
import { assumptionClassOf } from '../bounds';
import { UnitKind, kindProfiles, profileOf } from '../../partial-engine/grammar';

const conditions = (over: Partial<AdmissionConditions> = {}): AdmissionConditions => ({
  ownSliderPossible: false,
  sliderPossible: false,
  ownTrailCount: 8,
  theirTrailCount: 8,
  ownPromotionImminent: false,
  promotionImminent: false,
  ...over,
});

const BASE_ONLY = [BASE_COHORT_ID];
const BOTH = [BASE_COHORT_ID, TERRITORY_COHORT_ID];
/** The rung an own-slider board is conducted under on arch/s3: the repair. */
const SLIDER = [BASE_COHORT_ID, SLIDER_COHORT_ID];

// ---------------------------------------------------------------------------

describe('the governor is condition-keyed and never budget-keyed', () => {
  test('admits exactly six measured conditions, none of them a clock', () => {
    // Structural, and the mirror of the posture governor's own guard: the ONLY
    // way a millisecond could reach the classifier is through this type.
    // Adding a budget field here is the design error the test exists to catch.
    //
    // SIX ON arch/s3, not four: E1 re-keyed the predicate on the OWN-TEAM
    // slider bit, and the board-level bit is kept beside it because the compute
    // census and M4 are stated in board-level terms and a corpus that dropped
    // it could not be read against either — nor re-derive what the arch/s2
    // predicate would have decided on the same board. Both pre-arms follow the
    // same rule for the same reason.
    expect(Object.keys(conditions()).sort()).toEqual([
      'ownPromotionImminent',
      'ownSliderPossible',
      'ownTrailCount',
      'promotionImminent',
      'sliderPossible',
      'theirTrailCount',
    ]);
  });

  test('the SOURCE of admission.ts names no clock outside its own prose', () => {
    // The type guard above catches a field. This catches the other shape: a
    // classifier that reads the clock directly rather than being handed it.
    // Comments are stripped first — the doctrine has to be allowed to say the
    // word "budget" in order to forbid it.
    const src = readFileSync(join(__dirname, '..', 'admission.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of [
      /\bbudget/i,
      /\bdeadline/i,
      /\belapsed/i,
      /Date\s*\.\s*now/,
      /performance\s*\.\s*now/,
      /\bsliceMs\b/,
      /\bremaining/i,
      /\bhrtime\b/,
    ]) {
      expect([forbidden.source, forbidden.test(code)]).toEqual([forbidden.source, false]);
    }
    // ...and the doctrine really is in the prose, so this test is guarding a
    // documented rule rather than a coincidence of naming.
    expect(src).toContain('NEVER BUDGET-KEYED');
  });

  test('classifies identically for every condition combination whatever the stamp', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const trail of [0, 3, 4, 9]) {
        const c = conditions({
          // The own bits are the keyed ones and the board-level bits are
          // implied by them (own => any), so the sweep walks the own bits and
          // keeps the any bits consistent rather than enumerating impossible
          // states like "we own a slider but the board has none".
          ownSliderPossible: (mask & 1) !== 0,
          sliderPossible: (mask & 1) !== 0 || (mask & 8) !== 0,
          ownPromotionImminent: (mask & 2) !== 0,
          promotionImminent: (mask & 2) !== 0 || (mask & 8) !== 0,
          theirTrailCount: (mask & 4) !== 0 ? 0 : 7,
          ownTrailCount: trail,
        });
        const a = new AdmissionGovernor(BOTH, 1);
        const b = new AdmissionGovernor(BOTH, 1);
        a.observe(c, 0);
        b.observe(c, 9_999_999);
        expect(sameLadder(a.current, b.current)).toBe(true);
        expect(a.current).toEqual(classifyAdmission(c));
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('classifyAdmission is pure and total', () => {
  test('every ladder it can return is non-empty and starts at the base cohort', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const trail of [0, 1, 3, 4, 5, 12]) {
        const ladder = classifyAdmission(
          conditions({
            ownSliderPossible: (mask & 1) !== 0,
            sliderPossible: (mask & 1) !== 0 || (mask & 8) !== 0,
            ownPromotionImminent: (mask & 2) !== 0,
            promotionImminent: (mask & 2) !== 0 || (mask & 8) !== 0,
            theirTrailCount: (mask & 4) !== 0 ? 0 : 7,
            ownTrailCount: trail,
          })
        );
        expect(ladder.length).toBeGreaterThan(0);
        expect(ladder[0]).toBe(BASE_COHORT_ID);
        // Ascending cost, no repeats, and every rung is a registered objective.
        expect(new Set(ladder).size).toBe(ladder.length);
        for (const id of ladder) expect(COHORTS.some((c) => c.id === id)).toBe(true);
      }
    }
  });

  test('an EMPTY table still answers, and answers with the safety floor', () => {
    // Totality is not left to the table's good behaviour. "No rule applies"
    // degrades to "spend nothing extra", never to a throw and never to an
    // empty ladder — base is admitted on every board under every policy.
    expect(classifyAdmission(conditions(), [])).toEqual(BASE_ONLY);
    const conditional: LadderRow[] = [
      { id: 'never', when: () => false, ladder: BOTH, evidence: 'test' },
    ];
    expect(classifyAdmission(conditions(), conditional)).toEqual(BASE_ONLY);
  });

  test('the active rung is the LAST one — the richest admitted objective', () => {
    expect(activeRungOf(BASE_ONLY)).toBe(BASE_COHORT_ID);
    expect(activeRungOf(BOTH)).toBe(TERRITORY_COHORT_ID);
    // Nothing here says what the rungs BELOW the last one do. That is a later
    // stage's question and this stage encodes no answer to it.
  });
});

describe('the first tenant, as the table states it', () => {
  test('an OWN-slider board gets the repair rung, whatever the roster looks like', () => {
    // arch/s2 answered `[base]` here. E2 says that throws away a +0.514 feature
    // to avoid a +0.000 one; the rung is the repair.
    const own = { ownSliderPossible: true, sliderPossible: true };
    expect(classifyAdmission(conditions(own))).toEqual(SLIDER);
    expect(classifyAdmission(conditions({ ...own, ownTrailCount: 99 }))).toEqual(SLIDER);
    // And below the trail threshold too: the slider row outranks the thin-trail
    // row deliberately, because a thin-trail piece board is the board the
    // repair was built for.
    expect(classifyAdmission(conditions({ ...own, ownTrailCount: 0 }))).toEqual(SLIDER);
  });

  test('AN ENEMY-ONLY SLIDER DOES NOT GATE — this is the whole of E1', () => {
    // THE AMENDMENT, AS ONE ASSERTION. The board carries a slider
    // (`sliderPossible`) and we do not own it (`ownSliderPossible` false).
    // arch/s2's board-level key demoted here; E1 measures this exact class at
    // +0.57 [+0.23, +0.88] for territory over material — indistinguishable from
    // the +0.58 it gets with no slider on the board at all — and the
    // contact-forced replication puts it at +0.53 (150 ms) and +0.75 (1000 ms).
    // So the shipped objective runs.
    expect(
      classifyAdmission(conditions({ sliderPossible: true, ownSliderPossible: false }))
    ).toEqual(BOTH);
    // Identical to the no-slider board, which is the shape of E1's finding:
    // the `any` bit separates nothing.
    expect(
      classifyAdmission(conditions({ sliderPossible: true, ownSliderPossible: false }))
    ).toEqual(classifyAdmission(conditions()));
    // ...and the enemy pre-arm is scoped the same way, or the two halves of one
    // rule would be keyed on different boards.
    expect(
      classifyAdmission(conditions({ promotionImminent: true, ownPromotionImminent: false }))
    ).toEqual(BOTH);
  });

  test('the pre-arm gates exactly as own-slider presence does', () => {
    // A3's recommendation, and the reason the transition happens BETWEEN turns:
    // an imminent OWN promotion IS own-slider presence for the gate's purposes.
    expect(
      classifyAdmission(conditions({ ownPromotionImminent: true, promotionImminent: true }))
    ).toEqual(SLIDER);
    expect(
      classifyAdmission(
        conditions({
          ownPromotionImminent: true,
          promotionImminent: true,
          ownSliderPossible: false,
        })
      )
    ).toEqual(
      classifyAdmission(conditions({ ownSliderPossible: true, sliderPossible: true }))
    );
  });

  test('the trail threshold bites at exactly four', () => {
    expect(OWN_TRAIL_ADMISSION_THRESHOLD).toBe(4);
    for (let n = 0; n < OWN_TRAIL_ADMISSION_THRESHOLD; n++) {
      expect([n, classifyAdmission(conditions({ ownTrailCount: n }))]).toEqual([n, BASE_ONLY]);
    }
    for (const n of [4, 5, 8]) {
      expect([n, classifyAdmission(conditions({ ownTrailCount: n }))]).toEqual([n, BOTH]);
    }
  });

  test('THEIR trail count does not gate — the room feature sums OUR side', () => {
    for (const theirs of [0, 3, 9]) {
      expect(classifyAdmission(conditions({ theirTrailCount: theirs }))).toEqual(BOTH);
    }
  });

  test('every table row carries the measurement that paid for it', () => {
    for (const row of ADMISSION_LADDERS) {
      expect([row.id, row.evidence.length > 40]).toEqual([row.id, true]);
      expect([row.id, row.ladder.length > 0]).toEqual([row.id, true]);
      expect([row.id, row.ladder[0]]).toEqual([row.id, BASE_COHORT_ID]);
    }
    // The last row must be unconditional, or the table would be relying on the
    // classifier's fallback for its ordinary answer.
    const last = ADMISSION_LADDERS[ADMISSION_LADDERS.length - 1] as LadderRow;
    expect(last.when(conditions({ sliderPossible: true, ownTrailCount: 0 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('the slider detector is class-level and pessimistic', () => {
  test('it is the ENGINE predicate, over every registered kind', () => {
    // Not a kind-name set — the calibration doctrine's fourth fact. Pinned
    // against `cloud.ts`'s own `rays.length > 0 && !oriented` so the two
    // cannot drift.
    for (const p of kindProfiles()) {
      const engineSays = p.rays.length > 0 && !p.oriented;
      expect([p.name, isSliderKind(p.kind)]).toEqual([p.name, engineSays]);
    }
    // And it is not vacuous in either direction on the shipped catalogue.
    expect(isSliderKind(UnitKind.Rook)).toBe(true);
    expect(isSliderKind(UnitKind.Bishop)).toBe(true);
    expect(isSliderKind(UnitKind.Queen)).toBe(true);
    expect(isSliderKind(UnitKind.Snake)).toBe(false);
    expect(isSliderKind(UnitKind.Knight)).toBe(false);
    expect(isSliderKind(UnitKind.King)).toBe(false);
    expect(isSliderKind(UnitKind.Pawn)).toBe(false);
  });

  test('a kindSet that MIGHT be a slider counts as one (owner ruling Q2)', () => {
    const pawn = 1 << UnitKind.Pawn;
    const queen = 1 << UnitKind.Queen;
    expect(sliderPossibleIn(pawn)).toBe(false);
    // The fork a pawn held past the promotion horizon actually takes: the
    // claim's kindSet is the UNION, and the union contains a queen.
    expect(sliderPossibleIn(pawn | queen)).toBe(true);
    expect(sliderPossibleIn(queen)).toBe(true);
    expect(sliderPossibleIn(0)).toBe(false);
    // Every bit is read, not just the low ones.
    expect(sliderPossibleIn((1 << UnitKind.Snake) | (1 << UnitKind.Bishop))).toBe(true);
  });

  test('the fog bias is one-way: widening a kindSet never clears the flag', () => {
    // Monotonicity of the pessimistic reading. More uncertainty about what a
    // unit is can only ever make us MORE cautious, which is the direction of
    // error the owner accepted.
    for (const seed of [0, 1 << UnitKind.Snake, 1 << UnitKind.Queen, 1 << UnitKind.Pawn]) {
      for (const p of kindProfiles()) {
        const widened = seed | (1 << p.kind);
        if (sliderPossibleIn(seed)) expect(sliderPossibleIn(widened)).toBe(true);
      }
    }
  });
});

describe('the promotion pre-arm', () => {
  const PROMOTION_WEIGHT = 10;

  test('a kind that cannot promote never arms it', () => {
    for (const p of kindProfiles()) {
      if (p.promotesTo !== null) continue;
      expect([p.name, promotionImminentFor(p.kind, 99, 99, PROMOTION_WEIGHT)]).toEqual([
        p.name,
        false,
      ]);
    }
    expect(profileOf(UnitKind.Pawn).promotesTo).toBe(UnitKind.Queen);
  });

  test('the live form is one meal away, without the landing clause', () => {
    expect(promotionImminentFor(UnitKind.Pawn, 8, 0, PROMOTION_WEIGHT)).toBe(false);
    expect(promotionImminentFor(UnitKind.Pawn, 9, 0, PROMOTION_WEIGHT)).toBe(true);
    expect(promotionImminentFor(UnitKind.Pawn, 10, 0, PROMOTION_WEIGHT)).toBe(true);
  });

  test('MONOTONE IN HOLD DEPTH: a deeper hold can only ever arm it', () => {
    // The pessimistic form, and the property the freeze rests on. A unit we
    // have not seen for `d` turns could have eaten on every one of them, so a
    // longer hold widens what it might weigh — and the answer therefore only
    // ever travels false -> true, never back. If this were non-monotone, a
    // refinement that revealed a unit had been held longer than we thought
    // could REMOVE caution mid-turn, which is exactly the shape the ladder is
    // frozen to prevent.
    for (let weight = 0; weight <= PROMOTION_WEIGHT + 1; weight++) {
      let armed = false;
      for (let depth = 0; depth <= 12; depth++) {
        const now = promotionImminentFor(UnitKind.Pawn, weight, depth, PROMOTION_WEIGHT);
        if (armed) expect([weight, depth, now]).toEqual([weight, depth, true]);
        armed = armed || now;
      }
    }
  });

  test('a pawn held long enough arms the gate even at weight 1', () => {
    expect(promotionImminentFor(UnitKind.Pawn, 1, 0, PROMOTION_WEIGHT)).toBe(false);
    expect(promotionImminentFor(UnitKind.Pawn, 1, 7, PROMOTION_WEIGHT)).toBe(false);
    expect(promotionImminentFor(UnitKind.Pawn, 1, 8, PROMOTION_WEIGHT)).toBe(true);
  });

  test('a negative depth is clamped, never trusted', () => {
    expect(promotionImminentFor(UnitKind.Pawn, 9, -50, PROMOTION_WEIGHT)).toBe(true);
    expect(promotionImminentFor(UnitKind.Pawn, 1, -50, PROMOTION_WEIGHT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the dwell', () => {
  test('a single dissenting measurement does not move the ladder', () => {
    const g = new AdmissionGovernor(BOTH, DEFAULT_ADMISSION_DWELL);
    expect(g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 0)).toBeNull();
    expect(g.current).toEqual(BOTH);
    expect(g.pendingHeld).toBe(1);
  });

  test('two consecutive agreeing measurements do', () => {
    const g = new AdmissionGovernor(BOTH, DEFAULT_ADMISSION_DWELL);
    g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 0);
    const flip = g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 1);
    expect(flip).not.toBeNull();
    expect(flip?.from).toEqual(BOTH);
    expect(flip?.to).toEqual(SLIDER);
    expect(g.current).toEqual(SLIDER);
    expect(g.activeCohort).toBe(SLIDER_COHORT_ID);
    expect(g.flips).toHaveLength(1);
  });

  test('CHATTER GUARD: alternating boards never flip anything', () => {
    // The property the dwell exists for. A predicate on a quantity that moves
    // every turn would otherwise replace the basis every turn — and replacing
    // the basis is not a log-tidiness question, it is throwing away the
    // ratchet. Nothing in the shipped tenant chatters (the composite gate
    // flips 0.101 times per 100 team-turns), which is why this is asserted on
    // a synthetic alternation rather than on a corpus.
    const g = new AdmissionGovernor(BOTH, DEFAULT_ADMISSION_DWELL);
    for (let i = 0; i < 40; i++) {
      g.observe(conditions({ ownSliderPossible: i % 2 === 0, sliderPossible: i % 2 === 0 }), i);
    }
    expect(g.current).toEqual(BOTH);
    expect(g.flips).toHaveLength(0);
  });

  test('an agreeing measurement clears whatever was pending', () => {
    const g = new AdmissionGovernor(BOTH, 3);
    g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 0);
    g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 1);
    expect(g.pendingHeld).toBe(2);
    g.observe(conditions(), 2); // the board agrees with where we are
    expect(g.pendingHeld).toBe(0);
    g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 3);
    expect(g.current).toEqual(BOTH); // the count restarted, so no flip yet
    expect(g.current).not.toEqual(SLIDER);
  });

  test('a DIFFERENT dissent restarts the count rather than inheriting it', () => {
    const three: LadderRow[] = [
      { id: 'a', when: (c) => c.ownTrailCount === 0, ladder: BASE_ONLY, evidence: 'test'.repeat(20) },
      { id: 'b', when: (c) => c.ownTrailCount === 1, ladder: BOTH, evidence: 'test'.repeat(20) },
      { id: 'c', when: () => true, ladder: BASE_ONLY, evidence: 'test'.repeat(20) },
    ];
    const g = new AdmissionGovernor(BOTH, 2, three);
    g.observe(conditions({ ownTrailCount: 0 }), 0); // pending [base], held 1
    g.observe(conditions({ ownTrailCount: 1 }), 1); // agrees with current: clears
    expect(g.pendingHeld).toBe(0);
    expect(g.current).toEqual(BOTH);
  });

  test('dwell 1 restores flip-on-first-sight, for a harness that wants it', () => {
    const g = new AdmissionGovernor(BOTH, 1);
    expect(
      g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 0)
    ).not.toBeNull();
    expect(g.current).toEqual(SLIDER);
  });

  test('the state carries across decisions, and it is a VALUE', () => {
    const first = new AdmissionGovernor(BOTH, DEFAULT_ADMISSION_DWELL);
    first.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 0);
    const carried = first.state;
    expect(carried.held).toBe(1);
    // The next decision resumes from it and flips on ITS first measurement —
    // which is the whole point of counting the dwell in measurements across
    // turns, since one decision is one measurement.
    const second = AdmissionGovernor.resume(carried, DEFAULT_ADMISSION_DWELL);
    expect(
      second.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 1)
    ).not.toBeNull();
    expect(second.current).toEqual(SLIDER);
    // ...and the first governor did not move when the second one did.
    expect(first.current).toEqual(BOTH);
  });

  test('the OPENING governor adopts the board without dwelling', () => {
    // With nothing before it there is no chatter to suppress, and starting
    // from a fixed guess would run the first turn of every game under an
    // objective the board never asked for.
    const g = AdmissionGovernor.opening(
      conditions({ ownSliderPossible: true, sliderPossible: true })
    );
    expect(g.current).toEqual(SLIDER);
    expect(g.flips).toHaveLength(0);
  });
});

describe('a flip rides as a framing assumption', () => {
  test('it is the cohort assumption of the rung now in force', () => {
    const g = new AdmissionGovernor(BOTH, 1);
    const flip = g.observe(conditions({ ownSliderPossible: true, sliderPossible: true }), 7);
    expect(flip?.assumption).toEqual(admissionAssumption(SLIDER));
    expect(flip?.assumption.kind).toBe('cohort');
    if (flip?.assumption.kind !== 'cohort') throw new Error('unreachable');
    // THE STAMP NAMES THE PROFILE THAT WAS ACTUALLY RUN, which is the whole
    // point of item 3 of the arch/s3 brief: the repair is a different objective
    // and its assumption says so, by id AND by invoked feature set. `command`
    // in this list is what tells a corpus reader six months later that this
    // number was proved under the repair and not under the shipped profile.
    expect(flip.assumption.id).toBe(SLIDER_COHORT_ID);
    expect(flip.assumption.features).toEqual([
      'command',
      'healthEconomy',
      'kingMargin',
      'material',
      'reach',
      'room',
    ]);
  });

  test('FRAMING, not conditioning: a policy running never defeats discharge', () => {
    // A bespoke "admission" variant or a `narrowing` would have meant a
    // decision could never report an exact bound again merely because a policy
    // had been switched on.
    expect(assumptionClassOf(admissionAssumption(BOTH))).toBe('framing');
    expect(assumptionClassOf(admissionAssumption(BASE_ONLY))).toBe('framing');
    expect(assumptionClassOf(admissionAssumption(SLIDER))).toBe('framing');
  });

  test('the flip records the conditions that produced it', () => {
    const g = new AdmissionGovernor(BOTH, 1);
    const c = conditions({ ownSliderPossible: true, sliderPossible: true, ownTrailCount: 6 });
    const flip = g.observe(c, 3);
    expect(flip?.conditions).toEqual(c);
    // The stamp is a label and nothing reads it back.
    expect(flip?.at).toBe(3);
  });

  test('an unregistered rung is refused rather than stamped', () => {
    expect(() => admissionAssumption(['no-such-cohort'])).toThrow(/unknown cohort/);
  });
});
