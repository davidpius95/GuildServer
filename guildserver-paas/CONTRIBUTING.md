# Contributing to GuildServer PaaS

Welcome to the GuildServer PaaS contributing guide. GuildServer is a private, proprietary Platform-as-a-Service project. This document outlines how to become a contributor, set up your environment, follow our code standards, and submit changes.

---

## Table of Contents

1. [Becoming a Private Contributor](#1-becoming-a-private-contributor)
2. [Getting Started as a Contributor](#2-getting-started-as-a-contributor)
3. [Code Standards](#3-code-standards)
4. [Pull Request Process](#4-pull-request-process)
5. [Testing](#5-testing)
6. [Adding New Features](#6-adding-new-features)
7. [Areas Open for Contribution](#7-areas-open-for-contribution)
8. [Communication](#8-communication)
9. [Code of Conduct](#9-code-of-conduct)
10. [License and IP](#10-license-and-ip)

---

## 1. Becoming a Private Contributor

GuildServer is a private/proprietary project. Contributors must be explicitly invited by the project owner. You cannot submit unsolicited pull requests.

### Requesting Access

To request contributor access, contact the project owner through one of these channels:

- **GitHub**: Open an issue on the repository (if you have read access) or contact the owner's GitHub profile directly.
- **Email**: Send an email to the project owner with the subject line "GuildServer Contributor Request".
- **Discord**: If you have access to the GuildServer Discord server, use the `#contributor-requests` channel.

### What to Provide

When requesting access, include the following:

- Your GitHub username
- Your areas of expertise (frontend, backend, DevOps, database, Kubernetes, etc.)
- What you want to work on or the area of the project you are interested in
- A brief summary of your relevant experience
- Links to previous open-source contributions or projects (optional but helpful)

### Confidentiality Requirements

- Contributors may be required to sign a Non-Disclosure Agreement (NDA) before being granted access to the repository.
- All code, architecture details, internal documentation, and business logic are confidential.
- Do not share any part of the codebase, screenshots of the application, or internal discussions publicly.
- Violations of confidentiality may result in immediate revocation of access and legal action.

### Access Levels

| Level | Description |
|---|---|
| **Read-only** | Can view the codebase and issues. Cannot push branches or open PRs. |
| **Contributor** | Can create branches, open PRs, and participate in code reviews. |
| **Maintainer** | Can approve and merge PRs, manage issues, and make architectural decisions. |

New contributors typically start at the Contributor level and may be promoted to Maintainer based on the quality and consistency of their contributions.

### Onboarding Process

1. The project owner grants you repository access on GitHub.
2. You are invited to the GuildServer Discord server for real-time communication.
3. You are assigned an onboarding buddy/mentor from the existing team.
4. You complete the development environment setup (see below).
5. You are assigned a small starter task to familiarize yourself with the codebase and workflow.

---

## 2. Getting Started as a Contributor

### Development Environment Setup

#### Prerequisites

Ensure you have the following installed:

- **Node.js** >= 20.0.0
- **pnpm** (package manager -- this is a pnpm workspace monorepo)
- **Docker** and **Docker Compose** (for PostgreSQL, Redis, and Traefik)
- **PostgreSQL 15** (runs via Docker)
- **Redis 7** (runs via Docker)
- **Git**

#### Clone the Repository

For internal team members:

```bash
git clone git@github.com:<org>/guildserver-paas.git
cd guildserver-paas
```

#### Install Dependencies

```bash
pnpm install
```

#### Start Infrastructure

Create the Docker network and start the backing services (PostgreSQL on port 5433, Redis on port 6380, Traefik on ports 80/443/8080):

```bash
docker network create guildserver
docker-compose up -d postgres redis traefik
```

#### Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. At a minimum you will need:

- `DATABASE_URL` -- defaults to `postgresql://guildserver:password123@localhost:5433/guildserver`
- `REDIS_URL` -- defaults to `redis://localhost:6380`
- `JWT_SECRET` -- any strong random string
- `FRONTEND_URL` -- defaults to `http://localhost:3000`

#### Run Database Migrations

```bash
pnpm run db:migrate
```

#### Seed the Database

```bash
cd packages/database
pnpm run db:seed
pnpm run db:seed-plans
cd ../..
```

The `db:seed` script populates initial data (users, organizations, sample projects). The `db:seed-plans` script creates the billing plan tiers (Hobby, Pro, Enterprise).

#### Start the Development Servers

```bash
pnpm run dev
```

This uses Turborepo to start all workspaces concurrently.

#### Verify Everything is Running

| Service | URL | Description |
|---|---|---|
| Web App | http://localhost:3000 | Next.js 15 frontend |
| API Server | http://localhost:3001/health | Express + tRPC backend health check |
| Swagger Docs | http://localhost:3001/api-docs | API documentation |
| Traefik Dashboard | http://localhost:8080 | Reverse proxy dashboard |

### Understanding the Codebase

GuildServer is a **pnpm workspace monorepo** managed by **Turborepo**.

#### Top-Level Structure

```
guildserver-paas/
├── apps/
│   ├── api/          # Express + tRPC backend (port 3001)
│   ├── web/          # Next.js 15 frontend (port 3000)
│   └── docs/         # Docusaurus 3 documentation (port 3001)
├── packages/
│   ├── database/     # Drizzle ORM schemas + migrations (@guildserver/database)
│   └── cli/          # CLI tool (gs command)
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

#### Backend: `apps/api/`

The API is an **Express** server with **tRPC** for type-safe API procedures and plain Express routes for webhooks and OAuth.

| Directory | Contents |
|---|---|
| `src/routers/` | 17 tRPC routers: auth, organization, project, application, database, deployment, user, kubernetes, workflow, monitoring, audit, environment, domain, webhook, notification, github, billing |
| `src/services/` | Business logic modules: docker, builder, git-provider, container-manager, kubernetes, metrics-collector, notification, stripe, spend-manager, usage-meter, cicd, compliance, enterprise-auth |
| `src/queues/` | BullMQ job queues: deployment, monitoring, backup |
| `src/websocket/` | WebSocket server for real-time deployment updates |
| `src/trpc/` | tRPC initialization, context creation, router composition, middleware (publicProcedure, protectedProcedure, adminProcedure, organizationProcedure) |
| `src/routes/` | Plain Express routes for webhooks (GitHub/GitLab), OAuth (GitHub + Google), and Stripe webhooks |
| `src/utils/` | Winston logger and helper utilities |

Key dependencies: Express, tRPC v10, BullMQ, Dockerode, Stripe, jsonwebtoken, bcryptjs, ioredis, ws, simple-git, Zod.

#### Frontend: `apps/web/`

The web app is a **Next.js 15** application using the **App Router**.

| Directory | Contents |
|---|---|
| `src/app/` | Next.js App Router pages and layouts |
| `src/components/` | UI components following shadcn/ui patterns (Radix UI + Tailwind CSS) |
| `src/components/ui/` | Base UI primitives (button, dialog, tabs, skeleton, drawer, etc.) |
| `src/components/motion/` | Framer Motion animation wrappers |
| `src/components/charts/` | Recharts-based data visualizations |
| `src/hooks/` | Custom hooks: useAuth, useDeploymentStream, useMediaQuery, useReducedMotion |
| `src/lib/` | Utility functions (cn, trpc client setup) |

Key dependencies: Next.js 15, React 18, tRPC React Query, Radix UI, Tailwind CSS, Framer Motion, Zustand, React Hook Form, Zod, Recharts, Lucide React.

#### Database: `packages/database/`

The database package uses **Drizzle ORM** with PostgreSQL.

| Directory | Contents |
|---|---|
| `src/schema/index.ts` | All 28 Drizzle table definitions with relations |
| `src/migrate.ts` | Migration runner |
| `src/seed.ts` | Database seeder |
| `src/seed-plans.ts` | Billing plans seeder (Hobby, Pro, Enterprise) |
| `src/backfill-subscriptions.ts` | Subscription backfill utility |
| `migrations/` | Generated SQL migration files |

The 28 tables cover: organizations, users, oauthAccounts, members, projects, applications, databases, deployments, domains, certificates, environmentVariables, webhookDeliveries, notifications, notificationPreferences, slackConfigs, kubernetesClusters, k8sDeployments, plans, subscriptions, invoices, usageRecords, paymentMethods, ssoProviders, workflowTemplates, workflowExecutions, approvalRequests, metrics, auditLogs.

---

## 3. Code Standards

### TypeScript

- **Strict mode** is enabled across all packages.
- All function parameters and return types must be explicitly typed.
- Use **Zod schemas** for runtime validation of all inputs and external data.
- Do not use `any`. Use `unknown` with type guards or proper type narrowing instead.
- Prefer `interface` for object shapes and `type` for unions/intersections.

### Frontend (`apps/web`)

- Use the `"use client"` directive at the top of files that contain client-side interactivity (hooks, event handlers, browser APIs).
- Follow **shadcn/ui patterns**: use the `cn()` utility (from `@/lib/utils`) for className merging with `clsx` + `tailwind-merge`.
- Use **Radix UI** primitives as the foundation for accessible, unstyled components.
- **Styling**: Tailwind CSS only. Do not use inline styles, CSS modules, or styled-components.
- **Global state**: Zustand stores.
- **Server state**: tRPC React Query hooks (via `@trpc/react-query` with `@tanstack/react-query` v4).
- **Forms**: React Hook Form with Zod resolver (`@hookform/resolvers/zod`).
- **Icons**: `lucide-react` only. Do not introduce other icon libraries.
- **Animations**: Framer Motion. Use the wrappers in `src/components/motion/` where available.
- **Loading states**: Use Skeleton components from `src/components/ui/skeleton.tsx` and follow existing loading patterns.
- **Error handling**: Use error boundaries and `error.tsx` files in the App Router.
- **Empty states**: Use the `EmptyState` component pattern.
- **Navigation**: Dashboard navigation items are defined in `src/app/dashboard/layout.tsx`.

### Backend (`apps/api`)

- All API endpoints must go through **tRPC routers**. Do not create raw Express routes except for webhooks, OAuth callbacks, or third-party integrations that require specific HTTP methods/headers.
- Use `protectedProcedure` for authenticated routes, `adminProcedure` for admin-only routes, and `publicProcedure` only for unauthenticated endpoints (login, register, health).
- **Input validation**: Every mutation and query must have a Zod input schema. No unvalidated user input.
- **Business logic** belongs in `src/services/`, not directly in router procedure handlers. Routers should be thin -- validate input, call a service, return the result.
- **Database queries**: Use the Drizzle ORM query builder. Import tables and the `db` instance from `@guildserver/database`.
- **Logging**: Use the Winston logger imported from `src/utils/logger.ts`. Do not use `console.log` in production code.
- **Error handling**: Throw `TRPCError` with the appropriate error code:
  - `UNAUTHORIZED` -- user is not authenticated
  - `FORBIDDEN` -- user lacks permission or has exceeded plan limits
  - `NOT_FOUND` -- requested resource does not exist
  - `BAD_REQUEST` -- invalid input that Zod did not catch
  - `CONFLICT` -- duplicate resource or state conflict
- **Billing enforcement**: Use `enforcePlanLimit()` and `enforceFeature()` from `src/trpc/trpc.ts` to check plan limits before resource-creating operations.
- **Background jobs**: Long-running operations (deployments, builds, monitoring) go through BullMQ queues, not synchronous request handlers.

### Database

- All schema changes go through `packages/database/src/schema/index.ts`. This is the single source of truth for the database schema.
- After modifying the schema, generate a migration:
  ```bash
  pnpm run db:generate
  ```
- Apply the migration:
  ```bash
  pnpm run db:migrate
  ```
- **Never** modify a migration file after it has been committed and merged. If a migration is wrong, create a new migration to fix it.
- Use **UUID primary keys** (`.primaryKey().defaultRandom()`).
- Add **indexes** for columns that are frequently queried, filtered, or joined on. See existing tables for patterns.
- Use **JSONB** columns for flexible metadata and configuration fields.
- Define **relations** in the same schema file using Drizzle's `relations()` helper.
- Update seed scripts (`seed.ts`, `seed-plans.ts`) if your schema change requires initial data.

### Git Conventions

#### Branch Naming

Use descriptive, prefixed branch names:

- `feature/kubernetes-cluster-management`
- `fix/websocket-connection-timeout`
- `refactor/extract-deployment-service`
- `docs/update-api-reference`
- `test/docker-service-unit-tests`
- `chore/update-dependencies`

#### Commit Messages

Follow the **Conventional Commits** format:

```
feat: add kubernetes cluster management
fix: resolve WebSocket connection timeout on idle sessions
refactor: extract deployment logic to dedicated service
docs: update API reference for billing endpoints
test: add unit tests for docker service
chore: update drizzle-orm to v0.30
```

Rules:
- Use imperative mood in the subject line ("add" not "added" or "adds").
- Keep the subject line under 72 characters.
- Use the body to explain **what** and **why**, not **how**.
- Reference issue numbers where applicable: `fix: resolve timeout (#42)`.

#### Commit Hygiene

- Keep commits **atomic** -- one logical change per commit.
- Do not commit generated files, `.env` files, `node_modules/`, or `.next/` build artifacts.
- **Rebase on `main`** before opening a PR to ensure a clean history.

---

## 4. Pull Request Process

### Before Opening a PR

1. Create a feature branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. Make your changes, following the code standards above.

3. Run all checks locally. Every one of these must pass:
   ```bash
   pnpm run typecheck    # TypeScript type checking across all packages
   pnpm run lint         # ESLint across all packages
   pnpm run test         # Jest tests
   pnpm run build        # Full production build
   ```

4. Rebase on the latest `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

### Opening a PR

Open a pull request against the `main` branch with:

- A clear, concise title (under 70 characters).
- A description that explains **what** changed and **why**.
- Screenshots or screen recordings for any UI changes.
- A link to the related GitHub issue.

### PR Template

Use this template for your PR description:

```markdown
## Summary
Brief description of what this PR does and why.

## Changes
- Specific change 1
- Specific change 2
- Specific change 3

## Testing
- How to test this PR locally
- What was tested (manual and automated)
- Edge cases considered

## Screenshots (if UI changes)
Before | After

## Related Issues
Closes #XXX
```

### Review and Merge

- At least **1 maintainer approval** is required before merging.
- All CI checks must pass (lint, typecheck, tests, build).
- Reviewers may request changes. Address all feedback before requesting re-review.
- PRs are **squash merged** into `main` to keep the commit history clean.
- Delete your feature branch after merge.

---

## 5. Testing

### Backend Tests

| Item | Detail |
|---|---|
| Framework | Jest + ts-jest |
| Location | `apps/api/tests/` (or co-located `*.test.ts` files) |
| Run all tests | `cd apps/api && pnpm run test` |
| Watch mode | `cd apps/api && pnpm run test:watch` |
| Coverage report | `cd apps/api && pnpm run test:coverage` |
| CI mode | `cd apps/api && pnpm run test:ci` |
| Test database | Use a separate `guildserver_test` database to avoid polluting dev data |

Testing guidelines:
- Write unit tests for all service functions.
- Mock external dependencies (Docker, Stripe, GitHub API) in tests.
- Test both success and error paths.
- Use descriptive test names that explain the expected behavior.

### Frontend Tests

| Item | Detail |
|---|---|
| Lint | `cd apps/web && pnpm run lint` |
| Type check | `cd apps/web && pnpm run typecheck` |

### End-to-End Tests

| Item | Detail |
|---|---|
| Framework | Playwright |
| Run | `npx playwright test` |

### Type Checking (All Packages)

```bash
pnpm run typecheck
```

This runs `tsc --noEmit` across all workspaces via Turborepo.

---

## 6. Adding New Features

### Adding a New tRPC Router

1. Create a new file: `apps/api/src/routers/your-feature.ts`

2. Define your procedures using the appropriate middleware:
   ```typescript
   import { z } from "zod";
   import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc/trpc";
   import { TRPCError } from "@trpc/server";

   export const yourFeatureRouter = createTRPCRouter({
     list: protectedProcedure
       .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
       .query(async ({ ctx, input }) => {
         // Call service layer
       }),

     create: protectedProcedure
       .input(z.object({ name: z.string().min(1).max(255) }))
       .mutation(async ({ ctx, input }) => {
         // Call service layer
       }),
   });
   ```

3. Register the router in `apps/api/src/trpc/router.ts`:
   ```typescript
   import { yourFeatureRouter } from "../routers/your-feature";

   export const appRouter = createTRPCRouter({
     // ... existing routers
     yourFeature: yourFeatureRouter,
   });
   ```

4. If the feature has complex business logic, create a corresponding service file in `apps/api/src/services/your-feature.ts`.

### Adding a New Database Table

1. Add the table definition in `packages/database/src/schema/index.ts`:
   ```typescript
   export const yourTable = pgTable("your_table", {
     id: uuid("id").primaryKey().defaultRandom(),
     name: varchar("name", { length: 255 }).notNull(),
     organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
     metadata: jsonb("metadata").default({}),
     createdAt: timestamp("created_at").defaultNow(),
     updatedAt: timestamp("updated_at").defaultNow(),
   }, (table) => ({
     organizationIdIdx: index("your_table_organization_id_idx").on(table.organizationId),
   }));
   ```

2. Add relations if the table references or is referenced by other tables:
   ```typescript
   export const yourTableRelations = relations(yourTable, ({ one }) => ({
     organization: one(organizations, {
       fields: [yourTable.organizationId],
       references: [organizations.id],
     }),
   }));
   ```

3. Export the table from the schema index (it is already exported by virtue of being in `index.ts`).

4. Generate the migration:
   ```bash
   pnpm run db:generate
   ```

5. Apply the migration:
   ```bash
   pnpm run db:migrate
   ```

6. Update seed scripts in `packages/database/src/` if the table needs initial data.

### Adding a New Dashboard Page

1. Create the page file: `apps/web/src/app/dashboard/your-page/page.tsx`

2. Start with the `"use client"` directive and follow the existing page pattern:
   ```typescript
   "use client"

   import { useAuth } from "@/hooks/use-auth"
   import { trpc } from "@/components/trpc-provider"
   import { Skeleton } from "@/components/ui/skeleton"
   import { EmptyState } from "@/components/empty-state"

   export default function YourPage() {
     const { isAuthenticated } = useAuth({ redirect: true })
     const query = trpc.yourFeature.list.useQuery({ limit: 20 })

     if (query.isLoading) {
       return <YourPageSkeleton />
     }

     if (!query.data || query.data.length === 0) {
       return <EmptyState title="No items yet" description="Create your first item to get started." />
     }

     return (
       <div>
         <h1 className="text-3xl font-bold tracking-tight">Your Page</h1>
         {/* Page content */}
       </div>
     )
   }
   ```

3. Add a navigation entry in `apps/web/src/app/dashboard/layout.tsx` by adding an item to the `navigation` array:
   ```typescript
   const navigation = [
     // ... existing items
     { name: "Your Page", href: "/dashboard/your-page", icon: YourIcon },
   ]
   ```

4. Follow these patterns consistently:
   - Skeleton loading states while data is fetching
   - Empty state component when there is no data
   - Error handling with error boundaries or inline error displays
   - Responsive design (mobile-first with Tailwind breakpoints)

### Adding a New Background Job

1. Define the queue in `apps/api/src/queues/setup.ts` or a dedicated file in `apps/api/src/queues/`:
   ```typescript
   export const yourQueue = new Queue("your-queue", { connection: redis });
   ```

2. Define the job data types with a Zod schema or TypeScript interface.

3. Create a worker with the processing logic:
   ```typescript
   const yourWorker = new Worker(
     "your-queue",
     async (job) => {
       logger.info("Processing job", { jobId: job.id, data: job.data });
       // Your processing logic
     },
     { connection: redis }
   );
   ```

4. Add worker event handlers for `completed` and `failed` events.

5. Register recurring jobs (if applicable) in the `initializeQueues()` function in `apps/api/src/queues/setup.ts`.

6. Enqueue jobs from your routers or services:
   ```typescript
   await yourQueue.add("job-name", { /* job data */ });
   ```

---

## 7. Areas Open for Contribution

The following areas are actively looking for contributions:

- **Performance optimization** -- Query optimization, caching strategies, frontend rendering performance
- **Test coverage improvement** -- Unit tests for services, integration tests for routers, E2E tests for critical workflows
- **Documentation improvements** -- API documentation, architecture guides, tutorials in `apps/docs/`
- **UI/UX refinements** -- Dashboard polish, responsive design improvements, animation tuning
- **Bug fixes** -- Check the GitHub Issues for bugs labeled `good-first-issue` or `help-wanted`
- **New integrations** -- Cloud providers (AWS, GCP, Azure), CI/CD tools, monitoring services
- **Kubernetes features** -- Cluster management enhancements, Helm chart support, multi-cluster deployment
- **CLI tool enhancements** -- New commands and improved developer experience for the `gs` CLI in `packages/cli/`
- **Accessibility improvements** -- ARIA attributes, keyboard navigation, screen reader support
- **Internationalization (i18n)** -- Translation infrastructure and language support
- **Billing and usage metering** -- Stripe integration improvements, usage tracking accuracy

---

## 8. Communication

| Channel | Purpose |
|---|---|
| **GitHub Issues** | Bug reports, feature requests, and task tracking |
| **GitHub Pull Requests** | Code contributions and code review |
| **Discord Server** | Real-time discussion, questions, and collaboration (invite link provided upon onboarding) |
| **Weekly Sync Calls** | Video calls for active contributors to discuss progress, blockers, and priorities |

Guidelines:
- Use GitHub Issues for anything that needs to be tracked long-term.
- Use Discord for quick questions, pairing sessions, and informal discussion.
- Tag the appropriate team members in PRs and issues for faster response.
- Be responsive to code review feedback -- aim to address comments within 48 hours.

---

## 9. Code of Conduct

All contributors are expected to maintain a professional and respectful environment.

- **Be respectful and professional** in all interactions, whether in code reviews, issues, or chat.
- **Provide constructive feedback** -- explain the reasoning behind your suggestions and offer alternatives.
- **Help onboard new contributors** -- answer questions, pair program, and share knowledge.
- **Document your code** -- write clear comments for complex logic, update docs when behavior changes.
- **Write tests for new features** -- untested code will not be merged.
- **Follow the established patterns** -- consistency is more important than personal preference. If you want to change a pattern, open an issue to discuss it first.
- **Ask questions when unsure** -- it is always better to ask than to guess. Use Discord or comment on the relevant issue/PR.
- **Do not push directly to `main`** -- all changes go through pull requests.

---

## 10. License and IP

- GuildServer PaaS is a **proprietary project**. It is not open source.
- All contributions become part of the GuildServer project and are owned by the project.
- Contributors retain credit for their work via Git history and contributor acknowledgments.
- **Do not share any part of the codebase publicly** -- this includes code snippets, screenshots, architecture diagrams, and internal documentation.
- **Do not use GuildServer code** in other projects, whether personal or commercial.
- Contributors may be required to sign a **Contributor License Agreement (CLA)** in addition to the NDA.
- If you have questions about intellectual property or licensing, contact the project owner before proceeding.

---

Thank you for contributing to GuildServer PaaS. Your work helps build a better platform for everyone. If you have any questions or need help getting started, reach out on Discord or open a GitHub issue.
