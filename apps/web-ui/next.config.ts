import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Local development transport only. Production routes UI/API through the gateway.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    const api = (process.env.STUDIO_API_ORIGIN ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/download', destination: `${api}/download` },
    ];
  },
};

export default nextConfig;
