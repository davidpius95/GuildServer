DO $$ BEGIN
 CREATE TYPE "backup_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "database_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid,
	"size_bytes" integer DEFAULT 0,
	"status" "backup_status" DEFAULT 'pending',
	"file_url" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "registry_url" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "registry_username" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "registry_password" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "redirects_to" varchar(255);--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verification_error" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_http_status" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "database_backups_database_id_idx" ON "database_backups" ("database_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "database_backups" ADD CONSTRAINT "database_backups_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
