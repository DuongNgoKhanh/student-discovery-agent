import { adminLogin } from '@/modules/auth/auth.service';
import { adminLoginSchema } from '@/modules/auth/auth.schemas';
import { clearAuthCookiesOn, setAuthCookiesOn } from '@/modules/auth/cookies';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';


// Admin gets an access token only; any user refresh cookie is deleted so it cannot
// silently restore a user session.
export const handlePost = withHandler(async (req, ctx) => {
  const input = adminLoginSchema.parse(await readJsonBody(req));
  const data = await adminLogin(input);
  return clearAuthCookiesOn(setAuthCookiesOn(success(data, ctx), { access: data.access_token }), ['refresh']);
});
