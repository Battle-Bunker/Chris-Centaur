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

// ============================================================================
// 3-4. THE AGGREGATION'S TWO SILENT WRONG ANSWERS
//
// Both were found by the 20260831-batch2 ingest, both are reproduced here on
// synthetic batches with PLANTED answers, and both are the same species of
// defect: a value the tool used to pick for itself, where picking wrong
// produced a number rather than an error.
// ============================================================================

const AGG = path.join(__dirname, 'aggregate.js');
const VNULL = path.join(__dirname, 'verify-null.js');

/** Run a bin and return {code, out, err} without throwing. */
function run(script, argv) {
  try {
    const out = execFileSync(process.execPath, [script, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, encoding: 'utf8',
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? ''), err: String(e.stderr ?? '') };
  }
}

/**
 * ONE SYNTHETIC GAME, with the outcome PLANTED and the seats ROTATED.
 *
 * `subjShare` is the sharePar handed to `lobster-territory`; the other lobster
 * gets the complement about par, so the board is zero-sum about par exactly the
 * way the real 25x25 boards nearly are. That is what makes reading the wrong
 * seat return the right magnitude with the wrong sign, and it is the property
 * the regression turns on.
 *
 * `stamps` maps bot -> resolved config, which is what the fixed aggregate reads
 * to work out which seat the treatment reached.
 */
function fixtureRow({ sweepId, cell, seed, rotation, subjShare, stamps }) {
  const bots = ['reflex', 'lobster-territory', 'lobster-material'];
  // The seats ROTATE between games — the property that made reading row 0 a
  // lottery in the first place.
  const seats = bots.map((_, i) => ({
    seat: i, teamID: ['red', 'blue', 'green'][i], bot: bots[(i + rotation) % 3],
  }));
  const shares = {
    reflex: 0,
    'lobster-territory': subjShare,
    'lobster-material': 3 - subjShare, // zero-sum about par on a 3-team board
  };
  const results = seats.map((s) => ({
    seat: s.seat, bot: s.bot, teamID: s.teamID,
    place: s.bot === 'lobster-territory' ? (subjShare >= 1.5 ? 1 : 2) : 2,
    score: s.bot === 'lobster-territory' ? (subjShare >= 1.5 ? 1 : 0) : 0.5,
    finalUnits: 3, finalMaterial: Math.round(shares[s.bot] * 10),
    adjudicatedMaterial: Math.round(shares[s.bot] * 10),
    sharePar: shares[s.bot], eliminatedOnTurn: null,
  }));
  const health = seats.map((s) => ({
    seat: s.seat, bot: s.bot, decisions: 10, illegal: 0, unstaged: 0, stagedNothing: 0,
    overruns: 0, worstOverrunMs: 0, worstWallMs: 100, plansEvaluated: 1, assumptions: 0,
    boundViolations: 0, boundsInversions: 0, ratchetRefusals: 0,
    deathsSelf: 0, deathsWall: 0, deathsExhaustion: 0, deathsBodyBlock: 0,
    deathsContest: 0, deathsTeammate: 0, errors: 0,
    mechanism: stamps[s.bot] ? { flags: stamps[s.bot] } : undefined,
  }));
  return {
    sweepId, gameId: `${cell}-s${seed}-r${rotation}`, cell, block: `${cell}#${seed}`,
    rotation, configHash: `hash-${cell}`, seed, configName: cell,
    size: 11, teamCount: 3, unitsPerTeam: 6, budgetMs: 100, turnCap: 20,
    hazardDamage: 0, hazardLayout: 'none', foodSpawnRate: 0.5, fertile: false, potions: false,
    turns: 20, endKind: 'turn-cap', terminal: 'cap', reason: 'cap',
    seats, results, health,
  };
}

/** Write one arm of one sweep: `blocks` seeds x 3 rotations. */
function writeArm(batch, arm, sweepId, { cell = 'c', blocks = 4, shareOf, stamps, armJson }) {
  const dir = path.join(batch, 'arms', arm, sweepId);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (let s = 0; s < blocks; s++) {
    for (let r = 0; r < 3; r++) {
      rows.push(fixtureRow({ sweepId, cell, seed: 1000 + s, rotation: r, subjShare: shareOf(s, r), stamps }));
    }
  }
  // COMPLETION ORDER, not seed order — the manifest really is written by a
  // worker pool, and the old code read row 0.
  rows.reverse();
  fs.writeFileSync(path.join(dir, 'manifest.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(
    path.join(batch, 'arms', arm, 'arm.json'),
    JSON.stringify(armJson ?? { arm, bundleStamp: { sha: 'deadbeef' }, envOverrides: {} }, null, 1) + '\n'
  );
}

const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'simworker-aggfix-'));

section('3. THE SUBJECT SEAT — aggregate.js may not guess which bot it is measuring');

{
  /*
   * THE DEFECT ITSELF, WITH ITS SIGN PLANTED.
   *
   * A config pair: the treatment reaches `lobster-territory` only, and it makes
   * that bot WORSE by exactly 0.4 sharePar. Because the fixture board is
   * zero-sum about par, `lobster-material` therefore reads +0.4. The old
   * fallback read whichever lobster happened to sit first in the first row of
   * the manifest and could return either. The fixed tool derives the treated
   * seat from the resolved stamps and must return the TREATED one: -0.4.
   */
  const b = path.join(FIX, 'config-pair');
  const baseStamps = {
    'lobster-territory': { name: 'lobster-territory', unitFatality: false, gainOrdering: true },
    'lobster-material': { name: 'lobster-material', unitFatality: false, gainOrdering: true },
  };
  const treatStamps = {
    'lobster-territory': { name: 'lobster-territory', unitFatality: true, gainOrdering: true },
    'lobster-material': { name: 'lobster-material', unitFatality: false, gainOrdering: true },
  };
  writeArm(b, 'default', 'p-cfg', { shareOf: (s) => 1.5 + 0.01 * s, stamps: baseStamps });
  writeArm(b, 'treat', 'p-cfg', { shareOf: (s) => 1.1 + 0.01 * s, stamps: treatStamps });

  const r = run(AGG, ['--batch', b, '--base', 'default', '--out', path.join(b, 'a.json'), '--md', path.join(b, 'a.md')]);
  ok(r.code === 0, 'a config pair aggregates without a declared subject');
  const j = r.code === 0 ? JSON.parse(fs.readFileSync(path.join(b, 'a.json'), 'utf8')) : null;
  const sw = j ? j.sweeps[0] : null;
  ok(
    sw !== null && /lobster-territory/.test(sw.subject) && !/lobster-material/.test(sw.subject),
    'and RESOLVES the subject to the seat the config reached, not to the other lobster'
  );
  ok(
    sw !== null && /RESOLVED STAMP/.test(sw.subjectHow),
    'and says it derived that from the per-seat resolved stamps, so a reader can check it'
  );
  const d = sw ? sw.cells[0].deltas.treat.sharePar.mean : null;
  ok(d !== null && Math.abs(d - -0.4) < 1e-9, 'THE SIGN: the planted -0.4 comes back as -0.4');
  ok(
    d !== null && d < 0,
    'and NOT as +0.4 — the untreated seat on a near-zero-sum board reports the same ' +
      'magnitude with the sign reversed, which is what batch 2 P7F hit'
  );

  // And declaring the other seat must give the mirror image, which proves the
  // subject is the thing being selected and not an accident of the fixture.
  const r2 = run(AGG, ['--batch', b, '--base', 'default', '--subject', 'lobster-material',
    '--out', path.join(b, 'm.json'), '--md', path.join(b, 'm.md')]);
  const dm = r2.code === 0 ? JSON.parse(fs.readFileSync(path.join(b, 'm.json'), 'utf8')).sweeps[0].cells[0].deltas.treat.sharePar.mean : null;
  ok(dm !== null && Math.abs(dm - 0.4) < 1e-9, 'reading the UNTREATED seat gives +0.4 — the inversion, on demand and declared');
}

{
  /*
   * THE WHOLE-BUNDLE PAIR. No seat's stamp differs, because the two arms differ
   * by BUILD: both lobster seats are treated and both are legitimately
   * readable. There is no fact in the data that picks one, so the tool must
   * REFUSE rather than pick — and must name both candidates and the spelling
   * that resolves it.
   */
  const b = path.join(FIX, 'bundle-pair');
  const same = {
    'lobster-territory': { name: 'lobster-territory', unitFatality: false },
    'lobster-material': { name: 'lobster-material', unitFatality: false },
  };
  writeArm(b, 'baseline', 'p-bundle', { shareOf: (s) => 1.5 + 0.01 * s, stamps: same });
  writeArm(b, 'search-arch', 'p-bundle', { shareOf: (s) => 1.2 + 0.01 * s, stamps: same });

  const r = run(AGG, ['--batch', b, '--base', 'baseline', '--out', path.join(b, 'a.json'), '--md', path.join(b, 'a.md')]);
  ok(r.code === 3, 'a whole-bundle pair with no declared subject is REFUSED (exit 3), not guessed');
  ok(/REFUSES TO GUESS/.test(r.err), 'and the refusal says so in its first line');
  ok(
    /lobster-territory/.test(r.err) && /lobster-material/.test(r.err),
    'and names BOTH candidate seats rather than silently preferring one'
  );
  ok(/--subject lobster-territory/.test(r.err), 'and prints the exact spelling that fixes it');
  ok(
    !fs.existsSync(path.join(b, 'a.json')),
    'and refuses BEFORE computing anything — no half-written analysis left behind'
  );

  const r2 = run(AGG, ['--batch', b, '--base', 'baseline', '--subject', 'lobster-territory',
    '--out', path.join(b, 'a.json'), '--md', path.join(b, 'a.md')]);
  ok(r2.code === 0, 'and runs once the seat is declared');
  const sw = r2.code === 0 ? JSON.parse(fs.readFileSync(path.join(b, 'a.json'), 'utf8')).sweeps[0] : null;
  ok(sw !== null && /DECLARED/.test(sw.subjectHow), 'recording that the seat was declared rather than derived');
}

{
  /* One candidate seated: derivable with no stamps at all, and must stay so. */
  const b = path.join(FIX, 'one-lobster');
  const one = (arm, share) => {
    const dir = path.join(b, 'arms', arm, 'p-one');
    fs.mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 3; r++) {
        const row = fixtureRow({ sweepId: 'p-one', cell: 'c', seed: 1000 + s, rotation: r, subjShare: share, stamps: {} });
        for (const list of [row.seats, row.results, row.health]) {
          for (const x of list) if (x.bot === 'lobster-material') x.bot = 'reflex2';
        }
        rows.push(row);
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(b, 'arms', arm, 'arm.json'), JSON.stringify({ arm, bundleStamp: { sha: 'x' }, envOverrides: {} }) + '\n');
  };
  one('base', 1.5);
  one('treat', 1.2);
  const r = run(AGG, ['--batch', b, '--base', 'base', '--out', path.join(b, 'a.json'), '--md', path.join(b, 'a.md')]);
  ok(r.code === 0, 'a sweep seating ONE candidate contender still needs no declaration');
  const sw = r.code === 0 ? JSON.parse(fs.readFileSync(path.join(b, 'a.json'), 'utf8')).sweeps[0] : null;
  ok(sw !== null && /only contender/.test(sw.subjectHow), 'and says it was the only contender seated');
}

section('4. THE BASE ARM — resolved per sweep, because no arm is in every sweep');

{
  /*
   * THE CRASH. `--base` names one arm for the BATCH. N0 floors every board and
   * shares no arm with any treatment, so `byArm.get(baseName)` was undefined
   * in the delta loop:
   *   TypeError: Cannot read properties of undefined (reading 'get')
   * The integrity gate already fell back; the delta loop did not.
   */
  const b = path.join(FIX, 'disjoint-sweeps');
  const st = {
    'lobster-territory': { name: 'lobster-territory', unitFatality: false },
    'lobster-material': { name: 'lobster-material', unitFatality: false },
  };
  const treatSt = {
    'lobster-territory': { name: 'lobster-territory', unitFatality: true },
    'lobster-material': { name: 'lobster-material', unitFatality: false },
  };
  writeArm(b, 'default', 'p-treat', { shareOf: (s) => 1.5 + 0.01 * s, stamps: st });
  writeArm(b, 'treat', 'p-treat', { shareOf: (s) => 1.3 + 0.01 * s, stamps: treatSt });
  // The A/A null: a DIFFERENT pair of arms, in a sweep `default` never ran.
  writeArm(b, 'nullA', 'n0-aa-null', { shareOf: (s) => 1.5 + 0.01 * s, stamps: st });
  writeArm(b, 'nullB', 'n0-aa-null', { shareOf: (s) => 1.5 + 0.01 * s, stamps: st });

  const r = run(AGG, ['--batch', b, '--base', 'default', '--subject', 'lobster-territory',
    '--out', path.join(b, 'a.json'), '--md', path.join(b, 'a.md')]);
  ok(r.code === 0, 'a batch whose base arm is absent from one sweep AGGREGATES instead of crashing');
  ok(
    !/Cannot read properties of undefined/.test(r.err),
    'and specifically does not throw the TypeError at the delta loop that batch 2 hit'
  );
  const j = r.code === 0 ? JSON.parse(fs.readFileSync(path.join(b, 'a.json'), 'utf8')) : { sweeps: [] };
  ok(j.sweeps.length === 2, 'both sweeps are reported — the null is not lost with the crash');
  const byId = Object.fromEntries(j.sweeps.map((s) => [s.sweepId, s]));
  ok(byId['p-treat'] && byId['p-treat'].base === 'default', 'the sweep the base arm ran uses the requested base');
  ok(
    byId['n0-aa-null'] && byId['n0-aa-null'].base === 'nullA',
    'the sweep it did NOT run falls back to an arm that is actually present'
  );
  ok(
    byId['n0-aa-null'] && byId['n0-aa-null'].cells[0].deltas.nullB !== undefined,
    'and its delta is taken against that fallback base, not against nothing'
  );
  const mdText = fs.existsSync(path.join(b, 'a.md')) ? fs.readFileSync(path.join(b, 'a.md'), 'utf8') : '';
  ok(
    /not the requested `default`/.test(mdText),
    'the markdown SAYS the base was substituted rather than letting a reader assume otherwise'
  );
  ok(
    /Δ nullB−nullA/.test(mdText),
    'and labels the delta column with the base it was actually taken against'
  );
  ok(
    j.problems.some((p) => /did not run it/.test(p)),
    'and the substitution is recorded as an integrity problem, not only in the prose'
  );
}

section('5. THE NOISE FLOOR IS A PROPERTY OF ONE SEAT — verify-null.js');

{
  /*
   * The A/A cell cannot invert a sign — both arms are the same build. It can
   * publish the WRONG FLOOR, which is quieter and, for the tool whose whole job
   * is the yardstick, worse: every treatment in the batch is read against it.
   * On batch 2's own A/A rows the two seats' `null-snake6` score floors differ
   * by 2.2x. So this refuses an undeclared seat too.
   */
  const b = path.join(FIX, 'null-seat');
  const st = {
    'lobster-territory': { name: 'lobster-territory' },
    'lobster-material': { name: 'lobster-material' },
  };
  // Same build both sides; the two seats carry DIFFERENT dispersion, which is
  // the whole point — their floors are not interchangeable.
  writeArm(b, 'nullA', 'n0-aa-null', { shareOf: (s, r) => 1.5 + 0.2 * ((s + r) % 2), stamps: st });
  writeArm(b, 'nullB', 'n0-aa-null', { shareOf: (s, r) => 1.5 + 0.2 * ((s + r + 1) % 2), stamps: st });

  const r = run(VNULL, ['--batch', b, '--null', 'nullA,nullB']);
  ok(r.code !== 0, 'verify-null REFUSES to publish a floor for an undeclared seat');
  ok(/does not guess which bot/.test(r.out), 'and says it does not guess');
  ok(
    /lobster-territory/.test(r.out) && /lobster-material/.test(r.out) && /--subject /.test(r.out),
    'and names both candidates it will not choose between, with the spelling that resolves it'
  );

  const r2 = run(VNULL, ['--batch', b, '--null', 'nullA,nullB', '--subject', 'lobster-territory']);
  ok(r2.code === 0, 'and publishes the floor once the seat is declared');
  ok(
    /measured on the `lobster-territory` seat/.test(r2.out),
    'stamping the floor with the seat it belongs to, so a treatment is read against its own'
  );
}

section('6. A MINER READS THE FOLD, NOT THE RAW REPORT — depth-ran.js');

{
  /*
   * THE DEFECT ITSELF, AND IT COST A BATCH.
   *
   * `depth-ran.js` shipped reading `mechanism.cluster`, `mechanism.scout.plies`
   * and `mechanism.scout.focus.fired` — the RAW `MechanismReport` paths. The
   * replay stream carries the FOLD (`harness/lib/bots.ts::foldMechanism`):
   * `clusterJoints`, `scoutPlies`, `focusFired`. Every lookup was `undefined`,
   * every `??` defaulted to 0, and the tool reported the depth layer running on
   * 0.0% of 7,680 decisions — for the treatment arm AND the control, at three
   * budgets. A third of a batch's conclusions were retracted on that reading
   * before anyone opened a replay.
   *
   * So the fixture is a replay whose depth layer plainly RAN, and the assertion
   * is that the miner says so. A field-name drift of any kind fails it.
   */
  const dir = path.join(FIX, 'depth-ran', 'arms', 'tip', 'sw');
  fs.mkdirSync(dir, { recursive: true });
  const folded = {
    clusterJoints: 512,
    clusterEnumMs: 40,
    scoutThreads: 18,
    scoutPlies: 24,
    scoutDeepestPlies: 3,
    scoutObservations: 16,
    slices: 6,
    improveCalls: 6,
    refineCalls: 0,
    focusDecisions: 1,
    focusFired: 1,
  };
  const lines = [
    { kind: 'header', config: { name: 'c', budgetMs: 1000 }, seats: [{ teamID: 'red', bot: 'subject' }] },
    { kind: 'turn', turn: 1, telemetry: { red: { mechanism: folded } } },
    { kind: 'turn', turn: 2, telemetry: { red: { mechanism: folded } } },
  ];
  fs.writeFileSync(
    path.join(dir, 'g.jsonl.gz'),
    require('zlib').gzipSync(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  );

  const r = run(path.join(__dirname, 'depth-ran.js'), [path.join(FIX, 'depth-ran')]);
  ok(r.code === 0, 'depth-ran reads a replay whose rows carry the folded shape');
  ok(/\*\*100\.0%\*\*/.test(r.out), 'THE REGRESSION: a layer that ran reads 100.0%, not 0.0%');
  ok(/\| 24\.00 \|/.test(r.out), 'and the scout plies come back as 24, not as a defaulted 0');
  ok(/\| 6\.00 \|/.test(r.out), 'and the loop column reports the improve calls that caused them');

  /*
   * AND THE OTHER HALF: a row this miner cannot read must be REFUSED, not
   * counted as a zero. That is the property the original lacked — it had no way
   * to tell "the layer did not run" from "I am looking at the wrong field".
   */
  const dir2 = path.join(FIX, 'depth-ran-raw', 'arms', 'tip', 'sw');
  fs.mkdirSync(dir2, { recursive: true });
  const raw = { cluster: { jointsEnumerated: 512 }, scout: { plies: 24, threads: 18 } };
  fs.writeFileSync(
    path.join(dir2, 'g.jsonl.gz'),
    require('zlib').gzipSync(
      [
        { kind: 'header', config: { name: 'c', budgetMs: 1000 }, seats: [{ teamID: 'red', bot: 'subject' }] },
        { kind: 'turn', turn: 1, telemetry: { red: { mechanism: raw } } },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n'
    )
  );
  const r2 = run(path.join(__dirname, 'depth-ran.js'), [path.join(FIX, 'depth-ran-raw')]);
  ok(r2.code !== 0, 'a row whose shape this miner does not understand is REFUSED');
  ok(/REFUSED/.test(r2.err + r2.out), 'and the refusal says so rather than printing a zero');
}

fs.rmSync(FIX, { recursive: true, force: true });

// ------------------------------------------------------------------ verdict

console.log('');
console.log(`${pass} passed, ${fail} failed, ${skip} skipped.`);
if (fail > 0) {
  console.log('');
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
