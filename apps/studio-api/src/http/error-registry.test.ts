import { describe, expect, it } from 'vitest';
import { failure } from '@/http/response';
import { ProductError } from '@/http/errors';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_CODES, ERROR_ALIASES } from '@/generated/error-codes';

const context = { requestId: 'registry-request', traceId: 'registry-trace' };

describe('registered transport error codes', () => {
  it('keeps all generated bindings synchronized with the central registry', () => {
    const root = resolve(__dirname, '../../../..');
    const registry = JSON.parse(readFileSync(resolve(root, 'contracts/error-codes.json'), 'utf8'));
    expect(Object.keys(ERROR_CODES)).toEqual(Object.keys(registry.codes));
    expect(ERROR_ALIASES).toEqual(Object.fromEntries(Object.entries(registry.codes).flatMap(([code, entry]) => (entry as { aliases: string[] }).aliases.map((alias) => [alias, code]))));
    expect(readFileSync(resolve(root, 'apps/web-ui/src/generated/error-codes.ts'), 'utf8')).toBe(readFileSync(resolve(root, 'apps/studio-api/src/generated/error-codes.ts'), 'utf8'));
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^[A-Z][A-Z0-9]*_[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
    for (const target of Object.values(ERROR_ALIASES)) expect(ERROR_CODES).toHaveProperty(target);
  });

  it('registers every literal service error emitted by either API', () => {
    const root = resolve(__dirname, '../../../..');
    function check(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (/\.(ts|py)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          for (const match of readFileSync(path, 'utf8').matchAll(/(?:ProductError|RuntimeSessionError)\(\s*\d+,\s*['"]([A-Z_]+)['"]/g)) {
            expect(Object.hasOwn(ERROR_CODES, match[1]!) || Object.hasOwn(ERROR_ALIASES, match[1]!), `${path}: ${match[1]}`).toBe(true);
          }
        }
      }
    }
    check(resolve(root, 'apps/studio-api/src'));
    check(resolve(root, 'apps/agent-runtime/src/agent_runtime'));
  });
  it.each([
    ['REVISION_CONFLICT', 'CONFLICT_REVISION'],
    ['IDEMPOTENCY_KEY_COLLISION', 'CONFLICT_IDEMPOTENCY_KEY'],
    ['RESOURCE_NOT_FOUND', 'RES_NOT_FOUND'],
    ['AUTH_INVALID_TOKEN', 'AUTH_TOKEN_INVALID'],
    ['INTERNAL_ERROR', 'SYS_INTERNAL_ERROR'],
    ['INVALID_INPUT', 'VAL_INVALID_INPUT'],
  ])('canonicalizes %s without changing the internal exception', async (legacy, canonical) => {
    const error = new ProductError(409, legacy, 'Meaningful message', false, { kind: 'example' });
    const body = await failure(error, context).json();
    expect(body.error).toEqual({ code: canonical, legacy_code: legacy, message: 'Meaningful message', retryable: false, details: { kind: 'example' } });
    expect(error.code).toBe(legacy);
  });

  it('keeps stable codes without redundant legacy_code', async () => {
    const body = await failure(new ProductError(422, 'PUBLISH_GATE_FAILED', 'Publish gate failed'), context).json();
    expect(body.error.code).toBe('PUBLISH_GATE_FAILED');
    expect(body.error).not.toHaveProperty('legacy_code');
  });

  it('hides unregistered codes and their private details', async () => {
    const response = failure(new ProductError(400, 'PRIVATE_UNREGISTERED', 'database password', true, { secret: 'credential' }), context);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toEqual({ code: 'SYS_INTERNAL_ERROR', message: 'Internal server error', retryable: false, details: null });
    expect(JSON.stringify(body)).not.toContain('PRIVATE_UNREGISTERED');
    expect(JSON.stringify(body)).not.toContain('credential');
  });
});
