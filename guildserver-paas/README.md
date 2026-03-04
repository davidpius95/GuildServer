# GuildServer PaaS

An enterprise-grade, self-hosted Platform as a Service for deploying, scaling, and managing applications and databases on your own infrastructure. GuildServer is a private alternative to Heroku, Vercel, or Railway -- with full control over your data, networking, and costs.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Monorepo Structure](#monorepo-structure)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Setup -- Windows](#setup----windows)
- [Setup -- Linux (Ubuntu/Debian)](#setup----linux-ubuntudebian)
- [Docker Compose Services](#docker-compose-services)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [API Architecture](#api-architecture)
  - [Middleware Stack](#middleware-stack)
  - [REST Endpoints](#rest-endpoints)
  - [tRPC API](#trpc-api)
  - [tRPC Routers](#trpc-routers)
  - [WebSocket Server](#websocket-server)
  - [Background Job Queues](#background-job-queues)
- [Database Schema](#database-schema)
- [Services](#services)
- [Web App Pages](#web-app-pages)
- [Authentication Flow](#authentication-flow)
- [Logging](#logging)
- [Key Architectural Patterns](#key-architectural-patterns)
- [CI/CD (GitHub Actions)](#cicd-github-actions)
- [Production Deployment](#production-deployment)
- [License](#license)

---

## Overview

GuildServer PaaS is a full-featured, self-hosted platform for teams and organizations that want the convenience of a managed cloud platform without giving up control. Deploy applications from Git repositories, manage databases, configure custom domains with automatic SSL, monitor performance, and handle billing -- all from a single dashboard running on your own servers.

The platform supports multiple build strategies (Dockerfile, Nixpacks, Heroku Buildpacks, Paketo, static sites, Railpack), integrates with GitHub and Google OAuth for authentication and repository access, and provides real-time deployment logs and metrics over WebSocket connections.

---

## Features

### Core Platform
- Git-based application deployments (GitHub, GitLab, Bitbucket, Gitea, Docker, raw Git)
- Six build types: Dockerfile, Nixpacks, Heroku Buildpacks, Paketo, Static, Railpack
- Managed database instances with connection info and lifecycle management
- Custom domain management with automatic SSL via Let's Encrypt and Traefik
- Environment variable management with AES-256 encryption at rest
- Preview deployments for pull requests with configurable TTL
- Real-time deployment logs and status via WebSocket
- Application scaling (replica count, CPU and memory limits)
- Deployment rollback and retry

### Enterprise
- Multi-tenant organizations with role-based access control (owner, admin, member)
- Kubernetes multi-cluster orchestration with Helm chart support
- Enterprise SSO via SAML, OIDC, and LDAP providers
- Compliance frameworks: SOC2, HIPAA, PCI-DSS
- Workflow engine with approval gates
- Audit logging with export and compliance reporting

### Billing and Usage
- Stripe-powered subscription billing (Hobby, Pro, Enterprise plans)
- Usage metering for deployments, build minutes, storage, and bandwidth
- Spend limits and overage cost tracking
- Invoice history and payment method management

### Monitoring and Notifications
- Application metrics collection and visualization (Recharts)
- System health monitoring
- Multi-channel notifications: email (SMTP/Nodemailer), Slack webhooks, in-app
- Configurable notification preferences per event type

### Developer Experience
- End-to-end type safety with tRPC and TypeScript
- CLI tool (`gs` / `guildserver` commands)
- Swagger/OpenAPI documentation at `/api-docs`
- Docusaurus documentation site (80 pages across 12 sections)

---

## Monorepo Structure

```
guildserver-paas/
├── apps/
│   ├── api/              # Express.js + tRPC v10 API server (port 4000)
│   ├── web/              # Next.js 15 App Router frontend (port 3000)
│   └── docs/             # Docusaurus 3 documentation site (port 3001)
├── packages/
│   ├── database/         # Drizzle ORM schemas, migrations, seeds
│   └── cli/              # GuildServer CLI (gs command)
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

Monorepo tooling: **pnpm workspaces** + **Turborepo**.

---

## Technology Stack

### Frontend (`apps/web`)

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | Next.js (App Router) | 15.0.3 |
| UI Library | React | 18.2.0 |
| Language | TypeScript | 5.3.3 |
| Styling | Tailwind CSS + tailwindcss-animate | 3.4.0 |
| Component Primitives | Radix UI | Multiple (accordion, alert-dialog, avatar, checkbox, dialog, dropdown-menu, label, navigation-menu, popover, progress, scroll-area, select, separator, slot, switch, tabs, toast, tooltip) |
| Component Patterns | class-variance-authority + tailwind-merge (shadcn/ui) | -- |
| Animations | Framer Motion | 10.16.16 |
| Charts | Recharts | 2.9.3 |
| Forms | React Hook Form + @hookform/resolvers + Zod | 7.48.2 / 3.22.4 |
| Auth | next-auth | 4.24.5 |
| Dark Mode | next-themes | 0.2.1 |
| API Client | @trpc/client + @trpc/react-query + @tanstack/react-query | 10.45.0 / 4.36.1 |
| State Management | zustand | 4.4.7 |
| Icons | lucide-react | 0.303.0 |
| Toasts | sonner | 1.3.1 |
| Date Utilities | date-fns | 3.0.6 |
| Serialization | superjson | 2.2.1 |

### Backend (`apps/api`)

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | Express.js | 4.18.2 |
| Language | TypeScript | 5.3.3 |
| API Layer | tRPC | 10.45.0 |
| ORM | Drizzle ORM | 0.29.1 |
| Job Queue | BullMQ | 5.1.9 |
| Redis Client | ioredis | 5.3.2 |
| Docker API | Dockerode | 4.0.2 |
| Kubernetes | @kubernetes/client-node | 0.20.0 |
| Billing | Stripe | 20.4.0 |
| WebSocket | ws | 8.16.0 |
| Auth Tokens | jsonwebtoken | 9.0.2 |
| Password Hashing | bcryptjs | 2.4.3 |
| Git Operations | simple-git | 3.22.0 |
| Email | nodemailer | 6.9.8 |
| Logging | winston | 3.11.0 |
| Security Headers | helmet | 7.1.0 |
| CORS | cors | 2.8.5 |
| Compression | compression | 1.7.4 |
| API Docs | swagger-ui-express | 5.0.1 |
| YAML Parsing | js-yaml | 4.1.0 |
| HTTP Logging | morgan | 1.10.0 |
| Validation | Zod | 3.22.4 |
| Env Config | dotenv | 17.2.1 |

### Database (`packages/database`)

| Technology | Version |
|-----------|---------|
| PostgreSQL | 15 |
| Drizzle ORM | 0.29.1 |
| drizzle-kit | 0.20.6 |
| postgres (driver) | 3.4.3 |

### Infrastructure

| Technology | Purpose |
|-----------|---------|
| Docker + Docker Compose | Containerization and orchestration |
| Traefik v3.6 | Reverse proxy, automatic SSL via Let's Encrypt |
| Redis 7 | Job queues (BullMQ) and caching |
| GitHub Actions | CI/CD pipelines |

### CLI (`packages/cli`)

| Technology | Version |
|-----------|---------|
| commander | 12.0.0 |
| chalk | 5.3.0 |
| ora | 8.0.1 |
| inquirer | 9.2.12 |

Binary names: `guildserver` and `gs`.

### Documentation (`apps/docs`)

| Technology | Details |
|-----------|---------|
| Docusaurus | 3.9 with React 18 |
| Content | 80 documentation pages across 12 sections |

---

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** (any recent version)
- **Docker** and **Docker Compose**
- **PostgreSQL** 15+ (or use the Docker Compose service)
- **Redis** 7+ (or use the Docker Compose service)
- **Git**

---

## Setup -- Windows

### Step 1: Install Prerequisites

Install Node.js 20+ from [https://nodejs.org](https://nodejs.org).

Install pnpm:

```powershell
npm install -g pnpm
```

Install Docker Desktop from [https://docker.com/products/docker-desktop](https://docker.com/products/docker-desktop) (enable the WSL2 backend).

Install Git from [https://git-scm.com](https://git-scm.com).

### Step 2: Clone the Repository

```powershell
git clone https://github.com/guildserver/guildserver-paas.git
cd guildserver-paas
```

### Step 3: Install Dependencies

```powershell
pnpm install
```

### Step 4: Start Infrastructure (PostgreSQL + Redis)

**Option A -- Using Docker Compose (recommended):**

```powershell
docker network create guildserver
docker-compose up -d postgres redis traefik
```

This starts:

- PostgreSQL on port **5433** (mapped from container port 5432)
- Redis on port **6380** (mapped from container port 6379)
- Traefik on ports **80**, **443**, **8080** (dashboard)

**Option B -- Using local PostgreSQL + Redis:**

Install PostgreSQL 15 and Redis 7, then create the database:

```powershell
createdb -U postgres guildserver
```

### Step 5: Configure Environment Variables

```powershell
copy .env.example .env
```

Edit `.env` with the minimum required variables:

```
DATABASE_URL="postgresql://guildserver:password123@localhost:5433/guildserver"
REDIS_URL="redis://localhost:6380"
JWT_SECRET="your-secure-random-string-here"
NEXTAUTH_SECRET="another-secure-random-string-here"
NEXTAUTH_URL="http://localhost:3000"
NODE_ENV="development"
```

Also create or verify `apps/web/.env`:

```
NODE_ENV="development"
NEXT_PUBLIC_API_URL="/trpc"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-nextauth-secret-change-in-production"
```

### Step 6: Run Database Migrations and Seed

```powershell
pnpm run db:migrate
pnpm run db:seed --filter @guildserver/database
```

To seed billing plans:

```powershell
cd packages/database
pnpm run db:seed-plans
cd ../..
```

### Step 7: Start Development Servers

```powershell
pnpm run dev
```

This starts all apps via Turborepo:

- **Web UI:** http://localhost:3000
- **API server:** http://localhost:4000
- **API docs (Swagger):** http://localhost:4000/api-docs
- **Health check:** http://localhost:4000/health

Or start each app individually:

```powershell
# Terminal 1 - API
cd apps/api && pnpm run dev

# Terminal 2 - Web
cd apps/web && pnpm run dev

# Terminal 3 - Docs (optional)
cd apps/docs && pnpm run dev
```

### Step 8: Verify Installation

Open http://localhost:3000 in your browser. You should see the GuildServer landing page. Click "Get Started" to create your first account.

---

## Setup -- Linux (Ubuntu/Debian)

### Step 1: Install Prerequisites

```bash
# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose (v2)
sudo apt-get install -y docker-compose-plugin

# Install Git
sudo apt-get install -y git
```

### Step 2: Clone and Install

```bash
git clone https://github.com/guildserver/guildserver-paas.git
cd guildserver-paas
pnpm install
```

### Step 3: Start Infrastructure

```bash
docker network create guildserver
docker compose up -d postgres redis traefik
```

### Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with the minimum required variables (same values as the Windows section above).

Also create or verify `apps/web/.env`:

```bash
cat > apps/web/.env << 'EOF'
NODE_ENV="development"
NEXT_PUBLIC_API_URL="/trpc"
NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-nextauth-secret-change-in-production"
EOF
```

### Step 5: Database Setup

```bash
pnpm run db:migrate
cd packages/database && pnpm run db:seed && pnpm run db:seed-plans && cd ../..
```

### Step 6: Start Development

```bash
pnpm run dev
```

### Step 7: Verify

```bash
curl http://localhost:4000/health
# Should return: {"status":"ok","timestamp":"...","version":"1.0.0","environment":"development"}
```

---

## Docker Compose Services

| Service | Image | Container Name | Host Port(s) | Container Port(s) | Health Check |
|---------|-------|----------------|---------------|--------------------|-----------------------------|
| traefik | traefik:v3.6 | guildserver-traefik | 80, 443, 8080 | 80, 443, 8080 | -- |
| postgres | postgres:15-alpine | guildserver-postgres | 5433 | 5432 | `pg_isready -U guildserver` |
| redis | redis:7-alpine | guildserver-redis | 6380 | 6379 | `redis-cli ping` |
| api | Custom (Dockerfile) | guildserver-api | 4000 | 4000 | -- |
| web | Custom (Dockerfile) | guildserver-web | 3000 | 3000 | -- |

**Networks:**

- `guildserver-network` -- internal bridge network for inter-service communication
- `guildserver` -- external network for Traefik routing

**Volumes:**

- `postgres_data` -- persistent PostgreSQL data
- `redis_data` -- persistent Redis data

**Full stack with Docker only:**

```bash
docker network create guildserver
docker-compose up -d
```

---

## Environment Variables

Below is the complete list of environment variables. Variables marked **Required** must be set for the application to start.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://guildserver:password@localhost:5433/guildserver` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6380` |
| `JWT_SECRET` | Secret for signing JWT tokens | (random string) |
| `NEXTAUTH_SECRET` | Secret for NextAuth session encryption | (random string) |
| `NEXTAUTH_URL` | NextAuth base URL | `http://localhost:3000` |
| `NODE_ENV` | Runtime environment | `development` or `production` |

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Frontend URL | `http://localhost:3000` |
| `API_URL` | API URL | `http://localhost:4000` |
| `FRONTEND_URL` | Used by API for CORS origin | -- |
| `PORT` | API server port | `4000` |
| `LOG_LEVEL` | Winston log level | `info` |
| `DEBUG` | Enable debug mode | `false` |

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_DIRECT_URL` | Direct PostgreSQL connection (for migrations) | (optional) |
| `REDIS_PASSWORD` | Redis password | (empty) |

### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_EXPIRES_IN` | JWT token TTL | `7d` |

### OAuth (Optional)

GitHub and Google OAuth are configured in `apps/api/src/routes/oauth.ts`. Environment variables for OAuth are set via the OAuth provider configurations.

### Email (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | -- |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | -- |
| `SMTP_PASS` | SMTP password | -- |
| `EMAIL_FROM` | Sender email address | `noreply@guildserver.com` |

### Storage (Optional)

| Variable | Description |
|----------|-------------|
| `S3_ENDPOINT` | S3-compatible endpoint URL |
| `S3_REGION` | S3 region |
| `S3_BUCKET` | S3 bucket name |
| `S3_ACCESS_KEY` | S3 access key |
| `S3_SECRET_KEY` | S3 secret key |

### Docker

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_HOST` | Docker daemon socket | `unix:///var/run/docker.sock` |
| `DOCKER_CERT_PATH` | Docker TLS certificate path | -- |
| `DOCKER_TLS_VERIFY` | Enable Docker TLS verification | -- |

### Kubernetes (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `KUBECONFIG_PATH` | Path to kubeconfig file | -- |
| `KUBERNETES_NAMESPACE` | Default Kubernetes namespace | `guildserver` |

### Monitoring (Optional)

| Variable | Description |
|----------|-------------|
| `PROMETHEUS_URL` | Prometheus server URL |
| `GRAFANA_URL` | Grafana server URL |
| `JAEGER_URL` | Jaeger tracing URL |

### Billing (Optional)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key for billing |

Stripe price IDs are stored in the `plans` database table.

### Enterprise (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `ENTERPRISE_MODE` | Enable enterprise features | `false` |
| `SAML_ENABLED` | Enable SAML authentication | -- |
| `SAML_ENTITY_ID` | SAML entity ID | -- |
| `SAML_SSO_URL` | SAML SSO endpoint URL | -- |
| `SAML_CERT` | SAML certificate | -- |
| `OIDC_ENABLED` | Enable OIDC authentication | -- |
| `OIDC_ISSUER` | OIDC issuer URL | -- |
| `OIDC_CLIENT_ID` | OIDC client ID | -- |
| `OIDC_CLIENT_SECRET` | OIDC client secret | -- |
| `COMPLIANCE_ENABLED` | Enable compliance frameworks | -- |
| `SOC2_ENABLED` | Enable SOC2 compliance | -- |
| `HIPAA_ENABLED` | Enable HIPAA compliance | -- |
| `PCI_ENABLED` | Enable PCI-DSS compliance | -- |

### Multi-Region (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `MULTI_REGION_ENABLED` | Enable multi-region deployment | `false` |
| `PRIMARY_REGION` | Primary region identifier | -- |
| `SECONDARY_REGIONS` | Comma-separated secondary regions | -- |

### SSL

| Variable | Description | Default |
|----------|-------------|---------|
| `ACME_EMAIL` | Email for Let's Encrypt certificate registration | `admin@guildserver.com` |

### Development

| Variable | Description | Default |
|----------|-------------|---------|
| `SENTRY_DSN` | Sentry error tracking DSN | -- |
| `GIT_CLONE_DIR` | Directory for cloned repositories | `.builds/` |
| `API_PUBLIC_URL` | Public API URL for webhook generation | -- |

### Web App (`apps/web/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | tRPC endpoint path | `/trpc` |
| `NEXT_PUBLIC_API_BASE_URL` | Full API server URL for WebSocket and OAuth | `http://localhost:4000` |

---

## Scripts

All scripts are run from the repository root using `pnpm run`.

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
| `clean` | Clean all build artifacts and node_modules |
| `db:generate` | Generate Drizzle migrations |
| `db:migrate` | Run database migrations |
| `db:studio` | Open Drizzle Studio (GUI) |
| `db:seed` | Seed database |
| `docker:build` | Build Docker image |
| `docker:run` | Docker Compose up |
| `docker:stop` | Docker Compose down |
| `k8s:deploy` | kubectl apply Kubernetes manifests |
| `terraform:init` | Terraform init |
| `terraform:plan` | Terraform plan |
| `terraform:apply` | Terraform apply |

---

## API Architecture

### Middleware Stack

The Express middleware is applied in the following order:

1. **Helmet** -- security headers
2. **CORS** -- origin set to `FRONTEND_URL`, credentials enabled
3. **Compression** -- gzip response compression
4. **Morgan** -- HTTP request logging (combined format)
5. **Express JSON parser** -- 10 MB body limit
6. **Express URL-encoded parser** -- 10 MB body limit

### REST Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/health` | Health check | None |
| GET | `/api-docs` | Swagger UI | None |
| GET | `/api-docs.json` | OpenAPI spec | None |
| POST | `/webhooks/github` | GitHub webhook handler | Webhook signature |
| POST | `/webhooks/gitlab` | GitLab webhook handler | Webhook signature |
| POST | `/webhooks/git` | Generic Git webhook handler | Webhook signature |
| GET | `/auth/github` | GitHub OAuth initiation | None |
| GET | `/auth/github/callback` | GitHub OAuth callback | None |
| GET | `/auth/google` | Google OAuth initiation | None |
| GET | `/auth/google/callback` | Google OAuth callback | None |
| POST | `/webhooks/stripe` | Stripe webhook (raw body) | Stripe signature |

### tRPC API

- **Mount path:** `/trpc`
- **Transformer:** SuperJSON
- **Authentication:** JWT via `Authorization: Bearer <token>` header
- **Context:** `req`, `res`, `db`, `user`, `isAuthenticated`, `isAdmin`
- **Procedure types:** `publicProcedure`, `protectedProcedure`, `adminProcedure`, `organizationProcedure`

### tRPC Routers

The API exposes 17 tRPC routers with the following procedures:

**1. auth**
`register`, `login`, `me`, `updateProfile`, `changePassword`, `logout`

**2. organization**
`list`, `getById`, `create`, `update`, `delete`, `getMembers`, `updateMember`, `removeMember`

**3. project**
`list`, `getById`, `create`, `update`, `delete`

**4. application**
`list`, `getById`, `create`, `update`, `updatePreviewSettings`, `delete`, `deploy`, `getLogs`, `getMetrics`, `restart`, `scale`, `listGithubRepos`, `listGithubBranches`

**5. database**
`list`, `getById`, `create`, `update`, `delete`, `restart`, `getConnectionInfo`

**6. deployment**
`listAll`, `list`, `getById`, `cancel`, `getLogs`, `rollback`, `retry`, `activity`

**7. domain**
`list`, `add`, `generateAutoUrl`, `verify`, `setPrimary`, `remove`, `getCertificateStatus`, `getAccessUrl`

**8. environment**
`list`, `getDecrypted`, `set`, `bulkSet`, `delete`, `deleteAll`

**9. webhook**
`getWebhookUrl`, `listDeliveries`, `sendTestWebhook`

**10. monitoring**
`recordMetric`, `getMetrics`, `getApplicationMetrics`, `getOrganizationMetrics`, `getSystemHealth`, `getAlerts`, `getApplicationsSummary`

**11. kubernetes**
`listClusters`, `getClusterById`, `createCluster`, `updateCluster`, `deleteCluster`, `deployToCluster`, `listDeployments`, `getClusterStatus`, `getClusterMetrics`

**12. workflow**
`listTemplates`, `getTemplateById`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `executeWorkflow`, `listExecutions`, `getExecutionById`, `getApprovalRequests`, `approveRequest`

**13. notification**
`list`, `getUnreadCount`, `markRead`, `markAllRead`, `getPreferences`, `updatePreferences`, `getSlackConfig`, `setSlackConfig`, `testSlackNotification`

**14. github**
`getConnectionStatus`, `getConnectedAccounts`, `listRepos`, `listBranches`, `disconnect`

**15. user**
`list` (admin), `getById`, `update` (admin), `delete` (admin), `getActivity`, `getStats`, `impersonate` (admin)

**16. billing**
`getPlans`, `getCurrentPlan`, `getUsage`, `getInvoices`, `getPaymentMethods`, `createCheckoutSession`, `createPortalSession`, `cancelSubscription`, `resumeSubscription`, `setSpendLimit`, `getSpendStatus`, `startTrial`

**17. audit**
`getLogs`, `createLog`, `getStatistics`, `exportLogs`, `getComplianceReport`

### WebSocket Server

- **Path:** `/ws`
- **Authentication:** JWT via query parameter `?token=` or `Authorization` header
- **Events:** `deployment_status`, log streaming, real-time metrics
- **Server functions:** `broadcastToUser(userId, message)`, `getConnectedClients()`

### Background Job Queues

Powered by BullMQ with Redis as the backing store.

| Queue | Jobs |
|-------|------|
| `deployment` | `deploy-application`, `build-application` |
| `monitoring` | Periodic metrics collection, health checks, container sync |
| `backup` | Database backups, configuration backups |

---

## Database Schema

The PostgreSQL database contains 28 tables managed by Drizzle ORM. All schema definitions are in `packages/database/src/schema/index.ts`.

### Core Tables

**users**
`id`, `email`, `name`, `password`, `avatar`, `role` (admin, user), `emailVerified`, `twoFactorSecret`, `twoFactorEnabled`, `lastLogin`, `preferences`, `createdAt`, `updatedAt`

**organizations**
`id`, `name`, `slug`, `logo`, `description`, `metadata`, `ownerId`, `stripeCustomerId`, `createdAt`, `updatedAt`

**members**
`id`, `userId`, `organizationId`, `role` (owner, admin, member), `permissions`, `projectsAccess`, `applicationsAccess`, `joinedAt`, `updatedAt`

**oauthAccounts**
`id`, `userId`, `provider`, `providerAccountId`, `accessToken`, `refreshToken`, `tokenExpiresAt`, `scope`, `createdAt`, `updatedAt`

**projects**
`id`, `name`, `description`, `organizationId`, `environment`, `settings`, `createdAt`, `updatedAt`

### Applications and Deployments

**applications**
`id`, `name`, `appName`, `description`, `projectId`, `sourceType` (github, gitlab, bitbucket, gitea, docker, git, drop), `repository`, `branch`, `buildPath`, `dockerfile`, `buildType` (dockerfile, nixpacks, heroku, paketo, static, railpack), `buildArgs`, `environment`, `dockerImage`, `dockerTag`, `containerPort`, `memoryReservation`, `memoryLimit`, `cpuReservation`, `cpuLimit`, `replicas`, `autoDeployment`, `previewDeployments`, `mainBranch`, `previewTtlHours`, `status`, `createdAt`, `updatedAt`

**deployments**
`id`, `title`, `description`, `status`, `applicationId`, `databaseId`, `gitCommitSha`, `buildLogs`, `deploymentLogs`, `imageTag`, `deploymentType`, `triggeredBy`, `sourceDeploymentId`, `isPreview`, `previewBranch`, `startedAt`, `completedAt`, `createdAt`

**databases**
`id`, `name`, `type`, `projectId`, `databaseName`, `username`, `password`, `dockerImage`, `command`, `environment`, `memoryLimit`, `cpuLimit`, `externalPort`, `status`, `createdAt`, `updatedAt`

### Domains and Certificates

**domains**
`id`, `domain`, `applicationId`, `isPrimary`, `isAutoGenerated`, `verificationToken`, `verificationMethod`, `verified`, `status`, `certificateId`, `forceHttps`, `createdAt`, `updatedAt`

**certificates**
`id`, `domain`, `certificateChain`, `privateKey`, `issuer`, `status`, `issuedAt`, `expiresAt`, `lastRenewalAt`, `autoRenew`, `createdAt`, `updatedAt`

**environmentVariables**
`id`, `applicationId`, `key`, `value`, `scope` (production, preview, development), `isSecret`, `createdAt`, `updatedAt`

**webhookDeliveries**
`id`, `applicationId`, `provider`, `eventType`, `payload`, `headers`, `statusCode`, `response`, `delivered`, `error`, `processingTimeMs`, `createdAt`

### Notifications

**notifications**
`id`, `userId`, `type`, `title`, `message`, `metadata`, `read`, `createdAt`

**notificationPreferences**
`id`, `userId`, `event`, `emailEnabled`, `slackEnabled`, `inAppEnabled`, `createdAt`, `updatedAt`

**slackConfigs**
`id`, `organizationId`, `webhookUrl`, `channelName`, `enabled`, `createdAt`

### Kubernetes

**kubernetesClusters**
`id`, `name`, `kubeconfig`, `endpoint`, `version`, `provider`, `region`, `status` (active, inactive, error, pending, maintenance), `metadata`, `organizationId`, `createdAt`, `updatedAt`

**k8sDeployments**
`id`, `name`, `namespace`, `clusterId`, `applicationId`, `helmChartName`, `helmChartVersion`, `values`, `status`, `replicas`, `readyReplicas`, `createdAt`, `updatedAt`

### Billing

**plans**
`id`, `name`, `slug` (hobby, pro, enterprise), `description`, `priceMonthly`, `priceYearly`, `stripePriceIdMonthly`, `stripePriceIdYearly`, `limits`, `features`, `sortOrder`, `isActive`, `createdAt`, `updatedAt`

**subscriptions**
`id`, `organizationId`, `planId`, `status` (active, trialing, past_due, canceled, paused, incomplete), `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialStart`, `trialEnd`, `seats`, `usageCreditCents`, `spendLimitCents`, `metadata`, `createdAt`, `updatedAt`

**invoices**
`id`, `organizationId`, `subscriptionId`, `stripeInvoiceId`, `number`, `status` (draft, open, paid, void, uncollectible), `amountDueCents`, `amountPaidCents`, `currency`, `periodStart`, `periodEnd`, `invoiceUrl`, `pdfUrl`, `paidAt`, `createdAt`

**usageRecords**
`id`, `organizationId`, `metric`, `value`, `periodStart`, `periodEnd`, `reportedToStripe`, `stripeUsageRecordId`, `createdAt`

**paymentMethods**
`id`, `organizationId`, `stripePaymentMethodId`, `type`, `cardBrand`, `cardLast4`, `cardExpMonth`, `cardExpYear`, `isDefault`, `createdAt`

### Enterprise

**ssoProviders**
`id`, `name`, `providerType` (saml, oidc, ldap, azure-ad, google, github), `configuration`, `organizationId`, `enabled`, `createdAt`, `updatedAt`

**workflowTemplates**
`id`, `name`, `description`, `definition`, `version`, `status` (draft, active, inactive, archived), `organizationId`, `createdBy`, `createdAt`, `updatedAt`

**workflowExecutions**
`id`, `templateId`, `name`, `status` (pending, running, paused, completed, failed, cancelled), `currentStep`, `context`, `errorMessage`, `startedAt`, `completedAt`, `triggeredBy`, `organizationId`, `createdAt`

**approvalRequests**
`id`, `workflowExecutionId`, `stepId`, `approverId`, `approverType`, `status` (pending, approved, rejected, expired), `comments`, `requestedAt`, `respondedAt`, `expiresAt`, `organizationId`

### Monitoring and Audit

**metrics**
`id`, `name`, `type`, `value`, `labels`, `timestamp`, `applicationId`, `organizationId`

**auditLogs**
`id`, `userId`, `organizationId`, `action`, `resourceType`, `resourceId`, `resourceName`, `metadata`, `ipAddress`, `userAgent`, `timestamp`, `sessionId`

---

## Services

The following service modules are located in `apps/api/src/services/`:

| Service | File | Description |
|---------|------|-------------|
| Docker | `docker.ts` | Docker container lifecycle management (deploy, restart, stop, logs, stats, network management). Network: `guildserver`, container prefix: `gs` |
| Container Manager | `container-manager.ts` | Sync container statuses, health checks, metrics collection |
| Git Provider | `git-provider.ts` | Clone repositories, verify webhook signatures (GitHub/GitLab), parse push events, list repos and branches |
| Builder | `builder.ts` | Build Docker images. Supports: dockerfile, nixpacks, heroku, paketo, static, railpack |
| Kubernetes | `kubernetes.ts` | Kubernetes cluster management, Helm integration, deployment management |
| Metrics Collector | `metrics-collector.ts` | Periodic metrics collection and storage |
| Notification | `notification.ts` | Multi-channel notifications (email, Slack, in-app). Events: deployment_success, deployment_failed, preview_created, preview_expired, certificate_expiring, webhook_failed, member_added, member_removed |
| Usage Meter | `usage-meter.ts` | Track deployments and build minutes, check plan limits |
| Spend Manager | `spend-manager.ts` | Calculate overage costs, check spend limits. Rates: $0.001/deployment, $0.02/build-minute, $0.10/GB-storage, $0.05/GB-bandwidth |
| Stripe | `stripe.ts` | Stripe checkout sessions, portal sessions, subscription management |
| Enterprise Auth | `enterprise-auth.ts` | SAML, OIDC, and LDAP authentication providers |
| CI/CD | `cicd.ts` | CI/CD pipeline management, GitHub Actions and GitLab CI integration |
| Compliance | `compliance.ts` | SOC2, HIPAA, and PCI-DSS compliance frameworks |

---

## Web App Pages

### Public Pages

| Path | Description |
|------|-------------|
| `/` | Landing page with hero section and feature highlights |
| `/pricing` | Pricing plans comparison |

### Auth Pages

| Path | Description |
|------|-------------|
| `/auth/login` | Email/password login with GitHub and Google OAuth |
| `/auth/register` | Account registration |
| `/auth/callback` | OAuth callback handler |

### Dashboard Pages (authenticated)

| Path | Description |
|------|-------------|
| `/dashboard` | Overview with stats, deployment activity chart, recent apps, system status |
| `/dashboard/applications` | Applications list with status badges |
| `/dashboard/applications/[id]` | App detail page (deploy, logs, env vars, domains, metrics) |
| `/dashboard/deployments` | Deployments list with filtering |
| `/dashboard/databases` | Database instances list |
| `/dashboard/templates` | Application templates |
| `/dashboard/workflows` | Workflow management |
| `/dashboard/monitoring` | System metrics and analytics |
| `/dashboard/notifications` | Notification center |
| `/dashboard/onboarding` | First-time setup wizard |
| `/dashboard/team` | Team and member management |
| `/dashboard/security` | Security settings |
| `/dashboard/settings` | Account and organization settings |
| `/dashboard/billing` | Plans, usage, and invoices |

---

## Authentication Flow

1. User registers via the `auth.register` tRPC procedure (password hashed with bcryptjs).
2. User logs in via `auth.login` (returns a signed JWT token).
3. The frontend stores the token in `localStorage` under the key `guildserver-token`.
4. All subsequent API requests include the header `Authorization: Bearer <token>`.
5. The tRPC context middleware verifies the JWT and looks up the user in the database.
6. OAuth flow: `GET /auth/github` redirects to GitHub, which redirects back to `GET /auth/github/callback`, which issues a JWT token.

---

## Logging

- **Library:** Winston
- **Transports:**
  - Console (development, with colors)
  - File: `logs/error.log` (production, errors only)
  - File: `logs/combined.log` (production, all levels)
- **Configuration:** Set `LOG_LEVEL` environment variable (default: `info`)

---

## Key Architectural Patterns

- **End-to-end type safety:** tRPC allows the frontend to import router types directly from the API, providing compile-time type checking across the network boundary.
- **BullMQ deployment pipeline:** A tRPC mutation enqueues a deployment job, a BullMQ worker processes the build and deploy steps, and WebSocket broadcasts status updates to connected clients.
- **WebSocket event buffering:** Deployment events are buffered by deployment ID and replayed when a client connects or learns the deployment ID, preventing missed events during the initial request/response cycle.
- **Container naming convention:** Docker containers are named `gs-{applicationId}` and placed on the `guildserver` Docker network.
- **Traefik Docker provider:** Containers receive Traefik labels for automatic routing and SSL certificate provisioning.
- **Centralized schema:** All Drizzle ORM schema definitions live in `packages/database/src/schema/index.ts`, shared across the API and any other packages that need database access.
- **Encrypted environment variables:** Application environment variables are encrypted with AES-256 before storage and decrypted on read via the `environment.getDecrypted` procedure.

---

## CI/CD (GitHub Actions)

Configuration file: `.github/workflows/test.yml`

### Jobs

| Job | Description |
|-----|-------------|
| `lint-and-typecheck` | ESLint and TypeScript type checking |
| `backend-tests` | API tests with PostgreSQL 15 and Redis 7 service containers |
| `frontend-tests` | Next.js tests |
| `e2e-tests` | Full-stack end-to-end tests with Playwright |
| `build-test` | Build all apps and Docker images |
| `security-audit` | npm audit and CodeQL analysis |
| `dependency-check` | Check for outdated dependencies |

### CI Environment

- Test database: `guildserver_test` (user: `test`, password: `test`)
- JWT secret: `test-jwt-secret-key-for-ci`

---

## Production Deployment

### Docker Compose (simplest)

```bash
docker network create guildserver
docker-compose up -d
```

This starts all services (Traefik, PostgreSQL, Redis, API, Web) with the configuration defined in `docker-compose.yml`.

### VPS Deployment

1. Install Docker and Docker Compose on your VPS.
2. Clone the repository.
3. Configure `.env` with production values (strong secrets, production database credentials, real domain).
4. Set `ACME_EMAIL` for Let's Encrypt SSL certificate registration.
5. Run `docker-compose up -d`.
6. Point your domain DNS A record to the VPS IP address.

### Supported Build Types

| Build Type | Description |
|-----------|-------------|
| Dockerfile | Custom Dockerfiles in the repository |
| Nixpacks | Auto-detection of language and framework (similar to Railway) |
| Heroku Buildpacks | Heroku-compatible buildpack support |
| Paketo | Cloud Native Buildpacks |
| Static | Static site hosting |
| Railpack | Rails-optimized builds |

---

## License

GuildServer is licensed under the [Apache License 2.0](LICENSE).
