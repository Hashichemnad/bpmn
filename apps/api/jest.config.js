/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  testEnvironment: 'node',
  moduleNameMapper: { '^@processhub/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};

module.exports = {
  testTimeout: 30000,
  projects: [
    { ...base, displayName: 'unit', rootDir: '.', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.js',
      setupFiles: ['<rootDir>/test/test-env.js'],
    },
  ],
};
