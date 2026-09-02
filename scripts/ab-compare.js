#!/usr/bin/env node
/**
 * PAIRED A/B OVER TWO BUILDS OF THE LOCAL RUNNER.
 *
 * Two builds of this bot cannot coexist in one process — the evaluator, the
 * kernel and the substrate are all module-level singletons of one checkout —
 * so there is no `ab` subcommand inside the runner and there is not going to
 * be one. The paired experiment is run instead as two builds, each writing one
 * JSON summary per (scenario, seed):
 *
 *     # in worktree A                      # in worktree B
 *     npx tsc && node dist/tests/local-game.js \
 *         sum all 60 5 --nodes --json=A.jsonl --label=before
 *     ...and the same with --json=B.jsonl --label=after
 *
 *     node scripts/ab-compare.js A.jsonl B.jsonl
 *
 * and this script does the subtraction. It takes a file of JSON Lines, a file
 * holding a JSON array, or a directory of either.
 *
 * TWO RULES IT ENFORCES, because both were got wrong before:
 *
 *  1. NOTHING IS EVER POOLED ACROSS BOARD CLASSES. `snakes`, `mixed` and
 *     `sparse` have different rosters, different food densities and different
 *     death causes; a mean over the three is a number with no referent, and it
 *     hides a change that helps snakes and wrecks pieces. Every statistic here
 *     is computed per scenario and printed per scenario. The only cross-board
 *     line is a COUNT of which way each board went.
 *
 *  2. PAIRING IS BY SEED, and a pair is only a pair when both arms ran the
 *     same board at the same seed for the same turn count on the same budget.
 *     Anything unmatched is reported, never silently dropped or averaged in.
 *
 * The paired mean is reported with a SIGN TEST (exact two-sided binomial over
 * the seeds whose delta is nonzero) rather than a t-test: five seeds of a game
 * counter are not normal, and the question being asked is "did this move the
 * needle the same way on most boards", which is exactly what the sign test
 * answers. It is a weak test on five seeds by construction — p can never fall
 * below 0.0625 — and that is the honest reading, not a defect to tune away.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The metrics compared by default: rates first (the only comparable form —
// a run that died early has fewer unit-turns and therefore fewer of
// everything), then the raw sizes that say whether the run itself changed.
const DEFAULT_METRICS = [
  'rates.mealsPer100',
  'rates.deathsPer100',
  'rates.reversalsPer100',
  'rates.unjustifiedReversalsPer100',
  'rates.dithersPer100',
  'rates.stationaryPer100',
  'rates.seedKeptPer100',
  'rates.potionPickupsPer100',
  'rates.potionTierUpsPer100',
  'counters.unitTurns',
  'counters.turns',
  'counters.deathsWhileDebuffed',
  'counters.deathsWhileBuffed',
];

/** Lower is better for these; everything else reads "higher is better". */
const LOWER_IS_BETTER = new Set([
  'rates.deathsPer100',
  'rates.reversalsPer100',
  'rates.unjustifiedReversalsPer100',
  'rates.dithersPer100',
  'rates.stationaryPer100',
  'rates.seedKeptPer100',
  'counters.deathsWhileDebuffed',
]);

function readRuns(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(target)
      .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
      .sort()
      .flatMap((f) => readRuns(path.join(target, f)));
  }
  const text = fs.readFileSync(target, 'utf8').trim();
  if (text === '') return [];
  if (text.startsWith('[')) return JSON.parse(text);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${target}:${i + 1} is not JSON: ${err.message}`);
      }
    });
}

const keyOf = (run) => `${run.scenario}|${run.seed}`;
const pick = (run, dotted) =>
  dotted.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), run);

/**
 * Exact two-sided binomial test against p = 1/2 — the sign test.
 * Zero-delta pairs carry no sign and are excluded, which is the standard
 * treatment and is also the only one that keeps "no change at all" from
 * reading as evidence of a change.
 */
function signTest(deltas) {
  const nonzero = deltas.filter((d) => d !== 0);
  const n = nonzero.length;
  const up = nonzero.filter((d) => d > 0).length;
  if (n === 0) return { n: 0, up: 0, down: 0, p: 1 };
  const choose = (a, b) => {
    let r = 1;
    for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
    return r;
  };
  const extreme = Math.min(up, n - up);
  let tail = 0;
  for (let k = 0; k <= extreme; k++) tail += choose(n, k);
  const p = Math.min(1, (2 * tail) / Math.pow(2, n));
  return { n, up, down: n - up, p };
}

const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const fmt = (x, w = 9) => {
  const s = Number.isInteger(x) ? String(x) : x.toFixed(3);
  return s.padStart(w);
};

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const eq = a.indexOf('=');
        return eq === -1 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
      })
  );
  if (args.length !== 2 || flags.help) {
    process.stdout.write(
      'usage: node scripts/ab-compare.js <before.jsonl|dir> <after.jsonl|dir> ' +
        '[--metrics=a,b,c] [--all-metrics]\n'
    );
    process.exit(args.length === 2 ? 0 : 1);
  }

  const before = readRuns(args[0]);
  const after = readRuns(args[1]);
  if (before.length === 0 || after.length === 0) {
    process.stderr.write('one side has no runs in it\n');
    process.exit(1);
  }

  const labelA = before[0].label ?? path.basename(args[0]);
  const labelB = after[0].label ?? path.basename(args[1]);

  // The reproducibility warning, printed loudly and first: a paired diff of two
  // wall-clock-budgeted runs is a diff of two machine loads.
  const modes = new Set([...before, ...after].map((r) => r.mode));
  if (modes.has('ms')) {
    process.stdout.write(
      '!! WARNING: some runs are wall-clock budgeted (mode "ms"). Those counters\n' +
        '!! are not reproducible at a fixed seed, so every delta below is noise\n' +
        '!! plus signal and there is no way to tell which is which. Re-run both\n' +
        '!! arms with --nodes.\n\n'
    );
  }
  if (modes.size > 1) process.stdout.write('!! WARNING: the two arms used different budget modes.\n\n');

  const byKeyA = new Map(before.map((r) => [keyOf(r), r]));
  const byKeyB = new Map(after.map((r) => [keyOf(r), r]));
  const unmatched = [
    ...[...byKeyA.keys()].filter((k) => !byKeyB.has(k)).map((k) => `${k} only in ${labelA}`),
    ...[...byKeyB.keys()].filter((k) => !byKeyA.has(k)).map((k) => `${k} only in ${labelB}`),
  ];

  const metrics = flags.metrics
    ? String(flags.metrics).split(',')
    : flags['all-metrics']
      ? [
          ...new Set(
            [...before, ...after].flatMap((r) =>
              ['rates', 'counters', 'work'].flatMap((g) =>
                Object.keys(r[g] ?? {}).map((k) => `${g}.${k}`)
              )
            )
          ),
        ].sort()
      : DEFAULT_METRICS;

  const scenarios = [...new Set(before.map((r) => r.scenario))].sort();
  process.stdout.write(`A = ${labelA}   B = ${labelB}   (delta = B - A)\n`);

  const verdicts = [];
  for (const scenario of scenarios) {
    const seeds = before
      .filter((r) => r.scenario === scenario)
      .map((r) => r.seed)
      .filter((seed) => byKeyB.has(`${scenario}|${seed}`))
      .sort((a, b) => a - b);
    process.stdout.write(`\n=== ${scenario}  (${seeds.length} paired seeds) ===\n`);
    if (seeds.length === 0) continue;

    for (const seed of seeds) {
      const a = byKeyA.get(`${scenario}|${seed}`);
      const b = byKeyB.get(`${scenario}|${seed}`);
      for (const field of ['budget', 'mode', 'turnsRequested']) {
        if (a[field] !== b[field]) {
          process.stdout.write(
            `  !! seed ${seed}: ${field} differs (${a[field]} vs ${b[field]}) — not a pair\n`
          );
        }
      }
      if (a.crashed || b.crashed) {
        process.stdout.write(`  !! seed ${seed} crashed: A=${a.crashed} B=${b.crashed}\n`);
      }
    }

    // Deaths by cause is a per-board dictionary and belongs to the board, so it
    // is printed per scenario rather than folded into a rate.
    const causes = [
      ...new Set(
        seeds.flatMap((seed) => [
          ...Object.keys(byKeyA.get(`${scenario}|${seed}`).deathsByCause ?? {}),
          ...Object.keys(byKeyB.get(`${scenario}|${seed}`).deathsByCause ?? {}),
        ])
      ),
    ].sort();

    const rows = [
      ...metrics.map((m) => ({ name: m, get: (r) => pick(r, m) })),
      ...causes.map((c) => ({
        name: `deaths.${c}`,
        get: (r) => (r.deathsByCause ?? {})[c] ?? 0,
        lowerIsBetter: true,
      })),
    ];

    const head = ['metric'.padEnd(34), ...seeds.map((s) => `seed${s}`.padStart(9))].join(' ');
    process.stdout.write(`${head}      mean A    mean B       delta   sign(p)\n`);
    for (const row of rows) {
      const as = seeds.map((s) => byKeyA.get(`${scenario}|${s}`)).map(row.get);
      const bs = seeds.map((s) => byKeyB.get(`${scenario}|${s}`)).map(row.get);
      if (as.some((v) => v === undefined) && bs.some((v) => v === undefined)) continue;
      const A = as.map((v) => v ?? 0);
      const B = bs.map((v) => v ?? 0);
      const deltas = A.map((v, i) => B[i] - v);
      const st = signTest(deltas);
      const lower = row.lowerIsBetter ?? LOWER_IS_BETTER.has(row.name);
      const md = mean(deltas);
      const mark = md === 0 ? ' ' : (md > 0) === !lower ? '+' : '-';
      process.stdout.write(
        [
          row.name.padEnd(34),
          ...deltas.map((d) => fmt(d)),
          fmt(mean(A), 11),
          fmt(mean(B), 10),
          fmt(md, 11),
          ` ${st.up}/${st.down} p=${st.p.toFixed(3)} ${mark}`,
        ].join(' ') + '\n'
      );
      if (row.name === 'rates.mealsPer100' || row.name === 'rates.deathsPer100') {
        verdicts.push({ scenario, metric: row.name, delta: md, p: st.p });
      }
    }
  }

  process.stdout.write('\n=== across board classes (a COUNT, never a mean) ===\n');
  for (const metric of [...new Set(verdicts.map((v) => v.metric))]) {
    const vs = verdicts.filter((v) => v.metric === metric);
    const up = vs.filter((v) => v.delta > 0).length;
    const down = vs.filter((v) => v.delta < 0).length;
    process.stdout.write(
      `${metric.padEnd(24)} up on ${up}/${vs.length} boards, down on ${down}, ` +
        `flat on ${vs.length - up - down}\n`
    );
  }
  if (unmatched.length > 0) {
    process.stdout.write(`\nunpaired runs (excluded):\n  ${unmatched.join('\n  ')}\n`);
  }
}

main();
