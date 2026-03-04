---
title: "Alerts & Notifications"
sidebar_position: 4
---

# Alerts & Notifications

GuildServer includes a multi-channel notification system that delivers alerts about deployments, certificate issues, webhook failures, and billing thresholds. Notifications are sent via in-app messages, email (SMTP), and Slack webhooks.

## Notification Events

The following events trigger notifications:

| Event | Description |
|---|---|
| `deployment_success` | Application deployed successfully |
| `deployment_failed` | Deployment encountered an error |
| `preview_created` | Preview deployment is ready |
| `preview_expired` | Preview deployment cleaned up after TTL |
| `certificate_expiring` | SSL certificate expiring soon |
| `certificate_failed` | SSL certificate provisioning failed |
| `webhook_failed` | Webhook delivery to application failed |
| `member_added` | New team member joined the organization |
| `member_removed` | Team member removed from the organization |
| `spend_threshold_50` | Organization used 50% of monthly spend limit |
| `spend_threshold_75` | Organization used 75% of monthly spend limit |
| `spend_threshold_100` | Organization reached 100% of spend limit |
| `spend_limit_reached` | Deployments paused due to spend limit |
| `trial_ending` | Pro trial ending soon |

## Delivery Channels

### In-App Notifications

In-app notifications are stored in the `notifications` database table and delivered in real time via WebSocket. Each notification record contains a type, title, message, and JSON metadata. The notification is simultaneously broadcast over WebSocket using `broadcastToUser()` so the dashboard updates instantly.

In-app notifications appear in the dashboard notification bell and persist until marked as read.

### Email Notifications

Email delivery uses **Nodemailer** with SMTP. Emails are only sent when SMTP is configured:

```bash
# Required environment variables for email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASS=your-password
EMAIL_FROM=noreply@guildserver.com
```

Emails use a dark-themed HTML template including a notification title, message body, a "View Details" action button, and a footer linking to notification preferences.

:::info
If `SMTP_HOST` is not set, email notifications are silently skipped. No error is raised.
:::

### Slack Notifications

Slack integration uses **incoming webhooks**. Configure a webhook URL per organization in the `slack_configs` table. Slack messages use the **Block Kit** attachment format with color-coded sidebars:

| Event Category | Color |
|---|---|
| Deployment success | Green `#22c55e` |
| Deployment failed | Red `#ef4444` |
| Preview created | Purple `#8b5cf6` |
| Certificates / warnings | Amber `#f59e0b` |
| Member added | Blue `#3b82f6` |
| Member removed | Gray `#6b7280` |

Each Slack message includes an optional "View Details" button linking to the relevant resource.

## Notification Preferences

Users can configure per-event notification preferences. Each preference record controls three channel toggles: `emailEnabled`, `slackEnabled`, and `inAppEnabled`.

### Default Behavior

When no preference record exists for an event, the defaults apply:

| Channel | Default |
|---|---|
| In-app | Enabled |
| Email | Enabled |
| Slack | Disabled |

### Configuring Preferences

Preferences are managed in **Settings > Notifications** in the dashboard. Each event type has individual toggles for each delivery channel.

## How Notifications Are Triggered

The `notify()` function is the central entry point:

```typescript
import { notify } from "../services/notification";

await notify("deployment_success", userId, organizationId, {
  appName: "my-app",
  url: "http://my-app.example.com",
  commitSha: "a1b2c3d4",
  branch: "main",
});
```

The function generates a title/message from the event, checks user preferences, sends to each enabled channel, and logs the result.

:::warning
Notification delivery is fire-and-forget. The `notify()` call is wrapped in `.catch()` at call sites to prevent notification failures from blocking deployments.
:::

## Deployment Notifications

Deployment notifications are sent automatically by the deployment worker -- `deployment_success` on completion and `deployment_failed` on error. Each includes the app name, access URL or error message, and a link to build logs.

## Spend Threshold Alerts

Billing threshold alerts are checked after each deployment and after build minutes are tracked:

| Threshold | Event | Message |
|---|---|---|
| 50% | `spend_threshold_50` | Informational -- consider reviewing usage |
| 75% | `spend_threshold_75` | Warning -- approaching limit |
| 100% | `spend_threshold_100` | Alert -- limit reached |
| Hard cap | `spend_limit_reached` | Deployments paused until next billing period |

These are triggered by the `checkSpendThresholds()` function in the spend manager service.

## Database Tables

### notifications

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `userId` | UUID | Recipient user |
| `type` | VARCHAR(100) | Event type (e.g., `deployment_success`) |
| `title` | VARCHAR(255) | Human-readable title |
| `message` | TEXT | Detailed message body |
| `metadata` | JSONB | Event-specific data (appName, url, etc.) |
| `read` | BOOLEAN | Whether the user has read it |
| `createdAt` | TIMESTAMP | Creation time |

Indexes: `(userId)`, `(userId, read)` for efficient unread-count queries.

### notification_preferences

| Column | Type | Description |
|---|---|---|
| `userId` | UUID | User who owns the preference |
| `event` | VARCHAR(100) | Event type |
| `emailEnabled` | BOOLEAN | Send email for this event |
| `slackEnabled` | BOOLEAN | Send Slack message for this event |
| `inAppEnabled` | BOOLEAN | Store in-app notification |

### slack_configs

| Column | Type | Description |
|---|---|---|
| `organizationId` | UUID | Owning organization |
| `webhookUrl` | TEXT | Slack incoming webhook URL |
| `channelName` | VARCHAR(255) | Display name of the target channel |
| `enabled` | BOOLEAN | Whether Slack delivery is active |

## Setting Up Slack Integration

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Incoming Webhooks** and create a webhook for your channel
3. Copy the webhook URL
4. In GuildServer, go to **Settings > Integrations > Slack**
5. Paste the webhook URL and select the channel
6. Enable the events you want to receive in Slack

## Source Files

| File | Purpose |
|---|---|
| `apps/api/src/services/notification.ts` | `notify()` function, all delivery channels |
| `packages/database/src/schema/index.ts` | `notifications`, `notificationPreferences`, `slackConfigs` tables |
| `apps/api/src/queues/setup.ts` | Deployment worker notification calls |
