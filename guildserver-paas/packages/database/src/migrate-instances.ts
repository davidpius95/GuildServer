import dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = postgres(connectionString, { max: 1 });

/**
 * Adds the VPS instance catalog (instance_types) and provisioned instances
 * tables, plus the new "starter" PaaS plan tier. Idempotent — safe to re-run.
 */
async function migrateInstances() {
  console.log("🔄 Running VPS / pricing schema migration...\n");

  try {
    // Add the "starter" PaaS plan tier (idempotent).
    console.log("Adding 'starter' plan tier...");
    await sql.unsafe(`ALTER TYPE "plan_slug" ADD VALUE IF NOT EXISTS 'starter';`);

    console.log("Creating instance enums...");
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "instance_family" AS ENUM('shared', 'dedicated');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "instance_status" AS ENUM('pending', 'provisioning', 'active', 'stopped', 'error', 'terminated');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    console.log("Creating instance_types table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "instance_types" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "slug" varchar(64) NOT NULL UNIQUE,
        "name" varchar(255) NOT NULL,
        "family" "instance_family" NOT NULL,
        "description" text,
        "vcpu" numeric NOT NULL,
        "ram_mb" integer NOT NULL,
        "storage_gb" integer NOT NULL,
        "transfer_tb" integer NOT NULL,
        "price_monthly" integer NOT NULL,
        "price_hourly_micro" integer NOT NULL,
        "stripe_price_id_monthly" varchar(255),
        "stripe_price_id_hourly" varchar(255),
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    console.log("Creating instances table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "instances" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar(255) NOT NULL,
        "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
        "instance_type_id" uuid REFERENCES "instance_types"("id") ON DELETE RESTRICT,
        "provider_id" uuid REFERENCES "compute_providers"("id") ON DELETE SET NULL,
        "region" varchar(64) DEFAULT 'default',
        "billing_period" varchar(16) DEFAULT 'monthly',
        "extra_storage_gb" integer DEFAULT 0,
        "backups_enabled" boolean DEFAULT false,
        "status" "instance_status" DEFAULT 'pending',
        "hostname" varchar(255),
        "ipv4" inet,
        "status_message" text,
        "vmid" integer,
        "node" varchar(128),
        "stripe_subscription_id" varchar(255),
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);
    // Columns added after the initial table release (idempotent for existing installs)
    await sql.unsafe(`ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "vmid" integer;`);
    await sql.unsafe(`ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "node" varchar(128);`);
    await sql.unsafe(`ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255);`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "instances_organization_id_idx" ON "instances" ("organization_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "instances_status_idx" ON "instances" ("status");`);

    console.log("\n✅ VPS / pricing schema migration completed successfully");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrateInstances();
