#!/usr/bin/env node
/**
 * Re-vendor the possibility-cloud engine into src/partial-engine/.
 *
 * This is the SECOND vendored package in this repo, and it answers a different
 * question from the first. src/engine-vendor/ is the rules — what happened.
 * src/partial-engine/ is the uncertainty layer on top — what happens if only
 * SOME of the units are modelled, carrying every unmodelled one as a
 * possible-presence claim instead of an assumed move. The two share the game's
 * rules as ideas, not as code, and the differential in
 * src/tests/partial-engine-differential.test.ts is what keeps that honest:
 * it plays random boards through BOTH and demands they agree.
 *
 * Source: packages/engine/src/partial/ of the snek-centaur-platform repo.
 * That subtree is self-contained — every import inside it is a sibling in the
 * same directory — which is exactly why it is vendorable at all.
 *
 * Usage:
 *   npm run sync-partial-engine                    # reads ../snek-centaur-platform
 *   npm run sync-partial-engine -- /path/to/repo
 *   npm run sync-partial-engine -- --check         # verify only, exit 1 on drift
 *
 * Two different checks exist, and they are not the same check:
 *
 *   --check          compares the vendored tree against a SOURCE CHECKOUT.
 *                    Needs the sibling repo; catches "upstream moved on".
 *   the manifest     compares the vendored tree against recorded content
 *                    hashes. Needs nothing; catches "somebody edited the
 *                    copy". The drift test runs this one on every CI run,
 *                    which is why it is the one that is always available.
 *
 * As with sync-engine.js the copies differ from their sources by exactly one
 * thing: a header block this script injects, terminated by HEADER_END.
 * `stripVendorHeader` removes it again, so the comparison is byte for byte.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Default location of the sibling source checkout. */
const DEFAULT_SOURCE_REPO = path.resolve(__dirname, '..', '..', 'snek-centaur-platform');

/** Where the partial subtree lives inside that checkout. */
const SOURCE_SUBTREE = path.join('packages', 'engine', 'src', 'partial');

/** Where the copies live in this repo. */
const VENDOR_ROOT = path.resolve(__dirname, '..', 'src', 'partial-engine');

/** The provenance record, written beside the copies. */
const MANIFEST_PATH = path.join(VENDOR_ROOT, 'VENDOR-MANIFEST.json');

/**
 * Every file the package consists of, as basenames under SOURCE_SUBTREE.
 * The drift test asserts the vendored tree holds exactly these plus
 * REPO_OWNED_FILES, so a file added upstream shows up as a failing test
 * rather than as a silent omission.
 */
const VENDORED_FILES = [
  'bitgrid.ts',
  'bounds.ts',
  'checks.ts',
  'cloud.ts',
  'contest.ts',
  'engine.ts',
  'exact.ts',
  'field.ts',
  'grammar.ts',
  'index.ts',
  'narrow.ts',
  'refine.ts',
  'risk.ts',
  'twin.ts',
];

/**
 * Files that live in src/partial-engine/ but are OURS — written here, not
 * copied. They are excluded from the sync and from the manifest, and the
 * drift test uses this list to tell "a file we wrote" apart from "a vendored
 * file somebody edited". Nothing may appear in both lists.
 */
const REPO_OWNED_FILES = ['wire-adapter.ts', 'VENDOR-MANIFEST.json'];

/** The last line of an injected header. Everything up to and including it goes. */
const HEADER_END = 'END VENDORED HEADER';

function headerFor(sourcePath) {
  const lines = [
    'VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.',
    `Source: ${sourcePath}`,
    'This is a byte-for-byte copy of the possibility-cloud engine.',
    'Edits here are overwritten and fail the vendor drift test: change the',
    'engine upstream, then run `npm run sync-partial-engine`.',
    HEADER_END,
  ];
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

/** The hash the manifest records: sha256 of the SOURCE bytes, header stripped. */
function hashOf(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The upstream commit a checkout is sitting on, or null if it is not a repo. */
function commitOf(sourceRepo) {
  try {
    return require('child_process')
      .execFileSync('git', ['-C', sourceRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim();
  } catch {
    return null;
  }
}

/** Read the committed manifest, or null when there is not one yet. */
function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * Compare the vendored tree against the manifest's recorded hashes. This is
 * the check that needs no source checkout, so it is the one CI can always run.
 * Returns a list of human-readable problems; empty means no drift.
 */
function checkManifest() {
  const manifest = readManifest();
  if (manifest === null) return [`no manifest at ${path.relative(process.cwd(), MANIFEST_PATH)}`];

  const problems = [];
  const recorded = new Set(Object.keys(manifest.files));

  for (const [name, want] of Object.entries(manifest.files)) {
    const dest = path.join(VENDOR_ROOT, name);
    if (!fs.existsSync(dest)) {
      problems.push(`missing from the vendored tree: ${name}`);
      continue;
    }
    const got = hashOf(stripVendorHeader(fs.readFileSync(dest, 'utf8')));
    if (got !== want.sha256) {
      problems.push(`edited since it was vendored: ${name} (${want.sha256} -> ${got})`);
    }
  }

  // A file nobody accounted for is drift too — an upstream addition that was
  // copied without being listed, or a stray edit-in-place under a new name.
  const owned = new Set(REPO_OWNED_FILES);
  for (const name of fs.readdirSync(VENDOR_ROOT)) {
    if (name.endsWith('.test.ts')) continue;
    if (recorded.has(name) || owned.has(name)) continue;
    problems.push(`unaccounted file in the vendored tree: ${name}`);
  }

  return problems;
}

/**
 * Copy (or verify against) the source checkout. `checkOnly` compares without
 * writing. Returns {problems, manifest}: the manifest is what WOULD be written.
 */
function sync(sourceRepo, checkOnly) {
  const problems = [];
  const subtree = path.join(sourceRepo, SOURCE_SUBTREE);
  const files = {};

  for (const name of VENDORED_FILES) {
    if (REPO_OWNED_FILES.includes(name)) {
      problems.push(`${name} is listed as both vendored and repo-owned`);
      continue;
    }
    const src = path.join(subtree, name);
    if (!fs.existsSync(src)) {
      problems.push(`missing in source repo: ${path.join(SOURCE_SUBTREE, name)}`);
      continue;
    }
    const body = fs.readFileSync(src, 'utf8');
    files[name] = { sha256: hashOf(body), bytes: Buffer.byteLength(body, 'utf8') };

    const dest = path.join(VENDOR_ROOT, name);
    const wanted = headerFor(path.join(SOURCE_SUBTREE, name).split(path.sep).join('/')) + body;

    if (checkOnly) {
      const have = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
      if (have === null) problems.push(`not vendored: ${name}`);
      else if (stripVendorHeader(have) !== body) problems.push(`out of date: ${name}`);
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, wanted);
    console.log(`vendored ${SOURCE_SUBTREE}/${name} -> src/partial-engine/${name}`);
  }

  // A file upstream has that we do not list is the case the file list exists
  // to catch: report it, so adding it here is a decision somebody makes.
  if (fs.existsSync(subtree)) {
    for (const name of fs.readdirSync(subtree)) {
      if (!name.endsWith('.ts')) continue;
      if (!VENDORED_FILES.includes(name)) {
        problems.push(`present upstream but not vendored: ${name} (add it to VENDORED_FILES)`);
      }
    }
  }

  const manifest = {
    // Not prose: the fields a drift test and a human bisecting a regression
    // both need, and nothing else.
    package: '@cyphid/snek-engine',
    subtree: SOURCE_SUBTREE.split(path.sep).join('/'),
    sourceRepo: 'https://github.com/Cyphid-Academy/snek-centaur-platform',
    sourceCommit: commitOf(sourceRepo),
    vendoredAt: new Date().toISOString(),
    hashAlgorithm: 'sha256-of-source-bytes-header-stripped',
    files,
  };
  return { problems, manifest };
}

function writeManifest(manifest) {
  // Keep the timestamp stable when nothing else moved, so re-running the sync
  // does not produce a diff that says nothing.
  const previous = readManifest();
  const next = { ...manifest };
  if (
    previous !== null &&
    previous.sourceCommit === manifest.sourceCommit &&
    JSON.stringify(previous.files) === JSON.stringify(manifest.files)
  ) {
    next.vendoredAt = previous.vendoredAt;
  }
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote src/partial-engine/${path.basename(MANIFEST_PATH)}`);
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const manifestOnly = args.includes('--manifest');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (manifestOnly) {
    const problems = checkManifest();
    if (problems.length > 0) {
      console.error('Vendored partial-engine has drifted from its manifest:');
      problems.forEach((p) => console.error(`  - ${p}`));
      process.exit(1);
    }
    console.log('Vendored partial-engine matches its manifest.');
    return;
  }

  const sourceRepo = positional[0]
    ? path.resolve(positional[0])
    : process.env.SNEK_ENGINE_REPO
      ? path.resolve(process.env.SNEK_ENGINE_REPO)
      : DEFAULT_SOURCE_REPO;

  if (!fs.existsSync(path.join(sourceRepo, SOURCE_SUBTREE))) {
    console.error(
      `No engine checkout at ${sourceRepo} (looked for ${SOURCE_SUBTREE}).\n` +
        'Clone it as a sibling of this repo, set SNEK_ENGINE_REPO, or pass the path: ' +
        'npm run sync-partial-engine -- /path/to/snek-centaur-platform\n' +
        'To check the copies against the committed manifest instead (no checkout ' +
        'needed): npm run sync-partial-engine -- --manifest'
    );
    process.exit(1);
  }

  const { problems, manifest } = sync(sourceRepo, checkOnly);
  if (problems.length > 0) {
    console.error(`Partial-engine vendoring ${checkOnly ? 'is stale' : 'failed'}:`);
    problems.forEach((p) => console.error(`  - ${p}`));
    if (checkOnly) console.error('Run: npm run sync-partial-engine');
    process.exit(1);
  }
  if (!checkOnly) writeManifest(manifest);
  console.log(checkOnly ? 'Vendored partial-engine is up to date.' : 'Vendored partial-engine synced.');
}

module.exports = {
  DEFAULT_SOURCE_REPO,
  SOURCE_SUBTREE,
  VENDOR_ROOT,
  MANIFEST_PATH,
  VENDORED_FILES,
  REPO_OWNED_FILES,
  HEADER_END,
  stripVendorHeader,
  hashOf,
  readManifest,
  checkManifest,
  sync,
};

if (require.main === module) main();
