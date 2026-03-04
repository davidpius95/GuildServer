---
sidebar_position: 4
title: Project Structure
description: Understand the GuildServer monorepo layout, workspace packages, and how the components connect.
---

# Project Structure

GuildServer is organized as a **pnpm monorepo** managed by **Turborepo**. The repository contains two application packages and two library packages, along with infrastructure configuration and scripts.

## Top-Level Layout

```
guildserver-paas/
├── apps/
│   ├── api/              # Express + tRPC backend API
│   ├── web/              # Next.js 15 frontend dashboard
│   └── docs/             # Docusaurus documentation site (this site)
├── packages/
│   ├── database/         # Drizzle ORM schemas, migrations, seeds
│   └── cli/              # Command-line tool (gs / guildserver)
├── scripts/
│   ├── dev.sh            # Development setup script
│   └── build.sh          # Production build script
├── data/                 # Docker volume data (gitignored)
├── docker-compose.yml    # Infrastructure services
├── turbo.json            # Turborepo pipeline configuration
├── pnpm-workspace.yaml   # Workspace definitions
├── package.json          # Root package with shared scripts
├── .env.example          # Environment variable template
└── README.md
```

## Workspaces

The monorepo defines two workspace globs in `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

This means every directory inside `apps/` and `packages/` is treated as an independent npm package with its own `package.json`.

---

## `apps/api` — Backend API

**Package name:** `@guildserver/api`

The API server is an Express application enhanced with tRPC for type-safe RPC calls, WebSocket support for real-time updates, and BullMQ for background job processing.

```
apps/api/
├── src/
│   ├── index.ts          # Express app setup, middleware, server startup
│   ├── trpc/             # tRPC context and root router
│   ├── routers/          # tRPC procedure routers (one per domain)
│   │   ├── application.ts
│   │   ├── auth.ts
│   │   ├── audit.ts
│   │   ├── billing.ts
│   │   ├── database.ts
│   │   ├── deployment.ts
│   │   ├── domain.ts
│   │   ├── environment.ts
│   │   ├── github.ts
│   │   ├── kubernetes.ts
│   │   ├── monitoring.ts
│   │   ├── notification.ts
│   │   ├── organization.ts
│   │   ├── project.ts
│   │   ├── user.ts
│   │   ├── webhook.ts
│   │   └── workflow.ts
│   ├── routes/           # Plain Express routes (webhooks, OAuth)
│   ├── services/         # Business logic layer (builder, deployer)
│   ├── queues/           # BullMQ queue definitions and workers
│   ├── websocket/        # WebSocket server for live logs
│   ├── swagger.ts        # Swagger/OpenAPI setup
│   └── utils/            # Shared utilities (logger, etc.)
├── package.json
└── tsconfig.json
```

**Key dependencies:**
- `express` + `@trpc/server` — HTTP + RPC
- `dockerode` — Docker API client for container management
- `@kubernetes/client-node` — Kubernetes API integration
- `bullmq` + `ioredis` — Background job queues
- `ws` — WebSocket server
- `stripe` — Payment processing
- `jsonwebtoken` + `bcryptjs` — Authentication
- `nodemailer` — Email notifications
- `simple-git` — Git operations for deployments
- `winston` — Structured logging

**Scripts:**
- `dev` — Start with hot reloading via `tsx watch`
- `build` — Compile TypeScript to `dist/`
- `start` — Run compiled output
- `test` — Run Jest test suite
- `db:generate` — Generate Drizzle migration files
- `db:studio` — Open Drizzle Studio GUI

---

## `apps/web` — Frontend Dashboard

**Package name:** `@guildserver/web`

The web dashboard is a Next.js 15 application with React 18, TailwindCSS, and Radix UI components. It communicates with the API exclusively through tRPC (type-safe client) and React Query for server state management.

```
apps/web/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── auth/         # Login and registration pages
│   │   ├── dashboard/    # Protected dashboard pages
│   │   │   ├── applications/
│   │   │   ├── deployments/
│   │   │   ├── databases/
│   │   │   └── ...
│   │   ├── layout.tsx    # Root layout (providers, theme)
│   │   └── page.tsx      # Landing / redirect page
│   ├── components/       # Reusable UI components
│   │   └── ui/           # Shadcn-style base components
│   ├── lib/              # Utilities, tRPC client setup
│   └── styles/           # Global CSS and Tailwind config
├── public/               # Static assets
├── package.json
├── next.config.js
├── tailwind.config.ts
├── postcss.config.js
└── tsconfig.json
```

**Key dependencies:**
- `next` (v15) + `react` (v18) — Framework and UI library
- `@trpc/client` + `@trpc/react-query` + `@tanstack/react-query` — Type-safe API client
- `@radix-ui/*` — Accessible UI primitives (dialog, dropdown, tabs, etc.)
- `tailwindcss` + `class-variance-authority` + `tailwind-merge` — Styling
- `lucide-react` — Icon library
- `react-hook-form` + `zod` — Form handling with validation
- `recharts` — Dashboard charts and graphs
- `zustand` — Client-side state management
- `framer-motion` — Animations
- `sonner` — Toast notifications
- `next-themes` — Dark/light mode

**Scripts:**
- `dev` — Start Next.js dev server on port 3000
- `build` — Production build
- `start` — Start production server
- `lint` — Run ESLint with Next.js config
- `typecheck` — TypeScript type checking

---

## `packages/database` — Database Package

**Package name:** `@guildserver/database`

This shared package contains the Drizzle ORM schema definitions, migration files, and seed scripts. Both `apps/api` and `apps/web` depend on this package for type-safe database access.

```
packages/database/
├── src/
│   ├── index.ts          # Database client export
│   ├── schema/
│   │   └── index.ts      # All table and relation definitions
│   ├── migrate.ts        # Migration runner
│   ├── seed.ts           # Development seed data
│   ├── seed-plans.ts     # Billing plan seed data
│   ├── migrate-billing.ts # Billing-specific migrations
│   └── backfill-subscriptions.ts
├── migrations/           # SQL migration files
├── package.json
└── tsconfig.json
```

**Database tables defined in the schema:**

| Category | Tables |
|----------|--------|
| **Core** | `organizations`, `users`, `oauth_accounts`, `members`, `projects`, `applications`, `databases`, `deployments` |
| **Domains & Certificates** | `domains`, `certificates`, `environment_variables` |
| **Webhooks** | `webhook_deliveries` |
| **Notifications** | `notifications`, `notification_preferences`, `slack_configs` |
| **Kubernetes** | `kubernetes_clusters`, `k8s_deployments` |
| **Billing** | `plans`, `subscriptions`, `invoices`, `usage_records`, `payment_methods` |
| **Enterprise Auth** | `sso_providers` |
| **Workflows** | `workflow_templates`, `workflow_executions`, `approval_requests` |
| **Monitoring** | `metrics` |
| **Audit** | `audit_logs` |

---

## `packages/cli` — Command-Line Interface

**Package name:** `@guildserver/cli`

A terminal-based management tool for GuildServer that provides commands for deploying, managing applications, and interacting with the API.

```
packages/cli/
├── src/
│   └── index.ts          # CLI entry point with Commander.js
├── package.json
└── tsconfig.json
```

**Binary names:** `gs` and `guildserver`

**Key dependencies:**
- `commander` — Command parsing and subcommand routing
- `chalk` — Terminal color output
- `ora` — Loading spinners
- `inquirer` — Interactive prompts

---

## Infrastructure Files

### `docker-compose.yml`

Defines five services:

| Service | Image | Host Port | Purpose |
|---------|-------|-----------|---------|
| `traefik` | `traefik:v3.6` | 80, 443, 8080 | Reverse proxy with auto-SSL |
| `postgres` | `postgres:15-alpine` | 5433 | Primary database |
| `redis` | `redis:7-alpine` | 6380 | Job queues and caching |
| `api` | Built from `apps/api/Dockerfile` | 4000 | Backend API |
| `web` | Built from `apps/web/Dockerfile` | 3000 | Frontend dashboard |

### `turbo.json`

Defines the Turborepo build pipeline with task dependencies:

- `build` depends on upstream `^build` outputs
- `dev` is persistent and never cached
- `test` depends on upstream `^build`
- `db:migrate`, `db:seed`, `db:generate` are never cached

### Root `package.json`

Provides convenience scripts that delegate to Turbo:

- `pnpm run dev` — Start all apps in development
- `pnpm run build` — Build all packages
- `pnpm run test` — Run all test suites
- `pnpm run lint` — Lint all packages
- `pnpm run db:migrate` — Run database migrations
- `pnpm run db:seed` — Seed development data
- `pnpm run db:studio` — Open Drizzle Studio

---

## Dependency Graph

```
@guildserver/web ─────► @guildserver/database
                              ▲
@guildserver/api ─────────────┘

@guildserver/cli  (standalone, talks to API over HTTP)
@guildserver/docs (standalone, no code dependencies)
```

Both `@guildserver/api` and `@guildserver/web` share `@guildserver/database` as a workspace dependency. The CLI operates independently, communicating with the API server over HTTP. The docs site has no code dependencies on other packages.

## Next Steps

- [Configuration](./configuration) — Complete environment variable reference
- [Architecture](/contributing/architecture) — Deep dive into the system design
- [Database Schema](/contributing/database-schema) — Detailed schema documentation
