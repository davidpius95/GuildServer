-- BaaS schema additions — idempotent, safe to run on hand-managed prod DB
-- Adds: auto-pause columns, WAL archiving columns, baas_metrics table

-- ── baas_projects: auto-pause columns ─────────────────────────────────────────
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "idle_timeout_minutes" integer DEFAULT 30;
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "last_activity_at"     timestamp;
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "auto_wake_enabled"    boolean DEFAULT true;

-- ── baas_projects: WAL / PITR columns ─────────────────────────────────────────
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "wal_archive_enabled" boolean DEFAULT false;
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "wal_archive_path"    text;
ALTER TABLE "baas_projects" ADD COLUMN IF NOT EXISTS "pitr_enabled"        boolean DEFAULT false;

-- ── baas_backups: WAL target time column ──────────────────────────────────────
ALTER TABLE "baas_backups" ADD COLUMN IF NOT EXISTS "wal_target_time" timestamp;

-- ── baas_metrics: new table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "baas_metrics" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"         uuid NOT NULL REFERENCES "baas_projects"("id") ON DELETE CASCADE,
  "collected_at"       timestamp DEFAULT now(),

  -- Container resource usage (from docker stats)
  "cpu_percent"        decimal DEFAULT 0,
  "ram_mb_used"        integer DEFAULT 0,
  "storage_gb_used"    decimal DEFAULT 0,

  -- Database metrics (from pg_stat_database)
  "active_connections" integer DEFAULT 0,
  "db_size_mb"         decimal DEFAULT 0,
  "tx_committed"       integer DEFAULT 0,
  "tx_rolled_back"     integer DEFAULT 0,

  "metadata"           jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "baas_metrics_project_id_idx"   ON "baas_metrics"("project_id");
CREATE INDEX IF NOT EXISTS "baas_metrics_collected_at_idx" ON "baas_metrics"("collected_at");
CREATE INDEX IF NOT EXISTS "baas_metrics_project_time_idx" ON "baas_metrics"("project_id", "collected_at");
