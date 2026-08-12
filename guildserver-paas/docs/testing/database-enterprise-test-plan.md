# Database Enterprise Test Plan

This document describes how to test GuildServer database hosting, backup scheduling, restore, download, and future external-database migration flows.

## Current implementation status

Implemented today:

- Platform-hosted database containers for PostgreSQL, MySQL, MariaDB, MongoDB, and Redis.
- Persistent Docker volumes for hosted databases.
- Connection info endpoint with redacted password.
- Manual backup jobs.
- Automatic backup scheduling with hourly, daily, and weekly cadence.
- Backup retention sweep.
- Backup download through the authenticated downloads route.
- Restore jobs from completed backup files.
- Dashboard database list, create modal, backup settings, backup history, restore, download, restart, and delete actions.

Not yet first-class:

- External database connection registry.
- Testing an external database connection before saving it.
- Pull migration from an external provider into GuildServer.
- Push migration from GuildServer to an external provider.
- Migration dry-run, progress timeline, validation checks, cutover, rollback, and post-migration verification.

## Fast backend smoke test

Run this on a machine with:

- `DATABASE_URL` pointed at the GuildServer control-plane database.
- Docker socket access.
- Redis available via `REDIS_URL`.
- A disposable project ID.

Command:

```bash
SMOKE_PROJECT_ID=<project-id> pnpm --dir apps/api smoke:database
```

What it verifies:

- Creates a disposable PostgreSQL database record.
- Provisions a real PostgreSQL container.
- Waits until PostgreSQL accepts queries.
- Writes a smoke table and row.
- Creates a backup record and runs the real dump.
- Mutates the database after backup.
- Restores from the backup.
- Confirms restore brought the row count back to the backup state.
- Registers an automatic backup schedule.
- Removes the schedule, backup file, database container, volume, backup rows, and database row.

Production expectations:

- `DATABASE_PUBLIC_HOST` must be set to the hostname users should put into TablePlus, psql, MySQL Workbench, Compass, or Redis clients.
- `BACKUP_DIR` must point to durable storage. The production compose file mounts `database_backups` at `/var/lib/guildserver/backups`.

Expected result:

```json
{
  "ok": true,
  "createdRecord": true,
  "provisioned": true,
  "ready": true,
  "writeVerified": true,
  "restoreVerified": true,
  "scheduleRegistered": true
}
```

## Manual UI test

### Hosted database

1. Log in.
2. Open Dashboard > Databases.
3. Click Create Database.
4. Create a PostgreSQL database with automatic backups enabled.
5. Confirm the database card appears with status `running`.
6. Copy the connection string.
7. Confirm the copied connection string uses the assigned external port and redacts the password.
8. Click Backup.
9. Open Backups tab.
10. Confirm a backup appears as `in_progress`, then `completed`.
11. Click Download.
12. Confirm the browser downloads a dump file.
13. Click Restore on the completed backup.
14. Confirm restore starts and does not block the UI.
15. Open Settings.
16. Change backup frequency and retention.
17. Save backup settings.
18. Confirm the database card still loads and the settings persist after refresh.

### Delete behavior

1. Delete a disposable database without destroying data if the UI exposes that option.
2. Confirm the container is removed.
3. Confirm scheduled backup jobs are removed.
4. Confirm persistent volume behavior matches the selected delete option.

## API-level test matrix

| Area | Test | Expected |
| --- | --- | --- |
| Access control | User outside organization lists databases | `FORBIDDEN` |
| Create | Valid PostgreSQL config | DB row created and container starts |
| Create failure | Invalid image or unavailable Docker | DB status becomes `error`; user gets actionable error |
| Connection info | Running database | Host, port, database, username returned; password redacted |
| Manual backup | Running database | Backup row goes `in_progress` to `completed`; file path and size set |
| Manual backup failure | Stopped database | Backup row becomes `failed` with error |
| Schedule enable | hourly/daily/weekly | Existing repeat job is replaced with the right cron |
| Schedule disable | backupEnabled false | Repeat job removed |
| Retention | expired backup | File and DB row are deleted |
| Restore | completed backup | Restore job runs and data is restored |
| Download | completed backup | Authenticated route streams file |
| Delete | database with schedule | Schedule removed; container removed; data volume behavior matches option |

## External database and migration target design

To reach enterprise quality, add these first-class flows:

### Connect external database

Required fields:

- Provider label.
- Engine: PostgreSQL, MySQL, MariaDB, MongoDB, Redis.
- Host, port, database name, username.
- Secret password or connection string stored encrypted.
- SSL mode and CA certificate where applicable.
- Network access notes: allowlist IP, tunnel, private network, or SSH/Tailscale proxy.

Required actions:

- Test connection.
- Save connection.
- Show last successful check.
- Rotate credentials.
- Disable/delete external connection.

### Import into GuildServer

Flow:

1. Select external source.
2. Test source connection.
3. Choose or create GuildServer target database.
4. Run compatibility check.
5. Start migration job.
6. Stream dump/import progress.
7. Validate row counts or checksum where supported.
8. Show connection string for new target.
9. Optional cutover checklist.

### Export out of GuildServer

Flow:

1. Select hosted database.
2. Select external target.
3. Test target connection.
4. Run dry-run permissions check.
5. Create safety backup.
6. Transfer dump to target.
7. Validate import.
8. Keep source intact unless user explicitly deletes it.

### Enterprise migration requirements

- Migration jobs must be resumable or safely retryable.
- Every migration needs logs, status, started/completed timestamps, source, target, and actor.
- Credentials must never be printed in logs.
- Large database migrations need streaming, not loading dumps fully into memory.
- Destructive cutover/delete actions need explicit confirmation.
- Failed migrations should keep both source and target recoverable.
