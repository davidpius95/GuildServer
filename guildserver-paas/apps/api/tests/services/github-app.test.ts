/**
 * GitHub App installation tokens: repository access that does not depend on
 * one person's login. GitHub is mocked; the key pair is generated per run.
 */
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  clearInstallationTokens,
  createAppJwt,
  githubAppConfigured,
  installationTokenForRepository,
  parseRepository,
} from '../../src/services/github-app';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const env = { GITHUB_APP_ID: '123456', GITHUB_APP_PRIVATE_KEY: privateKey } as NodeJS.ProcessEnv;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('githubAppConfigured', () => {
  it('is off until both the app id and the private key are set', () => {
    expect(githubAppConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(githubAppConfigured({ GITHUB_APP_ID: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(githubAppConfigured(env)).toBe(true);
  });
});

describe('createAppJwt', () => {
  it('signs with RS256, as the app, back-dated so GitHub accepts it', () => {
    const now = () => 1_700_000_000_000;
    const token = createAppJwt(env, now);
    // Verified at the same instant it was signed: the fixed clock above sits in
    // the past, and jwt.verify would otherwise judge it against today.
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      clockTimestamp: Math.floor(now() / 1000),
    }) as jwt.JwtPayload;
    const issuedAt = Math.floor(now() / 1000);
    expect(decoded.iss).toBe('123456');
    expect(decoded.iat).toBe(issuedAt - 60);
    expect(decoded.exp!).toBeGreaterThan(issuedAt);
    expect(decoded.exp! - decoded.iat!).toBeLessThanOrEqual(10 * 60);
  });

  it('accepts a key pasted into an env var with escaped newlines', () => {
    const escaped = { ...env, GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') };
    expect(() => createAppJwt(escaped)).not.toThrow();
  });
});

describe('installationTokenForRepository', () => {
  beforeEach(() => clearInstallationTokens());

  it('mints a token for the repository installation', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 42 }))
      .mockResolvedValueOnce(json({ token: 'ghs_installation', expires_at: new Date(Date.now() + 3_600_000).toISOString() }));

    await expect(installationTokenForRepository('acme', 'shop', { env, fetchImpl: fetchImpl as any })).resolves.toBe('ghs_installation');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/shop/installation');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.github.com/app/installations/42/access_tokens');
    expect(fetchImpl.mock.calls[1][1].method).toBe('POST');
  });

  it('reuses a cached token until it is close to expiring', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 42 }))
      .mockResolvedValueOnce(json({ token: 'ghs_first', expires_at: new Date(3_600_000).toISOString() }))
      .mockResolvedValueOnce(json({ id: 42 }))
      .mockResolvedValueOnce(json({ token: 'ghs_second', expires_at: new Date(7_200_000).toISOString() }));

    const early = () => 0;
    await expect(installationTokenForRepository('acme', 'shop', { env, fetchImpl: fetchImpl as any, now: early })).resolves.toBe('ghs_first');
    await expect(installationTokenForRepository('ACME', 'Shop', { env, fetchImpl: fetchImpl as any, now: early })).resolves.toBe('ghs_first');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Inside the renewal window: a fresh token is minted rather than risking
    // one that expires mid-clone.
    const nearExpiry = () => 3_600_000 - 60_000;
    await expect(installationTokenForRepository('acme', 'shop', { env, fetchImpl: fetchImpl as any, now: nearExpiry })).resolves.toBe('ghs_second');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('returns null when the app is not configured, without calling GitHub', async () => {
    const fetchImpl = jest.fn();
    await expect(installationTokenForRepository('acme', 'shop', { env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as any })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['the app is not installed on the repository', json({ message: 'Not Found' }, 404)],
    ['GitHub refuses the app credentials', json({ message: 'Bad credentials' }, 401)],
  ])('returns null when %s', async (_label, response) => {
    const fetchImpl = jest.fn().mockResolvedValue(response);
    await expect(installationTokenForRepository('acme', 'shop', { env, fetchImpl: fetchImpl as any })).resolves.toBeNull();
  });

  it('returns null, not an exception, when minting fails or the key is unusable', async () => {
    const mintFails = jest.fn().mockResolvedValueOnce(json({ id: 42 })).mockResolvedValueOnce(json({ message: 'nope' }, 500));
    await expect(installationTokenForRepository('acme', 'shop', { env, fetchImpl: mintFails as any })).resolves.toBeNull();

    const brokenKey = { GITHUB_APP_ID: '123456', GITHUB_APP_PRIVATE_KEY: 'not-a-key' } as NodeJS.ProcessEnv;
    const fetchImpl = jest.fn();
    await expect(installationTokenForRepository('acme', 'shop', { env: brokenKey, fetchImpl: fetchImpl as any })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('parseRepository', () => {
  it.each([
    ['acme/shop', 'acme', 'shop'],
    ['https://github.com/acme/shop', 'acme', 'shop'],
    ['https://github.com/acme/shop.git', 'acme', 'shop'],
    ['git@github.com:acme/shop.git', 'acme', 'shop'],
    ['https://token@github.com/acme/shop', 'acme', 'shop'],
  ])('reads %s', (input, owner, repo) => {
    expect(parseRepository(input)).toEqual({ owner, repo });
  });

  it('returns null for something that is not a repository', () => {
    expect(parseRepository('shop')).toBeNull();
    expect(parseRepository('')).toBeNull();
  });
});
