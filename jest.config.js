module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Mirror the tsconfig path alias the vendored engine imports through.
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/engine-vendor/shared/$1',
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