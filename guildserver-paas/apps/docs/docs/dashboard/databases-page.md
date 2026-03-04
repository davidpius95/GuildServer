---
title: "Databases"
sidebar_position: 5
---

# Databases

The Databases page (`/dashboard/databases`) lets you provision, manage, and monitor database instances. It provides a card-based view of your databases with resource usage metrics, connection strings, and backup management.

## Page Layout

The page consists of:

1. **Header** -- title, description, and a "Create Database" button
2. **Search bar** -- filters databases by name or type
3. **Tab system** with three tabs: Databases, Backups, and Monitoring

## Databases Tab

### Database Grid

Databases are displayed in a responsive card grid (2 columns on medium screens, 3 on large screens). Each card contains the following sections:

**Header section:**
- A **type icon** (Database icon for PostgreSQL and MySQL, Activity icon for Redis)
- The **database name**
- A kebab menu button for additional actions
- A **status badge** (green for running, red for stopped, yellow for maintenance)
- An **environment badge** (e.g., "production", "staging")

**Details section:**

| Field | Example |
|---|---|
| Type | PostgreSQL 15.2 |
| Size | 2.4 GB |
| Connections | 24/100 |
| Last Backup | 2 hours ago |

**Resource usage:**
- **CPU Usage** -- percentage with a visual progress bar
- **Memory Usage** -- percentage with a visual progress bar

**Connection string:**
- A read-only input displaying the full connection string
- A **copy button** that copies the string to the clipboard (with fallback for non-HTTPS contexts)

:::tip
Connection strings contain credentials. Treat them as secrets and store them as [environment variables](./app-detail.md) in your applications rather than hardcoding them.
:::

**Action buttons:**
- **Stop / Start** -- toggles the database running state (Pause icon when running, Play icon when stopped)
- **Backup** -- triggers an on-demand backup with download icon
- **Settings** -- opens database configuration (gear icon)

### Supported Database Types

GuildServer supports the following database engines:

| Type | Default Port | Use Case |
|---|---|---|
| **PostgreSQL** | 5432 | Relational data, complex queries, JSONB support |
| **MySQL** | 3306 | Web applications, WordPress, traditional RDBMS |
| **Redis** | 6379 | Caching, session storage, pub/sub messaging |
| **MongoDB** | 27017 | Document storage, flexible schemas |

### Search

The search bar filters the database list by name or type (case-insensitive, client-side).

### Empty State

When no databases match the search query or none exist, an empty state displays with a Database icon and a "Create Database" button.

## Backups Tab

The Backups tab shows a **Backup History** card with a chronological list of database backups. Each entry displays:

| Field | Description |
|---|---|
| **Icon** | Download icon for visual identification. |
| **Database name** | Which database was backed up. |
| **Size** | Size of the backup file. |
| **Time** | Relative timestamp of when the backup was created. |
| **Status** | Badge showing the backup result (e.g., "completed" in green). |

Each backup entry has two action buttons:

- **Download** -- downloads the backup file
- **Restore** -- restores the database from this backup point

:::warning
Restoring a backup replaces all current data in the target database. Always verify you are restoring to the correct instance before proceeding.
:::

## Monitoring Tab

The Monitoring tab provides four summary cards in a responsive grid (2 columns on medium, 4 on large):

| Card | Description |
|---|---|
| **Total Databases** | Total count of database instances with the number currently running. |
| **Total Storage** | Aggregate storage used across all databases, with a month-over-month delta shown in green. |
| **Active Connections** | Current active connections vs. total connection capacity across all instances. |
| **Last Backup** | Time since the most recent backup completed, with an "All databases backed up" status note. |

## Creating a Database

Clicking the "Create Database" button in the header opens the database creation flow. You will specify:

- **Name** -- a unique identifier for the database instance
- **Type** -- select from PostgreSQL, MySQL, Redis, or MongoDB
- **Credentials** -- username and password for the database
- **Resource limits** -- optional CPU and memory constraints

## Related Pages

- [Application Detail](./app-detail.md) -- configure database connection strings as environment variables
- [Monitoring](./monitoring.md) -- view system-wide resource usage including databases
- [Templates](./templates.md) -- deploy pre-configured database instances (PostgreSQL, MySQL, Redis, MongoDB) from the template catalog
