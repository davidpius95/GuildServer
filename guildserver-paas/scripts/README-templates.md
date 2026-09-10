# Service template catalogue

The catalogue of deployable Compose stacks is imported from Coolify's
Apache-2.0 template corpus and vendored into this repository. See
`docs/attribution/coolify.md` for the licence position and the statement of
significant changes.

## The two scripts

```
scripts/import-coolify-templates.ts   fetch a pinned commit, translate, vendor
scripts/verify-templates.ts           deploy each template, keep the ones that work
```

They run in that order, and the second feeds the first:

```
                  ┌──────────────────────────────┐
  upstream ──────▶│ import-coolify-templates.ts  │──▶ packages/database/src/seed/
  (pinned commit) └──────────────────────────────┘        service-templates.ts
                                 ▲                        service-template-compose.ts
                                 │                                │
                   scripts/verified-templates.json                │
                                 ▲                                ▼
                  ┌──────────────────────────────┐         (scratch daemon)
                  │    verify-templates.ts       │◀────────────────┘
                  └──────────────────────────────┘
```

A template is `publishable` only when it both parses cleanly and has a recorded
pass in the ledger **against the current pin**. Importing is not endorsing.

## Importing

```bash
pnpm tsx scripts/import-coolify-templates.ts            # fetch, translate, write
pnpm tsx scripts/import-coolify-templates.ts --dry-run  # report only
pnpm tsx scripts/import-coolify-templates.ts --offline <dir>   # local checkout
```

Nothing fetches at runtime — only this script talks to GitHub, and only at the
commit in `UPSTREAM_COMMIT`. To take upstream changes: edit that constant,
re-run, review the diff, re-run the gate, update the attribution file.

## Verifying

```bash
GS_ALLOW_DOCKER_TESTS=1 pnpm tsx scripts/verify-templates.ts
GS_ALLOW_DOCKER_TESTS=1 pnpm tsx scripts/verify-templates.ts --only ghost,umami
GS_ALLOW_DOCKER_TESTS=1 pnpm tsx scripts/verify-templates.ts --limit 25 --no-write
```

> **This starts containers.** Run it only on a scratch daemon that hosts nothing
> else. Developer and staging hosts for this platform run live customer
> workloads on the same daemon, and the sandbox refuses such a daemon by design.
> If it refuses, that is the correct outcome — move to a scratch runner. Do not
> set `GS_DOCKER_TESTS_ACK_SHARED_DAEMON`.

After a run, re-run the importer to fold the results into the catalogue.

## Consuming the data

```ts
import {
  PUBLISHABLE_SERVICE_TEMPLATES,
  SERVICE_TEMPLATES,
  COOLIFY_UPSTREAM,
} from "@guildserver/database/dist/seed/service-templates";
import { getServiceTemplateCompose } from "@guildserver/database/dist/seed/service-template-compose";
```

Both modules are side-effect free and do not open a database connection, so they
are safe to import from anywhere. Compose bodies live in the second module
because they are large and a catalogue UI does not need them.

Before deploying a template, resolve its variables — `variables` (generated
secrets and assigned domains) and `userVariables` (values the operator supplies)
— with `materializeVariables`, then substitute with `interpolateCompose`, both
from `apps/api/src/services/templates/materialize.ts`. Handing a raw body to
Docker leaves `SERVICE_PASSWORD_*` as the empty string, i.e. a database with no
password.
