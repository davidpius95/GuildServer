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

# NEXT_PUBLIC_* vars must be available at build time for Next.js to inline them
ARG NEXT_PUBLIC_API_BASE_URL=https://guild-technologies.com
ARG NEXT_PUBLIC_API_URL=/trpc
ARG API_URL=http://api:4000
ARG NEXTAUTH_URL=https://guild-technologies.com
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_URL=$API_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules

COPY package.json turbo.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database ./packages/database
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build database package (needed as dependency), then materialize the web
# package workspace before the Next.js build so local package binaries resolve
# the same way they do in development.
RUN mkdir -p /app/apps/web/public && \
    pnpm exec tsc -p packages/database/tsconfig.json && \
    cp pnpm-lock.yaml apps/web/pnpm-lock.yaml && \
    pnpm --dir apps/web install --frozen-lockfile && \
    rm apps/web/pnpm-lock.yaml && \
    pnpm --dir apps/web build

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
