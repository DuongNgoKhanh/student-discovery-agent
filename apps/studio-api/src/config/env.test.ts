import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { failure } from '@/http/response';
import { getStorageEnv, parseAuthEnv, parseKnowledgeEnv, parseProductEnv, parseStorageEnv } from '@/config/env';

describe('parseProductEnv', () => {
  const ok = { DATABASE_URL: 'postgres://u:p@h:5432/d', SECRET_KEY: 's3cret' };

  it('applies TTL and cookie defaults', () => {
    const e = parseProductEnv(ok);
    expect(e.ACCESS_TOKEN_EXPIRE_MINUTES).toBe(30);
    expect(e.REFRESH_TOKEN_EXPIRE_MINUTES).toBe(20160);
    expect(e.AUTH_COOKIE_ACCESS).toBe('sda_access');
    expect(e.AUTH_COOKIE_REFRESH).toBe('sda_refresh');
  });

  it('coerces numeric TTL overrides', () => {
    expect(parseProductEnv({ ...ok, ACCESS_TOKEN_EXPIRE_MINUTES: '15' }).ACCESS_TOKEN_EXPIRE_MINUTES).toBe(15);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseProductEnv({ SECRET_KEY: 's' })).toThrow(/DATABASE_URL/);
  });

  it('throws when SECRET_KEY is missing or empty', () => {
    expect(() => parseProductEnv({ DATABASE_URL: ok.DATABASE_URL })).toThrow(/SECRET_KEY/);
    expect(() => parseProductEnv({ ...ok, SECRET_KEY: '' })).toThrow(/SECRET_KEY/);
  });

  it('importing env module does not read process.env or connect', async () => {
    const mod = await import('@/config/env');
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

describe('parseAuthEnv', () => {
  it('needs only SECRET_KEY, applies TTL defaults and has no admin password default', () => {
    expect(() => parseAuthEnv({})).toThrow();
    const e = parseAuthEnv({ SECRET_KEY: 's', ACCESS_TOKEN_EXPIRE_MINUTES: '', ADMIN_PASSWORD: '' });
    expect(e.ACCESS_TOKEN_EXPIRE_MINUTES).toBe(30);
    expect(e.REFRESH_TOKEN_EXPIRE_MINUTES).toBe(20160);
    expect(e.ADMIN_USERNAME).toBe('admin');
    expect(e.ADMIN_PASSWORD).toBeUndefined();
  });
});

describe('lazy getters', () => {
  it('missing env throws a plain Error and the HTTP response is a generic 500', async () => {
    vi.stubEnv('S3_ENDPOINT', '');
    vi.stubEnv('S3_ACCESS_KEY', '');
    let thrown: unknown;
    try {
      getStorageEnv();
    } catch (e) {
      thrown = e;
    }
    vi.unstubAllEnvs();
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ZodError);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = failure(thrown, { requestId: 'r', traceId: 't' });
    spy.mockRestore();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain('INTERNAL_ERROR');
    expect(text).not.toContain('S3_');
  });
});

it.each(['14', '61'])('rejects unsafe access TTL %s', (value) => { expect(() => parseAuthEnv({ SECRET_KEY: 's', ACCESS_TOKEN_EXPIRE_MINUTES: value })).toThrow(); });
it.each(['10079', '43201'])('rejects unsafe refresh TTL %s', (value) => { expect(() => parseAuthEnv({ SECRET_KEY: 's', REFRESH_TOKEN_EXPIRE_MINUTES: value })).toThrow(); });

describe('knowledge env', () => {
  it('defaults the embedding model list and signing kid', () => {
    const env = parseKnowledgeEnv({});
    expect(env.KNOWLEDGE_DATABASE_URL).toBeUndefined();
    expect(env.KNOWLEDGE_EMBEDDING_MODELS).toEqual(['gemini-embedding-2']);
    expect(env.STUDIO_RUNTIME_SIGNING_KID).toBe('studio');
  });
  it('splits the model list and treats blanks as unset', () => {
    const env = parseKnowledgeEnv({ KNOWLEDGE_EMBEDDING_MODELS: ' fake-embedding , gemini-embedding-2 ', RUNTIME_INTERNAL_URL: '' });
    expect(env.KNOWLEDGE_EMBEDDING_MODELS).toEqual(['fake-embedding', 'gemini-embedding-2']);
    expect(env.RUNTIME_INTERNAL_URL).toBeUndefined();
  });
  it('rejects a malformed runtime URL', () => {
    expect(() => parseKnowledgeEnv({ RUNTIME_INTERNAL_URL: 'not a url' })).toThrow();
  });
});
