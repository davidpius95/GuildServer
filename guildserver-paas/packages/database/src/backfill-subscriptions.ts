import dotenv from "dotenv";
dotenv.config();

import { db, organizations, plans, subscriptions } from "./index";
import { eq, isNull } from "drizzle-orm";

/**
 * Backfill script: assign Hobby plan to all existing organizations that
 * don't have a subscription yet. Idempotent — safe to run multiple times.
 */
async function backfillSubscriptions() {
  console.log("🔄 Backfilling subscriptions for existing organizations...\n");

  try {
    // Get the Hobby plan
    const hobbyPlan = await db.query.plans.findFirst({
      where: eq(plans.slug, "hobby"),
    });

    if (!hobbyPlan) {
      console.error("❌ Hobby plan not found. Run seed-plans.ts first.");
      process.exit(1);
    }

    // Get all organizations
    const allOrgs = await db.query.organizations.findMany();

    let created = 0;
    let skipped = 0;

    for (const org of allOrgs) {
      // Check if this org already has a subscription
      const existingSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, org.id),
      });

      if (existingSub) {
        skipped++;
        console.log(`  ⏭️  ${org.name} — already has subscription (${existingSub.status})`);
        continue;
      }

      // Create Hobby subscription
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await db.insert(subscriptions).values({
        organizationId: org.id,
        planId: hobbyPlan.id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        seats: 1,
      });

      created++;
      console.log(`  ✅ ${org.name} — assigned Hobby plan`);
    }

    console.log(`\n🎉 Backfill complete: ${created} created, ${skipped} skipped (already had subscription)`);
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  }
}

backfillSubscriptions();
