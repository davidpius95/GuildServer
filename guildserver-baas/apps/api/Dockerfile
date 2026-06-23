FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY packages/database/package.json  ./packages/database/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY apps/api/package.json           ./apps/api/
# Install build tools for native addons (ssh2, cpu-features)
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
# Build internal packages first, then the api
RUN pnpm --filter @guildserver/baas-db build
RUN pnpm --filter @guildserver/baas-scheduler build
RUN pnpm --filter @guildserver/baas-api build

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY --from=builder /app/node_modules        ./node_modules
COPY --from=builder /app/packages            ./packages
COPY --from=builder /app/apps/api/dist       ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4001
CMD ["node", "dist/index.js"]
