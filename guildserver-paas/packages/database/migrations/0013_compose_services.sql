-- Compose stacks as a first-class resource.
--
-- Additive only: new tables plus one nullable column on `deployments`. Safe to
-- apply to a live database before the code that uses it ships, which is the
-- required order on installs where scripts/self-update.sh deploys code
-- automatically but does not run migrations.

CREATE TABLE IF NOT EXISTS "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "service_name" varchar(255) NOT NULL,
  "description" text,
  "project_id" uuid,
  -- The user's Compose file, kept verbatim as the source of truth.
  "compose_file" text NOT NULL,
  -- What we actually handed to Docker, for debugging our own normalisation.
  "compose_resolved" text,
  "template_id" varchar(255),
  "template_version" varchar(64),
  "environment" jsonb DEFAULT '{}'::jsonb,
  "domains" jsonb DEFAULT '{}'::jsonb,
  "provider_id" uuid,
  "status" varchar(50) DEFAULT 'inactive',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_containers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_id" uuid NOT NULL,
  "compose_service_name" varchar(255) NOT NULL,
  "container_id" text,
  "container_name" varchar(255),
  "image" text,
  "status" varchar(50) DEFAULT 'pending',
  "health" varchar(50),
  "host_port" integer,
  "container_port" integer,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "service_volumes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_id" uuid NOT NULL,
  "compose_volume_name" varchar(255) NOT NULL,
  "volume_name" varchar(255) NOT NULL,
  -- Only volumes we created may be deleted when the stack is removed.
  "managed" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "service_id" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "services_project_id_idx" ON "services" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_status_idx" ON "services" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_containers_service_id_idx" ON "service_containers" ("service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_containers_container_id_idx" ON "service_containers" ("container_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_volumes_service_id_idx" ON "service_volumes" ("service_id");--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_provider_id_compute_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "compute_providers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "service_containers" ADD CONSTRAINT "service_containers_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "service_volumes" ADD CONSTRAINT "service_volumes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
