import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('prefers localised server text, then the HTTP status sentence', () => {
    expect(errorMessage(new ApiError({ code: 'VAL_INVALID_INPUT', message: 'File CSV trống', httpStatus: 422 }))).toBe('File CSV trống');
    expect(errorMessage(new ApiError({ code: 'SYS_UNAVAILABLE', message: 'Knowledge search is unavailable', httpStatus: 503 })))
      .toBe('Dịch vụ tạm thời không sẵn sàng, hãy thử lại sau ít phút.');
    expect(errorMessage(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409 }), { 409: 'Trùng ID' })).toBe('Trùng ID');
    expect(errorMessage(new Error('Lỗi form'))).toBe('Lỗi form');
  });
});
