-- Organization-wide notification channels, and a per-channel delivery log.
--
-- Additive; safe to apply to a live database before the code that uses it.
-- slack_configs stays: the per-user Slack preference still reads it.

CREATE TABLE IF NOT EXISTS "notification_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  -- email | webhook | discord | slack | telegram, validated by the API.
  "type" varchar(32) NOT NULL,
  -- Non-secret settings: email recipients, Telegram chat id.
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Encrypted JSON (utils/crypto encryptSecret): webhook URL, bot token,
  -- signing secret. Never returned to clients.
  "secret" text,
  -- Names of the events this channel receives.
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_delivery_at" timestamp,
  "last_delivery_ok" boolean,
  "last_error" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notification_channels_organization_id_idx" ON "notification_channels" ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel_id" uuid NOT NULL,
  "event" varchar(100) NOT NULL,
  -- "<event>:<id of what happened>". Unique per channel, so an event reported
  -- twice (a retried job, two code paths) is delivered once.
  "dedupe_key" varchar(255) NOT NULL,
  -- pending | sent | failed
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now(),
  "delivered_at" timestamp
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_channel_dedupe_idx" ON "notification_deliveries" ("channel_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_created_at_idx" ON "notification_deliveries" ("created_at");--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
