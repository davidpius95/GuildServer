---
title: "Docker Compose Deployment"
sidebar_position: 1
---

# Docker Compose Deployment

GuildServer ships with a development `docker-compose.yml` and a production `docker-compose.prod.yml`. The production file runs Traefik, PostgreSQL, Redis, the API, the web frontend, the documentation site, Prometheus, Grafana, cAdvisor, node-exporter, postgres-exporter, redis-exporter, Loki, and Promtail.

## Services Overview

```
┌─────────────────────────────────────────────────────┐
│                    Docker Compose                     │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Traefik  │  │ Postgres │  │  Redis   │           │
│  │  :80/443  │  │  :5432   │  │ internal │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   API    │  │   Web    │  │   Docs   │           │
│  │  :4000   │  │  :3000   │  │   :80    │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │Prometheus│  │ Grafana  │  │ cAdvisor │           │
│  │ internal │  │  :3000   │  │  :8081   │           │
│  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────┘
```

| Service | Image | Ports | Purpose |
|---|---|---|---|
| `traefik` | `traefik:v3.6` | 80, 443, 8080 | Reverse proxy, SSL termination, container routing |
| `postgres` | `postgres:15-alpine` | dev: 5433 host; prod: 127.0.0.1:5432 host | Primary database |
| `redis` | `redis:7-alpine` | dev: 6380 host; prod: internal | Cache, BullMQ job queues |
| `api` | Custom build | 4000 | Backend API (Express + tRPC) |
| `web` | Custom build | 3000 | Frontend (Next.js 15) |
| `docs` | Custom build | 80 | Docusaurus documentation served at `/docs` |
| `prometheus` | `prom/prometheus` | internal | Metrics storage and alert rules |
| `grafana` | `grafana/grafana` | 3000 internal | Dashboards at `grafana.<BASE_DOMAIN>` |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | 8081 internal | Container metrics and `/healthz` health endpoint |
| `node-exporter` | `prom/node-exporter` | internal | Host metrics |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter` | internal | PostgreSQL metrics |
| `redis-exporter` | `oliver006/redis_exporter` | internal | Redis metrics |
| `loki` | `grafana/loki` | internal | Log storage |
| `promtail` | `grafana/promtail` | internal | Docker log collection |

## Production Configuration

The default `docker-compose.yml` is configured for development. Use `docker-compose.prod.yml` for production.

```bash
cp .env.example .env.production
# edit .env.production with real secrets and BASE_DOMAIN
docker network create guildserver
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Keep `.env.production` outside Git. The compose file supports safe defaults for local testing, but production must provide strong secrets.

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

### 2. Limit External Port Exposure

In production, only Traefik needs public ports. PostgreSQL may be bound to loopback for SSH-tunneled desktop access, but it must not listen publicly. Redis should remain internal:

```yaml
postgres:
  ports:
    - "127.0.0.1:5432:5432"

redis:
  # no public ports
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

### 6. Monitoring Services

The production compose includes the monitoring stack. Two details matter operationally:

- cAdvisor runs with `-port=8081`, so its Docker health check must probe `http://127.0.0.1:8081/healthz`.
- Prometheus should scrape cAdvisor on `cadvisor:8081`, not `cadvisor:8080`.

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

cAdvisor also has an explicit health check because the upstream image defaults can assume port `8080`, while this deployment serves cAdvisor on `8081`:

```yaml
cadvisor:
  command:
    - "-port=8081"
  healthcheck:
    test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:8081/healthz"]
```

## Starting Services

```bash
# Development
docker compose up -d

# Production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# Watch production logs
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f

# Watch a specific production service
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

For local development only:

```bash
docker compose logs -f
docker compose logs -f api
```

## Stopping Services

```bash
# Stop development services (preserves volumes)
docker compose down

# Stop production services (preserves volumes)
docker compose --env-file .env.production -f docker-compose.prod.yml down

# Stop and remove development volumes (DESTROYS DATA)
docker compose down -v
```

## Updating

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

:::tip
For zero-downtime updates, deploy a new version alongside the old one and switch Traefik routing. This requires a more advanced setup with rolling deployments.
:::

## Checking Status

```bash
# View production containers
docker compose --env-file .env.production -f docker-compose.prod.yml ps

# Check resource usage
docker stats

# View API health
curl http://localhost:4000/health

# View cAdvisor health from inside its container
docker exec guildserver-cadvisor wget -q -O - http://127.0.0.1:8081/healthz
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
