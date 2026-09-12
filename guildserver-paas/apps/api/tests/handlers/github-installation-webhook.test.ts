/**
 * Installation lifecycle over the webhook: GitHub tells us when an App is
 * removed, suspended or re-scoped. An installation we have no organization
 * for is ignored — only the install callback knows whose it is, and guessing
 * would hand one tenant another tenant's repositories.
 */
import { db, users, organizations, githubInstallations } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import {
  installationForOwner,
  recordInstallation,
  refreshInstallationFromPayload,
  removeInstallation,
  suspendInstallation,
} from '../../src/services/github-installations';

async function tenant(label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `hook-${label}-${stamp}@example.com`, name: label } as any)
    .returning();
  const [org] = await db
    .insert(organizations)
    .values({ name: `${label} ${stamp}`, slug: `${label}-${stamp}`, ownerId: user.id } as any)
    .returning();
  return { user, org };
}

const payloadFor = (login: string, selection = 'selected', type = 'User') => ({
  installation: { account: { login, type }, repository_selection: selection },
});

describe('installation lifecycle', () => {
  it('forgets an installation when GitHub says it was deleted', async () => {
    const { org } = await tenant('del');
    const installationId = Date.now() + 11;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'del-co' });

    await removeInstallation(installationId);

    expect(await installationForOwner(org.id, 'del-co')).toBeNull();
  });

  it('stops offering a suspended installation, and offers it again when unsuspended', async () => {
    const { org } = await tenant('susp2');
    const installationId = Date.now() + 12;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'susp2-co' });

    await suspendInstallation(installationId, true);
    expect(await installationForOwner(org.id, 'susp2-co')).toBeNull();

    await suspendInstallation(installationId, false);
    expect(await installationForOwner(org.id, 'susp2-co')).not.toBeNull();
  });

  it('updates the account and repository scope from the event', async () => {
    const { org } = await tenant('scope');
    const installationId = Date.now() + 13;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'scope-co', repositorySelection: 'selected' });

    await refreshInstallationFromPayload(installationId, payloadFor('scope-co', 'all', 'Organization'));

    const [row] = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    expect(row.repositorySelection).toBe('all');
    expect(row.accountType).toBe('Organization');
  });

  it('ignores an installation it has never seen, rather than guessing an owner', async () => {
    const unknownId = Date.now() + 14;

    await refreshInstallationFromPayload(unknownId, payloadFor('someone-elses-account'));

    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, unknownId));
    expect(rows).toHaveLength(0);
  });

  it('never moves an installation to a different organization on a webhook', async () => {
    const mine = await tenant('keep');
    const installationId = Date.now() + 15;
    await recordInstallation({ organizationId: mine.org.id, installationId, accountLogin: 'keep-co' });

    await refreshInstallationFromPayload(installationId, payloadFor('keep-co', 'all'));

    const [row] = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    expect(row.organizationId).toBe(mine.org.id);
  });
});
