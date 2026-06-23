-- BaaS tables: fleet nodes, projects, backups, custom hostnames
-- Idempotent — safe to run on a hand-managed prod database

-- ENUMs

DO $$ BEGIN
  CREATE TYPE "product" AS ENUM ('paas', 'baas');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "baas_project_status" AS ENUM ('provisioning', 'active', 'paused', 'error', 'deleting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "baas_node_role" AS ENUM ('edge', 'compute', 'storage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "baas_node_status" AS ENUM ('online', 'offline', 'maintenance', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add product column to organizations

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "product" "product" DEFAULT 'paas';

-- Fleet node registry

CREATE TABLE IF NOT EXISTS "baas_nodes" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"             varchar(255) NOT NULL,
  "hostname"         varchar(255) NOT NULL,
  "internal_ip"      inet NOT NULL,
  "external_ip"      inet,
  "role"             "baas_node_role" NOT NULL DEFAULT 'compute',
  "status"           "baas_node_status" NOT NULL DEFAULT 'offline',

  "vcpu_total"       integer NOT NULL,
  "ram_mb_total"     integer NOT NULL,
  "storage_gb_total" integer NOT NULL,

  "vcpu_used"        integer DEFAULT 0,
  "ram_mb_used"      integer DEFAULT 0,
  "storage_gb_used"  integer DEFAULT 0,

  "ssh_user"         varchar(64) DEFAULT 'root',
  "ssh_port"         integer DEFAULT 22,
  "ssh_private_key"  text,

  "provider_id"      uuid REFERENCES "compute_providers"("id") ON DELETE SET NULL,

  "pod_name"         varchar(128),
  "location"         varchar(255),

  "last_heartbeat"   timestamp,
  "metadata"         jsonb DEFAULT '{}',
  "created_at"       timestamp DEFAULT now(),
  "updated_at"       timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "baas_nodes_status_idx" ON "baas_nodes"("status");
CREATE INDEX IF NOT EXISTS "baas_nodes_role_idx"   ON "baas_nodes"("role");

-- BaaS projects (one complete Supabase stack per project)

CREATE TABLE IF NOT EXISTS "baas_projects" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                  varchar(255) NOT NULL,
  "slug"                  varchar(255) NOT NULL UNIQUE,
  "organization_id"       uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,

  "node_id"               uuid REFERENCES "baas_nodes"("id") ON DELETE SET NULL,

  "db_password"           text NOT NULL,
  "jwt_secret"            text NOT NULL,
  "anon_key"              text NOT NULL,
  "service_role_key"      text NOT NULL,

  "db_host"               varchar(255),
  "db_port"               integer DEFAULT 5432,
  "db_name"               varchar(255) NOT NULL,
  "db_user"               varchar(255) NOT NULL,

  "api_url"               text,
  "realtime_url"          text,
  "storage_url"           text,
  "studio_url"            text,

  "host_port_base"        integer,

  "vcpu_limit"            decimal DEFAULT 1,
  "ram_mb_limit"          integer DEFAULT 2048,
  "storage_gb_limit"      integer DEFAULT 8,

  "status"                "baas_project_status" DEFAULT 'provisioning',
  "status_message"        text,
  "container_ids"         jsonb DEFAULT '{}',

  "backup_enabled"        boolean DEFAULT true,
  "backup_retention_days" integer DEFAULT 7,

  "created_at"            timestamp DEFAULT now(),
  "updated_at"            timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "baas_projects_org_id_idx"  ON "baas_projects"("organization_id");
CREATE INDEX IF NOT EXISTS "baas_projects_node_id_idx" ON "baas_projects"("node_id");
CREATE INDEX IF NOT EXISTS "baas_projects_status_idx"  ON "baas_projects"("status");

-- BaaS backups

CREATE TABLE IF NOT EXISTS "baas_backups" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"   uuid NOT NULL REFERENCES "baas_projects"("id") ON DELETE CASCADE,
  "status"       "backup_status" DEFAULT 'pending',
  "backup_type"  varchar(20) DEFAULT 'automatic',
  "size_bytes"   integer DEFAULT 0,
  "file_path"    text,
  "error"        text,
  "started_at"   timestamp DEFAULT now(),
  "completed_at" timestamp,
  "expires_at"   timestamp,
  "created_at"   timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "baas_backups_project_id_idx" ON "baas_backups"("project_id");
CREATE INDEX IF NOT EXISTS "baas_backups_status_idx"     ON "baas_backups"("status");

-- BaaS custom hostnames (Cloudflare for SaaS)

CREATE TABLE IF NOT EXISTS "baas_custom_hostnames" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"              uuid NOT NULL REFERENCES "baas_projects"("id") ON DELETE CASCADE,
  "hostname"                varchar(255) NOT NULL UNIQUE,

  "cf_custom_hostname_id"   varchar(255),
  "cf_ownership_txt_name"   text,
  "cf_ownership_txt_value"  text,
  "cf_ssl_status"           varchar(64),

  "status"                  "domain_status" DEFAULT 'pending',
  "verified"                boolean DEFAULT false,

  "created_at"              timestamp DEFAULT now(),
  "updated_at"              timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "baas_custom_hostnames_project_id_idx" ON "baas_custom_hostnames"("project_id");
