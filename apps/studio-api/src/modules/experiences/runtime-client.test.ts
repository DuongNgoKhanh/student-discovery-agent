import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import {
  defaultExperienceRuntimeClient,
  EVALUATE_TARGET,
  VALIDATE_TARGET,
  VERIFY_TARGET,
} from '@/modules/experiences/runtime-client';

const KEY = Buffer.alloc(32, 9).toString('base64');
const ctx = { requestId: 'req-1', traceId: 'trace-1' };

beforeEach(() => {
  vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
  vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', KEY);
  vi.stubEnv('STUDIO_RUNTIME_SIGNING_KID', 'studio');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );

describe('defaultExperienceRuntimeClient', () => {
  describe('validate', () => {
    it('signs with purpose experience.validate and returns the report', async () => {
      const mockReport = {
        id: 'val_123',
        experience_id: 'exp_1',
        draft_revision: 2,
        content_hash: 'sha256:abc',
        definition_schema_version: '2.0',
        engine_version: 'adaptive-riasec-v2',
        status: 'passed',
        mandatory_passed: true,
        issues: [],
        created_at: '2026-11-03T00:00:00Z',
      };
      respond(200, { success: true, data: mockReport });

      const command = {
        experience_id: 'exp_1',
        definition: { schema_version: '2.0' },
        expected_revision: 2,
        content_hash: 'sha256:abc',
        idempotency_key: 'idem_val_1',
      };

      const result = await defaultExperienceRuntimeClient.validate(command, ctx);
      expect(result).toEqual(mockReport);

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(String(url)).toBe(`http://runtime:8000${VALIDATE_TARGET}`);
      expect(JSON.parse(init!.body as string)).toEqual(command);
      expect(decodeJwt((init!.headers as Record<string, string>)['x-caller-context']!)).toMatchObject({
        purpose: 'experience.validate',
        caller_type: 'studio_service',
      });
    });

    it('rejects with 503 if response is malformed', async () => {
      respond(200, { success: true, data: { status: 'not-a-valid-status' } });
      await expect(
        defaultExperienceRuntimeClient.validate(
          {
            experience_id: 'exp_1',
            definition: {},
            expected_revision: 1,
            content_hash: 'sha256:abc',
            idempotency_key: 'k1',
          },
          ctx,
        ),
      ).rejects.toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE' });
    });

    it('re-throws 409 conflict when runtime reports hash/revision conflict', async () => {
      respond(409, { success: false, error: { code: 'REVISION_CONFLICT', message: 'Hash mismatch' } });
      await expect(
        defaultExperienceRuntimeClient.validate(
          {
            experience_id: 'exp_1',
            definition: {},
            expected_revision: 1,
            content_hash: 'sha256:abc',
            idempotency_key: 'k1',
          },
          ctx,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    });
  });

  describe('evaluate', () => {
    it('signs with purpose experience.evaluate and returns the evaluation report', async () => {
      const mockReport = {
        id: 'eval_123',
        experience_id: 'exp_1',
        draft_revision: 2,
        content_hash: 'sha256:abc',
        definition_schema_version: '2.0',
        engine_version: 'adaptive-riasec-v2',
        status: 'passed',
        mandatory_passed: true,
        cases: [
          {
            case_id: 'case_1',
            mandatory: true,
            passed: true,
            expected: {},
            actual: {},
            issues: [],
          },
        ],
        created_at: '2026-11-03T00:00:00Z',
      };
      respond(200, { success: true, data: mockReport });

      const command = {
        experience_id: 'exp_1',
        definition: { schema_version: '2.0' },
        expected_revision: 2,
        content_hash: 'sha256:abc',
        idempotency_key: 'idem_eval_1',
      };

      const result = await defaultExperienceRuntimeClient.evaluate(command, ctx);
      expect(result).toEqual(mockReport);

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(String(url)).toBe(`http://runtime:8000${EVALUATE_TARGET}`);
      expect(decodeJwt((init!.headers as Record<string, string>)['x-caller-context']!)).toMatchObject({
        purpose: 'experience.evaluate',
      });
    });
  });

  describe('verify', () => {
    it('signs with purpose experience.verify and returns verified verdict', async () => {
      respond(200, { success: true, data: { verified: true, reason: null } });

      const input = {
        experience_id: 'exp_1',
        definition_hash: 'sha256:abc',
        definition_schema_version: '2.0',
        engine_version: 'adaptive-riasec-v2',
        validation_id: 'val_123',
        evaluation_id: 'eval_123',
      };

      const result = await defaultExperienceRuntimeClient.verify(input, ctx);
      expect(result).toEqual({ verified: true, reason: null });

      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(String(url)).toBe(`http://runtime:8000${VERIFY_TARGET}`);
      expect(JSON.parse(init!.body as string)).toEqual(input);
      expect(decodeJwt((init!.headers as Record<string, string>)['x-caller-context']!)).toMatchObject({
        purpose: 'experience.verify',
      });
    });

    it('returns verified: false with reason if reports are stale or missing', async () => {
      respond(200, { success: true, data: { verified: false, reason: "Validation report 'val_old' not found" } });

      const result = await defaultExperienceRuntimeClient.verify(
        {
          experience_id: 'exp_1',
          definition_hash: 'sha256:abc',
          definition_schema_version: '2.0',
          engine_version: 'adaptive-riasec-v2',
          validation_id: 'val_old',
          evaluation_id: 'eval_old',
        },
        ctx,
      );
      expect(result).toEqual({ verified: false, reason: "Validation report 'val_old' not found" });
    });
  });
});
