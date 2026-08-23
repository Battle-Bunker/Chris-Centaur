/**
 * Bench entry point. Plain CommonJS so it can install the two resolver shims
 * the repo's jest config installs (`moduleNameMapper`) BEFORE ts-node loads
 * any of the vendored engine:
 *
 *   1. `./bitgrid.js` -> `./bitgrid.ts`  (the vendored ESM specifiers)
 *   2. `@shared/*`    -> `src/engine-vendor/shared/*`
 *
 * Usage:
 *   node --max-old-space-size=512 --expose-gc bench/soak/run.js <scenario> [k=v ...]
 */

'use strict';

const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const original = Module._resolveFilename;
Module._resolveFilename = function patched(request, parent, isMain, options) {
  if (request.startsWith('@shared/')) {
    request = path.join(ROOT, 'src', 'engine-vendor', 'shared', request.slice('@shared/'.length));
  }
  try {
    return original.call(this, request, parent, isMain, options);
  } catch (err) {
    if (/^\.{1,2}\//.test(request) && request.endsWith('.js')) {
      return original.call(this, request.slice(0, -3), parent, isMain, options);
    }
    throw err;
  }
};

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
process.env.TS_NODE_FILES = 'false';
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'ES2020', sourceMap: false },
});

require('./main.ts');
