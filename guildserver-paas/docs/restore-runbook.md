# Restoring the GuildServer control-plane database

This is the procedure that was rehearsed on 13 September 2026: the newest
production dump restored into a scratch database in 61 seconds with zero
errors. Rehearse it again whenever the schema changes shape, and after any
change to the backup job — a dump nobody has restored is a hope, not a backup.

## What is backed up

`guildserver-backup.sh` runs nightly and writes `guildserver-<stamp>.sql.gz`
to `/home/usher-node/guildserver-backups`, keeping 14 days. It holds the
platform's own database: organizations, projects, applications, databases
metadata, tokens, notification channels, installations and audit history.

It does **not** hold customer database contents — those have their own
per-database backups, configurable off-site (see `docs/backups.md`) — and it
does not hold `.env.production`, which carries `ENV_ENCRYPTION_KEY`. **A
restored database is unreadable without that key**: every stored secret is
encrypted with it. Keep a copy somewhere this host is not the only holder.

## Rehearsing a restore (safe, touches nothing live)

```bash
BACKUP=$(ls -1t /home/usher-node/guildserver-backups/guildserver-*.sql.gz | head -1)
SCRATCH="restore_drill_$(date +%s)"

docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'CREATE DATABASE $SCRATCH'"
gunzip -c "$BACKUP" | docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $SCRATCH -q"

# Compare against production: table count, migrations, and a few row counts.
docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $SCRATCH -At" <<'SQL'
select 'tables: '||count(*) from information_schema.tables where table_schema='public';
select 'migrations: '||count(*) from guildserver_migrations;
select 'users: '||count(*) from users;
SQL

docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE $SCRATCH'"
```

Expect the dump to be behind production by whatever happened since it was
taken. A dump from before a migration will show one fewer migration and one
fewer table — that is correct, not a fault.

## Restoring for real (destructive — read first)

1. **Stop writers.** Under the updater's lock, so a deploy cannot start
   mid-restore:
   ```bash
   flock /tmp/guildserver-self-update.lock docker compose --env-file .env.production \
     -f docker-compose.prod.yml stop api web
   ```
2. **Take a dump of the current state first**, however broken it looks. It is
   the only way back if the restore turns out worse.
3. **Restore into a new database, not over the live one.** Restoring over a
   database with open connections fails halfway and leaves neither version
   intact:
   ```bash
   docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres -c 'CREATE DATABASE guildserver_restored'"
   gunzip -c <dump> | docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d guildserver_restored -q"
   ```
4. **Verify before cutting over**: table count, `guildserver_migrations`, and
   row counts for `organizations`, `applications`, `users`.
5. **Cut over** by renaming, which is atomic and reversible:
   ```bash
   docker exec -i guildserver-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d postgres" <<'SQL'
   ALTER DATABASE guildserver RENAME TO guildserver_before_restore;
   ALTER DATABASE guildserver_restored RENAME TO guildserver;
   SQL
   ```
6. **Apply any migrations the dump predates**, then start the API and web
   again and run `scripts/prod-smoke.sh`.
7. **Keep `guildserver_before_restore`** until the platform has run cleanly for
   a day.

## If the restore is from before a migration

`pnpm --filter @guildserver/database db:migrate` brings it forward, then
`db:verify` confirms the schema matches `schema/index.ts`. Both are safe to
re-run.
