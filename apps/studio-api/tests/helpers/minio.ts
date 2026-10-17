import { GenericContainer, Wait } from 'testcontainers';

export interface MinioHandle {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  stop(): Promise<void>;
}

const ACCESS_KEY = 'sda_test_access';
const SECRET_KEY = 'sda_test_secret_key';

/** Disposable MinIO on a random mapped port; callers must `stop()` in a `finally`. */
export async function startMinio(): Promise<MinioHandle> {
  const container = await new GenericContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z')
    .withEnvironment({ MINIO_ROOT_USER: ACCESS_KEY, MINIO_ROOT_PASSWORD: SECRET_KEY })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    stop: async () => {
      await container.stop();
    },
  };
}
