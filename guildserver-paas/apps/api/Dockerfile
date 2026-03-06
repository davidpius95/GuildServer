FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# --- Dependencies stage ---
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --frozen-lockfile

# --- Builder stage ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

COPY package.json turbo.json pnpm-workspace.yaml ./
COPY packages/database ./packages/database
COPY apps/api ./apps/api

# Build database package first, then api
RUN pnpm --filter @guildserver/database build && \
    pnpm --filter @guildserver/api build

# --- Production dependencies ---
FROM base AS prod-deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --frozen-lockfile --prod

# --- Runner stage ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/database/node_modules ./packages/database/node_modules

# Copy built output
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/database/drizzle ./packages/database/drizzle
COPY --from=builder /app/packages/database/src/migrate.ts ./packages/database/src/migrate.ts

# Copy root package.json and workspace config for module resolution
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]
