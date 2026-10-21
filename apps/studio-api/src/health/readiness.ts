import { sql } from 'drizzle-orm';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { getProductDatabase } from '@/infrastructure/db/client';
import { getStorageEnv } from '@/config/env';
import { getS3Client } from '@/infrastructure/storage/s3';
import { getProductEnv } from '@/config/env';

export type HealthStatus = 'ok' | 'degraded' | 'down';
export type ReadinessSnapshot = {
  status: HealthStatus;
  checks: Record<string, HealthStatus>;
};

const statusOf = (checks: Record<string, HealthStatus>): HealthStatus => {
  const values = Object.values(checks);
  if (values.includes('down')) return 'down';
  if (values.includes('degraded')) return 'degraded';
  return 'ok';
};

async function checkDatabase(): Promise<HealthStatus> {
  try {
    await getProductDatabase().execute(sql`select 1`);
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkMinio(): Promise<HealthStatus> {
  try {
    const env = getStorageEnv();
    const buckets = [env.S3_BUCKET, env.MINIO_PUBLIC_BUCKET_NAME].filter((bucket): bucket is string => Boolean(bucket));
    await Promise.all(buckets.map(bucket => getS3Client().send(new HeadBucketCommand({ Bucket: bucket }))));
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkRuntime(): Promise<HealthStatus> {
  let url: string | undefined;
  try {
    url = getProductEnv().RUNTIME_READY_URL;
  } catch {
    return 'down';
  }
  if (!url) return 'degraded';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({})) as { status?: unknown };
    if (body.status === 'ok' && response.ok) return 'ok';
    if (body.status === 'degraded' || body.status === 'down') return body.status;
    return 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export async function probeReadiness(): Promise<ReadinessSnapshot> {
  const entries = await Promise.all([
    checkDatabase().then(status => ['db', status] as const),
    checkMinio().then(status => ['minio', status] as const),
    checkRuntime().then(status => ['runtime', status] as const),
  ]);
  const checks = Object.fromEntries(entries) as Record<string, HealthStatus>;
  return { status: statusOf(checks), checks };
}

export function readinessResponse(snapshot: ReadinessSnapshot): Response {
  return new Response(JSON.stringify(snapshot), {
    status: snapshot.status === 'ok' ? 200 : 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
