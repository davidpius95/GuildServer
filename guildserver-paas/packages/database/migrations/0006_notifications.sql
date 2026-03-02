-- Phase 7: Notification system tables

-- Notifications table (in-app inbox)
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(100) NOT NULL,
  "title" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "metadata" jsonb DEFAULT '{}',
  "read" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON "notifications"("user_id");
CREATE INDEX IF NOT EXISTS idx_notifications_read ON "notifications"("user_id", "read");

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event" varchar(100) NOT NULL,
  "email_enabled" boolean DEFAULT true,
  "slack_enabled" boolean DEFAULT false,
  "in_app_enabled" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  UNIQUE("user_id", "event")
);

-- Slack webhook config per organization
CREATE TABLE IF NOT EXISTS "slack_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "webhook_url" text NOT NULL,
  "channel_name" varchar(255),
  "enabled" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  UNIQUE("organization_id")
);
