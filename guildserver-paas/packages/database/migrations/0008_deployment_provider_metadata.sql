-- Migration: Add provider metadata to deployments table
-- Stores the Proxmox LXC VMID and other provider-specific info per deployment
-- so we can look up the workload without scanning all LXCs by hostname.

ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "provider_id" uuid REFERENCES "compute_providers"("id") ON DELETE SET NULL;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "lxc_vm_id" integer;
ALTER TABLE "deployments" ADD COLUMN IF NOT EXISTS "provider_metadata" jsonb;
