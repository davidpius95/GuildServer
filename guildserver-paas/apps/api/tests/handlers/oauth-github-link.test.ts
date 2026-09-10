/**
 * Linking GitHub to the signed-in user, end to end.
 *
 * Regression for the duplicate-account bug: this GitHub App cannot read
 * private emails, so connecting GitHub from Settings created a second, empty
 * account instead of attaching GitHub to the user who clicked "Connect".
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { db, users, oauthAccounts } from '@guildserver/database';
import { eq, like } from 'drizzle-orm';
import { oauthRouter } from '../../src/handlers/oauth';
import { closeLinkRedis, createLinkToken } from '../../src/services/oauth-link';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
const originalFetch = global.fetch;
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

function app() {
  const a = express();
  a.use(express.urlencoded({ extended: true }));
  a.use(express.json());
  a.use('/auth', oauthRouter);
  return a;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** GitHub as this platform actually sees it: no readable email. */
function mockGithub(githubUserId: number, login: string) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    if (u.startsWith('https://github.com/login/oauth/access_token')) {
      return jsonResponse({ access_token: `ghu_${login}`, refresh_token: `ghr_${login}`, expires_in: 28800 });
    }
    if (u === 'https://api.github.com/user') {
      return jsonResponse({ id: githubUserId, login, name: login, email: null, avatar_url: '' }, 200, { 'x-oauth-scopes': '' });
    }
    if (u === 'https://api.github.com/user/emails') {
      return jsonResponse({ message: 'Resource not accessible by integration' }, 403);
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  });
}

async function makeUser(email = `real-${stamp()}@example.com`) {
  const [u] = await db.insert(users).values({ email, name: 'Real User' } as any).returning();
  return u;
}

async function startLink(token: string) {
  return request(app()).post('/auth/github/link').set('Origin', FRONTEND).type('form').send({ token, returnTo: '/dashboard/settings' });
}

function stateAndCookie(res: request.Response) {
  const location = new URL(res.headers.location);
  const state = location.searchParams.get('state')!;
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('oauth_state='))!;
  return { state, cookie: cookie.split(';')[0] };
}

async function noreplyUsersFor(githubUserId: number) {
  // The fallback address GitHub sign-in used when it could not read an email.
  return db.select().from(users).where(like(users.email, `${githubUserId}+%@users.noreply.github.com`));
}

beforeAll(() => {
  process.env.GITHUB_CLIENT_ID = 'test-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(async () => {
  await closeLinkRedis();
});

describe('POST /auth/github/link', () => {
  it('rejects a request with no Origin', async () => {
    const res = await request(app()).post('/auth/github/link').type('form').send({ token: createLinkToken('u', 'github') });
    expect(res.status).toBe(403);
  });

  it('rejects a request from another origin', async () => {
    // Otherwise a hostile page could submit its own link token from a victim's
    // browser and attach the victim's GitHub account to the attacker.
    const res = await request(app())
      .post('/auth/github/link')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ token: createLinkToken('u', 'github') });
    expect(res.status).toBe(403);
  });

  it('bounces an invalid token back to Settings', async () => {
    const res = await startLink('not-a-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard/settings?github=link_invalid`);
  });

  it('redirects to GitHub with a state that carries no identity', async () => {
    const u = await makeUser();
    const res = await startLink(createLinkToken(u.id, 'github'));
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);

    const { state, cookie } = stateAndCookie(res);
    expect(cookie).toBe(`oauth_state=${state}`);
    const decoded = Buffer.from(state, 'base64url').toString();
    expect(JSON.parse(decoded).linkPending).toBe(true);
    // Neither the user id nor the token travels through GitHub.
    expect(decoded).not.toContain(u.id);
    expect(decoded).not.toContain('eyJ');
  });

  it('accepts a link token only once', async () => {
    const u = await makeUser();
    const token = createLinkToken(u.id, 'github');
    expect((await startLink(token)).headers.location).toMatch(/^https:\/\/github\.com/);
    const replay = await startLink(token);
    expect(replay.headers.location).toBe(`${FRONTEND}/dashboard/settings?github=link_used`);
  });
});

describe('GET /auth/github/callback in link mode', () => {
  it('attaches GitHub to the signed-in user and creates no account', async () => {
    const u = await makeUser();
    const ghId = 930000000 + Math.floor(Math.random() * 1e6);
    global.fetch = mockGithub(ghId, `link${ghId}`) as any;

    const { state, cookie } = stateAndCookie(await startLink(createLinkToken(u.id, 'github')));
    const res = await request(app()).get('/auth/github/callback').query({ code: 'c', state }).set('Cookie', cookie);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.pathname).toBe('/auth/callback');
    expect(location.searchParams.get('returnTo')).toBe('/dashboard/settings');
    // The session handed back is for the same user who started the link.
    expect((jwt.decode(location.searchParams.get('token')!) as any).userId).toBe(u.id);

    const [row] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, String(ghId)));
    expect(row.userId).toBe(u.id);
    expect(row.refreshToken).toBe(`ghr_link${ghId}`);

    // The bug: a noreply placeholder account used to appear here.
    expect(await noreplyUsersFor(ghId)).toHaveLength(0);
  });

  it('cannot be replayed with the same state', async () => {
    const u = await makeUser();
    const ghId = 940000000 + Math.floor(Math.random() * 1e6);
    global.fetch = mockGithub(ghId, `replay${ghId}`) as any;

    const { state, cookie } = stateAndCookie(await startLink(createLinkToken(u.id, 'github')));
    expect((await request(app()).get('/auth/github/callback').query({ code: 'c', state }).set('Cookie', cookie)).status).toBe(302);

    const replay = await request(app()).get('/auth/github/callback').query({ code: 'c2', state }).set('Cookie', cookie);
    expect(replay.headers.location).toBe(`${FRONTEND}/dashboard/settings?github=link_expired`);
    expect(await noreplyUsersFor(ghId)).toHaveLength(0);
  });

  it('refuses a forged link state rather than creating an account', async () => {
    const ghId = 950000000 + Math.floor(Math.random() * 1e6);
    global.fetch = mockGithub(ghId, `forged${ghId}`) as any;
    const state = Buffer.from(JSON.stringify({ csrf: 'forged-nonce', linkPending: true, scope: 'repo' })).toString('base64url');

    const res = await request(app()).get('/auth/github/callback').query({ code: 'c', state }).set('Cookie', `oauth_state=${state}`);
    expect(res.headers.location).toBe(`${FRONTEND}/dashboard/settings?github=link_expired`);
    expect(await noreplyUsersFor(ghId)).toHaveLength(0);
    expect(await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, String(ghId)))).toHaveLength(0);
  });

  it('refuses to take a GitHub account that belongs to someone else', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const ghId = 960000000 + Math.floor(Math.random() * 1e6);
    await db.insert(oauthAccounts).values({ userId: owner.id, provider: 'github', providerAccountId: String(ghId), accessToken: 'ghu_owner' } as any);
    global.fetch = mockGithub(ghId, `taken${ghId}`) as any;

    const { state, cookie } = stateAndCookie(await startLink(createLinkToken(other.id, 'github')));
    const res = await request(app()).get('/auth/github/callback').query({ code: 'c', state }).set('Cookie', cookie);

    expect(res.headers.location).toBe(`${FRONTEND}/dashboard/settings?github=already_linked`);
    const [row] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, String(ghId)));
    expect(row.userId).toBe(owner.id);
    expect(row.accessToken).toBe('ghu_owner');
  });
});
