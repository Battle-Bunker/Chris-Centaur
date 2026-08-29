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
  LEGACY_ENTRIES,
  LEGACY_SLATE,
  REGISTRY,
  SLATE_LEGACY,
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

  test('there is exactly ONE slate, and asking for another throws', () => {
    expect(slateFor()).toBe(LEGACY_SLATE);
    expect(slateFor(SLATE_LEGACY)).toBe(LEGACY_SLATE);
    // Selection of a non-legacy entry is the NEXT increment. Unrepresentable in
    // the type, and refused at run time for a caller that casts around it.
    expect(() => slateFor('greedy-voi' as typeof SLATE_LEGACY)).toThrow(/unknown slate/);
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
