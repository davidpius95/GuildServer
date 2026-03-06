---
sidebar_position: 13
title: Notifications API
description: Notification management and preference endpoints.
---

# Notifications API

All endpoints in this section are available through the `notification` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/notification.<procedure>`

## Procedures

### `list`

- **Type:** query
- **Description:** List notifications for the authenticated user.
- **Input:** { limit?, unreadOnly? }
- **Returns:** Notification[]

### `markRead`

- **Type:** mutation
- **Description:** Mark a notification as read.
- **Input:** { id }

### `markAllRead`

- **Type:** mutation
- **Description:** Mark all notifications as read.

### `getPreferences`

- **Type:** query
- **Description:** Get notification preferences.
- **Returns:** NotificationPreference[]

### `updatePreferences`

- **Type:** mutation
- **Description:** Update notification preferences for an event.
- **Input:** { event, emailEnabled?, slackEnabled?, inAppEnabled? }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
