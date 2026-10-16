import { clearAuthCookiesOn } from '@/server/auth/cookies';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';

export const runtime = 'nodejs';

export const POST = withHandler(async (_req, ctx) => clearAuthCookiesOn(success({ ok: true as const }, ctx)));
