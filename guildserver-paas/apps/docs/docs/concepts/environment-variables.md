---
sidebar_position: 7
title: Environment Variables
description: Manage runtime configuration for your applications with scoped, encrypted environment variables.
---

# Environment Variables

Environment variables provide **runtime configuration** for your applications without hardcoding values in source code. GuildServer supports scoped variables, secret encryption, and inheritance from the project level.

## Variable Properties

| Field | Description |
|-------|-------------|
| `key` | Variable name (e.g., `DATABASE_URL`, `API_KEY`) |
| `value` | Variable value |
| `applicationId` | The application this variable belongs to |
| `scope` | Environment scope: `production`, `preview`, or `development` |
| `isSecret` | Whether the value is encrypted at rest |

## Scopes

Environment variables are scoped to specific deployment contexts:

| Scope | Description | Applied To |
|-------|-------------|-----------|
| `production` | Variables used in production deployments | Standard deployments on the main branch |
| `preview` | Variables used in preview deployments | Preview environments for PR branches |
| `development` | Variables used in development mode | Local development and staging |

When deploying, GuildServer injects only the variables matching the deployment scope into the container environment.

## Encryption

Variables marked as `isSecret: true` are **encrypted at rest** using AES-256-CBC encryption. The encryption key is derived from the `ENV_ENCRYPTION_KEY` environment variable configured on the platform.

:::warning
The `ENV_ENCRYPTION_KEY` must be exactly 32 characters long. If this key is lost or changed, all previously encrypted values become unreadable. Back up this key securely.
:::

Secret variables are encrypted before being stored in the database, decrypted only at deployment time when injected into containers, masked in the dashboard UI (displayed as `********`), and never exposed in API responses after creation.

## Setting Variables

### Dashboard

1. Navigate to your application.
2. Click the **Environment** tab.
3. Click **Add Variable**.
4. Enter the key, value, and select a scope.
5. Toggle **Secret** if the value is sensitive.
6. Click **Save**.

Changes to environment variables require a new deployment to take effect.

### API

```typescript
// Add an environment variable
await trpc.environment.create.mutate({
  applicationId: "app-uuid",
  key: "DATABASE_URL",
  value: "postgresql://user:pass@host:5432/db",
  scope: "production",
  isSecret: true,
});

// List variables for an application
const vars = await trpc.environment.list.query({
  applicationId: "app-uuid",
});
```

## Variable Inheritance

Environment variables follow a hierarchy with application-level variables taking precedence over project-level variables. If a project defines `NODE_ENV=staging` and an application defines `NODE_ENV=production`, the container receives `NODE_ENV=production`.

## Built-in Variables

GuildServer automatically injects several built-in variables into every deployment:

| Variable | Description |
|----------|-------------|
| `PORT` | The container port the app should listen on |
| `NODE_ENV` | Set to the deployment scope |
| `GUILDSERVER_APP_ID` | The application UUID |
| `GUILDSERVER_DEPLOYMENT_ID` | The deployment UUID |
| `GUILDSERVER_APP_NAME` | The application name |
| `GUILDSERVER_DOMAIN` | The primary domain for the application |

## Related Concepts

- [Applications](./applications) — Applications that use environment variables
- [Deployments](./deployments) — How variables are injected at deploy time
- [Configuration](/getting-started/configuration) — Platform-level environment variables
- [Environment API](/api/environment) — API reference
