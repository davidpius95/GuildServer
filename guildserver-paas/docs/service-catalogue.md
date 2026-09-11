# One-click service catalogue

The Templates page's **One-click services** view deploys self-hosted services
(Ghost, Uptime Kuma, n8n, …) as Compose stacks. The templates are Coolify's
(Apache-2.0; see `docs/attribution/coolify.md`), translated and vendored in
`packages/database/src/seed/`.

## What is offered

A template is listed only if both hold:

1. **It passed the deployment gate** (`scripts/verify-templates.ts`): every
   service started, stayed up and passed its health check on a scratch GitHub
   runner, at the vendored upstream commit. The workflow
   `.github/workflows/verify-templates.yml` runs weekly and publishes results
   to the `template-verification` branch for review.
2. **The stack deployer accepts it**: a stack planned from it passes the same
   normalisation a real deploy runs. Templates needing something the deployer
   refuses on purpose (`cap_add`, `security_opt`, a fixed `container_name`)
   are left out.

On 2026-09-11: 302 templates, 192 passed the gate, 182 offered.

## What deploying does

`serviceTemplate.deploy` (`apps/api/src/services/templates/catalogue.ts`):

- declares named volumes the upstream file mounts but does not declare;
- checks user settings: unknown keys are rejected (so generated secrets cannot
  be overridden) and required ones must be filled in;
- generates each secret once per identifier, so an app and its database get
  the same password;
- gives each service a domain variable points at `<service>-<stack>.<BASE_DOMAIN>`,
  routed when the service publishes a port (otherwise a warning is returned);
- creates and deploys the stack through the stack router, so project access,
  Compose validation and deployment records are the same as for a hand-written
  stack.

The Compose file is stored with `${VAR}` references and the values in the
stack's environment; the stack deployer interpolates it and escapes `$` so
generated passwords survive the Compose CLI's second interpolation pass.

## Updating the templates

1. Re-import: `pnpm tsx scripts/import-coolify-templates.ts` (pins a new
   upstream commit).
2. Run the verification workflow; review and merge its results.
3. `tests/services/template-catalogue.test.ts` plans every offered template, so
   CI fails if an update breaks one.
