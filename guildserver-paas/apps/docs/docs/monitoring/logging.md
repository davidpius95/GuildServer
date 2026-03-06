---
title: "Logging"
sidebar_position: 3
---

# Logging

GuildServer provides structured server-side logging, real-time container log streaming via WebSocket, and build log persistence for deployment troubleshooting.

## Server-Side Logging

The API server uses **Winston** for structured JSON logging. The logger is configured in `apps/api/src/utils/logger.ts`.

### Configuration

```typescript
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
  ),
  defaultMeta: {
    service: "guildserver-api",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});
```

### Log Levels

Winston supports the following levels (from highest to lowest priority):

| Level | Usage |
|---|---|
| `error` | Unrecoverable failures: deployment errors, database connection loss |
| `warn` | Recoverable issues: Docker unavailable, notification delivery failure |
| `info` | Operational events: deployment started, container created, user login |
| `debug` | Detailed diagnostics: metrics collected, SQL queries, WebSocket messages |

Set the log level via the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=debug  # Show all messages including debug
LOG_LEVEL=warn   # Show only warnings and errors
```

### Production Transports

In production (`NODE_ENV=production`), two additional file transports are added:

| File | Contents |
|---|---|
| `logs/error.log` | Error-level messages only |
| `logs/combined.log` | All messages at the configured level and above |

:::tip
Configure log rotation in production to prevent disk exhaustion. Use `logrotate` on Linux or a Winston transport like `winston-daily-rotate-file`.
:::

### HTTP Request Logging

A Morgan-compatible stream adapter is exported for HTTP access logging:

```typescript
export const loggerStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
```

## Application Container Logs

### Fetching Logs via API

Container logs are retrieved directly from the Docker daemon using the `getContainerLogs()` function:

```typescript
const logs = await getContainerLogs(applicationId, 100);
// Returns: string[] -- array of log lines with timestamps
```

This function:

1. Finds the container by application ID (using `gs.app.id` label)
2. Calls `container.logs()` with `stdout: true`, `stderr: true`, `timestamps: true`
3. Parses the Docker multiplexed stream format (8-byte header per frame)
4. Returns clean log lines as an array of strings

Even stopped containers can have their logs retrieved -- the function falls back to listing all containers (not just running ones) if no running container is found.

### Docker Multiplexed Stream Format

Docker container logs use a multiplexed stream where each frame has an 8-byte header:

```
[stream_type (1 byte)] [padding (3 bytes)] [size (4 bytes, big-endian)] [payload]
```

- `stream_type = 1` -- stdout
- `stream_type = 2` -- stderr

The parser strips these headers and returns clean text lines.

## Real-Time Log Streaming

GuildServer supports live log tailing via WebSocket. This is used by the dashboard Container Logs tab and the `gs logs -f` CLI command.

### Subscribing to Logs

Send a WebSocket message to start receiving logs:

```json
{
  "type": "subscribe_logs",
  "payload": { "applicationId": "your-app-id" }
}
```

The server responds with a confirmation:

```json
{ "type": "logs_subscribed", "applicationId": "your-app-id" }
```

Then log lines stream in real time:

```json
{
  "type": "log_line",
  "applicationId": "your-app-id",
  "timestamp": "2025-03-01T12:00:15.123456789Z",
  "level": "info",
  "message": "Server listening on port 3000"
}
```

### How It Works

1. Client sends `subscribe_logs` with an `applicationId`
2. Server finds the running container via Docker API
3. Server calls `container.logs({ follow: true, stdout: true, stderr: true, tail: 50, timestamps: true })` to start a streaming connection
4. Each chunk from Docker is parsed through the multiplexed stream parser
5. Parsed log lines are sent to the client as `log_line` messages
6. On disconnect, the Docker log stream is destroyed

### Log Level Detection

Log levels are automatically detected from the stream:

| Condition | Assigned Level |
|---|---|
| Frame comes from stderr (`stream_type = 2`) | `error` |
| Message contains the word "error" (case-insensitive) | `error` |
| Message contains the word "warn" (case-insensitive) | `warning` |
| Everything else | `info` |

### Unsubscribing

To stop receiving logs:

```json
{
  "type": "unsubscribe_logs",
  "payload": { "applicationId": "your-app-id" }
}
```

The server destroys the Docker log stream and confirms:

```json
{ "type": "logs_unsubscribed", "applicationId": "your-app-id" }
```

:::info
When a container stops or is redeployed, the log stream ends automatically. The client receives a `logs_ended` message.
:::

### Stream Cleanup

Log streams are automatically cleaned up when:

- The WebSocket client disconnects
- The client sends `unsubscribe_logs`
- The container stops or is removed
- A WebSocket error occurs

Each client tracks its active log streams in a `Map<applicationId, DockerStream>`, ensuring no stream leaks.

## Build and Deployment Logs

Build and deployment logs are persisted in the `deployments` table for post-mortem analysis.

### Build Logs

Stored in the `deployments.buildLogs` column as newline-delimited text. Build logs capture:

- Repository cloning progress
- Docker image build output (layer-by-layer)
- Build type detection and port detection
- Error messages with stack traces

### Deployment Logs

Stored in the `deployments.deploymentLogs` column. Deployment logs capture:

- Container name and ID
- Assigned host port
- Access URL
- Traefik routing configuration

Example deployment log:

```
Container: gs-my-app-a1b2c3d4
Port: 12345
Container ID: sha256:abc123...
URL: http://my-app.guildserver.localhost
```

### Accessing Logs in the UI

The application detail page provides two log views:

- **Container Logs** tab -- live logs from the running container (via WebSocket or API)
- **Build Logs** tab -- stored build output from the most recent deployment

### Accessing Logs via CLI

```bash
# View last 50 lines
gs logs <app-id>

# View last 200 lines
gs logs <app-id> -n 200

# Stream logs in real time
gs logs <app-id> -f

# Filter by level
gs logs <app-id> --level error
```

See the [CLI Commands](../cli/commands.md) reference for full details.

## WebSocket Authentication

Log streaming requires authentication. The WebSocket connection is established with a JWT token:

```
ws://localhost:4000/ws?token=<jwt-token>
```

The server verifies the token on connection and associates the WebSocket client with a user ID. Unauthenticated connections are immediately closed with code `1008`.

## Source Files

| File | Purpose |
|---|---|
| `apps/api/src/utils/logger.ts` | Winston logger configuration |
| `apps/api/src/services/docker.ts` | `getContainerLogs()`, Docker log parsing |
| `apps/api/src/websocket/server.ts` | WebSocket log streaming, multiplexed stream parser |
| `apps/api/src/queues/setup.ts` | Build log accumulation during deployment |
