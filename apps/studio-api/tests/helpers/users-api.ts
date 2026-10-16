import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { expect } from 'vitest';

const common = parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi/schemas/common.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('date-time', true);
ajv.addSchema({ $id: 'common', components: common.components });
export const validateEnvelope = ajv.compile({ $ref: 'common#/components/schemas/ApiResponse' });


export function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function json(res: Response) {
  const text = await res.text();
  expect(text).not.toContain('hashed_password');
  return JSON.parse(text);
}
