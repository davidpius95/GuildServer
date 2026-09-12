-- Which GitHub App installation belongs to which organization.
--
-- One App serves every tenant, so a customer installs it on their own GitHub
-- account and GuildServer records the installation against their organization.
-- Deploys then clone with a credential that belongs to the installation rather
-- than to whoever connected the repository, and nothing has to be configured
-- per tenant by an operator.
--
-- Additive; safe to apply before the code that uses it. With no rows, deploys
-- behave exactly as they do today (the connecting user's OAuth token).

CREATE TABLE IF NOT EXISTS "github_installations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  -- GitHub's numeric installation id.
  "installation_id" bigint NOT NULL,
  -- The account the App is installed on (user or organisation login).
  "account_login" varchar(255) NOT NULL,
  "account_type" varchar(32),
  -- "all" or "selected": what the installer granted.
  "repository_selection" varchar(32),
  -- Who connected it, for an audit trail. Kept if that user is later removed.
  "installed_by_user_id" uuid,
  "suspended_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- One row per installation; re-installing updates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_installation_id_idx"
  ON "github_installations" ("installation_id");
CREATE INDEX IF NOT EXISTS "github_installations_organization_id_idx"
  ON "github_installations" ("organization_id");

DO $$ BEGIN
  ALTER TABLE "github_installations"
    ADD CONSTRAINT "github_installations_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "github_installations"
    ADD CONSTRAINT "github_installations_installed_by_user_id_fk"
    FOREIGN KEY ("installed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
