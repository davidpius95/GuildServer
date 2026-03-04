---
title: "OAuth (GitHub & Google)"
sidebar_position: 2
---

# OAuth (GitHub & Google)

GuildServer supports OAuth authentication through **GitHub** and **Google**. Users can sign in with their existing accounts, and GuildServer will automatically create or link user accounts. GitHub OAuth additionally provides repository access for Git-based deployments.

## How the OAuth Flow Works

The OAuth flow follows the standard Authorization Code Grant:

```
1. User clicks "Sign in with GitHub/Google" on the frontend
2. Frontend redirects to: {API_URL}/auth/github (or /auth/google)
3. API generates a CSRF state token, stores it in a cookie, and redirects to the provider
4. User authenticates with the provider and grants permissions
5. Provider redirects back to: {API_URL}/auth/github/callback (or /auth/google/callback)
6. API verifies the state token (CSRF protection)
7. API exchanges the authorization code for an access token
8. API fetches the user's profile and email from the provider
9. API finds or creates the GuildServer user account (see Account Linking below)
10. API generates a JWT token
11. API updates the user's lastLogin timestamp
12. API redirects to: {FRONTEND_URL}/auth/callback?token={jwt}
13. Frontend stores the JWT token and completes the login
```

## GitHub OAuth

### Setup Steps

1. Go to [github.com/settings/developers](https://github.com/settings/developers) and create a new **OAuth App**.
2. Set the **Homepage URL** to your frontend URL (e.g., `http://localhost:3000`).
3. Set the **Authorization callback URL** to `{API_URL}/auth/github/callback` (e.g., `http://localhost:4000/auth/github/callback`).
4. Copy the **Client ID** and **Client Secret**.
5. Set the environment variables:

```env
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

### Scopes

GuildServer requests different GitHub scopes depending on the intended use:

| Scope | When Used | Purpose |
|-------|-----------|---------|
| `user:email` | Default (basic login) | Read the user's email address for account creation |
| `user:email,repo` | When `?scope=repo` is passed | Full repository access for Git deployments, browsing repos, setting up webhooks |

The scope is determined by a query parameter on the OAuth initiation endpoint:

```typescript
// Basic login
GET /auth/github

// Login with repository access
GET /auth/github?scope=repo
```

### GitHub-Specific Details

- If the user's email is not public on GitHub, the API fetches it from the `/user/emails` endpoint and selects the primary verified email.
- The GitHub access token is stored in the `oauth_accounts` table and reused for repository browsing and webhook setup.
- The GitHub avatar URL is saved to the user's profile.

## Google OAuth

### Setup Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create a new project (or select an existing one).
3. Navigate to **APIs & Services > OAuth consent screen** and configure it:
   - Select "External" user type (or "Internal" for Google Workspace domains).
   - Fill in the app name, support email, and developer contact.
   - Add the scopes: `openid`, `email`, `profile`.
4. Navigate to **APIs & Services > Credentials** and create **OAuth 2.0 Client ID**.
   - Application type: "Web application".
   - Add authorized redirect URI: `{API_URL}/auth/google/callback` (e.g., `http://localhost:4000/auth/google/callback`).
5. Copy the **Client ID** and **Client Secret**.
6. Set the environment variables:

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### Google-Specific Details

- GuildServer uses the scopes `openid email profile` for Google OAuth.
- The `access_type=offline` parameter requests a refresh token for long-lived access.
- The `prompt=consent` parameter ensures the consent screen is shown every time, which is required to receive a refresh token.
- User info (email, name, picture) is extracted from the ID token JWT payload -- no additional API call is needed.
- The refresh token and access token are stored in the `oauth_accounts` table.

## Account Linking

When a user authenticates via OAuth, the `findOrCreateOAuthUser` function handles three scenarios:

### Scenario 1: Returning OAuth User

If the provider + provider account ID already exists in `oauth_accounts`:
- Update the stored access token (in case it was refreshed by the provider).
- Return the existing user.

### Scenario 2: Existing User, New OAuth Provider

If no OAuth account exists but a user with the same email is found:
- Link the new OAuth account to the existing user.
- Update the user's avatar if they don't have one.

### Scenario 3: Brand New User

If neither the OAuth account nor the email exists:
1. Create a new user with `password: null` (OAuth-only, no password set).
2. Set `emailVerified` to the current timestamp (the provider verified the email).
3. Create an OAuth account record.
4. Create a default organization (`"{name}'s Team"`).
5. Add the user as the organization owner with full permissions:

```typescript
permissions: {
  admin: true,
  projects: ["create", "read", "update", "delete"],
  applications: ["create", "read", "update", "delete", "deploy"],
  databases: ["create", "read", "update", "delete"],
  workflows: ["create", "read", "update", "delete", "execute"],
  kubernetes: ["create", "read", "update", "delete"],
}
```

6. Create a "Default Project" within the organization.
7. Assign the Hobby (free) plan to the organization.

## OAuth Accounts Table

OAuth accounts are stored in the `oauth_accounts` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `userId` | UUID | Foreign key to `users` table |
| `provider` | varchar(50) | `"github"` or `"google"` |
| `providerAccountId` | varchar(255) | The user's ID on the provider |
| `accessToken` | text | Provider access token |
| `refreshToken` | text | Provider refresh token (Google only) |
| `tokenExpiresAt` | timestamp | Token expiration time |
| `scope` | text | Granted OAuth scopes |
| `createdAt` | timestamp | When the account was linked |
| `updatedAt` | timestamp | Last token update |

The table has indexes on `userId` and on `(provider, providerAccountId)` for fast lookups.

## CSRF Protection

OAuth flows are protected against CSRF attacks using a state parameter:

1. Before redirecting to the provider, the API generates a random 32-byte hex string.
2. The state is stored in an `HttpOnly`, `SameSite=Lax` cookie with a 10-minute TTL.
3. The state is passed to the provider as a URL parameter.
4. On callback, the API compares the state from the URL with the cookie value.
5. If they don't match, the request is rejected with an `invalid_state` error.

```typescript
const state = crypto.randomBytes(32).toString("hex");
setStateCookie(res, state);
// ... redirect to provider with state parameter

// On callback:
if (!state || state !== cookies.oauth_state) {
  return res.redirect(`${FRONTEND_URL}/auth/login?error=invalid_state`);
}
clearStateCookie(res);
```

## Environment Variables Summary

| Variable | Provider | Required | Description |
|----------|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub | For GitHub OAuth | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub | For GitHub OAuth | OAuth App client secret |
| `GOOGLE_CLIENT_ID` | Google | For Google OAuth | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google | For Google OAuth | OAuth 2.0 client secret |
| `API_URL` | Both | No (defaults to `http://localhost:4000`) | Base URL for callback endpoints |
| `FRONTEND_URL` | Both | No (defaults to `http://localhost:3000`) | Where to redirect after auth |

:::tip
OAuth providers are optional. If the environment variables are not set, the corresponding login button will not be shown. The platform falls back to email/password authentication.
:::

## Error Handling

OAuth errors redirect the user to the login page with an error query parameter:

| Error | Cause |
|-------|-------|
| `invalid_state` | CSRF state mismatch -- possible attack or expired cookie |
| `no_code` | Provider did not return an authorization code |
| `token_exchange_failed` | Failed to exchange code for access token |
| `no_email` | Provider account has no verified email address |
| `oauth_failed` | Generic error during the OAuth callback |

## Next Steps

- Understand [authentication](./authentication.md) for JWT token details
- Review [roles and permissions](./roles-permissions.md) for organization access control
- Learn about [SSO](./sso.md) for enterprise single sign-on
