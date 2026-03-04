---
title: "Single Sign-On (SSO)"
sidebar_position: 4
---

# Single Sign-On (SSO)

GuildServer supports enterprise Single Sign-On (SSO) for organizations that require centralized identity management. SSO allows team members to authenticate using their organization's identity provider (IdP) instead of managing separate GuildServer credentials.

:::info
SSO is an **Enterprise plan** feature. It is not available on Hobby or Pro plans. See [Plans & Pricing](../billing/plans.md) for plan comparison.
:::

## Supported Providers

GuildServer supports six SSO provider types, defined by the `sso_provider_type` enum:

| Provider Type | Protocol | Common Providers |
|--------------|----------|------------------|
| `saml` | SAML 2.0 | Okta, OneLogin, Azure AD, PingFederate |
| `oidc` | OpenID Connect | Auth0, Keycloak, Google Workspace, Ping Identity |
| `ldap` | LDAP / LDAPS | Active Directory, OpenLDAP, FreeIPA |
| `azure-ad` | Azure AD (native) | Microsoft Entra ID |
| `google` | Google Workspace | Google Workspace (domain-restricted) |
| `github` | GitHub Enterprise | GitHub Enterprise Server |

## Configuration

SSO providers are configured per-organization and stored in the `sso_providers` table. Each provider record contains:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | varchar(255) | Human-readable provider name (e.g., "Corporate Okta") |
| `providerType` | sso_provider_type enum | One of: `saml`, `oidc`, `ldap`, `azure-ad`, `google`, `github` |
| `configuration` | JSONB | Provider-specific settings (see below) |
| `organizationId` | UUID | The organization this provider belongs to |
| `enabled` | boolean | Whether the provider is active (default: true) |
| `createdAt` | timestamp | When the provider was created |
| `updatedAt` | timestamp | Last configuration update |

### SAML Configuration

For SAML 2.0 providers, the `configuration` JSON should contain:

```json
{
  "entityId": "https://guildserver.example.com/saml/metadata",
  "ssoUrl": "https://idp.example.com/saml2/sso",
  "certificate": "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
  "signatureAlgorithm": "sha256",
  "nameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
}
```

**Environment variables** for global SAML defaults:

| Variable | Description |
|----------|-------------|
| `SAML_ENTITY_ID` | Service Provider entity ID |
| `SAML_SSO_URL` | Identity Provider SSO URL |
| `SAML_CERT` | IdP X.509 certificate (PEM format) |
| `SAML_CALLBACK_URL` | ACS (Assertion Consumer Service) URL |

### OIDC Configuration

For OpenID Connect providers:

```json
{
  "issuer": "https://accounts.google.com",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
  "tokenUrl": "https://oauth2.googleapis.com/token",
  "userInfoUrl": "https://openidconnect.googleapis.com/v1/userinfo",
  "scopes": ["openid", "email", "profile"]
}
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `OIDC_ISSUER` | Provider issuer URL |
| `OIDC_CLIENT_ID` | Client ID from provider |
| `OIDC_CLIENT_SECRET` | Client secret from provider |
| `OIDC_CALLBACK_URL` | Redirect URI after authentication |

### LDAP Configuration

For LDAP/LDAPS (Active Directory, OpenLDAP):

```json
{
  "url": "ldaps://ldap.example.com:636",
  "bindDN": "cn=admin,dc=example,dc=com",
  "bindPassword": "admin-password",
  "searchBase": "ou=users,dc=example,dc=com",
  "searchFilter": "(uid={{username}})",
  "usernameAttribute": "uid",
  "emailAttribute": "mail",
  "nameAttribute": "cn",
  "tlsOptions": {
    "rejectUnauthorized": true
  }
}
```

### Azure AD Configuration

For Microsoft Entra ID (Azure AD):

```json
{
  "tenantId": "your-tenant-id",
  "clientId": "your-app-client-id",
  "clientSecret": "your-app-client-secret",
  "domain": "yourdomain.onmicrosoft.com"
}
```

### Google Workspace Configuration

For Google Workspace (domain-restricted):

```json
{
  "domain": "example.com",
  "clientId": "your-google-client-id",
  "clientSecret": "your-google-client-secret",
  "hostedDomain": "example.com"
}
```

### GitHub Enterprise Configuration

For GitHub Enterprise Server:

```json
{
  "baseUrl": "https://github.yourdomain.com",
  "clientId": "your-ghe-client-id",
  "clientSecret": "your-ghe-client-secret",
  "allowedOrganizations": ["your-org"]
}
```

## SSO Login Flow

1. User navigates to the organization's login page.
2. The SSO provider option is displayed based on the organization's configured `sso_providers`.
3. User clicks the SSO login button.
4. GuildServer redirects to the identity provider's authentication page.
5. User authenticates with the IdP (using corporate credentials, MFA, etc.).
6. IdP redirects back to GuildServer with an authentication assertion.
7. GuildServer verifies the assertion and creates or links the user account.
8. A JWT token is issued and the user is logged in.

## Database Schema

```sql
CREATE TABLE sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  provider_type sso_provider_type NOT NULL,
  configuration JSONB NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Managing SSO Providers

### Adding a Provider

Organization owners can add SSO providers through the dashboard or API. The configuration object must match the expected schema for the selected provider type.

### Enabling / Disabling

Providers can be temporarily disabled without deleting them by setting `enabled` to `false`. Disabled providers are not shown on the login page.

### Multiple Providers

An organization can configure multiple SSO providers. For example, an organization might have both an OIDC provider for most employees and an LDAP provider for legacy systems.

## Security Considerations

:::warning
- Store SSO configuration secrets (client secrets, bind passwords, certificates) securely. They are stored in the `configuration` JSONB column.
- Use HTTPS for all callback URLs and IdP endpoints.
- For LDAP, always use LDAPS (TLS-encrypted) connections in production.
- Regularly rotate client secrets and review SSO provider configurations.
:::

## Next Steps

- Review [authentication](./authentication.md) for how JWT tokens are issued after SSO
- Understand [roles and permissions](./roles-permissions.md) for post-login access control
- Learn about [two-factor authentication](./two-factor.md) for additional security
- Compare [plans](../billing/plans.md) to access SSO features
