import { db, usageRecords, subscriptions, plans, applications, databases as databasesTable } from "@guildserver/database";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Usage metering service.
 * Tracks deployment counts, bandwidth, build minutes, and other metered usage.
 * Enforces plan limits for Hobby (hard caps) and tracks overages for Pro.
 */

// =====================
// TRACKING FUNCTIONS
// =====================

/**
 * Track a deployment for the current billing period.
 */
export async function trackDeployment(organizationId: string): Promise<void> {
  try {
    await incrementUsage(organizationId, "deployments", 1);
    logger.debug(`Tracked deployment for org ${organizationId}`);
  } catch (error: any) {
    logger.error(`Failed to track deployment: ${error.message}`);
  }
}

/**
 * Track build minutes for the current billing period.
 */
export async function trackBuildMinutes(
  organizationId: string,
  minutes: number
): Promise<void> {
  try {
    await incrementUsage(organizationId, "build_minutes", minutes);
    logger.debug(`Tracked ${minutes} build minutes for org ${organizationId}`);
  } catch (error: any) {
    logger.error(`Failed to track build minutes: ${error.message}`);
  }
}

/**
 * Track bandwidth consumption in GB.
 */
export async function trackBandwidth(
  organizationId: string,
  gigabytes: number
): Promise<void> {
  try {
    await incrementUsage(organizationId, "bandwidth_gb", gigabytes);
  } catch (error: any) {
    logger.error(`Failed to track bandwidth: ${error.message}`);
  }
}

// =====================
// USAGE QUERIES
// =====================

/**
 * Get current usage for an organization in the current billing period.
 */
export async function getCurrentUsage(
  organizationId: string
): Promise<Record<string, number>> {
  const { periodStart, periodEnd } = await getCurrentPeriod(organizationId);

  const records = await db.query.usageRecords.findMany({
    where: and(
      eq(usageRecords.organizationId, organizationId),
      gte(usageRecords.periodStart, periodStart),
      lte(usageRecords.periodEnd, periodEnd)
    ),
  });

  // Aggregate by metric
  const usage: Record<string, number> = {};
  for (const record of records) {
    usage[record.metric] = (usage[record.metric] || 0) + Number(record.value);
  }

  return usage;
}

/**
 * Check if a specific metric is within plan limits.
 * Returns { allowed, current, limit, overage }.
 */
export async function checkLimit(
  organizationId: string,
  metric: string
): Promise<{
  allowed: boolean;
  current: number;
  limit: number;
  overage: number;
  isUnlimited: boolean;
}> {
  const { limits, planSlug } = await getOrgPlanLimits(organizationId);

  const limitKey = metricToLimitKey(metric);
  const limit = limits[limitKey] ?? -1;
  const isUnlimited = limit === -1;

  // For resource-based metrics (apps, databases), count actual DB rows
  // For metered metrics (deployments, bandwidth, build_minutes), use usage records
  let current: number;
  if (metric === "applications") {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${organizationId} LIMIT 1)`));
    current = result[0]?.count || 0;
  } else if (metric === "databases") {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(databasesTable)
      .where(eq(databasesTable.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${organizationId} LIMIT 1)`));
    current = result[0]?.count || 0;
  } else {
    const usage = await getCurrentUsage(organizationId);
    current = usage[metric] || 0;
  }

  const overage = isUnlimited ? 0 : Math.max(0, current - limit);
  const allowed = isUnlimited || current < limit;

  return { allowed, current, limit, overage, isUnlimited };
}

/**
 * Enforce a plan limit. Throws an error if the limit is exceeded.
 * For Hobby plan: hard cap (no overages).
 * For Pro plan: allows overages (billing takes care of it).
 */
export async function enforceLimit(
  organizationId: string,
  metric: string
): Promise<void> {
  const { allowed, current, limit, isUnlimited } = await checkLimit(organizationId, metric);

  if (isUnlimited || allowed) return;

  const { planSlug } = await getOrgPlanLimits(organizationId);

  // Hobby plan: hard cap
  if (planSlug === "hobby") {
    throw new Error(
      `Plan limit reached: ${metric}. You've used ${current}/${limit}. Upgrade to Pro for higher limits.`
    );
  }

  // Pro plan: allow overages (charged via Stripe metered billing)
  // We don't block here — spend management (Step 12) handles hard caps if configured
}

/**
 * Get a dashboard-friendly usage summary with percentages.
 */
export async function getUsageSummary(organizationId: string): Promise<{
  metrics: Record<
    string,
    {
      current: number;
      limit: number;
      percentage: number;
      isUnlimited: boolean;
    }
  >;
  planSlug: string;
}> {
  const { limits, planSlug } = await getOrgPlanLimits(organizationId);
  const usage = await getCurrentUsage(organizationId);

  // Also count actual resources (apps, databases)
  const appCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(applications)
    .where(eq(applications.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${organizationId} LIMIT 1)`));

  const dbCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(databasesTable)
    .where(eq(databasesTable.projectId, sql`(SELECT id FROM projects WHERE organization_id = ${organizationId} LIMIT 1)`));

  const metricsMap: Record<
    string,
    { current: number; limit: number; percentage: number; isUnlimited: boolean }
  > = {};

  const metricDefs = [
    { key: "deployments", limitKey: "maxDeployments" },
    { key: "bandwidth_gb", limitKey: "maxBandwidthGb" },
    { key: "build_minutes", limitKey: "maxBuildMinutes" },
    { key: "applications", limitKey: "maxApps", count: appCount[0]?.count || 0 },
    { key: "databases", limitKey: "maxDatabases", count: dbCount[0]?.count || 0 },
  ];

  for (const def of metricDefs) {
    const limit = limits[def.limitKey] ?? -1;
    const current = def.count !== undefined ? def.count : (usage[def.key] || 0);
    const isUnlimited = limit === -1;
    const percentage = isUnlimited ? 0 : limit > 0 ? Math.round((current / limit) * 100) : 0;

    metricsMap[def.key] = { current, limit, percentage, isUnlimited };
  }

  return { metrics: metricsMap, planSlug };
}

// =====================
// INTERNAL HELPERS
// =====================

/**
 * Increment a usage metric for the current billing period.
 * Creates a new record if none exists for this metric/period, otherwise updates.
 */
async function incrementUsage(
  organizationId: string,
  metric: string,
  value: number
): Promise<void> {
  const { periodStart, periodEnd } = await getCurrentPeriod(organizationId);

  // Try to find existing record for this metric + period
  const existing = await db.query.usageRecords.findFirst({
    where: and(
      eq(usageRecords.organizationId, organizationId),
      eq(usageRecords.metric, metric),
      eq(usageRecords.periodStart, periodStart),
      eq(usageRecords.periodEnd, periodEnd)
    ),
  });

  if (existing) {
    // Increment existing record
    await db
      .update(usageRecords)
      .set({
        value: sql`${usageRecords.value} + ${value}`,
      })
      .where(eq(usageRecords.id, existing.id));
  } else {
    // Create new record
    await db.insert(usageRecords).values({
      organizationId,
      metric,
      value: String(value),
      periodStart,
      periodEnd,
    });
  }
}

/**
 * Get the current billing period for an organization.
 * Uses the subscription's period, or defaults to calendar month.
 */
async function getCurrentPeriod(
  organizationId: string
): Promise<{ periodStart: Date; periodEnd: Date }> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
    return {
      periodStart: new Date(sub.currentPeriodStart),
      periodEnd: new Date(sub.currentPeriodEnd),
    };
  }

  // Default to calendar month
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return { periodStart, periodEnd };
}

/**
 * Get an organization's plan limits and features.
 */
async function getOrgPlanLimits(organizationId: string): Promise<{
  limits: Record<string, number>;
  features: Record<string, boolean>;
  planSlug: string;
}> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  if (!sub?.plan) {
    // Default to hobby limits
    return {
      limits: {
        maxApps: 3,
        maxDatabases: 1,
        maxDeployments: 50,
        maxBandwidthGb: 10,
        maxBuildMinutes: 100,
        maxMemoryMb: 512,
        maxCpuCores: 0.5,
        maxDomainsPerApp: 1,
        maxTeamMembers: 1,
      },
      features: {},
      planSlug: "hobby",
    };
  }

  return {
    limits: (sub.plan.limits as Record<string, number>) || {},
    features: (sub.plan.features as Record<string, boolean>) || {},
    planSlug: sub.plan.slug,
  };
}

/**
 * Map a usage metric name to the corresponding plan limit key.
 */
function metricToLimitKey(metric: string): string {
  const mapping: Record<string, string> = {
    deployments: "maxDeployments",
    bandwidth_gb: "maxBandwidthGb",
    build_minutes: "maxBuildMinutes",
    applications: "maxApps",
    databases: "maxDatabases",
    storage_gb: "maxStorageGb",
  };
  return mapping[metric] || metric;
}
