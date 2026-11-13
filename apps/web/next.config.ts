import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // The browser calls /api/* on the web app's own origin; Next forwards it to the API.
  // Same origin means the session cookie needs no CORS dance for normal requests.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  // The API sets these with helmet; the pages come from Next, so they need their own.
  // No framing stops clickjacking (a hidden Flowgate page under a fake "Approve" button).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  poweredByHeader: false,
  // Linting runs once for the whole monorepo (`pnpm lint`), not again inside `next build`.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
