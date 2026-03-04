import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

import { ProxmoxProvider } from '../../src/providers/proxmox';
import { ProxmoxClient } from '../../src/services/proxmox-client';
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
  });

  // -------------------------------------------------------------------------
  // deploy()
  // -------------------------------------------------------------------------

  describe('deploy()', () => {
    it('should create an LXC, start it, wait for IP, and return a valid DeployResult', async () => {
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

      expect(result.containerId).toBe('pve-100');
      expect(result.containerName).toBe('pve-100');
      expect(result.logs).toBeInstanceOf(Array);
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.providerMetadata).toBeDefined();
      expect(result.providerMetadata!.vmid).toBe(100);
      expect(result.providerMetadata!.provider).toBe('proxmox');
      expect(result.providerMetadata!.lxcIp).toBe('192.168.1.50');

      // Verify createLXC was called with nesting=1 and correct hostname
      expect(mockClient.createLXC).toHaveBeenCalledTimes(1);
      const createArgs = mockClient.createLXC.mock.calls[0];
      expect(createArgs[0]).toBe('pve'); // node
      expect(createArgs[1].features).toBe('nesting=1');
      expect(createArgs[1].hostname).toBe('gs-my-test-app');
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

      waitSpy.mockRestore();
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
    it('should return placeholder messages indicating SSH is not implemented', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);

      const logs = await provider.getLogs('my-test-app');

      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((l) => l.includes('not yet available'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getMetrics()
  // -------------------------------------------------------------------------

  describe('getMetrics()', () => {
    it('should return WorkloadMetrics with converted values', async () => {
      const provider = new ProxmoxProvider(testConfig);
      const mockClient = MockedProxmoxClient.mock.instances[0] as any;

      mockClient.listLXCs = jest.fn().mockResolvedValue([
        { vmid: 100, name: 'gs-my-test-app', status: 'running', mem: 0, maxmem: 0, disk: 0, maxdisk: 0, cpu: 0, maxcpu: 0, uptime: 0 },
      ]);
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
});
