import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { z } from 'zod';
import { CLIENT_INVALID_ENVELOPE, unwrapChatEnvelope } from './envelope';
import { errorEnvelope, fixtureMeta, successEnvelope } from '../fixtures';

const dataSchema = z.object({ id: z.string() }).passthrough();

describe('unwrapChatEnvelope', () => {
  it('trả data khi success=true', () => {
    const data = unwrapChatEnvelope(successEnvelope(200, { id: 'conv_1' }), 200, dataSchema);
    expect(data.id).toBe('conv_1');
  });

  it('HTTP 200 với success=false là lỗi, không phải thành công (FR-UI-01)', () => {
    const body = {
      status: 200,
      success: false,
      data: null,
      error: { code: 'REQ_INVALID', message: 'lỗi nghiệp vụ', retryable: false },
      meta: fixtureMeta(),
    };
    const run = () => unwrapChatEnvelope(body, 200, dataSchema);
    expect(run).toThrow(ApiError);
    try {
      run();
    } catch (e) {
      expect((e as ApiError).code).toBe('REQ_INVALID');
    }
  });

  it('giữ details của lỗi 409 để UI đồng bộ state mới', () => {
    const body = errorEnvelope(409, 'REVISION_CONFLICT', {
      details: { kind: 'revision_conflict', actual_revision: 4 },
    });
    try {
      unwrapChatEnvelope(body, 409, dataSchema);
      expect.unreachable();
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('REVISION_CONFLICT');
      expect(err.httpStatus).toBe(409);
      expect(err.details).toEqual({ kind: 'revision_conflict', actual_revision: 4 });
    }
  });

  it('body sai shape thành lỗi client, không render dữ liệu hỏng', () => {
    try {
      unwrapChatEnvelope({ success: true, data: { id: 1 } }, 200, dataSchema);
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe(CLIENT_INVALID_ENVELOPE);
    }
  });

  it('body không phải JSON object thành lỗi client', () => {
    expect(() => unwrapChatEnvelope(null, 500, dataSchema)).toThrow(ApiError);
  });
});
