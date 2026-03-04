---
title: "Development Setup"
sidebar_position: 1
---

# Development Setup

This guide walks through setting up a local development environment for contributing to GuildServer.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | >= 20.0.0 | Runtime |
| pnpm | Latest | Package manager (workspace support) |
| Docker | Latest | Container runtime |
| Docker Compose | v2+ | Service orchestration |
| Git | Latest | Version control |

## Step 1: Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/guildserver-paas.git
cd guildserver-paas
```

## Step 2: Install Dependencies

GuildServer uses **pnpm workspaces** with **Turborepo** for monorepo management:

```bash
pnpm install
```

This installs dependencies for all workspaces:
- `apps/api` -- Backend API server
- `apps/web` -- Frontend web application
- `apps/docs` -- Documentation site
- `packages/database` -- Drizzle ORM schema and migrations
- `packages/cli` -- Command-line interface

## Step 3: Start Infrastructure

Start only the infrastructure services (database, cache, reverse proxy):

```bash
docker compose up -d postgres redis traefik
```

Wait for health checks to pass:

```bash
docker compose ps
```

You should see `postgres` and `redis` in a healthy state.

:::info
The default `docker-compose.yml` maps PostgreSQL to port **5433** and Redis to port **6380** on the host to avoid conflicts with local installations.
:::

## Step 4: Configure Environment

```bash
cp .env.example .env
```

The default values work out of the box for local development. Key settings:

```bash
DATABASE_URL="postgresql://guildserver:password123@localhost:5433/guildserver"
REDIS_URL="redis://localhost:6380"
JWT_SECRET="your-jwt-secret-key-here"
NODE_ENV="development"
```

## Step 5: Run Database Migrations

```bash
pnpm run db:migrate
```

This creates all tables defined in `packages/database/src/schema/index.ts`.

## Step 6: Seed Initial Data

```bash
pnpm run db:seed
```

The seed script creates:
- A default admin user
- A default organization
- Billing plans (Hobby, Pro, Enterprise)

## Step 7: Create the Docker Network

The shared network is needed for Traefik to route to deployed containers:

```bash
docker network create guildserver
```

## Step 8: Start Development Servers

```bash
pnpm run dev
```

This starts all development servers via Turborepo:

| Service | URL | Description |
|---|---|---|
| Web Frontend | http://localhost:3000 | Next.js 15 dev server with hot reload |
| API Server | http://localhost:4000 | Express + tRPC with auto-restart |
| Traefik Dashboard | http://localhost:8080 | Reverse proxy admin UI |

## Step 9: Verify

```bash
# API health check
curl http://localhost:4000/health

# Open the frontend
open http://localhost:3000
```

Log in with the credentials created by the seed script.

## Step 10: Run Tests

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Type checking
pnpm run typecheck

# Linting
pnpm run lint
```

## Useful Commands

| Command | Description |
|---|---|
| `pnpm run dev` | Start all dev servers |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run typecheck` | TypeScript type checking |
| `pnpm run lint` | Run ESLint |
| `pnpm run lint:fix` | Auto-fix lint errors |
| `pnpm run format` | Format code with Prettier |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm run db:seed` | Seed initial data |
| `pnpm run db:studio` | Open Drizzle Studio (database GUI) |
| `pnpm run db:generate` | Generate migration from schema changes |
| `pnpm run clean` | Remove all build artifacts and node_modules |

## Project Structure

```
guildserver-paas/
├── apps/
│   ├── api/                 # Backend API (Express + tRPC)
│   │   ├── src/
│   │   │   ├── routers/     # tRPC route handlers
│   │   │   ├── services/    # Business logic
│   │   │   ├── queues/      # BullMQ job processing
│   │   │   ├── websocket/   # WebSocket server
│   │   │   └── utils/       # Shared utilities
│   │   └── Dockerfile
│   ├── web/                 # Frontend (Next.js 15)
│   │   ├── src/
│   │   │   ├── app/         # App Router pages
│   │   │   ├── components/  # React components
│   │   │   └── lib/         # Client utilities
│   │   └── Dockerfile
│   └── docs/                # Documentation (Docusaurus)
├── packages/
│   ├── database/            # Drizzle ORM schema
│   │   ├── src/schema/      # Table definitions
│   │   └── migrations/      # SQL migration files
│   └── cli/                 # CLI tool
│       └── src/commands/    # CLI command implementations
├── docker-compose.yml       # Service orchestration
├── .env.example             # Environment template
├── turbo.json               # Turborepo configuration
└── package.json             # Root workspace config
```

## Troubleshooting

### Port conflicts

If ports 3000, 4000, 5433, or 6380 are already in use:

```bash
# Check what is using a port
lsof -i :3000
# or on Windows
netstat -ano | findstr :3000
```

### Database connection errors

Verify PostgreSQL is running and healthy:

```bash
docker compose ps postgres
docker compose logs postgres
```

### Redis connection errors

The GuildServer API connects to Redis on port **6380** (not the default 6379):

```bash
REDIS_URL="redis://localhost:6380"
```

### Hot reload not working

For the web frontend, ensure you are running Next.js dev mode (not production build). For the API, the `tsx` watcher should auto-restart on file changes.

See the [Architecture](./architecture.md) page for a deeper dive into how the system is structured.
