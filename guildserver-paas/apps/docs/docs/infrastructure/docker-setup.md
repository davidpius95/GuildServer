---
title: "Docker Setup"
sidebar_position: 1
---

# Docker Setup

GuildServer PaaS runs as a set of Docker containers orchestrated by Docker Compose. This page provides a complete walkthrough of the `docker-compose.yml` configuration, each service, and the commands you need to manage the stack.

## Prerequisites

Before starting, ensure you have the following installed:

- **Docker Engine** v24+ (or Docker Desktop)
- **Docker Compose** v2+ (bundled with Docker Desktop)
- At least **4 GB of available RAM** for all services

## Architecture Overview

The platform consists of five core services:

| Service    | Image               | Host Port     | Container Port | Purpose                        |
|------------|---------------------|---------------|----------------|--------------------------------|
| Traefik    | `traefik:v3.6`      | 80, 443, 8080 | 80, 443, 8080 | Reverse proxy, SSL termination |
| PostgreSQL | `postgres:15-alpine`| 5433          | 5432           | Primary database               |
| Redis      | `redis:7-alpine`    | 6380          | 6379           | Cache and queue broker         |
| API        | Custom (Dockerfile) | 4000          | 4000           | Backend tRPC API server        |
| Web        | Custom (Dockerfile) | 3000          | 3000           | Next.js frontend               |

## Full docker-compose.yml Walkthrough

### Traefik Reverse Proxy

Traefik is the entry point for all HTTP/HTTPS traffic. It auto-discovers Docker containers and routes traffic based on hostname labels.

```yaml
services:
  traefik:
    image: traefik:v3.6
    container_name: guildserver-traefik
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=guildserver"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL:-admin@guildserver.com}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--log.level=INFO"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./data/letsencrypt:/letsencrypt
    networks:
      - default
      - guildserver
    restart: unless-stopped
```

Key configuration flags:

- **`--providers.docker=true`** -- Enables Docker provider so Traefik reads container labels for routing rules.
- **`--providers.docker.exposedbydefault=false`** -- Containers must explicitly opt in with `traefik.enable=true`.
- **`--providers.docker.network=guildserver`** -- Traefik routes traffic through the `guildserver` network only.
- **`--entrypoints.web.address=:80`** -- HTTP entry point.
- **`--entrypoints.websecure.address=:443`** -- HTTPS entry point.
- **`--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web`** -- Uses HTTP-01 challenge for Let's Encrypt certificates.

:::info
The ACME email defaults to `admin@guildserver.com` but can be overridden with the `ACME_EMAIL` environment variable.
:::

The Docker socket is mounted read-only (`/var/run/docker.sock:/var/run/docker.sock:ro`) so Traefik can monitor container events. The `data/letsencrypt` directory stores SSL certificates persistently.

### PostgreSQL Database

PostgreSQL 15 (Alpine variant) serves as the primary relational database for all platform data.

```yaml
  postgres:
    image: postgres:15-alpine
    container_name: guildserver-postgres
    environment:
      POSTGRES_DB: guildserver
      POSTGRES_USER: guildserver
      POSTGRES_PASSWORD: password123
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./packages/database/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U guildserver -d guildserver"]
      interval: 10s
      timeout: 5s
      retries: 5
```

:::danger
The default `POSTGRES_PASSWORD` is `password123`. **Change this immediately** for any non-local deployment. Use a strong, random password and set it via environment variables or a `.env` file.
:::

- **Port 5433** is exposed on the host (mapped from container port 5432) to avoid conflicts with any local PostgreSQL installation.
- The `postgres_data` named volume ensures data persists across container restarts.
- Database migrations from `packages/database/migrations` are automatically applied on first startup via the `docker-entrypoint-initdb.d` mount.
- The health check runs `pg_isready` every 10 seconds and allows up to 5 retries before the service is considered unhealthy.

### Redis Cache

Redis 7 (Alpine) is used for caching, session storage, and as a queue broker for BullMQ job processing.

```yaml
  redis:
    image: redis:7-alpine
    container_name: guildserver-redis
    ports:
      - "6380:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
```

- **Port 6380** is exposed on the host (mapped from 6379) to avoid conflicts with local Redis.
- The `redis_data` volume persists cached data and queued jobs.
- Health check uses `redis-cli ping` to confirm the server is responsive.

### Backend API

The API service runs the Node.js/Express tRPC backend.

```yaml
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: guildserver-api
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://guildserver:password123@postgres:5432/guildserver
      REDIS_URL: redis://redis:6379
      JWT_SECRET: your-jwt-secret-key-here
      PORT: 4000
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./apps/api:/app/apps/api
      - ./packages:/app/packages
      - /app/node_modules
      - /app/apps/api/node_modules
    command: npm run dev --workspace=@guildserver/api
```

Key details:

- The API **waits for PostgreSQL and Redis** to be healthy before starting (`depends_on` with `condition: service_healthy`).
- **`DATABASE_URL`** references `postgres` (the Docker service name) as the hostname -- Docker DNS resolves this within the network.
- Development volumes mount source code for hot-reloading while keeping `node_modules` inside the container via anonymous volumes.
- The command uses workspace syntax to run only the API package.

:::warning
Replace `JWT_SECRET` with a strong, random secret in production. A weak secret compromises all authentication tokens. Generate one with `openssl rand -hex 32`.
:::

### Frontend Web App

The web service runs the Next.js frontend dashboard.

```yaml
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: guildserver-web
    environment:
      NODE_ENV: development
      NEXT_PUBLIC_API_URL: http://localhost:4000/trpc
      NEXTAUTH_URL: http://localhost:3000
      NEXTAUTH_SECRET: your-nextauth-secret-here
    ports:
      - "3000:3000"
    depends_on:
      - api
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages:/app/packages
      - /app/node_modules
      - /app/apps/web/node_modules
    command: npm run dev --workspace=@guildserver/web
```

- The web app depends on the API service being available.
- `NEXT_PUBLIC_API_URL` is a client-side environment variable pointing to the tRPC endpoint.
- `NEXTAUTH_URL` and `NEXTAUTH_SECRET` are used by the frontend session management layer.

## Volumes

```yaml
volumes:
  postgres_data:
  redis_data:
```

Two named volumes provide persistent storage:

| Volume          | Mount Point in Container         | Purpose                              |
|-----------------|----------------------------------|--------------------------------------|
| `postgres_data` | `/var/lib/postgresql/data`       | PostgreSQL database files            |
| `redis_data`    | `/data`                          | Redis persistence (RDB/AOF)          |

Additionally, `./data/letsencrypt` is a bind mount for Traefik's ACME certificate storage.

## Networks

```yaml
networks:
  default:
    name: guildserver-network
  guildserver:
    external: true
    name: guildserver
```

GuildServer uses two Docker networks:

- **`guildserver-network`** (default) -- Internal network for the core services (Traefik, Postgres, Redis, API, Web). Created automatically by Docker Compose.
- **`guildserver`** (external) -- A pre-existing bridge network shared with deployed application containers. Traefik routes traffic to these containers through this network.

:::tip
You must create the external network before running `docker compose up`:

```bash
docker network create guildserver
```

This only needs to be done once. The network persists across restarts.
:::

## Docker Compose Commands

### Start all services

```bash
# Create the external network (first time only)
docker network create guildserver

# Start in foreground (see all logs)
docker compose up

# Start in background (detached)
docker compose up -d
```

### Stop all services

```bash
# Stop and remove containers (preserves volumes)
docker compose down

# Stop, remove containers AND delete volumes (destroys all data)
docker compose down -v
```

### View logs

```bash
# All services, follow output
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f postgres
docker compose logs -f traefik

# Last 100 lines of a service
docker compose logs --tail=100 api
```

### Restart a single service

```bash
docker compose restart api
docker compose restart web
docker compose restart traefik
```

### Rebuild after code changes

```bash
# Rebuild and restart all services
docker compose up -d --build

# Rebuild a specific service only
docker compose up -d --build api
```

### Check service health and status

```bash
# Show running containers with ports and status
docker compose ps

# Show resource usage
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### Access a service shell

```bash
# Open a shell in the API container
docker compose exec api sh

# Open a psql shell in PostgreSQL
docker compose exec postgres psql -U guildserver -d guildserver

# Open a redis-cli shell
docker compose exec redis redis-cli
```

## Environment Variables Reference

| Variable             | Service  | Default                                      | Description                     |
|----------------------|----------|----------------------------------------------|---------------------------------|
| `ACME_EMAIL`         | Traefik  | `admin@guildserver.com`                      | Let's Encrypt contact email     |
| `POSTGRES_DB`        | Postgres | `guildserver`                                | Database name                   |
| `POSTGRES_USER`      | Postgres | `guildserver`                                | Database user                   |
| `POSTGRES_PASSWORD`  | Postgres | `password123`                                | Database password               |
| `DATABASE_URL`       | API      | `postgresql://guildserver:password123@postgres:5432/guildserver` | Full connection string |
| `REDIS_URL`          | API      | `redis://redis:6379`                         | Redis connection string         |
| `JWT_SECRET`         | API      | `your-jwt-secret-key-here`                   | JWT signing secret              |
| `PORT`               | API      | `4000`                                       | API server port                 |
| `NEXT_PUBLIC_API_URL`| Web      | `http://localhost:4000/trpc`                 | tRPC endpoint URL               |
| `NEXTAUTH_URL`       | Web      | `http://localhost:3000`                      | Frontend base URL               |
| `NEXTAUTH_SECRET`    | Web      | `your-nextauth-secret-here`                  | Session encryption secret       |

## Next Steps

- Learn how [Traefik routes traffic](./traefik.md) to deployed applications
- Understand the [networking model](./networking.md) between containers
- Configure [resource limits](./resource-limits.md) for your applications
