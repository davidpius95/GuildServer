FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# --- Dependencies stage ---
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/docs/package.json ./apps/docs/

RUN pnpm install --frozen-lockfile --filter @guildserver/docs

# --- Builder stage ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/docs ./apps/docs

RUN pnpm --filter @guildserver/docs build

# --- Runner stage ---
FROM nginx:alpine AS runner

# Copy nginx config
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/apps/docs/build /usr/share/nginx/html/docs

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
