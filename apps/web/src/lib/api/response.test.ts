import { describe, it, expect } from 'vitest';
import { unwrap } from './response';
import { ApiError } from './errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('unwrap', () => {
  it('trả data khi success', async () => {
    const data = await unwrap<{ id: number }>(
      jsonResponse({ success: true, data: { id: 1 }, error: null }),
    );
    expect(data).toEqual({ id: 1 });
  });

  it('ném ApiError khi lỗi nghiệp vụ (HTTP 200, success:false)', async () => {
    const res = jsonResponse({
      success: false,
      data: null,
      error: { code: 'REQ_INVALID', message: 'Sai', retryable: false },
    });
    await expect(unwrap(res)).rejects.toBeInstanceOf(ApiError);
    await expect(unwrap(res)).rejects.toMatchObject({ code: 'REQ_INVALID', retryable: false });
  });

  it('ném ApiError khi lỗi kỹ thuật 5xx', async () => {
    const res = jsonResponse(
      { success: false, data: null, error: { code: 'SYS_500', message: 'x', retryable: true } },
      500,
    );
    await expect(unwrap(res)).rejects.toMatchObject({ code: 'SYS_500', httpStatus: 500 });
  });
});
