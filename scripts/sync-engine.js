#!/usr/bin/env node
/**
 * Re-vendor the TacticToes turn-resolution module into src/engine-vendor/.
 *
 * The rules of the game have ONE encoding, and it lives in the TacticToes
 * repo (functions/src/gameprocessors/engine/). The server plays the game by
 * calling it; this bot predicts a turn by calling the same code, copied
 * file-for-file. Copying is the whole point — a re-implementation, however
 * careful, is a second mirror that drifts, and the bot spent a long time
 * proving that.
 *
 * Usage:
 *   npm run sync-engine                 # reads ../TacticToes
 *   npm run sync-engine -- /path/to/TacticToes
 *   npm run sync-engine -- --check      # verify only, exit 1 on drift
 *
 * The vendored copies differ from their sources by exactly one thing: a header
 * block this script injects, terminated by HEADER_END. `stripVendorHeader`
 * removes it again, which is how the sync spec compares the two byte for byte.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Default location of the sibling source checkout. */
const DEFAULT_SOURCE_REPO = path.resolve(__dirname, '..', '..', 'TacticToes');

/** Where the copies live in this repo. */
const VENDOR_ROOT = path.resolve(__dirname, '..', 'src', 'engine-vendor');

/**
 * Every file the module consists of, as {from, to} relative paths. VENDOR.md
 * in the source repo is the authority on this list; the sync spec asserts the
 * vendored tree matches it exactly, so a file added upstream shows up as a
 * failing test rather than as a silent omission.
 */
const VENDORED_FILES = [
  { from: 'functions/src/gameprocessors/engine/resolveTurn.ts', to: 'engine/resolveTurn.ts' },
  { from: 'functions/src/gameprocessors/engine/turnEngine.ts', to: 'engine/turnEngine.ts' },
  { from: 'functions/src/gameprocessors/engine/moveGrammar.ts', to: 'engine/moveGrammar.ts' },
  { from: 'shared/types/Game.ts', to: 'shared/types/Game.ts' },
  { from: 'functions/src/gameprocessors/engine/VENDOR.md', to: 'VENDOR.md' },
];

/** The last line of an injected header. Everything up to and including it goes. */
const HEADER_END = 'END VENDORED HEADER';

function headerFor(sourcePath, isMarkdown) {
  const lines = [
    'VENDORED from Battle-Bunker/TacticToes — do not edit.',
    `Source: ${sourcePath}`,
    'This is a byte-for-byte copy of the single encoding of the game rules.',
    'Edits here are overwritten and fail the vendor-sync spec: change the',
    'rules in TacticToes, then run `npm run sync-engine`.',
    HEADER_END,
  ];
  if (isMarkdown) {
    return `<!--\n${lines.map((l) => `  ${l}`).join('\n')}\n-->\n\n`;
  }
  return `/*\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n\n`;
}

/**
 * A vendored file with its injected header removed — i.e. the source bytes.
 * Files with no header come back unchanged, so this is safe to apply blindly.
 */
function stripVendorHeader(text) {
  const marker = text.indexOf(HEADER_END);
  if (marker === -1) return text;
  const closer = text.indexOf('\n', marker);
  if (closer === -1) return text;
  // Skip the comment terminator line that follows, plus the blank line after it.
  const afterCloser = text.indexOf('\n', closer + 1);
  if (afterCloser === -1) return text;
  return text.slice(afterCloser + 1).replace(/^\n/, '');
}

function sync(sourceRepo, checkOnly) {
  const problems = [];
  for (const file of VENDORED_FILES) {
    const src = path.join(sourceRepo, file.from);
    if (!fs.existsSync(src)) {
      problems.push(`missing in source repo: ${file.from}`);
      continue;
    }
    const body = fs.readFileSync(src, 'utf8');
    const dest = path.join(VENDOR_ROOT, file.to);
    const wanted = headerFor(file.from, file.to.endsWith('.md')) + body;

    if (checkOnly) {
      const have = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
      if (have === null) problems.push(`not vendored: ${file.to}`);
      else if (stripVendorHeader(have) !== body) problems.push(`out of date: ${file.to}`);
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, wanted);
    console.log(`vendored ${file.from} -> src/engine-vendor/${file.to}`);
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const positional = args.filter((a) => !a.startsWith('--'));
  const sourceRepo = positional[0] ? path.resolve(positional[0]) : DEFAULT_SOURCE_REPO;

  if (!fs.existsSync(sourceRepo)) {
    console.error(
      `No TacticToes checkout at ${sourceRepo}.\n` +
        'Clone it as a sibling of this repo, or pass the path: ' +
        'npm run sync-engine -- /path/to/TacticToes'
    );
    process.exit(1);
  }

  const problems = sync(sourceRepo, checkOnly);
  if (problems.length > 0) {
    console.error(`Engine vendoring ${checkOnly ? 'is stale' : 'failed'}:`);
    problems.forEach((p) => console.error(`  - ${p}`));
    if (checkOnly) console.error('Run: npm run sync-engine');
    process.exit(1);
  }
  console.log(checkOnly ? 'Vendored engine is up to date.' : 'Vendored engine synced.');
}

module.exports = {
  DEFAULT_SOURCE_REPO,
  VENDOR_ROOT,
  VENDORED_FILES,
  HEADER_END,
  stripVendorHeader,
  sync,
};

if (require.main === module) main();
