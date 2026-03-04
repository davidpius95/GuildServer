---
title: "Backups & Disaster Recovery"
sidebar_position: 5
---

# Backups & Disaster Recovery

GuildServer stores all critical state in PostgreSQL. This guide covers backup strategies for the database, Redis, Docker volumes, and a disaster recovery plan.

## Database Backups

### Manual Backup with pg_dump

Create a compressed backup of the PostgreSQL database:

```bash
# From the host (using the exposed port)
pg_dump -h localhost -p 5433 -U guildserver -d guildserver -Fc > backup_$(date +%Y%m%d_%H%M%S).dump

# Or via the Docker container
docker compose exec postgres pg_dump -U guildserver -d guildserver -Fc > backup_$(date +%Y%m%d_%H%M%S).dump
```

The `-Fc` flag produces a custom-format compressed archive, which is the most flexible for restoration.

### Automated Daily Backups

Set up a cron job to run backups automatically:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /path/to/guildserver-paas && docker compose exec -T postgres pg_dump -U guildserver -d guildserver -Fc > /backups/guildserver_$(date +\%Y\%m\%d).dump 2>/dev/null
```

Create the backup directory:

```bash
sudo mkdir -p /backups
sudo chmod 700 /backups
```

### Backup Retention Script

Keep the last 7 daily backups and delete older ones:

```bash
#!/bin/bash
# /usr/local/bin/cleanup-backups.sh
BACKUP_DIR="/backups"
RETENTION_DAYS=7

find "$BACKUP_DIR" -name "guildserver_*.dump" -mtime +$RETENTION_DAYS -delete
echo "Cleaned up backups older than $RETENTION_DAYS days"
```

Add to cron to run daily after the backup:

```bash
30 2 * * * /usr/local/bin/cleanup-backups.sh
```

### Restoring from Backup

```bash
# Stop the API to prevent writes during restore
docker compose stop api web

# Restore the database
docker compose exec -T postgres pg_restore \
  -U guildserver \
  -d guildserver \
  --clean \
  --if-exists \
  < /backups/guildserver_20250301.dump

# Restart services
docker compose start api web

# Verify
curl http://localhost:4000/health
```

:::danger
The `--clean` flag drops existing objects before restoring. Make sure you are restoring to the correct database.
:::

### Plain SQL Backup (Alternative)

For a human-readable SQL dump:

```bash
docker compose exec -T postgres pg_dump -U guildserver -d guildserver > backup.sql
```

Restore with:

```bash
docker compose exec -T postgres psql -U guildserver -d guildserver < backup.sql
```

## Redis Backups

Redis is used for BullMQ job queues and caching. While Redis data is not critical (jobs can be re-queued and caches rebuilt), you may want to back it up.

### RDB Snapshots

Redis automatically creates RDB snapshots in the data volume. To trigger a manual snapshot:

```bash
docker compose exec redis redis-cli BGSAVE
```

The RDB file is stored in the `redis_data` volume at `/data/dump.rdb`.

### Backing Up the Redis Volume

```bash
# Create a backup of the Redis volume
docker run --rm \
  -v guildserver-paas_redis_data:/data \
  -v /backups:/backup \
  alpine tar czf /backup/redis_$(date +%Y%m%d).tar.gz -C /data .
```

### AOF Persistence

For stronger durability guarantees, enable Redis AOF (Append-Only File):

```yaml
# docker-compose.yml
redis:
  command: redis-server --appendonly yes
```

This logs every write operation and can recover to the exact state before a crash.

## Docker Volume Backups

### PostgreSQL Volume

```bash
# Stop PostgreSQL first for a consistent backup
docker compose stop postgres

# Back up the volume
docker run --rm \
  -v guildserver-paas_postgres_data:/data \
  -v /backups:/backup \
  alpine tar czf /backup/postgres_volume_$(date +%Y%m%d).tar.gz -C /data .

# Restart PostgreSQL
docker compose start postgres
```

:::tip
Prefer `pg_dump` over volume-level backups. `pg_dump` creates portable, version-independent backups. Volume backups are tied to the specific PostgreSQL version and platform.
:::

### Let's Encrypt Certificates

```bash
# Back up the acme.json file
cp data/letsencrypt/acme.json /backups/acme_$(date +%Y%m%d).json
```

This file contains all provisioned SSL certificates and their private keys. While certificates can be re-provisioned, backing up avoids Let's Encrypt rate limits.

## Application Data

### Build and Deployment Logs

Build logs and deployment logs are stored in the `deployments` table in PostgreSQL. They are included in database backups automatically.

### Environment Variables

Encrypted environment variables are stored in the `environment_variables` table. They are included in database backups.

:::warning
Environment variable secrets are encrypted with `ENV_ENCRYPTION_KEY`. If you lose this key, you cannot decrypt stored secrets even with a valid database backup. Store this key securely outside the database.
:::

## BullMQ Job Queue

The BullMQ framework in GuildServer supports a backup queue, though automated backups are not yet fully implemented:

```typescript
export const backupQueue = new Queue("backup", { connection: redis });
```

The backup worker is available at `apps/api/src/queues/setup.ts` and can be extended with custom backup logic.

## Disaster Recovery Plan

### Complete Recovery from Scratch

1. **Provision a new server** meeting the [minimum requirements](./vps-deployment.md#server-requirements)

2. **Install Docker and Node.js** following the [VPS Deployment Guide](./vps-deployment.md)

3. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/guildserver-paas.git
   cd guildserver-paas
   ```

4. **Restore environment configuration**
   ```bash
   cp .env.backup .env  # or recreate from documentation
   ```

5. **Create the Docker network**
   ```bash
   docker network create guildserver
   ```

6. **Start infrastructure services only**
   ```bash
   docker compose up -d postgres redis traefik
   ```

7. **Wait for PostgreSQL to be ready**
   ```bash
   docker compose exec postgres pg_isready -U guildserver
   ```

8. **Restore the database**
   ```bash
   docker compose exec -T postgres pg_restore \
     -U guildserver -d guildserver --clean --if-exists \
     < /backups/guildserver_latest.dump
   ```

9. **Restore SSL certificates** (optional, speeds recovery)
   ```bash
   cp /backups/acme_latest.json data/letsencrypt/acme.json
   ```

10. **Start application services**
    ```bash
    docker compose up -d api web
    ```

11. **Verify health**
    ```bash
    curl http://localhost:4000/health
    docker compose ps
    ```

12. **Re-deploy applications** -- previously running containers will need to be redeployed from the dashboard since Docker container state is not backed up.

### Recovery Time Estimates

| Scenario | Estimated Time |
|---|---|
| API service restart | < 1 minute |
| Database restore (< 1 GB) | 5 - 10 minutes |
| Full server rebuild | 30 - 60 minutes |
| DNS propagation (new server IP) | Minutes to 48 hours |

## Offsite Backup Strategy

For production deployments, store backups offsite:

```bash
# Upload to S3-compatible storage
aws s3 cp /backups/guildserver_$(date +%Y%m%d).dump \
  s3://your-backup-bucket/guildserver/

# Or use rclone for other providers
rclone copy /backups/guildserver_$(date +%Y%m%d).dump \
  remote:guildserver-backups/
```

Schedule offsite uploads in cron to run after the local backup completes.
