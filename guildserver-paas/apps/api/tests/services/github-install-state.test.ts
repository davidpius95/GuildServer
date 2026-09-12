/**
 * Starting an installation: the nonce carries who installed it and for which
 * organization, because GitHub's post-install redirect identifies nobody.
 */
import { rememberInstallState, takeInstallState, rememberLinkState, takeLinkState } from '../../src/services/oauth-link';

type Stored = { value: string; expiresAt: number };

/** A Redis stand-in with the two operations these helpers use. */
function fakeRedis() {
  const store = new Map<string, Stored>();
  return {
    store,
    async set(key: string, value: string, _ex: string, ttl: number, mode?: string) {
      if (mode === 'NX' && store.has(key)) return null;
      store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
      return 'OK';
    },
    async getdel(key: string) {
      const hit = store.get(key);
      store.delete(key);
      return hit ? hit.value : null;
    },
  };
}

describe('install state', () => {
  it('remembers the installer and their organization, once', async () => {
    const redis = fakeRedis() as any;
    expect(await rememberInstallState('nonce-1', 'user-1', 'org-1', redis)).toBe(true);
    // A replayed nonce must not overwrite the first.
    expect(await rememberInstallState('nonce-1', 'attacker', 'org-9', redis)).toBe(false);

    expect(await takeInstallState('nonce-1', redis)).toEqual({ userId: 'user-1', organizationId: 'org-1' });
  });

  it('can only be redeemed once, so a replayed redirect records nothing', async () => {
    const redis = fakeRedis() as any;
    await rememberInstallState('nonce-2', 'user-1', 'org-1', redis);
    expect(await takeInstallState('nonce-2', redis)).not.toBeNull();
    expect(await takeInstallState('nonce-2', redis)).toBeNull();
  });

  it('returns null for a nonce nobody minted, and for an empty one', async () => {
    const redis = fakeRedis() as any;
    expect(await takeInstallState('never-issued', redis)).toBeNull();
    expect(await takeInstallState('', redis)).toBeNull();
  });

  it('keeps install nonces separate from link nonces', async () => {
    const redis = fakeRedis() as any;
    await rememberInstallState('shared-nonce', 'user-1', 'org-1', redis);
    await rememberLinkState('shared-nonce', 'user-2', redis);

    // Neither flow can redeem the other's nonce as its own.
    expect(await takeLinkState('shared-nonce', redis)).toBe('user-2');
    expect(await takeInstallState('shared-nonce', redis)).toEqual({ userId: 'user-1', organizationId: 'org-1' });
  });

  it('refuses the install when Redis is unavailable, rather than proceeding blind', async () => {
    const broken = {
      async set() { throw new Error('ECONNREFUSED'); },
      async getdel() { throw new Error('ECONNREFUSED'); },
    } as any;
    expect(await rememberInstallState('nonce-3', 'user-1', 'org-1', broken)).toBe(false);
    expect(await takeInstallState('nonce-3', broken)).toBeNull();
  });
});
