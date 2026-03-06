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

# Build only the database package (API runs via tsx from source)
RUN pnpm --filter @guildserver/database build

# --- Runner stage ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy all node_modules (tsx needs devDependencies)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

# Copy source and built database
COPY --from=builder /app/apps/api/src ./apps/api/src
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/tsconfig.json ./apps/api/
COPY --from=builder /app/packages/database ./packages/database

# Copy root config for workspace resolution
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

EXPOSE 4000

CMD ["npx", "tsx", "apps/api/src/index.ts"]
