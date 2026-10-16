import { describe, expect, it } from 'vitest';
import { readJsonBody } from './body';

function req(body: string | undefined, contentType?: string) {
  return new Request('http://x/api/v1/a', {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  });
}

describe('readJsonBody content type (CSRF hardening)', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8', 'application/merge-patch+json'])(
    'accepts %s',
    async (ct) => {
      await expect(readJsonBody(req('{"a":1}', ct))).resolves.toEqual({ a: 1 });
    },
  );

  it.each([undefined, 'text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'text/json'])(
    'rejects %s with 415 VAL_UNSUPPORTED_MEDIA_TYPE',
    async (ct) => {
      await expect(readJsonBody(req('{"a":1}', ct))).rejects.toMatchObject({ status: 415, code: 'VAL_UNSUPPORTED_MEDIA_TYPE' });
    },
  );

  it('optional empty body needs no content type; non-empty optional body still must be JSON', async () => {
    await expect(readJsonBody(req(undefined), { optional: true })).resolves.toBeUndefined();
    await expect(readJsonBody(req('{"a":1}', 'text/plain'), { optional: true })).rejects.toMatchObject({ status: 415 });
  });

  it('required body: empty -> 400, malformed -> 400', async () => {
    await expect(readJsonBody(req('', 'application/json'))).rejects.toMatchObject({ status: 400, code: 'VAL_INVALID_REQUEST' });
    await expect(readJsonBody(req('{', 'application/json'))).rejects.toMatchObject({ status: 400, code: 'VAL_INVALID_REQUEST' });
  });
});
