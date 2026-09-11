-- Cloudflare for SaaS: track the Custom Hostname ID and last-known status from
-- Cloudflare's API so we can verify, update, and clean up custom hostnames.
-- Additive migration — safe to apply before the code that uses the columns.

ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "cf_custom_hostname_id" varchar(64);
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "cf_custom_hostname_status" varchar(32);
