import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductError } from '@/http/errors';
import { getKnowledgePool, mapDatabaseError } from '@/infrastructure/db/knowledge-client';

function expectUnavailable(mapped: unknown) {
  expect(mapped).toBeInstanceOf(ProductError);
  expect(mapped).toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE', retryable: true, details: { kind: 'dependency_down' } });
}

describe('mapDatabaseError', () => {
  it.each(['ECONNREFUSED', '08006', '57P01', '57014'])('maps code %s to 503', (code) => {
    expectUnavailable(mapDatabaseError(Object.assign(new Error('x'), { code })));
  });
  it.each(['Connection terminated unexpectedly', 'Connection terminated due to connection timeout'])('maps "%s" to 503', (message) => {
    expectUnavailable(mapDatabaseError(new Error(message)));
  });
  it('passes a ProductError through unchanged', () => {
    const error = new ProductError(409, 'CONFLICT_ALREADY_EXISTS', 'dup');
    expect(mapDatabaseError(error)).toBe(error);
  });
  it('leaves constraint violations and unrelated errors alone', () => {
    const unique = Object.assign(new Error('duplicate key'), { code: '23505' });
    const plain = new Error('boom');
    expect(mapDatabaseError(unique)).toBe(unique);
    expect(mapDatabaseError(plain)).toBe(plain);
  });
});

describe('getKnowledgePool configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers 503 not_configured while KNOWLEDGE_DATABASE_URL is unset', () => {
    vi.stubEnv('KNOWLEDGE_DATABASE_URL', '');
    expect.assertions(2);
    try {
      getKnowledgePool();
    } catch (error) {
      expect(error).toBeInstanceOf(ProductError);
      expect(error).toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE', details: { kind: 'not_configured' } });
    }
  });

  it('answers 503 not_configured for an invalid knowledge env, logging only variable names', () => {
    vi.stubEnv('KNOWLEDGE_DATABASE_URL', 'postgres://u:p@h/d');
    vi.stubEnv('RUNTIME_INTERNAL_URL', 'not a url');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect.assertions(3);
    try {
      getKnowledgePool();
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE', details: { kind: 'not_configured' } });
    }
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[1])).not.toContain('postgres://');
  });
});
