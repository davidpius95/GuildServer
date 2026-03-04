---
sidebar_position: 2
title: Projects
description: Learn how projects group related applications and databases within an organization.
---

# Projects

Projects are organizational containers within a GuildServer organization. They group related **applications** and **databases** together, making it easy to manage resources for a specific product, service, or client.

## Why Projects?

In a real-world scenario, a team might manage dozens of applications. Projects provide logical grouping:

```
Organization: "Acme Corp"
├── Project: "Main Website"
│   ├── App: frontend (Next.js)
│   ├── App: api (Express)
│   └── Database: main-postgres (PostgreSQL)
├── Project: "Mobile Backend"
│   ├── App: mobile-api (Fastify)
│   ├── Database: mobile-db (PostgreSQL)
│   └── Database: mobile-cache (Redis)
└── Project: "Internal Tools"
    ├── App: admin-panel (React)
    └── Database: admin-db (PostgreSQL)
```

## Project Properties

| Field | Description |
|-------|-------------|
| `name` | Human-readable project name |
| `description` | Optional description of the project purpose |
| `organizationId` | The organization this project belongs to |
| `environment` | Project-level environment variables (JSON) inherited by all applications |
| `settings` | Project-level settings (JSON) for custom configuration |

## Creating a Project

From the dashboard:
1. Navigate to the organization dashboard.
2. Click **New Project**.
3. Enter a name and optional description.
4. Click **Create**.

Via the API:
```typescript
const project = await trpc.project.create.mutate({
  name: "My Project",
  description: "Frontend and backend for the main product",
  organizationId: "org-uuid",
});
```

## Project-Level Environment Variables

Projects can define environment variables that are inherited by all applications within the project. Application-level variables take precedence over project-level variables when there is a conflict.

This is useful for shared configuration like database URLs, API keys, or feature flags that apply to all services in a project.

## Access Control

Organization admins can restrict member access to specific projects using the `projectsAccess` field on the member record. When this array is populated, the member can only see and interact with the listed projects.

## Related Concepts

- [Organizations](./organizations) — Parent entity for projects
- [Applications](./applications) — Deploy services within a project
- [Databases](./databases) — Provision databases within a project
- [Environment Variables](./environment-variables) — Configuration inheritance
