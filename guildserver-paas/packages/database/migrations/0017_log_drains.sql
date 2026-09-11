-- Log drains: forward a resource's container logs to an HTTP endpoint.
--
-- Additive; safe to apply before the code that uses it. With no rows the log
-- drain manager follows no containers.

CREATE TABLE IF NOT EXISTS "log_drains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  -- Exactly one of these is set (enforced by the API): the application or
  -- Compose stack whose containers are drained.
  "application_id" uuid,
  "service_id" uuid,
  -- Encrypted JSON (utils/crypto encryptSecret): endpoint URL and request
  -- headers. Never returned to clients.
  "secret" text NOT NULL,
  -- json (a JSON array per request) | ndjson (one JSON object per line).
  "format" varchar(16) DEFAULT 'json' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_delivery_at" timestamp,
  "last_delivery_ok" boolean,
  "last_error" text,
  "records_sent" bigint DEFAULT 0 NOT NULL,
  "records_dropped" bigint DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "log_drains_organization_id_idx" ON "log_drains" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_drains_application_id_idx" ON "log_drains" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_drains_service_id_idx" ON "log_drains" ("service_id");--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
