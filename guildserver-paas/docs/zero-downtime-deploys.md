# Zero-downtime deploys

With `GS_ZERO_DOWNTIME=1` on the API, application deploys replace the running
container without dropping requests. The implementation is
`apps/api/src/services/docker/rolling.ts`.

## How a deploy runs

1. **Candidate.** The new version starts on a fresh host port with no Traefik
   router labels, so it cannot receive traffic.
2. **Health gate.** The app's configured health check (or a reachability
   probe). If the candidate never becomes healthy it is removed and the running
   version is untouched: a failed deploy changes nothing.
3. **Promotion.** The proven image starts again with the full label set.
   - *Overlap* — its Traefik labels match the running container's, so both
     serve behind one Traefik service, then the old one is retired.
   - *Serial* — the labels differ (domain, port or routing changed), so the old
     container is retired first. This gives a short gap, once; the next deploy
     overlaps.
4. **Retirement.** The old container gets SIGTERM and its stop grace period.

## What makes the overlap lossless

When the retired container stops, its address disappears from the Docker
network immediately, but Traefik keeps routing to it until it processes
Docker's event. Two settings close that window:

- Every router has a retry middleware (`<router>-retry`, 3 attempts, 100ms):
  a request that fails at the network level is sent to another backend.
- Traefik runs with `--serverstransport.forwardingtimeouts.dialtimeout=2s`
  (`docker-compose.prod.yml`), so a dial to the vanished address fails in 2s
  instead of hanging for Traefik's default 30s.

A retried request never produced a response, but one cut off while being
processed can run twice. Applications should finish in-flight requests on
SIGTERM; the stop grace period gives them time to.

## Proof

`.github/workflows/docker-acceptance.yml` runs
`apps/api/tests/integration/docker-rolling-live.test.ts` on a scratch GitHub
runner: a rolling swap behind a real Traefik under continuous load must return
no non-2xx response, and an unhealthy candidate must leave the old version
serving. It runs on pushes to `main` that touch the Docker or Compose code, so
it gates production deploys of that code. Never run it on a GuildServer host:
the test creates and removes containers, and its sandbox refuses a daemon with
platform-managed containers on it.

## Rolling out

1. Traefik must run with the dial timeout. After changing its command,
   recreate it under the updater lock:
   `flock /tmp/guildserver-self-update.lock docker compose --env-file .env.production -f docker-compose.prod.yml up -d traefik`
2. Set `GS_ZERO_DOWNTIME=1` for the API and recreate it.
3. Each app's first deploy afterwards may be serial (its router labels gained
   the retry middleware); later deploys overlap.
