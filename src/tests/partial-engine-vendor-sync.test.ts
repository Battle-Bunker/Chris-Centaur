/**
 * The vendored possibility-cloud engine is a COPY, and this is what keeps it one.
 *
 * src/partial-engine/ holds packages/engine/src/partial/ from the
 * snek-centaur-platform repo, file for file. It is the uncertainty layer the
 * centaur reasons with; src/engine-vendor/ is the rules it reasons ABOUT. Two
 * copies, two sync scripts, two drift tests, and one differential
 * (partial-engine-differential.test.ts) that makes them agree on real boards.
 *
 * This test differs from engine-vendor-sync.test.ts in one important way, and
 * the difference is deliberate. That one can only compare against a sibling
 * TacticToes checkout, so it SKIPS its byte-identity half when there isn't one
 * — on CI, that half never runs. Here the sync script records a content hash
 * per file in VENDOR-MANIFEST.json, and the manifest is committed. So the
 * drift check needs no checkout and never skips: it runs on every machine,
 * every run, and it fails the moment somebody edits a copy.
 *
 * The comparison against a live source checkout is still here, still optional,
 * and still the only thing that can catch "upstream moved on".
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describeArrivalShellDifferential } from './arrival-shell-differential';

// The sync script is the one definition of the file list, the header format
// and the hash; importing it here means the test and the tool can never
// disagree about what "in sync" means.
const sync = require('../../scripts/sync-partial-engine.js') as {
  DEFAULT_SOURCE_REPO: string;
  SOURCE_SUBTREE: string;
  VENDOR_ROOT: string;
  MANIFEST_PATH: string;
  VENDORED_FILES: string[];
  REPO_OWNED_FILES: string[];
  HEADER_END: string;
  stripVendorHeader: (text: string) => string;
  hashOf: (text: string) => string;
  readManifest: () => Manifest | null;
  checkManifest: () => string[];
};

interface Manifest {
  package: string;
  subtree: string;
  sourceRepo: string;
  sourceCommit: string | null;
  vendoredAt: string;
  hashAlgorithm: string;
  files: { [name: string]: { sha256: string; bytes: number } };
}

const vendored = (name: string): string => join(sync.VENDOR_ROOT, name);
const sourceRepo = process.env.SNEK_ENGINE_REPO || sync.DEFAULT_SOURCE_REPO;
const sourceSubtree = join(sourceRepo, sync.SOURCE_SUBTREE);
const haveSource = existsSync(sourceSubtree);

describe('the vendored partial engine is present and marked as vendored', () => {
  test.each(sync.VENDORED_FILES)('%s is vendored', (name) => {
    expect(existsSync(vendored(name))).toBe(true);
  });

  test.each(sync.VENDORED_FILES)('%s carries the do-not-edit header', (name) => {
    const text = readFileSync(vendored(name), 'utf8');
    expect(text).toContain('VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.');
    expect(text).toContain('npm run sync-partial-engine');
    expect(text).toContain(sync.HEADER_END);
    // The header is strippable, and stripping it leaves real content.
    const body = sync.stripVendorHeader(text);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain(sync.HEADER_END);
  });

  test('nothing is listed as both vendored and ours', () => {
    // wire-adapter.ts lives in the same directory and is NOT a copy. If a file
    // ever appeared in both lists the drift check would quietly stop covering
    // it, so the overlap is an error rather than a precedence rule.
    const overlap = sync.VENDORED_FILES.filter((f) => sync.REPO_OWNED_FILES.includes(f));
    expect(overlap).toEqual([]);
  });

  test('the subtree imports nothing outside itself', () => {
    // This is the property that made the package vendorable at all: every
    // import inside src/partial/ is a sibling in the same directory. A new
    // upstream import of the mainline engine, or of an npm package, would
    // drag a dependency in here — so it fails at our build, on purpose.
    for (const name of sync.VENDORED_FILES) {
      const source = readFileSync(vendored(name), 'utf8');
      const specifiers = Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g)).map((m) => m[1]);
      for (const specifier of specifiers) {
        expect([name, specifier]).toEqual([name, expect.stringMatching(/^\.\/[A-Za-z0-9_-]+\.js$/)]);
      }
    }
  });

  test('the engine is a pure function of its input', () => {
    // No clock, no RNG, no network — a candidate evaluation that read any of
    // them would not be reproducible, and a search over irreproducible
    // evaluations is not a search.
    for (const name of sync.VENDORED_FILES) {
      const source = readFileSync(vendored(name), 'utf8');
      expect([name, /Math\.random|Date\.now|new Date\(|fetch\(/.test(source)]).toEqual([
        name,
        false,
      ]);
    }
  });
});

describe('the vendored partial engine matches its manifest', () => {
  const manifest = sync.readManifest();

  test('the manifest exists and records its provenance', () => {
    expect(manifest).not.toBeNull();
    const m = manifest as Manifest;
    expect(m.package).toBe('@cyphid/snek-engine');
    expect(m.subtree).toBe('packages/engine/src/partial');
    // The commit is the whole point of the record: without it "which engine is
    // this" has no answer, and a bisect across a behaviour change has nowhere
    // to start.
    expect(m.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(m.files).sort()).toEqual([...sync.VENDORED_FILES].sort());
  });

  // The drift check itself. No source checkout, no skip: if this is red,
  // somebody edited a copy — do not patch the copy, change the engine upstream
  // and re-run `npm run sync-partial-engine`.
  test.each(sync.VENDORED_FILES)('%s has not been edited since it was vendored', (name) => {
    const want = (manifest as Manifest).files[name];
    expect(want).toBeDefined();
    const got = sync.hashOf(sync.stripVendorHeader(readFileSync(vendored(name), 'utf8')));
    expect(got).toBe(want.sha256);
  });

  test('the vendored tree holds exactly the manifest plus what we own', () => {
    // An unaccounted file is drift too: an upstream addition copied in without
    // being listed, or an edit-in-place that renamed its way out of the check.
    const accounted = new Set([...sync.VENDORED_FILES, ...sync.REPO_OWNED_FILES]);
    const stray = readdirSync(sync.VENDOR_ROOT).filter(
      (name) => !accounted.has(name) && !name.endsWith('.test.ts')
    );
    expect(stray).toEqual([]);
  });

  test('the script agrees with this test about drift', () => {
    // `npm run sync-partial-engine -- --manifest` is the same check from the
    // command line, for a developer who wants it without the runner.
    expect(sync.checkManifest()).toEqual([]);
  });
});

/**
 * THE BEHAVIOURAL HALF OF THE DRIFT GATE.
 *
 * Everything above proves the copies are UNEDITED. That is not the same claim
 * as "the one place we reproduce engine arithmetic still agrees with it", and
 * the copies moving is exactly when that second claim breaks.
 *
 * `src/lobster/evaluate/shells.ts` reproduces `CloudTimeline.arrival()`'s
 * stamping loop, so the evaluator can read the dilation shells without the
 * eager `minCost` Dijkstra behind them — the one deliberate second encoding in
 * the repository. It drifts silently and only in a soft positional signal, so
 * the differential runs HERE, in the same run as the hashes, and a re-vendor
 * that changes how `earliest` is derived fails the vendor gate rather than
 * quietly degrading the reach feature.
 */
describeArrivalShellDifferential('vendor drift gate');

(haveSource ? describe : describe.skip)(
  'the vendored partial engine is byte-identical to the sibling engine checkout',
  () => {
    test.each(sync.VENDORED_FILES)('%s matches its source exactly', (name) => {
      const copied = sync.stripVendorHeader(readFileSync(vendored(name), 'utf8'));
      const origin = readFileSync(join(sourceSubtree, name), 'utf8');
      // If this fails, either somebody edited the copy or the engine moved on.
      // Run `npm run sync-partial-engine` and read the diff before committing.
      expect(copied).toBe(origin);
    });

    test('upstream has not added a file we are not vendoring', () => {
      const upstream = readdirSync(sourceSubtree).filter((f) => f.endsWith('.ts'));
      expect(upstream.sort()).toEqual([...sync.VENDORED_FILES].sort());
    });
  }
);

if (!haveSource) {
  // Not a silent skip: say so, so nobody reads a green run as proof that the
  // copies are current with upstream. The manifest check above proves they are
  // UNEDITED, which is a different claim.
  console.warn(
    `[partial-engine-vendor-sync] No engine checkout at ${sourceRepo} — ` +
      'the copies were checked against the manifest, NOT against upstream.'
  );
}
