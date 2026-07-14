import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // One shared vtt_test DB + a single backend, so run files serially.
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
