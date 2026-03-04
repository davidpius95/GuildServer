---
title: "Team Management"
sidebar_position: 6
---

# Team Management

The Team Management page (`/dashboard/team`) lets you view, search, and manage organization members, understand role-based permissions, and review audit logs of actions taken within your organization.

## Page Layout

The page consists of:

1. **Header** -- title, description, and a Refresh button
2. **Stats cards** -- four summary cards in a responsive grid
3. **Tab system** with three tabs: Members, Roles & Permissions, and Audit Log

## Stats Cards

Four cards provide a quick summary of your team:

| Card | Description |
|---|---|
| **Total Members** | Count of all members in the organization, with the number of active members shown below. |
| **Organization** | The current organization name displayed in bold, with the organization slug below. |
| **Admins** | Number of members with `admin` or `owner` roles. |
| **Audit Events** | Count of recent audit log entries fetched from the API. |

Data is fetched from the `organization.getMembers` and `audit.getLogs` tRPC endpoints in real time.

## Members Tab

### Search

A search bar filters members by name or email address (case-insensitive, client-side filtering).

### Member List

Each member is displayed in a bordered row within a card titled "Team Members". Each entry contains:

- An **avatar circle** with the member's initials (derived from their display name, or first two characters of their email address)
- **Name** and **email address**
- A **role badge** with color coding:
  - Purple: `owner`
  - Red: `admin`
  - Blue: `member` / `developer`
  - Gray: `viewer`
- **Join date** formatted as a locale date string
- **Last login** timestamp when available

:::info
Member data is fetched from the real API. The member list refreshes when you click the Refresh button in the header.
:::

### Empty States

- When a search returns no results: "No members match your search"
- When the organization has no members: "No team members found"
- During loading: "Loading members..." message

## Roles & Permissions Tab

This tab is divided into two side-by-side cards:

### Role Definitions

Lists the three default roles and their descriptions:

| Role | Description |
|---|---|
| **Owner** | Full access to everything, including billing and organization deletion. |
| **Admin** | Can manage team members and all deployment operations. |
| **Member** | Can deploy and manage applications, but cannot manage team or billing. |

Each role is displayed with its corresponding color-coded badge.

### Permission Matrix

A grid showing which permissions each role grants:

| Permission | Owner | Admin | Member |
|---|---|---|---|
| Billing | Yes | No | No |
| Team Management | Yes | Yes | No |
| Deploy Apps | Yes | Yes | Yes |
| View Resources | Yes | Yes | Yes |

:::tip
When evaluating team access, use the principle of least privilege -- assign the minimum role needed for each member's responsibilities.
:::

## Audit Log Tab

The Audit Log tab displays a chronological list of actions taken within the organization. The data is fetched from the `audit.getLogs` endpoint with a limit of **20 entries**. Each entry shows:

| Field | Description |
|---|---|
| **Action** | The action performed (e.g., "application.deploy", "member.invite"). Displayed in bold. |
| **Resource type** | A secondary badge indicating the affected resource type. |
| **Timestamp** | Full locale date and time string, separated by a dot from the action. |
| **Resource name** | The name of the affected resource, when applicable. |
| **Metadata** | Truncated JSON payload with additional context details (first 200 characters), rendered in monospace on a muted background. |

Each audit entry is preceded by an Activity icon for visual consistency.

### Empty State

When no audit logs exist, a dimmed Activity icon appears with the message "No audit logs found" and the note "Actions will appear here as they occur."

## Data Sources

| Data | Endpoint | Notes |
|---|---|---|
| Members | `organization.getMembers` | Requires valid organization ID |
| Audit logs | `audit.getLogs` | Limited to 20 most recent entries |

## Related Pages

- [Settings](./settings.md) -- organization configuration and integrations
- [Dashboard Overview](./overview.md) -- quick access to team invites via Quick Actions
- [Billing](./billing.md) -- manage subscription seats
