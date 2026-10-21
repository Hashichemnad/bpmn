/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
    // ESM-only dependencies (openid-client and its helpers) are compiled to CommonJS for Jest;
    // at runtime Node loads them natively (require of ES modules, Node >= 20.19).
    '^.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'CommonJS', target: 'ES2022' }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/|openid-client/|oauth4webapi/|jose/)'],
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
