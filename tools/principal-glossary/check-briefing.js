#!/usr/bin/env node
'use strict';
/*
 * CHECK A DRAFT BRIEFING AGAINST THE PRINCIPAL TERMINOLOGY LEDGER.
 *
 *   node tools/principal-glossary/check-briefing.js < draft.md
 *   node tools/principal-glossary/check-briefing.js --principal chris --file draft.md
 *
 * Exit 0  = nothing in the draft is jargon the principal has never been given.
 * Exit 1  = BLOCKING findings (listed). Define them inline or use a native word.
 * Exit 2  = the ledger itself is broken (invalid JSON, missing evidence, unsorted).
 *
 * WHAT IT FLAGS
 *   BLOCK   a term the ledger marks `internal`  — in code/agent reports, never briefed.
 *   BLOCK   a term the ledger marks `corrected` — the principal SAID they did not
 *           know it. Corrections never auto-expire, so this fires forever until
 *           you pass --ack for it, which is a promise you re-defined it in place.
 *   BLOCK   a NEW-JARGON SHAPE absent from the ledger entirely: camelCase,
 *           PascalCase with an interior capital, UPPER_SNAKE, bare ALLCAPS, or a
 *           codename like CL7 / P12R / B0. This is the heuristic net for jargon
 *           nobody has got round to seeding.
 *   OWED    (non-blocking) a flagged term that this draft appears to define on
 *           the spot. Good — now record the definition event in the ledger, in
 *           THIS work cycle. Printed under "LEDGER OWED".
 *   NOTE    (non-blocking) a `defined` term carrying redefineOnNextUse, i.e. one
 *           that was corrected once and re-defined. Worth a reminder clause.
 *
 * FLAGS
 *   --principal ID   which human this briefing is for            (default: chris)
 *   --file PATH      read PATH instead of stdin
 *   --ledger PATH    use a different ledger
 *   --ack a,b,c      suppress blocking findings for these terms; each ack is
 *                    echoed under LEDGER OWED, because an ack is a debt
 *   --strict         also fail on OWED/NOTE findings
 *   --code           also scan fenced/inline code (skipped by default: jargon
 *                    inside a quoted snippet is quoted material, not prose)
 *   --json           machine-readable findings on stdout
 *   --quiet          only print the summary line
 */

const fs = require('fs');
const G = require('./lib/glossary');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
function arg(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const PRINCIPAL = arg('principal', 'chris');
const STRICT = has('strict');
const SCAN_CODE = has('code');
const AS_JSON = has('json');
const QUIET = has('quiet');
const ACK = new Set(
  (arg('ack', '') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
function readInput() {
  const f = arg('file', null);
  if (f) return fs.readFileSync(f, 'utf8');
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

/**
 * Blank out code so the scanner sees prose only. Replaced with spaces rather
 * than deleted, so every offset still maps to the right line.
 */
function maskCode(text) {
  if (SCAN_CODE) return text;
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/```[\s\S]*?```/g, blank)      // fenced blocks
    .replace(/~~~[\s\S]*?~~~/g, blank)
    .replace(/`[^`\n]*`/g, blank)           // inline code
    .replace(/^ {4,}\S.*$/gm, blank);       // indented blocks
}

// ---------------------------------------------------------------------------
// the new-jargon shape net
// ---------------------------------------------------------------------------
const SHAPE_TESTS = [
  { name: 'camelCase', re: /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/ },
  { name: 'PascalCase', re: /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/ },
  { name: 'UPPER_SNAKE', re: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/ },
  { name: 'ALLCAPS', re: /^[A-Z]{2,}$/ },
  { name: 'codename', re: /^[A-Z]{1,4}[0-9]+[A-Za-z]?(?:-[A-Za-z0-9]+)?$/ },
  { name: 'dotted-identifier', re: /^[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/ },
];

// Tokens as they appear in prose: keep interior . _ - and a trailing ().
const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$.-]*(?:\(\))?/g;

function shapeOf(tok) {
  for (const t of SHAPE_TESTS) if (t.re.test(tok)) return t.name;
  return null;
}

// ---------------------------------------------------------------------------
// inline-definition detection
// ---------------------------------------------------------------------------
/*
 * Does the draft define this term right where it uses it? Deliberately a
 * shallow test: it recognises the SHAPES of an inline definition, so that
 * "define it at first use" is cheap to satisfy honestly and awkward to fake.
 */
const DEFN_CUES = [
  /\(\s*=/, /\(\s*i\.e\./i, /\(\s*that is/i, /\(\s*the\b/i, /\(\s*a\b/i, /\(\s*meaning/i,
  /\bmeans\b/i, /\bis defined as\b/i, /\bdefined as\b/i, /\bshorthand for\b/i,
  /\bwhich is\b/i, /\bthat is,/i, /\bi\.e\./i, /\s—\s/, /\s--\s/, /:\s+\S/,
];
function looksDefinedInline(text, endOffset) {
  const window = text.slice(endOffset, endOffset + 160);
  return DEFN_CUES.some((re) => re.test(window));
}

function lineOf(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
let idx;
try {
  idx = G.index(G.load(arg('ledger', null)), PRINCIPAL);
} catch (e) {
  process.stderr.write(`principal-glossary: ${e.message}\n`);
  process.exit(2);
}

const raw = readInput();
const text = maskCode(raw);

const findings = [];
const pushed = new Set();   // one finding per (term, severity) — first hit only

function addFinding(f) {
  const k = `${f.severity}|${f.term.toLowerCase()}`;
  if (pushed.has(k)) return;
  pushed.add(k);
  findings.push(f);
}

// 0. spans covered by a SAFE (native/defined) term ---------------------------
/*
 * "trail unit" is defined; bare "trail" is corrected. Without this pass the
 * checker fires on every correct use of the defined phrase, which is exactly
 * the crying-wolf failure that gets a checker switched off. A shorter unsafe
 * match nested inside a longer safe match is the safe term, not the unsafe one.
 */
const safeSpans = [];
for (const e of idx.entries) {
  if (e.term.state !== 'native' && e.term.state !== 'defined') continue;
  for (const re of e.regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      safeSpans.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
}
function shieldedBySafeTerm(start, end) {
  return safeSpans.some(([s, t]) => s <= start && t >= end && (t - s) > (end - start));
}

// 1. ledger terms in unsafe states -----------------------------------------
for (const e of idx.entries) {
  const st = e.term.state;
  const isUnsafe = st === 'internal' || st === 'corrected';
  const isReminder = st === 'defined' && e.term.redefineOnNextUse === true;
  if (!isUnsafe && !isReminder) continue;

  for (let i = 0; i < e.regexes.length; i++) {
    const re = e.regexes[i];
    re.lastIndex = 0;
    let m = null, cand;
    while ((cand = re.exec(text)) !== null) {
      if (cand[0].length === 0) { re.lastIndex++; continue; }
      if (!shieldedBySafeTerm(cand.index, cand.index + cand[0].length)) { m = cand; break; }
    }
    if (!m) continue;

    const acked = ACK.has(e.term.term.toLowerCase()) || ACK.has(m[0].toLowerCase());
    const inline = looksDefinedInline(text, m.index + m[0].length);

    let severity, why;
    if (isReminder) {
      severity = 'NOTE';
      why = `was CORRECTED once and later re-defined — add a reminder clause`;
    } else if (acked) {
      severity = 'OWED';
      why = `acked on the command line — you promised to define it inline; record the definition event in the ledger now`;
    } else if (st === 'corrected') {
      // corrections never auto-expire and never soften to a warning; an inline
      // definition is the remedy, but it must be claimed explicitly via --ack.
      //
      // TWO KINDS OF CORRECTION WEAR ONE STATE. The usual one is "the principal
      // said they did not know this word". The other, since the 20260830
      // vocabulary ruling, is "the principal knows exactly what it means and
      // told us to stop saying it" — a BAN. `corrected` is the state that
      // enforces both, because it is the only one that blocks every use and
      // will not clear without an explicit --ack. Printing the unfamiliarity
      // wording at a banned word would tell the drafter something false about a
      // human being, so the entry's own `note` distinguishes them and the
      // message follows it.
      severity = 'BLOCK';
      const banned = /^THIS IS A BAN/.test(String(e.term.note ?? ''));
      why = banned
        ? `BANNED IN OWNER-FACING TEXT by the principal's own ruling — use the replacement in the gloss. If you genuinely must name the old word (quoting the ruling, or naming a file path), re-define it inline at this use and re-run with --ack "${e.term.term}"`
        : `CORRECTED: the principal said they did not know this word. Re-define it inline at this use and re-run with --ack "${e.term.term}"`;
    } else if (inline) {
      severity = 'OWED';
      why = `internal, but this draft appears to define it in place — record the definition event in the ledger this cycle`;
    } else {
      severity = 'BLOCK';
      why = `INTERNAL: lives in code/agent reports, never briefed to ${PRINCIPAL}`;
    }

    addFinding({
      severity,
      term: e.term.term,
      matched: m[0],
      state: st,
      line: lineOf(text, m.index),
      why,
      gloss: e.term.gloss,
      quote: (e.term.evidence[e.term.evidence.length - 1] || {}).quote || null,
    });
    break;   // first literal that hits is enough
  }
}

// 2. the shape net: jargon-shaped tokens absent from the ledger entirely -----
{
  let m;
  TOKEN_RE.lastIndex = 0;
  const seenTok = new Set();
  while ((m = TOKEN_RE.exec(text)) !== null) {
    let tok = m[0].replace(/[.-]+$/, '');
    if (!tok || tok.length < 2) continue;
    const low = tok.toLowerCase();
    if (seenTok.has(low)) continue;
    seenTok.add(low);
    if (idx.known.has(low)) continue;                     // already in the ledger
    if (idx.stoplist.has(low)) continue;                  // ordinary English / proper noun
    const shape = shapeOf(tok);
    if (!shape) continue;
    // an ALLCAPS token that is just an emphasised ordinary word we already know
    // in lowercase is not new jargon.
    if (shape === 'ALLCAPS' && idx.known.has(low)) continue;

    const acked = ACK.has(low);
    const inline = looksDefinedInline(text, m.index + m[0].length);
    addFinding({
      severity: acked || inline ? 'OWED' : 'BLOCK',
      term: tok,
      matched: tok,
      state: 'unknown',
      line: lineOf(text, m.index),
      why: acked
        ? `unknown ${shape} token, acked — seed it in the ledger this cycle`
        : inline
          ? `unknown ${shape} token, defined in place here — seed it in the ledger this cycle`
          : `NEW JARGON SHAPE (${shape}) and absent from the ledger. Define it inline and seed it, or drop it.`,
      gloss: null,
      quote: null,
    });
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
findings.sort((a, b) => a.line - b.line || a.term.localeCompare(b.term));
const blocking = findings.filter((f) => f.severity === 'BLOCK');
const owed = findings.filter((f) => f.severity === 'OWED');
const notes = findings.filter((f) => f.severity === 'NOTE');

if (AS_JSON) {
  process.stdout.write(JSON.stringify({
    principal: PRINCIPAL, blocking: blocking.length, owed: owed.length,
    notes: notes.length, findings,
  }, null, 2) + '\n');
} else if (!QUIET) {
  const w = (s) => process.stdout.write(s + '\n');
  if (blocking.length) {
    w(`\nBLOCKING — ${blocking.length} term(s) ${PRINCIPAL} has never been given:`);
    for (const f of blocking) {
      w(`  L${f.line}  ${f.matched}`);
      w(`        ${f.why}`);
      if (f.gloss) w(`        it means: ${f.gloss}`);
      if (f.quote) w(`        they said: "${f.quote}"`);
    }
  }
  if (owed.length) {
    w(`\nLEDGER OWED — ${owed.length} term(s) defined in place. Record them NOW:`);
    for (const f of owed) w(`  L${f.line}  ${f.matched} — ${f.why}`);
  }
  if (notes.length) {
    w(`\nNOTE — ${notes.length} previously-corrected term(s):`);
    for (const f of notes) w(`  L${f.line}  ${f.matched} — ${f.why}`);
  }
  if (!findings.length) w(`\nclean: every term in this draft is native or defined for "${PRINCIPAL}".`);
}

const fail = blocking.length > 0 || (STRICT && findings.length > 0);
if (!AS_JSON) {
  process.stdout.write(
    `\ncheck-briefing[${PRINCIPAL}]: ${blocking.length} blocking, ${owed.length} owed, ` +
    `${notes.length} notes — ${fail ? 'FAIL' : 'pass'}\n`
  );
}
process.exit(fail ? 1 : 0);
