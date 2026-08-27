#!/usr/bin/env node
/*
 * RUN A PAIRED CELL — the entry point every real measurement goes through.
 *
 *   node tools/simworker/bin/run-pair.js \
 *     --batch  <batch-dir> \
 *     --spec   <spec.json> \
 *     --arm    base=<bundle-dir> \
 *     --arm    treat=<bundle-dir>,CENTAUR_WASM=on \
 *     [--workers 1] [--resume] [--note "..."]
 *
 * ── WHY THIS EXISTS AND WHY IT REFUSES A SINGLE ARM ────────────────────────
 *
 * Every bot here is ANYTIME and WALL-CLOCK BOUNDED. How much it searches is a
 * function of how much CPU it got, so a game played on a quiet box and a game
 * played on a loaded box are played by two different bots wearing the same
 * name. That is not a small effect: the program's own budget-noise exhibits put
 * it at the same order as the treatment effects being chased.
 *
 * A sequential design cannot survive that. Arm A at 21:00 and arm B at 23:00
 * ran under two load regimes, and the difference between them contains the
 * treatment AND the difference between those regimes, with no way to separate
 * the two after the fact.
 *
 * So arms are launched at the SAME INSTANT, in separate processes, each with
 * its own `--workers`, and whatever the box is doing lands on both of them. The
 * pairing is then exact: same sweepId, same cells, same seeds, same seat
 * rotation, so game `<cell>-<seed>-r<rot>` in arm A and the same gameId in arm
 * B are the same board played by two different builds under one load.
 *
 * A SINGLE ARM IS REFUSED. Not discouraged — refused. A lone arm produces
 * numbers that look exactly like paired numbers and mean nothing, and the one
 * reliable way an unpaired result gets into a findings table is somebody
 * running one arm "just to see" and then quoting it. If you want a lone
 * baseline for throughput, use run-sweep.js directly and do not put its
 * outcome metrics in a table.
 *
 * ── WHAT AN ARM IS ─────────────────────────────────────────────────────────
 *
 *   name=<bundle-dir>[,KEY=VALUE]...
 *
 * The bundle is a build of some branch (build-bot.sh). The KEY=VALUE pairs are
 * environment overrides applied to that arm's process only. An A/A NULL is two
 * arms with the SAME bundle and the SAME env and different names — which is
 * exactly what verify-null.js checks for and what every batch needs one of.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------------- args

function parseArgs(argv) {
  const out = { arms: [], workers: '1', resume: false, note: '', batch: '', spec: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') out.arms.push(argv[++i]);
    else if (a === '--batch') out.batch = argv[++i];
    else if (a === '--spec') out.spec = argv[++i];
    else if (a === '--workers') out.workers = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--resume') out.resume = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else fail(`unknown argument "${a}"`);
  }
  return out;
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 46).join('\n').replace(/^ ?\*ary?/gm, ''));
}

function fail(msg) {
  console.error(`\n[run-pair] FATAL: ${msg}\n`);
  process.exit(1);
}

/** `name=/path/to/bundle,KEY=V,KEY2=V2` -> {name, bundle, env}. */
function parseArm(text) {
  const parts = text.split(',');
  const head = parts.shift();
  const eq = head.indexOf('=');
  if (eq <= 0) fail(`--arm "${text}" must start with <name>=<bundle-dir>`);
  const name = head.slice(0, eq);
  const bundle = path.resolve(head.slice(eq + 1));
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) fail(`arm name "${name}" must be alphanumeric/dash/underscore`);
  const env = {};
  let armSpec = null;
  for (const p of parts) {
    const j = p.indexOf('=');
    if (j <= 0) fail(`--arm "${text}": "${p}" is not KEY=VALUE`);
    const k = p.slice(0, j);
    const v = p.slice(j + 1);
    // A lowercase `spec=` selects a per-arm spec VARIANT (same sweepId, e.g. a
    // different subject bot for P3's slider seam). Engine env keys are all
    // uppercase, so the namespace cannot collide.
    if (k === 'spec') armSpec = path.resolve(v);
    else env[k] = v;
  }
  return { name, bundle, env, armSpec };
}

const args = parseArgs(process.argv);
if (args.batch === '') fail('--batch <dir> is required');
if (args.spec === '') fail('--spec <spec.json> is required');
if (args.arms.length < 2) {
  fail(
    `${args.arms.length} arm(s) given; a paired cell needs at least 2.\n` +
    '  An anytime bot\'s strength is a function of the CPU it got, so a lone arm\n' +
    '  measures the treatment AND the machine, inseparably. Add the baseline arm —\n' +
    '  or, for an A/A null, the same bundle twice under two names:\n' +
    '     --arm nullA=<bundle> --arm nullB=<bundle>\n' +
    '  If you genuinely want one unpaired sweep for throughput only, call\n' +
    '  harness/build/bin/run-sweep.js directly and keep its outcome numbers out\n' +
    '  of every table.'
  );
}

const arms = args.arms.map(parseArm);
for (const arm of arms) {
  if (!arm.armSpec) continue;
  if (!fs.existsSync(arm.armSpec)) fail(`arm "${arm.name}": spec variant not found: ${arm.armSpec}`);
  const v = JSON.parse(fs.readFileSync(arm.armSpec, 'utf8'));
  if (v.sweepId !== JSON.parse(fs.readFileSync(path.resolve(args.spec), 'utf8')).sweepId) {
    fail(`arm "${arm.name}": spec variant sweepId "${v.sweepId}" differs from the pair's sweepId — a variant must be the same sweep`);
  }
}
const names = new Set(arms.map((a) => a.name));
if (names.size !== arms.length) fail('two arms share a name; names are directory names and must be distinct');

const specPath = path.resolve(args.spec);
if (!fs.existsSync(specPath)) fail(`spec not found: ${specPath}`);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
if (typeof spec.sweepId !== 'string' || spec.sweepId === '') fail('spec has no sweepId');

// A per-arm spec variant must be the SAME sweep (same sweepId, so gameIds
// pair) — it exists to move seat contents, not to smuggle in a different
// experiment. aggregate.js still checks configHash and seats game by game;
// a deliberate subject swap is declared there with --subject-map.


const batchDir = path.resolve(args.batch);

// Every arm must actually be built, and the check happens BEFORE anything is
// launched — half a pair is worse than none, because the half that ran looks
// like data.
for (const arm of arms) {
  const entry = path.join(arm.bundle, 'harness', 'build', 'bin', 'run-sweep.js');
  if (!fs.existsSync(entry)) {
    fail(`arm "${arm.name}": no build at ${entry}\n  Build it first:  tools/simworker/build-bot.sh <ref> ${arm.bundle}`);
  }
}

// ------------------------------------------------------------------- launch

const stamp = new Date().toISOString();
const loadBefore = os.loadavg();

console.log(`# batch      ${batchDir}`);
console.log(`# sweep      ${spec.sweepId}`);
console.log(`# arms       ${arms.map((a) => a.name).join(' | ')}`);
console.log(`# host       ${os.hostname()} ${os.platform()}/${os.arch()} cpus=${os.cpus().length} ` +
            `mem=${(os.totalmem() / 1024 ** 3).toFixed(1)}G node=${process.version}`);
console.log(`# loadavg    ${loadBefore.map((x) => x.toFixed(2)).join(' ')} (before launch)`);
console.log(`# workers    ${args.workers} per arm  => ${arms.length * Number(args.workers)} concurrent games`);
console.log('');

for (const arm of arms) {
  const bundleStamp = readJson(path.join(arm.bundle, 'bundle.json'));
  const envText = Object.keys(arm.env).length === 0 ? '(inherited)' : Object.entries(arm.env).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`#   ${arm.name.padEnd(14)} ${bundleStamp ? `${bundleStamp.sha.slice(0, 10)} ${bundleStamp.ref}` : 'UNSTAMPED BUNDLE'}`);
  console.log(`#   ${''.padEnd(14)} env: ${envText}`);
}
console.log('');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const children = arms.map((arm) => {
  const outRoot = path.join(batchDir, 'arms', arm.name);
  fs.mkdirSync(outRoot, { recursive: true });

  const argv = [
    path.join(arm.bundle, 'harness', 'build', 'bin', 'run-sweep.js'),
    '--spec', arm.armSpec ?? specPath,
    '--out', outRoot,
    '--workers', args.workers,
  ];
  if (args.resume) argv.push('--resume');

  const logPath = path.join(outRoot, `${spec.sweepId}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'a' });

  // The arm's own record, written BEFORE the run so a killed batch still says
  // what it was trying to do.
  fs.writeFileSync(path.join(outRoot, 'arm.json'), JSON.stringify({
    arm: arm.name,
    bundle: arm.bundle,
    bundleStamp: readJson(path.join(arm.bundle, 'bundle.json')),
    envOverrides: arm.env,
    spec: spec.sweepId,
    specPath: arm.armSpec ?? specPath,
    specVariantOf: arm.armSpec ? specPath : null,
    workers: Number(args.workers),
    startedAt: stamp,
    note: args.note,
  }, null, 1) + '\n');

  const child = spawn(process.execPath, argv, {
    env: { ...process.env, ...arm.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${arm.name}] `;
  const pipe = (stream, sink) => {
    let buf = '';
    stream.on('data', (chunk) => {
      log.write(chunk);
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) sink(tag + l);
    });
  };
  pipe(child.stdout, (l) => console.log(l));
  pipe(child.stderr, (l) => console.error(l));
  return { arm, child, logPath };
});

// A loadavg trace across the run. Budget honesty is not a footnote: the whole
// reason arms are concurrent is that load moves results, and a batch that
// cannot show what the load was during it cannot defend its own numbers.
const loadTrace = [];
const loadTimer = setInterval(() => {
  loadTrace.push({ t: new Date().toISOString(), load: os.loadavg(), freeGb: Number((os.freemem() / 1024 ** 3).toFixed(2)) });
}, 30_000);
loadTimer.unref();

const results = [];
let outstanding = children.length;

for (const { arm, child, logPath } of children) {
  child.on('exit', (code, signal) => {
    results.push({ arm: arm.name, code, signal, logPath });
    console.log(`# ${arm.name} exited code=${code} signal=${signal ?? '-'}`);
    if (--outstanding === 0) finish();
  });
}

function finish() {
  clearInterval(loadTimer);
  const loadAfter = os.loadavg();
  const failedArms = results.filter((r) => r.code !== 0);

  const summary = {
    batch: path.basename(batchDir),
    sweepId: spec.sweepId,
    startedAt: stamp,
    finishedAt: new Date().toISOString(),
    note: args.note,
    workersPerArm: Number(args.workers),
    arms: arms.map((a) => ({
      arm: a.name,
      bundle: a.bundle,
      bundleStamp: readJson(path.join(a.bundle, 'bundle.json')),
      envOverrides: a.env,
      specPath: a.armSpec ?? specPath,
      exit: results.find((r) => r.arm === a.name) ?? null,
      games: countManifest(path.join(batchDir, 'arms', a.name, spec.sweepId, 'manifest.jsonl')),
    })),
    host: {
      hostname: os.hostname(), platform: os.platform(), arch: os.arch(),
      cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || null,
      totalmemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
      node: process.version,
    },
    loadavg: { before: loadBefore, after: loadAfter, trace: loadTrace },
  };

  fs.mkdirSync(path.join(batchDir, 'pairs'), { recursive: true });
  const outPath = path.join(batchDir, 'pairs', `${spec.sweepId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 1) + '\n');

  console.log('');
  console.log(`# pair record -> ${outPath}`);
  for (const a of summary.arms) {
    console.log(`#   ${a.arm.padEnd(14)} ${a.games} games`);
  }
  const counts = new Set(summary.arms.map((a) => a.games));
  if (counts.size > 1) {
    console.log('#');
    console.log('# WARNING: the arms finished DIFFERENT numbers of games. The pairing is');
    console.log('# only valid over the gameIds present in BOTH — aggregate.js will intersect');
    console.log('# them and report how many it dropped. Say so in findings.md.');
  }
  if (failedArms.length > 0) {
    console.log(`# WARNING: ${failedArms.length} arm(s) exited non-zero: ${failedArms.map((r) => r.arm).join(', ')}`);
    console.log('# Their logs are in the arm directories. Document the failure in findings.md;');
    console.log('# do not quietly rerun only the arm that failed — that unpairs the cell.');
  }
  process.exit(failedArms.length > 0 ? 1 : 0);
}

function countManifest(p) {
  try {
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}
