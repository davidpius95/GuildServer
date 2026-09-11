import client from 'prom-client';

/**
 * One registry per process, even if this module is loaded more than once.
 *
 * Under tsx a dynamic `import()` of a module that was already loaded with a
 * static import can evaluate it a second time. prom-client's constructors used
 * to register every metric in its *global* registry as well, so the second
 * evaluation threw "A metric with the name ... has already been registered" —
 * which turned the first successful sign-up into an HTTP 500. Metrics now go
 * only into this registry (`registers: [register]`), and both the registry and
 * each metric are reused when they already exist.
 */
const globalMetrics = globalThis as typeof globalThis & { __guildserverMetricsRegistry?: client.Registry };
const existingRegistry = globalMetrics.__guildserverMetricsRegistry;

export const register: client.Registry = existingRegistry ?? new client.Registry();
if (!existingRegistry) {
  globalMetrics.__guildserverMetricsRegistry = register;
  // Default metrics (CPU, memory, file descriptors, etc. for the API container)
  client.collectDefaultMetrics({ register });
}

/** Return the metric already registered under `name`, or create and register it. */
function metric<T extends client.Metric<string>>(name: string, create: () => T): T {
  return (register.getSingleMetric(name) as T | undefined) ?? create();
}

// -----------------------------------------------------------------------------
// Custom Metrics
// -----------------------------------------------------------------------------

// 1. Deployments Total
export const deploymentsTotal = metric('guildserver_deployments_total', () =>
  new client.Counter({
    name: 'guildserver_deployments_total',
    help: 'Total number of container deployments',
    labelNames: ['status', 'app_id'],
    registers: [register],
  }),
);

// 2. Deployment Duration
export const deploymentDuration = metric('guildserver_deployment_duration_seconds', () =>
  new client.Histogram({
    name: 'guildserver_deployment_duration_seconds',
    help: 'Time taken to build and deploy a container',
    labelNames: ['status', 'app_id'],
    buckets: [10, 30, 60, 120, 300, 600, 1800], // buckets in seconds
    registers: [register],
  }),
);

// 3. Queue Depth
export const queueDepth = metric('guildserver_queue_depth', () =>
  new client.Gauge({
    name: 'guildserver_queue_depth',
    help: 'Number of jobs currently waiting or active in queues',
    labelNames: ['queue_name', 'status'],
    registers: [register],
  }),
);

// 4. Webhook Deliveries
export const webhookDeliveries = metric('guildserver_webhook_deliveries_total', () =>
  new client.Counter({
    name: 'guildserver_webhook_deliveries_total',
    help: 'Total number of webhooks received',
    labelNames: ['provider', 'event_type'],
    registers: [register],
  }),
);

// 5. API Request Counter
export const httpRequestCounter = metric('guildserver_api_requests_total', () =>
  new client.Counter({
    name: 'guildserver_api_requests_total',
    help: 'Total number of HTTP requests to the API',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  }),
);

// 6. API Request Duration
export const httpRequestDuration = metric('guildserver_api_request_duration_seconds', () =>
  new client.Histogram({
    name: 'guildserver_api_request_duration_seconds',
    help: 'Duration of HTTP requests to the API',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // buckets in seconds
    registers: [register],
  }),
);

// 7. Signups Total
export const signupsTotal = metric('guildserver_signups_total', () =>
  new client.Counter({
    name: 'guildserver_signups_total',
    help: 'Total number of users who have successfully registered/signed up',
    labelNames: ['provider'], // e.g. 'github', 'google', 'email'
    registers: [register],
  }),
);

// 8. Active Repositories
export const activeRepositories = metric('guildserver_active_repositories', () =>
  new client.Gauge({
    name: 'guildserver_active_repositories',
    help: 'Number of active Git repositories linked to the platform',
    async collect() {
      try {
        const { db } = await import('@guildserver/database');
        const { applications } = await import('@guildserver/database');
        const { isNotNull, count } = await import('drizzle-orm');

        const [{ value }] = await db
          .select({ value: count() })
          .from(applications)
          .where(isNotNull(applications.repository));

        this.set(value);
      } catch (err) {
        console.error("Failed to collect active repositories metric", err);
      }
    },
    registers: [register],
  }),
);
