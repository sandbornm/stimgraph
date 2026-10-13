import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, resolve(process.cwd(), 'lib/local-platform.ts')));
    return config;
  },
};

export default nextConfig;
