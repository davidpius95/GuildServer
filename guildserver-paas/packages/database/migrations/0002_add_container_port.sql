-- Add container_port column to applications table
-- Allows templates to specify the internal port the container listens on
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "container_port" integer;
