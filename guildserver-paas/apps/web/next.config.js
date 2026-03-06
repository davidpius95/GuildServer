/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['localhost'],
  },
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    API_URL: process.env.API_URL || 'http://localhost:4000',
  },
  transpilePackages: ['@guildserver/database'],
  async rewrites() {
    return [
      {
        source: '/trpc/:path*',
        destination: 'http://localhost:4000/trpc/:path*',
      },
      {
        source: '/webhooks/:path*',
        destination: 'http://localhost:4000/webhooks/:path*',
      },
    ]
  },
}

module.exports = nextConfig
