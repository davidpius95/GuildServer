---
title: "Two-Factor Authentication"
sidebar_position: 5
---

# Two-Factor Authentication

GuildServer includes database schema support for **TOTP-based two-factor authentication (2FA)**, providing an additional layer of security beyond passwords. When fully implemented, users will need to provide a time-based one-time password from an authenticator app alongside their credentials during login.

## Current Status

:::info
The 2FA schema fields (`twoFactorSecret` and `twoFactorEnabled`) are present on the `users` table and ready for use. The full TOTP enrollment and verification flow is planned for a future release.
:::

The `auth.me` endpoint already returns the `twoFactorEnabled` field, allowing the frontend to display the current 2FA status:

```typescript
const me = await trpc.auth.me.query();
// me.twoFactorEnabled -> boolean (default: false)
```

## Database Schema

The `users` table includes two fields dedicated to 2FA:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `twoFactorSecret` | `text` | `null` | The TOTP secret key (stored encrypted). Used to generate and verify time-based codes. |
| `twoFactorEnabled` | `boolean` | `false` | Whether 2FA is currently active for this user. |

```sql
-- From the users table definition
two_factor_secret TEXT,
two_factor_enabled BOOLEAN DEFAULT false
```

## Planned Implementation

The planned 2FA implementation will follow the standard TOTP flow:

### Enrollment Flow

1. User navigates to **Settings > Security** and clicks "Enable 2FA".
2. The API generates a TOTP secret using a library such as `otplib` or `speakeasy`.
3. The secret is temporarily stored and a QR code is displayed containing:
   - The secret key
   - The issuer name (`GuildServer`)
   - The user's email
4. User scans the QR code with an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden, etc.).
5. User enters the current 6-digit TOTP code to verify the setup.
6. On successful verification:
   - `twoFactorSecret` is saved to the database (encrypted).
   - `twoFactorEnabled` is set to `true`.
   - Backup/recovery codes are generated and shown once.

### Login Flow with 2FA

1. User enters email and password.
2. API verifies credentials (bcrypt compare).
3. If `twoFactorEnabled` is `true`, the API returns a `2FA_REQUIRED` status instead of a JWT token.
4. The frontend displays a TOTP code input form.
5. User enters the 6-digit code from their authenticator app.
6. API verifies the code against the stored `twoFactorSecret` using TOTP validation.
7. On success, a JWT token is issued normally.

### Recovery

If a user loses access to their authenticator app:

1. **Backup codes** -- During enrollment, users receive one-time recovery codes that can be used in place of a TOTP code.
2. **Admin reset** -- An organization admin or system admin can disable 2FA on the user's account, allowing them to log in with just their password and re-enroll.

## TOTP Technical Details

| Parameter | Value |
|-----------|-------|
| Algorithm | SHA-1 (standard TOTP) |
| Digits | 6 |
| Period | 30 seconds |
| Issuer | `GuildServer` |
| Time window | +/- 1 step (allows 30s clock skew) |

### QR Code Format

The QR code encodes an `otpauth://` URI:

```
otpauth://totp/GuildServer:{email}?secret={base32secret}&issuer=GuildServer&algorithm=SHA1&digits=6&period=30
```

## Security Best Practices

:::tip
When 2FA is available, enable it for all accounts that have access to production infrastructure. 2FA significantly reduces the risk of account compromise from phished or leaked passwords.
:::

:::warning
- The `twoFactorSecret` must be stored encrypted at rest. It is the shared secret between the server and the user's authenticator app.
- Backup codes should be stored as bcrypt hashes, similar to passwords.
- Rate-limit 2FA verification attempts to prevent brute-force attacks (there are only 1,000,000 possible 6-digit codes per 30-second window).
:::

## Authenticator App Compatibility

2FA will work with any TOTP-compatible authenticator app:

| App | Platform |
|-----|----------|
| Google Authenticator | iOS, Android |
| Authy | iOS, Android, Desktop |
| 1Password | iOS, Android, macOS, Windows, Browser |
| Bitwarden | iOS, Android, Desktop, Browser |
| Microsoft Authenticator | iOS, Android |
| KeePassXC | macOS, Windows, Linux |

## Next Steps

- Review [authentication](./authentication.md) for the full auth flow
- Set up [OAuth](./oauth.md) for passwordless social login
- Learn about [SSO](./sso.md) for enterprise identity management
- Generate [API keys](./api-keys.md) for programmatic access (bypasses 2FA)
