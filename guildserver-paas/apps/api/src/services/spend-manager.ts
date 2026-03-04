import { db, subscriptions, plans, members } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { notify } from "./notification";
import { getCurrentUsage } from "./usage-meter";

/**
 * Spend Management Service
 *
 * Tracks overage costs against spend limits for Pro+ plans.
 * Sends notifications at 50%, 75%, and 100% thresholds.
 * Optionally hard-caps deployments when the limit is reached.
 */

// Overage rates (in cents)
const OVERAGE_RATES = {
  bandwidth_gb: 15, // $0.15 per GB
  build_minutes: 1, // $0.01 per minute
  deployments: 10, // $0.10 per deployment
};

/**
 * Calculate the current overage cost for an organization.
 * Only tracks usage beyond included amounts in the plan.
 */
export async function calculateOverageCost(organizationId: string): Promise<{
  totalCents: number;
  breakdown: Record<string, { overage: number; costCents: number; rate: number }>;
}> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  const planSlug = sub?.plan?.slug || "hobby";
  const limits = (sub?.plan?.limits as Record<string, number>) || {};
  const usage = await getCurrentUsage(organizationId);

  if (planSlug === "hobby") {
    return { totalCents: 0, breakdown: {} };
  }

  const breakdown: Record<string, { overage: number; costCents: number; rate: number }> = {};
  let totalCents = 0;

  for (const [metric, rate] of Object.entries(OVERAGE_RATES)) {
    const limitKey = metricToLimitKey(metric);
    const limit = limits[limitKey] ?? -1;
    const current = usage[metric] || 0;

    if (limit === -1) continue; // unlimited

    const overage = Math.max(0, current - limit);
    const costCents = overage * rate;

    if (overage > 0) {
      breakdown[metric] = { overage, costCents, rate };
      totalCents += costCents;
    }
  }

  return { totalCents, breakdown };
}

/**
 * Check spend limit before a deployment.
 * Returns { allowed, reason } — allowed is false if hard-capped at limit.
 */
export async function checkSpendLimit(organizationId: string): Promise<{
  allowed: boolean;
  reason?: string;
  currentSpendCents: number;
  limitCents: number | null;
  percentage: number;
}> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  // No subscription or Hobby plan — no spend limit applies
  if (!sub || sub.plan?.slug === "hobby") {
    return { allowed: true, currentSpendCents: 0, limitCents: null, percentage: 0 };
  }

  const spendLimitCents = sub.spendLimitCents;

  // No limit configured — allow everything
  if (spendLimitCents === null || spendLimitCents === undefined) {
    return { allowed: true, currentSpendCents: 0, limitCents: null, percentage: 0 };
  }

  const { totalCents } = await calculateOverageCost(organizationId);

  // Account for usage credit
  const creditCents = sub.usageCreditCents || 0;
  const netSpendCents = Math.max(0, totalCents - creditCents);
  const percentage = spendLimitCents > 0 ? Math.round((netSpendCents / spendLimitCents) * 100) : 0;

  if (netSpendCents >= spendLimitCents) {
    return {
      allowed: false,
      reason: `Spend limit reached ($${(netSpendCents / 100).toFixed(2)}/$${(spendLimitCents / 100).toFixed(2)}). Increase your spend limit or wait for the next billing period.`,
      currentSpendCents: netSpendCents,
      limitCents: spendLimitCents,
      percentage,
    };
  }

  return {
    allowed: true,
    currentSpendCents: netSpendCents,
    limitCents: spendLimitCents,
    percentage,
  };
}

/**
 * Check spend thresholds and send notifications if needed.
 * Call this after each metered usage event (deployment, build, bandwidth).
 * Uses subscription metadata to track which thresholds have been notified.
 */
export async function checkSpendThresholds(organizationId: string): Promise<void> {
  try {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, organizationId),
      with: { plan: true },
    });

    if (!sub || sub.plan?.slug === "hobby" || !sub.spendLimitCents) {
      return;
    }

    const { totalCents } = await calculateOverageCost(organizationId);
    const creditCents = sub.usageCreditCents || 0;
    const netSpendCents = Math.max(0, totalCents - creditCents);
    const spendLimitCents = sub.spendLimitCents;
    const percentage = spendLimitCents > 0 ? Math.round((netSpendCents / spendLimitCents) * 100) : 0;

    // Track which thresholds have been notified this period using metadata
    const metadata = (sub.metadata as Record<string, any>) || {};
    const notified = metadata.spendNotified || {};
    const currentSpend = (netSpendCents / 100).toFixed(2);
    const spendLimit = (spendLimitCents / 100).toFixed(2);

    // Find the org owner to notify
    const owner = await db.query.members.findFirst({
      where: and(
        eq(members.organizationId, organizationId),
        eq(members.role, "owner")
      ),
    });

    if (!owner || !owner.userId) return;

    const thresholds = [
      { pct: 50, event: "spend_threshold_50" as const },
      { pct: 75, event: "spend_threshold_75" as const },
      { pct: 100, event: "spend_threshold_100" as const },
    ];

    let needsUpdate = false;

    for (const threshold of thresholds) {
      if (percentage >= threshold.pct && !notified[`${threshold.pct}`]) {
        // Send notification
        await notify(threshold.event, owner.userId, organizationId, {
          currentSpend,
          spendLimit,
          percentage: threshold.pct,
          url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard/billing`,
        });

        notified[`${threshold.pct}`] = true;
        needsUpdate = true;

        logger.info(
          `Spend alert: org ${organizationId} reached ${threshold.pct}% of spend limit ($${currentSpend}/$${spendLimit})`
        );
      }
    }

    // Update metadata with notified thresholds
    if (needsUpdate) {
      await db
        .update(subscriptions)
        .set({
          metadata: { ...metadata, spendNotified: notified },
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, sub.id));
    }
  } catch (error: any) {
    logger.error(`Spend threshold check failed: ${error.message}`);
  }
}

/**
 * Reset spend notification flags.
 * Call this at the start of each new billing period (from webhook).
 */
export async function resetSpendNotifications(organizationId: string): Promise<void> {
  try {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, organizationId),
    });

    if (!sub) return;

    const metadata = (sub.metadata as Record<string, any>) || {};
    delete metadata.spendNotified;

    await db
      .update(subscriptions)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
  } catch (error: any) {
    logger.error(`Failed to reset spend notifications: ${error.message}`);
  }
}

// =====================
// HELPERS
// =====================

function metricToLimitKey(metric: string): string {
  const mapping: Record<string, string> = {
    deployments: "maxDeployments",
    bandwidth_gb: "maxBandwidthGb",
    build_minutes: "maxBuildMinutes",
    applications: "maxApps",
    databases: "maxDatabases",
  };
  return mapping[metric] || metric;
}
