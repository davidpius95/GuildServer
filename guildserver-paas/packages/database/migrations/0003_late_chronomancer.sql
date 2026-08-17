-- Managed database persistence + backup configuration.
-- (Instance/billing tables from the same generate run are applied separately via
-- db:migrate-instances, so they are intentionally omitted here.)

ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "backup_type" varchar(20) DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "file_path" text;--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "error" text;--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "database_backups" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "volume_name" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "container_id" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "host_port" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_frequency" varchar(20) DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_hour" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_retention_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN IF NOT EXISTS "backup_dir" text;
