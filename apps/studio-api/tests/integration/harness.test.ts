import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { CreateBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { startPostgres } from '../helpers/postgres';
import { startMinio } from '../helpers/minio';

describe('test harness smoke', () => {
  it('starts Postgres on a random port, connects, stops', async () => {
    const pg = await startPostgres();
    try {
      const client = new Client({ connectionString: pg.url });
      await client.connect();
      const r = await client.query('select 1 as one');
      expect(r.rows[0].one).toBe(1);
      await client.end();
    } finally {
      await pg.stop();
    }
  });

  it('starts MinIO, creates a bucket, stops', async () => {
    const minio = await startMinio();
    try {
      const s3 = new S3Client({
        endpoint: minio.endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: minio.accessKey, secretAccessKey: minio.secretKey },
      });
      await s3.send(new CreateBucketCommand({ Bucket: 'harness-smoke' }));
      const list = await s3.send(new ListBucketsCommand({}));
      expect(list.Buckets?.map((b) => b.Name)).toContain('harness-smoke');
    } finally {
      await minio.stop();
    }
  });
});
