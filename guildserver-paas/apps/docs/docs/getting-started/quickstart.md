---
sidebar_position: 2
title: 5-Minute Quickstart
description: Get GuildServer running locally in under five minutes with this step-by-step guide.
---

# 5-Minute Quickstart

This guide walks you through getting GuildServer running on your local machine from scratch. By the end, you will have the full platform operational: frontend dashboard, API server, PostgreSQL, Redis, and Traefik.

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Minimum Version | Check Command |
|------|----------------|---------------|
| **Node.js** | 20.0.0 (LTS) | `node --version` |
| **pnpm** (or npm) | 9.0+ (npm 10.0+) | `pnpm --version` |
| **Docker** | 24.0+ | `docker --version` |
| **Docker Compose** | v2.0+ | `docker compose version` |
| **Git** | 2.x | `git --version` |

:::tip
pnpm is the recommended package manager for GuildServer. Install it with `npm install -g pnpm` if you do not have it.
:::

## Step 1: Clone the Repository

```bash
git clone https://github.com/guildserver/guildserver-paas.git
cd guildserver-paas
```

## Step 2: Install Dependencies

```bash
pnpm install
```

This installs all dependencies across the monorepo workspaces (`apps/api`, `apps/web`, `packages/database`, and `packages/cli`).

## Step 3: Start Infrastructure Services

Start PostgreSQL, Redis, and Traefik using Docker Compose:

```bash
docker compose up -d postgres redis traefik
```

Wait a few seconds for the services to become healthy. You can verify with:

```bash
docker compose ps
```

You should see all three services in a `running` state with healthy health checks.

## Step 4: Configure Environment Variables

Copy the example environment file and adjust if needed:

```bash
cp .env.example .env
```

The defaults are configured for local development. The critical variables are already set:

```env
DATABASE_URL="postgresql://guildserver:password123@localhost:5433/guildserver"
REDIS_URL="redis://localhost:6380"
JWT_SECRET="your-jwt-secret-here"
```

:::warning
The default Docker Compose maps PostgreSQL to port **5433** and Redis to port **6380** on the host to avoid conflicts with any local instances you may already be running.
:::

## Step 5: Set Up the Database

Run database migrations to create all tables:

```bash
pnpm run db:migrate
```

Then seed the database with initial data (admin user, plans, sample organization):

```bash
pnpm run db:seed
```

## Step 6: Start Development Servers

Launch both the API server and the web dashboard simultaneously:

```bash
pnpm run dev
```

Turbo will start both `@guildserver/api` and `@guildserver/web` in parallel with hot reloading.

## Step 7: Open the Dashboard

Once the servers are running, open your browser and navigate to:

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | [http://localhost:3000](http://localhost:3000) | Next.js dashboard |
| **API** | [http://localhost:3001](http://localhost:3001) | Express + tRPC API |
| **API Docs** | [http://localhost:3001/api-docs](http://localhost:3001/api-docs) | Swagger documentation |
| **Health Check** | [http://localhost:3001/health](http://localhost:3001/health) | API health endpoint |
| **Traefik Dashboard** | [http://localhost:8080](http://localhost:8080) | Traefik proxy admin panel |

## Step 8: Log In

Use the seeded admin account to log in:

| Field | Value |
|-------|-------|
| **Email** | `admin@guildserver.com` |
| **Password** | `password123` |

:::warning
Change the default credentials immediately in any non-development environment. The seed user is intended only for local development.
:::

## Step 9: Deploy Your First Application

1. From the dashboard, click **New Application**.
2. Give it a name (e.g., `my-first-app`).
3. Select a source type:
   - **Git Repository** — paste a GitHub URL and select a branch.
   - **Docker Image** — enter an image name like `nginx:latest`.
4. Configure the container port (e.g., `80` for nginx).
5. Click **Deploy**.

GuildServer will pull the code or image, build a container, assign a domain (e.g., `my-first-app.guildserver.localhost`), and route traffic through Traefik.

You can monitor the deployment progress in real time from the Deployments page.

## Step 10: Explore the Platform

Now that you are up and running, explore the rest of GuildServer:

- **[Dashboard Guide](/dashboard/overview)** — Full walkthrough of the web interface
- **[Core Concepts](/concepts/organizations)** — Understand organizations, projects, and applications
- **[API Reference](/api)** — Complete tRPC and REST API documentation
- **[CLI Reference](/cli)** — Manage GuildServer from your terminal
- **[Configuration](/getting-started/configuration)** — All environment variables explained

## Stopping the Environment

To stop the development servers, press `Ctrl+C` in the terminal running `pnpm run dev`.

To stop Docker services:

```bash
docker compose down
```

To stop Docker services **and delete all data volumes** (fresh start):

```bash
docker compose down -v
```
