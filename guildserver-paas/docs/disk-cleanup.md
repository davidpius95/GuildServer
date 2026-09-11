# Disk report and cleanup

Platform admins can see what is using disk on the Docker host and reclaim it.
Code: `apps/api/src/services/disk-report/`.

## Report (`monitoring.diskReport`)

Read-only. Lists image candidates, protected images, build cache, stopped
containers and volumes. The rules:

- An image is never a candidate if a rollback could need it: the newest
  completed deployments of each application (default 5) and any completed in
  the retention window (default 14 days) are protected, as are images used by
  any container and each application's configured image.
- Candidates are `safe` (platform-built or untagged) or `review` (third-party).
- Volumes are never candidates. They hold customer data and are listed for
  human review only.

## Cleanup (`monitoring.diskCleanup`)

Acts on image ids selected from a report:

- **Dry run by default.** Nothing is deleted unless `dryRun: false`.
- Re-plans from a fresh inventory first and removes an image only if it is
  still a `safe` candidate, so anything deployed or made a rollback target
  since the report was generated is kept.
- Never removes `review` images, and removes images without force, so Docker
  refuses one a container still uses.
- `includeBuildCache: true` also prunes build cache idle longer than the policy
  (default 7 days).
- Cannot touch volumes or containers: its Docker client only has
  `getImage().remove` and `pruneBuilder`.

Suggested routine: generate a report, review it, run a dry run with the chosen
ids, then run it for real.
