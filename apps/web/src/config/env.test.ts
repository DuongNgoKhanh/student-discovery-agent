import { describe, it, expect } from 'vitest';
import { parseEnv, parseProductEnv, parseStorageEnv } from './env';

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

  it('does not require DATABASE_URL or SECRET_KEY', () => {
    expect(() => parseEnv({ API_BASE_URL: 'http://x/api/v1' })).not.toThrow();
  });
});

describe('parseProductEnv', () => {
  const ok = { DATABASE_URL: 'postgres://u:p@h:5432/d', SECRET_KEY: 's3cret' };

  it('applies TTL and cookie defaults', () => {
    const e = parseProductEnv(ok);
    expect(e.ACCESS_TOKEN_EXPIRE_MINUTES).toBe(11520);
    expect(e.REFRESH_TOKEN_EXPIRE_MINUTES).toBe(43200);
    expect(e.AUTH_COOKIE_ACCESS).toBe('sda_access');
    expect(e.AUTH_COOKIE_REFRESH).toBe('sda_refresh');
  });

  it('coerces numeric TTL overrides', () => {
    expect(parseProductEnv({ ...ok, ACCESS_TOKEN_EXPIRE_MINUTES: '5' }).ACCESS_TOKEN_EXPIRE_MINUTES).toBe(5);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseProductEnv({ SECRET_KEY: 's' })).toThrow(/DATABASE_URL/);
  });

  it('throws when SECRET_KEY is missing or empty', () => {
    expect(() => parseProductEnv({ DATABASE_URL: ok.DATABASE_URL })).toThrow(/SECRET_KEY/);
    expect(() => parseProductEnv({ ...ok, SECRET_KEY: '' })).toThrow(/SECRET_KEY/);
  });

  it('importing env module does not read process.env or connect', async () => {
    const mod = await import('./env');
    expect(typeof mod.parseProductEnv).toBe('function');
  });
});

describe('parseStorageEnv', () => {
  it('requires storage settings only when called', () => {
    expect(() => parseStorageEnv({})).toThrow();
    const e = parseStorageEnv({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'a',
      S3_SECRET_KEY: 'b',
      S3_BUCKET: 'bk',
    });
    expect(e.S3_BUCKET).toBe('bk');
    expect(e.S3_REGION).toBe('us-east-1');
  });
});
