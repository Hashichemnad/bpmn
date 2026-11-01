// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/prisma/migrations/**',
      '**/*.config.{js,mjs,cjs}',
      '**/vite.config.ts',
      '**/vitest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      // NestJS dependency injection relies on runtime class references in constructor params.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/api/prisma/seed*.ts', 'apps/api/prisma/perf*.ts', 'apps/api/src/main.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // Context providers export their hook; the router module exports its route table.
          allowExportNames: [
            'useAuth',
            'useLocale',
            'createQueryClient',
            'routes',
            'createRouter',
            'ME_KEY',
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/test/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Build and CI scripts (Node, print their reports).
    files: ['scripts/**/*.mjs', 'apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
