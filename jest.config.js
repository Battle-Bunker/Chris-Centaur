module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Mirror the tsconfig path alias the vendored engine imports through.
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/engine-vendor/shared/$1',
    // src/partial-engine/ is vendored from an ESM package, so its internal
    // imports carry the ".js" extension ESM requires ("./bitgrid.js" for
    // bitgrid.ts). tsc resolves that shape natively; jest's node resolver does
    // not. Dropping the extension hands the request back to
    // moduleFileExtensions, which finds the .ts — and finds a real .js first
    // where one exists, so the src/web/*.js requires keep working.
    //
    // This one line is the entire cost of keeping the copies byte-identical to
    // upstream. The alternative was rewriting the specifiers in all 14 files
    // during the sync, which would have made every future drift diff noisy.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // THE ONE SUITE THE DEFAULT RUN DOES NOT TAKE, and it is a matter of time
  // rather than of trust: `exact-reply.gate.test.ts` settles concrete worlds
  // inside sixteen games and costs about four minutes. Its seed-1 arm per
  // scenario runs on every `npx jest` from `exact-reply.test.ts`, out of the
  // same table and through the same runner, so nothing here is unguarded —
  // only less of it is guarded. `npm run gate:exact` names the file back in
  // by overriding this list — `npm run gate:exact` puts the PATH FIRST and
  // the override after it, because jest's array options otherwise swallow the
  // positional that follows them.
  testPathIgnorePatterns: ['/node_modules/', 'exact-reply\\.gate\\.test\\.ts$'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    // Vendored third-party source: not ours to cover (see src/engine-vendor).
    '!src/engine-vendor/**',
  ],
};