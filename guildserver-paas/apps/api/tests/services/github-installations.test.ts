/**
 * Installations belong to organizations: one App, many tenants, no leakage.
 */
import { db, users, organizations, githubInstallations } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import {
  installationForOwner,
  installationUrl,
  installationsForOrganization,
  recordInstallation,
  removeInstallation,
  suspendInstallation,
} from '../../src/services/github-installations';

async function tenant(label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `inst-${label}-${stamp}@example.com`, name: label } as any)
    .returning();
  const [org] = await db
    .insert(organizations)
    .values({ name: `${label} ${stamp}`, slug: `${label}-${stamp}`, ownerId: user.id } as any)
    .returning();
  return { user, org };
}

describe('recording installations', () => {
  it('records an installation against the organization that installed it', async () => {
    const { user, org } = await tenant('acme');
    await recordInstallation({
      organizationId: org.id,
      installationId: Date.now(),
      accountLogin: 'acme-inc',
      accountType: 'Organization',
      repositorySelection: 'selected',
      installedByUserId: user.id,
    });

    const rows = await installationsForOrganization(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountLogin).toBe('acme-inc');
    expect(rows[0].installedByUserId).toBe(user.id);
  });

  it('keeps one row when the same installation is seen again', async () => {
    const { org } = await tenant('repeat');
    const installationId = Date.now() + 1;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'repeat-co', repositorySelection: 'selected' });
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'repeat-co', repositorySelection: 'all' });

    const rows = await installationsForOrganization(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].repositorySelection).toBe('all');
  });

  it('forgets an installation that was uninstalled', async () => {
    const { org } = await tenant('gone');
    const installationId = Date.now() + 2;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'gone-co' });
    await removeInstallation(installationId);
    expect(await installationsForOrganization(org.id)).toHaveLength(0);
  });
});

describe('finding an installation for a repository owner', () => {
  it('matches an installation this organization owns', async () => {
    const { org } = await tenant('match');
    await recordInstallation({ organizationId: org.id, installationId: Date.now() + 3, accountLogin: 'match-co' });
    const found = await installationForOwner(org.id, 'match-co');
    expect(found?.accountLogin).toBe('match-co');
  });

  it("never returns another tenant's installation on the same account", async () => {
    const mine = await tenant('mine');
    const theirs = await tenant('theirs');
    await recordInstallation({ organizationId: theirs.org.id, installationId: Date.now() + 4, accountLogin: 'shared-account' });

    // The other tenant installed it; this organization must not inherit access.
    expect(await installationForOwner(mine.org.id, 'shared-account')).toBeNull();
    expect(await installationForOwner(theirs.org.id, 'shared-account')).not.toBeNull();
  });

  it('ignores a suspended installation, which GitHub refuses tokens for', async () => {
    const { org } = await tenant('susp');
    const installationId = Date.now() + 5;
    await recordInstallation({ organizationId: org.id, installationId, accountLogin: 'susp-co' });
    await suspendInstallation(installationId, true);
    expect(await installationForOwner(org.id, 'susp-co')).toBeNull();

    await suspendInstallation(installationId, false);
    expect(await installationForOwner(org.id, 'susp-co')).not.toBeNull();
  });

  it('returns null for an owner nobody installed on', async () => {
    const { org } = await tenant('none');
    expect(await installationForOwner(org.id, 'not-installed')).toBeNull();
  });
});

describe('installationUrl', () => {
  it('points at the App a customer installs themselves', () => {
    expect(installationUrl({ GITHUB_APP_SLUG: 'guildserverauth' } as NodeJS.ProcessEnv)).toBe(
      'https://github.com/apps/guildserverauth/installations/new',
    );
  });

  it('is null when no App is configured, so the UI can hide the button', () => {
    expect(installationUrl({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
