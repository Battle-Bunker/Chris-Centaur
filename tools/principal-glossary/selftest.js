#!/usr/bin/env node
'use strict';
/*
 * node tools/principal-glossary/selftest.js
 *
 * No dependencies. Asserts the ledger is valid and the checker actually catches
 * what it claims to catch — including by trying to sneak jargon past it.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const G = require('./lib/glossary');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const CHECK = path.join(__dirname, 'check-briefing.js');
const RENDER = path.join(__dirname, 'render-view.js');

/** Run check-briefing.js over `text`; returns {code, out}. */
function check(text, extra) {
  try {
    const out = execFileSync(process.execPath, [CHECK, ...(extra || [])], {
      input: text, encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// --- the ledger itself ------------------------------------------------------
let ledger;
try {
  ledger = G.load();
  ok('ledger loads and validates', true);
} catch (e) {
  ok('ledger loads and validates', false, e.message);
  console.error(fails.join('\n'));
  process.exit(1);
}

const chris = G.principal(ledger, 'chris');
ok('principal chris exists', !!chris);
ok('multi-principal shape (principals is an array)', Array.isArray(ledger.principals));
ok('every state is represented in the seed',
  ['native', 'defined', 'corrected', 'internal']
    .every((s) => chris.terms.some((t) => t.state === s)));

const sorted = chris.terms.map((t) => t.term.toLowerCase());
ok('terms are sorted by lowercased term (merge invariant)',
  sorted.every((v, i) => i === 0 || sorted[i - 1] <= v));

ok('every corrected term carries redefineOnNextUse',
  chris.terms.filter((t) => t.state === 'corrected').every((t) => t.redefineOnNextUse === true));
ok('every corrected term carries the principal\'s own words',
  chris.terms.filter((t) => t.state === 'corrected')
    .every((t) => t.evidence[t.evidence.length - 1].quote));
ok('every term carries dated evidence',
  chris.terms.every((t) => t.evidence.length && t.evidence.every((e) => e.date)));
ok('every term\'s state matches its last evidence transition',
  chris.terms.every((t) => t.evidence[t.evidence.length - 1].to === t.state));

// validate() must actually reject bad ledgers, or it is decoration ------------
function mutate(fn) {
  const copy = JSON.parse(JSON.stringify(ledger));
  delete copy._path;
  fn(G.principal(copy, 'chris'), copy);
  return G.validate(copy);
}
ok('validate rejects a native term with no quote and no attestation',
  mutate((p) => {
    const t = p.terms.find((x) => x.state === 'native');
    const e = t.evidence[t.evidence.length - 1];
    e.quote = null; delete e.attestation;
  }).length > 0);
ok('validate rejects an out-of-order term list',
  mutate((p) => { p.terms.reverse(); }).length > 0);
ok('validate rejects a state that contradicts its evidence',
  mutate((p) => { p.terms.find((x) => x.state === 'internal').state = 'native'; }).length > 0);
ok('validate rejects a term with no evidence at all',
  mutate((p) => { p.terms[0].evidence = []; }).length > 0);
ok('validate rejects a corrected term without redefineOnNextUse',
  mutate((p) => {
    const t = p.terms.find((x) => x.state === 'corrected');
    if (t) delete t.redefineOnNextUse;
  }).length > 0);

// --- the checker ------------------------------------------------------------
const CLEAN =
  'The worker threads and WASM work landed, so a multi-second turn now spends its\n' +
  'compute time across cores instead of a single-threaded run. Win rate on the\n' +
  'snake-only boards did not move. Clusters expand when entanglement accumulation\n' +
  'on a search thread eats our uncertainty clouds, so we keep looking ahead on\n' +
  'partial boards. Branch selection stays weighted random selection over priors.\n';

const r1 = check(CLEAN);
ok('a clean briefing exits 0', r1.code === 0, `exit ${r1.code}\n${r1.out}`);

const DIRTY =
  'The kernel carries the ratchet across rounds, and a new gainWeighting pass\n' +
  'reorders candidates before the second round of node evaluation.\n';
const r2 = check(DIRTY);
ok('an internal term + a novel camelCase token exits nonzero', r2.code !== 0);
ok('the internal term is named in the output', /ratchet/.test(r2.out), r2.out);
ok('the novel camelCase token is named in the output', /gainWeighting/.test(r2.out), r2.out);

const r3 = check('The posture is FOGGED and the SubtreeCertificate cites TWO units.\n');
ok('UPPER/Pascal jargon is caught', r3.code !== 0 && /SubtreeCertificate/.test(r3.out));
ok('stoplisted ordinary caps are not flagged', !/\bL\d+\s+TWO\b/.test(r3.out), r3.out);

const r4 = check('The trail behind each snake blocks movement.\n');
ok('a CORRECTED term blocks', r4.code !== 0 && /CORRECTED/.test(r4.out));
ok('the correction quote is shown back', /this is new terminology/.test(r4.out));

const r5 = check('Each trail unit blocks movement.\n'); // fixture must not name a term whose state can legitimately change; 'cluster seed' became corrected 2026-08-29
ok('a defined phrase shields the corrected word nested inside it',
  r5.code === 0, r5.out);
ok('but the re-defined term still raises its reminder',
  /NOTE/.test(r5.out) && /trail unit/.test(r5.out), r5.out);

const r6 = check('The trail (the body a snake leaves behind) blocks movement.\n', ['--ack', 'trail']);
ok('--ack clears a correction but records the debt',
  r6.code === 0 && /LEDGER OWED/.test(r6.out), r6.out);

const r7 = check('VOC (= value of computation) decides where to spend.\n');
ok('an internal term defined in place downgrades to a debt, not a block',
  r7.code === 0 && /LEDGER OWED/.test(r7.out), r7.out);
const r8 = check('VOC (= value of computation) decides where to spend.\n', ['--strict']);
ok('--strict fails on an unrecorded debt', r8.code !== 0);

const r9 = check('Set `CENTAUR_TIER_TRUTH=full` and read `basisKeyOf` in the code.\n');
ok('jargon inside code spans is not flagged by default', r9.code === 0, r9.out);
const r10 = check('Set `CENTAUR_TIER_TRUTH=full` in the config.\n', ['--code']);
ok('--code scans code spans too', r10.code !== 0, r10.out);

const r11 = check(CLEAN, ['--principal', 'nobody']);
ok('an unknown principal exits 2, not a false pass', r11.code === 2, r11.out);

// --- the 20260830 vocabulary ban --------------------------------------------
//
// The owner banned two words from owner-facing text. `corrected` is the state
// that enforces a ban, because it is the only one that blocks EVERY use and
// will not clear without an explicit --ack. These assertions exist so a future
// tidy-up that "promotes dark back to defined" fails the gate instead of
// quietly re-opening the words.
{
  const chris = ledger.principals.find((p) => p.id === 'chris');
  const termOf = (n) => chris.terms.find((t) => t.term === n);
  for (const name of ['dark', 'promotion']) {
    const t = termOf(name);
    ok(`"${name}" is banned in owner-facing text`, t && t.state === 'corrected', JSON.stringify(t && t.state));
    ok(`"${name}" is re-defined at every use`, t && t.redefineOnNextUse === true);
    ok(`"${name}" carries the owner's own words`, t && /VOCABULARY BAN|never "promote"/.test(
      (t.evidence[t.evidence.length - 1] || {}).quote || ''
    ));
    ok(`"${name}" prescribes what to say instead`, t && /SAY INSTEAD/.test(t.gloss || ''));
    ok(`"${name}" says it is a ban and not an unfamiliarity`, t && /^THIS IS A BAN/.test(t.note || ''));
  }
  const rBan = check('The layer was promoted last night.\n');
  ok('a banned word blocks a draft', rBan.code !== 0, rBan.out);
  ok('and the drafter is told it is a BAN, not a confusion',
    /BANNED IN OWNER-FACING TEXT/.test(rBan.out) && !/said they did not know/.test(rBan.out), rBan.out);
  // The FILENAME is not prose. A longer `defined` phrase shields the shorter
  // banned word nested inside it, which is what keeps the path writable.
  const rPath = check('See the promotion ledger for what each candidate has earned.\n');
  ok('naming `promotion ledger` still passes — a path is not a claim', rPath.code === 0, rPath.out);
  // And the replacement vocabulary is seeded, so a drafter is not left guessing.
  for (const name of ['selectable', 'feature branch', 'validated baseline', 'decision joint', 'lane (a)', 'lane (b)']) {
    ok(`the replacement vocabulary seeds "${name}"`, termOf(name) !== undefined);
  }
}

// --- the rendered view ------------------------------------------------------
try {
  execFileSync(process.execPath, [RENDER, '--check'], { encoding: 'utf8' });
  ok('FAMILIARITY.md is in sync with the ledger', true);
} catch (e) {
  ok('FAMILIARITY.md is in sync with the ledger', false,
    'run: node tools/principal-glossary/render-view.js');
}

// --- report -----------------------------------------------------------------
if (fails.length) {
  console.error(`\nprincipal-glossary selftest: ${pass} passed, ${fails.length} FAILED`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`principal-glossary selftest: ${pass} assertions, all passed.`);
