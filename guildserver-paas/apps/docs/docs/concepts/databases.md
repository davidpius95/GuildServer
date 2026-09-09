---
sidebar_position: 5
title: Databases
description: Learn about managed database provisioning in GuildServer — PostgreSQL, MySQL, MongoDB, and Redis.
---

# Databases

GuildServer provides managed database provisioning as part of the platform. You can create PostgreSQL, MySQL, MongoDB, and Redis instances directly from the dashboard or API, with automatic credential management, resource limits, and optional external access.

## Supported Database Types

| Type | Docker Image | Default Port | Use Case |
|------|-------------|-------------|----------|
| **PostgreSQL** | `postgres:15-alpine` | 5432 | Relational data, ACID transactions |
| **MySQL** | `mysql:8-alpine` | 3306 | Relational data, WordPress, legacy apps |
| **MongoDB** | `mongo:7` | 27017 | Document storage, flexible schemas |
| **Redis** | `redis:7-alpine` | 6379 | Caching, sessions, pub/sub, queues |

## Database Properties

| Field | Description |
|-------|-------------|
| `name` | Human-readable display name |
| `type` | Database engine type |
| `projectId` | Parent project |
| `databaseName` | Name of the database/keyspace inside the engine |
| `username` | Authentication username |
| `password` | Authentication password (stored encrypted) |
| `dockerImage` | Docker image to use (with optional custom tag) |
| `memoryLimit` | Maximum memory in MB |
| `cpuLimit` | Maximum CPU cores |
| `externalPort` | Host port for external access (optional) |
| `status` | Current status: `inactive`, `running`, `stopped`, `failed` |

## Creating a Database

From the dashboard:
1. Navigate to your project.
2. Click **New Database**.
3. Select the database type (PostgreSQL, MySQL, MongoDB, Redis).
4. Configure the name, credentials, and optional resource limits.
5. Click **Create**.

GuildServer will pull the Docker image, create a container with the configured credentials, attach it to the GuildServer Docker network, and optionally expose an external port for direct access.

## Connecting Applications to Databases

Applications deployed on GuildServer can connect to databases using the internal Docker network hostname. Store the connection string in the application's [environment variables](./environment-variables):

```env
DATABASE_URL=postgresql://myuser:mypassword@db-abc123:5432/mydb
```

## External Access

When an `externalPort` is configured, the database is accessible from outside the Docker network on `localhost:<externalPort>`. This is useful for local development tools like pgAdmin, DBeaver, or TablePlus.

:::warning Security
External database ports should only be used in development. In production, use VPN or SSH tunneling to access databases securely. Never expose database ports to the public internet.
:::

## Related Concepts

- [Applications](./applications) — Connect apps to databases
- [Environment Variables](./environment-variables) — Store connection strings
- [Resource Limits](/infrastructure/resource-limits) — Container resource management
- [Databases API](/api/databases) — API reference


## Connecting an application

Open **Databases** and use the **Internal connection** address for apps on the same GuildServer host. PostgreSQL uses `gs-db-<first 12 characters of database ID>:5432`, not the published host port. Do not use a Cloudflare-proxied website hostname for a direct PostgreSQL connection.

Choose **Connect to app**, select an app in the same project, and save. GuildServer stores the internal URL as an encrypted production `DATABASE_URL` (`REDIS_URL` for Redis). Existing values require explicitly selecting **Replace existing connection**. Redeploy the app to apply the variable. Linking does not migrate data from Neon or any other database.

The copy button copies a URL template: replace `***` with the database password. The published host port is informational and requires a separately configured direct TCP route for external clients. Restarting does not change that port.

Apps on other servers need a separately configured private network route; the local connection action does not support them.
