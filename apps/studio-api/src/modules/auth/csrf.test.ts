import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requireSameOrigin } from './csrf';
beforeEach(() => { vi.stubEnv('SECRET_KEY','csrf-test'); vi.stubEnv('PRODUCT_BASE_URL','https://study.example.test'); });
afterEach(() => vi.unstubAllEnvs());
it('uses configured external HTTPS origin behind the HTTP gateway transport', () => {
 const req = new Request('http://studio-api:3001/api/v1/auth/refresh', {headers:{origin:'https://study.example.test'}});
 expect(() => requireSameOrigin(req)).not.toThrow();
});
it('ignores forged forwarded headers when enforcing the configured origin', () => {
 const req = new Request('http://studio-api:3001/api/v1/auth/refresh', {headers:{origin:'https://attacker.test','x-forwarded-host':'attacker.test','x-forwarded-proto':'https'}});
 expect(() => requireSameOrigin(req)).toThrow(expect.objectContaining({code:'AUTH_CSRF_REJECTED'}));
});
