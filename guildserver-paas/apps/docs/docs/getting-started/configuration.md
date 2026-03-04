---
sidebar_position: 5
title: Configuration
description: Complete reference for all GuildServer environment variables, grouped by category with descriptions, defaults, and examples.
---

# Configuration

GuildServer is configured through environment variables defined in the `.env` file at the project root. Copy the example file to get started:

```bash
cp .env.example .env
```

This page documents every supported environment variable grouped by category.

---

## Database

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string used by Drizzle ORM for all database operations. | Yes | — | `postgresql://guildserver:password@localhost:5433/guildserver` |
| `DATABASE_DIRECT_URL` | Direct PostgreSQL connection string, bypassing any connection pooler. Used for migrations and schema operations. | No | Same as `DATABASE_URL` | `postgresql://guildserver:password@localhost:5433/guildserver` |

:::tip Connection pooling
If you use a connection pooler (like PgBouncer or Supabase's pooler), set `DATABASE_URL` to the pooler URL and `DATABASE_DIRECT_URL` to the direct PostgreSQL connection. Drizzle uses the direct URL for migrations.
:::

---

## Redis

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `REDIS_URL` | Redis connection string used by BullMQ for background job queues and by ioredis for caching and pub/sub. | Yes | — | `redis://localhost:6380` |
| `REDIS_PASSWORD` | Redis password, if authentication is enabled. Can also be embedded in `REDIS_URL`. | No | `""` (empty) | `my-redis-password` |

---

## Application

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `NODE_ENV` | Application environment. Controls logging verbosity, error detail, and security headers. | No | `development` | `production` |
| `APP_URL` | Canonical URL of the web frontend. Used for generating links in emails and notifications. | No | `http://localhost:3000` | `https://app.guildserver.com` |
| `API_URL` | Canonical URL of the API server. | No | `http://localhost:3001` | `https://api.guildserver.com` |

---

## Authentication

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `NEXTAUTH_SECRET` | Secret key used by NextAuth.js for session encryption on the frontend. | Yes | — | `openssl rand -base64 48` |
| `NEXTAUTH_URL` | Canonical URL for NextAuth.js callback handling. Must match the frontend URL. | Yes | `http://localhost:3000` | `https://app.guildserver.com` |
| `JWT_SECRET` | Secret key for signing JWT tokens issued by the API server. Must be a long, random string. | Yes | — | `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | JWT token expiration duration. Accepts values like `7d`, `24h`, `3600s`. | No | `7d` | `24h` |

:::warning Security
Never use the placeholder values from `.env.example` in production. Generate unique, cryptographically secure values for `JWT_SECRET` and `NEXTAUTH_SECRET`.
:::

---

## OAuth Providers

### GitHub OAuth

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID. Required for GitHub login and repository browsing. | No | — | `Iv1.abc123def456` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret. | No | — | `secret_abc123...` |

To set up GitHub OAuth:
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set the Authorization callback URL to `{API_URL}/auth/github/callback`

### Google OAuth

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID. Required for Google login. | No | — | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret. | No | — | `GOCSPX-abc123...` |

To set up Google OAuth:
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID
3. Add `{API_URL}/auth/google/callback` as an authorized redirect URI

---

## Email (SMTP)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `SMTP_HOST` | SMTP server hostname for sending emails (notifications, invitations, password resets). | No | — | `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTP server port. | No | `587` | `465` |
| `SMTP_USER` | SMTP authentication username. | No | — | `apikey` |
| `SMTP_PASS` | SMTP authentication password or API key. | No | — | `SG.abc123...` |
| `EMAIL_FROM` | Sender address for outgoing emails. | No | `noreply@guildserver.com` | `platform@yourcompany.com` |

:::info
Email sending is optional. If SMTP is not configured, email-based features (notifications, team invitations, password resets) will be disabled and logged as warnings.
:::

---

## Storage (S3-Compatible)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `S3_ENDPOINT` | S3-compatible storage endpoint. Used for build artifact storage and backups. | No | — | `https://s3.amazonaws.com` |
| `S3_REGION` | Storage region. | No | — | `us-east-1` |
| `S3_BUCKET` | Bucket name. | No | — | `guildserver-artifacts` |
| `S3_ACCESS_KEY` | S3 access key ID. | No | — | `AKIAIOSFODNN7EXAMPLE` |
| `S3_SECRET_KEY` | S3 secret access key. | No | — | `wJalrXUtnFEMI/K7MDENG/...` |

---

## Docker

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `DOCKER_HOST` | Docker daemon socket or TCP address. GuildServer uses Dockerode to create and manage containers. | No | `unix:///var/run/docker.sock` | `tcp://192.168.1.10:2376` |
| `DOCKER_CERT_PATH` | Path to TLS certificates for remote Docker daemon connections. | No | — | `/home/user/.docker/certs` |
| `DOCKER_TLS_VERIFY` | Enable TLS verification for Docker daemon connections. | No | — | `1` |

---

## Kubernetes

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `KUBECONFIG_PATH` | Path to kubeconfig file for Kubernetes cluster access. | No | — | `/home/user/.kube/config` |
| `KUBERNETES_NAMESPACE` | Default Kubernetes namespace for deployments. | No | `guildserver` | `production` |

---

## Stripe Billing

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret key for server-side billing operations. | No | — | `sk_live_abc123...` |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for client-side Stripe.js. | No | — | `pk_live_abc123...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret for verifying incoming webhook events. | No | — | `whsec_abc123...` |

:::info
Billing features are optional. If Stripe is not configured, the platform operates without billing enforcement, and all organizations get unlimited access.
:::

---

## Monitoring

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `PROMETHEUS_URL` | Prometheus server URL for querying application metrics. | No | — | `http://prometheus:9090` |
| `GRAFANA_URL` | Grafana dashboard URL for metric visualization links. | No | — | `http://grafana:3000` |
| `JAEGER_URL` | Jaeger tracing URL for distributed trace collection. | No | — | `http://jaeger:16686` |
| `SENTRY_DSN` | Sentry error tracking DSN for the API server. | No | — | `https://abc@sentry.io/123` |

---

## SSL / ACME

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `ACME_EMAIL` | Email address registered with Let's Encrypt for automatic SSL certificate provisioning. Required for production HTTPS. | No | `admin@guildserver.com` | `devops@yourcompany.com` |

---

## Enterprise Features

These variables enable enterprise-tier functionality. They are all disabled by default.

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `ENTERPRISE_MODE` | Enable enterprise features globally. | No | `false` | `true` |
| `SAML_ENABLED` | Enable SAML SSO authentication. | No | `false` | `true` |
| `OIDC_ENABLED` | Enable OpenID Connect SSO authentication. | No | `false` | `true` |
| `COMPLIANCE_ENABLED` | Enable compliance features (audit log retention, data policies). | No | `false` | `true` |

### SAML Configuration

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `SAML_ENTITY_ID` | Service Provider entity ID for SAML. | No | — | `https://guildserver.com/saml` |
| `SAML_SSO_URL` | Identity Provider SSO URL. | No | — | `https://idp.example.com/sso` |
| `SAML_CERT` | Identity Provider X.509 certificate (PEM format). | No | — | (certificate content) |

### OIDC Configuration

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `OIDC_ISSUER` | OIDC provider issuer URL. | No | — | `https://accounts.google.com` |
| `OIDC_CLIENT_ID` | OIDC client ID. | No | — | `client-id-from-provider` |
| `OIDC_CLIENT_SECRET` | OIDC client secret. | No | — | `client-secret-from-provider` |

### Compliance

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `SOC2_ENABLED` | Enable SOC 2 compliance mode (extended audit retention, access controls). | No | `false` | `true` |
| `HIPAA_ENABLED` | Enable HIPAA compliance mode (PHI handling policies, encryption at rest). | No | `false` | `true` |
| `PCI_ENABLED` | Enable PCI DSS compliance mode (payment data handling policies). | No | `false` | `true` |

---

## Security

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `VAULT_URL` | HashiCorp Vault server URL for secrets management. | No | — | `https://vault.example.com` |
| `VAULT_TOKEN` | Vault authentication token. | No | — | `hvs.abc123...` |
| `SECURITY_SCANNING_ENABLED` | Enable container image security scanning on deployment. | No | `false` | `true` |
| `ENV_ENCRYPTION_KEY` | AES-256-CBC encryption key for environment variable storage. Must be exactly 32 characters. | No | — | `abcdefghijklmnopqrstuvwxyz123456` |

:::warning
The `ENV_ENCRYPTION_KEY` must be exactly 32 characters long. If you change this key after encrypting environment variables, previously encrypted values will become unreadable.
:::

---

## Cost Management (Enterprise)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `COST_TRACKING_ENABLED` | Enable cloud cost tracking integration. | No | `false` | `true` |
| `AWS_COST_EXPLORER_KEY` | AWS Cost Explorer API key. | No | — | `AKIAIOSFODNN7EXAMPLE` |
| `AZURE_COST_MANAGEMENT_KEY` | Azure Cost Management API key. | No | — | (Azure key) |
| `GCP_BILLING_KEY` | GCP Billing API key. | No | — | (GCP key) |

---

## Workflow Management (Enterprise)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `WORKFLOW_ENGINE_ENABLED` | Enable the workflow automation engine. | No | `false` | `true` |
| `APPROVAL_WORKFLOWS_ENABLED` | Enable deployment approval workflows. | No | `false` | `true` |

---

## Multi-Region (Enterprise)

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `MULTI_REGION_ENABLED` | Enable multi-region deployment support. | No | `false` | `true` |
| `PRIMARY_REGION` | Primary deployment region. | No | `us-east-1` | `eu-west-1` |
| `SECONDARY_REGIONS` | Comma-separated list of secondary regions. | No | `us-west-2,eu-west-1` | `ap-southeast-1,us-west-2` |

---

## Development & Debugging

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `DEBUG` | Enable verbose debug logging. | No | `false` | `true` |
| `LOG_LEVEL` | Logging verbosity level. Accepted values: `error`, `warn`, `info`, `debug`. | No | `info` | `debug` |
| `FRONTEND_URL` | Frontend URL used by the API for CORS origin and OAuth callback URLs. | No | `http://localhost:3000` | `https://app.guildserver.com` |
| `BASE_DOMAIN` | Base domain for auto-generated application subdomains. | No | `guildserver.localhost` | `apps.guildserver.com` |

---

## Minimal Production Configuration

Here is a minimal `.env` for a production deployment:

```env
# Required
NODE_ENV=production
DATABASE_URL=postgresql://user:password@db-host:5432/guildserver
REDIS_URL=redis://:password@redis-host:6379
JWT_SECRET=<64-char-random-string>
NEXTAUTH_SECRET=<64-char-random-string>
NEXTAUTH_URL=https://app.guildserver.com
FRONTEND_URL=https://app.guildserver.com
BASE_DOMAIN=apps.guildserver.com

# SSL
ACME_EMAIL=devops@yourcompany.com

# Recommended
LOG_LEVEL=info
ENV_ENCRYPTION_KEY=<exactly-32-characters>
```

## Next Steps

- [Core Concepts](/concepts/organizations) — Understand the data model
- [Deployment Guide](/deployment/git-deployments) — Deploy your first application
- [Self-Hosting](/self-hosting/docker-compose) — Production deployment guide
