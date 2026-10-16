import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('parse hợp lệ + áp default', () => {
    const e = parseEnv({ API_BASE_URL: 'http://x/api/v1', NODE_ENV: 'test' });
    expect(e.API_BASE_URL).toBe('http://x/api/v1');
    expect(e.AUTH_COOKIE_ACCESS).toBe('sda_access');
    expect(e.AUTH_COOKIE_REFRESH).toBe('sda_refresh');
  });

  it('ném lỗi khi thiếu API_BASE_URL', () => {
    expect(() => parseEnv({})).toThrow();
  });
});
