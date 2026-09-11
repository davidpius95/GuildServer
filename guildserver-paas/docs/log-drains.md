# Log drains

A **log drain** forwards the container logs of one application or Compose
stack to an HTTP endpoint you control. Anything that accepts JSON over HTTP
works: Fluent Bit's `http` input, Vector's `http_server` source, Axiom, Better
Stack, or your own collector.

Owners and admins manage drains (tRPC `logDrain.*`). Members can see which
resources are drained and to which host. The endpoint's path and query string,
and every header value, are write-only: they are stored encrypted and never
returned by the API.

## What is sent

Each log line becomes one record:

```json
{
  "timestamp": "2026-09-11T05:00:00.123456789Z",
  "message": "GET /health 200 2ms",
  "stream": "stdout",
  "resource": { "type": "application", "id": "…", "name": "shop" },
  "container": { "id": "c0ffee000001", "name": "shop-7f3a" },
  "source": "guildserver"
}
```

Records are sent in batches of up to 500 records or 512 KiB, about every two
seconds, as either:

- `json` (default): the request body is a JSON array. This is what Fluent
  Bit's `http` input expects.
- `ndjson`: one JSON object per line, `Content-Type: application/x-ndjson`.

Up to 10 extra request headers can be configured, for example `Authorization`
or `X-Api-Key`. Headers the HTTP stack owns (`Host`, `Content-Length`,
`Content-Type`, `Transfer-Encoding`, `User-Agent`, …) cannot be overridden.

### Fluent Bit example

```ini
[INPUT]
    Name   http
    Listen 0.0.0.0
    Port   9880

[OUTPUT]
    Name   stdout
    Match  *
```

Point the drain at `https://<your-fluent-bit-host>:9880/guildserver` with
format `json`.

## Behaviour and limits

- **Picked up within 30 seconds.** Drains are re-read every 30 seconds
  (`GS_LOG_DRAIN_RECONCILE_MS`). Enabling a drain starts from that moment; it
  does not replay old logs.
- **Every running container** of the resource is followed, including a
  rolling deploy's candidate, so a failing new version's logs are captured.
- **Restarts.** When a container restarts, the drain resumes from the last
  second it forwarded. A line in that second can occasionally be sent twice;
  lines are not skipped.
- **Long lines** are cut at 16 KiB and marked `…[truncated]`.
- **Failures.** A failing endpoint is retried with exponential backoff (1 s
  doubling to 60 s), keeping record order. Up to 10,000 records or 8 MiB are
  buffered per drain. Beyond that new lines are dropped and counted in
  `recordsDropped`. Redirects are never followed.
- **Status.** `lastDeliveryAt`, `lastDeliveryOk`, `lastError` (host only, never
  the path or query), `recordsSent` and `recordsDropped` are updated at most
  every 15 seconds. `logDrain.test` sends one record immediately.
- At most 50 drains per organization, and 200 followed containers per API
  process.

## Endpoint safety

The endpoint is resolved before use and re-checked every minute. It is refused
if **any** resolved address is loopback, link-local (including cloud metadata
at 169.254.169.254) or unspecified. Private ranges are refused unless the
operator sets `GS_LOG_DRAIN_ALLOW_PRIVATE_ENDPOINTS=1`, for example to reach a
Fluent Bit on the same LAN. Loopback additionally needs
`GS_LOG_DRAIN_ALLOW_LOOPBACK_ENDPOINTS=1` and is intended for test rigs.

## Turning it off

`GS_LOG_DRAINS=0` disables the forwarder entirely. With no drains configured it
follows no containers and only re-reads the (empty) drain list.
