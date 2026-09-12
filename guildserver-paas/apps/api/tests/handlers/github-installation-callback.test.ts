/**
 * The post-install redirect from GitHub.
 *
 * It carries an installation id and no identity, so the state nonce minted by
 * github.createInstallIntent is the only thing that says who installed the App
 * and for which organization. Anything else must record nothing: guessing an
 * owner would hand one tenant another tenant's repositories.
 */
import express from 'express';
import request from 'supertest';
import { db, users, organizations, githubInstallations } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import { oauthRouter } from '../../src/handlers/oauth';
import { closeLinkRedis, rememberInstallState } from '../../src/services/oauth-link';

const originalFetch = global.fetch;

function app() {
  const server = express();
  server.use('/auth', oauthRouter);
  return server;
}

async function tenant(label: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ email: `cb-${label}-${stamp}@example.com`, name: label } as any)
    .returning();
  const [org] = await db
    .insert(organizations)
    .values({ name: `${label} ${stamp}`, slug: `${label}-${stamp}`, ownerId: user.id } as any)
    .returning();
  return { user, org };
}

/** GitHub answering the App's lookup of one installation. */
function mockInstallation(accountLogin: string, ok = true) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    if (u.startsWith('https://api.github.com/app/installations/')) {
      if (!ok) return new Response('{"message":"Not Found"}', { status: 404 });
      return new Response(
        JSON.stringify({ account: { login: accountLogin, type: 'User' }, repository_selection: 'selected' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  });
}

describe('GET /auth/github/installation', () => {
  const realAppId = process.env.GITHUB_APP_ID;
  const realKey = process.env.GITHUB_APP_PRIVATE_KEY;

  beforeAll(() => {
    // A real key is not needed: installationDetails only has to reach fetch.
    const { generateKeyPairSync } = require('crypto');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.GITHUB_APP_ID = '4059711';
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  });

  afterAll(async () => {
    process.env.GITHUB_APP_ID = realAppId;
    process.env.GITHUB_APP_PRIVATE_KEY = realKey;
    global.fetch = originalFetch;
    // The route builds a lazy Redis client; without this jest never exits.
    await closeLinkRedis();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('records the installation against the organization that started it', async () => {
    const { user, org } = await tenant('ok');
    const installationId = Date.now() + 101;
    const nonce = `nonce-ok-${installationId}`;
    expect(await rememberInstallState(nonce, user.id, org.id)).toBe(true);
    global.fetch = mockInstallation('ok-account') as any;

    const response = await request(app())
      .get(`/auth/github/installation?installation_id=${installationId}&setup_action=install&state=${nonce}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toMatch(/github=installed/);

    const [row] = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    expect(row.organizationId).toBe(org.id);
    expect(row.accountLogin).toBe('ok-account');
    expect(row.installedByUserId).toBe(user.id);
  });

  it('records nothing when the state nonce is missing', async () => {
    const installationId = Date.now() + 102;
    global.fetch = mockInstallation('nobody') as any;

    const response = await request(app()).get(`/auth/github/installation?installation_id=${installationId}&setup_action=install`);

    expect(response.headers.location).toMatch(/install_unmatched/);
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    expect(rows).toHaveLength(0);
  });

  it('records nothing when the state nonce is replayed', async () => {
    const { user, org } = await tenant('replay');
    const installationId = Date.now() + 103;
    const nonce = `nonce-replay-${installationId}`;
    await rememberInstallState(nonce, user.id, org.id);
    global.fetch = mockInstallation('replay-account') as any;

    const first = await request(app())
      .get(`/auth/github/installation?installation_id=${installationId}&setup_action=install&state=${nonce}`);
    expect(first.headers.location).toMatch(/github=installed/);

    const second = await request(app())
      .get(`/auth/github/installation?installation_id=${installationId + 1}&setup_action=install&state=${nonce}`);
    expect(second.headers.location).toMatch(/install_unmatched/);

    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId + 1));
    expect(rows).toHaveLength(0);
  });

  it('records nothing when an owner has only requested the install', async () => {
    const response = await request(app()).get('/auth/github/installation?setup_action=request');
    expect(response.headers.location).toMatch(/install_requested/);
  });

  it('records nothing when GitHub will not describe the installation', async () => {
    const { user, org } = await tenant('unread');
    const installationId = Date.now() + 104;
    const nonce = `nonce-unread-${installationId}`;
    await rememberInstallState(nonce, user.id, org.id);
    global.fetch = mockInstallation('unused', false) as any;

    const response = await request(app())
      .get(`/auth/github/installation?installation_id=${installationId}&setup_action=install&state=${nonce}`);

    expect(response.headers.location).toMatch(/install_unreadable/);
    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.installationId, installationId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a redirect with no usable installation id', async () => {
    const response = await request(app()).get('/auth/github/installation?installation_id=not-a-number&setup_action=install');
    expect(response.headers.location).toMatch(/install_invalid/);
  });
});
