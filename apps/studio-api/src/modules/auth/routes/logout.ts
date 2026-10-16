import { clearAuthCookiesOn } from '@/modules/auth/cookies';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';


export const handlePost = withHandler(async (_req, ctx) => clearAuthCookiesOn(success({ ok: true as const }, ctx)));
