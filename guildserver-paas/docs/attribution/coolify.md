# Attribution: Coolify

GuildServer's platform-parity programme draws on [Coolify](https://github.com/coollabsio/coolify),
licensed under the **Apache License 2.0**. This file records exactly what was taken and how, so
the provenance of every borrowed artefact is auditable.

Coolify is a PHP/Laravel application; GuildServer is TypeScript. No Coolify source file is or can
be compiled into this repository. The relationship therefore falls into three categories.

## 1. Copied verbatim (Apache-2.0, attribution required)

| Artefact | Source path in coollabsio/coolify | Pinned commit | Destination here |
|---|---|---|---|
| 341 Compose service templates (the Compose bodies, translated — see below) | `templates/compose/*.yaml` | `424dbd36fff39a9ccd22efbee019cf490dcf9fc8` | `packages/database/src/seed/service-template-compose.ts` |
| The same templates' header metadata: slogan, category, tags, documentation URL, logo path, default port | `templates/compose/*.yaml` | `424dbd36fff39a9ccd22efbee019cf490dcf9fc8` | `packages/database/src/seed/service-templates.ts` |
| Three template files kept verbatim as parser test fixtures | `templates/compose/{actualbudget,ghost,langfuse}.yaml`, and the first 60 lines of `templates/compose/appwrite.yaml` | `424dbd36fff39a9ccd22efbee019cf490dcf9fc8` | `apps/api/tests/fixtures/coolify-templates/` |

Anything landing in this table must also be covered by `NOTICE` at the repository root.

Both generated files carry the upstream repository, commit, path and licence in a
header comment, and `service-templates.ts` exports the same provenance as
`COOLIFY_UPSTREAM` so it is available at runtime rather than only in a comment.

Nothing is fetched at runtime. The templates were fetched once, from the pinned
commit above, by `scripts/import-coolify-templates.ts`, and vendored. Bumping the
pin means editing `UPSTREAM_COMMIT`, re-running the importer, reviewing the diff,
re-running the verification gate, and updating this file.

### Statement of significant changes (Apache-2.0 §4(b))

The Compose bodies in `service-template-compose.ts` are **modified versions** of
the upstream files, not verbatim copies. The modifications:

1. **Coolify's magic environment variables are translated.** Upstream templates
   use names such as `SERVICE_PASSWORD_MYSQL`, `SERVICE_URL_APP_3000` and
   `SERVICE_BASE64_64_SECRETKEY`, which have no meaning outside Coolify's PHP
   runtime — that runtime recognises them and substitutes generated values.
   GuildServer instead:
   - classifies each name against the closed command set transcribed from
     Coolify's `generateEnvValue`, and hoists it into a declared `variables`
     list on the template (a generated secret, or a domain to assign);
   - rewrites Coolify's bare declarations (`- SERVICE_URL_APP_3000`) and its
     path-suffixed form (`- SERVICE_URL_APPWRITE=/console`) into ordinary
     Compose interpolation (`- SERVICE_URL_APP_3000=${SERVICE_URL_APP_3000}`,
     `- SERVICE_URL_APPWRITE=${SERVICE_URL_APPWRITE}/console`).
   References of the form `$VAR` and `${VAR}` are left byte-for-byte unchanged,
   as both are already valid Compose.

2. **`exclude_from_hc` is removed.** It is Coolify's own key rather than a
   Compose one, and Docker rejects a service definition carrying it. What it
   signifies — that the service is a one-shot task — is preserved as `oneShot`
   on the template's service summary.

3. **The header metadata comment block is removed** from the body and parsed
   into structured fields.

4. **Templates upstream marks `ignore: true` are omitted** (28 of 371), as are
   two whose YAML is invalid (`langfuse`, `gramps-web`, which merge a sequence
   anchor into a mapping). 341 templates are imported.

No upstream file's licence header or copyright notice was removed; the upstream
files carry none, and provenance is instead recorded in the generated headers,
in this file, and in `NOTICE`.

## 2. Reimplemented from reading

Behaviour studied in Coolify's source and reimplemented independently in TypeScript. No code was
copied; the design credit is Coolify's.

| Behaviour | Where it lives here | Notes |
|---|---|---|
| Magic-variable naming conventions and their generated value shapes | `apps/api/src/services/templates/coolify-template.ts` | The closed set of generator commands and their lengths was transcribed from Coolify's `bootstrap/helpers/shared.php` (`generateEnvValue`, `parseEnvVariable`) and `bootstrap/helpers/services.php` (`parseServiceUrlOrFqdn`). No PHP was copied; the rules are reimplemented in TypeScript, and the value generation differs (see below). |
| Generating values for those variables | `apps/api/src/services/templates/materialize.ts` | Coolify uses Laravel's `Str::password`/`Str::random`. GuildServer uses Node's `crypto.randomBytes` with rejection sampling, which is an independent implementation with different bias characteristics, not a port. |

Deliberate behavioural differences from Coolify, for the record:

- Coolify treats the label in `SERVICE_URL_<LABEL>` as identifying a service.
  GuildServer resolves it to a real Compose service by four rules in order of
  certainty (exact name, unique service exposing the named port, separator-
  insensitive prefix, sole service in the file) and refuses to guess when two
  services match, because 89 of 341 templates use a label that is not a service
  name.
- Coolify can mint Supabase anon/service JWTs signed with `SERVICE_PASSWORD_JWT`.
  GuildServer cannot express a value derived from another generated value, so
  templates needing `SERVICE_SUPABASEANON_*` / `SERVICE_SUPABASESERVICE_*` are
  imported but held back from publication rather than shipped with an empty key.
- Coolify publishes every template it ships. GuildServer publishes only
  templates that have deployed and become healthy on a scratch daemon, recorded
  in `scripts/verified-templates.json`.

## 3. Deliberately not taken

- Livewire/Blade UI and Laravel plumbing — no analogue in this stack.
- Coolify's server-provisioning shell scripts — GuildServer's Proxmox provider covers this ground
  and is the platform's differentiator.
- Template logo assets (`templates/svgs/*`). These are third-party product logos that Coolify
  redistributes; each is the trademark of its own project and Coolify's Apache-2.0 licence does not
  grant rights to them. The catalogue stores the upstream logo *path* as a reference only. Serving
  those images requires a separate decision about trademark use — do not vendor them on the
  strength of this attribution.

## Licence

Apache License 2.0. The full text is reproduced in `LICENSES/Apache-2.0.txt`. Section 4 requires
that copies of the work carry the licence, retain attribution notices, and state significant
changes. Section 4(d) requires the `NOTICE` file be propagated where one exists upstream.
