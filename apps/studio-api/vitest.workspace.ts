import { configDefaults, defineWorkspace } from 'vitest/config';

// MinIO images are no longer published on Docker Hub and object storage is not in use yet,
// so MinIO-backed integration suites are opt-in: run with SDA_TEST_MINIO=1 to include them.
const minioEnabled = process.env.SDA_TEST_MINIO === '1';
const minioSuites = ['tests/integration/storage-api.test.ts', 'tests/integration/http-transport.test.ts'];

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration', environment: 'node', include: ['tests/integration/**/*.test.ts'],
      exclude: minioEnabled ? configDefaults.exclude : [...configDefaults.exclude, ...minioSuites],
      testTimeout: 120_000, hookTimeout: 120_000,
    },
  },
]);
