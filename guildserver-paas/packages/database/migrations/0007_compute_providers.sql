-- Phase 1: Multi-Cloud Infrastructure — Compute Providers
-- Adds provider abstraction layer for deploying to Docker, Proxmox, K8s, AWS, GCP, etc.

-- Provider type enum
DO $$ BEGIN
  CREATE TYPE "provider_type" AS ENUM (
    'docker-local',
    'docker-remote',
    'proxmox',
    'kubernetes',
    'aws-ecs',
    'gcp-cloudrun',
    'azure-aci',
    'hetzner',
    'digitalocean'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Provider status enum
DO $$ BEGIN
  CREATE TYPE "provider_status" AS ENUM (
    'pending',
    'connected',
    'error',
    'disabled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Compute providers table
CREATE TABLE IF NOT EXISTS "compute_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "type" "provider_type" NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL DEFAULT '{}',
  "region" varchar(100),
  "is_default" boolean DEFAULT false,
  "status" "provider_status" DEFAULT 'pending',
  "last_health_check" timestamp,
  "health_message" text,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- Indexes for compute_providers
CREATE INDEX IF NOT EXISTS "compute_providers_organization_id_idx" ON "compute_providers"("organization_id");
CREATE INDEX IF NOT EXISTS "compute_providers_type_idx" ON "compute_providers"("type");
CREATE INDEX IF NOT EXISTS "compute_providers_default_idx" ON "compute_providers"("organization_id", "is_default");

-- Add provider columns to applications table
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "provider_id" uuid REFERENCES "compute_providers"("id") ON DELETE SET NULL;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "deployment_target" varchar(50) DEFAULT 'docker-local';

-- Index for provider_id on applications
CREATE INDEX IF NOT EXISTS "applications_provider_id_idx" ON "applications"("provider_id");
