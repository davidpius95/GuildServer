# Notification channels

An organization can send events to any number of **channels**. Each channel has
a type, a target, and the list of events it receives. Owners and admins manage
channels (tRPC `notificationChannel.*`); every member can see which channels
exist and, in outline, where they point. Credentials are write-only: once saved,
a webhook URL, bot token or signing secret is never returned by the API.

Personal notifications (the in-app inbox and email to the acting user) are
unchanged and still follow each user's preferences.

## Channel types

| Type | Target | Notes |
|---|---|---|
| `slack` | Incoming webhook URL on `https://hooks.slack.com/` | Other hosts are refused. Event text is escaped, so it cannot `@channel`. |
| `discord` | `https://discord.com/api/webhooks/<id>/<token>` | Other hosts are refused. Mentions are disabled on every message. |
| `telegram` | Bot token and chat id (`-100…` or `@channel`) | Sent as plain text to `api.telegram.org`. |
| `webhook` | Any `http(s)` URL, optional signing secret (≥ 16 chars) | Loopback, link-local (including cloud metadata) and private addresses are refused; see below. |
| `email` | 1–20 recipient addresses | Requires the server's SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`). |

## Events

`deployment_success`, `deployment_failed`, `preview_created`, `preview_expired`,
`certificate_expiring`, `certificate_failed`, `webhook_failed`, `member_added`,
`member_removed`, `spend_threshold_50`, `spend_threshold_75`,
`spend_threshold_100`, `spend_limit_reached`, `trial_ending`, `payment_failed`,
`backup_failed`, `backup_upload_failed`.

Each occurrence of an event (one deployment, one backup) reaches each channel
**at most once**, even if it is reported twice. Every attempt is recorded and
can be listed with `notificationChannel.deliveries`.

## Delivery behaviour

- Requests time out after 10 seconds and never follow redirects.
- HTTP 408, 429 and 5xx, timeouts and connection failures are retried twice
  (after 2 s and 10 s). Other 4xx responses are not retried.
- Failure reasons are stored without credentials.
- Retries happen in the API process; a restart during the back-off drops the
  remaining attempts for that occurrence.

## Generic webhooks

The request is a `POST` with a JSON body:

```json
{
  "event": "deployment_failed",
  "title": "shop deployment failed",
  "message": "Deployment failed: build exited 1",
  "severity": "critical",
  "url": "https://guildserver.example.com/dashboard/applications/…",
  "occurredAt": "2026-09-11T05:00:00.000Z",
  "data": { "appName": "shop", "error": "build exited 1" }
}
```

Headers:

| Header | Value |
|---|---|
| `X-GuildServer-Event` | The event name |
| `X-GuildServer-Timestamp` | Unix seconds when the request was signed |
| `X-GuildServer-Signature` | `sha256=` + hex HMAC-SHA256 of `<timestamp>.<raw body>`, only when a signing secret is set |

### Verifying a signature

Verify against the **raw** request body, before parsing it, and reject old
timestamps to stop replays:

```ts
import { createHmac, timingSafeEqual } from "crypto";

export function verifyGuildServerWebhook(rawBody: string, headers: Record<string, string>, secret: string): boolean {
  const timestamp = headers["x-guildserver-timestamp"];
  const signature = headers["x-guildserver-signature"] ?? "";
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### Private and loopback targets

Webhook targets are resolved before every delivery, and the delivery is
refused if **any** resolved address is loopback, link-local or unspecified.
Private ranges (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) are refused
unless the operator sets:

```bash
GS_NOTIFY_ALLOW_PRIVATE_ENDPOINTS=1
```

Loopback additionally needs `GS_NOTIFY_ALLOW_LOOPBACK_ENDPOINTS=1` and exists
for test rigs only. The same rules, with `GS_S3_ALLOW_*` variables, apply to
off-site backup storage endpoints.

## Legacy Slack integration

The organization-level Slack webhook in **Settings → Notifications** and each
user's per-event "Slack" toggle still work. The saved webhook URL is no longer
returned to the browser, only whether one is set, and only owners and admins
can send a test message.
