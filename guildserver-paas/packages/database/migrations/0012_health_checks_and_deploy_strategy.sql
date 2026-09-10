-- Configurable health checks and rolling deployments.
--
-- Every column is nullable and additive: this migration is safe to apply to a
-- running production database BEFORE the code that reads these columns is
-- deployed, which is the required order on installs where
-- scripts/self-update.sh ships code automatically but does not run migrations.
--
-- NULL means "use the previous built-in behaviour" throughout, so existing
-- applications keep deploying exactly as they did before.

-- How the deployment replaces the running container.
--   'recreate' — stop the old container, then start the new one (legacy behaviour)
--   'rolling'  — start the candidate alongside, health-check it, then switch
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deployment_strategy varchar(20);

-- HTTP path probed to decide whether a candidate container is healthy.
-- NULL falls back to the existing reachability probe (HTTP GET / then raw TCP).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_path text;

-- Port to probe. NULL means "the resolved service port".
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_port integer;

-- Seconds between probes.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_interval integer;

-- Seconds a single probe may take before it counts as a failure.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_timeout integer;

-- Consecutive failures tolerated before the candidate is declared unhealthy.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_retries integer;

-- Grace period after container start before failures are counted, for apps
-- with slow boots (migrations, JIT warmup).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_start_period integer;

-- Comma-separated HTTP status codes or ranges treated as healthy, e.g.
-- '200-299,401'. An app behind auth legitimately answers 401 on / and was
-- previously indistinguishable from a broken one.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS health_check_expected_status text;

-- Seconds to wait for the outgoing container to exit cleanly before SIGKILL,
-- so in-flight requests and shutdown hooks can finish.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS stop_grace_period integer;

-- Records which container is serving and which is being promoted, so a
-- deployment interrupted mid-switch can be reconciled rather than leaving two
-- live containers fighting over one Traefik router.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS candidate_container_id text;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS previous_container_id text;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS strategy varchar(20);
