import jwt from 'jsonwebtoken';
import { db, users, oauthAccounts } from '@guildserver/database';
import { and, eq, like } from 'drizzle-orm';
import {
  closeLinkRedis,
  consumeLinkJti,
  createLinkToken,
  isAllowedLinkOrigin,
  linkOAuthAccountToUser,
  rememberLinkState,
  takeLinkState,
  verifyLinkToken,
} from '../../src/services/oauth-link';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function makeUser() {
  const [u] = await db.insert(users).values({ email: `link-${stamp()}@example.com`, name: 'Link User' } as any).returning();
  return u;
}

afterAll(async () => {
  await closeLinkRedis();
});

describe('link tokens', () => {
  it('round-trips the user and a unique id', () => {
    const a = verifyLinkToken(createLinkToken('user-1', 'github'), 'github');
    const b = verifyLinkToken(createLinkToken('user-1', 'github'), 'github');
    expect(a?.userId).toBe('user-1');
    expect(a?.jti).toBeTruthy();
    expect(a?.jti).not.toBe(b?.jti);
  });

  it('rejects a tampered token', () => {
    const token = createLinkToken('user-1', 'github');
    const [h, p, sig] = token.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString());
    forged.sub = 'someone-else';
    const tampered = [h, Buffer.from(JSON.stringify(forged)).toString('base64url'), sig].join('.');
    expect(verifyLinkToken(tampered, 'github')).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ provider: 'github' }, process.env.JWT_SECRET!, {
      subject: 'user-1', audience: 'guildserver-oauth-link', jwtid: 'x', expiresIn: -10,
    });
    expect(verifyLinkToken(expired, 'github')).toBeNull();
  });

  it('rejects a session JWT used as a link token', () => {
    // A stolen dashboard JWT must not double as permission to link accounts.
    const session = jwt.sign({ userId: 'user-1', email: 'a@b.c' }, process.env.JWT_SECRET!);
    expect(verifyLinkToken(session, 'github')).toBeNull();
  });

  it('rejects a token for another provider, and non-string input', () => {
    const token = jwt.sign({ provider: 'gitlab' }, process.env.JWT_SECRET!, {
      subject: 'user-1', audience: 'guildserver-oauth-link', jwtid: 'x', expiresIn: 60,
    });
    expect(verifyLinkToken(token, 'github')).toBeNull();
    expect(verifyLinkToken(undefined, 'github')).toBeNull();
    expect(verifyLinkToken({} as any, 'github')).toBeNull();
  });

  it('carries its subject as sub, so it cannot pass for a session token', () => {
    const decoded = jwt.decode(createLinkToken('user-1', 'github')) as any;
    expect(decoded.userId).toBeUndefined();
    expect(decoded.sub).toBe('user-1');
  });
});

describe('isAllowedLinkOrigin', () => {
  const FRONTEND = 'https://guild-technologies.com';
  it.each([
    ['https://guild-technologies.com', true],
    ['https://guild-technologies.com:443', true],
    ['https://evil.example', false],
    ['http://guild-technologies.com', false],
    ['https://guild-technologies.com.evil.example', false],
    [undefined, false],
    ['not a url', false],
  ])('%s -> %s', (origin, expected) => {
    expect(isAllowedLinkOrigin(origin as any, FRONTEND)).toBe(expected);
  });
});

describe('single use, backed by Redis', () => {
  it('accepts a token id once', async () => {
    const jti = `jti-${stamp()}`;
    await expect(consumeLinkJti(jti)).resolves.toBe(true);
    await expect(consumeLinkJti(jti)).resolves.toBe(false);
  });

  it('fails closed when Redis is unavailable', async () => {
    const broken = { set: jest.fn().mockRejectedValue(new Error('down')), getdel: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(consumeLinkJti('x', broken)).resolves.toBe(false);
    await expect(rememberLinkState('n', 'u', broken)).resolves.toBe(false);
    await expect(takeLinkState('n', broken)).resolves.toBeNull();
  });

  it('redeems link state exactly once', async () => {
    const nonce = `nonce-${stamp()}`;
    await expect(rememberLinkState(nonce, 'user-7')).resolves.toBe(true);
    await expect(takeLinkState(nonce)).resolves.toBe('user-7');
    await expect(takeLinkState(nonce)).resolves.toBeNull();
    await expect(takeLinkState('')).resolves.toBeNull();
  });
});

describe('linkOAuthAccountToUser', () => {
  it('attaches a new identity to the user', async () => {
    const u = await makeUser();
    const id = `gh-${stamp()}`;
    await expect(
      linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: id, accessToken: 'ghu_a', refreshToken: 'ghr_a' }),
    ).resolves.toEqual({ status: 'linked' });
    const [row] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, id));
    expect(row.userId).toBe(u.id);
    expect(row.refreshToken).toBe('ghr_a');
  });

  it('refreshes an identity the user already has, keeping a refresh token the new grant omits', async () => {
    const u = await makeUser();
    const id = `gh-${stamp()}`;
    await linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: id, accessToken: 'ghu_1', refreshToken: 'ghr_1' });
    await linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: id, accessToken: 'ghu_2' });
    const rows = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].accessToken).toBe('ghu_2');
    expect(rows[0].refreshToken).toBe('ghr_1');
  });

  it('refuses to move an identity owned by a different user', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = `gh-${stamp()}`;
    await linkOAuthAccountToUser({ userId: owner.id, provider: 'github', providerAccountId: id, accessToken: 'ghu_owner' });

    await expect(
      linkOAuthAccountToUser({ userId: other.id, provider: 'github', providerAccountId: id, accessToken: 'ghu_thief' }),
    ).resolves.toEqual({ status: 'conflict' });

    const [row] = await db.select().from(oauthAccounts).where(eq(oauthAccounts.providerAccountId, id));
    expect(row.userId).toBe(owner.id);
    expect(row.accessToken).toBe('ghu_owner');
  });

  it('switches the user to a different account rather than adding a second GitHub row', async () => {
    const u = await makeUser();
    await linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: `gh-old-${stamp()}`, accessToken: 'ghu_old' });
    const newId = `gh-new-${stamp()}`;
    await linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: newId, accessToken: 'ghu_new' });
    const rows = await db.select().from(oauthAccounts).where(and(eq(oauthAccounts.userId, u.id), eq(oauthAccounts.provider, 'github')));
    expect(rows).toHaveLength(1);
    expect(rows[0].providerAccountId).toBe(newId);
  });

  it('never creates a user', async () => {
    const u = await makeUser();
    const before = await db.select().from(users).where(like(users.email, '%users.noreply.github.com'));
    await linkOAuthAccountToUser({ userId: u.id, provider: 'github', providerAccountId: `gh-${stamp()}`, accessToken: 'x' });
    const after = await db.select().from(users).where(like(users.email, '%users.noreply.github.com'));
    expect(after.length).toBe(before.length);
  });
});
