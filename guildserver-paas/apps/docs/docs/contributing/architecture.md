---
title: "Architecture"
sidebar_position: 2
---

# Architecture

GuildServer is a monorepo-based PaaS (Platform-as-a-Service) that deploys applications as Docker containers with automatic reverse proxy routing, SSL, and monitoring.

## System Architecture

```
                         User / Browser
                                |
                    +---------------------------+
                    |      Traefik v3.6         |
                    |   Reverse Proxy + SSL     |
                    |     :80 / :443            |
                    +------+----------+---------+
                           |          |
             +-------------+    +-----+----------------+
             |  Next.js 15 |    |  Deployed Apps       |
             |  Web :3000  |    |  (Docker containers  |
             +------+------+    |   on guildserver     |
                    |           |   network)           |
                    | tRPC      +----------------------+
             +------+------+
             | Express.js  |
             | API :4000   |
             +--+---+---+--+
                |   |   |
   +------------+  ++-+ +----------+
   | PostgreSQL |  |Redis|  |Docker |
   |   :5432    |  |:6379|  |Engine |
   +------------+  +-----+  +------+
```

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15 (App Router) | React framework with server components |
| React | 18 | UI library |
| Tailwind CSS | 3.x | Utility-first CSS |
| shadcn/ui | Latest | Reusable component library |
| tRPC Client | 10.x | Type-safe API calls |
| TanStack Query | 4.x | Data fetching and caching |

### Backend

| Technology | Version | Purpose |
|---|---|---|
| Express.js | 4.x | HTTP server framework |
| tRPC | 10.x | Type-safe RPC framework |
| Drizzle ORM | Latest | Type-safe database access |
| BullMQ | Latest | Job queue for async processing |
| dockerode | Latest | Docker API client |
| Winston | Latest | Structured logging |
| ws | Latest | WebSocket server |
| Nodemailer | Latest | Email delivery |

### Infrastructure

| Technology | Version | Purpose |
|---|---|---|
| PostgreSQL | 15 | Primary database |
| Redis | 7 | Cache, job queue backend |
| Traefik | 3.6 | Reverse proxy, SSL, routing |
| Docker | Latest | Container runtime |

### Developer Tools

| Technology | Purpose |
|---|---|
| Turborepo | Monorepo build orchestration |
| pnpm | Fast package management with workspaces |
| TypeScript | Static typing across all packages |
| ESLint | Code linting |
| Prettier | Code formatting |
| Jest | Unit and integration testing |
| Playwright | End-to-end testing |

## Key Design Decisions

### tRPC for Type-Safe APIs

GuildServer uses tRPC v10 to share types between the frontend and backend without code generation. The API is defined as typed routers with Zod input validation:

```typescript
// Backend: define a procedure
export const monitoringRouter = createTRPCRouter({
  getMetrics: protectedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      timeRange: z.enum(["1h", "6h", "24h", "7d", "30d"]),
    }))
    .query(async ({ ctx, input }) => {
      // TypeScript knows the exact shape of input
      return metricsData;
    }),
});
```

### BullMQ for Async Deployment Processing

Deployments are processed asynchronously via BullMQ to avoid blocking API requests:

1. User triggers deploy via API
2. API creates a deployment record (status: `pending`)
3. API enqueues a job on the `deployment` queue
4. Deployment worker picks up the job (concurrency: 3)
5. Worker clones, builds, deploys, and updates status via WebSocket

Three queues are defined:

| Queue | Purpose | Concurrency |
|---|---|---|
| `deployment` | Build and deploy containers | 3 |
| `monitoring` | Health checks and metrics | 1 |
| `backup` | Database backups | 1 |

### Drizzle ORM for Type-Safe Database Access

Drizzle provides compile-time type safety for all database operations:

```typescript
export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).default("inactive"),
});

const app = await db.query.applications.findFirst({
  where: eq(applications.id, appId),
  with: { project: true, deployments: true },
});
```

### Traefik for Zero-Config Container Routing

When a container is deployed, GuildServer adds Docker labels that Traefik reads automatically. No configuration reload is needed -- Traefik watches the Docker socket for container events and updates routing in real time.

### WebSocket for Real-Time Updates

A WebSocket server on `/ws` provides:

- **Deployment progress** -- phase-by-phase status updates during builds
- **Build logs** -- streamed as they are generated
- **Container logs** -- real-time log tailing from Docker
- **Metrics updates** -- periodic resource usage broadcasts
- **Notifications** -- instant delivery of alerts

## Request Flow

### API Request (tRPC)

```
Browser
  -> Next.js page
    -> tRPC client (GET for queries, POST for mutations)
      -> Express.js middleware (CORS, auth)
        -> tRPC router -> Protected procedure (JWT)
          -> Zod validation -> Handler -> Drizzle ORM / Docker
        -> tRPC response
      -> TanStack Query cache
    -> React re-render
```

### Deployment Flow

```
User clicks "Deploy"
  -> tRPC mutation: application.deploy
    -> Create deployment record (status: pending)
    -> Enqueue BullMQ job -> Return deployment ID
  -> WebSocket: subscribe to deployment updates

BullMQ Worker picks up job:
  1. Validate configuration
  2. Clone repository (if git-based)
  3. Build Docker image (if needed) or pull from registry
  4. Stop existing container
  5. Create and start new container (with Traefik labels)
  6. Health check
  7. Update deployment status to "completed"
  8. Send notifications (in-app, email, Slack)

Each step broadcasts progress via WebSocket
```

### Container Routing

```
HTTP request for my-app.example.com
  -> Traefik receives on port 80/443
    -> Matches Host rule from container labels
    -> Routes to container internal port (auto-detected)
  -> Application serves response
```

## Package Dependencies

```
apps/web -------> packages/database (shared types)
apps/api -------> packages/database (ORM queries)
packages/cli ---> apps/api (HTTP/tRPC calls)
```

The `@guildserver/database` package exports the Drizzle schema, client, and type definitions used by both the API and web frontend.

## Source Files

| Directory | Contents |
|---|---|
| `apps/api/src/routers/` | tRPC route definitions |
| `apps/api/src/services/` | Business logic (docker, builder, notifications) |
| `apps/api/src/queues/` | BullMQ queue definitions and workers |
| `apps/api/src/websocket/` | WebSocket server and handlers |
| `apps/web/src/app/` | Next.js App Router pages |
| `apps/web/src/components/` | React UI components |
| `packages/database/src/schema/` | Drizzle table definitions |
| `packages/cli/src/commands/` | CLI command implementations |
