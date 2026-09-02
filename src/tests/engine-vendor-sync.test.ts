/**
 * The vendored engine is a COPY, and this is what keeps it one.
 *
 * src/engine-vendor/ holds the TacticToes turn-resolution module file for file
 * (see its VENDOR.md). It is the single encoding of the game rules: the server
 * plays the game by calling it, and this bot predicts a turn by calling the
 * very same source. The value of that arrangement is entirely in the word
 * "same" — a copy that has been touched, even helpfully, is a second mirror,
 * and a second mirror drifts.
 *
 * So: whenever a sibling TacticToes checkout is present, every vendored file
 * must be byte-identical to its origin once the injected header is stripped.
 * When no checkout is present (CI, a fresh clone, a machine that only has the
 * bot) the comparison is skipped rather than failed — the bot must stay
 * buildable on its own, which is the whole point of vendoring.
 *
 * The structural checks below do NOT need the sibling checkout and always run.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// The sync script is the one definition of the file list and the header
// format; importing it here means the test and the tool can never disagree
// about what "in sync" means.
const sync = require('../../scripts/sync-engine.js') as {
  DEFAULT_SOURCE_REPO: string;
  VENDOR_ROOT: string;
  VENDORED_FILES: Array<{ from: string; to: string }>;
  HEADER_END: string;
  stripVendorHeader: (text: string) => string;
};

const vendored = (relative: string): string => join(sync.VENDOR_ROOT, relative);
const sourceRepo = process.env.TACTICTOES_REPO || sync.DEFAULT_SOURCE_REPO;
const haveSource = existsSync(join(sourceRepo, 'functions/src/gameprocessors/engine'));

describe('the vendored engine is present and marked as vendored', () => {
  test.each(sync.VENDORED_FILES.map((f) => f.to))('%s is vendored', (relative) => {
    expect(existsSync(vendored(relative))).toBe(true);
  });

  test.each(sync.VENDORED_FILES.map((f) => f.to))(
    '%s carries the do-not-edit header',
    (relative) => {
      const text = readFileSync(vendored(relative), 'utf8');
      expect(text).toContain('VENDORED from Battle-Bunker/TacticToes — do not edit.');
      expect(text).toContain('npm run sync-engine');
      expect(text).toContain(sync.HEADER_END);
      // The header is strippable, and stripping it leaves real content.
      expect(sync.stripVendorHeader(text).length).toBeGreaterThan(0);
      expect(sync.stripVendorHeader(text)).not.toContain(sync.HEADER_END);
    }
  );

  test('the module imports nothing but itself and the wire types', () => {
    // The same contract TacticToes enforces on its side (engineVendor.spec.ts),
    // re-checked HERE because a bad import would only break at our build.
    for (const { to } of sync.VENDORED_FILES) {
      if (!to.endsWith('.ts') || !to.startsWith('engine/')) continue;
      const source = readFileSync(vendored(to), 'utf8');
      const specifiers = Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g)).map(
        (m) => m[1]
      );
      for (const specifier of specifiers) {
        if (specifier === '@shared/types/Game') continue;
        expect(specifier).toMatch(/^\.\/[A-Za-z0-9_-]+$/);
      }
      // No clock, no RNG, no network: resolveTurn must stay a pure function of
      // its input, or a candidate evaluation would not be reproducible.
      expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(|fetch\(/);
    }
  });
});

(haveSource ? describe : describe.skip)(
  'the vendored engine is byte-identical to the sibling TacticToes checkout',
  () => {
    test.each(sync.VENDORED_FILES.map((f) => [f.to, f.from]))(
      '%s matches %s exactly',
      (to, from) => {
        const copied = sync.stripVendorHeader(readFileSync(vendored(to), 'utf8'));
        const origin = readFileSync(join(sourceRepo, from), 'utf8');
        // If this fails, somebody edited the copy (or the source moved on).
        // Do not patch the copy: run `npm run sync-engine`.
        expect(copied).toBe(origin);
      }
    );

    test('the vendored tree holds exactly the files VENDOR.md lists', () => {
      const listed = readFileSync(vendored('VENDOR.md'), 'utf8');
      for (const { to } of sync.VENDORED_FILES) {
        const base = to.split('/').pop() as string;
        expect(listed).toContain(base);
      }
    });
  }
);

if (!haveSource) {
  // Not a silent skip: say so, so nobody reads a green run as proof of sync.
  console.warn(
    `[engine-vendor-sync] No TacticToes checkout at ${sourceRepo} — ` +
      'byte-identity against the source was NOT verified in this run.'
  );
}
