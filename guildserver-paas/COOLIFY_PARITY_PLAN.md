# GuildServer ← Coolify parity programme: implementation plan

**Status:** executed. See "Execution status" below (updated 2026-09-12); the rest of this
document is the original plan, kept for reference.

## Execution status (2026-09-11)

| ID | State | How it is proven |
|---|---|---|
| W0 | CI gates every production deploy (`GUILDSERVER_REQUIRE_CI=enforce`): lint, zero type errors in api and web (baselines 0; the web build no longer ignores type or lint errors), backend (1,216 tests against real Postgres, Redis, MinIO), frontend (77). End-to-end (Playwright: register, sign in/out, every dashboard page renders without errors) against a real API, web app, Postgres and Redis. | CI on every push to `main` |
| W1 | Rolling deploys with health gate, overlap/serial promotion, per-router retry middleware and a 2s Traefik dial timeout. Off unless `GS_ZERO_DOWNTIME=1`; apps with persistent storage stay on recreate unless `GS_ZERO_DOWNTIME_SHARED_VOLUME=1`. | `docker-acceptance.yml`: a swap under continuous load behind real Traefik returns no non-2xx; an unhealthy candidate leaves the old version serving |
| W2 | Compose stacks (API, UI, deploy, logs, status, delete). | `docker-acceptance.yml`: web + Postgres + Redis stack deploys, keeps data across redeploy, deletes only its own resources |
| W3 | 302 Coolify templates imported; 192 passed the deployment gate on scratch runners; 182 offered in the One-click services catalogue (the rest need `cap_add`, `security_opt`, a fixed `container_name`, or have an unparseable port). | `verify-templates.yml` (weekly); a unit test plans every offered template |
| W4 | REST API v1 with scoped, revocable tokens. | router and isolation tests |
| W5 | S3-compatible off-site database backups with verified round trip. | tests against MinIO in CI |
| W6 | Disk report, cleanup (dry run by default, re-checked against a fresh plan, never volumes or containers) and an admin UI card. | unit tests with a Docker client that fails on any other call |
| W7 | Notification channels (Slack, Discord, webhook, Telegram, email) and log drains. | router, provider and shipper tests |
| W8 | Remote Docker hosts over SSH with pinned host keys. | provider and router tests |

Off-site database backups were verified on production on 2026-09-12 in the same way: MinIO
deployed as a Compose stack on a public hostname, backup storage pointed at it (its own
write/read/delete test passing), a PostgreSQL database provisioned, and a manual backup
completed and uploaded — 882 bytes with a recorded checksum and a remote key in the bucket.
Two bugs that only a live check could find were fixed on the way: a database was reported
"running" the moment its container started, so a backup taken seconds later failed with
`database "..." does not exist`; and the off-site upload decision read a snapshot of the
database row taken before the dump, so storage attached while a backup was queued was
silently ignored and the backup stayed on this host.

Verified on production (guild-technologies.com) on 2026-09-12 with a throwaway labelled
account, then cleaned up: sign-up, deploying an application from an image on its auto URL,
webhook notification channels, log drains, REST API tokens and their revocation, a one-click
catalogue deploy (Uptime Kuma answering on its routed URL) and a hand-written Compose stack
answering on its domain. Rolling deploys are enabled in production (`GS_ZERO_DOWNTIME=1`).

The per-workstream feature flags proposed below were not all needed: only `GS_ZERO_DOWNTIME`
exists, because the other workstreams are additive and invisible until used.

Problems found and fixed along the way: jsonb values were stored as JSON strings (drizzle 0.29;
fixed by drizzle 0.45.2 and a batched backfill of 7.9M production rows); 307 type errors (0 now,
several of them real bugs); a GitHub connection that GitHub had revoked still showed "Connected"
(the settings page now detects it and offers Reconnect); metrics retention never ran (now nightly,
30 days).

GitHub App repository access is implemented and self-service (2026-09-12). One App serves every
tenant: a customer installs it on their own GitHub account from Settings, and the installation is
recorded against their organization, so deploys use a credential belonging to the installation
rather than to whoever connected the repository and keep working after that person revokes access
or leaves. Nothing is configured per tenant by an operator.

The tenant boundary is explicit, because one App could otherwise widen what a tenant can reach: an
installation token is only ever used for a repository the deploying user can read with their own
GitHub identity; an installation recorded by one organization is never offered to another; the
post-install redirect carries no identity, so without a valid, unredeemed nonce the callback
records nothing rather than guessing an owner; and a webhook never moves an installation between
organizations. Uninstall, suspend and repository-scope changes are handled. Where no App is
configured, none is installed for a repository, or GitHub refuses, deploys fall back to the user's
OAuth token exactly as before. See docs/github-app.md.

Not built, and shown as such rather than hidden: Kubernetes (the provider reports itself
unimplemented, its workflow template is labelled Experimental) and SSO ("coming soon" on billing
and pricing). Nothing else from this plan is outstanding.
**Author:** Claude Opus 5, 9 September 2026
**Worktree:** `Davidcode/guildserver-coolify-gaps-0978cc` @ `306545a`
**Source of requirements:** the GuildServer vs Coolify gap analysis dated 9 September 2026.

---

## 0. Two findings that reshape the request

### 0.1 Coolify's code cannot be copied into GuildServer

The request was "copy the code, it's open source." That is licence-legal but technically not
available:

| | Coolify | GuildServer |
|---|---|---|
| Licence | Apache-2.0 (verified via GitHub API) | proprietary |
| Language | **PHP** (verified: `"language": "PHP"`) | TypeScript |
| Framework | Laravel 11 + Livewire + Blade | Next.js 15 + Express + tRPC |
| ORM | Eloquent, MySQL/Postgres | Drizzle, Postgres |
| Async | Laravel Queues + Horizon | BullMQ + Redis |
| Remote exec | `spatie/ssh` shell strings | `dockerode` + `ssh2` |

There is no file in `coollabsio/coolify` that can be dropped into `apps/api/src`. What we can
take, and what I plan to take, splits into three buckets:

- **Verbatim-copyable data assets (Apache-2.0, attribution required).** The ~371 Docker Compose
  service definitions under `templates/compose/`. These are YAML, not PHP, and are the single
  highest-value copyable asset in the repository. Copying them requires we ship an `Apache-2.0`
  `NOTICE` file crediting coollabsio and retain their licence text for that subtree.
- **Portable logic and conventions.** Compose parsing/normalisation rules, Traefik label
  generation, container naming and label taxonomy, the deployment-queue state machine, the
  disk-cleanup thresholds, health-check semantics, backup command construction per engine. These
  are read-then-reimplement-in-TypeScript, not copy.
- **Not worth taking.** Livewire UI, Laravel-specific plumbing, their server-provisioning shell
  scripts (our Proxmox path is better and is our differentiator).

I will keep a `docs/attribution/coolify.md` recording exactly which artefacts were copied and
which were reimplemented from reading, so the provenance is auditable.

### 0.2 This machine is production

This is not a dev box with a copy of the app. Verified:

- `docker ps` on this host runs `guildserver-traefik`, `guildserver-api`, `guildserver-web`,
  `guildserver-postgres`, and **live customer workloads** including
  `gs-daily-habit-tracker-app-beabc5c7`, `gs-db-223abf8c-1ab`, two n8n containers, and
  `guildpay-api`.
- `guildserver-api` compose labels resolve to
  `/home/usher-node/GuildServer/guildserver-paas/docker-compose.prod.yml`.
- `https://guild-technologies.com/health` → `{"status":"healthy","environment":"production"}`.
- `crontab -l` → `*/5 * * * * … guildserver-self-update.sh`, i.e. **any merge to `origin/main`
  is on production within five minutes, unattended, with no human gate.**

Two consequences I am treating as hard constraints:

1. **Docker integration tests are dangerous by default.** Our own code paths call
   `removeExistingContainers()` and `listContainers({filters:{label:[gs.managed=true]}})`. A
   careless integration test on this daemon can stop a paying customer's app. Every test agent
   gets a mandatory namespace guard (§4.3) and no agent may run destructive Docker calls outside
   a `gs.test-run=<uuid>` label scope.
2. **"Merge and push to production" is a live-fire action.** I will do it, because you asked, but
   in small reversible waves behind flags, each with a post-deploy smoke gate and a scripted
   rollback (§6), never as one big-bang merge at the end.

---

## 1. Scope: what we are building

Ordered by the gap analysis's own P0/P1/P2, adjusted for the two findings above. Nine
workstreams. Each is independently shippable and independently revertible.

| ID | Workstream | Gap addressed | Ships behind flag |
|---|---|---|---|
| W0 | Test & safety harness | prerequisite for everything | n/a |
| W1 | Zero-downtime deploys + configurable health checks | "Weak"/"Weak" | `GS_ZERO_DOWNTIME` |
| W2 | Docker Compose as a first-class resource | **"Absent"** — largest product gap | `GS_COMPOSE` |
| W3 | Service catalogue from Coolify templates | "Weak" (72 shallow → real stacks) | `GS_CATALOG_V2` |
| W4 | Public REST API + scoped tokens | "Weak" | additive, no flag |
| W5 | S3 off-site backups (DB + volumes) | "Adequate"/"Absent" | `GS_S3_BACKUPS` |
| W6 | Server disk safety & deployment-aware cleanup | "Weak" | `GS_CLEANUP` (dry-run first) |
| W7 | Notification matrix + log drains | "Weak"/"Absent" | additive |
| W8 | Remote Docker provider (SSH) | **"Absent"** — factory throws today | `GS_REMOTE_DOCKER` |

Explicitly **out of scope** for this programme, and I want that on the record rather than
silently dropped: browser terminal (W-later; needs an auth/audit design of its own), Docker Swarm,
real Kubernetes (today's router returns `mockStatus`/`mockMetrics` — I propose we *label it
experimental in the UI* as a one-line honesty fix rather than build it), and production SSO
(`enterprise-auth.ts` is explicitly mock; same treatment).

---

## 2. Workstream detail

Each entry gives the concrete files, the design decision, and the acceptance test. File paths are
real and were read during recon.

### W0 — Test & safety harness (blocks everything else)

**Why first:** `apps/api` has 29 test files, all unit-level with mocked `dockerode`.
`apps/web/package.json` `test` is literally `echo "No tests configured" && exit 0`. There is a
`playwright.config.ts` but the E2E job in CI has never had a real suite behind it. We cannot
"test every feature we add" on that base.

- `apps/api/tests/helpers/docker-sandbox.ts` — **new.** Allocates a per-run
  `gs.test-run=<uuid>` label, a dedicated `gs-test-<uuid>` bridge network, and a
  `withSandbox()` wrapper that (a) refuses to run if `GS_ALLOW_DOCKER_TESTS !== "1"`, (b) asserts
  every container it touches carries its own run label, (c) tears down only by that label, and
  (d) has an `afterAll` reaper. **This is the guard that keeps customer containers alive.**
- `apps/api/tests/integration/*.int.test.ts` — real-daemon suites, `jest --selectProjects
  integration`, opt-in only.
- `apps/web/jest.config.js` + first component tests; replace the fake `test` script.
- `apps/web/tests/e2e/` — Playwright specs against a locally-composed stack, not production.
- `scripts/prod-smoke.sh` — **new.** Read-only production verification: `/health`, tRPC
  `application.list` with a scoped token, Traefik router presence, the habit-tracker URL returning
  200. Used as the post-deploy gate in §6.
- `.github/workflows/test.yml` — add an `integration-tests` job on an ephemeral runner (safe:
  not this host), and make `frontend-tests` actually fail on failure.

**Acceptance:** `pnpm test` fails if any suite fails; `GS_ALLOW_DOCKER_TESTS=1 pnpm test:int`
passes on a scratch daemon; running it here with the guard off exits non-zero without touching
Docker; `scripts/prod-smoke.sh` passes against current production.

### W1 — Zero-downtime deployment + health checks

**The defect, precisely:** `apps/api/src/services/docker/container.ts:180` calls
`removeExistingContainers()` *before* `createContainer()` at line ~295. The old container is gone
before the new one exists. Every deploy is a hard outage window.

**Design (ported from Coolify's rolling-update semantics, reimplemented):**
1. Create the new container with the same labels but `gs.role=candidate` and **no** Traefik
   router labels.
2. Poll the configured health check against the candidate's host port until pass/timeout.
3. On pass: add Traefik labels to the candidate — since Traefik reads Docker labels live, this
   requires a container recreate, so instead we **assign both containers to the same Traefik
   service name** and remove the old container's labels by stopping it, giving a sub-second
   switch. (Alternative considered: Traefik file-provider dynamic config, which gives a true
   0-second switch but adds a shared-volume dependency. I will prototype label-swap first and
   escalate to file-provider only if the measured gap exceeds ~1s.)
4. On fail: destroy the candidate, leave the incumbent serving, mark the deployment failed with
   the candidate's logs. **This alone converts today's "failed deploy = outage" into "failed
   deploy = no-op".**

- Schema: `applications` gains `healthCheckPath`, `healthCheckPort`, `healthCheckInterval`,
  `healthCheckTimeout`, `healthCheckRetries`, `healthCheckStartPeriod`, `healthCheckExpectedStatus`,
  `stopGracePeriod`, `deploymentStrategy` (`recreate` | `rolling`). New migration in
  `packages/database/migrations/`.
- `apps/api/src/services/docker/container.ts` — split `deployContainer` into
  `createCandidate` / `promoteCandidate` / `retireIncumbent`.
- `apps/api/src/services/docker/health.ts` — extend the existing 216-line module to honour the new
  fields instead of its current fixed behaviour.
- Web: health-check fields on the app settings page; strategy selector.

**Acceptance:** integration test deploys app v1, starts a 200-req/s loop, deploys v2, asserts
**zero non-2xx responses**; a second test deploys a deliberately-crashing v2 and asserts v1 still
serves and the deployment is marked failed.

### W2 — Docker Compose as a first-class resource

The single biggest gap. Today a user cannot deploy web + worker + db + queue as one thing.

- Schema: new `services` table (a Compose stack), `serviceContainers` (per-service child rows),
  `serviceVolumes`. `deployments` gains a nullable `serviceId` so stack deploys reuse the existing
  queue, history, logs, and rollback machinery rather than growing a parallel one.
- `apps/api/src/services/compose/parse.ts` — parse with `js-yaml` (already a dependency), validate
  with zod.
- `apps/api/src/services/compose/normalize.ts` — **the ported core.** Coolify's value here is its
  normalisation rules: injecting the managed network, rewriting `ports` to Traefik labels,
  expanding `${VAR}` from our env store, generating passwords for `SERVICE_PASSWORD_*`-style
  placeholders, mapping named volumes to managed volumes, preserving `depends_on` ordering. I will
  reimplement these rules in TypeScript from reading their PHP, documented rule-by-rule.
- `apps/api/src/services/compose/deploy.ts` — `docker compose up` via the CLI against a generated
  file (matching Coolify's own approach) with per-service status reconciliation back into
  `serviceContainers`.
- `apps/api/src/routers/service.ts` + `trpc/router.ts` registration.
- Web: `app/dashboard/services/` — list, create-from-file, create-from-catalogue, per-service
  logs/status, stack-level deploy/stop/delete.

**Acceptance:** integration test deploys a 3-service stack (web+postgres+redis) from raw Compose,
asserts all three healthy, the web service is reachable through Traefik on a generated domain, the
Postgres volume survives a redeploy, and stack delete removes exactly its own containers, network,
and volumes and nothing else.

### W3 — Real service catalogue

- `scripts/import-coolify-templates.ts` — **new.** Fetches `templates/compose/*.yaml` from
  `coollabsio/coolify` at a pinned commit, parses their `# documentation:` / `# tags:` header
  comments, and emits `packages/database/src/seed/service-templates.ts`. Pinned, vendored, and
  attributed — not a runtime fetch.
- Replaces the 72 hand-written single-image entries in
  `apps/web/src/app/dashboard/templates/templates-data.ts` with catalogue rows backed by W2.
- **Quality gate over count** (per the gap analysis): a template is only published if
  `scripts/verify-templates.ts` can deploy it, reach health, and clean it up on a scratch daemon.
  I expect to publish materially fewer than 371 initially and grow the passing set.

**Acceptance:** ≥25 templates pass the automated deploy-health-cleanup gate; the catalogue page
lists only passing templates; each carries attribution.

### W4 — Public REST API + scoped tokens

- Schema: `apiTokens` (hashed token, `scopes[]`, `lastUsedAt`, `expiresAt`, org+user FK).
- `apps/api/src/middleware/api-token.ts` — bearer auth resolving to a tRPC-compatible context.
- `apps/api/src/rest/` — Express routers for applications, deployments, databases, domains, logs,
  backups, services. Scopes: `read`, `deploy`, `write`, `admin`.
- Extend the existing `swagger.ts` so the surface is documented, not just asserted.
- Web: token management UI under settings, with one-time secret reveal.

**Acceptance:** supertest suite covering every endpoint × every scope, asserting 403 on
insufficient scope and 401 on revoked/expired; production smoke uses a `read` token.

### W5 — S3 off-site backups

Today `db-backup.ts` (192 lines) writes to a local volume — on the same host as the database. Not
a DR plan.

- Schema: `s3Storages` (endpoint, bucket, region, encrypted key/secret, path-style flag);
  `databaseBackups` gains `destination`, `s3StorageId`, `remoteKey`, `sizeBytes`, `checksum`.
- `apps/api/src/services/storage/s3.ts` — S3-compatible client (adds `@aws-sdk/client-s3`).
- Extend `db-backup.ts` with upload-after-dump, retention pruning on the remote, and
  restore-from-remote.
- **`apps/api/src/services/volume-backup.ts` — new.** The "Absent" row: tar a named volume from a
  throwaway alpine container, stream to S3, restore in reverse.
- Scheduled restore drill in `queues/backups.ts` that restores the newest backup into a scratch
  container, runs a row-count assertion, and alerts on mismatch.

**Acceptance:** integration test backs a Postgres DB with known rows to MinIO, deletes the DB,
restores from S3, asserts row counts match; same for a volume with known files.

### W6 — Disk safety & deployment-aware cleanup

- `apps/api/src/services/disk-manager.ts` — thresholds, `docker system df` parsing, image/volume
  reaping that **excludes images referenced by any current deployment or rollback-retention
  window**, and preview-container reaping past TTL.
- Ships **dry-run-only first** (`GS_CLEANUP=report`), emitting a report for a full week before
  anyone flips it to `enforce`. On this host, an over-eager pruner is a customer-data event.

**Acceptance:** unit tests over the retention algebra; an integration test asserting a
rollback-eligible image is never selected; a dry-run against this host reviewed by you before
enforce.

### W7 — Notifications + log drains

- Schema: `notificationChannels` (type: email/webhook/discord/telegram/slack, config, enabled
  events), replacing the single-purpose `slackConfigs`.
- `apps/api/src/services/notification.ts` — provider dispatch; `nodemailer` is already a
  dependency.
- `apps/api/src/services/log-drain.ts` — Fluent-Bit-compatible forwarding per resource.
- Events: deployment failure, backup failure, disk threshold, spend limit, health-check flap.

**Acceptance:** per-provider unit tests with a mock transport; an E2E asserting a failed deploy
produces exactly one notification per subscribed channel.

### W8 — Remote Docker provider

`providers/factory.ts:50` throws `"Docker Remote provider is not yet implemented"`. The UI offers
it. Finish exactly this one and hide the other six.

- `apps/api/src/providers/docker-remote.ts` — implements the existing `ComputeProvider` interface
  over SSH (`ssh2` is already a dependency) or TLS socket.
- Key management (encrypted at rest via `utils/crypto.ts`), reachability validation, prerequisite
  install, network/proxy bootstrap, resource discovery.
- **Honesty fix:** `aws-ecs`, `gcp-cloudrun`, `azure-aci`, `hetzner`, `digitalocean` removed from
  the provider picker until implemented. Kubernetes and SSO marked experimental.

**Acceptance:** integration test against a throwaway Docker-in-Docker target: register, validate,
deploy, log, health, stop, delete.

---

## 3. Agent fleet

You asked for a fleet working concurrently. Here is the topology, sized so that agents do not
collide on files or on the Docker daemon.

```
                    ┌─────────────────────────────┐
                    │  Orchestrator (me, main)    │
                    │  owns schema, merges, prod  │
                    └──────────┬──────────────────┘
        ┌──────────────┬───────┴───────┬──────────────┬──────────────┐
        ▼              ▼               ▼              ▼              ▼
   ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ A1      │   │ A2        │   │ A3       │   │ A4       │   │ A5       │
   │ runtime │   │ compose   │   │ platform │   │ ops      │   │ frontend │
   │ W1      │   │ W2 + W3   │   │ W4 + W8  │   │ W5+W6+W7 │   │ all UI   │
   └────┬────┘   └─────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
        └──────────────┴──────────────┴──────────────┴──────────────┘
                                      ▼
                          ┌───────────────────────┐
                          │ V1  Verification agent│  ← the "proper test agent"
                          │ adversarial, gates    │
                          └───────────────────────┘
```

**Rules that make concurrency safe:**

- **Worktree isolation.** Every implementation agent runs `isolation: "worktree"`, so no two
  agents share a working tree. Note the stash-stack caveat in this environment: agents are
  instructed never to use bare `git stash`.
- **Schema is single-owner.** Only the orchestrator writes
  `packages/database/src/schema/index.ts` and `packages/database/migrations/`. Agents needing
  schema submit a request; I land it first and they rebase. This removes the highest-probability
  merge conflict in the repo (one 1,542-line file that five agents would otherwise all touch).
- **Docker daemon is serialised.** Only one agent at a time may hold the integration-test lock
  (`flock` on a lockfile), and only inside the W0 sandbox. Everything else is unit tests with
  mocked dockerode, which parallelises freely.
- **A5 owns all of `apps/web/src`.** Backend agents never edit frontend files; they publish tRPC
  procedure signatures and A5 consumes them. This is the second-biggest conflict source removed.
- **V1 never writes product code.** It writes tests and verdicts only, so it can run continuously
  against whatever has landed without racing anyone.

### The verification agent (V1) — its actual job

Not "run `pnpm test`". Its brief:

1. **Re-derive acceptance independently.** Given a workstream's acceptance criteria, write its
   own tests without reading the implementer's tests, so we detect tests written to match the bug.
2. **Adversarial cases mandatory per workstream:** the failure path, the concurrent path, the
   restart-mid-operation path, and the "does this touch resources it doesn't own" path.
3. **Blast-radius audit.** For every diff touching `dockerode`, statically check that every
   destructive call (`remove`, `stop`, `prune`, `createVolume` overwrite) is label-scoped. Any
   unscoped destructive call is an automatic block.
4. **Regression gate on the existing 29 suites** — no workstream lands red.
5. **Verdict format:** `PASS` / `BLOCK <reason>` per workstream. I do not merge a `BLOCK`.

---

## 4. Sequencing

Five waves. Each wave ends with a merge to `main`, an automatic production deploy, and a smoke
gate before the next wave starts.

| Wave | Content | Concurrency | Gate |
|---|---|---|---|
| **0** | W0 harness + honesty fixes (hide unimplemented providers, mark K8s/SSO experimental) | orchestrator + V1 | prod smoke green; no behaviour change |
| **1** | W1 zero-downtime, W4 REST API, W7 notifications | A1, A3, A4 in parallel | zero-dropped-request test; prod deploy of a canary app observed |
| **2** | W2 Compose engine | A2 + A5, others on W5/W8 | 3-service stack deploys on prod host under flag, in a scratch project |
| **3** | W3 catalogue, W5 S3 backups, W8 remote Docker | A2, A4, A3 | ≥25 templates green; restore drill green |
| **4** | W6 cleanup (report mode), hardening, docs | A4 + V1 | one week of dry-run reports reviewed by you |

Rough calendar at this fleet size: wave 0 ~2 days, wave 1 ~1 week, wave 2 ~2 weeks, wave 3 ~2
weeks, wave 4 ~1 week + the observation window. Call it **6–7 weeks** to all-green, versus the
gap analysis's own 0–6 month framing — the compression comes from parallelism, and it is the part
of this plan I hold most loosely.

---

## 5. Production merge & verification protocol

Because `main` → production is unattended and five minutes wide, every wave follows this exact
sequence:

1. Feature branch → PR to `main`. CI (`test.yml`) must be green including the new integration job.
2. V1 verdict `PASS`.
3. **Pre-merge production snapshot:** `git rev-parse origin/main` recorded, `docker ps` inventory
   captured, Postgres dumped to the backup volume. This is the rollback anchor.
4. Merge. Cron picks it up within 5 minutes; `self-update.sh` already has a `rollback()` trap on
   compose failure, which covers "won't boot" but *not* "boots and misbehaves".
5. **Post-deploy gate, T+6 min:** `scripts/prod-smoke.sh` — `/health`, an authenticated tRPC read,
   Traefik router inventory unchanged, and **the habit-tracker app still returns 200**. That last
   check is the canary for "did we break a real customer".
6. **Feature verification in production:** deploy a throwaway app in a dedicated `gs-verify`
   project exercising the new capability end-to-end, then delete it.
7. **Failure → rollback:** `git revert` the merge and push; cron redeploys the prior image within
   5 minutes. Documented as `scripts/rollback-prod.sh`.

Every new capability ships flag-off (`GS_*` env in `.env.production`), is enabled for the
`gs-verify` project first, then globally. So the risky moment is a config flip I can reverse in
seconds, not a code deploy.

---

## 6. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Integration test kills a customer container on this host | **critical** | W0 sandbox guard; `GS_ALLOW_DOCKER_TESTS` opt-in; label-scope audit in V1; CI integration job runs on an ephemeral runner, not here |
| Cleanup (W6) deletes an in-use image | high | report-mode for a full week; retention excludes rollback window; your sign-off before enforce |
| Compose engine mis-parses and clobbers an existing app's network | high | stack-scoped networks; delete-by-label only; V1 blast-radius audit |
| Schema migration locks prod Postgres | medium | additive-only columns, nullable, no table rewrites; migrations reviewed by orchestrator alone |
| Five-minute unattended deploy amplifies any mistake | high | wave-based merges, flags off by default, smoke gate, scripted revert |
| Coolify attribution missed | medium | `docs/attribution/coolify.md` + `NOTICE`, reviewed at each wave |
| Parallel agents conflict | medium | single-owner schema, single-owner frontend, worktree isolation, serialised Docker lock |

---

## 7. Decisions I need from you

1. **Scope confirmation.** Nine workstreams is a large programme. Confirm all, or cut to a subset
   (my recommendation if you want value fastest: W0 → W1 → W2 → W3, which is the reliability fix
   plus the two headline product gaps).
2. **The three honesty fixes.** Hiding six unimplemented cloud providers, and labelling Kubernetes
   and SSO "experimental", changes what your UI advertises. Yes or no?
3. **Cleanup enforce.** Confirm W6 stays report-only until you personally review a week of output.
4. **A staging target.** Everything is safer if wave verification runs somewhere other than the
   host serving `daily-habit-tracker-app`. Is there a second VM or Proxmox node I can use? If not
   I proceed with the sandbox guards, but I'd rather have the second box.
5. **Habit-tracker migration.** The gap analysis's Neon→managed-Postgres migration (4 users, 9
   habits, 20 day records) is customer-data work with its own freeze window. In or out of this
   programme? I recommend **out** — done separately, deliberately, after W1 lands so the redeploy
   is zero-downtime.
