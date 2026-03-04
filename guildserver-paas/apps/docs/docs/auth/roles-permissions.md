---
title: "Roles & Permissions"
sidebar_position: 3
---

# Roles & Permissions

GuildServer implements a two-level access control model: **system-wide roles** for platform administration and **organization roles** with granular permissions for team-based access control.

## System Roles

System roles are set on the `users` table and control platform-wide access:

| Role | Description |
|------|-------------|
| `admin` | Platform administrator. Can access all organizations and system settings. |
| `user` | Regular user. Access limited to organizations they belong to. |

The system role is checked by the `adminProcedure` middleware:

```typescript
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user || !ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

## Organization Roles

Organization roles are defined on the `members` table and control access within a specific organization. There are three roles:

| Role | Description |
|------|-------------|
| `owner` | Full control over the organization including billing, deletion, and ownership transfer |
| `admin` | Can manage all resources (apps, databases, clusters) but cannot manage billing or delete the organization |
| `member` | Can view and deploy within their permitted scope |

### Role Capabilities

| Capability | Owner | Admin | Member |
|-----------|-------|-------|--------|
| Create applications | Yes | Yes | Yes |
| Deploy applications | Yes | Yes | Yes |
| View deployments and logs | Yes | Yes | Yes |
| Create/manage databases | Yes | Yes | Yes |
| Manage environment variables | Yes | Yes | Yes |
| Create/manage K8s clusters | Yes | Yes | No |
| Invite/remove team members | Yes | Yes | No |
| Manage billing & subscriptions | Yes | No | No |
| Set spend limits | Yes | Yes | No |
| Delete the organization | Yes | No | No |
| Cancel subscription | Yes | No | No |
| Start a trial | Yes | No | No |

## Granular Permissions

Beyond the role hierarchy, each member record supports fine-grained permissions stored as a JSONB object on the `members` table:

### Permissions JSON Structure

```json
{
  "admin": true,
  "projects": ["create", "read", "update", "delete"],
  "applications": ["create", "read", "update", "delete", "deploy"],
  "databases": ["create", "read", "update", "delete"],
  "workflows": ["create", "read", "update", "delete", "execute"],
  "kubernetes": ["create", "read", "update", "delete"]
}
```

Each key represents a resource type, and the array contains the allowed operations. The `admin` flag grants full access to all resources.

### Default Permissions by Role

When a new member is added, their permissions are set based on their role:

**Owner:**
```json
{
  "admin": true,
  "projects": ["create", "read", "update", "delete"],
  "applications": ["create", "read", "update", "delete", "deploy"],
  "databases": ["create", "read", "update", "delete"],
  "workflows": ["create", "read", "update", "delete", "execute"],
  "kubernetes": ["create", "read", "update", "delete"]
}
```

**Admin:** Same as owner but `admin` may be set to `false` depending on configuration.

**Member:** Restricted permissions, typically read + deploy only:
```json
{
  "admin": false,
  "projects": ["read"],
  "applications": ["read", "deploy"],
  "databases": ["read"],
  "workflows": ["read"],
  "kubernetes": ["read"]
}
```

### Resource-Level Access Control

The `members` table also provides two array fields for restricting access to specific resources:

| Field | Type | Description |
|-------|------|-------------|
| `projectsAccess` | `text[]` | Array of project IDs the member can access. Empty = all projects. |
| `applicationsAccess` | `text[]` | Array of application IDs the member can access. Empty = all applications. |

When these arrays are populated, they restrict the member's access to only the listed resources, regardless of their role permissions.

## Procedure Types

GuildServer defines three tRPC procedure types that enforce different access levels:

### `publicProcedure`

No authentication required. Anyone can call these endpoints.

```typescript
export const publicProcedure = t.procedure;
```

Used for: `auth.register`, `auth.login`, `billing.getPlans`

### `protectedProcedure`

Requires a valid JWT token. Rejects unauthenticated requests with `UNAUTHORIZED`:

```typescript
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, user: ctx.user },
  });
});
```

Used for: Most API operations.

### `adminProcedure`

Requires a valid token AND the system `admin` role. Rejects non-admin users with `FORBIDDEN`:

```typescript
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user || !ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({
    ctx: { ...ctx, user: ctx.user },
  });
});
```

Used for: Platform-wide administrative operations.

## How Access Control Works in Practice

Most API endpoints follow this pattern to check organization membership:

```typescript
// 1. Verify the user is a member of the organization
const member = await ctx.db.query.members.findFirst({
  where: and(
    eq(members.userId, ctx.user.id),
    eq(members.organizationId, input.organizationId)
  ),
});

if (!member) {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You are not a member of this organization",
  });
}

// 2. Check role for privileged operations
if (!member || !["owner", "admin"].includes(member.role)) {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only organization owners or admins can manage billing",
  });
}
```

## Billing Enforcement Helpers

In addition to role checks, GuildServer provides billing-aware enforcement functions defined in `trpc.ts`:

### `enforcePlanLimit(organizationId, metric)`

Checks if a usage metric is within plan limits. On Hobby plans, throws `FORBIDDEN` when the limit is reached. On Pro/Enterprise plans, allows overages:

```typescript
await enforcePlanLimit(orgId, "applications");
await enforcePlanLimit(orgId, "deployments");
```

### `enforceFeature(organizationId, featureName)`

Checks if a feature is enabled for the organization's plan. Throws `FORBIDDEN` with an upgrade prompt if the feature is not available:

```typescript
await enforceFeature(orgId, "previewDeployments");
await enforceFeature(orgId, "teamCollaboration");
```

### `getUserOrgId(userId)`

Helper to get the default organization ID for a user:

```typescript
const orgId = await getUserOrgId(ctx.user.id);
```

## Members Table Schema

```sql
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role member_role NOT NULL,  -- 'owner' | 'admin' | 'member'
  permissions JSONB DEFAULT '{}',
  projects_access TEXT[] DEFAULT '{}',
  applications_access TEXT[] DEFAULT '{}',
  joined_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Indexes:
- `members_user_id_idx` on `user_id`
- `members_organization_id_idx` on `organization_id`
- `members_user_org_idx` on `(user_id, organization_id)` for fast membership lookups

## Audit Logging

All permission-sensitive actions are recorded in the `audit_logs` table:

| Column | Type | Description |
|--------|------|-------------|
| `userId` | UUID | Who performed the action |
| `organizationId` | UUID | Which organization |
| `action` | varchar(100) | Action performed (e.g., `create`, `delete`, `deploy`) |
| `resourceType` | varchar(100) | Type of resource (e.g., `application`, `database`) |
| `resourceId` | UUID | ID of the affected resource |
| `resourceName` | varchar(255) | Human-readable resource name |
| `metadata` | JSONB | Additional context data |
| `ipAddress` | inet | Client IP address |
| `userAgent` | text | Client user agent string |
| `timestamp` | timestamp | When the action occurred |

## Next Steps

- Set up [OAuth providers](./oauth.md) for social login
- Configure [SSO](./sso.md) for enterprise organizations
- Learn about [authentication](./authentication.md) for token details
- Review [plans and pricing](../billing/plans.md) for plan-based access control
