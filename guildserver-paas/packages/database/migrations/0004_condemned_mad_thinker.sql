DO $$ BEGIN
 CREATE TYPE "crypto_payment_status" AS ENUM('awaiting_payment', 'detected', 'confirming', 'confirmed', 'underpaid', 'expired', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "payment_provider" AS ENUM('stripe', 'flutterwave', 'crypto');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "payment_transaction_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'canceled', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crypto_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_transaction_id" uuid,
	"status" "crypto_payment_status" DEFAULT 'awaiting_payment' NOT NULL,
	"chain_id" integer NOT NULL,
	"token_symbol" varchar(20) NOT NULL,
	"token_contract_address" varchar(255),
	"token_decimals" integer DEFAULT 18 NOT NULL,
	"receiving_address" varchar(255) NOT NULL,
	"payer_address" varchar(255),
	"expected_amount" numeric NOT NULL,
	"usd_equivalent_cents" integer NOT NULL,
	"tx_hash" varchar(255),
	"confirmations" integer DEFAULT 0,
	"required_confirmations" integer DEFAULT 12,
	"expires_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid,
	"provider" "payment_provider" NOT NULL,
	"status" "payment_transaction_status" DEFAULT 'pending' NOT NULL,
	"purpose" varchar(100) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"flutterwave_tx_ref" varchar(255),
	"flutterwave_tx_id" varchar(255),
	"payment_method_detail" varchar(100),
	"crypto_payment_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"failure_reason" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ALTER COLUMN "stripe_payment_method_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "provider" "payment_provider" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "flutterwave_tx_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "provider" "payment_provider" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "flutterwave_card_token" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "flutterwave_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "wallet_address" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "wallet_chain_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crypto_payments_org_id_idx" ON "crypto_payments" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crypto_payments_tx_hash_idx" ON "crypto_payments" ("tx_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crypto_payments_status_idx" ON "crypto_payments" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_org_id_idx" ON "payment_transactions" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_provider_idx" ON "payment_transactions" ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_flutterwave_tx_ref_idx" ON "payment_transactions" ("flutterwave_tx_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_status_idx" ON "payment_transactions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_methods_provider_idx" ON "payment_methods" ("provider");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crypto_payments" ADD CONSTRAINT "crypto_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crypto_payments" ADD CONSTRAINT "crypto_payments_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
