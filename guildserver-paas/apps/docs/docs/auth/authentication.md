---
title: "Authentication"
sidebar_position: 1
---

# Authentication

GuildServer uses **JWT (JSON Web Tokens)** for API authentication. The platform supports three authentication methods: email/password registration, GitHub OAuth, and Google OAuth. All API requests (except public endpoints) require a valid JWT token.

## Authentication Flow

```
1. User submits credentials (email/password, or OAuth redirect)
2. API verifies credentials (bcrypt compare or OAuth token exchange)
3. API generates a signed JWT token with { userId, email }
4. Token is returned to the client
5. Client includes token in Authorization header on all subsequent requests
6. API middleware verifies the token, fetches the user, and attaches to context
```

## JWT Token Details

### Token Generation

Tokens are generated using the `jsonwebtoken` library and signed with the `JWT_SECRET` environment variable:

```typescript
const token = jwt.sign(
  { userId: newUser.id, email: newUser.email },
  process.env.JWT_SECRET!,
  { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
);
```

### Token Payload

| Field | Type | Description |
|-------|------|-------------|
| `userId` | UUID string | The user's database ID |
| `email` | string | The user's email address |
| `iat` | number | Issued-at timestamp (added automatically by jsonwebtoken) |
| `exp` | number | Expiration timestamp |

### Token Expiry

The default token lifetime is **7 days**, controlled by the `JWT_EXPIRES_IN` environment variable. Accepted formats include `"7d"`, `"24h"`, `"3600"` (seconds).

:::info
Tokens are **not refreshed** automatically. When a token expires, the user must log in again to obtain a new one. There is no refresh token mechanism.
:::

## Obtaining a Token

### Registration

New users can register with email, name, and password via the `auth.register` tRPC mutation:

```typescript
const result = await trpc.auth.register.mutate({
  email: "user@example.com",
  name: "Jane Doe",
  password: "securepassword123", // minimum 8 characters
});

// result.token  -> JWT token string
// result.user   -> { id, email, name, role, createdAt }
```

On registration, GuildServer automatically:
1. Hashes the password with bcrypt (12 rounds).
2. Creates the user record.
3. Creates a default organization named `"{name}'s Team"`.
4. Adds the user as the organization owner with full permissions.
5. Creates a "Default Project" within the organization.
6. Assigns the Hobby (free) plan to the organization.
7. Returns a signed JWT token.

### Login

Existing users authenticate via the `auth.login` mutation:

```typescript
const result = await trpc.auth.login.mutate({
  email: "user@example.com",
  password: "securepassword123",
});

// result.token  -> JWT token string
// result.user   -> { id, email, name, role, createdAt, lastLogin }
```

The login mutation:
1. Finds the user by email.
2. Compares the password against the bcrypt hash.
3. Updates `lastLogin` timestamp.
4. Returns a signed JWT token.

### OAuth Login

Users can also obtain tokens via [GitHub or Google OAuth](./oauth.md). The OAuth flow ends with a redirect to the frontend containing a JWT token in the URL query parameter.

## Using the Token

### Authorization Header

Include the JWT token in the `Authorization` header of every API request:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### tRPC Client Example

```typescript
const trpc = createTRPCProxyClient({
  links: [
    httpBatchLink({
      url: "http://localhost:4000/trpc",
      headers() {
        return {
          authorization: `Bearer ${token}`,
        };
      },
    }),
  ],
});
```

## Context Creation

On every request, the API middleware extracts and verifies the JWT token, then fetches the user from the database. This happens in `apps/api/src/trpc/context.ts`:

```typescript
export async function createContext({ req, res }: CreateExpressContextOptions) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  let user: User | null = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, decoded.userId),
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });

      if (dbUser) {
        user = dbUser;
      }
    } catch (error) {
      // Invalid token, user remains null
    }
  }

  return {
    req,
    res,
    db,
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
  };
}
```

The context provides these flags to all tRPC procedures:

| Field | Type | Description |
|-------|------|-------------|
| `user` | `User \| null` | The authenticated user object, or null |
| `isAuthenticated` | boolean | Whether a valid token was provided |
| `isAdmin` | boolean | Whether the user has the system `admin` role |

## Procedure Types

GuildServer defines three tRPC procedure types with increasing levels of access control:

### `publicProcedure`

No authentication required. Used for:
- `auth.register` -- User registration
- `auth.login` -- User login
- `billing.getPlans` -- View available plans

### `protectedProcedure`

Requires a valid JWT token. Returns `UNAUTHORIZED` if the token is missing or invalid:

```typescript
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, user: ctx.user },
  });
});
```

Used for most API operations: managing applications, deployments, databases, etc.

### `adminProcedure`

Requires a valid token AND the system `admin` role. Returns `FORBIDDEN` if the user is not an admin:

```typescript
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.isAuthenticated || !ctx.user || !ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({
    ctx: { ...ctx, user: ctx.user },
  });
});
```

Used for platform-wide administrative operations.

## Password Security

- Passwords are hashed with **bcryptjs** using a cost factor of **12 rounds**.
- Minimum password length is **8 characters** (enforced by Zod validation).
- Passwords are never stored in plain text or logged.
- Password change requires providing the current password for verification.

```typescript
// Hashing on registration
const hashedPassword = await bcrypt.hash(password, 12);

// Verification on login
const isValidPassword = await bcrypt.compare(password, user.password);
```

## Additional Auth Endpoints

### Get Current User

```typescript
const me = await trpc.auth.me.query();
// Returns: { id, email, name, role, avatar, twoFactorEnabled,
//            lastLogin, preferences, createdAt, updatedAt }
```

### Update Profile

```typescript
await trpc.auth.updateProfile.mutate({
  name: "New Name",
  avatar: "https://example.com/avatar.jpg",
  preferences: { theme: "dark" },
});
```

### Change Password

```typescript
await trpc.auth.changePassword.mutate({
  currentPassword: "oldpassword123",
  newPassword: "newstrongerpassword456",
});
```

### Logout

```typescript
await trpc.auth.logout.mutate();
```

:::tip
Since JWTs are stateless, the logout endpoint does not invalidate the token server-side. The client should discard the token from local storage. The token will naturally expire after the configured TTL.
:::

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | -- | Secret key for signing JWT tokens |
| `JWT_EXPIRES_IN` | No | `7d` | Token expiration duration |

:::danger
Use a strong, random `JWT_SECRET` in production. Generate one with: `openssl rand -hex 32`. A compromised secret allows attackers to forge valid tokens for any user.
:::

## Next Steps

- Set up [OAuth providers](./oauth.md) for GitHub and Google login
- Understand [roles and permissions](./roles-permissions.md) for organization access control
- Learn about [two-factor authentication](./two-factor.md) for enhanced security
- Generate [API keys](./api-keys.md) for programmatic access
