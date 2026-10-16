import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Legacy root download link; not a BFF, just an alias to the Product route.
  async rewrites() {
    return [{ source: '/download', destination: '/api/v1/download' }];
  },
};

export default nextConfig;
