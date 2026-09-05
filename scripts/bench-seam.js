#!/usr/bin/env node
/**
 * THE SEAM BENCHMARK — ms per node, and nodes per decision, on a fixed spec.
 *
 * WHY IT EXISTS. The lobster kernel is an ANYTIME search: give it more time
 * and it refines further, so wall-clock alone says nothing — a build that is
 * half as fast produces a different (worse) decision in the same budget rather
 * than the same decision more slowly. The unit that IS comparable across
 * builds is the cost of one unit of search, and the deterministic mode
 * (`--nodes`) is what makes it measurable: the same build and seed spend the
 * SAME number of nodes, so the only thing that moves between builds is the
 * time each node costs.
 *
 *     ms/node = wall time of the run / nodes the run spent
 *
 * A behaviour change moves `nodes`; a throughput change moves `ms/node`. This
 * script prints both, plus nodes/decision, so a regression in either is
 * visible and they cannot be confused for each other.
 *
 * WHAT IT RUNS. A fixed spec — `mixed`, `snakes`, `sparse` and `potions`, 40
 * turns, seed 1, at the default node budget — in a CHILD PROCESS per case, so
 * one case's caches and heap cannot pay for the next one's. Nothing here
 * asserts: it is an instrument, and the gate that asserts is
 * `basic-intelligence.test.ts`.
 *
 *     node scripts/bench-seam.js                 # the fixed spec
 *     node scripts/bench-seam.js mixed 20        # one scenario, 20 turns
 *     node scripts/bench-seam.js all 40 3        # seeds 1..3
 */

const { execFileSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, '..', 'dist', 'tests', 'local-game.js');
const DEFAULT_SCENARIOS = ['mixed', 'snakes', 'sparse', 'potions'];

function runOne(scenario, turns, seed) {
  const started = process.hrtime.bigint();
  const out = execFileSync(
    process.execPath,
    [RUNNER, scenario, String(turns), String(seed), '120', '--nodes', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }
  );
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (line === undefined) throw new Error(`${scenario}/${seed}: no JSON summary`);
  const summary = JSON.parse(line);
  return { ms, ...summary.work };
}

function main() {
  if (!existsSync(RUNNER)) {
    console.error(`no build at ${RUNNER} — run \`npx tsc\` first`);
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const which = argv[0] ?? 'all';
  const turns = Number(argv[1] ?? 40);
  const seeds = Number(argv[2] ?? 1);
  const scenarios = which === 'all' ? DEFAULT_SCENARIOS : which.split(',');

  console.log(`bench-seam: ${turns} turns, seeds 1..${seeds}, deterministic node budget`);
  console.log(
    `${'scenario'.padEnd(10)}${'seed'.padStart(5)}${'nodes'.padStart(10)}` +
      `${'decisions'.padStart(11)}${'nodes/dec'.padStart(11)}${'ms'.padStart(10)}${'ms/node'.padStart(10)}`
  );
  let totalMs = 0;
  let totalNodes = 0;
  for (const scenario of scenarios) {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = runOne(scenario, turns, seed);
      totalMs += r.ms;
      totalNodes += r.nodes;
      console.log(
        scenario.padEnd(10) +
          String(seed).padStart(5) +
          String(r.nodes).padStart(10) +
          String(r.decisions).padStart(11) +
          (r.nodes / r.decisions).toFixed(1).padStart(11) +
          r.ms.toFixed(0).padStart(10) +
          (r.ms / r.nodes).toFixed(4).padStart(10)
      );
    }
  }
  console.log(
    `${'TOTAL'.padEnd(10)}${''.padStart(5)}${String(totalNodes).padStart(10)}` +
      `${''.padStart(11)}${''.padStart(11)}${totalMs.toFixed(0).padStart(10)}` +
      `${(totalMs / totalNodes).toFixed(4).padStart(10)}`
  );
}

main();
