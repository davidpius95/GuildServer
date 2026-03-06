---
title: "Docker Compose Deployment"
sidebar_position: 1
---

# Docker Compose Deployment

GuildServer ships with a `docker-compose.yml` that orchestrates all required services: Traefik (reverse proxy), PostgreSQL (database), Redis (cache and queues), the API server, and the web frontend.

## Services Overview

```
┌─────────────────────────────────────────────────────┐
│                    Docker Compose                     │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Traefik  │  │ Postgres │  │  Redis   │           │
│  │  :80/443  │  │  :5433   │  │  :6380   │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐                          │
│  │   API    │  │   Web    │                          │
│  │  :4000   │  │  :3000   │                          │
│  └──────────┘  └──────────┘                          │
└─────────────────────────────────────────────────────┘
```

| Service | Image | Ports | Purpose |
|---|---|---|---|
| `traefik` | `traefik:v3.6` | 80, 443, 8080 | Reverse proxy, SSL termination, container routing |
| `postgres` | `postgres:15-alpine` | 5433 (host) -> 5432 | Primary database |
| `redis` | `redis:7-alpine` | 6380 (host) -> 6379 | Cache, BullMQ job queues |
| `api` | Custom build | 4000 | Backend API (Express + tRPC) |
| `web` | Custom build | 3000 | Frontend (Next.js 15) |

## Production Configuration

The default `docker-compose.yml` is configured for development. For production, you need to make several changes.

### 1. Set Real Secrets

:::danger
Never deploy with the default secrets. Change these immediately:
:::

```yaml
# PostgreSQL
environment:
  POSTGRES_PASSWORD: <generate-a-strong-password>

# API
environment:
  JWT_SECRET: <random-32-char-string>
  DATABASE_URL: postgresql://guildserver:<your-pg-password>@postgres:5432/guildserver
```

### 2. Remove External Port Exposure

In production, only Traefik needs external ports. Remove the `ports` mapping from PostgreSQL and Redis:

```yaml
postgres:
  # Remove this:
  # ports:
  #   - "5433:5432"

redis:
  # Remove this:
  # ports:
  #   - "6380:6379"
```

### 3. Configure SSL

Set a real email for Let's Encrypt certificate notifications:

```yaml
traefik:
  command:
    - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
```

Set `ACME_EMAIL` in your `.env` file or shell environment.

### 4. Set Your Domain

```bash
# .env
BASE_DOMAIN=yourdomain.com
```

Applications will be accessible at `<app-name>.yourdomain.com`.

### 5. Production Environment

```yaml
api:
  environment:
    NODE_ENV: production
web:
  environment:
    NODE_ENV: production
    NEXT_PUBLIC_API_URL: https://api.yourdomain.com/trpc
```

## Volume Persistence

Three named volumes ensure data survives container restarts:

| Volume | Service | Mount Point | Purpose |
|---|---|---|---|
| `postgres_data` | postgres | `/var/lib/postgresql/data` | Database files |
| `redis_data` | redis | `/data` | Redis RDB snapshots |
| `./data/letsencrypt` | traefik | `/letsencrypt` | SSL certificates (acme.json) |

:::warning
Back up the `postgres_data` volume regularly. See the [Backups](./backups.md) guide for instructions.
:::

## Networks

The compose file defines two networks:

- **`guildserver-network`** (default) -- internal communication between compose services
- **`guildserver`** (external) -- shared with deployed application containers so Traefik can route to them

The `guildserver` network must exist before starting compose. The API server creates it automatically via `ensureNetwork()`, or you can create it manually:

```bash
docker network create guildserver
```

## Health Checks

PostgreSQL and Redis include health checks that the API service depends on:

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U guildserver -d guildserver"]
    interval: 10s
    timeout: 5s
    retries: 5

redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

The API container waits for both services to be healthy before starting:

```yaml
api:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

## Starting Services

```bash
# Start all services in the background
docker compose up -d

# Watch logs
docker compose logs -f

# Watch a specific service
docker compose logs -f api
```

## Stopping Services

```bash
# Stop all services (preserves volumes)
docker compose down

# Stop and remove volumes (DESTROYS DATA)
docker compose down -v
```

## Updating

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose up -d --build
```

:::tip
For zero-downtime updates, deploy a new version alongside the old one and switch Traefik routing. This requires a more advanced setup with rolling deployments.
:::

## Checking Status

```bash
# View running containers
docker compose ps

# Check resource usage
docker stats

# View API health
curl http://localhost:4000/health
```

## Full Production docker-compose.yml Example

```yaml
services:
  traefik:
    image: traefik:v3.6
    container_name: guildserver-traefik
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=guildserver"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--log.level=WARN"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./data/letsencrypt:/letsencrypt
    networks:
      - default
      - guildserver
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    container_name: guildserver-postgres
    environment:
      POSTGRES_DB: guildserver
      POSTGRES_USER: guildserver
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U guildserver"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: guildserver-redis
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: guildserver-api
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://guildserver:${POSTGRES_PASSWORD}@postgres:5432/guildserver
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      PORT: 4000
      ACME_EMAIL: ${ACME_EMAIL}
      BASE_DOMAIN: ${BASE_DOMAIN}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: guildserver-web
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: https://api.${BASE_DOMAIN}/trpc
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    name: guildserver-network
  guildserver:
    external: true
    name: guildserver
```
