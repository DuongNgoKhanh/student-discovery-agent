import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';
import { getStorageEnv } from '@/config/env';

// Named s3.ts (not minio.ts): the adapter uses @aws-sdk/client-s3 with path-style addressing for MinIO.
let cached: { key: string; client: S3Client } | undefined;

/** Lazy client built from env; rebuilt if the endpoint/credentials change (tests). */
export function getS3Client(): S3Client {
  const env = getStorageEnv();
  const key = [env.S3_ENDPOINT, env.S3_ACCESS_KEY, env.S3_SECRET_KEY, env.S3_REGION].join('|');
  if (cached?.key === key) return cached.client;
  cached?.client.destroy();
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  cached = { key, client };
  return client;
}
