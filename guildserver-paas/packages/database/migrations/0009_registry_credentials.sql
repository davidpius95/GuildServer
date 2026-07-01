-- Add private registry credentials to applications for pulling non-public images
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "registry_url" text;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "registry_username" text;
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "registry_password" text;
