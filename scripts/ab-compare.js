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
  'rates.grownMealsPer100',
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
  // D1's instrument (docs/design/BEHAVIOUR-AUDIT.md): how often a unit walks at
  // the square an enemy is standing on, and how often it loses there.
  'rates.enemyOccupiedEntriesPer100',
  'rates.enemyOccupiedEntriesLostPer100',
  'counters.longestPark',
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
  'rates.enemyOccupiedEntriesLostPer100',
  'counters.longestPark',
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

// THE OPPONENT IS PART OF THE PAIR, exactly like the board class and the
// seed: `mixed` mirror-self-play and `mixed` against `material-only` are
// different experiments over the same board, and pooling them would average
// a change's effect against a mirror with its effect against a diversified
// field — two different questions with two different answers. A run with no
// `opponent` field (a mirror run, from before this flag existed or from a
// build that never passed it) keys on the literal string 'none' rather than
// on `undefined`, so it prints and pairs like any other named arm instead of
// vanishing from a `Map` key.
const opponentOf = (run) => run.opponent ?? 'none';
// AND SO IS WHAT A MEAL IS WORTH. `sparse` and `sparse` at `foodEnergy: 50` are
// the same geometry under two different food rules — every meal fills and grows
// on one, only the meal that tops a tank off grows on the other — so they pair
// no more than two different boards do. A run with no `foodEnergy` field (every
// scenario but `sparse-lean`, and every summary taken before the field existed)
// keys on the literal string 'default', for the same reason `opponent` keys on
// 'none': an `undefined` in a `Map` key would make it vanish rather than print.
const foodEnergyOf = (run) => (run.foodEnergy === undefined ? 'default' : String(run.foodEnergy));
// AND SO IS WHICH SIDE PLAYED US. `--side=1` is the same board from the other
// colour: an asymmetric roster gives the two slots different openings, so a
// swapped arm and an unswapped one pair no more than two boards do. A summary
// with no `side` field is slot 0 — every arm taken before the swap existed.
const sideOf = (run) => (run.side === undefined ? 0 : Number(run.side));
const keyOf = (run) =>
  `${run.scenario}|${run.seed}|${opponentOf(run)}|${foodEnergyOf(run)}|${sideOf(run)}`;
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
  // --- outcome instrument (ENDGAME): one entry per arm, counted at the end.
  const outcomeVerdicts = [];
  // --- end outcome instrument -----------------------------------------------
  for (const scenario of scenarios) {
    // OPPONENTS ARE NEVER POOLED, same rule as board classes: a mirror run
    // ('none') and a run against 'material-only' are different experiments
    // over the same board, so each gets its own block below rather than a
    // shared mean across both.
    // WHAT A MEAL IS WORTH SPLITS THE BLOCK TOO, for the same reason: the same
    // board under two food rules is two experiments.
    const arms = [
      ...new Set(
        before
          .filter((r) => r.scenario === scenario)
          .map((r) => `${opponentOf(r)}|${foodEnergyOf(r)}|${sideOf(r)}`)
      ),
    ].sort();
    for (const arm of arms) {
      const [opponent, foodEnergy, side] = arm.split('|');
      const pairKey = (seed) => `${scenario}|${seed}|${opponent}|${foodEnergy}|${side}`;
      const seeds = before
        .filter(
          (r) =>
            r.scenario === scenario &&
            opponentOf(r) === opponent &&
            foodEnergyOf(r) === foodEnergy &&
            String(sideOf(r)) === side
        )
        .map((r) => r.seed)
        .filter((seed) => byKeyB.has(pairKey(seed)))
        .sort((a, b) => a - b);
      const label =
        (opponent === 'none' ? scenario : `${scenario} / opponent=${opponent}`) +
        (foodEnergy === 'default' ? '' : ` / foodEnergy=${foodEnergy}`) +
        (side === '0' ? '' : ` / side=${side}`);
      process.stdout.write(`\n=== ${label}  (${seeds.length} paired seeds) ===\n`);
      if (seeds.length === 0) continue;

      for (const seed of seeds) {
        const a = byKeyA.get(pairKey(seed));
        const b = byKeyB.get(pairKey(seed));
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

      // Deaths by cause is a per-board dictionary and belongs to the board, so
      // it is printed per scenario/opponent rather than folded into a rate.
      const causes = [
        ...new Set(
          seeds.flatMap((seed) => [
            ...Object.keys(byKeyA.get(pairKey(seed)).deathsByCause ?? {}),
            ...Object.keys(byKeyB.get(pairKey(seed)).deathsByCause ?? {}),
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

      // --- THE OUTCOME SECTION (ENDGAME) ---------------------------------
      //
      // WHAT THE GAME SCORES, printed before the process counters because it
      // is the thing the counters are proxies for. Two readings, and they
      // answer different questions:
      //
      //  * W/D/L AND THE WIN RATE. A count over the seeds — a game's result is
      //    not per unit-turn and dividing it by one would be a number with no
      //    referent. `winRate` scores a draw as half a win, which is the only
      //    scoring under which "beat the opponent more often" and "lose less
      //    often" are the same statement.
      //
      //  * A PAIRED SIGN TEST ON THE LEAD AT THE CAP. The verdict is three
      //    valued and a five-seed W/D/L moves in steps of 0.2, so it has
      //    almost no power; the MARGIN the cap is decided on is continuous,
      //    paired by seed, and is the quantity a sign test can actually read.
      //    A change that turns three level boards into three one-weight leads
      //    shows up here and nowhere else — and it is the honest early signal
      //    that a win-rate change is coming, not a substitute for one.
      //
      // MIRROR ARMS ARE REPORTED AND MEAN LITTLE. In self-play both teams fold
      // the same profile, so an outcome there is a fact about the board's
      // asymmetry, not about the change. The arm that carries the question is
      // the one against a named `--opponent`.
      const outcomeRows = seeds
        .map((seed) => ({
          seed,
          a: byKeyA.get(pairKey(seed)).outcome,
          b: byKeyB.get(pairKey(seed)).outcome,
        }))
        .filter((r) => r.a !== undefined && r.b !== undefined);
      if (outcomeRows.length > 0) {
        const tally = (get) => {
          const rs = outcomeRows.map(get).map((o) => o.result);
          const w = rs.filter((r) => r === 'win').length;
          const d = rs.filter((r) => r === 'draw').length;
          const l = rs.filter((r) => r === 'loss').length;
          return { w, d, l, rate: (w + 0.5 * d) / rs.length };
        };
        const ta = tally((r) => r.a);
        const tb = tally((r) => r.b);
        const leadDeltas = outcomeRows.map((r) => r.b.lead - r.a.lead);
        const st = signTest(leadDeltas);
        const meanLeadA = mean(outcomeRows.map((r) => r.a.lead));
        const meanLeadB = mean(outcomeRows.map((r) => r.b.lead));
        const kinds = (get) => {
          const k = {};
          for (const r of outcomeRows) k[get(r).kind] = (k[get(r).kind] ?? 0) + 1;
          return JSON.stringify(k);
        };
        process.stdout.write(
          `  outcome  A: W${ta.w}/D${ta.d}/L${ta.l} winRate=${ta.rate.toFixed(3)} ` +
            `lead=${meanLeadA.toFixed(2)} kinds=${kinds((r) => r.a)}\n` +
            `  outcome  B: W${tb.w}/D${tb.d}/L${tb.l} winRate=${tb.rate.toFixed(3)} ` +
            `lead=${meanLeadB.toFixed(2)} kinds=${kinds((r) => r.b)}\n` +
            `  outcome  delta winRate=${(tb.rate - ta.rate).toFixed(3)} ` +
            `delta lead=${(meanLeadB - meanLeadA).toFixed(2)} ` +
            `sign(lead) ${st.up}/${st.down} p=${st.p.toFixed(3)}\n` +
            `  outcome  per seed: ` +
            outcomeRows
              .map(
                (r) =>
                  `${r.seed}:${r.a.result[0].toUpperCase()}${r.a.lead >= 0 ? '+' : ''}${r.a.lead}` +
                  `->${r.b.result[0].toUpperCase()}${r.b.lead >= 0 ? '+' : ''}${r.b.lead}`
              )
              .join(' ') +
            '\n'
        );
        outcomeVerdicts.push({
          scenario,
          opponent,
          side,
          deltaWinRate: tb.rate - ta.rate,
          deltaLead: meanLeadB - meanLeadA,
        });
      }
      // --- end outcome section ----------------------------------------------

      const head = ['metric'.padEnd(34), ...seeds.map((s) => `seed${s}`.padStart(9))].join(' ');
      process.stdout.write(`${head}      mean A    mean B       delta   sign(p)\n`);
      for (const row of rows) {
        const as = seeds.map((s) => byKeyA.get(pairKey(s))).map(row.get);
        const bs = seeds.map((s) => byKeyB.get(pairKey(s))).map(row.get);
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
          verdicts.push({ scenario, opponent, metric: row.name, delta: md, p: st.p });
        }
      }
    }
  }

  // A COUNT, never a mean — and grouped by opponent for the same reason every
  // block above is: a board that flips one way under a mirror and the other
  // way against `material-only` is two facts, not one averaged-away number.
  for (const opponent of [...new Set(verdicts.map((v) => v.opponent))].sort()) {
    process.stdout.write(
      `\n=== across board classes${opponent === 'none' ? '' : ` / opponent=${opponent}`} (a COUNT, never a mean) ===\n`
    );
    const forOpponent = verdicts.filter((v) => v.opponent === opponent);
    for (const metric of [...new Set(forOpponent.map((v) => v.metric))]) {
      const vs = forOpponent.filter((v) => v.metric === metric);
      const up = vs.filter((v) => v.delta > 0).length;
      const down = vs.filter((v) => v.delta < 0).length;
      process.stdout.write(
        `${metric.padEnd(24)} up on ${up}/${vs.length} boards, down on ${down}, ` +
          `flat on ${vs.length - up - down}\n`
      );
    }
  }
  // --- THE OUTCOME COUNT ACROSS BOARD CLASSES (ENDGAME) --------------------
  // A COUNT, never a mean, for the same reason the counter version above is:
  // "up on two boards and down on none" is the keep rule's own sentence, and
  // it is only readable as a count. Mirror arms are listed separately from
  // the arms against a named opponent, because only the second kind carries
  // the question.
  if (outcomeVerdicts.length > 0) {
    for (const opponent of [...new Set(outcomeVerdicts.map((v) => v.opponent))].sort()) {
      const forOpponent = outcomeVerdicts.filter((v) => v.opponent === opponent);
      process.stdout.write(
        `\n=== outcomes across board classes` +
          `${opponent === 'none' ? ' (MIRROR — symmetric, reported not read)' : ` / opponent=${opponent}`}` +
          ` (a COUNT, never a mean) ===\n`
      );
      for (const field of ['deltaWinRate', 'deltaLead']) {
        const up = forOpponent.filter((v) => v[field] > 0).length;
        const down = forOpponent.filter((v) => v[field] < 0).length;
        process.stdout.write(
          `${field.padEnd(24)} up on ${up}/${forOpponent.length} arms, down on ${down}, ` +
            `flat on ${forOpponent.length - up - down}\n`
        );
      }
      for (const v of forOpponent) {
        process.stdout.write(
          `  ${`${v.scenario}${v.side === '0' ? '' : `/side=${v.side}`}`.padEnd(24)} ` +
            `winRate ${v.deltaWinRate >= 0 ? '+' : ''}${v.deltaWinRate.toFixed(3)}  ` +
            `lead ${v.deltaLead >= 0 ? '+' : ''}${v.deltaLead.toFixed(2)}\n`
        );
      }
    }
  }
  // --- end outcome count ----------------------------------------------------
  if (unmatched.length > 0) {
    process.stdout.write(`\nunpaired runs (excluded):\n  ${unmatched.join('\n  ')}\n`);
  }
}

main();
