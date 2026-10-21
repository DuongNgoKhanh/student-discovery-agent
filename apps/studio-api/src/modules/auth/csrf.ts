import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
/** Browser POSTs must prove same-origin. Header absence is not evidence of same-origin. */
export function requireSameOrigin(req: Request): void {
  const configured = getAuthEnv().PRODUCT_BASE_URL;
  const expected = new URL(configured ?? req.url).origin;
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site' ||
      (origin ? origin !== expected : site !== 'same-origin')) {
    throw new ProductError(403, 'AUTH_CSRF_REJECTED', 'Same-origin request required');
  }
}
