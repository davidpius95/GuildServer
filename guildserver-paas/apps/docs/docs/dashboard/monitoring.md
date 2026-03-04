---
title: "Monitoring"
sidebar_position: 8
---

# Monitoring

The Monitoring page (`/dashboard/monitoring`) provides real-time observability into your infrastructure, applications, and system health. It features interactive charts powered by Recharts, configurable time ranges, and alert management.

## Page Layout

The page consists of:

1. **Header** -- title, description, time range selector, and refresh button
2. **System overview cards** -- four metric summary cards
3. **Tab system** with four tabs: Performance, Applications, System Health, and Alerts

## Time Range Selector

A button group in the header lets you select the time window for historical data:

| Range | Description |
|---|---|
| **1h** | Last hour |
| **6h** | Last 6 hours |
| **24h** | Last 24 hours (default) |
| **7d** | Last 7 days |

Changing the time range re-fetches organization metrics from the `monitoring.getOrganizationMetrics` endpoint.

## Refresh

The Refresh button manually re-fetches all four monitoring queries simultaneously (organization metrics, system health, alerts, and application summary). It shows a spinning animation during the refresh.

## System Overview Cards

Four cards provide an at-a-glance summary of system health:

| Card | Data |
|---|---|
| **CPU Usage** | Current aggregate CPU percentage across all running apps, with a progress bar. Shows the number of running apps below. |
| **Memory Usage** | Current aggregate memory in megabytes, with a progress bar. Shows the number of active containers. |
| **Applications** | Running apps vs. total apps (e.g., "3/5"), with badges showing running and stopped counts. |
| **Active Alerts** | Total alert count, with badges breaking down critical (red) and warning (yellow) counts. Shows "All Clear" when no alerts exist. |

## Staggered Refresh Intervals

To prevent all API queries from firing simultaneously (thundering herd), each data source uses a different refresh interval:

| Data Source | Interval | Endpoint |
|---|---|---|
| Organization metrics | 30 seconds | `monitoring.getOrganizationMetrics` |
| System health | 45 seconds | `monitoring.getSystemHealth` |
| Alerts | 60 seconds | `monitoring.getAlerts` |
| Application summary | 30 seconds | `monitoring.getApplicationsSummary` |

:::info
Staggered intervals spread API load over time, improving perceived responsiveness and reducing server pressure compared to synchronizing all queries on the same interval.
:::

## Performance Tab

### CPU & Memory Over Time

A **LineChart** displays historical CPU and memory data over the selected time range:

- Purple line: CPU percentage
- Green line: Memory in MB
- Grid, axes, and tooltip for hover inspection
- Dot-less lines with 2px stroke width for clean visualization

When no data points have been collected yet, a placeholder message appears: "Waiting for metrics data... Metrics are collected every 15 seconds."

### Per-Application Resource Usage

A **BarChart** shows current CPU and memory usage broken down by application:

- Purple bars: CPU percentage per app
- Green bars: Memory in MB per app
- Only healthy (running) applications are included

When no running applications exist, a placeholder message appears: "No running applications. Deploy an application to see metrics."

### Deployment Statistics

When organization metrics are available, four additional cards display:

| Card | Description |
|---|---|
| **Total Deployments** | Cumulative count of all deployments. |
| **Successful** | Count of successful deployments (shown in green). |
| **Success Rate** | Percentage calculated as `successful / total * 100`. |
| **Running Apps** | Running apps vs. total applications ratio. |

## Applications Tab

Lists per-application metrics in a detailed view. Each application entry shows:

- **App name** with a server icon
- **CPU usage** as a percentage
- **Memory usage** in MB
- **Network I/O** (received and transmitted bytes, formatted with `formatBytes`)
- **Health status badge**: Healthy (green), Unhealthy (yellow for running but unhealthy), or the current status (gray)
- **Uptime** formatted as days/hours/minutes (e.g., "2d 5h", "45m")

When no applications exist, a placeholder with a server icon appears.

## System Health Tab

Provides a detailed breakdown of infrastructure health:

### Overall Status

The section header includes the overall health badge (Healthy, Warning, or Critical) derived from the `monitoring.getSystemHealth` response.

### Infrastructure Services

A 2-column grid displays each infrastructure service:

- **Status icon** (green check, yellow warning, red X)
- **Service name** (e.g., Docker Engine, API Server)
- **Uptime** (e.g., "2d 5h")
- **Response time** for latency-sensitive services

### Container Summary

A 4-column grid shows container statistics:

| Metric | Color |
|---|---|
| **Total** | Default |
| **Running** | Green |
| **Stopped** | Gray |
| **Errored** | Red |

### Application Health

When per-application health data is available, a list shows each application with:

- A heart icon (green for healthy, red for unhealthy)
- App name and uptime or status description
- Health badge (Healthy or the current error status)

## Alerts Tab

Displays active alerts based on container health and resource usage thresholds:

Each alert entry includes:

- **Severity icon** (red X for critical, yellow warning for warning, blue check for info)
- **Alert title** in bold
- **Severity badge** with color coding (red for critical, yellow for warning, blue for info)
- **Description** of the alert condition
- **Timestamp** showing when the alert was triggered

When no alerts exist, a green checkmark icon appears with "All Clear" and the message "No active alerts. All systems operating normally."

:::tip
Alerts are generated automatically based on container health checks and resource usage thresholds. You do not need to configure them manually. To receive alerts via email or Slack, configure your notification preferences in [Settings](./settings.md).
:::

## Related Pages

- [Dashboard Overview](./overview.md) -- system health summary on the main dashboard
- [Application Detail](./app-detail.md) -- per-app metrics and container logs
- [Settings](./settings.md) -- configure alert notification channels
- [Deployments](./deployments-page.md) -- deployment success rates
