import type { NextConfig } from 'next';
import { apiProxyRewrites } from './src/config/api-proxy';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Development and gateway-less hosts (API_PROXY_ORIGIN); otherwise the gateway routes UI/API.
  async rewrites() {
    return apiProxyRewrites(process.env);
  },
};

export default nextConfig;
