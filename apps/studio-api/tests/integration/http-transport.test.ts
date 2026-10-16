import { serve } from '@hono/node-server';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '@/app';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase } from '@/infrastructure/db/client';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { startMinio, type MinioHandle } from '../helpers/minio';

let pg: PostgresHandle;
let minio: MinioHandle;
let server: Server | undefined;
let origin: string;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  minio = await startMinio();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'transport-test-secret');
  vi.stubEnv('S3_ENDPOINT', minio.endpoint);
  vi.stubEnv('S3_ACCESS_KEY', minio.accessKey);
  vi.stubEnv('S3_SECRET_KEY', minio.secretKey);
  vi.stubEnv('S3_BUCKET', 'transport-private');
  vi.stubEnv('MINIO_PUBLIC_BUCKET_NAME', 'transport-public');
  const storage = new S3Client({
    endpoint: minio.endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: minio.accessKey, secretAccessKey: minio.secretKey },
  });
  try { await storage.send(new CreateBucketCommand({ Bucket: 'transport-public' })); }
  finally { storage.destroy(); }
  server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 }) as Server;
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('PRODUCT_BASE_URL', origin);
});

afterAll(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await closeProductDatabase();
  } finally {
    await minio?.stop();
    await pg?.stop();
    vi.unstubAllEnvs();
  }
});

it('preserves two auth cookies and binary avatar bytes over the Node adapter', async () => {
  const credentials = { email: 'http@example.test', password: 'Transport1!' };
  const post = (path: string) => fetch(`${origin}/api/v1/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  });
  const registered = await post('register');
  expect(registered.status).toBe(200);
  await registered.json();
  const login = await post('login');
  expect(login.status).toBe(200);
  expect(login.headers.getSetCookie()).toHaveLength(2);
  const cookie = login.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
  const { data } = await login.json();
  const session = await fetch(`${origin}/api/v1/auth/session`, { headers: { cookie } });
  expect(session.status).toBe(200);
  expect((await session.json()).data).toEqual({ userId: String(data.user.id), isAdmin: false });
  const form = new FormData();
  form.set('file', new File([png], 'avatar.png', { type: 'image/png' }));
  const uploaded = await fetch(`${origin}/api/v1/users/avatar/upload`, { method: 'POST', headers: { cookie }, body: form });
  expect(uploaded.status).toBe(200);
  await uploaded.json();
  const avatar = await fetch(`${origin}/api/v1/users/${data.user.id}/avatar`);
  expect(avatar.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(png);
});
