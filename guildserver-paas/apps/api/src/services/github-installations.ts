/**
 * GitHub App installations, owned by organizations.
 *
 * One App serves every tenant. A customer installs it on their own GitHub
 * account and GuildServer records the installation against their organization,
 * so deploys can clone with a credential belonging to the installation rather
 * than to whoever connected the repository — with nothing configured per tenant
 * by an operator.
 *
 * The tenant boundary lives here: an installation recorded by one organization
 * is never offered to another, and a repository is only ever matched against
 * installations that organization owns.
 */

import { db, githubInstallations } from "@guildserver/database";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface RecordInstallationInput {
  organizationId: string;
  installationId: number;
  accountLogin: string;
  accountType?: string | null;
  repositorySelection?: string | null;
  installedByUserId?: string | null;
}

/**
 * Record an installation, or update it if GitHub has seen it before.
 * Re-installing on the same account keeps one row rather than accumulating.
 */
export async function recordInstallation(
  input: RecordInstallationInput,
  database: typeof db = db,
): Promise<void> {
  const now = new Date();
  const existing = await database.query.githubInstallations.findFirst({
    where: eq(githubInstallations.installationId, input.installationId),
  });

  if (existing) {
    await database
      .update(githubInstallations)
      .set({
        organizationId: input.organizationId,
        accountLogin: input.accountLogin,
        accountType: input.accountType ?? existing.accountType,
        repositorySelection: input.repositorySelection ?? existing.repositorySelection,
        installedByUserId: input.installedByUserId ?? existing.installedByUserId,
        suspendedAt: null,
        updatedAt: now,
      })
      .where(eq(githubInstallations.id, existing.id));
    return;
  }

  await database.insert(githubInstallations).values({
    organizationId: input.organizationId,
    installationId: input.installationId,
    accountLogin: input.accountLogin,
    accountType: input.accountType ?? null,
    repositorySelection: input.repositorySelection ?? null,
    installedByUserId: input.installedByUserId ?? null,
  });
}

/** Forget an installation when GitHub says it was uninstalled. */
export async function removeInstallation(installationId: number, database: typeof db = db): Promise<void> {
  await database.delete(githubInstallations).where(eq(githubInstallations.installationId, installationId));
  logger.info("GitHub App installation removed", { installationId });
}

/** Mark an installation suspended; GitHub keeps it but refuses tokens. */
export async function suspendInstallation(
  installationId: number,
  suspended: boolean,
  database: typeof db = db,
): Promise<void> {
  await database
    .update(githubInstallations)
    .set({ suspendedAt: suspended ? new Date() : null, updatedAt: new Date() })
    .where(eq(githubInstallations.installationId, installationId));
}

/** Every installation this organization owns. */
export async function installationsForOrganization(
  organizationId: string,
  database: typeof db = db,
): Promise<(typeof githubInstallations.$inferSelect)[]> {
  return database.query.githubInstallations.findMany({
    where: eq(githubInstallations.organizationId, organizationId),
  });
}

/**
 * The installation this organization owns that covers `owner`, or null.
 *
 * Matching is by account login, and scoped to the organization: another
 * tenant's installation on the same account is not visible here, which is what
 * keeps one App from widening what a tenant can reach.
 */
export async function installationForOwner(
  organizationId: string,
  owner: string,
  database: typeof db = db,
): Promise<typeof githubInstallations.$inferSelect | null> {
  const rows = await database.query.githubInstallations.findMany({
    where: and(
      eq(githubInstallations.organizationId, organizationId),
      eq(githubInstallations.accountLogin, owner),
    ),
  });
  const usable = rows.find((row) => !row.suspendedAt);
  return usable ?? null;
}

/** Where a customer goes to install the App on their own account. */
export function installationUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const slug = env.GITHUB_APP_SLUG;
  if (!slug) return null;
  return `https://github.com/apps/${slug}/installations/new`;
}

/**
 * Update what we know about an installation GitHub just told us about.
 * An installation with no recorded organization is ignored: only the install
 * callback knows whose it is, and guessing would hand one tenant another's
 * repositories.
 */
export async function refreshInstallationFromPayload(
  installationId: number,
  payload: { installation?: { account?: { login?: string; type?: string }; repository_selection?: string } },
  database: typeof db = db,
): Promise<void> {
  const existing = await database.query.githubInstallations.findFirst({
    where: eq(githubInstallations.installationId, installationId),
  });
  if (!existing) {
    logger.info("Ignoring an installation event for an installation we have no organization for", { installationId });
    return;
  }

  await database
    .update(githubInstallations)
    .set({
      accountLogin: payload.installation?.account?.login ?? existing.accountLogin,
      accountType: payload.installation?.account?.type ?? existing.accountType,
      repositorySelection: payload.installation?.repository_selection ?? existing.repositorySelection,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.id, existing.id));
}
