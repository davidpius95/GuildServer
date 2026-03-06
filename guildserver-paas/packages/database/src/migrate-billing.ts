import dotenv from "dotenv";
dotenv.config();

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = postgres(connectionString, { max: 1 });

async function migrateBilling() {
  console.log("🔄 Running billing schema migration...\n");

  try {
    // Create enums
    console.log("Creating enums...");
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "plan_slug" AS ENUM('hobby', 'pro', 'enterprise');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled', 'paused', 'incomplete');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        CREATE TYPE "invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log("  ✅ Enums created\n");

    // Create plans table
    console.log("Creating plans table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar(255) NOT NULL,
        "slug" "plan_slug" NOT NULL,
        "description" text,
        "price_monthly" integer,
        "price_yearly" integer,
        "stripe_price_id_monthly" varchar(255),
        "stripe_price_id_yearly" varchar(255),
        "limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "features" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "plans_slug_unique" UNIQUE("slug")
      );
    `);
    console.log("  ✅ plans table created\n");

    // Create subscriptions table
    console.log("Creating subscriptions table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "plan_id" uuid NOT NULL,
        "status" "subscription_status" DEFAULT 'active' NOT NULL,
        "stripe_customer_id" varchar(255),
        "stripe_subscription_id" varchar(255),
        "current_period_start" timestamp,
        "current_period_end" timestamp,
        "cancel_at_period_end" boolean DEFAULT false,
        "trial_start" timestamp,
        "trial_end" timestamp,
        "seats" integer DEFAULT 1,
        "usage_credit_cents" integer DEFAULT 0,
        "spend_limit_cents" integer,
        "metadata" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);
    console.log("  ✅ subscriptions table created\n");

    // Create invoices table
    console.log("Creating invoices table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "invoices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "subscription_id" uuid,
        "stripe_invoice_id" varchar(255),
        "number" varchar(100),
        "status" "invoice_status" DEFAULT 'draft',
        "amount_due_cents" integer DEFAULT 0,
        "amount_paid_cents" integer DEFAULT 0,
        "currency" varchar(10) DEFAULT 'usd',
        "period_start" timestamp,
        "period_end" timestamp,
        "invoice_url" text,
        "pdf_url" text,
        "paid_at" timestamp,
        "created_at" timestamp DEFAULT now()
      );
    `);
    console.log("  ✅ invoices table created\n");

    // Create usage_records table
    console.log("Creating usage_records table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "usage_records" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "metric" varchar(100) NOT NULL,
        "value" numeric DEFAULT '0' NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "reported_to_stripe" boolean DEFAULT false,
        "stripe_usage_record_id" varchar(255),
        "created_at" timestamp DEFAULT now()
      );
    `);
    console.log("  ✅ usage_records table created\n");

    // Create payment_methods table
    console.log("Creating payment_methods table...");
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "payment_methods" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" uuid NOT NULL,
        "stripe_payment_method_id" varchar(255) NOT NULL,
        "type" varchar(50) DEFAULT 'card',
        "card_brand" varchar(50),
        "card_last4" varchar(4),
        "card_exp_month" integer,
        "card_exp_year" integer,
        "is_default" boolean DEFAULT false,
        "created_at" timestamp DEFAULT now()
      );
    `);
    console.log("  ✅ payment_methods table created\n");

    // Add stripe_customer_id to organizations
    console.log("Adding stripe_customer_id to organizations...");
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" varchar(255);
      EXCEPTION
        WHEN duplicate_column THEN null;
      END $$;
    `);
    console.log("  ✅ stripe_customer_id column added\n");

    // Create indexes
    console.log("Creating indexes...");
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "invoices_org_id_idx" ON "invoices" ("organization_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "invoices_stripe_inv_idx" ON "invoices" ("stripe_invoice_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices" ("created_at");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "payment_methods_org_id_idx" ON "payment_methods" ("organization_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "subscriptions_org_id_idx" ON "subscriptions" ("organization_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "subscriptions_stripe_sub_idx" ON "subscriptions" ("stripe_subscription_id");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "usage_records_org_metric_idx" ON "usage_records" ("organization_id","metric");`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "usage_records_period_idx" ON "usage_records" ("period_start","period_end");`);
    console.log("  ✅ Indexes created\n");

    // Add foreign keys
    console.log("Adding foreign keys...");
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE no action ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await sql.unsafe(`
      DO $$ BEGIN
        ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log("  ✅ Foreign keys added\n");

    // Verify
    const result = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
      AND table_name IN ('plans','subscriptions','invoices','usage_records','payment_methods')
      ORDER BY table_name;
    `;
    console.log("📋 Billing tables in database:");
    for (const row of result) {
      console.log(`  ✅ ${row.table_name}`);
    }

    // Check organizations column
    const orgCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='organizations' AND column_name='stripe_customer_id';
    `;
    if (orgCols.length > 0) {
      console.log("  ✅ organizations.stripe_customer_id column exists");
    }

    console.log("\n🎉 Billing schema migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrateBilling();
