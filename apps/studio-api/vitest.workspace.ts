import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration', environment: 'node', include: ['tests/integration/**/*.test.ts'],
      testTimeout: 120_000, hookTimeout: 120_000,
    },
  },
]);
