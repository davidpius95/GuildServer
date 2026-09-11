/**
 * Database backups: credentials never in a command, dumps confined to the
 * backup root, streaming with checksums, off-site copies, and restores that
 * refuse corrupt data. Docker is mocked; MinIO is used when GS_MINIO_TESTS=1.
 */
const mockStreamExec = jest.fn();
const mockGetAppContainer = jest.fn();
jest.mock('../../src/services/docker/container', () => ({
  streamExecInContainer: (...args: any[]) => mockStreamExec(...args),
  getAppContainer: (...args: any[]) => mockGetAppContainer(...args),
}));

import { createHash, randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import { eq } from 'drizzle-orm';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db, users, organizations, projects, databases, databaseBackups, s3Storages } from '@guildserver/database';
import { encryptSecret } from '../../src/utils/crypto';

const BACKUP_ROOT = path.join(os.tmpdir(), `gs-backup-root-${randomUUID().slice(0, 8)}`);
process.env.BACKUP_DIR = BACKUP_ROOT;
// Required after BACKUP_DIR is set: the module reads it at load time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const backup = require('../../src/services/db-backup') as typeof import('../../src/services/db-backup');
const { DatabaseBackupService, ENGINES, backupDirFor } = backup;

const HOSTILE = { databaseName: 'appdb', username: 'app', password: `p'"; $(touch /tmp/pwned) \`id\` $HOME` };

describe('engine commands', () => {
  it.each(Object.keys(ENGINES))('%s never places the password in a command', (engine) => {
    for (const phase of ['dump', 'restore'] as const) {
      const { cmd, env } = ENGINES[engine][phase](HOSTILE);
      expect({ engine, phase, leaked: cmd.some((part) => part.includes(HOSTILE.password)) }).toEqual({ engine, phase, leaked: false });
      if (engine !== 'redis' || phase === 'dump') {
        expect(env.some((e) => e.endsWith(HOSTILE.password))).toBe(true);
      }
    }
  });

  it('puts no user-supplied value inside a shell script', () => {
    const hostileUser = { ...HOSTILE, username: 'u"; rm -rf / #' };
    for (const engine of ['mongodb', 'redis']) {
      for (const phase of ['dump', 'restore'] as const) {
        const { cmd } = ENGINES[engine][phase](hostileUser);
        if (cmd[0] === 'sh') expect(cmd[2]).not.toMatch(/rm -rf|touch|pwned/);
      }
    }
  });

  it('passes PostgreSQL names only in --option=value form, so they cannot become options', () => {
    const { cmd } = ENGINES.postgresql.dump({ ...HOSTILE, databaseName: '--file=/tmp/x' });
    expect(cmd).toContain('--dbname=--file=/tmp/x');
    expect(cmd).not.toContain('--file=/tmp/x');
  });

  it.each(['-rf', '--result-file=/etc/x', 'a b', 'x;y', ''])('refuses MySQL database name %j', (name) => {
    expect(() => ENGINES.mysql.dump({ ...HOSTILE, databaseName: name })).toThrow(/cannot be passed safely/);
    expect(() => ENGINES.mariadb.restore({ ...HOSTILE, databaseName: name })).toThrow(/cannot be passed safely/);
  });
});

describe('backupDirFor', () => {
  it('uses the backup root by default and honours a directory inside it', () => {
    expect(backupDirFor({ id: 'db1' })).toBe(path.join(BACKUP_ROOT, 'db1'));
    expect(backupDirFor({ id: 'db1', backupDir: path.join(BACKUP_ROOT, 'custom') })).toBe(path.join(BACKUP_ROOT, 'custom'));
  });

  it.each(['/etc', '/app/apps/api/src', `${BACKUP_ROOT}/../elsewhere`, `${BACKUP_ROOT}-evil`, BACKUP_ROOT])(
    'ignores %s and falls back to the default',
    (dir) => {
      expect(backupDirFor({ id: 'db1', backupDir: dir })).toBe(path.join(BACKUP_ROOT, 'db1'));
    },
  );
});

// ---------------------------------------------------------------------------

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const minio = process.env.GS_MINIO_TESTS === '1';
const S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT || 'http://127.0.0.1:9100',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY || 'gs-test-access',
  secretAccessKey: process.env.TEST_S3_SECRET_KEY || 'gs-test-secret-key',
};
const bucket = `gs-backup-${randomUUID().slice(0, 8)}`;

async function world(opts: { storage?: 'good' | 'bad' | 'none' } = {}) {
  const s = stamp();
  const [user] = await db.insert(users).values({ email: `bk-${s}@example.com`, name: 'bk' } as any).returning();
  const [org] = await db.insert(organizations).values({ name: `bk ${s}`, slug: `bk-${s}`, ownerId: user.id } as any).returning();
  const [project] = await db.insert(projects).values({ name: 'p', organizationId: org.id } as any).returning();
  let storageId: string | null = null;
  if (opts.storage && opts.storage !== 'none') {
    const [storage] = await db
      .insert(s3Storages)
      .values({
        organizationId: org.id, name: 'minio', endpoint: S3.endpoint, region: 'us-east-1', bucket, pathPrefix: `t-${s}`,
        accessKeyId: encryptSecret(S3.accessKeyId)!,
        secretAccessKey: encryptSecret(opts.storage === 'good' ? S3.secretAccessKey : 'wrong-secret')!,
        forcePathStyle: true,
      } as any)
      .returning();
    storageId = storage.id;
  }
  const [database] = await db
    .insert(databases)
    .values({ name: `db-${s}`, type: 'postgresql', databaseName: 'app', username: 'app', password: 'pw', projectId: project.id, backupStorageId: storageId } as any)
    .returning();
  return { org, database, storageId };
}

function execReturning(bytes: Buffer, exitCode = 0, stderr = '') {
  mockStreamExec.mockImplementationOnce(async () => {
    const stdout = new PassThrough();
    const completed = new Promise<{ exitCode: number; stderr: string }>((resolve) => {
      stdout.on('end', () => resolve({ exitCode, stderr }));
    });
    setImmediate(() => stdout.end(bytes));
    return { stdout, completed };
  });
}

/** Capture what a restore feeds into the container. */
function execCapturingStdin() {
  const captured: { data?: Buffer } = {};
  mockStreamExec.mockImplementationOnce(async (_id: string, _cmd: string[], options: { stdin?: Readable }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of options.stdin!) chunks.push(chunk as Buffer);
    captured.data = Buffer.concat(chunks);
    const stdout = new PassThrough();
    stdout.end();
    return { stdout, completed: Promise.resolve({ exitCode: 0, stderr: '' }) };
  });
  return captured;
}

async function row(id: string) {
  const [r] = await db.select().from(databaseBackups).where(eq(databaseBackups.id, id));
  return r;
}

const originalEnv = { ...process.env };

beforeAll(async () => {
  await fsp.mkdir(BACKUP_ROOT, { recursive: true });
  if (minio) {
    process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS = '1';
    process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS = '1';
    const admin = new S3Client({ endpoint: S3.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey } });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    admin.destroy();
  }
});

afterAll(async () => {
  process.env = originalEnv;
  await fsp.rm(BACKUP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  mockStreamExec.mockReset();
  mockGetAppContainer.mockReset().mockResolvedValue({ id: 'container-1', restart: jest.fn() });
});

describe('runBackup', () => {
  it('streams the dump to disk with its size and SHA-256, passing secrets only in env', async () => {
    const { database } = await world();
    const dump = Buffer.from('PGDMP fake dump contents');
    execReturning(dump);
    const record = await DatabaseBackupService.triggerBackup(database.id);

    await DatabaseBackupService.runBackup(record.id);

    const r = await row(record.id);
    expect(r.status).toBe('completed');
    expect(r.sizeBytes).toBe(dump.length);
    expect(r.checksumSha256).toBe(createHash('sha256').update(dump).digest('hex'));
    expect(r.filePath!.startsWith(path.join(BACKUP_ROOT, database.id))).toBe(true);
    expect(Buffer.compare(await fsp.readFile(r.filePath!), dump)).toBe(0);

    const [, cmd, options] = mockStreamExec.mock.calls[0];
    expect(cmd.join(' ')).not.toContain('pw');
    expect(options.env).toContain('PGPASSWORD=pw');
  });

  it('marks the backup failed and removes the partial file when the dump command fails', async () => {
    const { database } = await world();
    execReturning(Buffer.from('partial'), 1, 'pg_dump: error: connection failed');
    const record = await DatabaseBackupService.triggerBackup(database.id);

    await expect(DatabaseBackupService.runBackup(record.id)).rejects.toThrow(/connection failed/);
    const r = await row(record.id);
    expect(r.status).toBe('failed');
    const dir = path.join(BACKUP_ROOT, database.id);
    expect((await fsp.readdir(dir).catch(() => [])).length).toBe(0);
  });

  it('refuses an empty dump rather than recording it as a backup', async () => {
    const { database } = await world();
    execReturning(Buffer.alloc(0));
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await expect(DatabaseBackupService.runBackup(record.id)).rejects.toThrow(/no output/);
    expect((await row(record.id)).status).toBe('failed');
  });
});

describe('restoreBackup', () => {
  async function completedBackup(bytes: Buffer, storage: 'none' | 'good' = 'none') {
    const w = await world({ storage });
    execReturning(bytes);
    const record = await DatabaseBackupService.triggerBackup(w.database.id);
    await DatabaseBackupService.runBackup(record.id);
    return { ...w, backup: await row(record.id) };
  }

  it('restores a local copy that matches its checksum, streaming it into the container', async () => {
    const data = Buffer.from('good dump');
    const { backup: b } = await completedBackup(data);
    const captured = execCapturingStdin();
    await expect(DatabaseBackupService.restoreBackup(b.id)).resolves.toBe(true);
    expect(Buffer.compare(captured.data!, data)).toBe(0);
  });

  it('refuses to restore a local copy that has been altered, and never touches the database', async () => {
    const { backup: b } = await completedBackup(Buffer.from('original dump'));
    mockStreamExec.mockClear(); // the backup itself used the mock; only the restore is under test
    await fsp.writeFile(b.filePath!, 'tampered dump');
    await expect(DatabaseBackupService.restoreBackup(b.id)).rejects.toThrow(/checksum/);
    expect(mockStreamExec).not.toHaveBeenCalled();
  });

  it('refuses when there is no local copy and nothing off-site', async () => {
    const { backup: b } = await completedBackup(Buffer.from('dump'));
    mockStreamExec.mockClear();
    await fsp.rm(b.filePath!);
    await expect(DatabaseBackupService.restoreBackup(b.id)).rejects.toThrow(/no local copy/);
    expect(mockStreamExec).not.toHaveBeenCalled();
  });
});

(minio ? describe : describe.skip)('off-site copies (MinIO)', () => {
  it('uploads after a successful backup and restores from the off-site copy when the local one is lost', async () => {
    const data = Buffer.from(`offsite dump ${randomUUID()}`);
    const { database } = await world({ storage: 'good' });
    execReturning(data);
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(record.id);

    const r = await row(record.id);
    expect(r.remoteKey).toContain(`database-backups/${database.id}/`);
    expect(r.uploadedAt).not.toBeNull();
    expect(r.uploadError).toBeNull();

    await fsp.rm(r.filePath!);
    const captured = execCapturingStdin();
    await DatabaseBackupService.restoreBackup(record.id);
    expect(Buffer.compare(captured.data!, data)).toBe(0);
  });

  it('falls back to the off-site copy when the local copy is corrupt', async () => {
    const data = Buffer.from(`fallback dump ${randomUUID()}`);
    const { database } = await world({ storage: 'good' });
    execReturning(data);
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(record.id);
    const r = await row(record.id);
    await fsp.writeFile(r.filePath!, 'bit rot');

    const captured = execCapturingStdin();
    await DatabaseBackupService.restoreBackup(record.id);
    expect(Buffer.compare(captured.data!, data)).toBe(0);
  });

  it('refuses to restore an off-site copy that has been altered, and never touches the database', async () => {
    const { database } = await world({ storage: 'good' });
    execReturning(Buffer.from(`honest dump ${randomUUID()}`));
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(record.id);
    const r = await row(record.id);

    // Local copy gone, and the object in the bucket replaced behind our back.
    await fsp.rm(r.filePath!);
    const admin = new S3Client({ endpoint: S3.endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey } });
    await admin.send(new PutObjectCommand({ Bucket: bucket, Key: r.remoteKey!, Body: 'swapped dump' }));
    admin.destroy();

    mockStreamExec.mockClear();
    await expect(DatabaseBackupService.restoreBackup(record.id)).rejects.toThrow(/off-site copy does not match its checksum/);
    expect(mockStreamExec).not.toHaveBeenCalled();
  });

  it('keeps a completed local backup, and records why, when the off-site copy fails', async () => {
    const { database } = await world({ storage: 'bad' });
    execReturning(Buffer.from('dump'));
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(record.id);

    const r = await row(record.id);
    expect(r.status).toBe('completed');
    expect(r.remoteKey).toBeNull();
    expect(r.uploadError).toBeTruthy();
    expect(r.uploadError).not.toContain('wrong-secret');
  });

  it('refuses a storage that belongs to another organization', async () => {
    const mine = await world();
    const theirs = await world({ storage: 'good' });
    await db.update(databases).set({ backupStorageId: theirs.storageId }).where(eq(databases.id, mine.database.id));
    execReturning(Buffer.from('dump'));
    const record = await DatabaseBackupService.triggerBackup(mine.database.id);
    await DatabaseBackupService.runBackup(record.id);

    const r = await row(record.id);
    expect(r.remoteKey).toBeNull();
    expect(r.uploadError).toMatch(/another organization|no longer exists/);
  });

  it('deletes both copies, and reports failure when the off-site copy cannot be removed', async () => {
    const { database, storageId } = await world({ storage: 'good' });
    execReturning(Buffer.from('dump'));
    const record = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(record.id);
    const r = await row(record.id);

    await expect(DatabaseBackupService.deleteBackupArtifacts(r)).resolves.toBe(true);
    await expect(fsp.access(r.filePath!)).rejects.toBeDefined();

    // A second backup whose storage credentials have since broken.
    execReturning(Buffer.from('dump2'));
    const second = await DatabaseBackupService.triggerBackup(database.id);
    await DatabaseBackupService.runBackup(second.id);
    const r2 = await row(second.id);
    await db.update(s3Storages).set({ secretAccessKey: encryptSecret('now-wrong')! }).where(eq(s3Storages.id, storageId!));
    await expect(DatabaseBackupService.deleteBackupArtifacts(r2)).resolves.toBe(false);
  });
});
