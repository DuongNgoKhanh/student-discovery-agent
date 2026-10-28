import { describe, expect, it } from 'vitest';
import { apiProxyRewrites } from './api-proxy';

describe('apiProxyRewrites', () => {
  it('proxies API and download to the configured hosted API origin', () => {
    expect(apiProxyRewrites({ NODE_ENV: 'production', API_PROXY_ORIGIN: 'https://sda-api.onrender.com/' })).toEqual([
      { source: '/api/:path*', destination: 'https://sda-api.onrender.com/api/:path*' },
      { source: '/download', destination: 'https://sda-api.onrender.com/download' },
    ]);
  });

  it('keeps production behind the gateway when no proxy origin is configured', () => {
    expect(apiProxyRewrites({ NODE_ENV: 'production' })).toEqual([]);
    expect(apiProxyRewrites({ NODE_ENV: 'production', API_PROXY_ORIGIN: '' })).toEqual([]);
  });

  it('falls back to the local API in development', () => {
    expect(apiProxyRewrites({ NODE_ENV: 'development' })[0]).toEqual(
      { source: '/api/:path*', destination: 'http://127.0.0.1:3001/api/:path*' });
    expect(apiProxyRewrites({ NODE_ENV: 'development', STUDIO_API_ORIGIN: 'http://api:3001' })[1]).toEqual(
      { source: '/download', destination: 'http://api:3001/download' });
  });

  it('rejects a proxy origin that is not an absolute http(s) URL', () => {
    expect(() => apiProxyRewrites({ NODE_ENV: 'production', API_PROXY_ORIGIN: 'sda-api.onrender.com' })).toThrow();
  });
});
