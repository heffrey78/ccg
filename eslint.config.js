import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The core must stay deterministic (decision #11): all randomness comes from the
// seeded PRNG in state, and nothing reads the clock.
const determinismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seeded PRNG from game state.' },
    { object: 'Date', property: 'now', message: 'The core must not read the clock.' },
    { object: 'performance', property: 'now', message: 'The core must not read the clock.' },
    { object: 'crypto', property: 'getRandomValues', message: 'Use the seeded PRNG from game state.' },
    { object: 'crypto', property: 'randomUUID', message: 'Use the seeded PRNG from game state.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'The core must not read the clock.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/test-results/**', '**/playwright-report/**', '**/src-tauri/target/**', '**/src-tauri/gen/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: determinismRules,
  },
  {
    // Game packages build only on the engine's public API (decision #14), like external ones.
    files: ['games/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@ccg/*/*'], message: 'Import only the public entry point of an @ccg package.' },
            { group: ['**/packages/*', '**/packages/*/**'], message: 'Import @ccg packages by name, not by path.' },
          ],
        },
      ],
    },
  },
  {
    // The client plays any game package; it must never depend on a specific one (requirement #6).
    files: ['packages/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@ccg/game-*', '**/games/**'], message: 'The client must not import a specific game package.' }] },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
