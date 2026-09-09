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
| _(none yet)_ | | |

## 3. Deliberately not taken

- Livewire/Blade UI and Laravel plumbing — no analogue in this stack.
- Coolify's server-provisioning shell scripts — GuildServer's Proxmox provider covers this ground
  and is the platform's differentiator.

## Licence

Apache License 2.0. The full text is reproduced in `LICENSES/Apache-2.0.txt`. Section 4 requires
that copies of the work carry the licence, retain attribution notices, and state significant
changes. Section 4(d) requires the `NOTICE` file be propagated where one exists upstream.
