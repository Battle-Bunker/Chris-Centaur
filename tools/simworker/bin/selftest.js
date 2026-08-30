#!/usr/bin/env node
'use strict';
/*
 * THE KIT'S OWN GATE — per-seat bot isolation, asserted twice.
 *
 *   node tools/simworker/bin/selftest.js                  # transform only
 *   node tools/simworker/bin/selftest.js --bundle <dir>   # + a real game
 *
 * Plain node, no dependencies, no build step — the same discipline
 * `tools/learnloop/bin/selftest.js` runs on, because this has to work from a
 * fresh clone on the owner's box before anything is installed.
 *
 * ── WHY TWO LAYERS, AND WHY THE SECOND ONE IS THE REAL ONE ─────────────────
 *
 * 1. THE TRANSFORM. `lib/arm-spec.js` decides which seats an arm's config
 *    reaches. Every rule in it is asserted here by trying to break it: an
 *    ambiguous `bot=` is refused, a targeted `bot@` reaches its seat and no
 *    other, a seat that is not seated is refused, a non-lobster seat is
 *    refused, and the board-defining half of the spec comes through byte-equal.
 *
 * 2. THE STAMP. A transform that looks right and an engine that resolved right
 *    are different claims. So, when a bundle is available, this plays ONE REAL
 *    GAME seating TWO lobster contenders with DIFFERENT configs and reads the
 *    per-seat `health[].mechanism.flags` stamp out of the manifest — the bot
 *    the engine actually resolved. Each seat must show its own config and
 *    neither may show the other's. That is the assertion the 20260830 defect
 *    would have failed, and it is the one that would catch its return.
 *
 * The live layer is SKIPPED LOUDLY without a bundle rather than silently
 * passing, and a bundle that predates the flag teardown of 2026-08-29 publishes
 * no config stamp at all — that is reported as a skip with its reason too, not
 * as a pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const A = require('../lib/arm-spec');

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function ok(cond, what) {
  if (cond) { pass++; console.log(`  ok   ${what}`); }
  else { fail++; failures.push(what); console.log(`  FAIL ${what}`); }
}
function refuses(fn, what) {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof A.ArmSpecError ? e.message : `WRONG ERROR TYPE: ${e.message}`; }
  ok(msg !== null && !msg.startsWith('WRONG ERROR TYPE'), what);
}
function skipped(what) { skip++; console.log(`  SKIP ${what}`); }
function section(s) { console.log(''); console.log(s); }

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// ------------------------------------------------------- 1. the transform

section('1. PER-SEAT ISOLATION — the transform');

/** The shape every experiment in the program that seats two lobsters has. */
const TWO_LOBSTER = {
  sweepId: 'selftest',
  bots: ['noGain', 'lobster-territory', 'reflex'],
  contenders: { noGain: { base: 'lobster-territory', bot: { candidates: { gainOrdering: false } } } },
  cells: [{ cell: 'c', config: {} }],
  seeds: [1, 2],
  rotateSeats: true,
};

/** The library's own shape: one reachable seat, and it must keep working. */
const ONE_LOBSTER = {
  sweepId: 'selftest',
  bots: ['lobster-territory', 'lobster-material', 'reflex'],
  cells: [{ cell: 'c', config: {} }],
  seeds: [1, 2],
  rotateSeats: true,
};

{
  // THE DEFECT ITSELF. Before 20260830 this merged the config into BOTH
  // `noGain` and `lobster-territory` and the within-game contrast cancelled.
  refuses(
    () => A.resolveArmTargets(TWO_LOBSTER, { name: 'treat', bot: { territoryRefine: true } }),
    'an untargeted bot= on a two-lobster spec is REFUSED, not merged into both'
  );
  let msg = '';
  try { A.resolveArmTargets(TWO_LOBSTER, { name: 'treat', bot: { territoryRefine: true } }); }
  catch (e) { msg = e.message; }
  ok(msg.includes('noGain') && msg.includes('lobster-territory'), 'the refusal names both candidate seats');
  ok(msg.includes('bot@noGain='), 'the refusal prints the spelling that fixes it');
}

{
  const t = A.resolveArmTargets(ONE_LOBSTER, { name: 'treat', bot: { territoryRefine: true } });
  ok(
    Object.keys(t).length === 1 && t['lobster-territory'].territoryRefine === true,
    'an untargeted bot= on the library shape still lands on lobster-territory'
  );
  ok(
    t['lobster-material'] === undefined,
    'and it does NOT reach the lobster-material seat it never reached before'
  );
}

{
  const s = A.specForArm(TWO_LOBSTER, { name: 'treat', botTargets: { noGain: { territoryRefine: true } } });
  ok(s.contenders.noGain.bot.territoryRefine === true, 'bot@noGain= reaches noGain');
  ok(
    s.contenders.noGain.bot.candidates.gainOrdering === false,
    "and MERGES onto the seat's declared config rather than replacing it"
  );
  ok(
    s.contenders['lobster-territory'] === undefined,
    'and leaves the other lobster seat entirely unconfigured — THE ISOLATION PROPERTY'
  );
}

{
  const s = A.specForArm(TWO_LOBSTER, {
    name: 'treat',
    botTargets: { noGain: { sampledCap: true }, 'lobster-territory': { multistartSeed: true } },
  });
  ok(
    s.contenders.noGain.bot.sampledCap === true && s.contenders.noGain.bot.multistartSeed === undefined,
    'two targets in one arm: noGain gets only its own config'
  );
  ok(
    s.contenders['lobster-territory'].bot.multistartSeed === true &&
      s.contenders['lobster-territory'].bot.sampledCap === undefined,
    'two targets in one arm: lobster-territory gets only its own config'
  );
  ok(
    s.contenders['lobster-territory'].base === 'lobster-territory',
    'a contender wearing a built-in name declares that built-in as its base (checkContenders)'
  );
}

{
  const s = A.specForArm(TWO_LOBSTER, { name: 'treat', botTargets: { noGain: { sampledCap: true } } });
  ok(s.sweepId === TWO_LOBSTER.sweepId, 'the arm spec keeps the shared sweepId');
  ok(s.cells === TWO_LOBSTER.cells, 'the arm spec keeps the shared cells BY REFERENCE — the pairing guarantee');
  ok(s.seeds === TWO_LOBSTER.seeds, 'the arm spec keeps the shared seeds by reference');
  ok(s.rotateSeats === TWO_LOBSTER.rotateSeats, 'the arm spec keeps the shared seat rotation');
  ok(TWO_LOBSTER.contenders.noGain.bot.sampledCap === undefined, 'and does not mutate the shared spec');
}

refuses(
  () => A.resolveArmTargets(TWO_LOBSTER, { name: 'treat', botTargets: { nobody: { sampledCap: true } } }),
  'bot@<seat>= naming a seat the spec does not seat is refused'
);
refuses(
  () => A.resolveArmTargets(TWO_LOBSTER, { name: 'treat', botTargets: { reflex: { sampledCap: true } } }),
  'bot@reflex= is refused — reflex is not driven by TeamDecisionOptions'
);
refuses(
  () => A.resolveArmTargets(TWO_LOBSTER, { name: 'treat', bot: { a: 1 }, botTargets: { noGain: { b: 2 } } }),
  'mixing bot= and bot@<seat>= in one arm is refused'
);
refuses(
  () => A.resolveArmTargets({ sweepId: 's', bots: ['reflex', 'legacy'] }, { name: 'treat', bot: { a: 1 } }),
  'bot= on a spec that seats no configurable contender is refused'
);

{
  const t = A.resolveArmTargets(ONE_LOBSTER, { name: 'base', bot: null });
  ok(Object.keys(t).length === 0, 'an arm with no config configures no seat');
  ok(A.specForArm(ONE_LOBSTER, { name: 'base', bot: null }) === ONE_LOBSTER, 'and gets the shared spec unchanged');
}

{
  ok(
    A.configurableSeats(ONE_LOBSTER).join(',') === 'lobster-territory,lobster-material',
    'lobster-material IS a configurable seat — bot@ can reach it even though bot= may not'
  );
  const s = A.specForArm(ONE_LOBSTER, { name: 'treat', botTargets: { 'lobster-material': { sampledCap: true } } });
  ok(
    s.contenders['lobster-material'].bot.sampledCap === true &&
      s.contenders['lobster-territory'] === undefined,
    'bot@lobster-material= configures the material seat and nothing else'
  );
}

// -------------------------------------------------- 2. the per-seat stamp

section('2. PER-SEAT ISOLATION — the resolved stamp, through run-pair, from real games');

const bundle = arg('bundle', process.env.SIMWORKER_BUNDLE || '');

if (bundle === '') {
  skipped(
    'the live two-contender pair — no bundle. Pass --bundle <dir> (or set\n' +
    '       SIMWORKER_BUNDLE) to run it. Build one with:\n' +
    '           tools/simworker/build-bot.sh <post-teardown ref> <dir>\n' +
    '       WITHOUT IT THIS GATE HAS NOT CHECKED THE THING IT IS FOR: the transform\n' +
    '       above is a claim about a spec, and the defect it guards was a claim about\n' +
    '       what the engine resolved on which seat.'
  );
} else if (!fs.existsSync(path.join(bundle, 'harness', 'build', 'bin', 'run-sweep.js'))) {
  ok(false, `--bundle ${bundle} has no build at harness/build/bin/run-sweep.js`);
} else {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'simworker-selftest-'));

  // THE REGRESSION, END TO END, THROUGH THE ENTRY POINT THE DEFECT LIVED IN.
  //
  // The spec seats TWO lobster contenders. `refineOn` carries a config of its
  // own from the spec; `gainOff` carries none. The treatment arm then ablates
  // ONE of them from the command line. Under the pre-20260830 merge that
  // command configured BOTH seats — which is exactly the contamination — so
  // this pair fails loudly if the merge ever comes back.
  //
  // Two arms, one game each, because run-pair refuses a lone arm and is right
  // to: the assertion here is about stamps rather than outcomes, but the entry
  // point is the thing under test and it is tested as it is used.
  const spec = {
    sweepId: 'isolation-regression',
    _comment: [
      'THE PER-SEAT ISOLATION REGRESSION. Two lobster contenders in one game,',
      'carrying DIFFERENT configs. Each seat must stamp its own and neither may',
      "stamp the other's. Generated by tools/simworker/bin/selftest.js.",
    ],
    bots: ['gainOff', 'refineOn', 'reflex'],
    contenders: {
      gainOff: { base: 'lobster-territory' },
      refineOn: { base: 'lobster-territory', bot: { territoryRefine: true } },
    },
    seeds: [909001],
    rotateSeats: false,
    cells: [
      {
        cell: 'iso',
        config: {
          name: 'iso',
          size: 11,
          teams: ['red', 'blue', 'green'],
          // Four is the smallest roster `normalizeConfig` accepts (4..8).
          roster: ['snake', 'snake', 'snake', 'snake'],
          placement: 'anchored',
          budgetMs: 60,
          turnCap: 6,
          food: { initial: 3, spawnRate: 0.5 },
          hazards: { layout: 'none' },
          potions: { enabled: false },
        },
      },
    ],
  };
  const specPath = path.join(out, 'spec.json');
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 1) + '\n');

  const batch = path.join(out, 'batch');
  const runPair = path.join(__dirname, 'run-pair.js');

  // FIRST: the ambiguous command must be REFUSED at the entry point, before a
  // game runs. This is the defect's own command line.
  let refusal = '';
  try {
    execFileSync(
      process.execPath,
      [runPair, '--batch', path.join(out, 'never'), '--spec', specPath,
       '--arm', `base=${bundle}`,
       '--arm', `treat=${bundle},bot={"candidates":{"gainOrdering":false}}`,
       '--workers', '1'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 }
    );
  } catch (e) {
    refusal = String((e.stderr || e.stdout || '') || '');
  }
  ok(/AMBIGUOUS/.test(refusal), 'run-pair REFUSES a bare bot= on a two-lobster spec');
  ok(
    !fs.existsSync(path.join(out, 'never')),
    'and refuses BEFORE launching anything — no half-batch left on disk'
  );

  // THEN: the targeted command must run, and configure one seat.
  let ran = true;
  let err = '';
  try {
    execFileSync(
      process.execPath,
      [runPair, '--batch', batch, '--spec', specPath,
       '--arm', `base=${bundle}`,
       '--arm', `treat=${bundle},bot@gainOff={"candidates":{"gainOrdering":false}}`,
       '--workers', '1', '--note', 'per-seat isolation regression'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }
    );
  } catch (e) {
    ran = false;
    // The FIRST lines, not the last: the message is at the top and the stack
    // below it is the part nobody needs to read from a gate.
    err = String((e.stderr || e.stdout || e.message) || '').split('\n').slice(0, 6).join('\n       ');
  }

  if (!ran) {
    // A bundle from before the 20260829 teardown REFUSES a spec that declares a
    // bot config — correctly, since it would ignore it. A skip with a reason,
    // not a failure of this gate.
    if (/bot-config|predates the flag teardown/i.test(err)) {
      skipped(`this bundle predates the flag teardown and cannot carry a bot config:\n       ${err}`);
    } else {
      ok(false, `the targeted pair did not run:\n       ${err}`);
    }
  } else {
    const stampsOf = (armName) => {
      const m = path.join(batch, 'arms', armName, 'isolation-regression', 'manifest.jsonl');
      if (!fs.existsSync(m)) return null;
      const row = JSON.parse(fs.readFileSync(m, 'utf8').trim().split('\n')[0]);
      const byBot = {};
      for (const h of row.health) byBot[h.bot] = h.mechanism ? h.mechanism.flags : null;
      return byBot;
    };
    const treat = stampsOf('treat');
    const base = stampsOf('base');
    if (treat === null || base === null) {
      ok(false, 'one arm wrote no manifest');
    } else if (!treat.gainOff || !treat.refineOn) {
      skipped(
        'this bundle publishes no mechanism.config stamp (pre-CL7 telemetry), so the\n' +
        '       resolved bot cannot be read per seat. Rebuild from a current ref.'
      );
    } else {
      // THE ASSERTION THE DEFECT WOULD HAVE FAILED.
      ok(treat.gainOff.gainOrdering === false, 'treat/gainOff resolved the ablation it was given');
      ok(
        treat.refineOn.gainOrdering === true,
        'treat/refineOn did NOT lose gainOrdering — the isolation property, at the stamp'
      );
      ok(
        treat.refineOn.territoryRefine === true,
        "treat/refineOn kept its OWN spec-declared config"
      );
      ok(
        treat.gainOff.territoryRefine === false,
        "treat/gainOff did not pick up refineOn's config"
      );
      ok(
        treat.gainOff.name === 'gainOff' && treat.refineOn.name === 'refineOn',
        'each seat stamps its own contender name'
      );
      ok(
        base.gainOff.gainOrdering === true && base.refineOn.gainOrdering === true,
        'the base arm carries the ablation on neither seat'
      );
      // AND THE ARM RECORD SAYS WHICH SEAT, not merely which config.
      const armJson = JSON.parse(fs.readFileSync(path.join(batch, 'arms', 'treat', 'arm.json'), 'utf8'));
      ok(
        armJson.seatConfigs && Object.keys(armJson.seatConfigs).join(',') === 'gainOff',
        'arm.json records the RESOLVED seat map, so a later reader can tell which seat moved'
      );
    }
  }
  fs.rmSync(out, { recursive: true, force: true });
}

// ------------------------------------------------------------------ verdict

console.log('');
console.log(`${pass} passed, ${fail} failed, ${skip} skipped.`);
if (fail > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
