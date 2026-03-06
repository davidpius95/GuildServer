---
title: "Application Detail"
sidebar_position: 3
---

# Application Detail

The Application Detail page (`/dashboard/applications/[id]`) provides a comprehensive view of a single application, including real-time metrics, deployment history, environment configuration, domain management, live logs, and webhooks.

## Header

The page header displays:

- A **back button** that returns to the [Applications](./applications-page.md) list
- The **application name** in large bold text
- A color-coded **status badge** (running, deploying, building, failed, stopped, pending)
- The **source description** -- either `Docker: image:tag` or the repository URL
- Three action buttons: **Deploy**, **Restart**, and **Delete**

Clicking Deploy immediately triggers a new deployment, auto-switches to the Build Logs tab, and begins streaming logs in real time.

:::warning
The Delete button opens a confirmation dialog. Deleting an application permanently stops and removes the container, and this action cannot be undone.
:::

## Metrics Cards

When metrics data is available, four cards display real-time container statistics in a 4-column grid:

| Card | Data |
|---|---|
| **Status** | Current application status with a matching icon and capitalized label. |
| **CPU Usage** | Current CPU usage as a percentage (e.g., "2.3%"). Displays "N/A" when unavailable. |
| **Memory** | Current memory consumption in megabytes (e.g., "64.2 MB"). Displays "N/A" when unavailable. |
| **Network** | Received bytes formatted in KB (e.g., "512 KB"). Displays "N/A" when unavailable. |

Metrics refresh automatically every **30 seconds** via the `application.getMetrics` endpoint.

## Tab System

Below the metrics, a tab bar provides access to seven tabs:

### 1. Deployments Tab

Displays the deployment history for this application. Each deployment entry shows:

- A **status icon** (green check, blue pulse, red X)
- **Commit SHA** (first 8 characters) for Git deployments, or "Deployment" for Docker
- **Timestamp** with calculated duration in seconds
- A **Rollback** button (visible only for completed deployments that produced an image tag)
- A **status badge** that shows "rollback" for rollback-type deployments

Clicking a deployment card selects it and highlights it with a primary ring border. If no deployments exist, a "Deploy Now" button is shown.

### 2. Preview Tab

Manages preview deployment settings for Git-based applications:

- **Enable/Disable toggle** -- a button that controls whether preview deployments are active
- **Main Branch** -- the branch that triggers production deployments (default: `main`). All other branches create preview deployments.
- **Preview TTL (hours)** -- how long preview containers live before automatic cleanup (default: 72 hours)
- **Active Previews list** -- shows currently running preview deployments with branch name, purple "preview" badge, timestamp, and an "Open" link to the preview URL

:::info
Preview deployments are only available for Git-based applications. Docker image apps will see a message explaining this limitation.
:::

### 3. Environment Tab

Manages environment variables with scoped access:

**Scope selector** -- three buttons let you switch between `Production`, `Preview`, and `Development` scopes. Each scope maintains its own independent set of variables.

**Variable list** -- each variable displays:
- The key in monospace bold (minimum width 180px)
- The value (or masked dots for secrets)
- A shield icon for encrypted secrets
- A delete button

**Secret masking** -- variables marked as secret display their values as dots. A "Show/Hide secret values" toggle reveals or conceals all secret values at once.

**Add Variable form** -- at the bottom, a form lets you add new variables:
- KEY input (auto-uppercased as you type)
- Value input (rendered as a password field when the secret toggle is active)
- A shield button to toggle between secret and plain text modes
- An "Add" button to save

:::tip
Environment variables are injected at deploy time. After adding or changing variables, trigger a new deployment for the changes to take effect. Secrets are encrypted at rest using AES-256-CBC.
:::

### 4. Domains Tab

Manages custom domains and auto-generated URLs:

- **Generate Auto URL** button -- creates a `*.localhost` domain automatically for local development
- **Domain list** -- each domain shows:
  - The domain name in monospace code font
  - Badges for: Primary, Auto-generated, SSL (for verified non-localhost custom domains), and verification status
  - CNAME verification instructions for unverified domains (format: `_gs-verify.yourdomain.com`)
  - Action buttons: Verify, Set Primary, and Remove

**Adding a custom domain:**
1. Enter the domain in the input field and click "Add Domain"
2. Create the CNAME record shown in the verification instructions
3. Click "Verify" once the DNS record propagates
4. Optionally click "Set Primary" to make it the default access URL

### 5. Container Logs Tab

Displays the most recent **50 lines** of container output in a terminal-style viewer. Logs are fetched from the `application.getLogs` endpoint and refresh every **30 seconds**.

The log viewer uses a dark background with monospace green text, replicating a terminal aesthetic. Error lines are highlighted in red and step headers are highlighted in blue.

### 6. Build Logs Tab

Provides real-time build log streaming during active deployments:

- **DeployStepper** component shows a visual pipeline: Validate, Clone, Build, Deploy, Health Check
- Each step transitions through pending, active, completed, and failed states
- **Live log streaming** via WebSocket connection that persists across the session
- **Following mode** toggle -- when enabled, the log view auto-scrolls to the latest output
- **Deployment URL** link appears after a successful deployment

The WebSocket connection is managed by the `useDeploymentStream` hook. When a deployment completes or fails, the app data is automatically refetched so the metrics and status badge update.

:::info
The build log stream stays connected persistently so it is ready the moment a deployment starts. The deployment ID controls which events are processed, not whether the WebSocket connects.
:::

### 7. Webhooks Tab

Manages webhook configuration for the application:

- **Webhook URL** -- a read-only field displaying the unique webhook endpoint, with a copy-to-clipboard button
- **Test Webhook** button -- sends a test payload that triggers a deployment
- **Delivery History** -- lists the most recent 20 webhook deliveries with expandable details showing request/response data, timestamps, and status codes

Delivery history refreshes every **30 seconds** when the Webhooks tab is active.

## Data Refresh Strategy

| Data | Interval | Notes |
|---|---|---|
| Application details | 15 seconds | Core app data including deployments |
| Container logs | 30 seconds | Last 50 lines |
| Metrics (CPU, memory, network) | 30 seconds | Live container stats |
| Build logs | Real-time | WebSocket streaming |
| Environment variables | On demand | Refetches after mutations |
| Domains | On demand | Refetches after mutations |
| Webhook deliveries | 30 seconds | Only when Webhooks tab is active |

## Related Pages

- [Applications](./applications-page.md) -- return to the full application list
- [Deployments](./deployments-page.md) -- see deployments across all applications
- [Monitoring](./monitoring.md) -- organization-wide resource metrics
