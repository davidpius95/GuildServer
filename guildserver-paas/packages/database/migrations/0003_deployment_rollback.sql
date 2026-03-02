-- Phase 3: Add rollback support columns to deployments table
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "image_tag" text;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "deployment_type" varchar(50) DEFAULT 'standard';
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "triggered_by" varchar(255);
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "source_deployment_id" uuid;
