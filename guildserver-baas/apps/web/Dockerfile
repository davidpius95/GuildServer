FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database/package.json  ./packages/database/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY apps/api/package.json           ./apps/api/
COPY apps/web/package.json           ./apps/web/
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/

ARG NEXT_PUBLIC_BAAS_API_URL
ARG NEXT_PUBLIC_PAAS_WEB_URL

ENV NEXT_PUBLIC_BAAS_API_URL=${NEXT_PUBLIC_BAAS_API_URL}
ENV NEXT_PUBLIC_PAAS_WEB_URL=${NEXT_PUBLIC_PAAS_WEB_URL}

RUN pnpm --filter @guildserver/baas-db build
RUN pnpm --filter @guildserver/baas-api build
RUN pnpm --filter @guildserver/baas-web build

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public         ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static     ./apps/web/.next/static

USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/web/server.js"]
