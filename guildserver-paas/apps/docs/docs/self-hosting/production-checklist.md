---
title: "Production Checklist"
sidebar_position: 3
---

# Production Checklist

Before exposing GuildServer to real traffic, work through this checklist to ensure your deployment is secure, reliable, and operationally sound.

## Security

- [ ] **Change `JWT_SECRET`** to a strong random value (32+ characters). Generate with: `openssl rand -base64 32`
- [ ] **Change the database password** from the default `password123` in both `docker-compose.yml` and `DATABASE_URL`
- [ ] **Set `ENV_ENCRYPTION_KEY`** to a secure 32-character string. This key encrypts secret environment variables stored in the database
- [ ] **Set `NEXTAUTH_SECRET`** to a unique random value for session signing
- [ ] **Configure HTTPS** via Traefik + Let's Encrypt (see [SSL Certificates](./ssl-certificates.md))
- [ ] **Set `ACME_EMAIL`** for Let's Encrypt certificate expiry notifications
- [ ] **Configure firewall** -- allow only ports 80 (HTTP), 443 (HTTPS), and 22 (SSH)
- [ ] **Remove Traefik dashboard** in production by removing `--api.insecure=true` and port 8080
- [ ] **Remove external database ports** -- PostgreSQL (5433) and Redis (6380) should not be publicly accessible
- [ ] **Review CORS settings** to restrict allowed origins to your domain
- [ ] **Enable rate limiting** on the API to prevent abuse

## Environment

- [ ] **Set `NODE_ENV=production`** for both the API and Web services
- [ ] **Set `BASE_DOMAIN`** to your actual domain (e.g., `example.com`)
- [ ] **Set `APP_URL`** to your frontend URL (e.g., `https://example.com`)
- [ ] **Set `API_URL`** to your API URL (e.g., `https://api.example.com`)
- [ ] **Set `NEXTAUTH_URL`** to match `APP_URL`
- [ ] **Set `LOG_LEVEL=info`** (or `warn` for quieter logs)

## Database

- [ ] **Set up automatic database backups** -- see [Backups & Disaster Recovery](./backups.md)
- [ ] **Test backup restoration** to verify backups are valid
- [ ] **Run migrations** before going live: `pnpm run db:migrate`
- [ ] **Seed initial data** if not already done: `pnpm run db:seed`

## Monitoring

- [ ] **Verify API health endpoint** responds: `curl https://api.yourdomain.com/health`
- [ ] **Set up external uptime monitoring** (e.g., UptimeRobot, Pingdom, or Checkly)
- [ ] **Configure email notifications** via SMTP for deployment alerts -- see [Alerts & Notifications](../monitoring/alerts.md)
- [ ] **Set up Slack integration** if your team uses Slack
- [ ] **Review metrics collection** is running (check API logs for "Metrics collection started")

## Infrastructure

- [ ] **Docker restart policy** is set to `unless-stopped` on all containers
- [ ] **Volume persistence** is configured for PostgreSQL, Redis, and Let's Encrypt data
- [ ] **Configure log rotation** to prevent disk exhaustion:

```bash
# /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

- [ ] **Set up swap space** if running on a low-memory VPS (2 GB recommended minimum):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Updates Strategy

- [ ] **Establish an update process** -- pull latest code, rebuild, restart
- [ ] **Test updates in a staging environment** before applying to production
- [ ] **Set up a rollback plan** -- keep previous Docker images for quick rollback

## Optional but Recommended

- [ ] **Configure S3-compatible storage** for build artifacts and backups
- [ ] **Enable two-factor authentication** for admin accounts
- [ ] **Set up audit logging** review schedule
- [ ] **Document your deployment** for team reference (runbook)
- [ ] **Configure spend limits** for billing if using paid plans
- [ ] **Set up SSH key authentication** and disable password login on your server

## Quick Verification Commands

After completing the checklist, run these commands to verify:

```bash
# All containers running
docker compose ps

# API is healthy
curl -f https://api.yourdomain.com/health

# Database is accessible
docker compose exec postgres pg_isready -U guildserver

# Redis is responsive
docker compose exec redis redis-cli ping

# SSL certificate is valid
curl -vI https://yourdomain.com 2>&1 | grep "SSL certificate"

# Check for default passwords
grep -r "password123" docker-compose.yml .env
# Should return no results
```

:::danger
If `grep "password123"` returns any results, you still have default credentials in your configuration. Change them before going live.
:::
