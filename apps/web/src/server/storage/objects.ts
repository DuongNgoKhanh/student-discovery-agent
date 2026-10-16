import 'server-only';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client } from './s3';

export interface StoredObject {
  body: ReadableStream;
  contentType: string;
  size: number;
}

export async function putObject(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await getS3Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
}

/** Returns null when the object (or bucket) does not exist. */
export async function getObject(bucket: string, key: string): Promise<StoredObject | null> {
  try {
    const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) return null;
    return {
      body: res.Body.transformToWebStream(),
      contentType: res.ContentType ?? 'application/octet-stream',
      size: res.ContentLength ?? 0,
    };
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.name === 'NoSuchBucket' || e.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
