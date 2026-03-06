---
title: "Traefik Reverse Proxy"
sidebar_position: 2
---

# Traefik Reverse Proxy

GuildServer uses [Traefik v3.6](https://doc.traefik.io/traefik/) as its reverse proxy and load balancer. Traefik automatically discovers deployed application containers, routes traffic by domain name, and handles SSL certificate provisioning through Let's Encrypt.

## What Traefik Does in GuildServer

Traefik serves three critical roles in the platform:

1. **Auto-discovery** -- Monitors the Docker socket for container events and reads routing labels from newly deployed containers.
2. **Domain-based routing** -- Routes incoming HTTP/HTTPS requests to the correct container based on the `Host` header.
3. **SSL termination** -- Automatically provisions and renews TLS certificates via Let's Encrypt for production domains.

## Docker Provider Configuration

Traefik is configured with the Docker provider, which reads labels from running containers to create routing rules dynamically.

```yaml
command:
  - "--providers.docker=true"
  - "--providers.docker.exposedbydefault=false"
  - "--providers.docker.network=guildserver"
```

| Flag | Purpose |
|------|---------|
| `providers.docker=true` | Enable Docker as a configuration source |
| `providers.docker.exposedbydefault=false` | Require explicit opt-in via `traefik.enable=true` |
| `providers.docker.network=guildserver` | Only route through the `guildserver` bridge network |

Because `exposedbydefault` is `false`, containers that do not carry the `traefik.enable=true` label are invisible to Traefik. This prevents infrastructure services (Postgres, Redis) from being accidentally exposed.

## How Applications Get Routed

When GuildServer deploys an application, the deployment service (`apps/api/src/services/docker.ts`) attaches Traefik labels to the container. The router name is derived from the application name, sanitized to remove non-alphanumeric characters.

### Required Labels

Every routed container receives at minimum these labels:

```
traefik.enable=true
traefik.http.routers.{routerName}.rule=Host(`{domain}`)
traefik.http.services.{routerName}.loadbalancer.server.port={port}
```

For example, an app named `my-blog` with domain `my-blog.localhost` on port 3000:

```
traefik.enable=true
traefik.http.routers.my-blog.rule=Host(`my-blog.localhost`)
traefik.http.routers.my-blog.entrypoints=web
traefik.http.services.my-blog.loadbalancer.server.port=3000
```

### GuildServer Management Labels

In addition to Traefik labels, every deployed container receives tracking labels that allow the platform to manage the container lifecycle:

```
gs.managed=true
gs.app.id={applicationId}
gs.app.name={appName}
gs.deployment.id={deploymentId}
gs.project.id={projectId}
gs.type=application
```

### Localhost vs. Production Domains

The deployment service distinguishes between localhost/development domains and production domains. This logic is implemented in the `isLocalhostDomain()` function:

```typescript
export function isLocalhostDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    d === "localhost" ||
    d.endsWith(".localhost") ||
    d.endsWith(".local") ||
    d.endsWith(".test") ||
    d.endsWith(".example") ||
    d === "127.0.0.1" ||
    d.startsWith("192.168.") ||
    d.startsWith("10.") ||
    d.startsWith("172.16.")
  );
}
```

**Localhost domains** get a plain HTTP router (no TLS):

```
traefik.http.routers.{name}.rule=Host(`my-app.localhost`)
traefik.http.routers.{name}.entrypoints=web
```

**Production domains** get three routers:

1. A **secure HTTPS router** with TLS via Let's Encrypt
2. An **HTTP-to-HTTPS redirect router** that sends all HTTP traffic to HTTPS
3. A **redirect middleware** that performs the `301 Moved Permanently` redirect

```
# 1. Secure HTTPS router
traefik.http.routers.{name}-secure.rule=Host(`app.example.com`)
traefik.http.routers.{name}-secure.entrypoints=websecure
traefik.http.routers.{name}-secure.tls=true
traefik.http.routers.{name}-secure.tls.certresolver=letsencrypt

# 2. HTTP-to-HTTPS redirect router
traefik.http.routers.{name}-redirect.rule=Host(`app.example.com`)
traefik.http.routers.{name}-redirect.entrypoints=web
traefik.http.routers.{name}-redirect.middlewares={name}-https-redirect

# 3. Redirect middleware
traefik.http.middlewares.{name}-https-redirect.redirectscheme.scheme=https
traefik.http.middlewares.{name}-https-redirect.redirectscheme.permanent=true
```

### Multiple Domains

An application can have multiple domains. The deployment service generates `Host` rules using the `||` operator:

```
traefik.http.routers.my-app.rule=Host(`my-app.localhost`) || Host(`staging.my-app.localhost`)
```

Localhost and production domains are handled separately -- localhost domains go to the HTTP router, while production domains go to the HTTPS router with TLS.

### Container Port Detection

The deployment service automatically detects the correct internal port for well-known Docker images. If the application specifies a `containerPort`, that takes precedence. Otherwise, GuildServer maps common images to their default ports:

| Image Pattern | Default Port |
|---------------|-------------|
| `node`, `next`, `nuxt`, `remix` | 3000 |
| `nginx`, `httpd`, `apache`, `caddy` | 80 |
| `flask`, `django`, `fastapi`, `uvicorn`, `gunicorn` | 8000 |
| `spring`, `tomcat`, `wildfly`, `jenkins`, `nocodb`, `hasura`, `keycloak` | 8080 |
| `vite` | 5173 |
| `n8n` | 5678 |
| `grafana`, `metabase`, `umami`, `outline`, `gitea` | 3000 |
| `ghost` | 2368 |
| `strapi` | 1337 |
| `minio`, `sonarqube`, `portainer` | 9000 |
| `uptime-kuma` | 3001 |
| Unknown | 80 |

The full port detection logic lives in the `detectDefaultPort()` function in `docker.ts`.

## ACME / Let's Encrypt

Traefik provisions SSL certificates automatically using the ACME protocol with Let's Encrypt.

### Configuration

```yaml
command:
  - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL:-admin@guildserver.com}"
  - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
  - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
```

| Setting | Purpose |
|---------|---------|
| `acme.email` | Contact email for Let's Encrypt notifications and expiry warnings |
| `acme.storage` | Path to the certificate store file (persisted via bind mount) |
| `acme.httpchallenge.entrypoint` | Uses the `web` (port 80) entry point for HTTP-01 challenges |

### Certificate Lifecycle

1. A production domain is assigned to a container with the `certresolver=letsencrypt` label.
2. Traefik requests a certificate from Let's Encrypt using the HTTP-01 challenge.
3. Let's Encrypt makes an HTTP request to `http://{domain}/.well-known/acme-challenge/{token}` to verify domain ownership.
4. The certificate is stored in `/letsencrypt/acme.json` and auto-renewed before expiry (typically 30 days before the 90-day expiration).

:::warning
For HTTP-01 challenges to succeed, port 80 must be publicly accessible and the domain's DNS must point to your server. If you are behind a firewall or NAT, configure port forwarding accordingly.
:::

### Certificate Storage

Certificates are stored in a bind mount:

```yaml
volumes:
  - ./data/letsencrypt:/letsencrypt
```

The `acme.json` file inside this directory contains all certificates and private keys. Ensure it is backed up and has restricted permissions (`chmod 600`).

## HTTP-to-HTTPS Redirect

:::info
GuildServer does **not** enable a global HTTP-to-HTTPS redirect. A global redirect would break `.localhost` domains used in development. Instead, redirects are configured per-router via container labels for production domains only.
:::

For each production domain, the deployment service creates a redirect middleware that sends a `301 Moved Permanently` response, directing browsers from `http://` to `https://`.

## Traefik Dashboard

The Traefik dashboard is available on **port 8080** and provides a real-time view of:

- Active HTTP and TCP routers
- Configured services and their health status
- Middleware chains applied to each router
- Entry point configurations

Access the dashboard at `http://localhost:8080` during development.

:::danger
The dashboard is configured with `--api.insecure=true`, which means no authentication is required. In production, either disable the dashboard entirely or protect it behind basic auth middleware or IP whitelisting.
:::

## Local Development

During local development, GuildServer uses `.localhost` domains for deployed applications. Modern browsers resolve `*.localhost` to `127.0.0.1` without any `/etc/hosts` configuration.

Example workflow:

1. Deploy an application named `my-app`.
2. GuildServer assigns the domain `my-app.localhost`.
3. Access the app at `http://my-app.localhost` (port 80, routed through Traefik).

No HTTPS is used for `.localhost` domains -- they use the plain `web` (port 80) entry point exclusively.

## Entry Points Summary

| Entry Point | Address | Protocol | Purpose |
|-------------|---------|----------|---------|
| `web`       | `:80`   | HTTP     | Plain HTTP traffic, ACME challenges, localhost domains |
| `websecure` | `:443`  | HTTPS    | TLS-terminated traffic for production domains |

## Troubleshooting

### Container not reachable by domain

1. Verify the container has `traefik.enable=true` in its labels: `docker inspect <container>`.
2. Confirm the container is on the `guildserver` network: `docker network inspect guildserver`.
3. Check that the `Host` rule matches the domain you are requesting.
4. Review Traefik logs: `docker compose logs -f traefik`.

### SSL certificate not provisioning

1. Ensure port 80 is accessible from the public internet.
2. Verify the DNS A or CNAME record points to your server IP.
3. Check Traefik logs for ACME errors: look for "unable to obtain ACME certificate" messages.
4. Confirm the `letsencrypt` volume mount exists and has correct file permissions.

### Multiple apps conflicting

Each application gets a unique router name derived from its `appName`. If two apps share the same sanitized name, routing conflicts will occur. Ensure application names are unique within the platform.

## Next Steps

- Understand the full [networking model](./networking.md)
- Learn about [Kubernetes integration](./kubernetes.md) for multi-cluster deployments
- Review the [Docker setup](./docker-setup.md) for the complete Compose file
