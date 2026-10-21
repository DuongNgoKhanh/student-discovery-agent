import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminToPublic, toAdminProfile, toUserProfile } from './users.profile';
import { userQuerySchema } from './users.schemas';
import { handleGet } from './routes/download';
import { encodeExperienceCursor, decodeExperienceCursor } from '../experiences/experiences.repository';
import { patchExperienceSchema, saveDraftSchema, toExperienceMetadataDTO, toExperienceDraftDTO } from '../experiences/experiences.schemas';
vi.mock('@/infrastructure/storage/objects', () => ({ getObject: vi.fn() }));
import { getObject } from '@/infrastructure/storage/objects';
const row = { id: 4, email: 'private@example.test', name: 'Name', bio: 'private bio', position: 'Student', avatar_url: null, hashed_password: 'secret', is_deleted: false, created_at: new Date(), updated_at: new Date() };
describe('API review regressions', () => {
  it('public users expose only four safe fields while self/admin retain email', () => {
    expect(adminToPublic(toAdminProfile(row))).toEqual({ id: 4, name: 'Name', avatar_url: null, position: 'Student' });
    expect(toUserProfile(row).email).toBe(row.email);
  });
  it('rejects unsupported cursor sorting rather than silently ignoring it', () => {
    expect(userQuerySchema.safeParse({ order_by: 'email' }).success).toBe(false);
    expect(userQuerySchema.safeParse({ dir: 'sideways' }).success).toBe(false);
  });
  it('rejects forged unsigned experience cursors', () => {
    const forged = Buffer.from(JSON.stringify({ created_at: '2026-10-19T10:00:00.000Z', id: 'exp_a' })).toString('base64url');
    expect(() => decodeExperienceCursor(forged)).toThrow();
    expect(decodeExperienceCursor(encodeExperienceCursor({ created_at: '2026-10-19T10:00:00.000Z', id: 'exp_a' })).id).toBe('exp_a');
  });
  it('uses explicit metadata and draft revision request names', () => {
    expect(patchExperienceSchema.safeParse({ expected_metadata_revision: 0, name: 'New', idempotency_key: 'p' }).success).toBe(true);
    expect(saveDraftSchema.safeParse({ expected_draft_revision: 0, content: {}, idempotency_key: 'd' }).success).toBe(true);
    expect(toExperienceMetadataDTO({ id: 'exp_a', revision: 2, name: 'N', description: '', activity_type: 'personality_assessment', created_at: new Date(), updated_at: new Date() })).toHaveProperty('metadata_revision', 2);
    expect(toExperienceDraftDTO({ experience_id: 'exp_a', draft_id: 'd', revision: 3, content_hash: 'h', content: {}, updated_by: 'a', updated_at: new Date() })).toHaveProperty('draft_revision', 3);
  });
  it.each(['\0x', 'x\ny', '../x', './x', '%', '%00x', '%2500x', '%2e%2e/x', '%252e%252e/x', '.%2fsecret', 'x%5c..%5cy', '%0ax'])('rejects unsafe encoded object path %s before storage lookup', async (key) => {
    vi.stubEnv('MINIO_PUBLIC_BUCKET_NAME', 'sda-public');
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY', 'test');
    vi.stubEnv('S3_SECRET_KEY', 'test');
    vi.stubEnv('S3_BUCKET', 'private');
    vi.mocked(getObject).mockClear();
    const response = await handleGet(new Request(`http://localhost/api/v1/download?object_name=${encodeURIComponent('sda-public/' + key)}`), { params: {} });
    expect(response.status).toBe(404);
    expect(getObject).not.toHaveBeenCalled();
  });
});

beforeEach(() => { vi.stubEnv('SECRET_KEY', 'cursor-test-secret'); });

it('public object download sanitizes the filename and sends nosniff', async () => {
  vi.stubEnv('MINIO_PUBLIC_BUCKET_NAME', 'sda-public');
  vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
  vi.stubEnv('S3_ACCESS_KEY', 'test');
  vi.stubEnv('S3_SECRET_KEY', 'test');
  vi.stubEnv('S3_BUCKET', 'private');
  vi.mocked(getObject).mockResolvedValueOnce({ body: new Response(new Uint8Array([1])).body!, contentType: 'image/png', size: 1 });
  const response = await handleGet(new Request('http://localhost/api/v1/download?object_name=' + encodeURIComponent('sda-public/a"b.png')), { params: {} });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="a_b.png"');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
