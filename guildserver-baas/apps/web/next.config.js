/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/baas",
  output: "standalone",
  transpilePackages: ["@guildserver/baas-api"],
  env: {
    NEXT_PUBLIC_BAAS_API_URL:  process.env.NEXT_PUBLIC_BAAS_API_URL  || "http://localhost:4001",
    NEXT_PUBLIC_PAAS_WEB_URL:  process.env.NEXT_PUBLIC_PAAS_WEB_URL  || "http://localhost:3000",
  },
}
module.exports = nextConfig;

