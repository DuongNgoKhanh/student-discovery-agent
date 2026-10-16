import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { components } from '@/generated/api/user-api';
import { getUiEnv } from '@/config/env';

export type Session = components['schemas']['SessionMetadata'];

export class SessionApiUnavailable extends Error {
  constructor() { super('Studio API session service is unavailable'); }
}

const sessionResponse = z.object({
  success: z.literal(true),
  data: z.object({ userId: z.string().min(1), isAdmin: z.boolean() }),
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
    if (response.status === 401) return null;
    if (!response.ok) throw new SessionApiUnavailable();
    return sessionResponse.parse(await response.json()).data;
  } catch {
    throw new SessionApiUnavailable();
  }
}
