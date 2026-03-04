import { db, plans } from "./index";
import { eq } from "drizzle-orm";

/**
 * Seed the billing plans table with the 3 pricing tiers.
 * Idempotent — safe to run multiple times. Uses upsert logic.
 */
async function seedPlans() {
  console.log("💳 Seeding billing plans...");

  const planData = [
    {
      name: "Hobby",
      slug: "hobby" as const,
      description: "Free tier for personal projects and experimentation",
      priceMonthly: 0,
      priceYearly: 0,
      stripePriceIdMonthly: null,
      stripePriceIdYearly: null,
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
        auditRetentionDays: 7,
      },
      features: {
        previewDeployments: false,
        teamCollaboration: false,
        customDomains: true,
        prioritySupport: false,
        sso: false,
        spendManagement: false,
        webhooks: false,
        apiAccess: false,
      },
      sortOrder: 0,
    },
    {
      name: "Pro",
      slug: "pro" as const,
      description: "For teams and commercial projects with usage-based pricing",
      priceMonthly: 2000, // $20.00
      priceYearly: 20000, // $200.00 (2 months free)
      stripePriceIdMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || null,
      stripePriceIdYearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || null,
      limits: {
        maxApps: 25,
        maxDatabases: 10,
        maxDeployments: 500,
        maxBandwidthGb: 100,
        maxBuildMinutes: 1000,
        maxMemoryMb: 4096,
        maxCpuCores: 2,
        maxDomainsPerApp: 50,
        maxTeamMembers: -1, // unlimited
        auditRetentionDays: 90,
      },
      features: {
        previewDeployments: true,
        teamCollaboration: true,
        customDomains: true,
        prioritySupport: true,
        sso: false, // add-on
        spendManagement: true,
        webhooks: true,
        apiAccess: true,
      },
      sortOrder: 1,
    },
    {
      name: "Enterprise",
      slug: "enterprise" as const,
      description: "Custom pricing for large organizations with compliance needs",
      priceMonthly: null, // custom pricing
      priceYearly: null,
      stripePriceIdMonthly: null,
      stripePriceIdYearly: null,
      limits: {
        maxApps: -1,
        maxDatabases: -1,
        maxDeployments: -1,
        maxBandwidthGb: -1,
        maxBuildMinutes: -1,
        maxMemoryMb: 16384,
        maxCpuCores: 8,
        maxDomainsPerApp: -1,
        maxTeamMembers: -1,
        auditRetentionDays: 365,
      },
      features: {
        previewDeployments: true,
        teamCollaboration: true,
        customDomains: true,
        prioritySupport: true,
        sso: true,
        spendManagement: true,
        webhooks: true,
        apiAccess: true,
      },
      sortOrder: 2,
    },
  ];

  try {
    for (const plan of planData) {
      // Check if plan already exists
      const existing = await db.query.plans.findFirst({
        where: eq(plans.slug, plan.slug),
      });

      if (existing) {
        // Update existing plan
        await db
          .update(plans)
          .set({
            name: plan.name,
            description: plan.description,
            priceMonthly: plan.priceMonthly,
            priceYearly: plan.priceYearly,
            stripePriceIdMonthly: plan.stripePriceIdMonthly,
            stripePriceIdYearly: plan.stripePriceIdYearly,
            limits: plan.limits,
            features: plan.features,
            sortOrder: plan.sortOrder,
            updatedAt: new Date(),
          })
          .where(eq(plans.id, existing.id));
        console.log(`  ✅ Updated plan: ${plan.name}`);
      } else {
        // Insert new plan
        await db.insert(plans).values({
          name: plan.name,
          slug: plan.slug,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          stripePriceIdMonthly: plan.stripePriceIdMonthly,
          stripePriceIdYearly: plan.stripePriceIdYearly,
          limits: plan.limits,
          features: plan.features,
          sortOrder: plan.sortOrder,
          isActive: true,
        });
        console.log(`  ✅ Created plan: ${plan.name}`);
      }
    }

    // Verify
    const allPlans = await db.query.plans.findMany({
      orderBy: (plans, { asc }) => [asc(plans.sortOrder)],
    });
    console.log(`\n💳 Plans seeded successfully! ${allPlans.length} plans in database:`);
    for (const p of allPlans) {
      const price = p.priceMonthly !== null ? `$${(p.priceMonthly / 100).toFixed(2)}/mo` : "Custom";
      console.log(`  - ${p.name} (${p.slug}): ${price}`);
    }
  } catch (error) {
    console.error("❌ Plan seeding failed:", error);
    process.exit(1);
  }
}

seedPlans();
