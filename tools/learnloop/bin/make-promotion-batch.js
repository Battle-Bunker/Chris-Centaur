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

/*
 * ── CROSS-BRANCH ARMS ──────────────────────────────────────────────────────
 *
 * Most arms in this ledger are one bundle plus a named `BotConfig`. Some are
 * not: under the branching paradigm (docs/BRANCHING.md, owner ruling 20260830)
 * an architecture change lives on its own branch and is validated as a batch
 * arm, so its experiment races TWO BUNDLES BUILT FROM TWO REFS.
 *
 * That is not an extension of the harness — it is what the harness was built
 * for. `build-bot.sh` resolves any git ref to a bundle, an arm is a
 * `name=<bundle-dir>` pair, and `run-pair.js` launches the arms at the same
 * instant in separate processes and pairs them by gameId afterwards. Batch 1's
 * P1 ran exactly this: `integrated` @ 66904d2 against `perf-substrate` @
 * 8059b86, 144 games paired and 0 dropped.
 *
 * What the generator has to add is the thing an operator cannot reconstruct
 * from prose: WHICH REF EACH ARM IS BUILT FROM. An experiment declares
 * `armRefs: { <arm>: <branchRoles key> }` and this prints a BUNDLES block with
 * the exact `build-bot.sh` lines beside the `--arm` lines. A ref named nowhere
 * is a bundle somebody has to guess at, and a guessed bundle is the silent A/A
 * this whole ledger is organised around refusing.
 */
const ROLES = ledger.branchRoles ?? {};

function roleOf(key, id) {
  const r = ROLES[key];
  if (r === undefined || !r.ref) {
    problems.push(`${id}: armRefs names "${key}", which is not a branch role in ledger.branchRoles`);
    return null;
  }
  return r;
}

/** The `--arm` lines and the BUNDLES block, for one experiment. */
function armLines(x, id) {
  const cfgs = x.armConfigs;
  if (!cfgs) return [];
  const refs = x.armRefs ?? null;
  const bundleOf = (name) => {
    if (refs === null) return '<bundle>';
    const r = roleOf(refs[name], id);
    return r === null ? '<bundle>' : `<bundle-${r.bundleName ?? name}>`;
  };
  const lines = [
    '',
    refs === null
      ? 'ARM CONFIGS (both arms from POST-TEARDOWN bundles):'
      : 'ARM CONFIGS — A CROSS-BRANCH PAIR: one bundle per arm, from the refs below.',
    ...Object.entries(cfgs).map(
      ([name, cfg]) =>
        `    --arm '${name}=${bundleOf(name)}${cfg === null ? '' : `,bot=${JSON.stringify(cfg)}`}'`
    ),
  ];
  if (refs !== null) {
    lines.push('');
    lines.push('BUNDLES — build one per arm, from the ref named here, and record the');
    lines.push('resolved SHA from each bundle.json in findings.md:');
    for (const [name, key] of Object.entries(refs)) {
      const r = roleOf(key, id);
      if (r === null) continue;
      lines.push(`    tools/simworker/build-bot.sh ${r.ref} ${bundleOf(name)} --fetch`);
      lines.push(`        ${name}: ${r.branch} — ${r.role}`);
    }
    lines.push('');
  }
  return lines;
}

/** The arm-selection boilerplate, in the shape this experiment actually has. */
const HOW_AN_ARM_IS_SELECTED = [
  'HOW AN ARM IS SELECTED, AND THE TRAP THAT REPLACED THE OLD ONE. The',
  'feature flags are gone (owner ruling 20260829; the search-layer half',
  'landed with the depth work). An arm is a BUNDLE plus a named BotConfig:',
  '    --arm \'treat=<bundle>,bot={"territoryRefine":true}\'',
  'or a `contenders` map in the spec. Exporting a CENTAUR_* variable now',
  'does NOTHING — an arm that sets one plays the shipped bot under a',
  "treatment's name, which is the silent A/A that voided P5. run-pair.js",
  'refuses the dead names; a bad config field is a refusal from',
  'botConfigFromJson rather than a silent off.',
  'THE REMAINING TRAP IS THE BUNDLE. A pre-teardown bundle has no',
  'bot-config module and ignores the config entirely, so BOTH arms of a',
  "pair must be built from post-teardown refs. Read the per-game rows'",
  'mechanism.config stamp — the bot that actually resolved — not the spec.',
];

const HOW_A_BRANCH_ARM_IS_SELECTED = [
  'HOW AN ARM IS SELECTED HERE, AND WHY THIS ONE IS DIFFERENT. This is a',
  'BRANCH-VERSUS-BRANCH pair under the branching paradigm (docs/BRANCHING.md,',
  'owner ruling 20260830): an architecture change is built on its own branch,',
  'validated as a batch arm, and MERGED on the result. So the arms are two',
  'BUNDLES built from two refs, each running its own shipped default, and the',
  'BUNDLES block above is the whole of the arm definition.',
  'DO NOT ADD bot= TO EITHER ARM unless this spec prints one. A bundle built',
  'from a pre-teardown ref has no src/lobster/bot-config module, and',
  'checkContenders refuses a spec that declares a bot config against it —',
  'correctly, because such a bundle would ignore the config and play its',
  "shipped bot under the arm's name. With no config declared, that check does",
  'not fire and both arms simply play what they ship, which is the comparison.',
  'READ THE VERDICT AT THE RIGHT GRAIN. Two branch tips differ by everything',
  'that landed on either since they forked, so a delta attributes to THE',
  'BRANCH and to nothing finer. That is the right instrument for a merge',
  'decision and the wrong one for a mechanism claim.',
];

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
  // A WITHDRAWN EXPERIMENT IS EMITTED WITH ITS REASON, NEVER DELETED.
  //
  // `blockedOn` says "not yet"; `withdrawn` says "not this question, ever, as
  // written" — the shape a spec takes when the code it named stopped existing.
  // The batch-2 P8/P9-joint arm is the exhibit: the cluster enumeration's off
  // arm names a build the search-layer teardown deleted, so the pair cannot be
  // built out of two current bundles at all. Deleting the row would leave a
  // future reader unable to tell a question that was ANSWERED from one that
  // became unaskable, which are different facts about the same flag.
  if (x.withdrawn) {
    plist.push({
      id: x.id,
      flag: f.flag,
      status: f.status,
      scheduled: false,
      withdrawn: true,
      reason: x.withdrawn,
      question: x.question,
    });
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
        // WHAT TO ACTUALLY TYPE. An arm name is a label; the config — or, for a
        // cross-branch pair, the REF — is the arm. Printed here so the operator
        // never has to reconstruct one from prose; the reconstruction is where a
        // mistyped arm becomes a silent A/A.
        ...armLines(x, x.id),
        `READS OUT: ${(x.readsOut ?? []).join(', ')}`,
        ...(x.designNote ? ['', `DESIGN NOTE: ${x.designNote}`] : []),
        ...(x.mergeDecision ? ['', `MERGE DECISION: ${x.mergeDecision}`] : []),
        ...(x.scopeNote ? ['', `SCOPE: ${x.scopeNote}`] : []),
        ...(x.gate ? ['', `GATE: ${x.gate}`] : []),
        ...(x.requires ? ['', `REQUIRES: ${x.requires}`] : []),
        '',
        ...(x.armRefs ? HOW_A_BRANCH_ARM_IS_SELECTED : HOW_AN_ARM_IS_SELECTED),
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

/*
 * WHICH BUNDLE THE A/A NULL IS TWO COPIES OF.
 *
 * `verify-null.js` asserts an IDENTICAL bundle SHA in both arms, so an A/A null
 * is one build seated twice. That was invisible while every arm in a batch came
 * from one branch. It stops being invisible the moment a batch races branches,
 * and the choice belongs in the ledger rather than in an operator's head:
 * `branchRoles.aaNull.use` names the role, and its `why` and `caveat` are
 * printed into the spec so the reader meets the reasoning where the instruction
 * is.
 */
const aaRole = ROLES[(ROLES.aaNull ?? {}).use ?? ''] ?? null;
const AA_BUNDLE = aaRole === null ? '<bundle>' : `<bundle-${aaRole.bundleName}>`;
const AA_BUNDLE_NOTE =
  aaRole === null
    ? []
    : [
        `WHICH BUNDLE: both arms are ${aaRole.branch}`,
        `(${aaRole.ref}) — the ${aaRole.role} branch.`,
        `    tools/simworker/build-bot.sh ${aaRole.ref} ${AA_BUNDLE} --fetch`,
        '',
        ...wrap(ROLES.aaNull.why),
        '',
        ...wrap(ROLES.aaNull.caveat),
        '',
      ];

/** Soft-wrap a long ledger string into spec-comment lines. */
function wrap(text, width = 76) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
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
    `    --arm nullA=${AA_BUNDLE} --arm nullB=${AA_BUNDLE}`,
    'Its paired delta measures run-to-run variance and nothing else. That number',
    'is the yardstick every treatment delta in this batch is read against.',
    '',
    // WHICH BUNDLE, AND WHY. A null is one bundle seated twice; a batch that
    // races whole branches therefore has to CHOOSE which one, and a choice
    // nobody wrote down is a choice the next operator makes differently.
    ...AA_BUNDLE_NOTE,
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

// PRUNE THE SPECS THIS BATCH NO LONGER EMITS.
//
// A spec file is an INSTRUCTION to the local session, and the session runs the
// directory rather than the P-list. A withdrawn experiment whose file survives
// a regeneration is therefore an instruction to spend a night on arms nobody
// can build — which is exactly the failure the P8/P9-joint withdrawal exists to
// prevent. So the directory is the batch, and nothing else in it is a spec.
{
  const emitted = new Set(specs.map((s) => `${s.sweepId}.json`));
  emitted.add('P-LIST.json');
  emitted.add('README.md');
  for (const name of fs.readdirSync(outDir)) {
    if (!name.endsWith('.json') || emitted.has(name)) continue;
    fs.unlinkSync(path.join(outDir, name));
    console.log(`pruned ${name} — no longer emitted by the ledger`);
  }
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
