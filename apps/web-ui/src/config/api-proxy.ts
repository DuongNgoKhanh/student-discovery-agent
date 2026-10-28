type ProxyEnv = { NODE_ENV?: string; API_PROXY_ORIGIN?: string; STUDIO_API_ORIGIN?: string };
type Rewrite = { source: string; destination: string };

/**
 * Same-origin API transport for hosts without the nginx gateway (Vercel): API_PROXY_ORIGIN is read at build time.
 * Unset in production keeps routing to the gateway; development falls back to the local API.
 */
export function apiProxyRewrites(env: ProxyEnv): Rewrite[] {
  let origin = env.API_PROXY_ORIGIN;
  if (!origin) {
    if (env.NODE_ENV !== 'development') return [];
    origin = env.STUDIO_API_ORIGIN ?? 'http://127.0.0.1:3001';
  }
  const url = new URL(origin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('API_PROXY_ORIGIN must be an http(s) URL');
  const api = url.origin;
  return [
    { source: '/api/:path*', destination: `${api}/api/:path*` },
    { source: '/download', destination: `${api}/download` },
  ];
}
