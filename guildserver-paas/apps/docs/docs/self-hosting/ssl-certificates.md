---
title: "SSL Certificates"
sidebar_position: 4
---

# SSL Certificates

GuildServer uses **Traefik** as its reverse proxy with built-in Let's Encrypt integration for automatic SSL certificate provisioning. Every custom domain gets HTTPS with zero manual configuration.

## How It Works

```
1. You deploy an app with domain "myapp.example.com"
   ↓
2. GuildServer adds Traefik labels to the container:
   traefik.http.routers.myapp-secure.tls.certresolver=letsencrypt
   ↓
3. Traefik detects the new router and domain
   ↓
4. Traefik requests a certificate from Let's Encrypt (HTTP-01 challenge)
   ↓
5. Let's Encrypt verifies domain ownership via port 80
   ↓
6. Certificate is issued and stored in acme.json
   ↓
7. HTTPS is active -- HTTP requests are redirected to HTTPS
```

## Configuration

### Required Environment Variable

```bash
ACME_EMAIL=admin@yourdomain.com
```

This email is sent to Let's Encrypt for certificate expiry notifications. It is configured in the Traefik command:

```yaml
traefik:
  command:
    - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
    - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
```

### Certificate Storage

Certificates are stored in `/letsencrypt/acme.json` inside the Traefik container. This file is persisted via a volume mount:

```yaml
traefik:
  volumes:
    - ./data/letsencrypt:/letsencrypt
```

:::warning
The `acme.json` file contains private keys. Ensure the `data/letsencrypt` directory has restricted permissions: `chmod 600 data/letsencrypt/acme.json`
:::

### Challenge Type

GuildServer uses the **HTTP-01** challenge by default. This requires:

- Port 80 must be publicly accessible
- DNS must resolve the domain to your server IP
- The domain must not be a localhost/internal domain

### Entrypoints

Traefik listens on two entrypoints:

| Entrypoint | Port | Purpose |
|---|---|---|
| `web` | 80 | HTTP traffic and ACME challenges |
| `websecure` | 443 | HTTPS traffic |

## Automatic HTTPS for Deployed Applications

When an application is deployed with a custom domain, GuildServer automatically configures Traefik labels on the container:

**For real (non-localhost) domains:**

```
traefik.http.routers.<app>-secure.rule = Host(`myapp.example.com`)
traefik.http.routers.<app>-secure.entrypoints = websecure
traefik.http.routers.<app>-secure.tls = true
traefik.http.routers.<app>-secure.tls.certresolver = letsencrypt
```

Plus an HTTP-to-HTTPS redirect:

```
traefik.http.routers.<app>-redirect.rule = Host(`myapp.example.com`)
traefik.http.routers.<app>-redirect.entrypoints = web
traefik.http.routers.<app>-redirect.middlewares = <app>-https-redirect
traefik.http.middlewares.<app>-https-redirect.redirectscheme.scheme = https
traefik.http.middlewares.<app>-https-redirect.redirectscheme.permanent = true
```

**For localhost domains (development):**

Localhost domains (`.localhost`, `.local`, `.test`, `.example`, `127.0.0.1`, private IPs) skip TLS entirely:

```
traefik.http.routers.<app>.rule = Host(`myapp.localhost`)
traefik.http.routers.<app>.entrypoints = web
```

This distinction is handled automatically by the `isLocalhostDomain()` function in the Docker service.

## Certificate Renewal

Traefik automatically renews certificates before they expire. Let's Encrypt certificates are valid for 90 days, and Traefik begins renewal 30 days before expiry.

No manual intervention is required. If renewal fails, GuildServer sends a `certificate_failed` notification via the [alerting system](../monitoring/alerts.md).

## Custom Certificates

If you need to use your own certificates instead of Let's Encrypt (e.g., for internal CAs or wildcard certs), you can configure them in Traefik's static configuration.

### File-Based Certificates

Create a certificates configuration file:

```yaml
# traefik/dynamic/certs.yml
tls:
  certificates:
    - certFile: /certs/yourdomain.crt
      keyFile: /certs/yourdomain.key
```

Mount the certificates and configuration in `docker-compose.yml`:

```yaml
traefik:
  volumes:
    - ./certs:/certs:ro
    - ./traefik/dynamic:/etc/traefik/dynamic:ro
  command:
    - "--providers.file.directory=/etc/traefik/dynamic"
    - "--providers.file.watch=true"
```

### Wildcard Certificates

For wildcard certificates (`*.yourdomain.com`), you need to use the DNS-01 challenge instead of HTTP-01. This requires DNS provider API credentials. Refer to the [Traefik documentation](https://doc.traefik.io/traefik/https/acme/#dnschallenge) for provider-specific configuration.

## Local Development

In local development, SSL is not used. Applications are accessible via `.localhost` domains over plain HTTP:

```
http://my-app.guildserver.localhost
```

This works because `.localhost` domains resolve to `127.0.0.1` by default on most operating systems, and Traefik routes them without TLS.

## Database Schema

SSL certificates are also tracked in the `certificates` database table:

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `domain` | VARCHAR(255) | Domain name |
| `certificateChain` | TEXT | Full certificate chain (PEM) |
| `privateKey` | TEXT | Private key (PEM, encrypted at rest) |
| `issuer` | VARCHAR(255) | Certificate issuer (default: `lets-encrypt`) |
| `status` | ENUM | `pending`, `provisioning`, `active`, `renewal`, `failed`, `expired` |
| `issuedAt` | TIMESTAMP | When the cert was issued |
| `expiresAt` | TIMESTAMP | Expiry date |
| `lastRenewalAt` | TIMESTAMP | Last successful renewal |
| `autoRenew` | BOOLEAN | Whether auto-renewal is enabled (default: true) |

## Troubleshooting

### Certificate not provisioning

1. Verify port 80 is accessible from the internet
2. Check DNS resolves correctly: `dig myapp.example.com`
3. Check Traefik logs: `docker compose logs traefik | grep -i acme`
4. Verify `ACME_EMAIL` is set in your environment
5. Check `acme.json` permissions: must be readable by Traefik

### Certificate expired

If a certificate expires despite auto-renewal:

1. Check Traefik logs for renewal errors
2. Verify the domain still resolves to your server
3. Delete the stale entry from `acme.json` and restart Traefik to force re-provisioning

### Mixed content warnings

Ensure your frontend is configured to use HTTPS URLs for API calls:

```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/trpc
```
