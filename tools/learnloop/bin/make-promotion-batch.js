#!/usr/bin/env node
'use strict';
/*
 * WHAT SHOULD THE PC RUN NEXT? — answered from the ledger, as a command.
 *
 *   node tools/learnloop/bin/make-promotion-batch.js --out <dir> [--blocks 16]
 *   node tools/learnloop/bin/make-promotion-batch.js --dry
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * arch-synthesis Stage 5: *"the A/B harness output IS the production predicate
 * table — one artifact, two consumers."* The consequence, taken seriously, is
 * that the NEXT batch's contents are a function of the ledger and not of
 * whoever happens to be reading it. A judgement call made freshly each time is
 * a judgement call that drifts, forgets the exploration slice, and quietly
 * stops scheduling the cells whose answers were inconvenient.
 *
 * So: every undecided flag contributes its own named decisive experiment; every
 * promoted or supported flag contributes a ~10% exploration slice running the
 * OPPOSITE branch; and the A/A null is emitted unconditionally and sized like
 * the treatment cells.
 *
 * ── THE THREE RULES, ALL OF THEM REFUSALS ──────────────────────────────────
 *
 *  1. THE A/A NULL IS MANDATORY AND IS SIZED LIKE THE TREATMENT. A null at 4
 *     blocks next to a treatment at 16 understates the floor, because the floor
 *     narrows with block count — which is the direction that makes a treatment
 *     look significant when it is not.
 *
 *  2. AN EXPERIMENT BLOCKED ON SOMETHING ELSE IS EMITTED AS A COMMENT, NOT AS A
 *     CELL. P4R waits on P11; P6R waits on counters that do not exist. Emitting
 *     them anyway would spend box time producing rows nobody can read.
 *
 *  3. THE EXPLORATION SLICE IS NEVER DROPPED FOR SPACE. It is the ratchet
 *     guard: today's policy selects tomorrow's corpus, so a promoted flag with
 *     no opposite-branch slice is a flag that can never be revised back. It is
 *     small on purpose — 4 blocks, mechanism-first — so there is no version of
 *     "we did not have room" that is true.
 *
 * `--dry` validates without writing: it builds every spec, runs the same shape
 * checks a reader would, prints the P-list and the box-time estimate, and exits
 * nonzero if anything is malformed.
 */

const fs = require('fs');
const path = require('path');
const L = require('../lib/ledger');
const C = require('../lib/cells');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const flag = (n) => process.argv.includes(`--${n}`);

const DRY = flag('dry');
const BLOCKS = Number(arg('blocks', '16'));
const SLICE_BLOCKS = Number(arg('slice-blocks', '4'));
const outDir = path.resolve(arg('out', path.join(__dirname, '..', 'specs', 'batch2')));
const ledger = L.load(arg('ledger', L.LEDGER_PATH));

/** Cell name -> the vocabulary's cell descriptor. One place, so a cell name in
 * the ledger's `nextExperiment` cannot mean two different boards. */
const CELL_SHAPES = {
  // ── the potions-ON board, which is the board real games are played on ────
  // These are the cells a new experiment should be scheduled in. `cells.js`
  // gives every `potion-` name potions-on without being told; the axis is
  // written out anyway so a reader of this table can see the board.
  'potion-mix-king': { roster: 'mix-king', potions: 'on' },
  'potion-snake5-queen': { roster: 'snake5-queen', potions: 'on' },
  'potion-snake5-knight': { roster: 'snake5-knight', potions: 'on' },
  'potion-snake5-pawn': { roster: 'snake5-pawn', potions: 'on' },
  'potion-snake6': { roster: 'snake6', potions: 'on' },
  'potion-hazard-mix-king': { roster: 'mix-king', hazards: 'interior', potions: 'on' },
  'potion-sparse-mix-king': { roster: 'mix-king', food: 'sparse', potions: 'on' },
  // Never played, so nothing to pin: these take the potions-on default.
  'base-mix-king': { roster: 'mix-king' },
  'sparse-mix-king': { roster: 'mix-king', food: 'sparse' },

  // ── the potions-OFF controls, and the ledger's own history ───────────────
  // Every name below has measurement rows behind it, all played potions-off.
  // `cells.js` pins them so those rows keep describing the games that made
  // them; they stay schedulable as the explicit off-controls the ruling allows,
  // and a treatment that is not ABOUT the potion axis should not be in one.
  'headline-mix-king': { roster: 'mix-king', potions: 'off' },
  'hazard-mix-king': { roster: 'mix-king', hazards: 'interior', potions: 'off' },
  'null-snake6': { roster: 'snake6', potions: 'off' },
  'null-nopotion-mix-king': { roster: 'mix-king', potions: 'off' },
  'snake5-queen': { roster: 'snake5-queen', potions: 'off' },
  'snake5-knight': { roster: 'snake5-knight', potions: 'off' },
  'snake5-pawn': { roster: 'snake5-pawn', potions: 'off' },
};

const problems = [];
const specs = [];
const plist = [];

function cellsFor(names, id) {
  const out = [];
  for (const n of names) {
    const shape = CELL_SHAPES[n];
    if (shape === undefined) {
      problems.push(`${id}: unknown cell "${n}" — add it to CELL_SHAPES or fix the ledger`);
      continue;
    }
    out.push(C.cell(n, shape));
  }
  return out;
}

// -------------------------------------------------------- the decisive cells

for (const f of L.undecided(ledger)) {
  const x = f.nextExperiment;
  if (!x) {
    problems.push(`${f.flag}: status ${f.status} with no nextExperiment — the ledger owes one`);
    continue;
  }
  if (x.blockedOn || x.priority === 'DEFERRED until the counters exist.') {
    plist.push({
      id: x.id,
      flag: f.flag,
      status: f.status,
      scheduled: false,
      reason: x.blockedOn ?? x.priority,
      question: x.question,
    });
    continue;
  }
  const cells = cellsFor(x.cells ?? [], x.id);
  if (cells.length === 0) {
    problems.push(`${x.id}: no runnable cells`);
    continue;
  }
  const blocks = Number(x.blocks ?? BLOCKS);
  const sweepId = `${x.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${f.flag.toLowerCase().replace(/^centaur_/, '')}`;
  specs.push(
    C.spec(
      sweepId,
      [
        `${x.id} — ${f.flag} (${f.stage}), status ${f.status}.`,
        '',
        `QUESTION: ${x.question}`,
        '',
        `ARMS: ${(x.arms ?? []).join('  |  ')}`,
        `READS OUT: ${(x.readsOut ?? []).join(', ')}`,
        ...(x.designNote ? ['', `DESIGN NOTE: ${x.designNote}`] : []),
        ...(x.scopeNote ? ['', `SCOPE: ${x.scopeNote}`] : []),
        ...(x.gate ? ['', `GATE: ${x.gate}`] : []),
        ...(x.requires ? ['', `REQUIRES: ${x.requires}`] : []),
        '',
        'FLAG-VALUE TRAP: every CL flag parses only `1`, `on` or `true`, with no',
        'warning on anything else. Set the OFF arm by OMITTING the variable, and',
        'check the manifest envAtRun block afterwards. Since the CL7 telemetry',
        'closure the per-game rows also carry the RESOLVED flag stamp, which is',
        'the value that actually ran — read that, not the environment.',
        '',
        'Generated from tools/learnloop/promotion-ledger.json. Do not hand-edit;',
        're-run make-promotion-batch.js.',
      ],
      cells,
      C.FIELD,
      blocks
    )
  );
  plist.push({
    id: x.id,
    flag: f.flag,
    status: f.status,
    scheduled: true,
    sweepId,
    arms: x.arms ?? [],
    cells: x.cells,
    blocks,
    gamesPerArm: C.gamesPerArm(specs[specs.length - 1]),
    question: x.question,
  });
}

// --------------------------------------------------- the standing experiments
//
// Not flag promotions: owner-approved program questions that outlive any one
// flag. The budget ladder is the live example — it was pre-approved conditional
// on budget-probe v2 confirming, and v2 confirmed, so it is scheduled here
// rather than waiting to be remembered. A `budgets` list fans one experiment
// out into one spec per rung, because a budget is a property of the CONFIG and
// not of the arm: two rungs in one spec would be two experiments in one table.

for (const x of ledger.standingExperiments ?? []) {
  const budgets = x.budgets ?? [C.DEFAULTS.budget];
  const blocks = Number(x.blocks ?? BLOCKS);
  for (const budget of budgets) {
    const cells = (x.cells ?? [])
      .map((n) => {
        const shape = CELL_SHAPES[n];
        if (shape === undefined) {
          problems.push(`${x.id}: unknown cell "${n}"`);
          return null;
        }
        return C.cell(`${n}@${budget}`, shape, { budget });
      })
      .filter(Boolean);
    if (cells.length === 0) continue;
    const sweepId = `${x.id.toLowerCase()}-budget-${budget}`;
    specs.push(
      C.spec(
        sweepId,
        [
          `${x.id} — ${x.title}, rung ${budget} ms.`,
          '',
          `APPROVED BY: ${x.approvedBy}`,
          `TRIGGER: ${x.trigger}`,
          '',
          `QUESTION: ${x.question}`,
          `ARMS: ${(x.arms ?? []).join('  |  ')}`,
          `READS OUT: ${(x.readsOut ?? []).join(', ')}`,
          ...(x.designNote ? ['', `DESIGN NOTE: ${x.designNote}`] : []),
          ...(x.caveat ? ['', `CAVEAT: ${x.caveat}`] : []),
          '',
          'MECHANISM-FIRST at this block count. Placement here is descriptive.',
          '',
          'Generated from tools/learnloop/promotion-ledger.json.',
        ],
        cells,
        C.FIELD,
        blocks
      )
    );
    plist.push({
      id: `${x.id}@${budget}`,
      flag: x.title,
      status: 'standing',
      scheduled: true,
      sweepId,
      arms: x.arms ?? [],
      blocks,
      gamesPerArm: C.gamesPerArm(specs[specs.length - 1]),
      question: `${x.question} (rung ${budget} ms)`,
    });
  }
}

// ---------------------------------------------------- the exploration slices

const sliceCells = [];
const sliceFlags = [];
for (const f of L.needsExploration(ledger)) {
  const x = f.nextExperiment;
  if (!x) {
    problems.push(`${f.flag}: ${f.status} with no exploration slice defined`);
    continue;
  }
  sliceFlags.push({ flag: f.flag, id: x.id, arms: x.arms ?? [], cells: x.cells ?? [] });
  for (const n of x.cells ?? []) {
    if (!sliceCells.some((c) => c.cell === n)) {
      const shape = CELL_SHAPES[n];
      if (shape === undefined) {
        problems.push(`${x.id}: unknown slice cell "${n}"`);
        continue;
      }
      sliceCells.push(C.cell(n, shape));
    }
  }
}

if (sliceCells.length > 0) {
  specs.push(
    C.spec(
      'x9-exploration-slice',
      [
        'THE EXPLORATION SLICE — the ratchet guard, and it is not optional.',
        '',
        'A3 memo section 4.2 item 6: the policy decides which games get played with',
        'which features, so tomorrow`s corpus is selected by today`s policy. A',
        'promoted default with no opposite-branch slice is a default that can never',
        'be revised back, because the cell that would revise it stops generating',
        'data the moment it is promoted.',
        '',
        'Each flag below runs its OPPOSITE branch on a small slice. Small on purpose:',
        `${SLICE_BLOCKS} blocks, mechanism-first, so there is no version of "we did not have`,
        'room" that is true. Do NOT read placement off these cells — at this block',
        'count nothing here can support a placement claim, and it is not meant to.',
        '',
        ...sliceFlags.map(
          (s) => `  ${s.id.padEnd(12)} ${s.flag}: run ${s.arms[1] ?? 'the opposite branch'} against the shipped default`
        ),
        '',
        'Generated from tools/learnloop/promotion-ledger.json.',
      ],
      sliceCells,
      C.FIELD,
      SLICE_BLOCKS
    )
  );
  plist.push({
    id: 'X9',
    flag: sliceFlags.map((s) => s.flag).join(' + '),
    status: 'exploration-slice',
    scheduled: true,
    sweepId: 'x9-exploration-slice',
    blocks: SLICE_BLOCKS,
    gamesPerArm: C.gamesPerArm(specs[specs.length - 1]),
    question: 'Keep the promoted defaults falsifiable.',
  });
}

// ------------------------------------------------------------ the A/A null
//
// ITS CELLS ARE THE UNION OF WHAT THE BATCH ACTUALLY RUNS (`AA-FLOOR-COVERAGE`).
//
// This used to be the hard-coded pair headline-mix-king + null-snake6,
// regardless of where the treatments ran. Batch 1 therefore floored two of its
// eight cells, and by the ledger's own rule — a metric with no floor in the A/A
// cell is UNREADABLE, not null — the other six produced rows nobody was allowed
// to read. Games spent on unreadable rows. It landed hardest on the ledger's
// single best result: TERRITORY_SLIDER_PROFILE's only win is on snake5-queen
// and had to be compared against a BORROWED mix-king floor, which it clears by
// 0.018.
//
// So the floor is now measured wherever a treatment is read. It costs box time
// and it is the cheapest box time in the batch.

const nullCellNames = [];
for (const s of specs) {
  for (const c of s.cells) {
    // Standing-experiment cells are emitted as `<cell>@<budget>`; the floor is
    // a property of the BOARD, so the rung suffix is stripped for coverage.
    const base = String(c.cell).split('@')[0];
    if (CELL_SHAPES[base] !== undefined && !nullCellNames.includes(base)) nullCellNames.push(base);
  }
}
for (const n of ['headline-mix-king', 'null-snake6']) {
  if (!nullCellNames.includes(n)) nullCellNames.push(n);
}

const nullSpec = C.spec(
  'n0-aa-null',
  [
    'THE A/A NULL — one per batch, MANDATORY, and sized like the treatment cells.',
    '',
    'CELLS ARE DERIVED, NOT CHOSEN: every board any scheduled spec in this batch',
    'runs on appears here, because a treatment metric with no floor in the A/A',
    'cell is UNREADABLE rather than null, and an unfloored treatment cell is box',
    'time spent on a row nobody may read. This batch floors:',
    `    ${nullCellNames.join(', ')}`,
    '',
    'Run with two arms that are the SAME bundle and the SAME env under two names:',
    '    --arm nullA=<bundle> --arm nullB=<bundle>',
    'Its paired delta measures run-to-run variance and nothing else. That number',
    'is the yardstick every treatment delta in this batch is read against.',
    '',
    `SIZED AT ${BLOCKS} BLOCKS to match the treatment cells. A null at 4 blocks`,
    'beside a treatment at 16 understates the floor, because the floor narrows',
    'with block count — the direction that makes a treatment look significant',
    'when it is not.',
    '',
    'Batch 20260827 measured this floor at +/-0.097 (mix-king) and +/-0.032',
    '(snake6) with 0 illegal and 0 errors. Those are the numbers to beat, and a',
    'wider band this time is an INSTRUMENT EVENT, not a nuisance.',
    '',
    'Then check it:',
    '    node tools/simworker/bin/verify-null.js --batch <dir> --null nullA,nullB',
  ],
  cellsFor(nullCellNames, 'n0'),
  C.FIELD,
  BLOCKS
);
specs.push(nullSpec);
plist.push({
  id: 'N0',
  flag: '(A/A null)',
  status: 'mandatory',
  scheduled: true,
  sweepId: 'n0-aa-null',
  blocks: BLOCKS,
  gamesPerArm: C.gamesPerArm(nullSpec),
  question: 'What is the noise floor on this box, at this load, at this block count?',
});

// ------------------------------------------------------------------- checks

for (const s of specs) {
  if (!s.sweepId) problems.push('a spec has no sweepId');
  if (!Array.isArray(s.cells) || s.cells.length === 0) problems.push(`${s.sweepId}: no cells`);
  if (!Array.isArray(s.seeds) || s.seeds.length === 0) problems.push(`${s.sweepId}: no seeds`);
  if (new Set(s.seeds).size !== s.seeds.length) problems.push(`${s.sweepId}: duplicate seeds`);
  for (const c of s.cells) {
    if (!c.config || !Array.isArray(c.config.roster) || c.config.roster.length !== 6) {
      problems.push(`${s.sweepId}/${c.cell}: roster is not six units`);
    }
  }
}
if (!specs.some((s) => s.sweepId === 'n0-aa-null')) {
  problems.push('no A/A null in the batch — that is not a batch, it is a set of unreadable numbers');
}
// THE FLOOR MUST COVER THE BATCH. The derivation above makes this true by
// construction; the check is here so that a future edit that reintroduces a
// hand-picked null list fails the gate instead of quietly shipping unreadable
// cells again.
{
  const floored = new Set(nullSpec.cells.map((c) => String(c.cell).split('@')[0]));
  const uncovered = [
    ...new Set(
      specs
        .filter((s) => s.sweepId !== 'n0-aa-null')
        .flatMap((s) => s.cells.map((c) => String(c.cell).split('@')[0]))
    ),
  ].filter((n) => !floored.has(n));
  if (uncovered.length > 0) {
    problems.push(
      `the A/A null does not floor ${uncovered.join(', ')} — a treatment metric with no floor ` +
        'in the A/A cell is UNREADABLE, not null, so those are games spent on rows nobody may read'
    );
  }
}

const nullBlocks = nullSpec.seeds.length;
const maxTreat = Math.max(...specs.filter((s) => s.sweepId !== 'n0-aa-null').map((s) => s.seeds.length));
if (nullBlocks < maxTreat) {
  problems.push(
    `the A/A null is ${nullBlocks} blocks against a ${maxTreat}-block treatment — the null must be ` +
      'sized like the treatment or it understates the floor'
  );
}

// ------------------------------------------------------------------ output

const totalGames = plist.filter((p) => p.scheduled).reduce((a, p) => a + (p.gamesPerArm ?? 0) * 2, 0);

console.log('THE PROPOSED BATCH, FROM THE LEDGER');
console.log('');
for (const p of plist) {
  if (!p.scheduled) {
    console.log(`  --  ${p.id.padEnd(12)} ${p.flag}  NOT SCHEDULED: ${p.reason}`);
    continue;
  }
  console.log(
    `  ${p.id.padEnd(14)} ${String(p.flag).padEnd(26)} ${String(p.blocks).padStart(2)} blocks  ` +
      `${String(p.gamesPerArm).padStart(4)} games/arm  [${p.status}]`
  );
}
console.log('');
console.log(`${specs.length} specs, ${totalGames} games total across both arms of every pair.`);
console.log('');

if (problems.length > 0) {
  console.error('PROBLEMS:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (DRY) {
  console.log('--dry: nothing written. Every spec built and validated.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
for (const s of specs) {
  fs.writeFileSync(path.join(outDir, `${s.sweepId}.json`), JSON.stringify(s, null, 1) + '\n');
}
fs.writeFileSync(
  path.join(outDir, 'P-LIST.json'),
  JSON.stringify(
    { generatedFrom: 'tools/learnloop/promotion-ledger.json', blocks: BLOCKS, sliceBlocks: SLICE_BLOCKS, plist },
    null,
    2
  ) + '\n'
);
console.log(`wrote ${specs.length} specs + P-LIST.json -> ${outDir}`);
