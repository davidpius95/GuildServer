import { db, instanceTypes } from "./index";
import { eq } from "drizzle-orm";

/**
 * Seed the VPS instance catalog (IaaS). Idempotent — upserts by slug.
 * Prices positioned between Hetzner and DigitalOcean: predictable flat
 * monthly tiers with an equivalent hourly rate (monthly / 730 hours).
 */

const HOURS_PER_MONTH = 730;
// Hourly price stored as micro-cents (millionths of a cent) for sub-cent precision.
const hourlyMicro = (priceMonthlyCents: number) =>
  Math.round((priceMonthlyCents / HOURS_PER_MONTH) * 1_000_000);

type SeedInstance = {
  slug: string;
  name: string;
  family: "shared" | "dedicated";
  description: string;
  vcpu: string;
  ramMb: number;
  storageGb: number;
  transferTb: number;
  priceMonthly: number; // cents
  sortOrder: number;
};

const catalog: SeedInstance[] = [
  // Shared CPU — General Purpose (burstable, best value)
  { slug: "gs-s1", name: "Shared 1", family: "shared", description: "Entry-level apps, bots, and dev environments", vcpu: "1", ramMb: 1024, storageGb: 25, transferTb: 1, priceMonthly: 500, sortOrder: 10 },
  { slug: "gs-s2", name: "Shared 2", family: "shared", description: "Small production apps and APIs", vcpu: "1", ramMb: 2048, storageGb: 50, transferTb: 2, priceMonthly: 1000, sortOrder: 20 },
  { slug: "gs-s3", name: "Shared 3", family: "shared", description: "Standard web apps with a database", vcpu: "2", ramMb: 4096, storageGb: 80, transferTb: 3, priceMonthly: 2000, sortOrder: 30 },
  { slug: "gs-s4", name: "Shared 4", family: "shared", description: "Busy apps and small clusters", vcpu: "4", ramMb: 8192, storageGb: 160, transferTb: 4, priceMonthly: 4000, sortOrder: 40 },
  { slug: "gs-s5", name: "Shared 5", family: "shared", description: "High-traffic apps and multi-service stacks", vcpu: "6", ramMb: 16384, storageGb: 320, transferTb: 6, priceMonthly: 8000, sortOrder: 50 },

  // Dedicated CPU — Performance (no noisy neighbours)
  { slug: "gs-d1", name: "Dedicated 1", family: "dedicated", description: "Consistent performance for production workloads", vcpu: "2", ramMb: 4096, storageGb: 100, transferTb: 4, priceMonthly: 4200, sortOrder: 60 },
  { slug: "gs-d2", name: "Dedicated 2", family: "dedicated", description: "CPU-intensive services and CI/CD", vcpu: "4", ramMb: 8192, storageGb: 200, transferTb: 5, priceMonthly: 8400, sortOrder: 70 },
  { slug: "gs-d3", name: "Dedicated 3", family: "dedicated", description: "Databases and heavy compute", vcpu: "8", ramMb: 16384, storageGb: 400, transferTb: 6, priceMonthly: 16800, sortOrder: 80 },
  { slug: "gs-d4", name: "Dedicated 4", family: "dedicated", description: "Large-scale, latency-sensitive workloads", vcpu: "16", ramMb: 32768, storageGb: 600, transferTb: 8, priceMonthly: 33600, sortOrder: 90 },
];

async function seedInstanceTypes() {
  console.log("🖥️  Seeding VPS instance catalog...");

  try {
    for (const it of catalog) {
      const values = {
        slug: it.slug,
        name: it.name,
        family: it.family,
        description: it.description,
        vcpu: it.vcpu,
        ramMb: it.ramMb,
        storageGb: it.storageGb,
        transferTb: it.transferTb,
        priceMonthly: it.priceMonthly,
        priceHourlyMicro: hourlyMicro(it.priceMonthly),
        sortOrder: it.sortOrder,
        isActive: true,
      };

      const existing = await db.query.instanceTypes.findFirst({
        where: eq(instanceTypes.slug, it.slug),
      });

      if (existing) {
        await db.update(instanceTypes).set({ ...values, updatedAt: new Date() }).where(eq(instanceTypes.id, existing.id));
        console.log(`  ✅ Updated instance type: ${it.slug}`);
      } else {
        await db.insert(instanceTypes).values(values);
        console.log(`  ✅ Created instance type: ${it.slug}`);
      }
    }

    const all = await db.query.instanceTypes.findMany({
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    });
    console.log(`\n🖥️  Instance catalog seeded! ${all.length} types:`);
    for (const t of all) {
      console.log(`  - ${t.slug} (${t.family}): $${(t.priceMonthly / 100).toFixed(2)}/mo`);
    }
  } catch (error) {
    console.error("❌ Instance catalog seeding failed:", error);
    process.exit(1);
  }
  process.exit(0);
}

seedInstanceTypes();
