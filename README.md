<p align="center">
  <img src="https://img.shields.io/badge/GuildServer-PaaS-6366f1?style=for-the-badge&labelColor=0a0e27" alt="GuildServer PaaS" />
</p>

<h1 align="center">GuildServer</h1>

<p align="center">
  <strong>Self-hosted Platform as a Service — deploy, scale, and manage apps on your own infrastructure.</strong><br />
  A private alternative to Heroku, Vercel, and Railway with full control over your data, networking, and costs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/tRPC-10-2596BE?logo=trpc&logoColor=white" alt="tRPC" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue" alt="License" />
</p>

---

## Table of Contents

- [What Is GuildServer?](#what-is-guildserver)
- [Key Features](#key-features)
- [How It Works (Non-Technical)](#how-it-works-non-technical)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start (5 minutes)](#quick-start-5-minutes)
- [Setup — Step by Step](#setup--step-by-step)
  - [macOS](#macos-setup)
  - [Linux (Ubuntu / Debian)](#linux-ubuntu--debian-setup)
  - [Windows (WSL2)](#windows-wsl2-setup)
- [Running the Project](#running-the-project)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [API Reference](#api-reference)
- [Dashboard Pages](#dashboard-pages)
- [Production Deployment](#production-deployment)
- [Auto-Deploy (CI/CD)](#auto-deploy-cicd)
- [How to Contribute](#how-to-contribute)
  - [Your First Contribution](#your-first-contribution)
  - [Branch & Commit Conventions](#branch--commit-conventions)
  - [Adding Features](#adding-features)
  - [Pull Request Process](#pull-request-process)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Scripts Reference](#scripts-reference)
- [Troubleshooting](#troubleshooting)
- [Project Roadmap](#project-roadmap)
- [License](#license)

---

## What Is GuildServer?

GuildServer is a **self-hosted PaaS** (Platform as a Service). Think of it as your own private Heroku or Vercel that runs on servers you control — a VPS, a mini-PC at home, or a cloud VM.

You push code, GuildServer builds it, containerizes it with Docker, and serves it on a custom domain with automatic SSL. It handles databases, environment variables, deployments, rollbacks, team management, billing, and monitoring — everything a modern cloud platform does.

**Who is it for?**

- Developers who want a Heroku-like experience on their own hardware
- Teams who need to keep data on-premises for compliance or cost reasons
- Startups who want to offer PaaS to their own customers (white-label)
- Hobbyists who want to self-host their projects with a nice dashboard

---

## Key Features

| Category | Features |
|----------|----------|
| **Deployments** | Git-based deploys from GitHub, GitLab, Bitbucket, Gitea, Docker, or raw Git |
| **Build Strategies** | Dockerfile, Nixpacks, Heroku Buildpacks, Paketo, Static files, Railpack |
| **Databases** | Managed PostgreSQL, MySQL, MongoDB, Redis with connection info and lifecycle |
| **Domains** | Custom domains with automatic SSL via Let's Encrypt and Traefik |
| **Real-time** | Live deployment logs and status updates via WebSocket |
| **Multi-tenant** | Organizations with role-based access control (owner / admin / member) |
| **Billing** | Stripe integration with usage metering, plans, invoices, and spend limits |
| **OAuth** | GitHub and Google sign-in |
| **Monitoring** | Application metrics, system health, audit logs |
| **Kubernetes** | Optional K8s cluster management and Helm integration |
| **Enterprise** | SAML/OIDC SSO, compliance frameworks (SOC2, HIPAA, PCI-DSS), workflows |
| **Auto-deploy** | Push to `main` and your app is live within 5 minutes |

---

## How It Works (Non-Technical)

1. **You sign up** on the GuildServer dashboard and create an organization.
2. **You connect your GitHub** account (or any Git provider).
3. **You create a project** and pick a repository + branch.
4. **GuildServer builds your app** using Docker, detects the right buildpack, and launches a container.
5. **You get a URL** — your app is live. Add a custom domain if you want.
6. **Every time you push code**, GuildServer detects the change and re-deploys automatically.
7. **You can add databases**, environment variables, team members, and custom domains through the dashboard.

Everything runs on **your** server. No data leaves your infrastructure unless you choose to.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │              Cloudflare Tunnel               │
                    │          (HTTPS termination + CDN)           │
                    └───────────────────┬──────────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────────┐
                    │          Traefik v3.6 Reverse Proxy          │
                    │   Ports 80 / 443 / 8080 (dashboard)         │
                    │   Auto SSL via Let's Encrypt                 │
                    └──────┬────────────────────┬──────────────────┘
                           │                    │
              ┌────────────▼──────┐  ┌──────────▼────────────┐
              │   Next.js 15 Web  │  │  Express + tRPC API   │
              │   Port 3000       │  │  Port 4000            │
              │   App Router      │  │  17 tRPC routers      │
              │   Dashboard UI    │  │  BullMQ job queues    │
              └───────────────────┘  │  WebSocket server     │
                                     └──────────┬────────────┘
                                                │
                           ┌────────────────────┼────────────────────┐
                           │                    │                    │
                ┌──────────▼──────┐  ┌──────────▼──────┐  ┌─────────▼───────┐
                │  PostgreSQL 15  │  │    Redis 7       │  │  Docker Engine  │
                │  28 tables      │  │  BullMQ + cache  │  │  App containers │
                │  Drizzle ORM    │  │                  │  │  gs-{appId}     │
                └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### How a deployment works

```
User pushes code to GitHub
         │
         ▼
GitHub webhook hits POST /webhooks/github
         │
         ▼
API enqueues a "deploy-application" job in BullMQ
         │
         ▼
BullMQ worker picks up the job:
  1. Clones the repo
  2. Detects build strategy (Dockerfile / Nixpacks / etc.)
  3. Builds a Docker image
  4. Stops old container (gs-{appId})
  5. Starts new container with Traefik labels
  6. Traefik auto-discovers and routes traffic
         │
         ▼
WebSocket broadcasts status in real-time to the dashboard
         │
         ▼
App is live at {slug}.yourdomain.com  ✅
```

---

## Repository Structure

```
GuildServer/
├── guildserver-paas/                # ★ The main PaaS application
│   ├── apps/
│   │   ├── api/                     # Express + tRPC backend (port 4000)
│   │   │   ├── Dockerfile           # Multi-stage production build
│   │   │   └── src/
│   │   │       ├── routers/         # 17 tRPC routers (auth, org, app, deploy...)
│   │   │       ├── services/        # Business logic (docker, builder, stripe...)
│   │   │       ├── queues/          # BullMQ job queues (deployment, monitoring)
│   │   │       ├── websocket/       # Real-time WebSocket server
│   │   │       ├── trpc/            # tRPC init, context, middleware
│   │   │       └── routes/          # Express routes (webhooks, OAuth)
│   │   ├── web/                     # Next.js 15 dashboard (port 3000)
│   │   │   ├── Dockerfile           # Multi-stage standalone build
│   │   │   └── src/
│   │   │       ├── app/             # App Router pages and layouts
│   │   │       ├── components/      # shadcn/ui + Radix UI components
│   │   │       ├── hooks/           # useAuth, useDeploymentStream, etc.
│   │   │       └── lib/             # Utilities (cn, tRPC client)
│   │   └── docs/                    # Docusaurus 3 documentation site
│   ├── packages/
│   │   ├── database/                # Drizzle ORM schemas + migrations
│   │   │   ├── src/schema/index.ts  # All 28 table definitions
│   │   │   ├── src/migrate.ts       # Migration runner
│   │   │   ├── src/seed.ts          # Database seeder
│   │   │   └── migrations/          # Generated SQL files
│   │   └── cli/                     # GuildServer CLI (gs command)
│   ├── scripts/
│   │   ├── self-update.sh           # Auto-deploy cron script
│   │   ├── build.sh                 # Docker build script
│   │   └── dev.sh                   # Development startup script
│   ├── monitoring/                  # Grafana + Prometheus configs
│   ├── docker-compose.yml           # Development compose
│   ├── docker-compose.prod.yml      # Production compose with Traefik routing
│   ├── turbo.json                   # Turborepo pipeline config
│   ├── pnpm-workspace.yaml          # pnpm workspace definition
│   ├── .env.example                 # Environment variable template
│   ├── CONTRIBUTING.md              # Detailed contribution guide
│   └── README.md                    # PaaS-specific README
├── guildserver-baas-cloud/          # BaaS extension (Supabase Cloud equivalent)
├── guildserver-examples/            # Example app templates
└── README.md                        # ← You are here
```

**Monorepo tooling:** [pnpm workspaces](https://pnpm.io/workspaces) + [Turborepo](https://turbo.build/)

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| **Next.js 15** (App Router) | React framework with standalone output for Docker |
| **React 18** | UI library |
| **Tailwind CSS 3.4** | Utility-first styling |
| **Radix UI** | Accessible, unstyled component primitives |
| **tRPC + React Query** | End-to-end type-safe API calls |
| **Framer Motion** | Smooth animations and transitions |
| **Recharts** | Charts and data visualization |
| **React Hook Form + Zod** | Form handling with runtime validation |
| **Zustand** | Client-side state management |
| **Lucide React** | Icon library |

### Backend

| Technology | Purpose |
|------------|---------|
| **Express.js 4** | HTTP server |
| **tRPC 10** | Type-safe API layer (17 routers) |
| **Drizzle ORM** | Database queries and migrations |
| **BullMQ** | Background job queues (deployments, backups, monitoring) |
| **Dockerode** | Docker container management via API |
| **Stripe SDK** | Billing, subscriptions, usage metering |
| **ws** | WebSocket server for real-time updates |
| **jsonwebtoken + bcryptjs** | Auth tokens and password hashing |
| **Winston** | Structured logging |
| **Zod** | Runtime input validation |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| **Docker + Compose** | Containerization for apps and platform services |
| **PostgreSQL 15** | Primary database (28 tables) |
| **Redis 7** | Job queues and caching |
| **Traefik v3.6** | Reverse proxy with auto SSL and Docker provider |
| **Cloudflare Tunnel** | HTTPS termination, CDN, DDoS protection |
| **GitHub Actions** | CI/CD pipelines |

---

## Prerequisites

Before you start, make sure you have these installed on your computer:

| Tool | Minimum Version | How to Check | Install Link |
|------|----------------|--------------|-------------|
| **Node.js** | 20.0.0 | `node --version` | [nodejs.org](https://nodejs.org/) |
| **pnpm** | 9.0.0 | `pnpm --version` | `npm install -g pnpm` |
| **Docker** | 24.0.0 | `docker --version` | [docker.com](https://docs.docker.com/get-docker/) |
| **Docker Compose** | v2.0.0 | `docker compose version` | Included with Docker Desktop |
| **Git** | 2.30.0 | `git --version` | [git-scm.com](https://git-scm.com/) |

> **New to these tools?** Don't worry — the step-by-step guides below walk you through installing everything.

---

## Quick Start (5 minutes)

If you already have Node.js 20+, pnpm, Docker, and Git installed:

```bash
# 1. Clone the repo
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas

# 2. Copy environment config
cp .env.example .env

# 3. Install dependencies
pnpm install

# 4. Create Docker network and start infrastructure
docker network create guildserver
docker compose up -d postgres redis traefik

# 5. Run database migrations and seed data
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..

# 6. Start the development servers
pnpm run dev
```

Open your browser:

| Service | URL |
|---------|-----|
| 🌐 **Dashboard** | [http://localhost:3000](http://localhost:3000) |
| 🔌 **API** | [http://localhost:4000](http://localhost:4000) |
| 📚 **API Docs (Swagger)** | [http://localhost:4000/api-docs](http://localhost:4000/api-docs) |
| ❤️ **Health Check** | [http://localhost:4000/health](http://localhost:4000/health) |
| 🔀 **Traefik Dashboard** | [http://localhost:8080](http://localhost:8080) |

---

## Setup — Step by Step

### macOS Setup

<details>
<summary><strong>Click to expand macOS instructions</strong></summary>

#### 1. Install Homebrew (if you don't have it)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### 2. Install Node.js 20

```bash
brew install node@20
# Or use nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20
```

#### 3. Install pnpm

```bash
npm install -g pnpm
```

#### 4. Install Docker Desktop

Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) and install. Make sure Docker Desktop is running (you'll see the whale icon in your menu bar).

#### 5. Clone and set up

```bash
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas
cp .env.example .env
pnpm install
```

#### 6. Start infrastructure

```bash
docker network create guildserver
docker compose up -d postgres redis traefik
```

#### 7. Set up the database

```bash
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..
```

#### 8. Start development

```bash
pnpm run dev
```

Dashboard at http://localhost:3000, API at http://localhost:4000.

</details>

### Linux (Ubuntu / Debian) Setup

<details>
<summary><strong>Click to expand Linux instructions</strong></summary>

#### 1. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. Install pnpm

```bash
npm install -g pnpm
```

#### 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker   # or log out and back in
sudo apt-get install -y docker-compose-plugin git
```

#### 4. Clone and set up

```bash
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas
cp .env.example .env
pnpm install
```

#### 5. Start infrastructure

```bash
docker network create guildserver
docker compose up -d postgres redis traefik
```

#### 6. Set up the database

```bash
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..
```

#### 7. Start development

```bash
pnpm run dev
```

#### 8. Verify

```bash
curl http://localhost:4000/health
# Should return: {"status":"ok","timestamp":"...","version":"1.0.0"}
```

</details>

### Windows (WSL2) Setup

<details>
<summary><strong>Click to expand Windows instructions</strong></summary>

#### 1. Install prerequisites

- Install [Node.js 20+](https://nodejs.org) (LTS)
- Install [Docker Desktop](https://docker.com/products/docker-desktop) — enable the WSL2 backend in settings
- Install [Git](https://git-scm.com)

```powershell
npm install -g pnpm
```

#### 2. Clone and set up

```powershell
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer\guildserver-paas
copy .env.example .env
pnpm install
```

#### 3. Edit `.env`

Open `.env` in your editor and set at minimum:

```env
DATABASE_URL="postgresql://guildserver:password123@localhost:5433/guildserver"
REDIS_URL="redis://localhost:6380"
JWT_SECRET="your-secure-random-string-here"
NEXTAUTH_SECRET="another-secure-random-string-here"
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"
```

Also create `apps/web/.env`:

```env
NODE_ENV="development"
NEXT_PUBLIC_API_URL="/trpc"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-nextauth-secret-change-in-production"
```

#### 4. Start infrastructure

```powershell
docker network create guildserver
docker compose up -d postgres redis traefik
```

#### 5. Set up the database

```powershell
pnpm run db:migrate
cd packages\database
pnpm run db:seed
pnpm run db:seed-plans
cd ..\..
```

#### 6. Start development

```powershell
pnpm run dev
```

</details>

---

## Running the Project

After initial setup, the daily workflow is:

```bash
cd GuildServer/guildserver-paas

# Make sure Docker is running, then start infrastructure (if not already up)
docker compose up -d postgres redis traefik

# Start the dev servers
pnpm run dev
```

This starts both the API (port 4000) and Web (port 3000) in watch mode. Changes to source files auto-reload.

### Stopping everything

```bash
# Stop dev servers: press Ctrl+C in the terminal

# Stop Docker infrastructure (keeps data)
docker compose stop

# Stop and remove infrastructure (loses data)
docker compose down -v
```

---

## Environment Variables

### Required (must be set)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://guildserver:password123@localhost:5433/guildserver` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6380` |
| `JWT_SECRET` | Secret for signing auth tokens (min 32 chars) | *(random string)* |
| `NEXTAUTH_SECRET` | NextAuth session encryption key | *(random string)* |
| `NEXTAUTH_URL` | Dashboard URL | `http://localhost:3000` |
| `NODE_ENV` | Environment | `development` or `production` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret | — |
| `STRIPE_SECRET_KEY` | Stripe billing key | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email sending | — |
| `ACME_EMAIL` | Let's Encrypt email for SSL certs | `admin@guildserver.com` |
| `DOCKER_HOST` | Docker daemon socket | `unix:///var/run/docker.sock` |
| `LOG_LEVEL` | Winston log level | `info` |

> See the full list with all 50+ variables in [`guildserver-paas/.env.example`](guildserver-paas/.env.example)

---

## Database

GuildServer uses **PostgreSQL 15** with **Drizzle ORM**.

### 28 Tables

| Group | Tables |
|-------|--------|
| **Core** | `users`, `organizations`, `members`, `oauthAccounts`, `projects` |
| **Apps & Deploy** | `applications`, `deployments`, `databases` |
| **Domains & Config** | `domains`, `certificates`, `environmentVariables`, `webhookDeliveries` |
| **Notifications** | `notifications`, `notificationPreferences`, `slackConfigs` |
| **Kubernetes** | `kubernetesClusters`, `k8sDeployments` |
| **Billing** | `plans`, `subscriptions`, `invoices`, `usageRecords`, `paymentMethods` |
| **Enterprise** | `ssoProviders`, `workflowTemplates`, `workflowExecutions`, `approvalRequests` |
| **Monitoring** | `metrics`, `auditLogs` |

### Common database commands

```bash
# Generate a new migration after changing schema
pnpm run db:generate

# Apply pending migrations
pnpm run db:migrate

# Seed the database with initial data
cd packages/database && pnpm run db:seed && cd ../..

# Seed billing plans (Hobby, Pro, Enterprise)
cd packages/database && pnpm run db:seed-plans && cd ../..

# Open Drizzle Studio (visual database browser)
pnpm run db:studio
```

Schema is defined in a single file: [`packages/database/src/schema/index.ts`](guildserver-paas/packages/database/src/schema/index.ts)

---

## API Reference

### Authentication flow

1. **Register** via `auth.register` (password hashed with bcryptjs)
2. **Login** via `auth.login` → returns a signed JWT
3. Frontend stores token as `guildserver-token` in localStorage
4. All requests include `Authorization: Bearer <token>`
5. **OAuth**: `GET /auth/github` or `/auth/google` → callback issues JWT

### REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api-docs` | Swagger UI documentation |
| POST | `/webhooks/github` | GitHub webhook handler |
| POST | `/webhooks/gitlab` | GitLab webhook handler |
| POST | `/webhooks/stripe` | Stripe webhook |
| GET | `/auth/github` | GitHub OAuth flow |
| GET | `/auth/google` | Google OAuth flow |

### tRPC routers (17 total)

| Router | Key Procedures |
|--------|----------------|
| **auth** | register, login, me, updateProfile, changePassword |
| **organization** | list, create, get, update, delete, getMembers, inviteMember |
| **project** | list, create, get, update, delete |
| **application** | list, create, deploy, getLogs, getMetrics, restart, scale |
| **database** | list, create, delete, restart, getConnectionInfo |
| **deployment** | list, getById, cancel, getLogs, rollback, retry |
| **domain** | list, add, verify, setPrimary, remove, getCertificateStatus |
| **environment** | list, getDecrypted, set, bulkSet, delete |
| **webhook** | getWebhookUrl, listDeliveries, sendTestWebhook |
| **monitoring** | recordMetric, getMetrics, getSystemHealth, getAlerts |
| **kubernetes** | listClusters, createCluster, deployToCluster, getClusterMetrics |
| **workflow** | listTemplates, executeWorkflow, getApprovalRequests, approveRequest |
| **notification** | list, getUnreadCount, markRead, getPreferences, updatePreferences |
| **github** | getConnectionStatus, listRepos, listBranches, disconnect |
| **user** | list (admin), getById, update (admin), impersonate (admin) |
| **billing** | getPlans, getCurrentPlan, getUsage, createCheckoutSession, cancelSubscription |
| **audit** | getLogs, getStatistics, exportLogs, getComplianceReport |

### WebSocket

- **Path:** `/ws`
- **Auth:** JWT via `?token=` query parameter
- **Events:** `deployment_status`, real-time log streaming, live metrics

---

## Dashboard Pages

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Hero, features, pricing |
| Login | `/auth/login` | Email/password + GitHub + Google |
| Register | `/auth/register` | Account creation |
| Dashboard | `/dashboard` | Overview stats and activity |
| Applications | `/dashboard/applications` | App list with status badges |
| App Detail | `/dashboard/applications/[id]` | Deploy, logs, env vars, domains, metrics |
| Deployments | `/dashboard/deployments` | Deployment history |
| Databases | `/dashboard/databases` | Database instances |
| Templates | `/dashboard/templates` | App templates |
| Workflows | `/dashboard/workflows` | Workflow management |
| Monitoring | `/dashboard/monitoring` | System metrics |
| Notifications | `/dashboard/notifications` | Notification center |
| Team | `/dashboard/team` | Team management |
| Settings | `/dashboard/settings` | Account and org settings |
| Billing | `/dashboard/billing` | Plans, usage, invoices |
| Admin Users | `/dashboard/admin/users` | User management (admin only) |

---

## Production Deployment

### Docker Compose

```bash
# On your server:
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas

docker network create guildserver

# Set production environment variables
export JWT_SECRET="$(openssl rand -hex 32)"
export NEXTAUTH_SECRET="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"
export ACME_EMAIL="admin@yourdomain.com"

# Build and launch
docker compose -f docker-compose.prod.yml up -d --build
```

### DNS + HTTPS

**Option A — Cloudflare Tunnel (recommended):**
1. Install `cloudflared` on your server
2. Create a tunnel pointing to `http://localhost:80`
3. Cloudflare handles SSL, CDN, and DDoS protection

**Option B — Direct VPS:**
1. Point an A record to your server's IP
2. Traefik automatically provisions SSL via Let's Encrypt

---

## Auto-Deploy (CI/CD)

GuildServer includes a self-update script. Pushes to `main` go live automatically.

```bash
# Install the cron job on your server (checks every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/guildserver/guildserver-paas/scripts/self-update.sh >> /var/log/guildserver-update.log 2>&1") | crontab -
```

The script fetches `origin/main`, compares HEADs, and if different: pulls, rebuilds Docker images, restarts containers, and runs migrations — with zero downtime.

---

## How to Contribute

### Your First Contribution

1. **Get access** — contact the project owner (see [CONTRIBUTING.md](guildserver-paas/CONTRIBUTING.md))
2. **Clone the repo** and follow the [setup guide](#setup--step-by-step)
3. **Pick a starter task** — look for issues labeled `good-first-issue` or `help-wanted`
4. **Create a branch**, make your changes, open a PR

### Branch & Commit Conventions

**Branch names** use a prefix:
```
feature/add-kubernetes-monitoring
fix/websocket-timeout-on-idle
docs/update-api-reference
refactor/extract-deployment-service
test/docker-service-unit-tests
chore/update-dependencies
```

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add kubernetes cluster management
fix: resolve WebSocket timeout on idle sessions
docs: update API reference for billing endpoints
refactor: extract deployment logic to service
test: add unit tests for docker service
chore: update drizzle-orm to v0.30
```

### Adding Features

#### New tRPC Router

1. Create `apps/api/src/routers/your-feature.ts`
2. Define procedures with `protectedProcedure` or `adminProcedure`
3. Register in `apps/api/src/trpc/router.ts`
4. Complex logic goes in `apps/api/src/services/your-feature.ts`

#### New Database Table

1. Add the table in `packages/database/src/schema/index.ts`
2. Run `pnpm run db:generate` to create migration
3. Run `pnpm run db:migrate` to apply
4. Update seed scripts if needed

#### New Dashboard Page

1. Create `apps/web/src/app/dashboard/your-page/page.tsx`
2. Use `"use client"` directive, `useAuth({ redirect: true })`
3. Add navigation entry in `apps/web/src/app/dashboard/layout.tsx`
4. Include skeleton loading states and empty state components

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following [code standards](#code-standards)
3. Run all checks: `pnpm run typecheck && pnpm run lint && pnpm run build`
4. Rebase on `main`: `git rebase origin/main`
5. Open a PR with a clear title and description
6. At least 1 maintainer approval required
7. PRs are squash-merged into `main`

---

## Code Standards

### TypeScript
- **Strict mode** enabled everywhere
- All parameters and return types must be explicitly typed
- Use `Zod` for runtime validation — no unvalidated user input
- Never use `any` — use `unknown` with type guards

### Frontend (`apps/web`)
- `"use client"` for interactive components
- **Tailwind CSS only** — no inline styles or CSS modules
- Follow **shadcn/ui** patterns with `cn()` utility
- Icons from **Lucide React** only
- Animations via **Framer Motion**

### Backend (`apps/api`)
- All endpoints go through **tRPC routers** (except webhooks/OAuth)
- Business logic in `src/services/`, not in router handlers
- Throw `TRPCError` with correct codes (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, etc.)
- Background work goes through **BullMQ** queues
- Use **Winston logger** — no `console.log` in production code

### Database
- Schema changes only in `packages/database/src/schema/index.ts`
- **UUID primary keys** with `.defaultRandom()`
- **Never** modify committed migration files — create new ones to fix issues
- Add indexes for frequently queried columns

---

## Testing

```bash
# Type checking across all packages
pnpm run typecheck

# ESLint across all packages
pnpm run lint

# Run backend tests
cd apps/api && pnpm run test

# Run tests in watch mode
cd apps/api && pnpm run test:watch

# Full production build (catches import/build errors)
pnpm run build
```

| Framework | Scope |
|-----------|-------|
| **Jest + ts-jest** | Backend unit/integration tests |
| **Playwright** | End-to-end browser tests |
| **ESLint** | Code quality linting |
| **TypeScript** | Static type checking |

---

## Scripts Reference

Run these from `GuildServer/guildserver-paas/`:

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Start all apps in development mode |
| `pnpm run build` | Build all apps for production |
| `pnpm run start` | Start all apps in production mode |
| `pnpm run typecheck` | TypeScript type checking |
| `pnpm run lint` | ESLint across all packages |
| `pnpm run lint:fix` | Auto-fix ESLint issues |
| `pnpm run format` | Prettier formatting |
| `pnpm run test` | Run all tests |
| `pnpm run clean` | Remove build artifacts and node_modules |
| `pnpm run db:generate` | Generate Drizzle migrations |
| `pnpm run db:migrate` | Apply pending migrations |
| `pnpm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `pnpm run db:seed` | Seed initial database data |
| `pnpm run docker:build` | Build Docker images |
| `pnpm run docker:run` | Docker Compose up |
| `pnpm run docker:stop` | Docker Compose down |

---

## Troubleshooting

<details>
<summary><strong>Port already in use</strong></summary>

```bash
# Find what's using a port (e.g. 3000)
lsof -i :3000
# Kill it
kill -9 <PID>
```
</details>

<details>
<summary><strong>Docker network "guildserver" not found</strong></summary>

```bash
docker network create guildserver
```
</details>

<details>
<summary><strong>Database connection refused</strong></summary>

Make sure Docker containers are running:
```bash
docker compose up -d postgres redis
docker compose ps   # Should show "healthy" status
```
</details>

<details>
<summary><strong>pnpm install fails</strong></summary>

```bash
# Clear cache and reinstall
rm -rf node_modules
rm pnpm-lock.yaml
pnpm install
```
</details>

<details>
<summary><strong>Migration errors</strong></summary>

```bash
# Check if the database is running
docker compose ps

# Reset the database (⚠️ deletes all data)
docker compose down -v
docker compose up -d postgres redis
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..
```
</details>

<details>
<summary><strong>"Cannot find module" errors</strong></summary>

The monorepo has internal dependencies. Rebuild everything:
```bash
pnpm run build
pnpm run dev
```
</details>

---

## Project Roadmap

- [x] Core PaaS (deploy, scale, manage apps)
- [x] Git-based deployments (GitHub, GitLab, Bitbucket, Gitea)
- [x] 6 build strategies (Dockerfile, Nixpacks, Heroku, Paketo, Static, Railpack)
- [x] Custom domains with auto SSL
- [x] Multi-tenant organizations with RBAC
- [x] Real-time deployment logs via WebSocket
- [x] Stripe billing with usage metering
- [x] OAuth (GitHub, Google)
- [x] Monitoring and audit logs
- [x] Auto-deploy on push
- [ ] GuildServer BaaS Cloud (Supabase-equivalent multi-tenant backend service)
- [ ] Multi-node fleet management
- [ ] Marketplace for app templates
- [ ] Mobile dashboard app

---

## License

GuildServer is licensed under the [Apache License 2.0](LICENSE).

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/davidpius95">David Pius</a>
</p>