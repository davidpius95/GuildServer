---
title: "CLI Overview"
sidebar_position: 1
---

# CLI Overview

The GuildServer CLI (`@guildserver/cli`) is a command-line tool for managing applications, deployments, environment variables, and infrastructure from the terminal. It communicates with the GuildServer API server over HTTP using the tRPC protocol.

## Installation

### Global Install via npm

```bash
npm install -g @guildserver/cli
```

After installation, two binary aliases are available:

| Command | Description |
|---|---|
| `guildserver` | Full command name |
| `gs` | Short alias (identical functionality) |

### From the Monorepo

If you are developing GuildServer itself, run the CLI directly from the workspace:

```bash
# Run in development mode (with hot reload via tsx)
pnpm --filter @guildserver/cli dev

# Or build and run the compiled version
pnpm --filter @guildserver/cli build
node packages/cli/dist/index.js
```

## Requirements

| Requirement | Minimum Version |
|---|---|
| Node.js | >= 20.0.0 |
| GuildServer API | Running and accessible |

The CLI uses the Node.js built-in `fetch` API (available since Node 18) for all HTTP requests and `ws` for WebSocket log streaming.

## Technology Stack

The CLI is built with the following libraries:

| Library | Version | Purpose |
|---|---|---|
| **Commander.js** | 12.x | Command parsing, subcommand routing, option handling |
| **Chalk** | 5.x | Colored terminal output |
| **Ora** | 8.x | Loading spinners for async operations |
| **Inquirer** | 9.x | Interactive prompts for guided workflows |

## Quick Start

```bash
# 1. Install the CLI
npm install -g @guildserver/cli

# 2. Authenticate with your GuildServer instance
gs login --api-url https://api.yourdomain.com

# 3. Check your authentication status
gs whoami

# 4. View your organization status
gs status

# 5. Deploy an application from the current directory
gs deploy

# 6. List all applications
gs apps list

# 7. Stream logs from a running application
gs logs <appId> --follow
```

## Authentication

Before using most commands, you must authenticate with a GuildServer instance. The `login` command supports both interactive and non-interactive modes.

### Interactive Login

```bash
gs login
```

This prompts for:

1. **API URL** -- the address of your GuildServer API server (default: `http://localhost:4000`)
2. **Email** -- your account email address
3. **Password** -- your account password

On success, the CLI stores a JWT token and organization context locally.

### Non-Interactive Login

For scripts and CI/CD pipelines, pass credentials directly:

```bash
gs login --email admin@example.com --password mysecretpassword --api-url https://api.yourdomain.com
```

### Environment Variable Override

You can set the API URL via environment variable instead of the `--api-url` flag:

```bash
export GUILDSERVER_API_URL=https://api.yourdomain.com
gs login --email admin@example.com --password mysecretpassword
```

## Configuration

The CLI stores its configuration at `~/.guildserver/config.json`. This file is created automatically on first login.

### Configuration Fields

| Field | Type | Description |
|---|---|---|
| `apiUrl` | string | GuildServer API server URL |
| `token` | string | JWT authentication token |
| `organizationId` | string | Active organization UUID |
| `organizationName` | string | Active organization display name |
| `userId` | string | Authenticated user UUID |
| `userName` | string | Authenticated user display name |

### Configuration File Location

| Platform | Path |
|---|---|
| Linux / macOS | `~/.guildserver/config.json` |
| Windows | `%USERPROFILE%\.guildserver\config.json` |

:::warning
The configuration file contains your JWT token. Ensure the file has restricted permissions (`chmod 600 ~/.guildserver/config.json`) and do not commit it to version control.
:::

### Configuration Precedence

The CLI resolves the API URL in the following order:

1. `--api-url` command-line flag (highest priority)
2. `GUILDSERVER_API_URL` environment variable
3. `apiUrl` field in `~/.guildserver/config.json`
4. Default: `http://localhost:4000`

## API Communication

The CLI communicates with the GuildServer API using the tRPC v10 HTTP protocol:

- **Queries** are sent as `GET` requests with the input serialized in the URL query string
- **Mutations** are sent as `POST` requests with the input in the JSON request body
- **Authentication** is sent via the `Authorization: Bearer <token>` header

```
# Query example (internal)
GET /trpc/application.list?input={"json":{"projectId":"uuid"}}

# Mutation example (internal)
POST /trpc/application.deploy
Body: {"json":{"id":"uuid"}}
```

Error responses from the API are parsed to extract meaningful messages, including Zod validation errors which are formatted as `field: message` pairs.

## WebSocket Support

The `logs --follow` command uses a WebSocket connection for real-time log streaming:

```
ws://<api-url>/ws?token=<jwt-token>
```

The WebSocket connection supports:

- **subscribe_logs** -- start streaming logs for an application
- **unsubscribe_logs** -- stop streaming logs
- **log_line** -- individual log entries with timestamp, level, and message

Press `Ctrl+C` to gracefully disconnect from the log stream.

## Global Options

These options are available on all commands:

| Option | Description |
|---|---|
| `--api-url <url>` | Override the API server URL for this command |
| `--help` | Display help for any command |
| `--version` | Display the CLI version |

## Command Groups

The CLI organizes commands into the following groups:

| Group | Commands | Description |
|---|---|---|
| **Authentication** | `login`, `logout`, `whoami` | Manage API credentials |
| **Deployment** | `deploy` | Deploy applications from source or Docker images |
| **Applications** | `apps list`, `apps info`, `apps restart`, `apps stop`, `apps delete` | Manage running applications |
| **Logs** | `logs` | View and stream application logs |
| **Environment** | `env list`, `env set`, `env remove`, `env pull`, `env push` | Manage environment variables |
| **Status** | `status` | View organization overview and system health |

See the [Commands](./commands) page for detailed documentation of every command.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Command completed successfully |
| `1` | Command failed (authentication error, API error, or invalid input) |

## Troubleshooting

### Cannot connect to GuildServer API

```
Cannot connect to GuildServer API at http://localhost:4000. Is the server running?
```

Verify the API is running and accessible:

```bash
curl http://localhost:4000/health
```

If the API is on a different host or port, set the URL explicitly:

```bash
gs login --api-url https://api.yourdomain.com
```

### Not logged in

```
Not logged in. Run `guildserver login` first.
```

Your token may have expired or the config file may be missing. Re-authenticate:

```bash
gs login
```

### Permission denied

If you see `FORBIDDEN` or `UNAUTHORIZED` errors, verify you are logged in to the correct organization and that your user account has the required role (owner, admin, or member).

## Related Pages

- [CLI Commands](./commands) -- Complete reference for all commands
- [Architecture](../contributing/architecture) -- How the CLI communicates with the API
- [Development Setup](../contributing/development-setup) -- Setting up the monorepo for CLI development
