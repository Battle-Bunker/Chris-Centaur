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