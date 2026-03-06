---
title: "API Keys"
sidebar_position: 6
---

# API Keys

API keys provide **programmatic access** to the GuildServer API without requiring interactive login or OAuth flows. They are designed for CI/CD pipelines, automation scripts, CLI tools, and third-party integrations.

## Overview

API keys function as long-lived authentication tokens that bypass the standard login flow. They are associated with the user who created them and inherit that user's permissions and organization memberships.

## Creating an API Key

### Via the Dashboard

1. Navigate to **Settings > Security > API Keys**.
2. Click **Generate New Key**.
3. Provide a descriptive name for the key (e.g., "GitHub Actions CI", "CLI Access", "Monitoring Script").
4. Optionally set an expiration date.
5. Click **Create**.
6. The key is displayed **once** -- copy and store it securely.

:::danger
API keys are shown only at creation time. If you lose the key, you must revoke it and generate a new one. There is no way to retrieve an existing key after the creation dialog is closed.
:::

### Key Format

API keys follow the JWT format, signed with the same `JWT_SECRET` as regular authentication tokens. They contain:

```json
{
  "userId": "uuid-of-the-creator",
  "email": "user@example.com",
  "type": "api_key"
}
```

## Using an API Key

### HTTP Authorization Header

Include the API key in the `Authorization` header of your HTTP requests, using the `Bearer` scheme:

```bash
curl -H "Authorization: Bearer gs_your-api-key-here" \
  http://localhost:4000/trpc/auth.me
```

### tRPC Client

```typescript
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

const client = createTRPCProxyClient({
  links: [
    httpBatchLink({
      url: "http://localhost:4000/trpc",
      headers() {
        return {
          authorization: `Bearer ${process.env.GUILDSERVER_API_KEY}`,
        };
      },
    }),
  ],
});

// Use the client as normal
const apps = await client.application.list.query({
  organizationId: "your-org-id",
});
```

### CI/CD Example (GitHub Actions)

```yaml
name: Deploy to GuildServer
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Trigger Deployment
        env:
          GUILDSERVER_API_KEY: ${{ secrets.GUILDSERVER_API_KEY }}
          GUILDSERVER_API_URL: ${{ vars.GUILDSERVER_API_URL }}
        run: |
          curl -X POST "${GUILDSERVER_API_URL}/trpc/deployment.create" \
            -H "Authorization: Bearer ${GUILDSERVER_API_KEY}" \
            -H "Content-Type: application/json" \
            -d '{"applicationId": "your-app-id"}'
```

## Key Management

### Revoking a Key

1. Navigate to **Settings > Security > API Keys**.
2. Find the key you want to revoke in the list.
3. Click **Revoke**.
4. Confirm the revocation.

Revoked keys are immediately invalidated. Any request using a revoked key will receive a `401 Unauthorized` response.

### Key Properties

| Property | Description |
|----------|-------------|
| **Name** | Descriptive label (e.g., "CI Pipeline") |
| **Created** | Timestamp of key creation |
| **Last Used** | Timestamp of most recent API call |
| **Expiration** | Optional expiration date |
| **Status** | Active or Revoked |

### Permission Inheritance

API keys inherit the full permissions of the user who created them:

- **Organization memberships** -- The key can access all organizations the user belongs to.
- **Organization role** -- The key has the same role (owner, admin, member) as the user in each organization.
- **Granular permissions** -- Any resource-level access restrictions on the user's membership apply to the key.
- **System role** -- If the user is a system admin, the key has admin access.

:::warning
If a user's permissions change (e.g., they are removed from an organization), API keys created by that user are automatically affected. If the user account is deleted, all their API keys become invalid.
:::

## Best Practices

### 1. Use Descriptive Names

Name your keys after their purpose so you can identify them later:

- "GitHub Actions -- Production Deploy"
- "Monitoring Dashboard -- Read Only"
- "Terraform Infrastructure"

### 2. Rotate Keys Regularly

Set a rotation schedule (e.g., every 90 days) to limit exposure from potentially compromised keys:

1. Create a new key.
2. Update all systems using the old key.
3. Verify everything works with the new key.
4. Revoke the old key.

### 3. Use Environment Variables

Never hardcode API keys in source code. Use environment variables or secrets management:

```bash
# .env file (never committed to git)
GUILDSERVER_API_KEY=gs_your-key-here
```

```bash
# .gitignore
.env
.env.local
.env.*.local
```

### 4. Minimize Key Scope

Create separate keys for different purposes. If one key is compromised, only that specific integration is affected. Avoid using a single "master" key for everything.

### 5. Set Expiration Dates

For temporary access (e.g., a contractor or one-time migration), set an expiration date on the key so it automatically becomes invalid.

### 6. Monitor Key Usage

Regularly review the "Last Used" timestamp for each key. Keys that have not been used in a long time may be candidates for revocation.

### 7. Never Share Keys

Each team member or system should have its own API key. Sharing keys makes it impossible to trace actions in audit logs and increases the blast radius of a compromise.

## Security Considerations

- API keys bypass interactive authentication (including 2FA when implemented). Treat them with the same sensitivity as passwords.
- All API key usage is logged in the audit trail with the associated user ID.
- Store keys in a secrets manager (AWS Secrets Manager, HashiCorp Vault, GitHub Secrets) rather than plain text files.
- Implement IP allowlisting at the network level for keys used from known infrastructure.

## Troubleshooting

### Key returns 401 Unauthorized

- Verify the key has not been revoked.
- Check if the key has expired.
- Ensure the `Authorization` header format is correct: `Bearer <key>` (with a space after "Bearer").
- Confirm the key was copied correctly (no leading/trailing whitespace).

### Key returns 403 Forbidden

- The user who created the key may not have access to the requested organization or resource.
- Check the user's organization membership and role.
- Verify the user's granular permissions allow the requested operation.

## Next Steps

- Review [authentication](./authentication.md) for JWT token details
- Understand [roles and permissions](./roles-permissions.md) to know what your key can access
- Set up [OAuth](./oauth.md) for interactive authentication flows
