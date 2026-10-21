import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { success, failure } from '@/http/response';
import { ProductError } from '@/http/errors';

// Validates real envelopes against contracts/openapi/schemas/common.yaml.
// Ajv (v8) understands the OpenAPI 3.0 `nullable` keyword natively, so null
// is not silently skipped or wrongly rejected.
const doc = parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi/schemas/common.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('date-time', true);
ajv.addSchema({ $id: 'error-codes.yaml', ...parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi/schemas/error-codes.yaml'), 'utf8')) });
ajv.addSchema({ $id: 'common', components: doc.components });
const validate = ajv.compile({ $ref: 'common#/components/schemas/ApiResponse' });
const ctx = { requestId: 'req-1', traceId: 'trace-1' };

describe('envelope matches contracts/openapi/schemas/common.yaml ApiResponse', () => {
  it('success', async () => {
    const body = await success({ ok: true }, ctx, 201).json();
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  });
  it('error with null and object details', async () => {
    for (const details of [undefined, { kind: 'x' }]) {
      const body = await failure(new ProductError(422, 'INVALID_INPUT', 'bad', false, details), ctx).json();
      expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it('rejects a non-conforming envelope', () => {
    expect(validate({ status: 200, success: true, data: null, error: 'x', meta: {} })).toBe(false);
  });
});
