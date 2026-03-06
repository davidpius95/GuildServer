---
sidebar_position: 4
title: Deployments
description: Learn about the GuildServer deployment lifecycle, from build to running container, including rollbacks and preview deployments.
---

# Deployments

A deployment in GuildServer represents a single **build-and-run cycle** for an [application](./applications). Each time you deploy, GuildServer creates a new deployment record that tracks the build process, logs, container image, and final status.

## Deployment Properties

| Field | Description |
|-------|-------------|
| `title` | Optional human-readable title for the deployment |
| `description` | Optional description or changelog |
| `status` | Current status of the deployment |
| `applicationId` | The application being deployed |
| `gitCommitSha` | Git commit SHA that triggered this deployment |
| `buildLogs` | Complete build output |
| `deploymentLogs` | Runtime deployment logs |
| `imageTag` | Docker image tag produced by this deployment |
| `deploymentType` | `standard`, `rollback`, or `preview` |
| `triggeredBy` | User or system that initiated the deployment |
| `isPreview` | Whether this is a preview deployment |
| `previewBranch` | Branch name for preview deployments |
| `sourceDeploymentId` | For rollbacks, links to the original deployment |
| `startedAt` | When the deployment started |
| `completedAt` | When the deployment finished |

## Deployment Statuses

| Status | Description |
|--------|-------------|
| `pending` | Deployment is queued and waiting to be processed |
| `building` | Source code is being pulled and container image is being built |
| `deploying` | Container is being started and health checks are running |
| `running` | Deployment is live and serving traffic |
| `failed` | Build or deployment failed (check logs for details) |
| `cancelled` | Deployment was cancelled by the user |
| `rolled_back` | This deployment was replaced by a rollback |

## Deployment Flow

```
1. Trigger       →  Create deployment record (status: pending)
2. Queue         →  Add to BullMQ build queue
3. Pull Source   →  Clone git repo or pull Docker image
4. Build         →  Run build process (Dockerfile, Nixpacks, etc.)
5. Tag Image     →  Tag the built image with deployment ID
6. Deploy        →  Create/update container with new image
7. Health Check  →  Verify the container is healthy
8. Route Traffic →  Update Traefik routing to new container
9. Complete      →  Mark deployment as running
```

## Deployment Types

### Standard Deployment

The default deployment type. Triggered by manual deploy from the dashboard, Git push with auto-deployment enabled, webhook from a Git provider, or API call.

### Rollback Deployment

A rollback creates a new deployment that re-uses the Docker image from a previous successful deployment. This is faster than a standard deployment because it skips the build step entirely. The `sourceDeploymentId` field links the rollback to the original deployment it reverts to.

### Preview Deployment

Preview deployments are created automatically for non-main branch pushes when preview deployments are enabled on the application. They run in isolation with their own container, get a unique URL based on the branch name, and are automatically cleaned up after the configured TTL (default: 72 hours).

## Real-Time Logs

GuildServer streams build and deployment logs in real time via WebSocket. The dashboard connects to the WebSocket server and subscribes to log events for the active deployment, giving immediate feedback during the build-and-deploy process.

## Related Concepts

- [Git Deployments](/deployment/git-deployments) — Deploying from Git repositories
- [Docker Deployments](/deployment/docker-deployments) — Deploying Docker images
- [Preview Deployments](/deployment/preview-deployments) — PR-based environments
- [Rollbacks](/deployment/rollbacks) — Reverting to previous deployments
- [Build Logs](/deployment/build-logs) — Understanding build output
