/** SEARCH-THEORY probe (not for commit): is `accept`'s relation acyclic? */
import { posteriorOfBranch, foldObservation, precisionOfSigma } from '../belief';
import { refutedAt } from '../bounds/witness';

type B = { lo: number; hi: number; est: number; deep?: { value: number; sigma: number } };

const beliefOf = (b: B) => {
  const post = posteriorOfBranch(b.lo, b.hi, b.est);
  if (b.deep === undefined) return post;
  return foldObservation(post, {
    kind: 'deep-finding',
    value: b.deep.value,
    precision: precisionOfSigma(b.deep.sigma),
    plies: 2,
  } as never);
};

/** core.ts::accept, with basis always equal and the tie key omitted. */
const accept = (t: B, i: B, anyDeep: boolean): boolean => {
  if (refutedAt(t.hi, i.lo)) return false;
  // compareFloors: same basis => comparable
  if (anyDeep) {
    const a = t.deep, b = i.deep;
    if (!(a === undefined && b === undefined)) {
      if (!refutedAt(i.hi, t.lo)) {
        const pa = beliefOf(t), pb = beliefOf(i);
        if (pa.mu !== pb.mu) return pa.mu > pb.mu;
        if (pa.prec !== pb.prec) return pa.prec > pb.prec;
      }
    }
  }
  if (t.lo !== i.lo) return t.lo > i.lo;
  if (t.est !== i.est) return t.est > i.est;
  if (t.hi !== i.hi) return t.hi > i.hi;
  return false;
};

test('accept() admits a 3-cycle once the depth rung speaks', () => {
  const A: B = { lo: 0, hi: 12, est: 6, deep: { value: 9, sigma: 0.5 } };
  const B_: B = { lo: 5, hi: 5.2, est: 5.1 };
  const C: B = { lo: 4, hi: 20, est: 19 };
  const mu = (x: B) => beliefOf(x).mu;
  // eslint-disable-next-line no-console
  console.log('mu:', { A: mu(A), B: mu(B_), C: mu(C) });
  // eslint-disable-next-line no-console
  console.log('A>B', accept(A, B_, true), 'B>C', accept(B_, C, true), 'C>A', accept(C, A, true));
  expect(accept(A, B_, true) && accept(B_, C, true) && accept(C, A, true)).toBe(true);
});
