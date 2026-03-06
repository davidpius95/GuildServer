-- Phase 4: Add preview deployment support
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "is_preview" boolean DEFAULT false;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "preview_branch" varchar(255);
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "main_branch" varchar(255) DEFAULT 'main';
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "preview_ttl_hours" integer DEFAULT 72;
