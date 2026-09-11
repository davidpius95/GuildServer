-- Off-site backup storage (S3-compatible) for database backups.
--
-- Safe to apply to a live database before the code that uses it ships, which
-- is the required order on installs where scripts/self-update.sh deploys code
-- automatically but does not run migrations. Everything is additive except
-- widening database_backups.size_bytes from integer to bigint: a 2 GiB dump
-- overflowed int4. Re-running the ALTER on a bigint column is a no-op.

CREATE TABLE IF NOT EXISTS "s3_storages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "endpoint" text NOT NULL,
  "region" varchar(64) DEFAULT 'us-east-1' NOT NULL,
  "bucket" varchar(255) NOT NULL,
  -- Optional key prefix inside the bucket, so several installs or teams can
  -- share one bucket without colliding.
  "path_prefix" text,
  -- Both stored encrypted (utils/crypto encryptSecret), never returned to clients.
  "access_key_id" text NOT NULL,
  "secret_access_key" text NOT NULL,
  -- MinIO, Ceph and most self-hosted S3 need path-style addressing.
  "force_path_style" boolean DEFAULT true NOT NULL,
  "last_tested_at" timestamp,
  "last_test_ok" boolean,
  "last_test_error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "s3_storages_organization_id_idx" ON "s3_storages" ("organization_id");--> statement-breakpoint

-- NULL keeps today's behaviour: backups stay on the local host only.
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_storage_id" uuid;--> statement-breakpoint

ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "storage_id" uuid;--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "remote_key" text;--> statement-breakpoint
-- Hex SHA-256 of the dump, recorded at backup time and checked before restore.
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "checksum_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "uploaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "upload_error" text;--> statement-breakpoint
ALTER TABLE "database_backups" ALTER COLUMN "size_bytes" TYPE bigint;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "s3_storages" ADD CONSTRAINT "s3_storages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "databases" ADD CONSTRAINT "databases_backup_storage_id_s3_storages_id_fk" FOREIGN KEY ("backup_storage_id") REFERENCES "s3_storages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_storage_id_s3_storages_id_fk" FOREIGN KEY ("storage_id") REFERENCES "s3_storages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
