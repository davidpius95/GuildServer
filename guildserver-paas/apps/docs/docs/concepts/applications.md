---
sidebar_position: 3
title: Applications
description: Understand GuildServer applications — deployable services with source configuration, build settings, resource limits, and domain routing.
---

# Applications

An application in GuildServer represents a **deployable service** — a web app, API server, background worker, or any containerized process. Applications belong to a [project](./projects) and are the primary unit of deployment.

## Application Properties

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable display name |
| `appName` | string | URL-safe identifier used in auto-generated domains |
| `description` | string | Optional description |
| `projectId` | UUID | Parent project |
| `sourceType` | enum | How the source code is provided |
| `repository` | string | Git repository URL (for git-based sources) |
| `branch` | string | Git branch to deploy from (default: `main`) |
| `buildType` | enum | Build strategy to use |
| `containerPort` | integer | Port the application listens on inside the container |
| `replicas` | integer | Number of container instances (default: 1) |
| `status` | string | Current status: `inactive`, `building`, `running`, `failed`, `stopped` |

## Source Types

GuildServer supports multiple ways to provide application source code:

| Source Type | Description |
|------------|-------------|
| `github` | Deploy from a GitHub repository with OAuth-based access |
| `gitlab` | Deploy from a GitLab repository |
| `bitbucket` | Deploy from a Bitbucket repository |
| `gitea` | Deploy from a Gitea instance |
| `git` | Deploy from any Git URL (HTTPS or SSH) |
| `docker` | Deploy a pre-built Docker image from any registry |
| `drop` | Upload source code directly (file drop) |

## Build Types

Each application specifies a build strategy:

| Build Type | Description |
|-----------|-------------|
| `dockerfile` | Build using a Dockerfile in the repository |
| `nixpacks` | Automatic detection and build using Nixpacks |
| `heroku` | Build using Heroku buildpacks |
| `paketo` | Build using Paketo/Cloud Native Buildpacks |
| `static` | Serve static files (HTML, CSS, JS) |
| `railpack` | Build using Railpack |

## Resource Limits

Applications can have resource limits configured to control container resource consumption:

| Setting | Description |
|---------|-------------|
| `memoryReservation` | Guaranteed minimum memory (MB) |
| `memoryLimit` | Maximum memory the container can use (MB) |
| `cpuReservation` | Guaranteed minimum CPU cores |
| `cpuLimit` | Maximum CPU cores the container can use |

These limits are enforced at the Docker/Kubernetes level and prevent any single application from consuming all host resources.

## Preview Deployments

Applications can enable preview deployments for pull request branches:

| Setting | Description |
|---------|-------------|
| `previewDeployments` | Enable/disable preview deployments (default: `false`) |
| `mainBranch` | The production branch name (default: `main`) |
| `previewTtlHours` | Hours before preview environments are cleaned up (default: `72`) |

When enabled, pushes to non-main branches automatically create isolated preview environments with their own URLs.

## Auto-Deployment

When `autoDeployment` is enabled, GuildServer automatically deploys the application whenever new commits are pushed to the configured branch. This is triggered via [webhooks](/deployment/webhooks) from the Git provider.

## Application Lifecycle

```
Created → Building → Running ⟷ Stopped
                  ↘ Failed
```

1. **Created** — Application record exists but has never been deployed.
2. **Building** — Source code is being pulled and a container image is being built.
3. **Running** — Container is running and accepting traffic.
4. **Stopped** — Container was manually stopped by the user.
5. **Failed** — Build or deployment failed. Check build logs for details.

## Related Concepts

- [Deployments](./deployments) — How applications are built and deployed
- [Domains](./domains) — Custom domain routing
- [Environment Variables](./environment-variables) — Runtime configuration
- [Resource Limits](/infrastructure/resource-limits) — Detailed resource management
