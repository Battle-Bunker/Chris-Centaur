/**
 * THE PER-BRANCH BELIEF — the arithmetic, and the non-deciding law.
 *
 * The belief is the redesign's §3.1 posterior: a sound interval that moves only
 * by proof, and a density inside it that moves by any observation at its EARNED
 * precision. This file asserts the four properties everything downstream will
 * rest on:
 *
 *   1. PRECISION IS DERIVED, NOT CHOSEN. There is no tuning constant in the
 *      module, and the precision of a reading is a function of the interval it
 *      came with. That is the whole argument against the scout's constant cap,
 *      in its smallest form.
 *   2. THE MERGE IS THE PRECISION-WEIGHTED MERGE, including at both degenerate
 *      ends (an exact reading, and one that claims nothing).
 *   3. THE DENSITY LIVES INSIDE THE PROOF. `mu` is truncated into `[lo, hi]`
 *      after every operation, and a sound tighten never inflates precision.
 *   4. NON-DECIDING. Nothing that can move a decision imports the module — the
 *      lint rule that enforces it is exercised here against the real config, so
 *      a rule that stopped firing fails a test instead of failing silently.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  OBSERVATION_KINDS,
  beliefReportOf,
  emptyPosterior,
  foldObservation,
  posteriorOfBranch,
  precisionOfInterval,
  withSoundInterval,
} from '../belief';
import type { BranchPosterior } from '../belief';
import { DEAD, WIN } from '../evaluate/bound';

const near = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('earned precision is derived from the interval, never chosen', () => {
  test('half-width is one sigma: prec = 4 / width^2', () => {
    near(precisionOfInterval(0, 2), 1); // sigma 1
    near(precisionOfInterval(0, 4), 0.25); // sigma 2
    near(precisionOfInterval(-3, 1), 0.25); // sigma 2, wherever it sits
    near(precisionOfInterval(0, 1), 4); // sigma 1/2
    // Narrower is more precise, monotonically. This is the property the
    // redesign's "influence scales with the precision it earned, in BOTH
    // directions" reduces to.
    expect(precisionOfInterval(0, 1)).toBeGreaterThan(precisionOfInterval(0, 2));
  });

  test('a COLLAPSED interval is exact — infinite precision', () => {
    expect(precisionOfInterval(5, 5)).toBe(Number.POSITIVE_INFINITY);
    // The two lattice elements included: a branch proved dead in every world,
    // or proved won in every world, is exactly known.
    expect(precisionOfInterval(DEAD, DEAD)).toBe(Number.POSITIVE_INFINITY);
    expect(precisionOfInterval(WIN, WIN)).toBe(Number.POSITIVE_INFINITY);
  });

  test('an UNBOUNDED interval earns nothing — a position and no confidence', () => {
    expect(precisionOfInterval(DEAD, 10)).toBe(0);
    expect(precisionOfInterval(-10, WIN)).toBe(0);
    expect(precisionOfInterval(DEAD, WIN)).toBe(0);
    // An inverted interval cannot happen (the bank refuses one) and earns
    // nothing rather than a negative precision if it ever did.
    expect(precisionOfInterval(3, 1)).toBe(0);
  });

  test('the module holds no tuning constant to choose a precision with', () => {
    // The cap the redesign deletes was "at most one lattice step, ever". Its
    // replacement must not smuggle a second constant in: precision comes from
    // the interval, and nothing here scales it.
    const src = fs.readFileSync(path.join(__dirname, '..', 'belief.ts'), 'utf8');
    // Comments stripped: the prose cites section numbers and measured counts,
    // and neither is a constant the code can multiply by.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const numbers = new Set((code.match(/[^\w.]\d+(?:\.\d+)?/g) ?? []).map((m) => m.slice(1)));
    // The only numeric literals left are the ones the formula itself has:
    // sigma = width/2 gives prec = 4/width^2, 0 is the improper prior's
    // precision, and 1 is the provenance counter's increment. There is no
    // chosen scale, no floor, and no cap.
    expect([...numbers].sort()).toEqual(['0', '1', '2', '4']);
  });
});

describe('the precision-weighted merge', () => {
  test('the first observation lands whole on an improper prior', () => {
    // prec starts at 0, so (0*mu + pi*v)/(0+pi) = v. The limit, not a special
    // case: an empty posterior has no opinion to average against.
    const p = foldObservation(emptyPosterior(0, 10), {
      kind: 'evaluation',
      value: 7,
      precision: 4,
    });
    near(p.mu, 7);
    near(p.prec, 4);
  });

  test('two readings average in proportion to their precision', () => {
    let p = foldObservation(emptyPosterior(0, 10), {
      kind: 'bank-price',
      value: 2,
      precision: 1,
    });
    p = foldObservation(p, { kind: 'evaluation', value: 6, precision: 3 });
    // (1*2 + 3*6) / 4 = 5 — the confident reading pulls three times as hard.
    near(p.mu, 5);
    near(p.prec, 4);
  });

  test('an EXACT reading replaces the mean outright', () => {
    let p = foldObservation(emptyPosterior(0, 10), {
      kind: 'evaluation',
      value: 2,
      precision: 1000,
    });
    p = foldObservation(p, {
      kind: 'bank-price',
      value: 9,
      precision: Number.POSITIVE_INFINITY,
    });
    near(p.mu, 9);
    expect(p.prec).toBe(Number.POSITIVE_INFINITY);
    // …and nothing finite moves it afterwards. A proof is not outvoted by a
    // thousand opinions.
    const after = foldObservation(p, { kind: 'deep-finding', value: 0, precision: 1e9 });
    near(after.mu, 9);
    expect(after.prec).toBe(Number.POSITIVE_INFINITY);
  });

  test('a reading that claims NOTHING positions the mean and adds no confidence', () => {
    const p = foldObservation(emptyPosterior(DEAD, 10), {
      kind: 'evaluation',
      value: 4,
      precision: 0,
    });
    near(p.mu, 4);
    expect(p.prec).toBe(0);
    // And it does not erase a reading that did claim something.
    const q = foldObservation(
      foldObservation(emptyPosterior(0, 10), {
        kind: 'evaluation',
        value: 6,
        precision: 2,
      }),
      { kind: 'shadow', value: 1, precision: 0 }
    );
    near(q.mu, 6);
    near(q.prec, 2);
  });

  test('every fold is counted by kind, and nothing else is', () => {
    let p = emptyPosterior(0, 10);
    for (const kind of OBSERVATION_KINDS) {
      p = foldObservation(p, { kind, value: 5, precision: 1 });
    }
    for (const kind of OBSERVATION_KINDS) expect(p.provenance[kind]).toBe(1);
  });
});

describe('the density lives inside the proof', () => {
  test('mu is truncated into the sound support on every operation', () => {
    const p = foldObservation(emptyPosterior(2, 4), {
      kind: 'deep-finding',
      value: 100,
      precision: 9,
    });
    // However confident the observation, it cannot claim a value the sound
    // interval has excluded. This is the channel law in its smallest form.
    expect(p.mu).toBe(4);
    const q = foldObservation(emptyPosterior(2, 4), {
      kind: 'deep-finding',
      value: -100,
      precision: 9,
    });
    expect(q.mu).toBe(2);
  });

  test('a sound tighten narrows the support and does NOT add precision', () => {
    const p = foldObservation(emptyPosterior(0, 10), {
      kind: 'evaluation',
      value: 9,
      precision: 3,
    });
    const t = withSoundInterval(p, 0, 5);
    expect(t.lo).toBe(0);
    expect(t.hi).toBe(5);
    // The mean is re-truncated…
    expect(t.mu).toBe(5);
    // …and the precision is untouched: a proof that narrows the support does
    // not make a belief better informed, it makes some of it unreachable.
    near(t.prec, 3);
  });

  test('the legacy assembly reads the interval and the computed est', () => {
    const p = posteriorOfBranch(0, 4, 3);
    // Two observations at the same earned precision — the interval's midpoint
    // and the computed est — so the mean sits between them.
    near(p.prec, 2 * precisionOfInterval(0, 4));
    near(p.mu, 2.5);
    expect(p.provenance['bank-price']).toBe(1);
    expect(p.provenance.evaluation).toBe(1);
    expect(p.provenance.shadow).toBe(0);
    expect(p.provenance['deep-finding']).toBe(0);
  });

  test('the legacy assembly survives the lattice ends', () => {
    const dead = posteriorOfBranch(DEAD, DEAD, DEAD);
    expect(dead.prec).toBe(Number.POSITIVE_INFINITY);
    expect(dead.mu).toBe(DEAD);
    const wide = posteriorOfBranch(DEAD, 12, 5);
    expect(wide.prec).toBe(0);
    expect(Number.isNaN(wide.mu)).toBe(false);
    expect(wide.mu).toBeLessThanOrEqual(12);
    const won = posteriorOfBranch(3, WIN, 40);
    expect(won.prec).toBe(0);
    expect(won.mu).toBe(40);
  });
});

describe('the report folds what the branches carried', () => {
  test('exact, unbounded and finite branches are counted apart', () => {
    const rows: BranchPosterior[] = [
      posteriorOfBranch(1, 1, 1), // exact
      posteriorOfBranch(DEAD, 5, 2), // unbounded
      posteriorOfBranch(0, 4, 2), // finite
      posteriorOfBranch(0, 2, 1), // finite
    ];
    const rep = beliefReportOf(rows, rows[2]);
    expect(rep.branches).toBe(4);
    expect(rep.exact).toBe(1);
    expect(rep.unbounded).toBe(1);
    expect(rep.meanPrecision).not.toBeNull();
    expect(rep.staged).toBe(rows[2]);
    // Provenance sums over every branch: two observations each.
    expect(rep.provenance['bank-price']).toBe(4);
    expect(rep.provenance.evaluation).toBe(4);
    expect(rep.deciding).toBe(false);
  });

  test('no finite branch means NULL, not zero', () => {
    // The same distinction the mechanism report's nulls carry: "nothing had a
    // finite precision" is a different statement from "the mean was zero".
    const rep = beliefReportOf([posteriorOfBranch(DEAD, 5, 2)], null);
    expect(rep.meanPrecision).toBeNull();
    expect(rep.staged).toBeNull();
  });

  test('an empty decision reports nothing rather than throwing', () => {
    const rep = beliefReportOf([], null);
    expect(rep.branches).toBe(0);
    expect(rep.meanPrecision).toBeNull();
  });
});

describe('NON-DECIDING: no layer that can move a decision may import it', () => {
  test('the lint rule naming the four layers is present and names the module', () => {
    // The structural half of "carried, populated, and read by nothing". A
    // deleted or renamed rule would leave the property true only by habit, so
    // the rule itself is asserted — and `registry.test.ts` asserts the module
    // reads no environment, which is the other half of "this is data".
    const cfg = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'eslint.config.js'),
      'utf8'
    );
    expect(cfg).toContain('BELIEF_PATTERN');
    for (const layer of [
      'src/lobster/bounds/**/*.ts',
      'src/lobster/search/**/*.ts',
      'src/lobster/evaluate/**/*.ts',
      'src/lobster/selection/**/*.ts',
    ]) {
      expect(cfg).toContain(layer);
    }
  });

  test('the module imports nothing at all', () => {
    // It cannot participate in a comparison even by accident: it has no
    // dependency to reach one through. Every consumer imports IT.
    const src = fs.readFileSync(path.join(__dirname, '..', 'belief.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
