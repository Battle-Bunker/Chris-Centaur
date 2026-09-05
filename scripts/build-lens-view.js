#!/usr/bin/env node
/**
 * Bundle the decision lens's view-model for the browser.
 *
 * THE LENS HAS ONE IMPLEMENTATION. The reducer that folds a turn's events into
 * a frame, the cursor state machine, and the renderer that turns a frame into
 * a draw transcript all live in TypeScript under `src/lens/`, and live play,
 * replay and the boundary tests all run that same code. The play page is a
 * browser, which cannot import TypeScript, so the module is bundled here into
 * one classic script that hangs the module off `window.LensView`.
 *
 * The alternative — a second copy of the fold, in JavaScript, on the page — is
 * exactly the failure this whole exercise is undoing. The old play page had
 * two display paths and they drifted where nobody was looking; a second
 * reducer would drift in the same way and take Law C ("live and replay are the
 * same fold over the same event type") with it.
 *
 * The bundle is CHECKED IN, on the same terms the vendored engine is: a
 * generated artifact is only legitimate when something asserts it matches its
 * source, so `src/tests/lens-bundle.test.ts` rebuilds it and compares byte for
 * byte. Change anything under `src/lens/` and that test tells you to run this.
 *
 * Usage:
 *   npm run build:lens            # write src/web/lens-view.js
 *   npm run build:lens -- --check # verify only, exit 1 on drift
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'lens', 'view', 'index.ts');
const OUT = path.join(ROOT, 'src', 'web', 'lens-view.js');

const BANNER = `/**
 * GENERATED — do not edit. Run \`npm run build:lens\` after changing
 * src/lens/**; src/tests/lens-bundle.test.ts fails if this file drifts.
 *
 * The decision lens's view-model: the reducer's consumer, the cursor state
 * machine, the two sources and the renderer, bundled for the browser as
 * window.LensView. One implementation, shared by live play, replay and the
 * boundary tests.
 */`;

function build() {
  // esbuild is a devDependency; a production install that has omitted dev
  // dependencies can still SERVE the checked-in bundle, it simply cannot
  // rebuild it. Say which of the two situations you are in.
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (err) {
    console.error(
      'esbuild is not installed. `npm install` (with dev dependencies) and retry;\n' +
        'the checked-in src/web/lens-view.js is what the page serves in the meantime.'
    );
    process.exit(1);
  }
  const result = esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'LensView',
    target: 'es2020',
    banner: { js: BANNER },
    // Deterministic output: the test compares bytes, so nothing in here may
    // depend on the machine that ran it.
    write: false,
    legalComments: 'none',
    charset: 'utf8',
  });
  return result.outputFiles[0].text;
}

function main() {
  const bundled = build();
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (onDisk === bundled) {
      console.log('lens-view.js is up to date');
      return;
    }
    console.error('lens-view.js is STALE — run `npm run build:lens`');
    process.exit(1);
  }
  fs.writeFileSync(OUT, bundled);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${bundled.length} bytes)`);
}

main();
