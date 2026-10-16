import { adminLogin } from '@/server/auth/auth.service';
import { adminLoginSchema } from '@/server/auth/auth.schemas';
import { clearAuthCookiesOn, setAuthCookiesOn } from '@/server/auth/cookies';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';

export const runtime = 'nodejs';

// Admin gets an access token only; any user refresh cookie is deleted so it cannot
// silently restore a user session.
export const POST = withHandler(async (req, ctx) => {
  const input = adminLoginSchema.parse(await readJsonBody(req));
  const data = await adminLogin(input);
  return clearAuthCookiesOn(setAuthCookiesOn(success(data, ctx), { access: data.access_token }), ['refresh']);
});
