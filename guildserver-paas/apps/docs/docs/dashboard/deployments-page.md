---
title: "Deployments"
sidebar_position: 4
---

# Deployments

The Deployments page (`/dashboard/deployments`) provides a unified view of deployment history across all applications in your organization. It supports filtering, searching, expandable build logs, and rollback functionality.

## Page Layout

The page is organized into:

1. **Header** -- title with rocket icon and description
2. **Filter bar** -- status filters, time range filters, search input, and refresh button
3. **Deployment table** -- expandable rows with a column header
4. **Pagination** -- page controls for navigating large result sets

Deployment data is fetched from the `deployment.listAll` tRPC endpoint and refreshes automatically every **15 seconds**.

## Filtering

### Status Filter

A row of buttons lets you filter deployments by status:

| Filter | Description |
|---|---|
| **All** | Shows all deployments regardless of status. |
| **Completed** | Only successful deployments. |
| **Building** | Deployments currently in the build phase. |
| **Failed** | Deployments that encountered errors. |
| **Cancelled** | Deployments that were manually cancelled. |

### Time Range Filter

A separate button group filters by time window:

| Range | Description |
|---|---|
| **All Time** | No time constraint. |
| **Last 24h** | Deployments within the past 24 hours. |
| **Last 7d** | Deployments within the past 7 days. |
| **Last 30d** | Deployments within the past 30 days. |

Changing either filter resets the page number back to the first page.

### Search

A search input (264px wide) filters deployments client-side by:

- Application name
- Git commit SHA

### Refresh

A refresh button manually re-fetches the deployment list. It displays a spinning animation while the refetch is in progress.

## Deployment Table

The table uses a 7-column grid layout with a sticky header:

| Column | Content |
|---|---|
| **Expand** | Chevron icon that toggles the expanded row (right when collapsed, down when expanded). |
| **Application** | App name and project name shown on two lines. |
| **Status** | Icon and color-coded badge (green for completed, blue for building/deploying/running, red for failed, yellow for cancelled). |
| **Commit / Source** | Git commit SHA (first 8 characters) with branch icon, or "Docker" with container icon. |
| **Duration** | Formatted as seconds or minutes+seconds (e.g., "4m 32s"). Shows a dash when unavailable. |
| **Time** | Relative timestamp using a `timeAgo` function (e.g., "just now", "5m ago", "2h ago", "3d ago"). |
| **Actions** | Rollback button for completed deployments with an image tag. |

:::info
Deployment rows are individually memoized to prevent unnecessary re-renders when other rows are expanded or collapsed.
:::

### Expandable Build Logs

Clicking a deployment row expands it to reveal build logs in a terminal-style viewer:

- Dark background (`gray-950`) with green monospace text
- **Error lines** highlighted in red (lines containing "ERROR" or "error")
- **Step headers** highlighted in blue (lines starting with "Step" or "---")
- **Success lines** highlighted in green (lines starting with "Successfully" or containing "completed")
- Maximum height of 256px with vertical scroll overflow

If deployment logs are also available, they appear in a separate section below with cyan text on a dark background.

When no build logs are available, the message "No build logs available" is displayed in gray text.

### Rollback

The Rollback button is available on completed deployments that have an image tag. Clicking it opens a confirmation dialog:

- **Title**: "Roll back to this deployment?"
- **Description**: Explains the time context and that the current deployment will be replaced
- **Confirm label**: "Roll Back"
- **Variant**: Warning (amber styling)

:::warning
Rolling back replaces the currently running container with the selected deployment's image. The rollback itself creates a new deployment entry in the history.
:::

## Pagination

When the total number of deployments exceeds the page limit (**20 per page**), pagination controls appear at the bottom:

- A text summary: "Showing 1-20 of 45 deployments"
- **Previous** and **Next** buttons
- Buttons are disabled at the first and last pages respectively

## Status Color Coding

Deployments use a consistent color scheme across the UI with dark mode support:

| Status | Light Mode | Dark Mode |
|---|---|---|
| `completed` | Green 50/700 | Green 950/400 |
| `building` / `deploying` / `running` | Blue 50/700 | Blue 950/400 |
| `pending` | Gray 50/700 | Gray 800/400 |
| `failed` | Red 50/700 | Red 950/400 |
| `cancelled` | Yellow 50/700 | Yellow 950/400 |

## Empty State

When no deployments match the current filters, an empty state card displays with:

- A rocket icon
- "No deployments found" heading
- A contextual message (filter-aware, e.g., "No completed deployments. Try changing your filters.")
- A "Clear filters" button when filters are active

## Related Pages

- [Application Detail](./app-detail.md) -- per-app deployments and build logs
- [Applications](./applications-page.md) -- manage and deploy individual apps
- [Monitoring](./monitoring.md) -- deployment success rate and performance metrics
