#!/usr/bin/env node
/*
 * GENERATE THE SPEC LIBRARY.
 *
 *   node tools/simworker/bin/make-specs.js [--out tools/simworker/specs] [--blocks 16]
 *
 * The committed specs under `tools/simworker/specs/` were produced by this
 * script. It is committed alongside them so a cell can be re-cut — more seeds,
 * a different budget, a roster the program has not tried — without hand-editing
 * JSON and without the axes drifting apart between cells.
 *
 * ── THE SHAPE EVERYTHING IS BUILT AROUND ───────────────────────────────────
 *
 * The owner's target: "2s turns, 3 teams * 6 units each, 25x25 boards". 25 is
 * the harness's maximum board size, so this is the top of the supported range
 * in every dimension at once. Everything below is that shape with ONE axis
 * moved at a time.
 *
 * ── SEEDS AND BLOCKS ───────────────────────────────────────────────────────
 *
 * A BLOCK is one seed played through every cyclic seat rotation — 3 games on a
 * 3-team board. Blocks, not games, are the unit of resampling. `--blocks 16` is
 * the floor for a PLACEMENT claim; 4-8 is enough for mechanism-first
 * exploration, which is what a first pass at a new cell should be.
 *
 * Seeds are a fixed arithmetic sequence from a per-cell base, so two batches of
 * the same cell at different block counts NEST: the 16-block run contains the
 * 8-block run's seeds. That makes "we added blocks" a strictly stronger
 * statement rather than a different experiment.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const outDir = path.resolve(arg('out', path.join(__dirname, '..', 'specs')));
const BLOCKS = Number(arg('blocks', '16'));
const BUDGET = Number(arg('budget', '2000'));
const SIZE = Number(arg('size', '25'));
const TURN_CAP = Number(arg('cap', '120'));
const SEED_BASE = Number(arg('seed-base', '4001'));

const TEAMS = ['red', 'blue', 'green'];

/**
 * ROSTERS — six units a side, the owner's shape, varied by what pieces are on
 * the board.
 *
 * `snake6` is not merely one more roster. It is the NULL ROSTER for every
 * treatment that is gated on piece class: I2's slider profile adds terms that
 * are switched off when nothing on the board is a piece (asserted in
 * src/tests/territory-slider.test.ts), and the staging-safety guard's whole
 * regression is a snake-only phenomenon. On this roster those arms are
 * bit-identical to their baseline, so the contrast measured there is the
 * run-to-run noise floor and nothing else — a null that rides along inside the
 * treatment batch instead of costing a separate pair.
 */
const ROSTERS = {
  snake6: ['snake', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-pawn': ['pawn', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-knight': ['knight', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'snake5-queen': ['queen', 'snake', 'snake', 'snake', 'snake', 'snake'],
  'mix-king': ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
};

/** Board-condition axes, one step off the baseline each. */
const POTIONS = {
  off: { enabled: false },
  on: { enabled: true, spawnRate: 0.15, initial: 2, effectTurns: 3 },
};
const HAZARDS = {
  none: { layout: 'none' },
  // "Interior" hazards. `border` is the edge and `random` is not reproducible
  // across board sizes in a way a reader can picture, so the interior arm is
  // `cross` — a deterministic pair of bands through the middle that every team
  // must cross or route around, at the default damageRatio (0.15 of the
  // reference kind's max health, i.e. a COST rather than a wall).
  interior: { layout: 'cross', damageRatio: 0.15 },
};
const FOOD = {
  normal: { initial: 6, spawnRate: 0.5 },
  sparse: { initial: 4, spawnRate: 0.15 },
};

function seedsFor(cellName, blocks) {
  // A stable per-cell offset so two different cells never share a seed
  // sequence — identical seeds across cells would correlate their noise.
  let h = 0;
  for (const ch of cellName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = SEED_BASE + (h % 1000) * 100;
  return Array.from({ length: blocks }, (_, i) => base + i);
}

function cell(name, { roster, potions = 'off', hazards = 'none', food = 'normal' }) {
  return {
    cell: name,
    config: {
      name,
      size: SIZE,
      teams: TEAMS,
      roster: ROSTERS[roster],
      budgetMs: BUDGET,
      turnCap: TURN_CAP,
      food: FOOD[food],
      hazards: HAZARDS[hazards],
      potions: POTIONS[potions],
    },
  };
}

/**
 * Bots seated in EVERY arm of a cross-build comparison.
 *
 * The contender sits in one seat and a fixed reference field fills the others.
 * `lobster-material` and `reflex` are the field: they are not the subject of
 * any claim, they are there so the subject has something to play against that
 * is the same in both arms.
 *
 * READ THE CAVEAT. In a CROSS-BRANCH pair the field is compiled from each
 * branch too, so "the same in both arms" is an assumption, not a guarantee —
 * it holds exactly to the extent the branches did not change those paths. That
 * is precisely what the A/A null and the inert `snake6` cell are for: if the
 * field moved, the null moves with it and the batch says so.
 */
const FIELD = ['lobster-territory', 'lobster-material', 'reflex'];

function spec(sweepId, comment, cells, bots = FIELD, blocks = BLOCKS) {
  const seeds = seedsFor(sweepId, blocks);
  return {
    _comment: comment,
    sweepId,
    bots,
    seeds,
    rotateSeats: true,
    cells,
  };
}

const specs = [];

// ---------------------------------------------------------------- P0 pilot
specs.push(spec(
  'p0-pilot',
  [
    'THROUGHPUT PILOT — run this FIRST on a new machine, before any real batch.',
    'Two blocks, one cell, at the headline shape. Its only job is to tell you how',
    'long one game of the real thing takes on YOUR box, so the overnight batch can',
    'be sized instead of guessed. Read `games/hour` off the runner output and',
    'multiply: a 16-block cell is 48 games per arm.',
    'Do NOT quote anything from this run. Two blocks resolve nothing.',
  ],
  [cell('headline-mix-king', { roster: 'mix-king' })],
  FIELD,
  2
));

// ------------------------------------------- P1 integrated vs perf-substrate
specs.push(spec(
  'p1-substrate-headline',
  [
    'P1 — does the perf substrate change STRENGTH, or only speed?',
    '',
    'Arms are two BUILDS: `integrated` (claude/mid-turn-collision-logic-mkxurg) and',
    '`perf-substrate` (claude/cluster-lookahead). Both run their shipped defaults.',
    'This is the question the whole substrate programme has deferred: W1/W2/W3 and',
    'CL0 were measured as throughput, and a throughput change that moves the number',
    'of plans a 2000ms budget can price is a STRENGTH change whether or not anyone',
    'intended it. At 2000ms there is enough budget for that to show.',
    '',
    'snake6 is the inert-roster null cell and mix-king is the headline. Run the A/A',
    'null pair alongside (spec n0-aa-null) in the same batch, on the same box.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('null-snake6', { roster: 'snake6' }),
    cell('snake5-queen', { roster: 'snake5-queen' }),
  ]
));

// ------------------------------------------------ P2 integrated vs legacy
specs.push(spec(
  'p2-legacy-rebaseline',
  [
    'P2 — the deployed-relevant re-baseline at the owner\'s target shape.',
    '',
    'ONE build, TWO seat assignments is NOT how this runs. Both arms are the same',
    'bundle; the arms differ by CENTAUR_ENGINE (lobster vs legacy), which selects',
    'which engine drives the full pass.',
    '',
    'BUDGET WARNING, and it is the reason this cell is at 2000ms and not lower:',
    'legacy\'s chunk dispatch is not preemptible. At 150ms it overruns to ~1s and',
    'its own telemetry reports statesEvaluated: 0, chunksCompleted: 0,',
    'deadlineHit: true — it is not playing badly, it is playing its FALLBACK MOVE.',
    'A legacy arm under 1000ms is a reflex baseline wearing legacy\'s name. 2000ms',
    'is comfortably clear of that, which makes this the first shape where the',
    'comparison is honest.',
    '',
    'Legacy also gives PIECES NO BOT — that is the production truth under the flag,',
    'and it is why the piece-bearing rosters matter here more than anywhere else.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('null-snake6', { roster: 'snake6' }),
    cell('snake5-knight', { roster: 'snake5-knight' }),
  ]
));

// ------------------------------------------------------- P3 slider profile
specs.push(spec(
  'p3-slider-2000',
  [
    'P3 — I2\'s TERRITORY_SLIDER_PROFILE, extended from 1000ms to 2000ms.',
    '',
    'I2 found the repair WINS at 1000ms and not at 150ms: the profile adds terms',
    '(command, movement budget) that only pay once the search has budget to act on',
    'them. That is a BUDGET GRADIENT, and a gradient measured at two points is a',
    'line drawn through two points. 2000ms is the third.',
    '',
    'Both arms are the SAME bundle. The arms differ only in which bot name is',
    'seated in the subject seat, because the profile has NO env flag and no config',
    'field — `TeamDecisionOptions.evaluate` is the only seam that reaches it, and',
    'the harness holds that seam. See the bot-version map in HANDOFF.md.',
    '',
    'null-snake6 is a PROVABLY INERT cell for this arm: with no piece on the board',
    'the two profiles are bit-identical. If a delta appears there, it is noise, and',
    'its size is the yardstick for the piece cells in the same batch.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('null-snake6', { roster: 'snake6' }),
    cell('snake5-queen', { roster: 'snake5-queen' }),
    cell('snake5-pawn', { roster: 'snake5-pawn' }),
  ]
));

// --------------------------------------------------- P4 tier truth, potions
specs.push(spec(
  'p4-tiertruth-potions',
  [
    'P4 — CENTAUR_TIER_TRUTH=full against the shipped default `expiry`, on',
    'potion-rich cells.',
    '',
    'Both arms are the same bundle; they differ by one environment variable.',
    'The widening is DARK by default for a reason: I4 measured an 858-inversion',
    'interaction storm (class B0 floor > B1 ceiling) and Stage 2.5 shipped only the',
    'expiry half. The engine fix that was supposed to enable the rest landed, and',
    'the re-measure was never run. THIS IS THAT RE-MEASURE.',
    '',
    'It also changed TIMING since those numbers were taken: couldCollectPotion is',
    'now gated n >= 2 rather than firing at the turn-start field, and own reach only',
    'LOWERS own tier. The old inversion counts describe code that no longer exists —',
    'do not compare against them, measure fresh.',
    '',
    'Potions ON everywhere here: with potions off the flag has nothing to feed on',
    'and the cell is a second null.',
  ],
  [
    cell('potion-mix-king', { roster: 'mix-king', potions: 'on' }),
    cell('potion-snake5-queen', { roster: 'snake5-queen', potions: 'on' }),
    cell('null-nopotion-mix-king', { roster: 'mix-king', potions: 'off' }),
  ]
));

// ------------------------------------------------------------- P5 wasm arena
specs.push(spec(
  'p5-wasm-arena',
  [
    'P5 — CENTAUR_WASM=on against the shipped `off`, on the perf-substrate build.',
    '',
    'Both arms are the perf-substrate bundle; they differ by one environment',
    'variable. The flag is OFF by default and that default follows a measurement,',
    'not an expectation: W2 already took partitionOf from 55us to 26us, so the',
    'naive "wasm beats JS" gap this was aimed at is mostly closed.',
    '',
    'The wasm arm is REFUSED at runtime, silently and per partition, whenever an',
    'input it needs is not resident in linear memory. So `on` is never a',
    'correctness bet — but it does mean an arm can be `on` and do nothing. Check',
    'the mechanism rows before believing a null here: a null that is really',
    '"the arm never engaged" is a different finding from "the arm engaged and did',
    'not help", and only the mechanism rows tell them apart.',
    '',
    'Valid values are `on` and `off` ONLY. There is no `auto`; anything else is',
    'ignored with a warning and falls back to off — which would silently turn this',
    'into an A/A null.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('hazard-mix-king', { roster: 'mix-king', hazards: 'interior' }),
    cell('null-snake6', { roster: 'snake6' }),
  ]
));

// -------------------------------------------------------- P6 admission gate
specs.push(spec(
  'p6-admission',
  [
    'P6 — CENTAUR_COHORT_POLICY=on against off (the flag-gated cohort governor).',
    '',
    'BLOCKED AS SHIPPED. The governor lives on branch `arch/s2`, which at the time',
    'this kit was cut existed ONLY on the cloud session\'s machine and was never',
    'pushed to GitHub. build-bot.sh cannot check out a branch that is not in the',
    'clone, and it will say so rather than substituting a different branch.',
    '',
    'Run this only after someone confirms arch/s2 is on origin. Verify with:',
    '    git ls-remote --heads origin arch/s2',
    'If that prints nothing, skip P6, and say in findings.md that it was skipped',
    'because the branch is unpublished. Do NOT silently run it against a branch',
    'that happens to build.',
    '',
    'Its target boards are the crowded ones — the governor decides which units get',
    'admitted to a joint decision, so a roster with more claimants than budget is',
    'where it can act at all.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('hazard-mix-king', { roster: 'mix-king', hazards: 'interior' }),
    cell('null-snake6', { roster: 'snake6' }),
  ]
));

// ------------------------------------------------- P7 CL1 promotion gates
specs.push(spec(
  'p7-cl1-gates',
  [
    'P7 — CL1\'s two new per-engine flags, on the perf-substrate branch.',
    'These are their EMPIRICAL PROMOTION GATES. Both ship default OFF pending',
    'exactly this measurement.',
    '',
    '  CENTAUR_CLUSTER_SEED    index-driven pairwise seed (search/cluster-seed.ts)',
    '  CENTAUR_UNIT_FATALITY   rung-0 fatality classifier (candidates.ts)',
    '',
    'Kept as SEPARATE flags on purpose, and measured separately for the same',
    'reason the code gives: "two features behind one flag is a paired experiment',
    'that measures their sum". Race each on-vs-off, then both-on, each against',
    'its own null. Do not read a both-on result as evidence for either alone.',
    '',
    'FLAG-VALUE TRAP, and it is a silent one. Both parse ONLY `1`, `on` or',
    '`true` as on. There is no validation warning and no `off` keyword —',
    'anything else, including `yes` or `ON`, is off. An arm with a mistyped',
    'value is an A/A null wearing a treatment\'s name and will look exactly like',
    'a null result. Set the off arm by OMITTING the variable, and check the',
    'batch manifest\'s envAtRun block afterwards to confirm the on arm carried',
    'the value you meant.',
    '',
    'MECHANISM PRIMARY, and here that is what the gate is actually about. CL1\'s',
    'deterministic probe measured fatal stagings 41->0 and teammate kills 25->4.',
    'The live arm asks the two things that probe cannot: does the effect survive',
    'real play, and does it cost placement?',
    '',
    'CL1\'S OWN HONEST NEGATIVE, which this sweep exists to adjudicate: final',
    'floors came out slightly WORSE on 14 of 26 replay positions. A cleaner',
    'rung-0 that prices out to a worse floor is a real tension, not a wash. Read',
    'the placement rows against the null with that specifically in mind, and do',
    'not let a good mechanism story carry a bad placement row.',
    '',
    'Mine the replays for deaths by cause (self-inflicted, teammate kills, wall,',
    'bodyBlock) and staged-move fatality. The manifest health counters are the',
    'coarse view; the per-turn `events` block carries the causes.',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('null-snake6', { roster: 'snake6' }),
    cell('snake5-knight', { roster: 'snake5-knight' }),
  ]
));

// ------------------------------------------------------------ the A/A null
specs.push(spec(
  'n0-aa-null',
  [
    'THE A/A NULL — one per batch, MANDATORY, and sized like the treatment cells.',
    '',
    'Run this spec with two arms that are the SAME bundle and the SAME env under',
    'two different names:',
    '    --arm nullA=<bundle> --arm nullB=<bundle>',
    'Its paired delta measures run-to-run variance and nothing else. That number is',
    'the yardstick every treatment delta in the batch is read against.',
    '',
    'SIZE IT LIKE THE TREATMENT. A null at 4 blocks next to a treatment at 16',
    'blocks understates the floor, because the floor narrows with block count —',
    'which is the direction that makes a treatment look significant when it is not.',
    '',
    'The program has measured this floor excluding zero at four blocks on a',
    'provably inert path: d P(first) +0.167 [0.056, 0.306] between one baseline and',
    'the identical baseline. Treat that as the prior, not the exception.',
    '',
    'Then check it: tools/simworker/bin/verify-null.js --batch <dir> --null nullA,nullB',
  ],
  [
    cell('headline-mix-king', { roster: 'mix-king' }),
    cell('null-snake6', { roster: 'snake6' }),
  ]
));

// -------------------------------------------------- board-condition ladder
specs.push(spec(
  'x1-conditions-ladder',
  [
    'THE BOARD-CONDITION LADDER — for a batch that has budget left after its',
    'priority cell, or for exploration at 4-8 blocks.',
    '',
    'Baseline plus one axis moved at a time: potions on, hazards interior, food',
    'sparse. Never two at once — a cell that moves two axes cannot say which one',
    'did the work, and at these block counts there is no power to interact them.',
    '',
    'MECHANISM-FIRST. At 4-8 blocks nothing here can support a placement claim.',
    'Read the mechanism rows (overrun rate, unstaged rate, assumption rate, decision',
    'wall time, turns-to-decisive) and treat the placement rows as descriptive.',
  ],
  [
    cell('base-mix-king', { roster: 'mix-king' }),
    cell('potion-mix-king', { roster: 'mix-king', potions: 'on' }),
    cell('hazard-mix-king', { roster: 'mix-king', hazards: 'interior' }),
    cell('sparse-mix-king', { roster: 'mix-king', food: 'sparse' }),
  ],
  FIELD,
  8
));

// ------------------------------------------------------- the roster ladder
specs.push(spec(
  'x2-roster-ladder',
  [
    'THE ROSTER LADDER — all five rosters at the headline conditions.',
    '',
    'The single most informative exploratory spec in the library: piece class is',
    'the axis on which this program\'s verdicts most often SIGN-FLIP. The staging',
    'guard helps on piece boards and regresses on snake-only ones; the slider',
    'profile is inert without a piece and wins with one. A treatment measured on',
    'one roster has been measured on one roster.',
    '',
    'At 8 blocks this is mechanism-first. Promote whichever roster shows the',
    'largest mechanism separation to its own 16-block cell.',
  ],
  Object.keys(ROSTERS).map((r) => cell(r === 'snake6' ? 'null-snake6' : r, { roster: r })),
  FIELD,
  8
));

// ------------------------------------------------------------------ smoke
specs.push({
  _comment: [
    'SMOKE TEST — the gate that must pass before any real run, and the acceptance',
    'test for the kit itself.',
    '',
    'Deliberately tiny: 2 games, 11x11, 150ms, no seat rotation. It proves the',
    'toolchain end to end — build, seat, play, resolve, gzip a replay, write a',
    'manifest row — and proves nothing at all about any bot. It takes seconds.',
    '',
    'It uses `control11`, whose shape is pinned to the h2h ladder\'s `snakes11` row.',
    'At 150ms the lobster bots run their real anytime path; do not read the',
    'outcome.',
  ],
  sweepId: 'smoke',
  bots: ['lobster-territory', 'reflex'],
  seeds: [11, 12],
  rotateSeats: false,
  cells: [{ cell: 'smoke-control11', config: { preset: 'control11', budgetMs: 150, turnCap: 25 } }],
});

// ------------------------------------------------------------------- write

fs.mkdirSync(outDir, { recursive: true });
for (const s of specs) {
  const p = path.join(outDir, `${s.sweepId}.json`);
  fs.writeFileSync(p, JSON.stringify(s, null, 1) + '\n');
  const games = s.cells.length * s.seeds.length * (s.rotateSeats === false ? 1 : s.bots.length);
  console.log(`${path.basename(p).padEnd(28)} ${s.cells.length} cells x ${s.seeds.length} seeds x ` +
              `${s.rotateSeats === false ? 1 : s.bots.length} rot = ${games} games/arm`);
}
console.log('');
console.log(`${specs.length} specs -> ${outDir}`);
console.log('');
console.log('Games per ARM. A paired cell runs two arms, so double it for the batch.');
