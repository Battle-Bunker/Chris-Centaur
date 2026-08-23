/**
 * Verifier V1's bench harness. ADDED, never a modification: the repository's
 * own jest.config.js is untouched and does not see this directory (its roots
 * are <rootDir>/src). The bench is run explicitly:
 *
 *   npx jest --config bench/operator/jest.config.js
 *
 * It exists so the measurement runs (which are slow and print raw numbers)
 * never slow down or pollute the repository suite.
 */
const path = require('path');
const root = path.resolve(__dirname, '..', '..');

module.exports = {
  rootDir: root,
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/bench'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/engine-vendor/shared/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/*.bench.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true, diagnostics: false }] },
  testTimeout: 600000,
  maxWorkers: 1,
};
