---
sidebar_position: 1
title: Git Deployments
description: Deploy applications from Git repositories with automatic builds and webhook-triggered deployments.
---

# Git Deployments

GuildServer supports deploying applications directly from Git repositories. When you connect a repository, GuildServer clones the source code, builds a container image using your chosen build strategy, and deploys the container with automatic domain routing.

## Supported Git Providers

| Provider | Source Type | Features |
|----------|-----------|----------|
| **GitHub** | github | OAuth integration, repository browser, webhook auto-setup |
| **GitLab** | gitlab | Repository URL, manual webhook setup |
| **Bitbucket** | bitbucket | Repository URL, manual webhook setup |
| **Gitea** | gitea | Repository URL, manual webhook setup |
| **Generic Git** | git | Any HTTPS or SSH Git URL |

## GitHub Integration

GuildServer provides a first-class GitHub integration via OAuth:

1. Connect your GitHub account from the dashboard settings.
2. When creating an application, select **GitHub** as the source.
3. Browse your repositories and select one.
4. Choose a branch to deploy from.
5. GuildServer automatically sets up a webhook for push events.

The GitHub OAuth token is stored in the oauth_accounts table and used for private repository access and API calls.

## Deployment Flow

1. **Clone** -- GuildServer uses simple-git to clone the repository at the specified branch and commit.
2. **Detect** -- If no build type is explicitly set, GuildServer auto-detects based on files present (e.g., Dockerfile, package.json, requirements.txt).
3. **Build** -- The source is built into a Docker image using the configured build type.
4. **Tag** -- The image is tagged with the deployment ID for traceability.
5. **Deploy** -- A container is created from the image and connected to the GuildServer Docker network.
6. **Route** -- Traefik is configured to route traffic to the new container.

## Build Types for Git Repos

| Build Type | Detection | Description |
|-----------|-----------|-------------|
| dockerfile | Dockerfile present | Uses docker build with the repository Dockerfile |
| nixpacks | Auto-detect | Nixpacks analyzes the repo and generates a build plan |
| heroku | Procfile present | Uses Heroku buildpacks for the detected language |
| paketo | Auto-detect | Cloud Native Buildpacks |
| static | index.html in root | Serves static files with a lightweight HTTP server |
| railpack | Rails app detected | Optimized for Ruby on Rails applications |

## Configuration

### Build Path

If your application is in a subdirectory (monorepo), set the `buildPath` field to the relative path of the application source directory.

### Build Arguments

Pass build-time arguments via the `buildArgs` JSON field. These are available during the Docker build step as ARG values.

### Auto-Deployment

Enable `autoDeployment` to trigger builds on every push to the configured branch. When combined with webhooks, this provides a full continuous deployment pipeline.

## Related Pages

- [Docker Deployments](./docker-deployments) -- Deploy pre-built images
- [Preview Deployments](./preview-deployments) -- PR-based environments
- [Webhooks](./webhooks) -- Webhook configuration
- [Build Logs](./build-logs) -- Reading build output
