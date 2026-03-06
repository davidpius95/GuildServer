FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# --- Dependencies stage ---
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --frozen-lockfile

# --- Builder stage ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

COPY package.json turbo.json pnpm-workspace.yaml ./
COPY packages/database ./packages/database
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build database package (needed as dependency), then web
# API source is copied for type imports (import type { AppRouter })
# but not built — Next.js resolves types from source with ignoreBuildErrors
RUN pnpm --filter @guildserver/database build && \
    pnpm --filter @guildserver/web build

# --- Runner stage ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy Next.js standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
