import 'server-only';
import { getStorageEnv } from '@/config/env';
import type { ProductDatabase } from '../db/client';
import { ProductError } from '../http/errors';
import { getObject, putObject, type StoredObject } from '../storage/objects';
import { updateUserRow } from './users.repository';

export const MAX_AVATAR_BYTES = 1048576;

export function publicBucket(): string {
  const bucket = getStorageEnv().MINIO_PUBLIC_BUCKET_NAME;
  if (!bucket) throw new Error('MINIO_PUBLIC_BUCKET_NAME is not configured');
  return bucket;
}

export const avatarKey = (userId: number) => `user_${userId}`;

function sniff(b: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

export const tooLarge = () => new ProductError(413, 'VAL_PAYLOAD_TOO_LARGE', 'File size exceeds 1MB limit');
const bad = (msg: string) => new ProductError(400, 'VAL_INVALID_AVATAR', msg);

export async function uploadAvatar(db: ProductDatabase, userId: number, file: File): Promise<{ avatar_url: string }> {
  if (file.size === 0) throw bad('File is empty');
  if (file.size > MAX_AVATAR_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniff(bytes);
  if (!contentType) throw bad('Only PNG or JPEG images are allowed');

  const base = getStorageEnv().PRODUCT_BASE_URL;
  if (!base) throw new Error('PRODUCT_BASE_URL is not configured');
  // Storage first: if it throws, the DB row is left untouched.
  await putObject(publicBucket(), avatarKey(userId), bytes, contentType);
  const avatar_url = `${base.replace(/\/+$/, '')}/api/v1/users/${userId}/avatar`;
  await updateUserRow(db, userId, { avatar_url });
  return { avatar_url };
}

export async function readAvatar(_db: ProductDatabase, userId: number): Promise<StoredObject | null> {
  return getObject(publicBucket(), avatarKey(userId));
}
