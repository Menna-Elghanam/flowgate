import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // The browser calls /api/* on the web app's own origin; Next forwards it to the API.
  // Same origin means the session cookie needs no CORS dance for normal requests.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  // Linting runs once for the whole monorepo (`pnpm lint`), not again inside `next build`.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
