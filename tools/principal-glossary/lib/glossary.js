'use strict';
/*
 * lib/glossary.js — load, validate and match against the principal terminology
 * ledger. No dependencies. Node >= 18.
 *
 * The ledger is the artifact. Everything else in this directory is either a
 * rendering of it (render-view.js) or a query against it (check-briefing.js).
 */

const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(__dirname, '..', 'ledger.json');

const STATES = ['native', 'defined', 'corrected', 'internal'];

/** States whose terms may appear in a briefing without a fresh definition. */
const SAFE_STATES = ['native', 'defined'];
/** States whose terms MUST be defined inline (or avoided) at every use. */
const UNSAFE_STATES = ['internal', 'corrected'];

// ---------------------------------------------------------------------------
// load + validate
// ---------------------------------------------------------------------------

function load(file) {
  const p = file || LEDGER_PATH;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ledger at ${p}: ${e.message}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`ledger at ${p} is not valid JSON: ${e.message}`);
  }
  const errs = validate(json);
  if (errs.length) {
    throw new Error(`ledger at ${p} is invalid:\n  - ${errs.join('\n  - ')}`);
  }
  json._path = p;
  return json;
}

/**
 * Structural + epistemic validation. Returns an array of human-readable
 * problems; empty means valid.
 *
 * The epistemic rules are not decoration. They are the reason the ledger can
 * be trusted after six compactions:
 *   - every term carries at least one evidence entry with a date;
 *   - `native` and `corrected` are claims about what a HUMAN did, so they need
 *     either a verbatim `quote` fragment (strong) or an explicit `attestation`
 *     string saying where it was observed (weak, and rendered as weak). What
 *     they may never be is a bare assertion with neither;
 *   - `defined` requires a `where` (which briefing), because "we defined it
 *     somewhere, probably" is exactly the belief this system exists to kill;
 *   - terms are sorted by lowercased term, so append-heavy edits from two
 *     branches merge line-by-line instead of conflicting.
 */
function validate(l) {
  const errs = [];
  if (!l || typeof l !== 'object') return ['ledger is not an object'];
  if (l.schemaVersion !== 1) errs.push(`unsupported schemaVersion ${l.schemaVersion} (expected 1)`);
  if (!Array.isArray(l.principals) || l.principals.length === 0) {
    errs.push('principals must be a non-empty array');
    return errs;
  }
  const ids = new Set();
  for (const p of l.principals) {
    if (!p.id) { errs.push('a principal has no id'); continue; }
    if (ids.has(p.id)) errs.push(`duplicate principal id ${p.id}`);
    ids.add(p.id);
    if (!Array.isArray(p.terms)) { errs.push(`${p.id}: terms must be an array`); continue; }

    let prev = null;
    const seen = new Set();
    for (const t of p.terms) {
      const at = `${p.id}/"${t && t.term}"`;
      if (!t.term || typeof t.term !== 'string') { errs.push(`${at}: missing term`); continue; }
      const key = t.term.toLowerCase();
      if (seen.has(key)) errs.push(`${at}: duplicate term`);
      seen.add(key);
      if (prev !== null && key < prev) {
        errs.push(`${at}: out of order (must sort by lowercased term after "${prev}") — run render-view.js --sort`);
      }
      prev = key;

      if (!STATES.includes(t.state)) errs.push(`${at}: unknown state "${t.state}"`);
      if (!t.gloss || typeof t.gloss !== 'string') errs.push(`${at}: missing gloss`);
      if (!Array.isArray(t.evidence) || t.evidence.length === 0) {
        errs.push(`${at}: no evidence — every state needs at least one dated entry`);
        continue;
      }
      for (const e of t.evidence) {
        if (!/^\d{4}-\d{2}-\d{2}x?$|^\d{4}-\d{2}-\d{1}x$/.test(String(e.date || ''))) {
          errs.push(`${at}: evidence date "${e.date}" is not YYYY-MM-DD (a trailing x for an approximate day is allowed)`);
        }
        if (!STATES.includes(e.to)) errs.push(`${at}: evidence.to "${e.to}" is not a state`);
      }
      const latest = t.evidence[t.evidence.length - 1];
      if (latest.to !== t.state) {
        errs.push(`${at}: state is "${t.state}" but the last evidence entry transitions to "${latest.to}"`);
      }
      if ((t.state === 'native' || t.state === 'corrected') && !latest.quote && !latest.attestation) {
        errs.push(`${at}: state "${t.state}" is a claim about the principal and REQUIRES either a verbatim "quote" fragment or an explicit "attestation" in its latest evidence entry`);
      }
      if (t.state === 'corrected' && !latest.quote) {
        errs.push(`${at}: a "corrected" state must carry the principal's own words — attestation is not enough`);
      }
      if (t.state === 'defined' && !latest.where) {
        errs.push(`${at}: state "defined" requires a "where" naming the briefing that defined it`);
      }
      if (t.state === 'corrected' && t.redefineOnNextUse !== true) {
        errs.push(`${at}: corrected terms must carry redefineOnNextUse: true`);
      }
    }
  }
  return errs;
}

function principal(l, id) {
  const p = l.principals.find((x) => x.id === id);
  if (!p) {
    throw new Error(`no principal "${id}" in the ledger (have: ${l.principals.map((x) => x.id).join(', ')})`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every literal string that should be taken to mean this ledger entry. */
function matchStrings(t) {
  if (Array.isArray(t.match) && t.match.length) return t.match.slice();
  const out = [t.term];
  if (Array.isArray(t.aliases)) out.push(...t.aliases);
  return out;
}

/**
 * A word-boundary regex for one literal. Single alphabetic words also match
 * their plain plural; nothing else is stemmed, because guessing morphology is
 * how a checker earns a reputation for crying wolf.
 */
function literalRegex(lit) {
  const body = escapeRe(lit).replace(/\\?[ ]/g, '\\s+');
  const plural = /^[A-Za-z][A-Za-z-]*$/.test(lit) && !/s$/i.test(lit) ? '(?:s)?' : '';
  const lead = /^[A-Za-z0-9]/.test(lit) ? '\\b' : '';
  const tail = /[A-Za-z0-9)]$/.test(lit) ? '\\b' : '';
  return new RegExp(`${lead}${body}${plural}${tail}`, 'gi');
}

/** Build the index a checker run needs. */
function index(l, principalId) {
  const p = principal(l, principalId);
  const byState = { native: [], defined: [], corrected: [], internal: [] };
  const known = new Set();       // every literal known to the ledger, lowercased
  const entries = [];
  for (const t of p.terms) {
    byState[t.state].push(t);
    const lits = matchStrings(t);
    for (const lit of lits) known.add(lit.toLowerCase());
    entries.push({ term: t, literals: lits, regexes: lits.map(literalRegex) });
  }
  const stoplist = new Set(
    ((l.checker && l.checker.stoplist) || []).map((s) => s.toLowerCase())
  );
  return { ledger: l, principal: p, byState, known, entries, stoplist };
}

module.exports = {
  LEDGER_PATH, STATES, SAFE_STATES, UNSAFE_STATES,
  load, validate, principal, index, matchStrings, literalRegex, escapeRe,
};
