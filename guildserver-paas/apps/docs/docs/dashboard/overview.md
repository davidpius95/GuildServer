---
title: "Dashboard Overview"
sidebar_position: 1
---

# Dashboard Overview

The GuildServer Dashboard is the central hub for monitoring and managing your entire deployment environment. When you sign in and navigate to `/dashboard`, you land on the overview page, which surfaces real-time data about your applications, projects, containers, and infrastructure health.

## Onboarding State

If you have not yet created an organization, the dashboard renders a welcome prompt instead of the standard overview. This prompt displays a "Get Started" button that navigates to `/dashboard/onboarding`, where you can create your first organization.

:::tip
Organizations are the top-level resource in GuildServer. Every project, application, and team member belongs to an organization. You must create one before you can deploy anything.
:::

## Stats Cards

The top of the dashboard displays four animated stats cards arranged in a responsive grid (2 columns on medium screens, 4 on large screens):

| Card | Description |
|---|---|
| **Applications** | Total count of applications in the current project. Below the number, running and failed counts are highlighted in green and red respectively. |
| **Projects** | Number of projects within the current organization. |
| **Running** | Count of applications with `running` status, shown in green. When system health data is available, it also reports the running vs. total container ratio (e.g., "3/5 containers"). |
| **Status** | Overall system health. Displays "Healthy", "Warning", or "Critical" with matching color coding. Derived from the `monitoring.getSystemHealth` API endpoint, falling back to a heuristic based on failed application count. |

The stats cards use staggered entrance animations for a polished loading experience.

## Deployment Activity Chart

Below the stats cards, a dedicated card renders a **Deployment Activity** chart powered by Recharts. This chart visualizes the number of deployments per day over the **last 7 days** using a bar or area chart.

The chart component (`DeploymentActivity`) accepts a `days` prop and queries the API for historical deployment data scoped to the current organization.

## Recent Applications

The lower-left section displays up to **5 of your most recent applications** in a compact list. Each entry includes:

- A **status icon** (green check for running, blue pulse for deploying/building, red X for failed, yellow warning for stopped)
- The **application name**
- The **source description** (Docker image and tag for Docker apps, or repository URL for Git apps)
- A color-coded **status badge**

Clicking any application navigates to its [Application Detail](./app-detail.md) page. If more than 5 applications exist, a "View all N applications" button links to the [Applications](./applications-page.md) page.

:::info
When no applications exist, the dashboard shows an empty state with a call-to-action button: "Deploy your first app", which navigates to the applications page.
:::

## System Status

The lower-right card displays **real-time infrastructure health** data. This data is fetched from the `monitoring.getSystemHealth` tRPC endpoint and refreshes automatically every **30 seconds**.

Each service entry shows:

- A health status icon (green check, yellow warning, or red X)
- The **service name** (e.g., Docker Engine, API Server, Database)
- **Uptime** information when available
- A color-coded **health badge** (Healthy, Warning, or Down)

If the health check API is unreachable (e.g., during API startup), the card displays an "Unavailable" badge with a **Retry** button.

## Quick Actions

At the bottom of the dashboard, three quick-action buttons are arranged in a 3-column grid:

| Action | Link | Description |
|---|---|---|
| **Deploy Application** | `/dashboard/applications?action=create` | Opens the create application modal. See [Applications](./applications-page.md). |
| **Create Database** | `/dashboard/databases` | Navigates to the databases page. See [Databases](./databases-page.md). |
| **Invite Team Member** | `/dashboard/team` | Navigates to team management. See [Team Management](./team-management.md). |

Each button displays an icon, a title, and a brief description (e.g., "Deploy from Git or Docker").

## Data Refresh Behavior

The dashboard uses several polling strategies to keep data fresh without overwhelming the API:

| Data | Refresh Interval |
|---|---|
| Application list | On demand (query-based) |
| System health | Every 30 seconds |
| Deployment activity chart | On page load |

:::warning
If you notice the Status card showing "Unavailable", check that the API server is running and accessible. The health endpoint requires a valid organization ID in UUID format.
:::

## Navigation

From the dashboard, you can navigate to all other sections of GuildServer:

- [Applications](./applications-page.md) -- manage and deploy your apps
- [Deployments](./deployments-page.md) -- view deployment history across all apps
- [Databases](./databases-page.md) -- provision and manage database instances
- [Monitoring](./monitoring.md) -- deep-dive into system metrics and charts
- [Team Management](./team-management.md) -- invite members and manage roles
- [Settings](./settings.md) -- configure your organization and integrations
