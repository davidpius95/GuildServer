-- Ownership columns every row already has: make the database enforce it.
--
-- These were declared nullable, so drizzle typed every relation through them
-- (application -> project -> organization) as possibly missing, and nothing
-- stopped an orphaned row from being written. Production had zero NULLs in
-- every one of them when this was written (2026-09-11).
--
-- SET NOT NULL fails, rolling the migration back, if a NULL has crept in, so
-- nothing is silently changed. It is a no-op on a column that is already NOT
-- NULL, so re-running is safe. The tables are small; each is scanned once.

ALTER TABLE "projects" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "applications" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "databases" ALTER COLUMN "project_id" SET NOT NULL;
ALTER TABLE "members" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "members" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "kubernetes_clusters" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "workflow_templates" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "workflow_executions" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "database_backups" ALTER COLUMN "database_id" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "timestamp" SET NOT NULL;
