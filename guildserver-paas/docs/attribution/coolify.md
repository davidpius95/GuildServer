# Attribution: Coolify

GuildServer's platform-parity programme draws on [Coolify](https://github.com/coollabsio/coolify),
licensed under the **Apache License 2.0**. This file records exactly what was taken and how, so
the provenance of every borrowed artefact is auditable.

Coolify is a PHP/Laravel application; GuildServer is TypeScript. No Coolify source file is or can
be compiled into this repository. The relationship therefore falls into three categories.

## 1. Copied verbatim (Apache-2.0, attribution required)

| Artefact | Source path in coollabsio/coolify | Pinned commit | Destination here |
|---|---|---|---|
| _(none yet)_ | | | |

Anything landing in this table must also be covered by `NOTICE` at the repository root.

## 2. Reimplemented from reading

Behaviour studied in Coolify's source and reimplemented independently in TypeScript. No code was
copied; the design credit is Coolify's.

| Behaviour | Where it lives here | Notes |
|---|---|---|
| Compose file kept verbatim as source of truth, normalised only on the way to the daemon | `apps/api/src/services/compose/normalize.ts` | Coolify stores the user's `docker_compose_raw` and derives `docker_compose` from it at deploy time. GuildServer's `services.compose_file` / `services.compose_resolved` pair follows the same split, for the same reason: the user's file must stay editable and recoverable. |
| Namespacing a stack's containers, networks and volumes to a per-stack project name | `apps/api/src/services/compose/normalize.ts` | The idea of rewriting every identifier into a stack-scoped namespace is Coolify's. The scheme itself differs: GuildServer embeds 8 hex characters of the stack row's UUID and treats a `gs.service.id` label — not the name prefix — as the authority for every destructive operation. |
| `SERVICE_PASSWORD_*` / `SERVICE_USER_*` / `SERVICE_BASE64_*` placeholder vocabulary for generated credentials | `generateForPlaceholder` in `apps/api/src/services/compose/normalize.ts` | Coolify's convention for "invent a value for this variable and remember it". GuildServer adds `SERVICE_HEX_*`, and deliberately does **not** generalise to heuristics like "any variable ending in `_PASSWORD`" — an unset `STRIPE_API_KEY` must fail the deploy rather than receive a random value. |
| Routing generated from a per-service domain map rather than from the Compose file's own Traefik labels | `apps/api/src/services/compose/normalize.ts` | Coolify assigns FQDNs per compose service and synthesises the proxy labels. GuildServer does the same but delegates to its existing `buildTraefikLabels`, so stacks and applications cannot drift apart. |
| Deploying through the `docker compose` CLI rather than reimplementing the engine | `apps/api/src/services/compose/deploy.ts` | Coolify shells out to `docker compose up`. Same reasoning adopted here: the CLI is the reference implementation of the format we accept and handles dependency ordering, network and volume creation better than anything built on dockerode. |

## 3. Deliberately not taken

- Livewire/Blade UI and Laravel plumbing — no analogue in this stack.
- Coolify's server-provisioning shell scripts — GuildServer's Proxmox provider covers this ground
  and is the platform's differentiator.

## Licence

Apache License 2.0. The full text is reproduced in `LICENSES/Apache-2.0.txt`. Section 4 requires
that copies of the work carry the licence, retain attribution notices, and state significant
changes. Section 4(d) requires the `NOTICE` file be propagated where one exists upstream.
