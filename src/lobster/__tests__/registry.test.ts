/**
 * THE ENTRY REGISTRY — the five sockets, the legacy entries, and the identity
 * law.
 *
 * What is asserted here, in the order it matters:
 *
 *   1. THE IDENTITY LAW. Every legacy entry's structural fingerprint is
 *      PINNED. The entries take their params BY REFERENCE from the constants
 *      the shipped code reads, so moving a shipped constant without minting a
 *      new entry id (`@2`) breaks this test — which is what makes "an entry is
 *      immutable once measured" a property of the build rather than a habit.
 *   2. RESOLUTION IS TOTAL AND CHECKED. One entry per socket per decision, and
 *      a slate naming an entry that does not exist, or one from another socket,
 *      THROWS. A silent fallback would attribute a measurement to an entry that
 *      never ran.
 *   3. THE SEAM RULE. Only the evaluator socket writes sound bounds; every
 *      other socket's entries are advisory. That is the rule that decides what
 *      may be an entry at all.
 *   4. NO ENV FLAG. The registry is data and `slate=legacy` is one internal
 *      constant. Asserted against the source, because the whole mandate is a
 *      rejection of flag-gated pseudo-dead code as the testing paradigm.
 *   5. THE PER-FEATURE-PARTS PRECONDITION, and exactly where it is blocked.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_ENTRIES,
  LEGACY_ENTRIES,
  LEGACY_SLATE,
  POTION_AWARE_BOLD_SLATE,
  POTION_AWARE_SLATE,
  POTION_ENTRIES,
  POTION_INTEL_SLATE,
  REGISTRY,
  SLATE_IDS,
  SLATE_LEGACY,
  SLATE_POTION_AWARE,
  SLATE_POTION_INTEL,
  SLATE_POTION_AWARE_BOLD,
  SLOT_IDS,
  StrategyRegistry,
  UnknownEntryError,
  entryFingerprint,
  slateFor,
  slateStampOf,
} from '../registry';
import type { SlotId, StrategyEntry } from '../registry';
import { DEFAULT_KNOBS } from '../candidates';
import { DEFAULT_TUNING } from '../search/core';
import { LAT } from '../search/edge-ev';
import { TERRITORY_PROFILE, DEFAULT_PROFILE } from '../evaluate/calibration';
import { BoundEvaluator, FEATURES, defaultEvaluator, fold } from '../evaluate';
import type { Bound, Evaluator, JointPlan, Substrate } from '../contracts';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../team-decision-engine';
import { REPLAY_SET, WALL, BUDGET_MS } from '../../tests/core-identity-fixture';
import type { Board, CentaurMove, GameState, Snake } from '../../types/battlesnake';
import type { PinEvent } from '../contracts';

// ------------------------------------------------------------------ helpers

/** A short, stable digest of a fingerprint. The fingerprints themselves are
 * canonical but long; what a pin needs is only that they do not move. */
function digest(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const sourceOf = (file: string): string =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// -------------------------------------------------------------- the entries

describe('the registry holds every legacy entry, once, in its own socket', () => {
  test('ids are unique, prefixed by socket, and versioned', () => {
    const prefix: Readonly<Record<SlotId, string>> = {
      'move-selector': 'move/',
      'evaluator-selector': 'evsel/',
      evaluator: 'eval/',
      aggregator: 'agg/',
      scheduler: 'sched/',
    };
    const seen = new Set<string>();
    for (const e of LEGACY_ENTRIES) {
      expect(seen.has(e.id)).toBe(false);
      seen.add(e.id);
      expect(e.id.startsWith(prefix[e.slot])).toBe(true);
      // The identity law's visible half: every id carries a version, so a
      // params change is a NEW id rather than a mutation of a measured one.
      expect(e.id).toMatch(/@\d+$/);
      expect(e.record.status).toBe('default');
    }
  });

  test('every socket has at least one entry, and every entry a real socket', () => {
    for (const slot of SLOT_IDS) {
      expect(REGISTRY.entries(slot).length).toBeGreaterThan(0);
    }
    const slots = new Set<string>(SLOT_IDS);
    for (const e of LEGACY_ENTRIES) expect(slots.has(e.slot)).toBe(true);
  });

  test('THE SEAM RULE: only the evaluator socket writes sound bounds', () => {
    // "If it can change a sound bound, it is kernel behind the law harness; if
    // it can only change order or spend, it is a slot entry." The evaluators
    // are the one socket that publishes lo/hi, and an entry marked
    // `sound-writing` owes the law harness as its admission gate.
    for (const e of LEGACY_ENTRIES) {
      expect(e.soundness).toBe(e.slot === 'evaluator' ? 'sound-writing' : 'advisory');
    }
  });

  test('nothing is claimed as fitted that has not been fitted', () => {
    // The priors and the cost models are DECLARED and empty. A `fitted: true`
    // here without a fit behind it would be a number with no measurement, and
    // increment 2 reads exactly these.
    for (const e of LEGACY_ENTRIES) {
      expect(e.priors.fitted).toBe(false);
      expect(e.cost.fitted).toBe(false);
      expect(e.priors.note.length).toBeGreaterThan(0);
      expect(e.cost.note.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------- the identity law

describe('THE IDENTITY LAW: an entry is immutable once measured', () => {
  /**
   * PINNED FINGERPRINTS. If one of these fails, a shipped constant moved
   * underneath a registry entry. The repair is NOT to update the number here:
   * it is to mint a new entry id (`@2`) so that every measurement already
   * recorded still refers to the strategy that produced it, and then to pin the
   * new entry.
   */
  const PINNED: Readonly<Record<string, string>> = {
    'move/legacy-order@1': '89b13844',
    'evsel/legacy-always@1': 'df3b136c',
    'eval/legacy-territory@1': 'c8783375',
    'eval/legacy-material@1': '5cc11aec',
    'eval/legacy-territory-slider@1': '949478e9',
    'eval/legacy-territory-slider-royal@1': 'd913e999',
    'agg/legacy-clamp@1': '21213045',
    'sched/legacy-slice@1': '67a3153e',
  };

  test('every entry is pinned, and every pin names an entry', () => {
    expect(Object.keys(PINNED).sort()).toEqual(LEGACY_ENTRIES.map((e) => e.id).sort());
  });

  test('no entry has drifted from the constants the shipped code reads', () => {
    for (const e of LEGACY_ENTRIES) {
      expect(`${e.id}=${digest(entryFingerprint(e))}`).toBe(`${e.id}=${PINNED[e.id]}`);
    }
  });

  test('the fingerprint moves when a param moves, and not when prose does', () => {
    const base = LEGACY_ENTRIES.find((e) => e.id === 'agg/legacy-clamp@1') as StrategyEntry;
    const reworded: StrategyEntry = {
      ...base,
      record: { ...base.record, note: 'a clarified comment is not a new strategy' },
      priors: { ...base.priors, note: 'nor is this' },
    };
    expect(entryFingerprint(reworded)).toBe(entryFingerprint(base));
    const retuned: StrategyEntry = {
      ...base,
      params: { ...(base.params as Record<string, unknown>), lat: LAT + 1 } as never,
    };
    expect(entryFingerprint(retuned)).not.toBe(entryFingerprint(base));
  });

  test('the legacy params ARE the shipped constants, not a copy of them', () => {
    // The registry mirrors what runs. Read the params back and compare them to
    // the live constants: a retyped table would drift silently, and the
    // fingerprint pins above would then be pinning the wrong thing.
    const move = REGISTRY.get('move/legacy-order@1', 'move-selector').params as Record<
      string,
      unknown
    >;
    expect(move.candidateCap).toBe(DEFAULT_TUNING.candidateCap);
    expect((move.ordering as Record<string, unknown>).gainOrdering).toBe(
      DEFAULT_KNOBS.gainOrdering
    );
    const clamp = REGISTRY.get('agg/legacy-clamp@1', 'aggregator').params as Record<
      string,
      unknown
    >;
    expect(clamp.lat).toBe(LAT);
    expect(clamp.polarity).toBe('loser-only');
    expect(clamp.writesBound).toBe(false);
    // The slate's evaluator is the profile production actually runs.
    expect(REGISTRY.get('eval/legacy-territory@1', 'evaluator').params).toBe(TERRITORY_PROFILE);
    expect(DEFAULT_PROFILE).toBe(TERRITORY_PROFILE);
    expect(defaultEvaluator.profile).toBe(TERRITORY_PROFILE);
  });
});

// ---------------------------------------------------------------- resolution

describe('resolution is total and checked', () => {
  test('the legacy slate resolves one entry per socket', () => {
    const resolved = REGISTRY.resolve(LEGACY_SLATE);
    expect(resolved.slateId).toBe(SLATE_LEGACY);
    expect(resolved.moveSelectors).toHaveLength(1);
    expect(resolved.evaluators).toHaveLength(1);
    expect(resolved.evaluatorSelector.slot).toBe('evaluator-selector');
    expect(resolved.aggregator.slot).toBe('aggregator');
    expect(resolved.scheduler.slot).toBe('scheduler');
    expect(slateStampOf(resolved)).toEqual({
      slate: SLATE_LEGACY,
      moveSelectors: LEGACY_SLATE.moveSelectors,
      evaluatorSelector: LEGACY_SLATE.evaluatorSelector,
      evaluators: LEGACY_SLATE.evaluators,
      aggregator: LEGACY_SLATE.aggregator,
      scheduler: LEGACY_SLATE.scheduler,
    });
    // `resolve()` with no argument is the same decision, not a different one.
    expect(slateStampOf(REGISTRY.resolve())).toEqual(slateStampOf(resolved));
  });

  test('an entry that does not exist THROWS — it never falls back', () => {
    expect(() => REGISTRY.get('agg/precision-merge@1', 'aggregator')).toThrow(UnknownEntryError);
    expect(() =>
      REGISTRY.resolve({ ...LEGACY_SLATE, aggregator: 'agg/precision-merge@1' })
    ).toThrow(UnknownEntryError);
  });

  test('an entry from the WRONG socket throws too', () => {
    // Cross-socket reuse would make an entry id ambiguous, and an entry id is
    // what a measurement attaches to.
    expect(() => REGISTRY.get('agg/legacy-clamp@1', 'scheduler')).toThrow(UnknownEntryError);
    expect(() =>
      REGISTRY.resolve({ ...LEGACY_SLATE, scheduler: 'agg/legacy-clamp@1' })
    ).toThrow(UnknownEntryError);
  });

  test('an empty socket is refused: the frame is the slate', () => {
    expect(() => REGISTRY.resolve({ ...LEGACY_SLATE, evaluators: [] })).toThrow(/frame/);
    expect(() => REGISTRY.resolve({ ...LEGACY_SLATE, moveSelectors: [] })).toThrow(
      /move selector/
    );
  });

  test('a duplicate id cannot be registered', () => {
    expect(() => new StrategyRegistry([...LEGACY_ENTRIES, LEGACY_ENTRIES[0]])).toThrow(
      /duplicate/
    );
  });

  test('there are exactly FOUR slates, and asking for a fifth throws', () => {
    // FOUR: the shipped lineup, the potion-aware four, THIS BRANCH's
    // `potion-intel` (the four plus the two plan-discriminating terms) and the
    // parent branch's `potion-aware-bold` (the four at four times the scale).
    // Each is a MEMBER of one collection rather than an edit of another, so
    // every number recorded against any of them still describes the lineup that
    // produced it.
    expect(slateFor()).toBe(LEGACY_SLATE);
    expect(slateFor(SLATE_LEGACY)).toBe(LEGACY_SLATE);
    expect(slateFor(SLATE_POTION_AWARE)).toBe(POTION_AWARE_SLATE);
    expect(slateFor(SLATE_POTION_INTEL)).toBe(POTION_INTEL_SLATE);
    expect(slateFor(SLATE_POTION_AWARE_BOLD)).toBe(POTION_AWARE_BOLD_SLATE);
    expect(SLATE_IDS).toEqual([
      SLATE_LEGACY,
      SLATE_POTION_AWARE,
      SLATE_POTION_INTEL,
      SLATE_POTION_AWARE_BOLD,
    ]);
    // A name the registry does not hold is refused at run time as well as in
    // the type, for a caller that casts around it: a silent fallback to the
    // default would attribute a measurement to a slate that never ran.
    expect(() => slateFor('greedy-voi' as typeof SLATE_LEGACY)).toThrow(/unknown slate/);
  });

  test('the potion-aware slate resolves, and every socket but one is legacy', () => {
    const resolved = REGISTRY.resolve(POTION_AWARE_SLATE);
    expect(resolved.slateId).toBe(SLATE_POTION_AWARE);
    expect(resolved.moveSelectors.map((e) => e.id)).toEqual(LEGACY_SLATE.moveSelectors);
    expect(resolved.evaluatorSelector.id).toBe(LEGACY_SLATE.evaluatorSelector);
    expect(resolved.aggregator.id).toBe(LEGACY_SLATE.aggregator);
    expect(resolved.scheduler.id).toBe(LEGACY_SLATE.scheduler);
    // The frame is the slate: the sound entry first, the advisory four after.
    // FOUR, and neither six nor eight. The two plan-discriminating terms are
    // named by `potion-intel` alone and the bold four by `potion-aware-bold`
    // alone; a slate that grew members underneath a recorded measurement would
    // be exactly the edit the identity law forbids.
    expect(resolved.evaluators.map((e) => e.id)).toEqual([
      ...LEGACY_SLATE.evaluators,
      'eval/attack-window@2',
      'eval/potion-seek@3',
      'eval/potion-control@2',
      'eval/dodge-discount@2',
    ]);
  });

  test('the potion-intel slate is potion-aware plus the two that discriminate plans', () => {
    const resolved = REGISTRY.resolve(POTION_INTEL_SLATE);
    expect(resolved.slateId).toBe(SLATE_POTION_INTEL);
    // Four sockets untouched, again: the question this slate asks is about the
    // evaluator frame and about nothing else.
    expect(resolved.moveSelectors.map((e) => e.id)).toEqual(LEGACY_SLATE.moveSelectors);
    expect(resolved.evaluatorSelector.id).toBe(LEGACY_SLATE.evaluatorSelector);
    expect(resolved.aggregator.id).toBe(LEGACY_SLATE.aggregator);
    expect(resolved.scheduler.id).toBe(LEGACY_SLATE.scheduler);
    expect(resolved.evaluators.map((e) => e.id)).toEqual([
      ...POTION_AWARE_SLATE.evaluators,
      'eval/potion-pickup@1',
      'eval/potion-defense@1',
    ]);
    for (const e of resolved.evaluators.slice(1)) expect(e.soundness).toBe('advisory');
  });

  test('the bold slate is the same slate at four times the voice', () => {
    const bold = REGISTRY.resolve(POTION_AWARE_BOLD_SLATE);
    expect(bold.slateId).toBe(SLATE_POTION_AWARE_BOLD);
    // Every socket but the evaluator list is the legacy entry, exactly as in
    // `potion-aware`: a ladder rung that also moved a second socket would be
    // two changes wearing one name.
    expect(bold.moveSelectors.map((e) => e.id)).toEqual(LEGACY_SLATE.moveSelectors);
    expect(bold.evaluatorSelector.id).toBe(LEGACY_SLATE.evaluatorSelector);
    expect(bold.aggregator.id).toBe(LEGACY_SLATE.aggregator);
    expect(bold.scheduler.id).toBe(LEGACY_SLATE.scheduler);
    expect(bold.evaluators.map((e) => e.id)).toEqual([
      ...LEGACY_SLATE.evaluators,
      'eval/attack-window@3',
      'eval/potion-seek@4',
      'eval/potion-control@3',
      'eval/dodge-discount@3',
    ]);
    // THE ONLY DIFFERENCE IS THE WEIGHT. Compared field by field against the
    // quiet row, so a params value that drifted between scales would make the
    // ladder a comparison of two strategies rather than of two volumes.
    const quiet = REGISTRY.get('eval/potion-seek@3', 'evaluator').params as Record<string, unknown>;
    const loud = REGISTRY.get('eval/potion-seek@4', 'evaluator').params as Record<string, unknown>;
    expect(loud.weight).toBe(4);
    expect(quiet.weight).toBe(1);
    for (const k of Object.keys(quiet)) {
      if (k === 'weight' || k === 'exposure') continue;
      expect(loud[k]).toEqual(quiet[k]);
    }
  });
});

// ------------------------------------------------------- the potion entries

describe('the potion entries are members of the evaluator collection', () => {
  test('they are ADVISORY, and the seam rule is stated per soundness class', () => {
    // The seam rule pinned above for the legacy entries says the evaluator
    // socket is the one that CAN write lo/hi. It does not say every entry in
    // it does: an `advisory` evaluator entry reaches `est` through
    // `advisoryEst` and can move no bound, which is why it owes no law-harness
    // admission gate. That distinction is the whole of what these four are.
    for (const e of POTION_ENTRIES) {
      expect(e.slot).toBe('evaluator');
      expect(e.soundness).toBe('advisory');
      expect(e.id).toMatch(/^eval\/.*@\d+$/);
      // Never `default`: nothing has been raced with these in a slate.
      expect(e.record.status).toBe('candidate');
      expect(e.record.ledgerRows).toEqual([]);
      expect(e.priors.fitted).toBe(false);
      expect(e.cost.fitted).toBe(false);
    }
  });

  test('THE IDENTITY LAW: seating a term mints a new id, never edits the old', () => {
    // The modules' own entries carry `weight: 0` — the honest params of a term
    // in no lineup. Seating one means a non-zero weight, the params tree is
    // part of the fingerprint, so the seated term is a NEW ENTRY. Every number
    // ever recorded against the older id still refers to what produced it.
    const registered = new Set(ALL_ENTRIES.map((e) => e.id));
    for (const older of [
      'eval/attack-window@1',
      'eval/potion-seek@2',
      'eval/potion-control@1',
      'eval/dodge-discount@1',
    ]) {
      expect(registered.has(older)).toBe(false);
    }
    const params = (id: string): Record<string, unknown> =>
      REGISTRY.get(id, 'evaluator').params as Record<string, unknown>;
    expect(params('eval/attack-window@2').weight).toBe(0.5);
    expect(params('eval/potion-seek@3').weight).toBe(1);
    expect(params('eval/potion-control@2').weight).toBe(1);
    // THE MODIFIER. Weight zero on purpose: everything dodge-discount does
    // happens by being present, which switches potion-seek's exposure endpoint.
    expect(params('eval/dodge-discount@2').weight).toBe(0);
    // And the one substantive difference from `@1`, which is why it is not a
    // reweighting: at `+1` the window IS potion-seek's prospective gain and
    // would be counted twice, so the seated entry judges at the unit's own tier.
    expect(params('eval/attack-window@2').tierDelta).toBe(0);
  });

  test('every potion entry is pinned, like every legacy one', () => {
    // Same instrument, same repair: if one of these moves, mint the next
    // version rather than updating the number here.
    const PINNED_POTION: Readonly<Record<string, string>> = {
      'eval/attack-window@2': 'ddefa565',
      'eval/potion-seek@3': '36d83019',
      'eval/potion-control@2': 'a38c1b12',
      'eval/dodge-discount@2': '787e8db3',
      // The two this branch added. The four above are unchanged, which is the
      // claim that matters here: adding members to a collection moved nothing
      // that was already in it.
      'eval/potion-pickup@1': '61724054',
      'eval/potion-defense@1': '95ac7ba8',
      // The bold four. The quiet four's pins are UNCHANGED above, which is the
      // identity law's own assertion: a second scale mints new ids and leaves
      // every number recorded against the old ones describing what made them.
      'eval/attack-window@3': '811107d1',
      'eval/potion-seek@4': '03c7f172',
      'eval/potion-control@3': '1f408678',
      'eval/dodge-discount@3': 'f1b1c537',
    };
    expect(Object.keys(PINNED_POTION).sort()).toEqual(POTION_ENTRIES.map((e) => e.id).sort());
    for (const e of POTION_ENTRIES) {
      expect(`${e.id}=${digest(entryFingerprint(e))}`).toBe(`${e.id}=${PINNED_POTION[e.id]}`);
    }
    // Ids are unique across the WHOLE registry, not just within their file.
    expect(new Set(ALL_ENTRIES.map((e) => e.id)).size).toBe(ALL_ENTRIES.length);
    expect(ALL_ENTRIES.length).toBe(LEGACY_ENTRIES.length + POTION_ENTRIES.length);
  });
});

// ------------------------------------------------------------- no env flags

describe('the registry is DATA: no environment flag selects anything', () => {
  test('neither the registry nor the belief reads the environment', () => {
    // The mandate's first clause: no more flag-gated pseudo-dead code as the
    // testing paradigm. `slate=legacy` is one internal constant, and there is
    // no `CENTAUR_*` here to mistype into an A/A null wearing a treatment's
    // name.
    for (const file of ['registry.ts', 'belief.ts']) {
      const src = sourceOf(file);
      expect(src.includes('process.env')).toBe(false);
      expect(src).not.toMatch(/CENTAUR_[A-Z_]+\s*=/);
    }
  });
});

// --------------------------------------------- the per-feature-parts precondition

/**
 * THE POSITIONAL-PORTFOLIO PRECONDITION, and where it currently sits.
 *
 * The portfolio thread's binding precondition on this build:
 * "dial-as-recalibration-without-re-basing (redesign §4.3) holds ONLY if the
 * bound bank retains PER-FEATURE PARTS, not folded totals."
 *
 * These two tests say exactly where that stands, so the next increment does
 * not have to rediscover it:
 *
 *   · the EVALUATOR does publish them. `fold()` computes one `Bound` per
 *     feature, UNWEIGHTED, on every evaluation, and `evaluatePlan` returns them
 *     as `PlanEvaluation.parts`. Unweighted is what a weight dial needs: a
 *     re-valuation is a multiply, not a re-fold.
 *
 *   · the BANK DROPS THEM. `BoundBank.priceBranch` prices through
 *     `evaluate.scorePlan`, which is `evaluatePlan(...).bound` — the folded
 *     total — and `EvaluationMemo` is typed `Map<string, Bound>`. So the parts
 *     are computed on every branch and discarded at the bank's door.
 *
 * The second test PINS that, which makes it a tripwire rather than a comment:
 * routing the bank through `evaluatePlan` (the restructure the precondition
 * asks for) fails it, and the failure is where the retention decision gets
 * reviewed — including its cost, which is the evaluation memo's value type and
 * the worker protocol that ships `Bound` entries between threads.
 */
describe('PRECONDITION: per-feature parts on the fold path', () => {
  test('the fold publishes one UNWEIGHTED Bound per feature', () => {
    // The fact the precondition rests on: `fold` records each feature's own
    // bound BEFORE the weight is applied, so re-valuing under a new weight is a
    // multiply rather than a re-fold — which is what makes an operator dial a
    // recalibration and not a re-basing (redesign §4.3).
    const f = (key: string, lo: number, hi: number) => ({
      key,
      defaultWeight: 1,
      contract: { reads: [], cliff: false, dischargeable: true },
      evaluate: () => ({ lo, est: (lo + hi) / 2, hi }),
    });
    const features = [f('alpha', 1, 3), f('beta', 2, 4)];
    const out = fold(features, {}, { alpha: 10, beta: 2 });
    expect(out.parts.alpha).toEqual({ lo: 1, est: 2, hi: 3 });
    expect(out.parts.beta).toEqual({ lo: 2, est: 3, hi: 4 });
    // …and the total IS the weighted sum, so the two are genuinely different
    // objects and the parts are not the fold under another name.
    expect(out.total).toEqual({ lo: 1 * 10 + 2 * 2, est: 2 * 10 + 3 * 2, hi: 3 * 10 + 4 * 2 });

    // The production evaluator folds the shipped feature list, so every one of
    // those parts is computed on every branch the decision prices.
    const ev = new BoundEvaluator();
    expect(ev.features.map((k) => k.key).sort()).toEqual(FEATURES.map((k) => k.key).sort());
    expect(FEATURES.length).toBeGreaterThan(1);
  });

  test('BLOCKED, PINNED: the bank prices through the FOLDED TOTAL', async () => {
    /** Counts which door the decision path actually takes. */
    class DoorCounter implements Evaluator {
      scoreCalls = 0;
      evalCalls = 0;
      constructor(private readonly inner: BoundEvaluator) {}
      get evaluationIdentity(): string {
        return this.inner.evaluationIdentity;
      }
      scorePlan(sub: Substrate, plan: JointPlan, asTeam: number): Bound {
        this.scoreCalls++;
        return this.inner.scorePlan(sub, plan, asTeam);
      }
      evaluatePlan(sub: Substrate, plan: JointPlan, asTeam: number) {
        this.evalCalls++;
        return this.inner.evaluatePlan(sub, plan, asTeam);
      }
    }

    const counter = new DoorCounter(new BoundEvaluator());
    const entry = REPLAY_SET[0];
    const staged: string[] = [];
    let t = 1_000;
    const ports = {
      setBotRecommendation: (_g: string, snakeId: string, move: CentaurMove) => {
        staged.push(`${snakeId}:${String(move)}`);
      },
      enableTeamStaging: () => undefined,
      onPinEvent: (_g: string, _s: (ev: PinEvent, turn?: number) => void) => () => undefined,
      pinSnakeIdOf: () => null,
      now: () => WALL,
      monotonic: () => {
        const v = t;
        t += 0.02;
        return v;
      },
      log: () => undefined,
    } as unknown as TeamDecisionPorts;

    const engine = new TeamDecisionEngine(ports, {
      evaluate: counter,
      // THE LEGACY LINEUP, NAMED. `DoorCounter` is a wrapper and not a
      // `BoundEvaluator`, and this branch's default slate names six advisory
      // entries — which have no feature fold to overlay onto a wrapper, so
      // `evaluatorForSlate` refuses rather than silently dropping them. That
      // refusal is correct and is the point of this probe naming its slate: a
      // caller that hands in an evaluator the lineup cannot compose with is
      // asking about the DOOR, not about the potion doctrine.
      bot: { slate: SLATE_LEGACY },
      kernel: { reserveMs: 20, sliceMs: 10 },
    });
    const view = (snakeId: string): GameState =>
      ({
        game: { id: 'g', ruleset: { name: 'standard', version: '1' }, timeout: 500 },
        turn: entry.turn,
        board: entry.board as Board,
        you: (entry.board as Board).snakes.find((s) => s.id === snakeId) as Snake,
      }) as unknown as GameState;
    await engine.decideTurn({
      gameId: 'parts-precondition',
      turn: entry.turn,
      board: entry.board,
      ourTeamId: entry.ourTeamId,
      units: entry.units.map((snakeId) => ({ snakeId, view: view(snakeId) })),
      deadlineMs: WALL + BUDGET_MS,
    });

    // The decision priced branches — so the path was exercised…
    expect(counter.scoreCalls).toBeGreaterThan(0);
    // …and took the folded-total door every single time. Per-feature parts are
    // computed on every one of those calls and dropped at the bank.
    expect(counter.evalCalls).toBe(0);
  }, 60_000);
});
