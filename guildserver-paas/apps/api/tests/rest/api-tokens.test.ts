/**
 * Token issuance, authentication and bookkeeping.
 */
jest.mock('../../src/queues/setup', () => {
  // This file needs no queue. If an import ever pulls queues/setup in again it
  // must fail here, not silently start BullMQ workers that would run any
  // deploy job they find against the real Docker daemon.
  throw new Error('queues/setup must not load in token service tests');
});

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, apiTokens, users } from '@guildserver/database';
import {
  authenticateApiToken,
  createApiToken,
  recordApiTokenUse,
  revokeApiToken,
  scopeSatisfies,
} from '../../src/services/api-tokens';
import { addMember, makeOrg, makeUser, makeWorld, removeMember, token } from './fixtures';

describe('token format and storage', () => {
  it('issues gs_pat_ + 43 base64url chars, stores only its SHA-256, and a display prefix', async () => {
    const owner = await makeUser('fmt');
    const org = await makeOrg(owner, 'fmt');
    const { token: raw, record } = await token(org.id, owner.id, ['read']);

    expect(raw).toMatch(/^gs_pat_[A-Za-z0-9_-]{43}$/);
    expect(record.tokenPrefix).toBe(raw.slice(0, 'gs_pat_'.length + 8));
    expect(record.tokenHash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));

    const [stored] = await db.select().from(apiTokens).where(eq(apiTokens.id, record.id));
    // The plaintext must not survive anywhere in the row.
    expect(JSON.stringify(stored)).not.toContain(raw.slice('gs_pat_'.length));
  });

  it('never issues two tokens with the same hash', async () => {
    const owner = await makeUser('uniq');
    const org = await makeOrg(owner, 'uniq');
    const hashes = new Set<string>();
    for (let i = 0; i < 20; i++) hashes.add((await token(org.id, owner.id, ['read'])).record.tokenHash);
    expect(hashes.size).toBe(20);
  });
});

describe('createApiToken validation', () => {
  it('rejects no scopes, unknown scopes, and non-members', async () => {
    const owner = await makeUser('val');
    const stranger = await makeUser('stranger');
    const org = await makeOrg(owner, 'val');
    await expect(token(org.id, owner.id, [])).rejects.toThrow(/scope/i);
    await expect(token(org.id, owner.id, ['superuser'])).rejects.toThrow(/scope/i);
    await expect(token(org.id, stranger.id, ['read'])).rejects.toThrow(/member/i);
  });

  it('rejects a project restriction naming another organization, or an empty one', async () => {
    const owner = await makeUser('proj');
    const orgA = await makeOrg(owner, 'proja');
    const orgB = await makeOrg(owner, 'projb');
    const worldB = await makeWorld(orgB.id, 'b');
    await expect(token(orgA.id, owner.id, ['read'], { projectIds: [worldB.project.id] })).rejects.toThrow(/organization/i);
    // An empty restriction must not be mistaken for "every project".
    await expect(token(orgA.id, owner.id, ['read'], { projectIds: [] })).rejects.toThrow();
  });
});

describe('authenticateApiToken', () => {
  it('resolves a valid token to its user, organization and scopes', async () => {
    const owner = await makeUser('ok');
    const org = await makeOrg(owner, 'ok');
    const { token: raw, record } = await token(org.id, owner.id, ['deploy']);
    const identity = await authenticateApiToken(raw);
    expect(identity).toMatchObject({ tokenId: record.id, organizationId: org.id, userId: owner.id, scopes: ['deploy'], projectIds: null });
  });

  it.each([
    ['malformed', 'not-a-token'],
    ['wrong prefix', `ghp_${'a'.repeat(36)}`],
    ['well-formed but unknown', `gs_pat_${'A'.repeat(43)}`],
  ])('returns null for a %s token', async (_label, raw) => {
    await expect(authenticateApiToken(raw)).resolves.toBeNull();
  });

  it('returns null once revoked', async () => {
    const owner = await makeUser('rev');
    const org = await makeOrg(owner, 'rev');
    const { token: raw, record } = await token(org.id, owner.id, ['read']);
    await revokeApiToken(record.id);
    await expect(authenticateApiToken(raw)).resolves.toBeNull();
  });

  it('returns null once expired', async () => {
    const owner = await makeUser('exp');
    const org = await makeOrg(owner, 'exp');
    const { token: raw } = await token(org.id, owner.id, ['read'], { expiresAt: new Date(Date.now() - 1000) });
    await expect(authenticateApiToken(raw)).resolves.toBeNull();
  });

  it('returns null once the user leaves the organization, with no revocation step', async () => {
    const owner = await makeUser('owner');
    const dev = await makeUser('dev');
    const org = await makeOrg(owner, 'leave');
    await addMember(dev.id, org.id, 'member');
    const { token: raw } = await token(org.id, dev.id, ['read']);
    await expect(authenticateApiToken(raw)).resolves.not.toBeNull();
    await removeMember(dev.id, org.id);
    await expect(authenticateApiToken(raw)).resolves.toBeNull();
  });

  it('returns null once the user is deleted', async () => {
    const owner = await makeUser('owner2');
    const dev = await makeUser('gone');
    const org = await makeOrg(owner, 'gone');
    await addMember(dev.id, org.id, 'member');
    const { token: raw } = await token(org.id, dev.id, ['read']);
    await db.delete(users).where(eq(users.id, dev.id));
    await expect(authenticateApiToken(raw)).resolves.toBeNull();
  });
});

describe('scopeSatisfies', () => {
  it.each([
    [['admin'], 'read', true], [['admin'], 'deploy', true], [['admin'], 'write', true], [['admin'], 'admin', true],
    [['write'], 'read', true], [['write'], 'deploy', false], [['write'], 'write', true], [['write'], 'admin', false],
    [['deploy'], 'read', true], [['deploy'], 'write', false], [['deploy'], 'deploy', true], [['deploy'], 'admin', false],
    [['read'], 'read', true], [['read'], 'deploy', false], [['read'], 'write', false], [['read'], 'admin', false],
  ])('%j satisfies %s: %s', (granted, required, expected) => {
    expect(scopeSatisfies(granted as string[], required as any)).toBe(expected);
  });
});

describe('recordApiTokenUse', () => {
  it('writes at most once per interval', async () => {
    const owner = await makeUser('use');
    const org = await makeOrg(owner, 'use');
    const { token: raw, record } = await token(org.id, owner.id, ['read']);
    const identity = (await authenticateApiToken(raw))!;

    await expect(recordApiTokenUse(identity, '10.0.0.1')).resolves.toBe(true);
    const [first] = await db.select().from(apiTokens).where(eq(apiTokens.id, record.id));
    expect(first.lastUsedAt).not.toBeNull();
    expect(first.lastUsedIp).toBe('10.0.0.1');

    // A second request moments later — even from a stale identity that has not
    // seen the first write — must not rewrite the row.
    await expect(recordApiTokenUse(identity, '10.0.0.2')).resolves.toBe(false);
    const [second] = await db.select().from(apiTokens).where(eq(apiTokens.id, record.id));
    expect(second.lastUsedIp).toBe('10.0.0.1');
  });
});
