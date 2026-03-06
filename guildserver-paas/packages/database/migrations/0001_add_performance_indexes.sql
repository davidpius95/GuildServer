-- Performance indexes for GuildServer PaaS
-- Addresses missing indexes on foreign keys and frequently queried columns

-- Members: lookups by userId and organizationId (used in every auth check)
CREATE INDEX IF NOT EXISTS "members_user_id_idx" ON "members" ("user_id");
CREATE INDEX IF NOT EXISTS "members_organization_id_idx" ON "members" ("organization_id");
CREATE INDEX IF NOT EXISTS "members_user_org_idx" ON "members" ("user_id", "organization_id");

-- Projects: lookup by organization
CREATE INDEX IF NOT EXISTS "projects_organization_id_idx" ON "projects" ("organization_id");

-- Applications: lookup by project, filter by status
CREATE INDEX IF NOT EXISTS "applications_project_id_idx" ON "applications" ("project_id");
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "applications" ("status");

-- Databases: lookup by project
CREATE INDEX IF NOT EXISTS "databases_project_id_idx" ON "databases" ("project_id");

-- Deployments: lookup by application, filter by status, sort by created_at
CREATE INDEX IF NOT EXISTS "deployments_application_id_idx" ON "deployments" ("application_id");
CREATE INDEX IF NOT EXISTS "deployments_status_idx" ON "deployments" ("status");
CREATE INDEX IF NOT EXISTS "deployments_created_at_idx" ON "deployments" ("created_at");

-- Domains: lookup by application, lookup by domain name
CREATE INDEX IF NOT EXISTS "domains_application_id_idx" ON "domains" ("application_id");
CREATE INDEX IF NOT EXISTS "domains_domain_idx" ON "domains" ("domain");

-- Environment Variables: lookup by application
CREATE INDEX IF NOT EXISTS "env_vars_application_id_idx" ON "environment_variables" ("application_id");

-- Metrics: composite indexes for time-series queries (most critical for perf)
CREATE INDEX IF NOT EXISTS "metrics_application_id_idx" ON "metrics" ("application_id");
CREATE INDEX IF NOT EXISTS "metrics_organization_id_idx" ON "metrics" ("organization_id");
CREATE INDEX IF NOT EXISTS "metrics_timestamp_idx" ON "metrics" ("timestamp");
CREATE INDEX IF NOT EXISTS "metrics_app_name_ts_idx" ON "metrics" ("application_id", "name", "timestamp");
CREATE INDEX IF NOT EXISTS "metrics_org_name_ts_idx" ON "metrics" ("organization_id", "name", "timestamp");

-- Audit Logs: lookup by organization, sort by timestamp
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_idx" ON "audit_logs" ("organization_id");
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs" ("timestamp");
