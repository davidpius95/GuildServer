/**
 * S3 storage: endpoint safety (tenants choose endpoints the server connects
 * to), key construction, error hygiene, and a real round trip against the
 * loopback MinIO from docker-compose.test.yml when GS_MINIO_TESTS=1.
 */
import { randomBytes, randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  StorageError,
  assertSafeEndpoint,
  classifyAddress,
  configFromRow,
  deleteObject,
  describeStorageError,
  downloadToFile,
  objectKey,
  testStorage,
  uploadFile,
  type StorageConfig,
} from '../../src/services/storage/s3';
import { encryptSecret } from '../../src/utils/crypto';

const resolver = (map: Record<string, string[]>) => async (host: string) =>
  (map[host] ?? []).map((address) => ({ address }));

describe('classifyAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'], ['127.8.9.10', 'loopback'], ['::1', 'loopback'], ['::ffff:127.0.0.1', 'loopback'],
    ['169.254.169.254', 'link-local'], ['fe80::1', 'link-local'],
    ['10.1.2.3', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'], ['fd00::1', 'private'],
    ['0.0.0.0', 'unspecified'], ['::', 'unspecified'],
    ['8.8.8.8', 'public'], ['172.32.0.1', 'public'], ['2606:4700::1111', 'public'],
  ])('%s is %s', (ip, kind) => {
    expect(classifyAddress(ip)).toBe(kind);
  });
});

describe('assertSafeEndpoint', () => {
  const none = {} as NodeJS.ProcessEnv;
  const allowPrivate = { GS_S3_ALLOW_PRIVATE_ENDPOINTS: '1' } as NodeJS.ProcessEnv;

  it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://x', 'not a url'])('refuses %s', async (endpoint) => {
    await expect(assertSafeEndpoint(endpoint, none, resolver({}))).rejects.toThrow(StorageError);
  });

  it('refuses credentials embedded in the URL', async () => {
    await expect(
      assertSafeEndpoint('https://user:pass@s3.example.com', none, resolver({ 's3.example.com': ['8.8.8.8'] })),
    ).rejects.toThrow(/credentials/);
  });

  it.each([
    ['http://127.0.0.1:9000', 'loopback'],
    ['http://[::1]:9000', 'loopback'],
    ['http://169.254.169.254/latest/meta-data', 'link-local'],
    ['http://0.0.0.0:9000', 'unspecified'],
  ])('refuses %s (%s) even when private endpoints are allowed', async (endpoint, kind) => {
    await expect(assertSafeEndpoint(endpoint, allowPrivate, resolver({}))).rejects.toThrow(kind);
  });

  it('checks every address a hostname resolves to, not just how it is spelled', async () => {
    // A friendly-looking name with one record pointing at the metadata service must not pass.
    await expect(
      assertSafeEndpoint('https://backups.example.com', none, resolver({ 'backups.example.com': ['8.8.8.8', '169.254.169.254'] })),
    ).rejects.toThrow(/link-local/);
  });

  it('refuses private addresses unless the operator allows them', async () => {
    const r = resolver({ 'minio.lan': ['192.168.1.50'] });
    await expect(assertSafeEndpoint('http://minio.lan:9000', none, r)).rejects.toThrow(/private/);
    await expect(assertSafeEndpoint('http://minio.lan:9000', allowPrivate, r)).resolves.toBeUndefined();
  });

  it('allows loopback only when both operator flags are set', async () => {
    const loopbackOnly = { GS_S3_ALLOW_LOOPBACK_ENDPOINTS: '1' } as NodeJS.ProcessEnv;
    const both = { GS_S3_ALLOW_PRIVATE_ENDPOINTS: '1', GS_S3_ALLOW_LOOPBACK_ENDPOINTS: '1' } as NodeJS.ProcessEnv;
    await expect(assertSafeEndpoint('http://127.0.0.1:9100', loopbackOnly, resolver({}))).rejects.toThrow(/loopback/);
    await expect(assertSafeEndpoint('http://127.0.0.1:9100', both, resolver({}))).resolves.toBeUndefined();
    // The loopback flag never unlocks link-local.
    await expect(assertSafeEndpoint('http://169.254.169.254', both, resolver({}))).rejects.toThrow(/link-local/);
  });

  it('accepts a public endpoint', async () => {
    await expect(
      assertSafeEndpoint('https://s3.example.com', none, resolver({ 's3.example.com': ['52.216.1.1'] })),
    ).resolves.toBeUndefined();
  });

  it('refuses a hostname that does not resolve', async () => {
    await expect(assertSafeEndpoint('https://nowhere.invalid', none, resolver({}))).rejects.toThrow(/resolved/);
  });
});

describe('objectKey', () => {
  it('joins the prefix and parts, trimming slashes', () => {
    expect(objectKey({ pathPrefix: '/team-a/' }, 'database-backups', 'db1', 'x.dump')).toBe('team-a/database-backups/db1/x.dump');
    expect(objectKey({ pathPrefix: null }, 'a', 'b')).toBe('a/b');
  });

  // The control character is built at runtime so this source stays plain text.
  it.each(['../escape', '/abs', '', `bad${String.fromCharCode(1)}byte`])('refuses the part %j', (part) => {
    expect(() => objectKey({ pathPrefix: null }, part)).toThrow(StorageError);
  });
});

describe('describeStorageError', () => {
  it('reports the code and status without signed query parameters', () => {
    const error = Object.assign(
      new Error('failed https://s3/x?X-Amz-Credential=AKIA123/abc&X-Amz-Signature=deadbeef'),
      { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
    );
    const text = describeStorageError(error);
    expect(text).toMatch(/AccessDenied \(HTTP 403\)/);
    expect(text).not.toMatch(/AKIA123|deadbeef/);
  });
});

describe('configFromRow', () => {
  const row = {
    endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'b', pathPrefix: null, forcePathStyle: true,
  };

  it('decrypts stored credentials', () => {
    const cfg = configFromRow({ ...row, accessKeyId: encryptSecret('AKIA-REAL')!, secretAccessKey: encryptSecret('s3cr3t')! });
    expect(cfg.accessKeyId).toBe('AKIA-REAL');
    expect(cfg.secretAccessKey).toBe('s3cr3t');
  });
});

const minio = process.env.GS_MINIO_TESTS === '1' ? describe : describe.skip;

minio('against MinIO', () => {
  const endpoint = process.env.TEST_S3_ENDPOINT || 'http://127.0.0.1:9100';
  const bucket = `gs-test-${randomUUID().slice(0, 8)}`;
  const cfg: StorageConfig = {
    endpoint,
    region: 'us-east-1',
    bucket,
    pathPrefix: 'unit',
    accessKeyId: process.env.TEST_S3_ACCESS_KEY || 'gs-test-access',
    secretAccessKey: process.env.TEST_S3_SECRET_KEY || 'gs-test-secret-key',
    forcePathStyle: true,
  };
  const savedPrivate = process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS;
  const savedLoopback = process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS;
  let tmp: string;

  beforeAll(async () => {
    process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS = '1';
    process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS = '1';
    const admin = new S3Client({
      endpoint, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    admin.destroy();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gs-s3-'));
  });

  afterAll(async () => {
    if (savedPrivate === undefined) delete process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS;
    else process.env.GS_S3_ALLOW_PRIVATE_ENDPOINTS = savedPrivate;
    if (savedLoopback === undefined) delete process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS;
    else process.env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS = savedLoopback;
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('passes the connection test with valid credentials', async () => {
    await expect(testStorage(cfg)).resolves.toEqual({ ok: true });
  });

  it('fails the connection test with a wrong secret, without echoing it', async () => {
    const result = await testStorage({ ...cfg, secretAccessKey: 'definitely-wrong-secret' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('definitely-wrong-secret');
  });

  it('round-trips a multipart-sized file byte for byte, then deletes it', async () => {
    const source = path.join(tmp, 'source.bin');
    const back = path.join(tmp, 'back.bin');
    const data = randomBytes(20 * 1024 * 1024); // above the 16 MiB part size, so multipart is exercised
    await fsp.writeFile(source, data);
    const key = objectKey(cfg, 'roundtrip', 'source.bin');

    await uploadFile(cfg, key, source);
    await downloadToFile(cfg, key, back);
    expect(Buffer.compare(await fsp.readFile(back), data)).toBe(0);

    await deleteObject(cfg, key);
    await expect(downloadToFile(cfg, key, path.join(tmp, 'gone.bin'))).rejects.toBeDefined();
  }, 60_000);
});
