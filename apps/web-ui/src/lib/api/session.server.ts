import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createSessionSchema, type Session } from '../../../../../contracts/runtime/session';
import { getUiEnv } from '@/config/env';

export type { Session };
export class SessionExpired extends Error { constructor() { super('Access session has expired'); } }
const sessionSchema = createSessionSchema(z);

export class SessionApiUnavailable extends Error {
  constructor() { super('Studio API session service is unavailable'); }
}

const sessionResponse = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

/** UI rendering consumes verified metadata over HTTP; it owns no Product credentials. */
export async function getSession(): Promise<Session | null> {
  try {
    const incoming = await headers();
    const forwarded = new Headers();
    for (const name of ['cookie', 'x-request-id', 'x-trace-id']) {
      const value = incoming.get(name);
      if (value) forwarded.set(name, value);
    }
    const response = await fetch(new URL('/api/v1/auth/session', getUiEnv().STUDIO_API_ORIGIN).href, {
      headers: forwarded, cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) {
      const error = await response.json().catch(() => null);
      if (error?.error?.code === 'AUTH_TOKEN_EXPIRED') throw new SessionExpired();
      return null;
    }
    if (!response.ok) throw new SessionApiUnavailable();
    return sessionSchema.parse(sessionResponse.parse(await response.json()).data);
  } catch (error) {
    if (error instanceof SessionExpired) throw error;
    throw new SessionApiUnavailable();
  }
}
