/**
 * Managing off-site backup storage: who may, what is stored, what is returned,
 * and how a database may point at a storage.
 */
jest.mock('../../src/queues/setup', () => {
  // The database router must never pull in queues/setup here: it opens Redis
  // and starts BullMQ workers that would run queued deploys against real Docker.
  throw new Error('queues/setup must not load in backup storage router tests');
});
const mockProxy = () => new Proxy({ __esModule: true } as any, { get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn())) });
// Explicit, because the router awaits these and calls .catch on the result.
jest.mock('../../src/queues/backups', () => ({
  syncBackupSchedule: jest.fn().mockResolvedValue(undefined),
  addBackupJob: jest.fn().mockResolvedValue({ id: 'job' }),
  addRestoreJob: jest.fn().mockResolvedValue({ id: 'job' }),
}));
jest.mock('../../src/queues/deployment', () => mockProxy());
jest.mock('../../src/services/database-provision', () => mockProxy());
jest.mock('../../src/services/docker/container', () => mockProxy());
jest.mock('../../src/services/docker', () => mockProxy());

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { db, users, organizations, members, projects, databases, s3Storages } from '@guildserver/database';
import { backupStorageRouter } from '../../src/routers/backup-storage';
import { databaseRouter } from '../../src/routers/database';
import { encryptSecret } from '../../src/utils/crypto';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT || 'http://127.0.0.1:9100',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY || 'gs-test-access',
  secretAccessKey: process.env.TEST_S3_SECRET_KEY || 'gs-test-secret-key',
};

function ctx(user: { id: string; email: string; name: string | null }) {
  return { db, req: {} as any, res: {} as any, user: { ...user, role: 'user' }, isAuthenticated: true, isAdmin: false } as any;
}

async function org() {
  const s = stamp();
  const [owner] = await db.insert(users).values({ email: `own-${s}@example.com`, name: 'owner' } as any).returning();
  const [member] = await db.insert(users).values({ email: `mem-${s}@example.com`, name: 'member' } as any).returning();
  const [stranger] = await db.insert(users).values({ email: `str-${s}@example.com`, name: 'stranger' } as any).returning();
  const [o] = await db.insert(organizations).values({ name: `o ${s}`, slug: `o-${s}`, ownerId: owner.id } as any).returning();
  await db.insert(members).values([{ userId: owner.id, organizationId: o.id, role: 'owner' }, { userId: member.id, organizationId: o.id, role: 'member' }] as any);
  const [project] = await db.insert(projects).values({ name: 'p', organizationId: o.id } as any).returning();
  const [database] = await db
    .insert(databases)
    .values({ name: `db-${s}`, type: 'postgresql', databaseName: 'app', username: 'app', password: 'pw', projectId: project.id } as any)
    .returning();
  return { owner, member, stranger, org: o, project, database };
}

async function storedStorage(organizationId: string) {
  const [row] = await db
    .insert(s3Storages)
    .values({ organizationId, name: 's', endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'bucket-x', accessKeyId: encryptSecret('AKIA')!, secretAccessKey: encryptSecret('SECRET')!, forcePathStyle: true } as any)
    .returning();
  return row;
}

const input = (organizationId: string, overrides: Record<string, unknown> = {}) => ({
  organizationId, name: 'offsite', endpoint: S3.endpoint, bucket: 'placeholder-bucket',
  accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey, ...overrides,
});

describe('permissions', () => {
  it('lets members list, without credentials, and hides the organization from strangers', async () => {
    const { owner, member, stranger, org: o } = await org();
    await storedStorage(o.id);
    const rows = await backupStorageRouter.createCaller(ctx(member)).list({ organizationId: o.id });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/accessKeyId|secretAccessKey|AKIA|SECRET/);
    await expect(backupStorageRouter.createCaller(ctx(stranger)).list({ organizationId: o.id })).rejects.toThrow(/not found/i);
    expect(owner).toBeTruthy();
  });

  it('allows only owners and admins to create, test or delete', async () => {
    const { member, org: o } = await org();
    const storage = await storedStorage(o.id);
    const caller = backupStorageRouter.createCaller(ctx(member));
    await expect(caller.create(input(o.id))).rejects.toThrow(/owner or admin/);
    await expect(caller.test({ id: storage.id })).rejects.toThrow(/owner or admin/);
    await expect(caller.delete({ id: storage.id })).rejects.toThrow(/owner or admin/);
  });

  it("does not confirm another organization's storage exists", async () => {
    const a = await org();
    const b = await org();
    const theirs = await storedStorage(b.org.id);
    await expect(backupStorageRouter.createCaller(ctx(a.owner)).test({ id: theirs.id })).rejects.toThrow(/not found/i);
  });
});

describe('create', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('refuses a loopback endpoint before making any connection', async () => {
    delete process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS;
    delete process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS;
    const { owner, org: o } = await org();
    await expect(backupStorageRouter.createCaller(ctx(owner)).create(input(o.id, { endpoint: 'http://127.0.0.1:9100' }))).rejects.toThrow(/loopback/);
    await expect(backupStorageRouter.createCaller(ctx(owner)).create(input(o.id, { endpoint: 'http://169.254.169.254' }))).rejects.toThrow(/link-local/);
    expect(await db.select().from(s3Storages).where(eq(s3Storages.organizationId, o.id))).toHaveLength(0);
  });

  it('refuses an invalid bucket name or a path prefix containing ..', async () => {
    const { owner, org: o } = await org();
    const caller = backupStorageRouter.createCaller(ctx(owner));
    await expect(caller.create(input(o.id, { bucket: 'Bad_Bucket' }))).rejects.toThrow();
    await expect(caller.create(input(o.id, { pathPrefix: 'a/../b' }))).rejects.toThrow(/\.\./);
  });

  (process.env.GS_MINIO_TESTS === '1' ? describe : describe.skip)('against MinIO', () => {
    const bucket = `gs-router-${randomUUID().slice(0, 8)}`;
    beforeAll(async () => {
      const admin = new S3Client({ endpoint: S3.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey } });
      await admin.send(new CreateBucketCommand({ Bucket: bucket }));
      admin.destroy();
    });
    beforeEach(() => {
      process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS = '1';
      process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS = '1';
    });

    it('saves a storage only after a successful round trip, encrypting its credentials', async () => {
      const { owner, org: o } = await org();
      const created = await backupStorageRouter.createCaller(ctx(owner)).create(input(o.id, { bucket }));
      expect(JSON.stringify(created)).not.toMatch(/accessKeyId|secretAccessKey|gs-test-secret-key/);
      expect(created.lastTestOk).toBe(true);

      const [stored] = await db.select().from(s3Storages).where(eq(s3Storages.id, created.id));
      expect(stored.secretAccessKey).not.toBe(S3.secretAccessKey);
      expect(stored.accessKeyId).not.toBe(S3.accessKeyId);
    });

    it('saves nothing when the credentials do not work', async () => {
      const { owner, org: o } = await org();
      await expect(
        backupStorageRouter.createCaller(ctx(owner)).create(input(o.id, { bucket, secretAccessKey: 'not-the-secret' })),
      ).rejects.toThrow(/Could not use this storage/);
      expect(await db.select().from(s3Storages).where(eq(s3Storages.organizationId, o.id))).toHaveLength(0);
    });
  });
});

describe('delete', () => {
  it('refuses while a database uses the storage, and succeeds once it does not', async () => {
    const { owner, org: o, database } = await org();
    const storage = await storedStorage(o.id);
    await db.update(databases).set({ backupStorageId: storage.id }).where(eq(databases.id, database.id));
    const caller = backupStorageRouter.createCaller(ctx(owner));
    await expect(caller.delete({ id: storage.id })).rejects.toThrow(/used by 1 database/);
    await db.update(databases).set({ backupStorageId: null }).where(eq(databases.id, database.id));
    await expect(caller.delete({ id: storage.id })).resolves.toEqual({ success: true });
  });
});

describe('database.updateBackupSettings', () => {
  it("accepts a storage from the database's own organization", async () => {
    const { owner, org: o, database } = await org();
    const storage = await storedStorage(o.id);
    const updated = await databaseRouter.createCaller(ctx(owner)).updateBackupSettings({ id: database.id, backupStorageId: storage.id });
    expect(updated.backupStorageId).toBe(storage.id);
  });

  it("refuses another organization's storage as if it did not exist", async () => {
    const a = await org();
    const b = await org();
    const theirs = await storedStorage(b.org.id);
    await expect(
      databaseRouter.createCaller(ctx(a.owner)).updateBackupSettings({ id: a.database.id, backupStorageId: theirs.id }),
    ).rejects.toThrow(/Backup storage not found/);
  });

  it('ignores a backupDir sent by a client', async () => {
    const { owner, database } = await org();
    const updated = await databaseRouter
      .createCaller(ctx(owner))
      .updateBackupSettings({ id: database.id, backupRetentionDays: 9, backupDir: '/etc' } as any);
    expect(updated.backupDir).toBeNull();
    expect(updated.backupRetentionDays).toBe(9);
  });
});
