DO $$ BEGIN
 CREATE TYPE "certificate_status" AS ENUM('pending', 'provisioning', 'active', 'renewal', 'failed', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "domain_status" AS ENUM('pending', 'verifying', 'active', 'failed', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "env_scope" AS ENUM('production', 'preview', 'development');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "plan_slug" AS ENUM('hobby', 'pro', 'enterprise');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "provider_status" AS ENUM('pending', 'connected', 'error', 'disabled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "provider_type" AS ENUM('docker-local', 'docker-remote', 'proxmox', 'kubernetes', 'aws-ecs', 'gcp-cloudrun', 'azure-aci', 'hetzner', 'digitalocean');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled', 'paused', 'incomplete');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"certificate_chain" text,
	"private_key" text,
	"issuer" varchar(255) DEFAULT 'lets-encrypt',
	"status" "certificate_status" DEFAULT 'pending',
	"issued_at" timestamp,
	"expires_at" timestamp,
	"last_renewal_at" timestamp,
	"auto_renew" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compute_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "provider_type" NOT NULL,
	"organization_id" uuid,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" varchar(100),
	"is_default" boolean DEFAULT false,
	"status" "provider_status" DEFAULT 'pending',
	"last_health_check" timestamp,
	"health_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(255) NOT NULL,
	"application_id" uuid,
	"is_primary" boolean DEFAULT false,
	"is_auto_generated" boolean DEFAULT false,
	"verification_token" varchar(255),
	"verification_method" varchar(50) DEFAULT 'cname',
	"verified" boolean DEFAULT false,
	"status" "domain_status" DEFAULT 'pending',
	"certificate_id" uuid,
	"force_https" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "environment_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"scope" "env_scope" DEFAULT 'production',
	"is_secret" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" varchar(100) NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"slack_enabled" boolean DEFAULT false,
	"in_app_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scope" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slack_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"webhook_url" text NOT NULL,
	"channel_name" varchar(255),
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"provider" varchar(50) NOT NULL,
	"event_type" varchar(100),
	"payload" jsonb,
	"headers" jsonb,
	"status_code" integer,
	"response" text,
	"delivered" boolean DEFAULT false,
	"error" text,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "container_port" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "main_branch" varchar(255) DEFAULT 'main';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_ttl_hours" integer DEFAULT 72;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deployment_target" varchar(50) DEFAULT 'docker-local';--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "image_tag" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "deployment_type" varchar(50) DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "triggered_by" varchar(255);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "source_deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "is_preview" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "preview_branch" varchar(255);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "lxc_vm_id" integer;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compute_providers_organization_id_idx" ON "compute_providers" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compute_providers_type_idx" ON "compute_providers" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compute_providers_default_idx" ON "compute_providers" ("organization_id","is_default");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_application_id_idx" ON "domains" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "domains_domain_idx" ON "domains" ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "env_vars_application_id_idx" ON "environment_variables" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_org_id_idx" ON "invoices" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_stripe_inv_idx" ON "invoices" ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_read" ON "notifications" ("user_id","read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_accounts_user_id_idx" ON "oauth_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_accounts_provider_account_idx" ON "oauth_accounts" ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_methods_org_id_idx" ON "payment_methods" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_org_id_idx" ON "subscriptions" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_sub_idx" ON "subscriptions" ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_org_metric_idx" ON "usage_records" ("organization_id","metric");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_period_idx" ON "usage_records" ("period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_app" ON "webhook_deliveries" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_created" ON "webhook_deliveries" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_project_id_idx" ON "applications" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "applications" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_provider_id_idx" ON "applications" ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_idx" ON "audit_logs" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs" ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "databases_project_id_idx" ON "databases" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_application_id_idx" ON "deployments" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_status_idx" ON "deployments" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_created_at_idx" ON "deployments" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_user_id_idx" ON "members" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_organization_id_idx" ON "members" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "members_user_org_idx" ON "members" ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_application_id_idx" ON "metrics" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_organization_id_idx" ON "metrics" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_timestamp_idx" ON "metrics" ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_app_name_ts_idx" ON "metrics" ("application_id","name","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_org_name_ts_idx" ON "metrics" ("organization_id","name","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_organization_id_idx" ON "projects" ("organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_provider_id_compute_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "compute_providers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deployments" ADD CONSTRAINT "deployments_provider_id_compute_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "compute_providers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compute_providers" ADD CONSTRAINT "compute_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domains" ADD CONSTRAINT "domains_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slack_configs" ADD CONSTRAINT "slack_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
