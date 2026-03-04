---
sidebar_position: 1
title: Organizations
description: Understand how organizations provide multi-tenancy, team isolation, and billing boundaries in GuildServer.
---

# Organizations

Organizations are the top-level entity in GuildServer and serve as the **multi-tenancy boundary** for all platform resources. Every project, application, database, billing subscription, and team member belongs to an organization.

## Structure

```
Organization
├── Members (users with roles)
├── Projects
│   ├── Applications
│   │   ├── Deployments
│   │   ├── Domains
│   │   └── Environment Variables
│   └── Databases
├── Subscription (billing plan)
├── Kubernetes Clusters
├── SSO Providers
├── Workflow Templates
├── Slack Configurations
└── Audit Logs
```

## Creating an Organization

When a user signs up, GuildServer automatically creates a default organization with that user as the **owner**. Additional organizations can be created from the dashboard or via the API.

Each organization has:

| Field | Description |
|-------|-------------|
| `name` | Display name of the organization |
| `slug` | URL-safe identifier (unique across the platform) |
| `logo` | Optional logo URL |
| `description` | Optional description |
| `ownerId` | User ID of the organization owner |
| `stripeCustomerId` | Linked Stripe customer for billing |
| `metadata` | Arbitrary JSON for custom extensions |

## Member Roles

Organizations use role-based access control with three tiers:

| Role | Permissions |
|------|------------|
| **Owner** | Full access. Can delete the organization, manage billing, transfer ownership, and manage all members. Only one owner per organization. |
| **Admin** | Can manage projects, applications, databases, domains, and team members. Cannot delete the organization or manage billing. |
| **Member** | Can view and deploy applications within their permitted projects. Cannot manage team settings or billing. |

In addition to roles, members can have **granular permissions** stored as JSON, and scoped access to specific projects and applications via the `projectsAccess` and `applicationsAccess` arrays.

## Switching Organizations

Users can belong to multiple organizations. The dashboard provides an organization switcher in the navigation bar that lets users change their active context without logging out.

## Organization Settings

Organization owners and admins can configure:

- **General** — Name, slug, logo, description
- **Team** — Invite members, change roles, remove members
- **Billing** — Subscription plan, payment methods, invoices, spend limits
- **SSO** — Configure SAML, OIDC, or LDAP providers (Enterprise)
- **Notifications** — Slack webhook integration, email preferences
- **Audit Log** — View all actions performed within the organization

## API Access

Organizations are managed through the `organization` tRPC router:

```typescript
// List user's organizations
const orgs = await trpc.organization.list.query();

// Create a new organization
const org = await trpc.organization.create.mutate({
  name: "My Team",
  slug: "my-team",
});

// Update organization
await trpc.organization.update.mutate({
  id: org.id,
  name: "Updated Name",
});
```

See the [Organizations API Reference](/api/organizations) for the complete endpoint documentation.

## Related Concepts

- [Projects](./projects) — Organize applications within an organization
- [Roles & Permissions](/auth/roles-permissions) — Detailed access control documentation
- [Billing & Plans](/billing/plans) — Subscription management per organization
- [Team Management](/dashboard/team-management) — Dashboard guide for managing members
