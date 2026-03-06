---
sidebar_position: 2
title: Docker Deployments
description: Deploy pre-built Docker images from any container registry.
---

# Docker Deployments

If you already have a Docker image built and pushed to a container registry, you can deploy it directly on GuildServer without a build step. This is useful for images from CI/CD pipelines, third-party software, or private registries.

## Deploying a Docker Image

1. Create a new application and select **Docker** as the source type.
2. Enter the image name and tag (e.g., `nginx:latest`, `ghcr.io/myorg/myapp:v1.2`).
3. Configure the container port.
4. Click **Deploy**.

GuildServer will pull the image, create a container, and route traffic through Traefik.

## Supported Registries

GuildServer can pull from any Docker-compatible registry:

- **Docker Hub** -- `nginx:latest`, `postgres:15-alpine`
- **GitHub Container Registry** -- `ghcr.io/org/repo:tag`
- **AWS ECR** -- `123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:tag`
- **Google Artifact Registry** -- `us-docker.pkg.dev/project/repo/image:tag`
- **Azure Container Registry** -- `myregistry.azurecr.io/myapp:tag`
- **Self-hosted registries** -- Any registry accessible from the GuildServer host

## Configuration

| Field | Description |
|-------|-------------|
| `dockerImage` | Full image name including registry |
| `dockerTag` | Image tag (default: `latest`) |
| `containerPort` | Port the application listens on inside the container |
| `environment` | Environment variables to pass to the container |
| `memoryLimit` | Maximum memory in MB |
| `cpuLimit` | Maximum CPU cores |

## Updating the Image

To deploy a new version, update the `dockerTag` and trigger a new deployment. Because the image is already built, Docker deployments are faster than Git-based deployments.

## Private Registry Authentication

For private registries that require authentication, configure Docker credentials on the GuildServer host using `docker login` before deploying.

## Related Pages

- [Git Deployments](./git-deployments) -- Deploy from source code
- [Rollbacks](./rollbacks) -- Revert to a previous image
- [Applications](/concepts/applications) -- Application configuration
