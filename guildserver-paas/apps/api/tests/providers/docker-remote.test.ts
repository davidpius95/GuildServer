/**
 * DockerRemoteProvider against a fake remote daemon and a scripted SSH probe.
 * The Docker service functions are mocked; what matters here is that every
 * operation is aimed at the remote client, never the local daemon.
 */
jest.mock('../../src/services/docker', () => ({
  deployContainer: jest.fn(),
  ensureNetwork: jest.fn().mockResolvedValue(undefined),
  getAppContainerInfo: jest.fn(),
  getContainerLogs: jest.fn(),
  getContainerStats: jest.fn(),
  postDeployHealthCheck: jest.fn(),
  removeExistingContainers: jest.fn(),
  restartContainer: jest.fn(),
  stopContainer: jest.fn(),
  NETWORK_NAME: 'guildserver',
  GS_LABELS: { MANAGED: 'gs.managed' },
}));
jest.mock('../../src/services/node-docker', () => ({
  getLocalDockerClient: jest.fn(() => ({ local: true })),
  transferDockerImage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { DockerRemoteProvider, REMOTE_PROXY_IMAGE } from '../../src/providers/docker-remote';
import { encryptSecret } from '../../src/utils/crypto';
import { sshFingerprint } from '../../src/providers/ssh-host-key';
import * as dockerService from '../../src/services/docker';
import * as nodeDocker from '../../src/services/node-docker';
import type { DeployConfig, DockerRemoteConfig } from '../../src/providers/types';

const svc = dockerService as jest.Mocked<typeof dockerService>;
const transfer = nodeDocker.transferDockerImage as jest.Mock;

const PINNED = sshFingerprint(Buffer.from('the real host key'));
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nplaintext-key-material\n-----END OPENSSH PRIVATE KEY-----';

function stored(over: Partial<DockerRemoteConfig> = {}): DockerRemoteConfig {
  return { connectionType: 'ssh', host: '203.0.113.5', port: 22, sshUser: 'deploy', sshKey: encryptSecret(PRIVATE_KEY)!, hostKeyFingerprint: PINNED, ...over };
}

function fakeDaemon(over: Record<string, any> = {}) {
  const proxy = { start: jest.fn().mockResolvedValue(undefined) };
  return {
    version: jest.fn().mockResolvedValue({ Version: '27.1.1' }),
    info: jest.fn().mockResolvedValue({ Name: 'edge-1', NCPU: 4, MemTotal: 8 * 1024 * 1024 * 1024 }),
    listContainers: jest.fn().mockResolvedValue([]),
    getContainer: jest.fn(() => proxy),
    createContainer: jest.fn().mockResolvedValue(proxy),
    pull: jest.fn((_image: string, cb: any) => cb(null, {})),
    modem: { followProgress: jest.fn((_s: any, done: any) => done(null)) },
    proxy,
    ...over,
  };
}

function build(config: DockerRemoteConfig, daemon = fakeDaemon(), probe = jest.fn()) {
  const createClient = jest.fn(() => daemon as any);
  const provider = new DockerRemoteProvider(config, 'prov-1', { createClient, probe, env: {} as NodeJS.ProcessEnv });
  return { provider, createClient, daemon, probe };
}

const deployConfig = (over: Partial<DeployConfig> = {}): DeployConfig => ({
  deploymentId: 'dep-1', applicationId: 'app-1', appName: 'shop', projectId: 'proj-1', userId: 'user-1',
  dockerImage: 'nginx', dockerTag: '1.27', environment: {}, sourceType: 'docker', applicationConfig: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  svc.deployContainer.mockResolvedValue({ containerId: 'c1', containerName: 'gs-shop', hostPort: 30001, logs: ['deployed'] } as any);
});

describe('connecting', () => {
  it('builds the client from decrypted credentials and a verifier pinned to the stored key', async () => {
    const { provider, createClient } = build(stored());
    await provider.getLogs('app-1');
    const [plain, verifier] = createClient.mock.calls[0] as any;
    expect(plain.sshKey).toBe(PRIVATE_KEY);
    expect(verifier(Buffer.from('the real host key'))).toBe(true);
    expect(verifier(Buffer.from('an impostor'))).toBe(false);
  });

  it('will not operate on an SSH host whose key has never been pinned', async () => {
    const { provider, createClient } = build(stored({ hostKeyFingerprint: undefined }));
    await expect(provider.deploy(deployConfig())).rejects.toThrow(/not pinned/);
    expect(createClient).not.toHaveBeenCalled();
    expect(svc.deployContainer).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '169.254.169.254'])('refuses to operate on %s', async (host) => {
    const { provider, createClient } = build(stored({ host }));
    await expect(provider.stop('app-1')).rejects.toThrow(/not allowed/);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('deploy', () => {
  it('deploys through the remote client and health-checks the remote host', async () => {
    const { provider, daemon } = build(stored());
    const result = await provider.deploy(deployConfig());

    expect(svc.deployContainer).toHaveBeenCalledTimes(1);
    const [opts, client] = svc.deployContainer.mock.calls[0];
    expect(client).toBe(daemon);
    expect(opts).toMatchObject({ applicationId: 'app-1', dockerImage: 'nginx', dockerTag: '1.27', probeHost: '203.0.113.5' });
    expect(result.providerMetadata).toEqual({ provider: 'docker-remote', providerId: 'prov-1', remoteHost: '203.0.113.5' });
    expect(transfer).not.toHaveBeenCalled();
  });

  it('copies a locally built image to the host before deploying it', async () => {
    const { provider, daemon } = build(stored());
    const order: string[] = [];
    transfer.mockImplementationOnce(async () => void order.push('transfer'));
    svc.deployContainer.mockImplementationOnce(async () => {
      order.push('deploy');
      return { containerId: 'c1', containerName: 'gs-shop', hostPort: 30001, logs: [] } as any;
    });

    await provider.deploy(deployConfig({ dockerImage: 'gs-shop', dockerTag: 'abc123' }));
    expect(order).toEqual(['transfer', 'deploy']);
    expect(transfer).toHaveBeenCalledWith('gs-shop:abc123', { local: true }, daemon);
  });

  it('leaves the host\'s ports alone unless the proxy is managed', async () => {
    const { provider, daemon } = build(stored());
    await provider.deploy(deployConfig());
    expect(daemon.createContainer).not.toHaveBeenCalled();
    expect(daemon.listContainers).not.toHaveBeenCalled();
  });

  it('starts a managed proxy when none exists', async () => {
    const { provider, daemon } = build(stored({ manageProxy: true }));
    await provider.deploy(deployConfig());
    expect(daemon.pull).toHaveBeenCalledWith(REMOTE_PROXY_IMAGE, expect.any(Function));
    const spec = daemon.createContainer.mock.calls[0][0];
    expect(spec.HostConfig.PortBindings).toEqual({ '80/tcp': [{ HostPort: '80' }], '443/tcp': [{ HostPort: '443' }] });
    expect(spec.HostConfig.Binds).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');
    expect(spec.Cmd).toContain('--providers.docker.exposedbydefault=false');
    expect(spec.Cmd.join(' ')).not.toMatch(/api\.insecure/);
    expect(daemon.proxy.start).toHaveBeenCalled();
  });

  it('reuses a running proxy and restarts a stopped one', async () => {
    const running = build(stored({ manageProxy: true }), fakeDaemon({ listContainers: jest.fn().mockResolvedValue([{ Id: 'p', State: 'running' }]) }));
    await running.provider.deploy(deployConfig());
    expect(running.daemon.createContainer).not.toHaveBeenCalled();

    const stopped = build(stored({ manageProxy: true }), fakeDaemon({ listContainers: jest.fn().mockResolvedValue([{ Id: 'p', State: 'exited' }]) }));
    await stopped.provider.deploy(deployConfig());
    expect(stopped.daemon.createContainer).not.toHaveBeenCalled();
    expect(stopped.daemon.getContainer).toHaveBeenCalledWith('p');
    expect(stopped.daemon.proxy.start).toHaveBeenCalled();
  });

  it('verifies a deployment against the host address with the remote client', async () => {
    const { provider, daemon } = build(stored());
    svc.postDeployHealthCheck.mockResolvedValue({ healthy: true, message: 'ok' } as any);
    await provider.verifyDeployment({ containerId: 'c1', hostPort: 30001, expectedContainerPort: 80 });
    expect(svc.postDeployHealthCheck).toHaveBeenCalledWith(expect.objectContaining({ dockerClient: daemon, probeHost: '203.0.113.5', hostPort: 30001 }));
  });
});

describe('operations', () => {
  it('aims stop, restart, remove, logs, metrics, info and health at the remote daemon', async () => {
    const { provider, daemon } = build(stored());
    svc.getAppContainerInfo.mockResolvedValue({ containerId: 'c1', containerName: 'gs-shop', status: 'running', ports: [], image: 'nginx', created: new Date() } as any);
    svc.getContainerStats.mockResolvedValue({ cpuPercent: 1, memoryUsageMb: 2, memoryLimitMb: 3, memoryPercent: 4, networkRxBytes: 5, networkTxBytes: 6 } as any);

    await provider.stop('app-1');
    await provider.restart('app-1');
    await provider.remove('app-1');
    await provider.getLogs('app-1', 50);
    await provider.getMetrics('app-1');
    const info = await provider.getInfo('app-1');
    const health = await provider.healthCheck('app-1');

    expect(svc.stopContainer).toHaveBeenCalledWith('app-1', daemon);
    expect(svc.restartContainer).toHaveBeenCalledWith('app-1', daemon);
    expect(svc.removeExistingContainers).toHaveBeenCalledWith('app-1', undefined, daemon);
    expect(svc.getContainerLogs).toHaveBeenCalledWith('app-1', 50, daemon);
    expect(svc.getContainerStats).toHaveBeenCalledWith('app-1', daemon);
    expect(info?.providerMetadata).toEqual({ provider: 'docker-remote', remoteHost: '203.0.113.5' });
    expect(health).toMatchObject({ healthy: true, status: 'running' });
  });
});

describe('testConnection', () => {
  const seenKey = sshFingerprint(Buffer.from('first contact'));

  it('reports an SSH failure without touching Docker', async () => {
    const probe = jest.fn().mockResolvedValue({ reachable: true, authenticated: false, keyMismatch: false, fingerprint: seenKey, error: 'SSH authentication failed' });
    const { provider, createClient } = build(stored({ hostKeyFingerprint: undefined }), fakeDaemon(), probe);
    await expect(provider.testConnection()).resolves.toEqual({ connected: false, message: 'SSH authentication failed', details: { hostKeyFingerprint: seenKey } });
    expect(createClient).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ host: '203.0.113.5', username: 'deploy', privateKey: PRIVATE_KEY, expectedFingerprint: undefined }));
  });

  it('refuses a changed host key and does not offer the new key for pinning', async () => {
    const probe = jest.fn().mockResolvedValue({ reachable: true, authenticated: false, keyMismatch: true, fingerprint: seenKey, error: 'The server presented a different SSH host key than the pinned one' });
    const { provider } = build(stored(), fakeDaemon(), probe);
    const result = await provider.testConnection();
    expect(result.connected).toBe(false);
    expect(result.message).toMatch(/different SSH host key/);
    expect(result.details).toBeUndefined();
  });

  it('reports Docker details and the host key on success, pinning the Docker connection to that key', async () => {
    const probe = jest.fn().mockResolvedValue({ reachable: true, authenticated: true, keyMismatch: false, fingerprint: seenKey });
    const { provider, createClient } = build(stored({ hostKeyFingerprint: undefined }), fakeDaemon(), probe);
    const result = await provider.testConnection();
    expect(result).toEqual({
      connected: true,
      message: 'Connected to Docker 27.1.1 on edge-1',
      details: { version: '27.1.1', resources: { cpuCores: 4, memoryMb: 8192 }, hostKeyFingerprint: seenKey },
    });
    const verifier = (createClient.mock.calls[0] as any)[1];
    expect(verifier(Buffer.from('first contact'))).toBe(true);
    expect(verifier(Buffer.from('someone else'))).toBe(false);
  });

  it('explains when SSH works but Docker does not', async () => {
    const probe = jest.fn().mockResolvedValue({ reachable: true, authenticated: true, keyMismatch: false, fingerprint: seenKey });
    const daemon = fakeDaemon({ version: jest.fn().mockRejectedValue(new Error('permission denied /var/run/docker.sock')) });
    const { provider } = build(stored(), daemon, probe);
    const result = await provider.testConnection();
    expect(result.connected).toBe(false);
    expect(result.message).toMatch(/can this user run it/);
  });

  it('refuses a loopback host before any connection', async () => {
    const probe = jest.fn();
    const { provider, createClient } = build(stored({ host: '127.0.0.1' }), fakeDaemon(), probe);
    await expect(provider.testConnection()).resolves.toMatchObject({ connected: false, message: expect.stringMatching(/loopback/) });
    expect(probe).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('skips the SSH probe for TLS connections', async () => {
    const probe = jest.fn();
    const { provider } = build({ connectionType: 'tls', host: '203.0.113.5', port: 2376, tlsCa: 'ca', tlsCert: 'cert', tlsKey: encryptSecret('key')! }, fakeDaemon(), probe);
    await expect(provider.testConnection()).resolves.toMatchObject({ connected: true });
    expect(probe).not.toHaveBeenCalled();
  });
});
