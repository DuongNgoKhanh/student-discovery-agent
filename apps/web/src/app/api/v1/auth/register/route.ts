import { register } from '@/server/auth/auth.service';
import { registerSchema } from '@/server/auth/auth.schemas';
import { setAuthCookiesOn } from '@/server/auth/cookies';
import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';

export const runtime = 'nodejs';

export const POST = withHandler(async (req, ctx) => {
  const input = registerSchema.parse(await readJsonBody(req));
  const data = await register(getProductDatabase(), input);
  return setAuthCookiesOn(success(data, ctx), { access: data.access_token, refresh: data.refresh_token });
});
