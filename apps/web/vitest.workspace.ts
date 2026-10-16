import { defineWorkspace } from 'vitest/config';
import { resolve } from 'node:path';

const serverOnlyStub = resolve(__dirname, 'tests/helpers/server-only.ts');

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'client',
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['src/server/**', 'src/config/**', 'node_modules/**'],
    },
  },
  {
    extends: './vitest.config.ts',
    // `server-only` is stubbed for Node tests only; never in next build.
    resolve: { alias: { '@': resolve(__dirname, './src'), 'server-only': serverOnlyStub } },
    test: {
      name: 'server',
      environment: 'node',
      include: ['src/server/**/*.test.ts', 'src/config/**/*.test.ts', 'src/app/api/**/*.test.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    resolve: { alias: { '@': resolve(__dirname, './src'), 'server-only': serverOnlyStub } },
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
