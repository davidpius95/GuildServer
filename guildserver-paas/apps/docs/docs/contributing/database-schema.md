---
title: "Database Schema"
sidebar_position: 3
---

# Database Schema

GuildServer uses PostgreSQL 15 with Drizzle ORM. The schema is defined in `packages/database/src/schema/index.ts` and contains 28 tables organized into functional groups.

## Schema Overview

### Core Tables

| Table | Description |
|---|---|
| `users` | User accounts with email, password, role, 2FA settings |
| `organizations` | Multi-tenant organizations (workspaces) |
| `members` | Organization membership with roles and granular permissions |
| `projects` | Logical grouping of applications within an organization |
| `applications` | Deployed applications with source, build, and Docker configuration |
| `databases` | Managed database instances (PostgreSQL, MySQL, MongoDB, Redis) |
| `deployments` | Deployment history with build logs, status, and rollback support |
| `oauth_accounts` | Linked OAuth provider identities (GitHub, Google) |

### Infrastructure Tables

| Table | Description |
|---|---|
| `domains` | Custom domains linked to applications with DNS verification |
| `certificates` | SSL certificate tracking (Let's Encrypt integration) |
| `environment_variables` | Scoped env vars (production/preview/development) with encryption |
| `webhook_deliveries` | Incoming webhook payloads and delivery status |

### Notification Tables

| Table | Description |
|---|---|
| `notifications` | In-app notification history per user |
| `notification_preferences` | Per-user, per-event channel toggles |
| `slack_configs` | Organization Slack webhook configuration |

### Enterprise Tables

| Table | Description |
|---|---|
| `sso_providers` | SSO configuration (SAML, OIDC, LDAP, Azure AD) |
| `kubernetes_clusters` | Kubernetes cluster connection details |
| `k8s_deployments` | Kubernetes deployment tracking with Helm chart info |
| `workflow_templates` | Deployment workflow definitions |
| `workflow_executions` | Workflow execution state and history |
| `approval_requests` | Approval gates within workflow executions |

### Billing Tables

| Table | Description |
|---|---|
| `plans` | Pricing tiers (Hobby, Pro, Enterprise) with limits and features |
| `subscriptions` | Organization-to-plan mapping with Stripe integration |
| `invoices` | Invoice records mirroring Stripe |
| `usage_records` | Metered usage per org (deployments, bandwidth, build minutes) |
| `payment_methods` | Cached card info from Stripe |

### Monitoring Tables

| Table | Description |
|---|---|
| `metrics` | Time-series container metrics (CPU, memory, network) |
| `audit_logs` | User action audit trail with IP and user agent |

## Key Relationships

```
organizations
  |-- members --> users
  |-- projects
  |     |-- applications
  |     |     |-- deployments
  |     |     |-- domains
  |     |     |-- environment_variables
  |     |     |-- metrics
  |     |     |-- webhook_deliveries
  |     |     \-- k8s_deployments
  |     \-- databases
  |           \-- deployments
  |-- subscriptions --> plans
  |-- invoices
  |-- usage_records
  |-- payment_methods
  |-- sso_providers
  |-- workflow_templates
  |     \-- workflow_executions
  |           \-- approval_requests
  |-- kubernetes_clusters
  |     \-- k8s_deployments
  |-- audit_logs
  \-- slack_configs

users
  |-- members (memberships)
  |-- oauth_accounts
  |-- notifications
  |-- notification_preferences
  |-- audit_logs
  \-- approval_requests
```

## Enums

The schema defines 15 PostgreSQL enums:

| Enum | Values |
|---|---|
| `user_role` | `admin`, `user` |
| `member_role` | `owner`, `admin`, `member` |
| `source_type` | `github`, `gitlab`, `bitbucket`, `gitea`, `docker`, `git`, `drop` |
| `build_type` | `dockerfile`, `nixpacks`, `heroku`, `paketo`, `static`, `railpack` |
| `cluster_status` | `active`, `inactive`, `error`, `pending`, `maintenance` |
| `sso_provider_type` | `saml`, `oidc`, `ldap`, `azure-ad`, `google`, `github` |
| `workflow_status` | `draft`, `active`, `inactive`, `archived` |
| `execution_status` | `pending`, `running`, `paused`, `completed`, `failed`, `cancelled` |
| `approval_status` | `pending`, `approved`, `rejected`, `expired` |
| `plan_slug` | `hobby`, `pro`, `enterprise` |
| `subscription_status` | `active`, `trialing`, `past_due`, `canceled`, `paused`, `incomplete` |
| `invoice_status` | `draft`, `open`, `paid`, `void`, `uncollectible` |
| `domain_status` | `pending`, `verifying`, `active`, `failed`, `expired` |
| `certificate_status` | `pending`, `provisioning`, `active`, `renewal`, `failed`, `expired` |
| `env_scope` | `production`, `preview`, `development` |

## Notable Table Details

### applications

The `applications` table is the most complex, containing configuration for source code, build pipeline, Docker settings, resource limits, and preview deployments:

```typescript
{
  // Identity
  id, name, appName, description, projectId,

  // Source
  sourceType,    // github | gitlab | docker | git | ...
  repository,    // Git URL or Docker image reference
  branch,        // Default: "main"
  buildPath,     // Subdirectory for monorepo builds

  // Build
  buildType,     // dockerfile | nixpacks | heroku | ...
  buildArgs,     // JSONB build arguments
  dockerfile,    // Custom Dockerfile path

  // Docker
  dockerImage, dockerTag, containerPort,

  // Resource Limits
  memoryReservation, memoryLimit,  // MB
  cpuReservation, cpuLimit,        // CPU cores (decimal)

  // Deployment
  replicas,          // Default: 1
  autoDeployment,    // Auto-deploy on git push
  previewDeployments, previewTtlHours, mainBranch,

  // Status
  status,  // inactive | deploying | running | stopped | failed
}
```

### deployments

Deployments track the full lifecycle of a deploy, including rollback and preview support:

```typescript
{
  id, title, description, status,
  applicationId, databaseId,

  // Git info
  gitCommitSha,

  // Logs
  buildLogs,       // Full build output (text)
  deploymentLogs,  // Container info after deploy

  // Rollback
  imageTag,            // Docker image:tag for future rollbacks
  deploymentType,      // "standard" | "rollback" | "preview"
  sourceDeploymentId,  // Which deployment to roll back to

  // Preview
  isPreview,
  previewBranch,

  // Timing
  startedAt, completedAt, createdAt,
}
```

### metrics

Metrics are indexed for efficient time-range queries:

```typescript
{
  id, name, type, value, labels,
  timestamp,
  applicationId, organizationId,
}

// Indexes:
// (applicationId, name, timestamp)  -- per-app metric queries
// (organizationId, name, timestamp) -- org-wide aggregations
// (timestamp)                       -- retention cleanup
```

## Database Indexes

The schema uses strategic indexes for query performance:

- **Composite indexes** on metrics for time-range queries
- **Foreign key indexes** on all join columns (applicationId, projectId, organizationId)
- **Status indexes** on applications and deployments for filtered queries
- **Timestamp indexes** on deployments and audit logs for ordering
- **Unique constraint** on `organizations.slug` and `users.email`

## Working with the Schema

### Generate a Migration

After modifying the schema in `packages/database/src/schema/index.ts`:

```bash
pnpm run db:generate
```

### Apply Migrations

```bash
pnpm run db:migrate
```

### Explore with Drizzle Studio

```bash
pnpm run db:studio
```

This opens a web-based database GUI for browsing and editing data.

## Source File

The entire schema is defined in a single file:

`packages/database/src/schema/index.ts`
