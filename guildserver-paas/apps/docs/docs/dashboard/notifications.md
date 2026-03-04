---
title: "Notifications"
sidebar_position: 10
---

# Notifications

The Notifications page (`/dashboard/notifications`) displays a chronological feed of all system notifications with filtering, pagination, and bulk management actions. Notifications inform you about deployment outcomes, preview events, certificate status, webhook failures, and team changes.

## Page Layout

The page consists of:

1. **Header** -- title with bell icon, unread summary, "Mark all read" button, and refresh button
2. **Filter bar** -- toggle between All and Unread
3. **Notification list** -- paginated list of notification cards
4. **Pagination** -- page navigation controls

## Header

The header dynamically shows context about your notification state:

- When unread notifications exist: "You have N unread notification(s)"
- When all are read: "You're all caught up!"

**Action buttons:**
- **Mark all read** -- marks every unread notification as read in a single operation (only visible when unread count > 0)
- **Refresh** -- manually re-fetches the notification list (shows spinning animation during fetch)

## Filtering

Two filter buttons let you control the view:

| Filter | Description |
|---|---|
| **All** | Shows all notifications, both read and unread. |
| **Unread** | Shows only unread notifications. Includes a badge with the unread count when > 0. |

Changing the filter resets the page number to 0.

## Notification List

Notifications are displayed as cards, paginated at **20 per page**. Each notification card includes:

### Visual Structure

- **Type icon** -- a colored icon on the left indicating the notification type (see table below)
- **Title** -- bold text for unread notifications, regular weight for read
- **Unread indicator** -- a small primary-colored dot next to unread notification titles
- **Message** -- descriptive text explaining the event
- **Timestamp** -- relative time (e.g., "just now", "5m ago", "2h ago", "3d ago")
- **Mark as read** button -- appears only for unread notifications

Unread notifications are visually distinguished with a subtle primary-colored border and background tint.

### Notification Types

| Type | Icon | Color | Description |
|---|---|---|---|
| `deployment_success` | Rocket | Green | A deployment completed successfully. |
| `deployment_failed` | X Circle | Red | A deployment failed or errored out. |
| `preview_created` | Git Branch | Purple | A preview deployment is ready. |
| `preview_expired` | Clock | Yellow | A preview deployment has expired. |
| `certificate_expiring` | Shield | Yellow | An SSL certificate is about to expire. |
| `certificate_failed` | Shield | Yellow | SSL certificate provisioning failed. |
| `webhook_failed` | Webhook | Orange | A webhook delivery failed. |
| `member_added` | Users | Blue | A new member joined the team. |
| `member_removed` | Users | Blue | A member was removed from the team. |
| Default | Bell | Muted | Any other notification type. |

### Mark as Read

Each unread notification has a "Read" button with a checkmark icon. Clicking it calls the `notification.markRead` mutation for that specific notification, then refetches both the notification list and unread count.

## Unread Count

The unread count is fetched independently via `notification.getUnreadCount` and used in:

- The header subtitle text
- The Unread filter button badge
- The "Mark all read" button visibility

:::info
The unread count badge also appears in the dashboard navigation header, providing a persistent indicator of pending notifications across all pages.
:::

## Pagination

When the current page contains 20 or more notifications (the page limit), pagination controls appear:

- **Page indicator** -- "Page N" text
- **Previous** button -- disabled on the first page
- **Next** button -- disabled when the current page has fewer than 20 results

## Empty States

Two contextual empty states are supported:

- **No unread notifications** (when Unread filter is active): "No unread notifications. You're all caught up!"
- **No notifications at all** (when All filter is active): "Notifications will appear here when deployments complete, previews are created, or team events occur."

Both display a dimmed bell icon above the message.

## Configuring Notifications

Notification preferences (which events trigger which channels) are configured in [Settings > Notifications](./settings.md). You can enable or disable In-App, Email, and Slack delivery for each event type independently.

## Related Pages

- [Settings](./settings.md) -- configure notification preferences and channels
- [Application Detail](./app-detail.md) -- deployment events that trigger notifications
- [Team Management](./team-management.md) -- team events that trigger notifications
