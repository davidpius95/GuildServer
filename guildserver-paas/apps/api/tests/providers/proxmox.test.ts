import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the database module (used by findVMIDForApp for DB-based VMID lookup)
const mockFindFirst = jest.fn().mockResolvedValue(null);
jest.mock('@guildserver/database', () => ({
  db: {
    query: {
      deployments: { findFirst: (...args: any[]) => mockFindFirst(...args) },
    },
  },
  deployments: { applicationId: 'applicationId', lxcVmId: 'lxcVmId', createdAt: 'createdAt' },
}));

// Mock drizzle-orm operators
jest.mock('drizzle-orm', () => ({
  eq: jest.fn((...args: any[]) => ({ op: 'eq', args })),
  desc: jest.fn((...args: any[]) => ({ op: 'desc', args })),
  and: jest.fn((...args: any[]) => ({ op: 'and', args })),
  isNotNull: jest.fn((...args: any[]) => ({ op: 'isNotNull', args })),
}));

// Mock the ProxmoxClient before importing ProxmoxProvider
jest.mock('../../src/services/proxmox-client');

// Mock the logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the node-docker module (Docker client pool)
jest.mock('../../src/services/node-docker', () => ({
  getDockerClient: jest.fn().mockReturnValue({
    ping: jest.fn().mockResolvedValue('OK'),
    listContainers: jest.fn().mockResolvedValue([]),
    getContainer: jest.fn(),
    createContainer: jest.fn(),
    getNetwork: jest.fn().mockReturnValue({ inspect: jest.fn().mockResolvedValue({}) }),
    createNetwork: jest.fn().mockResolvedValue({}),
    pull: jest.fn(),
    modem: { followProgress: jest.fn() },
  }),
  getLocalDockerClient: jest.fn(),
  removeClient: jest.fn(),
  removeClientByHost: jest.fn(),
  clearPool: jest.fn(),
  testDockerClient: jest.fn().mockResolvedValue(false),
  waitForDockerReady: jest.fn().mockResolvedValue(undefined),
}));

// Mock the docker service functions used by ProxmoxProvider
jest.mock('../../src/services/docker', () => ({
  deployContainer: jest.fn().mockResolvedValue({
    containerId: 'docker-abc123',
    containerName: 'gs-my-test-app-deploy-1',
    hostPort: 10001,
    logs: ['Container deployed'],
  }),
  pullImage: jest.fn().mockResolvedValue(['Pulling image...', 'Done']),
  removeExistingContainers: jest.fn().mockResolvedValue(undefined),
  getAppContainer: jest.fn().mockResolvedValue(null),
  getAppContainerInfo: jest.fn().mockResolvedValue(null),
  getContainerLogs: jest.fn().mockResolvedValue(['log line 1', 'log line 2']),
  getContainerStats: jest.fn().mockResolvedValue(null),
  stopContainer: jest.fn().mockResolvedValue(true),
  restartContainer: jest.fn().mockResolvedValue(true),
  GS_LABELS: {
    MANAGED: 'gs.managed',
    APP_ID: 'gs.app.id',
    APP_NAME: 'gs.app.name',
    DEPLOYMENT_ID: 'gs.deployment.id',
    PROJECT_ID: 'gs.project.id',
    TYPE: 'gs.type',
  },
}));

import { ProxmoxProvider } from '../../src/providers/proxmox';
import { ProxmoxClient } from '../../src/services/proxmox-client';
import { waitForDockerReady, testDockerClient } from '../../src/services/node-docker';
import { deployContainer, pullImage, getContainerLogs, getContainerStats } from '../../src/services/docker';
import type { DeployConfig } from '../../src/providers/types';

const MockedProxmoxClient = ProxmoxClient as jest.MockedClass<typeof ProxmoxClient>;

const testConfig = {
  host: '192.168.1.100',
  port: 8006,
  tokenId: 'root@pam!test',
  tokenSecret: 'secret',
  node: 'pve',
  storage: 'local-lvm',
  bridge: 'vmbr0',
};

const deployConfig: DeployConfig = {
  deploymentId: 'deploy-123',
  applicationId: 'app-456',
  appName: 'my-test-app',
  projectId: 'proj-789',
  userId: 'user-001',
  dockerImage: 'nginx',
  dockerTag: 'latest',
  environment: { NODE_ENV: 'production' },
  memoryLimit: 512,
  cpuLimit: 1,
  containerPort: 3000,
  sourceType: 'docker',
};

beforeEach(() => {
  MockedProxmoxClient.mockClear();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('ProxmoxProvider', () => {
  describe('constructor', () => {
    it('should have type "proxmox"', () => {
      const provider = new ProxmoxProvider(testConfig);
      expect(provider.type).toBe('proxmox');
    });

    it('should instantiate ProxmoxClient with the correct config', () => {
      new ProxmoxProvider(testConfig);

      expect(MockedProxmoxClient).toHaveBeenCalledTimes(1);
      expect(MockedProxmoxClient).toHaveBeenCalledWith({
        host: '192.168.1.100',
        port: 8006,
        tokenId: 'root@pam!test',
        tokenSecret: 'secret',
        allowInsecure: true,
      });
    });

    it('should accept an optional providerId', () => {
      const provider = new ProxmoxProvider(testConfig, 'provider-abc');
      expect(provider.type).toBe('proxmox');
    });
  });

  // -------------------------------------------------------------------------
  // deploy()
  // -------------------------------------------------------------------------

  describe('deploy()', () => {
    it('should create an LXC, start it, wait for IP, deploy Docker, and return a valid DeployResult', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listTemplates = jest.fn().mockResolvedValue([
        { volid: 'local:vztmpl/ubuntu-22.04-standard.tar.zst', format: 'tar.zst', size: 100000 },
      ]);
      mockClient.getNextVMID = jest.fn().mockResolvedValue(100);
      mockClient.createLXC = jest.fn().mockResolvedValue('UPID:pve:00001:00000001:create');
      mockClient.waitForTask = jest.fn()
        .mockResolvedValueOnce({ status: 'OK' })   // creation
        .mockResolvedValueOnce({ status: 'OK' });   // start
      mockClient.startLXC = jest.fn().mockResolvedValue('UPID:pve:00002:00000002:start');
      mockClient.getLXCInterfaces = jest.fn().mockResolvedValue([
        {
          name: 'eth0',
          hwaddr: '00:11:22:33:44:55',
          'ip-addresses': [
            { 'ip-address': '192.168.1.50', 'ip-address-type': 'inet', prefix: 24 },
          ],
        },
      ]);

      const result = await provider.deploy(deployConfig);

      // With Docker deployment inside LXC, we get real Docker container info
      expect(result.containerId).toBe('docker-abc123');
      expect(result.containerName).toBe('gs-my-test-app-deploy-1');
      expect(result.hostPort).toBe(10001);
      expect(result.logs).toBeInstanceOf(Array);
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.providerMetadata).toBeDefined();
      expect(result.providerMetadata!.vmid).toBe(100);
      expect(result.providerMetadata!.provider).toBe('proxmox');
      expect(result.providerMetadata!.lxcIp).toBe('192.168.1.50');
      expect(result.providerMetadata!.dockerContainerId).toBe('docker-abc123');

      // Verify createLXC was called with nesting=1 and correct hostname
      expect(mockClient.createLXC).toHaveBeenCalledTimes(1);
      const createArgs = mockClient.createLXC.mock.calls[0];
      expect(createArgs[0]).toBe('pve'); // node
      expect(createArgs[1].features).toBe('nesting=1');
      expect(createArgs[1].hostname).toBe('gs-my-test-app');

      // Verify Docker deployment was attempted
      expect(waitForDockerReady).toHaveBeenCalled();
      expect(pullImage).toHaveBeenCalled();
      expect(deployContainer).toHaveBeenCalled();
    });

    it('should throw when LXC creation fails', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listTemplates = jest.fn().mockResolvedValue([
        { volid: 'local:vztmpl/ubuntu-22.04-standard.tar.zst', format: 'tar.zst', size: 100000 },
      ]);
      mockClient.getNextVMID = jest.fn().mockResolvedValue(101);
      mockClient.createLXC = jest.fn().mockResolvedValue('UPID:pve:create-fail');
      mockClient.waitForTask = jest.fn().mockResolvedValueOnce({
        status: 'Error',
        exitstatus: 'creation failed',
      });

      await expect(provider.deploy(deployConfig)).rejects.toThrow('LXC creation failed');
    });

    it('should succeed with lxcIp null when IP wait times out', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listTemplates = jest.fn().mockResolvedValue([
        { volid: 'local:vztmpl/ubuntu-22.04-standard.tar.zst', format: 'tar.zst', size: 100000 },
      ]);
      mockClient.getNextVMID = jest.fn().mockResolvedValue(102);
      mockClient.createLXC = jest.fn().mockResolvedValue('UPID:pve:create');
      mockClient.waitForTask = jest.fn()
        .mockResolvedValueOnce({ status: 'OK' })   // creation
        .mockResolvedValueOnce({ status: 'OK' });   // start
      mockClient.startLXC = jest.fn().mockResolvedValue('UPID:pve:start');
      // getLXCInterfaces throws a timeout error to simulate IP wait failure
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(
        new Error('Timed out waiting for LXC 102 to obtain an IP address after 60000ms'),
      );

      // Spy on the private waitForLXCIP method to make it fail quickly
      // instead of actually polling for 60 seconds.
      const waitSpy = jest.spyOn(provider as any, 'waitForLXCIP')
        .mockRejectedValue(new Error('Timed out waiting for LXC 102 to obtain an IP address'));

      const result = await provider.deploy(deployConfig);

      // Should NOT throw; deploy succeeds but with null IP and a warning log
      expect(result.containerId).toBe('pve-102');
      expect(result.providerMetadata!.lxcIp).toBeNull();
      // There should be a warning in the logs about the IP timeout
      expect(result.logs.some((l: string) =>
        l.toLowerCase().includes('warning') ||
        l.toLowerCase().includes('timed out') ||
        l.toLowerCase().includes('ip')
      )).toBe(true);

      // Docker deployment should NOT have been attempted (no IP)
      expect(deployContainer).not.toHaveBeenCalled();

      waitSpy.mockRestore();
    });

    it('should succeed even if Docker deployment inside LXC fails', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listTemplates = jest.fn().mockResolvedValue([
        { volid: 'local:vztmpl/ubuntu-22.04-standard.tar.zst', format: 'tar.zst', size: 100000 },
      ]);
      mockClient.getNextVMID = jest.fn().mockResolvedValue(103);
      mockClient.createLXC = jest.fn().mockResolvedValue('UPID:pve:create');
      mockClient.waitForTask = jest.fn()
        .mockResolvedValueOnce({ status: 'OK' })   // creation
        .mockResolvedValueOnce({ status: 'OK' });   // start
      mockClient.startLXC = jest.fn().mockResolvedValue('UPID:pve:start');
      mockClient.getLXCInterfaces = jest.fn().mockResolvedValue([
        {
          name: 'eth0',
          'ip-addresses': [{ 'ip-address': '192.168.1.51', 'ip-address-type': 'inet', prefix: 24 }],
        },
      ]);

      // Make waitForDockerReady throw to simulate Docker not being available
      (waitForDockerReady as jest.Mock).mockRejectedValueOnce(
        new Error('Docker daemon did not become ready within 60000ms'),
      );

      const result = await provider.deploy(deployConfig);

      // Deploy should succeed despite Docker failure — LXC is running
      expect(result.containerId).toBe('pve-103');
      expect(result.providerMetadata!.lxcIp).toBe('192.168.1.51');
      // Warning should be in logs
      expect(result.logs.some((l: string) =>
        l.toLowerCase().includes('warning') || l.toLowerCase().includes('docker')
      )).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('should stop the LXC without throwing', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.waitForTask = jest.fn().mockResolvedValue({ status: 'OK' });

      await expect(provider.stop('my-test-app')).resolves.toBeUndefined();
    });

    it('should throw when no LXC is found for the application', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([]);

      await expect(provider.stop('nonexistent-app')).rejects.toThrow(
        'No Proxmox LXC container found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // restart()
  // -------------------------------------------------------------------------

  describe('restart()', () => {
    it('should stop and start a running LXC and return true', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({ status: 'running', name: 'gs-my-test-app' });
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.startLXC = jest.fn().mockResolvedValue('UPID:pve:start');
      mockClient.waitForTask = jest.fn()
        .mockResolvedValueOnce({ status: 'OK' })   // stop
        .mockResolvedValueOnce({ status: 'OK' });   // start

      const result = await provider.restart('my-test-app');
      expect(result).toBe(true);
    });

    it('should return false when stop fails during restart', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({ status: 'running', name: 'gs-my-test-app' });
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.waitForTask = jest.fn().mockResolvedValueOnce({
        status: 'Error',
        exitstatus: 'stop failed',
      });

      const result = await provider.restart('my-test-app');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // remove()
  // -------------------------------------------------------------------------

  describe('remove()', () => {
    it('should stop a running LXC and destroy it', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({ status: 'running', name: 'gs-my-test-app' });
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.destroyLXC = jest.fn().mockResolvedValue('UPID:pve:destroy');
      mockClient.waitForTask = jest.fn()
        .mockResolvedValueOnce({ status: 'OK' })   // stop
        .mockResolvedValueOnce({ status: 'OK' });   // destroy

      await expect(provider.remove('my-test-app')).resolves.toBeUndefined();
      expect(mockClient.destroyLXC).toHaveBeenCalledWith('pve', 100);
    });

    it('should not throw when no LXC is found (idempotent removal)', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([]);

      await expect(provider.remove('nonexistent-app')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getLogs()
  // -------------------------------------------------------------------------

  describe('getLogs()', () => {
    it('should return Docker logs when Docker is reachable inside LXC', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockResolvedValue([
        {
          name: 'eth0',
          'ip-addresses': [{ 'ip-address': '192.168.1.50', 'ip-address-type': 'inet', prefix: 24 }],
        },
      ]);

      // Mock testDockerClient to return true (Docker reachable)
      (testDockerClient as jest.Mock).mockResolvedValueOnce(true);

      const logs = await provider.getLogs('my-test-app');

      expect(Array.isArray(logs)).toBe(true);
      expect(logs).toEqual(['log line 1', 'log line 2']);
      expect(getContainerLogs).toHaveBeenCalled();
    });

    it('should return fallback messages when Docker is not reachable', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));

      const logs = await provider.getLogs('my-test-app');

      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.includes('not available'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getMetrics()
  // -------------------------------------------------------------------------

  describe('getMetrics()', () => {
    it('should return Docker container metrics when Docker is reachable', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockResolvedValue([
        {
          name: 'eth0',
          'ip-addresses': [{ 'ip-address': '192.168.1.50', 'ip-address-type': 'inet', prefix: 24 }],
        },
      ]);

      (testDockerClient as jest.Mock).mockResolvedValueOnce(true);
      (getContainerStats as jest.Mock).mockResolvedValueOnce({
        cpuPercent: 5.5,
        memoryUsageMb: 128,
        memoryLimitMb: 512,
        memoryPercent: 25,
        networkRxBytes: 5000,
        networkTxBytes: 3000,
      });

      const metrics = await provider.getMetrics('my-test-app');

      expect(metrics).not.toBeNull();
      expect(metrics!.cpuPercent).toBe(5.5);
      expect(metrics!.memoryUsageMb).toBe(128);
    });

    it('should fall back to LXC metrics when Docker is not reachable', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({
        vmid: 100,
        name: 'gs-my-test-app',
        status: 'running',
        mem: 268435456,       // 256 MB in bytes
        maxmem: 536870912,    // 512 MB in bytes
        cpu: 0.25,
        maxcpu: 2,
        netin: 1000,
        netout: 2000,
        disk: 0,
        maxdisk: 0,
        uptime: 3600,
      });

      const metrics = await provider.getMetrics('my-test-app');

      expect(metrics).not.toBeNull();
      expect(metrics!.memoryUsageMb).toBe(256);
      expect(metrics!.memoryLimitMb).toBe(512);
      expect(metrics!.memoryPercent).toBe(50);
      // CPU: (0.25 / 2) * 100 = 12.5
      expect(metrics!.cpuPercent).toBe(12.5);
      expect(metrics!.networkRxBytes).toBe(1000);
      expect(metrics!.networkTxBytes).toBe(2000);
    });

    it('should return null when no LXC is found', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([]);

      const metrics = await provider.getMetrics('nonexistent-app');
      expect(metrics).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck()
  // -------------------------------------------------------------------------

  describe('healthCheck()', () => {
    it('should return healthy=true for a running LXC', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({
        status: 'running',
        name: 'gs-my-test-app',
        uptime: 3600,
      });
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));

      const result = await provider.healthCheck('my-test-app');
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('running');
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it('should return healthy=false for a stopped LXC', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'stopped', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({
        status: 'stopped',
        name: 'gs-my-test-app',
        uptime: 0,
      });

      const result = await provider.healthCheck('my-test-app');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('stopped');
    });

    it('should return healthy=false when no LXC is found', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([]);

      const result = await provider.healthCheck('nonexistent-app');
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('not_found');
    });
  });

  // -------------------------------------------------------------------------
  // testConnection()
  // -------------------------------------------------------------------------

  describe('testConnection()', () => {
    it('should return connected=true with version and resource details', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.testConnection = jest.fn().mockResolvedValue({
        connected: true,
        message: 'Connected to Proxmox VE 8.0',
        version: '8.0',
        nodes: 1,
      });
      mockClient.getNodeStatus = jest.fn().mockResolvedValue({
        cpu: 0.1,
        maxcpu: 8,
        mem: 4294967296,
        maxmem: 17179869184,   // ~16384 MB
        disk: 10737418240,
        maxdisk: 107374182400, // ~102400 MB
        uptime: 86400,
        status: 'online',
      });

      const result = await provider.testConnection();

      expect(result.connected).toBe(true);
      expect(result.message).toBe('Connected to Proxmox VE 8.0');
      expect(result.details).toBeDefined();
      expect(result.details!.version).toBe('8.0');
      expect(result.details!.nodeCount).toBe(1);
      expect(result.details!.resources).toBeDefined();
      expect(result.details!.resources!.cpuCores).toBe(8);
      expect(result.details!.resources!.memoryMb).toBe(Math.round(17179869184 / (1024 * 1024)));
    });
  });

  // -------------------------------------------------------------------------
  // findVMIDForApp — DB-based VMID lookup
  // -------------------------------------------------------------------------

  describe('DB-based VMID lookup', () => {
    it('should find VMID via database before scanning Proxmox', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      // DB returns a stored VMID
      mockFindFirst.mockResolvedValueOnce({ lxcVmId: 200 });

      // getLXCStatus confirms the VMID exists on the node
      mockClient.getLXCStatus = jest.fn().mockResolvedValue({
        status: 'running',
        name: 'gs-my-app',
      });

      // listLXCs should NOT be called (DB lookup should short-circuit)
      mockClient.listLXCs = jest.fn().mockResolvedValue([]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.waitForTask = jest.fn().mockResolvedValue({ status: 'OK' });

      // Call stop() which internally uses findVMIDForApp
      await provider.stop('my-app');

      // DB was queried
      expect(mockFindFirst).toHaveBeenCalled();

      // getLXCStatus was called to verify VMID exists
      expect(mockClient.getLXCStatus).toHaveBeenCalledWith('pve', 200);

      // stopLXC was called with the DB-provided VMID
      expect(mockClient.stopLXC).toHaveBeenCalledWith('pve', 200);

      // listLXCs was NOT called — DB lookup was sufficient
      expect(mockClient.listLXCs).not.toHaveBeenCalled();
    });

    it('should fall back to hostname scan when DB VMID is stale', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      // DB returns a VMID that no longer exists
      mockFindFirst.mockResolvedValueOnce({ lxcVmId: 999 });

      // getLXCStatus throws (VMID doesn't exist anymore)
      mockClient.getLXCStatus = jest.fn().mockRejectedValue(new Error('VM 999 not found'));

      // Hostname scan finds the correct container
      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 101, name: 'gs-my-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.waitForTask = jest.fn().mockResolvedValue({ status: 'OK' });

      await provider.stop('my-app');

      // Fell through to hostname scan
      expect(mockClient.listLXCs).toHaveBeenCalled();

      // Used the hostname-found VMID
      expect(mockClient.stopLXC).toHaveBeenCalledWith('pve', 101);
    });

    it('should fall back to hostname scan when DB has no VMID', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      // DB returns nothing
      mockFindFirst.mockResolvedValueOnce(null);

      // Hostname scan
      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 105, name: 'gs-my-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
      mockClient.getLXCInterfaces = jest.fn().mockRejectedValue(new Error('no IP'));
      mockClient.stopLXC = jest.fn().mockResolvedValue('UPID:pve:stop');
      mockClient.waitForTask = jest.fn().mockResolvedValue({ status: 'OK' });

      await provider.stop('my-app');

      expect(mockClient.listLXCs).toHaveBeenCalled();
      expect(mockClient.stopLXC).toHaveBeenCalledWith('pve', 105);
    });

    it('should store providerMetadata with VMID in deploy result', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listTemplates = jest.fn().mockResolvedValue([
        { volid: 'local:vztmpl/ubuntu-22.04-standard.tar.zst', format: 'tar.zst', size: 100000 },
      ]);
      mockClient.getNextVMID = jest.fn().mockResolvedValue(150);
      mockClient.createLXC = jest.fn().mockResolvedValue('UPID:pve:create');
      mockClient.waitForTask = jest.fn().mockResolvedValue({ status: 'OK' });
      mockClient.startLXC = jest.fn().mockResolvedValue('UPID:pve:start');
      mockClient.getLXCInterfaces = jest.fn().mockResolvedValue([
        {
          name: 'eth0',
          hwaddr: '00:11:22:33:44:55',
          'ip-addresses': [
            { 'ip-address': '10.0.0.50', 'ip-address-type': 'inet', prefix: 24 },
          ],
        },
      ]);

      const result = await provider.deploy(deployConfig);

      // providerMetadata should contain the VMID for DB storage
      expect(result.providerMetadata).toBeDefined();
      expect(result.providerMetadata!.vmid).toBe(150);
      expect(typeof result.providerMetadata!.vmid).toBe('number');

      // Should also include other useful metadata
      expect(result.providerMetadata!.provider).toBe('proxmox');
      expect(result.providerMetadata!.node).toBe('pve');
      expect(result.providerMetadata!.hostname).toBe('gs-my-test-app');
      expect(result.providerMetadata!.lxcIp).toBe('10.0.0.50');
    });
  });
});
