<p align="center">
  <img src="https://img.shields.io/badge/GuildServer-PaaS-6366f1?style=for-the-badge&labelColor=0a0e27" alt="GuildServer PaaS" />
</p>

<p align="center">
  <strong>Enterprise-grade, self-hosted Platform as a Service</strong><br />
  Deploy, scale, and manage applications on your own infrastructure.
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

GuildServer PaaS is a full-featured, self-hosted platform for teams and organizations that want the convenience of a managed cloud platform without giving up control. It is a private alternative to Heroku, Vercel, or Railway -- with full control over your data, networking, and costs.

- **Git-based deployments** from GitHub, GitLab, Bitbucket, Gitea, Docker, or raw Git
- **Six build strategies** -- Dockerfile, Nixpacks, Heroku Buildpacks, Paketo, Static, Railpack
- **Managed databases** with connection info and lifecycle management
- **Custom domains** with automatic SSL via Let's Encrypt and Traefik
- **Real-time logs** and deployment status via WebSocket
- **Multi-tenant** organizations with role-based access control
- **Stripe billing** with usage metering and spend limits
- **Auto-deploy** -- pushes to `main` are live within 5 minutes

---

## Quick Start

```bash
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas
cp .env.example .env          # edit with your secrets
pnpm install
docker network create guildserver
docker compose up -d postgres redis traefik
pnpm run db:migrate
pnpm run dev
```

The web UI will be at **http://localhost:3000** and the API at **http://localhost:4000**.

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
              │   Standalone      │  │  BullMQ job queues    │
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

### Monorepo Structure

```
guildserver-paas/
├── apps/
│   ├── api/                    # Express.js + tRPC v10 API server
│   │   ├── Dockerfile          # Multi-stage: base → deps → builder → runner (tsx)
│   │   └── src/
│   │       ├── routers/        # 17 tRPC routers
│   │       ├── services/       # Business logic (docker, builder, stripe, k8s...)
│   │       ├── queues/         # BullMQ job queues
│   │       ├── websocket/      # Real-time WebSocket server
│   │       ├── trpc/           # tRPC init, context, middleware
│   │       └── routes/         # Express routes (webhooks, OAuth)
│   ├── web/                    # Next.js 15 App Router frontend
│   │   ├── Dockerfile          # Multi-stage: base → deps → builder → runner (standalone)
│   │   └── src/
│   │       ├── app/            # App Router pages and layouts
│   │       ├── components/     # shadcn/ui + Radix UI + Framer Motion
│   │       ├── hooks/          # useAuth, useDeploymentStream, etc.
│   │       └── lib/            # Utilities (cn, tRPC client)
│   └── docs/                   # Docusaurus 3 documentation site
├── packages/
│   ├── database/               # Drizzle ORM schemas, migrations, seeds
│   └── cli/                    # GuildServer CLI (gs command)
├── scripts/
│   ├── self-update.sh          # Auto-deploy cron script
│   ├── build.sh                # Docker build script
│   └── dev.sh                  # Development startup script
├── docker-compose.yml          # Development compose
├── docker-compose.prod.yml     # Production compose with Traefik routing
├── turbo.json                  # Turborepo task config (v2 format)
├── pnpm-workspace.yaml         # pnpm workspace definition
├── .eslintrc.json              # Root ESLint config
├── .prettierrc.json            # Prettier config
├── .dockerignore               # Docker build exclusions
├── .nvmrc                      # Node.js version (20)
└── .env.example                # Environment variable template
```

Monorepo tooling: **pnpm workspaces** + **Turborepo**.

---

## Tech Stack

### Frontend

| | Technology | Purpose |
|---|---|---|
| <img src="https://img.shields.io/badge/-Next.js%2015-000?logo=next.js" /> | Next.js 15 | App Router, standalone output |
| <img src="https://img.shields.io/badge/-React%2018-61DAFB?logo=react&logoColor=black" /> | React 18 | UI library |
| <img src="https://img.shields.io/badge/-Tailwind%20CSS-06B6D4?logo=tailwindcss&logoColor=white" /> | Tailwind CSS 3.4 | Utility-first styling |
| <img src="https://img.shields.io/badge/-Radix%20UI-161618?logo=radixui" /> | Radix UI | Accessible component primitives |
| <img src="https://img.shields.io/badge/-tRPC-2596BE?logo=trpc&logoColor=white" /> | tRPC + React Query | End-to-end type-safe API client |
| <img src="https://img.shields.io/badge/-Framer%20Motion-0055FF?logo=framer" /> | Framer Motion | Animations |
| <img src="https://img.shields.io/badge/-Recharts-FF6384" /> | Recharts | Charts and data visualization |
| | React Hook Form + Zod | Form handling with validation |
| | Zustand | Client-side state management |
| | next-themes | Dark mode support |
| | Lucide React | Icon library |

### Backend

| | Technology | Purpose |
|---|---|---|
| <img src="https://img.shields.io/badge/-Express-000?logo=express" /> | Express.js 4.18 | HTTP server |
| <img src="https://img.shields.io/badge/-tRPC-2596BE?logo=trpc&logoColor=white" /> | tRPC 10 | Type-safe API layer |
| <img src="https://img.shields.io/badge/-Drizzle-C5F74F?logo=drizzle&logoColor=black" /> | Drizzle ORM | Database queries and migrations |
| <img src="https://img.shields.io/badge/-BullMQ-E83E30" /> | BullMQ | Background job queues |
| <img src="https://img.shields.io/badge/-Stripe-008CDD?logo=stripe&logoColor=white" /> | Stripe | Billing and subscriptions |
| | Dockerode | Docker container management |
| | ws | WebSocket server |
| | jsonwebtoken + bcryptjs | Auth tokens and password hashing |
| | Winston | Structured logging |
| | Zod | Runtime input validation |

### Infrastructure

| | Technology | Purpose |
|---|---|---|
| <img src="https://img.shields.io/badge/-Docker-2496ED?logo=docker&logoColor=white" /> | Docker + Compose | Containerization |
| <img src="https://img.shields.io/badge/-PostgreSQL-4169E1?logo=postgresql&logoColor=white" /> | PostgreSQL 15 | Primary database |
| <img src="https://img.shields.io/badge/-Redis-DC382D?logo=redis&logoColor=white" /> | Redis 7 | Job queues and caching |
| <img src="https://img.shields.io/badge/-Traefik-24A1C1?logo=traefikproxy&logoColor=white" /> | Traefik v3.6 | Reverse proxy + auto SSL |
| <img src="https://img.shields.io/badge/-Cloudflare-F38020?logo=cloudflare&logoColor=white" /> | Cloudflare Tunnel | HTTPS termination + CDN |
| <img src="https://img.shields.io/badge/-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" /> | GitHub Actions | CI/CD pipelines |
| <img src="https://img.shields.io/badge/-Proxmox-E57000?logo=proxmox&logoColor=white" /> | Proxmox VE | VM management |

---

## Getting Started

### Prerequisites

- **Node.js** >= 20 (use `.nvmrc`: `nvm use`)
- **pnpm** 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- **Docker** and **Docker Compose** v2
- **Git**

<details>
<summary><strong>Windows Setup</strong></summary>

#### 1. Install Prerequisites

Install [Node.js 20+](https://nodejs.org), [Docker Desktop](https://docker.com/products/docker-desktop) (WSL2 backend), and [Git](https://git-scm.com).

```powershell
npm install -g pnpm
```

#### 2. Clone and Install

```powershell
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas
pnpm install
```

#### 3. Start Infrastructure

```powershell
docker network create guildserver
docker-compose up -d postgres redis traefik
```

Services started:
- PostgreSQL on port **5433**
- Redis on port **6380**
- Traefik on ports **80**, **443**, **8080** (dashboard)

#### 4. Configure Environment

```powershell
copy .env.example .env
```

Edit `.env`:

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

#### 5. Database Setup

```powershell
pnpm run db:migrate
pnpm run db:seed --filter @guildserver/database
cd packages/database && pnpm run db:seed-plans && cd ../..
```

#### 6. Start Development

```powershell
pnpm run dev
```

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger Docs | http://localhost:4000/api-docs |
| Health Check | http://localhost:4000/health |
| Traefik Dashboard | http://localhost:8080 |

</details>

<details>
<summary><strong>Linux (Ubuntu/Debian) Setup</strong></summary>

#### 1. Install Prerequisites

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# Docker + Compose v2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt-get install -y docker-compose-plugin git
```

#### 2. Clone and Install

```bash
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas
pnpm install
```

#### 3. Start Infrastructure

```bash
docker network create guildserver
docker compose up -d postgres redis traefik
```

#### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with the values from the Windows section above
```

#### 5. Database Setup

```bash
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..
```

#### 6. Start Development

```bash
pnpm run dev
```

#### 7. Verify

```bash
curl http://localhost:4000/health
# {"status":"ok","timestamp":"...","version":"1.0.0","environment":"development"}
```

</details>

---

## Production Deployment

### Docker Compose (Simplest)

The project includes a production-ready `docker-compose.prod.yml` with Traefik routing, health checks, and service dependencies.

```bash
# Clone on your server
git clone https://github.com/davidpius95/GuildServer.git
cd GuildServer/guildserver-paas

# Create external network for Traefik
docker network create guildserver

# Set production environment variables
export JWT_SECRET="your-production-secret"
export NEXTAUTH_SECRET="your-nextauth-secret"
export POSTGRES_PASSWORD="strong-password"
export ACME_EMAIL="admin@yourdomain.com"

# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build
```

**Production services:**

| Service | Container | Port | Routing |
|---------|-----------|------|---------|
| Traefik | guildserver-traefik | 80, 443, 8080 | Reverse proxy + SSL |
| PostgreSQL | guildserver-postgres | internal only | Health checked |
| Redis | guildserver-redis | internal only | Health checked |
| API | guildserver-api | 4000 (internal) | `/trpc`, `/health`, `/api` via Traefik |
| Web | guildserver-web | 3000 (internal) | `/*` via Traefik (priority=1) |

### Multi-Stage Docker Builds

Both the API and Web app use optimized multi-stage Docker builds:

**API** (`apps/api/Dockerfile`):
- `base` -- Node 20 Alpine + pnpm via corepack
- `deps` -- Installs all workspace dependencies
- `builder` -- Copies source, builds the database package
- `runner` -- Runs via `tsx` from TypeScript source with `NODE_ENV=production`

**Web** (`apps/web/Dockerfile`):
- `base` -- Node 20 Alpine + pnpm via corepack
- `deps` -- Installs all workspace dependencies
- `builder` -- Builds database package + Next.js standalone output
- `runner` -- Minimal image running `node apps/web/server.js`

Key config: `next.config.js` sets `output: 'standalone'` and `outputFileTracingRoot` to the monorepo root for correct dependency tracing in pnpm workspaces.

### Auto-Deploy

The project includes a self-update script that automatically deploys when new commits are pushed to `main`.

**Setup on your server:**

```bash
# Install the cron job (checks every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/guildserver/guildserver-paas/scripts/self-update.sh >> /var/log/guildserver-update.log 2>&1") | crontab -

# View update logs
tail -f /var/log/guildserver-update.log
```

The `scripts/self-update.sh` script:
1. Fetches `origin/main`
2. Compares local HEAD with remote
3. If different, runs `git reset --hard origin/main`
4. Rebuilds API and Web Docker images
5. Restarts containers with zero-downtime
6. Runs database migrations
7. Prunes old Docker images

### Cloudflare Tunnel + Traefik

For production HTTPS without exposing ports directly:

1. Install `cloudflared` on the server
2. Create a tunnel pointing to `http://localhost:80`
3. Traefik handles routing between services
4. Cloudflare provides SSL termination, CDN, and DDoS protection

### DNS Configuration

Point your domain's DNS to either:
- **Cloudflare Tunnel** -- CNAME to your tunnel ID
- **Direct VPS** -- A record to your server IP (Traefik handles SSL via Let's Encrypt)

---

## Configuration

<details>
<summary><strong>Environment Variables</strong></summary>

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://guildserver:pass@localhost:5433/guildserver` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6380` |
| `JWT_SECRET` | JWT signing secret | (random string) |
| `NEXTAUTH_SECRET` | NextAuth session encryption | (random string) |
| `NEXTAUTH_URL` | NextAuth base URL | `http://localhost:3000` |
| `NODE_ENV` | Runtime environment | `development` or `production` |

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Frontend URL | `http://localhost:3000` |
| `API_URL` | API URL | `http://localhost:4000` |
| `FRONTEND_URL` | CORS origin | -- |
| `PORT` | API server port | `4000` |
| `LOG_LEVEL` | Winston log level | `info` |

### OAuth (Optional)

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app secret |
| `GITHUB_CALLBACK_URL` | GitHub OAuth callback URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |

### Email (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | -- |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | -- |
| `SMTP_PASS` | SMTP password | -- |
| `EMAIL_FROM` | Sender email address | `noreply@guildserver.com` |

### Billing (Optional)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### Docker

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_HOST` | Docker daemon socket | `unix:///var/run/docker.sock` |
| `ACME_EMAIL` | Let's Encrypt email | `admin@guildserver.com` |

### Kubernetes (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `KUBECONFIG_PATH` | Path to kubeconfig | -- |
| `KUBERNETES_NAMESPACE` | Default namespace | `guildserver` |

### Enterprise (Optional)

| Variable | Description |
|----------|-------------|
| `ENTERPRISE_MODE` | Enable enterprise features |
| `SAML_ENABLED` | Enable SAML SSO |
| `OIDC_ENABLED` | Enable OIDC SSO |
| `COMPLIANCE_ENABLED` | Enable compliance frameworks |

### Web App (`apps/web/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | tRPC endpoint path | `/trpc` |
| `NEXT_PUBLIC_API_BASE_URL` | Full API URL for WebSocket/OAuth | `http://localhost:4000` |

</details>

---

## API Architecture

### Authentication

1. Register via `auth.register` (password hashed with bcryptjs)
2. Login via `auth.login` (returns signed JWT)
3. Frontend stores token in `localStorage` as `guildserver-token`
4. All requests include `Authorization: Bearer <token>`
5. tRPC middleware verifies JWT and loads user context
6. OAuth: `GET /auth/github` or `/auth/google` initiates flow, callback issues JWT

**Procedure types:** `publicProcedure`, `protectedProcedure`, `adminProcedure`, `organizationProcedure`

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api-docs` | Swagger UI |
| POST | `/webhooks/github` | GitHub webhook handler |
| POST | `/webhooks/gitlab` | GitLab webhook handler |
| POST | `/webhooks/stripe` | Stripe webhook |
| GET | `/auth/github` | GitHub OAuth |
| GET | `/auth/google` | Google OAuth |

### WebSocket

- **Path:** `/ws`
- **Auth:** JWT via `?token=` query param
- **Events:** `deployment_status`, log streaming, real-time metrics

<details>
<summary><strong>tRPC Routers (17 routers)</strong></summary>

**auth** -- `register`, `login`, `me`, `updateProfile`, `changePassword`, `logout`

**organization** -- `list`, `getById`, `create`, `update`, `delete`, `getMembers`, `updateMember`, `removeMember`

**project** -- `list`, `getById`, `create`, `update`, `delete`

**application** -- `list`, `getById`, `create`, `update`, `updatePreviewSettings`, `delete`, `deploy`, `getLogs`, `getMetrics`, `restart`, `scale`, `listGithubRepos`, `listGithubBranches`

**database** -- `list`, `getById`, `create`, `update`, `delete`, `restart`, `getConnectionInfo`

**deployment** -- `listAll`, `list`, `getById`, `cancel`, `getLogs`, `rollback`, `retry`, `activity`

**domain** -- `list`, `add`, `generateAutoUrl`, `verify`, `setPrimary`, `remove`, `getCertificateStatus`, `getAccessUrl`

**environment** -- `list`, `getDecrypted`, `set`, `bulkSet`, `delete`, `deleteAll`

**webhook** -- `getWebhookUrl`, `listDeliveries`, `sendTestWebhook`

**monitoring** -- `recordMetric`, `getMetrics`, `getApplicationMetrics`, `getOrganizationMetrics`, `getSystemHealth`, `getAlerts`, `getApplicationsSummary`

**kubernetes** -- `listClusters`, `getClusterById`, `createCluster`, `updateCluster`, `deleteCluster`, `deployToCluster`, `listDeployments`, `getClusterStatus`, `getClusterMetrics`

**workflow** -- `listTemplates`, `getTemplateById`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `executeWorkflow`, `listExecutions`, `getExecutionById`, `getApprovalRequests`, `approveRequest`

**notification** -- `list`, `getUnreadCount`, `markRead`, `markAllRead`, `getPreferences`, `updatePreferences`, `getSlackConfig`, `setSlackConfig`, `testSlackNotification`

**github** -- `getConnectionStatus`, `getConnectedAccounts`, `listRepos`, `listBranches`, `disconnect`

**user** -- `list` (admin), `getById`, `update` (admin), `delete` (admin), `getActivity`, `getStats`, `impersonate` (admin)

**billing** -- `getPlans`, `getCurrentPlan`, `getUsage`, `getInvoices`, `getPaymentMethods`, `createCheckoutSession`, `createPortalSession`, `cancelSubscription`, `resumeSubscription`, `setSpendLimit`, `getSpendStatus`, `startTrial`

**audit** -- `getLogs`, `createLog`, `getStatistics`, `exportLogs`, `getComplianceReport`

</details>

### Background Job Queues

Powered by BullMQ with Redis:

| Queue | Jobs |
|-------|------|
| `deployment` | `deploy-application`, `build-application` |
| `monitoring` | Periodic metrics collection, health checks, container sync |
| `backup` | Database backups, configuration backups |

---

## Database Schema

<details>
<summary><strong>28 tables managed by Drizzle ORM</strong></summary>

All schema definitions are in `packages/database/src/schema/index.ts`.

### Core

| Table | Key Columns |
|-------|-------------|
| `users` | id, email, name, password, role (admin/user), twoFactorEnabled |
| `organizations` | id, name, slug, ownerId, stripeCustomerId |
| `members` | id, userId, organizationId, role (owner/admin/member) |
| `oauthAccounts` | id, userId, provider, providerAccountId, accessToken |
| `projects` | id, name, organizationId, environment, settings |

### Applications and Deployments

| Table | Key Columns |
|-------|-------------|
| `applications` | id, name, projectId, sourceType, buildType, repository, branch, replicas, status |
| `deployments` | id, applicationId, status, gitCommitSha, buildLogs, deploymentType |
| `databases` | id, name, type, projectId, dockerImage, status |

### Domains and Config

| Table | Key Columns |
|-------|-------------|
| `domains` | id, domain, applicationId, isPrimary, verified, certificateId |
| `certificates` | id, domain, issuer, status, expiresAt, autoRenew |
| `environmentVariables` | id, applicationId, key, value (AES-256 encrypted), scope |
| `webhookDeliveries` | id, applicationId, provider, eventType, delivered |

### Notifications

| Table | Key Columns |
|-------|-------------|
| `notifications` | id, userId, type, title, message, read |
| `notificationPreferences` | id, userId, event, emailEnabled, slackEnabled |
| `slackConfigs` | id, organizationId, webhookUrl, enabled |

### Kubernetes

| Table | Key Columns |
|-------|-------------|
| `kubernetesClusters` | id, name, endpoint, provider, region, status |
| `k8sDeployments` | id, name, namespace, clusterId, applicationId, replicas |

### Billing

| Table | Key Columns |
|-------|-------------|
| `plans` | id, name, slug, priceMonthly, priceYearly, limits, features |
| `subscriptions` | id, organizationId, planId, status, stripeSubscriptionId |
| `invoices` | id, organizationId, stripeInvoiceId, amountDueCents, status |
| `usageRecords` | id, organizationId, metric, value, periodStart |
| `paymentMethods` | id, organizationId, type, cardBrand, cardLast4 |

### Enterprise

| Table | Key Columns |
|-------|-------------|
| `ssoProviders` | id, name, providerType (saml/oidc/ldap), organizationId |
| `workflowTemplates` | id, name, definition, version, status |
| `workflowExecutions` | id, templateId, status, currentStep, context |
| `approvalRequests` | id, workflowExecutionId, approverId, status |

### Monitoring

| Table | Key Columns |
|-------|-------------|
| `metrics` | id, name, type, value, labels, applicationId |
| `auditLogs` | id, userId, action, resourceType, resourceId, ipAddress |

</details>

---

## Services

Business logic modules in `apps/api/src/services/`:

| Service | Description |
|---------|-------------|
| `docker.ts` | Container lifecycle (deploy, restart, stop, logs, stats). Network: `guildserver`, prefix: `gs-` |
| `container-manager.ts` | Container status sync, health checks, metrics |
| `git-provider.ts` | Clone repos, verify webhook signatures, parse push events |
| `builder.ts` | Build Docker images (dockerfile, nixpacks, heroku, paketo, static, railpack) |
| `kubernetes.ts` | Cluster management, Helm integration |
| `notification.ts` | Multi-channel notifications (email, Slack, in-app) |
| `stripe.ts` | Checkout sessions, portal sessions, subscription management |
| `usage-meter.ts` | Track deployments and build minutes, enforce plan limits |
| `spend-manager.ts` | Overage costs, spend limits |
| `enterprise-auth.ts` | SAML, OIDC, LDAP authentication |
| `cicd.ts` | GitHub Actions and GitLab CI integration |
| `compliance.ts` | SOC2, HIPAA, PCI-DSS frameworks |

---

## Web App Pages

### Public

| Path | Description |
|------|-------------|
| `/` | Landing page with hero, features, pricing |
| `/pricing` | Plan comparison |

### Auth

| Path | Description |
|------|-------------|
| `/auth/login` | Login with email/password, GitHub, Google |
| `/auth/register` | Account registration |
| `/auth/callback` | OAuth callback handler |

### Dashboard

| Path | Description |
|------|-------------|
| `/dashboard` | Overview: stats, deployment activity, system status |
| `/dashboard/applications` | Application list with status badges |
| `/dashboard/applications/[id]` | App detail (deploy, logs, env vars, domains, metrics) |
| `/dashboard/deployments` | Deployment history with filtering |
| `/dashboard/databases` | Database instances |
| `/dashboard/templates` | Application templates |
| `/dashboard/workflows` | Workflow management |
| `/dashboard/monitoring` | System metrics and analytics |
| `/dashboard/notifications` | Notification center |
| `/dashboard/onboarding` | First-time setup wizard |
| `/dashboard/team` | Team management |
| `/dashboard/security` | Security settings |
| `/dashboard/settings` | Account and org settings |
| `/dashboard/billing` | Plans, usage, invoices |
| `/dashboard/admin/users` | User management (admin) |
| `/dashboard/admin/infrastructure` | Infrastructure management (admin) |

---

## CI/CD Pipeline

GitHub Actions workflow at `.github/workflows/test.yml`:

| Job | Description |
|-----|-------------|
| `lint-and-typecheck` | ESLint + TypeScript type checking |
| `backend-tests` | API tests with PostgreSQL 15 + Redis 7 service containers |
| `frontend-tests` | Next.js tests |
| `e2e-tests` | Playwright end-to-end tests |
| `build-test` | Production build + Docker image build |
| `security-audit` | pnpm audit + CodeQL analysis |
| `dependency-check` | Check for outdated dependencies |

**CI environment:** Node.js 20, pnpm 9, PostgreSQL 15, Redis 7.

---

## Code Quality

### ESLint

Three-level ESLint configuration:

| Config | Scope |
|--------|-------|
| `.eslintrc.json` | Root: `@typescript-eslint/recommended`, warns on `no-explicit-any` and unused vars |
| `apps/web/.eslintrc.json` | Web: extends `next/core-web-vitals` + root |
| `apps/api/.eslintrc.json` | API: extends root with Node.js environment |

### Prettier

`.prettierrc.json`:
```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
```

### Run Quality Checks

```bash
pnpm run lint          # ESLint across all packages
pnpm run typecheck     # TypeScript type checking
pnpm run format        # Prettier formatting
pnpm run test          # All tests
```

---

## Scripts

All scripts are run from the repository root with `pnpm run`:

| Script | Description |
|--------|-------------|
| `dev` | Start all apps in dev mode (Turborepo) |
| `build` | Build all apps |
| `start` | Start all apps in production |
| `test` | Run all tests |
| `typecheck` | TypeScript type checking |
| `lint` | ESLint |
| `lint:fix` | ESLint auto-fix |
| `format` | Prettier formatting |
| `clean` | Remove build artifacts and node_modules |
| `db:generate` | Generate Drizzle migrations |
| `db:migrate` | Run database migrations |
| `db:studio` | Open Drizzle Studio GUI |
| `db:seed` | Seed database |
| `docker:build` | Build Docker image |
| `docker:run` | Docker Compose up |
| `docker:stop` | Docker Compose down |

---

## Key Architectural Patterns

- **End-to-end type safety** -- tRPC lets the frontend import router types directly, providing compile-time type checking across the network boundary.
- **BullMQ deployment pipeline** -- tRPC mutation enqueues a job, BullMQ worker processes build/deploy, WebSocket broadcasts status.
- **Smart retry logic** -- tRPC client skips retries on 401/403 errors, clears token, and redirects to login.
- **Container naming** -- Docker containers named `gs-{applicationId}` on the `guildserver` network.
- **Traefik Docker provider** -- Containers receive Traefik labels for automatic routing and SSL.
- **Encrypted environment variables** -- AES-256 encryption at rest, decrypted via `environment.getDecrypted`.
- **Centralized schema** -- All Drizzle ORM definitions in `packages/database/src/schema/index.ts`.
- **Standalone Next.js** -- Web app uses `output: 'standalone'` with `outputFileTracingRoot` for optimized Docker images in pnpm monorepos.

---

## License

GuildServer is licensed under the [Apache License 2.0](LICENSE).
