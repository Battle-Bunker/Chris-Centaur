#!/usr/bin/env node
/*
 * RUN A PAIRED CELL — the entry point every real measurement goes through.
 *
 *   node tools/simworker/bin/run-pair.js \
 *     --batch  <batch-dir> \
 *     --spec   <spec.json> \
 *     --arm    base=<bundle-dir> \
 *     --arm    'treat=<bundle-dir>,bot={"territoryRefine":true}' \
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
 *   name=<bundle-dir>[,bot=<json-or-path>][,KEY=VALUE]...
 *
 * The bundle is a build of some branch (build-bot.sh). An A/A NULL is two arms
 * with the SAME bundle and the SAME contender and different names — which is
 * exactly what verify-null.js checks for and what every batch needs one of.
 *
 * ── AN ARM IS A CONFIGURED BOT, NOT AN ENVIRONMENT ─────────────────────────
 *
 * `bot=` names a `BotConfig` — inline JSON, or a path to a `.json` file — and
 * it is applied to EVERY lobster contender the spec seats. The runner writes
 * the arm its own spec: the shared spec with the contender configs merged, and
 * `sweepId`, `cells`, `seeds` and `rotateSeats` byte-identical, so the pairing
 * guarantee is untouched — same boards, same seeds, same seat rotation, two
 * differently-configured bots.
 *
 * WHY IT IS NOT AN ENVIRONMENT VARIABLE ANY MORE. The owner's ruling of
 * 2026-08-29 tore the engine's feature-flag system out, and every `CENTAUR_*`
 * strategy flag is gone from the source. That is worth stating as a
 * MEASUREMENT fact and not just an API change: a process-wide variable moved
 * every lobster seat on the board at once, so a paired experiment on one
 * measured the difference between two whole boards and not the difference the
 * arm was named for. A contender is per seat, by construction.
 *
 * KEY=VALUE STILL WORKS, and is still an environment override applied to that
 * arm's process only — the harness needs it for things that really are process
 * environment (`DECISION_POOL_SIZE`, a bundle's own test seams). But the names
 * the teardown killed are REFUSED, by name, rather than passed through to a
 * bundle that would ignore them: see DEAD_FLAGS. Passing one to a current
 * bundle produces an A/A pair wearing a treatment's name, which is the single
 * most expensive mistake this harness can make. `--legacy-env` overrides the
 * refusal for the one legitimate case — REPRODUCING BATCH 1 against the
 * PRE-TEARDOWN BUNDLES it was actually run on, which do still read them — and
 * records `legacyEnv: true` on the arm so the manifest says so.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ------------------------------------------------------------------- args

function parseArgs(argv) {
  const out = { arms: [], workers: '1', resume: false, note: '', batch: '', spec: '', legacyEnv: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') out.arms.push(argv[++i]);
    else if (a === '--legacy-env') out.legacyEnv = true;
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

/**
 * THE FLAGS THE 2026-08-29 TEARDOWN DELETED.
 *
 * Setting one of these on a current bundle does nothing at all — the variable
 * has no reader — so the arm plays the shipped bot under a treatment's name and
 * the batch reports an A/A pair as a null result. Refused by name, with the
 * disposition each one got, so the operator learns what to write instead.
 */
const DEAD_FLAGS = {
  CENTAUR_ENGINE: 'now bot config: bot={"engine":"legacy"}',
  CENTAUR_STAGING_SAFETY: 'now bot config: bot={"stagingSafety":"guard"}',
  CENTAUR_TERRITORY_REFINE: 'now bot config: bot={"territoryRefine":true}',
  CENTAUR_UNIT_FATALITY: 'now bot config: bot={"candidates":{"unitFatality":true}}',
  CENTAUR_TIER_DEFENSE:
    'now bot config: bot={"candidates":{"tierSafeStaging":false,"selfDebuffOrdering":false}}',
  CENTAUR_WORKERS: 'now bot config: bot={"workers":"auto"} (deployment, judged by benchmarks)',
  CENTAUR_WORKERS_AUDIT: 'now bot config: bot={"workersAudit":true}',
  CENTAUR_ROYAL_MARGIN:
    'deleted; the reading is a CriterionProfile param and the correction it is owed ' +
    'has not been made — see staging-safety.ts DEFAULT_ROYAL_REACHERS',
  CENTAUR_TIER_TRUTH: 'deleted; the premise is now `full`, unconditionally — a correction',
  CENTAUR_MUTUAL_WIPE_AWARD: 'deleted; the award is unconditional — a correction',
  CENTAUR_WASM: 'deleted before this teardown; the flag no longer exists',
};

/** `name=/path/to/bundle[,bot=<json|path>][,KEY=V]` -> {name, bundle, bot, env}. */
function parseArm(text, allowLegacyEnv) {
  const parts = text.split(',');
  const head = parts.shift();
  const eq = head.indexOf('=');
  if (eq <= 0) fail(`--arm "${text}" must start with <name>=<bundle-dir>`);
  const name = head.slice(0, eq);
  const bundle = path.resolve(head.slice(eq + 1));
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) fail(`arm name "${name}" must be alphanumeric/dash/underscore`);
  const env = {};
  let bot = null;
  // An inline JSON bot config contains commas, so it is rejoined here: `bot=`
  // takes the whole rest of the arm string.
  const botAt = parts.findIndex((p) => p.startsWith('bot='));
  if (botAt >= 0) {
    const raw = parts.splice(botAt).join(',').slice('bot='.length);
    bot = readBotConfig(raw, name);
  }
  for (const p of parts) {
    const j = p.indexOf('=');
    if (j <= 0) fail(`--arm "${text}": "${p}" is not KEY=VALUE`);
    const key = p.slice(0, j);
    if (Object.prototype.hasOwnProperty.call(DEAD_FLAGS, key) && !allowLegacyEnv) {
      fail(
        `--arm "${name}": ${key} is a DELETED feature flag.\n` +
        `  ${DEAD_FLAGS[key]}\n` +
        '  A current bundle has no reader for it, so this arm would play the SHIPPED bot\n' +
        "  under a treatment's name and the batch would report an A/A pair as a null.\n" +
        '  If you are deliberately re-running batch 1 against its ORIGINAL pre-teardown\n' +
        '  bundles, which do read it, pass --legacy-env and say so in --note.'
      );
    }
    env[key] = p.slice(j + 1);
  }
  return { name, bundle, bot, env };
}

/** Inline JSON, or a path to a JSON file. Validated here so a typo fails at
 * launch rather than after the first game. */
function readBotConfig(raw, armName) {
  const text = raw.trim().startsWith('{')
    ? raw
    : (() => {
        const p = path.resolve(raw);
        if (!fs.existsSync(p)) fail(`--arm "${armName}": bot config file not found: ${p}`);
        return fs.readFileSync(p, 'utf8');
      })();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    fail(`--arm "${armName}": bot config is not valid JSON — ${e.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`--arm "${armName}": bot config must be a JSON object`);
  }
  return parsed;
}

/**
 * The arm's own spec: the shared one with this arm's bot config merged into
 * every LOBSTER contender, and everything that defines the boards untouched.
 *
 * The untouched half is the pairing guarantee, so it is asserted rather than
 * assumed — `sweepId`, `cells`, `seeds` and `rotateSeats` are copied by
 * reference from the shared spec and never read from the arm.
 */
function specForArm(spec, arm) {
  if (arm.bot === null) return spec;
  const contenders = { ...(spec.contenders ?? {}) };
  const bots = spec.bots ?? [];
  const lobsterish = bots.filter((b) => b === 'lobster-territory' || contenders[b] !== undefined);
  if (lobsterish.length === 0) {
    fail(
      `--arm "${arm.name}": bot= was given but the spec seats no lobster contender for it ` +
      `to configure (bots: ${bots.join(', ')}).`
    );
  }
  for (const b of lobsterish) {
    const existing = contenders[b] ?? {};
    contenders[b] = {
      ...existing,
      base: existing.base ?? (b === 'lobster-territory' ? 'lobster-territory' : existing.base),
      bot: { ...(existing.bot ?? {}), ...arm.bot },
    };
  }
  return { ...spec, contenders };
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

const arms = args.arms.map((t) => parseArm(t, args.legacyEnv));
const names = new Set(arms.map((a) => a.name));
if (names.size !== arms.length) fail('two arms share a name; names are directory names and must be distinct');

const specPath = path.resolve(args.spec);
if (!fs.existsSync(specPath)) fail(`spec not found: ${specPath}`);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
if (typeof spec.sweepId !== 'string' || spec.sweepId === '') fail('spec has no sweepId');

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
  console.log(`#   ${''.padEnd(14)} bot: ${arm.bot === null ? '(spec default)' : JSON.stringify(arm.bot)}`);
  console.log(`#   ${''.padEnd(14)} env: ${envText}${args.legacyEnv ? '  [--legacy-env]' : ''}`);
}
console.log('');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const children = arms.map((arm) => {
  const outRoot = path.join(batchDir, 'arms', arm.name);
  fs.mkdirSync(outRoot, { recursive: true });

  // The arm's own spec when it configures a bot, the shared one otherwise.
  // Written into the arm's own directory so a finished batch carries, per arm,
  // the exact spec that arm was played under.
  let armSpecPath = specPath;
  if (arm.bot !== null) {
    armSpecPath = path.join(outRoot, 'spec.json');
    fs.writeFileSync(armSpecPath, JSON.stringify(specForArm(spec, arm), null, 1) + '\n');
  }

  const argv = [
    path.join(arm.bundle, 'harness', 'build', 'bin', 'run-sweep.js'),
    '--spec', armSpecPath,
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
    // WHAT MAKES THIS ARM THIS ARM. `botConfig` is the contender; `envOverrides`
    // is process environment only and can no longer carry a strategy.
    botConfig: arm.bot,
    envOverrides: arm.env,
    legacyEnv: args.legacyEnv,
    spec: spec.sweepId,
    specPath: armSpecPath,
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
      botConfig: a.bot,
      envOverrides: a.env,
      legacyEnv: args.legacyEnv,
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
