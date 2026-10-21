import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/app';
import { issueAccessToken } from '@/modules/auth/tokens';
import * as service from '@/modules/experiences/experiences.service';

vi.mock('@/modules/experiences/experiences.service');
vi.mock('@/infrastructure/db/client', () => ({
  getProductDatabase: vi.fn(() => ({})),
}));

describe('experiences.routes', () => {
  let adminToken: string;
  let userToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.SECRET_KEY ??= 'test-secret-key-32-bytes-minimum-length-for-hs256';
    adminToken = await issueAccessToken('admin', true);
    userToken = await issueAccessToken('123', false);
  });

  const app = createApp();

  describe('Authentication and Authorization guards', () => {
    const endpoints = [
      { method: 'GET', path: '/api/v1/admin/experiences' },
      { method: 'POST', path: '/api/v1/admin/experiences', body: { name: 'E', idempotency_key: 'k' } },
      { method: 'GET', path: '/api/v1/admin/experiences/exp_1' },
      { method: 'PATCH', path: '/api/v1/admin/experiences/exp_1', body: { expected_metadata_revision: 0, idempotency_key: 'k', name: 'N' } },
      { method: 'GET', path: '/api/v1/admin/experiences/exp_1/draft' },
      { method: 'PUT', path: '/api/v1/admin/experiences/exp_1/draft', body: { expected_draft_revision: 0, idempotency_key: 'k', content: {} } },
      {
        method: 'POST',
        path: '/api/v1/admin/experiences/exp_1/releases',
        body: {
          expected_draft_revision: 0,
          content_hash: 'sha256:' + 'a'.repeat(64),
          validation_id: 'v1',
          evaluation_id: 'e1',
          approval_refs: [],
          idempotency_key: 'k',
        },
      },
      { method: 'GET', path: '/api/v1/admin/experiences/exp_1/releases' },
      { method: 'GET', path: '/api/v1/admin/experience-releases/rel_1' },
    ];

    it.each(endpoints)('$method $path rejects missing auth token with 401', async (ep) => {
      const res = await app.request(ep.path, {
        method: ep.method,
        headers: ep.body ? { 'content-type': 'application/json' } : {},
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it.each(endpoints)('$method $path rejects non-admin token with 403', async (ep) => {
      const res = await app.request(ep.path, {
        method: ep.method,
        headers: {
          authorization: `Bearer ${userToken}`,
          ...(ep.body ? { 'content-type': 'application/json' } : {}),
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('Route dispatching to service', () => {
    it('GET /api/v1/admin/experiences calls listExperiences', async () => {
      vi.mocked(service.listExperiences).mockResolvedValue({
        items: [],
        next_cursor: null,
      });

      const res = await app.request('/api/v1/admin/experiences?limit=10', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      expect(service.listExperiences).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 10 }),
      );
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toEqual([]);
    });

    it('POST /api/v1/admin/experiences calls createExperience and returns 201', async () => {
      vi.mocked(service.createExperience).mockResolvedValue({
        status: 201,
        data: {
          id: 'exp_1',
          metadata_revision: 0,
          name: 'Experience 1',
          description: '',
          activity_type: 'personality_assessment',
          created_at: '2026-10-19T10:00:00.000Z',
          updated_at: '2026-10-19T10:00:00.000Z',
          draft_ref: {
            draft_id: 'draft_1',
            draft_revision: 0,
            content_hash: 'sha256:abc',
          },
        },
      });

      const res = await app.request('/api/v1/admin/experiences', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Experience 1',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_key_1',
        }),
      });

      expect(res.status).toBe(201);
      expect(service.createExperience).toHaveBeenCalledTimes(1);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('exp_1');
    });

    it('GET /api/v1/admin/experiences/:id calls getExperience', async () => {
      vi.mocked(service.getExperience).mockResolvedValue({
        id: 'exp_1',
        metadata_revision: 0,
        name: 'Exp',
        description: '',
        activity_type: 'personality_assessment',
        created_at: '2026-10-19T10:00:00.000Z',
        updated_at: '2026-10-19T10:00:00.000Z',
        draft_ref: null,
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      expect(service.getExperience).toHaveBeenCalledWith(expect.anything(), 'exp_1');
    });

    it('PATCH /api/v1/admin/experiences/:id calls patchExperience', async () => {
      vi.mocked(service.patchExperience).mockResolvedValue({
        status: 200,
        data: {
          id: 'exp_1',
          metadata_revision: 1,
          name: 'Updated Name',
          description: 'Updated Desc',
          activity_type: 'personality_assessment',
          created_at: '2026-10-19T10:00:00.000Z',
          updated_at: '2026-10-19T10:00:00.000Z',
          draft_ref: null,
        },
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expected_metadata_revision: 0,
          idempotency_key: 'patch_1',
          name: 'Updated Name',
        }),
      });

      expect(res.status).toBe(200);
      expect(service.patchExperience).toHaveBeenCalledWith(
        expect.anything(),
        'exp_1',
        expect.objectContaining({ expected_metadata_revision: 0, name: 'Updated Name' }),
      );
    });

    it('GET /api/v1/admin/experiences/:id/draft calls readExperienceDraft', async () => {
      vi.mocked(service.readExperienceDraft).mockResolvedValue({
        experience_id: 'exp_1',
        draft_id: 'draft_1',
        draft_revision: 0,
        content_hash: 'sha256:abc',
        content: {},
        updated_by: 'admin',
        updated_at: '2026-10-19T10:00:00.000Z',
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1/draft', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      expect(service.readExperienceDraft).toHaveBeenCalledWith(expect.anything(), 'exp_1');
    });

    it('PUT /api/v1/admin/experiences/:id/draft calls saveExperienceDraft', async () => {
      vi.mocked(service.saveExperienceDraft).mockResolvedValue({
        status: 200,
        data: {
          experience_id: 'exp_1',
          draft_id: 'draft_1',
          draft_revision: 1,
          content_hash: 'sha256:abc',
          content: { questions: [] },
          updated_by: 'admin',
          updated_at: '2026-10-19T10:00:00.000Z',
        },
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1/draft', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expected_draft_revision: 0,
          idempotency_key: 'save_1',
          content: { questions: [] },
        }),
      });

      expect(res.status).toBe(200);
      expect(service.saveExperienceDraft).toHaveBeenCalledWith(
        expect.anything(),
        'exp_1',
        expect.objectContaining({ expected_draft_revision: 0 }),
        expect.objectContaining({ sub: 'admin' }),
      );
    });

    it('POST /api/v1/admin/experiences/:id/releases calls publishExperienceRelease', async () => {
      vi.mocked(service.publishExperienceRelease).mockResolvedValue({
        status: 201,
        data: {
          id: 'exp_rel_1',
          experience_id: 'exp_1',
          definition_version: '1.0.0',
          definition_hash: 'sha256:' + 'a'.repeat(64),
          definition_schema_version: '1.0',
          engine_version: '1.0.0',
          is_demo: false,
          approval_refs: ['app_1'],
          published_at: '2026-10-19T10:00:00.000Z',
          published_by: 'admin',
        },
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1/releases', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          expected_draft_revision: 1,
          content_hash: 'sha256:' + 'a'.repeat(64),
          validation_id: 'val_1',
          evaluation_id: 'eval_1',
          approval_refs: ['app_1'],
          idempotency_key: 'pub_1',
        }),
      });

      expect(res.status).toBe(201);
      expect(service.publishExperienceRelease).toHaveBeenCalledWith(
        expect.anything(),
        'exp_1',
        expect.objectContaining({ expected_draft_revision: 1 }),
        expect.objectContaining({ sub: 'admin' }),
      );
    });

    it('GET /api/v1/admin/experiences/:id/releases calls listExperienceReleases', async () => {
      vi.mocked(service.listExperienceReleases).mockResolvedValue({
        items: [],
        next_cursor: null,
      });

      const res = await app.request('/api/v1/admin/experiences/exp_1/releases?limit=5', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      expect(service.listExperienceReleases).toHaveBeenCalledWith(
        expect.anything(),
        'exp_1',
        expect.objectContaining({ limit: 5 }),
      );
    });

    it('GET /api/v1/admin/experience-releases/:release_id calls getExperienceRelease', async () => {
      vi.mocked(service.getExperienceRelease).mockResolvedValue({
        id: 'exp_rel_1',
        experience_id: 'exp_1',
        definition_version: '1.0.0',
        definition_hash: 'sha256:' + 'a'.repeat(64),
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        is_demo: false,
        approval_refs: [],
        published_at: '2026-10-19T10:00:00.000Z',
        published_by: 'admin',
      });

      const res = await app.request('/api/v1/admin/experience-releases/exp_rel_1', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      expect(service.getExperienceRelease).toHaveBeenCalledWith(expect.anything(), 'exp_rel_1');
    });
  });

  describe('Validation and error handling', () => {
    it('returns 422 VAL_INVALID_INPUT when path parameter fails resourceIdSchema', async () => {
      const res = await app.request('/api/v1/admin/experiences/invalid@id', {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VAL_INVALID_INPUT');
    });

    it('returns 400 VAL_INVALID_REQUEST on duplicate json keys in body', async () => {
      const res = await app.request('/api/v1/admin/experiences', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: '{"name":"A","name":"B","activity_type":"personality_assessment","idempotency_key":"k"}',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VAL_INVALID_REQUEST');
    });
  });
});
