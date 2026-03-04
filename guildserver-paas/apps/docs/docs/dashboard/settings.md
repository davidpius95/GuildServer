---
title: "Settings"
sidebar_position: 7
---

# Settings

The Settings page (`/dashboard/settings`) is the central configuration hub for your organization, notification preferences, security posture, and third-party integrations. It is organized into five tabs.

## Page Layout

The page consists of:

1. **Header** -- title and description
2. **Tab system** with five tabs: Organization, Profile, Notifications, Security, and Integrations

## Organization Tab

### Organization Details

A card displays your organization information with an Edit toggle:

| Field | Editable | Description |
|---|---|---|
| **Organization Name** | Yes | The display name for your organization. |
| **Organization Slug** | No | Auto-generated URL-safe identifier. Read-only. |
| **Description** | Yes | A brief description of the organization. |
| **Created** | No | The date the organization was created. |

Clicking "Edit" enables the name and description fields. Click "Save Changes" to persist updates via the `organization.update` tRPC mutation.

### Resource Usage

A summary card shows current usage across the organization:

| Metric | Description |
|---|---|
| **Team Members** | Count of members in the organization. |
| **Projects** | Number of projects. |
| **Audit Events (30d)** | Total audit events in the last 30 days (fetched from `audit.getStatistics`). |

## Profile Tab

Displays read-only profile information derived from the authentication provider:

- **Name** -- your display name
- **Email** -- your email address
- **Role** -- your role within the current organization (shown as a purple badge)

:::info
Profile information is managed by your authentication provider. To update your name or email, modify them in your identity provider (email/password, GitHub, or Google account).
:::

## Notifications Tab

### Notification Preferences

A comprehensive notification preferences card lets you control how you are notified for each event type. Changes are saved automatically when you toggle a switch.

Three notification channels are supported:

- **In-App** (bell icon) -- notifications appear in the [Notifications](./notifications.md) center
- **Email** (mail icon) -- email delivery (requires SMTP configuration)
- **Slack** (message icon) -- messages sent to a configured Slack channel

Events are grouped by category:

**Deployments:**
- Deployment Succeeded
- Deployment Failed

**Previews:**
- Preview Created
- Preview Expired

**Security:**
- Certificate Expiring
- Certificate Failed

**Integrations:**
- Webhook Failed

**Team:**
- Member Added
- Member Removed

Each event has three toggle switches (In-App, Email, Slack) that can be independently enabled or disabled.

### Slack Integration

A dedicated card manages the Slack incoming webhook configuration:

| Field | Description |
|---|---|
| **Webhook URL** | The Slack incoming webhook URL (e.g., `https://hooks.slack.com/services/T.../B.../...`). |
| **Channel Name** | Optional channel name override (e.g., `#deployments`). |

Buttons:
- **Save Slack Config** -- persists the webhook URL and channel configuration
- **Send Test** -- sends a test notification to verify the integration (only visible after saving)

A status badge indicates whether Slack is "Connected" or "Disabled".

### Email Notifications

A status card shows the current SMTP configuration state. If SMTP is not configured, it displays guidance on which environment variables to set: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`.

:::tip
Configure SMTP environment variables on your GuildServer API instance to enable email notification delivery. See your deployment documentation for details.
:::

## Security Tab

### Security Settings

A card displays the current security posture with status badges:

| Feature | Description | Status |
|---|---|---|
| **JWT Authentication** | Token-based authentication for all API calls. | Active |
| **Role-Based Access Control** | Owner, Admin, and Member roles with granular permissions. | Active |
| **Audit Logging** | All user actions and API calls are logged. | Active |
| **Environment Variable Encryption** | AES-256-CBC encryption for secret values. | Active |

### Danger Zone

A red-bordered card contains destructive actions:

- **Delete Organization** -- permanently deletes the organization and all associated data. This button is currently disabled as a safety measure.

:::warning
Deleting an organization is irreversible. All projects, applications, databases, team memberships, and deployment history will be permanently removed.
:::

## Integrations Tab

### Connected Accounts

Manages OAuth connections for GitHub and Google:

#### GitHub

The GitHub integration card shows:

- **Connection status** -- "Connected" badge when linked
- **Access level** -- "Full access" (with repo scope) or "Login only" (without repo scope)
- **Scopes** -- the OAuth scopes currently granted

Actions:
- **Connect GitHub** -- initiates the OAuth flow with `repo` scope
- **Grant Repo Access** -- upgrades a login-only connection to include repo scope
- **Disconnect** -- removes the GitHub OAuth connection

:::tip
Connecting GitHub with the `repo` scope enables the repository browser in the [Create Application](./applications-page.md) modal, letting you browse and select repos similar to Vercel.
:::

#### Google

The Google integration card shows:

- **Connection status** -- "Connected" badge when linked
- **Description** -- "Connected for sign-in" when active

Actions:
- **Connect Google** -- initiates the Google OAuth flow
- **Disconnect** -- removes the Google OAuth connection

### About Connected Accounts

An informational card explains that OAuth connections enable quick sign-in and (for GitHub) repository browsing. It reassures users that connections can be disconnected at any time.

## Related Pages

- [Team Management](./team-management.md) -- manage members and roles
- [Notifications](./notifications.md) -- view your notification history
- [Billing](./billing.md) -- manage subscription and payment
- [Applications](./applications-page.md) -- GitHub integration enables repo browsing
