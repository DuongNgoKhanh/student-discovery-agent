import { login } from '@/modules/auth/auth.service';
import { loginSchema } from '@/modules/auth/auth.schemas';
import { setAuthCookiesOn } from '@/modules/auth/cookies';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';


export const handlePost = withHandler(async (req, ctx) => {
  const input = loginSchema.parse(await readJsonBody(req));
  const result = await login(getProductDatabase(), input);
  return setAuthCookiesOn(success(result.data, ctx), { access: result.data.access_token, refresh: result.refresh_token, sessionMaxAge: result.session_max_age });
});
