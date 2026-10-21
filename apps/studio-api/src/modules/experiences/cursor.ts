import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

/** Versioned signed cursor. Scope binds the token to collection, filters and ordering. */
export function encodeCursor(scope: string, value: unknown): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, scope, value })).toString('base64url');
  const signature = createHmac('sha256', getAuthEnv().SECRET_KEY).update(`pagination:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeCursor(token: string, scope: string): unknown {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const [payload, sig] = token.split('.') as [string, string];
    const expected = createHmac('sha256', getAuthEnv().SECRET_KEY).update(`pagination:${payload}`).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (sig !== actual.toString('base64url') || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.scope !== scope) throw new Error();
    return parsed.value;
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
}
