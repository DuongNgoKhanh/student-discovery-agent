import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EXPERIENCE_BODY_BYTES,
  assertNoDuplicateKeys,
  parseExperienceJson,
  readExperienceJsonBody,
} from '@/modules/experiences/body';

function req(body: string | undefined, contentType?: string, contentLength?: string) {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers['content-type'] = contentType;
  if (contentLength !== undefined) headers['content-length'] = contentLength;

  return new Request('http://localhost/api/v1/admin/experiences/1/draft', {
    method: 'PUT',
    headers,
    body,
  });
}

describe('assertNoDuplicateKeys', () => {
  it('allows valid JSON objects without duplicate keys', () => {
    expect(() => assertNoDuplicateKeys('{"a": 1, "b": 2}')).not.toThrow();
    expect(() => assertNoDuplicateKeys('{"a": {"b": 1, "c": 2}}')).not.toThrow();
    expect(() => assertNoDuplicateKeys('[{"id": 1}, {"id": 2}]')).not.toThrow();
    expect(() => assertNoDuplicateKeys('{}')).not.toThrow();
    expect(() => assertNoDuplicateKeys('[]')).not.toThrow();
  });

  it('allows duplicate values in arrays', () => {
    expect(() => assertNoDuplicateKeys('["same", "same"]')).not.toThrow();
    expect(() => assertNoDuplicateKeys('[1, 1, 1]')).not.toThrow();
  });

  it('allows strings containing colons, commas, braces, and quotes', () => {
    expect(() =>
      assertNoDuplicateKeys('{"text": "val: { [ , } ] \\" hello", "other": 1}'),
    ).not.toThrow();
  });

  it('rejects duplicate keys at root level with 400 INVALID_REQUEST', () => {
    expect(() => assertNoDuplicateKeys('{"a": 1, "a": 2}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Duplicate key "a"',
      }),
    );
  });

  it('rejects duplicate keys in nested objects', () => {
    expect(() =>
      assertNoDuplicateKeys('{"nested": {"dup": 10, "dup": 20}}'),
    ).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Duplicate key "dup"',
      }),
    );
  });

  it('rejects duplicate keys in objects inside arrays', () => {
    expect(() =>
      assertNoDuplicateKeys('[{"id": 1, "id": 2}]'),
    ).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Duplicate key "id"',
      }),
    );
  });

  it('detects duplicate keys when one is unicode-escaped', () => {
    expect(() => assertNoDuplicateKeys('{"\\u0061": 1, "a": 2}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Duplicate key "a"',
      }),
    );
  });
});

describe('parseExperienceJson', () => {
  it('parses valid JSON data', () => {
    expect(parseExperienceJson('{"name": "test", "items": [1, 2]}')).toEqual({
      name: 'test',
      items: [1, 2],
    });
  });

  it('rejects malformed JSON syntax with 400 INVALID_REQUEST', () => {
    expect(() => parseExperienceJson('{')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Malformed JSON body',
      }),
    );
    expect(() => parseExperienceJson('{"a": 1,}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Malformed JSON body',
      }),
    );
  });

  it('rejects non-finite numbers (Infinity / -Infinity / 1e1000) with 400 INVALID_REQUEST', () => {
    expect(() => parseExperienceJson('{"val": 1e1000}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Non-finite numbers are not allowed',
      }),
    );
    expect(() => parseExperienceJson('{"val": -1e1000}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Non-finite numbers are not allowed',
      }),
    );
    expect(() => parseExperienceJson('[1, 1e1000]')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Non-finite numbers are not allowed',
      }),
    );
  });

  it('rejects duplicate keys via assertNoDuplicateKeys with 400 INVALID_REQUEST', () => {
    expect(() => parseExperienceJson('{"foo": "a", "foo": "b"}')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'INVALID_REQUEST',
      }),
    );
  });
});

describe('readExperienceJsonBody', () => {
  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON;charset=UTF-8',
    'application/merge-patch+json',
  ])('accepts valid content-type %s', async (ct) => {
    await expect(readExperienceJsonBody(req('{"valid": true}', ct))).resolves.toEqual({
      valid: true,
    });
  });

  it.each([
    undefined,
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'text/json',
  ])('rejects unsupported content-type %s with 415 VAL_UNSUPPORTED_MEDIA_TYPE', async (ct) => {
    await expect(readExperienceJsonBody(req('{"a": 1}', ct))).rejects.toMatchObject({
      status: 415,
      code: 'VAL_UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it('handles optional body correctly', async () => {
    await expect(readExperienceJsonBody(req(undefined), { optional: true })).resolves.toBeUndefined();
    await expect(readExperienceJsonBody(req('   '), { optional: true })).resolves.toBeUndefined();
    await expect(
      readExperienceJsonBody(req('{"a": 1}', 'text/plain'), { optional: true }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('rejects empty body when required with 400 INVALID_REQUEST', async () => {
    await expect(readExperienceJsonBody(req('', 'application/json'))).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Request body is required',
    });
    await expect(readExperienceJsonBody(req('   ', 'application/json'))).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Request body is required',
    });
  });

  it('rejects payloads exceeding custom maxBytes with 413 PAYLOAD_TOO_LARGE', async () => {
    const payload = JSON.stringify({ data: 'hello' }); // ~17 bytes
    await expect(
      readExperienceJsonBody(req(payload, 'application/json'), { maxBytes: 10 }),
    ).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('rejects based on Content-Length header exceeding maxBytes before reading body', async () => {
    const payload = JSON.stringify({ a: 1 });
    await expect(
      readExperienceJsonBody(req(payload, 'application/json', '2000000'), {
        maxBytes: DEFAULT_MAX_EXPERIENCE_BODY_BYTES,
      }),
    ).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('accepts payloads within 1MB limit', async () => {
    const data = { content: 'x'.repeat(1000) };
    await expect(
      readExperienceJsonBody(req(JSON.stringify(data), 'application/json')),
    ).resolves.toEqual(data);
  });
});
