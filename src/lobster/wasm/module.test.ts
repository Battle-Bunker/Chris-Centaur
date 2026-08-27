/**
 * THE COMMITTED ARTIFACT IS THE COMMITTED SOURCE.
 *
 * `src/lobster/wasm/module.ts` carries the compiled kernel as base64 so it
 * loads identically under ts-jest, ts-node and `dist/` (see
 * `scripts/build-wasm.js`). That is a build output checked into the tree, and
 * the failure mode of any such thing is that somebody edits the source and
 * forgets to rebuild — after which the tests keep passing against a module that
 * no longer implements the file it claims to.
 *
 * So the generated module carries the SHA-256 of the AssemblyScript source, and
 * this recomputes it from the file on disk. It needs no toolchain, which is the
 * point: `assemblyscript` is a devDependency that CI may not install, and a
 * gate that only runs where the compiler is installed is not a gate.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SOURCE_SHA256, WASM_BASE64, WASM_SHA256 } from './module';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'wasm', 'assembly', 'territory.ts');
const ARTIFACT = join(ROOT, 'wasm', 'territory.wasm');

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe('the committed wasm artifact', () => {
  it('was built from the AssemblyScript source now on disk', () => {
    // If this fails: `npm run build:wasm`. It means the kernel source moved and
    // the bytes did not — every wasm number in the suite is then about code
    // nobody can read.
    expect(sha(readFileSync(SRC))).toBe(SOURCE_SHA256);
  });

  it('embeds bytes that hash to the digest it declares', () => {
    expect(sha(Buffer.from(WASM_BASE64, 'base64'))).toBe(WASM_SHA256);
  });

  it('matches wasm/territory.wasm byte for byte', () => {
    // Belt and braces: the .wasm next to the source is what a reviewer
    // disassembles, and the base64 is what actually runs. They are one build.
    if (!existsSync(ARTIFACT)) return;
    expect(readFileSync(ARTIFACT).equals(Buffer.from(WASM_BASE64, 'base64'))).toBe(true);
  });

  it('is a valid module that imports exactly one memory', () => {
    const mod = new WebAssembly.Module(Buffer.from(WASM_BASE64, 'base64'));
    const imports = WebAssembly.Module.imports(mod);
    expect(imports).toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
  });
});
