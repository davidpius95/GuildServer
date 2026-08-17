const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  compress: true,
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: 'guild-technologies.com' },
    ],
  },
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'https://guild-technologies.com',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    API_URL: process.env.API_URL || 'https://guild-technologies.com',
  },
  transpilePackages: ['@guildserver/database'],
  typescript: {
    // trpc-provider.tsx imports AppRouter directly from API source, causing tsc to
    // transitively check all API files through the web's tsconfig.
    // Fix: build the API first and consume its compiled types, or move AppRouter to
    // a shared @guildserver/types package. Until then, run `pnpm typecheck` separately.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Hashed build assets: safe to cache forever, the filename changes on
        // every build.
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Everything that is NOT a hashed asset — i.e. the HTML documents.
        // Next.js otherwise sends `s-maxage=31536000` on statically prerendered
        // pages, which tells shared caches to keep the HTML for a year. That
        // HTML references build-hashed chunk filenames, so after any redeploy a
        // cached copy points at chunks that no longer exist: every script 404s
        // and the page renders blank. Must stay uncached so HTML and chunks are
        // always from the same build.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ]
  },
  async rewrites() {
    const apiUrl = process.env.API_URL || 'https://guild-technologies.com'
    return [
      {
        source: '/trpc/:path*',
        destination: `${apiUrl}/trpc/:path*`,
      },
      {
        source: '/webhooks/:path*',
        destination: `${apiUrl}/webhooks/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
