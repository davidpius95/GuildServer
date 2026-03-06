-- Phase 5: Webhook delivery tracking
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" uuid REFERENCES "applications"("id") ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_app ON "webhook_deliveries"("application_id");
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON "webhook_deliveries"("created_at" DESC);
