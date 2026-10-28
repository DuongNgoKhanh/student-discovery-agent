import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { dispatch } from './api';
import { declaredResponseValidator } from './openapi-response';
import { call, json } from './users-api';

export const api = async (method: string, path: string, token?: string, body?: unknown) => {
  const response = await dispatch(call(method, path, token, body));
  return { status: response.status, body: await json(response) };
};

export function expectDeclared(envelope: unknown, path: string, method: string, status: number) {
  const validate = declaredResponseValidator('public/knowledge-api.yaml', path, method, status);
  expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
}

export const newKbId = () => `kb-${randomUUID().slice(0, 8)}`;

export async function createKb(token: string, overrides: Record<string, unknown> = {}) {
  const id = newKbId();
  const res = await api('POST', '/admin/knowledge-bases', token, {
    id, name: `KB ${id}`, embedding_model: 'fake-embedding', ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

export async function createField(token: string, kbId: string, body: Record<string, unknown>) {
  const res = await api('POST', `/admin/knowledge-bases/${kbId}/fields`, token, body);
  expect(res.status).toBe(201);
  return res.body.data;
}
