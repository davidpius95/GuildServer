/**
 * Regression test for the GitHub OAuth callback.
 *
 * The callback stored only `access_token`. GitHub App user tokens expire
 * after about 8 hours and arrive with a refresh token, so every GitHub
 * connection silently died 8 hours after it was made. This drives the real
 * route end to end, with GitHub mocked, and checks what reaches the database.
 */
import express from 'express';
import request from 'supertest';
import { db, oauthAccounts } from '@guildserver/database';
import { eq } from 'drizzle-orm';
import { oauthRouter } from '../../src/handlers/oauth';

const DAY = 24 * 60 * 60 * 1000;
const originalFetch = global.fetch;

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mockGithub(tokenBody: Record<string, unknown>, githubUserId: number, login: string) {
  return jest.fn(async (url: any) => {
    const u = String(url);
    if (u.startsWith('https://github.com/login/oauth/access_token')) return jsonResponse(tokenBody);
    if (u === 'https://api.github.com/user') {
      return jsonResponse(
        { id: githubUserId, login, name: login, email: `${login}@example.com`, avatar_url: '' },
        { 'x-oauth-scopes': 'user:email, repo' },
      );
    }
    if (u === 'https://api.github.com/user/emails') return jsonResponse([]);
    throw new Error(`unexpected fetch in test: ${u}`);
  });
}

async function runCallback() {
  const app = express();
  app.use('/auth', oauthRouter);
  const state = Buffer.from(JSON.stringify({ csrf: 'test', scope: 'repo' })).toString('base64url');
  return request(app)
    .get('/auth/github/callback')
    .query({ code: 'test-code', state })
    .set('Cookie', `oauth_state=${state}`);
}

async function storedAccount(githubUserId: number) {
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(eq(oauthAccounts.providerAccountId, String(githubUserId)));
  return row;
}

describe('GET /auth/github/callback', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('stores the refresh token and expiry of a GitHub App user token', async () => {
    const id = 900000000 + Math.floor(Math.random() * 1e6);
    const login = `app${id}`;
    global.fetch = mockGithub(
      { access_token: 'ghu_test', refresh_token: 'ghr_test', expires_in: 28800, token_type: 'bearer' },
      id,
      login,
    ) as any;

    const res = await runCallback();
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/auth/callback?token=');

    const row = await storedAccount(id);
    expect(row.accessToken).toBe('ghu_test');
    expect(row.refreshToken).toBe('ghr_test');
    expect(row.tokenExpiresAt).not.toBeNull();
    // About 8 hours out. The margin is wide because timestamps are stored
    // without a time zone; the point is that an expiry was recorded at all.
    const expiresIn = new Date(row.tokenExpiresAt as any).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(-DAY);
    expect(expiresIn).toBeLessThan(2 * DAY);
  });

  it('stores no refresh token or expiry for a classic OAuth App token', async () => {
    const id = 910000000 + Math.floor(Math.random() * 1e6);
    const login = `classic${id}`;
    global.fetch = mockGithub({ access_token: 'gho_test', scope: 'user:email,repo', token_type: 'bearer' }, id, login) as any;

    const res = await runCallback();
    expect(res.status).toBe(302);

    const row = await storedAccount(id);
    expect(row.accessToken).toBe('gho_test');
    expect(row.refreshToken).toBeNull();
    expect(row.tokenExpiresAt).toBeNull();
  });

  it('replaces the refresh token when a returning user reconnects', async () => {
    const id = 920000000 + Math.floor(Math.random() * 1e6);
    const login = `again${id}`;

    global.fetch = mockGithub({ access_token: 'ghu_first', refresh_token: 'ghr_first', expires_in: 28800 }, id, login) as any;
    expect((await runCallback()).status).toBe(302);

    global.fetch = mockGithub({ access_token: 'ghu_second', refresh_token: 'ghr_second', expires_in: 28800 }, id, login) as any;
    expect((await runCallback()).status).toBe(302);

    // GitHub invalidates the first refresh token once the second is issued, so
    // keeping the old one would leave the connection unrenewable.
    const row = await storedAccount(id);
    expect(row.accessToken).toBe('ghu_second');
    expect(row.refreshToken).toBe('ghr_second');
  });
});
