---
sidebar_position: 3
title: Preview Deployments
description: Automatic ephemeral environments for pull request branches with configurable TTL.
---

# Preview Deployments

Preview deployments create **isolated, ephemeral environments** for non-main branches -- typically pull request branches. Each preview deployment gets its own container and URL, allowing you to test changes before merging.

## Enabling Preview Deployments

On an application, set `previewDeployments` to `true`, configure the `mainBranch` (default: `main`), and set the `previewTtlHours` for automatic cleanup (default: 72 hours).

## How It Works

1. A push is made to a non-main branch (e.g., `feature/login-page`).
2. The Git provider sends a webhook to GuildServer.
3. GuildServer detects the branch is not the main branch and creates a **preview deployment**.
4. The source is built and deployed in an isolated container.
5. A unique URL is assigned: `<app-name>-<branch>.guildserver.localhost`.
6. After the configured TTL, the preview is automatically cleaned up.

## Preview URLs

Preview deployments follow a naming pattern:

```
<app-name>-<sanitized-branch-name>.<base-domain>
```

For example, an app named `frontend` on branch `feature/login` gets `frontend-feature-login.guildserver.localhost`.

## Preview Environment Variables

Preview deployments use variables scoped to `preview`. This lets you configure different database URLs, API keys, or feature flags for preview environments without affecting production.

## Automatic Cleanup

Preview environments are cleaned up when the TTL expires, the branch is deleted from the repository, or a user manually deletes the preview deployment.

## Related Pages

- [Git Deployments](./git-deployments) -- Standard branch deployments
- [Webhooks](./webhooks) -- Trigger preview deployments
- [Environment Variables](/concepts/environment-variables) -- Preview-scoped variables
