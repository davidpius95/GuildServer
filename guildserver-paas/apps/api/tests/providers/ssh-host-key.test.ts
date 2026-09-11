/**
 * Host-key pinning against a real SSH handshake with an in-process ssh2
 * server on loopback. No external host, no Docker.
 */
import { AddressInfo } from 'net';
import { Server, utils } from 'ssh2';
import { FINGERPRINT_PATTERN, pinnedHostVerifier, probeSsh, sshFingerprint } from '../../src/providers/ssh-host-key';

const hostKey = utils.generateKeyPairSync('ed25519');
const allowedClient = utils.generateKeyPairSync('ed25519');
const otherClient = utils.generateKeyPairSync('ed25519');
const allowedPublic = utils.parseKey(allowedClient.public) as any;
const hostFingerprint = sshFingerprint((utils.parseKey(hostKey.public) as any).getPublicSSH());

let server: Server;
let port: number;

beforeAll(async () => {
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    client
      .on('authentication', (ctx: any) => {
        const ok = ctx.method === 'publickey' && ctx.key.algo === allowedPublic.type && Buffer.compare(ctx.key.data, allowedPublic.getPublicSSH()) === 0;
        if (!ok) return ctx.reject(['publickey']);
        if (ctx.signature && !allowedPublic.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) return ctx.reject(['publickey']);
        ctx.accept();
      })
      .on('ready', () => client.end())
      .on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('sshFingerprint', () => {
  it('uses the OpenSSH SHA256 format', () => {
    expect(hostFingerprint).toMatch(FINGERPRINT_PATTERN);
    expect(sshFingerprint(Buffer.from('abc'))).toBe('SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0');
  });
});

describe('pinnedHostVerifier', () => {
  it('accepts anything when nothing is pinned, reporting the key', () => {
    const seen: string[] = [];
    expect(pinnedHostVerifier(undefined, (f) => seen.push(f))(Buffer.from('abc'))).toBe(true);
    expect(seen).toEqual([sshFingerprint(Buffer.from('abc'))]);
  });

  it('accepts only the pinned key', () => {
    const verify = pinnedHostVerifier(sshFingerprint(Buffer.from('abc')));
    expect(verify(Buffer.from('abc'))).toBe(true);
    expect(verify(Buffer.from('abd'))).toBe(false);
  });
});

describe('probeSsh', () => {
  const base = () => ({ host: '127.0.0.1', port, username: 'deploy', timeoutMs: 5_000 });

  it('authenticates and reports the host key when nothing is pinned', async () => {
    const result = await probeSsh({ ...base(), privateKey: allowedClient.private });
    expect(result).toEqual({ reachable: true, authenticated: true, keyMismatch: false, fingerprint: hostFingerprint });
  });

  it('authenticates when the pinned key matches', async () => {
    const result = await probeSsh({ ...base(), privateKey: allowedClient.private, expectedFingerprint: hostFingerprint });
    expect(result.authenticated).toBe(true);
  });

  it('refuses a server presenting a different key before authenticating', async () => {
    const pinnedElsewhere = sshFingerprint(Buffer.from('some other host'));
    const result = await probeSsh({ ...base(), privateKey: allowedClient.private, expectedFingerprint: pinnedElsewhere });
    expect(result).toMatchObject({ reachable: true, authenticated: false, keyMismatch: true });
    expect(result.error).toMatch(/different SSH host key/);
  });

  it('reports failed authentication separately from reachability', async () => {
    const result = await probeSsh({ ...base(), privateKey: otherClient.private });
    expect(result).toMatchObject({ reachable: true, authenticated: false, keyMismatch: false, fingerprint: hostFingerprint });
    expect(result.error).toBe('SSH authentication failed');
  });

  it('reports an address with no SSH server as unreachable', async () => {
    const closed = new Server({ hostKeys: [hostKey.private] }, () => undefined);
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const freePort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const result = await probeSsh({ ...base(), port: freePort, privateKey: allowedClient.private });
    expect(result).toMatchObject({ reachable: false, authenticated: false });
    expect(result.fingerprint).toBeUndefined();
  });
});
