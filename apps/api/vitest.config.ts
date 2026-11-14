import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    silent: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each test file starts several in-process Postgres (WASM) databases; running too many files
    // at once exhausts memory on smaller machines. Two workers is fast enough and stable.
    maxWorkers: 2,
  },
});
