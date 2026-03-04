---
sidebar_position: 4
title: Rollbacks
description: Revert to a previous deployment by re-deploying a known-good container image.
---

# Rollbacks

Rollbacks let you revert an application to a previously successful deployment. Instead of rebuilding from source, GuildServer re-deploys the Docker image from the selected deployment, making rollbacks nearly instantaneous.

## How Rollbacks Work

1. Navigate to the application's deployment history.
2. Find a previously successful deployment.
3. Click **Rollback to this deployment**.
4. GuildServer creates a new deployment record with `deploymentType: "rollback"`.
5. The `sourceDeploymentId` links back to the original deployment.
6. The container is replaced with the original deployment's image.
7. Traffic is routed to the new container.

Because the build step is skipped, rollbacks typically complete in seconds rather than minutes.

## What Gets Rolled Back

- **Container image** -- The exact Docker image from the previous deployment is reused.
- **Environment variables** -- The current environment variables are used (not the ones from the previous deployment).

## What Does NOT Get Rolled Back

- **Database state** -- Database schema changes and data are not affected. Handle database rollbacks separately.
- **External services** -- Third-party integrations are not reverted.

## Rollback Chain

GuildServer preserves the full deployment chain. You can roll back to any previously successful deployment, not just the immediately prior one.

## Related Pages

- [Deployments](/concepts/deployments) -- Deployment lifecycle
- [Build Logs](./build-logs) -- Investigating failures
- [Deployments API](/api/deployments) -- API reference
