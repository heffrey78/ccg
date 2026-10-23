import { defaultServerConditions } from 'vite';
import { defineProject } from 'vitest/config';

// Shared per-package test config. Resolving the '@ccg/source' export condition
// lets tests import sibling workspace packages from source without building them.
export default defineProject({
  ssr: {
    resolve: {
      conditions: ['@ccg/source', ...defaultServerConditions],
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
