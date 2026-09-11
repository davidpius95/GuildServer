import { utils } from 'ssh2';
import { DockerRemoteConfigError, decryptDockerRemoteConfig, prepareDockerRemoteConfig } from '../../src/providers/docker-remote-config';
import { RemoteHostError, assertRemoteHostAllowed } from '../../src/providers/remote-host';
import { encryptSecret } from '../../src/utils/crypto';

const key = utils.generateKeyPairSync('ed25519').private;
const FP = 'SHA256:' + 'A'.repeat(43);
const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));
const ssh = (over: Record<string, unknown> = {}) => ({ connectionType: 'ssh', host: '203.0.113.5', port: 22, sshUser: 'deploy', sshKey: key, ...over });

describe('assertRemoteHostAllowed', () => {
  it.each(['127.0.0.1', '::1', '169.254.169.254', '0.0.0.0', 'fe80::1'])('refuses %s', async (host) => {
    await expect(assertRemoteHostAllowed(host, {} as any)).rejects.toThrow(RemoteHostError);
  });

  it.each(['10.0.0.5', '192.168.1.20', '203.0.113.5', '[2001:db8::5]'])('allows %s', async (host) => {
    await expect(assertRemoteHostAllowed(host, {} as any)).resolves.toBeUndefined();
  });

  it('checks every address a hostname resolves to', async () => {
    await expect(assertRemoteHostAllowed('docker.example.com', {} as any, resolveTo('203.0.113.5', '127.0.0.1'))).rejects.toThrow(/loopback/);
  });

  it('refuses things that are not host names', async () => {
    await expect(assertRemoteHostAllowed('host; rm -rf /', {} as any)).rejects.toThrow(/IP address or a hostname/);
    await expect(assertRemoteHostAllowed('user@host', {} as any)).rejects.toThrow(/IP address or a hostname/);
  });

  it('allows loopback only with the test-rig flag', async () => {
    await expect(assertRemoteHostAllowed('127.0.0.1', { GS_REMOTE_DOCKER_ALLOW_LOOPBACK: '1' } as any)).resolves.toBeUndefined();
  });
});

describe('prepareDockerRemoteConfig', () => {
  it('stores the private key encrypted, and it decrypts back', async () => {
    const stored = await prepareDockerRemoteConfig(ssh());
    expect(stored.sshKey).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(stored)).not.toContain(key.slice(40, 80));
    expect(decryptDockerRemoteConfig(stored).sshKey).toBe(key);
    expect(stored).toMatchObject({ connectionType: 'ssh', host: '203.0.113.5', port: 22, sshUser: 'deploy', manageProxy: false });
  });

  it.each([
    [ssh({ host: '169.254.169.254' }), /link-local/],
    [ssh({ sshKey: 'not a key' }), /private key/],
    [ssh({ sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ngarbage\n-----END OPENSSH PRIVATE KEY-----' }), /could not be read/],
    [ssh({ sshKey: undefined }), /private key or password/],
    [ssh({ sshUser: 'root; id' }), /SSH user/],
    [ssh({ port: 70000 }), /port/],
    [ssh({ hostKeyFingerprint: 'MD5:aa:bb' }), /fingerprint/],
    [ssh({ unexpected: true }), /Unrecognized key/],
    [{ connectionType: 'tls', host: '203.0.113.5', port: 2376, tlsCa: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----' }, /tlsCa, tlsCert and tlsKey/],
  ])('refuses %j', async (config, reason) => {
    const attempt = prepareDockerRemoteConfig(config);
    await expect(attempt).rejects.toThrow(DockerRemoteConfigError);
    await expect(prepareDockerRemoteConfig(config)).rejects.toThrow(reason);
  });

  it('defaults the port by connection type when none is given', async () => {
    expect((await prepareDockerRemoteConfig(ssh({ port: undefined }))).port).toBe(22);
    expect((await prepareDockerRemoteConfig(ssh({ port: '' }))).port).toBe(22);
    const tls = await prepareDockerRemoteConfig({
      connectionType: 'tls', host: '203.0.113.5',
      tlsCa: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----',
      tlsCert: '-----BEGIN CERTIFICATE-----\ny\n-----END CERTIFICATE-----',
      tlsKey: '-----BEGIN PRIVATE KEY-----\nz\n-----END PRIVATE KEY-----',
    });
    expect(tls.port).toBe(2376);
  });

  it('keeps stored secrets and the pin when an update leaves them out', async () => {
    const existing = { ...(await prepareDockerRemoteConfig(ssh())), hostKeyFingerprint: FP };
    const updated = await prepareDockerRemoteConfig(ssh({ sshKey: '', manageProxy: true }), existing);
    expect(updated.sshKey).toBe(existing.sshKey);
    expect(updated.hostKeyFingerprint).toBe(FP);
    expect(updated.manageProxy).toBe(true);
  });

  it('drops the pin when the host changes, so the new host is pinned afresh', async () => {
    const existing = { ...(await prepareDockerRemoteConfig(ssh())), hostKeyFingerprint: FP };
    const moved = await prepareDockerRemoteConfig(ssh({ host: '203.0.113.9', sshKey: '' }), existing);
    expect(moved.hostKeyFingerprint).toBeUndefined();
    expect(moved.sshKey).toBe(existing.sshKey);
  });

  it('decrypts legacy plaintext values unchanged', () => {
    expect(decryptDockerRemoteConfig({ connectionType: 'ssh', host: 'h', port: 22, sshPassword: 'plain' } as any).sshPassword).toBe('plain');
    expect(decryptDockerRemoteConfig({ connectionType: 'ssh', host: 'h', port: 22, sshPassword: encryptSecret('secret')! } as any).sshPassword).toBe('secret');
  });
});
