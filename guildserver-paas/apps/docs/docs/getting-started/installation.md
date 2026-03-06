---
sidebar_position: 3
title: Detailed Installation
description: Complete installation guide for GuildServer PaaS covering Docker Compose, manual setup, and development mode.
---

# Detailed Installation

This page covers all supported methods for installing and running GuildServer. Choose the approach that best fits your environment.

## Prerequisites

### Required Software

| Software | Minimum Version | Purpose |
|----------|----------------|---------|
| **Node.js** | 20.0.0 (LTS) | Runtime for API and frontend |
| **pnpm** | 9.0+ | Monorepo package manager (recommended) |
| **npm** | 10.0+ | Alternative package manager |
| **Docker** | 24.0+ | Container runtime for infrastructure and deployed apps |
| **Docker Compose** | v2.0+ | Multi-container orchestration |
| **Git** | 2.x | Source control |

### Infrastructure Services

| Service | Version | Purpose |
|---------|---------|---------|
| **PostgreSQL** | 15+ | Primary database for all platform data |
| **Redis** | 7+ | BullMQ job queues, caching, and pub/sub |
| **Traefik** | v3.x | Reverse proxy with automatic HTTPS |

These services can run via Docker (included in `docker-compose.yml`) or as external managed services.

### Hardware Requirements

For local development:
- 4 GB RAM minimum (8 GB recommended)
- 2 CPU cores minimum
- 10 GB free disk space

For production:
- 8 GB RAM minimum (16 GB recommended)
- 4 CPU cores minimum
- 50 GB SSD storage

---

## Method 1: Docker Compose (Recommended)

This is the fastest way to get the full stack running. Docker Compose starts PostgreSQL, Redis, Traefik, the API server, and the web frontend in one command.

### 1. Clone the Repository

```bash
git clone https://github.com/guildserver/guildserver-paas.git
cd guildserver-paas
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
DATABASE_URL="postgresql://guildserver:password123@postgres:5432/guildserver"
REDIS_URL="redis://redis:6379"
JWT_SECRET="generate-a-secure-random-string-here"
```

:::tip Generating a secure JWT secret
```bash
openssl rand -base64 48
```
:::

### 3. Create the Docker Network

GuildServer uses a shared Docker network so Traefik can route traffic to deployed application containers:

```bash
docker network create guildserver
```

### 4. Start All Services

```bash
docker compose up -d
```

This starts all five services: `postgres`, `redis`, `traefik`, `api`, and `web`.

### 5. Verify Everything is Running

```bash
docker compose ps
```

All services should show `Up (healthy)` status. The endpoints are:

- Frontend: http://localhost:3000
- API: http://localhost:4000
- Traefik Dashboard: http://localhost:8080

### 6. Run Database Migrations

If the API container does not auto-migrate on startup:

```bash
docker compose exec api npm run db:migrate --workspace=@guildserver/database
```

### 7. Seed Initial Data

```bash
docker compose exec api npm run db:seed --workspace=@guildserver/database
```

---

## Method 2: Manual Setup

Use this method when you want to run each component individually, or when you have external PostgreSQL and Redis instances.

### 1. Clone and Install

```bash
git clone https://github.com/guildserver/guildserver-paas.git
cd guildserver-paas
pnpm install
```

### 2. Start Infrastructure (Docker)

If you do not have external PostgreSQL and Redis, start them with Docker:

```bash
docker compose up -d postgres redis traefik
```

### 3. Configure the API

Create the API environment file:

```bash
cat > apps/api/.env << 'EOF'
NODE_ENV=development
DATABASE_URL=postgresql://guildserver:password123@localhost:5433/guildserver
REDIS_URL=redis://localhost:6380
JWT_SECRET=your-development-jwt-secret-key-here
PORT=3001
LOG_LEVEL=debug
FRONTEND_URL=http://localhost:3000
EOF
```

:::info Port Mapping
The Docker Compose file maps PostgreSQL to host port **5433** and Redis to host port **6380** to avoid conflicts with local instances. If you are using external services, use their actual host and port.
:::

### 4. Configure the Frontend

Create the web environment file:

```bash
cat > apps/web/.env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:3001/trpc
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-here
EOF
```

### 5. Run Migrations and Seed

```bash
pnpm run db:migrate
pnpm run db:seed
```

### 6. Start Development Servers

Start both API and web in development mode with hot reloading:

```bash
pnpm run dev
```

Or start them individually:

```bash
# Terminal 1: API server
pnpm --filter @guildserver/api dev

# Terminal 2: Web frontend
pnpm --filter @guildserver/web dev
```

---

## Method 3: Development Script

GuildServer includes a convenience script that automates the manual setup:

```bash
bash scripts/dev.sh
```

This script:

1. Checks that Docker is running.
2. Creates `.env` files if they do not exist.
3. Installs npm dependencies.
4. Starts PostgreSQL and Redis via Docker Compose.
5. Waits for services to be healthy.
6. Runs database migrations.
7. Starts all development servers with Turbo.

---

## Using External Databases

If you have managed PostgreSQL and Redis instances (e.g., AWS RDS, ElastiCache, Supabase), skip the Docker infrastructure services and point the environment variables at your external hosts:

```env
DATABASE_URL="postgresql://user:password@your-rds-host.aws.com:5432/guildserver"
REDIS_URL="redis://:password@your-redis-host.aws.com:6379"
```

Make sure the PostgreSQL instance has a database named `guildserver` created before running migrations.

---

## Verifying the Installation

After setup, run through this checklist:

| Check | Command / URL | Expected Result |
|-------|--------------|-----------------|
| API health | `curl http://localhost:3001/health` | `{"status":"healthy",...}` |
| API docs | http://localhost:3001/api-docs | Swagger UI loads |
| Frontend | http://localhost:3000 | Login page renders |
| Database | `docker compose exec postgres pg_isready` | `accepting connections` |
| Redis | `docker compose exec redis redis-cli ping` | `PONG` |
| Traefik | http://localhost:8080 | Traefik dashboard loads |

---

## Troubleshooting

### Port conflicts

If ports 3000, 3001, 5433, 6380, 80, 443, or 8080 are already in use, either stop the conflicting services or change the port mappings in `docker-compose.yml` and the corresponding `.env` files.

### Docker network errors

If you see errors about the `guildserver` network not existing:

```bash
docker network create guildserver
```

### Migration failures

If migrations fail with connection errors, ensure PostgreSQL is fully healthy before running:

```bash
docker compose exec postgres pg_isready -U guildserver -d guildserver
```

Wait until it reports `accepting connections`, then retry `pnpm run db:migrate`.

### Permission errors on Linux

If Docker commands require `sudo`, add your user to the `docker` group:

```bash
sudo usermod -aG docker $USER
```

Log out and back in for the change to take effect.

## Next Steps

- [Project Structure](./project-structure) — Understand the monorepo layout
- [Configuration](./configuration) — Complete environment variable reference
- [Dashboard Guide](/dashboard/overview) — Learn the web interface
