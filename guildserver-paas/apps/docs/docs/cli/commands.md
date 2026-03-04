---
title: "CLI Commands"
sidebar_position: 2
---

# CLI Commands

This page documents every command available in the GuildServer CLI. All commands support `--help` for inline usage information.

## Authentication Commands

### `gs login`

Authenticate with a GuildServer instance and store credentials locally.

```bash
gs login [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--email <email>` | Email address (skip interactive prompt) | -- |
| `--password <password>` | Password (skip interactive prompt) | -- |
| `--api-url <url>` | GuildServer API server URL | `http://localhost:4000` |

**Behavior:**

1. Checks API connectivity by hitting the `/health` endpoint
2. If `--email` or `--password` are not provided, prompts interactively
3. Sends credentials to `auth.login` via tRPC
4. Stores the JWT token in `~/.guildserver/config.json`
5. Fetches the user's organizations and auto-selects the first one

**Examples:**

```bash
# Interactive login (prompts for email and password)
gs login

# Non-interactive login
gs login --email admin@example.com --password s3cret

# Login to a remote instance
gs login --api-url https://api.guildserver.example.com

# Full non-interactive login for CI/CD
gs login --api-url https://api.example.com --email ci@example.com --password $GS_PASSWORD
```

---

### `gs logout`

Clear all stored credentials and configuration.

```bash
gs logout
```

Deletes the `~/.guildserver/config.json` file. You will need to run `gs login` again before using other commands.

---

### `gs whoami`

Display the currently authenticated user and active organization.

```bash
gs whoami
```

**Output:**

```
  User: David Chen
  Email: david@example.com
  Organization: My Team
  API: https://api.guildserver.example.com
```

Returns exit code `1` if not logged in.

## Deploy Command

### `gs deploy`

Deploy an application from a local directory or Docker image.

```bash
gs deploy [directory] [options]
```

**Arguments:**

| Argument | Description | Default |
|---|---|---|
| `directory` | Directory to deploy | Current working directory |

**Options:**

| Option | Description | Default |
|---|---|---|
| `--name <name>` | Application name | Inferred from `package.json` or directory name |
| `--image <image>` | Docker image to deploy (skips build) | -- |
| `--project <id>` | Target project ID | First project in organization |
| `--env <env>` | Environment (production, preview, development) | `production` |
| `--port <port>` | Container port | `3000` |
| `--no-wait` | Return immediately without waiting for completion | -- |

**Behavior:**

1. Determines application name from `--name`, `package.json`, or directory name
2. Sanitizes the name (lowercase, alphanumeric and hyphens only)
3. Gets or creates a project in the active organization
4. Checks if an application with this name already exists
5. If not, creates a new application with auto-detected settings:
   - If a `Dockerfile` exists, uses `dockerfile` build type
   - If `--image` is provided, uses the specified Docker image
6. Triggers a deployment via the `application.deploy` mutation
7. Polls for status updates every 2 seconds (up to 2 minutes)
8. Reports the final URL on success, or the last 10 log lines on failure

**Examples:**

```bash
# Deploy from current directory (auto-detects name and build type)
gs deploy

# Deploy a specific directory
gs deploy ./my-project

# Deploy with a custom name and port
gs deploy --name my-api --port 8080

# Deploy a Docker image directly (no build step)
gs deploy --image nginx:alpine --name web-proxy --port 80

# Deploy without waiting for completion
gs deploy --no-wait
```

:::info
The `deploy` command creates the application if it does not exist. For subsequent deployments of the same application, it triggers a new deployment on the existing application.
:::

## Application Commands

All application commands are grouped under the `apps` subcommand. Running `gs apps` without a subcommand defaults to `gs apps list`.

### `gs apps list`

List all applications in the active organization.

```bash
gs apps list [options]
gs apps ls [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--project <id>` | Filter by project ID | All projects |

**Output:**

Applications are grouped by project and display status, type, port, Docker image, and URL:

```
  Applications (My Team)

  Project Alpha
  ──────────────────────────────────────────────────
  [running]  my-api
     Status: running | Type: Docker | Port: 4000
     Image: my-api:latest
     URL: https://my-api.example.com

  [stopped]  staging-app
     Status: stopped | Type: Docker | Port: 3000
```

---

### `gs apps info <appId>`

Show detailed information about a specific application.

```bash
gs apps info <appId>
```

**Arguments:**

| Argument | Description |
|---|---|
| `appId` | Application UUID |

**Output:**

```
  my-api

  ID:          550e8400-e29b-41d4-a716-446655440000
  Status:      running
  Type:        docker
  Image:       my-api:latest
  Port:        4000
  Git URL:     ---
  Branch:      ---
  URL:         https://my-api.example.com
  Created:     3/1/2025, 10:30:00 AM
  Updated:     3/2/2025, 2:15:00 PM
```

---

### `gs apps restart <appId>`

Restart a running application container.

```bash
gs apps restart <appId>
```

Sends a `application.restart` mutation to the API. The container is stopped and started with the same configuration.

---

### `gs apps stop <appId>`

Stop an application container.

```bash
gs apps stop <appId>
```

Updates the application status to `stopped`. The container is removed but the application configuration is preserved. Deploy again to restart it.

---

### `gs apps delete <appId>`

Permanently delete an application and its container.

```bash
gs apps delete <appId> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--yes` | Skip the confirmation prompt | Prompts for confirmation |

**Behavior:**

Without `--yes`, prompts for confirmation before deleting. This action removes the application, its container, and all associated deployment history.

:::danger
Application deletion is permanent and cannot be undone. Deployment history, build logs, and environment variables for this application are deleted along with it.
:::

## Logs Command

### `gs logs <appId>`

View or stream application container logs.

```bash
gs logs <appId> [options]
```

**Arguments:**

| Argument | Description |
|---|---|
| `appId` | Application UUID |

**Options:**

| Option | Description | Default |
|---|---|---|
| `-n, --lines <number>` | Number of historical log lines to fetch | `50` |
| `-f, --follow` | Stream logs in real-time via WebSocket | Off |
| `--level <level>` | Filter by log level (info, warning, error) | All levels |

**Fetching Historical Logs:**

```bash
# Show the last 50 lines (default)
gs logs 550e8400-e29b-41d4-a716-446655440000

# Show the last 200 lines
gs logs 550e8400-e29b-41d4-a716-446655440000 -n 200

# Show only error logs
gs logs 550e8400-e29b-41d4-a716-446655440000 --level error
```

**Streaming Logs in Real-Time:**

```bash
gs logs 550e8400-e29b-41d4-a716-446655440000 --follow
```

This opens a WebSocket connection to the API server, subscribes to the application's log stream, and prints each log line as it arrives. Log entries are color-coded:

- **Cyan** -- info level
- **Yellow** -- warning level
- **Red** -- error level

Press `Ctrl+C` to disconnect from the stream.

**Output Format:**

```
  10:30:15 [INFO   ] Server listening on port 4000
  10:30:16 [INFO   ] Connected to PostgreSQL
  10:31:02 [WARNING] Slow query detected (1200ms)
  10:31:15 [ERROR  ] Connection refused: Redis
```

## Environment Variable Commands

All environment variable commands are grouped under the `env` subcommand.

### `gs env list <appId>`

List environment variables for an application.

```bash
gs env list <appId> [options]
gs env ls <appId> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--scope <scope>` | Filter by scope (production, preview, development) | All scopes |
| `--show-values` | Display actual values (hidden by default) | Values masked |

**Output:**

```
  Environment Variables

  PRODUCTION
  ──────────────────────────────────────────────────
  DATABASE_URL=••••••••
  REDIS_URL=••••••••
  JWT_SECRET=••••••••

  DEVELOPMENT
  ──────────────────────────────────────────────────
  DEBUG=••••••••
```

:::tip
Values are masked by default to prevent accidental exposure in screen shares or terminal recordings. Use `--show-values` to reveal them.
:::

---

### `gs env set <appId> <key> <value>`

Set a single environment variable.

```bash
gs env set <appId> <key> <value> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--scope <scope>` | Variable scope | `production` |

**Examples:**

```bash
# Set a production variable
gs env set 550e8400... DATABASE_URL postgresql://user:pass@host/db

# Set a development-only variable
gs env set 550e8400... DEBUG true --scope development
```

---

### `gs env remove <appId> <key>`

Remove an environment variable.

```bash
gs env remove <appId> <key> [options]
gs env rm <appId> <key> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--scope <scope>` | Variable scope to remove from | `production` |

---

### `gs env pull <appId>`

Download environment variables to a local `.env` file.

```bash
gs env pull <appId> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--scope <scope>` | Which scope to pull | `development` |
| `--file <file>` | Output file path | `.env.local` |

**Examples:**

```bash
# Pull development variables to .env.local
gs env pull 550e8400...

# Pull production variables to a custom file
gs env pull 550e8400... --scope production --file .env.production
```

The output file uses the standard `KEY=VALUE` format, one variable per line.

---

### `gs env push <appId>`

Upload a local `.env` file as environment variables.

```bash
gs env push <appId> [options]
```

**Options:**

| Option | Description | Default |
|---|---|---|
| `--scope <scope>` | Target scope for all variables | `production` |
| `--file <file>` | Input `.env` file path | `.env` |

**Behavior:**

1. Reads the specified `.env` file
2. Skips blank lines and lines starting with `#`
3. Parses each line as `KEY=VALUE`
4. Sets each variable via the `environment.set` mutation

**Examples:**

```bash
# Push .env to production
gs env push 550e8400...

# Push a specific file to development
gs env push 550e8400... --file .env.development --scope development
```

:::warning
The `push` command overwrites existing variables with the same key and scope. It does not delete variables that are not present in the file.
:::

## Status Command

### `gs status`

Display an overview of the active organization and system health.

```bash
gs status
```

**Output:**

```
  GuildServer Status

  API: https://api.guildserver.example.com
  Org: My Team (my-team)

  Overview
  ────────────────────────────────────────
  Projects:     3
  Applications: 12
    Running: 8
    Stopped: 4

  System Health
  ────────────────────────────────────────
  Docker:     healthy
  API:        healthy
  Containers: 8/12 running
```

The status command makes three API calls:

1. `organization.getById` -- organization name and slug
2. `project.list` + `application.list` -- counts applications by status
3. `monitoring.getSystemHealth` -- Docker engine and container health

If the monitoring endpoint is unavailable, the system health section is silently omitted.

## Command Summary

| Command | Description |
|---|---|
| `gs login` | Authenticate with a GuildServer instance |
| `gs logout` | Clear stored credentials |
| `gs whoami` | Show current user and organization |
| `gs deploy [dir]` | Deploy from directory or Docker image |
| `gs apps list` | List all applications |
| `gs apps info <id>` | Show application details |
| `gs apps restart <id>` | Restart an application |
| `gs apps stop <id>` | Stop an application |
| `gs apps delete <id>` | Delete an application |
| `gs logs <id>` | View application logs |
| `gs logs <id> -f` | Stream logs in real-time |
| `gs env list <id>` | List environment variables |
| `gs env set <id> K V` | Set an environment variable |
| `gs env remove <id> K` | Remove an environment variable |
| `gs env pull <id>` | Download env vars to a local file |
| `gs env push <id>` | Upload a local .env file |
| `gs status` | Show organization and system overview |

## Related Pages

- [CLI Overview](/cli) — Installation, authentication, and configuration
- [Architecture](../contributing/architecture) -- How the CLI communicates with the API
- [Logging](../monitoring/logging) -- Understanding log levels and formats
- [Alerts](../monitoring/alerts) -- Notification events triggered by deployments
