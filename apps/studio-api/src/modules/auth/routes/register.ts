import { limitRegistration } from '../registration-limit';
import { register } from '@/modules/auth/auth.service';
import { registerSchema } from '@/modules/auth/auth.schemas';
import { setAuthCookiesOn } from '@/modules/auth/cookies';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';


export const handlePost = withHandler(async (req, ctx) => {
  const input = registerSchema.parse(await readJsonBody(req));
  const db = getProductDatabase();
  await limitRegistration(db, req, input.email);
  const result = await register(db, input);
  return setAuthCookiesOn(success(result.data, ctx), { access: result.data.access_token, refresh: result.refresh_token, sessionMaxAge: result.session_max_age });
});
