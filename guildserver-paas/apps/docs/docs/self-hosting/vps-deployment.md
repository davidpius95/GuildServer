---
title: "VPS Deployment Guide"
sidebar_position: 2
---

# VPS Deployment Guide

This guide walks through deploying GuildServer on a fresh VPS running Ubuntu 22.04 or Debian 12. By the end, you will have a production-ready instance with SSL, database persistence, and automatic container management.

## Server Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 2 GB | 4 GB |
| CPU Cores | 2 | 4 |
| Disk | 20 GB SSD | 50 GB SSD |
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 LTS |

:::info
Each deployed application container will consume additional resources. Plan for roughly 256 MB RAM and 0.25 CPU per application.
:::

## Step 1: Install Docker

```bash
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (avoids needing sudo)
sudo usermod -aG docker $USER

# Apply group change (or log out and back in)
newgrp docker

# Verify installation
docker --version
docker compose version
```

Docker Compose is included with modern Docker installations (v2 plugin).

## Step 2: Install Node.js 20

Node.js is needed for running database migrations and the seed script.

```bash
# Install via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm (GuildServer uses pnpm workspaces)
npm install -g pnpm

# Verify
node --version  # v20.x.x
pnpm --version
```

## Step 3: Clone the Repository

```bash
git clone https://github.com/your-org/guildserver-paas.git
cd guildserver-paas
```

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit the `.env` file with your production values:

```bash
# Database
DATABASE_URL="postgresql://guildserver:YOUR_STRONG_PASSWORD@localhost:5433/guildserver"

# Redis
REDIS_URL="redis://localhost:6380"

# Application
NODE_ENV="production"
APP_URL="https://yourdomain.com"
API_URL="https://api.yourdomain.com"

# Authentication
JWT_SECRET="generate-a-random-32-char-string-here"
NEXTAUTH_SECRET="another-random-secret-here"
NEXTAUTH_URL="https://yourdomain.com"

# SSL / Domain
ACME_EMAIL="admin@yourdomain.com"
BASE_DOMAIN="yourdomain.com"

# Encryption key for environment variable secrets
ENV_ENCRYPTION_KEY="32-character-encryption-key-here"
```

:::danger
Generate strong random values for `JWT_SECRET`, `NEXTAUTH_SECRET`, and `ENV_ENCRYPTION_KEY`. Use `openssl rand -base64 32` to generate them.
:::

## Step 5: Configure DNS

Create the following DNS records pointing to your server IP:

| Type | Name | Value |
|---|---|---|
| A | `yourdomain.com` | `<server-ip>` |
| A | `*.yourdomain.com` | `<server-ip>` |

The wildcard record is needed for automatic subdomain routing (each deployed app gets `<app-name>.yourdomain.com`).

:::tip
DNS propagation can take up to 48 hours, but typically completes within minutes. Use `dig yourdomain.com` to verify.
:::

## Step 6: Create the Docker Network

The shared network must exist before starting services:

```bash
docker network create guildserver
```

## Step 7: Start Services

```bash
docker compose up -d
```

Watch the logs to ensure everything starts correctly:

```bash
docker compose logs -f
```

Wait for the health checks to pass. You should see log lines indicating PostgreSQL and Redis are ready.

## Step 8: Install Dependencies and Run Migrations

```bash
# Install Node.js dependencies
pnpm install

# Run database migrations
pnpm run db:migrate

# Seed initial data (creates default admin user and plans)
pnpm run db:seed
```

## Step 9: Verify the Installation

```bash
# Check API health
curl http://localhost:4000/health

# Check all containers are running
docker compose ps

# Check Traefik dashboard (development only)
curl http://localhost:8080/api/overview
```

## Step 10: Access GuildServer

Open your browser and navigate to your domain. If DNS and SSL are configured correctly:

- **Web UI**: `https://yourdomain.com`
- **API**: `https://api.yourdomain.com` (or `http://localhost:4000` directly)

Log in with the credentials created by the seed script.

## Firewall Configuration

Only ports 80 (HTTP) and 443 (HTTPS) need to be publicly accessible:

```bash
# Using ufw
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp   # SSH -- do not lock yourself out
sudo ufw enable

# Verify
sudo ufw status
```

:::warning
Do not expose ports 5433 (PostgreSQL), 6380 (Redis), or 8080 (Traefik dashboard) to the public internet.
:::

## Updating GuildServer

```bash
cd guildserver-paas

# Pull latest changes
git pull origin main

# Update dependencies
pnpm install

# Run any new migrations
pnpm run db:migrate

# Rebuild and restart containers
docker compose up -d --build
```

## Troubleshooting

### API fails to start

Check the logs:

```bash
docker compose logs api
```

Common issues:
- Database connection refused: ensure PostgreSQL is healthy (`docker compose ps`)
- Redis connection refused: ensure Redis is healthy
- Missing `JWT_SECRET`: check your `.env` file

### SSL certificates not provisioning

- Verify port 80 is publicly accessible (HTTP-01 challenge requires it)
- Check `ACME_EMAIL` is set
- Check Traefik logs: `docker compose logs traefik`
- Ensure DNS is pointing to your server

### Out of memory

If containers keep restarting with OOM kills:

```bash
# Check memory usage
docker stats --no-stream

# Increase swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

See the [Production Checklist](./production-checklist.md) for additional hardening steps.
