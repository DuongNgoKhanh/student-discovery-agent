import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { startMinio, type MinioHandle } from '../helpers/minio';
import { call, idRoute, json, route } from '../helpers/users-api';
import { migrateProduct } from '@/server/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/server/db/client';
import { issueAccessToken } from '@/server/auth/tokens';
import { findUserById, insertUser } from '@/server/users/users.repository';
import { POST as upload } from '@/app/api/v1/users/avatar/upload/route';
import { GET as getAvatar } from '@/app/api/v1/users/[user_id]/avatar/route';
import { GET as download } from '@/app/api/v1/download/route';

const BUCKET = 'sda-public';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let pg: PostgresHandle;
let minio: MinioHandle;
beforeAll(async () => {
  pg = await startPostgres();
  try {
    await migrateProduct(pg.url);
    minio = await startMinio();
    const s3 = new S3Client({
      endpoint: minio.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.accessKey, secretAccessKey: minio.secretKey },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    s3.destroy();
  } catch (e) {
    await minio?.stop();
    await pg.stop();
    throw e;
  }
});
afterAll(async () => {
  try {
    await closeProductDatabase();
  } finally {
    await minio?.stop();
    await pg?.stop();
  }
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  vi.stubEnv('S3_ENDPOINT', minio.endpoint);
  vi.stubEnv('S3_ACCESS_KEY', minio.accessKey);
  vi.stubEnv('S3_SECRET_KEY', minio.secretKey);
  vi.stubEnv('S3_BUCKET', 'sda-private');
  vi.stubEnv('MINIO_PUBLIC_BUCKET_NAME', BUCKET);
  vi.stubEnv('PRODUCT_BASE_URL', 'https://product.example.test/');
});

async function seed(email: string) {
  const row = await insertUser(getProductDatabase(), { email, hashed_password: 'h', name: 'S' } as never);
  return { row, token: await issueAccessToken(String(row.id)) };
}

function uploadReq(bytes: Uint8Array, token?: string) {
  const form = new FormData();
  form.set('file', new File([bytes as BlobPart], 'a.png', { type: 'image/png' }));
  return new Request('http://localhost/api/v1/users/avatar/upload', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

describe('avatar + download', () => {
  it('upload then GET returns the same bytes and content-type; avatar_url is absolute', async () => {
    const { row, token } = await seed('av1@example.test');
    const res = await upload(uploadReq(PNG, token), route);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.avatar_url).toBe(`https://product.example.test/api/v1/users/${row.id}/avatar`);
    expect((await findUserById(getProductDatabase(), row.id))?.avatar_url).toBe(body.data.avatar_url);

    const got = await getAvatar(call('GET', `/users/${row.id}/avatar`), idRoute(row.id));
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
  });

  it('rejects_avatar_larger_than_one_mebibyte', async () => {
    const { row, token } = await seed('av2@example.test');
    const big = new Uint8Array(1048577);
    big.set(PNG);
    const res = await upload(uploadReq(big, token), route);
    expect(res.status).toBe(413);
    expect((await findUserById(getProductDatabase(), row.id))?.avatar_url).toBeNull();
  });

  it('rejects non-image bytes and unauthenticated uploads', async () => {
    const { token } = await seed('av3@example.test');
    expect((await upload(uploadReq(new Uint8Array([1, 2, 3, 4]), token), route)).status).toBe(400);
    expect((await upload(uploadReq(PNG), route)).status).toBe(401);
  });

  it('missing avatar -> 404', async () => {
    const { row } = await seed('av4@example.test');
    expect((await getAvatar(call('GET', `/users/${row.id}/avatar`), idRoute(row.id))).status).toBe(404);
  });

  it('download: public bucket works as attachment; other bucket or ".." -> 404', async () => {
    const { row, token } = await seed('dl@example.test');
    await upload(uploadReq(PNG, token), route);
    const ok = await download(call('GET', `/download?object_name=${BUCKET}/user_${row.id}`), route);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/octet-stream');
    expect(ok.headers.get('content-disposition')).toBe(`attachment; filename=user_${row.id}`);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);
    expect((await download(call('GET', `/download?object_name=sda-private/user_${row.id}`), route)).status).toBe(404);
    expect((await download(call('GET', `/download?object_name=${BUCKET}/../x`), route)).status).toBe(404);
  });
});
