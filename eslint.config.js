import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const sharedLanguageOptions = {
  ecmaVersion: 2022,
  sourceType: 'module',
  globals: { ...globals.node, ...globals.es2022 },
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript source files — type-aware linting via tsconfig project
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ...sharedLanguageOptions,
        project: ['./tsconfig.base.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // JavaScript / ESM files — no TypeScript project needed
    files: ['**/*.mjs', '**/*.js'],
    ignores: ['ui/**/*.js'],
    languageOptions: {
      ...sharedLanguageOptions,
    },
  },
  {
    // Browser UI script files served statically by the Operator Control Plane
    files: ['ui/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.es2022 },
    },
  },
  {
    // Test files — relaxed unused-vars for test fixtures and mock handlers
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/*.d.ts',
      '**/tsconfig.tsbuildinfo',
      '**/vitest.config.*',
      '**/coverage/**',
    ],
  }
);