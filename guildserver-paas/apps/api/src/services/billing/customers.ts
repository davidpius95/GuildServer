import { db, organizations } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { requireStripe } from "./client";

export async function createCustomer(organizationId: string): Promise<string> {
  const s = requireStripe();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org) throw new Error(`Organization ${organizationId} not found`);

  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  const customer = await s.customers.create({
    name: org.name,
    metadata: {
      organizationId: org.id,
      organizationSlug: org.slug,
    },
  });

  await db
    .update(organizations)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizations.id, organizationId));

  logger.info(`Created Stripe customer ${customer.id} for org ${org.name}`);
  return customer.id;
}

export async function getOrCreateCustomerId(organizationId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!org) throw new Error(`Organization ${organizationId} not found`);
  if (org.stripeCustomerId) return org.stripeCustomerId;

  return createCustomer(organizationId);
}
