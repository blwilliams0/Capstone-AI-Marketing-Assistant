import { defineConfig } from 'vitest/config';

// Two workers: each test file starts in-process Postgres (WASM) databases, which use a lot of memory.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000, maxWorkers: 2 } });
