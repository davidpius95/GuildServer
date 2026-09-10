-- Scoped personal access tokens for the public REST API.
--
-- Additive only: one new table. Safe to apply to a live database before the
-- code that uses it ships, which is the required order on installs where
-- scripts/self-update.sh deploys code automatically but does not run
-- migrations.
--
-- Only a SHA-256 hash of each token is stored. Tokens are 32 random bytes, so
-- a slow password hash adds nothing, and an unsalted digest permits an indexed
-- equality lookup on every request. The plaintext is shown to the user once,
-- at creation, and is unrecoverable afterwards.

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- A token is bound to exactly one organization.
  "organization_id" uuid NOT NULL,
  -- The user the token acts as. Every request is authorized as this user, so
  -- losing organization membership disables the token without any extra step.
  "user_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  -- Leading characters of the token, safe to display, e.g. gs_pat_ab12cd34.
  "token_prefix" varchar(32) NOT NULL,
  "token_hash" text NOT NULL,
  -- Subset of ["read", "deploy", "write", "admin"].
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- Optional restriction to specific projects; NULL means every project the
  -- user can reach in the organization.
  "project_ids" jsonb,
  "expires_at" timestamp,
  "last_used_at" timestamp,
  "last_used_ip" varchar(64),
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "api_tokens_organization_id_idx" ON "api_tokens" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_user_id_idx" ON "api_tokens" ("user_id");--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
