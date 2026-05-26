import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    // Scoring tests run in node (pure math, no DOM needed).
    // Content tests use happy-dom (declared per-file via @vitest-environment).
    environment: 'node',
  },
});
