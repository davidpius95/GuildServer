---
sidebar_position: 5
title: Build Logs
description: Understand and troubleshoot build logs for GuildServer deployments.
---

# Build Logs

Every GuildServer deployment captures complete build and deployment logs. These logs are essential for debugging failed builds and understanding what happened during the deployment process.

## Viewing Build Logs

### Dashboard

1. Navigate to the application's **Deployments** tab.
2. Click on a deployment.
3. The build logs are displayed in a scrollable terminal-style view.
4. For active deployments, logs stream in real time via WebSocket.

### API

Retrieve deployment details including `buildLogs` and `deploymentLogs` through the deployment API endpoints.

## Log Structure

Logs are divided into two sections:

### Build Logs

Captured during the image build phase: Git clone output, build tool output, dependency installation, compilation output, and image tagging.

### Deployment Logs

Captured during the container deployment phase: container creation, health check results, Traefik routing updates, and container start confirmation.

## Real-Time Streaming

For in-progress deployments, GuildServer streams logs in real time via WebSocket. The dashboard automatically subscribes to the WebSocket channel for the active deployment and renders log lines as they arrive.

## Common Build Failures

| Error | Cause | Fix |
|-------|-------|-----|
| Repository not found | Git URL is incorrect or private repo without auth | Check the repository URL and OAuth connection |
| COPY failed: file not found | Dockerfile references a file not in the build context | Check the buildPath and Dockerfile COPY paths |
| Dependency resolution conflict | npm/yarn/pnpm version conflicts | Fix dependency versions in package.json |
| Listen EADDRINUSE | Container port conflict | Verify containerPort matches what your app uses |
| OOMKilled | Container exceeded memory limit | Increase memoryLimit |

## Related Pages

- [Deployments](/concepts/deployments) -- Deployment lifecycle
- [Rollbacks](./rollbacks) -- Revert when builds fail
- [WebSocket API](/api/websocket) -- Real-time log streaming
