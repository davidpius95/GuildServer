import client from 'prom-client';

// Create a Registry
export const register = new client.Registry();

// Add default metrics (CPU, memory, file descriptors, etc. for the API container)
client.collectDefaultMetrics({ register, prefix: 'guildserver_api_' });

// -----------------------------------------------------------------------------
// Custom Metrics
// -----------------------------------------------------------------------------

// 1. Deployments Total
export const deploymentsTotal = new client.Counter({
  name: 'guildserver_deployments_total',
  help: 'Total number of container deployments',
  labelNames: ['status', 'app_id'],
});
register.registerMetric(deploymentsTotal);

// 2. Deployment Duration
export const deploymentDuration = new client.Histogram({
  name: 'guildserver_deployment_duration_seconds',
  help: 'Time taken to build and deploy a container',
  labelNames: ['status', 'app_id'],
  buckets: [10, 30, 60, 120, 300, 600, 1800], // buckets in seconds
});
register.registerMetric(deploymentDuration);

// 3. Queue Depth
export const queueDepth = new client.Gauge({
  name: 'guildserver_queue_depth',
  help: 'Number of jobs currently waiting or active in queues',
  labelNames: ['queue_name', 'status'],
});
register.registerMetric(queueDepth);

// 4. Webhook Deliveries
export const webhookDeliveries = new client.Counter({
  name: 'guildserver_webhook_deliveries_total',
  help: 'Total number of webhooks received',
  labelNames: ['provider', 'event_type'],
});
register.registerMetric(webhookDeliveries);

// 5. API Request Counter
export const httpRequestCounter = new client.Counter({
  name: 'guildserver_api_requests_total',
  help: 'Total number of HTTP requests to the API',
  labelNames: ['method', 'route', 'status_code'],
});
register.registerMetric(httpRequestCounter);

// 6. API Request Duration
export const httpRequestDuration = new client.Histogram({
  name: 'guildserver_api_request_duration_seconds',
  help: 'Duration of HTTP requests to the API',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // buckets in seconds
});
register.registerMetric(httpRequestDuration);

// 7. Signups Total
export const signupsTotal = new client.Counter({
  name: 'guildserver_signups_total',
  help: 'Total number of users who have successfully registered/signed up',
  labelNames: ['provider'], // e.g. 'github', 'google', 'email'
});
register.registerMetric(signupsTotal);

// 8. Active Repositories
export const activeRepositories = new client.Gauge({
  name: 'guildserver_active_repositories',
  help: 'Number of active Git repositories linked to the platform',
  async collect() {
    try {
      // Lazy import db to prevent circular dependency issues during startup
      const { db } = await import('@guildserver/database');
      const { applications } = await import('@guildserver/database');
      const { isNotNull } = await import('drizzle-orm');
      
      const countResult = await db.select({ count: isNotNull(applications.repository) })
        .from(applications)
        .where(isNotNull(applications.repository));
        
      this.set(countResult.length);
    } catch (err) {
      console.error("Failed to collect active repositories metric", err);
    }
  }
});
register.registerMetric(activeRepositories);
